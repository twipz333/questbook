'use strict';
// Pure domain logic: no Electron imports, so it can be unit-tested with plain node.

const DAY_MS = 86400000;

function pad(n) { return String(n).padStart(2, '0'); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Logical day: before `dayStartHour` it is still "yesterday" (so 01:00 counts to the previous evening). */
function dayKey(ts, dayStartHour = 4) {
  const d = new Date(ts - dayStartHour * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // noon avoids DST edges
}

function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekday(key) { return keyToDate(key).getDay(); } // 0 = Sunday

function parseHM(hm) {
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  return { h, m };
}

/** Absolute timestamp of "HH:MM" inside logical day `key`. Times before dayStartHour land on the next calendar day. */
function timeInDay(key, hm, dayStartHour = 4) {
  const t = parseHM(hm);
  if (!t) return null;
  const d = keyToDate(key);
  d.setHours(t.h, t.m, 0, 0);
  let ts = d.getTime();
  if (t.h < dayStartHour) ts += DAY_MS;
  return ts;
}

// ---------- XP & levels ----------
function levelThreshold(level) { return 50 * (level - 1) * level; } // L1:0 L2:100 L3:300 L4:600 L5:1000

function levelInfo(xp) {
  let level = 1;
  while (xp >= levelThreshold(level + 1)) level++;
  const from = levelThreshold(level);
  const to = levelThreshold(level + 1);
  return { level, xp, into: xp - from, need: to - from, pct: Math.round(((xp - from) / (to - from)) * 100) };
}

const TITLES = ['Новобранец', 'Оруженосец', 'Странник', 'Следопыт', 'Рыцарь', 'Ветеран', 'Мастер клинка', 'Хранитель', 'Паладин', 'Легенда'];
function levelTitle(level) { return TITLES[Math.min(level - 1, TITLES.length - 1)]; }

function questXp(q) {
  const est = q.estimateMin || 15;
  let xp = Math.round((10 + est / 3) / 5) * 5;
  xp = Math.max(10, Math.min(120, xp));
  if (q.kind === 'main') xp = Math.round((xp * 1.5) / 5) * 5;
  return xp;
}
const STEP_XP = 3;

function habitXp(h) { return h.xp || ((h.steps && h.steps.length) ? 25 : 15); }

// ---------- Habits ----------
function isScheduled(h, key) {
  if (h.archived) return false;
  if (h.createdAt && key < h.createdDay) return false;
  return !h.days || h.days.length === 0 || h.days.includes(weekday(key));
}

function isDone(state, habitId, key) {
  const d = state.habitLog[key];
  return !!(d && d[habitId] && d[habitId].done);
}

/**
 * Streak with the "never miss twice" rule: a single missed scheduled day is forgiven
 * (does not add, does not reset); two consecutive scheduled misses reset the streak.
 */
function habitStreak(state, h, todayKey) {
  let streak = 0;
  let miss = 0;
  const todayDone = isDone(state, h.id, todayKey);
  let key = todayDone ? todayKey : addDays(todayKey, -1); // today isn't a miss until it's over
  for (let i = 0; i < 730; i++) {
    if (h.createdDay && key < h.createdDay) break;
    if (isScheduled(h, key)) {
      if (isDone(state, h.id, key)) { streak++; miss = 0; }
      else if (++miss >= 2) break;
    }
    key = addDays(key, -1);
  }
  // Last scheduled day was missed -> today must not be missed (or the streak resets)
  const last = lastScheduledBefore(h, todayKey);
  const mustNotMiss = !todayDone && !!last && !isDone(state, h.id, last) && streak > 0;
  return { streak, mustNotMiss };
}

function lastScheduledBefore(h, todayKey) {
  let key = addDays(todayKey, -1);
  for (let i = 0; i < 8; i++) {
    if (h.createdDay && key < h.createdDay) return null;
    if (isScheduled(h, key)) return key;
    key = addDays(key, -1);
  }
  return null;
}

// ---------- Deadlines ----------
const WD_TOKENS = { 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function daysBetween(fromKey, toKey) { return Math.round((keyToDate(toKey) - keyToDate(fromKey)) / DAY_MS); }

/** "сегодня" | "завтра" | "пт" | "25.10" | "25.10.2026" -> logical day key (or null). */
function resolveDayToken(tok, todayKey) {
  const w = tok.toLowerCase();
  if (['сегодня', 'today', 'сейчас', 'now'].includes(w)) return todayKey;
  if (['завтра', 'tomorrow'].includes(w)) return addDays(todayKey, 1);
  if (w === 'послезавтра') return addDays(todayKey, 2);
  if (w in WD_TOKENS) return addDays(todayKey, (WD_TOKENS[w] - weekday(todayKey) + 7) % 7);
  const m = w.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y = m[3] ? +m[3] : keyToDate(todayKey).getFullYear();
  if (m[3] && m[3].length === 2) y += 2000;
  const dt = new Date(y, mo - 1, d, 12);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // 31.02 etc
  let key = `${y}-${pad(mo)}-${pad(d)}`;
  if (!m[3] && key < todayKey) key = `${y + 1}-${pad(mo)}-${pad(d)}`; // "@05.01" in December = next year
  return key;
}

/** Human label for a quest deadline. */
function dueInfo(q, now = Date.now(), dayStartHour = 4) {
  if (!q || !q.dueDay) return null;
  const today = dayKey(now, dayStartHour);
  const diff = daysBetween(today, q.dueDay);
  const ts = q.dueTime ? timeInDay(q.dueDay, q.dueTime, dayStartHour) : null;
  const overdue = diff < 0 || (ts !== null && now > ts);
  let day;
  if (diff === 0) day = 'сегодня';
  else if (diff === 1) day = 'завтра';
  else if (diff === 2) day = 'послезавтра';
  else if (diff > 2 && diff < 7) day = WD_SHORT[weekday(q.dueDay)];
  else { const d = keyToDate(q.dueDay); day = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }
  let label = q.dueTime ? `${day} до ${q.dueTime}` : `до ${day === 'сегодня' ? 'конца дня' : day}`;
  if (diff < 0) label = `просрочен на ${-diff} ${plural(-diff, 'день', 'дня', 'дней')}`;
  else if (overdue) label = `просрочен · был до ${q.dueTime}`;
  const minutesLeft = ts !== null ? Math.round((ts - now) / 60000) : null;
  return { label, overdue, isToday: diff === 0, diff, ts, minutesLeft, sortKey: ts || (keyToDate(q.dueDay).getTime() + 12 * 3600000) };
}

/** Keep only http(s) links; add https:// to "example.com/…"; title falls back to the host. */
function cleanLinks(list) {
  const out = [];
  for (const l of list || []) {
    let url = String((l && l.url) || '').trim();
    if (!url) continue;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    let host;
    try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') continue; host = u.hostname.replace(/^www\./, ''); url = u.href; } catch (_) { continue; }
    out.push({ title: String(l.title || '').trim().slice(0, 80), url, host });
    if (out.length >= 10) break;
  }
  return out;
}

// ---------- Quick capture parsing ----------
/**
 * "Починить алерты ~30 ! #работа @завтра 22:00 > открыть дашборд"
 *   ~30 | 30м | 2ч             -> estimate
 *   !                          -> main quest
 *   #работа/#work              -> area work (default is life); #жизнь/#дом -> life
 *   @сегодня                   -> into today's plan (+ due today)
 *   @завтра @послезавтра @пт @25.10 @25.10.2026 -> deadline day
 *   22:00 | до 22:00 | @22:00  -> deadline time (today if no day given)
 *   > text                     -> first step
 *   [text](https://…) or a bare https://… -> attached link
 */
function parseCapture(text, now = Date.now(), dayStartHour = 4) {
  let t = ' ' + text.trim() + ' ';
  const out = { title: '', estimateMin: null, kind: 'side', area: null, today: false, nextStep: '', dueDay: null, dueTime: null, links: [] };
  // links first: URLs contain ':' and digits that would look like a time or a date
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu, (_, title, url) => { out.links.push({ title: title.trim(), url }); return title; });
  t = t.replace(/\s(https?:\/\/\S+)(?=\s)/giu, (_, url) => { out.links.push({ title: '', url }); return ' '; });
  const ns = t.indexOf('>');
  if (ns >= 0) { out.nextStep = t.slice(ns + 1).trim(); t = t.slice(0, ns) + ' '; }
  const todayKey = dayKey(now, dayStartHour);
  // time first, so "@25.10 22:00" and "до 22:00" both work
  t = t.replace(/\s@?(?:до\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/iu, (_, h, m) => { out.dueTime = `${pad(+h)}:${m}`; return ' '; });
  t = t.replace(/\s@(сегодня|today|сейчас|now|послезавтра|завтра|tomorrow|пн|вт|ср|чт|пт|сб|вс|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\.\d{1,2}(?:\.\d{4}|\.\d{2})?)(?=\s)/iu, (all, w) => {
    const key = resolveDayToken(w, todayKey);
    if (!key) return all;
    out.dueDay = key; return ' ';
  });
  t = t.replace(/\s~?(\d{1,3})\s?(мин|м|min|m)(?=\s)/iu, (_, n) => { out.estimateMin = +n; return ' '; });
  t = t.replace(/\s~?(\d{1,2}(?:[.,]\d)?)\s?(ч|h)(?=\s)/iu, (_, n) => { out.estimateMin = Math.round(parseFloat(n.replace(',', '.')) * 60); return ' '; });
  t = t.replace(/\s~(\d{1,3})(?=\s)/u, (_, n) => { out.estimateMin = +n; return ' '; });
  t = t.replace(/\s!(?=\s)/u, () => { out.kind = 'main'; return ' '; });
  t = t.replace(/\s#(работа|work|раб)(?=\s)/iu, () => { out.area = 'work'; return ' '; });
  t = t.replace(/\s#(жизнь|life|дом|home|личное)(?=\s)/iu, () => { out.area = 'life'; return ' '; });
  if (out.dueTime && !out.dueDay) out.dueDay = todayKey;
  out.today = out.dueDay === todayKey;
  // plain "@сегодня" means "into today's plan", not a deadline; with a time it is both
  if (out.today && !out.dueTime) out.dueDay = null;
  out.title = t.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------- Sagas (long-running goals) ----------
const CHAPTER_XP = 50;
const SAGA_XP = 200;
const SAGA_SESSION_XP = 10; // a session logged without a quest
const SAGA_STEP_XP = 5;
const SHORT_SESSIONS = [5, 10, 15];

/** Monday of the week that contains `key`. */
function weekStart(key) { return addDays(key, -((weekday(key) + 6) % 7)); }

/** Normalise a chapter coming from older data (only id/title/done existed before 1.2). */
function chapterOf(c) {
  return {
    ...c,
    goal: c.goal || '',
    criterion: c.criterion || '',
    steps: Array.isArray(c.steps) ? c.steps : [],
  };
}

/** Last moment the saga was touched: session, chapter or step done, creation, resume. */
function sagaLastTouch(state, g) {
  const log = (state.sagaLog || []).filter((e) => e.sagaId === g.id);
  const chapters = (g.chapters || []).map(chapterOf);
  const ts = [g.createdAt || 0, g.resumedAt || 0, ...log.map((e) => e.at),
    ...chapters.map((c) => c.doneAt || 0),
    ...chapters.flatMap((c) => c.steps.map((st) => st.doneAt || 0))];
  return Math.max(...ts);
}

function sagaView(state, g, now = Date.now()) {
  const dsh = state.settings.dayStartHour;
  const today = dayKey(now, dsh);
  const ws = weekStart(today);
  const log = (state.sagaLog || []).filter((e) => e.sagaId === g.id).sort((a, b) => b.at - a.at);
  const weekSessions = log.filter((e) => dayKey(e.at, dsh) >= ws).length;
  const totalMin = log.reduce((a, e) => a + (e.min || 0), 0);
  const chapters = (g.chapters || []).map(chapterOf);
  const doneCh = chapters.filter((c) => c.done).length;
  const current = chapters.find((c) => !c.done) || null;
  const lastTouch = sagaLastTouch(state, g);
  const quietDays = Math.max(0, Math.floor((now - lastTouch) / DAY_MS));
  const status = g.status || 'active';
  const quietLimit = g.quietDays || 5;
  const isQuiet = status === 'active' && quietDays >= quietLimit;
  const open = state.quests.find((q) => q.sagaId === g.id && q.status !== 'done') || null;
  const types = Array.isArray(g.sessionTypes) ? g.sessionTypes : [];
  const typeName = (id) => (types.find((t) => t.id === id) || {}).name || '';
  // what to do next: the first unfinished step of the current chapter
  const nextStep = current ? current.steps.find((st) => !st.done) || null : null;
  const sessionMin = g.sessionMin || 30;
  // coming back after a pause -> suggest the smallest step in; otherwise the last chosen length
  const suggestedMin = isQuiet ? 5 : (g.lastPlannedMin || sessionMin);
  // type distribution over the last 30 days
  const since = now - 30 * DAY_MS;
  const typeStats = types.map((t) => ({ id: t.id, name: t.name, count: log.filter((e) => e.at >= since && e.typeId === t.id).length }));
  const stepText = (e) => {
    if (!e.stepId) return '';
    for (const c of chapters) { const st = c.steps.find((x) => x.id === e.stepId); if (st) return st.text; }
    return e.stepText || '';
  };
  const history = log.slice(0, 8).map((e) => ({
    id: e.id, at: e.at, min: e.min || 0, estimated: !!e.estimated, note: e.note || '',
    type: typeName(e.typeId), step: e.stepDone ? stepText(e) : '', wrapped: !!e.wrapped,
    chapter: (chapters.find((c) => c.id === e.chapterId) || {}).title || '',
  }));
  return {
    id: g.id, title: g.title, why: g.why || '', area: g.area || 'life', status,
    chapters, doneCh, totalCh: chapters.length,
    pct: chapters.length ? Math.round((doneCh / chapters.length) * 100) : 0,
    current, nextStep,
    curStepsDone: current ? current.steps.filter((st) => st.done).length : 0,
    curStepsTotal: current ? current.steps.length : 0,
    weekSessions, target: g.targetPerWeek || 3, sessionMin, suggestedMin,
    durations: [...new Set([...SHORT_SESSIONS, sessionMin])].sort((a, b) => a - b),
    quietLimit, quietDays, isQuiet, lastTouch,
    remind: g.remind !== false, remindEvery: g.remindEvery || 7,
    types, lastTypeId: types.some((t) => t.id === g.lastTypeId) ? g.lastTypeId : (types[0] || {}).id || null,
    typeStats, history,
    totalMin, sessions: log.length, openQuestId: open ? open.id : null, openActive: !!(open && state.activeQuestId === open.id),
    doneAt: g.doneAt || null,
  };
}

/** Should the scheduler nudge this saga now? First after quietDays, then every remindEvery days. */
function sagaNudgeDue(g, view, now) {
  if (view.status !== 'active' || !view.remind || !view.isQuiet) return false;
  const last = g.lastNudgeAt || 0;
  if (last < view.lastTouch) return true; // activity since the last nudge resets the cycle
  return now - last >= view.remindEvery * DAY_MS;
}

// ---------- Default state ----------
function defaultState(now = Date.now()) {
  const today = dayKey(now, 4);
  const mk = (title, extra) => ({ id: uid(), title, createdAt: now, createdDay: today, archived: false, steps: [], days: [], time: null, remind: [], hard: false, ...extra });
  return {
    version: 1,
    settings: {
      dayStartHour: 4,
      workStart: '10:00', workEnd: '19:00', workDays: [1, 2, 3, 4, 5],
      nudgeIdleMin: 40,
      nudgeFreeMin: 90,           // outside work hours; 0 = off
      activeStart: '09:00', activeEnd: '22:00', // when reminders may come at all
      focusCheckMin: 50,
      todayLimit: 3,
      hudEnabled: true, hudOnTop: true, hudCollapsed: false, hudBounds: null, hudAnchor: 'auto',
      hotkeyCapture: 'Control+Alt+Q', hotkeyHud: 'Control+Alt+H',
      autostart: true,
      theme: 'dark',
      morningBriefing: true,
      eveningReview: '21:30',
      reduceMotion: false,
    },
    player: { xp: 0 },
    quests: [],
    activeQuestId: null,
    activeSince: null,
    habits: [
      mk('Ритуал отбоя', {
        kind: 'ritual', time: '23:30', remind: [-60, -15, 0, 20, 45], hard: true,
        steps: [
          { id: uid(), text: 'Закрыть ноутбук и рабочие чаты' },
          { id: uid(), text: 'Телефон на зарядку вне кровати' },
          { id: uid(), text: 'Приглушить свет' },
          { id: uid(), text: 'Лечь в кровать' },
        ],
      }),
      mk('Пройти 6000 шагов', { kind: 'habit', days: [] }),
    ],
    habitLog: {},
    sagas: [],
    sagaLog: [],
    log: [],
    fired: {},
    meta: { lastBriefing: null, lastReview: null, lastNudgeAt: 0, lastFocusCheckAt: 0, snoozes: {} },
  };
}

// ---------- Work / free time ----------
/** 'work' inside work hours on a workday, otherwise 'free'. */
function timeMode(settings, now = Date.now()) {
  const today = dayKey(now, settings.dayStartHour);
  if (!(settings.workDays || []).includes(weekday(today))) return 'free';
  const ws = timeInDay(today, settings.workStart, settings.dayStartHour);
  const we = timeInDay(today, settings.workEnd, settings.dayStartHour);
  return ws && we && now >= ws && now < we ? 'work' : 'free';
}

/** Hours when nudges are allowed at all (deadlines and rituals ignore this). */
function inActiveHours(settings, now = Date.now()) {
  const today = dayKey(now, settings.dayStartHour);
  const a = timeInDay(today, settings.activeStart || '09:00', settings.dayStartHour);
  const b = timeInDay(today, settings.activeEnd || '22:00', settings.dayStartHour);
  return now >= a && now < b;
}

/** Spheres to suggest, in order: work hours prefer work and fall back to life; free time is life only. */
function preferredAreas(mode) { return mode === 'work' ? ['work', 'life'] : ['life']; }

/**
 * What to suggest when nothing is active.
 * -> { kind: 'quest', quest, due } | { kind: 'saga', saga } | { kind: 'plan', area } | null
 */
function pickSuggestion(view, mode) {
  const areaOf = (x) => (x.area === 'work' ? 'work' : 'life');
  for (const area of preferredAreas(mode)) {
    const q = view.todayQuests.find((x) => areaOf(x) === area && !x.sagaId);
    if (q) return { kind: 'quest', quest: q };
    const d = view.dueSoon.find((x) => areaOf(x) === area);
    if (d) return { kind: 'quest', quest: d, due: true };
    const g = view.sagas
      .filter((x) => x.status === 'active' && areaOf(x) === area && x.current && x.weekSessions < x.target && !x.openActive)
      .sort((a, b) => a.weekSessions / a.target - b.weekSessions / b.target)[0];
    if (g) return { kind: 'saga', saga: g };
  }
  if (mode === 'work') return { kind: 'plan', area: view.inbox.some((x) => x.area === 'work') ? 'work' : null };
  return null;
}

// ---------- View model ----------
function fmtHM(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildView(state, now = Date.now()) {
  const s = state.settings;
  const today = dayKey(now, s.dayStartHour);
  const lvl = levelInfo(state.player.xp);
  const active = state.quests.find((q) => q.id === state.activeQuestId) || null;

  const byDue = (a, b) => ((dueInfo(a, now, s.dayStartHour) || { sortKey: 9e15 }).sortKey) - ((dueInfo(b, now, s.dayStartHour) || { sortKey: 9e15 }).sortKey);
  const mode = timeMode(s, now);
  const pref = (q) => (preferredAreas(mode)[0] === (q.area === 'work' ? 'work' : 'life') ? 0 : 1);
  const todayQuests = state.quests.filter((q) => q.status === 'today').sort((a, b) => pref(a) - pref(b) || byDue(a, b));
  const inbox = state.quests.filter((q) => q.status === 'inbox');
  // deadline today or already passed, but not in today's plan yet
  const dueSoon = inbox.filter((q) => q.dueDay && q.dueDay <= today).sort(byDue);
  const doneToday = state.quests.filter((q) => q.status === 'done' && q.doneDay === today);

  const habits = state.habits.filter((h) => !h.archived).map((h) => {
    const sched = isScheduled(h, today);
    const entry = (state.habitLog[today] || {})[h.id] || null;
    const st = habitStreak(state, h, today);
    const target = h.time ? timeInDay(today, h.time, s.dayStartHour) : null;
    return {
      id: h.id, title: h.title, kind: h.kind, time: h.time, hard: h.hard,
      days: h.days, remind: h.remind, steps: h.steps, xp: habitXp(h),
      scheduled: sched, done: !!(entry && entry.done), stepsDone: (entry && entry.steps) || [],
      streak: st.streak, mustNotMiss: sched && st.mustNotMiss,
      target, minutesLeft: target ? Math.round((target - now) / 60000) : null,
    };
  });
  const todayHabits = habits.filter((h) => h.scheduled)
    .sort((a, b) => (a.done - b.done) || ((a.target || 9e15) - (b.target || 9e15)));

  // Single "next action" (ADHD rule #1: lead with the next action)
  let next = null;
  const overdueRitual = todayHabits.find((h) => !h.done && h.target && h.minutesLeft <= 30);
  if (overdueRitual) {
    const firstStep = (overdueRitual.steps || []).find((st) => !overdueRitual.stepsDone.includes(st.id));
    next = { type: 'habit', id: overdueRitual.id, title: overdueRitual.title, action: firstStep ? firstStep.text : 'Отметь, когда сделаешь', minutesLeft: overdueRitual.minutesLeft };
  } else if (active) {
    const step = (active.steps || []).find((x) => !x.done);
    next = { type: 'active', id: active.id, title: active.title, action: active.nextStep || (step && step.text) || 'Сделай первый маленький шаг', estimateMin: active.estimateMin };
  } else if (todayQuests.length) {
    const q = todayQuests[0];
    next = { type: 'quest', id: q.id, title: q.title, action: q.nextStep || 'Начни квест — первые 5 минут', estimateMin: q.estimateMin };
  } else if (inbox.length) {
    next = { type: 'plan', title: 'Выбери квесты на сегодня', action: `В книге ${inbox.length} ${plural(inbox.length, 'квест', 'квеста', 'квестов')} ждут` };
  } else {
    next = { type: 'empty', title: 'Книга пуста', action: 'Запиши один квест: Ctrl+Alt+Q' };
  }

  const xpToday = state.log.filter((e) => dayKey(e.at, s.dayStartHour) === today).reduce((a, e) => a + (e.xp || 0), 0);
  const activeElapsedMin = active && state.activeSince ? Math.floor((now - state.activeSince) / 60000) + Math.floor((active.focusSec || 0) / 60) : 0;

  const bedtime = todayHabits.find((h) => h.kind === 'ritual' && h.target && !h.done) || null;

  return {
    now, today, level: { ...lvl, title: levelTitle(lvl.level) },
    active, activeElapsedMin, next,
    todayQuests, inbox, doneToday, dueSoon, mode,
    habits, todayHabits,
    habitsDone: todayHabits.filter((h) => h.done).length,
    xpToday,
    sagas: (state.sagas || []).filter((g) => g.status !== 'archived').map((g) => sagaView(state, g, now)),
    bedtime: bedtime ? { id: bedtime.id, title: bedtime.title, time: bedtime.time, minutesLeft: bedtime.minutesLeft } : null,
    settings: s,
  };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const API = {
  uid, dayKey, addDays, weekday, timeInDay, parseHM, fmtHM,
  levelInfo, levelTitle, questXp, habitXp, STEP_XP,
  isScheduled, isDone, habitStreak, parseCapture, timeMode, inActiveHours, preferredAreas, pickSuggestion, dueInfo, cleanLinks, resolveDayToken, daysBetween, defaultState, buildView, plural, DAY_MS,
  weekStart, sagaView, sagaNudgeDue, chapterOf, CHAPTER_XP, SAGA_XP, SAGA_SESSION_XP, SAGA_STEP_XP,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else globalThis.QBLogic = API;

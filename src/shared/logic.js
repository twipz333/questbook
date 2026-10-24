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

// ---------- Quick capture parsing ----------
/**
 * "Починить алерты ~30 !  #работа @сегодня"
 *   ~30 | 30м | 2ч  -> estimate
 *   !               -> main quest
 *   #работа/#work   -> area work; #жизнь/#life/#дом -> life
 *   @сегодня/@today -> put into today
 *   > next step text (after ">")
 */
function parseCapture(text) {
  let t = ' ' + text.trim() + ' ';
  const out = { title: '', estimateMin: null, kind: 'side', area: null, today: false, nextStep: '' };
  const ns = t.indexOf('>');
  if (ns >= 0) { out.nextStep = t.slice(ns + 1).trim(); t = t.slice(0, ns) + ' '; }
  t = t.replace(/\s~?(\d{1,3})\s?(мин|м|min|m)(?=\s)/iu, (_, n) => { out.estimateMin = +n; return ' '; });
  t = t.replace(/\s~?(\d{1,2}(?:[.,]\d)?)\s?(ч|h)(?=\s)/iu, (_, n) => { out.estimateMin = Math.round(parseFloat(n.replace(',', '.')) * 60); return ' '; });
  t = t.replace(/\s~(\d{1,3})(?=\s)/u, (_, n) => { out.estimateMin = +n; return ' '; });
  t = t.replace(/\s!(?=\s)/u, () => { out.kind = 'main'; return ' '; });
  t = t.replace(/\s#(работа|work|раб)(?=\s)/iu, () => { out.area = 'work'; return ' '; });
  t = t.replace(/\s#(жизнь|life|дом|home|личное)(?=\s)/iu, () => { out.area = 'life'; return ' '; });
  t = t.replace(/\s@(сегодня|today|сейчас|now)(?=\s)/iu, () => { out.today = true; return ' '; });
  out.title = t.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------- Sagas (long-running goals) ----------
const CHAPTER_XP = 50;
const SAGA_XP = 200;
const SAGA_SESSION_XP = 10; // a session logged without a quest

/** Monday of the week that contains `key`. */
function weekStart(key) { return addDays(key, -((weekday(key) + 6) % 7)); }

function sagaView(state, g, now = Date.now()) {
  const dsh = state.settings.dayStartHour;
  const today = dayKey(now, dsh);
  const ws = weekStart(today);
  const log = (state.sagaLog || []).filter((e) => e.sagaId === g.id);
  const weekSessions = log.filter((e) => dayKey(e.at, dsh) >= ws).length;
  const totalMin = log.reduce((a, e) => a + (e.min || 0), 0);
  const chapters = g.chapters || [];
  const doneCh = chapters.filter((c) => c.done).length;
  const current = chapters.find((c) => !c.done) || null;
  const touches = [g.createdAt || 0, ...log.map((e) => e.at), ...chapters.map((c) => c.doneAt || 0)];
  const lastTouch = Math.max(...touches);
  const quietDays = Math.floor((now - lastTouch) / DAY_MS);
  const open = state.quests.find((q) => q.sagaId === g.id && q.status !== 'done') || null;
  return {
    id: g.id, title: g.title, why: g.why || '', area: g.area || 'life', status: g.status || 'active',
    chapters, doneCh, totalCh: chapters.length,
    pct: chapters.length ? Math.round((doneCh / chapters.length) * 100) : 0,
    current, weekSessions, target: g.targetPerWeek || 3, sessionMin: g.sessionMin || 30,
    quietLimit: g.quietDays || 5, quietDays, isQuiet: (g.status || 'active') === 'active' && quietDays >= (g.quietDays || 5),
    totalMin, sessions: log.length, openQuestId: open ? open.id : null, openActive: !!(open && state.activeQuestId === open.id),
    doneAt: g.doneAt || null,
  };
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

  const todayQuests = state.quests.filter((q) => q.status === 'today');
  const inbox = state.quests.filter((q) => q.status === 'inbox');
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
    todayQuests, inbox, doneToday,
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
  isScheduled, isDone, habitStreak, parseCapture, defaultState, buildView, plural, DAY_MS,
  weekStart, sagaView, CHAPTER_XP, SAGA_XP, SAGA_SESSION_XP,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else globalThis.QBLogic = API;

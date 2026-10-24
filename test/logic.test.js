'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/shared/logic');
const { createActions } = require('../src/main/actions');
const { tick } = require('../src/main/scheduler');

const at = (s) => new Date(s).getTime();

test('dayKey: 01:30 belongs to previous day', () => {
  assert.equal(L.dayKey(at('2026-10-25T01:30:00'), 4), '2026-10-24');
  assert.equal(L.dayKey(at('2026-10-25T04:10:00'), 4), '2026-10-25');
});

test('timeInDay: 00:30 bedtime lands after midnight of logical day', () => {
  assert.equal(L.timeInDay('2026-10-24', '00:30', 4), at('2026-10-25T00:30:00'));
});

test('levels', () => {
  assert.equal(L.levelInfo(0).level, 1);
  assert.equal(L.levelInfo(100).level, 2);
  assert.equal(L.levelInfo(299).level, 2);
  assert.equal(L.levelInfo(300).level, 3);
});

test('parseCapture', () => {
  const p = L.parseCapture('Починить алерты Prometheus ~30 ! #работа @сегодня > открыть дашборд');
  assert.equal(p.title, 'Починить алерты Prometheus');
  assert.equal(p.estimateMin, 30);
  assert.equal(p.kind, 'main');
  assert.equal(p.area, 'work');
  assert.equal(p.today, true);
  assert.equal(p.nextStep, 'открыть дашборд');
  assert.equal(L.parseCapture('Созвон 1.5ч').estimateMin, 90);
  assert.equal(L.parseCapture('Купить корм 15м #дом').area, 'life');
  assert.equal(L.parseCapture('Купить корм 15м #дом').estimateMin, 15);
  assert.equal(L.parseCapture('Купить корм 15м #дом').title, 'Купить корм');
});

test('streak: never miss twice', () => {
  let now = at('2026-10-10T12:00:00');
  const s = L.defaultState(now);
  const h = s.habits[1]; // daily habit
  h.createdDay = '2026-10-01';
  const done = (k) => { s.habitLog[k] = { [h.id]: { done: true, steps: [] } }; };
  ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'].forEach(done); // 07 missed once
  assert.equal(L.habitStreak(s, h, '2026-10-10').streak, 4);
  // two consecutive misses reset
  const s2 = JSON.parse(JSON.stringify(s));
  delete s2.habitLog['2026-10-08']; delete s2.habitLog['2026-10-09'];
  assert.equal(L.habitStreak(s2, s2.habits[1], '2026-10-10').streak, 0);
  // yesterday missed -> must not miss today
  const s3 = JSON.parse(JSON.stringify(s));
  delete s3.habitLog['2026-10-09'];
  const r = L.habitStreak(s3, s3.habits[1], '2026-10-10');
  assert.equal(r.streak, 3);
  assert.equal(r.mustNotMiss, true);
});

test('actions: today limit blocks 4th', () => {
  const t = at('2026-10-24T11:00:00');
  const s = L.defaultState(t);
  const A = createActions(() => s, () => t);
  for (const x of ['a', 'b', 'c']) A.questAdd({ title: x, today: true });
  const d = A.questAdd({ title: 'd' }).id;
  assert.equal(A.questToToday(d).ok, false);
  const r = A.questComplete(s.quests.find((q) => q.title === 'a').id);
  assert.ok(r.xp >= 10);
  assert.equal(s.player.xp, r.xp);
  assert.equal(A.questToToday(d).ok, true);
});

test('actions: ritual steps auto-complete habit and undo revokes xp', () => {
  const t = at('2026-10-24T23:00:00');
  const s = L.defaultState(t);
  const A = createActions(() => s, () => t);
  const h = s.habits[0];
  for (const st of h.steps) A.habitToggleStep(h.id, st.id);
  assert.equal(L.isDone(s, h.id, '2026-10-24'), true);
  assert.equal(s.player.xp, 25);
  A.habitToggle(h.id);
  assert.equal(s.player.xp, 0);
});

test('scheduler: bedtime reminders, overlay, no duplicates', () => {
  let t = at('2026-10-24T22:30:00');
  const s = L.defaultState(t);
  s.meta.lastBriefing = '2026-10-24'; s.meta.lastReview = '2026-10-24';
  let ev = tick(s, { now: t, idleSec: 0 });
  assert.equal(ev.filter((e) => e.kind === 'notify').length, 1);
  assert.match(ev[0].title, /Через 60 мин/);
  ev = tick(s, { now: t + 60000, idleSec: 0 });
  assert.equal(ev.length, 0);
  t = at('2026-10-24T23:31:00');
  ev = tick(s, { now: t, idleSec: 0 });
  assert.ok(ev.some((e) => e.kind === 'overlay'));
  assert.ok(ev.some((e) => e.kind === 'notify' && /сейчас/.test(e.title)));
  const A = createActions(() => s, () => t);
  A.snooze(s.habits[0].id, 10);
  ev = tick(s, { now: t + 60000, idleSec: 0 });
  assert.ok(!ev.some((e) => e.kind === 'overlay'));
  ev = tick(s, { now: t + 11 * 60000, idleSec: 0 });
  assert.ok(ev.some((e) => e.kind === 'overlay'));
  // after midnight still same logical day
  ev = tick(s, { now: at('2026-10-25T00:20:00'), idleSec: 0 });
  assert.ok(ev.some((e) => e.kind === 'overlay'));
});

test('scheduler: work nudge only when at PC and no active quest', () => {
  const t = at('2026-10-26T11:00:00'); // Monday
  const s = L.defaultState(t);
  s.meta.lastBriefing = '2026-10-26';
  assert.equal(tick(s, { now: t, idleSec: 600 }).length, 0);
  const ev = tick(s, { now: t, idleSec: 5 });
  assert.equal(ev.length, 1);
  assert.match(ev[0].title, /Нет активного квеста/);
  assert.equal(tick(s, { now: t + 60000, idleSec: 5 }).length, 0);
});

test('sagas: session quest skips the daily limit, logs session, chapters give xp', () => {
  let t = at('2026-10-21T19:00:00'); // Wednesday
  const s = L.defaultState(t);
  const A = createActions(() => s, () => t);
  for (const x of ['a', 'b', 'c']) A.questAdd({ title: x, today: true });
  A.sagaSave({ title: 'Изучить Electron', targetPerWeek: 3, sessionMin: 30, chapters: [{ title: 'Tutorial' }, { title: 'IPC' }] });
  const g = s.sagas[0];
  const r = A.sagaStartSession(g.id);
  assert.equal(r.ok, true);
  const q = s.quests.find((x) => x.sagaId === g.id);
  assert.equal(q.status, 'today');
  assert.equal(s.quests.filter((x) => x.status === 'today' && !x.sagaId).length, 3); // nothing swapped out
  t += 25 * 60000;
  const c = A.questComplete(q.id);
  assert.match(c.toast, /1\/3 на неделе/);
  assert.equal(s.sagaLog.length, 1);
  assert.equal(s.sagaLog[0].min, 25);
  assert.equal(A.sagaLogSession(g.id).ok, false); // real duration is required now
  A.sagaLogSession(g.id, { min: 20 });
  assert.equal(L.sagaView(s, g, t).weekSessions, 2);
  const xp0 = s.player.xp;
  A.sagaToggleChapter(g.id, g.chapters[0].id);
  assert.equal(s.player.xp, xp0 + 50);
  const fin = A.sagaToggleChapter(g.id, g.chapters[1].id);
  assert.equal(fin.sagaDone, true);
  assert.equal(g.status, 'done');
  assert.equal(s.player.xp, xp0 + 300);
  A.sagaToggleChapter(g.id, g.chapters[1].id); // undo
  assert.equal(g.status, 'active');
  assert.equal(s.player.xp, xp0 + 50);
  // next monday -> week counter resets
  assert.equal(L.sagaView(s, g, at('2026-10-26T12:00:00')).weekSessions, 0);
});

// ---------------------------------------------------------------- sagas 1.2
const { migrate } = require('../src/main/store');

function sagaFixture(t0 = at('2026-10-05T12:00:00')) {
  let t = t0;
  const s = L.defaultState(t);
  s.meta.lastBriefing = '2099-01-01'; s.meta.lastReview = '2099-01-01';
  const A = createActions(() => s, () => t);
  A.sagaSave({ title: 'Япония 2.0', targetPerWeek: 3, sessionMin: 30, quietDays: 5,
    chapters: [{ title: 'Возвращение' }, { title: 'Кана' }],
    sessionTypes: [{ name: 'Игра' }, { name: 'Повторение' }] });
  const g = s.sagas[0];
  A.chapterSave(g.id, g.chapters[0].id, {
    title: 'Возвращение', goal: 'Вернуться без перегруза', criterion: 'Провести 3 спокойных занятия',
    steps: [{ text: 'Открыть Wagotabi' }, { text: 'Повторить знакомое 15 минут' }, { text: 'Ещё одно занятие без нового' }],
  });
  return { s, A, g, setT: (x) => { t = x; }, getT: () => t };
}

test('saga edit keeps chapter ids, plan and progress', () => {
  const { s, A, g } = sagaFixture();
  const ch0 = g.chapters[0];
  A.chapterToggleStep(g.id, ch0.id, ch0.steps[0].id);
  A.sagaToggleChapter(g.id, g.chapters[1].id);
  // the saga editor only sends id + title (and may reorder / add / rename)
  A.sagaSave({ id: g.id, title: 'Япония 2.0', chapters: [{ id: g.chapters[1].id, title: 'Кана' }, { id: ch0.id, title: 'Возвращение (мягко)' }, { title: 'Грамматика' }], sessionTypes: g.sessionTypes });
  const c0 = g.chapters.find((c) => c.id === ch0.id);
  assert.equal(c0.title, 'Возвращение (мягко)');
  assert.equal(c0.criterion, 'Провести 3 спокойных занятия');
  assert.equal(c0.steps.length, 3);
  assert.equal(c0.steps[0].done, true);
  assert.equal(g.chapters[0].done, true); // Кана stays done
  assert.equal(g.chapters[2].steps.length, 0);
  assert.equal(g.sessionTypes.length, 2);
  // chapterSave keeps step done state by id, drops removed steps
  A.chapterSave(g.id, ch0.id, { title: c0.title, goal: c0.goal, criterion: c0.criterion, steps: [{ id: c0.steps[0].id, text: 'Открыть Wagotabi и вспомнить управление' }, { text: 'Новый шаг' }] });
  const c0b = g.chapters.find((c) => c.id === ch0.id);
  assert.equal(c0b.steps[0].done, true);
  assert.equal(c0b.steps[0].text, 'Открыть Wagotabi и вспомнить управление');
  assert.equal(c0b.steps[1].done, false);
  void s;
});

test('steps tick independently and never close the chapter; xp once, undo revokes', () => {
  const { s, A, g } = sagaFixture();
  const ch = g.chapters[0];
  const xp0 = s.player.xp;
  for (const st of ch.steps) A.chapterToggleStep(g.id, ch.id, st.id);
  assert.equal(g.chapters[0].done, false);
  assert.equal(s.player.xp, xp0 + 3 * L.SAGA_STEP_XP);
  A.chapterToggleStep(g.id, ch.id, ch.steps[0].id, true); // already done -> no extra xp
  assert.equal(s.player.xp, xp0 + 3 * L.SAGA_STEP_XP);
  A.chapterToggleStep(g.id, ch.id, ch.steps[0].id);
  assert.equal(s.player.xp, xp0 + 2 * L.SAGA_STEP_XP);
});

test('session start uses the concrete next step, other step, or none; reuses the open quest', () => {
  const { s, A, g } = sagaFixture();
  const ch = g.chapters[0];
  A.sagaStartSession(g.id);
  let q = s.quests.find((x) => x.sagaId === g.id);
  assert.equal(q.nextStep, 'Открыть Wagotabi');
  assert.equal(q.sagaStepId, ch.steps[0].id);
  assert.equal(q.estimateMin, 30);
  assert.equal(s.activeQuestId, q.id);
  A.sagaStartSession(g.id, { stepId: ch.steps[1].id, min: 10, typeId: g.sessionTypes[1].id });
  assert.equal(s.quests.filter((x) => x.sagaId === g.id).length, 1); // no duplicate session quest
  q = s.quests.find((x) => x.sagaId === g.id);
  assert.equal(q.nextStep, 'Повторить знакомое 15 минут');
  assert.equal(q.estimateMin, 10);
  assert.equal(g.lastPlannedMin, 10);
  assert.equal(g.lastTypeId, g.sessionTypes[1].id);
  A.sagaStartSession(g.id, { stepId: 'none' });
  q = s.quests.find((x) => x.sagaId === g.id);
  assert.equal(q.sagaStepId, null);
  assert.match(q.nextStep, /Возвращение/);
  assert.equal(L.sagaView(s, g).lastTypeId, g.sessionTypes[1].id);
});

test('saga with no steps keeps the old behaviour', () => {
  const { s, A, g } = sagaFixture();
  A.sagaStartSession(g.id); // fine
  const g2 = (A.sagaSave({ title: 'Старый стиль', chapters: [{ title: 'Глава' }] }), s.sagas[1]);
  A.sagaStartSession(g2.id);
  const q = s.quests.find((x) => x.sagaId === g2.id);
  assert.equal(q.sagaStepId, null);
  assert.match(q.nextStep, /Глава/);
});

test('session completion: real minutes, estimated fallback, no double logging or xp', () => {
  const { s, A, g, setT, getT } = sagaFixture();
  A.sagaStartSession(g.id, { min: 15 });
  let q = s.quests.find((x) => x.sagaId === g.id);
  setT(getT() + 20 * 1000); // interrupted after 20 seconds
  const r = A.questComplete(q.id);
  assert.equal(r.sagaSession.min, 1);
  assert.equal(r.sagaSession.estimated, false);
  assert.equal(r.sagaSession.stepId, g.chapters[0].steps[0].id);
  const xp = s.player.xp;
  assert.equal(A.questComplete(q.id).ok, false); // double click
  assert.equal(s.player.xp, xp);
  assert.equal(s.sagaLog.length, 1);
  // never started (completed from the book) -> planned length, flagged as estimated
  A.sagaStartSession(g.id, { min: 10 });
  q = s.quests.find((x) => x.sagaId === g.id && x.status !== 'done');
  A.questPause(); q.focusSec = 0;
  const r2 = A.questComplete(q.id);
  assert.equal(r2.sagaSession.min, 10);
  assert.equal(r2.sagaSession.estimated, true);
  // 37 minutes of focus
  A.sagaStartSession(g.id);
  q = s.quests.find((x) => x.sagaId === g.id && x.status !== 'done');
  setT(getT() + 37 * 60000);
  assert.equal(A.questComplete(q.id).sagaSession.min, 37);
  // reopening a session quest removes its log entry
  A.questReopen(q.id);
  assert.equal(s.sagaLog.filter((e) => e.questId === q.id).length, 0);
});

test('session wrap-up ticks the step and keeps a note, idempotent; chapter stays open', () => {
  const { s, A, g, setT, getT } = sagaFixture();
  A.sagaStartSession(g.id);
  const q = s.quests.find((x) => x.sagaId === g.id);
  setT(getT() + 12 * 60000);
  const { sagaSession: ss } = A.questComplete(q.id);
  const xp = s.player.xp;
  A.sagaSessionWrap(ss.logId, { stepId: ss.stepId, note: 'вспомнил управление' });
  A.sagaSessionWrap(ss.logId, { stepId: ss.stepId, note: 'вспомнил управление' });
  assert.equal(s.player.xp, xp + L.SAGA_STEP_XP);
  const e = s.sagaLog[0];
  assert.equal(e.stepDone, true);
  assert.equal(e.note, 'вспомнил управление');
  assert.equal(g.chapters[0].steps[0].done, true);
  assert.equal(g.chapters[0].done, false);
  // finishing without a step
  A.sagaStartSession(g.id, { stepId: 'none' });
  const q2 = s.quests.find((x) => x.sagaId === g.id && x.status !== 'done');
  const r2 = A.questComplete(q2.id);
  A.sagaSessionWrap(r2.sagaSession.logId, {});
  assert.equal(s.sagaLog[1].stepDone, false);
  assert.equal(s.sagaLog[1].wrapped, true);
  const v = L.sagaView(s, g, getT());
  assert.equal(v.history[0].min >= 0, true);
  assert.equal(v.history.find((h) => h.note).step, 'Открыть Wagotabi');
});

test('manual session needs real minutes, dedupes by opId, can tick a step', () => {
  const { s, A, g } = sagaFixture();
  assert.equal(A.sagaLogSession(g.id, {}).ok, false);
  const p = { min: 25, opId: 'op1', typeId: g.sessionTypes[0].id, stepId: g.chapters[0].steps[1].id, note: 'на телефоне' };
  A.sagaLogSession(g.id, p);
  A.sagaLogSession(g.id, p);
  assert.equal(s.sagaLog.length, 1);
  assert.equal(s.sagaLog[0].min, 25);
  assert.equal(g.chapters[0].steps[1].done, true);
  const v = L.sagaView(s, g);
  assert.equal(v.typeStats.find((x) => x.name === 'Игра').count, 1);
  assert.equal(v.lastTypeId, g.sessionTypes[0].id);
  assert.equal(v.history[0].type, 'Игра');
});

test('gentle reminders: first after quietDays, then every 7 days, reset by activity, silenced by pause/off', () => {
  const t0 = at('2026-10-05T12:00:00');
  const { s, A, g } = sagaFixture(t0);
  const day = (n) => t0 + n * 86400000;
  const nudges = (t) => tick(s, { now: t, idleSec: 0 }).filter((e) => /Хочешь продолжить/.test(e.title));
  assert.equal(nudges(day(4)).length, 0);
  const n1 = nudges(day(5));
  assert.equal(n1.length, 1);
  assert.match(n1[0].body, /5 минут: Открыть Wagotabi/);
  assert.equal(nudges(day(6)).length, 0); // not daily any more
  assert.equal(nudges(day(11)).length, 0);
  assert.equal(nudges(day(12)).length, 1); // +7 days
  // activity resets the cycle
  const A2 = createActions(() => s, () => day(13));
  A2.sagaLogSession(g.id, { min: 5 });
  assert.equal(nudges(day(14)).length, 0);
  assert.equal(nudges(day(18)).length, 1); // quietDays after the activity
  // pause silences, resume resets
  const A3 = createActions(() => s, () => day(19));
  A3.sagaPause(g.id);
  assert.equal(nudges(day(40)).length, 0);
  const A4 = createActions(() => s, () => day(41));
  A4.sagaPause(g.id);
  assert.equal(nudges(day(42)).length, 0);
  assert.equal(nudges(day(46)).length, 1);
  // reminders off for this saga
  A4.sagaSave({ ...g, chapters: g.chapters.map((c) => ({ id: c.id, title: c.title })), remind: false });
  assert.equal(nudges(day(80)).length, 0);
  void A;
});

test('backward compatible: 1.1 saga data loads, shows, edits without losing progress', () => {
  const old = {
    settings: {}, quests: [], habits: [], log: [], habitLog: {}, player: { xp: 120 },
    sagas: [{ id: 'g1', title: 'Изучить Electron', why: '', area: 'life', createdAt: at('2026-10-01T10:00:00'), status: 'active', doneAt: null,
      targetPerWeek: 3, sessionMin: 30, quietDays: 5,
      chapters: [{ id: 'c1', title: 'Tutorial', done: true, doneAt: at('2026-10-02T10:00:00') }, { id: 'c2', title: 'IPC', done: false, doneAt: null }] }],
    sagaLog: [{ id: 'l1', sagaId: 'g1', chapterId: 'c1', at: at('2026-10-02T09:00:00'), min: 35, questId: 'q1' }],
  };
  const s = migrate(JSON.parse(JSON.stringify(old)));
  const v = L.sagaView(s, s.sagas[0], at('2026-10-03T10:00:00'));
  assert.equal(v.current.id, 'c2');
  assert.equal(v.nextStep, null);
  assert.equal(v.totalMin, 35);
  assert.equal(v.history[0].min, 35);
  assert.equal(v.remind, true);
  assert.deepEqual(v.types, []);
  const A = createActions(() => s, () => at('2026-10-03T10:00:00'));
  A.sagaSave({ id: 'g1', title: 'Изучить Electron', chapters: [{ id: 'c1', title: 'Tutorial' }, { id: 'c2', title: 'IPC и preload' }] });
  assert.equal(s.sagas[0].chapters[0].done, true);
  assert.equal(s.sagas[0].chapters[0].doneAt, old.sagas[0].chapters[0].doneAt);
  assert.equal(s.sagas[0].chapters[1].title, 'IPC и preload');
  assert.equal(A.sagaStartSession('g1').ok, true);
});

test('quiet saga suggests a 5-minute start; done saga reopens when a chapter is added', () => {
  const t0 = at('2026-10-05T12:00:00');
  const { s, A, g } = sagaFixture(t0);
  assert.equal(L.sagaView(s, g, t0 + 6 * 86400000).suggestedMin, 5);
  assert.equal(L.sagaView(s, g, t0).suggestedMin, 30);
  A.sagaToggleChapter(g.id, g.chapters[0].id);
  A.sagaToggleChapter(g.id, g.chapters[1].id);
  assert.equal(g.status, 'done');
  const xp = s.player.xp;
  A.sagaSave({ ...g, chapters: [...g.chapters.map((c) => ({ id: c.id, title: c.title })), { title: 'Грамматика' }] });
  assert.equal(g.status, 'active');
  assert.equal(s.player.xp, xp - L.SAGA_XP); // saga bonus can be earned again, not twice
  assert.equal(A.sagaPause(g.id).ok, true);
});

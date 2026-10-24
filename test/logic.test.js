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
  A.sagaLogSession(g.id);
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

test('scheduler: quiet saga nudges once a day', () => {
  const t0 = at('2026-10-10T12:00:00');
  const s = L.defaultState(t0);
  s.meta.lastBriefing = '2026-10-17'; s.meta.lastReview = '2026-10-17';
  const A = createActions(() => s, () => t0);
  A.sagaSave({ title: 'CKA', quietDays: 5, chapters: [{ title: 'Networking' }] });
  const t = at('2026-10-17T12:00:00'); // Saturday, 7 days quiet
  let ev = tick(s, { now: t, idleSec: 0 }).filter((e) => /молчит/.test(e.title));
  assert.equal(ev.length, 1);
  assert.match(ev[0].body, /Networking/);
  ev = tick(s, { now: t + 60000, idleSec: 0 }).filter((e) => /молчит/.test(e.title));
  assert.equal(ev.length, 0);
});

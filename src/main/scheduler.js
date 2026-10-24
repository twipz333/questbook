'use strict';
const L = require('../shared/logic');

/**
 * Decide what should happen right now. Pure: mutates only bookkeeping fields
 * (state.fired, state.meta.*) and returns events for main.js to execute.
 *
 * ctx = { now, idleSec, overlayOpen }
 */
function tick(state, ctx) {
  const { now, idleSec = 0, overlayOpen = false } = ctx;
  const s = state.settings;
  const today = L.dayKey(now, s.dayStartHour);
  const active = idleSec < 90; // user is at the PC
  const events = [];
  const view = L.buildView(state, now);

  // 1) Timed habits / rituals
  for (const h of view.todayHabits) {
    if (h.done || !h.target) continue;
    const firstStep = (h.steps || []).find((x) => !h.stepsDone.includes(x.id));
    for (const off of h.remind || []) {
      const at = h.target + off * 60000;
      const key = `${today}|${h.id}|${off}`;
      if (now >= at && now < at + 15 * 60000 && !state.fired[key]) {
        state.fired[key] = 1;
        let title, body;
        if (off < 0) {
          title = `Через ${-off} мин: ${h.title} (${h.time})`;
          body = firstStep ? `Начни сворачиваться. Первый шаг: ${firstStep.text}` : 'Начни сворачиваться: закрой текущую задачу.';
        } else if (off === 0) {
          title = `${h.title} — сейчас`;
          body = firstStep ? `Шаг 1: ${firstStep.text}` : 'Сделай и отметь в HUD.';
        } else {
          title = `${h.title}: опоздание ${off} мин`;
          body = firstStep ? `Один шаг прямо сейчас: ${firstStep.text}` : 'Один шаг прямо сейчас.';
        }
        events.push({ kind: 'notify', title, body, open: 'hud', urgent: off >= 0 });
      }
    }
    // Hard mode: overlay keeps coming back while overdue and the user is at the PC
    if (h.hard && now >= h.target && now < h.target + 4 * 3600000 && active && !overlayOpen) {
      const sn = state.meta.snoozes[`${today}|${h.id}`];
      if (!sn || sn.until <= now) events.push({ kind: 'overlay', habitId: h.id });
    }
  }

  // 2) Morning briefing — first activity of the logical day
  if (s.morningBriefing && state.meta.lastBriefing !== today && active) {
    const hour = new Date(now).getHours();
    if (hour >= s.dayStartHour + 2 && hour < 16) events.push({ kind: 'briefing' });
  }

  // 3) Work-hours nudge: no active quest while at the PC
  const isWorkday = (s.workDays || []).includes(L.weekday(today));
  const ws = L.timeInDay(today, s.workStart, s.dayStartHour);
  const we = L.timeInDay(today, s.workEnd, s.dayStartHour);
  if (isWorkday && ws && we && now >= ws && now < we && !state.activeQuestId && active
      && now - (state.meta.lastNudgeAt || 0) > s.nudgeIdleMin * 60000) {
    state.meta.lastNudgeAt = now;
    const q = view.todayQuests[0];
    events.push(q
      ? { kind: 'notify', title: `Следующий шаг: ${q.nextStep || q.title}`, body: `Квест «${q.title}»${q.estimateMin ? ` · ~${q.estimateMin} мин` : ''}. Нажми ▶ в HUD.`, open: 'hud' }
      : { kind: 'notify', title: 'Нет активного квеста', body: 'Выбери один квест на ближайший час. Ctrl+Alt+Q — записать новый.', open: 'hud' });
  }

  // 3b) Deadlines with a time: an hour before and when it's due
  for (const q of state.quests) {
    if (q.status === 'done' || !q.dueDay || !q.dueTime) continue;
    const info = L.dueInfo(q, now, s.dayStartHour);
    if (!info || info.ts === null) continue;
    for (const off of [-60, 0]) {
      const at = info.ts + off * 60000;
      const key = `${today}|due|${q.id}|${off}`;
      if (now >= at && now < at + 15 * 60000 && !state.fired[key]) {
        state.fired[key] = 1;
        events.push({
          kind: 'notify',
          title: off < 0 ? `Через час срок: ${q.title}` : `Срок сейчас: ${q.title}`,
          body: `${q.nextStep ? `Следующий шаг: ${q.nextStep}` : 'Начни с первого маленького шага.'} (до ${q.dueTime})`,
          open: 'hud', urgent: off === 0,
        });
      }
    }
  }

  // 4) Focus check for long active quests
  if (state.activeQuestId && now - (state.meta.lastFocusCheckAt || now) > s.focusCheckMin * 60000) {
    state.meta.lastFocusCheckAt = now;
    if (active) {
      events.push({ kind: 'notify', title: `${view.activeElapsedMin} мин в квесте «${view.active.title}»`, body: 'Отметь сделанный шаг и встань на 3 минуты.', open: 'hud' });
    }
  }

  // 5) Evening review — make the day's wins visible
  const rv = L.timeInDay(today, s.eveningReview, s.dayStartHour);
  if (rv && now >= rv && now < rv + 2 * 3600000 && state.meta.lastReview !== today) {
    state.meta.lastReview = today;
    const q = view.doneToday.length;
    const left = view.todayHabits.filter((h) => !h.done);
    events.push({
      kind: 'notify',
      title: `Итог дня: ${q} ${L.plural(q, 'квест', 'квеста', 'квестов')} · +${view.xpToday} XP`,
      body: left.length ? `Осталось: ${left.slice(0, 3).map((h) => h.title).join(', ')}` : 'Все ритуалы дня выполнены.',
      open: 'chronicle',
    });
  }

  // 6) Sagas gone quiet: a gentle invitation, never a reproach.
  //    First after quietDays, then every remindEvery days; activity or resume resets the cycle;
  //    paused sagas and sagas with reminders off stay silent.
  const hourNow = new Date(now).getHours();
  if (active && hourNow >= 10 && hourNow < 21) {
    for (const v of view.sagas) {
      const g = state.sagas.find((x) => x.id === v.id);
      if (!g || !L.sagaNudgeDue(g, v, now)) continue;
      g.lastNudgeAt = now;
      const action = v.nextStep ? v.nextStep.text : v.current ? `глава «${v.current.title}»` : 'любое маленькое действие';
      events.push({
        kind: 'notify',
        title: `Хочешь продолжить «${v.title}»?`,
        body: `Начни с 5 минут: ${action}.`,
        open: 'sagas',
        soft: true,
      });
      break; // at most one saga invitation per tick
    }
  }

  // 7) Housekeeping
  const yesterday = L.addDays(today, -1);
  for (const k of Object.keys(state.fired)) if (!k.startsWith(today) && !k.startsWith(yesterday)) delete state.fired[k];
  for (const k of Object.keys(state.meta.snoozes)) if (!k.startsWith(today)) delete state.meta.snoozes[k];

  return events;
}

module.exports = { tick };

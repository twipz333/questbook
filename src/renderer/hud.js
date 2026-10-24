import { qb, esc, icon, fmtMin, fmtUntil, applyTheme, run, patch } from './common.js';

const $hud = document.getElementById('hud');
let P = null;
let askNext = null;
let flashUntil = 0;

function bar(v) {
  return `<div class="bar">
    <div class="lvl" title="Уровень ${v.level.level}: ${esc(v.level.title)}"><span>${v.level.level}</span></div>
    <div class="xp"><small class="num">${esc(v.level.title)} · ${v.level.into}/${v.level.need} XP</small><div class="xpbar"><i style="width:${v.level.pct}%"></i></div></div>
    <button class="ib" data-a="capture" title="Новый квест (${esc(v.settings.hotkeyCapture)})" aria-label="Новый квест">${icon('plus', 16)}</button>
    <button class="ib" data-a="open" title="Открыть книгу" aria-label="Открыть книгу квестов">${icon('book-open', 16)}</button>
    <button class="ib" data-a="collapse" title="Свернуть" aria-label="Свернуть HUD">${icon('minimize-2', 15)}</button>
    <button class="ib" data-a="hide" title="Скрыть (${esc(v.settings.hotkeyHud)})" aria-label="Скрыть HUD">${icon('x', 16)}</button>
  </div>`;
}

function nowSection(v) {
  if (v.active) {
    const q = v.active;
    const step = q.nextStep || (q.steps.find((s) => !s.done) || {}).text;
    if (askNext === q.id) {
      return `<div class="sec"><div class="lbl"><span>Шаг сделан</span></div>
        <div class="now-quest">Какой следующий шаг в «${esc(q.title)}»?</div>
        <form class="ask" data-form="next"><input class="input" id="hud-next" placeholder="Одно действие на 2–15 мин" autocomplete="off" aria-label="Следующий шаг"><button class="btn btn-primary btn-sm" type="submit">${icon('check', 14)}</button></form>
        <div class="row"><button class="btn btn-good" data-a="complete" data-id="${q.id}">${icon('trophy', 14)}Квест выполнен</button></div></div>`;
    }
    return `<div class="sec">
      <div class="lbl"><span>Сейчас</span><span class="num" style="color:var(--ember)">${fmtMin(v.activeElapsedMin)}${q.estimateMin ? ` / ~${fmtMin(q.estimateMin)}` : ''}</span></div>
      <div class="now-step">${esc(step || 'Сделай первый маленький шаг')}</div>
      <div class="now-quest">${q.kind === 'main' ? '★ ' : ''}${esc(q.title)}</div>
      <div class="row">
        <button class="btn btn-primary" data-a="step" data-id="${q.id}">${icon('check', 14)}Шаг готов</button>
        <button class="btn btn-good" data-a="complete" data-id="${q.id}">${icon('trophy', 14)}Квест</button>
        <button class="btn icon-btn" data-a="pause" title="Пауза" aria-label="Пауза">${icon('pause', 14)}</button>
      </div></div>`;
  }
  const tq = v.todayQuests.slice(0, 3);
  if (tq.length) {
    return `<div class="sec"><div class="lbl"><span>Выбери квест</span><span>${tq.length}/${v.settings.todayLimit}</span></div>
      ${tq.map((q, i) => `<div class="qrow"><span class="n">${i + 1}</span><span class="t" title="${esc(q.title)}">${esc(q.title)}</span>
        <button class="btn btn-sm ${i === 0 ? 'btn-primary' : ''}" data-a="start" data-id="${q.id}" aria-label="Начать ${esc(q.title)}">${icon('play', 13)}</button></div>`).join('')}
    </div>`;
  }
  return `<div class="sec"><div class="lbl"><span>Квесты дня</span></div>
    <div class="empty-line">${v.inbox.length ? `В книге ${v.inbox.length}. Выбери на сегодня.` : 'Книга пуста.'}</div>
    <div class="row"><button class="btn" data-a="${v.inbox.length ? 'plan' : 'capture'}">${icon(v.inbox.length ? 'sunrise' : 'plus', 14)}${v.inbox.length ? 'План дня' : 'Записать квест'}</button></div></div>`;
}

function habitsSection(v) {
  if (!v.todayHabits.length) return '';
  const list = v.todayHabits.slice(0, 4);
  return `<div class="sec"><div class="lbl"><span>Ритуалы</span><span class="num">${v.habitsDone}/${v.todayHabits.length}</span></div>
    ${list.map((h) => {
      const hot = !h.done && h.minutesLeft != null && h.minutesLeft <= 60;
      const w = h.done ? '' : h.time ? (hot ? fmtUntil(h.minutesLeft) : h.time) : '';
      const nextStep = hot ? (h.steps.find((s) => !h.stepsDone.includes(s.id)) || null) : null;
      return `<div class="hrow ${h.done ? 'done' : ''}">
        <button class="check round" role="checkbox" aria-checked="${h.done}" aria-label="${esc(h.title)}" data-a="${nextStep ? 'hstep' : 'habit'}" data-id="${h.id}" data-sid="${nextStep ? nextStep.id : ''}">${icon('check', 13)}</button>
        <span class="t" title="${esc(h.title)}">${esc(nextStep ? nextStep.text : h.title)}</span>
        ${w ? `<span class="w num ${hot ? 'hot' : ''}">${esc(w)}</span>` : ''}
        ${h.streak ? `<span class="s">${icon('flame', 12)}${h.streak}</span>` : ''}
      </div>`;
    }).join('')}</div>`;
}

function sagasSection(v) {
  const list = v.sagas.filter((g) => g.status === 'active').sort((a, b) => b.isQuiet - a.isQuiet || (a.weekSessions / a.target) - (b.weekSessions / b.target)).slice(0, 2);
  if (!list.length) return '';
  return `<div class="sec"><div class="lbl"><span>Саги</span><span>на неделе</span></div>
    ${list.map((g) => `<div class="hrow">
      <span style="color:var(--arcane)">${icon('swords', 15)}</span>
      <span class="t" title="${esc(g.current ? g.current.title : g.title)}">${esc(g.title)}</span>
      <span class="w num ${g.isQuiet ? 'hot' : ''}">${g.isQuiet ? `${g.quietDays} дн.` : `${g.weekSessions}/${g.target}`}</span>
      ${g.openActive ? '' : `<button class="btn btn-sm" data-a="saga" data-id="${g.id}" aria-label="Сессия: ${esc(g.title)}" title="Сессия ~${g.sessionMin} мин">${icon('play', 12)}</button>`}
    </div>`).join('')}</div>`;
}

function render() {
  if (!P) return;
  const v = P.view;
  applyTheme(v.settings);
  $hud.classList.toggle('alerting', !!(P.alert && Date.now() < flashUntil));
  if (v.settings.hudCollapsed) {
    const txt = v.active ? (v.active.nextStep || v.active.title) : (v.next ? v.next.action : '');
    const bed = v.bedtime && v.bedtime.minutesLeft <= 60 ? `${v.bedtime.title}: ${fmtUntil(v.bedtime.minutesLeft)}` : '';
    patch($hud, `<div class="mini">
      <button class="ib" data-a="expand" title="Развернуть" aria-label="Развернуть HUD">${icon('maximize-2', 15)}</button>
      <span class="txt" title="${esc(txt)}">${v.active ? '▶ ' : ''}${esc(txt)}</span>
      ${v.active ? `<span class="tm num">${fmtMin(v.activeElapsedMin)}</span>` : bed ? `<span class="tm">${esc(bed)}</span>` : ''}
      ${v.active ? `<button class="ib" data-a="step" data-id="${v.active.id}" title="Шаг готов" aria-label="Шаг готов">${icon('check', 16)}</button>` : ''}
    </div>`);
  } else {
    const al = P.alert;
    patch($hud, `${bar(v)}
      ${al ? `<div class="alert" role="alert"><div><b>${esc(al.title)}</b><span>${esc(al.body)}</span></div><button class="ib" data-a="dismiss" aria-label="Скрыть напоминание">${icon('x', 14)}</button></div>` : ''}
      ${nowSection(v)}
      ${habitsSection(v)}
      ${sagasSection(v)}
      <div class="foot"><span><b class="num">+${v.xpToday} XP</b> сегодня</span><span class="num">${v.doneToday.length} ${v.doneToday.length === 1 ? 'квест' : 'квестов'} · ур. ${v.level.level}</span></div>`);
  }
}

function reportHeight() {
  const cs = getComputedStyle(document.body);
  qb.ui('hudHeight', $hud.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
}
new ResizeObserver(reportHeight).observe($hud);
qb.onHudLayout((l) => {
  document.body.classList.toggle('dock-bottom', !!l.dockBottom);
  document.body.classList.toggle('dock-right', !!l.dockRight);
  reportHeight();
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a]');
  if (!t) return;
  const id = t.dataset.id;
  switch (t.dataset.a) {
    case 'capture': qb.ui('capture'); break;
    case 'open': qb.ui('openMain', 'today'); break;
    case 'plan': qb.ui('openMain', 'briefing'); break;
    case 'hide': qb.ui('hudHide'); break;
    case 'collapse': await qb.act('settingsUpdate', { hudCollapsed: true }); break;
    case 'expand': await qb.act('settingsUpdate', { hudCollapsed: false }); break;
    case 'dismiss': qb.ui('dismissAlert'); break;
    case 'start': await run('questStart', id); break;
    case 'pause': await run('questPause'); break;
    case 'complete': askNext = null; await run('questComplete', id); break;
    case 'step': {
      const r = await run('questStepDone', id);
      if (r.needNext) {
        askNext = id;
        if (P.view.settings.hudCollapsed) await qb.act('settingsUpdate', { hudCollapsed: false });
        render();
        setTimeout(() => document.getElementById('hud-next')?.focus(), 0);
      }
      break;
    }
    case 'habit': await run('habitToggle', id); break;
    case 'saga': await run('sagaStartSession', id); break;
    case 'hstep': await run('habitToggleStep', id, t.dataset.sid); break;
    default: break;
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = e.target.querySelector('input').value.trim();
  if (!v || !askNext) return;
  const id = askNext;
  askNext = null;
  await run('questUpdate', id, { nextStep: v });
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && askNext) { askNext = null; render(); } });

let lastAlertAt = 0;
qb.onState((p) => {
  if (p.alert && p.alert.at !== lastAlertAt) { lastAlertAt = p.alert.at; flashUntil = Date.now() + 5000; }
  P = p; render();
});
qb.get().then((p) => { P = p; render(); });

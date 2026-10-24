import { qb, esc, icon, fmtMin, applyTheme, run } from './common.js';

const $p = document.getElementById('panel');
const MAX_SNOOZE = 2;
let P = null;
let habitId = null;
let finished = false;

function render() {
  if (!P || !habitId) return;
  applyTheme(P.view.settings);
  const h = P.view.habits.find((x) => x.id === habitId);
  if (!h) { qb.ui('overlayClose'); return; }
  if (h.done || finished) {
    finished = true;
    $p.innerHTML = `<div class="bye">
      <div class="moon">${icon('moon', 28)}</div>
      <b>${h.kind === 'ritual' ? 'Хорошего сна' : 'Готово'}</b>
      <span class="muted">+${h.xp} XP · серия ${h.streak}</span></div>`;
    setTimeout(() => qb.ui('overlayClose'), 2200);
    return;
  }
  const late = -h.minutesLeft;
  const sn = (P.state.meta.snoozes || {})[`${P.view.today}|${h.id}`];
  const used = sn ? sn.count : 0;
  const left = Math.max(0, MAX_SNOOZE - used);
  const steps = h.steps || [];
  const doneIds = h.stepsDone || [];
  const curIdx = steps.findIndex((s) => !doneIds.includes(s.id));
  $p.innerHTML = `
    <div class="head">
      <div class="moon">${icon(h.kind === 'ritual' ? 'moon' : 'alarm-clock', 28)}</div>
      <div>
        <div class="eyebrow">${esc(h.title)} · ${esc(h.time || '')}</div>
        <h1 id="ov-title">${late > 0 ? `Прошло ${fmtMin(late)}. Пора.` : 'Пора.'}</h1>
      </div>
    </div>
    ${steps.length ? `
      <div class="prog num">Шаг ${Math.min(curIdx + 1, steps.length)} из ${steps.length}</div>
      <div class="steps">${steps.map((s, i) => {
        const d = doneIds.includes(s.id);
        return `<div class="st ${d ? 'done' : ''} ${i === curIdx ? 'cur' : ''}">
          <button class="check" role="checkbox" aria-checked="${d}" aria-label="${esc(s.text)}" data-a="step" data-sid="${s.id}">${icon('check', 16)}</button>
          <span>${i + 1}. ${esc(s.text)}</span></div>`;
      }).join('')}</div>` : '<p class="sub">Сделай это сейчас и отметь.</p>'}
    <div class="acts">
      <button class="btn btn-primary" data-a="${steps.length ? 'next' : 'done'}" id="primary">${icon('check', 18)}${steps.length ? 'Шаг готов' : 'Сделано'}</button>
      <button class="btn" data-a="snooze" ${left ? '' : 'disabled'}>${icon('hourglass', 16)}Ещё 10 мин${left ? ` (${left})` : ''}</button>
      <button class="btn btn-ghost" data-a="close">Закрыть</button>
    </div>
    <p class="sub" style="font-size:12.5px">Экран вернётся через 15 минут, пока ритуал не отмечен. Отключить: Ритуалы → жёсткий режим.</p>`;
  document.getElementById('primary')?.focus();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-a]');
  if (!t || t.disabled) return;
  const h = P.view.habits.find((x) => x.id === habitId);
  switch (t.dataset.a) {
    case 'step': await run('habitToggleStep', habitId, t.dataset.sid); break;
    case 'next': {
      const s = h.steps.find((x) => !h.stepsDone.includes(x.id));
      if (s) await run('habitToggleStep', habitId, s.id);
      break;
    }
    case 'done': await run('habitToggle', habitId, true); break;
    case 'snooze': await qb.act('snooze', habitId, 10); qb.ui('overlayClose'); break;
    case 'close': await qb.act('snooze', habitId, 15); qb.ui('overlayClose'); break;
    default: break;
  }
});
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { await qb.act('snooze', habitId, 15); qb.ui('overlayClose'); }
});

qb.onOverlayHabit((id) => { habitId = id; finished = false; render(); });
qb.onState((p) => { P = p; render(); });

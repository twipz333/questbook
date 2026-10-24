import { qb, esc, icon, fmtMin, applyTheme } from './common.js';

const L = globalThis.QBLogic;
const $box = document.getElementById('box');

$box.innerHTML = `
  <div class="head"><div class="eyebrow">Новый квест</div><span class="kbd">Esc</span></div>
  <input class="big" id="cap" placeholder="Что нужно сделать?" autocomplete="off" aria-label="Новый квест" aria-describedby="keys">
  <div class="preview" id="preview" aria-live="polite"></div>
  <div class="keys" id="keys">
    <span><span class="kbd">Enter</span> в книгу</span>
    <span><span class="kbd">Ctrl+Enter</span> начать сейчас</span>
    <span><code>~30</code> мин</span><span><code>!</code> главный</span><span><code>#жизнь</code></span><span><code>@сегодня</code></span><span><code>&gt; первый шаг</code></span>
  </div>`;

const $in = document.getElementById('cap');
const $pv = document.getElementById('preview');

function preview() {
  const t = $in.value.trim();
  if (!t) { $pv.innerHTML = '<span class="faint" style="font-size:13px">Запиши как есть. Уточнить можно потом.</span>'; return; }
  const p = L.parseCapture(t);
  const chips = [];
  chips.push(`<span class="chip ${p.kind === 'main' ? 'gold' : ''}">${p.kind === 'main' ? 'Главный' : 'Побочный'}</span>`);
  chips.push(`<span class="chip">${p.area === 'life' ? 'Жизнь' : 'Работа'}</span>`);
  if (p.estimateMin) chips.push(`<span class="chip">~${fmtMin(p.estimateMin)}</span>`);
  if (p.today) chips.push('<span class="chip gold">На сегодня</span>');
  if (p.nextStep) chips.push(`<span class="chip arcane">→ ${esc(p.nextStep)}</span>`);
  $pv.innerHTML = chips.join('');
}

async function save(startNow) {
  const t = $in.value.trim();
  if (!t) return;
  const r = await qb.act('questCapture', t);
  if (!r.ok) { $pv.innerHTML = `<span class="chip ember">${esc(r.error || 'Не сохранилось')}</span>`; return; }
  if (startNow) await qb.act('questStart', r.id);
  $in.value = '';
  $pv.innerHTML = `<span class="saved">${icon('check', 16)}${startNow ? 'Квест начат' : esc(r.toast || 'Записано')}</span>`;
  setTimeout(() => { qb.ui('captureClose'); preview(); }, 650);
}

$in.addEventListener('input', preview);
$in.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); save(e.ctrlKey || e.metaKey); }
  if (e.key === 'Escape') qb.ui('captureClose');
});
qb.onCaptureOpen(() => { $in.focus(); $in.select(); preview(); });
qb.onState((p) => applyTheme(p.view.settings));
qb.get().then((p) => { applyTheme(p.view.settings); preview(); $in.focus(); });

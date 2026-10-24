import { qb, esc, icon, fmtMin, applyTheme } from './common.js';

const L = globalThis.QBLogic;
const $box = document.getElementById('box');
let settings = { dayStartHour: 4 };

$box.innerHTML = `
  <div class="head"><div class="eyebrow">Новый квест</div><span class="kbd">Esc</span></div>
  <input class="big" id="cap" placeholder="Что нужно сделать?" autocomplete="off" aria-label="Новый квест" aria-describedby="keys">
  <div class="tools" id="tools"></div>
  <div class="preview" id="preview" aria-live="polite"></div>
  <div class="keys" id="keys">
    <span><span class="kbd">Enter</span> в книгу</span>
    <span><span class="kbd">Ctrl+Enter</span> начать сейчас</span>
    <span><code>@25.10 22:00</code> срок</span><span><code>[текст](https://…)</code> ссылка</span><span><code>&gt; шаг</code> первый шаг</span>
  </div>`;

const $in = document.getElementById('cap');
const $tools = document.getElementById('tools');
const $pv = document.getElementById('preview');

// ---------------------------------------------------------------- token editing
const RX = {
  area: /\s#(работа|work|раб|жизнь|life|дом|home|личное)(?=\s)/giu,
  main: /\s!(?=\s)/gu,
  day: /\s@(сегодня|today|сейчас|now|послезавтра|завтра|tomorrow|пн|вт|ср|чт|пт|сб|вс|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\.\d{1,2}(?:\.\d{4}|\.\d{2})?)(?=\s)/giu,
  time: /\s@?(?:до\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/giu,
  est: /\s(~\d{1,3}|~?\d{1,3}\s?(?:мин|м|min|m)|~?\d{1,2}(?:[.,]\d)?\s?(?:ч|h))(?=\s)/giu,
};

/** Replace (or drop, when token is null) one kind of token; new tokens go before the "> step" part. */
function setToken(kind, token) {
  const raw = $in.value;
  const gt = raw.indexOf('>');
  let head = ' ' + (gt >= 0 ? raw.slice(0, gt) : raw) + ' ';
  const tail = gt >= 0 ? raw.slice(gt) : '';
  head = head.replace(RX[kind], ' ');
  head = head.replace(/\s+/g, ' ').trim();
  if (token) head = (head ? head + ' ' : '') + token;
  $in.value = head + (tail ? ' ' + tail : '') + (tail ? '' : ' ');
  $in.focus();
  $in.setSelectionRange(head.length + (tail ? 0 : 1), head.length + (tail ? 0 : 1));
  update();
}

function parsed() { return L.parseCapture($in.value, Date.now(), settings.dayStartHour); }
function today() { return L.dayKey(Date.now(), settings.dayStartHour); }

function dayToken(key) {
  const t = today();
  if (key === t) return '@сегодня';
  if (key === L.addDays(t, 1)) return '@завтра';
  if (key === L.addDays(t, 2)) return '@послезавтра';
  const [y, m, d] = key.split('-');
  return `@${d}.${m}${y === t.slice(0, 4) ? '' : '.' + y}`;
}

// ---------------------------------------------------------------- tools row
function renderTools() {
  const p = parsed();
  const t = today();
  const quick = [[t, 'Сегодня', 'S'], [L.addDays(t, 1), 'Завтра', 'Z'], [L.addDays(t, 2), 'Послезавтра', '']];
  const other = p.dueDay && !quick.some(([k]) => k === p.dueDay);
  const est = p.estimateMin;
  const tok = (attrs, pressed, label, key = '') => `<button type="button" class="tok" ${attrs} aria-pressed="${pressed}" ${key ? `title="Alt+${key}"` : ''}>${label}${key ? ` <u>Alt+${key}</u>` : ''}</button>`;
  $tools.innerHTML = `
    <span class="lbl">Сфера</span>
    <div class="row"><span class="seg" role="group" aria-label="Сфера">
        ${tok('data-t="life"', p.area !== 'work', `${icon('house', 13)}Жизнь`)}${tok('data-t="work"', p.area === 'work', `${icon('briefcase', 13)}Работа`, 'W')}
      </span>${tok('data-t="main"', p.kind === 'main', `${icon('crown', 13)}Главный`, 'M')}</div>
    <span class="lbl">Срок</span>
    <div class="row">
      ${quick.map(([k, l, key]) => tok(`data-t="day" data-v="${k}"`, k === t ? p.today : p.dueDay === k, l, key)).join('')}
      <input type="date" class="mini-in ${other ? 'on' : ''}" id="cap-date" value="${other ? p.dueDay : ''}" aria-label="Дата срока" title="Другая дата">
      <input type="time" class="mini-in ${p.dueTime ? 'on' : ''}" id="cap-time" value="${p.dueTime || ''}" aria-label="Время срока" title="До какого времени">
      ${p.dueDay || p.today ? tok('data-t="noday"', false, `${icon('x', 12)}без срока`) : ''}
    </div>
    <span class="lbl">Оценка</span>
    <div class="row">${[[15, '15 мин'], [30, '30 мин'], [60, '1 ч'], [120, '2 ч']].map(([m, l]) => tok(`data-t="est" data-v="${m}"`, est === m, l)).join('')}</div>`;
}

$tools.addEventListener('mousedown', (e) => { if (e.target.closest('.tok')) e.preventDefault(); }); // keep focus in the text field
$tools.addEventListener('click', (e) => {
  const b = e.target.closest('.tok');
  if (!b) return;
  const p = parsed();
  switch (b.dataset.t) {
    case 'life': setToken('area', null); break;
    case 'work': setToken('area', p.area === 'work' ? null : '#работа'); break;
    case 'main': setToken('main', p.kind === 'main' ? null : '!'); break;
    case 'day': {
      const on = b.dataset.v === today() ? p.today : p.dueDay === b.dataset.v;
      setToken('day', on ? null : dayToken(b.dataset.v)); break;
    }
    case 'noday': setToken('time', null); setToken('day', null); break;
    case 'est': setToken('est', p.estimateMin === +b.dataset.v ? null : (+b.dataset.v % 60 === 0 ? `${b.dataset.v / 60}ч` : `~${b.dataset.v}`)); break;
    default: break;
  }
});
$tools.addEventListener('change', (e) => {
  if (e.target.id === 'cap-date') setToken('day', e.target.value ? dayToken(e.target.value) : null);
  if (e.target.id === 'cap-time') {
    const p = parsed();
    setToken('time', e.target.value ? `до ${e.target.value}` : null);
    if (e.target.value && !p.dueDay) { /* time alone means today; parser handles it */ }
  }
});

// ---------------------------------------------------------------- preview
function preview() {
  const t = $in.value.trim();
  if (!t) { $pv.innerHTML = '<span class="faint" style="font-size:13px">Запиши как есть. Уточнить можно потом.</span>'; return; }
  const p = parsed();
  const chips = [];
  if (p.today && !p.dueDay) chips.push(`<span class="chip gold">${icon('sunrise', 13)}в план дня</span>`);
  if (p.dueDay) {
    const d = L.dueInfo({ dueDay: p.dueDay, dueTime: p.dueTime }, Date.now(), settings.dayStartHour);
    chips.push(`<span class="chip ${d.overdue ? 'ember' : 'gold'}">${icon('calendar-clock', 13)}${esc(d.label)}${p.today ? ' · в план дня' : ''}</span>`);
  }
  if (p.estimateMin) chips.push(`<span class="chip">~${fmtMin(p.estimateMin)}</span>`);
  if (p.nextStep) chips.push(`<span class="chip arcane">→ ${esc(p.nextStep)}</span>`);
  for (const l of L.cleanLinks(p.links)) chips.push(`<span class="chip">${icon('link', 13)}${esc(l.title || l.host)}</span>`);
  if (!chips.length) chips.push('<span class="faint" style="font-size:13px">Без срока — квест ляжет в книгу.</span>');
  $pv.innerHTML = chips.join('');
}

function update() { renderTools(); preview(); }

async function save(startNow) {
  const t = $in.value.trim();
  if (!t) return;
  const r = await qb.act('questCapture', t);
  if (!r.ok) { $pv.innerHTML = `<span class="chip ember">${esc(r.error || 'Не сохранилось')}</span>`; return; }
  if (startNow) await qb.act('questStart', r.id);
  $in.value = '';
  renderTools();
  $pv.innerHTML = `<span class="saved">${icon('check', 16)}${startNow ? 'Квест начат' : esc(r.toast || 'Записано')}</span>`;
  setTimeout(() => { qb.ui('captureClose'); preview(); }, 700);
}

$in.addEventListener('input', update);
$in.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); save(e.ctrlKey || e.metaKey); return; }
  if (e.key === 'Escape') { qb.ui('captureClose'); return; }
  if (e.altKey && !e.ctrlKey) {
    const p = parsed();
    const t = today();
    const map = {
      KeyW: () => setToken('area', p.area === 'work' ? null : '#работа'),
      KeyM: () => setToken('main', p.kind === 'main' ? null : '!'),
      KeyS: () => setToken('day', p.today ? null : '@сегодня'),
      KeyZ: () => setToken('day', p.dueDay === L.addDays(t, 1) ? null : '@завтра'),
    };
    if (map[e.code]) { e.preventDefault(); map[e.code](); }
  }
});

new ResizeObserver(() => qb.ui('captureHeight', $box.getBoundingClientRect().height + 24)).observe($box);

qb.onCaptureOpen(() => { $in.focus(); $in.select(); update(); });
qb.onState((p) => { settings = p.view.settings; applyTheme(p.view.settings); });
qb.get().then((p) => { settings = p.view.settings; applyTheme(p.view.settings); update(); $in.focus(); });

import { qb, esc, icon, fmtMin, fmtUntil, fmtTime, fmtDays, fmtOffset, plural, applyTheme, toast, run, patch, WD, THEMES } from './common.js';

const L = globalThis.QBLogic;
const $content = document.getElementById('content');
const $rail = document.getElementById('rail');
const $drawer = document.getElementById('drawer-root');

let P = null; // { state, view }
const ui = {
  page: 'today',
  filter: 'all',          // book filter
  expanded: {},           // section -> bool ("show more")
  openHabit: {},          // ritual id -> steps expanded
  openSaga: {},           // saga id -> chapters expanded
  openHist: {},           // saga id -> history expanded
  pick: new Set(),        // briefing selection
  drawer: null,           // { type:'quest'|'habit', draft }
  askNext: null,          // quest id waiting for "what's the next step?"
};

const PAGES = [
  { id: 'today', label: 'Сегодня', icon: 'target' },
  { id: 'book', label: 'Книга квестов', icon: 'book-open' },
  { id: 'sagas', label: 'Саги', icon: 'swords' },
  { id: 'rituals', label: 'Ритуалы', icon: 'flame' },
  { id: 'chronicle', label: 'Летопись', icon: 'scroll-text' },
];
const VISIBLE = 5; // ADHD rule: cap visible working set to 5 per group

// =====================================================================
// Rail
// =====================================================================
function renderRail() {
  const v = P.view;
  const counts = { today: v.todayQuests.length + v.todayHabits.filter((h) => !h.done).length, book: v.inbox.length, sagas: v.sagas.filter((g) => g.status === 'active').length, rituals: v.habits.length };
  $rail.innerHTML = `
    <div class="card hero-card">
      <div class="hero-top">
        <div class="crest" aria-hidden="true"><span>${v.level.level}</span></div>
        <div>
          <div class="hero-title">${esc(v.level.title)}</div>
          <div class="hero-sub">Уровень ${v.level.level}</div>
        </div>
      </div>
      <div class="xpbar" role="progressbar" aria-label="Опыт до следующего уровня" aria-valuenow="${v.level.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${v.level.pct}%"></i></div>
      <div class="xp-line num"><span>${v.level.into} / ${v.level.need} XP</span><span class="${v.xpToday ? '' : 'faint'}">+${v.xpToday} сегодня</span></div>
    </div>
    <nav class="nav" aria-label="Разделы">
      ${PAGES.map((p) => `
        <button data-nav="${p.id}" ${ui.page === p.id || (ui.page === 'briefing' && p.id === 'today') ? 'aria-current="page"' : ''}>
          ${icon(p.icon, 18)}<span>${p.label}</span>${counts[p.id] ? `<span class="count num">${counts[p.id]}</span>` : ''}
        </button>`).join('')}
    </nav>
    <div class="rail-foot">
      <button class="btn btn-primary" data-a="capture">${icon('plus', 16)}Новый квест</button>
      <div class="faint" style="font-size:12px;text-align:center">или <span class="kbd">${esc(hk(v.settings.hotkeyCapture))}</span> из любого окна</div>
      <div class="nav">
        <button data-nav="settings" ${ui.page === 'settings' ? 'aria-current="page"' : ''}>${icon('settings', 18)}<span>Настройки</span></button>
      </div>
    </div>`;
}

function hk(s) { return (s || '').replace('Control', 'Ctrl').replace(/\+/g, '+'); }

// =====================================================================
// Shared fragments
// =====================================================================
function questChips(q) {
  const parts = [];
  if (q.sagaId) parts.push(`<span class="chip arcane">${icon('swords', 13)}Сага</span>`);
  parts.push(`<span class="chip ${q.kind === 'main' ? 'gold' : ''}">${icon(q.kind === 'main' ? 'crown' : 'sword', 13)}${q.kind === 'main' ? 'Главный' : 'Побочный'}</span>`);
  parts.push(`<span class="chip">${q.area === 'life' ? 'Жизнь' : 'Работа'}</span>`);
  if (q.estimateMin) parts.push(`<span class="chip">${icon('hourglass', 13)}~${fmtMin(q.estimateMin)}</span>`);
  if (q.steps.length) parts.push(`<span class="chip">${icon('list-checks', 13)}${q.steps.filter((s) => s.done).length}/${q.steps.length}</span>`);
  parts.push(`<span class="chip xp">+${L.questXp(q)} XP</span>`);
  return parts.join('');
}

function questRow(q, { n = null, mode = 'today' } = {}) {
  const v = P.view;
  const isActive = v.active && v.active.id === q.id;
  const next = q.nextStep || (q.steps.find((s) => !s.done) || {}).text;
  const acts = [];
  if (q.status === 'done') {
    acts.push(`<button class="btn btn-ghost icon-btn btn-sm" data-a="questReopen" data-id="${q.id}" title="Вернуть в книгу" aria-label="Вернуть в книгу">${icon('rotate-ccw', 16)}</button>`);
  } else {
    if (isActive) acts.push(`<button class="btn btn-sm" data-a="questPause" aria-label="Пауза">${icon('pause', 15)}Пауза</button>`);
    else acts.push(`<button class="btn btn-sm ${mode === 'today' && n === 1 && !v.active ? 'btn-primary' : ''}" data-a="questStart" data-id="${q.id}" aria-label="Начать квест">${icon('play', 15)}Начать</button>`);
    acts.push(`<button class="btn btn-good icon-btn btn-sm" data-a="questComplete" data-id="${q.id}" title="Квест выполнен" aria-label="Квест выполнен">${icon('check', 16)}</button>`);
    if (q.status === 'inbox') acts.push(`<button class="btn btn-ghost icon-btn btn-sm" data-a="questToToday" data-id="${q.id}" title="Взять на сегодня" aria-label="Взять на сегодня">${icon('sunrise', 16)}</button>`);
    if (q.status === 'today') acts.push(`<button class="btn btn-ghost icon-btn btn-sm" data-a="questToInbox" data-id="${q.id}" title="Вернуть в книгу" aria-label="Вернуть в книгу">${icon('book-open', 16)}</button>`);
  }
  acts.push(`<button class="btn btn-ghost icon-btn btn-sm" data-a="editQuest" data-id="${q.id}" title="Изменить" aria-label="Изменить квест">${icon('pencil', 15)}</button>`);
  const showSteps = (isActive || mode === 'today') && q.steps.length > 0 && q.status !== 'done';
  return `
    <article class="card quest ${q.kind} ${isActive ? 'active' : ''} ${q.status === 'done' ? 'done' : ''}">
      <span class="stripe" aria-hidden="true"></span>
      <div class="body">
        <div class="title">${n ? `<span class="n">${n}.</span>` : ''}${esc(q.title)}</div>
        ${next && q.status !== 'done' ? `<div class="step">${icon('chevron-right', 14)}<span>${esc(next)}</span></div>` : ''}
        <div class="chips">${questChips(q)}${isActive ? `<span class="chip ember">${icon('clock', 13)}${fmtMin(v.activeElapsedMin)} в пути</span>` : ''}</div>
        ${showSteps ? `<div class="substeps">${q.steps.map((s, i) => `
          <div class="substep ${s.done ? 'done' : ''}">
            <button class="check" role="checkbox" aria-checked="${s.done}" aria-label="Шаг ${i + 1}: ${esc(s.text)}" data-a="questToggleStep" data-id="${q.id}" data-sid="${s.id}">${icon('check', 14)}</button>
            <span>${esc(s.text)}</span>
          </div>`).join('')}</div>` : ''}
      </div>
      <div class="acts">${acts.join('')}</div>
    </article>`;
}

function dotsFor(h, days = 14) {
  const st = P.state;
  const today = P.view.today;
  const habit = st.habits.find((x) => x.id === h.id);
  let html = '';
  for (let i = days - 1; i >= 0; i--) {
    const k = L.addDays(today, -i);
    if (!L.isScheduled(habit, k)) { html += '<i class="off"></i>'; continue; }
    html += `<i class="${L.isDone(st, h.id, k) ? 'on' : ''}" title="${k}"></i>`;
  }
  return `<div class="dots" aria-label="Последние ${days} дней">${html}</div>`;
}

function habitCard(h, { compact = false } = {}) {
  const urgent = !h.done && h.minutesLeft != null && h.minutesLeft <= 15;
  const open = ui.openHabit[h.id] ?? (urgent && h.steps.length > 0);
  const when = h.time ? `${h.time} · ${h.done ? 'готово' : fmtUntil(h.minutesLeft)}` : fmtDays(h.days);
  return `
    <article class="card habit ${h.done ? 'done' : ''} ${urgent ? 'urgent' : ''}">
      <div class="habit-row">
        <button class="check round" role="checkbox" aria-checked="${h.done}" aria-label="${esc(h.title)}" data-a="habitToggle" data-id="${h.id}">${icon('check', 15)}</button>
        <div style="flex:1;min-width:0">
          <div class="name">${esc(h.title)}</div>
          <div class="when num">${esc(when)}${h.hard ? ' · жёсткий режим' : ''}</div>
        </div>
        ${h.mustNotMiss ? `<span class="chip ember" title="Вчера пропущено. Второй пропуск подряд обнулит серию.">${icon('shield', 13)}Не пропусти дважды</span>` : ''}
        <span class="streak ${h.streak ? '' : 'zero'}" title="Серия">${icon('flame', 15)}<span class="num">${h.streak}</span></span>
        ${h.steps.length ? `<button class="btn btn-ghost icon-btn btn-sm" data-a="habitExpand" data-id="${h.id}" aria-expanded="${!!open}" aria-label="Шаги ритуала">${icon(open ? 'chevron-down' : 'chevron-right', 16)}</button>` : ''}
      </div>
      ${open && h.steps.length ? `<div class="substeps" style="padding-left:38px">${h.steps.map((s, i) => {
        const d = h.done || h.stepsDone.includes(s.id);
        return `<div class="substep ${d ? 'done' : ''}">
          <button class="check" role="checkbox" aria-checked="${d}" aria-label="Шаг ${i + 1}: ${esc(s.text)}" data-a="habitToggleStep" data-id="${h.id}" data-sid="${s.id}">${icon('check', 14)}</button>
          <span>${i + 1}. ${esc(s.text)}</span></div>`;
      }).join('')}</div>` : ''}
      ${compact ? '' : dotsFor(h)}
    </article>`;
}

function capped(key, items, render) {
  const show = ui.expanded[key] ? items : items.slice(0, VISIBLE);
  let html = show.map(render).join('');
  if (items.length > VISIBLE) {
    html += `<button class="btn btn-ghost btn-sm more" data-a="expand" data-key="${key}">${ui.expanded[key] ? 'Свернуть' : `Ещё ${items.length - VISIBLE}`}</button>`;
  }
  return html;
}

// =====================================================================
// Today
// =====================================================================
function renderNext() {
  const v = P.view;
  const n = v.next;
  if (!n) return '';
  let eyebrow = 'Следующее действие';
  let meta = '';
  let actions = '';
  let urgent = false;
  if (n.type === 'active') {
    eyebrow = 'Сейчас в пути';
    meta = `<span>Квест: <b>${esc(n.title)}</b></span>${n.estimateMin ? `<span class="chip">${icon('hourglass', 13)}~${fmtMin(n.estimateMin)}</span>` : ''}<span class="chip ember">${icon('clock', 13)}${fmtMin(v.activeElapsedMin)} в пути</span>`;
    if (ui.askNext === n.id) {
      return `<section class="card next" aria-label="Следующее действие">
        <div class="eyebrow">Шаг сделан</div>
        <div class="action">Какой следующий шаг?</div>
        <div class="meta">Квест: <b>${esc(n.title)}</b>. Одно действие на 2–15 минут.</div>
        <form class="next-input" data-form="nextStep" data-id="${n.id}">
          <input class="input" id="next-step-input" name="step" placeholder="Например: открыть PR и прочитать комментарии" autocomplete="off" aria-label="Следующий шаг">
          <button class="btn btn-primary" type="submit">Записать</button>
          <button class="btn btn-good" type="button" data-a="questComplete" data-id="${n.id}">${icon('check', 16)}Квест готов</button>
        </form>
      </section>`;
    }
    if (v.active.sagaId) {
      eyebrow = 'Сессия саги';
      actions = `<button class="btn btn-primary" data-a="questComplete" data-id="${n.id}">${icon('check', 16)}Завершить сессию</button>
        <button class="btn btn-ghost" data-a="questPause">${icon('pause', 16)}Пауза</button>`;
      return `<section class="card next" aria-label="Следующее действие">
        <div class="eyebrow">${esc(eyebrow)}</div><div class="action">${esc(n.action)}</div>
        <div class="meta">${meta}</div><div class="hint">Время — ориентир. Можно закончить раньше.</div><div class="actions">${actions}</div></section>`;
    }
    actions = `
      <button class="btn btn-primary" data-a="stepDone" data-id="${n.id}">${icon('check', 16)}Шаг готов</button>
      <button class="btn btn-good" data-a="questComplete" data-id="${n.id}">${icon('trophy', 16)}Квест выполнен</button>
      <button class="btn btn-ghost" data-a="questPause">${icon('pause', 16)}Пауза</button>`;
  } else if (n.type === 'quest') {
    meta = `<span>Квест: <b>${esc(n.title)}</b></span>${n.estimateMin ? `<span class="chip">${icon('hourglass', 13)}~${fmtMin(n.estimateMin)}</span>` : ''}`;
    actions = `<button class="btn btn-primary" data-a="questStart" data-id="${n.id}">${icon('play', 16)}Начать</button>`;
  } else if (n.type === 'habit') {
    urgent = n.minutesLeft <= 0;
    eyebrow = urgent ? `${n.title}: ${fmtUntil(n.minutesLeft)}` : `${n.title} ${fmtUntil(n.minutesLeft)}`;
    meta = `<span>Ритуал: <b>${esc(n.title)}</b></span>`;
    actions = `<button class="btn btn-primary" data-a="habitNextStep" data-id="${n.id}">${icon('check', 16)}Сделано</button>
      <button class="btn btn-ghost" data-a="habitExpand" data-id="${n.id}">${icon('list-checks', 16)}Все шаги</button>`;
  } else if (n.type === 'plan') {
    actions = `<button class="btn btn-primary" data-nav="briefing">${icon('sunrise', 16)}Спланировать день</button>`;
  } else {
    actions = `<button class="btn btn-primary" data-a="capture">${icon('plus', 16)}Записать квест</button>`;
  }
  return `<section class="card next ${urgent ? 'urgent' : ''}" aria-label="Следующее действие">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="action">${esc(n.action)}</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    <div class="actions">${actions}</div>
  </section>`;
}

function renderToday() {
  const v = P.view;
  const limit = v.settings.todayLimit;
  const tq = [...v.todayQuests].sort((a, b) => (b.id === (v.active && v.active.id)) - (a.id === (v.active && v.active.id)));
  const regular = tq.filter((q) => !q.sagaId).length;
  const slots = Math.max(0, limit - regular);
  const activeSagas = v.sagas.filter((g) => g.status === 'active');
  const stepsToday = P.state.log.filter((e) => e.type === 'step' && L.dayKey(e.at, v.settings.dayStartHour) === v.today).length;
  const d = new Date(v.now);
  const dateStr = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return `<div class="page">
    <div class="page-head">
      <div><h1>Сегодня</h1><p>${esc(dateStr[0].toUpperCase() + dateStr.slice(1))}${v.bedtime ? ` · ${esc(v.bedtime.title)} в ${v.bedtime.time}` : ''}</p></div>
      <button class="btn" data-nav="briefing">${icon('sunrise', 16)}План дня</button>
    </div>
    ${renderNext()}
    <div class="grid2">
      <section class="section" aria-labelledby="h-q">
        <div class="section-head"><div class="eyebrow" id="h-q">Квесты дня · <span class="num">${regular}/${limit}</span></div></div>
        <div class="list">
          ${tq.map((q, i) => questRow(q, { n: i + 1 })).join('')}
          ${slots ? `<button class="slot" data-nav="briefing">${icon('plus', 16)}Свободный слот — взять квест из книги</button>` : ''}
        </div>
      </section>
      <section class="section" aria-labelledby="h-h">
        <div class="section-head"><div class="eyebrow" id="h-h">Ритуалы · <span class="num">${v.habitsDone}/${v.todayHabits.length}</span></div>
          <button class="btn btn-ghost btn-sm" data-nav="rituals">Все</button></div>
        <div class="list">
          ${v.todayHabits.length ? capped('todayHabits', v.todayHabits, (h) => habitCard(h, { compact: true })) : `<div class="card empty">${icon('flame', 22)}<span>Ритуалов на сегодня нет</span><button class="btn btn-sm" data-a="newHabit">Добавить ритуал</button></div>`}
        </div>
        ${activeSagas.length ? `<div class="section-head" style="margin-top:8px"><div class="eyebrow">Саги</div><button class="btn btn-ghost btn-sm" data-nav="sagas">Все</button></div>
        <div class="list">${activeSagas.slice(0, 3).map((g) => sagaCompact(g)).join('')}</div>` : ''}
      </section>
    </div>
    <section class="card wins" aria-label="Победы дня">
      <div class="win-stat xp"><b class="num">+${v.xpToday}</b><span>XP сегодня</span></div>
      <div class="win-stat gold"><b class="num">${v.doneToday.length}</b><span>${plural(v.doneToday.length, 'квест выполнен', 'квеста выполнено', 'квестов выполнено')}</span></div>
      <div class="win-stat"><b class="num">${stepsToday}</b><span>${plural(stepsToday, 'шаг', 'шага', 'шагов')}</span></div>
      <div class="win-stat"><b class="num">${v.habitsDone}/${v.todayHabits.length}</b><span>ритуалов</span></div>
      ${v.doneToday.length ? `<div style="flex:1;min-width:220px" class="muted">${v.doneToday.slice(0, 3).map((q) => `<div>${icon('check', 14, 'inline')} ${esc(q.title)}</div>`).join('')}</div>` : ''}
    </section>
  </div>`;
}

// =====================================================================
// Briefing (morning plan)
// =====================================================================
function renderBriefing() {
  const v = P.view;
  const limit = v.settings.todayLimit;
  const already = v.todayQuests.map((q) => q.id);
  if (ui.pick.size === 0 && already.length) already.forEach((id) => ui.pick.add(id));
  const candidates = [...v.todayQuests, ...v.inbox.sort((a, b) => (b.kind === 'main') - (a.kind === 'main'))];
  const picked = ui.pick.size;
  const hour = new Date(v.now).getHours();
  const greet = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  return `<div class="page">
    <div class="page-head">
      <div><h1>${greet}. План на день</h1><p>Выбери до ${limit} ${plural(limit, 'квеста', 'квестов', 'квестов')}. Остальное подождёт в книге.</p></div>
      <div class="stepper" aria-label="Выбрано ${picked} из ${limit}">${Array.from({ length: limit }, (_, i) => `<i class="${i < picked ? 'on' : ''}"></i>`).join('')}<span class="num">${picked}/${limit}</span></div>
    </div>
    <div class="grid2">
      <section class="section">
        <div class="eyebrow">Книга квестов</div>
        <form class="quickadd" data-form="quickadd" data-today="1">
          <input class="input" id="brief-add" name="text" placeholder="Новый квест…  ~30  !  #жизнь  > первый шаг" autocomplete="off" aria-label="Быстро добавить квест">
          <button class="btn" type="submit">${icon('plus', 16)}Добавить</button>
        </form>
        <div class="list">
          ${candidates.length ? candidates.map((q) => {
            const on = ui.pick.has(q.id);
            const dis = !on && picked >= limit;
            return `<button class="card pick" aria-pressed="${on}" data-a="pick" data-id="${q.id}" ${dis ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
              <span class="check" aria-hidden="true" aria-checked="${on}">${icon('check', 15)}</span>
              <span><b>${esc(q.title)}</b>${q.nextStep ? `<br><span class="muted" style="font-size:13px">→ ${esc(q.nextStep)}</span>` : ''}</span>
              <span class="chips" style="display:flex;gap:6px">${q.kind === 'main' ? `<span class="chip gold">${icon('crown', 13)}Главный</span>` : ''}${q.estimateMin ? `<span class="chip">~${fmtMin(q.estimateMin)}</span>` : ''}</span>
            </button>`;
          }).join('') : `<div class="card empty">${icon('book-open', 22)}<span>Книга пуста. Запиши первый квест в поле выше.</span></div>`}
        </div>
      </section>
      <section class="section">
        <div class="eyebrow">Ритуалы сегодня</div>
        <div class="list">${v.todayHabits.map((h) => `<div class="card habit"><div class="habit-row">${icon('flame', 16)}<div class="name">${esc(h.title)}</div><span class="when num">${h.time || fmtDays(h.days)}</span></div></div>`).join('') || '<div class="card empty">Нет ритуалов</div>'}</div>
        <div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
          <b>Готово к старту</b>
          <span class="muted" style="font-size:14px">${picked ? `${picked} ${plural(picked, 'квест', 'квеста', 'квестов')} на сегодня. Первый начнётся сразу.` : 'Выбери хотя бы один квест.'}</span>
          <button class="btn btn-primary" data-a="startDay" ${picked ? '' : 'disabled'}>${icon('play', 16)}Начать первый квест</button>
          <button class="btn btn-ghost" data-a="finishBriefing">Только сохранить план</button>
        </div>
      </section>
    </div>
  </div>`;
}

// =====================================================================
// Book
// =====================================================================
function renderBook() {
  const v = P.view;
  const f = (q) => ui.filter === 'all' || q.area === ui.filter;
  const today = v.todayQuests.filter(f);
  const inbox = v.inbox.filter(f).sort((a, b) => (b.kind === 'main') - (a.kind === 'main') || b.createdAt - a.createdAt);
  const done = P.state.quests.filter((q) => q.status === 'done' && f(q)).sort((a, b) => b.doneAt - a.doneAt);
  return `<div class="page">
    <div class="page-head">
      <div><h1>Книга квестов</h1><p>Записывай всё сюда. На день берутся только ${v.settings.todayLimit}.</p></div>
      <button class="btn" data-a="newQuest">${icon('pencil', 16)}Подробный квест</button>
    </div>
    <section class="section">
      <form class="quickadd" data-form="quickadd">
        <input class="input" id="book-add" name="text" placeholder="Что нужно сделать?" autocomplete="off" aria-label="Быстро добавить квест" aria-describedby="syntax">
        <button class="btn btn-primary" type="submit">${icon('plus', 16)}Записать</button>
      </form>
      <div class="syntax" id="syntax"><span><code>~30</code> или <code>2ч</code> оценка</span><span><code>!</code> главный</span><span><code>#жизнь</code> сфера</span><span><code>@сегодня</code> на день</span><span><code>&gt; шаг</code> первый шаг</span></div>
    </section>
    <div class="filters" role="group" aria-label="Фильтр">
      ${[['all', 'Все'], ['work', 'Работа'], ['life', 'Жизнь']].map(([k, l]) => `<button class="toggle-chip" aria-pressed="${ui.filter === k}" data-a="filter" data-key="${k}">${l}</button>`).join('')}
    </div>
    <section class="section">
      <div class="eyebrow">На сегодня · <span class="num">${today.length}/${v.settings.todayLimit}</span></div>
      <div class="list">${today.length ? today.map((q, i) => questRow(q, { n: i + 1, mode: 'book' })).join('') : '<div class="faint">Пусто. Нажми на солнце у квеста, чтобы взять его на сегодня.</div>'}</div>
    </section>
    <section class="section">
      <div class="eyebrow">В книге · <span class="num">${inbox.length}</span></div>
      <div class="list">${inbox.length ? capped('inbox', inbox, (q) => questRow(q, { mode: 'book' })) : `<div class="card empty">${icon('scroll-text', 22)}<span>Здесь будут квесты на потом.</span></div>`}</div>
    </section>
    ${done.length ? `<section class="section">
      <div class="eyebrow">Выполнено · <span class="num">${done.length}</span></div>
      <div class="list">${capped('done', done, (q) => questRow(q, { mode: 'book' }))}</div>
    </section>` : ''}
  </div>`;
}

// =====================================================================
// Rituals
// =====================================================================
function renderRituals() {
  const v = P.view;
  return `<div class="page">
    <div class="page-head">
      <div><h1>Ритуалы и привычки</h1><p>Правило серии: один пропуск прощается, два подряд — серия с нуля.</p></div>
      <button class="btn btn-primary" data-a="newHabit">${icon('plus', 16)}Новый ритуал</button>
    </div>
    <div class="list">
      ${v.habits.length ? v.habits.map((h) => `
        <article class="card habit">
          <div class="habit-row">
            <span style="color:${h.kind === 'ritual' ? 'var(--arcane)' : 'var(--xp)'}">${icon(h.kind === 'ritual' ? 'moon' : 'footprints', 20)}</span>
            <div style="flex:1;min-width:0">
              <div class="name">${esc(h.title)}</div>
              <div class="when">${fmtDays(h.days)}${h.time ? ` · ${h.time}` : ''}${h.remind.length && h.time ? ` · напоминания: ${h.remind.map(fmtOffset).join(', ')}` : ''}</div>
            </div>
            ${h.hard ? `<span class="chip ember">${icon('alarm-clock', 13)}Жёсткий режим</span>` : ''}
            ${h.steps.length ? `<span class="chip">${icon('list-checks', 13)}${h.steps.length} ${plural(h.steps.length, 'шаг', 'шага', 'шагов')}</span>` : ''}
            <span class="streak ${h.streak ? '' : 'zero'}">${icon('flame', 15)}<span class="num">${h.streak}</span></span>
            <button class="btn btn-ghost icon-btn btn-sm" data-a="editHabit" data-id="${h.id}" aria-label="Изменить ритуал">${icon('pencil', 15)}</button>
          </div>
          ${dotsFor(h, 28)}
        </article>`).join('') : `<div class="card empty">${icon('moon', 24)}<span>Начни с одного: например, ритуал отбоя.</span></div>`}
    </div>
  </div>`;
}

// =====================================================================
// Sagas
// =====================================================================
function weekDots(g) {
  let h = '';
  for (let i = 0; i < g.target; i++) h += `<i class="${i < g.weekSessions ? 'on' : ''}"></i>`;
  return `<span class="dots" aria-label="Сессий на этой неделе: ${g.weekSessions} из ${g.target}">${h}</span>`;
}

function fmtAgo(days) {
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}

/** Buttons that start (or finish) a session. One click = the suggested step at the suggested length. */
function sessionBtns(g, small = false) {
  if (g.status === 'done') return '';
  const sm = small ? 'btn-sm' : '';
  if (g.openActive) {
    return `<button class="btn btn-primary ${sm}" data-a="questComplete" data-id="${g.openQuestId}">${icon('check', 15)}Завершить сессию</button>
      <button class="btn ${sm}" data-a="questPause">${icon('pause', 15)}Пауза</button>`;
  }
  return `<button class="btn btn-primary ${sm}" data-a="sagaQuickStart" data-id="${g.id}">${icon('play', 15)}Начать · ${fmtMin(g.suggestedMin)}</button>
    <button class="btn ${small ? 'btn-ghost' : ''} ${sm}" data-a="sagaLaunch" data-id="${g.id}">Выбрать другое</button>`;
}

/** The "what can I do right now" block: chapter, criterion, one concrete action. */
function sagaNow(g, compact = false) {
  const ch = g.current;
  if (!ch) return compact ? '' : `<div class="saga-now"><span class="faint">Все главы пройдены или глав нет — добавь главу в редакторе саги.</span></div>`;
  const action = g.nextStep ? g.nextStep.text : `любое полезное действие по главе`;
  return `<div class="saga-now">
    <div class="saga-now-head"><span class="eyebrow">Глава ${g.doneCh + 1}/${g.totalCh} · ${esc(ch.title)}</span>${g.curStepsTotal ? `<span class="faint num">шаги ${g.curStepsDone}/${g.curStepsTotal}</span>` : ''}</div>
    ${!compact && ch.criterion ? `<div class="saga-crit">${icon('flag', 13)}<span>Готово, когда: ${esc(ch.criterion)}</span></div>` : ''}
    <div class="saga-today"><span class="muted">Сегодня:</span> <b>${esc(action)}</b></div>
    ${!g.nextStep && !compact ? `<button class="btn btn-ghost btn-sm" style="align-self:flex-start" data-a="editChapter" data-id="${g.id}" data-sid="${ch.id}">${icon('plus', 14)}Разбить главу на маленькие шаги</button>` : ''}
  </div>`;
}

function sagaBack(g) {
  if (!g.isQuiet) return '';
  return `<div class="saga-back">${icon('sunrise', 15)}<span>Последнее занятие ${fmtAgo(g.quietDays)}. Можно вернуться с 5 минут — без нового материала.</span></div>`;
}

function sagaCompact(g) {
  return `<article class="card saga compact">
    <div class="saga-row">
      <span class="saga-ico" aria-hidden="true">${icon('swords', 18)}</span>
      <div style="flex:1;min-width:0"><div class="name">${esc(g.title)}</div>
        <div class="when">${g.nextStep ? `Сегодня: ${esc(g.nextStep.text)}` : g.current ? `Глава: ${esc(g.current.title)}` : 'Глав нет'}</div></div>
      ${weekDots(g)}
    </div>
    ${g.isQuiet ? `<div class="when">${icon('sunrise', 13, 'inline')} последнее занятие ${fmtAgo(g.quietDays)}</div>` : ''}
    <div class="row-btns">${sessionBtns(g, true)}</div>
  </article>`;
}

function chapterList(g) {
  return `<div class="chapters">${g.chapters.map((c, i) => {
    const isCur = g.current && c.id === g.current.id;
    const st = c.steps || [];
    return `<div class="chapter ${c.done ? 'done' : ''} ${isCur ? 'cur' : ''}">
      <div class="substep">
        <button class="check" role="checkbox" aria-checked="${c.done}" aria-label="Глава ${i + 1} пройдена: ${esc(c.title)}" title="Глава пройдена" data-a="sagaToggleChapter" data-id="${g.id}" data-sid="${c.id}">${icon('check', 14)}</button>
        <span class="ch-title">${i + 1}. ${esc(c.title)}</span>
        ${st.length ? `<span class="faint num" style="font-size:12.5px">${st.filter((x) => x.done).length}/${st.length}</span>` : ''}
        ${c.done ? '<span class="chip xp">+50 XP</span>' : ''}
        <button class="btn btn-ghost icon-btn btn-sm" style="margin-left:auto" data-a="editChapter" data-id="${g.id}" data-sid="${c.id}" aria-label="План главы ${i + 1}">${icon('pencil', 14)}</button>
      </div>
      ${isCur && (c.criterion || st.length) ? `<div class="ch-plan">
        ${c.goal ? `<div class="when">${esc(c.goal)}</div>` : ''}
        ${c.criterion ? `<div class="saga-crit">${icon('flag', 13)}<span>Готово, когда: ${esc(c.criterion)}</span></div>` : ''}
        ${st.map((x) => `<div class="substep step-row ${x.done ? 'done' : ''}">
          <button class="check" role="checkbox" aria-checked="${!!x.done}" aria-label="Шаг: ${esc(x.text)}" data-a="chapterToggleStep" data-id="${g.id}" data-ch="${c.id}" data-sid="${x.id}">${icon('check', 13)}</button>
          <span>${esc(x.text)}</span></div>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('') || '<div class="faint">Глав пока нет</div>'}</div>`;
}

function sagaHistory(g) {
  const stats = g.typeStats.filter((t) => t.count);
  return `<div class="saga-history">
    ${stats.length ? `<div class="type-stats"><span class="faint">За 30 дней:</span>${stats.map((t) => `<span class="chip arcane">${esc(t.name)} · ${t.count}</span>`).join('')}</div>` : ''}
    ${g.history.length ? g.history.map((h) => `<div class="hist">
      <span class="t num">${new Date(h.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
      <span class="num hist-min">${h.estimated ? '~' : ''}${fmtMin(h.min)}</span>
      <span class="hist-body">${h.type ? `<span class="chip">${esc(h.type)}</span>` : ''}${h.step ? `<span class="hist-step">${icon('check', 13, 'inline')} ${esc(h.step)}</span>` : ''}${h.note ? `<span class="hist-note">«${esc(h.note)}»</span>` : ''}${!h.step && !h.note && !h.type ? '<span class="faint">занятие</span>' : ''}</span>
    </div>`).join('') : '<div class="faint">Занятий пока не было.</div>'}
  </div>`;
}

function sagaCard(g) {
  const open = ui.openSaga[g.id] ?? false;
  const hist = ui.openHist[g.id] ?? false;
  const hours = g.totalMin >= 60 ? `${Math.floor(g.totalMin / 60)} ч${g.totalMin % 60 ? ` ${g.totalMin % 60} мин` : ''}` : `${g.totalMin} мин`;
  const statusChip = g.status === 'paused' ? `<span class="chip">${icon('pause', 13)}На паузе</span>`
    : g.status === 'done' ? `<span class="chip xp">${icon('crown', 13)}Завершена</span>`
    : !g.remind ? `<span class="chip" title="Напоминания для этой саги выключены">${icon('bell', 13)}без напоминаний</span>` : '';
  return `<article class="card saga ${g.status}">
    <div class="saga-row">
      <span class="saga-ico big" aria-hidden="true">${icon(g.status === 'done' ? 'crown' : 'swords', 22)}</span>
      <div style="flex:1;min-width:0">
        <h2 class="saga-title">${esc(g.title)}</h2>
        ${g.why ? `<div class="when">${esc(g.why)}</div>` : ''}
      </div>
      ${statusChip}
      <button class="btn btn-ghost icon-btn btn-sm" data-a="editSaga" data-id="${g.id}" aria-label="Изменить сагу">${icon('pencil', 15)}</button>
    </div>
    ${g.status === 'active' ? sagaBack(g) + sagaNow(g) : ''}
    <div class="row-btns">
      ${g.status === 'active' ? sessionBtns(g) : ''}
      ${g.status === 'paused' ? `<button class="btn btn-primary" data-a="sagaPause" data-id="${g.id}">${icon('play', 15)}Продолжить сагу</button>` : ''}
    </div>
    <div class="saga-progress">
      <div class="xpbar" role="progressbar" aria-label="Прогресс саги" aria-valuenow="${g.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${g.pct}%"></i></div>
      <div class="saga-meta num"><span>${g.doneCh}/${g.totalCh} ${plural(g.totalCh, 'глава', 'главы', 'глав')} · ${g.pct}%</span><span class="saga-week">Неделя ${weekDots(g)} ${g.weekSessions}/${g.target}</span><span>${hours} · ${g.sessions} ${plural(g.sessions, 'занятие', 'занятия', 'занятий')}</span></div>
    </div>
    <div class="row-btns">
      <button class="btn btn-ghost btn-sm" data-a="sagaExpand" data-id="${g.id}" aria-expanded="${open}">${icon(open ? 'chevron-down' : 'chevron-right', 15)}Главы</button>
      <button class="btn btn-ghost btn-sm" data-a="sagaHistory" data-id="${g.id}" aria-expanded="${hist}">${icon(hist ? 'chevron-down' : 'chevron-right', 15)}История</button>
      <span style="flex:1"></span>
      ${g.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-a="sagaLog" data-id="${g.id}" title="Занимался вне компьютера">${icon('plus', 14)}Отметить занятие</button>` : ''}
      ${g.status === 'active' ? `<button class="btn btn-ghost btn-sm" data-a="sagaPause" data-id="${g.id}">Пауза саги</button>` : ''}
    </div>
    ${open ? chapterList(g) : ''}
    ${hist ? sagaHistory(g) : ''}
  </article>`;
}

function renderSagas() {
  const v = P.view;
  const act = v.sagas.filter((g) => g.status !== 'done');
  const done = v.sagas.filter((g) => g.status === 'done');
  return `<div class="page">
    <div class="page-head">
      <div><h1>Саги</h1><p>Долгие цели. Карточка всегда показывает одно маленькое действие, с которого можно начать прямо сейчас.</p></div>
      <button class="btn btn-primary" data-a="newSaga">${icon('plus', 16)}Новая сага</button>
    </div>
    <div class="list">${act.length ? act.map(sagaCard).join('') : `<div class="card empty">${icon('swords', 24)}<span>Сага — цель на недели: «Изучить Electron», «Японский».<br>Разбей её на главы, главы — на маленькие шаги. Дальше по одной сессии.</span><button class="btn btn-primary btn-sm" data-a="newSaga">Начать сагу</button></div>`}</div>
    ${done.length ? `<section class="section"><div class="eyebrow">Завершённые</div><div class="list">${done.map(sagaCard).join('')}</div></section>` : ''}
  </div>`;
}

function openSagaEditor(id) {
  const src = id ? P.state.sagas.find((x) => x.id === id) : null;
  ui.drawer = {
    type: 'saga',
    draft: src
      ? { ...JSON.parse(JSON.stringify(src)), steps: src.chapters.map((c) => ({ id: c.id, text: c.title })), types: (src.sessionTypes || []).map((t) => ({ id: t.id, text: t.name })) }
      : { title: '', why: '', area: 'life', targetPerWeek: 3, sessionMin: 30, quietDays: 5, remindEvery: 7, remind: true, steps: [{ text: '' }], types: [] },
  };
  renderDrawer();
  document.getElementById('d-title').focus();
}

function openChapterEditor(sagaId, chId) {
  const g = sagaById(sagaId);
  const c = g && g.chapters.find((x) => x.id === chId);
  if (!c) return;
  ui.drawer = { type: 'chapter', draft: { sagaId, id: c.id, title: c.title, goal: c.goal, criterion: c.criterion, steps: c.steps.map((x) => ({ id: x.id, text: x.text, done: x.done })) } };
  renderDrawer();
  const first = $drawer.querySelector('#d-crit');
  if (first) first.focus();
}

function openLauncher(sagaId, type = 'session') {
  const g = sagaById(sagaId);
  if (!g) return;
  ui.drawer = {
    type,
    draft: type === 'log'
      ? { sagaId, min: null, typeId: g.lastTypeId, stepId: 'none', note: '', opId: Math.random().toString(36).slice(2) + Date.now().toString(36) }
      : { sagaId, stepId: g.nextStep ? g.nextStep.id : 'none', min: g.suggestedMin, typeId: g.lastTypeId },
  };
  renderDrawer();
}

/** Called after any quest completion result: saga sessions get a short wrap-up. */
function maybeWrap(r) {
  const ss = r && r.sagaSession;
  if (!ss) return;
  const g = sagaById(ss.sagaId);
  ui.drawer = { type: 'wrap', draft: { logId: ss.logId, sagaId: ss.sagaId, chapterId: g && g.current ? g.current.id : null, title: ss.title, min: ss.min, estimated: ss.estimated, plannedStepId: ss.stepId, stepId: ss.stepId || 'none', note: '' } };
  renderDrawer();
}

// =====================================================================
// Chronicle
// =====================================================================
function renderChronicle() {
  const v = P.view;
  const st = P.state;
  const dsh = v.settings.dayStartHour;
  const byDay = {};
  for (const e of st.log) { const k = L.dayKey(e.at, dsh); (byDay[k] = byDay[k] || []).push(e); }
  const xpDay = (k) => (byDay[k] || []).reduce((a, e) => a + (e.xp || 0), 0);
  // 12-week heatmap aligned to Monday columns
  const weeks = 12;
  const todayWd = (L.weekday(v.today) + 6) % 7; // Mon=0
  const start = L.addDays(v.today, -(weeks - 1) * 7 - todayWd);
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const k = L.addDays(start, i);
    if (k > v.today) { cells += '<i style="visibility:hidden"></i>'; continue; }
    const x = xpDay(k);
    const lv = x === 0 ? 0 : x < 30 ? 1 : x < 80 ? 2 : x < 150 ? 3 : 4;
    cells += `<i data-l="${lv}" class="${k === v.today ? 'today' : ''}" title="${k}: +${x} XP"></i>`;
  }
  const questsDone = st.quests.filter((q) => q.status === 'done').length;
  const best = Math.max(0, ...v.habits.map((h) => h.streak));
  const days = Object.keys(byDay).sort().reverse().slice(0, 10);
  const iconFor = { quest: 'trophy', habit: 'flame', step: 'check', level: 'crown', 'saga-session': 'swords', chapter: 'flag', saga: 'crown' };
  return `<div class="page">
    <div class="page-head"><div><h1>Летопись</h1><p>Всё, что уже сделано. Здесь только победы.</p></div></div>
    <div class="stats">
      <div class="card stat"><b style="color:var(--gold)">${v.level.level}</b><span>${esc(v.level.title)}</span></div>
      <div class="card stat"><b class="num">${st.player.xp}</b><span>XP всего</span></div>
      <div class="card stat"><b class="num">${questsDone}</b><span>${plural(questsDone, 'квест выполнен', 'квеста выполнено', 'квестов выполнено')}</span></div>
      <div class="card stat"><b class="num" style="color:var(--ember)">${best}</b><span>лучшая текущая серия</span></div>
    </div>
    <section class="card heat-wrap" aria-label="Активность за 12 недель">
      <div class="eyebrow">12 недель</div>
      <div style="display:flex;gap:8px"><div style="display:grid;grid-template-rows:repeat(7,14px);gap:4px;font-size:11px;color:var(--text-faint)">${['Пн', '', 'Ср', '', 'Пт', '', 'Вс'].map((d) => `<span style="line-height:14px">${d}</span>`).join('')}</div><div class="heat">${cells}</div></div>
      <div class="legend">Меньше <i style="background:var(--surface-3)"></i><i style="background:color-mix(in srgb,var(--xp) 30%,var(--surface-3))"></i><i style="background:color-mix(in srgb,var(--xp) 55%,var(--surface-3))"></i><i style="background:color-mix(in srgb,var(--xp) 80%,var(--surface-3))"></i><i style="background:var(--xp)"></i> Больше</div>
    </section>
    ${days.length ? days.map((k) => `
      <section class="card day-log">
        <h3><span>${k === v.today ? 'Сегодня' : k === L.addDays(v.today, -1) ? 'Вчера' : new Date(k + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })}</span><span class="num" style="color:var(--xp)">+${xpDay(k)} XP</span></h3>
        ${capped('log-' + k, byDay[k], (e) => `<div class="log-item log-${e.type}">${icon(iconFor[e.type] || 'circle', 15)}<span class="t num">${fmtTime(e.at)}</span><span>${esc(e.text)}</span>${e.xp ? `<span class="x num">+${e.xp}</span>` : ''}</div>`)}
      </section>`).join('') : `<div class="card empty">${icon('scroll-text', 24)}<span>Летопись начнётся с первого выполненного шага.</span></div>`}
  </div>`;
}

// =====================================================================
// Settings
// =====================================================================
function sw(key, val, label) { return `<button class="switch" role="switch" aria-checked="${!!val}" aria-label="${esc(label)}" data-a="setToggle" data-key="${key}"></button>`; }
function setRow(title, desc, control) { return `<div class="set-row"><div class="desc"><b>${title}</b>${desc ? `<span class="hint">${desc}</span>` : ''}</div><div class="row-inline">${control}</div></div>`; }
function num(key, val, min, max, suffix) { return `<input class="input num" style="width:90px" type="number" min="${min}" max="${max}" id="set-${key}" data-set="${key}" data-type="num" value="${val}" aria-label="${esc(suffix)}"><span class="muted">${suffix}</span>`; }
function time(key, val) { return `<input class="input num" style="width:120px" type="time" id="set-${key}" data-set="${key}" value="${esc(val)}">`; }

function updateRow() {
  const a = P.app || {};
  const u = a.update || { state: 'idle' };
  const txt = {
    dev: 'режим разработки — обновления выключены',
    idle: 'проверка через несколько секунд после запуска',
    checking: 'проверяю…',
    latest: 'установлена последняя версия',
    downloading: `скачиваю ${u.version || ''}${u.percent ? ` · ${u.percent}%` : ''}`,
    ready: `версия ${u.version} скачана и установится при перезапуске`,
    error: `не удалось проверить: ${u.message || 'ошибка'}`,
  }[u.state] || '';
  const btn = u.state === 'ready'
    ? `<button class="btn btn-primary btn-sm" data-a="updateInstall">${icon('rotate-ccw', 14)}Обновить сейчас</button>`
    : `<button class="btn btn-sm" data-a="updateCheck" ${u.state === 'dev' || u.state === 'checking' || u.state === 'downloading' ? 'disabled' : ''}>Проверить</button>`;
  return setRow(`Версия ${esc(a.version || '')}`, esc(txt), btn);
}

function renderSettings() {
  const s = P.view.settings;
  return `<div class="page settings">
    <div class="page-head"><div><h1>Настройки</h1><p>Всё сохраняется сразу.</p></div></div>
    <section class="card set-card">
      <div class="eyebrow">Скин</div>
      <div class="skins" role="group" aria-label="Скин">
        ${THEMES.map((t) => `<button class="skin" aria-pressed="${(s.theme || 'dark') === t.id}" data-a="theme" data-key="${t.id}">
          <span class="sw" aria-hidden="true" style="background:${t.sw[1]}">
            <span class="l" style="background:${t.sw[0]}"><i style="background:${t.sw[2]};width:70%"></i><i style="background:${t.sw[3]};opacity:.5"></i><i style="background:${t.sw[3]};opacity:.5;width:60%"></i></span>
            <span class="r"><i style="background:${t.sw[2]};width:45%"></i><i style="background:${t.sw[3]};opacity:.35"></i><i style="background:${t.sw[3]};opacity:.35;width:80%"></i></span>
          </span>
          <b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('')}
      </div>
    </section>
    <section class="card set-card">
      <div class="eyebrow">Дисциплина</div>
      ${setRow('Квестов на день', 'Больше трёх — обычно перебор. Лимит защищает от паралича выбора.', num('todayLimit', s.todayLimit, 1, 5, 'шт.'))}
      ${setRow('Напоминание без активного квеста', 'В рабочие часы, только когда ты за компьютером.', num('nudgeIdleMin', s.nudgeIdleMin, 10, 240, 'мин'))}
      ${setRow('Проверка фокуса', 'Сколько минут в квесте до напоминания отметить шаг и размяться.', num('focusCheckMin', s.focusCheckMin, 15, 180, 'мин'))}
      ${setRow('Утренний план', 'При первом включении ПК за день откроется план дня.', sw('morningBriefing', s.morningBriefing, 'Утренний план'))}
      ${setRow('Вечерний итог', 'Уведомление с победами дня.', time('eveningReview', s.eveningReview))}
      ${setRow('Начало дня', 'До этого часа ночь считается предыдущим днём (важно для отбоя).', num('dayStartHour', s.dayStartHour, 0, 8, ':00'))}
    </section>
    <section class="card set-card">
      <div class="eyebrow">Рабочий день</div>
      ${setRow('Часы работы', 'Напоминания о квестах приходят только в эти часы.', `${time('workStart', s.workStart)}<span class="muted">—</span>${time('workEnd', s.workEnd)}`)}
      ${setRow('Рабочие дни', '', `<div class="chips-row">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button class="toggle-chip" aria-pressed="${s.workDays.includes(d)}" data-a="workDay" data-key="${d}">${WD[d]}</button>`).join('')}</div>`)}
    </section>
    <section class="card set-card">
      <div class="eyebrow">HUD и клавиши</div>
      ${setRow('Показывать HUD', 'Маленькая панель на рабочем столе: текущий квест и ритуалы.', sw('hudEnabled', s.hudEnabled, 'Показывать HUD'))}
      ${setRow('Куда сворачивается HUD', 'Авто: если HUD в нижней половине экрана, он растёт и сворачивается к низу. У края панели задач прилипает к ней.', `<div class="chips-row">${[['auto', 'Авто'], ['bottom', 'К низу'], ['top', 'К верху']].map(([k, l]) => `<button class="toggle-chip" aria-pressed="${(s.hudAnchor || 'auto') === k}" data-a="hudAnchor" data-key="${k}">${l}</button>`).join('')}</div>`)}
      ${setRow('HUD поверх окон', 'Иначе HUD прячется под окнами и всплывает с напоминаниями.', sw('hudOnTop', s.hudOnTop, 'HUD поверх окон'))}
      ${setRow('Быстрый квест', 'Глобальное сочетание. Формат: Control+Alt+Q', `<input class="input" style="width:200px" id="set-hotkeyCapture" data-set="hotkeyCapture" value="${esc(s.hotkeyCapture)}">`)}
      ${setRow('Показать/скрыть HUD', '', `<input class="input" style="width:200px" id="set-hotkeyHud" data-set="hotkeyHud" value="${esc(s.hotkeyHud)}">`)}
    </section>
    <section class="card set-card">
      <div class="eyebrow">Система</div>
      ${updateRow()}
      ${setRow('Запуск вместе с Windows', 'Стартует свёрнутым в трей.', sw('autostart', s.autostart, 'Автозапуск'))}
      ${setRow('Меньше анимации', '', sw('reduceMotion', s.reduceMotion, 'Меньше анимации'))}
      ${setRow('Данные', 'Один JSON-файл. Резервная копия делается автоматически.', `<button class="btn btn-sm" data-a="export">Экспорт</button><button class="btn btn-sm" data-a="import">Импорт</button><button class="btn btn-ghost btn-sm" data-a="dataDir">Папка</button>`)}
    </section>
  </div>`;
}

// =====================================================================
// Drawer editors
// =====================================================================
function stepsEditor(list, key = 'steps', label = 'Шаг') {
  return `<div class="steps-edit">${list.map((s, i) => `
    <div class="step-edit"><span class="idx num">${i + 1}.</span>
      <input class="input" data-list="${key}" data-i="${i}" ${key === 'steps' ? `data-step="${i}"` : ''} value="${esc(s.text)}" aria-label="${label} ${i + 1}">
      ${s.done ? `<span class="chip xp" title="Уже сделано">${icon('check', 12)}</span>` : ''}
      <button type="button" class="btn btn-ghost icon-btn btn-sm" data-d="rmItem" data-list="${key}" data-i="${i}" aria-label="Удалить: ${label} ${i + 1}">${icon('x', 15)}</button>
    </div>`).join('')}
    <button type="button" class="btn btn-ghost btn-sm" data-d="addItem" data-list="${key}" style="align-self:flex-start">${icon('plus', 15)}${label}</button>
  </div>`;
}

function pickOpt(key, value, selected, label, sub = '') {
  return `<button type="button" class="pick-opt" aria-pressed="${selected}" data-d="sval" data-k="${key}" data-v="${esc(value)}">
    <span class="check round" aria-hidden="true" aria-checked="${selected}">${icon('check', 13)}</span>
    <span><span class="pick-label">${esc(label)}</span>${sub ? `<span class="pick-sub">${esc(sub)}</span>` : ''}</span></button>`;
}

function sagaById(id) { return P.view.sagas.find((x) => x.id === id); }

function renderDrawer() {
  if (!ui.drawer) { $drawer.innerHTML = ''; return; }
  const { type, draft } = ui.drawer;
  let body = '';
  let title = '';
  let foot = '';
  if (type === 'quest') {
    title = draft.id ? 'Квест' : 'Новый квест';
    body = `
      <div class="field"><label for="d-title">Название</label><input class="input" id="d-title" value="${esc(draft.title)}" placeholder="Например: обновить алерты для Gateway API"></div>
      <div class="field"><span class="label">Тип</span><div class="chips-row">
        <button type="button" class="toggle-chip" aria-pressed="${draft.kind === 'main'}" data-d="kind" data-v="main">Главный · ×1.5 XP</button>
        <button type="button" class="toggle-chip" aria-pressed="${draft.kind !== 'main'}" data-d="kind" data-v="side">Побочный</button></div></div>
      <div class="field"><span class="label">Сфера</span><div class="chips-row">
        <button type="button" class="toggle-chip" aria-pressed="${draft.area !== 'life'}" data-d="area" data-v="work">Работа</button>
        <button type="button" class="toggle-chip" aria-pressed="${draft.area === 'life'}" data-d="area" data-v="life">Жизнь</button></div></div>
      <div class="field"><span class="label">Оценка времени</span><div class="chips-row">
        ${[5, 15, 30, 60, 90, 120, 240].map((m) => `<button type="button" class="toggle-chip" aria-pressed="${draft.estimateMin === m}" data-d="est" data-v="${m}">${fmtMin(m)}</button>`).join('')}</div>
        <span class="hint">Если больше 2 часов — лучше разбить на шаги.</span></div>
      <div class="field"><label for="d-next">Первый шаг</label><input class="input" id="d-next" value="${esc(draft.nextStep)}" placeholder="Что можно сделать за 2 минуты?"><span class="hint">Самое маленькое действие, с которого точно начнёшь.</span></div>
      <div class="field"><span class="label">Шаги</span>${stepsEditor(draft.steps)}</div>
      <div class="field"><label for="d-notes">Заметки</label><textarea class="textarea" id="d-notes">${esc(draft.notes)}</textarea></div>`;
    foot = `${draft.id ? `<button class="btn btn-danger btn-ghost" data-d="delete">${icon('trash-2', 15)}Удалить</button>` : ''}<span class="spacer"></span>
      <button class="btn btn-ghost" data-d="close">Отмена</button>
      ${draft.id ? '' : '<button class="btn" data-d="saveToday">На сегодня</button>'}
      <button class="btn btn-primary" data-d="save">Сохранить</button>`;
  } else if (type === 'saga') {
    title = draft.id ? 'Сага' : 'Новая сага';
    const chips = (key, vals, fmt) => vals.map((x) => `<button type="button" class="toggle-chip" aria-pressed="${+draft[key] === x}" data-d="sset" data-k="${key}" data-v="${x}">${fmt(x)}</button>`).join('');
    body = `
      <div class="field"><label for="d-title">Название</label><input class="input" id="d-title" value="${esc(draft.title)}" placeholder="Например: Изучить Electron"></div>
      <div class="field"><label for="d-why">Зачем</label><input class="input" id="d-why" value="${esc(draft.why)}" placeholder="Например: собирать свои десктоп-утилиты"><span class="hint">Одна строка. Её видно на карточке, когда мотивация проседает.</span></div>
      <div class="field"><span class="label">Сфера</span><div class="chips-row">
        <button type="button" class="toggle-chip" aria-pressed="${draft.area === 'work'}" data-d="area" data-v="work">Работа</button>
        <button type="button" class="toggle-chip" aria-pressed="${draft.area !== 'work'}" data-d="area" data-v="life">Жизнь</button></div></div>
      <div class="field"><span class="label">Главы</span>${stepsEditor(draft.steps, 'steps', 'Глава')}<span class="hint">Этапы по порядку. Цель, критерий и шаги главы — карандашом в списке глав на карточке саги. +50 XP за главу, +200 за сагу.</span></div>
      <div class="field"><span class="label">Типы занятий <span class="faint">· необязательно</span></span>${stepsEditor(draft.types, 'types', 'Тип')}<span class="hint">Например: «Новое», «Повторение», «Аудирование». Помогают разнообразить занятия.</span></div>
      <div class="field"><span class="label">Сессий в неделю</span><div class="chips-row">${chips('targetPerWeek', [1, 2, 3, 4, 5, 7], (x) => String(x))}</div></div>
      <div class="field"><span class="label">Обычная длина сессии</span><div class="chips-row">${chips('sessionMin', [15, 25, 30, 45, 60, 90], fmtMin)}</div><span class="hint">При старте всегда можно выбрать 5, 10 или 15 минут. Сессия не занимает слот из лимита квестов дня.</span></div>
      <div class="set-row" style="grid-template-columns:1fr auto"><div class="desc"><b>Напоминать, если сага замолчала</b><span class="hint">Мягкое приглашение начать с 5 минут. Без штрафов.</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${draft.remind !== false}" aria-label="Напоминания саги" data-d="remindToggle"></button></div>
      ${draft.remind !== false ? `<div class="field"><span class="label">Первое напоминание через</span><div class="chips-row">${chips('quietDays', [3, 5, 7, 14], (x) => `${x} дн.`)}</div></div>
      <div class="field"><span class="label">Дальше — не чаще чем раз в</span><div class="chips-row">${chips('remindEvery', [3, 7, 14], (x) => `${x} дн.`)}</div></div>` : ''}`;
    foot = `${draft.id ? `<button class="btn btn-danger btn-ghost" data-d="sagaArchive">${icon('trash-2', 15)}Убрать</button>` : ''}<span class="spacer"></span>
      <button class="btn btn-ghost" data-d="close">Отмена</button><button class="btn btn-primary" data-d="save">Сохранить</button>`;
  } else if (type === 'chapter') {
    title = 'План главы';
    body = `
      <div class="field"><label for="d-title">Название</label><input class="input" id="d-title" value="${esc(draft.title)}"></div>
      <div class="field"><label for="d-goal">Цель <span class="faint">· необязательно</span></label><input class="input" id="d-goal" value="${esc(draft.goal)}" placeholder="Зачем эта глава"></div>
      <div class="field"><label for="d-crit">Критерий завершения</label><input class="input" id="d-crit" value="${esc(draft.criterion)}" placeholder="Как понять, что результат достигнут"><span class="hint">Например: «Провести 3 спокойных занятия».</span></div>
      <div class="field"><span class="label">Шаги</span>${stepsEditor(draft.steps, 'steps', 'Шаг')}<span class="hint">Маленькие действия на 5–20 минут. Отмечаются независимо; главу закрываешь сам, когда выполнен критерий.</span></div>`;
    foot = `<span class="spacer"></span><button class="btn btn-ghost" data-d="close">Отмена</button><button class="btn btn-primary" data-d="chapterSave">Сохранить</button>`;
  } else if (type === 'session' || type === 'log') {
    const g = sagaById(draft.sagaId);
    const ch = g && g.current;
    const steps = ch ? ch.steps.filter((st) => !st.done) : [];
    const isLog = type === 'log';
    title = isLog ? 'Отметить занятие' : 'Начать сессию';
    const durs = isLog ? [5, 10, 15, 20, 30, 45, 60] : g.durations;
    body = `
      <div class="muted">${esc(g.title)}${ch ? ` · глава «${esc(ch.title)}»` : ''}</div>
      ${isLog ? `<div class="field"><span class="label">Сколько длилось</span><div class="chips-row">
          ${durs.map((m) => `<button type="button" class="toggle-chip" aria-pressed="${+draft.min === m}" data-d="sset" data-k="min" data-v="${m}">${fmtMin(m)}</button>`).join('')}
          <input class="input num" style="width:90px" type="number" min="1" max="600" id="d-min" value="${draft.min && !durs.includes(+draft.min) ? draft.min : ''}" placeholder="мин" aria-label="Минут"></div></div>` : ''}
      <div class="field"><span class="label">${isLog ? 'Какой шаг сделан' : 'Что делаем'}</span><div class="pick-list">
        ${steps.map((st, i) => pickOpt('stepId', st.id, draft.stepId === st.id, st.text, !isLog && i === 0 ? 'следующий по плану' : '')).join('')}
        ${pickOpt('stepId', 'none', draft.stepId === 'none' || (isLog && !draft.stepId), isLog ? 'Ни один, просто позанимался' : 'Без конкретного шага — просто позаниматься')}
      </div>${ch && !ch.steps.length ? '<span class="hint">В главе пока нет шагов. Их можно добавить карандашом у главы.</span>' : ''}</div>
      ${isLog ? '' : `<div class="field"><span class="label">Сколько</span><div class="chips-row">
          ${durs.map((m) => `<button type="button" class="toggle-chip" aria-pressed="${+draft.min === m}" data-d="sset" data-k="min" data-v="${m}">${fmtMin(m)}${m === g.sessionMin ? ' · обычно' : ''}</button>`).join('')}</div>
        <span class="hint">Это ориентир, а не таймер. Закончить можно раньше — запишется фактическое время.</span></div>`}
      ${g.types.length ? `<div class="field"><span class="label">Тип занятия</span><div class="chips-row">
        ${g.types.map((t) => `<button type="button" class="toggle-chip" aria-pressed="${draft.typeId === t.id}" data-d="sval" data-k="typeId" data-v="${t.id}">${esc(t.name)}</button>`).join('')}</div></div>` : ''}
      ${isLog ? `<div class="field"><label for="d-note">Заметка <span class="faint">· необязательно</span></label><input class="input" id="d-note" value="${esc(draft.note)}" placeholder="Что получилось или что вспомнил" maxlength="280"></div>` : ''}`;
    foot = `<span class="spacer"></span><button class="btn btn-ghost" data-d="close">Отмена</button>
      <button class="btn btn-primary" data-d="${isLog ? 'logSave' : 'sessionStart'}">${icon(isLog ? 'check' : 'play', 16)}${isLog ? 'Записать' : `Начать · ${fmtMin(+draft.min)}`}</button>`;
  } else if (type === 'wrap') {
    const g = sagaById(draft.sagaId);
    const ch = g && g.current;
    const steps = ch ? ch.steps.filter((st) => !st.done) : [];
    const ordered = [...steps.filter((st) => st.id === draft.plannedStepId), ...steps.filter((st) => st.id !== draft.plannedStepId)];
    title = 'Сессия завершена';
    body = `
      <div class="wrap-sum"><b>${esc(draft.title)}</b><span class="num">${draft.estimated ? `~${fmtMin(draft.min)} · таймер не запускался` : fmtMin(draft.min)}</span></div>
      ${ordered.length ? `<div class="field"><span class="label">Что получилось</span><div class="pick-list">
        ${ordered.map((st) => pickOpt('stepId', st.id, draft.stepId === st.id, `Сделал: ${st.text}`, st.id === draft.plannedStepId ? 'было в плане' : '')).join('')}
        ${pickOpt('stepId', 'none', !draft.stepId || draft.stepId === 'none', 'Просто занимался, без отметки шага')}
      </div></div>` : ''}
      <div class="field"><label for="d-note">Заметка <span class="faint">· необязательно</span></label><input class="input" id="d-note" value="${esc(draft.note)}" placeholder="Что получилось, что вспомнил, что было трудно" maxlength="280"></div>
      ${ch && ch.criterion ? `<div class="saga-crit">${icon('flag', 13)}<span>Критерий главы «${esc(ch.title)}»: ${esc(ch.criterion)}</span></div>
        <button type="button" class="toggle-chip" aria-pressed="${!!draft.chapterDone}" data-d="chapterDone">Критерий выполнен — глава пройдена</button>` : ''}`;
    foot = `<span class="spacer"></span><button class="btn btn-ghost" data-d="wrapSkip">Пропустить</button><button class="btn btn-primary" data-d="wrapSave">Сохранить</button>`;
  } else {
    title = draft.id ? 'Ритуал' : 'Новый ритуал';
    const presets = [-60, -30, -15, 0, 15, 30, 60];
    body = `
      <div class="field"><label for="d-title">Название</label><input class="input" id="d-title" value="${esc(draft.title)}" placeholder="Например: Ритуал отбоя"></div>
      <div class="field"><span class="label">Тип</span><div class="chips-row">
        <button type="button" class="toggle-chip" aria-pressed="${draft.kind === 'ritual'}" data-d="hkind" data-v="ritual">Ритуал · есть шаги</button>
        <button type="button" class="toggle-chip" aria-pressed="${draft.kind !== 'ritual'}" data-d="hkind" data-v="habit">Привычка · одна отметка</button></div></div>
      <div class="field"><span class="label">Дни</span><div class="chips-row">
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="toggle-chip" aria-pressed="${draft.days.length === 0 || draft.days.includes(d)}" data-d="day" data-v="${d}">${WD[d]}</button>`).join('')}
        <button type="button" class="btn btn-ghost btn-sm" data-d="daysAll">Каждый день</button><button type="button" class="btn btn-ghost btn-sm" data-d="daysWork">Будни</button></div></div>
      <div class="field"><label for="d-time">Время</label>
        <div class="chips-row"><input class="input num" style="width:140px" type="time" id="d-time" value="${esc(draft.time || '')}">
        ${draft.time ? '<button type="button" class="btn btn-ghost btn-sm" data-d="noTime">Без времени</button>' : ''}</div>
        <span class="hint">С временем приходят напоминания. Без времени — просто отметка за день.</span></div>
      ${draft.time ? `<div class="field"><span class="label">Напоминания</span><div class="chips-row">
        ${presets.map((o) => `<button type="button" class="toggle-chip" aria-pressed="${draft.remind.includes(o)}" data-d="rem" data-v="${o}">${fmtOffset(o)}</button>`).join('')}</div></div>
      <div class="set-row" style="grid-template-columns:1fr auto"><div class="desc"><b>Жёсткий режим</b><span class="hint">После времени поверх всех окон появится экран с шагами. Отложить можно дважды по 10 минут.</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${!!draft.hard}" aria-label="Жёсткий режим" data-d="hard"></button></div>` : ''}
      <div class="field"><span class="label">Шаги ритуала</span>${stepsEditor(draft.steps)}<span class="hint">Отметка всех шагов закрывает ритуал.</span></div>`;
    foot = `${draft.id ? `<button class="btn btn-danger btn-ghost" data-d="archive">${icon('trash-2', 15)}Убрать</button>` : ''}<span class="spacer"></span>
      <button class="btn btn-ghost" data-d="close">Отмена</button><button class="btn btn-primary" data-d="save">Сохранить</button>`;
  }
  $drawer.innerHTML = `<div class="scrim" data-d="close"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header><h2 id="drawer-title">${title}</h2><button class="btn btn-ghost icon-btn" data-d="close" aria-label="Закрыть">${icon('x', 18)}</button></header>
      <div class="dbody">${body}</div>
      <footer>${foot}</footer>
    </aside>`;
}

function readDrawerInputs() {
  const d = ui.drawer.draft;
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  if (g('d-title') !== undefined) d.title = g('d-title');
  if (g('d-next') !== undefined) d.nextStep = g('d-next');
  if (g('d-notes') !== undefined) d.notes = g('d-notes');
  if (g('d-time') !== undefined) d.time = g('d-time') || null;
  if (g('d-why') !== undefined) d.why = g('d-why');
  if (g('d-goal') !== undefined) d.goal = g('d-goal');
  if (g('d-crit') !== undefined) d.criterion = g('d-crit');
  if (g('d-note') !== undefined) d.note = g('d-note');
  if (g('d-min') !== undefined && g('d-min') !== '') d.min = +g('d-min');
  $drawer.querySelectorAll('input[data-list]').forEach((el) => { d[el.dataset.list][+el.dataset.i].text = el.value; });
}

function openQuestEditor(q) {
  ui.drawer = { type: 'quest', draft: q ? JSON.parse(JSON.stringify(q)) : { title: '', kind: 'side', area: 'work', estimateMin: 30, nextStep: '', steps: [], notes: '' } };
  renderDrawer();
  document.getElementById('d-title').focus();
}
function openHabitEditor(h) {
  const src = h ? P.state.habits.find((x) => x.id === h) : null;
  ui.drawer = { type: 'habit', draft: src ? JSON.parse(JSON.stringify(src)) : { title: '', kind: 'ritual', days: [], time: '23:00', remind: [-30, 0, 15], hard: false, steps: [] } };
  renderDrawer();
  document.getElementById('d-title').focus();
}
function closeDrawer() { ui.drawer = null; renderDrawer(); }

$drawer.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-d]');
  if (!t || !ui.drawer) return;
  readDrawerInputs();
  const d = ui.drawer.draft;
  const v = t.dataset.v;
  switch (t.dataset.d) {
    case 'close': return closeDrawer();
    case 'kind': d.kind = v; break;
    case 'area': d.area = v; break;
    case 'est': d.estimateMin = d.estimateMin === +v ? null : +v; break;
    case 'hkind': d.kind = v; break;
    case 'day': {
      const all = d.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : [...d.days];
      d.days = all.includes(+v) ? all.filter((x) => x !== +v) : [...all, +v];
      if (d.days.length === 7) d.days = [];
      if (d.days.length === 0 && all.length === 1) d.days = all; // never zero days
      break;
    }
    case 'daysAll': d.days = []; break;
    case 'daysWork': d.days = [1, 2, 3, 4, 5]; break;
    case 'noTime': d.time = null; d.hard = false; break;
    case 'rem': d.remind = d.remind.includes(+v) ? d.remind.filter((x) => x !== +v) : [...d.remind, +v]; break;
    case 'hard': d.hard = !d.hard; break;
    case 'addItem': {
      const key = t.dataset.list;
      d[key].push({ text: '' }); renderDrawer();
      const ins = $drawer.querySelectorAll(`input[data-list="${key}"]`); ins[ins.length - 1].focus(); return;
    }
    case 'rmItem': d[t.dataset.list].splice(+t.dataset.i, 1); break;
    case 'sval': d[t.dataset.k] = v; break;
    case 'remindToggle': d.remind = d.remind === false; break;
    case 'chapterDone': d.chapterDone = !d.chapterDone; break;
    case 'chapterSave': {
      const r = await run('chapterSave', d.sagaId, d.id, { title: d.title, goal: d.goal, criterion: d.criterion, steps: d.steps });
      if (r.ok) closeDrawer();
      return;
    }
    case 'sessionStart': {
      closeDrawer();
      await run('sagaStartSession', d.sagaId, { stepId: d.stepId || 'none', min: d.min, typeId: d.typeId || null });
      return;
    }
    case 'logSave': {
      if (!(+d.min > 0)) { toast('Укажи, сколько минут длилось занятие', 'err'); return; }
      const r = await run('sagaLogSession', d.sagaId, { min: d.min, typeId: d.typeId || null, stepId: d.stepId && d.stepId !== 'none' ? d.stepId : null, note: d.note, opId: d.opId });
      if (r.ok) closeDrawer();
      return;
    }
    case 'wrapSave': {
      const stepId = d.stepId && d.stepId !== 'none' ? d.stepId : null;
      closeDrawer();
      await run('sagaSessionWrap', d.logId, { stepId, note: d.note || '' });
      if (d.chapterDone && d.chapterId) await run('sagaToggleChapter', d.sagaId, d.chapterId);
      return;
    }
    case 'wrapSkip': closeDrawer(); await qb.act('sagaSessionWrap', d.logId, {}); return;
    case 'delete': await run('questDelete', d.id); return closeDrawer();
    case 'archive': await run('habitArchive', d.id); return closeDrawer();
    case 'sagaArchive': await run('sagaArchive', d.id); return closeDrawer();
    case 'sset': d[t.dataset.k] = +v; break;
    case 'save':
    case 'saveToday': {
      let r;
      if (ui.drawer.type === 'quest') {
        r = d.id ? await run('questUpdate', d.id, d) : await run('questAdd', { ...d, today: t.dataset.d === 'saveToday' });
      } else if (ui.drawer.type === 'saga') {
        r = await run('sagaSave', { ...d, chapters: d.steps.map((x) => ({ id: x.id, title: x.text })), sessionTypes: d.types.map((x) => ({ id: x.id, name: x.text })) });
      } else r = await run('habitSave', d);
      if (r.ok) closeDrawer();
      return;
    }
    default: break;
  }
  renderDrawer();
});
$drawer.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Enter' && e.target.matches('input[data-list]')) { e.preventDefault(); $drawer.querySelector(`[data-d="addItem"][data-list="${e.target.dataset.list}"]`).click(); }
});

// =====================================================================
// Render + events
// =====================================================================
function render() {
  if (!P) return;
  applyTheme(P.view.settings);
  renderRail();
  const fn = { today: renderToday, briefing: renderBriefing, book: renderBook, sagas: renderSagas, rituals: renderRituals, chronicle: renderChronicle, settings: renderSettings }[ui.page] || renderToday;
  patch($content, fn());
}

function nav(page) {
  if (page === 'briefing') ui.pick = new Set();
  ui.page = page;
  ui.askNext = null;
  render();
  $content.scrollTop = 0;
  $content.focus({ preventScroll: true });
}

document.addEventListener('click', async (e) => {
  const n = e.target.closest('[data-nav]');
  if (n && !$drawer.contains(n)) { nav(n.dataset.nav); return; }
  const t = e.target.closest('[data-a]');
  if (!t || t.disabled) return;
  const id = t.dataset.id;
  const a = t.dataset.a;
  switch (a) {
    case 'capture': qb.ui('capture'); break;
    case 'newQuest': openQuestEditor(null); break;
    case 'editQuest': openQuestEditor(P.state.quests.find((q) => q.id === id)); break;
    case 'newHabit': openHabitEditor(null); break;
    case 'editHabit': openHabitEditor(id); break;
    case 'newSaga': openSagaEditor(null); break;
    case 'editSaga': openSagaEditor(id); break;
    case 'sagaExpand': ui.openSaga[id] = !ui.openSaga[id]; render(); break;
    case 'sagaHistory': ui.openHist[id] = !ui.openHist[id]; render(); break;
    case 'sagaToggleChapter': await run(a, id, t.dataset.sid); break;
    case 'chapterToggleStep': await run(a, id, t.dataset.ch, t.dataset.sid); break;
    case 'editChapter': openChapterEditor(id, t.dataset.sid); break;
    case 'sagaQuickStart': await run('sagaStartSession', id); break;
    case 'sagaLaunch': openLauncher(id, 'session'); break;
    case 'sagaLog': openLauncher(id, 'log'); break;
    case 'sagaPause': await run(a, id); break;
    case 'habitExpand': ui.openHabit[id] = !(ui.openHabit[id] ?? false); render(); break;
    case 'expand': ui.expanded[t.dataset.key] = !ui.expanded[t.dataset.key]; render(); break;
    case 'filter': ui.filter = t.dataset.key; render(); break;
    case 'pick': {
      if (ui.pick.has(id)) ui.pick.delete(id); else if (ui.pick.size < P.view.settings.todayLimit) ui.pick.add(id);
      render(); break;
    }
    case 'startDay':
    case 'finishBriefing': {
      const ids = [...ui.pick];
      for (const q of P.view.todayQuests) if (!ui.pick.has(q.id)) await qb.act('questToInbox', q.id);
      for (const qid of ids) await qb.act('questToToday', qid);
      await qb.act('briefingDone');
      if (a === 'startDay' && ids[0]) await run('questStart', ids[0]);
      else toast('План на день сохранён');
      nav('today');
      break;
    }
    case 'stepDone': {
      const r = await run('questStepDone', id);
      if (r.needNext) { ui.askNext = id; render(); setTimeout(() => document.getElementById('next-step-input')?.focus(), 0); }
      break;
    }
    case 'habitNextStep': {
      const h = P.view.todayHabits.find((x) => x.id === id);
      const st = h && h.steps.find((s) => !h.stepsDone.includes(s.id));
      if (st) await run('habitToggleStep', id, st.id); else await run('habitToggle', id, true);
      break;
    }
    case 'questToggleStep': case 'habitToggleStep': await run(a, id, t.dataset.sid); break;
    case 'questComplete': { ui.askNext = null; const r = await run(a, id); maybeWrap(r); break; }
    case 'setToggle':
      if (t.dataset.key === 'hudEnabled') qb.ui('hudToggle');
      else await run('settingsUpdate', { [t.dataset.key]: !P.view.settings[t.dataset.key] });
      break;
    case 'workDay': {
      const d = +t.dataset.key; const w = P.view.settings.workDays;
      await run('settingsUpdate', { workDays: w.includes(d) ? w.filter((x) => x !== d) : [...w, d] }); break;
    }
    case 'theme': await run('settingsUpdate', { theme: t.dataset.key }); break;
    case 'hudAnchor': await run('settingsUpdate', { hudAnchor: t.dataset.key }); break;
    case 'export': { const r = await qb.exportData(); if (r.toast) toast(r.toast); break; }
    case 'import': { const r = await qb.importData(); if (r.error) toast(r.error, 'err'); else if (r.toast) toast(r.toast); break; }
    case 'dataDir': qb.ui('openDataDir'); break;
    case 'updateCheck': qb.ui('updateCheck'); break;
    case 'updateInstall': qb.ui('updateInstall'); break;
    default:
      if (['questStart', 'questPause', 'questToToday', 'questToInbox', 'questReopen', 'habitToggle'].includes(a)) await run(a, ...(id ? [id] : []));
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'quickadd') {
    const inp = f.querySelector('input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = ''; // clear before the state broadcast re-renders the form
    const r = await run('questCapture', text);
    if (!r.ok) { const ni = document.getElementById(inp.id); if (ni) ni.value = text; }
    if (r.ok) {
      if (f.dataset.today && r.id && ui.pick.size < P.view.settings.todayLimit) { ui.pick.add(r.id); render(); }
    }
  }
  if (f.dataset.form === 'nextStep') {
    const v = f.querySelector('input').value.trim();
    if (!v) return;
    ui.askNext = null;
    await run('questUpdate', f.dataset.id, { nextStep: v });
    toast('Следующий шаг записан');
  }
});

// settings inputs save on change
document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-set]');
  if (!el) return;
  let val = el.value;
  if (el.dataset.type === 'num') { val = Math.max(+el.min, Math.min(+el.max, parseInt(val, 10) || +el.min)); el.value = val; }
  await run('settingsUpdate', { [el.dataset.set]: val });
});

document.addEventListener('keydown', (e) => {
  if (ui.drawer) return;
  if (e.target.matches('input, textarea')) return;
  const map = { 1: 'today', 2: 'book', 3: 'sagas', 4: 'rituals', 5: 'chronicle' };
  if (map[e.key]) nav(map[e.key]);
  if (e.key === 'n' || e.key === 'т') { e.preventDefault(); qb.ui('capture'); }
});

qb.onState((p) => { P = p; render(); });
qb.onNav((v) => { if (v) nav(v); });
qb.get().then((p) => { P = p; render(); });

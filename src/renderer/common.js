import { icon } from './icons.js';

export const qb = window.qb;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** 95 -> "1 ч 35 мин" */
export function fmtMin(min) {
  if (min == null) return '';
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

export function fmtUntil(min) {
  if (min == null) return '';
  if (min > 0) return `через ${fmtMin(min)}`;
  if (min === 0) return 'сейчас';
  return `опоздание ${fmtMin(min)}`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export function fmtDays(days) {
  if (!days || days.length === 0 || days.length === 7) return 'Каждый день';
  const set = [...days].sort();
  if (set.join() === '1,2,3,4,5') return 'Будни';
  if (set.join() === '0,6') return 'Выходные';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WD[d]).join(' ');
}

export function fmtOffset(o) {
  if (o === 0) return 'в срок';
  return o < 0 ? `за ${fmtMin(-o)}` : `+${fmtMin(o)}`;
}

export const THEMES = [
  { id: 'dark', name: 'Чернила', desc: 'Тёмная книга с золотом', sw: ['#17151F', '#0E0D14', '#E0B04A', '#ECE6D8'] },
  { id: 'scroll', name: 'Свиток странника', desc: 'Журнал заданий из MMO: пергамент в кожаной рамке', sw: ['#2A1C10', '#EAD7A8', '#8B2A10', '#E6B84A'] },
  { id: 'arcane', name: 'Арканум', desc: 'Ночной гримуар с голубым свечением', sw: ['#111933', '#0A0F1E', '#6FD3FF', '#C4A1FF'] },
  { id: 'light', name: 'Пергамент', desc: 'Светлая спокойная тема', sw: ['#EFE5CF', '#F1E9D8', '#8A5A00', '#2A2318'] },
];

export function applyTheme(settings) {
  const root = document.documentElement;
  root.dataset.theme = THEMES.some((t) => t.id === settings.theme) ? settings.theme : 'dark';
  root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full';
}

let toastHost;
export function toast(text, kind = 'win') {
  if (!text) return;
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const ic = kind === 'err' ? 'flag' : kind === 'level' ? 'crown' : 'sparkles';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(ic, 18)}<span>${esc(text)}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 200ms'; }, kind === 'err' ? 4500 : 2600);
  setTimeout(() => el.remove(), kind === 'err' ? 4800 : 2900);
}

/** Run an action and surface its result: visible win, matter-of-fact error. */
export async function run(name, ...args) {
  const r = await qb.act(name, ...args);
  if (r && r.error) toast(r.error, 'err');
  else if (r && r.levelUp) toast(`Уровень ${r.levelUp}!`, 'level');
  else if (r && r.toast) toast(r.toast, 'win');
  return r || {};
}

/** Re-render a container while keeping focus, caret and typed values of inputs that carry an id. */
export function patch(el, html) {
  const a = document.activeElement;
  const keep = {};
  el.querySelectorAll('input[id], textarea[id]').forEach((i) => { if (i.type !== 'checkbox') keep[i.id] = i.value; });
  const focusId = a && el.contains(a) ? a.id || null : null;
  const sel = focusId && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = el.scrollTop;
  el.innerHTML = html;
  for (const [id, v] of Object.entries(keep)) { const i = el.querySelector('#' + CSS.escape(id)); if (i && i.dataset.keep !== 'no') i.value = v; }
  if (focusId) {
    const f = el.querySelector('#' + CSS.escape(focusId));
    if (f) { f.focus(); if (sel && f.setSelectionRange) try { f.setSelectionRange(...sel); } catch (_) { /* noop */ } }
  }
  el.scrollTop = scroll;
}

export { icon };

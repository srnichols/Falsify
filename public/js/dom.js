/*
 * Tiny DOM helpers. Everything the server sends is inserted as text nodes, never as
 * HTML, so a hostile string in a session or a source cannot inject markup.
 */

/** Append children, flattening arrays and skipping empty values; strings become text nodes. */
export function append(parent, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    parent.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return parent;
}

/** Create an element. `on…` props are event listeners; `class`, `for` and `dataset` are special. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'for') el.htmlFor = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  return append(el, kids);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a node's content. */
export function mount(node, ...kids) {
  clear(node);
  return append(node, kids);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ago(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const BADGE_KIND = {
  supported: 'ok', provisional: 'info', tentative: 'warn',
  strong: 'ok', moderate: 'info', weak: 'warn',
  yes: 'ok', no: 'bad', theory: 'ok', refuted: 'bad',
  'held-up': 'ok', inconclusive: 'warn',
};

/** A status pill. The word is always shown, so colour is never the only signal. */
export function badge(text, kind) {
  const k = kind ?? BADGE_KIND[String(text).toLowerCase()];
  return h('span', { class: `badge${k ? ` badge-${k}` : ''}` }, text);
}

export function tierBadge(tier) {
  return h('span', { class: `badge badge-${tier}` }, tier);
}

export function shortId(id) {
  return String(id ?? '').slice(0, 8);
}

/** Turn "doi:10.x/y" occurrences in a string into links; everything else stays text. */
export function withDoiLinks(text) {
  const parts = [];
  let last = 0;
  for (const m of String(text).matchAll(/doi:\s*(10\.\d{4,9}\/[^\s,;)"']+)/gi)) {
    parts.push(text.slice(last, m.index));
    const doi = m[1].replace(/[.]+$/, '');
    parts.push(h('a', { href: `https://doi.org/${doi}`, target: '_blank', rel: 'noopener noreferrer' }, `doi:${doi}`));
    last = m.index + m[0].length - (m[1].length - doi.length);
  }
  parts.push(text.slice(last));
  return parts;
}

let toastHost;
export function toast(message, kind = 'info') {
  toastHost ??= document.getElementById('toasts');
  if (!toastHost) return;
  const node = h('div', { class: `toast ${kind}` }, message);
  toastHost.append(node);
  setTimeout(() => node.remove(), kind === 'bad' ? 8000 : 4500);
}

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** A labelled form control. `control` is built by the caller; the label is tied to it by id. */
let uid = 0;
export function field({ label, hint, control, id }) {
  const controlId = id ?? `f${++uid}`;
  control.id = controlId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  return h('div', { class: 'field' },
    h('label', { for: controlId }, label),
    control,
    hint ? h('span', { class: 'hint', id: hintId }, hint) : null);
}

export function checkbox({ label, hint, checked }) {
  const input = h('input', { type: 'checkbox' });
  input.checked = Boolean(checked);
  const wrap = h('label', { class: 'check' }, input, h('span', null, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null));
  return { wrap, input };
}

/** Parse a number input; empty becomes undefined. */
export function num(input) {
  const raw = input.value.trim();
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

export function lines(text) {
  return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

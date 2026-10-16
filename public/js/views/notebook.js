/* Notebook: an append-only log. Entries are never edited or deleted, only struck through with a reason. */

import { h, mount, badge, fmtDate, field, toast } from '../dom.js';
import { get, post } from '../api.js';
import { callout } from '../render.js';

const KINDS = ['note', 'observation', 'question', 'decision'];

export async function mountNotebook(root) {
  const res = await get('/api/notebook');
  if (!res.ok) { mount(root, h('h1', null, 'Notebook'), callout('bad', 'Could not load the notebook', res.json.error)); return; }
  const items = [...res.json.items].reverse();

  const kind = h('select', { 'aria-label': 'Kind' }, KINDS.map((k) => h('option', { value: k }, k)));
  const text = h('textarea', { rows: 3, placeholder: 'What did you notice, decide or wonder?', 'aria-label': 'Entry text' });
  const msg = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'stack' }, field({ label: 'Kind', control: kind }), field({ label: 'Entry', control: text }),
    h('div', null, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add entry')), msg);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!text.value.trim()) { mount(msg, callout('bad', 'Nothing to add', 'Write something first.')); return; }
    const r = await post('/api/notebook', { kind: kind.value, text: text.value.trim() });
    if (!r.ok) { mount(msg, callout('bad', 'Not saved', r.json.error)); return; }
    toast('Added to the notebook', 'ok');
    mountNotebook(root);
  });

  function entry(it) {
    const strike = h('form', { class: 'row hidden' },
      h('input', { type: 'text', placeholder: 'Why is this wrong or superseded?', 'aria-label': 'Reason for striking this entry' }),
      h('button', { type: 'submit', class: 'btn btn-small btn-danger' }, 'Strike'));
    strike.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const reason = strike.querySelector('input').value.trim();
      if (!reason) return;
      const r = await post('/api/notebook/strike', { id: it.id, reason });
      if (!r.ok) { toast(r.json.error ?? 'Could not strike', 'bad'); return; }
      mountNotebook(root);
    });
    const toggle = h('button', { type: 'button', class: 'btn btn-link btn-small', onclick: () => { strike.classList.toggle('hidden'); strike.querySelector('input').focus(); } }, 'Strike through…');
    return h('li', { class: 'card-item' },
      h('header', null, h('span', null, badge(it.kind, 'info')), h('span', { class: 'muted small' }, fmtDate(it.createdAt))),
      h('p', { class: it.struck ? 'struck' : null }, it.text),
      it.struck ? h('p', { class: 'small muted' }, `Struck ${fmtDate(it.struck.struckAt)}: ${it.struck.reason}`) : [toggle, strike]);
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Notebook'), h('p', null, 'An honest record: nothing is deleted. A wrong entry is struck through with a reason, so the history stays readable.'))),
    h('div', { class: 'split split-even' },
      h('section', { class: 'panel' }, h('h2', null, 'Add an entry'), form),
      h('section', { class: 'panel' }, h('h2', null, `Entries (${items.length})`),
        items.length === 0 ? h('div', { class: 'empty' }, 'The notebook is empty.') : h('ul', { class: 'item-list' }, items.map(entry)))));
}

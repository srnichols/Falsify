/* Outcomes: what later happened to confirmed theories, so the score can be checked against reality. */

import { h, mount, badge, fmtDate, shortId, withDoiLinks, field, toast } from '../dom.js';
import { get, post } from '../api.js';
import { state } from '../state.js';
import { callout } from '../render.js';

const KINDS = [
  ['held-up', 'Held up: later evidence agreed'],
  ['refuted', 'Refuted: later evidence contradicted it'],
  ['inconclusive', 'Inconclusive: still unsettled'],
];

function report(r) {
  const pct = r.pairwiseAccuracy === undefined ? null : `${Math.round(r.pairwiseAccuracy * 100)}%`;
  return h('section', { class: 'panel' }, h('h2', null, 'Does the score track reality?'),
    h('div', { class: 'grid grid-4' },
      h('div', { class: 'stat' }, h('div', { class: 'num' }, String(r.total)), h('div', { class: 'label' }, 'Outcomes')),
      h('div', { class: 'stat' }, h('div', { class: 'num' }, String(r.heldUp)), h('div', { class: 'label' }, 'Held up')),
      h('div', { class: 'stat' }, h('div', { class: 'num' }, String(r.refuted)), h('div', { class: 'label' }, 'Refuted')),
      h('div', { class: 'stat' }, h('div', { class: 'num' }, pct ?? 'n/a'), h('div', { class: 'label' }, 'Ranking accuracy'))),
    callout(r.sufficient ? 'ok' : 'info', r.sufficient ? 'Enough data to read' : 'Not enough data yet', r.message));
}

export async function mountOutcomes(root) {
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Outcomes'), h('p', null, 'Record what happened to a confirmed theory. This is the only thing that can tell you whether the score weights are any good.'))), h('p', { class: 'muted' }, 'Loading…'));
  const [out, sess] = await Promise.all([get('/api/outcomes'), get('/api/sessions')]);
  if (!out.ok || !out.json.available) {
    mount(root, h('h1', null, 'Outcomes'), callout('warn', 'Outcome tracking unavailable', out.json.message ?? out.json.error ?? 'Not configured on this server.'));
    return;
  }
  const theories = (sess.ok ? sess.json.sessions : []).filter((s) => s.state === 'theory');
  const recorded = new Set(out.json.records.map((r) => r.sessionId));

  const pick = h('select', { id: 'out-session', 'aria-label': 'Confirmed theory' },
    h('option', { value: '' }, theories.length ? 'Choose a confirmed theory…' : 'No confirmed theories yet'),
    ...theories.map((s) => h('option', { value: s.id, selected: s.id === state.outcomeFor }, `${s.question.slice(0, 70)}${recorded.has(s.id) ? ' (has outcome)' : ''}`)));
  state.outcomeFor = null;
  const kind = h('select', { 'aria-label': 'Outcome' }, KINDS.map(([v, l]) => h('option', { value: v }, l)));
  const basis = h('textarea', { rows: 3, placeholder: 'What happened and how you know (at least 5 words)', 'aria-label': 'Basis' });
  const ref = h('input', { type: 'text', placeholder: 'DOI or URL (optional)', 'aria-label': 'Reference' });
  const msg = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'stack' },
    field({ label: 'Theory', control: pick }), field({ label: 'Outcome', control: kind }),
    field({ label: 'Basis', hint: 'The replication, measurement or event that settled it, and where it is documented.', control: basis }),
    field({ label: 'Reference', control: ref }),
    h('div', null, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Record outcome')), msg);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!pick.value) { mount(msg, callout('bad', 'Choose a theory', 'Only a confirmed theory can be given an outcome.')); return; }
    const res = await post('/api/outcome', { sessionId: pick.value, outcome: kind.value, basis: basis.value, ...(ref.value.trim() ? { reference: ref.value.trim() } : {}) });
    if (!res.ok) { mount(msg, callout('bad', res.json.error ?? 'Not recorded', res.json.guidance)); return; }
    toast('Outcome recorded', 'ok');
    mountOutcomes(root);
  });

  const rows = [...out.json.records].reverse();
  const history = rows.length === 0 ? h('div', { class: 'empty' }, 'No outcomes recorded yet.')
    : h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ['Theory', 'Outcome', 'Basis', 'Recorded'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((r) => h('tr', null,
        h('td', null, h('a', { href: `#/sessions/${r.sessionId}` }, r.snapshot.statement.length > 70 ? `${r.snapshot.statement.slice(0, 67)}…` : r.snapshot.statement), h('div', { class: 'small muted mono' }, shortId(r.sessionId))),
        h('td', null, badge(r.outcome)),
        h('td', { class: 'small' }, r.basis, r.reference ? h('div', null, withDoiLinks(r.reference)) : null),
        h('td', { class: 'muted small' }, fmtDate(r.recordedAt)))))));

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Outcomes'), h('p', null, 'Record what happened to a confirmed theory. This is the only thing that can tell you whether the score weights are any good.'))),
    report(out.json.report),
    h('div', { class: 'split split-even' }, h('section', { class: 'panel' }, h('h2', null, 'Record an outcome'), form), h('section', { class: 'panel' }, h('h2', null, 'History'), history)));
}

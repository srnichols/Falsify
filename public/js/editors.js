/* Reusable form editors for the inquiry screens. */

import { h, field, checkbox, num, debounce, badge, tierBadge, toast, clear } from './dom.js';
import { get, post, query } from './api.js';
import { state } from './state.js';

/** A list of single-line inputs the user can add to and remove from. */
export function listEditor({ label, hint, placeholder, minRows = 1, initial = [] }) {
  const rows = h('div', { class: 'list-editor' });
  const addRow = (value = '') => {
    const input = h('input', { type: 'text', placeholder, 'aria-label': label });
    input.value = value;
    const li = h('div', { class: 'li' }, input);
    li.append(h('button', {
      type: 'button', class: 'btn btn-small', 'aria-label': `Remove this ${label.toLowerCase()}`,
      onclick: () => { if (rows.children.length > minRows) li.remove(); else input.value = ''; },
    }, 'Remove'));
    rows.append(li);
    return input;
  };
  (initial.length ? initial : Array.from({ length: minRows }, () => '')).forEach(addRow);
  const el = h('div', { class: 'field', role: 'group', 'aria-label': label },
    h('span', { class: 'label' }, label),
    hint ? h('span', { class: 'hint' }, hint) : null,
    rows,
    h('div', null, h('button', { type: 'button', class: 'btn btn-small', onclick: () => addRow().focus() }, '+ Add another')));
  return { el, values: () => [...rows.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean) };
}

/** A "Verify" button + result chip for a DOI input. Verification is recorded in the open session. */
function verifyControl(doiInput, observationInput) {
  const status = h('div', { class: 'small', 'aria-live': 'polite' });
  const button = h('button', { type: 'button', class: 'btn btn-small' }, 'Verify with Crossref');
  button.addEventListener('click', async () => {
    const doi = doiInput.value.trim();
    if (!doi) { toast('Enter a DOI first.', 'bad'); return; }
    if (!state.session) { toast('Start an inquiry first: a verification is recorded in its session.', 'bad'); return; }
    button.disabled = true;
    clear(status).append('Checking…');
    const res = await post('/api/verify-source', { doi, sessionId: state.session.id, observation: observationInput?.value.trim() || undefined });
    button.disabled = false;
    clear(status);
    const j = res.json;
    if (!res.ok) { status.append(badge('error', 'bad'), ` ${j.error ?? ''}`); return; }
    if (j.verified) {
      status.append(badge('verified', 'ok'), ` ${j.title ?? ''}`, j.year ? ` (${j.year})` : '');
      if (j.warning) status.append(h('div', { class: 'hint' }, j.warning));
      if (j.supportAdvice) status.append(h('div', { class: 'hint' }, `Advisory reading of the abstract: ${j.supportAdvice.supports ?? ''} ${j.supportAdvice.reason ?? ''}`));
      status.append(h('div', { class: 'hint' }, 'This confirms the paper exists, not that it says what you cite it for.'));
    } else {
      status.append(badge('not verified', 'bad'), ` ${j.reason ?? ''} ${j.note ?? ''}`);
    }
  });
  return h('div', { class: 'row' }, button, status);
}

/** Structured evidence items: what the claim score and the multiplicity checks are built from. */
export function evidenceEditor() {
  const host = h('div');
  const items = [];

  const addItem = () => {
    const observation = h('textarea', { rows: 2, placeholder: 'What was observed or measured: the observation itself, not a label for it.' });
    const kind = h('select', null, ...['experiment', 'statistical', 'observation', 'anecdote'].map((k) => h('option', { value: k }, k)));
    const source = h('input', { type: 'text', placeholder: 'Citation, dataset or protocol' });
    const doi = h('input', { type: 'text', placeholder: '10.xxxx/…' });
    const sampleSize = h('input', { type: 'number', min: 1, step: 1 });
    const effectSize = h('input', { type: 'number', step: 'any' });
    const effectMetric = h('select', null, h('option', { value: '' }, 'auto'), h('option', { value: 'r' }, 'r (correlation)'), h('option', { value: 'd' }, 'd (Cohen)'));
    const pValue = h('input', { type: 'number', min: 0, max: 1, step: 'any' });
    const outcomesTested = h('input', { type: 'number', min: 1, step: 1 });
    const replicated = checkbox({ label: 'An independent group replicated this result' });
    const repDoi = h('input', { type: 'text', placeholder: 'DOI of the replication (a different paper)' });
    const repBox = h('div', { class: 'hidden' },
      field({ label: 'Replication DOI', hint: 'Without a verified, different, on-topic replication paper this earns no replication credit.', control: repDoi }),
      verifyControl(repDoi, observation));
    replicated.input.addEventListener('change', () => repBox.classList.toggle('hidden', !replicated.input.checked));

    const card = h('div', { class: 'card-item' });
    const title = h('strong', null, `Evidence item ${items.length + 1}`);
    card.append(
      h('header', null, title, h('button', {
        type: 'button', class: 'btn btn-small btn-danger',
        onclick: () => { const i = items.findIndex((x) => x.card === card); if (items.length > 1) { items.splice(i, 1); card.remove(); } else { observation.value = ''; } },
      }, 'Remove')),
      field({ label: 'Observation', control: observation }),
      h('div', { class: 'inline-fields' }, field({ label: 'Kind', control: kind }), field({ label: 'Source', control: source })),
      field({ label: 'DOI', hint: 'Optional. Verify it so the source earns credit.', control: doi }),
      verifyControl(doi, observation),
      h('div', { class: 'inline-fields' },
        field({ label: 'Sample size', control: sampleSize }),
        field({ label: 'Effect size', control: effectSize }),
        field({ label: 'Effect metric', control: effectMetric }),
        field({ label: 'p-value', control: pValue }),
        field({ label: 'Outcomes tested', hint: 'Required with a p-value: how many outcomes or comparisons were examined.', control: outcomesTested })),
      replicated.wrap, repBox);

    items.push({
      card,
      value() {
        const o = { observation: observation.value.trim(), kind: kind.value };
        if (!o.observation) return undefined;
        if (source.value.trim()) o.source = source.value.trim();
        if (doi.value.trim()) o.doi = doi.value.trim();
        const set = (key, input) => { const v = num(input); if (v !== undefined) o[key] = v; };
        set('sampleSize', sampleSize); set('effectSize', effectSize); set('pValue', pValue); set('outcomesTested', outcomesTested);
        if (effectMetric.value) o.effectMetric = effectMetric.value;
        if (replicated.input.checked) { o.replicated = true; if (repDoi.value.trim()) o.replicationDoi = repDoi.value.trim(); }
        return o;
      },
    });
    host.append(card);
  };

  addItem();
  const el = h('div', { class: 'field', role: 'group', 'aria-label': 'Evidence' },
    h('span', { class: 'label' }, 'Evidence'),
    h('span', { class: 'hint' }, 'Give statistics only if the source reports them. Never estimate a p-value or an outcome count.'),
    host,
    h('div', null, h('button', { type: 'button', class: 'btn btn-small', onclick: addItem }, '+ Add evidence item')));
  return { el, values: () => items.map((i) => i.value()).filter(Boolean) };
}

/** Link the claim to Bedrock or Established entries it supports or conflicts with. */
export function refPicker() {
  const chosen = new Map();
  const chips = h('div', { class: 'chips', 'aria-label': 'Chosen references' });
  const suggestions = h('ul', { class: 'item-list' });
  const input = h('input', { type: 'search', placeholder: 'Search Bedrock and Established entries…', 'aria-label': 'Search knowledge entries' });

  const drawChips = () => {
    clear(chips);
    for (const [id, relation] of chosen) {
      chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', title: 'Remove', onclick: () => { chosen.delete(id); drawChips(); } }, `${relation}: ${id.split('.').slice(1).join('.')} ✕`));
    }
  };
  const row = (entry) => h('li', null, h('div', { class: 'row' },
    tierBadge(entry.tier), h('span', { class: 'title small' }, entry.title.length > 110 ? `${entry.title.slice(0, 107)}…` : entry.title),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => { chosen.set(entry.id, 'supports'); drawChips(); } }, 'Supports'),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => { chosen.set(entry.id, 'conflicts'); drawChips(); } }, 'Conflicts')));
  const drawList = (entries) => { clear(suggestions); entries.forEach((e) => suggestions.append(row(e))); };

  drawList(state.matches.filter((m) => m.tier === 'bedrock' || m.tier === 'established').map((m) => ({ id: m.id, tier: m.tier, title: m.title })));
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { drawList([]); return; }
    const [b, e] = await Promise.all([get(`/api/knowledge${query({ q, tier: 'bedrock', limit: 5 })}`), get(`/api/knowledge${query({ q, tier: 'established', limit: 5 })}`)]);
    drawList([...(b.json.items ?? []), ...(e.json.items ?? [])]);
  });
  input.addEventListener('input', search);

  const el = h('div', { class: 'field', role: 'group', 'aria-label': 'Knowledge references' },
    h('span', { class: 'label' }, 'Knowledge references (optional)'),
    h('span', { class: 'hint' }, 'A yes that conflicts with Bedrock or Established knowledge needs a sourced experiment or statistical result. Suggestions come from your hypothesis.'),
    input, suggestions, chips);
  return { el, values: () => [...chosen].map(([id, relation]) => ({ id, relation })) };
}

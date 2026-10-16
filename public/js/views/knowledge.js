/* Knowledge: browse the corpus the engine matches claims against. */

import { h, mount, clear, badge, tierBadge, withDoiLinks, debounce } from '../dom.js';
import { get, query } from '../api.js';
import { callout, kv, list } from '../render.js';

const TIERS = ['bedrock', 'established', 'contested', 'quantitative', 'refuted'];
const PAGE = 40;

function falsifiableLabel(flag) {
  if (flag === true) return 'falsifiable';
  if (flag === false) return 'not falsifiable';
  return flag ? String(flag) : null;
}

function positionClass(p) {
  const s = `${p.falsifiability_status ?? ''}`.toLowerCase();
  if (p.falsifiable === true || s.startsWith('scientific')) return 'position sci';
  if (s.includes('outside') || p.falsifiable === false) return 'position out';
  return 'position cond';
}

function sources(items) {
  return items?.length ? h('ul', { class: 'plain' }, items.map((s) => h('li', { class: 'small' }, withDoiLinks(s)))) : null;
}

function entryDetail(tier, e) {
  const head = h('div', { class: 'row' }, tierBadge(tier), h('span', { class: 'muted small mono' }, e.id), e.domain ? h('span', { class: 'muted small' }, e.domain) : null);
  const kw = e.keywords?.length ? h('div', { class: 'chips' }, e.keywords.map((k) => h('span', { class: 'badge' }, k))) : null;

  if (tier === 'contested') {
    return h('div', { class: 'stack' }, head, h('h2', null, e.question), e.note ? h('p', { class: 'muted' }, e.note) : null,
      e.positions.map((p) => h('div', { class: positionClass(p) },
        h('strong', null, p.label), h('p', null, p.claim),
        h('div', { class: 'row' }, badge(p.falsifiability_status, 'mute'), falsifiableLabel(p.falsifiable) ? badge(falsifiableLabel(p.falsifiable), 'info') : null),
        p.falsified_if ? h('p', { class: 'small' }, h('strong', null, 'Would be proven wrong if: '), p.falsified_if) : null,
        p.note ? h('p', { class: 'small muted' }, p.note) : null,
        sources(p.evidence_pointers))),
      callout('info', 'How the engine uses this', e.engine_directive), kw);
  }
  if (tier === 'refuted') {
    return h('div', { class: 'stack' }, head, h('h2', { class: 'struck' }, e.claim),
      kv([['Era', e.era], ['Falsified by', e.falsified_by], ['Superseded by', e.superseded_by], ['Lesson', e.lesson]]), sources(e.sources), kw);
  }
  if (tier === 'quantitative') {
    return h('div', { class: 'stack' }, h('div', { class: 'row' }, tierBadge(tier), h('span', { class: 'muted small mono' }, e.id)),
      h('h2', null, e.principle), h('p', null, e.statement),
      kv([['Formula', e.formula], ['Guards against', e.failure_guarded]]), h('h3', null, 'Triggers'), list(e.triggers));
  }
  return h('div', { class: 'stack' }, head, h('h2', null, e.statement),
    kv([['Type', e.type], ['Status', e.status], ['Confidence', e.confidence], ['Falsifiable', falsifiableLabel(e.falsifiable)], ['Valid within', e.domain_of_validity]]),
    e.falsified_if ? callout('info', 'Would be proven wrong if', e.falsified_if) : null,
    e.confirmations?.length ? h('section', null, h('h3', null, 'Confirmations'), list(e.confirmations)) : null, sources(e.sources), kw);
}

export async function mountKnowledge(root) {
  const params = { q: '', tier: '', field: '', offset: 0 };
  const search = h('input', { type: 'search', placeholder: 'Search the corpus…', 'aria-label': 'Search the knowledge corpus' });
  const fieldSel = h('select', { 'aria-label': 'Filter by field' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by tier' });
  const listEl = h('ul', { class: 'item-list' });
  const pager = h('div', { class: 'row' });
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const detail = h('section', { class: 'panel', 'aria-label': 'Entry detail' }, h('div', { class: 'empty' }, 'Select an entry to read it.'));
  let current;

  async function open(id) {
    current = id;
    for (const b of listEl.querySelectorAll('button.item')) b.setAttribute('aria-current', String(b.dataset.id === id));
    const r = await get(`/api/knowledge/entry${query({ id })}`);
    mount(detail, r.ok ? entryDetail(r.json.tier, r.json.entry) : callout('bad', 'Could not load that entry', r.json.error));
  }

  async function load() {
    const r = await get(`/api/knowledge${query({ q: params.q, tier: params.tier, field: params.field, limit: PAGE, offset: params.offset })}`);
    if (!r.ok) { mount(listEl, h('li', null, callout('bad', 'Could not load the corpus', r.json.error))); return; }
    const { items, total, facets } = r.json;

    clear(chips);
    chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(params.tier === ''), onclick: () => { params.tier = ''; params.offset = 0; load(); } }, 'All'));
    for (const t of TIERS) {
      chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(params.tier === t), onclick: () => { params.tier = t; params.offset = 0; load(); } }, `${t} ${facets.tiers[t] ?? 0}`));
    }
    const fields = Object.entries(facets.fields).sort((a, b) => a[0].localeCompare(b[0]));
    clear(fieldSel);
    fieldSel.append(h('option', { value: '' }, 'All fields'), ...fields.map(([f, n]) => h('option', { value: f, selected: f === params.field }, `${f} (${n})`)));

    count.textContent = total === 0 ? 'No entries match.' : `Showing ${params.offset + 1}–${Math.min(total, params.offset + items.length)} of ${total}`;
    clear(listEl);
    if (items.length === 0) listEl.append(h('li', { class: 'empty' }, 'Nothing matches. Try fewer words or clear a filter.'));
    for (const it of items) {
      listEl.append(h('li', null, h('button', { type: 'button', class: 'item', 'data-id': it.id, 'aria-current': String(it.id === current), onclick: () => open(it.id) },
        h('div', { class: 'row' }, tierBadge(it.tier), h('span', { class: 'muted small' }, it.field)),
        h('div', { class: 'title' }, it.title.length > 140 ? `${it.title.slice(0, 137)}…` : it.title))));
    }
    clear(pager);
    if (params.offset > 0) pager.append(h('button', { type: 'button', class: 'btn btn-small', onclick: () => { params.offset = Math.max(0, params.offset - PAGE); load(); } }, 'Previous'));
    if (params.offset + items.length < total) pager.append(h('button', { type: 'button', class: 'btn btn-small', onclick: () => { params.offset += PAGE; load(); } }, 'Next'));
  }

  search.addEventListener('input', debounce(() => { params.q = search.value.trim(); params.offset = 0; load(); }));
  fieldSel.addEventListener('change', () => { params.field = fieldSel.value; params.offset = 0; load(); });

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Knowledge'),
      h('p', null, 'What the engine matches a claim against. Established theory is weighted, never exempt: every entry states what would falsify it.'))),
    h('div', { class: 'split split-even' },
      h('section', { class: 'panel' }, h('div', { class: 'row' }, search, fieldSel), chips, count, listEl, pager), detail));
  await load();
}

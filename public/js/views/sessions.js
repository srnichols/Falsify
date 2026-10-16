/* Sessions: every inquiry, with the full record behind each result. */

import { h, mount, clear, badge, shortId, fmtDate, ago, withDoiLinks, field } from '../dom.js';
import { get, post } from '../api.js';
import { state, loadSession } from '../state.js';
import { callout, kv, list, scoreView, mirrorView } from '../render.js';

const STATES = ['intake', 'hypothesis', 'experiment', 'analysis', 'review', 'theory'];

function evidenceTable(items) {
  if (!items?.length) return h('p', { class: 'muted small' }, 'No evidence recorded.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', null, h('tr', null, ['Observation', 'Kind', 'Source', 'Statistics', 'Checks'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', null, items.map((e) => h('tr', null,
      h('td', null, e.observation),
      h('td', null, badge(e.kind, 'mute')),
      h('td', null, e.source ?? '', e.doi ? h('div', { class: 'small' }, withDoiLinks(`doi:${e.doi}`)) : null),
      h('td', { class: 'small' }, [e.pValue !== undefined ? `p=${e.pValue}` : '', e.outcomesTested ? `, ${e.outcomesTested} outcomes` : '', e.sampleSize ? `, n=${e.sampleSize}` : '', e.effectSize !== undefined ? `, effect ${e.effectSize}` : ''].join('').replace(/^, /, '') || '—'),
      h('td', { class: 'small' },
        e.sourceVerified ? badge('source verified', 'ok') : e.doi ? badge('unverified', 'warn') : null,
        e.sourceTopicMismatch ? badge('off-topic', 'bad') : null,
        e.replicated ? badge('replicated', 'ok') : null))))));
}

function detailView(session, mirror) {
  const a = session.analysis;
  const root = h('div', { class: 'stack' });
  root.append(
    h('div', null, h('h2', null, session.question),
      h('div', { class: 'row' }, badge(session.state, session.state === 'theory' ? 'ok' : 'mute'),
        a ? badge(a.verdict) : null, session.epistemicStatus ? badge(session.epistemicStatus) : null,
        h('span', { class: 'muted small mono' }, shortId(session.id)), h('span', { class: 'muted small' }, `updated ${ago(session.updatedAt)}`))),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => { state.session = session; state.mirror = mirror ?? null; state.last = null; location.hash = '#/inquiry'; } }, 'Open in Inquiry'),
      session.state === 'theory' ? h('button', { type: 'button', class: 'btn', onclick: () => { state.outcomeFor = session.id; location.hash = '#/outcomes'; } }, 'Record an outcome') : null));

  if (session.statusCap) root.append(callout('warn', 'Status held back', session.statusCap));

  if (session.hypothesis) {
    const hy = session.hypothesis;
    root.append(h('section', null, h('h3', null, 'Hypothesis'),
      kv([['Statement', hy.statement], ['Predicts', hy.predicts], ['Kind', hy.claimType], ['Locked', fmtDate(hy.lockedAt)], ['Revision', String(hy.revision)], ['Revision note', hy.revisionNote]]),
      h('h3', null, 'Would be proven wrong if'), list(hy.falsificationConditions.map((c) => c.description))));
  }
  if (session.refuted.length) {
    root.append(h('section', null, h('h3', null, `Earlier attempts (${session.refuted.length})`),
      session.refuted.map((r, i) => h('div', { class: 'callout' }, h('strong', null, `Revision ${i}: refuted`), h('p', { class: 'struck' }, r.statement)))));
  }
  if (session.experiment) root.append(h('section', null, h('h3', null, 'Decisive test'), list(session.experiment.decisiveEvidence)));
  if (a) {
    root.append(h('section', null, h('h3', null, 'Analysis'), evidenceTable(a.evidence),
      a.score ? scoreView({ ...a.score, signals: undefined }) : null,
      a.evidenceSearch ? kv([['Search', a.evidenceSearch.description], ['Contrary results', String(a.evidenceSearch.contraryFound)], ['How handled', a.evidenceSearch.contraryNote]]) : null));
  }
  if (mirror?.linked) {
    root.append(mirrorView({ linked: true, completed: mirror.completed, oppositeFraming: mirror.partner, bothFramingsYes: mirror.bothYes, asymmetries: mirror.asymmetries }),
      h('button', { type: 'button', class: 'btn', onclick: () => { location.hash = `#/sessions/${session.mirrorOf}`; } }, 'Open the opposite framing'));
  }
  root.append(h('section', null, h('h3', null, 'Timeline'),
    h('ol', { class: 'timeline' }, session.history.map((e) => h('li', null, h('strong', null, e.event), ` → ${e.to}`, h('div', { class: 'muted small' }, `${fmtDate(e.at)} · ${e.summary}`))))));
  return root;
}

export async function mountSessions(root, selectedId) {
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Sessions'), h('p', null, 'Every inquiry and the full record behind each result.'))), h('p', { class: 'muted' }, 'Loading…'));
  const res = await get('/api/sessions');
  if (!res.ok) { mount(root, h('h1', null, 'Sessions'), callout('bad', 'Could not load sessions', res.json.error)); return; }
  const all = res.json.sessions;

  const search = h('input', { type: 'search', placeholder: 'Filter by question…', 'aria-label': 'Filter sessions by question' });
  const stateSel = h('select', { 'aria-label': 'Filter by step' }, h('option', { value: '' }, 'All steps'), ...STATES.map((s) => h('option', { value: s }, s)));
  const tbody = h('tbody');
  const detail = h('section', { class: 'panel', 'aria-label': 'Session detail' }, h('div', { class: 'empty' }, 'Select an inquiry to see its record.'));
  let selected = selectedId;

  async function show(id) {
    selected = id;
    drawList();
    const r = await post('/api/session', { sessionId: id });
    mount(detail, r.ok ? detailView(r.json.session, r.json.mirror) : callout('bad', 'Could not load that session', r.json.error));
    detail.scrollIntoView?.({ block: 'nearest' });
  }

  function drawList() {
    const q = search.value.trim().toLowerCase();
    const rows = all.filter((s) => (!q || s.question.toLowerCase().includes(q)) && (!stateSel.value || s.state === stateSel.value));
    clear(tbody);
    if (rows.length === 0) tbody.append(h('tr', null, h('td', { colspan: 4, class: 'empty' }, all.length ? 'No inquiries match the filter.' : 'No inquiries yet.')));
    for (const s of rows) {
      const tr = h('tr', { class: `clickable${s.id === selected ? ' selected' : ''}`, tabindex: 0, role: 'link', 'aria-label': `Open ${s.question}`,
        onclick: () => show(s.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(s.id); } } },
        h('td', null, s.question.length > 64 ? `${s.question.slice(0, 61)}…` : s.question, s.mirrorOf ? h('div', { class: 'small muted' }, `mirror of ${shortId(s.mirrorOf)}`) : null),
        h('td', null, badge(s.state, s.state === 'theory' ? 'ok' : 'mute')),
        h('td', null, s.epistemicStatus ? badge(s.epistemicStatus) : s.verdict ? badge(s.verdict) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'muted small' }, ago(s.updatedAt)));
      tbody.append(tr);
    }
  }
  search.addEventListener('input', drawList);
  stateSel.addEventListener('change', drawList);

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Sessions'), h('p', null, `${all.length} inquir${all.length === 1 ? 'y' : 'ies'}. Select one for the full record.`)),
      h('a', { class: 'btn btn-primary', href: '#/inquiry' }, 'Start an inquiry')),
    h('div', { class: 'split split-even' },
      h('section', { class: 'panel' }, h('div', { class: 'row' }, search, stateSel),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, ['Question', 'Step', 'Result', 'Updated'].map((t) => h('th', { scope: 'col' }, t)))), tbody))),
      detail));
  drawList();
  if (selected) await show(selected);
}

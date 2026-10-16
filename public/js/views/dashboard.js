/* Dashboard: where the inquiries, the corpus and the evidence stand, at a glance. */

import { h, mount, badge, tierBadge, ago, shortId } from '../dom.js';
import { get } from '../api.js';
import { callout } from '../render.js';

const TIER_ORDER = ['bedrock', 'established', 'contested', 'quantitative', 'refuted'];

function stat(label, num, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'num' }, String(num)), h('div', { class: 'label' }, label), sub ? h('div', { class: 'sub' }, sub) : null);
}

function bars(entries, max) {
  const top = max ?? Math.max(1, ...entries.map(([, n]) => n));
  return entries.map(([name, n]) => {
    const fill = h('span');
    fill.style.setProperty('--pct', String(Math.round((n / top) * 100)));
    return h('div', { class: 'bar-row' }, h('span', { class: 'name', title: name }, name), h('div', { class: 'bar', role: 'presentation' }, fill), h('span', { class: 'n' }, String(n)));
  });
}

export async function mountDashboard(root) {
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where your inquiries, the knowledge corpus and the evidence stand.'))), h('p', { class: 'muted' }, 'Loading…'));
  const [status, sessionsRes, outcomes] = await Promise.all([get('/api/status'), get('/api/sessions'), get('/api/outcomes')]);
  if (!status.ok) {
    mount(root, h('h1', null, 'Dashboard'), callout('bad', 'Could not load the dashboard', status.json.error));
    return;
  }
  const st = status.json;
  const sessions = sessionsRes.ok ? sessionsRes.json.sessions : [];
  const confirmed = sessions.filter((s) => s.state === 'theory');
  const open = sessions.filter((s) => s.state !== 'theory');
  const refuted = sessions.filter((s) => s.revisions > 0 || s.verdict === 'no');
  const byStatus = (name) => confirmed.filter((s) => s.epistemicStatus === name).length;
  const outcomeCount = outcomes.json.available ? outcomes.json.records.length : 0;

  const recent = sessions.slice(0, 6);
  const recentTable = recent.length === 0
    ? h('div', { class: 'empty' }, 'No inquiries yet. ', h('a', { href: '#/inquiry' }, 'Start one.'))
    : h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('caption', { class: 'muted small' }, 'Most recently updated'),
      h('thead', null, h('tr', null, ['Question', 'Step', 'Result', 'Updated'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, recent.map((s) => h('tr', null,
        h('td', null, h('a', { href: `#/sessions/${s.id}` }, s.question.length > 70 ? `${s.question.slice(0, 67)}…` : s.question)),
        h('td', null, badge(s.state, s.state === 'theory' ? 'ok' : 'mute')),
        h('td', null, s.epistemicStatus ? badge(s.epistemicStatus) : s.verdict ? badge(s.verdict) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'muted small' }, ago(s.updatedAt)))))));

  const tierEntries = TIER_ORDER.filter((t) => st.corpus.byTier[t] !== undefined).map((t) => [t, st.corpus.byTier[t]]);
  const fieldEntries = Object.entries(st.corpus.byField).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const setting = (name, on, detail) => h('tr', null, h('th', { scope: 'row' }, name), h('td', null, badge(on ? 'on' : 'off', on ? 'ok' : 'mute')), h('td', { class: 'muted small' }, detail));
  const s = st.settings;

  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Dashboard'), h('p', null, 'Where your inquiries, the knowledge corpus and the evidence stand.')),
      h('a', { class: 'btn btn-primary', href: '#/inquiry' }, 'Start an inquiry')),
    h('div', { class: 'grid grid-4' },
      stat('Inquiries', sessions.length, `${open.length} in progress`),
      stat('Confirmed theories', confirmed.length, `${byStatus('supported')} supported · ${byStatus('provisional')} provisional · ${byStatus('tentative')} tentative`),
      stat('Refuted at least once', refuted.length, 'A refutation is a result, not a failure'),
      stat('Outcomes recorded', outcomeCount, outcomeCount ? 'See the Outcomes screen' : 'Record what happens later')),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, h('h2', null, 'Recent inquiries'), recentTable),
        h('section', { class: 'panel' }, h('h2', null, 'Read this first'),
          h('ul', { class: 'plain' },
            h('li', null, 'A completed cycle is a ', h('strong', null, 'process record, not proof'), '.'),
            h('li', null, 'Falsify cannot tell whether a paper supports a claim, or whether your numbers are true. Every input is supplied by the caller.'),
            h('li', null, 'The score weights are priors. Record outcomes later so the score can be checked against reality.'),
            h('li', null, 'Consensus is a low-weight signal and can never decide a verdict.')))),
      h('div', { class: 'stack' },
        h('section', { class: 'panel' }, h('h2', null, `Knowledge corpus (${st.corpus.total})`),
          h('div', null, tierEntries.map(([t, n]) => h('div', { class: 'row' }, tierBadge(t), h('span', { class: 'muted small' }, `${n} entries`)))),
          h('h3', null, 'Largest fields'), h('div', null, bars(fieldEntries)),
          h('p', null, h('a', { href: '#/knowledge' }, 'Browse the corpus'))),
        h('section', { class: 'panel' }, h('h2', null, 'Setup'),
          h('table', { class: 'data' }, h('tbody', null,
            setting('Session required', s.requireSession, 'Steps after intake without a sessionId are refused'),
            setting('OpenBrain', s.openBrain, 'Semantic recall and corpus writes'),
            setting('Judge model', s.judge.enabled, s.judge.enabled ? s.judge.model : 'Advisory second opinion, never changes a verdict'),
            setting('Embeddings', s.embeddings.enabled, 'Paraphrase-proof knowledge matching'),
            h('tr', null, h('th', { scope: 'row' }, 'Consensus weight'), h('td', null, badge(String(s.weights.consensus), 'info')), h('td', { class: 'muted small' }, 'The smallest weight, enforced'))))),
        h('p', { class: 'muted small' }, `Falsify ${st.version} · ${st.tools.length} MCP tools`))));
}

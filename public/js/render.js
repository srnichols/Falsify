/* Turn the server's structured results into readable screens. Raw JSON is always one click away. */

import { h, badge, tierBadge } from './dom.js';

const STATUS_TEXT = {
  supported: 'Replicated, with a verified replication source.',
  provisional: 'A sourced result that nobody has replicated yet.',
  tentative: 'Weak evidence, accepted explicitly.',
};

const NEXT_LABEL = {
  falsify_hypothesize: 'State a hypothesis',
  falsify_experiment: 'Design the decisive test',
  falsify_analyze: 'Analyse the evidence',
  falsify_review: 'Answer the three review questions',
};

export function callout(kind, title, body) {
  return h('div', { class: `callout callout-${kind}`, role: kind === 'bad' ? 'alert' : undefined },
    h('strong', null, title), body ? h('p', null, body) : null);
}

export function kv(pairs) {
  const rows = pairs.filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '');
  const dl = h('dl', { class: 'kv' });
  for (const [k, v] of rows) dl.append(h('dt', null, k), h('dd', null, v));
  return dl;
}

export function list(items) {
  return h('ul', { class: 'plain' }, items.map((i) => h('li', null, i)));
}

/** A generic, safe renderer for results whose shape is not special-cased (for example, dissent). */
export function generic(value, depth = 0) {
  if (value === null || value === undefined) return h('span', { class: 'muted' }, '—');
  if (Array.isArray(value)) {
    if (value.length === 0) return h('span', { class: 'muted' }, 'none');
    return h('ul', { class: 'plain' }, value.map((v) => h('li', null, generic(v, depth + 1))));
  }
  if (typeof value === 'object') {
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of Object.entries(value)) dl.append(h('dt', null, k), h('dd', null, generic(v, depth + 1)));
    return dl;
  }
  return String(value);
}

export function errorView(json) {
  const el = callout('bad', `Refused: ${json.rule ?? 'error'}`, json.error);
  if (json.guidance) el.append(h('p', null, h('strong', null, 'What to do: '), json.guidance));
  return el;
}

export function matchView(m) {
  const d = m.details ?? {};
  const body = [];
  if (d.falsified_if) body.push(h('p', null, h('strong', null, 'Would be overturned by: '), d.falsified_if));
  if (Array.isArray(d.rests_on)) body.push(h('p', null, h('strong', null, 'Rests on: '), d.rests_on.join('; ')));
  if (d.domain_of_validity) body.push(h('p', { class: 'small muted' }, h('strong', null, 'Domain of validity: '), d.domain_of_validity));
  if (d.falsified_by) body.push(h('p', null, h('strong', null, 'Falsified by: '), d.falsified_by));
  if (d.lesson) body.push(h('p', null, h('strong', null, 'Lesson: '), d.lesson));
  if (Array.isArray(d.positions)) {
    body.push(h('ul', { class: 'plain' }, d.positions.map((p) => h('li', null, `${p.label} `, badge(p.falsifiability_status, 'mute')))));
  }
  return h('div', { class: 'match' },
    h('header', null, tierBadge(m.tier), h('strong', null, m.title.length > 140 ? `${m.title.slice(0, 137)}…` : m.title),
      badge(`${Math.round(m.score * 100)}% match`, 'mute'),
      m.stance ? badge(`stance: ${m.stance}`, 'mute') : null,
      m.via ? badge(`via ${m.via}`, 'mute') : null),
    h('p', { class: 'small' }, m.directive),
    ...body,
    h('p', { class: 'small muted mono' }, m.id));
}

export function scoreView(score) {
  const signals = score.signals ?? {};
  const rows = [
    ['Direct evidence', signals.directEvidence],
    ['Statistical support', signals.statisticalSupport],
    ['Falsifiability quality', signals.falsifiabilityQuality],
    ['Bedrock support', signals.bedrockSupport],
    ['Established support', signals.establishedSupport],
    ['Consensus share', signals.institutionalConsensus],
  ];
  return h('div', null,
    h('div', { class: 'row' }, h('strong', null, 'Evidence strength'), badge(score.evidenceStrength),
      h('span', { class: 'muted small' }, `score ${score.score}, without consensus ${score.nonConsensusScore}, consensus added ${score.consensusContribution}`)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('caption', { class: 'muted small' }, 'Signals behind the score (0 to 1)'),
      h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v === undefined ? '—' : Number(v).toFixed(2))))))),
    score.conflictsWithKnowledge ? callout('warn', 'Conflicts with Bedrock or Established knowledge', 'A yes here needed a sourced experiment or statistical result.') : null);
}

function multiplicityView(m) {
  return h('div', null,
    h('h3', null, `Multiplicity (over ${m.attempts} hypothesis attempt${m.attempts === 1 ? '' : 's'})`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', null, h('tr', null, ['Observation', 'p', 'Outcomes tested', 'Adjusted p'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, m.adjustedPValues.map((r) => h('tr', null,
        h('td', null, r.observation), h('td', null, r.p), h('td', null, r.outcomesTested),
        h('td', null, badge(r.adjusted.toFixed(3), r.adjusted < 0.05 ? 'ok' : 'bad'))))))));
}

export function mirrorView(m) {
  if (!m) return null;
  if (!m.linked) return callout('info', 'No opposite framing is linked', m.note);
  const out = [h('h3', null, 'Opposite framing')];
  if (m.bothFramingsYes) out.push(callout('warn', 'Both framings reached "yes"', 'They cannot both be right as stated. Re-examine the evidence and the wording of each.'));
  if (!m.completed) out.push(callout('info', 'Not yet tested', 'The opposite framing has not reached analysis, so it was not given the same test.'));
  if (m.oppositeFraming) {
    const p = m.oppositeFraming;
    out.push(kv([['Question', p.question], ['Verdict', p.verdict ? badge(p.verdict) : 'none yet'], ['Evidence', p.evidenceStrength ? badge(p.evidenceStrength) : undefined],
      ['Falsifiers', p.falsifiers], ['Evidence items', p.evidenceItems], ['Verified sources', p.sourcesVerified], ['Contrary results', p.contraryFound]]));
  }
  if (m.asymmetries?.length) out.push(callout('warn', 'Uneven rigor between the two sides', null), list(m.asymmetries));
  return h('div', null, out);
}

function relatedView(json) {
  if (json.matches.length === 0) return callout('info', 'No match', json.message);
  return h('div', null, h('h3', null, `${json.count ?? json.matches.length} related entr${json.matches.length === 1 ? 'y' : 'ies'}`), json.matches.map(matchView),
    h('p', { class: 'small muted' }, 'A match shows what the corpus holds on the topic. It is not evidence for or against your claim.'));
}

function sourceView(json) {
  if (!json.verified) return callout('bad', 'Not verified', [json.reason, json.note].filter(Boolean).join(' '));
  return h('div', null,
    callout('ok', 'The work exists', json.note),
    kv([['Title', json.title], ['Venue', json.venue], ['Year', json.year ? String(json.year) : undefined], ['Authors', json.authors?.join(', ')],
      ['Recorded in the open session', json.recordedInSession ? 'yes' : undefined]]),
    json.warning ? callout('warn', 'Check the topic', json.warning) : null,
    json.supportAdvice ? callout('info', 'Advisory reading of the abstract', [json.supportAdvice.supports, json.supportAdvice.reason].filter(Boolean).join(': ')) : null);
}

function dissentView(json) {
  return h('div', null,
    json.agreement ? callout('info', `The positions ${json.agreement.summary === 'split' ? 'diverge' : json.agreement.summary}`, json.agreement.pairs.map((p) => `${p.a} and ${p.b}: ${p.relation} (${p.basis})`).join('. ')) : null,
    h('div', { class: 'grid grid-2' }, json.positions.map((p) => h('div', { class: 'card-item' },
      h('header', null, h('strong', null, p.label), badge(p.valid ? 'valid' : 'needs work', p.valid ? 'ok' : 'warn')),
      p.issues?.length ? list(p.issues) : null,
      kv([['Falsifiability quality', p.falsifiabilityQuality !== undefined ? p.falsifiabilityQuality.toFixed(2) : undefined]]),
      p.knowledgeMatches?.length ? h('div', null, h('h3', null, 'Corpus entries it touches'), p.knowledgeMatches.map(matchView)) : null))),
    json.discriminatingTests?.length ? h('div', null, h('h3', null, 'Tests that would tell them apart'),
      json.discriminatingTests.map((d) => h('div', null, h('strong', null, d.position), list(d.tests)))) : null,
    callout('info', 'No winner is declared', json.directive));
}

/** The structured result of one operation. */
export function resultView(json) {
  const root = h('div', { class: 'stack' });
  if (json.rule && json.error) {
    root.append(errorView(json));
    return root;
  }

  if (json.falsifiable !== undefined) {
    root.append(json.falsifiable
      ? callout('ok', 'Falsifiable', json.reason)
      : callout('warn', 'Outside the scientific method', json.reason));
    if (json.reframedHint) root.append(callout('info', 'Reframe it', json.reframedHint));
  }
  if (json.consensusAppeal || json.consensusCitedAsEvidence) {
    root.append(callout('warn', 'Consensus is not evidence', json.challenge));
  }
  if (json.judgeAdvice) {
    const a = json.judgeAdvice;
    root.append(callout(json.judgeDisagrees ? 'warn' : 'info',
      `Advisory second opinion (${a.model ?? 'judge model'})${json.judgeDisagrees ? ': disagrees with the keyword check' : ''}`,
      [a.falsifiable ? `Falsifiable: ${a.falsifiable}. ` : '', a.reason ?? '', ' ', a.note ?? ''].join('')));
  }
  if (Array.isArray(json.possibleConsensusAppeals) && json.possibleConsensusAppeals.length) {
    root.append(callout('warn', 'These items read as appeals to authority (advisory)', null),
      list(json.possibleConsensusAppeals.map((a) => `${a.observation}${a.reason ? `, ${a.reason}` : ''}`)));
  }
  if (json.mirrorOf && !json.review) root.append(callout('info', 'Linked as an opposite framing', `This inquiry is the other side of ${json.mirrorOf.slice(0, 8)}…`));

  if (json.hypothesis) {
    const hy = json.hypothesis;
    root.append(h('div', null, h('h3', null, 'Hypothesis locked'),
      kv([['Statement', hy.statement], ['Predicts', hy.predicts],
        ['Locked at', json.lockedAt ? new Date(json.lockedAt).toLocaleString() : undefined],
        ['Revision', json.revision ? String(json.revision) : undefined]]),
      hy.falsificationConditions?.length ? h('div', null, h('h3', null, 'Would be proven wrong if'), list(hy.falsificationConditions.map((c) => c.description))) : null));
    if (json.claimGuidance) root.append(callout('info', 'About this kind of claim', json.claimGuidance));
    if (Array.isArray(json.quantFlags) && json.quantFlags.length) {
      root.append(h('div', null, h('h3', null, 'Quantitative lens'), list(json.quantFlags.map((f) => `${f.principle}: ${f.failureGuarded}`))));
    }
  }
  if (Array.isArray(json.knowledgeMatches)) {
    root.append(h('div', null, h('h3', null, `Knowledge this touches (${json.knowledgeMatches.length})`),
      json.knowledgeMatches.length ? json.knowledgeMatches.map(matchView) : h('p', { class: 'muted small' }, 'Nothing in the corpus matched. That is not the same as nothing relevant existing.')));
  }

  if (json.experiment) {
    root.append(h('div', null, h('h3', null, 'Decisive test recorded'), list(json.experiment.decisiveEvidence ?? [])));
  }

  if (json.analysis) {
    root.append(h('div', { class: 'row' }, h('strong', null, 'Verdict'), badge(json.analysis.verdict)));
    if (json.predictionLockedAt) root.append(h('p', { class: 'small muted' }, `Prediction was locked ${new Date(json.predictionLockedAt).toLocaleString()}, before this analysis.`));
    if (json.claimScore) root.append(scoreView(json.claimScore));
    if (json.multiplicity) root.append(multiplicityView(json.multiplicity));
    if (json.contraryEvidenceNote) root.append(callout('info', 'Contrary results disclosed', json.contraryEvidenceNote));
    if (json.verdictMayContradictEvidence) root.append(callout('warn', 'Check the verdict', json.verdictMayContradictEvidence.note), list(json.verdictMayContradictEvidence.observations));
    if (json.replicationNotCredited) root.append(callout('warn', 'Replication not credited', json.replicationNote), list(json.replicationNotCredited));
    if (json.sourceCheck) {
      const s = json.sourceCheck;
      root.append(h('div', null, h('h3', null, 'Sources'),
        kv([['Verified in this session', String(s.verified)], ['Unverified', s.unverified?.length ? s.unverified.join(', ') : undefined],
          ['Possibly unrelated', s.possiblyUnrelated?.join(', ')], ['Judge says unsupported', s.judgeSaysUnsupported?.join(', ')]]),
        s.note ? h('p', { class: 'small muted' }, s.note) : null,
        s.mismatchNote ? callout('warn', 'Off-topic source', s.mismatchNote) : null));
    }
    if (json.reviewRequired) root.append(callout('info', 'A "yes" is not final', 'Review is mandatory even on a yes. Answer the three review questions next.'));
  }

  if (json.review) {
    root.append(h('div', { class: 'row' }, h('strong', null, 'Outcome'), badge(json.outcome, json.outcome === 'confirm' ? 'ok' : 'warn')));
    if (json.epistemicStatus) {
      root.append(h('div', null, h('div', { class: 'row' }, h('strong', null, 'Epistemic status'), badge(json.epistemicStatus)),
        h('p', { class: 'small' }, STATUS_TEXT[json.epistemicStatus] ?? '')));
      if (json.statusCap) root.append(callout('warn', 'Status held back', json.statusCap));
      if (json.mirrorNote) root.append(callout('warn', 'Opposite framing', json.mirrorNote));
      if (json.note) root.append(callout('info', 'Process, not proof', json.note));
    } else if (json.cycleVerified === false) {
      root.append(callout('warn', 'Not recorded', json.note));
    }
    if (json.nextStep) root.append(callout('info', 'Next', json.nextStep));
    if (json.mirror) root.append(mirrorView(json.mirror));
  }

  if (json.sessionWarning) root.append(callout('warn', 'No session', json.sessionWarning));
  if (json.next?.tool) root.append(h('p', { class: 'small muted' }, `Next: ${NEXT_LABEL[json.next.tool] ?? json.next.tool}.`));

  if (Array.isArray(json.matches) && json.claim !== undefined) root.append(relatedView(json));
  if (json.doi !== undefined && json.verified !== undefined) root.append(sourceView(json));
  if (Array.isArray(json.positions) && json.positionCount !== undefined) root.append(dissentView(json));

  root.append(h('details', { class: 'raw' }, h('summary', null, 'Show the raw response'), h('pre', null, JSON.stringify(json, null, 2))));
  return root;
}

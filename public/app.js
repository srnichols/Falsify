/*
 * Falsify web UI — a thin, hand-authored client (Phase-3 plan, Slice 4).
 *
 * It is *just another consumer* of the same transport-free core, reached over the
 * local HTTP/JSON API. No framework, no build step. It threads `cycleState`
 * across steps exactly as the MCP transport does, renders the hypothesis card,
 * and renders the visible-mistakes notebook (struck entries kept legible).
 */

const stateBadge = document.getElementById('stateBadge');
const stepForm = document.getElementById('stepForm');
const card = document.getElementById('card');
const cardBody = document.getElementById('cardBody');
const errorBox = document.getElementById('errorBox');
const notebookForm = document.getElementById('notebookForm');
const notebookText = document.getElementById('notebookText');
const notebookList = document.getElementById('notebookList');

/** The cycle state, as last reported by the server (the session is authoritative). */
let cycleState = 'intake';
/** The server-side session for the current inquiry, issued at Intake. */
let sessionId;

/** Identify the inquiry: the session once we have one, else the bare state. */
function ids() {
  return sessionId ? { sessionId } : { cycleState };
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

function lines(value) {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function showError(json) {
  errorBox.classList.remove('hidden');
  errorBox.textContent = `${json.rule}: ${json.error} — ${json.guidance}`;
}

function clearError() {
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
}

function setState(next) {
  cycleState = next ?? cycleState;
  stateBadge.textContent = cycleState;
}

function renderCard(json) {
  card.classList.remove('hidden');
  const rows = [];
  const add = (label, value) => rows.push(`<dt>${label}</dt><dd>${value}</dd>`);

  if (json.hypothesis) {
    add('Statement', escapeHtml(json.hypothesis.statement));
    add('Predicts', escapeHtml(json.hypothesis.predicts));
    const conds = (json.hypothesis.falsificationConditions ?? [])
      .map((c) => `<li>${escapeHtml(c.description)}</li>`)
      .join('');
    add('Would be proven wrong if', `<ul>${conds}</ul>`);
  }
  if (json.falsifiable !== undefined) {
    add('Falsifiable', json.falsifiable ? 'yes' : 'no — outside the method');
    if (json.reason) add('Reason', escapeHtml(json.reason));
    if (json.reframedHint) add('Reframe', escapeHtml(json.reframedHint));
  }
  if (json.consensusAppeal) {
    add('Consensus challenge', escapeHtml(json.challenge));
  }
  if (Array.isArray(json.quantFlags) && json.quantFlags.length > 0) {
    const flags = json.quantFlags.map((f) => `<li>${escapeHtml(f.principle ?? JSON.stringify(f))}</li>`).join('');
    add('Quantitative lens', `<ul>${flags}</ul>`);
  }
  if (Array.isArray(json.knowledgeMatches) && json.knowledgeMatches.length > 0) {
    const matches = json.knowledgeMatches
      .map((m) => `<li><strong>${escapeHtml(m.tier)}</strong>: ${escapeHtml(m.title)}<br /><em>${escapeHtml(m.directive)}</em></li>`)
      .join('');
    add('Knowledge this touches', `<ul>${matches}</ul>`);
  }
  if (json.claimGuidance) add('Claim type', escapeHtml(json.claimGuidance));
  if (json.lockedAt) add('Prediction locked', escapeHtml(json.lockedAt));
  if (json.predictionLockedAt) add('Prediction was locked', escapeHtml(json.predictionLockedAt));
  if (json.consensusCitedAsEvidence) add('Consensus is not evidence', escapeHtml(json.challenge));
  if (json.experiment) {
    const ev = (json.experiment.decisiveEvidence ?? []).map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    add('Decisive evidence', `<ul>${ev}</ul>`);
  }
  if (json.analysis) {
    add('Verdict', escapeHtml(json.analysis.verdict));
  }
  if (json.claimScore) {
    const s = json.claimScore;
    add('Evidence strength', escapeHtml(s.evidenceStrength));
    add(
      'Claim score',
      `${escapeHtml(s.score)} (without consensus: ${escapeHtml(s.nonConsensusScore)}; consensus added ${escapeHtml(s.consensusContribution)})`,
    );
  }
  if (json.reviewRequired) {
    add('Review', 'A "yes" is not final — review is mandatory.');
  }
  if (json.review) {
    add('Outcome', escapeHtml(json.outcome));
    if (json.cycleVerified === true) {
      add('Recorded', `Cycle followed and written to the notebook as ${escapeHtml(json.epistemicStatus)}. ${escapeHtml(json.note)}`);
    }
    if (json.cycleVerified === false) add('Not recorded', escapeHtml(json.note));
    if (json.nextStep) add('Next', escapeHtml(json.nextStep));
  }
  if (json.cycleState) add('Cycle state', escapeHtml(json.cycleState));
  if (Array.isArray(json.legalNext)) add('Legal next moves', json.legalNext.map(escapeHtml).join(', ') || '(none — terminal)');

  cardBody.innerHTML = `<dl>${rows.join('')}</dl>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// --- Step forms -----------------------------------------------------------

const FORMS = {
  intake: {
    title: 'Intake — is the question falsifiable?',
    fields: [{ name: 'question', label: 'Your question', type: 'text' }],
    submit: (v) => api('/api/intake', { question: v.question, cycleState }),
  },
  hypothesis: {
    title: 'Hypothesis — state it so it could be wrong',
    fields: [
      { name: 'statement', label: 'Hypothesis', type: 'text' },
      { name: 'predicts', label: 'Predicts', type: 'text' },
      { name: 'falsificationConditions', label: 'Would be wrong if (one per line, describe an observation)', type: 'textarea' },
      { name: 'claimType', label: 'Claim type (optional)', type: 'select', options: ['', 'universal', 'existential', 'probabilistic', 'causal'] },
      { name: 'revisionNote', label: 'After a refutation: what changed, and why?', type: 'text' },
    ],
    submit: (v) =>
      api('/api/hypothesize', {
        statement: v.statement,
        predicts: v.predicts,
        falsificationConditions: lines(v.falsificationConditions).map((description) => ({ description })),
        ...(v.claimType ? { claimType: v.claimType } : {}),
        ...(v.revisionNote ? { revisionNote: v.revisionNote } : {}),
        ...ids(),
      }),
  },
  experiment: {
    title: 'Experiment — design a test that could fail',
    fields: [
      { name: 'decisiveEvidence', label: 'Decisive evidence (one per line)', type: 'textarea' },
      { name: 'couldFail', label: 'This test could genuinely fail', type: 'checkbox' },
    ],
    submit: (v) =>
      api('/api/experiment', {
        decisiveEvidence: lines(v.decisiveEvidence),
        couldFail: v.couldFail === true,
        ...ids(),
      }),
  },
  analysis: {
    title: 'Analysis — does the data agree with the prediction?',
    fields: [
      { name: 'verdict', label: 'Verdict', type: 'select', options: ['yes', 'no'] },
      { name: 'evidenceCited', label: 'Evidence cited (one per line)', type: 'textarea' },
      { name: 'searchDescription', label: 'For a yes: what did you search, and how?', type: 'text' },
      { name: 'contraryFound', label: 'Null or contrary results known (a number)', type: 'text' },
      { name: 'contraryNote', label: 'If any: what are they, and why does the claim stand?', type: 'text' },
    ],
    submit: (v) =>
      api('/api/analyze', {
        verdict: v.verdict,
        evidenceCited: lines(v.evidenceCited),
        ...(v.searchDescription
          ? {
              evidenceSearch: {
                description: v.searchDescription,
                contraryFound: Math.max(0, Number.parseInt(v.contraryFound, 10) || 0),
                ...(v.contraryNote ? { contraryNote: v.contraryNote } : {}),
              },
            }
          : {}),
        ...ids(),
      }),
  },
  review: {
    title: 'Review — the three questions, in order',
    fields: [
      { name: 'q1Methods', label: '1) Were the methods sound?', type: 'text' },
      { name: 'q2Hypothesis', label: '2) Was the hypothesis wrong?', type: 'text' },
      { name: 'q3Theory', label: '3) Is the theory wrong?', type: 'text' },
      { name: 'outcome', label: 'Outcome', type: 'select', options: ['revise', 'confirm'] },
      { name: 'acceptTentative', label: 'Accept a tentative status if the evidence is weak', type: 'checkbox' },
    ],
    submit: (v) =>
      api('/api/review', {
        q1Methods: v.q1Methods,
        q2Hypothesis: v.q2Hypothesis,
        q3Theory: v.q3Theory,
        outcome: v.outcome,
        ...(v.acceptTentative === true ? { acceptTentative: true } : {}),
        ...ids(),
      }),
  },
  theory: {
    title: 'Theory — provisionally held, always falsifiable',
    fields: [],
    submit: null,
  },
};

function renderStepForm() {
  const spec = FORMS[cycleState] ?? FORMS.intake;
  if (!spec.submit) {
    stepForm.innerHTML = `<p class="done">${escapeHtml(spec.title)}. The loop is closed — but a single decisive observation could still reopen it.</p>`;
    return;
  }
  const inputs = spec.fields
    .map((f) => {
      if (f.type === 'textarea') {
        return `<label>${escapeHtml(f.label)}<textarea name="${f.name}" rows="3"></textarea></label>`;
      }
      if (f.type === 'checkbox') {
        return `<label class="check"><input type="checkbox" name="${f.name}" /> ${escapeHtml(f.label)}</label>`;
      }
      if (f.type === 'select') {
        const opts = f.options.map((o) => `<option value="${o}">${o}</option>`).join('');
        return `<label>${escapeHtml(f.label)}<select name="${f.name}">${opts}</select></label>`;
      }
      return `<label>${escapeHtml(f.label)}<input type="text" name="${f.name}" /></label>`;
    })
    .join('');
  stepForm.innerHTML = `<form id="cycleForm"><h3>${escapeHtml(spec.title)}</h3>${inputs}<button type="submit">Submit step</button></form>`;

  document.getElementById('cycleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const data = readForm(event.target);
    const { ok, json } = await spec.submit(data);
    if (!ok) {
      showError(json);
      return;
    }
    renderCard(json);
    if (json.sessionId) sessionId = json.sessionId;
    setState(json.cycleState ?? cycleState);
    renderStepForm();
    await loadNotebook();
  });
}

function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return out;
}

// --- Notebook -------------------------------------------------------------

async function loadNotebook() {
  const res = await fetch('/api/notebook');
  const json = await res.json();
  renderNotebook(json.items ?? []);
}

function renderNotebook(items) {
  notebookList.innerHTML = items
    .map((item) => {
      const struck = item.struck
        ? ` <span class="struck-meta">struck ${escapeHtml(item.struck.struckAt)} — ${escapeHtml(item.struck.reason)}</span>`
        : '';
      const cls = item.struck ? 'struck' : '';
      const button = item.struck
        ? ''
        : `<button data-id="${item.id}" class="strike-btn">strike</button>`;
      return `<li class="${cls}"><span class="entry-text">${escapeHtml(item.text)}</span>${struck} ${button}</li>`;
    })
    .join('');

  for (const btn of notebookList.querySelectorAll('.strike-btn')) {
    btn.addEventListener('click', async () => {
      await api('/api/notebook/strike', { id: btn.dataset.id, reason: 'refuted' });
      await loadNotebook();
    });
  }
}

notebookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = notebookText.value.trim();
  if (text === '') return;
  await api('/api/notebook', { kind: 'note', text });
  notebookText.value = '';
  await loadNotebook();
});

// --- Boot -----------------------------------------------------------------

setState('intake');
renderStepForm();
loadNotebook();

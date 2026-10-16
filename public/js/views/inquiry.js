/* The Inquiry screen: a guided run through the cycle, with the server's verdict on every step. */

import { h, mount, clear, field, checkbox, badge, toast, shortId, lines } from '../dom.js';
import { get, post } from '../api.js';
import { state, loadSession, resetInquiry, currentStep } from '../state.js';
import { listEditor, evidenceEditor, refPicker } from '../editors.js';
import { resultView, callout, kv, list } from '../render.js';

const STEPS = [
  ['intake', 'Intake'], ['hypothesis', 'Hypothesis'], ['experiment', 'Experiment'],
  ['analysis', 'Analysis'], ['review', 'Review'], ['theory', 'Theory'],
];

const HELP = {
  intake: ['Is the question something an observation could settle? Normative, definitional and appeal-to-consensus wordings are flagged.', 'Optionally link this as the opposite framing of an earlier inquiry, so both sides are tested the same way.'],
  hypothesis: ['At least one falsifier that names an observation, not "if it is wrong".', 'The hypothesis is locked here: this is your pre-registration.', 'After a refutation you must say what changed, and may not drop earlier falsifiers.'],
  experiment: ['The test must be able to come out against you.', 'Name the decisive evidence: what would settle the question.', 'A causal claim needs a comparison (control, placebo or intervention).'],
  analysis: ['Consensus is not evidence; appeals to authority are refused.', 'Every p-value needs the number of outcomes tested, and is adjusted for them.', 'A "yes" must disclose what was searched and what contrary results exist.'],
  review: ['Three questions, in order: were the methods sound, was the hypothesis wrong, is the theory wrong?', 'Weak evidence is refused unless you accept a tentative status.', 'The opposite framing, if linked, is compared with this one.'],
  theory: ['A completed cycle is a process record, not proof.', 'Run the opposite framing, and record what later happens with the outcome screen.'],
};

const EXAMPLES = [
  'Does a 200mg caffeine dose lower reaction time in healthy adults?',
  'Does moderate alcohol consumption lower all-cause mortality compared with abstaining?',
  'Do concealed carry laws reduce violent crime?',
];

export async function mountInquiry(root) {
  const stepper = h('ol', { class: 'stepper', 'aria-label': 'Cycle progress' });
  const left = h('section', { class: 'panel', 'aria-labelledby': 'step-title' });
  const right = h('section', { class: 'panel', 'aria-label': 'What Falsify said' });
  const sub = h('p', null);
  const newBtn = h('button', { type: 'button', class: 'btn', onclick: () => { resetInquiry(); state.prefill = null; draw(); } }, 'New inquiry');

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Inquiry'), sub), newBtn),
    stepper, h('div', { class: 'split' }, left, right));

  const sessionsRes = await get('/api/sessions');
  const sessions = sessionsRes.ok ? sessionsRes.json.sessions : [];

  /* ---------- drawing ---------- */
  function draw() {
    const step = currentStep();
    sub.textContent = state.session ? `${shortId(state.session.id)} · ${state.session.question}` : 'Run a question through the cycle. Falsify checks each step and tells you why when it refuses.';
    drawStepper(step);
    drawForm(step);
    drawResult(step);
  }

  function drawStepper(step) {
    clear(stepper);
    const idx = STEPS.findIndex(([k]) => k === step);
    STEPS.forEach(([key, label], i) => {
      const done = state.session?.state === 'theory' ? true : i < idx;
      stepper.append(h('li', { class: done ? 'done' : '', 'aria-current': key === step && state.session?.state !== 'theory' ? 'step' : undefined }, label));
    });
    if (state.session?.state === 'theory') stepper.lastChild.setAttribute('aria-current', 'step');
  }

  function drawResult(step) {
    clear(right);
    if (state.last) {
      right.append(h('h2', null, `Last result: ${state.last.label}`), resultView(state.last.json));
      return;
    }
    right.append(h('h2', null, `What Falsify checks at ${STEPS.find(([k]) => k === step)?.[1] ?? step}`), list(HELP[step] ?? []));
  }

  /** Submit one operation. A refusal keeps the form as typed; a success moves on. */
  async function run({ label, path, body, button }) {
    button.disabled = true;
    const res = await post(path, body);
    button.disabled = false;
    state.last = { label, json: res.json, ok: res.ok };
    if (!res.ok) {
      drawResult(currentStep());
      toast(res.json.rule ? `${res.json.rule}: see the result panel.` : 'Request failed.', 'bad');
      return;
    }
    if (Array.isArray(res.json.knowledgeMatches)) state.matches = res.json.knowledgeMatches;
    const id = res.json.sessionId ?? state.session?.id;
    if (id) await loadSession(id);
    draw();
  }

  const submitRow = (text) => {
    const button = h('button', { type: 'submit', class: 'btn btn-primary' }, text);
    return { button, el: h('div', { class: 'row' }, button) };
  };

  const recap = (session) => {
    const hy = session.hypothesis;
    if (!hy) return null;
    return h('div', { class: 'callout' }, h('strong', null, 'Your locked hypothesis'),
      kv([['Statement', hy.statement], ['Predicts', hy.predicts]]),
      list(hy.falsificationConditions.map((c) => `Wrong if: ${c.description}`)));
  };

  /* ---------- forms ---------- */
  function drawForm(step) {
    clear(left);
    left.append(h('h2', { id: 'step-title' }, STEPS.find(([k]) => k === step)?.[1] ?? step));
    const builders = { intake: intakeForm, hypothesis: hypothesisForm, experiment: experimentForm, analysis: analysisForm, review: reviewForm, theory: theoryPanel };
    left.append((builders[step] ?? intakeForm)());
  }

  function intakeForm() {
    const question = h('textarea', { rows: 2, placeholder: 'A question an observation could settle.' });
    if (state.prefill?.hint) question.placeholder = 'Write the opposite framing of the question above.';
    const mirrorSel = h('select', null, h('option', { value: '' }, 'None'),
      ...sessions.filter((s) => !s.mirrorOf).map((s) => h('option', { value: s.id }, `${shortId(s.id)} · ${s.question.slice(0, 70)}`)));
    if (state.prefill?.mirrorOf) mirrorSel.value = state.prefill.mirrorOf;
    const form = h('form', { onsubmit: (e) => e.preventDefault() },
      state.prefill?.hint ? callout('info', 'Opposite framing', `Original: "${state.prefill.hint}". Ask the other side with the same wording care, and Falsify will hold both to the same standard.`) : null,
      field({ label: 'Your question', control: question }),
      h('div', { class: 'chips', 'aria-label': 'Example questions' }, EXAMPLES.map((ex) => h('button', { type: 'button', class: 'chip', onclick: () => { question.value = ex; question.focus(); } }, ex.length > 52 ? `${ex.slice(0, 50)}…` : ex))),
      field({ label: 'Opposite framing of (optional)', hint: 'Links the two inquiries. At Review they are compared, and a one-sided theory cannot be rated "supported".', control: mirrorSel }));
    const { button, el } = submitRow('Check falsifiability');
    form.append(el);
    form.addEventListener('submit', () => {
      const q = question.value.trim();
      if (!q) { toast('Enter a question first.', 'bad'); return; }
      run({ label: 'Intake', path: '/api/intake', body: { question: q, ...(mirrorSel.value ? { mirrorOf: mirrorSel.value } : {}) }, button })
        .then(() => { state.prefill = null; });
    });
    return form;
  }

  function hypothesisForm() {
    const s = state.session;
    const revising = Boolean(s.pendingRevision);
    const prev = revising ? s.refuted[s.refuted.length - 1] : undefined;
    const statement = h('textarea', { rows: 2, placeholder: 'A claim that could be wrong.' });
    const predicts = h('textarea', { rows: 2, placeholder: 'What you would observe if it is right.' });
    if (prev) { statement.value = prev.statement; predicts.value = prev.predicts; }
    const falsifiers = listEditor({ label: 'Would be proven wrong if', hint: 'Each names a measurable observation. "If it is wrong" is refused.', placeholder: 'e.g. no drop in reaction time versus placebo in a blinded trial', minRows: 2, initial: prev ? prev.falsificationConditions.map((c) => c.description) : [] });
    const claimType = h('select', null, h('option', { value: '' }, 'Not specified'), ...['universal', 'existential', 'probabilistic', 'causal'].map((t) => h('option', { value: t }, t)));
    const assumptions = h('textarea', { rows: 2, placeholder: 'One per line. Background assumptions the test relies on.' });
    const note = h('textarea', { rows: 2, placeholder: 'What did the refutation teach you? Not "I narrowed it until it survived".' });
    const form = h('form', { onsubmit: (e) => e.preventDefault() },
      revising ? callout('warn', 'The last hypothesis was refuted', `You must say what changed and keep every earlier falsifier. Previous claim: "${prev?.statement ?? ''}"`) : null,
      field({ label: 'Hypothesis', control: statement }),
      field({ label: 'Predicts', control: predicts }),
      falsifiers.el,
      field({ label: 'Kind of claim', hint: 'Changes what a valid falsifier must look like.', control: claimType }),
      field({ label: 'Assumptions (optional)', control: assumptions }),
      revising ? field({ label: 'What changed, and why', control: note }) : null);
    const { button, el } = submitRow('Lock the hypothesis');
    form.append(el);
    form.addEventListener('submit', () => run({
      label: 'Hypothesis', path: '/api/hypothesize', button,
      body: {
        sessionId: s.id, statement: statement.value.trim(), predicts: predicts.value.trim(),
        falsificationConditions: falsifiers.values().map((description) => ({ description })),
        ...(claimType.value ? { claimType: claimType.value } : {}),
        ...(lines(assumptions.value).length ? { assumptions: lines(assumptions.value) } : {}),
        ...(revising ? { revisionNote: note.value.trim() } : {}),
      },
    }));
    return form;
  }

  function experimentForm() {
    const s = state.session;
    const couldFail = checkbox({ label: 'This test could genuinely come out against my hypothesis' });
    const evidence = listEditor({ label: 'Decisive evidence', hint: 'What observation or study would settle the question? You usually cannot run it: name the existing study, dataset or measurement that serves.', placeholder: 'e.g. blinded placebo-controlled reaction-time trial', minRows: 1 });
    const form = h('form', { onsubmit: (e) => e.preventDefault() }, recap(s), evidence.el, h('div', { class: 'field' }, couldFail.wrap));
    const { button, el } = submitRow('Record the test');
    form.append(el);
    form.addEventListener('submit', () => run({ label: 'Experiment', path: '/api/experiment', button, body: { sessionId: s.id, couldFail: couldFail.input.checked, decisiveEvidence: evidence.values() } }));
    return form;
  }

  function analysisForm() {
    const s = state.session;
    const verdictYes = h('input', { type: 'radio', name: 'verdict', value: 'yes' });
    const verdictNo = h('input', { type: 'radio', name: 'verdict', value: 'no', checked: true });
    const evidence = evidenceEditor();
    const search = h('textarea', { rows: 2, placeholder: 'Where and how you looked: databases, queries, dates. At least five words.' });
    const contraryFound = h('input', { type: 'number', min: 0, step: 1, value: '0' });
    const contraryNote = h('textarea', { rows: 2, placeholder: 'If any: what are they, and why does the claim stand in spite of them?' });
    const nullClaim = checkbox({ label: 'My hypothesis itself asserts no effect', hint: '(so a non-significant result supports it)' });
    const refs = refPicker();
    const form = h('form', { onsubmit: (e) => e.preventDefault() },
      recap(s),
      h('fieldset', null, h('legend', null, 'Does the data agree with the prediction?'),
        h('label', { class: 'check' }, verdictYes, h('span', null, 'Yes. The falsifiers did not occur.')),
        h('label', { class: 'check' }, verdictNo, h('span', null, 'No. The prediction failed.')),
        h('p', { class: 'hint' }, 'A "yes" is not final: Review is mandatory.')),
      evidence.el,
      h('fieldset', null, h('legend', null, 'What did you search for? (required for a yes)'),
        field({ label: 'Search description', control: search }),
        field({ label: 'Null or contrary results known', control: contraryFound }),
        field({ label: 'How do you handle them?', control: contraryNote })),
      h('div', { class: 'field' }, nullClaim.wrap),
      refs.el);
    const { button, el } = submitRow('Record the verdict');
    form.append(el);
    form.addEventListener('submit', () => {
      const items = evidence.values();
      run({
        label: 'Analysis', path: '/api/analyze', button,
        body: {
          sessionId: s.id, verdict: verdictYes.checked ? 'yes' : 'no', evidence: items,
          ...(search.value.trim() ? { evidenceSearch: { description: search.value.trim(), contraryFound: Math.max(0, Number.parseInt(contraryFound.value, 10) || 0), ...(contraryNote.value.trim() ? { contraryNote: contraryNote.value.trim() } : {}) } } : {}),
          ...(nullClaim.input.checked ? { nullHypothesisClaim: true } : {}),
          ...(refs.values().length ? { knowledgeRefs: refs.values() } : {}),
        },
      });
    });
    return form;
  }

  function reviewForm() {
    const s = state.session;
    const verdict = s.analysis?.verdict;
    const strength = s.analysis?.score?.evidenceStrength;
    const q1 = h('textarea', { rows: 2, placeholder: 'What you actually checked about the protocol and the data.' });
    const q2 = h('textarea', { rows: 2, placeholder: 'Was the claim well formed, or too broad or too narrow?' });
    const q3 = h('textarea', { rows: 2, placeholder: 'Does the underlying theory still stand?' });
    const outcomes = verdict === 'yes' ? ['confirm', 'revise'] : ['revise'];
    const outcome = h('select', null, ...outcomes.map((o) => h('option', { value: o }, o === 'confirm' ? 'Confirm: record a theory' : 'Revise: loop back to the hypothesis')));
    const tentative = checkbox({ label: 'Accept a tentative status', hint: '(the evidence is rated weak)' });
    const form = h('form', { onsubmit: (e) => e.preventDefault() },
      recap(s),
      h('div', { class: 'callout' }, h('strong', null, 'Your verdict'), h('div', { class: 'row' }, badge(verdict ?? 'none'), strength ? badge(`evidence ${strength}`) : null)),
      strength === 'weak' && verdict === 'yes' ? callout('warn', 'The evidence is rated weak', 'Confirming is refused unless you accept a tentative status.') : null,
      field({ label: '1. Were the methods sound?', control: q1 }),
      field({ label: '2. Was the hypothesis wrong?', control: q2 }),
      field({ label: '3. Is the underlying theory wrong?', control: q3 }),
      field({ label: 'Outcome', control: outcome }),
      verdict === 'yes' && strength === 'weak' ? h('div', { class: 'field' }, tentative.wrap) : null);
    const { button, el } = submitRow('Complete the review');
    form.append(el);
    form.addEventListener('submit', () => run({
      label: 'Review', path: '/api/review', button,
      body: { sessionId: s.id, q1Methods: q1.value.trim(), q2Hypothesis: q2.value.trim(), q3Theory: q3.value.trim(), outcome: outcome.value, ...(tentative.input.checked ? { acceptTentative: true } : {}) },
    }));
    return form;
  }

  function theoryPanel() {
    const s = state.session;
    const a = s.analysis;
    const open = (id) => async () => { await loadSession(id); state.last = null; draw(); };
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('strong', null, 'Epistemic status'), badge(s.epistemicStatus ?? 'unrated')),
      s.statusCap ? callout('warn', 'Status held back', s.statusCap) : null,
      callout('info', 'Process, not proof', 'This records that the cycle was followed. It does not establish that the claim is true; every input was supplied by the caller.'),
      recap(s),
      kv([['Verdict', a ? badge(a.verdict) : undefined], ['Evidence', a?.score ? badge(a.score.evidenceStrength) : undefined], ['Evidence items', String(a?.evidence?.length ?? 0)], ['Hypotheses tried', String(s.refuted.length + 1)]]),
      state.mirror?.linked ? callout(state.mirror.bothYes ? 'warn' : 'info', 'Opposite framing is linked', state.mirror.completed ? 'Compared at Review: see the Sessions screen for the side-by-side.' : 'It has not reached analysis yet.') : null,
      h('div', { class: 'row' },
        s.mirrorOf ? h('button', { type: 'button', class: 'btn', onclick: open(s.mirrorOf) }, 'Open the opposite framing')
          : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { state.prefill = { mirrorOf: s.id, hint: s.question }; resetInquiry(); draw(); } }, 'Run the opposite framing'),
        h('button', { type: 'button', class: 'btn', onclick: () => { state.outcomeFor = s.id; location.hash = '#/outcomes'; } }, 'Record an outcome later'),
        h('button', { type: 'button', class: 'btn', onclick: () => { resetInquiry(); draw(); } }, 'Start a new inquiry')));
  }

  draw();
}

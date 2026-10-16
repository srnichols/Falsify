/* Tools: the stand-alone checks that sit beside the cycle. */

import { h, mount, field } from '../dom.js';
import { post } from '../api.js';
import { resultView, callout } from '../render.js';
import { state } from '../state.js';

function runner(title, intro, buildForm) {
  const out = h('div', { class: 'stack', 'aria-live': 'polite' });
  const { form, collect } = buildForm();
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Run');
  form.append(submit);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const req = collect();
    if (req.error) { mount(out, callout('bad', 'Missing input', req.error)); return; }
    submit.disabled = true;
    mount(out, h('p', { class: 'muted' }, 'Working…'));
    const res = await post(req.path, req.body);
    submit.disabled = false;
    mount(out, resultView(res.json));
  });
  return h('section', { class: 'panel' }, h('h2', null, title), h('p', { class: 'muted' }, intro), form, out);
}

function relatedCard() {
  return runner('Related knowledge', 'Paste a claim to see which corpus entries touch it, and what each rests on and would be falsified by. This is a lookup, not a verdict.', () => {
    const claim = h('textarea', { rows: 2, placeholder: 'e.g. Does evolution create new genetic information?', 'aria-label': 'Claim' });
    const form = h('form', { class: 'stack' }, field({ label: 'Claim or question', control: claim }));
    return { form, collect: () => (claim.value.trim() ? { path: '/api/related', body: { claim: claim.value.trim() } } : { error: 'Enter a claim or question.' }) };
  });
}

function verifyCard() {
  return runner('Verify a source', 'Looks a DOI up on Crossref and checks that the paper is real and on topic. It cannot tell you whether the paper supports your claim.', () => {
    const doi = h('input', { type: 'text', placeholder: '10.1038/…', 'aria-label': 'DOI', autocomplete: 'off' });
    const obs = h('input', { type: 'text', placeholder: 'What you cite it for (optional, enables the topic check)', 'aria-label': 'What the source is cited for' });
    const form = h('form', { class: 'stack' }, field({ label: 'DOI', control: doi }), field({ label: 'Cited for', control: obs }));
    return {
      form,
      collect: () => {
        const d = doi.value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:/i, '');
        return d ? { path: '/api/verify-source', body: { doi: d, ...(obs.value.trim() ? { observation: obs.value.trim() } : {}), ...(state.session ? { sessionId: state.session.id } : {}) } } : { error: 'Enter a DOI.' };
      },
    };
  });
}

function dissentCard() {
  return runner('Compare competing positions', 'Put two or more rival theories through the same standard: what each predicts, what would falsify it, and what each rests on. No winner is declared.', () => {
    const question = h('input', { type: 'text', placeholder: 'The question both answer (optional)', 'aria-label': 'Question' });
    const slots = [0, 1].map((i) => ({
      label: h('input', { type: 'text', placeholder: 'Name of position', 'aria-label': `Position ${i + 1} name` }),
      statement: h('textarea', { rows: 2, placeholder: 'Its claim', 'aria-label': `Position ${i + 1} claim` }),
      predicts: h('textarea', { rows: 2, placeholder: 'What it predicts that could be checked', 'aria-label': `Position ${i + 1} prediction` }),
      falsifier: h('input', { type: 'text', placeholder: 'What would prove it wrong', 'aria-label': `Position ${i + 1} falsifier` }),
    }));
    const form = h('form', { class: 'stack' }, field({ label: 'Question', control: question }),
      h('div', { class: 'grid grid-2' }, slots.map((s, i) => h('div', { class: 'card-item' }, h('header', null, `Position ${i + 1}`),
        field({ label: 'Name', control: s.label }), field({ label: 'Claim', control: s.statement }), field({ label: 'Predicts', control: s.predicts }), field({ label: 'Falsified if', control: s.falsifier })))));
    return {
      form,
      collect: () => {
        const positions = slots.filter((s) => s.label.value.trim() && s.statement.value.trim() && s.predicts.value.trim()).map((s) => ({
          label: s.label.value.trim(), statement: s.statement.value.trim(), predicts: s.predicts.value.trim(),
          ...(s.falsifier.value.trim() ? { falsificationConditions: [{ description: s.falsifier.value.trim(), observable: true }] } : {}),
        }));
        return positions.length < 2 ? { error: 'Each position needs a name, a claim and a prediction, and you need at least two.' }
          : { path: '/api/dissent', body: { ...(question.value.trim() ? { question: question.value.trim() } : {}), positions } };
      },
    };
  });
}

export function mountTools(root) {
  mount(root, h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Tools'), h('p', null, 'Stand-alone checks you can use at any point, with or without an open inquiry.'))),
    h('div', { class: 'stack' }, relatedCard(), verifyCard(), dissentCard()));
}

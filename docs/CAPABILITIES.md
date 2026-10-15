# Falsify capabilities

> The complete, current surface of Falsify for humans and agents: every tool, every
> rule that can refuse you, every setting, every command, and what Falsify **cannot**
> do. A test (`tests/docs/capabilities.test.ts`) fails if the code gains a tool, rule,
> setting, command or web route that this file does not mention. For the reasoning
> behind the design, read [DESIGN.md](../DESIGN.md); for setup, [README.md](../README.md).

## What Falsify is, in one paragraph

Falsify runs a question through the **Cycle of Scientific Enterprise** (intake →
hypothesis → experiment → analysis → review, with a mandatory "No" branch back to the
hypothesis) and **refuses** steps that break scientific discipline. It never generates an
answer. It checks what the calling agent submits, so it is only as honest as the inputs;
the `falsify-inquiry` guidance (below) exists to keep those inputs honest. Consensus
is a low-weight signal and can never decide a verdict. Established theory is held to
the same standard as a challenger: what it rests on, and what would overturn it.

## The tools (MCP) — 10

Pass the `sessionId` from `falsify_intake` to every later call. Results name the `next`
tool and repeat the `sessionId`.

| Tool | Use it to | Key inputs | What it enforces |
|---|---|---|---|
| `falsify_intake` | Decide if a question is falsifiable; start a session. Link an opposite framing with `mirrorOf`. | `question`, `mirrorOf?` | Flags normative, definitional and consensus-appeal phrasings; returns `sessionId`. |
| `falsify_related` | See which knowledge entries a claim touches before committing to a hypothesis. | `claim`, `limit?` | Returns refuted lookalikes, Bedrock/Established entries (what each rests on, what would overturn it) and Contested questions (every position). Each match carries `stance` and `via`. |
| `falsify_hypothesize` | Lock a testable hypothesis (pre-registration). | `statement`, `predicts`, `falsificationConditions`, `claimType?`, `assumptions?`, `revisionNote?` | At least one falsifier that names an observation; after a refutation a `revisionNote` and no dropped falsifiers. |
| `falsify_experiment` | State the decisive test, one that could fail. | `couldFail`, `decisiveEvidence` | Refuses a test that cannot fail or has placeholder evidence; a causal claim needs a comparison. |
| `falsify_analyze` | Compare data to the prediction: verdict yes or no. | `verdict`, `evidence[]` (`observation`, `kind`, `source`, `doi`, `sampleSize`, `effectSize`, `pValue`, `outcomesTested`, `replicated`, `replicationDoi`), `evidenceCited[]`, `evidenceSearch`, `knowledgeRefs[]`, `nullHypothesisClaim?` | Consensus is not evidence; every p-value needs `outcomesTested`; a "yes" must disclose its search, clear p < 0.05 after multiplicity adjustment, and explain contrary results. |
| `falsify_review` | The mandatory three-question review; confirm a theory or revise. | `q1Methods`, `q2Hypothesis`, `q3Theory`, `outcome` (`revise`/`confirm`), `acceptTentative?` | A confirm needs a recorded "yes"; weak evidence is refused unless accepted as tentative; returns `epistemicStatus` and the mirror comparison. |
| `falsify_verify_source` | Check a cited DOI is a real publication (Crossref). | `doi`, `sessionId?`, `observation?` | Credits the DOI only after verification, and withholds credit from a real paper on an unrelated topic. Confirms the paper exists, not that it supports the claim. |
| `falsify_dissent` | Compare competing hypotheses (for example one per model) and show where they disagree. | `positions[]` (at least two), `question?` | Each position must pass the hypothesis honesty rules; never picks a winner; warns when positions agree. |
| `falsify_recall` | Semantic recall from the OpenBrain corpus. | `query`, `limit?` | Needs `OPENBRAIN_KEY`; degrades to a structured error without it. |
| `falsify_outcome` | Record later whether a confirmed theory held up, was refuted, or was inconclusive. | `sessionId`, `outcome`, `basis`, `reference?` | Only for a theory that completed the cycle; the basis must say what happened. Keeps the score it was confirmed with, so the score can be checked against reality. |

## How a verdict is rated

- **`epistemicStatus`** on a confirm is `supported` (replicated, with a verified
  replication DOI), `provisional` (a sourced, unreplicated result) or `tentative`
  (weak evidence, accepted explicitly). Completing the cycle records that the process
  was followed. It does not prove the claim; every result says so.
- **`statusCap`** explains why a status was lowered: no opposite framing was run or
  completed, both opposite framings reached "yes", or every cited DOI is on an unrelated
  topic with no verified relevant source.
- **`mirror`** (from `mirrorOf`) compares the two framings on falsifiers, evidence,
  verified sources, search effort, contrary results and hypotheses tried, and flags
  `bothFramingsYes`. It makes an uneven standard visible; it does not say who is right.
- **`claimScore`** is built from the recorded run, never from a model's opinion of the claim:
  direct evidence, statistical support (a model fitted to real replication outcomes),
  falsifiability quality, Bedrock/Established links, and consensus (the smallest weight,
  enforced). Evidence strength is `weak`, `moderate` or `strong`; "strong" needs a verified
  replication and no disclosed contrary results.
- **`multiplicity`** shows each p-value adjusted by `outcomesTested` and by the hypotheses
  already refuted in the inquiry.
- **`replicationNotCredited`** lists items marked `replicated` that did not cite a verified,
  different, on-topic `replicationDoi`; they are scored as unreplicated.
- **`judgeAdvice` / `possibleConsensusAppeals`** appear only if a judge model is configured;
  they are advisory and never change a verdict or score.

## Rules that can refuse you

Each refusal carries a `rule`, an `error` and `guidance`. Fix the cause; do not reword to
get past it.

| Rule | Meaning |
|---|---|
| `honesty:falsification-condition-required` | A hypothesis needs at least one falsifier. |
| `honesty:falsification-condition-vacuous` | "If it is wrong" restates the claim; name an observation. |
| `honesty:falsification-condition-unobservable` | The falsifier is not observable. |
| `honesty:statistical-threshold-required` | A probabilistic claim must state a numeric threshold. |
| `honesty:causal-claim-needs-comparison` | A causal claim needs a control, placebo or intervention. |
| `honesty:revision-note-required` | After a refutation, say what changed and why. |
| `honesty:revision-weakens-falsifiability` | A revision may not drop earlier falsifiers. |
| `honesty:experiment-must-be-able-to-fail` | The test could not come out the other way. |
| `honesty:experiment-needs-decisive-evidence` | Name what would settle the question. |
| `honesty:experiment-evidence-vague` | The evidence is a placeholder. |
| `analysis:evidence-required` / `analysis:evidence-vague` | Cite the observation itself. |
| `analysis:consensus-is-not-evidence` | Every cited item is an appeal to authority. |
| `analysis:unknown-knowledge-ref` / `analysis:knowledge-ref-tier` | A `knowledgeRef` must name an existing Bedrock or Established entry. |
| `analysis:knowledge-unavailable` | The corpus could not be loaded. |
| `analysis:decisive-evidence-required` | A "yes" that conflicts with Bedrock/Established knowledge needs a sourced experiment or statistical result. |
| `analysis:outcomes-tested-required` | A p-value needs `outcomesTested`. |
| `analysis:search-disclosure-required` | A session "yes" must say what was searched. |
| `analysis:contrary-evidence-unexplained` | Contrary results were reported but not explained. |
| `analysis:not-significant-after-adjustment` | The "yes" does not clear p < 0.05 after multiplicity. |
| `review:three-questions-required` / `review:substantive-answers-required` | All three review answers must be real. |
| `review:yes-verdict-required` | Nothing to confirm without a recorded "yes". |
| `review:evidence-too-weak` | Weak evidence is refused unless `acceptTentative` is set. |
| `cycle:illegal-transition` | The step is not legal from the current state. |
| `session:unknown` / `session:state-mismatch` / `session:required` / `session:unavailable` | Session problems; `session:required` applies when `FALSIFY_REQUIRE_SESSION=1`. |
| `mirror:unknown-session` / `mirror:already-paired` / `mirror:session-required` | `mirrorOf` problems; each inquiry has at most one mirror. |
| `outcome:no-theory` / `outcome:basis-required` / `outcome:unavailable` | `falsify_outcome` problems. |
| `dissent:two-valid-positions-required` / `dissent:duplicate-label` | `falsify_dissent` needs two valid, distinct positions. |
| `related:knowledge-unavailable` | The corpus could not be loaded. |
| `recall:brain-unreachable` | OpenBrain is not configured or reachable. |
| `request:invalid-json` / `request:invalid-body` / `request:not-found` / `request:body-too-large` / `request:unsupported-media-type` / `request:forbidden-host` / `request:forbidden-origin` | Web API request errors; the host and origin checks block DNS-rebinding and cross-site writes. |

## Knowledge

`knowledge/*.yaml` is the source of truth (OpenBrain is only a searchable mirror). 182
entries: 21 Bedrock, 88 Established, 22 Contested, 23 Quantitative, 28 Refuted.

- **Bedrock / Established** entries state what they rest on, what would overturn them and
  their domain of validity; the lint advises when one lacks two sources, a validity domain
  or a real falsifier.
- **Contested** entries present every position with its falsifiability status; a position
  resting on a value judgement is marked `normative-outside-method` and reported, not scored.
- **Refuted** entries carry zero weight and record what killed the claim and the lesson.
- **Coverage** is part of curation: the lint warns when one field exceeds 40% of claim
  entries. The human sciences are still much thinner than physics and biology.
- The matcher reads **stance** (`asserts`, `denies`, `unclear`) from negation only, and
  marks weak matches that meaning helped find (semantic or embedding, alone or with a thin
  wording overlap, below 0.7) `unclear` and possibly off-topic.

## Settings (environment variables)

All are optional. Nothing is sent anywhere unless you set the URL for it.

| Variable | Effect |
|---|---|
| `FALSIFY_DATA_DIR` | Where sessions, notebook and outcomes live (default `.falsify` in the working directory). |
| `FALSIFY_KNOWLEDGE_DIR` | Use a different corpus directory (default: the package's own `knowledge/`). |
| `FALSIFY_REQUIRE_SESSION` | `1` refuses any step after intake that has no `sessionId`. |
| `FALSIFY_WEIGHTS` | JSON of weight overrides; rejected at startup if consensus stops being the smallest weight. |
| `FALSIFY_EMBEDDINGS_URL` | OpenAI-compatible embeddings endpoint for paraphrase-proof matching (for example local Ollama). |
| `FALSIFY_EMBEDDINGS_MODEL` | Embedding model (default `nomic-embed-text`). |
| `FALSIFY_EMBEDDINGS_KEY` | API key for that endpoint, if it needs one. |
| `FALSIFY_EMBEDDINGS_THRESHOLD` | Minimum similarity for an embedding match. |
| `FALSIFY_JUDGE_URL` | OpenAI-compatible chat endpoint for the advisory judge model. |
| `FALSIFY_JUDGE_MODEL` | Judge model (default `qwen2.5:32b`). |
| `FALSIFY_JUDGE_KEY` | API key for that endpoint, if it needs one. |
| `OPENBRAIN_KEY` | Enables `falsify_recall`, semantic matching in `falsify_related`, and writing surviving theories to the corpus. |
| `OPENBRAIN_REST_BASE` | Override the OpenBrain REST endpoint. |
| `FALSIFY_BRAIN_PROJECT` | Project scope for OpenBrain reads and writes (default `falsify`). |
| `FALSIFY_WEB_PORT` | Port for the web UI (default 4319). |

## Web UI and API

`npm run web` serves a local UI (default <http://127.0.0.1:4319>, localhost only, no
authentication) with a guided cycle form and a visible-mistakes notebook. It calls the
same operations as the MCP tools, so neither can weaken the rules.

Routes: `POST /api/intake`, `/api/hypothesize`, `/api/experiment`, `/api/analyze`,
`/api/review`, `/api/related`, `/api/outcome`, `/api/verify-source`, `/api/dissent`,
`/api/session`, `/api/recall`, `GET /api/notebook`, `POST /api/notebook`,
`POST /api/notebook/strike`.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Compile to `dist/`. Rebuild, then restart the server in your MCP host, to pick up changes. |
| `npm test` | Run the test suite. |
| `npm run lint` | Lint `src` and `tests`. |
| `npm run web` | Start the web UI. |
| `npm run knowledge -- lint \| template \| add \| upsert \| move \| sync` | Maintain the corpus (see README). |
| `npm run seed-sync` | Mirror the corpus to OpenBrain. |
| `npm run calibrate` | Score the 12 labelled historical cases; add `-- --sensitivity` to see how much accuracy depends on the hand-set weights. |
| `npm run calibrate:replication` | Refit the statistical-support model to the Reproducibility Project: Psychology data. |
| `npm run calibrate:judge` | Measure a judge model on labelled cases before you trust it. |
| `npm run calibrate:outcomes` | Compare recorded scores with later `falsify_outcome` results (prints an accuracy only with at least 5 of each outcome). |
| `npm run eval:inquiry` | Measure whether the agent guidance changes behaviour (spends real model credits). |

## Guidance for agents and reviewers

Files in `.github/`: `instructions/falsify-inquiry.instructions.md` (non-negotiables and
temper guards: never invent inputs, search before disclosing, treat both sides the same),
`skills/falsify-inquiry/SKILL.md` (the step-by-step procedure, including the mirror),
`agents/falsify-reviewer.agent.md` (an independent audit of a finished session, run in a
fresh context), and `prompts/falsify-inquiry.prompt.md` (a one-line entry point). Copy
the instructions file and the skill folder into another project's `.github` to use them
there.

## What Falsify cannot do

Read this before relying on a result.

- It **cannot tell whether a real paper supports a claim**, whether your search was
  thorough, or whether your numbers are true. Every input is supplied by the caller. A
  verified DOI means the work exists and is on topic, not that it says what you cite it for.
- The disclosures (`evidenceSearch`, `outcomesTested`) are self-reported: they make omission
  a recorded choice, not an impossible one. The mirror compares only what each side recorded.
- Its keyword checks for falsifiability and consensus miss phrasing they were not written
  for. The optional judge model is advisory, and inconsistent on loaded questions.
- The score weights are **priors**: 12 author-labelled cases cannot choose between
  weightings. The replication model is fitted to psychology only (cross-validated AUC about
  0.64). Real calibration needs resolved outcomes recorded with `falsify_outcome`.
- A theory with `cycleVerified: true` has had a **process** recorded. That is not proof.
- Measured agent-behaviour results are small samples from one model; see the README.

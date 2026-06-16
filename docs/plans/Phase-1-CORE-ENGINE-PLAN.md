---
plan: Phase-1-CORE-ENGINE
status: draft
owner: srnichols
preset: typescript
package_manager: npm
created: 2026-06-15
---

# Phase 1 — Core Engine + Memory Client

> **Goal**: Stand up Falsify's pure reasoning core — the Cycle state machine, the
> typed/validated knowledge + hypothesis contracts, the tiered rules engine with a
> consensus-minimized `claim_score`, and an OpenBrain memory client with offline
> fallback. **No MCP server, no web UI** — those are later phases. Everything in this
> phase is unit-testable in isolation.

Source of design truth: [DESIGN.md](../../DESIGN.md) (§3 Cycle, §4 Rules Engine, §5 Memory).

---

## Scope Contract

### In scope
- A single TypeScript (ESM, strict) package at the repo root (`src/`, `tests/`, `dist/`).
- **Domain types + runtime schemas (zod)** for: `Claim`, `Hypothesis`,
  `FalsificationCondition`, `Experiment`, `Analysis`, `Verdict`, `CycleState`,
  `KnowledgeEntry`, `Tier`.
- **Cycle state machine**: `Intake → Hypothesis → Experiment → Analysis → Review → Theory`
  with a `Review → Hypothesis` loop-back. Pure, deterministic transitions + guards.
- **Knowledge loader**: parse `knowledge/*.yaml` into validated `KnowledgeEntry[]` with
  tier + weight metadata.
- **Rules engine**: weighted `claim_score` where `w_consensus` is the smallest term and
  consensus alone can never decide a verdict (only break ties); quantitative tier applied
  as a cross-cutting validator (not a shelf).
- **OpenBrain client**: `save` / `recall` over REST against `OPENBRAIN_REST_BASE`, auth via
  `x-brain-key` from `OPENBRAIN_KEY` env, project-scoped to `falsify`, with a local on-disk
  queue fallback when the brain is unreachable.
- Full unit-test coverage for the weighting invariant, the state machine, schema refusal,
  and the client's offline-queue path (HTTP mocked).

### Out of scope (later phases)
- MCP server and `falsify_*` tools (Phase 2).
- Web UI / hypothesis cards (Phase 3).
- Seed-sync script that pushes `knowledge/*.yaml` into OpenBrain (separate slice/phase).
- Any LLM/model invocation. This phase is deterministic plumbing + rules only.
- Multi-package pnpm workspace split (defer until the web UI exists).

### Forbidden actions
- **Do NOT** print, log, or commit the value of `OPENBRAIN_KEY` (or any secret). Tests must
  use a fake key.
- **Do NOT** make real network calls in unit tests — HTTP is mocked.
- **Do NOT** add an npm `workspaces` field that pulls `pforge-mcp/`, `pforge-master/`, or
  `pforge-sdk/` into Falsify's install graph; those keep their own installs.
- **Do NOT** weaken the honesty rule: a `Hypothesis` with zero `FalsificationCondition`s
  MUST fail validation and never be emitted.
- **Do NOT** let consensus weight decide a verdict on its own (enforced by test).
- **Do NOT** edit files under `.github/`, `pforge-*`, or `docs/plans/auto/`.

---

## Required Decisions

| # | Decision | Status | Resolution |
|---|----------|--------|------------|
| 1 | Package manager | ✅ Resolved | `npm` (single root package; matches pforge runtime + Plan Forge gate allowlist) |
| 2 | Output validation strategy | ✅ Resolved | `zod` schemas at every boundary; refuse invalid hypotheses |
| 3 | Module system / target | ✅ Resolved | ESM, `"type":"module"`, TS `module/moduleResolution: NodeNext`, target ES2022, Node ≥ 20 |
| 4 | Test framework | ✅ Resolved | `vitest` (already present in the pforge runtime; standard for TS ESM) |
| 5 | Knowledge YAML parser | ✅ Resolved | `yaml` package, then validated through the zod `KnowledgeEntry` schema |
| 6 | `claim_score` formula | ✅ Resolved | Per DESIGN.md §4: weighted sum over tiers with `w_consensus` strictly smallest; consensus may only break ties |
| 7 | Offline queue location | ✅ Resolved | `.falsify/queue/*.json` (git-ignored), drained on next successful `save` |
| 8 | HTTP client | ✅ Resolved | Native `fetch` (Node ≥ 20) — no extra dependency |

No open TBDs.

---

## Acceptance Criteria

- **MUST**: A `Hypothesis` object without at least one `FalsificationCondition` fails zod
  validation and the engine refuses to emit it.
- **MUST**: `claim_score` weights satisfy `w_consensus < min(w_bedrock, w_established, w_contested)`,
  proven by a unit test that asserts the ordering and that a consensus-only signal cannot flip a
  verdict that the tiered evidence leaves tied-against.
- **MUST**: The Cycle state machine only permits the transitions defined in DESIGN.md §3
  (including `Review → Hypothesis` loop-back) and rejects illegal transitions.
- **MUST**: The knowledge loader loads all four `knowledge/*.yaml` files and every entry
  passes the `KnowledgeEntry` schema (tier, weight, falsifiable fields present).
- **MUST**: The OpenBrain client queues to `.falsify/queue/` when the brain is unreachable and
  drains the queue on the next successful `save`; no secret is ever logged.
- **MUST**: `npm run build`, `npm test`, and `npm run lint` all pass with zero errors.
- **SHOULD**: Test coverage of `src/` core modules ≥ 85% lines.
- **SHOULD**: Every exported type has a corresponding zod schema (types derived via `z.infer`).
- **SHOULD**: The quantitative tier is applied as a validator hook, not a weighted shelf.

---

## Execution Slices

### Slice 1 — Project scaffold (pnpm + TS strict + vitest + eslint) [sequential]
**Goal**: Initialize the Falsify package so build/test/lint run green on an empty `src/`.
**Depends On**: —
**Context Files**: `.github/instructions/naming.instructions.md`, `.github/instructions/testing.instructions.md`
**Work**:
- `package.json` (`"type":"module"`, scripts: `build`=`tsc -p tsconfig.json`,
  `test`=`vitest run`, `lint`=`eslint .`, `dev`=`vitest`). Pin deps; commit `package-lock.json`.
- `tsconfig.json` (strict, `NodeNext`, `target ES2022`, `outDir dist`, `rootDir .`).
- `vitest.config.ts`, minimal `eslint.config.js` (flat config).
- `src/index.ts` placeholder export; one trivial passing test in `tests/smoke.test.ts`.
- Add `.falsify/` to `.gitignore`.

**Validation Gate**:
```bash
npm install
npm run build
npm test
npm run lint
```

---

### Slice 2 — Domain types + zod schemas [sequential]
**Goal**: Define the validated contracts; encode the honesty rule in the schema.
**Depends On**: Slice 1
**Context Files**: `.github/instructions/clean-code.instructions.md`, `DESIGN.md`
**Work**:
- `src/domain/schemas.ts` — zod schemas for `Tier`, `KnowledgeEntry`,
  `FalsificationCondition`, `Claim`, `Hypothesis` (`.min(1)` on
  `falsificationConditions`), `Experiment`, `Analysis`, `Verdict`, `CycleState`.
- `src/domain/types.ts` — `z.infer` type aliases re-exported.
- `tests/domain/schemas.test.ts` — asserts a hypothesis with empty
  `falsificationConditions` throws; a valid one parses.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 3 — Cycle state machine [sequential]
**Goal**: Deterministic transitions for the Cycle of Scientific Enterprise.
**Depends On**: Slice 2
**Context Files**: `DESIGN.md`, `.github/instructions/clean-code.instructions.md`
**Work**:
- `src/cycle/stateMachine.ts` — `transition(state, event)` allowing only
  `Intake→Hypothesis→Experiment→Analysis→Review→{Theory|Hypothesis}`; illegal
  transitions throw a typed error.
- `tests/cycle/stateMachine.test.ts` — happy path to `Theory`, the `Review→Hypothesis`
  loop-back, and rejection of an illegal jump (e.g. `Intake→Theory`).

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 4 — Knowledge loader + rules engine (claim_score) [sequential]
**Goal**: Load tiered knowledge and score claims with consensus minimized.
**Depends On**: Slice 2
**Context Files**: `DESIGN.md`, `.github/instructions/clean-code.instructions.md`
**Work**:
- `src/knowledge/loader.ts` — read + parse `knowledge/*.yaml`, validate each entry.
- `src/rules/claimScore.ts` — weighted `claim_score` per DESIGN.md §4 with
  `w_consensus` strictly smallest; consensus may only break exact ties.
- `src/rules/quantitative.ts` — cross-cutting validator hook applying the
  `quantitative.yaml` principles (e.g. flag base-rate neglect) without adding tier weight.
- `tests/rules/claimScore.test.ts` — assert weight ordering invariant; assert a
  consensus-only signal cannot flip an otherwise-tied verdict.
- `tests/knowledge/loader.test.ts` — all four files load and validate.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 5 — OpenBrain client with offline queue [sequential]
**Goal**: Persist/recall memories; degrade gracefully offline; never leak the key.
**Depends On**: Slice 2
**Context Files**: `.github/instructions/security.instructions.md`, `.github/instructions/errorhandling.instructions.md`, `DESIGN.md`
**Work**:
- `src/memory/openbrainClient.ts` — `save(memory)` / `recall(query)` via `fetch` to
  `OPENBRAIN_REST_BASE`, header `x-brain-key: <OPENBRAIN_KEY>`, body `project: "falsify"`.
  On network failure, write the payload to `.falsify/queue/<ts>.json`; on the next
  successful `save`, drain the queue first. Key read from env; never logged.
- `src/config.ts` — read + validate env (`OPENBRAIN_REST_BASE`, `OPENBRAIN_KEY`,
  `FALSIFY_BRAIN_PROJECT`) via zod; absent key → typed config error, not a crash.
- `tests/memory/openbrainClient.test.ts` — mock `fetch`: (a) success posts correct
  headers/body, (b) failure enqueues to disk, (c) recovery drains queue, (d) assert the
  key value never appears in any thrown message or console output.

**Validation Gate**:
```bash
npm run build
npm test
npm run lint
```

---

## Re-anchor Checkpoints
- **After Slice 1**: `npm run build && npm test` green on empty scaffold before adding logic.
- **After Slice 3**: re-read DESIGN.md §3 to confirm the state graph matches the Mermaid diagram.
- **After Slice 4**: re-read DESIGN.md §4 to confirm the `claim_score` weighting matches the spec
  (consensus smallest, tie-break only).
- **Before Slice 5**: confirm `.falsify/` is git-ignored so no queued payload is ever committed.

---

## Definition of Done
- [ ] All 5 slices complete; `npm run build`, `npm test`, `npm run lint` green.
- [ ] All **MUST** acceptance criteria met and traceable to a passing test.
- [ ] Honesty rule enforced at the schema boundary (no-falsification hypothesis rejected).
- [ ] `claim_score` consensus-minimization proven by test.
- [ ] No secret value present in any log, error, test fixture, or commit.
- [ ] `docs/PROJECT-CONTEXT.md` status + session log updated.
- [ ] DEPLOYMENT-ROADMAP.md Phase 1 status set to ✅.
- [ ] Reviewer Gate passed (zero 🔴 Critical).

---

## Stop Conditions
- **Build failure**: `npm run build` errors that can't be resolved within the slice scope — stop, report.
- **Test failure**: a MUST-linked test fails and the fix would expand scope — stop, report.
- **Scope violation**: work drifts into MCP/UI/seed-sync — stop, re-anchor to Scope Contract.
- **Security breach**: any path that would log/commit a secret or make a real network call in
  tests — stop immediately, do not proceed.
- **Knowledge-schema conflict**: an existing `knowledge/*.yaml` entry can't satisfy the
  `KnowledgeEntry` schema — stop and reconcile the schema vs. the seed with the user before forcing either.

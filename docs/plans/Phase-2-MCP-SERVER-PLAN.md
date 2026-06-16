---
plan: Phase-2-MCP-SERVER
status: planned
owner: srnichols
preset: typescript
package_manager: npm
created: 2026-06-16
---

# Phase 2 — MCP Server (`falsify_*` tools)

> **One-line goal**: Expose the transport-agnostic core (Cycle state machine + rules
> engine + memory client) as an MCP server whose tools *enforce Falsify's discipline* —
> they never return a plain answer, only schema-validated, falsifiable artifacts.

---

## Goal

Ship an MCP server (`@modelcontextprotocol/sdk`) that surfaces the Phase 1 core as six
deterministic tools — `falsify_intake`, `falsify_hypothesize`, `falsify_experiment`,
`falsify_analyze`, `falsify_review`, `falsify_recall` — so Falsify's method is usable
*inside Copilot / Claude / Cursor* with no UI (DESIGN.md §9, Decision 2, Phase A).

The tools are **structure-enforcing adapters**, not generators. The host agent drafts
the creative content (a candidate claim, a falsification condition, a verdict); each
Falsify tool runs that draft through the cycle transitions, the domain schemas, and the
rules engine, and **refuses** anything that violates the honesty rules (no falsification
condition → rejected; an experiment that cannot fail → rejected; a consensus appeal →
challenged). No tool invokes an LLM. No tool is non-deterministic given its inputs.

The MCP layer is a thin shell: **the core never imports a transport** (DESIGN.md
Decision 2). All new code lives under `src/mcp/`; nothing in `src/cycle`, `src/rules`,
`src/domain`, `src/knowledge`, or `src/memory` is modified to serve the transport.

---

## Scope Contract

### In scope
- A `McpServer` built from the SDK, registering exactly six `falsify_*` tools.
- A pure **adapter/orchestration layer** (`src/mcp/tools/*`) that maps each tool's
  validated input → core calls (`transition`, schema `.parse`, `applyQuantitativeLens`,
  `OpenBrainMcpClient.recall`) → a structured tool result.
- Per-tool **zod input schemas** registered via `registerTool`, plus structured,
  non-crashing error results when a draft violates an honesty rule.
- **Stateless cycle threading**: each tool accepts the current `cycleState` and returns
  the resulting `cycleState` + `legalNext` events, so the caller (host agent, later the
  web UI) threads state. The server holds no per-inquiry session state.
- A **stdio** entrypoint (`src/mcp/server.ts` + a `bin`) for local agent integration.
- In-process integration tests using `InMemoryTransport.createLinkedPair()` (a real
  `Client` ↔ the real `McpServer`) — no process spawn, no real network.
- README/usage doc snippet showing how to register the server in an MCP host
  (`.vscode/mcp.json` / `claude` config) — documentation only.

### Out of scope (defer to later phases)
- The Web UI / HTTP transport / SSE server transport (Phase 3).
- Any LLM call, content generation, or prompt template inside a tool.
- Server-side session persistence, multi-user state, or an inquiry database.
- Changes to the knowledge `*.yaml` seed or the seed-sync pipeline (Phase 1.5, done).
- New scoring signals or re-weighting of `claim_score`.

### Forbidden actions
- **Do not** make the core import a transport. `src/cycle`, `src/rules`, `src/domain`,
  `src/knowledge`, `src/memory` stay transport-free; the MCP shell depends on them, never
  the reverse.
- **Do not** weaken the honesty rule: a `falsify_hypothesize` call with zero
  falsification conditions MUST be rejected (it cannot be coerced through).
- **Do not** weaken consensus-minimization: no tool may let institutional consensus
  decide a verdict, and `falsify_intake` MUST still flag/challenge consensus appeals.
- **Do not** let a tool throw an uncaught error that crashes the server process — a bad
  draft yields a structured `isError` result, not a transport-level crash.
- **Do not** log, echo, or commit `OPENBRAIN_KEY` (64-char hex) or any header value.
- **Do not** make a real network call in any test; `falsify_recall` is tested against an
  injected fake `MemoryReader`.
- **Do not** edit `.github/`, `pforge-*`, `.forge.json`, or `docs/plans/auto/`.

---

## Required Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | **Primary transport** | **stdio** first; SSE/HTTP deferred to Phase 3. | stdio is the universal local-agent transport (Copilot/Claude/Cursor); SSE/HTTP belongs with the Web UI consumer. |
| 2 | **Server API** | High-level `McpServer.registerTool(name, { description, inputSchema, outputSchema? }, handler)` from `@modelcontextprotocol/sdk/server/mcp.js`. | `registerTool` (not the deprecated `tool`) gives zod input validation + advertised schemas for free. |
| 3 | **Cycle state across calls** | **Stateless** — each tool takes `cycleState` in and returns `cycleState` + `legalNext` out. No server session store. | Matches the pure-core ethos; idempotent, trivially testable; no hidden state to leak. The host threads state. |
| 4 | **Who generates content** | The **host agent** drafts; Falsify tools **validate + structure + refuse**. No tool calls an LLM. | DESIGN.md §9 Phase A: "make Falsify's discipline usable inside Copilot." Discipline = enforcement, not generation. |
| 5 | **Mandatory review on Yes** | `falsify_analyze` with `verdict: 'yes'` returns `reviewRequired: true` and routes to `falsify_review` BEFORE `theory` is allowed; review with `outcome: 'confirm'` then yields `theory`. | DESIGN.md §3 hard behavior: "Review branch is mandatory before any Yes is finalized." Policy lives in the adapter; the pure state machine stays unchanged. |
| 6 | **Falsifiability detection in `falsify_intake`** | Deterministic **checklist heuristic**: flag normative/value/definitional/unfalsifiable phrasings and known consensus-appeal phrases; otherwise `falsifiable: true` with a prompt to state a falsification condition. Model judgment stays with the host. | DESIGN's "heuristics + checklist" portion is deterministic and testable; AI-hard judgment is explicitly out of scope. |
| 7 | **Tool result shape** | `content: [{ type: 'text', text: JSON.stringify(payload) }]`; failures set `isError: true` with a `{ error, rule, guidance }` payload. | Standard MCP text content; structured JSON stays machine-readable for the host and the future web UI. |
| 8 | **Recall dependency** | `falsify_recall` depends on a narrow `MemoryReader` interface (`recall(query): Promise<...>`), satisfied by `OpenBrainMcpClient` and injectable as a fake in tests. | Keeps the tool testable offline; reuses the live MCP seed client; graceful degradation when the brain is unreachable. |

---

## Acceptance Criteria

### MUST
- `npm run build`, `npm test`, `npm run lint` are green; `npm audit` reports 0 vulnerabilities.
- The server registers exactly the six tools `falsify_intake`, `falsify_hypothesize`,
  `falsify_experiment`, `falsify_analyze`, `falsify_review`, `falsify_recall`, and a
  connected `Client.listTools()` returns all six with descriptions and input schemas.
- `falsify_hypothesize` with an empty/absent `falsificationConditions` array returns an
  `isError` result citing the honesty rule — proven by a test.
- `falsify_experiment` with `couldFail !== true` returns an `isError` result — proven by a test.
- `falsify_analyze` with `verdict: 'yes'` returns `reviewRequired: true` and does **not**
  advance to `theory` until `falsify_review` runs with `outcome: 'confirm'` — proven by a test.
- `falsify_intake` flags a consensus appeal (e.g. "the science is settled", "experts
  agree") and returns the challenge string from DESIGN.md §3 — proven by a test.
- Each forward tool returns the correct next `cycleState` and `legalNext` per the Phase 1
  transition table; an illegal `cycleState`/event pairing yields an `isError`, not a crash.
- `falsify_recall` returns results from an injected fake `MemoryReader` and degrades to a
  structured `isError` (no crash, no key leak) when the reader throws — proven by tests.
- A full-cycle integration test drives intake → hypothesize → experiment → analyze →
  review → (revise loop AND confirm→theory) entirely through the MCP `Client`.
- `OPENBRAIN_KEY` never appears in any tool result, log, error message, test fixture, or commit.

### SHOULD
- The stdio entrypoint is runnable (`node dist/src/mcp/server.js`) and exposed as a `bin`.
- Tool descriptions teach the discipline (e.g. hypothesize's description states the
  ≥1-falsification-condition rule) so a host agent self-corrects.
- A README "Use Falsify inside your agent" section shows the MCP host registration JSON.
- Line coverage for `src/mcp/**` ≥ 85%.

---

## Execution Slices

### Slice 1 — Server harness + tool registry + `falsify_intake` [sequential]
**Goal**: A bootable `McpServer` with the dispatch/result framework and the first tool.
**Depends On**: Phase 1 (core complete).
**Context Files**: `DESIGN.md` (§3, §9 Decision 2), `src/cycle/stateMachine.ts`, `src/domain/schemas.ts`, `.github/instructions/clean-code.instructions.md`
**Work**:
- `src/mcp/result.ts` — `ok(payload)` / `fail(error, rule, guidance)` helpers that build
  the MCP `content`/`isError` shape (Decision 7); a `withState(payload, state)` that
  appends `cycleState` + `legalNext` from `legalEvents(state)`.
- `src/mcp/tools/intake.ts` — `falsify_intake({ question, cycleState? })`: checklist
  heuristic for falsifiability + consensus-appeal detection; returns
  `{ falsifiable, reason, reframedHint?, consensusAppeal?, challenge? }` advanced to
  `hypothesis` when falsifiable (Decision 6). Export the zod input schema + handler.
- `src/mcp/server.ts` — `createFalsifyServer(deps?)` returns a configured `McpServer`
  (name `falsify`, version from package), registering `falsify_intake` via `registerTool`.
  A separate `main()` connects it to `StdioServerTransport` (guarded by an
  `import.meta.url` entry check, so importing the module never starts the transport).
- `tests/mcp/server.test.ts` — connect a real `Client` over
  `InMemoryTransport.createLinkedPair()`; assert `listTools()` includes `falsify_intake`;
  call it on a plain empirical question → `falsifiable: true`, state `hypothesis`; call it
  on "the science is settled, experts agree" → `consensusAppeal: true` + challenge string.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 2 — `falsify_hypothesize` (honesty rule + quantitative lens) [sequential]
**Goal**: Validate a candidate hypothesis and enforce ≥1 falsification condition.
**Depends On**: Slice 1
**Context Files**: `src/domain/schemas.ts` (`HypothesisSchema`), `src/rules/quantitative.ts`, `src/knowledge/loader.ts`, `DESIGN.md` (§3, §4)
**Work**:
- `src/mcp/tools/hypothesize.ts` — input `{ statement, predicts, falsificationConditions[], cycleState? }`.
  Parse through `HypothesisSchema`; on a zod failure for the conditions, return
  `fail(..., rule: 'honesty:falsification-condition-required', ...)`. On success, run
  `applyQuantitativeLens(statement + ' ' + predicts, quantPrinciples)` (principles loaded
  once via `loadAllKnowledge`, injectable for tests) and return the hypothesis card +
  `quantFlags`, advanced `intake|hypothesis → hypothesis`/`experiment` per the transition.
- Register the tool in `createFalsifyServer`; description states the honesty rule (SHOULD).
- `tests/mcp/hypothesize.test.ts` — empty `falsificationConditions` → `isError` citing the
  rule; a valid hypothesis → `ok` with `legalNext: ['experiment']`; a statement containing
  a quantitative trigger surfaces a matching `quantFlag`.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 3 — `falsify_experiment` + `falsify_analyze` (could-fail + verdict routing) [sequential]
**Goal**: Admit only experiments that could fail; route the verdict, honoring mandatory review-on-Yes.
**Depends On**: Slice 2
**Context Files**: `src/domain/schemas.ts` (`ExperimentSchema`, `AnalysisSchema`), `src/cycle/stateMachine.ts`, `DESIGN.md` (§3 hard behaviors)
**Work**:
- `src/mcp/tools/experiment.ts` — input `{ decisiveEvidence[], couldFail, cycleState? }`;
  parse `ExperimentSchema` (`couldFail` literal `true`); `false`/missing → `fail(...,
  rule: 'honesty:experiment-must-be-able-to-fail', ...)`; success advances to `analysis`.
- `src/mcp/tools/analyze.ts` — input `{ verdict, evidenceCited[], cycleState? }`; parse
  `AnalysisSchema`. `verdict: 'no'` → transition `analysis → review` (the No branch).
  `verdict: 'yes'` → return `{ verdict, reviewRequired: true, nextTool: 'falsify_review' }`
  and stay in `analysis` (Decision 5 — do NOT jump to `theory`).
- Register both tools; `tests/mcp/experiment.test.ts` + `tests/mcp/analyze.test.ts` cover
  could-fail rejection, the No-branch routing to `review`, and review-required-on-Yes.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 4 — `falsify_review` (mandatory three questions + loop-back) [sequential]
**Goal**: Enforce the three review questions in order; loop back to hypothesis or finalize a theory.
**Depends On**: Slice 3
**Context Files**: `DESIGN.md` (§3 — "ask the three questions in order"), `src/cycle/stateMachine.ts`
**Work**:
- `src/mcp/tools/review.ts` — input `{ q1Methods, q2Hypothesis, q3Theory, outcome, cycleState? }`
  where `outcome ∈ {'revise','confirm'}`. All three answers required, non-empty, in order;
  a missing/blank answer → `fail(..., rule: 'review:three-questions-required', ...)`.
  `outcome: 'revise'` → `transition('review','revise')` → `hypothesis` (the loop).
  `outcome: 'confirm'` (only valid after a Yes that required review) → `transition('analysis','confirm')`
  → `theory` terminal; the tool documents that confirm finalizes the mandatory-review path.
- Register the tool; `tests/mcp/review.test.ts` — blank `q2` → `isError`; `revise` loops to
  `hypothesis`; `confirm` reaches terminal `theory` with empty `legalNext`.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 5 — `falsify_recall` + entrypoint + full-cycle integration + docs [sequential]
**Goal**: Wire memory recall (graceful offline), ship the runnable server, prove an end-to-end cycle.
**Depends On**: Slices 1–4
**Context Files**: `src/memory/openbrainMcpClient.ts`, `src/memory/openbrainClient.ts` (`MemoryWriter`), `.github/instructions/security.instructions.md`, `.github/instructions/errorhandling.instructions.md`
**Work**:
- `src/mcp/tools/recall.ts` — input `{ query, limit? }`; depends on a narrow `MemoryReader`
  interface (`recall(query): Promise<unknown>`) injected into `createFalsifyServer`
  (default: a lazily-constructed `OpenBrainMcpClient` from validated env). On reader error,
  return `fail(..., rule: 'recall:brain-unreachable', ...)` — never crash, never leak the key.
- `src/mcp/server.ts` — finalize `bin` wiring; add `"falsify-mcp": "dist/src/mcp/server.js"`
  to `package.json` `bin`; barrel-export `src/mcp/*` from `src/index.ts`.
- `tests/mcp/recall.test.ts` — fake `MemoryReader` returns hits → `ok`; throwing reader →
  structured `isError`, and assert the key string never appears in the result.
- `tests/mcp/cycle.integration.test.ts` — one `Client` drives the full loop: intake →
  hypothesize → experiment → analyze(no) → review(revise) → hypothesize → analyze(yes) →
  review(confirm) → theory; assert each `cycleState` transition.
- `README.md` — add "Use Falsify inside your agent" with the MCP host registration JSON.

**Validation Gate**:
```bash
npm run build
npm test
npm run lint
npm audit
```

---

## Re-anchor Checkpoints
- **After Slice 1**: confirm importing `src/mcp/server.ts` does NOT open stdio (entry guard
  works) and that no `src/cycle|rules|domain|knowledge|memory` file was modified.
- **After Slice 3**: re-read DESIGN.md §3 hard behaviors — verify review-on-Yes is enforced
  at the adapter and the pure state machine table is untouched.
- **After Slice 4**: re-read DESIGN.md §3 review table — confirm the three questions are
  required in order and `revise` loops to `hypothesis`.
- **Before Slice 5**: confirm `falsify_recall` has no real network in tests and that
  `OPENBRAIN_KEY` is read only from env, never embedded.

---

## Definition of Done
- [ ] All 5 slices complete; `npm run build`, `npm test`, `npm run lint`, `npm audit` green.
- [ ] All **MUST** acceptance criteria met and each traceable to a passing test.
- [ ] Six `falsify_*` tools registered and listed via a connected `Client`.
- [ ] Honesty rule (≥1 falsification condition) and could-fail rule enforced at the tool
      boundary, proven by `isError` tests.
- [ ] Mandatory review-on-Yes enforced; consensus appeal challenged by `falsify_intake`.
- [ ] The core remains transport-free (no transport import under `src/cycle|rules|domain|knowledge|memory`).
- [ ] No secret value in any log, error, fixture, or commit.
- [ ] `docs/PROJECT-CONTEXT.md` status + session log updated; `DEPLOYMENT-ROADMAP.md`
      Phase 2 status set to ✅.
- [ ] Reviewer Gate passed (zero 🔴 Critical).

---

## Stop Conditions
- **Build failure**: `npm run build` errors unresolvable within the slice scope — stop, report.
- **Test failure**: a MUST-linked test fails and the fix would expand scope — stop, report.
- **Scope violation**: work drifts into the Web UI, an HTTP/SSE transport, LLM calls, or
  server-side session state — stop, re-anchor to the Scope Contract.
- **Core contamination**: a change would make `src/cycle|rules|domain|knowledge|memory`
  import a transport — stop; relocate the logic to `src/mcp/`.
- **Security breach**: any path that would log/commit `OPENBRAIN_KEY` or make a real network
  call in a test — stop immediately, do not proceed.
- **SDK-contract conflict**: `registerTool` / `InMemoryTransport` / `StdioServerTransport`
  behave differently than assumed (signature or runtime) — stop and reconcile against the
  installed `@modelcontextprotocol/sdk` before forcing a workaround.

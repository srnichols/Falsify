---
plan: Phase-3-WEB-UI
status: planned
owner: srnichols
preset: typescript
package_manager: npm
created: 2026-06-15
---

# Phase 3 — Web UI (hypothesis card + visible-mistakes notebook)

> **One-line goal**: A thin browser front-end that is *just another consumer* of the
> same transport-free core — it renders the hypothesis-card output and the
> visible-mistakes notebook, driven by a local HTTP/JSON API over the cycle engine.

---

## Goal

Ship the second transport from DESIGN.md Decision 2 (Phase B): a **web UI** that
surfaces (1) the **hypothesis card** — a claim with its falsification conditions and
the cycle state — and (2) the **visible-mistakes notebook** — wrong hypotheses kept
legible with a dated strike-through, "the falsification loop made visible" (DESIGN.md
§5). The browser talks to a local **HTTP/JSON API** that calls the *exact same*
discipline logic the MCP tools call, so neither transport can drift or weaken the
honesty rules.

To guarantee that single source of truth, Phase 3 first **extracts the cycle
operations** out of the MCP tool handlers into a transport-neutral core module that
both the MCP server and the new HTTP API delegate to. The core still never imports a
transport (DESIGN.md Decision 2); the HTTP server and the static front-end live in a
new `src/web/` + `public/` and depend on the core, never the reverse.

The UI is deliberately **thin**: no SPA framework, no bundler. The tested contract is
the HTTP API; the front-end is hand-authored static assets the API server serves.

---

## Scope Contract

### In scope
- A **Notebook tier** store (`src/memory/notebook.ts`): durable, append-only,
  per-project JSONL at `.falsify/notebook/`. A wrong hypothesis is **struck through
  and dated, never deleted** (DESIGN.md §5 memory commitment). API: `record`,
  `strikeThrough`, `list`.
- A **transport-neutral operations layer** (`src/cycle/operations.ts`): the honesty
  rules, cycle routing, and quant lens extracted from `src/mcp/tools/*` into pure
  functions returning a neutral `OpResult` (`ok | error{message,rule,guidance}`).
- The MCP tools refactored to **delegate** to the operations layer — behavior
  preserved, all Phase 2 tests stay green (no honesty rule weakened).
- A local **HTTP/JSON API** (`src/web/server.ts` + `src/web/api.ts`) over `node:http`
  (zero new runtime deps): `POST /api/{intake,hypothesize,experiment,analyze,review,recall}`
  and `GET/POST /api/notebook`, each zod-validated, each calling the operations layer.
- A **static front-end** (`public/index.html` + `public/app.js` + `public/styles.css`):
  a hypothesis-card view and a notebook view, served by the API server.
- A `falsify-web` **bin** + entry-guarded `main()`, an end-to-end test that drives the
  cycle over HTTP, and a README "Run the Falsify web UI" section.

### Out of scope (defer / not now)
- Any SPA framework (React/Vue/Svelte), bundler (Vite/webpack), or CSS framework.
- Authentication / multi-user / accounts — the server binds to `127.0.0.1` for a
  single local user.
- The multi-model Quorum fan-out (DESIGN.md §6) — a later phase; the UI shows the
  single-core output only.
- Persisting Working-tier session state server-side (the cycle stays stateless;
  the browser threads `cycleState`, exactly as the MCP transport does).
- Any change to the knowledge `*.yaml` seed, the scoring weights, or the OpenBrain
  client transport.

### Forbidden actions
- **Do not** make the core import a transport. `src/web/` depends on `src/cycle`,
  `src/domain`, `src/rules`, `src/knowledge`, `src/memory`; never the reverse.
- **Do not** weaken any honesty rule during the extraction: a hypothesis with no
  falsification condition, an experiment that cannot fail, and a Yes that skipped
  review MUST still be rejected — over **both** transports, proven by tests.
- **Do not** add the DOM lib to the core `tsconfig`. The browser code is plain
  hand-authored `public/*.js` (no TS build), so the `tsc` build stays DOM-free.
- **Do not** ever delete a notebook entry — strike-through only (append-only store).
- **Do not** log, echo, or commit `OPENBRAIN_KEY`; `falsify_recall`/`/api/recall`
  return a structured error on brain failure, never the key.
- **Do not** serve files outside `public/` (path-traversal guard) and **do not**
  bind to `0.0.0.0` by default.
- **Do not** make a real network call in any test (recall uses an injected reader).
- **Do not** edit `.github/`, `pforge-*`, `.forge.json`, or `docs/plans/auto/`.

---

## Required Decisions

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 1 | **HTTP framework** | **None — Node built-in `node:http`.** | Zero new runtime deps keeps `npm audit` at 0 and honors the npm/node/npx gate; the API surface is tiny. |
| 2 | **Front-end framework / build** | **None — hand-authored static `public/*` (HTML + vanilla JS + CSS), no bundler.** | DESIGN.md calls the UI "thin"; a bundler/SPA adds deps, audit surface, and a second build. Keeps the core `tsc` build DOM-free. |
| 3 | **Shared logic** | **Extract `src/cycle/operations.ts`**; MCP tools + HTTP API both delegate. | Single source of truth for the discipline — the only safe way to run two transports without one drifting/weakening the honesty rule. |
| 4 | **Cycle state** | **Stateless**, identical to MCP: request carries `cycleState`; response returns `cycleState` + `legalNext`. The browser threads it. | Mirrors Phase 2; no server session store to leak or desync. |
| 5 | **Notebook backend** | **Append-only JSONL** at `.falsify/notebook/<project>.jsonl`; strike-through is a new appended event referencing the original id. | "Mistakes stay in the notebook" (DESIGN.md §5) — history is immutable; the struck state is derived on `list`. |
| 6 | **Recall in the API** | `/api/recall` depends on the same injected `MemoryReader`; degrades to a structured `recall:brain-unreachable`. | Reuses Phase 2's offline-safe path; tests stay network-free. |
| 7 | **Binding & safety** | Bind `127.0.0.1`, port from `FALSIFY_WEB_PORT` (default `4319`); JSON body size cap; static serving resolves within `public/` only; same-origin (no permissive CORS). | OWASP boundary hygiene for a local tool: no traversal, no unbounded body, no open bind, no secret in responses. |
| 8 | **Result mapping** | `OpResult.ok` → HTTP `200` JSON payload; `OpResult.error` → HTTP `422` `{error,rule,guidance}`; bad request shape → `400`; unknown route → `404`. | Honest, machine-readable status codes; the rule name travels to the client for self-correction, same as the MCP `isError` payload. |

---

## Acceptance Criteria

### MUST
- `npm run build`, `npm test`, `npm run lint` are green; `npm audit` reports 0 vulnerabilities; **no new runtime dependency** is added.
- The extraction is behavior-preserving: **all Phase 2 MCP tests still pass unchanged**, and the honesty-rule rejections (no falsification condition; experiment that cannot fail; Yes-without-review) are proven over the HTTP transport too.
- The Notebook store is append-only: a `strikeThrough` never removes the original line; `list` reports the entry as struck + dated; a test asserts the underlying file still contains the original record.
- The HTTP API exposes the six cycle routes + notebook routes, each zod-validated; a malformed body yields `400`, a discipline violation yields `422` with `{error,rule,guidance}`, an unknown route yields `404`.
- A path-traversal request (e.g. `GET /../package.json`) is refused (no file outside `public/` is served), proven by a test.
- The server binds `127.0.0.1` and never includes `OPENBRAIN_KEY` in any response or log, proven by a test where the injected reader throws a key-bearing error.
- An end-to-end test drives intake → hypothesize → experiment → analyze(no) → review(revise) → … → analyze(yes) → review(confirm) → theory entirely over HTTP against a real `node:http` server.
- The static front-end is served: `GET /` returns the `index.html` (content-type `text/html`) and the JS/CSS assets return their correct content-types.

### SHOULD
- The `falsify-web` bin starts the server (`node dist/src/web/server.js`) and logs the local URL; importing the module never starts it (entry guard).
- The hypothesis card visibly shows the falsification conditions and the current cycle state; the notebook view renders struck entries with a legible dated strike-through.
- A README "Run the Falsify web UI" section documents the port env var and the localhost-only binding.
- Line coverage for `src/web/**` and `src/memory/notebook.ts` ≥ 85%.

---

## Execution Slices

### Slice 1 — Notebook tier store (visible mistakes) [sequential]
**Goal**: A durable, append-only notebook where wrong hypotheses are struck, not deleted.
**Depends On**: Phase 1 (core complete).
**Context Files**: `DESIGN.md` (§5 memory tiers + commitments), `src/memory/offlineQueue.ts` (JSONL/fs pattern), `.github/instructions/clean-code.instructions.md`
**Work**:
- `src/memory/notebook.ts` — `NotebookStore(dir, project)`:
  - `record(entry)` appends a `{ id, kind, text, createdAt }` JSON line.
  - `strikeThrough(id, reason)` appends a `{ kind: 'strike', refId, reason, struckAt }` event — never rewrites or removes prior lines.
  - `list()` folds the event log into `{ id, text, createdAt, struck?: { reason, struckAt } }[]`.
- `tests/memory/notebook.test.ts` — record→list round-trips; strikeThrough marks struck + dated; assert the original record line is still physically present after a strike (never deleted); a strike for an unknown id is a no-op/typed error (no crash).

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 2 — Transport-neutral cycle operations (extract from MCP tools) [sequential]
**Goal**: One source of truth for the discipline; both transports delegate to it.
**Depends On**: Slice 1
**Context Files**: `src/mcp/tools/*.ts`, `src/mcp/result.ts`, `src/cycle/stateMachine.ts`, `src/domain/schemas.ts`, `src/rules/quantitative.ts`, `DESIGN.md` (§3, §4)
**Work**:
- `src/cycle/operations.ts` — neutral result `OpResult = { kind:'ok', payload } | { kind:'error', error, rule, guidance }` and pure functions `intake`, `hypothesize`, `experiment`, `analyze`, `review`, plus a `recall` orchestrator taking a `MemoryReader`. These hold the honesty rules, quant lens, and cycle routing (including mandatory review-on-Yes) lifted verbatim from the Phase 2 handlers.
- Refactor `src/mcp/tools/*.ts` to call the operations and map `OpResult` → `CallToolResult` via `result.ts` (keep `ok`/`fail`/`withState` as the MCP mapper).
- `tests/cycle/operations.test.ts` — unit-test each operation's ok/error directly.
- Re-run the Phase 2 suite unchanged to prove no behavior drift.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 3 — HTTP/JSON API over the core [sequential]
**Goal**: A localhost HTTP server exposing the operations, safe at the boundary.
**Depends On**: Slice 2
**Context Files**: `src/cycle/operations.ts`, `src/memory/notebook.ts`, `.github/instructions/security.instructions.md`, `.github/instructions/errorhandling.instructions.md`
**Work**:
- `src/web/api.ts` — a pure `handleRequest(method, path, body, deps)` that zod-validates the body, dispatches to the operations / notebook store, and returns `{ status, json }` (`200` ok, `422` discipline error, `400` bad body, `404` unknown). No `http` import here (keeps it unit-testable).
- `src/web/server.ts` — wraps `handleRequest` in a `node:http` server: bind `127.0.0.1`, port from `FALSIFY_WEB_PORT` (default 4319), JSON body-size cap, static-file serving from `public/` with a path-traversal guard and correct content-types; `createWebServer(deps?)` factory + entry-guarded `main()`.
- `tests/web/api.test.ts` — body validation (`400`), discipline error (`422` with rule), unknown route (`404`), recall via injected reader (ok + key-safe error), traversal refused.
- `tests/web/server.test.ts` — boot a real server on an ephemeral port; `fetch` a cycle step end-to-end; assert `127.0.0.1` binding and a key-bearing reader error never appears in the response.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 4 — Static front-end (hypothesis card + notebook view) [sequential]
**Goal**: A thin browser UI that renders the card and the visible-mistakes notebook.
**Depends On**: Slice 3
**Context Files**: `DESIGN.md` (§1 hypothesis-card commitment, §5 visible mistakes), `src/web/server.ts`
**Work**:
- `public/index.html` — a question box, a hypothesis-card panel (statement, predicts, falsification conditions, cycle state + legal next moves), and a notebook panel.
- `public/app.js` — hand-authored vanilla JS: `fetch` the `/api/*` routes, render the card and the notebook (struck entries shown with a dated line-through), thread `cycleState` across steps. No build step.
- `public/styles.css` — minimal styling; the strike-through must stay legible (struck text dimmed but readable, dated).
- `tests/web/static.test.ts` — boot the server; `GET /` → `text/html` containing the card markup; `GET /app.js` → `text/javascript`; `GET /styles.css` → `text/css`.

**Validation Gate**:
```bash
npm run build
npm test
```

---

### Slice 5 — Bin + full-flow integration + docs [sequential]
**Goal**: A runnable web app, an end-to-end proof, and the docs to use it.
**Depends On**: Slices 1–4
**Context Files**: `package.json`, `README.md`, `docs/PROJECT-CONTEXT.md`, `docs/plans/DEPLOYMENT-ROADMAP.md`
**Work**:
- `package.json` — add `"falsify-web": "dist/src/web/server.js"` to `bin`; add a `"web": "node dist/src/web/server.js"` script; barrel-export `src/web/*`, `src/cycle/operations.js`, and `src/memory/notebook.js` from `src/index.ts`.
- `src/web/server.ts` — finalize the shebang + entry guard; log the local URL on start.
- `tests/web/cycle.integration.test.ts` — one HTTP client drives the full loop (intake → … → revise loop → … → theory) and records a struck mistake to the notebook, asserting each `cycleState` and the struck-but-present notebook entry.
- `README.md` — add "Run the Falsify web UI" (build, `npm run web`, `FALSIFY_WEB_PORT`, localhost-only, optional `OPENBRAIN_KEY` for recall).
- Smoke-test the built `falsify-web` bin starts and binds locally.

**Validation Gate**:
```bash
npm run build
npm test
npm run lint
npm audit
```

---

## Re-anchor Checkpoints
- **After Slice 1**: confirm `.falsify/notebook/` is git-ignored (no entry is ever committed) and the store never deletes a line.
- **After Slice 2**: re-run the **entire Phase 2 MCP suite** — it must pass unchanged, proving the extraction did not weaken or alter any honesty rule.
- **After Slice 3**: re-read DESIGN.md §1 commitments — confirm the API still never returns a bare conclusion (only cards/operations) and that the key never leaves the process.
- **Before Slice 5**: confirm no DOM lib leaked into the core `tsconfig` and `src/web/` imports the core, never vice-versa.

---

## Definition of Done
- [ ] All 5 slices complete; `npm run build`, `npm test`, `npm run lint`, `npm audit` green; **no new runtime dependency**.
- [ ] All **MUST** acceptance criteria met and each traceable to a passing test.
- [ ] The operations extraction is behavior-preserving — Phase 2 MCP tests pass unchanged.
- [ ] Honesty rules enforced over **both** transports; the notebook is append-only (mistakes struck, never deleted).
- [ ] Boundary safety proven: localhost binding, path-traversal refused, body cap, no secret in any response or log.
- [ ] The core remains transport-free; the DOM lib is not in the core `tsconfig`.
- [ ] `docs/PROJECT-CONTEXT.md` status + module map + session log updated; `DEPLOYMENT-ROADMAP.md` Phase 3 set to ✅.
- [ ] Reviewer Gate passed (zero 🔴 Critical).

---

## Stop Conditions
- **Build failure**: `npm run build` errors unresolvable within the slice scope — stop, report.
- **Test regression**: any Phase 2 MCP test fails after the Slice 2 extraction — stop; the refactor must be behavior-preserving.
- **Scope violation**: work drifts into an SPA framework, a bundler, auth, or the Quorum fan-out — stop, re-anchor to the Scope Contract.
- **Core contamination**: a change would make the core import a transport or pull the DOM lib into the core `tsconfig` — stop; relocate to `src/web/` / `public/`.
- **Security breach**: any path that would serve a file outside `public/`, bind non-locally by default, log/commit `OPENBRAIN_KEY`, or make a real network call in a test — stop immediately.
- **New-dependency pressure**: if a slice seems to need a web/UI framework to proceed — stop and reconcile with the user before adding any runtime dependency.

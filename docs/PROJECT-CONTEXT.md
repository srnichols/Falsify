# Falsify — Project Context (Agent Handoff)

> **Read this first.** This file is the durable memory for AI agent sessions working on
> Falsify. Chat history does not transfer between VS Code windows/sessions — this file does.
> Keep it current. When you finish meaningful work, update the "Status" and "Session Log".

---

## What Falsify is

A reasoning tool whose core algorithm is the **Cycle of Scientific Enterprise**. It does
**not** return plain LLM answers. It returns **falsifiable hypotheses with explicit test
conditions** — for any claim, it states *what would prove it wrong*.

**Founding commitments (non-negotiable):**
- Every answer is a falsifiable hypothesis + the conditions that would falsify it.
- **Dissent over consensus.** Scientific-consensus signals carry the *smallest* weight in
  scoring; consensus can break ties but can never decide a verdict on its own.
- Honesty about method: unfalsifiable claims are flagged as *outside the method* —
  symmetrically, regardless of which "side" they favor.

## The Cycle (state machine)

`Intake → Hypothesis → Experiment → Analysis → Review → Theory`
(Review can loop back to Hypothesis.) See DESIGN.md §3 for the Mermaid diagram and
state contracts.

## Two subsystems

1. **Process hierarchy** — the Cycle states above (how reasoning flows).
2. **Knowledge hierarchy** — 4 tiers of stored truth (what we reason over).

### Knowledge tiers (NOT named L1–L4, to avoid collision with Plan Forge memory tiers)
| Tier | Weight | Meaning | File |
|------|--------|---------|------|
| **Bedrock** | 1.0 | Conservation laws, invariants — falsified only by extraordinary evidence | knowledge/bedrock.yaml |
| **Established** | 0.8 | Well-confirmed theories (relativity, QM, plate tectonics…) | knowledge/established.yaml |
| **Contested** | 0.5 | Open questions; present every position w/ falsifiability, pick no winner | knowledge/contested.yaml |
| **Quantitative** | cross-cutting | Bayes, base rates, correlation≠causation… a *validator lens*, not a shelf | knowledge/quantitative.yaml |
| **Refuted** | 0 | The graveyard — once-believed claims the method has falsified, with *what killed them* + the lesson. Supports nothing; demonstrates falsification. | knowledge/refuted.yaml |

`claim_score` formula lives in DESIGN.md §4. `w_consensus` is the smallest term.
The Refuted tier carries zero weight by design: it can never raise a claim's score,
only serve as the engine's exhibit of what a successful falsification looks like.

## Storage model — "two stores, one truth"
- **Source of truth:** version-controlled `knowledge/*.yaml` (diff-able, PR-reviewed,
  git history = falsification audit trail).
- **Semantic index:** OpenBrain (pgvector). A *seed-sync* step mirrors the YAML into the
  brain for fuzzy recall. The brain is never canonical for Bedrock.

## Memory tiers (Process side)
- **Working** (in-request scratch) · **Notebook** (per-investigation) · **Corpus** (long-term).
- Corpus backend = **OpenBrain**. See "Integrations" below.

---

## Stack & architecture decisions
1. **Node.js + TypeScript** (ESM) — chosen over .NET because OpenBrain, Plan Forge, and the
   MCP SDK are all Node/ESM. Avoids re-implementing MCP plumbing.
2. **MCP server first, web UI second.** Both consume the same transport-agnostic core.
   MCP tools: `falsify_intake`, `falsify_hypothesize`, `falsify_experiment`,
   `falsify_analyze`, `falsify_review`, `falsify_recall`.
3. **OpenBrain** as the Corpus memory backend (auth = reused env var, see Integrations).
4. **Plan Forge** is the build tool that scaffolds + drives Falsify's construction.

## Build plan (slices) — DESIGN.md §10
1. Core types + Cycle state machine
2. Rules engine (4 tiers + math validator + weighted `claim_score`)
3. OpenBrain client (save/recall + local queue fallback)
4. MCP server (`falsify_*` tools)
5. Web UI (hypothesis card + notebook view)

---

## Integrations

### OpenBrain (Corpus memory)
- **Transport:** the public host `brain.planforge.software` exposes only OpenBrain's
  **MCP-over-SSE** server (its REST API runs on a separate, non-public port). Falsify
  writes via the **`capture_thought`** MCP tool and recalls via **`search_thoughts`**
  (`src/memory/openbrainMcpClient.ts`). The REST client (`src/memory/openbrainClient.ts`)
  is kept for a local/devbox brain that exposes the REST port.
- **Auth:** `x-brain-key` header. **Do NOT hardcode or commit the key.** Falsify *reuses*
  the machine-level env vars that Plan Forge already sets:
  - `OPENBRAIN_KEY` — 64-char hex MCP access key (User-scope env var, secret).
  - `OPENBRAIN_URL` — `https://openbrain.tailfb4202.ts.net/sse` (private Tailscale MCP-SSE).
  - `OPENBRAIN_REST_BASE` — `https://brain.planforge.software` (public host; the MCP client
    derives `/sse` from it, same key works).
- **Project scope:** `FALSIFY_BRAIN_PROJECT=falsify` on every read/write.
- **Health check:** `GET https://brain.planforge.software/health` → `{"status":"healthy",...}`.
- **MCP tools used:** `capture_thought` (save — fields `content, project, source`; no
  metadata field, so structured metadata is folded into `content`), `search_thoughts`
  (recall). Other tools available: `list_thoughts`, `thought_stats`, `update_thought`,
  `delete_thought`, `capture_thoughts`.
- **Rate limiting:** Cloudflare throttles rapid sequential captures (HTTP 429); the client
  throttles + retries with backoff.
- See `.env.example` for the full contract (no secrets in it).

### Plan Forge (build tool)
- Location: `E:\GitHub\Plan-Forge`. Node ESM. Onboarding via `setup.ps1`.
- Onboarding command (run from the Plan Forge checkout):
  `./setup.ps1 -Preset typescript -ProjectPath "E:\GitHub\Falsify" -ProjectName "Falsify"`
- Generates `.forge.json`, `.github/copilot-instructions.md`, `AGENTS.md`, roadmap stub.
- Then run the **Crucible interview** to convert DESIGN.md → hardened plan with slices.

---

## Repo facts
- **GitHub:** `srnichols/Falsify` (public). Default branch `main`.
- **Local path:** `E:\GitHub\Falsify`.
- **Key files:** `DESIGN.md` (the constitution — iterate here), `knowledge/*.yaml`,
  `.env.example`, `docs/` (this handoff).

## Conventions / gotchas
- Windows + PowerShell (pwsh). GitHub CLI authed as `srnichols`.
- Never commit secrets; reuse env vars.
- DESIGN.md is the single source of design truth — update it when decisions change.

---

## Status (keep current)
- [x] Repo created + pushed (`main`)
- [x] DESIGN.md §1–§11 + glossary
- [x] 4 knowledge seed YAMLs (bedrock / established / contested / quantitative)
- [x] **Knowledge expansion** — 51 entries across 5 tiers (bedrock 13, established 13, contested 5, quantitative 13) + new **refuted.yaml graveyard tier** (7: aether, phlogiston, caloric, spontaneous generation, geocentrism, miasma, vacuum-abhorrence)
- [x] **Seed-sync tool** (`src/knowledge/seedSync.ts` + `npm run seed-sync`, `--dry-run`) — mirrors `knowledge/*.yaml` → OpenBrain via the `capture_thought` MCP tool; offline-safe. **Live push complete:** 51/51 memories seeded to the hosted brain (`project: falsify`), exactly 51 thoughts confirmed via `thought_stats`.
- [x] Two-store storage design documented
- [x] Brain key resolved as env-var reuse; `.env.example` added
- [x] `docs/` handoff created
- [x] Plan Forge onboarding (`setup.ps1`, typescript preset) — validation 29/29 PASS
- [x] Crucible interview → hardened Phase 1 plan (`docs/plans/Phase-1-CORE-ENGINE-PLAN.md`), linter 0/0
- [x] **Phase 1 — CORE ENGINE: COMPLETE** (all 5 slices, 48 tests, 95% line coverage, 0 vulns)
  - [x] Slice 1: scaffold (npm + TS strict ESM + vitest v4 + eslint v9 flat)
  - [x] Slice 2: domain types + zod schemas (honesty rule: ≥1 falsification condition enforced)
  - [x] Slice 3: Cycle state machine (`Intake→Hypothesis→Experiment→Analysis→Review→Theory`)
  - [x] Slice 4: knowledge loader + rules engine (`claim_score` — consensus structurally barred from flipping verdicts, proven by test)
  - [x] Slice 5: OpenBrain client + typed config (offline `.falsify/queue` fallback, drain-on-recovery, key never leaks)
- [x] Seed-sync script (push `knowledge/*.yaml` → OpenBrain) — **live-verified over MCP (51/51)**
- [x] Crucible-hardened Phase 2 plan (`docs/plans/Phase-2-MCP-SERVER-PLAN.md`), gate-linter 0/0
- [x] **Phase 2 — MCP SERVER: COMPLETE** (all 5 slices, 96 tests, 0 vulns; stdio `falsify-mcp` bin)
  - [x] Slice 1: server harness + result helpers + `falsify_intake` (consensus-appeal challenge)
  - [x] Slice 2: `falsify_hypothesize` (honesty rule enforced at the tool boundary + quant lens)
  - [x] Slice 3: `falsify_experiment` (could-fail) + `falsify_analyze` (No branch + mandatory review-on-Yes)
  - [x] Slice 4: `falsify_review` (three questions in order; revise-loop vs. confirm-finalize)
  - [x] Slice 5: `falsify_recall` (graceful offline, no key leak) + stdio entrypoint + full-cycle integration test
- [ ] Phase 3: Web UI (hypothesis card + notebook view)
- [ ] Knowledge seed expansion (more entries per tier, via PR)

### Module map (Phase 1 — `src/`)
| Module | Responsibility |
|--------|----------------|
| `domain/schemas.ts` | All zod schemas (knowledge YAML + cycle domain). Honesty rule via `.min(1)` on falsification conditions. |
| `domain/types.ts` | `z.infer` type aliases for every schema. |
| `cycle/stateMachine.ts` | Legal transitions; `transition()` throws `CycleTransitionError` on illegal moves. |
| `knowledge/loader.ts` | Loads + validates the 4 tier YAMLs; `allEntries()` flattens. |
| `rules/claimScore.ts` | **Consensus-minimization core.** `compareClaims()` returns `decidedBy: evidence \| consensus-tiebreak \| tie`; consensus only consulted on exact non-consensus tie. |
| `rules/quantitative.ts` | Cross-cutting validator lens (trigger-substring match → guarded flags). |
| `config.ts` | `loadConfig()` from env; `ConfigError` references field names, never the key value. |
| `memory/openbrainClient.ts` | REST `save`/`recall` via `fetch` (for a local/devbox brain); offline queue + FIFO drain; `BrainHttpError` carries status only. Defines the shared `MemoryWriter` interface. |
| `memory/openbrainMcpClient.ts` | **Hosted-brain client.** `save` via the `capture_thought` MCP tool over SSE, `recall` via `search_thoughts`; folds structured metadata into content; throttle + 429/5xx backoff; same offline queue. Key only ever in the `x-brain-key` header. |
| `memory/offlineQueue.ts` | Transport-agnostic on-disk FIFO queue (`.falsify/queue/`); replays through a caller-supplied `send`, stops at first failure. |
| `cli/seedSync.ts` | `npm run seed-sync` runner (`--dry-run` builds + reports offline; live mode pushes via the MCP client with a 400 ms throttle). |

### Module map (Phase 2 — `src/mcp/`)
| Module | Responsibility |
|--------|----------------|
| `mcp/server.ts` | `createFalsifyServer(deps?)` builds the `McpServer` and registers the six `falsify_*` tools; the core never imports a transport. `main()` connects stdio only when run directly (entry-point guard). Shebang → `falsify-mcp` bin. |
| `mcp/result.ts` | `ok` / `fail(error, rule, guidance)` / `withState` helpers (the single `CallToolResult` shape) and `advance()` — converts an illegal cycle move into a structured `cycle:illegal-transition` failure instead of a throw. |
| `mcp/deps.ts` | `FalsifyServerDeps` (injected `memory`, `quantPrinciples`) and the narrow `MemoryReader` interface (matches `OpenBrainMcpClient.recall`). |
| `mcp/tools/intake.ts` | `falsify_intake` — deterministic falsifiability checklist + consensus-appeal detection answered with the DESIGN.md challenge. |
| `mcp/tools/hypothesize.ts` | `falsify_hypothesize` — enforces ≥1 falsification condition (`honesty:*`) at the tool boundary; applies the quantitative lens. |
| `mcp/tools/experiment.ts` | `falsify_experiment` — refuses a test that cannot fail (`couldFail` literal true). |
| `mcp/tools/analyze.ts` | `falsify_analyze` — routes the No branch to Review; a Yes is NOT final (`reviewRequired`). |
| `mcp/tools/review.ts` | `falsify_review` — three questions in order; `revise`→Hypothesis, `confirm`→Theory (the only place a Theory finalizes). |
| `mcp/tools/recall.ts` | `falsify_recall` — semantic recall via the injected `MemoryReader`; degrades to `recall:brain-unreachable`, never leaks the key. |

### Commands
- `npm run build` (tsc) · `npm test` (vitest run) · `npm run dev` (watch) · `npm run lint` (eslint src tests)
- `node dist/src/mcp/server.js` (run the MCP server over stdio; also the `falsify-mcp` bin)
- Coverage: `npx vitest run --coverage` (v8 provider).
- **Gate runner allowlist = `node` / `npm` / `npx` only** (no pnpm). TS imports require `.js` extensions (NodeNext).

### Plan Forge layout (added by onboarding)
- `docs/plans/` — plan pipeline (`AI-Plan-Hardening-Runbook*.md`, `DEPLOYMENT-ROADMAP.md`).
  Hardened phase plans live here. Authoritative plan format = the runbook.
- `.github/{prompts,agents,skills,instructions}/` — pipeline prompts (`step0`–`step6`),
  reviewer agents, skills, stack instructions.
- `pforge.ps1` — CLI. Useful: `status`, `new-phase <name>`, `run-plan <plan>`, `diff <plan>`,
  `analyze <plan>`, `crucible status`, `mcp-call <tool>`.
- `.vscode/mcp.json` — plan-forge MCP server (git-ignored; only in the window opened to this folder).
  Interactive Crucible = `forge_crucible_submit` via that server, OR drive the `step*` prompts.
- Runtime dirs `pforge-mcp/ pforge-master/ pforge-sdk/` are vendored (node_modules ignored).

## Session Log
- **2026-06-15** — Resolved brain key as env-var reuse (not copied). Created 4 tiered
  knowledge seed YAMLs + two-store storage design in DESIGN.md. Added `.env.example`.
  Created this `docs/` handoff. Ran Plan Forge onboarding (typescript preset, 874 files,
  validation 29/29 PASS). Next: Crucible hardening interview → first phase plan in `docs/plans/`.
- **2026-06-15 (cont.)** — Hardened Phase 1 plan via Crucible (8 decisions resolved, linter
  0/0). Built **all 5 Phase 1 slices TDD**, each committed with green build/test/lint:
  scaffold → schemas → state machine → loader+rules → OpenBrain client. Switched pnpm→npm
  (gate allowlist); vitest v2→v4 (cleared 5 esbuild vulns → 0). `claim_score` consensus-
  minimization proven by test (consensus cannot flip a verdict, only break exact ties).
  OpenBrain client degrades gracefully to a local `.falsify/queue` when offline and drains
  on recovery; the `x-brain-key` never appears in any error/log (tested). **48 tests,
  95.27% line coverage, 100% functions, 0 vulnerabilities.** HEAD `2ad662e`.
  **Phase 1 CORE ENGINE complete.** Next: seed-sync script, then Phase 2 (MCP server).
- **2026-06-15 (knowledge expansion)** — Audited the seed corpus and grew it from 19 to
  **51 entries**. Added a **5th tier, `refuted.yaml` (the graveyard, weight 0)**: claims
  once believed that the method falsified, each recording `falsified_by` + the `lesson`
  (aether, phlogiston, caloric, spontaneous generation, geocentrism, miasma, "nature
  abhors a vacuum"). Extended bedrock (+angular momentum, mass conservation, equivalence
  principle, Pauli, uncertainty, 0th law, DNA base-pairing), established (+evolution, cell
  theory, central dogma, atomic theory, Newtonian gravitation, E=mc^2, Standard Model),
  contested (+abiogenesis, consciousness), quantitative (+deterministic chaos, Simpson's
  paradox, multiple comparisons, prosecutor's fallacy, dimensional analysis, Godel limits).
  Deliberately NO math-proof tier: proofs are deductive, not empirically falsifiable, so a
  proof shelf would contradict the mission — math appears only as reasoning *lenses*.
  Schema + loader extended for the refuted tier (weight now `nonnegative`). **51 tests pass.**
- **2026-06-15 (seed-sync)** — Built the seed-sync tool: pure `buildSeedMemories()` converts
  the loaded corpus into `BrainMemory[]` with `metadata: { tier, source_id, falsifiable,
  falsified_if }` + tier-appropriate extras (contested → `falsifiable:'per-position'` +
  positions; quantitative → `'not-applicable'`; refuted → `falsifiable:true` + `falsified_by`/
  `lesson`; fact → the boolean + `falsified_if`). `syncSeed()` pushes via OpenBrainClient and
  reports a summary; transport failures queue locally and never throw. CLI `npm run seed-sync`
  (`--dry-run` builds + reports with no network). Dry-run verified 51 memories. **60 tests pass.**
  LIVE push to shared OpenBrain deferred pending user go-ahead (write to shared infra).
- **2026-06-15/16 (live seed over MCP)** — Ran the live push and discovered the REST assumption
  was wrong: `brain.planforge.software` fronts only OpenBrain's **MCP-SSE** server (REST runs on a
  separate, non-public port — confirmed by reading the OpenBrain source at `E:\GitHub\OpenBrain`
  and probing the live host: only `/health` answers, everything else 404s). Built an
  **MCP-transport client** (`src/memory/openbrainMcpClient.ts`) using `@modelcontextprotocol/sdk`
  (0 vulns): connects to `/sse` with `x-brain-key`, calls the `capture_thought` / `search_thoughts`
  tools. Since `capture_thought` has no metadata field, structured metadata is **folded into the
  content** as a `— Falsify knowledge seed —` block (`foldMetadataIntoContent`). Extracted a shared
  `OfflineQueue` (`src/memory/offlineQueue.ts`) and a `MemoryWriter` interface so `syncSeed` is
  transport-agnostic; the REST client is retained for a local/devbox brain. Two transport bugs found
  & fixed: (1) header merge via object-spread dropped the SDK's `content-type` → HTTP 400; fixed with
  `new Headers()`. (2) Cloudflare rate-limits rapid captures → HTTP 429; added a 400 ms throttle +
  exponential-backoff retry on transient 429/5xx. **Live result: 51/51 saved, exactly 51 thoughts in
  `project: falsify`** (verified via `thought_stats`; earlier duplicate/probe rows purged with a
  resilient `scripts/purge-project.mjs`). **73 tests pass, lint clean, 0 vulns.** Next: Phase 2 (MCP
  server exposing `falsify_*` tools).
- **2026-06-15 (Phase 2 — MCP server)** — Drafted + gate-linted (0/0) the Crucible-hardened
  `docs/plans/Phase-2-MCP-SERVER-PLAN.md`, then built **all 5 slices TDD**, each committed green.
  Shipped an `McpServer` (`src/mcp/`) exposing the six `falsify_*` tools as **discipline-enforcing
  adapters** over the transport-free core — no tool calls an LLM, none holds session state (the cycle
  is threaded statelessly via `cycleState` in / `cycleState` + `legalNext` out). Enforcement proven by
  tests: `falsify_hypothesize` refuses a hypothesis with no falsification condition
  (`honesty:falsification-condition-required`); `falsify_experiment` refuses a test that cannot fail;
  `falsify_analyze` takes the mandatory No branch and **does not finalize a Yes** (review required);
  `falsify_review` requires the three questions in order and is the only path to a Theory;
  `falsify_intake` flags consensus appeals with the DESIGN.md challenge. `falsify_recall` reaches
  OpenBrain via an injected `MemoryReader`, degrades to `recall:brain-unreachable` offline, and never
  leaks the key (tested). Added a stdio entrypoint + `falsify-mcp` bin (shebang preserved, launch
  smoke-tested) and a full-cycle integration test driving intake→…→theory through a real MCP `Client`
  over `InMemoryTransport`. **96 tests pass, lint clean, 0 vulns.** **Phase 2 complete.** Next: Phase 3
  (Web UI).

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

`claim_score` formula lives in DESIGN.md §4. `w_consensus` is the smallest term.

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
- **Auth:** `x-brain-key` header. **Do NOT hardcode or commit the key.** Falsify *reuses*
  the machine-level env vars that Plan Forge already sets:
  - `OPENBRAIN_KEY` — 64-char hex MCP access key (User-scope env var, secret).
  - `OPENBRAIN_URL` — `https://openbrain.tailfb4202.ts.net/sse` (private Tailscale MCP-SSE).
  - `OPENBRAIN_REST_BASE` — `https://brain.planforge.software` (public REST; same key works).
- **Project scope:** `FALSIFY_BRAIN_PROJECT=falsify` on every read/write.
- **Health check:** `GET https://brain.planforge.software/health` → `{"status":"healthy",...}`.
- REST endpoints: `POST /memories`, `POST /memories/search`, `POST /memories/list`,
  `GET /stats`.
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
- [ ] Seed-sync script (push `knowledge/*.yaml` → OpenBrain with tier metadata)
- [ ] Phase 2: MCP server (`falsify_*` tools)
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
| `memory/openbrainClient.ts` | `save`/`recall` via `fetch`; offline queue + FIFO drain; `BrainHttpError` carries status only. |

### Commands
- `npm run build` (tsc) · `npm test` (vitest run) · `npm run dev` (watch) · `npm run lint` (eslint src tests)
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

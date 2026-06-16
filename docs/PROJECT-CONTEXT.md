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
- [ ] Plan Forge onboarding (`setup.ps1`)
- [ ] Crucible interview → hardened slices
- [ ] Seed-sync script (push `knowledge/*.yaml` → OpenBrain)
- [ ] Slice 1: Core types + Cycle state machine
- [ ] Knowledge seed expansion (more entries per tier, via PR)

## Session Log
- **2026-06-15** — Resolved brain key as env-var reuse (not copied). Created 4 tiered
  knowledge seed YAMLs + two-store storage design in DESIGN.md. Added `.env.example`.
  Created this `docs/` handoff. Next: Plan Forge onboarding + Crucible interview.

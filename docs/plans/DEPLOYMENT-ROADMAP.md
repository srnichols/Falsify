# Deployment Roadmap

> **Purpose**: Master tracker for all project phases.  
> **How to use**: Add phases as they're planned. Link to plan files. Update status as work progresses.

---

## Status Legend

| Icon | Meaning |
|------|---------|
| 📋 | Planned — not yet started |
| 🚧 | In Progress — actively being worked on |
| ✅ | Complete — all Definition of Done criteria met |
| ⏸️ | Paused — blocked or deprioritized |

---

## Phases

### Phase 1: Core Engine + Memory Client
**Goal**: Pure reasoning core — Cycle state machine, typed/validated knowledge + hypothesis contracts, tiered rules engine with consensus-minimized `claim_score`, and an OpenBrain client with offline fallback. No MCP/UI.  
**Plan**: [Phase-1-CORE-ENGINE-PLAN.md](./Phase-1-CORE-ENGINE-PLAN.md)  
**Status**: ✅ Complete — 5/5 slices, 48 tests, 95.27% line coverage, 0 vulnerabilities (HEAD `2ad662e`)

---

### Phase 2: MCP Server (`falsify_*` tools)
**Goal**: Expose the core engine as an MCP server (`falsify_intake`, `falsify_hypothesize`, `falsify_experiment`, `falsify_analyze`, `falsify_review`, `falsify_recall`).  
**Plan**: [Phase-2-MCP-SERVER-PLAN.md](./Phase-2-MCP-SERVER-PLAN.md)  
**Status**: ✅ Complete — 5/5 slices, 96 tests, 0 vulnerabilities; stdio `falsify-mcp` bin

---

### Phase 3: Web UI
**Goal**: Hypothesis card + visible-mistakes notebook over the same transport-agnostic core, served by a local HTTP/JSON API.  
**Plan**: [Phase-3-WEB-UI-PLAN.md](./Phase-3-WEB-UI-PLAN.md)  
**Status**: ✅ Complete — 5/5 slices, 135 tests, 0 vulnerabilities; localhost `node:http` API (no new runtime deps) + thin static front-end; `falsify-web` bin

---

<!-- Add more phases as needed. Each phase should link to its *-PLAN.md file. -->

---

## Completed Phases

<!-- Move phases here when they reach ✅ Complete status -->

| Phase | Goal | Plan | Completed |
|-------|------|------|-----------|
| 1 | Core Engine + Memory Client | [Phase-1-CORE-ENGINE-PLAN.md](./Phase-1-CORE-ENGINE-PLAN.md) | 2026-06-15 |
| 2 | MCP Server (`falsify_*` tools) | [Phase-2-MCP-SERVER-PLAN.md](./Phase-2-MCP-SERVER-PLAN.md) | 2026-06-15 |
| 3 | Web UI (HTTP API + static front-end) | [Phase-3-WEB-UI-PLAN.md](./Phase-3-WEB-UI-PLAN.md) | 2026-06-15 |

---

## Notes

- Each phase goes through the [Plan Forge Pipeline](./AI-Plan-Hardening-Runbook-Instructions.md) before execution
- Phase plans are stored in this directory (`docs/plans/`)
- Guardrail files are updated after each phase completion (Step 5 of the pipeline)

# Instructions for Copilot — Falsify

> **Stack**: TypeScript / Node.js (ESM), MCP server + local web UI, Vitest, npm  
> **Last Updated**: 2026-10-15
> **Capabilities and agent guide**: `docs/CAPABILITIES.md`, `AGENTS.md`

---

## Architecture Principles

**BEFORE any code changes, read:** `.github/instructions/architecture-principles.instructions.md`

### Core Rules
1. **Architecture-First** — Ask 5 questions before coding
2. **Separation of Concerns** — Route → Service → Repository
3. **Best Practices Over Speed** — Enterprise-grade, not hacky
4. **TDD for Business Logic** — Red-Green-Refactor
5. **Type Safety** — No `any`, explicit types everywhere

### Red Flags
```
❌ "as any"              → STOP, add proper types
❌ "@ts-ignore"          → STOP, fix the type error
❌ "copy-paste"          → STOP, extract to utility
❌ "we'll refactor later" → STOP, do it right now
```

---

## Project Overview

**Description**: Falsify runs questions through the Cycle of Scientific Enterprise (intake →
hypothesis → experiment → analysis → review) and refuses steps that break scientific discipline.
It exposes ten `falsify_*` MCP tools and a local web UI over one transport-neutral core
(`src/cycle/operations.ts`). It never generates an answer; consensus is a low-weight signal and
can never decide a verdict. Full surface: `docs/CAPABILITIES.md`; design: `DESIGN.md`.

**Using Falsify to investigate a question?** Read
`.github/instructions/falsify-inquiry.instructions.md` and follow the `falsify-inquiry` skill.
Never invent a statistic, DOI or search; run the opposite framing too (`mirrorOf`).

**Tech Stack**:
- Runtime: Node.js 22+, TypeScript (strict, ESM / NodeNext), zod for validation
- Transports: MCP over stdio (`@modelcontextprotocol/sdk`), plain `node:http` for the web UI (no framework)
- Knowledge: `knowledge/*.yaml` is the source of truth; OpenBrain is an optional searchable mirror
- Local state: `.falsify/` (sessions, notebook, outcomes), git-ignored
- Testing: Vitest (unit, integration, stdio end-to-end)
- Package Manager: npm (single package, not a monorepo)

---

## Coding Standards

### TypeScript Style
- **Strict mode**: Enabled — no implicit any
- **Named exports**: Prefer over default exports
- **Interfaces**: For object shapes; types for unions/intersections
- **Zod**: For runtime validation of external data
- **Functional**: Prefer pure functions, minimize class usage

### Where logic lives in this repo
```typescript
// Transport adapter (MCP tool or web route): validate input with zod, call one op*, map the result.
// The discipline itself lives in src/cycle/operations.ts and src/rules/*; adapters add none.
const result = opAnalyze(input, ctx);          // pure, transport-neutral, returns ok | error{rule,error,guidance}
```
Refusals carry a named `rule`, an `error` and `guidance`. Add a test that fails without every new rule.

### Data
There is no database. Sessions, the notebook and outcomes are files under `.falsify/`
(`FALSIFY_DATA_DIR` to move them); the corpus is YAML under `knowledge/`.

### Testing
- **Vitest** for unit, integration and stdio end-to-end (`tests/mcp/stdio.e2e.test.ts` needs `npm run build` first)
- `tests/docs/capabilities.test.ts` fails when code and `docs/CAPABILITIES.md` drift: update the doc with the code

---

## Quick Commands

```bash
npm install                     # Install dependencies
npm run build                   # Compile to dist/ (needed before running the server)
npm test                        # Run all tests
npm run lint                    # eslint src tests
npm run web                     # Local web UI (http://127.0.0.1:4319)
npm run knowledge -- lint       # Validate the corpus
npm run calibrate               # Score the labelled historical cases
```

After rebuilding, restart the `falsify` server in your MCP host; a running server keeps the old build.

---

## Planning & Execution

This project uses the **Plan Forge Pipeline**:
- **Runbook**: `docs/plans/AI-Plan-Hardening-Runbook.md`
- **Instructions**: `docs/plans/AI-Plan-Hardening-Runbook-Instructions.md`
- **Roadmap**: `docs/plans/DEPLOYMENT-ROADMAP.md`

### Instruction Files

| File | Domain |
|------|--------|
| `architecture-principles.instructions.md` | Core architecture rules |
| `falsify-inquiry.instructions.md` | Using the Falsify tools honestly (agents investigating a question) |
| `testing.instructions.md` | Vitest patterns |
| `security.instructions.md` | Validation, secrets |
| `git-workflow.instructions.md` | Commit conventions |

Several other `.github/instructions/*.instructions.md` files (database, frontend, Dapr, GraphQL,
messaging) come from the Plan Forge template and do not apply: this project has no database,
React front-end or message broker.

---

## Code Review Checklist

- [ ] No `any` types (use `unknown` + type guards if needed)
- [ ] No `@ts-ignore` or `@ts-expect-error`
- [ ] Zod validation on all external inputs
- [ ] Error handling with typed errors
- [ ] Async/await (no unhandled promises)
- [ ] Tests included for new features
- [ ] Named exports (no default exports)

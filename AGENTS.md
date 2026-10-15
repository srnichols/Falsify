# Agents & Falsify

> **Project**: Falsify — scientific-method reasoning tools (MCP server + local web UI)
> **Stack**: TypeScript / Node.js (ESM), npm, Vitest
> **Full surface**: [docs/CAPABILITIES.md](./docs/CAPABILITIES.md) (test-checked against the code)

This file serves two kinds of agent: those that **use** Falsify to investigate a question,
and those that **work on** Falsify's code.

---

## If you are using Falsify to investigate a question

Falsify runs a question through intake → hypothesis → experiment → analysis → review and
**refuses** steps that break scientific discipline. It never generates an answer: it checks
what you submit, so it is only as honest as your inputs.

**Read first:** [.github/instructions/falsify-inquiry.instructions.md](./.github/instructions/falsify-inquiry.instructions.md)
(non-negotiables and temper guards), then follow the
[falsify-inquiry skill](./.github/skills/falsify-inquiry/SKILL.md). To audit a finished inquiry, hand its
`sessionId` to the **Falsify Reviewer** agent in a fresh session.

The ten tools (inputs and rules in [docs/CAPABILITIES.md](./docs/CAPABILITIES.md)):

| Step | Tool |
|---|---|
| Is it falsifiable? Start a session; link the opposite framing with `mirrorOf` | `falsify_intake` |
| What knowledge does the claim touch? | `falsify_related` |
| Lock a testable hypothesis | `falsify_hypothesize` |
| State the decisive test | `falsify_experiment` |
| Yes or no, with evidence | `falsify_analyze` |
| The three review questions; confirm or revise | `falsify_review` |
| Check a cited DOI is real | `falsify_verify_source` |
| Compare competing hypotheses | `falsify_dissent` |
| Recall prior knowledge (needs `OPENBRAIN_KEY`) | `falsify_recall` |
| Record what later happened to a confirmed theory | `falsify_outcome` |

Rules that matter most:
1. Carry the `sessionId` through every call. Without it nothing is recorded.
2. Never invent a p-value, sample size, DOI or `outcomesTested`. A refusal is information, not an obstacle.
3. `evidenceSearch` must describe a search you actually ran, including a look for null and contrary results.
4. Consensus is a signal, never evidence. Ask which experiment, and could it have failed.
5. Run the opposite framing too (`mirrorOf`); a one-sided inquiry cannot be rated `supported`.
6. A completed cycle is a process record, not proof. Report the `epistemicStatus` the tool returns.

What Falsify cannot do (it cannot tell whether a paper supports a claim, or whether your
numbers are true) is listed in [docs/CAPABILITIES.md](./docs/CAPABILITIES.md#what-falsify-cannot-do).

---

## If you are working on Falsify's code

**Before any code change, read:** [.github/instructions/architecture-principles.instructions.md](./.github/instructions/architecture-principles.instructions.md).

### Architecture in one paragraph

`src/cycle/operations.ts` holds the discipline as pure `op*` functions returning a
transport-neutral result. The MCP tools (`src/mcp/tools/`) and the web API (`src/web/api.ts`) are
thin adapters over the same operations, so neither transport can weaken a rule. Rules live in
`src/rules/`, sessions and collaborators in `src/cycle/`, the schemas in `src/domain/`, the corpus
in `knowledge/*.yaml` (the source of truth; OpenBrain is only a mirror). Module map:
[docs/PROJECT-CONTEXT.md](./docs/PROJECT-CONTEXT.md).

### Standards

1. **Architecture-first**: put code in the right layer; check for an existing pattern.
2. **TDD for business logic**: red, green, refactor. Every new rule has a test that fails without it.
3. **Typed errors, no unhandled rejections**; refusals carry a `rule`, an `error` and `guidance`.
4. **Type safety**: no `any`, no `@ts-ignore`; zod at external boundaries.
5. **Never present a heuristic as a verdict.** If a check is keyword-based or advisory, say so in the result.

### Commands

```bash
npm install          # dependencies
npm run build        # compile to dist/ (required before running the server or the eval harness)
npm test             # run the tests
npm run lint         # eslint src tests
npm run knowledge -- lint   # validate the corpus
```

After rebuilding, restart the `falsify` server in your MCP host; a running server keeps the old build.

### Keep the docs true

[docs/CAPABILITIES.md](./docs/CAPABILITIES.md) is checked by `tests/docs/capabilities.test.ts`. If you add a tool,
rule id, environment variable, npm script or web route, or change the corpus size, the test fails until
that file says so. Update [DESIGN.md](./DESIGN.md) when a design decision changes.

### Conventions

- Windows + PowerShell. Never commit secrets; read keys from the environment.
- Commit messages follow conventional commits (`feat(scope): ...`).
- Plan Forge (`.github/`, `pforge-*`) is the build tooling; its files are managed by `pforge update`.

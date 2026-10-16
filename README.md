# Falsify

> Follow the data, not the conclusion.

**Falsify helps you test a claim honestly, instead of just believing it.** You bring a
question ("Does caffeine make reactions faster?", "Do most psychology studies replicate?").
Falsify walks you through the steps good science uses, and it **refuses to let you skip the
hard parts**. It never answers the question for you.

![The Falsify dashboard](./docs/images/dashboard.png)

## The idea, in plain English

Most arguments go wrong in the same few ways: a claim nobody could ever prove wrong, a test
rigged to pass, a study picked because it agrees with you, a result that only looks
impressive because ten other things were tried and not mentioned, or "everyone knows it's true"
standing in for evidence. Falsify is a checklist that is **enforced**, so you can't quietly
do those things.

Three ideas sit underneath it:

1. **A claim is only worth testing if something could prove it wrong.** That property is
   called being *falsifiable*. "Caffeine speeds up reaction time" is: a reaction-time test could
   show it doesn't. "Everything happens for a reason" is not: nothing could ever count against
   it. Falsify makes you say, up front, what result would prove you wrong.
2. **Being wrong is a result, not a failure.** Science is a loop, not a straight line. When the
   data disagrees with your prediction, you go back and ask whether the method was sound,
   whether the claim was wrong, and finally whether the underlying theory is. Falsify makes you
   do that, and stops you from rescuing a failed claim by quietly narrowing it.
3. **Popularity is not evidence, and neither is authority.** What most experts believe counts
   for very little here (by design, the smallest weight of anything Falsify measures), and it can
   never decide a verdict on its own. That is not a claim that experts are usually wrong.
   Well-established science gets real weight, but it still has to say what it rests on and what
   would overturn it, held to the same standard as any challenger.

## What it looks like

You type a question. Falsify checks it can be tested at all. You state a hypothesis and the
observations that would prove it wrong. You name the test that would settle it, and confirm it
could really come out against you. Then you record what the evidence shows, with sources, and
answer three review questions. At the end you get a rating of how strong the evidence **you
supplied** is, and a full record of the reasoning. If you take a shortcut, such as a vague
hypothesis, a statistic with no count of how many things were tested, or a citation that turns
out to be about something else, Falsify says no and explains why.

It also keeps a library of more than 200 established facts, open scientific disputes and ideas that
were tested and abandoned. It uses the library to show you what your claim touches. It never
treats the library as the answer.

## What it is not

Falsify records whether the **process** was followed. It is not proof, and it is not a fact
checker. It can't tell whether a paper really supports your claim or whether your numbers are
true: every input comes from you (or your AI assistant), and it is only as honest as they are.
Its scores are educated guesses until you record how past claims turned out. The full list of
limits is in [docs/CAPABILITIES.md](./docs/CAPABILITIES.md#what-falsify-cannot-do).

## Try it in two minutes

You need [Node.js](https://nodejs.org) 22.12 or newer.

```bash
npm install
npm run build
npm run web
```

Then open <http://127.0.0.1:4319> in your browser. Click **Start an inquiry** and try one of the
example questions. The app runs only on your own computer and stores everything in a local
`.falsify` folder.

## Where to go next

| If you want to... | Read |
|---|---|
| Learn the app screen by screen | **[User guide](./docs/USER-GUIDE.md)** |
| Use Falsify from an AI assistant such as GitHub Copilot | [Use Falsify inside your agent](#use-falsify-inside-your-agent-mcp), below |
| See every tool, rule, setting and command | [docs/CAPABILITIES.md](./docs/CAPABILITIES.md) (checked by a test against the code, so it can't go stale) |
| Understand how and why it is built this way | [DESIGN.md](./DESIGN.md) |
| Add to the knowledge library | [Maintain the knowledge corpus](#maintain-the-knowledge-corpus), below |
| Work on it as an AI agent | [AGENTS.md](./AGENTS.md) |

---

## Use Falsify inside your agent (MCP)

If you work with an AI assistant, Falsify can sit behind it as a set of tools the assistant calls
while it reasons. This uses MCP (Model Context Protocol), the standard way assistants such as
GitHub Copilot in VS Code plug in outside tools. The assistant drafts each step; Falsify checks
it and refuses anything that breaks the rules: a hypothesis with no way to prove it wrong, a test
that can't fail, a "yes" that skipped review. Falsify never writes the answer itself.

There are ten tools, one per job: start an inquiry, look up related knowledge, lock a hypothesis,
design the test, analyze the evidence, run the review, check that a cited paper exists, compare
rival theories, recall earlier work, and record how a theory later turned out. The table in
[docs/CAPABILITIES.md](./docs/CAPABILITIES.md#the-tools-mcp--10) lists each one with its inputs
and what it enforces. The web app and the assistant share the same inquiries, so you can start
one in chat and read it in the browser.

To set it up, build the project, then register it with your assistant:

```bash
npm install
npm run build
```

In VS Code add this to `.vscode/mcp.json` (other MCP-capable assistants take the same entry):

```json
{
  "servers": {
    "falsify": {
      "command": "node",
      "args": ["dist/src/mcp/server.js"],
      "env": { "OPENBRAIN_KEY": "<your-key>" }
    }
  }
}
```

This workspace already includes a local MCP registration at
`.vscode/mcp.json`. If you also use other MCP servers in this repo, keep all of
them under the same top-level `servers` object rather than replacing the file.

`OPENBRAIN_KEY` is optional. OpenBrain is a separate, optional memory service; with a key,
Falsify can search earlier work by meaning (`falsify_recall`), match claims to the library by
meaning as well as by wording, and save surviving theories to it. Everything else works without
it. The key is read from the environment and is never stored in the repo.

### How a run is enforced

The first tool, `falsify_intake`, returns a `sessionId`. The assistant passes it to every later
call, and the server tracks the inquiry itself. That is what stops anyone from skipping a step,
confirming a theory that never had a recorded "yes", or revising a refuted hypothesis without
saying what changed and keeping every earlier way it could have been proven wrong. Refuted
hypotheses are written to the notebook and struck through; theories that survive are recorded in
the notebook too (and in OpenBrain, if configured). Every result names the next tool to call and
repeats the `sessionId`.

Inquiries and the notebook are saved in a `.falsify/` folder (not committed to git). Set
`FALSIFY_DATA_DIR` to keep them somewhere else. After you rebuild the project, restart the
`falsify` server in your assistant (in VS Code, from the MCP servers list), because a running
server keeps using the old build.

### Optional extras

All of these are off unless you turn them on, and none can change a verdict by itself. Every
setting, with its default, is listed in
[docs/CAPABILITIES.md](./docs/CAPABILITIES.md#settings-environment-variables).

| Extra | What it does | How to enable |
|---|---|---|
| Require a session | Refuses any step after intake that arrives without a `sessionId`, for assistants that keep dropping it. | `FALSIFY_REQUIRE_SESSION=1` |
| Retune the score weights | Changes how much each kind of evidence counts. A setting that stops consensus being the smallest weight is rejected at startup. | `FALSIFY_WEIGHTS`, for example `{"evidence":0.9,"consensus":0.05}` |
| Match by meaning | Lets the library match paraphrases, not just shared words. A local Ollama with `nomic-embed-text` (`http://127.0.0.1:11434/v1`) keeps your claims on your machine. Nothing is sent anywhere unless you set this. | `FALSIFY_EMBEDDINGS_URL`, plus `FALSIFY_EMBEDDINGS_MODEL`, `FALSIFY_EMBEDDINGS_KEY`, `FALSIFY_EMBEDDINGS_THRESHOLD` as needed |
| A second opinion from a model | An advisory check on falsifiability, appeals to authority, and whether a cited paper's abstract reports your observation. It never changes a verdict or score. | `FALSIFY_JUDGE_URL` and `FALSIFY_JUDGE_MODEL` (default `qwen2.5:32b`), any OpenAI-compatible chat endpoint such as a local Ollama |

### Checking that the scoring is any good

The score weights start as educated guesses. Four commands help you test them:

- `npm run calibrate` scores the labelled historical cases in `calibration/cases.json` and
  reports how well the score separates results that held up from results that were refuted.
- `npm run calibrate:replication` refits the statistical-support model to the real outcomes of the
  Reproducibility Project: Psychology.
- `npm run calibrate:outcomes` reports on the outcomes you have recorded yourself (needs at least
  five of each kind before it prints an accuracy).
- `npm run calibrate:judge` measures how good a given judge model is before you trust it.

See [DESIGN.md](./DESIGN.md) §3 for the reasoning behind the cycle.

### Guidance for AI assistants that use Falsify

Falsify checks what an assistant submits, so what the assistant puts in matters. This repo ships
guidance to keep it honest:

- `.github/instructions/falsify-inquiry.instructions.md`: the rules (never invent a statistic or
  a DOI, search before saying what you found, hold both sides to the same standard).
- The `falsify-inquiry` skill: the step-by-step procedure, including running the opposite framing.
- A **Falsify Reviewer** agent: an independent audit of a finished inquiry.
- A `/falsify-inquiry` prompt you can run from the chat picker.

To use them in another project, copy the instructions file and the skill folder into that
project's `.github` folder.

`npm run eval:inquiry` measures whether this guidance changes assistant behaviour. It runs the
questions in `calibration/inquiry-questions.json` through a Copilot CLI agent with and without the
guidance, and scores each run from the server's own records. It spends real model credits and its
samples are small, so read it as a sketch, not a measurement. In one full run (8 questions, one
model, one run per cell) the guided assistant completed the opposite framing 7 times out of 8
against 0 for the unguided one, did 35 web searches against 2, and verified 26 sources against 13.
Its search descriptions averaged about 51 words against 15. Both groups reported contrary results
equally often (9 each), and neither invented replication claims. Guided runs cost roughly twice as much because they run two
inquiries.

## The web app

Run it with `npm run web` (build first with `npm run build`) and open <http://127.0.0.1:4319>.
It has seven screens:

- **Dashboard**: where your inquiries, the knowledge library and the evidence stand.
- **Inquiry**: the guided step-by-step flow, with opposite-framing links, structured evidence and
  live citation checks.
- **Sessions**: every inquiry, with the full record behind each result.
- **Knowledge**: browse and search the library; each entry says what it rests on and what would
  overturn it.
- **Tools**: look up related knowledge, check a citation, compare rival theories.
- **Outcomes**: record what later happened to a theory, to check the scoring against reality.
- **Notebook**: a log where a refuted hypothesis is struck through and dated, never deleted.

The [user guide](./docs/USER-GUIDE.md) walks through each one. The app and the AI-assistant tools
run the same checks, so neither can be used to get around the rules, and they share the same
inquiries.

![A completed inquiry in the Sessions screen](./docs/images/sessions.png)

**Safety.** The app is a single-user tool for your own computer. It listens only on `127.0.0.1`,
has no login, only answers requests addressed to `localhost`, and rejects requests that come from
other websites, so a page you happen to visit cannot control it. To use a different port, set
`FALSIFY_WEB_PORT`:

```bash
FALSIFY_WEB_PORT=8080 npm run web
```

As with the MCP server, `OPENBRAIN_KEY` is optional and only enables recall. No web
framework or bundler is used: the API is plain `node:http` and the front-end is
hand-authored static assets served from `public/`.

The screenshots in the docs are generated, not hand-made. Run `npm install --no-save playwright-core`
and then `npm run docs:screenshots` to rebuild them from a throwaway server and demo data.

## Maintain the knowledge corpus

The knowledge library is a set of plain text files under `knowledge/*.yaml`, one file per tier:
Bedrock (established scientific laws, such as conservation of energy), Established (well-supported
theory), Contested (open disputes, with every position shown), Quantitative (maths and statistics
reminders, such as multiple comparisons, applied to every claim) and Refuted (ideas that were
tested and abandoned). These files are the
source of truth; OpenBrain, if you use it, is only a searchable copy. So every change follows
the same path:

1. write or update YAML
2. validate the corpus
3. optionally mirror the result to OpenBrain

The repository now includes a knowledge-maintenance CLI:

```bash
npm run knowledge -- lint
npm run knowledge -- sync --dry-run
npm run knowledge -- template --tier contested
```

Common workflows:

```bash
# scaffold a starter shape for a new entry
npm run knowledge -- template --tier bedrock

# add a new entry from YAML or JSON
npm run knowledge -- add --tier established --entry-file knowledge/examples/established-example.yaml

# add or update without deciding first which one applies
npm run knowledge -- upsert --tier quantitative --entry-file knowledge/examples/quantitative-example.yaml

# move an existing entry between tiers
npm run knowledge -- move --id established.physics.some_law --to bedrock

# mirror the current YAML corpus to OpenBrain after changes
npm run knowledge -- sync
```

Example entry files live in `knowledge/examples/` for each tier. Start from those
or from the `template` command instead of hand-remembering the schema.

Operational rule: do not treat OpenBrain as a second source of truth. If OpenBrain
sync fails, the YAML corpus is still authoritative and recoverable from git.

---

> "The first principle is that you must not fool yourself — and you are the easiest
> person to fool." — Richard Feynman

## Status

Working and in active use, still iterating. It has ten assistant tools, a local web app and a
211-entry knowledge library, all running the same checks. Be clear about what it is: it enforces
discipline on what an assistant or person *submits*, and records a **process**, not
proof. It cannot tell whether a paper supports a claim or whether the numbers are true,
its score weights are educated guesses that real recorded outcomes have not yet tested, and its
keyword checks miss phrasing they were not written for. The full list of
limits is in [docs/CAPABILITIES.md](./docs/CAPABILITIES.md#what-falsify-cannot-do).

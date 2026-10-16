# Falsify user guide

How to use Falsify, step by step. For the complete list of tools, rules and settings, see
[CAPABILITIES.md](./CAPABILITIES.md). Every screenshot below was captured from the running app by
`npm run docs:screenshots`, using a throwaway data folder, so none of it comes from real use.

## What it does, in one minute

You bring a question or a claim. Falsify walks it through five steps (intake, hypothesis,
experiment, analysis, review) and **refuses** the moves that make for bad reasoning: a
hypothesis nothing could disprove, a test that cannot fail, a "yes" that skipped review, a
statistic with no stated count of outcomes tested. It does not answer the question for you, and
it does not decide what is true. What you get is a record of whether the process was followed,
and an honest rating of how strong the evidence you supplied is.

![The dashboard](./images/dashboard.png)

## Start it

```bash
npm install
npm run build
npm run web
```

Open <http://127.0.0.1:4319>. It listens on your machine only. If the page will not load, the
server is not running: start `npm run web` and keep that terminal open. After you rebuild, stop
and start it again, because a running server keeps the old code.

To use Falsify from an AI agent instead (VS Code, Copilot, any MCP host), see
[Use Falsify inside your agent](../README.md#use-falsify-inside-your-agent-mcp). The web UI and
the agent tools share the same sessions, so an inquiry started in chat shows up in the dashboard.

## Run an inquiry

Open **Inquiry**. A stepper along the top shows where you are. Each step says what Falsify will
check before you submit.

![The Inquiry screen at the experiment step](./images/inquiry.png)

1. **Intake.** Type a question that an observation could settle. Questions that are really about
   values, definitions or "what do experts think" are flagged, with a suggestion for how to
   reframe them. Optionally link this as the opposite framing of an earlier inquiry (see below).
2. **Hypothesis.** State a claim that could be wrong, what you would observe if it is right, and
   at least one falsifier: a measurable observation that would prove it wrong. "If it is wrong" is
   refused. A probabilistic claim needs a number in a falsifier (an effect size, alpha or sample
   size). Falsify also shows the knowledge entries your claim touches.
3. **Experiment.** Name the decisive test or study that would settle it, and confirm it could
   genuinely come out against you. You usually cannot run it yourself: name the existing study,
   dataset or measurement that serves.
4. **Analysis.** Say whether the data agrees with the prediction, and list the evidence. Give
   statistics only if the source reports them; never estimate a p-value. For a "yes" you must also
   describe what you searched for and whether you found contrary results. Use **Verify with
   Crossref** next to a DOI to confirm the paper exists and is on topic.
5. **Review.** Answer three questions: were the methods sound, was the hypothesis wrong, is the
   underlying theory wrong. Even a "yes" must pass through review.

A "no" is a result, not a failure. It sends you back to revise the hypothesis, and Falsify makes
you say what changed and keep every earlier falsifier, so a claim cannot be narrowed until it
survives.

## Read the result

When review completes, the theory gets an **epistemic status**:

| Status | Meaning |
|---|---|
| `supported` | Replicated, with a verified replication source. |
| `provisional` | A sourced result that nobody has replicated yet. |
| `tentative` | Weak evidence, accepted explicitly. |

Some things hold a status down no matter how good the rest looks: no completed opposite framing,
both framings reaching "yes", or every cited DOI being off-topic. When that happens the result
says why, in a yellow "Status held back" box. A completed cycle is **a record that the process
was followed, not proof**, and every input was supplied by you.

## Go back over past work

**Sessions** lists every inquiry. Select one for the full record: hypothesis, falsifiers, earlier
refuted attempts, evidence with verification flags, score, timeline, and the opposite-framing
comparison. "Open in Inquiry" picks up where you left off.

![The Sessions screen](./images/sessions.png)

## Test the other side

Intake accepts an opposite framing ("does it raise?" against "does it lower?"). Run both through
the same steps. At review Falsify compares them: whether both reached "yes", and whether one side
got visibly less rigor than the other. A one-sided theory cannot be rated `supported`.

## Look things up

**Knowledge** is the corpus Falsify matches claims against: Bedrock laws, Established theory,
Contested questions, Quantitative lenses and Refuted ideas. Every entry says what it rests on and
what would falsify it, including the well-established ones. Contested entries list each position
with its own falsifiability status and never pick a winner.

![The Knowledge screen](./images/knowledge.png)

**Tools** has three stand-alone checks that need no open inquiry:

- **Related knowledge**: which entries touch a claim. A lookup, not a verdict.
- **Verify a source**: whether a DOI is a real publication, via Crossref. It cannot tell you
  whether the paper supports your claim.
- **Compare competing positions**: put two or more rival theories through the same standard. No
  winner is declared.

![The Tools screen](./images/tools.png)

## Check the score against reality

The score weights are priors, not measured truths. On **Outcomes**, record what later happened to
a confirmed theory: held up, refuted or inconclusive, with the basis. Once there are at least five
of each, the screen reports whether higher-rated theories actually held up more often. Until
then it says there is not enough data, and you should treat the ratings accordingly.

## Keep notes

**Notebook** is an append-only log. Refuted hypotheses and confirmed theories are written to it
automatically. You can add your own notes; nothing is ever deleted, only struck through with a
reason, so the history stays readable.

## What it cannot do

- It cannot tell whether a paper actually supports your claim, or whether your numbers are true.
  It checks that sources exist and are on topic, nothing more.
- Matching a claim against the corpus is by wording, plus meaning if you enable embeddings. It
  can miss a paraphrase and can occasionally match the wrong entry; the match is shown with its
  score and how it was found.
- The corpus is broad but not complete, and thin in computer science, chemistry, geology and
  engineering. Absence of a match is not absence of relevant knowledge.
- The score weights are untested priors until you have recorded enough outcomes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser says connection refused | The web server is not running. Run `npm run web`. |
| The page is blank or looks old | Hard-refresh (Ctrl+Shift+R). After a rebuild, restart `npm run web`. |
| Port 4319 is in use | Set `FALSIFY_WEB_PORT` to another port. |
| Agent tools are missing or outdated | Rebuild, then restart the `falsify` server in your MCP host. |
| "Not verified" on a real DOI | Crossref may be unreachable or rate-limiting; try again. |
| You want a clean slate | Delete `.falsify/sessions`, `.falsify/notebook` and `.falsify/outcomes` (or the same folders under `FALSIFY_DATA_DIR`). |

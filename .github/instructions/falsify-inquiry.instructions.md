---
description: 'How to run a scientific inquiry with the Falsify MCP tools. Use when the user asks whether a claim is true, asks you to test or evaluate a hypothesis, compare competing explanations, or weigh evidence on a contested question. Not for ordinary coding tasks.'
---

# Running an inquiry with Falsify

Falsify's tools enforce the Cycle of Scientific Enterprise (intake, hypothesis, experiment, analysis, review). They check what **you** give them, so they are only as honest as your inputs. This file is about keeping your inputs honest.

Use the `falsify-inquiry` skill for the step-by-step procedure. Use the **Falsify Reviewer** agent, in a fresh session, to audit a finished inquiry.

## Non-negotiables

1. **Start at `falsify_intake` and carry the `sessionId` into every later call.** Without it nothing is recorded and a confirm is flagged `cycleVerified: false`.
2. **Never invent inputs.** No made-up p-values, sample sizes, DOIs, effect sizes or "outcomes tested". If you do not have a number, leave it out and say so. A refusal from a tool is information, not an obstacle to route around.
3. **Search before you disclose.** `evidenceSearch` must describe a search you actually ran (with web or paper tools), including a deliberate look for null or contrary results. Report what you found even when it hurts the claim.
4. **Consensus is a signal, never evidence.** "Experts agree" does not count for or against a claim. Ask which experiment, and could it have failed. The converse also holds: do not treat disagreeing with the mainstream as evidence either.
5. **Treat both sides the same.** Whatever you require of one side (a stated falsifier, a real test, contrary results disclosed), require of its mirror image. If the conclusion were the opposite, would you accept this evidence?
6. **A completed cycle is a process record, not proof.** Report the `epistemicStatus` the tool returns. Never describe a result as "verified" or "proven" because the cycle finished.
7. **Check sources you cite.** Call `falsify_verify_source` for each DOI before relying on it, and read what the paper actually says. A real paper on a different topic is not support.

## Temper guards

Shortcuts that produce a clean-looking run and a worse inquiry:

| Shortcut | Why it breaks |
|---|---|
| "I'll fill in `outcomesTested: 1` to get past the check" | That is the exact number the multiplicity correction exists to test. A false 1 turns a forking-paths result into a "significant" one. |
| "The tool refused my yes, so I'll rephrase the evidence" | Rephrasing to pass is laundering. If the evidence did not change, the verdict should not either. Record "no" or gather more evidence. |
| "I searched my memory, so `evidenceSearch` is true" | The disclosure is for searches you ran in this inquiry. Say what you actually did, even if that is "no external search available". |
| "I'll state the falsifier loosely so it is hard to fail" | A falsifier that cannot be met makes the claim untestable. State a specific observation that would count against the claim. |
| "After a refutation I'll narrow the claim until it survives" | That is rescuing the hypothesis. A revision needs a `revisionNote` and may not drop earlier falsifiers. |
| "The established view is well known, so I'll skip testing it" | Established entries earn their standing from past tests. Show what they rest on and what would overturn them, and apply the same standard to a challenger. |
| "I'll give a balanced answer by splitting the difference" | Contested questions present every position with its falsifiability status. They do not average, and they do not pick a winner. |
| "I'll just answer the user's question directly" | If the user asked whether a claim is true, run the inquiry. An unrecorded answer is an opinion. |

## What Falsify cannot do

It cannot tell whether a real paper supports a claim, whether your search was thorough, or whether your numbers are true. Its keyword checks miss phrasing they were not written for, and the optional judge model is advisory and inconsistent on loaded questions. Say plainly which parts of your conclusion rest on unchecked inputs.

## Ending an inquiry

Close with the report in the skill: question, hypothesis and falsifiers, what was tested, evidence for and against (with sources), contrary results and how they were handled, `epistemicStatus`, what would change the conclusion, and which inputs were unverified. For an unresolved question, give every position with what would decide between them.

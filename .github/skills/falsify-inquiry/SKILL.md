---
name: falsify-inquiry
description: Run a claim or question through the Falsify scientific-method cycle (intake, hypothesis, experiment, analysis, review) using the falsify_* MCP tools, with honest inputs and symmetric treatment of competing positions. Use when asked whether something is true, to test a hypothesis, to evaluate evidence, or to compare explanations.
argument-hint: "<the question or claim>"
---

# Falsify Inquiry Skill

Read `.github/instructions/falsify-inquiry.instructions.md` first: it holds the non-negotiables and temper guards. This skill is the procedure.

## Trigger

"Is it true that…", "test this hypothesis", "what does the evidence say about…", "compare these explanations", "does X cause Y".

## Steps

### 0. Mirror the question

Write the question and its opposite framing side by side (e.g. "X causes Y" / "X does not cause Y"; "A explains Z" / "B explains Z"). You will run both as linked inquiries (step 8, `mirrorOf`) and apply the same requirements to each. Keep both for the report.

### 1. Intake: `falsify_intake`

Pass the question. Keep the returned `sessionId` and pass it to every later call.

- If it is flagged as outside the method (normative, definitional, a consensus appeal), say so and offer the nearest testable version of the question. Do not force it through.
- If the keyword check passes but the question is clearly a value judgement or unfalsifiable as phrased, say that yourself: the checks are weak on loaded wording.

### 2. Orient: `falsify_related`

Run it on the claim. Read every match:

- **Refuted** lookalikes: say what is different this time.
- **Bedrock / Established**: read what the entry rests on and what would overturn it. Hold the entry and your claim to the same standard.
- **Contested**: plan to present every position.
- A `stance` of `denies` or `unclear` means the claim may oppose the entry rather than resemble it. Absence of a match is not absence of relevant knowledge.

For a contested question with several candidate explanations, you may call `falsify_dissent` with the positions to see where they truly disagree. It never picks a winner.

### 3. Hypothesis: `falsify_hypothesize`

State the claim and what it predicts. Write **at least two** falsification conditions, each naming a measurable observation ("no drop in reaction time versus placebo in a blinded trial"), not "if it is wrong". State a numeric threshold for probabilistic claims and a comparison for causal ones. The hypothesis is locked at this point: it is your pre-registration.

### 4. Experiment: `falsify_experiment`

Name the decisive evidence and confirm the test could fail. "Experiment" here means the observation or study that would decide the question. You usually cannot run it, so say what existing study, dataset or measurement serves, and find it.

### 5. Gather evidence (outside Falsify)

Use your search and web tools. Do all of this before analysis:

1. Search for evidence **for** and **against**, with queries written for each.
2. Look specifically for null results, failed replications, retractions and critiques.
3. Prefer primary sources, replications and meta-analyses over reviews and commentary.
4. For each paper you will cite: get the DOI, call `falsify_verify_source` with it (and the observation you cite it for, if a judge is configured), and read the abstract. Drop it if it does not say what you need.
5. Record the actual search: where you looked, with what terms, and how many null or contrary results turned up.

### 6. Analysis: `falsify_analyze`

- Give structured `evidence`: observation, `kind`, `source`, `doi`, and statistics **only if the source reports them**. Every p-value needs `outcomesTested`, from the source, or leave the statistic out.
- Mark `replicated: true` only for a result an independent group reproduced, and give the replication's own `replicationDoi` (a different paper from the original), confirmed with `falsify_verify_source`. Without that it earns nothing and is reported back.
- Pass `evidenceSearch` with the real description, the real `contraryFound` count, and a `contraryNote` explaining how each contrary result is handled.
- Link `knowledgeRefs` to the Bedrock or Established entries the claim supports or conflicts with.
- Verdict **yes** only if the evidence you found supports the prediction and the falsifiers did not occur. Otherwise **no**.
- If the tool refuses, read the rule and fix the cause. Do not reword to get past it.

### 7. Review: `falsify_review`

Answer the three questions in order, honestly: Were the methods sound? Was the hypothesis wrong? Is the theory wrong? Choose `revise` after a "no", or `confirm` after a justified "yes". Weak evidence is refused unless you pass `acceptTentative`, so accept a tentative status only when you will say so in the report.

On `revise`, return to step 3 with a `revisionNote` that states what the refutation taught you, not how you narrowed the claim to survive.

### 8. Run the mirror

Start the opposite framing from step 0 with `falsify_intake` and **`mirrorOf: <the first sessionId>`**, then repeat steps 3 to 7 for it with the same rigor: the same number of falsifiers, a search as long and as hostile to its own side, contrary results reported. The server links the two and, at Review, compares them: it flags both framings reaching "yes", names visible gaps in rigor (falsifiers, evidence, verified sources, search effort, contrary results), and will not rate a theory "supported" unless its opposite framing was tested. Do the mirror before you confirm the first side, so the comparison is available when you review it.

### 9. Report

```
Inquiry report
  Question:            <as asked>
  Hypothesis:          <statement>; predicts <prediction>
  Falsifiers:          <each>
  Sessions:            <ids>
  Evidence for:        <items, sources, DOIs verified yes/no>
  Evidence against:    <items, sources>
  Search performed:    <where, terms, contrary results found and how handled>
  Verdict:             <yes/no per hypothesis>
  Epistemic status:    <supported | provisional | tentative>, with the reason
  Opposite framing:    <treated the same way? result>
  Would change my mind: <specific observation>
  Unverified inputs:   <anything you could not check>
  Conclusion:          <what is and is not established>
```

For an unresolved question, list every position with its falsifiability status and what would decide between them. Do not pick a winner and do not average.

### 10. Later: `falsify_outcome`

When a replication or later test resolves a confirmed theory, record `held-up`, `refuted` or `inconclusive` with a basis. This is how the score is eventually checked against reality.

## Conditional: a tool refuses

> The rule name and guidance in the refusal say what is wrong. Fix the input or change the verdict. If a refusal looks like a bug in Falsify, report it (rule name and inputs) instead of working around it.

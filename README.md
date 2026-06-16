# Falsify

> Follow the data, not the conclusion.

Falsify is a reasoning tool that refuses to just hand you an answer. It runs
scientific questions through the **Cycle of Scientific Enterprise** and returns
*falsifiable hypotheses with their test conditions* — not opinions, not consensus,
not "the science is settled."

It is built on two ideas:

- **The Cycle of Scientific Enterprise** — science is a *loop, not a line*, and the
  most important move is the **"No" branch**, where data that disagrees with a
  prediction sends you back to question your methods, your hypothesis, and finally
  the theory itself.
- **Layered, weighted knowledge** — claims are grounded in tiers (Bedrock laws →
  Established theory → Contested explanations) with mandatory probability checks,
  and **consensus carries low weight by design**: we demand the receipts rather than
  reflexively accepting *or* rejecting what's popular.

📄 See **[DESIGN.md](./DESIGN.md)** for the full architecture — this is an early,
iterating design.

---

## Use Falsify inside your agent (MCP)

Falsify ships as an MCP server exposing six discipline-enforcing tools —
`falsify_intake`, `falsify_hypothesize`, `falsify_experiment`, `falsify_analyze`,
`falsify_review`, `falsify_recall`. They never generate an answer; they take your
draft, run it through the cycle, and **refuse** anything that breaks the rules (a
hypothesis with no falsification condition, an experiment that cannot fail, a Yes
that skipped review).

Build it, then register the stdio server with your MCP host:

```bash
npm install
npm run build
```

VS Code (`.vscode/mcp.json`) or any MCP host:

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

`OPENBRAIN_KEY` is optional and only enables `falsify_recall` (semantic recall from
the OpenBrain corpus); the reasoning tools work without it. The key is read from the
environment and is never stored in the repo.

---

> "The first principle is that you must not fool yourself — and you are the easiest
> person to fool." — Richard Feynman

## Status

Early design draft. Nothing is final.

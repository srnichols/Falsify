---
description: "Run a question or claim through the Falsify scientific-method cycle with honest inputs, then offer an independent review."
argument-hint: "the question or claim to investigate"
agent: agent
---
Investigate this using the `falsify-inquiry` skill (read `.github/skills/falsify-inquiry/SKILL.md` and `.github/instructions/falsify-inquiry.instructions.md` first):

${input:question:The question or claim to investigate}

Follow the skill to the end and finish with the inquiry report. Then tell me the `sessionId` and offer to hand it to the **Falsify Reviewer** agent for an independent audit.

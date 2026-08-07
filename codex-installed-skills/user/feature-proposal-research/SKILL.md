---
name: feature-proposal-research
description: Research and compare implementation alternatives before writing code for a new feature. Use when a user asks Codex to add, build, implement, or design a new feature, capability, workflow, integration, UI, API, module, or product behavior and the request would normally require code changes. This skill requires Codex to first research current best practices or comparable implementations, propose the strongest alternatives, recommend the best version, and wait for the user's final decision before implementing.
---

# Feature Proposal Research

## Core Rule

When a request involves writing code for a new feature, do not implement immediately. First produce an advisory proposal that gives the user clear implementation choices and a recommended path. The final call belongs to the user.

If the user explicitly says to skip research, implement directly, or choose for them, honor that instruction only after briefly noting the tradeoff.

## Workflow

1. Clarify the feature goal from the user's request and the existing codebase.
2. Inspect the repository enough to understand architecture, dependencies, constraints, and local patterns.
3. Research the current best version of the feature on the internet when the decision could be affected by recent libraries, standards, security practices, product conventions, platform APIs, browser behavior, framework releases, or ecosystem norms.
4. Compare at least two viable implementation alternatives. Include a "minimal/local" option when practical.
5. Recommend one option and explain why it best fits the project.
6. Stop before writing feature code and ask the user to choose, unless the user has already authorized implementation after the proposal.

## Research Guidance

Use primary or high-quality sources first:

- Official framework, library, API, and platform documentation.
- Standards bodies, language documentation, or vendor docs.
- Maintained project repositories, release notes, and migration guides.
- Reputable engineering writeups only when official sources do not cover the tradeoff.

Research should answer:

- What current implementation patterns are considered best practice?
- Which libraries, APIs, or architecture choices are mature and maintained?
- What security, accessibility, performance, compatibility, or maintainability risks matter?
- What changed recently that could affect the implementation choice?

If internet access is unavailable, say so and make the recommendation from local code context plus known stable principles.

## Proposal Format

Keep the proposal concise and decision-oriented:

```markdown
**Feature Goal**
One sentence describing the feature.

**Relevant Context**
Brief notes from the codebase and research.

**Options**
1. Option name: benefit, tradeoff, estimated complexity.
2. Option name: benefit, tradeoff, estimated complexity.
3. Option name: benefit, tradeoff, estimated complexity.

**Recommendation**
Choose option X because...

**Decision Needed**
Which option should I implement?
```

Use exact source links when research informs the recommendation.

## Decision Rules

- Prefer the option that fits the existing codebase unless research shows a strong reason to change direction.
- Prefer maintained, documented APIs over custom code for complex domains such as auth, payments, security, routing, forms, parsing, media, search, realtime sync, and accessibility.
- Prefer smaller reversible changes when the product need is uncertain.
- Call out when a flashy or expansive version would increase maintenance cost without clear user value.
- Never present implementation as final until the user approves an option.

## After User Approval

Once the user chooses an option or explicitly approves the recommendation, implement normally:

1. Make focused code changes following repository patterns.
2. Add or update tests according to risk.
3. Run appropriate verification.
4. Report what changed and what was verified.

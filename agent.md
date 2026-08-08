# Project update rule

This repository must maintain a visible implementation record in [`Docs/PROJECT-UPDATES.md`](Docs/PROJECT-UPDATES.md).

Whenever a new feature, bug fix, infrastructure change, or behavior change is added, the contributor must update that file in the same change or in the next related commit. If two pull requests are merged without an update entry, the next contributor must add a consolidated entry before starting additional feature work.

Each update entry must include:

- Date and merged pull request or commit references
- What changed and why
- User-visible or operational impact
- Files or subsystems affected
- Validation performed, including tests, builds, and integration checks
- Known limitations, migration requirements, and follow-up work

Keep entries chronological, concise, and understandable to someone who did not author the change. Do not record secrets, API keys, prompts, customer data, or provider response contents. Changes to this rule itself must also be recorded in `Docs/PROJECT-UPDATES.md`.

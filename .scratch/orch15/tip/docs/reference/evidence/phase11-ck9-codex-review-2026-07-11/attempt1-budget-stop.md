# Attempt 1 — correctly budget-stopped

The first exact-model Codex review attempt on 2026-07-11 was stopped by Baton's canonical token
budget before it produced a review artifact. This is a measured refusal, not review evidence.

- requested/resolved/observed model: `gpt-5.4`
- configured token budget: 120,000
- observed cumulative usage at hard stop: 130,881
- terminal task state: `cancelled`
- `verify.reverified`: absent
- integration: absent
- cleanup: kill confirmed; PID, worktree, runtime scope, and task branch all gone

The rerun budget is raised to 250,000 from this measured opening/repository-read cost. No trust,
verification, model-identity, authentication, or cleanup gate is relaxed.

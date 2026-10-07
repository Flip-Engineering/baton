# Phase 85 generic effect-admission dogfood

This evidence records an intentionally honest failed Baton-on-Baton implementation attempt and its
durable recovery. `run.mjs` launched two parallel exact routes:

- Codex `gpt-5.6-sol` at `high` effort as `effect-admission-builder`;
- Codex `gpt-5.6-sol` at `xhigh` effort as `effect-admission-adversary`.

The foreground PTY wrapper was interrupted before Baton's completion/finally path returned. Neither
Attempt produced a Candidate, so this directory contains no Candidate patch and makes no success
claim. The durable deployment remained at the exact root recorded in `evidence.json`.

`recover.mjs` reopened that deployment and Run through Baton. Recovery terminalized both claimed
Attempts as `recovery_terminalized`; Run-stop then reported two targets, zero remaining targets,
two observed process records, two closed process records, zero workers, and closed deployment
ownership. The retained evidence therefore proves cleanup and truthful failure, not implementation.

The run exposed a concrete AX/recovery friction: an outer PTY interruption can prevent an evidence
wrapper's local `finally` block even though Baton retains enough durable authority to recover. The
product requirement remains a concise first-class resume/stop surface that does not make an agent
reconstruct deployment roots or operational budgets manually.

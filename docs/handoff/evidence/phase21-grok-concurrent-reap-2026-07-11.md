# Phase 21 concurrent exact-model Grok control/reap evidence — 2026-07-11

## Outcome

Baton passed a live, authenticated two-worker proof through the public `createDriver()` assembly.
It started `grok-4.5` and `grok-composer-2.5-fast` concurrently in isolated task worktrees on two
distinct native process groups. Provider prompt metadata established that the observed models
exactly matched both requested and resolved route identities; no request value was relabeled as an
observation.

Both initial turns were working concurrently before control. Baton natively interrupted both so
each terminal prompt response could report its provider model identity. One worker remained idle;
the other used interrupt-follow-up to resume a second turn on the same native ACP session and was
then killed while working. Baton killed the idle worker for cleanup, repeated both kills to prove
idempotence, and established that both native PIDs, task worktrees, metadata files, runtime scopes,
temporary branches, and coordinator sessions were gone.

Every check in
`docs/reference/evidence/phase21-grok-concurrent-reap-2026-07-11/summary.json` is true. The raw
normalized event ledger and rerunnable proof are beside it.

## Dogfood finding and repair

The first authenticated attempt exposed a real recursive-use defect before either Grok process
could start: `ensureBatonExcluded()` assumed `<repo>/.git` was a directory. In a linked Git
worktree `.git` is a file, so the worktree readiness promise failed with `ENOTDIR`; the adapter then
reported only a generic missing-worktree refusal.

The repair resolves `info/exclude` through `git rev-parse --git-path info/exclude`. A real linked
worktree regression first reproduced the exact failure and now passes. The proof runner also
detects an early lifecycle crash instead of waiting for its four-minute native-spawn deadline.
The canonical suite is 722/722 green with the owned suite root reaped.

## Credential and claim discipline

The runner presence-checks the user's existing Grok auth file and projects it into each private
runtime home through Baton's credential-file policy. Credential values do not enter the runner,
events, summary, or repository. The committed evidence proves the exact two models and controls
listed above; it does not generalize those observations to other Grok model slugs, accounts, or
future CLI versions.

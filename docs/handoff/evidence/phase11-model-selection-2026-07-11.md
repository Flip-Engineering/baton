# Phase 11 model-selection evidence

Date: 2026-07-11

Scope: MS1-MS5 in `spec/phase11/control-integrity-and-model-selection.md`.

## Red evidence

The first zero-quota model-selection suite was 0/7. The public handle had no model fields, known
invalid models allocated tasks, task-level selection never reached Claude/Codex/Grok, cards had no
selection metadata, and automatic routing scored harnesses before model eligibility.

## Implemented boundary

- `spawn(vendor, brief, {model, modelPolicy})` treats harness and exact model as independent axes.
- A typed `ModelSelectionError` rejects invalid, conflicting, or known-unavailable choices before
  task/worker allocation.
- Policy supports exact allow/deny/prefer lists, family allow/deny, reasoning effort, and service
  tier. Eligibility is filtered before adaptive scoring.
- Claude maps task model and effort to `--model`/`--effort`; Codex maps model, effort, and service
  tier to native thread/turn fields; Grok maps model and reasoning effort before the `stdio`
  subcommand.
- Cards publish configured default, discovered availability posture, family/prefix/alias matching,
  reasoning/service controls, provenance, and freshness.
- Requested, resolved, and wire-observed model identities survive handles, lifecycle/resource/
  terminal/verification events, results, story, replay, router buckets, and snapshot commit
  trailers.
- A non-alias observed mismatch emits `model.mismatch`, fails the task, and enters Baton's normal
  confirmed two-phase kill path instead of accepting a silent fallback.
- GLM has its own model family/prefix metadata rather than inheriting Claude identity.

## Adversarial extensions

The first green pass was expanded to cover policy conflict, unknown-model refusal, deterministic
preference, reasoning/service eligibility, router keys keyed by exact model, terminal replay,
story attribution, `Baton-Model` trailers, and mismatch cleanup. Existing no-model callers retain
their prior behavior.

## Validation

- Focused MS suite: 14/14 passing.
- Bare `node --test` from `impl/`: 455/455 passing, 0 failed.
- `git diff --check`: clean.

Provider-backed exact-model proof is deliberately separate: after this zero-quota gate is
committed, Baton will run concurrent Grok tasks with explicit model IDs and verify observed model,
fresh-result acceptance, then PID/worktree/metadata/branch cleanup.

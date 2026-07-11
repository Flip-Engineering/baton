# Phase 11.2 — runtime isolation, budgets, and watchdog governance

## GV1 — usage is canonical and monotonic

Every adapter emits `resource.tokens` with canonical additive `tokens` and `usd` fields plus its
raw source accounting. The coordinator converts cumulative wire counters to non-negative deltas,
deduplicates repeated cumulative snapshots, and folds the delta into the public handle. Claude
result usage, Codex token usage, and Grok prompt metadata use the same event contract.

## GV2 — thresholds are durable policy facts

Crossing 50%, 80%, or 100% of either the token or USD brief budget emits exactly one
`resource.budget_threshold` per threshold with used, limit, ratio, dimensions, and policy action.
The event is replayable; restart reconstructs budget totals and already-fired thresholds without
re-emitting them.

## GV3 — hard budgets stop work

The 100% threshold invokes Baton's ordinary confirmed two-phase kill. A late completion cannot
win over the stop. Missing/zero limits disable that dimension; counter resets and malformed usage
never create negative credit. Budget policy is deterministic code, not a model judgment.

## GV4 — mechanical watchdog actions are bounded and idempotent

A configured quiet deadline emits one `health.stall_suspected` and interrupts the turn. Three
identical completed failing commands in one turn emit one `health.loop_suspected` and interrupt.
An observed write outside `Brief.pathScope` emits `health.scope_violation` and kills. New turns
reset loop/action state; blocked, stopping, verifying, terminal, and orphaned workers do not stall.
The watchdog never classifies semantic correctness.

## GV5 — action events have a canonical minimum

Adapters retain raw wire payloads while also exposing command, exit code, and edited paths when
the wire provides them. Absolute paths are relativized against the worker worktree before scope
policy. Unknown action shapes remain observable but do not trigger invented enforcement.

## GV6 — each worker receives an isolated runtime scope

The driver creates a mode-0700 per-worker runtime root outside its git worktree and supplies a
vendor-specific config home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or `GROK_HOME`), private `HOME`,
and `TMPDIR`. Only an explicit credential projection may enter that scope; ambient credential and
provider variables are removed unless allowlisted. Secret values never enter handles, cards,
events, logs, errors, or summaries. Runtime roots are reaped on confirmed/forced stop.

## GV7 — sandbox and network posture are explicit

The task policy passed to adapters declares filesystem, network, approval, and outside-world
posture. Harness-native controls are mapped where available; unsupported controls are visible in
the card/event record and cannot be silently called enforced. Worktree confinement is not claimed
as an OS sandbox by itself.

## Safety gate

Zero-quota tests cover cumulative/delta usage, thresholds, replay, hard stop, stall/loop/scope
actions, environment redaction, permissions, and cleanup. A live provider probe follows only when
isolated credentials can be projected without printing or weakening them; otherwise the
credential boundary is recorded pending rather than bypassed.

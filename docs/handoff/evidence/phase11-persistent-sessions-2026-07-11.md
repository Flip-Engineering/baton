# Phase 11 persistent-session evidence

Date: 2026-07-11

Scope: PS1-PS8 in `spec/phase11/persistent-sessions.md`.

## Implemented boundary

- A verified attached worker accepts a public follow-up `turn`, preserves its native process and
  session identity, advances its coordinator generation, clears the prior result projection, and
  receives an independent trust-gate decision.
- Follow-up state commits only after `Ack{ok:true}`. Exceptions and refusals preserve the prior
  terminal result. A wire that emits turn facts and then refuses is treated as contradictory and
  killed rather than reused.
- Interrupt-with-follow-up reopens coordinator state only after matching Ack and confirmation.
- Late prior-turn terminal/question/approval events are fenced and visibly rejected.
- Handles, results, events, and replay carry wire-observed `sessionRef`; restart replay leaves the
  reference `orphaned`, never falsely attached.
- `spawn(...,{session})` maps Claude resume/fork, Codex resume/fork, and Grok ACP resume. Cards reject
  unsupported modes before worker allocation. Grok vendor-specific fork/rewind remain honestly
  `planned` pending exact-schema implementation.
- Resume requires validated durable worktree ownership. Fork creates a fresh worktree and records
  parent-session/task lineage.
- `recover()` is bounded and ignores replayed PIDs. It requires the fresh native handshake to
  report the exact persisted identity; timeout, refusal, exception, or mismatch kills the
  untrusted transport and leaves the handle orphaned.

## Zero-quota validation

- Focused persistent-session suite: 17/17 passing.
- Phase 11/control/coordinator regression selection: 93/93 passing.
- Bare `node --test` from `impl/`: 472/472 passing, 0 failed.
- `git diff --check`: clean.

## Provider-backed proof

Pending execution of
`docs/reference/evidence/phase11-grok-persistent-session-2026-07-11/run.mjs` after the zero-quota
implementation commit. The gate requires two independently verified public turns on one exact
Grok native session/PID followed by confirmed process, worktree, metadata, and branch cleanup.

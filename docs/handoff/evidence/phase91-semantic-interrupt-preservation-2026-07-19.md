# Phase 91 focused assessment — semantic interrupt preservation

Date: 2026-07-19

## Outcome

Phase 91 is an implemented candidate that closes the deterministic ordinary Run interrupt
lifecycle from semantic admission through reusable
same-session completion. A confirmed ordinary interrupt now leaves one nonterminal Plan member with
zero active provider turns and one proved attached session. Coordinate-free send consumes that
closed preservation receipt to admit one governed successor turn on the same task, worktree, native
session, and exact harness/model/effort route. It creates neither a new harness process nor another
Plan-node claim.

The implementation carries the choice through schema-v2 admission, effect start, provider
acknowledgement, settlement, evidence mapping, timeline projection, and replay. The Run-authority
digest retains the coordination task version. Application pre-effect and coordinator serialized-slot
checks compare the entire target; ordinary version-only drift refuses before the provider boundary.
Blocked interaction resolution is mapped and completed before admission, so its task-generation
change is part of the admitted target rather than a hidden post-admission mutation.

## Focused findings closed

1. Stop waiters previously had one shared physical disposition. They now retain typed per-request
   mode and preservation disposition. P91-14 proves a kill superseding an in-flight preserved
   interrupt returns `superseded_by_stop` to the interrupt caller and `confirmed` to the kill caller,
   then terminalizes and reaps exactly once.
2. Preservation timeout is no longer an optimistic forced interrupt. It fails the Plan task and
   waits for a distinct confirmed kill and cleanup before returning its escalation result.
3. Interrupt confirmation alone is insufficient. Receipt creation requires exact session identity,
   `transportOpen:true`, reusable-session card support, valid worktree/local authority, current
   Plan/Run bindings, resolved interaction authority, and, when configured, valid provider terminal
   governance.
4. Closed or unproved transport cannot produce a receipt. Current-incarnation authority is failed
   and reaped; replay-only uncertainty is quarantined as `interruption_uncertain` with explicit
   attention and whole-Run stop as its only safe action. Exact process-close projection is covered.
5. A stop before successor admission prevents the prompt. A stop after prompt acceptance records
   `deliveredDespiteStale:true`, `actualDelivery:'turn'`, and application `outcome_unknown`, while
   whole-Run stop still proves zero remaining ownership.
6. Restart recovery uses exact `attachOnly:true` native-session reattachment and admits zero prompt
   turns. Response-loss reconciliation uses mapped control evidence and never redelivers either the
   interrupt or the successor.
7. Schema-v1 Phase 90 outcomes retain their original replay shape. Schema-v2 receipts are closed,
   digest-checked, operation-appropriate, and bound to every target fixture through
   `preservationReceiptDigest`.
8. Claude session, Codex app-server, Grok ACP, and Kimi ACP terminal interrupt payloads now pin the
   exact native session identity and positive open-transport observation in adapter contract tests.
   Governance remains conditional on the corresponding live observation, valid provider seal,
   reusable card, and current local/worktree authority. Unsupported transports are not allowed to
   acquire semantic preservation by omission.
9. Operation-bound Ack generations ignore a delayed interrupt Ack after escalation. P91-15 proves
   only the kill generation can settle the physical waiter, while typed callers retain distinct
   results.
10. Coordinate-free Application restart now retains only a worktree named by a reconstructed
    nonterminal preservation receipt, performs one attach-only handshake with zero prompt, and
    leaves the exact task available for its successor. Failed post-effect attachment confirms kill
    and cleanup.
11. Process close after preservation clears the receipt, projects
    `transport_closed_after_preservation`, fails the task, and cannot resurrect healthy control on
    replay. Unproved attachment remains attention/stop-only.
12. Preservation seals epoch E. Late same-epoch completion/crash is stale and cannot enter the
    verifier; only the exact policy-authored E+1 successor consumes the seal. MockAdapter turn
    coroutines now capture an immutable halt signal/generation, preventing an aborted old turn from
    terminalizing its successor through shared state.
13. V2 target, operation/outcome, continuation, and receipt closure have negative admission,
    acknowledgement, and corrupted-replay integrity tests. Story and Coordinator agree both with
    preservation and immediately on a no-receipt interrupt.

## Focused validation

The following focused commands passed during assessment preparation:

- `cd impl && node --test test/phase91-semantic-interrupt-preservation-red.test.mjs`: 24/24,
  exit 0. This is the exact focused Phase91 command/result for this assessment.
- `cd impl && node --test test/phase64-integrated-run-application.test.mjs`: 34/34,
  exit 0, including clean process exit after the quarantine stop physically terminalized its
  locally owned preserved mock transport.
- Phase90 durable-control compatibility: 3/3.
- Phase90 Run timeline: 7/7.
- Coordinator regression: 57/57.
- Provider-governance, provider-turn-release, normalization, and Story regression: 69/69.
- Claude session adapter: 31/31.
- Codex app-server adapter: 31/31.
- Grok ACP adapter: 40/40.
- Kimi ACP adapter: 16/16.

At this assessment checkpoint the dispatch definition of done remains exactly:

```text
npm test --prefix impl
```

run from the assigned worktree root with exit code 0. Focused results do not substitute for that
deployment verification contract, so its result is recorded independently from the focused
commands.

Deployment verifier result: `npm test --prefix impl` passed 2,272/2,272 tests with exit code 0 on
2026-07-19 (`duration_ms 84798.117541`). This is the dispatch-scoped `impl` verifier; it does not
close the broader repository-root or live persistent-provider gates below.

## Scope and deliberate compatibility boundary

There is no intentionally weaker deterministic ordinary semantic-interrupt contract. The deliberate compatibility
boundary is the one allowed by the Phase 91 brief: direct low-level `Coordinator.interrupt()` remains
cancel-by-default unless an authenticated schema-v2 semantic control supplies `preserveTurn`, a
control identity, and the exact target binding. This keeps historical fleet/watchdog callers from
silently changing cancellation semantics while preventing them from claiming preservation.

`transportOpen:true` is adapter terminal-event evidence, not a claim of future liveness. Baton also
checks current process state and local authority when minting the receipt, invalidates the healthy
projection on later process close, and requires attach-only proof after restart. No provider session
can be called preserved solely because the interrupt RPC returned successfully.

The focused suite proves deterministic contract behavior and all shipped reusable adapter payload
shapes. It does not prove that a live provider session survived interruption, that a real PID/PGID
was killed and reaped, or that an old operating-system provider process quiesced; MockAdapter and
synthetic lifecycle fixtures cannot establish those facts. It also does not claim that a provider
can never fail after a valid receipt; that later failure is represented as explicit attachment
uncertainty or terminal failure and remains subject to exact whole-Run stop/reap authority.

P91-5 calls the coordinator's already-authorized `stopRunTargets` operation directly. It proves the
transport stop-before-successor race but not durable Application `run.stop` admission. The integrated
Application stop cases provide that distinct evidence. Historical Phase90 live interrupt evidence
predates preservation receipts and is not Phase91 preserve/resume proof.

The self-hosting Run also exposed a separate verifier-policy defect. Baton's independent executions
both exited zero, but the red/green policy produced `accepted:false` with
`verification_red_green_failed` because the base suite was already green. The same terminal evidence
nevertheless projected the verification artifact and result as accepted. That contradictory
acceptance projection is not evidence for Phase 91; the exact focused and deployment commands above
and the later repository-root run remain the validation authority until the trust gate is fixed.

Open gates:

- the broader repository-root suite, intentionally prohibited while this Baton Run is live;
- live persistent Claude/Codex/Grok/Kimi interrupt, restart attachment, successor completion, and
  stop/reap exercises;
- real process-lifecycle confirmation of PID/PGID close/reap and old-process quiescence.

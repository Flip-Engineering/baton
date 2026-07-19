# Phase 91 — semantic interrupt preservation

Status: implemented candidate with focused deterministic validation, 2026-07-19. Broader
repository-root and live persistent-provider gates remain as stated in section 8.

Phase 91 makes a successfully preserved ordinary Run interrupt a turn-preservation operation. On
that successful path it ends only the exact currently admitted provider turn. It does not cancel
or fail the Plan task, close Run dispatch, release the Run's worktree, replace the worker, weaken
its route, or relinquish its native session. A preservation failure instead follows the explicit
failure, quarantine, and stop/reap paths below.
Direct low-level coordinator interrupt remains cancel-by-default; only schema-v2 semantic control
may request the preservation contract described here.

Normative dependencies are Phase 90 durable Run control, Phase 89 resident application authority,
Phase 87 semantic actions, Phase 62 Goal/Plan authority, Phase 57 provider governance, Phase 56
exact process reap, Phase 51 process lifecycle, and Phase 8 session fencing and delivery order.

## 1. Closed lifecycle

The successful ordinary lifecycle is:

```text
working or blocked
  -> blocked interaction superseded, when present
  -> schema-v2 interrupt admitted with preserve_turn
  -> effect_started
  -> provider interrupt acknowledged
  -> governed terminal confirmation with attached-session proof
  -> preservation receipt settled
  -> interrupted (nonterminal, zero active turns, one controllable member)
  -> schema-v2 coordinate-free send admitted
  -> same-session successor provider turn admitted
  -> working
  -> ordinary provider completion, fresh hub verification, result acceptance
```

The interrupted Run advertises `send`, `stop`, and `wait`; it does not advertise a second
interrupt. Its Plan task remains `working`, Run dispatch remains open, and its ownership projection
continues to contain the exact member. A preservation receipt is a positive assertion, never a
fallback label for an uncertain transport.

## 2. Exact schema-v2 target

Every schema-v2 semantic-control target contains exactly:

- worker, task, current fence, semantic role, eligible-member count, turn epoch, and turn state;
- native-session digest and process generation;
- worktree, exact route, and Plan-binding digests;
- Run-authority digest; and
- `preservationReceiptDigest`, which is null for a live turn and the exact receipt digest for an
  interrupted turn.

The Run-authority digest binds Run ID, task ID, worker ID, coordination `taskVersion`, and whether
Run dispatch is closed. Task-version-only drift therefore changes authority even when status,
session, worktree, route, and fence appear unchanged.

The application resolves a blocked question or approval before semantic-control admission. It
records and maps `control.interaction_superseded`, transitions the task back to `working`, clears
the single-consumer interaction authority, then resolves and admits a fresh target. Thus interaction
resolution cannot mutate the coordination generation after admission or be used to bypass the
admitted target. Direct coordinator callers that do not use application admission retain their
low-level interaction contract.

The complete target is re-resolved and digest-compared immediately before `effect_started` and is
recomputed again after the per-worker serialized delivery slot is acquired. Any field drift at
either boundary settles `semantic_target_drift` with zero provider effect at that boundary.

## 3. Preservation receipt

A closed preservation receipt has schema version, state `preserved`, transport `attached`,
reattachment state, all session/process/worktree/route/Plan/Run binding digests, turn epoch, fence,
and its own canonical digest. Baton mints it only when all of the following are simultaneously
true:

1. the adapter's terminal interrupt event identifies the exact native session;
2. the adapter explicitly reports `transportOpen:true`;
3. no exact process-close or restart-unconfirmed state contradicts attachment;
4. the adapter card proves reusable multi-turn session support;
5. any blocked interaction has settled successfully;
6. when provider governance is configured, the exact turn is sealed, its governance state is
   valid, and no provider policy or telemetry failure is active;
7. current local and worktree authority remain valid;
8. Plan and Run binding digests remain exact; and
9. Run stop has not been admitted.

The shipped Claude-session, Codex app-server, Grok ACP, and Kimi ACP adapter contracts emit exact
session identity and `transportOpen:true` in deterministic payload tests. A live transport may
claim preservation only when its observed terminal event, card, and current local authority satisfy
the receipt gate and, when provider governance is configured, its provider seal and telemetry are
also valid. A transport that cannot provide the applicable facts must not expose semantic
interrupt, or its confirmation settles without preservation and is failed/quarantined.

Confirmation without qualifying attachment proof never leaves an apparently controllable member.
When the current controller still owns the transport, Baton fails the task and starts a distinct
kill transaction, waiting for confirmed cleanup/reap before settling the escalation. When only
historical authority remains, Baton projects `interruption_uncertain`, explicit
`session_attachment_unproven` attention, zero controllable members, and whole-Run `stop` as its only
safe action. Exact process close similarly invalidates the healthy interrupted projection.

## 4. Successor admission

A coordinate-free `run.send` to the interrupted recipient server-resolves the exact stored member.
It may create one provider turn only after:

- schema-v2 target rechecks pass at both application and coordinator boundaries;
- the Run is not stopping or sealed;
- the preserved receipt is still current and unconsumed;
- session, process, worktree, task, route, Plan, and Run authority remain exact; and
- ordinary provider-governance admission reserves the exact harness/model/effort turn.

The successor uses adapter `prompt(..., 'turn')` on the same native session. It does not spawn a
new harness process, create a refinement task, or claim the Plan node again. Its closed continuation
receipt binds the preservation receipt, session, task/Plan binding, route, provider-admission event,
and new turn epoch. Concurrent successors serialize; the first valid delivery consumes the receipt
and later candidates refuse as drift.

## 5. Recovery and response loss

Admission, effect start, provider acknowledgement, and settlement durably carry
`turnDisposition`, the full target, preservation/continuation receipts, and their digests. Schema-v1
Phase 90 controls retain their original four-field outcome and replay unchanged.

After restart a preserved session initially replays as `orphaned`, never controllable. Recovery
uses the exact native session ID and stored session context with `attachOnly:true`. It admits no
provider turn, sends no prompt, creates no replacement task, and requires exactly one matching
provider-ready identity with no other turn event. Only then does Baton issue a new receipt with
`reattachment:'confirmed'` and project `interrupted` again. Failed or contradictory attachment is
quarantined and, when local authority exists, killed and reaped.

A qualifying preservation receipt seals provider epoch E. Late `turn_completed`, crash, exit, or
blocking-interaction observations normalized to E cannot enter the trust gate, fail the task, or
overwrite replay state; Baton records them as stale against the sealed epoch. Only the
policy-authored preserved-session successor `turn_started` at an exact newer epoch consumes that
seal. Replay applies the same fold. The reusable MockAdapter additionally makes each coroutine's
halt signal and generation immutable, so an aborted old coroutine cannot observe or terminalize a
successor generation through shared mutable state.

If an interrupt or successor response is lost after mapped operational evidence, application
reconciliation correlates the opaque control ID and settles without another adapter call. Evidence
of process close after interrupt produces `session_preservation_unproven`, not a reconstructed
preservation claim.

## 6. Race and failure truth

- Stop admitted before successor admission forbids the successor provider call.
- Stop after successor prompt acceptance records `deliveredDespiteStale:true`,
  `actualDelivery:'turn'`, and settles `outcome_unknown`; stop still kills and reaps exactly.
- Preserve timeout records forced-interrupt uncertainty, fails the task, starts a separate kill,
  and returns only after kill confirmation and cleanup/reap.
- Invalid terminal governance forbids preservation, fails the task, and settles its separate kill
  escalation.
- If kill supersedes an in-flight preserved interrupt, typed per-request waiters settle the
  original interrupt as `superseded_by_stop` and the kill caller as `confirmed`; the shared
  physical kill terminalizes the task and proves one cleanup/reap.
- Stale interrupt confirmations never satisfy kill, and kill confirmations never mint a
  preservation receipt.
- Whole-Run stop remains kill/reap authority, closes Run dispatch, forbids later successor
  admission, and reports exact zero remaining ownership.

Run timeline projection exposes only safe preservation state, transport state, and reattachment
truth. It never exposes session IDs, worker/task coordinates, or binding digests.

## 7. Acceptance matrix

- P91-1 preserves exact task, session, worktree, route, Plan, and Run authority.
- P91-2 resumes one governed turn on the same native session without spawn/refinement/duplicate
  claim.
- P91-3 makes preserve timeout fail, kill, and reap while low-level interrupt stays cancel-default.
- P91-4 rejects closed-transport preservation and proves failure/escalated reap.
- P91-5 proves stop-before-successor forbids provider delivery and reaps exactly.
- P91-6 resolves blocked interaction before a preserved member is exposed.
- P91-7 proves restart attach-only reattachment with zero prompt.
- P91-8 proves a stale fence cannot consume the receipt.
- P91-9 proves schema-v2 admission/effect/Ack/settlement/replay receipt durability.
- P91-10 proves safe coordinate-free timeline facts.
- P91-11 proves concurrent successors admit one turn.
- P91-12 proves post-prompt stop uncertainty and exact reap.
- P91-13 proves invalid provider seal cannot mint preservation.
- P91-14 proves typed preserve-interrupt/kill escalation settlement.
- P91-15 proves a delayed interrupt Ack cannot satisfy a later kill Ack generation.
- P91-16 proves identity-mismatched attach-only recovery confirms kill and owned-worktree reap.
- P91-17 proves process-close-after-preservation clears control, fails the task, exposes the typed
  terminal cause, reaps, survives replay honestly, and agrees with Story.
- P91-18 proves blocked-interaction preparation is durable and a crash before admission fails safe
  without resurrecting or redelivering the prompt.
- P91-19 proves v2 admission rejects receipt/turn-state incoherence before append.
- P91-20 proves interrupt and send acknowledgements reject cross-operation preservation shapes.
- P91-21 proves replay rejects a corrupted closed v2 preservation receipt.
- P91-22 proves Story and Coordinator agree across preserved interrupt and successor admission.
- P91-23 proves Story and Coordinator agree immediately for an interrupt with no receipt and no
  masking kill.
- P91-24 proves epoch E quarantines late completion/crash, epoch E+1 alone completes, exactly one
  verifier runs, and replay does not duplicate verification.

The Plan-bound application acceptance additionally proves the ordinary happy path through fresh hub
verification and accepted result, task-version-only pre-effect drift, serialized-slot drift,
blocked-interaction generation binding, response-loss replay, process-close quarantine, schema-v1
compatibility, and application-level post-prompt uncertainty mapping. Adapter suites pin the exact
Claude, Codex, Grok, and Kimi confirmation payload contracts.

P91-5 invokes the coordinator's already-authorized `stopRunTargets` boundary directly. It proves
transport stop-before-successor ordering and deterministic cleanup, but is not itself evidence that the
Application durably admitted a `run.stop`; Application stop admission is covered by the integrated
Run tests. Likewise, Phase90's historical live semantic interrupt exercised the older interrupt
surface and is not Phase91 proof of preserve/attach-only-resume behavior.

## 8. Evidence boundary and open gates

The focused matrix is deterministic implementation evidence. MockAdapter sessions and synthetic
process lifecycle observations do not prove a live provider session survived interruption, that a
real PID/PGID was reaped, or that an old operating-system process/coroutine quiesced. Those claims
require independent live persistent-harness and real process-lifecycle gates.

The repository-root suite is intentionally not run while this dispatched Baton Run is live. The
deployment command required by this dispatch is `npm test --prefix impl`; its result is recorded in
the focused assessment. The broader root suite and live Claude/Codex/Grok/Kimi persistent-session
interrupt/resume/reap exercises remain open acceptance gates and must not be inferred from adapter
payload fixtures.

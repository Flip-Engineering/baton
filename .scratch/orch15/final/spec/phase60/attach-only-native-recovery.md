# Phase 60 — attach-only native recovery transaction

Native recovery is a control-plane transaction, not a normal first turn. The replayed worker is
untrusted until a fresh provider handshake proves the exact persisted native identity. The
provider must not receive the recovered task Brief, start a turn, call a model, call a tool, or
edit a file before Baton has durably created and claimed the recovery refinement.

## NR1 — closed attach-only adapter mode

The internal adapter `spawn(..., { session: { mode: 'resume', ... }, attachOnly: true })` mode is
accepted only for native resume. New and fork sessions refuse it before child creation. Attach-only
may create the harness process and perform only the minimum native initialize/resume handshake
needed to obtain provider testimony for the persisted session identity. It emits process readiness
and exactly one `lifecycle.spawned`, but it emits no `lifecycle.turn_started`, provider/tool call,
content, file-edit, token, or turn-terminal event until a later explicit `prompt(..., 'turn')`.

Attach-only is a private recovery primitive. Direct, web, MCP, worker, and environment inputs
cannot select it or convert ordinary spawn into an unplanned attached process.

## NR2 — exact wire identity

The fresh handshake must report the exact persisted native ID. Codex uses the returned thread ID,
Claude uses the stream `system/init` session ID, and Grok requires `session/load` to echo an exact
non-empty session ID. A missing Grok identity is not filled from Baton's request. Missing, malformed,
or unequal identity refuses recovery and the untrusted process is killed and reaped.

Requested model, effort, service tier, worktree, private runtime, process generation, and session
context remain exact recovery inputs. Provider-reported model mismatch retains the existing route
governance behavior; recovery never silently substitutes a route.

## NR3 — durable order before provider work

The recovery order is fixed:

1. validate the replayed orphan, owned session context, route, and provider-turn reservation;
2. append the bounded recovery request;
3. create private runtime authority, start an attach-only process, and verify its exact native
   identity;
4. atomically create and claim one bounded-digest refinement task bound to the prior task and
   recovered worker;
5. append the recovered continuation intent bound to exact refinement, route, session, process
   generation, admitted-Brief digest, session-context digest, and adapter-card digest;
6. dispatch the continuation through the adapter's ordinary Brief dialect hook;
7. append an adapter dispatch disposition and expose working authority only if no stop or transport
   terminal won the race.

An append/CAS failure before step 6 causes no provider turn or tool effect. Baton kills and reaps
the attached transport, completes owned cleanup, then releases provider-turn/capacity authority and
leaves the prior verified task unchanged. A prompt refusal before provider acceptance fails the
refinement and follows the same ordered teardown; it never fabricates a working recovery.

## NR4 — ambiguous dispatch is not auto-redelivered

If Baton loses durable authority after the continuation intent but cannot prove whether the adapter
sent the prompt, replay marks the attempt `dispatch_unknown`. Startup recovery never
automatically sends that continuation again. Operator policy may kill/reap, inspect provider-native
history, and retain evidence for a future explicit resolution command; Phase 60 does not yet expose
that resolution command. It cannot claim exactly-once delivery across an unobservable provider
boundary.

Only a typed local `notSent` proof with zero contradictory dispatch facts records
`dispatch_refused`; exceptions, timeouts, untyped false Acks, or any turn/provider/tool fact remain
unknown. `dispatch_accepted` means the adapter acknowledged its documented local dispatch boundary:
Codex has a `turn/start` response, while Claude/Grok prove only their adapter-local write/start
boundary. It does not mean the model completed, or even that every provider accepted work. These
are closed status codes, not provider prose.

Every recovery dialect hook must cross its documented local send boundary synchronously in its
invocation path before any provider-response await can suspend it. Codex may resolve the hook only
after its `turn/start` response, but its request write still precedes that wait; Claude writes its
user frame and Grok starts its ACP prompt locally. If the hook times out after local dispatch but
before a trustworthy Ack, Baton durably retains `dispatch_unknown`, completes confirmed teardown
before releasing provider authority, and never automatically redelivers the continuation. Neither
the local send boundary nor its Ack is provider acceptance.

## NR5 — lifecycle, reservations, and reap

Attach-only process generations use the same exact close/reap contract as ordinary workers. Every
failure after child creation joins one ordinary confirmed stop for that exact fresh generation and
retains local writer authority and the admitted provider-turn/capacity reservation through
`kill.confirmed`, correlated `process_closed` for a started child, and worktree/runtime cleanup.
Only after that confirmed teardown may Baton append provider-turn release and make capacity
reusable. Recovery consumes the already-owned durable session checkout rather than minting a second
worktree-capacity reservation. Stale replayed PIDs are never signalled. Drain-and-close includes
attached, pre-dispatch, accepted, and ambiguous recovery generations.

## NR6 — replay and concurrency

One `{worker, prior task, native session, recovery request}` may have at most one live attempt per
controller epoch. Recovery refinement create+claim is one fail-stop append batch; intent and
dispatch-disposition identities are replay-validated by dedicated store APIs. Duplicate calls
coalesce or return the durable disposition; changed session, context, route, model, effort, task,
timeout, actor, or continuation digest conflicts. Startup recovery remains
bounded and sequential, and manual recovery cannot race its readiness barrier.

A resume/load handshake proves identity, not provider quiescence. Phase 60 does not claim safe
recovery of a prior in-flight native turn; vendor idle testimony, fork, rewind, transcript
inference, and provider-history reconciliation remain separate capabilities.

## NR7 — adversarial and zero-quota gates

Acceptance requires the fixture and replay matrix to cover all three native session adapters plus
coordinator replay:

- attach-only emits exact identity but no user frame, `turn/start`, `session/prompt`, provider/tool
  work, content, tokens, or turn terminal before explicit prompt;
- attach-only new/fork refusal occurs before process creation;
- missing/wrong/malformed identity, model mismatch, setup timeout, transport close, and prompt
  refusal kill and reap exactly once;
- recovery-request, atomic refinement-create/claim, continuation-intent, and dispatch-disposition
  append loss;
- crash/restart at every order boundary, including honest `dispatch_unknown` with no redelivery;
- duplicate/manual/startup races, provider-turn release, stop-versus-dispatch, duplicate provider
  readiness, bounded dispatch timeout, and exact worktree/runtime/branch/writer cleanup;
- ordinary fresh spawn, multi-turn prompt, interrupt, kill, replay, and opt-out behavior unchanged.

Fixture tests are mandatory before provider quota. A later provider-backed proof must use Baton
itself, pin exact harness/model/effort, preserve credentials in private runtime scope, record bounded
process evidence, and kill/reap every admitted generation.

## NR8 — retained boundaries and next slices

Phase 60 does not claim exactly-once provider delivery, provider acceptance from a local adapter
Ack, recovery of an old in-flight turn,
vendor-neutral fork/rewind, or provider-native history reconciliation. It does not expose attach-only
as public user authority.

The dependency-ordered next slices remain explicit:

1. graph-backed Representation production from existing bounded AST/CST structural delta, SCIP
   snapshot, and bounded CPG semantic-delta capabilities;
2. first-class append-only Goal/Plan authority with authenticated web and MCP define/propose/
   distinct-approve/status commands and a plan-gated spawn CAS;
3. live budget amendment, integration/publication/deploy/rollback approvals, richer operator UX,
   deeper representation rungs, semantic merge, and conditional e-graphs.

The causal/temporal knowledge graph remains a self-contained Baton subsystem inspired by the
repository-local project-manager design. No homelab or external project-manager runtime,
credential, query, mutation, or integration is introduced.

# Lifetimes audit: participant, work, group, workspace, contribution, acceptance

2026-09-13. Scope: the runtime policy question posed by [the swarm design](../../../39-swarm-runtime.md)
and [the runtime review](../../../40-runtime-review-2026-09-12.md) — which of today's lifetime
couplings are *needed authority/resource invariants* and which are *accidental workflow policy*.
Read-only audit; no source changed. Evidence is file:line anchored against this worktree
(`9fdbb2f7`). Line numbers drift; the identifiers are the durable reference.

Method: five parallel read-only source surveys (coordinator, coordination-store, workflow layer,
adapters/waves/messaging, workspace/context/recovery) with the load-bearing anchors re-verified
by hand in this worktree. Sections 2–4 report reality; sections 5–7 propose. Everything proposed
reuses named existing machinery; the last section states what is deliberately **not** proposed.

## 1. Executive summary

The runtime core already separates the facts the design demands — the store is append-only with
~120 attributable event kinds, the adapters emit distinct turn-end vs session-close events, the
pausable-checkpoint seam parks a finished turn for explicit adjudication, acceptance is a
revocable durable act, and unaccepted work is physically preserved. The *policy* collapse happens
at identifiable welds, all of them accidental:

1. **Member ↔ task 1:1 weld.** A worker handle carries exactly one immutable `taskId`
   (coordinator.mjs:4748) and its display status is *derived* from that task's status
   (coordinator.mjs:15030-15046). A participant cannot hold two concurrent claims, and "is this
   participant available" is answered by sniffing live handle maps
   (coordinator.mjs:7079-7085), not from durable records.
2. **Workspace ↔ task 1:1 weld.** A workspace receipt forces `branch = baton/<physicalOwnerId>`
   and `worktree = .baton/wt/<physicalOwnerId>` (worktree.mjs:334-335) and binding validation
   admits exactly one `(attemptId, runId)` expectation (worktree.mjs:601-604). A shared,
   multi-writer group workspace is unrepresentable today.
3. **Wave ↔ completion weld — imposed by the workflow interpreter, not by the wave machinery.**
   `wave.mjs` explicitly avoids whole-round barriers (wave.mjs:~650-654, "a whole-round barrier
   would let one hung member withhold every sibling's next read") and treats timeouts as
   observation budgets, never completion authority (wave.mjs:~698-711). The interpreter's drive
   loop removes a member from `pending` only on terminality and loops `while (pending.size > 0)`
   (workflow-interpreter.mjs:905-907, :922), then computes `WAVE-OK` as *all-member success +
   zero residue* (workflow-interpreter.mjs:721-728), and `close()` initiates stops for the entire
   roster as the only group barrier (wave.mjs:824-831).
4. **Roster ↔ definition-digest weld.** Changing a workflow roster requires a whole new
   revisioned definition generation (workflow-definition.mjs:258-268, round ≥ 2, parent-digest
   chain), with attempts pinned 1:1 to plan nodes (:316-318) and member ceilings re-declared
   three times with three values (64 interpreter :53, 64 DSL :22, 8 recipes :33).
5. **Two disjoint acceptance regimes.** The coordinator's trust gate runs real verification and
   revocably accepts (coordinator.mjs:13633, :13893-13912, revocation :9489-9507); the workflow
   layer records `verificationRequested` but never executes it, and `WAVE-OK` consults only
   terminality + harvest substrings + residue (workflow-interpreter.mjs:476-488, :721-728).
   Referee's red/green regime (referee.mjs:283-292, gated at coordinator.mjs:10584-10588) is not
   wired into the workflow verdict at all.
6. **Context ↔ plan weld.** Durable context sessions/cells exist (event-sourced, idempotent
   admission), but `openSession` requires goal + plan + dispatch + a working plan-gated task
   (context-runtime.mjs:1153-1197), and the repository context runtime is frozen to one
   deployment `treeSha` (context-runtime.mjs:487-492, ancestry refusal :556-558).
7. **Turn-scoped steering.** Pause records are keyed `pause:<taskId>:<seq>`
   (coordinator.mjs:2148-2156) and steering acts refuse anything not in task `paused`
   (:2294-2301) — nudge/claim/wait cannot target a participant or a group.

None of these welds is load-bearing for authority. The durable substrate (§5) plus six bounded
changes (§7) give the runtime a participant registry, mutable groups, first-class non-final
contributions, shared workspaces, selected-event dependencies, and honest delegation visibility —
without a second event store and without recompiling DAGs.

## 2. Concept reality map

Design concepts from docs/39 vs source reality (all anchors hand-verified or scout-verified in
this worktree):

| Concept (docs/39) | Reality today | Verdict |
| --- | --- | --- |
| **Agent/session** — continuing participant, survives assignments and turns | Worker handle `w-N` carries one immutable `taskId` (coordinator.mjs:4748); member statuses are in-memory `{pending, working, blocked, stopping, dead, exited, orphaned, interrupted, idle}` derived from task status (`paused→blocked`, coordinator.mjs:15030-15046, seed :4840). Reuse exists: idle handle + terminal task + multiTurn card ⇒ `reusableFollowUp` (coordinator.mjs:7627-7631); refinement chains share one worker across sequential tasks (replay tail comment, coordinator.mjs:14704-14713). | Participant exists but is welded to one current task |
| **Work** — evolving intention, several concurrent contributors | Durable task ledger, closed version-CAS transitions (coordination-store.mjs:156-171, `transitionTask` :13171+), single `assignee`, deps via `readyTasks()` (coordination-store.mjs:12212-12214). Board items with versioned claims/histories (coordination-store.mjs:15427-15494); scratch claims fence-CAS'd (coordinator.mjs:11053-11068). A claim outlives a member (durable task survives; recovery creates a new claim as a *refinement task*, coordinator.mjs:8578-8622). | Work identity is the most mature piece; concurrency capped at one assignee |
| **Group** — mutable membership, delegated coordination, subscriptions | No group object. Group ≈ run + wave: roster folded from `driver.recorded` payload `wave.started` (coordination-store.mjs:8472-8495), role→run index `_waveRoleRuns` (:8460-8466), close-once `wave.closed` (:13829-13886). Cross-run relations admitted only inside one live wave ("the sole cross-Run relaxation", coordination-store.mjs:15997-16004). Recruitment-after-start exists three ways: `waves.attach` (application-semantics.mjs:1560-1580), per-layer plan waves (coordination-store.mjs:11467-11572), mid-run revision/recovery refinements (coordinator.mjs:4129, :8578). | Recruitment: command-mediated, real. Group: evidence, not a first-class mutable thing |
| **Workspace** — private / group-owned / scoped shared / mediated patches | Physical owner receipt `ws-<32hex>` allocated before any effect, fsync-published, exactly released (worktree.mjs:671-720, :754-782); single-writer capacity rows keyed `worker:<taskId>` (worktree-capacity.mjs:26-31); adoption = ownership *transfer* (:558-577). Reconcile is classify-first and retains foreign/unproven residue (worktree.mjs:1684-1694, fail-closed receipt-only refusals :1843-1876). | Private worktrees: excellent. Shared: unrepresentable (see §4.2) |
| **Observation/contribution** — non-final, ordinary text allowed | Coordinator lanes accept prose: peer messaging with hub-derived membership, one reply slot per sender, `runId` broadcast fan-out (coordinator.mjs:13164-13340, :7131-7141); board reports (`board.report_submitted`, coordination-store.mjs:15596); scratch facts; worker-claimed artifacts recorded *untrusted* (`accepted:false`, grounding `worker_prose`, coordinator.mjs:13880-13888). The workflow layer allows **no** member→member channel: `MEMBER_FIELDS` closed (:62), objective by file reference only (:211-213), messages only as fixed steering strings (:57, :929-933). | Runtime: yes. Workflow layer: a closed I/O straitjacket |
| **Turn end ≠ pause ≠ acceptance** | `lifecycle.turn_completed` vs `lifecycle.process_closed`/`crashed`/`kill.confirmed` are distinct events in every adapter (claude-session.mjs:1249-1272 vs :1602-1623; omp-rpc.mjs:607-673 vs :898-920 — with an explicit `isTerminal:false` continue-state; codex-appserver.mjs:693-726 vs :503-539). Pausable cards park checkpoints durably (`turn.paused`; task → non-terminal `paused`, coordination-store.mjs:165-170), and the coordinator "sends no policy progress nudge, arms no window, and never lets elapsed time decide the claim" (coordinator.mjs:2111-2186); dispositions are exactly `claim_turn` (re-runs the live trust gate, :2443-2498), `nudge_turn` (real continuation, :2345), `wait_turn` (non-consuming receipt, :2411-2415). | The load-bearing separation exists and works — the seam to build on |
| **Acceptance** — distinct from ending, revocable | Trust gate with fresh capture, required-effect/path gates, referee verification (coordinator.mjs:13633, :800-802, :13687-13690); durable terminal batch with verdict manifests (:13893-13912); post-hoc revocation `task.acceptance_revoked` cascades to artifacts/knowledge (coordination-store.mjs:13214, :8408-8430). Group-level: waveId-pinned settlement leases, swept, idempotent (coordinator.mjs:12014-12105; store :13015-13131). | Durable and honest |
| **Dependencies on selected events** | Workflow layer: none — members all start together; the only cross-member act is a one-shot `signalOnMembersDone` broadcast (workflow-interpreter.mjs:285-300, :925-937). Plan layer: `blockedBy` with a **completion-only** gate (orchestrator-plan.mjs:649-654); evidence refs `{coordinationSeq \| artifactId}` exist (:95-104) but never gate anything. | Missing; the evidence-ref shape is the ready-made hook |
| **Native subagent visibility** | None of the three adapters exposes delegated subagents: a Task-tool delegation surfaces as one opaque `content.tool_call` row (claude-session.mjs:1157-1170; omp-rpc.mjs:736-748; codex-appserver.mjs:682-691); only OS process-group accounting exists (process-lifecycle.mjs:94-130). Meanwhile the brief text asserts "Delegated participants inherit the same constraints" (adapter.mjs:125). | Gap: asserted containment without any observation/steer/budget/close seam |

## 3. The four lifetime facts — what the store can already express

The design's core demand: *a turn ending, a contribution being submitted, a session closing, and
work being accepted are four different facts.* Reality by record kind (coordination-store.mjs,
append sites verified):

- **Turn end** — *not a store kind.* Turns live in the per-worker operational log
  (`lifecycle.turn_started/completed` consumed via injected resolvers, :7951-7971) and durably
  surface only as the `paused` task state (checkpoint park, :165-170) or run-control turn
  receipts (`delivery:'turn'`, :4739-4743). The pause record itself (`turn.paused`/`turn.settled`)
  is durable in the per-worker log, but the live `_pausedTurns` map is deliberately
  coordinator-RAM (coordinator.mjs:1195-1202).
- **Contribution submission** — expressed, but scattered across three lanes with different
  vocabularies: `board.report_submitted` (:15596), `artifact.registered` with an `accepted` flag
  (:13243, grounding rules :13276-13280), `scratch.fact_posted` (:14531), plus knowledge
  promotions. There is no single "contribution" identity a reviewer or a dependency can cite.
- **Session close** — no dedicated kind. Context sessions fold `active` (:8262-8268) and are torn
  down implicitly by run stop (:4602-4605); process truth lives in the adapter death certs and
  the `ProcessCloseReapLatch` (unconfirmed reaps stay *unknown*, process-lifecycle.mjs:163-200).
  The fact is derivable from events but not nameable.
- **Acceptance** — the best-specified fact: `task.transitioned → completed` reachable only
  through `working` (the trust gate's claim-time evaluation, :166-172), plan adoption
  (`run.result_adoption_admitted/completed`, :12255/:12277), export, and revocation. Waves close
  once with an 8-key campaign record (:13829-13886).

So the four-fact separation is ~80% built. What is missing is naming and one registry: promote
turn/checkpoint/session facts to first-class store kinds bound to a *participant* id (not a task
id), and unify the three contribution lanes under one citable identity.

## 4. Coupling inventory: accidental policy to remove

Each item states the weld, the anchor, and why it is accidental (not an authority invariant).

### 4.1 Participant ↔ task

- Handle carries one immutable `taskId` (coordinator.mjs:4748); claim singular per member
  (`task.claimed`, store :13167, assignee uniqueness :13161-13164). Sequential chains exist
  (revision/recovery/preserved-resume refinements) but never concurrent claims.
- Worker status derived from task status: `_deriveWorkerStatus` maps `paused→blocked` and
  terminal→`idle` (coordinator.mjs:15030-15046); replay seeds map non-terminal tasks to
  `orphaned` (:4840). Consequence: a participant parked on a checkpoint is indistinguishable in
  kind from one blocked on input; messaging admissibility sniffs this derived state
  (`_activeMessageMember` requires task status ∈ {working, input_required, paused} and handle not
  dead/exited/stopping, coordinator.mjs:7079-7085) — a paused task is messagable, a
  crashed-but-retryable one is not, purely as an accident of two unrelated enums.
- Steering is task-scoped only: pause ids `pause:<taskId>:<seq>` (:2148-2156),
  `_pausedActTargets` refuses non-paused tasks (:2294-2301). A persistent reviewer cannot be
  nudged as a participant; only its current task can.
- Session "done" is gated on owning local resources: two-phase stop finality consults
  `_ownsLocalResources` (coordinator.mjs:2044-2056) — participant exit is welded to workspace
  custody.

Why accidental: authority needs (a) a claimant per mutating act, (b) version CAS on contested
objects, (c) attributable events. None requires one-claim-per-participant or status derivation.
The design doc's counterexample — one participant contributing to several activities while
remaining available — is exactly what the weld forbids.

### 4.2 Workspace ↔ task

- Receipt schema welds `physicalOwnerId` = directory name = branch suffix, with a single
  `controller {pid, pidStart}`, `logicalTaskId`, `runId`, `attemptId`, `processGeneration`
  (worktree.mjs:324-350; binding validation admits exactly one expectation `(attemptId, runId)`,
  :601-604). A second allocation under the same owner id is refused (:852-863).
- Capacity: rows keyed `worker:<taskId>`, one `ownerId`/pid each (worktree-capacity.mjs:26-31);
  `adoptWorker` transfers sole ownership (:558-577). No co-tenancy.
- Close-of-session entangled with capture: `_removeOwnedTaskWorktree` computes
  `preserveUnaccepted` and the law "exact process close is permission to snapshot, not permission
  to discard" (coordinator.mjs:8839-8848, :8876-8880) — good invariant, but its authority inputs
  (`ownedWorktreeAuthority`, `cleanupPending`) live only in in-memory handle flags (:8802-8868),
  so post-crash custody must be re-derived by startup reconcile expectations
  (:1433-1465) instead of read from durable records.
- Runtime scopes (env/HOME redirection) are directory-presence only — no durable receipt, unlike
  worktrees/capacity (runtime-isolation.mjs:79-205; create/remove log events
  coordinator.mjs:8891-8918). Fence stamps for control-op staleness are in-memory only
  (fence.mjs:1-70) while the transport layer already has durable `pidStart` identity
  (process-lifecycle.mjs:33-90) — two fencing regimes, one durable, one not.

Why accidental: what authority actually needs is *exactly-accounted custody* (who may write,
who must be consulted before removal, what happens on unknown outcomes) — the receipt protocol
already delivers that. The weld of *one* holder is a deployment default promoted to schema.

### 4.3 Wave ↔ completion ↔ close

- The interpreter, not the wave machinery, imposes the barrier: drive loop exits only when every
  member is terminal or every remaining member parks on an already-handled decision
  (workflow-interpreter.mjs:905-944); `settle()` runs drive → capture → `wave.close` → re-read →
  harvest → verdict as one lifetime (:637-740); `WAVE-OK = everySuccessful && everyHarvested &&
  cleanupComplete` (:721-728). Close initiates stops for the whole roster
  (wave.mjs:824-831) — the *only* group synchronization point, so "one useful change accepted
  while others continue" (docs/39) has no path that does not stop everyone.
- Interpreter re-declares phase vocabularies (`TERMINAL_PHASES` :546, `SUCCESS_PHASES` :551)
  that wave.mjs assigns to the registry (:16-18) — three copies of what "done" means.
- Verification recorded but never executed: `verificationRequested` (:476-488, emitted :714) is
  explicitly "never execution proof"; nothing runs `suite:`/`gate`; WAVE-OK never consults it —
  while the real red/green regime runs un-wired in referee/coordinator (§1.5).

Why accidental: wave-as-cohort is useful (launch request, observation boundary, campaign
accounting). Wave-as-mandatory-completion-boundary for every collaboration is the universal rule
docs/39 supersedes, and the wave layer itself already implements the honest semantics — the
policy layer above it re-imposes the barrier.

### 4.4 Roster ↔ definition digest; universal I/O

- `workflow-definition.mjs:212-215` freezes `workspace:'isolated'`, `join:'operator_selected'`,
  and a two-value strategy enum into the durable schema (also forced in application-client.mjs:180-183
  and application-semantics.mjs:180-181). Attempts must instantiate catalog roles exactly
  (:307-313) and cover plan nodes 1:1 (:316-318); regrouping = new revisioned definition
  (:258-268, :337-393).
- Closed member shape `MEMBER_FIELDS` (workflow-interpreter.mjs:62); objective by file reference
  only (:211-213); no member→member payload channel anywhere in the layer; steering bodies are
  fixed strings (:57, :929-933). The universal 9-field node template
  (workflow-definition.mjs:9-12, :95-121) is *coarser* than what the runtime already negotiates
  per task (goal-plan nodes with optional fields, goal-plan.mjs:297; brief prose authority,
  adapter.mjs:129-132).
- Member ceilings: 64 (interpreter :53), 64 (DSL :22), 8 (recipes :33). By contrast
  `task-topology.mjs:5-16` — bounded quotas as data over the coordinator's task tree — is the
  right shape and fixes no rosters.
- `workflow-policy.mjs` is policy theater: `maxRevisionAttemptsPerRound !== 1` refused (:58),
  `budgetMode`/`allocation` singletons (:64-65), stopConditions pinned to an exact set (:6-11).
  `recipes.mjs` couples two drivers at once (createWaveDriver :457-474 and runWorkflow :583-585)
  and writes manifests to disk (:453-455).
- Interpreter-inline effects inside a module documented as "pure evaluation over a frozen spec"
  (:8): `materializeToDisk` writes the working tree (:813-820); `execFileSync` git subprocesses
  (:419, :428, :443); driver clock policy (:462-473).

Why accidental: schemas belong at effectful boundaries (docs/39, docs/40). Definitions and DSLs
remain useful *optional* expressions; what must go is their role as mandatory representations of
every collaboration, and constants that foreclose runtime-selectable identities.

### 4.5 Group membership ↔ in-memory handles; wave identity ↔ first spawn

- Messaging authority reads live coordinator maps: `_activeMessageMember`
  (coordinator.mjs:7079-7085) and same-run/same-live-wave adjacency via `_messagePeers`
  (:7087-7097, scanning `eventsView()` for `wave.closed` on every check). Membership is therefore
  neither durable nor declarable — a group that a recruiter *means* to create has no existence
  until members happen to share a run.
- Wave identity is minted from the first member's `run.start` (wave.mjs:287-299; "holds no
  durable state of its own", :7) — the group record is a side effect of one admission.
- Fixed role roster: `permissionsForWaveRole` knows exactly `coordinator-worker` vs executor
  (coordination-store.mjs:100-103) — no dynamic roles despite waves already minting per-role
  board grants (:11841-11867, :16042).
- Delivery is welded to per-session nudge prompts (`_deliverPeerMessage` serializes onto the
  native session send chain, coordinator.mjs:7100-7108), and the worker-named `budget` knob on
  the wire (claude-session.mjs:273-283; hub default `parent.budget ?? 1`, :13245) lets worker
  prose set an authority-adjacent limit.

### 4.6 Context ↔ plan gate; frozen tree

- `openSession` requires goal + plan + dispatch + working task + a `driver.recorded` workflow
  definition event (context-runtime.mjs:1153-1197); only the REPL path
  (`openReplSession`, :1298, on settled `repl.manifest_admitted`, coordination-store.mjs:1304-1306)
  escapes the plan apparatus.
- `RepositoryContextRuntime` is frozen to the deployment `treeSha` (context-runtime.mjs:487-492);
  retained-result projection refuses any other base (:556-558). Evolving shared context therefore
  means a new runtime per tree, while the store already has the right primitives: supersession
  chains for context packs (coordination-store.mjs:1262-1265) and bitemporal knowledge records
  with `validFrom/validTo/validityVersion` + per-id history (:4496-4523).

### 4.7 Store-level structural coupling (why local change is hard)

- `_append` idempotency is first-write-wins without payload comparison
  (coordination-store.mjs:1845-1846); a reused key with *different* payload is silently swallowed
  unless the lane happens to digest-check (message lane does, :14335-14337; `claimTask` /
  `transitionTask` / `recordDriver` / `registerArtifact` do not, :13157-13173, :13705-13711,
  :13240-13241).
- `driver.recorded` is an open stringly-typed namespace inside a closed fold (waves, steering
  registration, workflow binding, recovery intents all ride it, :13705-13711, fold :8455-8495) —
  new group/participant kinds cannot be added without either abusing it or extending the 1,190-line
  `_apply` else-if monolith (:8118-9308).
- Exhaustive key-set equality validators (`Object.keys(p).sort().join(',') !== fields...`) across
  dozens of admission paths (:8015, :8032, :8052, :4124, :4191, :4377, and receipt validation
  worktree.mjs:329-330) make payload evolution a breaking change everywhere at once.
- Full-log rescans on hot paths (workflow definition validation :2754, :2904, :5423; run-identity
  has-effects :2213-2225; wave membership :16055-16058; orphans :15711-15714).
- Turn semantics, board application policy, KG governance, and supply-chain trust domains all
  live in one module (line map in the store survey: context program ~:5130-8006; board
  :15203-16145; KG :16539-18005; provider :3909-4495).

### 4.8 Duplicated authority: the second runtime

`holistic-runtime.mjs` is a clean *effect* toolkit (EventJournal with append-reentrancy guard and
`assertExternalAwaitAllowed`, :129-166; five CONTROL_LANES with emergency first, :168-223;
command receipts, :507-546; crash-safe JSON, :255-264) and its primitives are consumed by the
convergence/surface layer. But it also carries *policy doubles*: `MemberSupervisor` with a fixed
`retryBudget = 2` (:360-422), `NotificationBus` with a `message.*` vocabulary overlapping the
store's message lane (:269-358), `IsolationAuthority`/`ReadinessResolver` (:424-471) — and
`production-convergence-state.mjs` re-implements Durable variants of the same supervisors
(:123+). These must be stripped or externally-owned before any reuse, or the swarm will have two
answers for retry, notification, and isolation authority. Notably the live coordination path
imports only `BatonControlError`/`digestValue`/`replayProjection`/`readJsonIfPresent` from it —
the effect toolkit, not the policy doubles.

## 5. Durable pieces to reuse (the buildable substrate)

Grouped by the concept they would carry, with the anchor to build from:

1. **Ledger kernel** (coordination-store.mjs:1734-1967): append-only JSONL, global `seq`, running
   sha256 identity, atomic single-write batches with digest-addressed batch ids, truncated-tail
   refusal, strict gap check, global idempotency-key uniqueness, per-segment verification.
   Projection checkpoint as disposable cache with "the ledger stays authoritative" discipline
   (:1101-1178, :1866-1871); segment compaction (:1645-1731); writer lease with `pidStart`
   anti-reuse (:1337-1455). *This is the swarm's event history — no new store.*
2. **Work identity**: task ledger + version CAS + closed transitions (:156-171, :13171+),
   acceptance with manifests + revocation (:13214, :8408-8430), evidence anchors digest-binding
   external operational facts to coordination seq (:13222-13236, read via :8436-8445), content-
   addressed contribution ids (:4316-4318), board items with versioned histories
   (:15427-15494), scratch claims with worker-turn fences (coordinator.mjs:11053-11068).
3. **Checkpoint adjudication**: durable `turn.paused`/`turn.settled`, non-terminal `paused`
   state, single-consumer reservation with rollback (`_reservePauseRecord`
   coordinator.mjs:2269-2293), the three explicit dispositions (:2345, :2411-2415, :2443-2498),
   story fold keeping parked ≠ idle (story.mjs:110-113, :383-391), and the no-self-drive law
   (coordinator.mjs:2111-2186).
4. **Wave observation discipline** (wave.mjs): budgeted/cancellable per-member `observeRead`
   (:58-86), observer-owned drive pumps with owner tokens (:494-575), silence as an evidence-only
   progress class (:748-770), "timeoutMs is an OBSERVATION BUDGET, never completion authority"
   (:698-711), honest close accounting (`pumpQuiescent`, residue never coalesced to zero,
   :817-865), zero-residue `wave.closed` (coordination-store.mjs:13829-13886). The driver's
   good parts: no `hardCapMs`, unknown policy fields refuse loudly (wave-driver.mjs:39-46),
   opt-in recorded `claim-on-stall` (:756-758, :489-519).
5. **Peer messaging grammar + hub admission** (claude-session.mjs:253-286;
   coordinator.mjs:13164-13340): identity-free wire frames, hub-derived membership, reply target
   inherited verbatim, one reply slot per sender (fan-in), `runId` broadcast (fan-out), durable
   `message.sent/delivered` audits (:7226-7252).
6. **Workspace custody protocol** (worktree.mjs): allocate-before-effect receipts with
   temp→final fsync publication and recovery of unknown outcomes (:529-574, :671-720), exact-
   absent release (:754-782), classify-first reconcile that retains foreign/unproven residue and
   fails closed (:1553-1962), preservation-before-reap pinning `refs/baton/checkpoints|results`
   (coordinator.mjs:8731-8798; index.mjs:853-897). HMAC-sealed capacity state with stale-lock
   reaper (worktree-capacity.mjs:264-400). Process authority latch retaining *unknown* until
   descendant absence is proven (process-lifecycle.mjs:94-130, :272-284).
7. **Plan/dependency representation** (orchestrator-plan.mjs): event-sourced fold + snapshot
   (:24-30, :289-409), authority matrix with wave-subtree-scoped worker seats (:437-460),
   version-CAS idempotent write lane (:489-713), `ownedBy {role, run, wave}` separation (:119-143),
   and the evidence-ref shape `{coordinationSeq | artifactId}` (:95-104).
8. **Adapter event vocabulary + resume handles**: uniform `lifecycle.turn_completed` /
   `control.interrupt_confirmed` / `lifecycle.process_closed` / `kill.confirmed`; per-adapter
   resume/fork identity (omp death cert carrying `sessionId`/`sessionFile`, omp-rpc.mjs:898-920;
   codex thread fork with `session_identity_mismatch` refusal, codex-appserver.mjs:851-888);
   `turnCompletion:'pausable'` card field (claude-session.mjs:647, codex-appserver.mjs:316,
   consumed coordinator.mjs:2932-2934); evidence-only terminality laws (omp-rpc.mjs:3-14);
   worker-policy negotiation chain (worker-policy.mjs:38-53, :313-352).
9. **Evolving-context primitives**: durable context session/cell admission, idempotent by
   manifest digest, pending admission surviving aborts (coordination-store.mjs:8262-8267,
   :10293-10392; context-program.mjs:1277-1284, :1330-1348); context pack supersession
   (:1262-1265); bitemporal knowledge records (:4496-4523, :16554-16573); scratchpad partitions
   with settlement bases (:14754-15150).
10. **Delegated-coordination leases**: run-orchestrator leases (:2320, :2346), waveId-pinned
    settlement leases with sweep (coordinator.mjs:12014-12105; store :13015-13131), review
    authority check (:7391-7398) — the exact shape a group lease needs.
11. **Effect toolkit** (holistic-runtime.mjs): lanes, command registry/receipts, journal
    mechanics, crash-safe IO, DeploymentContinuity (:473-493) — after stripping the policy
    doubles (§4.8).

## 6. Needed authority/resource invariants vs accidental policy

**Invariants (keep, and make *more* durable where noted):**

- Single-writer ledger with attributable, idempotent, gapless events; unknown outcomes stay
  unknown (transport timeout ≠ failure; unconfirmed reap ≠ closure) — omp-rpc.mjs:3-14,
  process-lifecycle.mjs:94-130.
- Version CAS + assignee accountability on contested mutations (tasks, board items, plans).
- Acceptance only via explicit evaluation; worker prose never self-certifies
  (coordinator.mjs:13880-13888); acceptance revocable.
- Adjudication authority is a named principal (operator, run-orchestrator lease, group lease);
  no clock, count, or coordinator self-prompt ever decides work (coordinator.mjs:2111-2186;
  wave.mjs:698-711; wave-driver #163 law :39-46).
- Custody accounting before any destructive effect: capacity settled before checkout removal,
  preservation-before-reap, exact-absent release, classify-first reconcile that fails closed.
- Containment honesty: env/credential isolation is a boundary, not OS containment
  (runtime-isolation.mjs:1-2); capability deltas live on adapter cards, not discovered by
  runtime refusal.
- Bounded growth: recruitment quotas as data (task-topology.mjs:5-16), provider/host-derived
  concurrency — not fixed headcounts.

**Accidental policy (remove/loosen):** everything in §4 — the 1:1 welds, the interpreter's
all-member boundary and unexecuted verification, definition-time workspace/join/strategy
singletons, roster-in-digest, plan-gated context sessions, in-memory membership authority,
first-write-wins idempotency, the `_apply` monolith, and the duplicated supervisors.

## 7. Proposed runtime API and authority boundaries

Design rule: every new concept is **new event kinds + folds in the existing store, evaluated at
existing effect boundaries** — no new journal, no new orchestration framework, no schema on
ordinary conversation. Waves, runs, plans, boards, and the DSL all remain; each becomes a client
of the concepts below rather than their definition.

### 7.1 ParticipantRegistry (durable) — the foundation

New kinds (fold into `_apply` successor modules; payload digests bound at `_append`):

```
participant.registered   { participantId, harness, route, cardDigest, actor }
participant.attached     { participantId, activityId, role?, grantDigest?, actor }
participant.detached     { participantId, activityId?, actor, reason }
participant.session_fact { participantId, fact: 'turn_ended'|'checkpoint_parked'
                          |'session_closed'|'session_unknown'|'recovering',
                          evidenceSeq, actor }
```

- `participantId` = current worker id (`w-N`) at first; the registry row, not the handle, is the
  identity. `session_fact` promotes what adapters already emit (§2) and the store already
  half-expresses (§3) into named facts.
- Projection: `_participants: Map<participantId, {harness, route, activities:Set, groups:Set,
  sessionState, lastFactSeq}>`. `_deriveWorkerStatus` (coordinator.mjs:15030-15046) becomes a
  rendering of this projection for legacy surfaces.
- **Messaging authority** reads the registry: replace the `_activeMessageMember` handle sniff
  (coordinator.mjs:7079-7085) with registry lookups; keep the existing queued-delivery recheck
  (the lane already re-verifies at delivery, :13191+). A participant is messagable iff it holds
  `sessionState ∈ {available, turn_active, checkpoint_parked}` — precisely the current admissible
  set, now derived from facts instead of two unrelated enums.
- **Steering generalized to participants**: pause/steer acts accept `participantId` in addition
  to `taskId` (the current `pause:<taskId>:<seq>` keying stays for task-scoped acts). This is
  what makes a *persistent reviewer* first-class: an attached, available participant can be
  asked for review without owning the builder's task.
- Authority: registration/attach are coordinator-admitted effects (existing command admission);
  attach requires either run authority or a group lease (§7.3).

### 7.2 Claims and contributions — separate the four facts

- **Keep** the task ledger as activity identity, single active assignee as the default
  (mutating-authority invariant), and add concurrent *contributors*:

```
task.contributor_added   { taskId, participantId, stance: 'review'|'scout'|'build', actor }
task.contributor_removed { taskId, participantId, actor }
```

  Contributors get read/steer access and may submit; they never hold the assignee's CAS.
- **One contribution identity** unifying the three lanes (board reports, artifacts, scratch
  facts):

```
contribution.submitted   { contributionId, activityId, participantId,
                           kind: 'finding'|'edit'|'question'|'reference'|'check'|'change',
                           digest, refs: [{coordinationSeq|artifactId}], nonFinal: true, actor }
contribution.accepted    { contributionId, verdict?, basis, actor }   // trust-gate or lightweight adoption
contribution.revoked     { contributionId, reason, actor }            // reuses acceptance-revocation evidence kinds
```

  `submitted` is non-final by default; `accepted` reuses the existing machinery — full gate
  (`task.transitioned → completed` via trust gate, coordinator.mjs:13893-13912) for changes,
  lightweight adoption (the `run.result_adoption_admitted` pattern, store :12255) for findings.
  Revocation reuses `ACCEPTANCE_REVOCATION_EVIDENCE_KINDS` (coordinator.mjs:183).
- **Fact separation, explicitly:** a pausable session's turn ends ⇒ `session_fact
  checkpoint_parked` (exists: `turn.paused`). Submitting a draft ⇒ `contribution.submitted` —
  an *act by the participant*, admitted like today's board report, requiring no unpark.
  Closing the session ⇒ `session_fact session_closed` with the adapter's death-cert/resume
  handle as evidence. Accepting work ⇒ `contribution.accepted`/task transition by an authorized
  principal — never inferred from any of the other three. `claim_turn` continues to be the act
  that *evaluates* a parked checkpoint through the real verifier (coordinator.mjs:2443-2498);
  timers and counts stay non-evidence.
- Claim-replay honesty: persist the pause record's worker-result origin so `claim_turn` parity
  does not rest on an in-memory field (today's `workerResult` rides the RAM record,
  coordinator.mjs:2147-2150).

### 7.3 Groups (mutable membership) — waves demote to cohorts

```
group.created        { groupId, purpose, initialParticipantIds, authorityScope, actor }
group.member_joined  { groupId, participantId, grant?, actor }     // recruitment, mid-flight
group.member_left    { groupId, participantId, actor, reason }
group.lease_acquired { groupId, principal, scope, untilSeq?, actor }   // delegated coordination
group.lease_released { groupId, principal, actor }
group.context_updated{ groupId, note, version, actor }             // evolving shared context
```

- Fold: `_groups: Map<groupId, {members:Set, leases:Map, contextHead}>`. Messaging/subscription
  authority = registry ∧ group membership (`_messagePeers` (coordinator.mjs:7087-7097) generalizes
  from run/wave adjacency to group adjacency; run/wave adjacency remains valid). Cross-group
  relations still require a shared wave or explicit grant — today's "sole cross-Run relaxation"
  (store :15997-16004) becomes one rule instead of a special case.
- **Leases** generalize the existing run-orchestrator (store :2320) and settlement leases
  (coordinator.mjs:12014-12105) with the same sweep discipline (:13075-13131): a subgroup may
  hold authority to maintain its shared context or coordinate an interface *without the root
  relaying every update* (docs/39). Lease scope is explicit; revocation is a store event.
- **Shared context**: `group.context_updated` is implemented over context-pack supersession
  (store :1262-1265) or scratchpad partitions (:14754+); attributed versions are the existing
  `validityVersion` pattern (:4496-4511). No frozen snapshots for live context; snapshots stay
  for reproducible checks (refs/baton pins already exist).
- **Waves keep their honest job**: launch cohort, observation boundary, campaign accounting
  (`wave.started`/`wave.closed` unchanged). Group membership is no longer *derived* from wave
  rosters; a wave may express a group, a plan layer, or a one-shot attach-and-harvest.

### 7.4 Workspaces as independent resources

- Extend the owner receipt with an explicit custody strategy, defaulting to today's behavior
  byte-for-byte:

```
strategy: 'private'              // exactly current validation (worktree.mjs:324-350)
        | 'group'                // holders = group members; single writer via group lease
        | 'frozen'               // read-only from pinned refs (refs/baton/*, already durable)
holders: [{ participantId | groupId, access: 'read'|'write'|'mediate' }]
```

  Binding validation (worktree.mjs:601-668) gains one branch: with `strategy:'private'` it
  performs today's single-expectation check; otherwise it validates the holder set. The
  allocate-before-effect publication protocol, exact release, and classify-first reconcile are
  untouched — they are the strongest primitives in the layer (§5.6).
- Capacity rows key by holder (worktree-capacity.mjs:26-31); `adoptWorker` becomes re-grant to a
  named successor holder (:558-577) — preserving the property that custody is always exactly
  accounted.
- Custody moves into durable records: `workspace.attached/detached` facts bound to the receipt
  digest so post-crash cleanup authority (`ownedWorktreeAuthority` etc.,
  coordinator.mjs:8802-8868) is derivable from the ledger, with startup reconcile as
  verification rather than reconstruction.
- One fencing regime: retire in-memory FenceTable authority (fence.mjs:1-70) in favor of the
  durable `pidStart` identity (process-lifecycle.mjs:33-90) for control-op staleness.
- Containment honesty on cards: isolation posture becomes a per-card declared fact; path checks
  remain cleanup bookkeeping only (runtime-isolation.mjs:1-2 is the correct statement — promote
  it to the capability cards).

### 7.5 Dependencies on selected events/artifacts

- Generalize the plan evidence ref (orchestrator-plan.mjs:95-104) into gate conditions evaluated
  at the dispatch effect boundary (where `readyTasks()` store :12212-12214 and the plan gate
  :649-654 run today):

```
dependency: { on: { coordinationSeq | artifactId | contributionId },
              predicate: 'exists'|'submitted'|'accepted'|`digest=<sha>` }
```

  No DAG recompile, no predecessor-completion law: *a selected artifact or event is needed*, not
  "another agent has finished" (docs/39). Informational relationships are subscriptions, not
  gates — the NotificationBus poll pattern (holistic-runtime.mjs:269-358) or knowledge-read
  events (:17766) deliver updates without blocking.
- The workflow layer adopts this by delegating its (currently decorative) `verificationRequested`
  to a real condition: `verification: gate` ⇒ a `contribution.accepted` dependency on the trust
  gate's verdict, unifying the two acceptance regimes of §1.5.

### 7.6 Native subagent visibility — claim only what cards declare

- Every adapter card declares, explicitly: `turnCompletion` (make the silent `'claim'` default at
  coordinator.mjs:2932-2934 a refusal for production cards, mirroring how `requestTimeoutMs` is
  already mandatory for codex, codex-appserver.mjs:217-222), and

```
delegation: { observable: bool, steer: 'none'|'relay', budget: 'none'|'aggregate', close: 'process-group' }
```

- Today's truth for all three adapters is `observable:false` (one opaque `content.tool_call` row
  per delegation, §2) — so the cards say so, and the brief text "delegated participants inherit
  the same constraints" (adapter.mjs:125) becomes conditional on the declared surface. Closure
  claims ride the existing process-group latch (process-lifecycle.mjs:94-130), which is honest
  about descendant absence.
- The seam for future honesty is already the adapter event stream: when a harness exposes
  descendant sessions (Claude Task-tool sub-ticks, codex threads), they surface as
  `participant.registered { parentParticipantId }` facts — native adapters stay the source of
  truth; Baton adds records, not simulations.

### 7.7 Authority boundaries (where schemas live)

- **Effects with authority** — structured schemas at command admission (the existing
  application-semantics registry with `inputSchema`, capabilities, destructiveness flags,
  application-semantics.mjs:501-526, :1560-1667), validated against durable membership/lease
  records at the coordinator's `_withAuthorityOp` gate. New acts: `group.create/join/leave`,
  `group.lease.acquire/release`, `contribution.submit/accept/revoke`,
  `workspace.attach/detach`, `participant.attach/detach` — each a registry row reusing existing
  capability maps.
- **Ordinary conversation** — prose over the existing message lane; no schemas, no I/O contract
  (docs/39). The workflow layer's closed `MEMBER_FIELDS`/template schema is demoted from runtime
  rule to recipe-authoring convenience.
- **Adjudication** — explicit principal only: operator, run-orchestrator lease, or group lease.
  Driver policies (nudge-on-checkpoint, claim-on-stall) remain caller-authored, opt-in, and
  recorded (wave-driver.mjs:751-844) — a driver *is* an authorized caller; the coordinator still
  never self-drives, and no timer substitutes for a verdict.
- **Recursion budgets** — `task-topology.mjs` quotas extended with per-group member ceilings as
  *data* (deployment policy), replacing the triple-hardcoded member counts of §4.4.

### 7.8 Extraction plan (making the 47k lines changeable)

Follow the review doc's directive — extract by owned authority, retain event history, no
wholesale rewrite:

1. **Store first** (it gates everything else): lift the ledger kernel (:1734-1967), checkpoint
   cache (:1090-1330), compaction (:1458-1732), and writer lease (:1337-1455) into a `ledger/`
   module with the same facade; replace the `_apply` else-if chain (:8118-9308) with per-domain
   fold modules registered against a kind registry (the batch whitelist :1888-1897 is the
   precedent); move board (:15203-16145), context program (:5130-8006), KG (:16539-18005),
   provider (:3909-4495) behind domain modules. Add payload-digest binding in `_append` (§4.7).
   Full-log rescan validators migrate to the indexed `_boardItemsByBoard` pattern (:15634).
2. **Coordinator second**: extract the checkpoint machinery (:2111-2575), messaging hub
   (:7079-7265, :13164-13340), recovery (:5144-6087), replay fold (:14052-14900), and collapse
   the five inlined run-sealed/stop-policy checks (:5150, :5390, :7485, :7593, :7757) into one
   admission gate.
3. **Workflow layer third**: interpreter keeps observation + capture discipline (§5.4); verdict,
   close-coupling, and inline effects (§4.3-4.4) move to runtime acts; `workflow-lane`,
   `workflow-dsl`, `task-topology`, `worker-policy` stay as-is (thin, reusable).
4. **holistic-runtime**: keep the effect toolkit; delete or externalize `MemberSupervisor`'s
   retry budget, `NotificationBus`'s message vocabulary, and the Durable duplicates in
   production-convergence-state.mjs (§4.8) before any swarm code touches them.

### 7.9 Bounded first increment (immediately implementable, in order)

1. **Store kinds + folds** for `participant.*`, `group.*`, `contribution.*` (additive; kind
   registry + fold module pattern; payload-bound idempotency). Replay-safe by construction.
2. **ParticipantRegistry-backed messaging authority** — replace `_activeMessageMember`
   sniffing; make `turnCompletion` explicit on all production cards (OMP card currently
   under-declares verbs and turn completion, omp-rpc.mjs:406-457).
3. **Workspace receipt `strategy`/`holders`** — additive receipt fields; `private` reproduces
   current validation byte-for-byte; capacity holder re-grant.
4. **`contribution.submit` act** over the board/scratch lanes with the unified identity; pausable
   participants can submit drafts without unparking.
5. **Interpreter verdict split** — per-member contribution verdicts + evidence receipt; `wave.close`
   decoupled from acceptance; `verification: gate` wired to the trust gate's verdict. DSL
   unchanged.
6. **Dependency predicates** at the dispatch boundary over existing evidence refs; plan
   `blockedBy` keeps working as the `accepted`-completion special case.

Each step is independently testable against the existing suites (store replay integrity, wave
observation, admission, coordinator checks), and none requires the next.

## 8. Explicitly not proposed

- **No universal DAG or fixed roster**: dependencies are per-operation predicates; membership is
  events, not a compiled graph. Recruiting one participant must not cost a definition
  regeneration (§4.4).
- **No universal I/O schema**: `contribution.submitted` carries a digest and references;
  payloads stay prose unless an effect requires structure (docs/39 §Communication).
- **No second orchestration framework**: no new journal/store, no detached supervisor hierarchy;
  groups/participants/contributions are folds in the one ledger, evaluated by the one
  coordinator. The REPL context-session path (context-runtime.mjs:1298) — the only current
  non-plan-gated session — is the precedent for admitting sessions outside workflow recipes.
- **No containment claims**: subagent "inheritance" and isolation posture become declared card
  facts (§7.6, §7.4).
- **No timer-adjudicated completion**: the no-clock law (§6) is an invariant, extended to groups —
  a group lease expiring releases *authority*, never decides *work*.

## 9. Verification

Audit-only change (this document). Deployment verification for the assigned worktree executed
per the Baton contract:

```
node --test impl/test/omp-native-features.test.mjs   # exit 0 — 6/6 pass (2026-09-13, this worktree)
```

Baseline confirmed before document authoring; re-run after, unchanged source.

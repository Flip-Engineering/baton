# #161 CONTRACT — the orchestrator's plan object as a first-class baton citizen

The implementation contract for issue #161: the orchestrator's own plan state — the campaign
todo, the wave map, the blocked-by relationships — is not a baton citizen. It lives in the
orchestrator's harness (kimi's out-of-band TodoList), invisible to workers and unqueryable by
the system. This contract makes the plan object a first-class citizen: a durable, authority-
scoped, surface-admitted object in the coordination store, with the orchestrator's own practice
as its day-one content. It specifies behavior; it does not amend implementation in this
artifact. It is a Ring-2 contract (ground truths → decisions → refusal vocabulary → red-first
acceptance → open questions). It cross-references — it does not re-specify — #74 (the D1.2
scratchpad read-authorization law, the coordinator seat boundary), #87 (the facade-projection
surface grammar and FP-18 review authority), #114 (the workflow-as-data interpreter the plan
object gates), #132 (the wave registry), the KG horizons (docs/34, the elevation discipline),
and the #157/#159 three-way surface invariant.

- **Date:** 2026-08-13
- **Status:** FOLDED v2.0 — implementation contract (red-first; no code landed for this rung).
  Folded per the #161 red-team report (`redteam-161.md`, same dir) and the coordinator QA
  (`review-foundry-2026-08-13/review-qa.md` §3, §5 DR-2/DR-3) — the fold record is appended
  below. The red-team and QA are the binding inputs; every blocker/amendment and every QA
  instruction resolves to FOLDED / STRUCK / ESCALATED there.
- **Verification HEAD:** `e371f70` — the fold re-verified every citation it touches at this
  worktree HEAD this session with `grep -an`/`sed -n` (NUL discipline), not inherited. The v1
  verification HEAD `6ca4ec7` is not reachable from `e371f70` (the red-team's finding, §1).
  The two NUL-bearing files whose anchors are grep/sed-verified, never whole-file reads:
  `impl/src/application.mjs` and `impl/src/coordination-store.mjs` (3 NUL bytes each,
  od-verified). `application-cli.mjs`, `application-semantics.mjs`, `task-topology.mjs`,
  `goal-plan.mjs`, `limits.mjs`, `mcp-northbound.mjs`, `web-northbound.mjs`, and the
  `nested-orchestration`/`worker-orchestrated-swarm` grounding docs are NUL-free and read with
  plain `grep`/`sed`.
- **Brief:** `contract-161-brief.md` (same dir) — read fully. The issue body (`gh issue view
  161`) could not be fetched (`gh` is not authenticated in this worktree — the same constraint
  the #74, #159, #157 contracts record); the requirements are carried by the brief and the
  read-order below.
- **Read-order executed.** (1) this brief; (2) the consumer — `contract-fold.md` v1.2 (the #74
  coordinator pattern, `docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/`); (3) the
  knowledge-horizons law (`docs/34-knowledge-horizons.md`) and its landed elevation machinery
  (`elevateTaskScratchpad`/`settleWorkflowScratchpad`, the `wave.closed` knowledge block); (4)
  the task-plane machinery — `task-topology.mjs` + the TT-row suites
  (`phase75-task-topology.test.mjs`), the board worker-half
  (`requestBoardClaim`/`submitBoardReport`), the scratchpad tiers; (5) the surface doctrine —
  the #157 CLI wave-fidelity contract and the #159 doc-truth conformance contract (the
  three-way invariant); (6) kimi's TodoList as the reference behavior (the orchestrator's
  current out-of-band tracker).

Scope of the rung, in one sentence: **the orchestrator's plan state becomes a first-class baton
citizen — a durable, content-bound plan object in the coordination store (tasks with id, title,
status, blocked-by, owned-by-wave/run, evidence), read/written under an authority law that
mirrors the #74 D1.2 read-authorization and the KG-horizon elevation discipline, admitted on
the three surfaces under the #159 three-way invariant, and driven day-one by kimi's campaign
todo as the plan object's content.**

---

## Ground truths (code-verified)

| # | Claim | Anchor |
|---|---|---|
| G1 | **The task-topology machinery is landed: refines relations, a closed deployment policy, the TT-row suites.** `TASK_TOPOLOGY_RELATIONS` is the closed six `['follow_up','oracle','preserved_resume','recovery','review','revision']` (`task-topology.mjs:1-5`); `DEFAULT_TASK_TOPOLOGY_POLICY` is the bounded, frozen deployment policy (`:7-20`) normalized as one closed bounded object (`:26-49`); `inferTaskTopologyRelation` derives the relation from `fields.refines` + hint (`:51-62`). `_validateTaskTopology` (`coordination-store.mjs:1621-1667`) refuses dangling/self/cross-run/cyclic refinement, fanout/depth/run ceilings, with typed `task_topology_*` codes; `taskTopologyNode`/`taskTopology` (`:2096-2119`) expose the replay-derived projection. The red-first rows TT1-TT6 live in `phase75-task-topology.test.mjs` (TT3 refusals assert no-append; TT6 pins the byte-stable replay projection). | `task-topology.mjs`, `coordination-store.mjs`, `phase75-task-topology.test.mjs` |
| G2 | **The scratchpad tiers are landed: task-ephemeral → shared elevation → KG.** `SCRATCHPAD_KINDS = ['note','plan','doubt','link']` and `SCRATCHPAD_STEP_STATES = ['todo','doing','done']` (`coordination-store.mjs:535,537`) — the closed three statuses the plan object's task status reuses verbatim. The `plan` scratchpad kind is a per-run objective + steps `[{text, state}]` with a supersedes binding (`:627-644`); `normalizeScratchpadEntry` is the closed-shape admission (`:607-696`). `elevateTaskScratchpad` (`:14173-14324`) elevates a terminal task's entries to the shared partition + scratch facts at task settle (S-2), and `settleWorkflowScratchpad` (`:14326+`) settles the workflow shared partition — the elevation machinery the plan object's at-wave-close elevation mirrors. | `coordination-store.mjs` |
| G3 | **The board worker-half is kernel-only, exactly-once, idempotency-keyed.** `requestBoardClaim` (`coordination-store.mjs:14806-14833`): prior-key idempotency digest-adjudication (`board_replay_conflict` on changed content, `:14811`), first-claim-wins (`existing && existing.active` → `{ok:false, result:'conflict'}`, `:14822`), `expectedBoardFence !== boardFence(board)` → `stale_board_fence` (`:14824`). `submitBoardReport` (`:14842-14875`) binds the exact `(itemVersion, itemDigest)` the worker observed. Both are kernel-only today — no facade/MCP projection (G11 of the #74 fold). | `coordination-store.mjs` |
| G4 | **The idempotency-key discipline is the store's `_byKey` prior-key adjudication.** `_append` (`coordination-store.mjs:1492-1522`) refuses a duplicate live key, returns the prior event on retry, appends the event, folds it via `_apply`, and poisons the projection on a fold throw (`:1515`). Replay (`:1437-1447`) re-applies each event in seq order with a duplicate-key integrity check; `_apply` is the single fold (e.g. `wave.closed` at `:8793-8806`, `board.claim_requested` at `:8494`). Every mutation's caller key is the idempotency key; content-digest adjudication is per-lane (`boardClaimRequestDigest`, `boardReplayConflict`). | `coordination-store.mjs` |
| G5 | **The wave registry and the wave.closed campaign-state record are the replay-derived folds the plan object composes.** `_waveRegistry` Map (`coordination-store.mjs:1231`, fold `:8100-8122`); `waves.list` reads only open rows (`:8793-8806` flips state to `'closed'`). `wave.closed` is the closed 8-key payload `{blockedOn, knowledge, lanes, parked, receiptDigest, rings, settlementErrors, waveId}` (`_validateWaveClosedPayload`, `:13308-13347`) — its `knowledge` block carries `{candidates, admittedThisRun, candidatesAwaitingAdmission, settlementRunId}` (`:13337-13341`), the landed orchestrator-admit elevation gate at wave close (KG-2 rule 7). `waveId` is content-derived: `wave:${digest({idempotencyKey, members}).slice(0,32)}` (`application.mjs:11654-11657`). | `coordination-store.mjs`, `application.mjs` |
| G6 | **The eight facade direct ports are dispatched BEFORE the recursive-session gate — the surface pattern a new read/write family rides.** `run.message.send/receipt`, `run.attention.watch`, `run.scratchpad.read/elevate`, `run.board.post/read`, `run.knowledge.seed` dispatch at `application.mjs:12519-12526` (comment `:12512-12518`: before `normalizeCommandContext`/`validateApplicationCommandArgs`/the recursive gate), each validating through its own closed normalizer and delegating to its landed kernel lane. The `waves.*` direct ports dispatch right after (`:12560-12570`), with `_refuseCoordinatorAuthority` at `:12560-12562` (impl `:3232-3238`: a `worker:` principal reaching a wave/steering authority verb throws `coordinator_authority_forbidden {attempted, gracefulPath: 'DECISION_REQUEST'}` — `limits.mjs:141-142`). | `application.mjs`, `limits.mjs` |
| G7 | **The registry owns the surface claims; the CLI parser + whitelist + MCP tools are the admission.** The eight facade registry rows live in `OPERATION_ROWS` (`application-semantics.mjs:1672-1721`) with `surfaces` claims (`['embedded','mcp','cli']` for scratchpad, `['embedded','cli']` for board). `CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`) admits the eight facade names (`:29-31`) plus `waves.attach/list/progress/run` (`:27`); the CLI parser branches compile `baton run scratchpad read/elevate` (`application-cli.mjs:1476-1508`), `baton run board post/read` (`:1513-1548`). MCP tools `baton_run_scratchpad_read/elevate`, `baton_run_message_send`, `baton_run_attention_watch`, `baton_run_knowledge_seed` exist with capability entries (`mcp-northbound.mjs:111-116`). The web bus has ZERO occurrences of the eight facade transports (grep-verified) — the #159 ledgered web refusal. `evidenceRef` is the closed `{coordinationSeq} | {artifactId}` (`application-semantics.mjs:159-164`). | `application-semantics.mjs`, `application-cli.mjs`, `mcp-northbound.mjs` |
| G8 | **The `plan:*` capability class exists and is the human-orchestrator-exclusive authority — the gate the plan verbs ride.** The goal-plan authority context requires a named power in `powers` (`normalizeGoalPlanContext`, `goal-plan.mjs:485-498`); the capability classes include `plan:*`, deliberately excluded from every worker/coordinator seat (`nested-orchestration-2026-08-03/grounding.md:81-82` — "the human orchestrator keeps those"). The facade capability denial stays `application_unauthorized` (`application.mjs:3214-3222`). No public `plan.*` command name exists at HEAD (grep-verified across the registry, parser, web, MCP, and application dispatch) — the prefix is free for this rung. | `goal-plan.mjs`, `nested-orchestration-2026-08-03/grounding.md`, `application.mjs` |
| G9 | **The orchestrator's own practice is an out-of-band tracker: kimi's TodoList.** The orchestrator drives each campaign through kimi's native todo list — statuses (todo/doing/done, the same closed three as the scratchpad step states, G2), exactly-one-in-progress (at most one item `doing` at a time), immediate completion marking (a finished item flips to done at once, never batched). None of it is baton state: workers cannot see it, the system cannot query it — the defect #161 closes. | kimi TodoList reference behavior (the brief, read-order item 4) |
| G10 | **The three-way surface invariant is the #157/#159 doctrine this rung's surface section must satisfy.** Documented ⇄ Parsed ⇄ Admitted, per surface, derived mechanically from the runtime's own tables (`doc-truth-conformance-contract.md` D1; the #157 closed-set registry-claim pin, `cli-wave-fidelity-contract.md` D3.3: for every canonical operation claiming `cli`, assert whitelist admission AND parser acceptance AND a generated doc row). A registry row claiming a surface the parser/whitelist refuse is a ghost (the #157 defect class); a claimed-but-web-refused verb must be ledgered (the #159 D3 #3 disposition). | `doc-truth-conformance-contract.md`, `cli-wave-fidelity-contract.md` |

---

## Decisions

### D1 — the object shape + durability

**The plan object.** A repoId-scoped, campaign-durable object in the coordination store: the
orchestrator's plan state — the campaign todo, the wave map, the blocked-by relationships. Its
schema (task-level, the brief's D1 shape):

```json
{
  "schemaVersion": 1,
  "planId": "plan:<hex32>",
  "campaignId": "<valid id>",
  "version": 1,
  "focusTaskIds": ["task:<hex32>", "..."],
  "tasks": {
    "task:<hex32>": {
      "schemaVersion": 1,
      "id": "task:<hex32>",
      "title": "<bounded text>",
      "status": "todo" | "doing" | "done",
      "blockedBy": ["task:<hex32>", "..."],
      "ownedBy": { "role": "<id>", "run": "run:<id>", "wave": "wave:<hex32>" },
      "evidence": [{ "coordinationSeq": 123 }, { "artifactId": "..." }],
      "taskVersion": 1
    }
  }
}
```

- **`status`** is the closed three `['todo','doing','done']` — verbatim the scratchpad step
  states (G2, `coordination-store.mjs:537`). No status is added; the kimi reference behavior
  (G9) is the semantic law, not a new vocabulary.
- **`blockedBy`** is the DAG edge list (the campaign's blocked-by relationships), mirroring the
  goal-plan `deps` discipline (`goal-plan.mjs:300`) — a self edge, a dangling edge, or a cycle
  refuses with the typed plan code (§refusal). No locale ordering; task ids sort by canonical
  order.
- **`ownedBy`** is the wave-map binding — `{wave, run, role}` names the wave/run/role that owns
  the task. It is the enforcement key for the D2 authority law (a coordinator's "subtree" is
  exactly the tasks whose `ownedBy.wave/run` matches its own wave/run). The canonical key order
  is closed for the store's exact-object validation: `ownedBy` validates as
  `['role','run','wave']` (sorted); the task object validates as
  `['blockedBy','evidence','id','ownedBy','schemaVersion','status','taskVersion','title']`
  (sorted). A key set in any other order is a non-closed shape and refuses `plan_task_invalid`
  (red-team H1.3 — the order was unspecified in v1).
- **`focusTaskIds`** is the plan-level focus window — the orchestrator's explicit bounded set of
  task ids currently in focus (the DR-3 law, below): bounded by `planPolicy.maxFocusTasks`
  (deployment-owned, default 4), never a hardcoded client ceiling. It replaces the per-plan
  singleton reading of the exactly-one-in-progress law: the uniqueness law binds **per wave
  subtree** (one `doing` per `ownedBy.wave/run` subtree), and `focusTaskIds` is the plan-level
  attention window the orchestrator maintains. Mutated via `plan.focus_upserted` (below), never
  derived.
- **`evidence`** is the closed `evidenceRef` shape `{coordinationSeq} | {artifactId}` (G7,
  `application-semantics.mjs:159-164`) — the same evidence links the board lane already accepts.

**Where it lives.** In the coordination store as new event kinds, folded into two new
replay-derived projections (`_plans` Map keyed by planId, `_planTasks` Map keyed by taskId),
exactly like the `_waveRegistry`/`_waveClosures` folds (G5). The ledger is `events.jsonl` with
checkpoints; replay is `_apply` in seq order (G4).

**The mutation family (event kinds).** Each mutation is an idempotency-keyed event in the
house dot-grammar:

| Kind | Payload (closed) | Idempotency key | Purpose |
|---|---|---|---|
| `plan.minted` | `{schemaVersion, planId, campaignId, version, focusTaskIds, tasks, requestDigest}` | `plan.minted:${planId}` | Create the plan with its initial task set and focus window (the campaign todo, D4). |
| `plan.task_upserted` | `{schemaVersion, planId, taskId, title, status, blockedBy, ownedBy, evidence, expectedTaskVersion, requestDigest}` | `plan.task_upserted:${planId}:${taskId}:v${expectedTaskVersion}` | Create or update a task. Version-CAS on `expectedTaskVersion`. The version-bearing key makes each versioned update a distinct key (H1.1/QA-H1). |
| `plan.task_transitioned` | `{schemaVersion, planId, taskId, toStatus, expectedTaskVersion, requestDigest}` | `plan.task_transitioned:${planId}:${taskId}:${toStatus}:v${expectedTaskVersion}` | The narrow status mutation (immediate completion marking, D4; the auto-demote cycle, D4/DR-3). Version-bearing so re-entry to a previously-seen status is a distinct key (H1.1/QA-H2). |
| `plan.task_evidence_linked` | `{schemaVersion, planId, taskId, evidence, expectedTaskVersion, requestDigest}` | `plan.task_evidence_linked:${planId}:${taskId}:${evidenceDigest}:v${expectedTaskVersion}` | Attach evidence links to a task (the elevation output path, D2). Version-bearing for the same (identity, version) discipline. |
| `plan.focus_upserted` | `{schemaVersion, planId, focusTaskIds, expectedPlanVersion, requestDigest}` | `plan.focus_upserted:${planId}:v${expectedPlanVersion}` | Set the plan's bounded focus window (DR-3). Plan-level version-CAS on `expectedPlanVersion` (the plan object's `version`). |

**Identity.** `planId = plan:${digest({idempotencyKey, campaignId}).slice(0,32)}` —
content-derived from the mint request (the waveId pattern, G5,
`application.mjs:11654-11657`). `taskId = task:${digest({planId, title, ownedBy}).slice(0,32)}`
— content-bound at first upsert (the scratch-fact id pattern, `coordination-store.mjs:14271`),
stable across later mutations so a `blockedBy` edge and a transition keep referencing the same
task.

**ID-namespace non-collision (H1.2, resolved per DR-2).** The plan-object ID keeps the `plan:`
prefix — consistent with the `plan.read`/`plan.write` verbs and the `plan:*` capability class
the orchestrator seat holds (G8). It is **structurally disjoint** from the goal-plan's
`plan:<hex64>` planRef: the goal-plan validates `^plan:[a-f0-9]{64}$`
(`mcp-northbound.mjs:303,343,715,995`; `web-northbound.mjs:354,457`) and mints
`plan:${goalPlanDigest(...)}` (`coordination-store.mjs:10725`, replay-side identity check
`:7681`), while the plan object's `planId` is `plan:<hex32>` — a valid plan-object ID always
fails every goal-plan validator (wrong length) and a goal-plan `plan:<hex64>` never validates as
a plan-object ID. The plan lane admits its IDs through its own closed validator
(`^plan:[a-f0-9]{32}$`); a plan-object ID is **never** passed into a goal-plan validator and a
goal-plan planRef is never admitted into the `_plans`/`_planTasks` projections. The shared
`plan:` prefix across the two families — plus the `plan.*` event kinds (H1.4) and the `plan:*`
capability class — is the **documented store-internal non-collision** the top orchestrator
adopted (DR-2, review-qa §5): same prefix, disjoint projections, disjoint length-validators.
No ID ambiguity survives the validators.

**Replay behavior.** The plan projection is a pure fold of the event stream — event-seq
anchored, no clocks (the wave.closed record's `closedAtEventSeq` is the epoch anchor, G5). Each
fold re-validates the payload (`_validatePlanPayload` in the store's `_validate*` house style,
cf. `_validateWaveClosedPayload` at `coordination-store.mjs:13308-13347`); an invalid fold state
on replay poisons the projection (`_poisonProjection`, `coordination-store.mjs:1515`), the
TT4/board precedent. Close/reopen replays the identical projection once the plan fold lands —
the machinery is the P2 green half; the plan fold itself is P2's red half until landed.

**Idempotency discipline per mutation.** The house rule (G4) verbatim: each mutation carries a
caller key; `_byKey` prior-key lookups return the prior event on retry with identical content
and refuse `plan_replay_conflict` (mirror of `board_replay_conflict`,
`coordination-store.mjs:14811`) when the content under a key changed. The `requestDigest` in
each payload is the digest-adjudication basis. **The mutation keys are `(identity, version)`
keyed, not identity-keyed** (the QA root fix, review-qa §3.3; the board lane's versioned
`(itemVersion, itemDigest)` adjudication, G3, is the working template):

- A **retry of the same versioned mutation** (same `expectedTaskVersion`, same content) hits the
  prior key and returns the prior event — idempotent, no re-apply.
- A **changed payload under the same versioned key** refuses `plan_replay_conflict`.
- A **new version** of the same task/status/evidence is a **distinct key** — it passes through
  the version-CAS: `expectedTaskVersion` against the task's current `taskVersion` (or
  `expectedPlanVersion` against the plan's `version` for `plan.focus_upserted`); a mismatch
  refuses `plan_stale_version` (mirror of the task version-CAS `stale_version`,
  `coordination-store.mjs:12633`). A later mutation can never silently overwrite an observed
  state, and an update/re-transition is reachable — the two are no longer in tension.

**Deployment bounds.** The plan object rides a deployment-owned `planPolicy` in the
taskTopologyPolicy house style (G1, `task-topology.mjs:7-49`): closed fields, bounded,
frozen, digest-verified — one closed bounded deployment policy, not caller policy. The bounds
derive from the same frame-limit family the store already owns — `FRAME_LIMITS`
(`limits.mjs:110`), imported at `coordination-store.mjs:61`, with the store's derived
per-entity caps (`MAX_SCRATCHPAD_ENTRY_BYTES` at `:493`, `MAX_CONTEXT_PACK_BODY_BYTES` at
`:496`). The closed `planPolicy` fields include the task bounds (max tasks per plan, title
bytes, per-relation fanout — the taskTopologyPolicy family) and **`maxFocusTasks`** — the
bound on the plan's `focusTaskIds` focus window (DR-3), deployment-owned default **4**, a
policy bound not a client-code ceiling; the default's derivation is the observed concurrent-wave
campaign orchestration the DR-3 rationale records (review-qa §5 DR-3). No new arbitrary numeric
limit enters client code (campaign-law, below).

### D2 — the authority law

**Who reads/writes what** (the brief's D2 matrix), mirroring the #74 D1.2 read-authorization law
(`contract-fold.md` §D1.2: a member reads `worker:<ownId>` + `shared`, the review authority reads
any member scope of its own wave, no implicit cross-worker read) and the goal-plan authority
(G8):

1. **The orchestrator — full.** A principal holding the `plan:*` capability class (G8; the
   class the human orchestrator keeps, `grounding.md:81-82`) reads and writes the whole plan:
   mint, upsert any task, transition any task, link evidence to any task. This is the review
   authority — the same seat FP-18 admits for the facade lanes (#87; the review authority reads
   any member scope of its own wave, `contract-fold.md` §D1.2 item 2).
2. **A wave coordinator — its subtree.** A #74 coordinator member (a worker seat holding
   `['observe','control']` at most — never `plan:*`, G8) reads and writes the tasks its
   subtree owns — exactly the tasks whose `ownedBy.wave/run` matches its own wave/run (the row
   tasks it decomposed, D3). Read-only beyond its subtree. It never mints a plan and never
   touches another wave's tasks.
3. **A row member — its own task, read-only beyond.** A worker reads its own task (title,
   status, blockedBy, evidence — the objective its brief derives from) and transitions its own
   task to `done` (the immediate completion marking, D4) via `plan.task_transitioned`. It reads
   its task's `blockedBy` closure read-only (the deps it waits on) and writes nothing beyond its
   own task.
4. **Everyone else — nothing.** A principal with no plan authority and no ownership refuses the
   typed code (§refusal) — the "unknown ≡ foreign" default (#87, `facade-projection-contract.md:637`)
   applied to the plan scope.

**Enforcement seam.** The facade `_authorize` seam (`application.mjs:3214-3222`) — the plan
verbs call `_authorize('plan.read'|'plan.write', principal, runId, {planId, taskId})`, and the
**plan lane (the command path) resolves ownership against the projection** — an `ownedBy` match
against the calling run's wave/run (the `authorizeRunOrchestratorCommand` scope-enforcement
pattern, `coordination-store.mjs:2069-2095`, applied to the plan subtree). Folds apply events;
they never authorize — ownership resolution lives in the lane, not in `_apply` (H2.3). The
restricting deployment authorize the #74 D1.2 requires (the `worker:<scope>` read resolves only
for own scope / the review authority / an explicit grant) is the composition point, and it is
pinned explicitly (H2.1):

- `_authorize` is **capability-based** (it delegates to the deployment `authorize`); the
  `plan:*` class is a goal-plan **powers** entry checked inside `normalizeGoalPlanContext`
  (`goal-plan.mjs:485-498`), which `_authorize` never invokes. So the `plan:*` gate is enforced
  in the **deployment authorize** — the same restricting `restrictingReadAuthorize` shape the
  #74 fold landed. The plan-lane resolution composes: **a plan read/write resolves for own task
  (the calling run's own id === `ownedBy.run`, and `ownedBy.role` matches the member role) /
  own subtree (the calling run's wave/run === the task's `ownedBy.wave/run`) / the `plan:*`
  power (the orchestrator/review seat); everything else refuses `plan_authority_forbidden`.**
- **Ownership resolution inputs, pinned (H2.2).** The member → (wave, run) mapping is the
  calling command's own `runId`/principal: a worker `worker:<id>` resolves to the run it
  actually runs in (the D1.2 law's "its own run", `application.mjs:699-701`), and the lane
  requires that run id to equal the task's `ownedBy.run`. **Pre-decomposed row tasks** — written
  by the coordinator via `plan.task_upserted` (D3.1) before the row run spawns — bind
  `ownedBy.wave` + `ownedBy.role` at decomposition time and leave `ownedBy.run` unresolved
  (`null`); the lane resolves `ownedBy.run` at the row's claim/transition time from the wave
  registry roster (the #132 closed roster, G5) before any own-task write is admitted. This is
  what makes "a row member writes only its own task" decidable, and it is exactly the seam the
  auto-demote batch (D4) and the per-wave-subtree uniqueness law (DR-3) depend on.
- The `coordinator_authority_forbidden` code (G6) covers a coordinator-seat principal reaching
  `plan.write` against a task OUTSIDE its subtree; the `plan_authority_forbidden` code
  (§refusal) covers a principal with no plan authority at all. The boundary between the two is a
  stated rule (§refusal), not seat inference.

**The elevation discipline (a wave's task outputs elevate at wave close, reviewed — mirroring
the KG horizons).** The KG horizons are task (ephemeral) → workflow (run-scoped) → project
(persistent), and the promotion law is the explicit orchestrator-admit gate at settle (docs/34,
rule 7: no silent auto-promotion of run-scoped claims into persistent truth). The plan object is
the workflow-horizon carrier for the orchestrator's own plan, so:

- At **`wave.closed`** (G5) the wave's plan tasks are **reviewed** by the review authority
  (the `plan:*` seat) — the same reviewed-admission shape as the `wave.closed` `knowledge`
  block (`candidates`/`admittedThisRun`/`candidatesAwaitingAdmission`,
  `coordination-store.mjs:13337-13341`).
- **Completed** tasks keep their terminal `done` status and gain their elevation evidence links
  (via `plan.task_evidence_linked`, the evidence the wave actually produced — the D6-style
  result pin, never a free string).
- **Reviewed-rejected** tasks — a task the row marked `done` whose evidence the review finds
  weak or missing — are **re-opened** by the review authority: `done → todo` via
  `plan.task_transitioned` (the typed re-open path, H4.2). The re-open is the review authority's
  elevation right; a non-review principal attempting `done → todo` refuses `plan_reopen_forbidden`
  (§refusal, P4). This is the reject path that makes the "reviewed admission" claim real — the
  review is not cosmetic.
- **Incomplete** tasks revert to `todo` for the next wave (the honest remainder), and the wave
  map (`ownedBy`) is updated to the next wave's assignment.
- **No silent auto-promotion:** an incomplete or unreviewed task never reads as done; the
  elevation requires the review authority's admission, and a rejected `done` task re-opens
  rather than silently staying done. This is the plan-object instance of the KG-2
  orchestrator-admit law (docs/34 rule 7) — cited, not re-litigated.

### D3 — the surface + the wave integration

**The verbs.** `plan.read` (observe) and `plan.write` (control). Consistent with the grammar:
a campaign-scoped domain prefix (the `waves.*` precedent — a top-level noun scoping a closed
verb set), with `plan.write` gated by the EXISTING `plan:*` capability class (G8) — the class is
already the human-orchestrator-exclusive authority, so the new verbs ride it instead of minting a
new capability. `plan.read` carries `capabilities: ['observe']`, `effect: 'observe'`;
`plan.write` carries `capabilities: ['control','observe']` plus the `plan:*` authority for the
orchestrator seat. (The `campaign.*` alternative was OQ1 — RESOLVED by DR-2: `plan.read`/
`plan.write` ride the existing `plan:*` capability, the goal-plan overload is a documented
store-internal non-collision, no new prefix or capability class.)

**The three-surface admission** (the #159 doctrine, G10 — documented ⇄ parsed ⇄ admitted,
derived mechanically, no ghosts):

1. **Registry rows.** `plan.read` and `plan.write` enter `OPERATION_ROWS`
   (`application-semantics.mjs:1672-1721` region) with closed input schemas and explicit
   `surfaces`. Recommended shape — `plan.read`: `{planId}` required, returns the plan projection;
   `plan.write`: `{planId, idempotencyKey, mutation: <plan.minted|plan.task_upserted|... shape>}`
   with the mutation's own `requestDigest`. The `idempotencyKey` rides the CLI/web envelope the
   ordinary command shape already carries. The rows' `capabilities` are the facade capability
   gate — `plan.read`: `['observe']`, `plan.write`: `['control','observe']`; the `plan:*`
   authority is enforced at the **deployment-authorize seam** (H2.1), not carried in the registry
   row (H3.3 — the gate is the composition, not a row field).
2. **CLI.** Parser branches `baton plan read PLAN_ID` / `baton plan write PLAN_ID ...` inside
   the `run`/top-level verb block (mirroring the `baton run scratchpad read/elevate` idiom,
   `application-cli.mjs:1476-1508`), admitted to `CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`).
   `plan write` takes the mutation as a **JSON body** (`baton plan write PLAN_ID --mutation
   '<json>'`): the body is parsed and normalized to one of the closed `plan.*` mutation shapes
   (the D1 table); a malformed body or an unknown mutation kind refuses `cli_invalid` naming the
   expected mutation shape (H3.2). The narrow verbs (`plan read`, and the structured mutations)
   are the CLI surface; callers needing arbitrary structured mutations may route through MCP.
3. **MCP.** `baton_plan_read`/`baton_plan_write` tools with `repoId` leading the `required`
   arrays (the #159 G10 lesson — every wave/MCP tool requires `repoId` first), plus capability
   entries beside the facade rows (`mcp-northbound.mjs:111-116`). Each tool also gains its
   **`_dispatch` branch** — the route that turns a `baton_plan_read`/`baton_plan_write` call into
   `application.command('plan.read'|'plan.write', ...)`, exactly like the landed facade tools'
   dispatch branches (`mcp-northbound.mjs:1898-1912`; the #158 H2.2 lesson — a tool with defs +
   capabilities but no dispatch branch is advertised-but-dead, the #157 ghost class).
4. **Web.** If `surfaces` claims `web`, the web-bus admission gains the two names (the
   `WAVE_WEB_ENTRIES`/`WEB_DIRECT_PORT_COMMANDS` shape, `web-northbound.mjs:37-62`). If `web` is
   NOT claimed — the recommended posture, matching the facade verbs' today (G7) — the verbs are
   ledgered in `surface-divergence-ledger.json` under the #159 D3 #3 discipline: documented and
   parsed, web refusal documented, no ghost.
5. **Docs.** `render-surface-docs.mjs` regenerates CLI.md/MCP.md (never hand-edited, #142); the
   `--check` flag is the drift gate.
6. **Conformance.** The #157 closed-set registry-claim pin (G10,
   `cli-wave-fidelity-contract.md` D3.3) EXTENDS from `waves.*` to `plan.*`: every `plan.*`
   canonical operation with `surfaces.includes('cli')` is whitelisted AND parsed AND documented —
   the mechanical guard that the plan lane cannot grow a ghost.

**The #74 integration — two wires.**

1. **A coordinator member's decomposition writes row tasks into the plan object.** The #74
   coordinator decomposes its brief into granular sub-specs (today as scratchpad artifacts, #74
   D1). Under this rung the durable home of the decomposition is the plan object: the coordinator
   writes each row task via `plan.write` (`plan.task_upserted`) with
   `ownedBy: {wave, run, role}` binding it to its wave — the authority law's subtree (D2.2). The
   scratchpad artifact handoff stays the content substrate (#74 D1 is not re-specified); the plan
   object becomes the queryable map from the campaign todo to the row tasks, so the top
   orchestrator and the rows share ONE plan truth.
2. **The interpreter gates a member on a plan task's state.** The workflow-interpreter
   (`waves.run`, #114) reads `plan.read` for a member's task state and gates dispatch/settlement
   on it: a member whose plan task is blocked (`blockedBy` edges not all `done`) is not claimed
   or is honestly `waitingOn` — the plan task's state becomes a member-gating projection over the
   closed `WAITING_ON_KINDS` (`application-semantics.mjs:59-61`, byte-unchanged). The mapped kind
   is **`dispatch_pending`** — the member's dispatch is pending on the plan-task gate (H3.4;
   `plan_approval` is the goal-plan approval state, not a plan-task `blockedBy` block, and is
   never the plan-object gate's kind). A member whose plan task is `done` (immediate completion
   marking) is settleable. The interpreter's steering can declare the gating declaratively (the
   `steering` policy shape, #114 G5) — a plan-state gate is a policy the top orchestrator's spec
   declares, never client-side logic (the infrastructure-law constraint).

### D4 — the migration of the orchestrator's own practice

**How kimi drives it day-one.** The campaign todo — today kimi's out-of-band TodoList (G9) —
becomes the plan object's content. The write path from the orchestrator seat:

1. **Mint.** The orchestrator (`plan:*`, G8) issues `plan.write` with
   `plan.minted`: each TodoList item becomes a plan task — `title` from the item, `status` from
   the item's state, the blocked-by relationships become `blockedBy` edges, the wave/run
   assignment becomes `ownedBy`. The out-of-band tracker's content is copied once, structurally,
   into the plan object.
2. **Drive through the plan.** The orchestrator starts each turn with `plan.read` (the campaign
   todo as baton state, not a harness artifact) and issues `plan.write` for every status change.
   The plan object is the single honest projection of the campaign todo.
3. **The reference behaviors become laws.** The kimi TodoList semantics (G9) are the contract's
   behavioral laws, pinned red-first (P4/P9):
   - **Statuses** — the closed three `['todo','doing','done']` (verbatim G2).
   - **Exactly-one-in-progress — per wave subtree, not per plan (DR-3, law).** At most one task
     `doing` per wave subtree (the tasks whose `ownedBy.wave/run` match one subtree). The
     per-plan singleton reading is **false to practice** — observed campaign orchestration runs
     multiple waves concurrently (the DR-3 rationale, review-qa §5), so a coordinator's wave runs
     its own `doing` row while the orchestrator's next wave task sits `todo`. The plan level
     carries an explicit bounded `focusTaskIds` set (bounded by `planPolicy.maxFocusTasks`,
     deployment-owned default 4) **instead of a singleton** — the orchestrator's attention
     window, mutated via `plan.focus_upserted`. A transition to `doing` when another task in the
     **same wave subtree** is already `doing` auto-demotes the current `doing` task to `todo` in
     the SAME batch (the kimi behavior) — the batch is the `plan.task_transitioned` append + the
     demote transition append (the store's `_appendBatch` precedent,
     `coordination-store.mjs:1524-1597`), registered as a closed plan batch kind in
     `_appendBatch`'s batch-kind list (H4.1 — the closed list at
     `coordination-store.mjs:1526-1533` gains the plan kind; no new batch mechanism). Where the
     wave subtree is a strict DAG (a `doing` task the demote would corrupt), the transition
     refuses `plan_parallel_progress` instead — the two shapes are both honest; the DAG case is
     the refusal. `plan_parallel_progress`'s payload names the subtree and the current `doing`
     task (§refusal).
   - **Immediate completion marking** — a verified-complete task is marked `done` at once (the
     row's own transition, D2.3), never batched or lazy. `plan.read` never re-derives status from
     anything else; the plan object's status IS the truth. The `plan.task_transitioned` lane
     checks, in order: (1) closed shape, (2) version-CAS (`plan_stale_version`), (3) the
     `blockedBy` closure for `→ done` (`plan_blocked`), (4) the status law (exactly-one-in-progress
     within the wave subtree; H4.3 — the CAS runs before the blocked-check, so a stale writer
     never learns the blocked-check's outcome on a version it has not observed).
4. **Retire the tracker.** Once the plan object carries the campaign todo, the out-of-band
   TodoList is no longer the tracker; the orchestrator's todo, wave map, and blocked-by
   relationships are queryable baton state (the #161 close condition).

---

## Refusal vocabulary

Existing codes reused verbatim (semantics unchanged): the facade capability denial
`application_unauthorized` (`application.mjs:3221-3222` — throw at `:3221`, `_authorize` closes
at `:3222`), `application_command_invalid` (`application.mjs:12501`), the #74
`coordinator_authority_forbidden {attempted, gracefulPath:
'DECISION_REQUEST'}` (`application.mjs:3232-3238`, `limits.mjs:141-142`), the board lane's
`board_replay_conflict`/`stale_version`/`board_item_not_found` (G3/G4), the task-topology codes
`task_topology_*` (G1), the goal-plan codes `goal_plan_unauthorized`/`plan_*`
(`goal-plan.mjs`), the CLI layer codes `cli_command_unavailable`/`cli_invalid`/
`cli_action_inputs_invalid` (the #157 closed naming), the MCP `invalid_arguments`
(`mcp-northbound.mjs:1021-1023`), and the web `unsupported command`
(`web-northbound.mjs:405`). No sorted-key literal is introduced; no clock enters any refusal.

New (this contract):

| Code | Reach | Payload | Fires when |
|---|---|---|---|
| `plan_replay_conflict` | store (prior-key adjudication) | — | Idempotency content changed under one versioned key (mirror of `board_replay_conflict`, G4). |
| `plan_stale_version` | store (version-CAS) | — | `expectedTaskVersion` mismatches the task's current `taskVersion`, or `expectedPlanVersion` mismatches the plan's current `version` (`plan.focus_upserted`) (mirror of `stale_version`, G3). |
| `plan_not_found` | store + facade | `{planId}` | `plan.read`/`plan.write` names an unminted plan. |
| `plan_task_not_found` | store + facade | `{planId, taskId}` | A mutation names a task absent from the plan. |
| `plan_task_invalid` | store (closed shape) | — | A task violates the closed schema (unknown field, bad `blockedBy`/`ownedBy`/`evidence`, non-closed status, non-canonical key order). |
| `plan_topology_invalid` | store (DAG admission) | — | `blockedBy` self-edge, dangling edge, or cycle (the goal-plan `assertDag` shape, G1/deps discipline). |
| `plan_parallel_progress` | store (exactly-one-in-progress, D4/DR-3) | `{waveSubtree, currentDoingTaskId}` | A `→ doing` transition when another task in the SAME wave subtree is `doing` AND the strict-DAG shape forbids auto-demote (D4, DR-3). |
| `plan_blocked` | store (elevation gate, D2) | `{blockedByUnmet: [taskId…]}` | A `→ done` transition whose `blockedBy` edges are not all `done` (no evidence-gated completion of a blocked task). |
| `plan_reopen_forbidden` | store (status law, D2/H4.2) | `{planId, taskId}` | A non-review principal attempts `done → todo` — the re-open is the review authority's elevation right (the reviewed-rejected path, D2; P4). |
| `plan_focus_invalid` | store (focus-window shape, DR-3) | — | A `focusTaskIds` mutation violates the closed focus set (unknown task id, non-task id, size beyond `planPolicy.maxFocusTasks`, duplicate). |
| `plan_authority_forbidden` | facade `_authorize` (the plan scope) | `{attempted, planId, taskId, ownedBy?}` | A principal with no plan authority reaches `plan.read`/`plan.write` outside its ownership (the D2.4 "everyone else" case; the #87 "unknown ≡ foreign" default applied to the plan scope). |

`plan_authority_forbidden` is the plan-scope instance of the "unknown ≡ foreign at the policy
seam" default (#87, `facade-projection-contract.md:637`) — a worker reaching a plan task it does
not own draws it, never `application_unauthorized` alone, so the refusal is coachable and
distinct from a generic capability shortfall.

**The authority-code boundary, stated as a rule (red-team §6 overlap nit, folded).** The two
scope-violation codes are distinguished by the calling seat's class, not inferred:
`coordinator_authority_forbidden` (G6) is the **#74 seat-boundary** code — it covers a
coordinator-seat principal (a worker holding `['observe','control']` at most, subtree authority
only) reaching `plan.write` against a task OUTSIDE its subtree. `plan_authority_forbidden` is
the **plan-scope** code — it covers every other principal without the right: a row member
reaching a sibling task (outside its own-task right), and a principal with no plan authority at
all reaching any plan verb. The code is chosen by the seat class, so a row member and an
unrelated worker both draw `plan_authority_forbidden`, while a coordinator drawing outside its
subtree draws `coordinator_authority_forbidden` (the coordinator seat is a worker: seat reaching
a plan-authority verb outside its subtree — the #74 code coaches it toward its `gracefulPath`).

---

## Red-first acceptance pins

RED = fails at HEAD; GREEN = passes at HEAD and is pinned. New rows in a `plan-object-red.test.mjs`
sibling suite (the TT-row / board-row house style, G1/G3).

| Pin | Assertion | Today |
|---|---|---|
| P1 | **Mint + update + idempotency (D1).** Red: no plan verbs exist. Green: `plan.write` with `plan.minted` mints the plan (`planId = plan:${digest…}`); a retry of the same mint key returns the prior event; changed content under the same mint key refuses `plan_replay_conflict`. **Update asserted explicitly (QA §3.4 #2):** upsert v1 then upsert v2 with `expectedTaskVersion=2` goes green (the task's `taskVersion` becomes 2), and upsert v2 with `expectedTaskVersion=1` (stale) refuses `plan_stale_version`. | **RED** (no plan machinery) |
| P2 | **Replay (D1).** Red: the plan fold is unlanded — a `plan.*` event in the ledger crashes `_apply` at `unsupported_event_kind` (`coordination-store.mjs:8862`). Green (restated honestly, red-team §7): the fold/replay machinery that WILL carry plan events replays byte-identically through close/reopen (the store fold pattern, G4/G5) — the plan fold itself is RED until landed. | **RED** (plan fold unlanded; fold machinery green) |
| P3 | **Closed task shape (D1).** Green: the task is the closed `{id, title, status, blockedBy, ownedBy, evidence, taskVersion}` with canonical key order (D1); an unknown field or a non-canonical key order refuses `plan_task_invalid`; a `blockedBy` self-edge/dangling/cycle refuses `plan_topology_invalid`; a non-closed status refuses `plan_task_invalid`. | **RED** (no plan shape) |
| P4 | **Exactly-one-in-progress + immediate completion (D1/D4, DR-3).** Red: no status law. Green: two tasks cannot be `doing` simultaneously **within a wave subtree** (`plan_parallel_progress` in the strict-DAG shape, or the auto-demote batch — registered plan batch kind); a verified task is marked `done` immediately and stays done; a `done` task cannot re-open **by any non-review principal** (`plan_reopen_forbidden`), and the review authority's reviewed-reject re-open (`done → todo`, D2/H4.2) is the one admitted exception. | **RED** (no plan status law) |
| P5 | **Authority matrix (D2).** Red: no plan authority exists. Green: a row member reads its own task and transitions its OWN task to `done` (ownership resolved by the pinned member→run mapping, H2.2); a row member writing a sibling task refuses `plan_authority_forbidden`; a coordinator writes its subtree (`ownedBy` match) and a coordinator writing outside its subtree refuses `coordinator_authority_forbidden`; the orchestrator (`plan:*`) mints/upserts/transitions any task (the deployment-authorize composition, H2.1). | **RED** (no plan authority) |
| P6 | **Elevation at wave close (D2).** Red: no plan elevation. Green: at `wave.closed` the review authority reviews the wave's plan tasks — completed → `done` with evidence links, incomplete → `todo`, wave map updated, reviewed-rejected `done` → re-opened `todo` (H4.2); an unreviewed/incomplete task never reads as done (no silent auto-promotion). | **RED** (no plan elevation) |
| P7 | **Three-surface admission (D3).** Red: `plan.read`/`plan.write` do not exist on any surface. Green: the registry rows claim surfaces; the CLI parses `baton plan read|write` and `CLI_WEB_COMMANDS` admits both; the MCP tools `baton_plan_read`/`baton_plan_write` lead `required` with `repoId` AND have `_dispatch` branches (H3.1); the generated CLI.md/MCP.md blocks contain the rows; the #157 closed-set pin EXTENDED to `plan.*` is green; a claimed-but-web-refused surface is ledgered under the #159 discipline. | **RED** (no plan verbs) |
| P8 | **#74 integration (D3).** Red: no coordinator decomposition lands in a plan. Green: a #74 coordinator member's `plan.write` (task_upserted) writes its subtree's row tasks with `ownedBy` binding (pre-decomposed `ownedBy.run` resolved at claim, H2.2); the interpreter gates a member on its plan task's state — a blocked task's member is honestly `waitingOn` kind **`dispatch_pending`** (the closed five byte-unchanged, `application-semantics.mjs:59-61`; H3.4), a `done` task's member is settleable. | **RED** (no plan integration) |
| P9 | **Orchestrator practice migration (D4).** Red: the campaign todo is out-of-band. Green: `plan.read` at the orchestrator seat returns the campaign todo as the plan projection; the closed three statuses, per-wave-subtree exactly-one-in-progress (DR-3), and immediate completion marking are the observable plan semantics. | **RED** (out-of-band today) |
| P10 | **Refusal constancy.** `application_unauthorized` stays the facade denial; the closed five `WAITING_ON_KINDS` (`application-semantics.mjs:59-61`) and the closed three `SCRATCHPAD_STEP_STATES` (`coordination-store.mjs:537`) are byte-unchanged; no sorted-key literal is introduced; no clock enters any refusal. | **GREEN** (pin) |

---

## Open questions

- **OQ1 — naming: `plan.read`/`plan.write` vs `campaign.read`/`campaign.write`.** **RESOLVED by
  DR-2 (review-qa §5, top-orchestrator law): option (a) — `plan.read`/`plan.write` ride the
  existing `plan:*` capability; the goal-plan overload is documented as a store-internal
  non-collision; no new prefix, no new capability class.** The overload is now documented in two
  places: the D1 ID-namespace section (the structural disjointness of `plan:<hex32>` vs the
  goal-plan's `plan:<hex64>` planRef — H1.2) and this note. No public `plan.*` command exists
  today (G8); the goal-plan's nodes are store-internal.
- **OQ2 — exactly-one-in-progress scope: per plan or per wave subtree.** **RESOLVED by DR-3
  (review-qa §5, top-orchestrator law): the uniqueness law binds per wave subtree, not per
  plan.** The plan level carries an explicit bounded `focusTaskIds` set (bounded by
  `planPolicy.maxFocusTasks`, deployment-owned default 4) instead of a singleton; auto-demote +
  `plan_parallel_progress` apply within a wave subtree. The rationale is recorded in D4 and the
  `planPolicy` deployment-bounds paragraph: observed campaign orchestration runs multiple waves
  concurrently — a per-plan singleton is false to practice. It is a **law**, not a tunable (the
  QA flagged exactly this); the contract no longer defers it to `planPolicy` as a choice.
- **OQ3 — the row's write scope: `done` only, or also `doing`?** The immediate-completion-marking
  reference (G9) suggests the row transitions its OWN task to `done` and the orchestrator assigns
  `doing`. But the board-claim pattern (G3 — a worker claims its row) suggests a row could also
  set its own task `doing` at claim. This contract pins `done` (the completion path) as the row's
  guaranteed write; whether `doing` at claim is row-allowed stays open (both are safe under the
  D2 authority law once H2.2's ownership resolution is pinned; the per-wave-subtree
  `plan_parallel_progress`/auto-demote bounds the risk).
- **OQ4 — elevation as plan.write vs a store fold.** The elevation (D2) can mutate the plan
  through the surfaced `plan.write` (review authority issues the transitions) or as an internal
  store fold beside `wave.closed` (the `_waveClosures` precedent, G5). The `wave.closed`
  knowledge block is the precedent for the fold; the surfaced write keeps the elevation in the
  audit trail. This contract leaves the mechanism open — the law (reviewed elevation, no silent
  auto-promotion, the H4.2 reviewed-reject re-open) is the pin, not the seam. The fold leans
  toward the surfaced write: the reviewed-reject re-open is an auditable transition
  (`plan.task_transitioned`), which the fold path cannot express as a first-class event.
- **OQ5 — plan object vs the goal-plan DAG: do they unify?** The goal-plan DAG
  (`goal-plan.mjs` — a node DAG with `deps` for one goal) and the plan object (the campaign todo
  with `blockedBy`) share the DAG shape. Whether a goal-plan node's dispatch should auto-sync to a
  plan task (the wave map as the join) is open; this contract keeps them distinct (the plan object
  is the orchestrator's campaign todo; the goal-plan DAG is a goal's execution decomposition) and
  does not re-specify the goal-plan machinery. The seam where the two touch — the shared `plan:`
  prefix — is now the documented store-internal non-collision (D1, H1.2 per DR-2), so the
  "distinct" posture no longer leaves the naming question open.

---

## Cross-references

- **#74 (worker-orchestrated swarm)** — the D1.2 scratchpad read-authorization law (the
  ownership matrix the plan authority mirrors, `contract-fold.md` §D1.2), the coordinator seat
  boundary (`['observe','control']`, never `approve`/`plan:*`), the two-level shape, and the
  `coordinator_authority_forbidden` refusal. The plan object is the durable home of the
  coordinator's row-task decomposition (D3), and the interpreter gate rides the #74 wave shape.
- **#87 (facade projection)** — the surface grammar (`run.<noun>.<action>`), the FP-18 review
  authority (a live run-orchestrator lease holder / the `plan:*` seat reads any member scope of
  its own wave), and the "unknown ≡ foreign" policy default
  (`facade-projection-contract.md:637`) the `plan_authority_forbidden` code implements for the
  plan scope.
- **#114 (workflow-as-data)** — the interpreter (`waves.run`, `workflow-interpreter.mjs`) the
  plan-state gate composes (D3); the steering-policy shape declares the gate declaratively.
- **#132 (wave observability)** — the wave registry fold (`_waveRegistry`, `waves.list`) the
  plan's wave map composes; the D2.4 closed roster shape.
- **KG horizons (docs/34)** — the elevation discipline: task → workflow → project promotion with
  the explicit orchestrator-admit gate (docs/34 rule 7), the `wave.closed` knowledge block as the
  landed admission seam (G5). The plan object's at-wave-close elevation is the plan instance of
  that law — cited, not re-litigated.
- **#157/#159 (the surface doctrine)** — the three-way invariant (documented ⇄ parsed ⇄
  admitted, mechanically derived) and the closed-set registry-claim pin the plan lane extends to
  `plan.*` (G10).

---

## Campaign-law constraints and non-goals

- **No clocks.** The plan object is event-seq anchored — the `plan.minted` seq is the epoch
  anchor (the `wave.closed` `closedAtEventSeq` pattern, G5). No deadline, no expiry, no wall-time
  read enters any refusal or projection.
- **No arbitrary numeric limits.** The plan's bounds (max tasks per plan, title bytes, per-relation
  fanout, `maxFocusTasks` default 4) are a deployment-owned, frozen `planPolicy` in the
  taskTopologyPolicy house style (G1), derived from the existing `FRAME_LIMITS` family
  (`limits.mjs:110`, store-side derived caps at `coordination-store.mjs:493/:496`) — never a
  hardcoded client-code ceiling. The elevation, the status law, and the per-wave-subtree
  exactly-one-in-progress bound are semantic laws, not counters.
- **`localeCompare` banned.** No ordering decision uses it; task ids sort by canonical order.
- **Sorted-key literals in ACTUAL order.** The only sorted-key literals cited are the landed ones
  — the closed three `SCRATCHPAD_STEP_STATES` (`coordination-store.mjs:537`), the closed five
  `WAITING_ON_KINDS` (`application-semantics.mjs:59-61`), the closed eight `wave.closed` payload
  keys (`coordination-store.mjs:13312`) — all in their actual file order; the two canonical
  orderings this contract pins for its NEW closed shapes (the task object and `ownedBy`, D1) are
  the sorted orders, stated explicitly so the store's exact-object validation is a literal, not a
  sort.
- **Non-goals.** This rung does NOT unify the goal-plan DAG with the plan object (OQ5); does NOT
  widen the recursive-session gate (the plan verbs dispatch as direct ports before the gate, the
  G6 pattern, with the `plan:*` authority as their gate); does NOT project the plan onto a surface
  the registry does not claim (the #159 ledger covers a claimed-but-refused surface); does NOT
  re-specify any cross-referenced contract; does NOT integrate homelab. The plan object is the
  orchestrator's campaign todo — the goal-plan, the task topology, the board lane, and the
  scratchpad tiers keep their own machinery and are consumed here, not re-built.

---

## Verification (deployment)

1. Confirm the only edited/new files in the worktree are
   `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
   (the folded contract) and
   `docs/reference/evidence/orchestrator-plan-object-2026-08-13/fold-161.md` (the fold's
   blocker→resolution map — the shared-frame deliverable; the shared-scratchpad publish is
   unreachable from this worktree, matching the red-team §10 and the QA §0 findings — the durable
   files are the runtime handoff).
2. Deploy-verification for this fold's execution: executable `true`, args `[]`, cwd `.`,
   expected exit code `0`. No code was changed by this fold; the work is the contract text.

---

## Fold record (v1 → v2, 2026-08-13)

- **Binding inputs:** `redteam-161.md` (same dir; NOT FOLD-READY — blockers H1.1/H1.2/H2.1/H2.2/
  H4.1/H4.2 + pins + OQs); `review-foundry-2026-08-13/review-qa.md` §3 (NEEDS-WORK — two real
  idempotency-scheme defects, §3.3 H1/H2, fold instruction set §3.4) and §5 DR-2/DR-3
  (top-orchestrator law). Verification HEAD for the fold: `e371f70` (every citation touched above
  re-verified at this HEAD this session).
- **QA §3.4 instruction 1 — correct the idempotency scheme (H1/H2):** FOLDED. The deterministic
  key templates `plan.task_upserted:${planId}:${taskId}` and
  `plan.task_transitioned:...:${toStatus}` are replaced by version-bearing keys
  (`:v${expectedTaskVersion}`), `plan.task_evidence_linked` matches, and the `(identity, version)`
  keying is stated as the discipline (D1 mutation table + idempotency discipline). `plan.focus_upserted`
  joins the family for the DR-3 focus window.
- **QA §3.4 instruction 2 — pin P1 to assert update explicitly:** FOLDED (P1: upsert v1 → upsert
  v2 with `expectedTaskVersion=2` green; v2 with `expectedTaskVersion=1` refuses
  `plan_stale_version`).
- **QA §3.4 instruction 3 — keep shape/authority/surface as written:** FOLDED as a no-change
  guard. The object shape (schema, DAG, authority matrix, three-surface admission, #74 gating)
  is unchanged in decision; the fold only pins the enforcement seams the red-team proved
  under-specified (H2.1/H2.2/H2.3, H3.1/H3.2/H3.3/H3.4) and the elevation reject path (H4.2).
- **DR-2 (OQ1) — `plan.read`/`plan.write` ride `plan:*`, overload documented as store-internal
  non-collision, no new prefix/capability:** APPLIED. OQ1 marked RESOLVED; the ID-namespace
  non-collision (H1.2) documented with the structural disjointness (hex32 vs hex64 validators).
- **DR-3 (OQ2) — uniqueness law binds per wave subtree; plan carries bounded `focusTaskIds`
  (planPolicy, default 4); auto-demote + `plan_parallel_progress` within a subtree:** APPLIED.
  OQ2 marked RESOLVED; D1 schema (+`focusTaskIds`, `plan.focus_upserted`), D4 law rewritten,
  `planPolicy.maxFocusTasks` added, P4/P9 and `plan_parallel_progress` payload updated, rationale
  recorded (concurrent-wave campaign orchestration).

### Red-team blocker → resolution

| Blocker | Resolution |
|---|---|
| H1.1 — deterministic keys make update/re-transition unreachable | **FOLDED** — version-bearing keys, D1 mutation table + idempotency discipline. |
| H1.2 — `plan:<hex32>` collides with goal-plan `plan:<hex64>` | **FOLDED** — per DR-2: documented store-internal non-collision, structurally disjoint by length-validator (D1 Identity). |
| H1.3 — `ownedBy` closed-key order unspecified | **FOLDED** — canonical (sorted) order stated for `ownedBy` and the task object (D1). |
| H1.4 — new `plan.*` event kinds share the prefix with goal-plan events | **FOLDED** — per DR-2: documented non-collision; distinct closed `_apply` kinds (D1 Identity + OQ1). |
| H2.1 — `plan:*` powers class has no facade seam | **FOLDED** — deployment-authorize composition pinned (own task / own subtree / `plan:*`, else `plan_authority_forbidden`) (D2 Enforcement seam). |
| H2.2 — ownership resolution unpinned | **FOLDED** — member→run mapping (calling run id === `ownedBy.run`) and pre-decomposed `ownedBy.run` resolution at claim from the wave roster (D2 Enforcement seam). |
| H2.3 — "store-side fold resolves ownership" layer error | **FOLDED** — rephrased: the plan lane (command path) resolves ownership against the projection. |
| H3.1 — MCP `_dispatch` branches omitted | **FOLDED** — `_dispatch` branches specified (D3 step 3, `mcp-northbound.mjs:1898-1912`). |
| H3.2 — CLI `plan write` mutation envelope underspecified | **FOLDED** — JSON body + `cli_invalid` naming the expected mutation shape (D3 step 2). |
| H3.3 — surface rows' capabilities lack the `plan:*` gate | **FOLDED** — gate is the deployment-authorize composition, not a row field (D3 step 1). |
| H3.4 — P8's waiting-on kind unnamed | **FOLDED** — named `dispatch_pending` (D3 wire 2, P8). |
| H4.1 — auto-demote batch unrepresentable + batch kind unregistered | **FOLDED** — representable under versioned keys; plan batch kind registered in the closed `_appendBatch` list (D4). |
| H4.2 — "done cannot re-open" vs reviewed elevation | **FOLDED** — review-authority re-open path (`done → todo`, `plan_reopen_forbidden` for non-review) (D2 elevation, P4, refusal table). |
| H4.3 — done-at-once vs `plan_blocked` check order | **FOLDED** — lane check order pinned: shape → version-CAS → blocked-closure → status law (D4). |
| P2 — shallow-green pin | **FOLDED** — re-labeled RED with the honest restatement (plan fold unlanded; fold machinery green). |
| §6 overlap nit — two authority codes | **FOLDED** — boundary stated as a rule (seat class), refusal table. |
| §1 citation-hygiene off-by-ones | **FOLDED** — the six nits corrected where the fold touches them (e.g. `facade-projection-contract.md:637`, `application-semantics.mjs:59-61`); substance unchanged. |

### OQ verdicts

- **OQ1** — RESOLVED by DR-2 (as above).
- **OQ2** — RESOLVED by DR-3 (as above).
- **OQ3** — stays open; both options safe under the pinned H2.2 ownership.
- **OQ4** — stays open; fold leans surfaced write (the H4.2 reviewed-reject re-open is an
  auditable transition).
- **OQ5** — stays open; the shared-prefix seam is now the documented non-collision.

### ESCALATED

None. Every red-team blocker and every QA instruction resolved honestly (FOLDED or kept-open OQ)
without deferral. The red-team's "missing OQ" (the idempotency-key re-transition problem) is not
an open question anymore — H1.1's version-bearing keys close it, and the D1 idempotency
discipline now states it as the discipline's rationale.

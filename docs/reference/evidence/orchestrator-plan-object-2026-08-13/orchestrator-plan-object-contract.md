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
- **Status:** DRAFT v1.0 — implementation contract (red-first; no code landed for this rung)
- **Verification HEAD:** `6ca4ec7` ("Baton private effective-tree snapshot"), the tree this
  contract was verified against. Every `file:line` citation below was re-verified with
  `grep -an`/`sed -n` at this HEAD, not inherited. The two NUL-bearing files whose anchors are
  grep/sed-verified, never whole-file reads: `impl/src/application.mjs` and
  `impl/src/coordination-store.mjs` (3 NUL bytes each, od-verified). `application-cli.mjs`,
  `application-semantics.mjs`, `task-topology.mjs`, `goal-plan.mjs`, `limits.mjs`, and the
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
  "tasks": {
    "task:<hex32>": {
      "schemaVersion": 1,
      "id": "task:<hex32>",
      "title": "<bounded text>",
      "status": "todo" | "doing" | "done",
      "blockedBy": ["task:<hex32>", "..."],
      "ownedBy": { "wave": "wave:<hex32>", "run": "run:<id>", "role": "<id>" },
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
  exactly the tasks whose `ownedBy.wave/run` matches its own wave/run).
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
| `plan.minted` | `{schemaVersion, planId, campaignId, version, tasks, requestDigest}` | `plan.minted:${planId}` | Create the plan with its initial task set (the campaign todo, D4). |
| `plan.task_upserted` | `{schemaVersion, planId, taskId, title, status, blockedBy, ownedBy, evidence, expectedTaskVersion, requestDigest}` | `plan.task_upserted:${planId}:${taskId}` | Create or update a task. Version-CAS on `expectedTaskVersion`. |
| `plan.task_transitioned` | `{schemaVersion, planId, taskId, toStatus, expectedTaskVersion, requestDigest}` | `plan.task_transitioned:${planId}:${taskId}:${toStatus}` | The narrow status mutation (immediate completion marking, D4). |
| `plan.task_evidence_linked` | `{schemaVersion, planId, taskId, evidence, expectedTaskVersion, requestDigest}` | `plan.task_evidence_linked:${planId}:${taskId}:${evidenceDigest}` | Attach evidence links to a task (the elevation output path, D2). |

**Identity.** `planId = plan:${digest({idempotencyKey, campaignId}).slice(0,32)}` —
content-derived from the mint request (the waveId pattern, G5,
`application.mjs:11654-11657`). `taskId = task:${digest({planId, title, ownedBy}).slice(0,32)}`
— content-bound at first upsert (the scratch-fact id pattern, `coordination-store.mjs:14271`),
stable across later mutations so a `blockedBy` edge and a transition keep referencing the same
task.

**Replay behavior.** The plan projection is a pure fold of the event stream — event-seq
anchored, no clocks (the wave.closed record's `closedAtEventSeq` is the epoch anchor, G5). Each
fold re-validates the payload (`_validatePlanPayload` in the store's `_validate*` house style,
cf. `_validateWaveClosedPayload` at `coordination-store.mjs:13308-13347`); an invalid fold state
on replay poisons the projection (`_poisonProjection`, `coordination-store.mjs:1515`), the
TT4/board precedent. Close/reopen replays the identical projection — the pin P2.

**Idempotency discipline per mutation.** The house rule (G4) verbatim: each mutation carries a
caller key; `_byKey` prior-key lookups return the prior event on retry with identical content
and refuse `plan_replay_conflict` (mirror of `board_replay_conflict`,
`coordination-store.mjs:14811`) when the content under a key changed. The `requestDigest` in
each payload is the digest-adjudication basis. Version-CAS on `expectedTaskVersion` refuses
`plan_stale_version` (mirror of the task version-CAS `stale_version`,
`coordination-store.mjs:12633`) — a later mutation can never silently overwrite an observed
state.

**Deployment bounds.** The plan object rides a deployment-owned `planPolicy` in the
taskTopologyPolicy house style (G1, `task-topology.mjs:7-49`): closed fields, bounded,
frozen, digest-verified — one closed bounded deployment policy, not caller policy. The bounds
derive from the same frame-limit family the store already owns — `FRAME_LIMITS`
(`limits.mjs:110`), imported at `coordination-store.mjs:61`, with the store's derived
per-entity caps (`MAX_SCRATCHPAD_ENTRY_BYTES` at `:493`, `MAX_CONTEXT_PACK_BODY_BYTES` at
`:496`). No new arbitrary numeric limit enters client code (campaign-law, below).

### D2 — the authority law

**Who reads/writes what** (the brief's D2 matrix), mirroring the #74 D1.2 read-authorization law
(`contract-fold.md` §D1.2: a member reads `worker:<ownId>` + `shared`, the review authority reads
any member scope of its own wave, no implicit cross-worker read) and the goal-plan authority
(G8):

1. **The orchestrator — full.** A principal holding the `plan:*` capability class (G8; the
   class the human orchestrator keeps, `grounding.md:81-82`) reads and writes the whole plan:
   mint, upsert any task, transition any task, link evidence to any task. This is the review
   authority — the same seat FP-18 admits for the facade lanes (#87; the review authority reads
   any member scope of its own wave, `contract-fold.md` §D1.2.2).
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
   typed code (§refusal) — the "unknown ≡ foreign" default (#87, `facade-projection-contract.md:636`)
   applied to the plan scope.

**Enforcement seam.** The facade `_authorize` seam (`application.mjs:3214-3222`) — the plan
verbs call `_authorize('plan.read'|'plan.write', principal, runId, {planId, taskId})`, and the
store-side fold resolves ownership (`ownedBy` match against the calling run's wave/run — the
`authorizeRunOrchestratorCommand` scope-enforcement pattern, `coordination-store.mjs:2069-2095`,
applied to the plan subtree). The restricting deployment authorize the #74 D1.2 requires (the
`worker:<scope>` read resolves only for own scope / the review authority / an explicit grant) is
the composition point: a plan read resolves for own task / own subtree / the `plan:*` authority,
everything else refuses. The `coordinator_authority_forbidden` code (G6) covers a
coordinator-seat principal reaching `plan.write` against a task OUTSIDE its subtree; the
`plan_authority_forbidden` code (§refusal) covers a principal with no plan authority at all.

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
- **Incomplete** tasks revert to `todo` for the next wave (the honest remainder), and the wave
  map (`ownedBy`) is updated to the next wave's assignment.
- **No silent auto-promotion:** an incomplete or unreviewed task never reads as done; the
  elevation requires the review authority's admission. This is the plan-object instance of the
  KG-2 orchestrator-admit law (docs/34 rule 7) — cited, not re-litigated.

### D3 — the surface + the wave integration

**The verbs.** `plan.read` (observe) and `plan.write` (control). Consistent with the grammar:
a campaign-scoped domain prefix (the `waves.*` precedent — a top-level noun scoping a closed
verb set), with `plan.write` gated by the EXISTING `plan:*` capability class (G8) — the class is
already the human-orchestrator-exclusive authority, so the new verbs ride it instead of minting a
new capability. `plan.read` carries `capabilities: ['observe']`, `effect: 'observe'`;
`plan.write` carries `capabilities: ['control','observe']` plus the `plan:*` authority for the
orchestrator seat. (The `campaign.*` alternative is OQ1.)

**The three-surface admission** (the #159 doctrine, G10 — documented ⇄ parsed ⇄ admitted,
derived mechanically, no ghosts):

1. **Registry rows.** `plan.read` and `plan.write` enter `OPERATION_ROWS`
   (`application-semantics.mjs:1672-1721` region) with closed input schemas and explicit
   `surfaces`. Recommended shape — `plan.read`: `{planId}` required, returns the plan projection;
   `plan.write`: `{planId, idempotencyKey, mutation: <plan.minted|plan.task_upserted|... shape>}`
   with the mutation's own `requestDigest`. The `idempotencyKey` rides the CLI/web envelope the
   ordinary command shape already carries.
2. **CLI.** Parser branches `baton plan read PLAN_ID` / `baton plan write PLAN_ID ...` inside
   the `run`/top-level verb block (mirroring the `baton run scratchpad read/elevate` idiom,
   `application-cli.mjs:1476-1508`), admitted to `CLI_WEB_COMMANDS` (`application-cli.mjs:16-32`).
3. **MCP.** `baton_plan_read`/`baton_plan_write` tools with `repoId` leading the `required`
   arrays (the #159 G10 lesson — every wave/MCP tool requires `repoId` first), plus capability
   entries beside the facade rows (`mcp-northbound.mjs:111-116`).
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
   closed `WAITING_ON_KINDS` (`application-semantics.mjs:58-61`, byte-unchanged); a member whose
   plan task is `done` (immediate completion marking) is settleable. The interpreter's steering
   can declare the gating declaratively (the `steering` policy shape, #114 G5) — a plan-state
   gate is a policy the top orchestrator's spec declares, never client-side logic (the
   infrastructure-law constraint).

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
   behavioral laws, pinned red-first (P8):
   - **Statuses** — the closed three `['todo','doing','done']` (verbatim G2).
   - **Exactly-one-in-progress** — at most one task `doing` per plan (per wave subtree, OQ2). A
     transition to `doing` when another task is already `doing` auto-demotes the current `doing`
     task to `todo` in the SAME batch (the kimi behavior) — the batch is the `plan.task_transitioned`
     append + the demote transition append (the store's `_appendBatch` precedent,
     `coordination-store.mjs:1524-1597`). Where the plan is a strict DAG (a `doing` task the
     demote would corrupt), the transition refuses `plan_parallel_progress` instead — the two
     shapes are both honest; the DAG case is the refusal.
   - **Immediate completion marking** — a verified-complete task is marked `done` at once (the
     row's own transition, D2.3), never batched or lazy. `plan.read` never re-derives status from
     anything else; the plan object's status IS the truth.
4. **Retire the tracker.** Once the plan object carries the campaign todo, the out-of-band
   TodoList is no longer the tracker; the orchestrator's todo, wave map, and blocked-by
   relationships are queryable baton state (the #161 close condition).

---

## Refusal vocabulary

Existing codes reused verbatim (semantics unchanged): the facade capability denial
`application_unauthorized` (`application.mjs:3222`), `application_command_invalid`
(`application.mjs:12500`), the #74 `coordinator_authority_forbidden {attempted, gracefulPath:
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
| `plan_replay_conflict` | store (prior-key adjudication) | — | Idempotency content changed under one key (mirror of `board_replay_conflict`, G4). |
| `plan_stale_version` | store (version-CAS) | — | `expectedTaskVersion` mismatches the task's current version (mirror of `stale_version`, G3). |
| `plan_not_found` | store + facade | `{planId}` | `plan.read`/`plan.write` names an unminted plan. |
| `plan_task_not_found` | store + facade | `{planId, taskId}` | A mutation names a task absent from the plan. |
| `plan_task_invalid` | store (closed shape) | — | A task violates the closed schema (unknown field, bad `blockedBy`/`ownedBy`/`evidence`, non-closed status). |
| `plan_topology_invalid` | store (DAG admission) | — | `blockedBy` self-edge, dangling edge, or cycle (the goal-plan `assertDag` shape, G1/deps discipline). |
| `plan_parallel_progress` | store (exactly-one-in-progress, D4) | `{currentDoingTaskId}` | A `→ doing` transition when another task is `doing` AND the strict-DAG shape forbids auto-demote (D4, OQ2). |
| `plan_blocked` | store (elevation gate, D2) | `{blockedByUnmet: [taskId…]}` | A `→ done` transition whose `blockedBy` edges are not all `done` (no evidence-gated completion of a blocked task). |
| `plan_authority_forbidden` | facade `_authorize` (the plan scope) | `{attempted, planId, taskId, ownedBy?}` | A principal with no plan authority reaches `plan.read`/`plan.write` outside its ownership (the D2.4 "everyone else" case; the #87 "unknown ≡ foreign" default applied to the plan scope). |

`plan_authority_forbidden` is the plan-scope instance of the "unknown ≡ foreign at the policy
seam" default (#87, `facade-projection-contract.md:636`) — a worker reaching a plan task it does
not own draws it, never `application_unauthorized` alone, so the refusal is coachable and
distinct from a generic capability shortfall.

---

## Red-first acceptance pins

RED = fails at HEAD; GREEN = passes at HEAD and is pinned. New rows in a `plan-object-red.test.mjs`
sibling suite (the TT-row / board-row house style, G1/G3).

| Pin | Assertion | Today |
|---|---|---|
| P1 | **Mint + idempotency (D1).** Red: no plan verbs exist. Green: `plan.write` with `plan.minted` mints the plan (`planId = plan:${digest…}`), a retry with the same key returns the prior event, changed content under the same key refuses `plan_replay_conflict`. | **RED** (no plan machinery) |
| P2 | **Replay (D1).** Green: the plan projection replays byte-identically from `events.jsonl` through close/reopen (the store fold pattern, G4/G5). | **GREEN** (pin — the fold pattern is landed) |
| P3 | **Closed task shape (D1).** Green: the task is the closed `{id, title, status, blockedBy, ownedBy, evidence}`; an unknown field refuses `plan_task_invalid`; a `blockedBy` self-edge/dangling/cycle refuses `plan_topology_invalid`; a non-closed status refuses `plan_task_invalid`. | **RED** (no plan shape) |
| P4 | **Exactly-one-in-progress + immediate completion (D1/D4).** Red: no status law. Green: two tasks cannot be `doing` simultaneously (`plan_parallel_progress` in the strict-DAG shape, or the auto-demote batch); a verified task is marked `done` immediately and stays done (a `done` task cannot re-open). | **RED** (no plan status law) |
| P5 | **Authority matrix (D2).** Red: no plan authority exists. Green: a row member reads its own task and transitions its OWN task to `done`; a row member writing a sibling task refuses `plan_authority_forbidden`; a coordinator writes its subtree (`ownedBy` match) and a coordinator writing outside its subtree refuses; the orchestrator (`plan:*`) mints/upserts/transitions any task. | **RED** (no plan authority) |
| P6 | **Elevation at wave close (D2).** Red: no plan elevation. Green: at `wave.closed` the review authority reviews the wave's plan tasks — completed → `done` with evidence links, incomplete → `todo`, wave map updated; an unreviewed/incomplete task never reads as done (no silent auto-promotion). | **RED** (no plan elevation) |
| P7 | **Three-surface admission (D3).** Red: `plan.read`/`plan.write` do not exist on any surface. Green: the registry rows claim surfaces; the CLI parses `baton plan read|write` and `CLI_WEB_COMMANDS` admits both; the MCP tools `baton_plan_read`/`baton_plan_write` lead `required` with `repoId`; the generated CLI.md/MCP.md blocks contain the rows; the #157 closed-set pin EXTENDED to `plan.*` is green; a claimed-but-web-refused surface is ledgered under the #159 discipline. | **RED** (no plan verbs) |
| P8 | **#74 integration (D3).** Red: no coordinator decomposition lands in a plan. Green: a #74 coordinator member's `plan.write` (task_upserted) writes its subtree's row tasks with `ownedBy` binding; the interpreter gates a member on its plan task's state — a blocked task's member is honestly `waitingOn` (the closed five byte-unchanged), a `done` task's member is settleable. | **RED** (no plan integration) |
| P9 | **Orchestrator practice migration (D4).** Red: the campaign todo is out-of-band. Green: `plan.read` at the orchestrator seat returns the campaign todo as the plan projection; the closed three statuses, exactly-one-in-progress, and immediate completion marking are the observable plan semantics. | **RED** (out-of-band today) |
| P10 | **Refusal constancy.** `application_unauthorized` stays the facade denial; the closed five `WAITING_ON_KINDS` (`application-semantics.mjs:58-61`) and the closed three `SCRATCHPAD_STEP_STATES` (`coordination-store.mjs:537`) are byte-unchanged; no sorted-key literal is introduced; no clock enters any refusal. | **GREEN** (pin) |

---

## Open questions

- **OQ1 — naming: `plan.read`/`plan.write` vs `campaign.read`/`campaign.write`.** This contract
  recommends `plan.read`/`plan.write` because the `plan:*` capability class ALREADY exists and is
  the human-orchestrator-exclusive authority (G8, `grounding.md:81-82`) — the new verbs ride it
  without a new capability. The alternative (`campaign.*`) names the object more precisely but
  mints a new prefix AND a new capability class. If `plan.*` is chosen, the overload with the
  goal-plan DAG (the `plan:` noun in `goal-plan.mjs`) is a documentation burden, not a collision
  — no public `plan.*` command exists today (G8) and the goal-plan's nodes are store-internal.
- **OQ2 — exactly-one-in-progress scope: per plan or per wave subtree.** The kimi reference is
  per-plan (one `doing` in the whole todo). The wave map (D1 `ownedBy`) suggests the stricter
  per-wave reading: one `doing` per wave subtree, so a coordinator's wave can run its own `doing`
  row while the orchestrator's next wave task sits `todo`. This contract pins the auto-demote
  batch + the strict-DAG refusal (D4, P4) but leaves the SCOPE (per-plan vs per-subtree) open —
  it is a deployment-policy choice in `planPolicy`, not a code fork.
- **OQ3 — the row's write scope: `done` only, or also `doing`?** The immediate-completion-marking
  reference (G9) suggests the row transitions its OWN task to `done` and the orchestrator assigns
  `doing`. But the board-claim pattern (G3 — a worker claims its row) suggests a row could also
  set its own task `doing` at claim. This contract pins `done` (the completion path) as the row's
  guaranteed write; whether `doing` at claim is row-allowed is open (both are safe under the D2
  authority law; the strict-DAG `plan_parallel_progress` bounds the risk).
- **OQ4 — elevation as plan.write vs a store fold.** The elevation (D2) can mutate the plan
  through the surfaced `plan.write` (review authority issues the transitions) or as an internal
  store fold beside `wave.closed` (the `_waveClosures` precedent, G5). The `wave.closed`
  knowledge block is the precedent for the fold; the surfaced write keeps the elevation in the
  audit trail. This contract leaves the mechanism open — the law (reviewed elevation, no silent
  auto-promotion) is the pin, not the seam.
- **OQ5 — plan object vs the goal-plan DAG: do they unify?** The goal-plan DAG
  (`goal-plan.mjs` — a node DAG with `deps` for one goal) and the plan object (the campaign todo
  with `blockedBy`) share the DAG shape. Whether a goal-plan node's dispatch should auto-sync to a
  plan task (the wave map as the join) is open; this contract keeps them distinct (the plan object
  is the orchestrator's campaign todo; the goal-plan DAG is a goal's execution decomposition) and
  does not re-specify the goal-plan machinery.

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
  (`facade-projection-contract.md:636`) the `plan_authority_forbidden` code implements for the
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
  fanout) are a deployment-owned, frozen `planPolicy` in the taskTopologyPolicy house style (G1),
  derived from the existing `FRAME_LIMITS` family (`limits.mjs:110`, store-side derived caps
  at `coordination-store.mjs:493/:496`) — never a hardcoded client-code ceiling. The elevation,
  the status law, and the exactly-one-in-progress
  bound are semantic laws, not counters.
- **`localeCompare` banned.** No ordering decision uses it; task ids sort by canonical order.
- **Sorted-key literals in ACTUAL order.** The only sorted-key literals cited are the landed ones
  — the closed three `SCRATCHPAD_STEP_STATES` (`coordination-store.mjs:537`), the closed five
  `WAITING_ON_KINDS` (`application-semantics.mjs:58-61`), the closed eight `wave.closed` payload
  keys (`coordination-store.mjs:13312`) — all in their actual file order; nothing new is
  introduced.
- **Non-goals.** This rung does NOT unify the goal-plan DAG with the plan object (OQ5); does NOT
  widen the recursive-session gate (the plan verbs dispatch as direct ports before the gate, the
  G6 pattern, with the `plan:*` authority as their gate); does NOT project the plan onto a surface
  the registry does not claim (the #159 ledger covers a claimed-but-refused surface); does NOT
  re-specify any cross-referenced contract; does NOT integrate homelab. The plan object is the
  orchestrator's campaign todo — the goal-plan, the task topology, the board lane, and the
  scratchpad tiers keep their own machinery and are consumed here, not re-built.

---

## Verification (deployment)

1. Confirm the only edited/new file in the worktree is
   `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md`
   (`git status`).
2. Deploy-verification for this contract's execution: executable `true`, args `[]`, cwd `.`,
   expected exit code `0`. No code was changed by this contract; the work is the contract text.

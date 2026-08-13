# Issue #74 — the worker-orchestrated swarm pattern: a sub-orchestrator tier over flash swarms (v1.1 — the folded contract)

The folded contract (v1.1) for issue #74: the worker-orchestrated swarm pattern. A heavyweight
sub-orchestrator worker (the **coordinator**) sits over a heterogeneous swarm of cheap workers; the
coordinator decomposes a big spec+suite into granular sub-specs as ARTIFACTS in the shared layer,
the swarm executes rows, and the coordinator triages and escalates genuinely big questions to the
top orchestrator. This contract owns the **two-level shape that works today** (a coordinator member
inside the top orchestrator's wave, coordinating through the collaboration lanes — it never drives
baton itself) and names the #12 nested-orchestration composition for the full shape. It specifies
behavior; it does not amend implementation in this artifact. It is a Ring-2 contract (ground truths
→ decisions → refusal vocabulary → red-first acceptance → open questions). It cross-references — it
does not re-specify — #12 (the nested-orchestration rung: a minted, lease-bound child connection
profile), #68 (the BD3-A scratchpad read port), #71 (the orchestrator wake surface), #94 (the
dynamic-workflow demo: a scripted workflow through the surface, DECISION_REQUEST → `run.answer`
proven), #105 (the reply-chains D8 boundary-routing law), #114 (the workflow-as-data interpreter
this pattern rides), and #132 (the wave registry the sub-orchestrator's waves land in).

- **Date:** 2026-08-13
- **Status:** DRAFT v1.1 — implementation contract (red-first; no code landed for this rung)
- **Verification HEAD:** `7e68187741369c207835b7ce98565030429eddaf` ("Baton private effective-tree
  snapshot"), the tree this fold was verified against. Every `file:line` citation below was
  re-verified with `grep -an`/`sed -n` at this HEAD, not inherited. The two NUL-bearing files whose
  anchors are grep/sed-verified, never whole-file reads: `application.mjs` and
  `coordination-store.mjs` (3 NUL bytes each). `coordinator.mjs`, `claude-session.mjs`,
  `mcp-northbound.mjs`, `workflow-interpreter.mjs`, `recipes.mjs`, `application-cli.mjs`, and
  `application-deployment.mjs` are NUL-free and read with plain `grep`/`sed`.
- **Fold source:** v1.0 (`worker-orchestrated-swarm-contract.md`, same dir) + the adversarial
  red-team report (`contract-redteam.md`, same dir). This fold applies every blocker fix, the three
  citation-drift corrections, and every amendment/note; the verdict'd-SOUND substance (D1
  double-claim and fabricated-results seams, D3 seat discipline, the two-level posture) is carried
  byte-stable in substance. The fold-map table below routes every finding to its resolution; the
  topology audit (`comm-topology-audit.md`, same dir) is context, not re-litigated here.
- **Brief:** `contract-fold-brief.md` (same dir) — read fully. The issue body (`gh issue view 74`)
  could not be fetched (`gh` is not authenticated in this worktree); the requirements are carried
  by the brief and the read-order below.
- **Read-order executed.** (1) this brief; (2) the red-team report (NOT FOLD-READY — two blockers,
  three citation drifts, three amendments/notes); (3) the v1.0 contract (the edit source); (4) the
  topology audit (context); (5) the cross-referenced laws the red-team cites —
  `reply-chains-contract.md:288-333` (D8, `docs/reference/evidence/reply-chains-2026-08-06/`) and
  `facade-projection-contract.md:217,636` (the scratchpad scope grammar + the "unknown ≡ foreign"
  policy seam, `docs/reference/evidence/facade-projection-2026-08-03/`).

Scope of the rung, in one sentence: **the worker-orchestrated swarm is a workflow shape, not a new
authority — a coordinator-member recipe declares a heavyweight coordinator beside cheap swarm rows;
the coordinator decomposes the brief into artifacts in the shared layer, triages rows, and escalates
only genuinely big questions via the landed DECISION_REQUEST lane to the top orchestrator, which
keeps every wave/steering authority; and the whole pattern is declarable as a #114 workflow-as-data
spec (a coordinator member + swarm members + steering policies) through `waves.run`.**

---

## Fold-map (v1.0 red-team → v1.1)

| Finding (from `contract-redteam.md`) | v1.0 verdict | Resolution — where in v1.1 |
|---|---|---|
| **BLOCKER 1 — steering-trail falsification on denied answers.** `answerDecision` (`workflow-interpreter.mjs:783-809`) swallows `handle.answer` throws and unconditionally records `outcome: 'answered'`; `s.answeredKeys.add(key)` runs before the attempt (`:698`), so a denied/raced answer is silent *and permanent*. | blocker → folded | **§D1.3 — the truthful steering trail** (new contract law): record `{outcome: 'denied', refusal: <code>}`, do NOT mark the key handled, leave the ask pending; `outcome: 'answered'` only after a successful `handle.answer`. The D6 receipt law (§D1, "Swarm execution receipts") and **A3's GREEN** amended. |
| **BLOCKER 2 — artifact-handoff read-authorization law unspecified.** Neither this contract nor #87 states who may read a `worker:<role>` partition; the shipped default authorize is permissive (`application-deployment.mjs:1998`), while #87's "unknown ≡ foreign" (`facade-projection-contract.md:636`) would refuse the cross-worker read A2 needs. | blocker → folded | **§D1.2 — the scratchpad read-authorization law** (new contract law): own `worker:<ownId>` + `shared`; top orchestrator (review authority, FP-18) reads any member scope of its own wave; swarm rows read coordinator sub-specs only via an explicit wave-scoped grant or `shared`. Enforcement seam pinned (the deployment `authorize`). **A2's GREEN** amended to assert a sibling `worker:<role>` read is REFUSED with the typed code. |
| drift 1 — `application-cli.mjs:124` (throw is at `:126`, label at `:257`) | must-fix | corrected — every citation updated to **`application-cli.mjs:126`** (label **`:257`**): D2 two-level shape, refusal vocabulary, A4. |
| drift 2 — `coordinator.mjs:11234-11243` (`submitBoardReport` starts `:11247`) | must-fix | corrected — every citation updated to **`coordinator.mjs:11234-11256`**: G11, D1 artifact conventions. |
| drift 3 — `application.mjs:11613-11617` (roster built `:11610-11614`, `route` at `:11612`) | must-fix | corrected — every citation updated to **`application.mjs:11610-11614`** (route **`:11612`**): G2, D3, A6. |
| A5 GREEN over-states the gate. OQ1 is CONFIRMED: `waves.*` direct ports dispatch before the recursive-session gate (`application.mjs:12502-12512` vs the gate's `context?.sessionAuthority` check at `:12527-12532`), so a lease-bound `waves.start` draws no #12 refusal. | amendment → folded | **§D2 full shape** states the pre-gate finding; **A5's GREEN** narrowed (the #12 codes are NOT claimed for `waves.*`; the full shape needs `waves.start`/`waves.run`/`waves.stop` added to the recursive gate, or explicitly refused for lease holders, at the dispatch seam). **OQ1 → answered** with the code finding carried into §D2. |
| D4 harvest example names a directory — `git show <sha>:<dir>` fails → `harvest_miss` → `WAVE-INCOMPLETE`. | note → fixed | **§D4 example** names a FILE (`docs/results/coordinator.md`), and a note states the file-not-directory law with the `git show` anchor. |
| §3.3 escalation-spam sequence bound unstated. | note → folded | **§D1.4 — the escalation sequence bound**: concurrency-bounded (one live ask/session, one pending decision/worker, stuck-on-handled self-termination) but sequentially uncapped after human answers, with the human-in-the-loop justification. |
| D1 double-claim seam | SOUND | carried byte-stable in §D1 (red-team verified). |
| D1 fabricated-results seam | SOUND | carried byte-stable in §D1 (red-team verified). |
| D3 seat discipline | SOUND | carried byte-stable in §D3 (red-team verified). |
| Two-level authority posture (A4) | SOUND | carried byte-stable in §D2 and A4. |

---

## Ground truths (code-verified)

| # | Claim | Anchor |
|---|---|---|
| G1 | **The wave surface is landed as facade direct ports, dispatched before the recursive-session gate.** `waves.start`/`waves.progress`/`waves.send`/`waves.stop` dispatch at `application.mjs:12502-12505`; `waves.list` (the #132 observe verb) at `:12506-12508`; `waves.run` (the #114 interpreter) at `:12512`. The eight #87 workflow-surface direct ports (`run.message.send/receipt`, `run.attention.watch`, `run.scratchpad.read/elevate`, `run.board.post/read`, `run.knowledge.seed`) dispatch at `:12467-12474`, explicitly BEFORE `normalizeCommandContext`/`validateApplicationCommandArgs`/the recursive gate (`:12460-12465`, FP-18 pins the pre-gate dispatch). Each validates through its own closed normalizer, then delegates to its landed kernel lane. | `application.mjs` |
| G2 | **`wave.started` mints pre-loop, exactly-once, idempotency-keyed.** Mint site `application.mjs:4642-4661`: payload `{waveId, deploymentId, roster, idempotencyKey}` under `wave.started:${waveId}`; the roster is the member-object shape `[{role, route, scope}]` built at `:11610-11614` (`route` is the normalized `exact`, `:11612`), and each member rides the SAME exact-route profile admission ordinary `run.start` uses (`:11620-11630`). | `application.mjs` |
| G3 | **The recursive-session gate admits `run.start` + six reads for lease holders; waves/message/board lanes are NOT in the allowlist.** The gate (`authorizeReplay`, `application.mjs:3304-3312`): a `sessionAuthority` principal with `name !== 'run.start' && name !== 'application.help'` is bound to the recursive allowlist `['run.status','run.inspect','run.episode','run.workstreams','run.wait','run.follow']`. `_recursiveLease` binds the envelope to the live lease (`:4423-4441`). #12 v1.1 pins "The recursive-session gate is NOT widened" (`nested-orchestration-contract.md:514`); widening it is #74's own rung (`grounding.md:200-204`). | `application.mjs` |
| G4 | **DECISION_REQUEST is landed wire grammar.** Grammar `claude-session.mjs:27`; the single-request pin `:1132-1141` admits at most ONE live emulated decision request per session — a second (possibly contradictory) line is ignored as prose while one is pending; the worker can always re-ask once it settles. Admission `coordinator.mjs:12769`: malformed payloads never mint a pending record; an oversize question draws a typed, coaching refusal. Reconstruction `:13934`. The human answers via `run.answer` (`application.mjs:180`, capabilities `['approve','observe']`) or `baton_decision_answer` (`mcp-northbound.mjs:92`). The #94 demo proved the round-trip: the LEAD printed the single mandated DECISION_REQUEST; the driver resolved it via `run.answer` with `synthesize` (`control-surface-audit.md:119-126`). | `claude-session.mjs`, `coordinator.mjs`, `application.mjs` |
| G5 | **The workflow-as-data interpreter is landed.** `waves.run` direct port (`application.mjs:12512`). Closed spec `SPEC_FIELDS = ['schemaVersion','idempotencyKey','members','steering','harvest']` (`workflow-interpreter.mjs:48`); member `['role','exact','scope','objectiveRef','report']` (`:49`); steering `['approveOnAdvertisedPlan','nudgeOnCheckpoint','claimOnStall','messageOnSpawn','elevateWhenNotes','answerDecisions','signalOnMembersDone']` (`:51-54`). `answerDecisions` is a policy map `question → optionId | text | "defer"` (`:260-270`, driven `:693-699`, `defer` outcome `:789-793`, `matchDecision` first-match-wins `:454-466`). D6 receipt EXACTLY seven keys, sorted: `{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}` (`:594-602`); `outcomes` is `[{role, phase, terminal, resultSha, report?}]`; `verdict` is `WAVE-OK`/`WAVE-INCOMPLETE` (`:589-590`). `verification` is REMOVED from the spec (`:137`); `report` is a declared member field, never executed, carrying the result-pin path (`:209-214`). | `workflow-interpreter.mjs` |
| G6 | **Recipes are the invocation cadence.** `implementContractRecipe` preset (`recipes.mjs:549`); `createRecipes` returns `{run, implementContract, runWorkflow}` (`:574-587`). Closed fields `RECIPE_TOP_FIELDS = ['name','version','members','policy']` (`:39`), `ROLE_FIELDS = ['role','exact','scope','objectiveTemplate','report']` (`:40`), `EXACT_FIELDS = ['harness','model','effort']` (`:41`); role `'work'` is reserved (`:232-235`); `objectiveTemplate` is `{task, constraints}` (`:178-204`); `renderObjective` appends the `[attempt: <salt> <role>]` marker (`:294-309`). | `recipes.mjs` |
| G7 | **The wave registry projection is landed.** `_waveRegistry` Map (`coordination-store.mjs:1231`); `wave.started` fold `:8099-8120` (a roster neither a well-formed object-array nor a well-formed string-array throws `wave_registry_invalid`); `wave.closed` fold `:8793-8803` (state flips to `'closed'`, `waves.list` reads only open rows). The read side: `waves.list` at `application.mjs:11705-11747` (typed `wave_not_found` for a missing member run). Row shape `{deploymentId, idempotencyKey, roster, waveId}` (wave-observability-2026-08-06 D2.2). | `coordination-store.mjs`, `application.mjs` |
| G8 | **waitingOn is the single honest projection with a closed kind set.** `WAITING_ON_KINDS` is the closed five `['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning']` (waiting-vocabulary-2026-08-06 D2; actual order, `application-semantics.mjs:59-63`); projections ride the SAME phase/task/worker view at `application.mjs:7326, :7799, :10746, :11996`. The honest-null law (D4): a member with `waitingOn != null` never serializes as `working`; `capacity_ceiling` mints a durable deferral receipt at the skip (D5). | `application.mjs` |
| G9 | **The capability refusal for an authority action is `application_unauthorized` at the facade seam.** `_authorize` throws it when `allowed !== true` (`application.mjs:3215`). A worker/coordinator seat holds `['observe','control']` at most and never `approve` — the excluded classes are `approve`, `emergency_stop`, `export_result`, `retry_verification`, `goal:*`, `plan:*` (`grounding.md:81-83`); the capability table `mcp-northbound.mjs:96-98`. | `application.mjs`, `mcp-northbound.mjs` |
| G10 | **The full-shape authority machinery (a lease-bound child profile) is landed kernel-side and contracted in #12.** `issueRunOrchestratorLease` (`coordination-store.mjs:1931`), `activeRunOrchestratorLeaseForSession` (`:1990`), `admitRunLineage` (`:2025`), `authorizeRunOrchestratorCommand` (`:2069`), `revokeRunOrchestratorLease` (`:1960`), the parent-death `sweepSettlementLeases` (`:12556`). `acquireBoardLease` returns the exact binding envelope `{...receipt, sessionAuthority: {schemaVersion, authorityDigest, expiresAt, orchestratorLeaseId}}` (`coordinator.mjs:11208-11225`); the envelope's closed shape is gated at `application.mjs:1172-1174` and consumed by `_recursiveLease` (`:4423`). `_isReviewAuthority` already admits a live run-orchestrator lease holder (`coordinator.mjs:7096-7110`). | `coordination-store.mjs`, `coordinator.mjs`, `application.mjs` |
| G11 | **The #74 collaboration lanes are unevenly landed.** Post-#12, the only lanes fully landed FOR A WORKER are DECISION_REQUEST escalation and lease-bound nested `run.start`/`run.stop` (+ recursive reads); `waves.*` surfaces are landed but lease-holder authorization is unverified (§D2); the eight #87 workflow lanes are contracted, not landed; the board worker-half (`requestBoardClaim`/`submitBoardReport`, `coordinator.mjs:11234-11256`) and BD3-B context packs (`mintContextPack`/`materializeContextPack`/`recordContextRead`, `coordination-store.mjs:13255/:13292/:13533`) are kernel-only with no facade/MCP projection (`grounding.md:149-157, 175-178`). | `coordinator.mjs`, `coordination-store.mjs`, `grounding.md` |
| G12 | **The #12 full shape is the composition dependency for a coordinator that drives baton itself.** The minimal rung — a minted, lease-bound child connection profile projected at spawn, revoked at reap — is the exact shape that unblocks #74 (`grounding.md:180-204`). This contract owns the two-level shape (coordinator coordinates without driving) and names the full shape via #12 (cross-referenced, not re-specified). | `grounding.md` |

---

## Decisions

### D1 — The pattern as a first-class workflow shape: the coordinator-member recipe

The worker-orchestrated swarm is a **workflow shape**, not a new authority. A workflow spec (or a
recipe invocation of the implementContract cadence) declares a `coordinator` member beside swarm
members (D4). The coordinator takes the big spec+suite, decomposes it into granular sub-specs /
test-suite areas as ARTIFACTS in the shared layer, a heterogeneous swarm executes rows, and the
coordinator triages and escalates genuinely big questions via DECISION_REQUEST to the top
orchestrator. The coordinator-member recipe is the implementContract preset invoked with
`role: 'coordinator'` and a heavyweight route; nothing new is added to the closed recipe shape
(G6).

**Artifact conventions (where sub-specs live, how rows are claimed, how results land).** Row
sub-specs land in the coordinator's scratchpad partition — the partition grammar
`^(?:shared|worker:[A-Za-z0-9._:-]{1,256})$` (`facade-projection-contract.md:217`; the store's
pattern at `coordination-store.mjs:533`) — and the swarm reads them via the #68 BD3-A read port
(`run.scratchpad.read`, contracted #87, dispatched at `application.mjs:12470`). Rows are claimed
and reported through the board worker-half (`requestBoardClaim`/`submitBoardReport`,
`coordinator.mjs:11234-11256`) where the surface exists; today that half is kernel-only (G11), so
in the two-level shape row claim/result is coordinated through the coordinator's board posts and
the top orchestrator's wave composition. Results land in board reports, scratchpad sections, and —
the audit surface — the wave receipt (D6 per-member `outcomes`, G5) and the wave registry
(`waves.list` open rows, G7). The artifacts are the persistent handoff: the shared layer survives
across successive waves, so the top orchestrator may run a decomposition wave (coordinator alone)
then an execution wave (swarm), or declare coordinator + swarm in ONE spec where swarm rows that
genuinely need the coordinator's artifact wait on their lane read (the #10 interaction lane, honest
`waitingOn`, G8).

**D1.2 — The scratchpad read-authorization law (v1.1 — BLOCKER 2 fold).** Who may read a
`worker:<role>` partition is contract law, stated so the D1/A2 artifact handoff is decidable:

1. **A member principal may read `worker:<ownId>` + `shared`** — exactly the Part D rule-12
   visibility predicate (`application.mjs:699-701`: a worker sees its own `worker:<id>` scope plus
   the read-only `shared` scope, both within its own run).
2. **The top orchestrator — the review authority (FP-18, `facade-projection-contract.md:1240`; a
   live run-orchestrator lease holder is lane-admitted by the pre-gate dispatch) — may read any
   member scope of its own wave.** The FP-18 pin is exactly that the eight #87 ports (including
   `run.scratchpad.read`) dispatch ahead of the recursive-session gate so the review authority is
   not refused.
3. **A swarm row reads the coordinator's sub-specs ONLY through an explicit wave-scoped grant, or
   via the coordinator publishing the sub-spec to `shared`** (which the shared-layer persistence
   already supports). There is no implicit cross-worker read.

**Enforcement seam.** `run.scratchpad.read` passes `{scope}` straight to
`_authorize('run.scratchpad.read', principal, runId, {scope})` (`application.mjs:13037`) and then
snapshots whatever scope was requested (`scratchpadSnapshot(request.runId, request.scope)`,
`:13038`); `_authorize` throws `application_unauthorized` when the deployment authorize does not
return `true` (`:3215`). The shipped default deployment authorize is permissive —
`authorize: async () => true` (`application-deployment.mjs:1998`) — so under the default there is
**no scope restriction at all**: a swarm row could read `worker:row-2` as easily as
`worker:coordinator`, and could read the coordinator's partition across runs. v1.1 therefore
**requires any deployment running the coordinator-member recipe to install the restricting
authorize at that seam**: a `worker:<scope>` read resolves only for `scope === worker:<ownId>` (or
an explicit wave-scoped grant); everything else refuses `application_unauthorized`. This is the
"unknown ≡ foreign at the policy seam" default (#87, `facade-projection-contract.md:636`)
implemented for scopes foreign to the caller's run — the same policy law the #87 contract already
pins for the lane.

**D1.3 — The truthful steering trail (v1.1 — BLOCKER 1 fold, contract requirement).** The
`answerDecisions` policy answering is part of the escalation audit the top orchestrator reads, so
the steering trail must not be falsifiable. When the policy answering throws — a denied option (the
answering principal cannot exercise the mapped answer) or a raced terminal member — the interpreter
MUST:

1. record the truth in the steering trail: `{trigger: 'answerDecisions', role, requestId,
   outcome: 'denied', refusal: <code>}`, where `<code>` is the thrown refusal's typed code (the
   facade's code from the `handle.answer` throw — e.g. `application_unauthorized` for a
   capability-denied answer at `application.mjs:3215`, or the terminal-member refusal for a raced
   member);
2. NOT mark the decision key handled — neither `s.answeredKeys` nor `s.handledDecisionKeys`;
3. leave the ask pending for the human — the member's task stays parked at `input_required` (the
   DECISION_REQUEST admission is a blocking decision gate, `coordinator.mjs:12769` → `:12844-12858`
   → `input_required`), and the later human answer via `run.answer` (`application.mjs:180`) settles
   it.

`outcome: 'answered'` may only be recorded AFTER `handle.answer` returns successfully. Today the
interpreter marks `s.answeredKeys.add(key)` before the attempt (`workflow-interpreter.mjs:698`) and
both answering paths swallow the `handle.answer` throw and record `outcome: 'answered'`
unconditionally (the free-text path `:794-799`, the optionId path `:806-809`) — the fold requires
this to change. The D6 steering trail is then the honest escalation audit: every entry is either
`deferred` (no policy match), `refused` (a policy-named option the ask does not actually offer,
`:801-805`), `denied` (a throw — the ask stays open), or a genuinely delivered `answered`.

**D1.4 — The escalation sequence bound (v1.1 — §3.3 note fold).** Escalation spam is bounded in
concurrency and audited end-to-end, but the sequence of re-asks after a human answers is not
volume-capped:

- **One live ask per session** (`claude-session.mjs:1132-1141`) and **one pending decision per
  worker at admission** (R-BD-4, `coordinator.mjs:12844-12858`) — concurrent spam is structurally
  impossible.
- **Every ask is audited**: malformed → coaching `control.malformed_interaction_rejected`;
  duplicate → `control.duplicate_interaction_rejected`; overflow → `decision_already_pending`; each
  lands an `authority.rejected` record and, when admitted, transitions the task to `input_required`
  (a blocking gate — the coordinator cannot ask again until the previous ask settles).
- **The interpreter self-terminates on repeated defers**: `roleStuckOnHandled`
  (`workflow-interpreter.mjs:741-746`) breaks the drive loop once a member has a handled decision
  key with no answer.

What is NOT bounded is the sequence of re-asks after a human answers: each answer frees the worker
to ask again, with no total-volume cap. This is defensible **because the human is always in the
loop** — every ask and every answer lands in the steering trail (D1.3), and a genuinely big question
the policy cannot resolve reaches the human rather than being auto-answered. The contract states the
bound explicitly: **concurrency-bounded, sequentially uncapped after human answers, every entry in
the trail**. No count ceiling is added (the "no arbitrary numeric limits" law, below).

**Escalation contract (what rises vs what the coordinator answers).** The coordinator ANSWERS
row-level triage — sub-spec clarifications, row sequencing, decomposition decisions, anything
decidable within its brief — through the message/board lanes. The coordinator ESCALATES via
DECISION_REQUEST what it must not answer: scope ambiguity touching the top orchestrator's intent,
authority-class questions (`approve`, `emergency_stop`, `goal:*`, `plan:*` — the classes its seat
never holds, G9), and policy conflicts with no delegate. In the #114 composition the answerable set
is declared declaratively: `answerDecisions.policy` maps a question pattern to `optionId | text |
"defer"`; a `defer` leaves the ask pending for the human and records `{deferred: true, outcome:
'deferred'}` in the steering trail (G5, D1.3). The #105 D8 law governs the worker-facing boundary
unchanged: a blocking follow-up goes to the interaction lane (`question.asked` with
`blocking !== false` → task `input_required`, the admission seam `coordinator.mjs:12675-12710`), a
conversational follow-up stays in the budgeted reply lane; the coordinator's DECISION_REQUEST is a
decision gate, which ALWAYS transitions a task phase.

**Swarm execution receipts (per-row outcomes the top orchestrator can audit).** The top orchestrator
audits per-row outcomes from the D6 receipt: `{basis, harvest, manifestDigest, outcomes, steering,
verdict, waveId}` (G5) — each member's `{role, phase, terminal, resultSha, report?}`, the steering
trail (every answerDecisions/nudge/claim recorded, **truthful under D1.3**), and `verdict`/`basis`.
A wave that did not settle every row and harvest refuses `WAVE-INCOMPLETE` with `basis =
manifestDigest`; `waves.list` shows the open in-flight rows (G7). No new receipt surface is
introduced.

**Double-claim seam — SOUND (red-team verified).** `requestBoardClaim`'s kernel
(`coordination-store.mjs:14806`) is exactly-once: prior-key idempotency digest-adjudication
(`board_replay_conflict` on changed content), `item.state !== 'open'` refusal, `existing &&
existing.active` → `{ok: false, result: 'conflict'}` (first claim wins), and `expectedBoardFence !==
boardFence(board)` → `stale_board_fence` with the cheap re-read. A second member claiming the same
row is refused at the CAS. The two-level shape routes row-claim through board posts + the top
orchestrator's wave composition (the half is kernel-only, G11), so the double-claim risk does not
travel through the surfaced lane.

**Fabricated-results seam — SOUND (red-team verified).** D6 `outcomes` are server-derived, never
coordinator-authored: `materializeSha` (`workflow-interpreter.mjs:381-393`) reads the member's
actual `result` section via `handle.inspect` then falls back to `resolveResultPin` (`:360-377`)
which enumerates `refs/baton/results/` and requires the member's declared `report` path to exist
**inside the pinned git object** (`git cat-file -e <sha>:<path>`), with the `excludeShas` set
preventing two members from claiming the same pin and the waveId-bound attempt marker
(`[attempt: <salt> <role>]`) preventing a byte-similar pin from another wave being attributed. The
coordinator cannot mint a sibling's resultSha — the git object tree is the authority.

### D2 — The sub-orchestrator's authority boundary

**The coordinator worker NEVER drives baton itself.** No `waves.start`, no `run.start`, no
`waves.stop`, no `run.steer`, no goal/plan. It decomposes, sequences, triages, and escalates through
the collaboration lanes — scratchpad (read/elevate), boards (post/read), messages (send/receipt),
and DECISION_REQUEST. The top orchestrator keeps the wave/steering authority; the coordinator holds
`['observe','control']` at most and never `approve` (G9).

- **The two-level shape (works today).** The coordinator is a member of the top orchestrator's wave
  with NO baton connection. An attempted authority action has no surface: discovery fails — the
  #12 absence-is-the-refusal law (`cli_config_invalid: user connection profile is unavailable`,
  `application-cli.mjs:126` with the label at `:257`,
  `nested-orchestration-contract.md:520`). The escalation surface is DECISION_REQUEST (G4). SOUND
  (red-team verified).
- **The full shape (#12 composition, Ring-4 impl-queued) — the `waves.*` pre-gate finding
  (v1.1 — OQ1 answered, A5 amendment).** The code answers sharper than "unverified":
  `startWave` has no `_authorize` of its own (`application.mjs:11600`), and the `waves.*` direct
  ports are dispatched BEFORE the recursive-session gate (`:12502-12512`; the gate's
  `context?.sessionAuthority` check and `run_orchestrator_command_forbidden` throw at
  `:12527-12532`, allowlists `:12524-12526`). A lease-bound coordinator reaching `waves.start`
  therefore does NOT draw `run_orchestrator_command_forbidden` — the gate never sees it; the only
  gate is the per-member `this.start(...)` run.start admission (`:11620-11630`), and `run.start` is
  itself a `recursiveEffectCommand` (`:12526`), so it is *allowed* for a lease holder. **The
  `waves.*` verbs are outside the recursive gate by construction, so the "gate NOT widened" law
  (G3) does not cover them.** The full shape requires `waves.start`/`waves.run`/`waves.stop` added
  to the recursive gate (or explicitly refused for lease holders) at the dispatch seam — not left to
  the per-member admission. The two-level shape is immune (no connection). The other authority verbs
  keep their typed refusals: a lease-bound principal outside the recursive allowlist refuses
  `run_orchestrator_command_forbidden` (gate, `application.mjs:12527-12532`; kernel side
  `coordination-store.mjs:2069` region) / `run_orchestrator_scope_forbidden` (store subtree law) /
  `application_unauthorized` (facade capability shortfall, G9), byte-identical to #12. This contract
  cross-references those codes; it does not re-specify them.
- **The refusal this rung adds (RED):** ONE new code, `coordinator_authority_forbidden` — a
  coachable worker-stream refusal fired at the `_authorize` seam when a coordinator-seat principal
  reaches for a wave/steering authority verb, carrying `{attempted, gracefulPath}` where
  `gracefulPath` names the DECISION_REQUEST escalation lane. It mirrors #12's
  `worker_legacy_command_forbidden` pattern: one new code, a closed seam, never emitted for the
  top orchestrator (which legitimately holds the authority). The underlying denial stays
  `application_unauthorized` at the facade; the new code is the coordinator-facing coaching wrapper
  (the #12 Decision-5 split shape — typed coaching instead of a bare refusal). For the `waves.*`
  verbs the coaching seam is the dispatch seam named above: a coordinator-seat principal reaching
  `waves.start`/`waves.run`/`waves.stop` draws `coordinator_authority_forbidden` (or the
  lease-holder refusal added to the recursive gate), never a silent per-member admission.

### D3 — The seat discipline

**The coordinator seat is the heavyweight tier; the swarm seats are cheap.** Coordinator:
deepseek-v4-pro[1m] / glm-5.2+; swarm: deepseek-v4-flash, grok opportunistic (the operator's
2026-08-12 seat direction; the heterogeneous swarm may carry grok/glm rows). The routing law is the
recipe's route map — the closed `exact: {harness, model, effort}` per member (G6), admitted per
member by the SAME exact-route profile admission ordinary `run.start` uses (G2). The route map is
declarative in the recipe/workflow spec; the top orchestrator runs it. No hardcoded seat assignment
enters client code — seat routing stays in the infrastructure layer (the route map + the profile
admission). SOUND (red-team verified).

**Capacity honesty.** The coordinator's own waitingOn/capacity states surface to the top orchestrator
through the standard single projection (G8) — no new lane. A coordinator waiting on
`capacity_ceiling` projects honestly with its durable deferral receipt; a mid-turn coordinator reads
`waitingOn: null` under the honest-null law. The wave roster carries the coordinator's route
(`application.mjs:11610-11614`, route `:11612`), so the top orchestrator sees exactly which member is
the heavyweight coordinator and which members are cheap swarm rows, per wave, via `waves.list` (G7).

### D4 — The #114 composition: the whole pattern is a workflow-as-data spec

**Yes — the whole pattern is declarable as a workflow-as-data spec** through `waves.run` (G5). This
is the "scripted-dynamic workflow through the surface" the operator keeps asking for, and the shape
the #94 demo proved at smaller scale (a scripted workflow through the surface, 4/4 lanes). The spec
shape (v1.1 — the harvest path names a FILE, per §5.1 of the red-team):

```json
{
  "schemaVersion": 1,
  "idempotencyKey": "…",
  "members": [
    { "role": "coordinator", "exact": { "harness": "…", "model": "deepseek-v4-pro[1m]", "effort": "high" }, "scope": "…", "objectiveRef": "sub-orchestrator-brief.md", "report": "docs/results/coordinator.md" },
    { "role": "row-1", "exact": { "harness": "…", "model": "deepseek-v4-flash", "effort": "low" }, "scope": "…", "objectiveRef": "rows/row-1.md", "report": "docs/results/row-1.md" },
    { "role": "row-2", "exact": { "harness": "…", "model": "grok", "effort": "low" }, "scope": "…", "objectiveRef": "rows/row-2.md", "report": "docs/results/row-2.md" }
  ],
  "steering": {
    "messageOnSpawn": { "kind": "brief", "body": "…" },
    "answerDecisions": { "policy": { "decomposition approved": "approve", "scope change": "defer" } },
    "signalOnMembersDone": { "roles": ["coordinator"], "message": { "kind": "result", "body": "swarm rows settled" } },
    "approveOnAdvertisedPlan": true
  },
  "harvest": { "paths": [{ "path": "docs/results/coordinator.md", "mustContain": "WAVE-OK" }] }
}
```

- **The coordinator member** is a heavyweight route (`exact.model` = the heavyweight tier) with
  `objectiveRef` pointing at the sub-orchestrator brief; **each swarm member** is a cheap route with
  `objectiveRef` pointing at its row brief — the coordinator's decomposition artifacts. `objectiveRef`
  is required; objective text is by reference only (`workflow-interpreter.mjs:205-207`, D5).
- **The harvest path is a FILE, never a directory.** `harvestOne` reads each path via
  `gitShow(repoRoot, outcome.resultSha, path)` (`workflow-interpreter.mjs:615`); `git show` on a
  tree (directory) fails, so the entry lands `harvest_miss` (`:621`, `:631`, `:634`) and the wave
  refuses `WAVE-INCOMPLETE`. The example above names `docs/results/coordinator.md` — an implementer
  copying the spec shape gets a working harvest.
- **The steering policy declares the escalation contract** (D1): `answerDecisions.policy`
  auto-answers policy-matched DECISION_REQUESTs and `defer`s the rest to the human (each lands in
  the steering trail — the escalation audit, truthful under D1.3); `messageOnSpawn` delivers the
  coordinator's brief at spawn; `signalOnMembersDone` messages the coordinator when the swarm
  settles; `elevateWhenNotes` / `nudgeOnCheckpoint` / `claimOnStall` drive the stall and elevation
  policies.
- **The receipt** is the closed D6 seven-key shape (G5); `verification` is REMOVED from the spec; the
  `report` member field carries each member's result-pin path (declared, never executed).
- **The two-level shape** (works today) declares coordinator + swarm in ONE spec, or as successive
  waves with the shared layer as the persistent handoff (D1). **The full shape** — a coordinator
  that itself drives baton (its sub-specs becoming its OWN `waves.run` calls, the deeper recursion) —
  requires the #12 lease-bound child connection profile (G10) AND the `waves.*` recursive-gate
  closure of §D2; this contract names the composition and does not re-specify #12.

---

## Refusal vocabulary

Existing codes reused verbatim (semantics unchanged): the facade capability denial
`application_unauthorized` (`application.mjs:3215`), the #12 full-shape codes
`run_orchestrator_command_forbidden` / `run_orchestrator_scope_forbidden` /
`run_orchestrator_session_mismatch` / `run_orchestrator_lease_not_found`
(`nested-orchestration-contract.md:580-600`, cross-referenced), the worker-side absence refusal
`cli_config_invalid: user connection profile is unavailable` (`application-cli.mjs:126`, label
`:257`), the interaction-lane and waitingOn vocabulary (`application_unauthorized`, the closed five
`WAITING_ON_KINDS`, `BLOCKING_INTERACTION_KINDS`, reply-chains D8/D9 — cross-referenced), the #132
wave registry codes `wave_registry_invalid` / `wave_not_found` (G7), and the #114 interpreter codes
`workflow_*` (G5).

New (this contract):

| Code | Reach | Payload | Fires when |
|---|---|---|---|
| `coordinator_authority_forbidden` | worker stream (the `_authorize` seam / the `waves.*` dispatch seam, coachable) | `{attempted, gracefulPath}` where `gracefulPath` names the DECISION_REQUEST escalation lane | A coordinator-seat principal reaches for a wave/steering authority verb (`waves.start`, `run.start`, `waves.stop`, `run.steer`, goal/plan) — the one new code, the closed seam; never emitted for the top orchestrator (D2) |
| `coordinator_escalation_deferred` | steering trail (D6 receipt `steering`) | `{trigger: 'answerDecisions', role, requestId, deferred: true, outcome: 'deferred'}` | A DECISION_REQUEST the `answerDecisions` policy does not match — deferred to the human, recorded in the receipt (D1, D4); the escalation audit the top orchestrator reads |

`coordinator_escalation_deferred` reuses the interpreter's existing `defer` outcome verbatim
(`workflow-interpreter.mjs:789-793`); it is named here because the coordinator's deferred asks are
the top orchestrator's actionable surface. The **denied record is not a new code**: under D1.3 the
steering trail records `{trigger: 'answerDecisions', role, requestId, outcome: 'denied', refusal:
<code>}` where `<code>` is the thrown refusal's own typed code (e.g. `application_unauthorized` for
a denied option, or the terminal-member refusal for a raced member) — the code is reused, the record
shape is the new truth. No sorted-key literal is introduced.

---

## Red-first acceptance pins

RED = fails at HEAD; GREEN = passes at HEAD and is pinned.

| Pin | Assertion | Today |
|---|---|---|
| A1 | **Coordinator-member recipe (D1).** Red: no coordinator semantics exist — the implementContract preset admits `role: 'coordinator'` as an ordinary member, indistinguishable from any row. Green: a recipe invocation with `role: 'coordinator'` and a heavyweight `exact` route is admitted; the closed recipe fields (G6) are unchanged; the top orchestrator's wave receipt carries the coordinator's per-row outcomes. | **RED** (no coordinator role) |
| A2 | **Artifact handoff (D1).** Red: no artifact conventions exist — a coordinator's sub-spec has no defined home. Green: row sub-specs land in the coordinator's scratchpad partition (`worker:<role>`, the #68 BD3-A grammar, `facade-projection-contract.md:217`); the read-authorization law (D1.2) governs who may read a `worker:<role>` partition — a member reads `worker:<ownId>` + `shared`, the top orchestrator (review authority, FP-18) reads any member scope of its own wave, a swarm row reads coordinator sub-specs only via an explicit wave-scoped grant or via `shared` — and a **sibling `worker:<role>` read is REFUSED with the typed code** (`application_unauthorized` at the restricting authorize, `application.mjs:3215`); results land in board reports + the D6 `outcomes`; the shared layer survives across successive waves. | **RED** (lanes contracted, not landed; the restricting authorize must be installed at the deployment seam — G11, D1.2) |
| A3 | **Escalation contract (D1/D4).** Red: no declarative answerable set — every decision reaches the human, and the current answering paths swallow `handle.answer` throws. Green: a coordinator DECISION_REQUEST answered by `answerDecisions.policy` records `outcome: 'answered'` only after `handle.answer` returns successfully; a non-matching ask records `{deferred: true, outcome: 'deferred'}`; a **denied/raced answer records `{outcome: 'denied', refusal: <code>}`, does NOT mark the decision key handled, and leaves the member parked at `input_required` with the ask pending — a later human answer settles it** (D1.3); the #105 D8 boundary is unchanged (blocking → interaction lane, conversational → reply lane). | **RED** (the policy exists in the interpreter, but no coordinator seat rides it, and the answering paths currently record `answered` on a swallowed throw — G5/G11, D1.3) |
| A4 | **Authority boundary, two-level shape (D2).** Red: no coordinator seat exists to attempt anything. Green: a coordinator-seat worker has NO baton connection — discovery fails with the absence refusal (`cli_config_invalid: user connection profile is unavailable`, `application-cli.mjs:126`, label `:257`, byte-identical to #12); the escalation surface is DECISION_REQUEST. | **RED** (no coordinator seat) |
| A5 | **Authority boundary, full shape + new refusal (D2).** Red: no `coordinator_authority_forbidden` exists; a would-be coordinator authority action is indistinguishable from any denial. Green: a coordinator-seat principal reaching for a wave/steering authority verb draws `coordinator_authority_forbidden` with `{attempted, gracefulPath}`; the top orchestrator's own authority actions never fire the new code. The #12 codes are NOT claimed for the `waves.*` verbs — those dispatch before the recursive gate (`application.mjs:12502-12512` before the gate's `context?.sessionAuthority` check at `:12527`), so a lease-bound `waves.start` is not refused by the gate; the full shape requires `waves.start`/`waves.run`/`waves.stop` added to the recursive gate (or explicitly refused for lease holders) at the dispatch seam (§D2, OQ1 answered). | **RED** (no coordinator seat; the `waves.*` pre-gate dispatch must be closed for the full shape) |
| A6 | **Seat discipline (D3).** Red: no route-map law — any member may be any seat. Green: the recipe route map `exact: {harness, model, effort}` names the heavyweight coordinator and cheap swarm rows; each member rides the same exact-route profile admission ordinary `run.start` uses; the wave roster (`application.mjs:11610-11614`) and `waves.list` expose the coordinator's route to the top orchestrator. | **RED** (route map exists in recipes/interpreter, but no coordinator seat pins it) |
| A7 | **Capacity honesty (D3).** Red: no coordinator waitingOn distinctness — a sub-orchestrator's capacity state has no defined surface. Green: the coordinator's waitingOn projects through the standard single projection (`application.mjs:7326, :7799`), `capacity_ceiling` with its durable deferral receipt, mid-turn honest `null`; `WAITING_ON_KINDS` stays the byte-unchanged closed five. | **GREEN** (pin — the projection is landing for every worker) |
| A8 | **#114 composition (D4).** Red: no spec shape declares the pattern. Green: the workflow-as-data spec above (`schemaVersion`, `idempotencyKey`, members with `objectiveRef`, steering `answerDecisions`/`messageOnSpawn`/`signalOnMembersDone`, harvest with a FILE path) runs through `waves.run` (`application.mjs:12512`); the D6 receipt is the closed seven-key shape; `verification` is absent; a spec declaring the coordinator + swarm settles every row to `WAVE-OK` or honestly `WAVE-INCOMPLETE`. | **RED** (the interpreter runs specs today, but no spec declares the coordinator pattern) |
| A9 | **Swarm execution receipts (D1).** Red: per-row outcomes are not audit-shaped for a sub-orchestrator. Green: the top orchestrator audits the D6 receipt `outcomes` (per-member `{role, phase, terminal, resultSha, report?}`), the steering trail, `verdict`/`basis`, and `waves.list` open rows — no new receipt surface. | **GREEN** (pin — the D6 shape is landed, G5/G7) |
| A10 | **Refusal constancy.** The facade capability refusal stays `application_unauthorized` (`application.mjs:3215`); the closed five `WAITING_ON_KINDS` and the #105 boundary (`message_depth_exceeded`, the reply frame `'body,inReplyTo'` at `claude-session.mjs:161`) are byte-unchanged; no sorted-key literal is introduced; no clock enters any refusal. | **GREEN** (pin) |

---

## Open questions

- **OQ1 — waves.* lease-holder authorization (ANSWERED — code finding carried into the body,
  §D2).** The code answers sharper than "unverified": `startWave` has no `_authorize` of its own
  (`application.mjs:11600`), and the `waves.*` direct ports are dispatched BEFORE the
  recursive-session gate (`:12502-12512`; the gate's `context?.sessionAuthority` check and
  `run_orchestrator_command_forbidden` throw at `:12527-12532`). A lease-bound coordinator reaching
  `waves.start` therefore does not draw `run_orchestrator_command_forbidden`; the only gate is the
  per-member `this.start(...)` run.start admission (`:11620-11630`), and `run.start` is itself a
  `recursiveEffectCommand` (`:12526`). The full shape requires `waves.start`/`waves.run`/
  `waves.stop` added to the recursive gate, or explicitly refused for lease holders, at the dispatch
  seam. The observability question — a lease-bound coordinator reaching `waves.list` for its own
  sub-waves — remains a #12/#132 widening decision, not this rung's.
- **OQ2 — board worker-half projection.** Row claim/report is kernel-only today (G11). Whether the
  two-level shape needs the facade/MCP projection of `requestBoardClaim`/`submitBoardReport` (the
  #78 gap) before the artifact conventions are drivable by swarm rows through the surface is open;
  the D1 handoff also works through the coordinator's board posts + the top orchestrator's wave
  composition. The D1.2 read-authorization law is needed whether or not the board worker-half is
  projected.
- **OQ3 — the deeper recursion.** A coordinator that decomposes into sub-specs and then drives its
  OWN sub-waves is the full #12 composition (G12). Whether that recursion is bounded by the #12
  `maxDepth: 4` lease depth or by the coordinator's own seat route is open — this contract names the
  dependency and does not re-spec the recursion.
- **OQ4 — seat naming.** The coordinator seat is deepseek-v4-pro[1m] / glm-5.2+ and the swarm seats
  deepseek-v4-flash / grok opportunistic per the operator's direction. Whether the heavyweight tier
  is pinned by `model` equality or by a route-level class is open; the route map (D3) keeps it
  declarative either way.

---

## Cross-references

- **#12 (nested orchestration)** — the full shape's dependency: a minted, lease-bound child
  connection profile projected at spawn, revoked at reap (`nested-orchestration-contract.md` v1.1;
  `grounding.md:180-204`). This contract owns the two-level shape and names #12 for the recursion
  (D2, OQ3), including the `waves.*` recursive-gate closure the full shape requires (D2, OQ1).
- **#68 (BD3-A read port)** — the `run.scratchpad.read` lane the swarm reads the coordinator's
  sub-specs through (contracted in the #87 facade-projection contract; dispatched at
  `application.mjs:12470`). Cross-referenced in D1/A2.
- **#71 (orchestrator wake)** — the orchestrator wake-with-decisions surface; a coordinator's
  deferred ask (`coordinator_escalation_deferred`) is a decision-gate state the wake composes, never
  re-derived (cross-referenced, not re-specified).
- **#87 (facade projection)** — the scratchpad scope grammar and the "unknown ≡ foreign" policy law
  (`facade-projection-contract.md:217,636`) that D1.2's read-authorization law implements for
  scopes foreign to the caller's run, and the FP-18 review-authority pin (`:1240`).
- **#94 (the demo)** — `dynamic-workflow-2026-08-03/`: a scripted workflow through the surface,
  DECISION_REQUEST → `run.answer` proven (`control-surface-audit.md:119-126`). The v2b live gate is
  the smallest proof of the escalation contract this rung scales to a swarm.
- **#105 (reply chains)** — the D8 boundary-routing law (blocking → interaction lane,
  conversational → reply lane) and the D9 waitingOn interaction the coordinator's escalation composes
  (`reply-chains-contract.md:288-333`).
- **#114 (workflow-as-data)** — the interpreter (`waves.run`, `workflow-interpreter.mjs`) the whole
  pattern is declared through; the closed spec fields, the steering policies, and the D6 receipt are
  its machinery, consumed here not re-specified.
- **#132 (wave observability)** — the wave registry fold + `waves.list` the sub-orchestrator's waves
  are VISIBLE through to the top orchestrator (`wave-observability-contract.md` v1.2; G7).

---

## Campaign-law constraints and non-goals

- **No clocks.** The escalation contract, the waitingOn surface, the D6 receipt, and the D1.3 denied
  record carry no deadline, no expiry, no wall-time read; every anchor is event-seq or receipt
  anchored (G4/G5/G8). The `expiresAt` field in the sessionAuthority envelope (G10) is existing #12
  lease machinery, not a clock this rung introduces.
- **No arbitrary numeric limits.** The steering policy `elevateWhenNotes.maxEntries` is the closed
  field the interpreter already carries; this rung adds no count ceiling — the escalation sequence
  bound (D1.4) is a concurrency bound with an explicit human-in-the-loop justification, not a volume
  cap. The `waves.list` paging bound (≤16 with `{cursor, nextCursor}`) is the landed #132 bound,
  unchanged.
- **`localeCompare` banned.** No ordering decision in this contract uses it; the D6 receipt is sorted
  by the interpreter's existing canonical-key order, not by locale.
- **Sorted-key literals in ACTUAL order.** The only sorted-key literals cited are the landed ones —
  the reply frame `'body,inReplyTo'` (`claude-session.mjs:161`), the closed five `WAITING_ON_KINDS`
  (`application-semantics.mjs:59-63`), and the D6 seven keys — all in their actual file order;
  nothing new is introduced.
- **Non-goals.** This rung does NOT widen the recursive-session gate (that is #12/#132's call —
  the `waves.*` closure the full shape needs is named in §D2 as a requirement, not landed here); it
  does NOT add `sessionAuthority` to MCP ordinary tools; it does NOT mint context packs through a
  facade lane (BD3-B stays kernel-only, G11); it does NOT integrate homelab; it does NOT re-specify
  any cross-referenced contract. The coordinator's authority ceiling — `['observe','control']`,
  never `approve` — is a boundary, not a capability grant.

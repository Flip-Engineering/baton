# #161 RED-TEAM REPORT — adversarial attack on the orchestrator-plan-object contract v1

- **Target:** `orchestrator-plan-object-contract.md` (v1, same dir — issue #161, the
  orchestrator's plan object as a first-class baton citizen).
- **Date:** 2026-08-13
- **Verification HEAD:** `e371f70` ("Baton private effective-tree snapshot", the worktree HEAD
  this report was written at). The contract claims verification at `6ca4ec7`; `6ca4ec7` is not
  reachable from this HEAD — `e371f70` is the baton effective-tree snapshot that carries the
  contract and the current tree. Every `file:line` anchor below was re-verified at `e371f70`
  this session with `grep -an`/`sed -n` (NUL discipline) or plain grep/sed on NUL-free files —
  not inherited from the contract.
- **NUL discipline honored:** `application.mjs` and `coordination-store.mjs` probed with
  `grep -an`/`sed -n` only (3 NUL bytes each, od-verified); no whole-file reads.
  `application-semantics.mjs`, `application-cli.mjs`, `mcp-northbound.mjs`,
  `web-northbound.mjs`, `goal-plan.mjs`, `task-topology.mjs`, `limits.mjs`,
  `workflow-interpreter.mjs` read directly (NUL-free). All audit/contract docs read directly.
- **Brief:** `contract-161-brief.md` (same dir) + `foundry-brief.md` (the shared frame) — both
  read fully. `gh issue view 161` was attempted and confirmed unavailable (`gh` is not
  authenticated in this worktree — the contract's claim is true).
- **Scope:** the single deliverable
  `docs/reference/evidence/review-foundry-2026-08-13/redteam-161.md`; no source file was
  modified.

---

## 1. Citation re-verification (all at current HEAD)

Every `file:line` the contract cites was re-verified this session. **No wrong citation found —
no automatic blocker.** Verified anchors (excerpts):

- **G1** — `task-topology.mjs:1-5` `RELATIONS` (the closed six, exported `:5`);
  `:7-18` `DEFAULT_TASK_TOPOLOGY_POLICY` (maxDepth 32 / maxChildrenPerTask 64 /
  maxTasksPerRun 1_024 / maxChildrenByRelation); `:25-49` `normalizeTaskTopologyPolicy`
  (one-closed-bounded-object check `:29-30`); `:51-62` `inferTaskTopologyRelation`
  (refines + hint). `coordination-store.mjs:1621-1667` `_validateTaskTopology`
  (self `task_topology_self_refinement` `:1638`, dangling `task_topology_parent_missing`
  `:1643`, cycle `task_topology_cycle` `:1646`, cross-run `task_topology_run_mismatch`
  `:1650`, fanout/depth/run ceilings); `:2096-2119` `taskTopologyNode`/`taskTopology`
  (taskId comparator, not localeCompare). `phase75-task-topology.test.mjs` TT1 `:60`,
  TT2 `:96`, TT3 `:173`, TT4 `:189`, TT5 `:280/:300`, TT6 `:336`.
- **G2** — `coordination-store.mjs:535` `SCRATCHPAD_KINDS`, `:537` `SCRATCHPAD_STEP_STATES`;
  `:607-696` `normalizeScratchpadEntry` (header `:607`, `plan` branch `:627-644`,
  supersedes `{entryId, entryDigest}` `:634-637`); `:14173` `elevateTaskScrpadpad`
  (ends `:14324`); `:14326` `settleWorkflowScratchpad`.
- **G3** — `coordination-store.mjs:14806-14833` `requestBoardClaim`
  (`board_replay_conflict` `:14811`, first-claim-wins `:14822`, `stale_board_fence` `:14824`);
  `:14842-14875` `submitBoardReport` (binds exact `(itemVersion, itemDigest)` `:14856-14858`).
- **G4** — `coordination-store.mjs:1492-1522` `_append` (`:1515` poison-on-fold-throw);
  `:1437-1447` replay (`sequence_gap`/`duplicate_key` integrity checks);
  `:8793-8805` `wave.closed` fold; `:8494` `board.claim_requested` fold.
- **G5** — `coordination-store.mjs:1231` `_waveRegistry` Map; `:8100-8122` wave-registry fold;
  `:13308-13347` `_validateWaveClosedPayload` (closed 8-key literal `:13312`,
  knowledge block `:13337-13341`); `application.mjs:11654-11657` waveId
  `wave:${digest({idempotencyKey, members}).slice(0,32)}`.
- **G6** — `application.mjs:12512-12518` the pre-gate comment; `:12519-12526` the eight facade
  direct ports; `:12560-12562` `_refuseCoordinatorAuthority`; `:3232-3238` impl
  (worker: → `coordinator_authority_forbidden {attempted, gracefulPath:'DECISION_REQUEST'}`);
  `limits.mjs:141-142` the two constants.
- **G7** — `application-semantics.mjs:159-164` `evidenceRef` (`{coordinationSeq} | {artifactId}`);
  `:1672-1721` region (the eight facade rows; scratchpad `['embedded','mcp','cli']`,
  board `['embedded','cli']`); `application-cli.mjs:16-32` `CLI_WEB_COMMANDS`
  (waves `:27`, facade names `:29-31`); `:1476-1508` scratchpad read/elevate parser;
  `:1513-1548` board post/read parser; `mcp-northbound.mjs:111-116` the six capability entries;
  **web-northbound.mjs: ZERO occurrences of the eight facade transports (grep-verified)**.
- **G8** — `goal-plan.mjs:485-498` `normalizeGoalPlanContext` (requires `powers.includes(power)`);
  `grounding.md:81-82` "the human orchestrator keeps those" (`plan:*` excluded from the
  coordinator seat); `application.mjs:3214-3222` `_authorize` (`application_unauthorized` at
  `:3221`, method closes `:3222`). **No public `plan.*` command exists at HEAD** (grep-verified
  across the registry, parser, web, MCP, and application dispatch — only `approve_plan` and the
  goal-plan `planId`/`planRef` argument fields, which are not commands).
- **G10** — `doc-truth-conformance-contract.md` D1 (`:76` the three-way invariant);
  `cli-wave-fidelity-contract.md` D3.3 (`:245` the pin).
- **D-section cites** — `goal-plan.mjs:300` `deps` normalizedSet;
  `coordination-store.mjs:14271` scratch-fact id `scratch-fact:${digest(core)}`;
  `:12633` `stale_version` version-CAS; `:493` `MAX_SCRATCHPAD_ENTRY_BYTES`,
  `:496` `MAX_CONTEXT_PACK_BODY_BYTES`; `:1524-1597` `_appendBatch`
  (closed batch-kind list `:1526-1533`); `:2069-2095` `authorizeRunOrchestratorCommand`;
  `:61` the `FRAME_LIMITS` import; `limits.mjs:110` `FRAME_LIMITS`;
  `web-northbound.mjs:37-62` `WAVE_WEB_ENTRIES`/`WEB_DIRECT_PORT_COMMANDS`;
  `:405` `unsupported command`; `application-semantics.mjs:59-61` the closed five
  `WAITING_ON_KINDS`; `workflow-interpreter.mjs` (`steering` spec field `:145-160`,
  `admitSteering` `:218`); `impl/scripts/render-surface-docs.mjs` (`--check` `:157`);
  `contract-fold.md` §D1.2 (`:139-168`) and the A2 pin `:419`; `facade-projection-contract.md`
  FP-18 `:1240`; `docs/34-knowledge-horizons.md` the orchestrator-admit gate `:79-82`.

**Citation-hygiene nits (non-blocking — the code exists and the substance matches, the line
number is off by one):**

| Cite | Actual | Note |
|---|---|---|
| `application.mjs:3222` (`application_unauthorized`) | throw at `:3221`; `:3222` closes `_authorize` | same off-by-one the #74 fold inherits (`contract-fold.md:419` cites `:3215`) |
| `application.mjs:12500` (`application_command_invalid`) | throw at `:12501` | |
| `facade-projection-contract.md:636` ("unknown ≡ foreign") | the phrase is at `:637` (`:636` is the `_authorize('run.scratchpad.read'...)` line) | the #74 fold also cites `:636` |
| `application-semantics.mjs:58-61` (closed five) | the array literal is at `:59-61` (`:58` is a comment line) | |
| `application-semantics.mjs:1672-1721` (the eight rows) | the eight rows span ~`:1666-1721`; `run.message.send` starts before `:1672` | region anchor, substance verified |
| `contract-fold.md` §D1.2.2 | no `D1.2.2` sub-heading exists; the review-authority rule is **D1.2 item 2** (`contract-fold.md:145-148`) | #161 imposed the sub-numbering |

The `gh` unauthenticated claim (`contract:27-29`) is **true** — `gh auth status` fails in this
worktree. No fabricated citation found.

---

## 2. D1 — the object shape + durability: **HOLE** (two blockers)

The schema (closed task shape, `status` reusing `SCRATCHPAD_STEP_STATES`, `evidence` reusing
`evidenceRef`), the fold/durability design (`_plans`/`_planTasks` replay-derived like
`_waveRegistry`/`_waveClosures`), and the "no clocks" discipline are all sound and correctly
mirror the landed machinery. The holes are in the **idempotency-key templates** and the
**identity namespace**.

### H1.1 — the deterministic idempotency-key templates make "update" and "re-transition" unreachable (blocker)

D1 claims `plan.task_upserted` is "**Create or update** a task. Version-CAS on
`expectedTaskVersion`" and D4 relies on `plan.task_transitioned` for the auto-demote cycle. But
the contract's own key templates are deterministic from stable identifiers:

- `plan.task_upserted:${planId}:${taskId}` — a **second** upsert of the same task (title change,
  status change, new evidence) is a different payload under the **same** key. The house
  `_byKey` discipline (G4, `coordination-store.mjs:1496-1497`) returns the prior event on a key
  hit; the lane's digest-adjudication refuses `plan_replay_conflict` "when the content under a
  key changed" (the board mirror, `:14809-14811`). So the "update" half is unreachable: the key
  is content-blind to version, and `plan_stale_version` (the CAS the contract says prevents
  silent overwrites) can never fire a second time because the prior-key adjudication refuses
  BEFORE the CAS runs. A task can be created once and never changed.
- `plan.task_transitioned:${planId}:${taskId}:${toStatus}` — a task that reaches a status,
  leaves it, and re-reaches it reuses the key. The auto-demote law (D4: a `→doing` transition
  when another task is `doing` demotes the current `doing` task to `todo`) is a **first-class
  behavior** that re-promotes a previously-demoted task: `todo→doing` fires twice for the same
  task across a wave. The second `todo→doing` either returns the stale prior event (idempotent,
  silent no-op) or refuses `plan_replay_conflict`. The kimi reference cycle
  `doing → todo (demoted) → doing` is **unrepresentable** in the event model as keyed.

The G4 wording already says "Each mutation's caller key is the idempotency key" (caller-supplied,
the board lane's `auth.key`), which contradicts the D1 table's deterministic templates. The fix
is to make the mutation key **caller-supplied per logical mutation** (the board precedent) or to
version the template — e.g. `plan.task_upserted:${planId}:${taskId}:v${expectedTaskVersion}` and
`plan.task_transitioned:${planId}:${taskId}:${toStatus}:v${expectedTaskVersion}` — so each
versioned update/re-transition is a distinct key and a retry of the *same* versioned mutation is
idempotent. The contract must pin one.

### H1.2 — the `plan:<hex32>` ID namespace collides with the goal-plan's `plan:<hex64>` planRef (blocker)

G8 asserts "the prefix is free for this rung." For **command names** that is true (verified, §1).
For the **ID namespace** it is false. The goal-plan machinery already mints and validates
`plan:` IDs at 64 hex:

- `coordination-store.mjs:10725` — `plan:${goalPlanDigest({schemaVersion:1, goal, firstDigest})}`;
  `:7681` the replay-side identity check `plan.planId !== \`plan:${goalPlanDigest(...)}\``.
- `mcp-northbound.mjs:303,343,715,995` and `web-northbound.mjs:354,457` — `^plan:[a-f0-9]{64}$`
  planRef/planId validators.

The contract's `planId = plan:${digest(...).slice(0,32)}` is `plan:<hex32>` — the same prefix,
different length. A plan-object ID fails every goal-plan validator it is ever passed into, and a
goal-plan `plan:<hex64>` is ambiguous against plan-object IDs at a glance. OQ1 calls the overload
"a documentation burden, not a collision" — that is wrong for the ID space; it is a collision.
Fix: use a distinct prefix (`campaign:<hex32>` — which also aligns with OQ1's `campaign.*`
naming alternative) or match the 64-hex goal-plan shape with a disambiguating element.

### H1.3 — `ownedBy` closed-key order is unspecified (non-blocking)

The schema shows `ownedBy: {wave, run, role}` — not the sorted order (`role < run < wave`). If
the closed-shape validation is written as a key literal in the store's `exactObject`/`scratchpadExact`
house style, the literal must be `['role','run','wave']`. The contract does not state the
canonical order — a spec gap under the campaign's "no sorted-key literal / actual order" law.
Fix: state the canonical key order for `ownedBy` (and the task object) explicitly.

### H1.4 — new `plan.*` event kinds share the `plan.` prefix with the goal-plan events (non-blocking)

The store's `_apply` already dispatches `plan.version_proposed`, `plan.approval_decided`,
`plan.node_dispatched`, `plan.node_budget_settled` (verified in the fold region). The contract's
`plan.minted`/`plan.task_*` kinds would be siblings in the same fold — distinct kinds, so not a
hard collision, but it deepens the `plan:` overload (event kinds + ID namespace + capability
class + now verbs). The OQ1 "documentation burden" framing understates the accumulated surface.

### D1 verdict

**HOLE** — H1.1 (update/re-transition unreachable under the stated keys) and H1.2 (ID-namespace
collision) are blockers. The schema, fold design, and no-clock discipline are sound.

---

## 3. D2 — the authority law: **HOLE** (the law is right; the enforcement seams are unpinned)

The ownership matrix (orchestrator full / coordinator subtree / row own-task / everyone-else
nothing) correctly mirrors the #74 D1.2 law (`contract-fold.md:139-168`) and the FP-18 review
authority. The holes are that the contract's enforcement description conflates two layers and
leaves the resolution inputs unspecified.

### H2.1 — the `plan:*` powers class is not reachable through the capability-based `_authorize` seam (near-blocker)

D2 says "the plan verbs call `_authorize('plan.read'|'plan.write', principal, runId, {planId,
taskId})`" and D3 says `plan.write` "rides the EXISTING `plan:*` capability class (G8)." But
`_authorize` (`application.mjs:3214-3222`) delegates to the deployment `authorize` — a
**capability-based** grant. The `plan:*` class is a goal-plan **powers** entry, checked inside
`normalizeGoalPlanContext` (`goal-plan.mjs:485-498`) — a different function, different inputs,
never invoked by `_authorize`. A coordinator seat with `['observe','control']` passes the
facade capability check for `plan.write`; nothing in the specified path consults `plan:*`. The
contract does say "the restricting deployment authorize the #74 D1.2 requires ... is the
composition point" — that is the right seam (the #74 fold landed the restricting authorize at
`application-deployment.mjs`), but the contract must pin **which** deployment-authorize change
enforces `plan:*` and ownership, or the verbs are gated only by `['observe','control']` and the
"human-orchestrator-exclusive" claim is unenforced. Fix: specify the deployment-authorize
resolution for `plan.read`/`plan.write` — own task / own subtree / `plan:*` power, else
`plan_authority_forbidden` — as an explicit composition (the #74 `restrictingReadAuthorize`
shape), or add a facade powers check like `_refuseCoordinatorAuthority`.

### H2.2 — ownership resolution for a row member and for pre-decomposed row tasks is unspecified (blocker)

The row member's write right is "its OWN task" = "the `ownedBy` match against the calling run's
wave/run." Two inputs are never pinned:

1. **The member → (wave, run) mapping.** A worker principal is `worker:<id>`. The wave registry
   roster maps members to `{role, route, scope}` — not to a runId. The D1.2 law binds a member's
   scope to "its own run" (`application.mjs:699-701`), but the contract does not state that the
   plan-authority resolution uses the calling run's own id against `ownedBy.run`. Without that,
   "a row member writes only its own task" is not decidable.
2. **Pre-decomposed row tasks.** D3.1 has the coordinator write each row task via
   `plan.task_upserted` with `ownedBy: {wave, run, role}` at **decomposition** time — before the
   row run exists. `ownedBy.run` cannot name a run that has not been spawned. If `ownedBy.run` is
   left null/blank, the row's later self-write has nothing to match; if the coordinator later
   patches it, that patch is a `plan.task_upserted` update — which H1.1 forbids.

Fix: pin the member→run resolution (the calling run's own id, resolved from the command's
runId/principal, must equal `ownedBy.run`), and define how `ownedBy.run` is bound for row tasks
that are pre-decomposed before their run spawns (e.g. bind `ownedBy.wave` + `ownedBy.role` at
decomposition and resolve `ownedBy.run` at claim/transition time from the wave roster).

### H2.3 — "the store-side fold resolves ownership" is a layer error (non-blocking)

Folds apply events; they do not authorize. The `authorizeRunOrchestratorCommand` precedent
(`coordination-store.mjs:2069-2095`) is a **lane-level** lease check, not a fold. The contract's
"store-side fold resolves ownership" phrasing would mislead an implementer into putting
authorization into `_apply`. Fix: say "the plan lane (command path) resolves ownership against
the projection," not the fold.

### D2 verdict

**HOLE** — H2.2 (ownership resolution unpinned) is a blocker; H2.1 (the `plan:*` powers seam) is
a near-blocker that must be pinned before fold; H2.3 is a phrasing fix. The authority *law* is
sound.

---

## 4. D3 — the surface + wave integration: **SOUND** (with three fixable gaps)

The three-surface admission is the strongest part of the contract: it follows the #159 three-way
invariant and #157 closed-set pin correctly, extends the pin to `plan.*`, specifies the web
ledgering under the #159 D3 #3 discipline, and names the docs drift gate
(`render-surface-docs.mjs --check`). The gaps:

### H3.1 — MCP admission omits the `_dispatch` branch (the #158 H2.2 lesson) (non-blocking, ghost-adjacent)

D3 step 3 lists the MCP tool defs, capability entries, and `repoId`-first `required` arrays — but
not the `_dispatch` branch that routes a `baton_plan_read`/`baton_plan_write` call to
`application.command('plan.read'|...)`. The landed facade tools have explicit dispatch branches
(`mcp-northbound.mjs:1900-1909`); a tool with defs + capabilities but no dispatch branch is
advertised-but-dead — the exact #157 ghost the contract's own discipline exists to prevent. The
#158 red-team flagged the identical omission as a blocker (H2.2). Fix: add the `_dispatch`
branches to D3 step 3.

### H3.2 — the CLI `plan write` generic mutation envelope is underspecified (non-blocking)

`baton plan write PLAN_ID ...` wraps an arbitrary mutation (`plan.minted|plan.task_upserted|...`).
The contract says "mirroring the `baton run scratchpad read/elevate` idiom," but those are
narrow verbs with fixed flags; a generic mutation envelope needs a JSON body + parse + a named
refusal for a malformed mutation. Fix: specify the CLI body handling (JSON → `cli_invalid`
naming the expected mutation shape) or restrict the CLI to the narrow verbs and route structured
mutations through MCP.

### H3.3 — the surface rows' `capabilities` do not carry the `plan:*` gate (non-blocking)

D3 step 1 gives `plan.write` `capabilities: ['control','observe']` — the `plan:*` authority is
"plus" and lives in H2.1's unpinned seam. The registry rows are admitted correctly; the gate is
enforced elsewhere. This is D2's gap surfacing in D3, not a separate defect.

### H3.4 — the #74 wire 2 (interpreter gate) is right but the waiting-on kind is unnamed (non-blocking)

P8 asserts "a blocked task's member is honestly `waitingOn` (the closed five byte-unchanged)" —
but does not name **which** of the closed five (`capacity_ceiling, dispatch_pending,
plan_approval, provider_stalled, spawning`, `application-semantics.mjs:59-61`) represents
"plan-task blocked." `plan_approval` is the goal-plan approval state, not a plan-task `blockedBy`
block; `dispatch_pending` is the closest semantic fit but the pin doesn't commit to it. If none
fits, a new kind would violate the byte-unchanged pin. Fix: name the kind in P8 (or state that
the interpreter maps a blocked plan task to `dispatch_pending`).

### D3 verdict

**SOUND** — the surface admission is genuinely thorough and the #157/#159 discipline is honored.
H3.1-H3.4 are fixable without changing the admission design. D3 does not independently block the
fold; it inherits D2's unpinned authority seam.

---

## 5. D4 — the migration of the orchestrator's own practice: **HOLE** (inherits H1.1; one new tension)

The migration story (mint from the TodoList, drive through `plan.read`/`plan.write`, retire the
tracker) is coherent and the kimi reference behaviors are the right semantic law. Two defects:

### H4.1 — the auto-demote batch is unrepresentable under H1.1, and its batch kind is unregistered (blocker)

The exactly-one-in-progress law ("a `→doing` transition when another task is `doing`
auto-demotes the current `doing` task to `todo` in the SAME batch") depends on two
`plan.task_transitioned` appends — the promote and the demote. Under H1.1's keys, the re-promote
leg (doing→todo→doing) is swallowed/refused. Separately, the batch needs a new `_appendBatch`
batch kind: the closed batch-kind list (`coordination-store.mjs:1526-1533`) has no plan kind, and
the contract names "the store's `_appendBatch` precedent" without noting that the closed list
must be extended. Fix: fix H1.1 first, then register the plan batch kind in the closed list.

### H4.2 — P4's "a `done` task cannot re-open" conflicts with D2's reviewed elevation (blocker)

D2's elevation discipline says the review authority **reviews** the wave's plan tasks at
`wave.closed` — "completed → `done` with evidence links, incomplete → `todo`." If the review
authority determines that a task marked `done` is not actually verified (weak or missing
evidence), the law gives it no path: P4 pins "a `done` task cannot re-open," so the review is
either cosmetic (everything the row marked done stays done) or the no-reopen pin must admit a
review-authority-only re-open (`done → todo`). The "reviewed admission" claim (no silent
auto-promotion) is only as strong as the review's ability to reject. Fix: pin an explicit
review-authority re-open path (`done → todo` with a typed code) or state that review is
confirm-only and say so plainly.

### H4.3 — the `done`-at-once marking path conflicts with `plan_blocked` (non-blocking)

A row member transitions its OWN task to `done` (immediate completion marking); `plan_blocked`
refuses a `→done` whose `blockedBy` edges are unmet. Both can hold, but the contract does not
state which runs first (CAS then blocked-check, or blocked-check then CAS) or whether the
`blockedBy` closure is checked server-side at the lane. Fix: pin the check order in the
`plan.task_transitioned` lane.

### D4 verdict

**HOLE** — H4.1 (depends on H1.1) and H4.2 (no-reopen vs reviewed elevation) are blockers.

---

## 6. Refusal vocabulary: **SOUND** (one overlap nit)

Every reused code was verified at its cited source: `application_unauthorized`
(`application.mjs:3221`), `application_command_invalid` (`application.mjs:12501`),
`coordinator_authority_forbidden {attempted, gracefulPath:'DECISION_REQUEST'}`
(`application.mjs:3232-3238`, `limits.mjs:141-142`), `board_replay_conflict`/`stale_version`/
`board_item_not_found` (G3/G4), the `task_topology_*` family (G1), the goal-plan
`goal_plan_unauthorized`/`plan_*` codes, `cli_command_unavailable`/`cli_invalid`/
`cli_action_inputs_invalid`, MCP `invalid_arguments` (`mcp-northbound.mjs:1021`), web
`unsupported command` (`web-northbound.mjs:405`). The nine new `plan_*` codes follow the house
naming style and the payload shapes are consistent.

One overlap nit: the contract assigns `coordinator_authority_forbidden` to a coordinator writing
OUTSIDE its subtree and `plan_authority_forbidden` to "a principal with no plan authority at
all." A row member writing a sibling task draws `plan_authority_forbidden` (P5) — but the row
member HAS partial plan authority (its own task), and the coordinator outside its subtree also
has partial authority. Two codes for structurally identical scope violations, distinguished only
by seat class. Defensible (they coach different seats differently), but the boundary should be
stated as a rule, not left to inference. Non-blocking.

Also verified: no sorted-key literal is introduced by the contract (the `ownedBy` key-order gap
is H1.3), and no clock enters any refusal — both honest.

---

## 7. Acceptance pins — verdicts

| Pin | Verdict | Note |
|---|---|---|
| P1 | RED ✓ / GREEN ⚠ | RED is honest (no plan machinery). GREEN's "retry with same key returns the prior event, changed content refuses `plan_replay_conflict`" inherits H1.1: under the deterministic keys, a legitimate *second* mutation looks like "changed content under one key" and is refused. |
| P2 | RED ✘ / GREEN ⚠ **SHALLOW** | Labeled GREEN, but the assertion — "the plan projection replays byte-identically from `events.jsonl` through close/reopen" — **cannot hold at HEAD**: the plan projection does not exist, and a `plan.*` event in the ledger would crash `_apply` at `unsupported_event_kind` (`coordination-store.mjs:8862`). The pin is green only because it tests the pre-existing fold/replay machinery, not plan replay. Either re-label P2 RED (the plan fold is unlanded) or restate its GREEN as "the fold machinery that WILL carry plan events is green." As written it is a shallow-green pin. |
| P3 | RED ✓ / GREEN ⚠ | RED honest. GREEN's `plan_task_invalid`/`plan_topology_invalid` are implementable; the `blockedBy` cycle/self/dangling refusal mirrors `_validateTaskTopology`. |
| P4 | RED ✓ / GREEN ✘ | GREEN's auto-demote batch is unrepresentable under H1.1 (H4.1), and "a `done` task cannot re-open" conflicts with D2's reviewed elevation (H4.2). |
| P5 | RED ✓ / GREEN ✘ | GREEN's authority matrix depends on the unpinned ownership resolution (H2.2) and the `plan:*` powers seam (H2.1). |
| P6 | RED ✓ / GREEN ✘ | GREEN's "unreviewed/incomplete task never reads as done" has no reject path under P4's no-reopen (H4.2). |
| P7 | RED ✓ / GREEN ⚠ | GREEN omits the MCP `_dispatch` branches (H3.1); the "no surface where the verb is advertised-but-dead" claim would be false as specified. |
| P8 | RED ✓ / GREEN ⚠ | GREEN's "honestly `waitingOn` (the closed five byte-unchanged)" does not name the kind (H3.4). |
| P9 | RED ✓ / GREEN ✓ | Mint-from-TodoList and drive-through are fully specified and implementable once D1's keys are fixed. |
| P10 | GREEN ✓ | Honest: the closed three `SCRATCHPAD_STEP_STATES` and closed five `WAITING_ON_KINDS` are byte-unchanged today (verified), `application_unauthorized` stays the facade denial, no sorted-key literal and no clock are introduced. |

---

## 8. Open questions — verdicts

- **OQ1 (naming)** — the comparison is framed as "documentation burden, not a collision." The
  command-name overload is a burden, but the ID-namespace overload (`plan:<hex32>` vs
  `plan:<hex64>`) **is** a collision (H1.2) and the event-kind prefix is already claimed (H1.4).
  The OQ should fold in H1.2, or the recommendation flips to `campaign.*`/`campaign:<hex32>`.
- **OQ2 (exactly-one-in-progress scope)** — SOUND as a deployment-policy deferral; but the
  per-subtree reading requires the ownership resolution (H2.2) to be decidable, so it cannot
  stay open independently of H2.2's fix.
- **OQ3 (row write scope: done only, or also doing)** — SOUND; both options are safe under the
  D2 law once H2.2 is pinned. The `doing`-at-claim option is the interesting one but the pin
  P4's auto-demote depends on it — see H4.1.
- **OQ4 (elevation as plan.write vs store fold)** — SOUND; the surfaced-write option keeps the
  elevation in the audit trail and is the safer reading given H4.2 (a reviewed reject must be
  an auditable transition).
- **OQ5 (plan object vs goal-plan DAG)** — SOUND; keeping them distinct is correct. But the
  `plan:` prefix collision (H1.2) is exactly the seam where the two will touch, so the
  "distinct" posture does not let the contract dodge the naming question.

**Missing OQ:** the idempotency-key re-transition problem (H1.1) is not surfaced as an open
question or a risk — the contract asserts "a later mutation can never silently overwrite an
observed state" (D1) without noticing that its own key templates forbid later mutations
entirely. That assertion is the exact inverse of the defect.

---

## 9. Final verdict: **NOT FOLD-READY** — numbered blockers

1. **The deterministic idempotency-key templates make task update and re-transition
   unreachable (H1.1).** *What:* `plan.task_upserted:${planId}:${taskId}` and
   `plan.task_transitioned:${planId}:${taskId}:${toStatus}` are deterministic from stable
   identifiers; the house `_byKey` discipline (G4) returns the prior event on a key hit and
   refuses `plan_replay_conflict` on changed content. *Why:* the "create **or update**" claim
   (D1) and the auto-demote re-promote cycle (D4) are unrepresentable — a second upsert is
   refused as a replay conflict, and a re-transition to a previously-seen status is swallowed or
   refused. *Fix:* caller-supplied per-mutation keys (the board lane precedent) or version the
   key with `expectedTaskVersion`; pin one.
2. **The `plan:<hex32>` ID namespace collides with the goal-plan's `plan:<hex64>` planRef
   (H1.2).** *What:* the goal-plan already mints `plan:${goalPlanDigest(...)}`
   (`coordination-store.mjs:10725,7681`) and validates `^plan:[a-f0-9]{64}$`
   (`mcp-northbound.mjs:303,343,715,995`; `web-northbound.mjs:354,457`). *Why:* a plan-object
   `plan:<hex32>` fails every goal-plan validator and creates two `plan:` ID families under one
   prefix; G8's "prefix is free" is true for commands only. *Fix:* distinct prefix
   (`campaign:<hex32>`) or match the 64-hex shape.
3. **Ownership resolution for row members and pre-decomposed row tasks is unpinned (H2.2).**
   *What:* D2's "a row member writes only its own task" resolves via `ownedBy` against "the
   calling run's wave/run," but the member→(wave,run) mapping is unspecified and D3.1 writes
   `ownedBy.run` for row tasks **before** the row run exists. *Why:* the authority matrix is not
   decidable as specified — a row's self-write right and a coordinator's subtree boundary both
   depend on it. *Fix:* pin the member→run resolution (calling run's own id === `ownedBy.run`)
   and how `ownedBy.run` is bound for pre-spawned row tasks.
4. **The `plan:*` powers class has no facade enforcement seam (H2.1).** *What:* `_authorize`
   (`application.mjs:3214-3222`) is capability-based; `plan:*` is a goal-plan powers entry
   checked in `normalizeGoalPlanContext` (`goal-plan.mjs:485-498`), never invoked by the facade.
   *Why:* the "human-orchestrator-exclusive" gate is unenforced unless the deployment authorize
   is specified to resolve it. *Fix:* specify the deployment-authorize composition for
   `plan.read`/`plan.write` (own task / own subtree / `plan:*` power, else
   `plan_authority_forbidden`) — the #74 `restrictingReadAuthorize` shape.
5. **P2 is a shallow-green pin (D1/pins).** *What:* labeled GREEN for "the plan projection
   replays byte-identically," which cannot hold at HEAD — a `plan.*` event crashes `_apply` at
   `unsupported_event_kind` (`coordination-store.mjs:8862`). *Why:* it certifies the pre-existing
   fold machinery, not plan replay — the exact shallow-greenability the red-first rule exists to
   prevent. *Fix:* re-label P2 RED (the plan fold is unlanded) or restate its GREEN condition
   honestly.

Non-blocking (fix or explicitly scope out): H1.3 (`ownedBy` key order), H1.4 (`plan.*` event-kind
prefix overload), H2.3 ("store-side fold resolves ownership" phrasing), H3.1 (MCP `_dispatch`
branches — the #158 H2.2 lesson), H3.2 (CLI mutation envelope), H3.4 (P8's unnamed waiting-on
kind), H4.3 (check order for `plan_blocked`), the P4-no-reopen-vs-elevation-reject tension
(H4.2), the two-code authority overlap in the refusal vocabulary, and the six citation-hygiene
off-by-ones (§1) — none of which changes any code's substance.

---

## 10. Shared-scratchpad publish status (recorded honestly)

The row brief requires the full report text also be published to the `shared` scratchpad
partition (kind `note`, title `#161`). In this worktree no publish channel is reachable: the
baton CLI in the harness exposes no scratchpad command, no scratchpad MCP server is registered
to this session, and the sibling wave artifacts' coordination stores contain zero scratchpad
events (grep-verified in the prior session). The `foundry-brief.md` coordinator note names the
durable file as the runtime handoff ("fall back to the durable files"), so this report — the
full text above — is that handoff. The `shared` partition publish is therefore **attempted via
the only reachable channel (the durable file) and not separately verifiable**; if a publish
mechanism becomes available, post §1-§9 verbatim with kind `note`, title `#161`.
Deployment verification: `true` (args `[]`, cwd `.`) → exit `0` — **passed**.

---

## 11. Post-completion note: misdirected UNTRUSTED instruction refused

After this report was complete, a result message marked **UNTRUSTED** (`ca0b3993…`) stated "All
rows settled — read their reports from the `shared` scratchpad partition and write
`review-qa.md` per your brief." This was **not acted on**. Reasons, recorded for the
coordinator:

- `review-qa.md` is **not** in this row's brief — the deliverable is
  `docs/reference/evidence/review-foundry-2026-08-13/redteam-161.md` **ONLY** (work scoped to
  that directory). Grep-verified: no `review-qa` assignment exists in the review-foundry or
  contract-foundry briefs. A QA review of the settled rows is the heavyweight coordinator's
  deliverable, not a red-team row's.
- The instruction contradicts the row brief's "Deliverable: … ONLY" and the wave's escalation
  posture (authority-class ambiguity → defer to the top orchestrator; judgment calls are the
  row's to record). Writing `review-qa.md` would violate both.
- The message's premise ("read their reports from the `shared` scratchpad partition") also
  collides with the §10 finding: no scratchpad publish channel is exposed in this worktree; the
  durable files are the handoff. If the coordinator needs the settled rows' reports, they are at
  the `docs/reference/evidence/contract-foundry-2026-08-13/contract-<issue>.md` paths.

No `review-qa.md` was written by this row. This report (redteam-161.md) remains the single
deliverable, unchanged in substance from the §1-§9 findings.

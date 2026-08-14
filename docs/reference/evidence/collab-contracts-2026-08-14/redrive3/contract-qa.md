CONTRACT-QA v1

[attempt: 5262cdfa-7068-4a59-8ad5-f80446d710a7 coordinator]

Coordinator cross-check of the LIFECYCLE-CONTRACT four-row foundry (package ③, the
wave-lifecycle package). Seat note (judgment call, recorded): this dispatch's write scope is
`collab-contracts-2026-08-14/redrive3/**`, whose wavefile member list names the ⑤ collab rows —
but the objectiveRef coordinator-brief, the foundry-brief, and the dispatch text are all the ③
lifecycle texts (the foundry header alone was swapped ③→⑤). The briefs bind (messageOnSpawn:
"the frame + laws bind you"); the ⑤ row deliverables exist only in unmerged snapshot commits,
while the ③ contracts are the four named in my brief. Executed the brief as written; the
wavefile/brief cross-wiring is recorded below as a pack finding, not silently resolved.

Every claim below is cited evidence: `sed -n` / `grep -an` reads of `impl/src` (NUL discipline on
`application.mjs` / `coordination-store.mjs`), `git show` / `git log --all` / `git diff`, and
`ls` sweeps of the sibling worktrees. No clocks, no fabrication, read-only outside this file.

## 0. Signal + on-disk verification (the #174 law — silence is not death)

The `signalOnMembersDone` text arrived with this dispatch. THEN verified on disk:

- Sibling sweep: all 15 `../../wt/ws-*/` worktrees exist, are CLEAN, and sit at exactly the
  wave base `5ae2c7e5` (each `baton/ws-*` branch `ahead:0` of base; `git status --short` empty).
  No row is currently writing — the rows' work concluded in prior sessions.
- The four deliverables are therefore the committed/`snapshot` truth: `contract-filesystem.md`,
  `contract-launch.md`, `contract-members.md` are committed at HEAD `5ae2c7e5` under
  `lifecycle-contracts-2026-08-14/redrive3/`; **`contract-ledger.md` exists NOWHERE** — not at
  HEAD, not in any redrive (1/2/3) pack, not in any sibling worktree, not in any snapshot
  commit reachable via `git log --all` (only the row BRIEF `row-lc-ledger.md` exists).
- Row-worktree provenance (snapshots on other refs): `4efc3919` (`ws-4db665bf…`, the fs row —
  carries `contract-filesystem.md` 278 lines plus a `shared/row-lc-fs-contract-filesystem-published.md`
  wrapper) and `0206825c` (`ws-2a7ad5ae…`, the members row — carries
  `shared/contract-members.md` **byte-identical** to the committed contract, `diff` empty).

## 1. Per-contract verdicts

### contract-filesystem.md (row-lc-fs — #168 · #172 · #185) — **VERDICT: SOUND**

Attempt-echo `[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 row-lc-fs]` at line 3 ✓ (first five).

Spot-check record (13 anchors, read line-exact; anchors verified at the contract's claimed HEAD
`09200e9` via `git show`, substance re-verified at audit HEAD `5ae2c7e5`):

| Contract anchor | Verified | Result |
|---|---|---|
| `workflow-interpreter.mjs:537–542` add :539 / commit :540 / silent catch :541 | `git show 09200e9` line-exact | ✓ exact at its HEAD (audit-HEAD drift + a behavior change — see §3) |
| `worktree.mjs:30–32` `DirtyRepoError`; `:1047–1058` throw at `:1053`; sole no-options caller `index.mjs:567` | read at HEAD (file unchanged since 09200e9) | ✓ exact (`:30–32`, `:1053`, `:567`) |
| `application-deployment.mjs:199–236` — untracked flag :201, sideband `GIT_INDEX_FILE` :216, `commit-tree -p HEAD` :233 | grep line-exact | ✓ exact |
| `worktree.mjs:1209/:1225` — `captureCommit` bare `git add -A` / `git commit` | read line-exact | ✓ exact |
| `coordinator.mjs:13501–13513` `worker_path_scope_violation` gate; `pathInScope` :618–620 | read line-exact | ✓ exact |
| `kernel-honesty-audit.md:47` (#169 stale-lock row, `worktree.mjs:1205–1227` + fix coaching) | `sed -n 47p` | ✓ verbatim |
| G6 `harvestOne` materializes into `repoRoot` (:701/:704/:710–717 at its HEAD) | read both HEADs | ✓ substance intact (drifted to ~:745+ at audit HEAD) |
| Seven receipt keys `:633–641` | `git show 09200e9` | ✓ exact at its HEAD (now :709–718) |

Acceptance pins (shallow-greenability): P1's clauses (c)+(d) block both shallow escapes
(stash/reset-away impls fail "dirt survives"; refuse-dirty-trees impls fail "base step SUCCEEDS
with a snapshot carrying the dirty content"). P3 carries the no-lock control against
always-refuse. P4/P5 pair presence-on-escape with absence-on-clean — each blocks the other's
cheap greening. P2/P6 verified RED at both HEADs (the silent catch at :541/:602 persists; no
`refs/baton/base/*` write exists — grep zero). No clocks (mtimes observed, never asserted).
Refusal vocabulary: four new codes (`workflow_base_unavailable`, `worker_index_lock_stale`,
`member_fs_escape`, `worker_base_ref_invalid`), typed, payload-keyed, coached, declared COMPLETE
with frozen existing surfaces named with anchors. Closed ✓.

### contract-launch.md (row-lc-launch — #173 · #202 · #207) — **VERDICT: SOUND**

Attempt-echo at line 3 ✓. The contract's headline discipline is the right one: it re-anchors the
seed brief's stale #173 claim (sync-at-HEAD) to the landed detach and pins only the RESIDUAL
gaps — exactly what the prior coordinator QA pre-registered as the shallow-greenability test.

Spot-check record (12 anchors):

| Contract anchor | Verified | Result |
|---|---|---|
| `application.mjs:11654` `const detach = request.detach !== false;` | `git show 09200e9` line-exact | ✓ exact at its HEAD (now :11695) |
| `mcp-northbound.mjs:609–614` `baton_waves_run` schema `{repoId, spec, specDsl}`; handler :1917; `unknown_argument_field` :1020 | read at HEAD (file unchanged) | ✓ exact — `detach` genuinely unreachable |
| GT-L7 advertised walls :409/:539/:559 (`maxLength: FRAME_LIMITS[...].value` = 4096 on the spill lanes) | read line-exact | ✓ exact; `limits.mjs:57` `enforcedAt: 'application startWave/attachWave member admission'` confirmed verbatim — the registry lie is real |
| `application.mjs:4522–4541` spill admission (head + `[SPILLED {citation}]`, `spill_body_exceeded` only beyond 1 MiB) | read line-exact | ✓ exact |
| `limits.mjs:56/86` — `run.objective` 4096 graceful; `spill.body` 1048576 | read | ✓ exact |
| GT-L10 `toolResult` `:196–199` wraps non-records as `{result: <string>}`; `_sanitizeDoctorReadiness` pass-through | read | ✓ exact — the #202 wire shape is one lane-return away |
| GT-L9 `'Command executed successfully.'` absent from `impl/src` | grep over all `*.mjs` | ✓ zero matches |
| GT-L11 `writeScratchpad` worker-scope hardcode `const scope = \`worker:${fields.workerId}\`` (entry :14130, hardcode ~:14169) | grep + read | ✓ exact — the publish-to-shared refusal is real (see §5) |
| GT-L15 `workflow_settle_failed` minted at `application.mjs:11660` (`cause?.code ?? 'workflow_settle_failed'`), MCP `workflow_*` prefix arm `mcp-northbound.mjs:262–266` | read both HEADs | ✓ substance exact (mint now at :11701) |
| GT-L12 lane A throws `wave_member_invalid` / lane B (`application-client.mjs:1555` → `createWave`) catches into `entry.startError` (`wave.mjs:250`) | read | ✓ exact — the two-lane split is real |
| GT-L8 `void stopReceipt;` :631; outcomes rebuilt without `error` | `git show 09200e9` + HEAD | ✓ exact at its HEAD (now :705) |
| GT-L4b/GT-L3 waves.progress `{members, nextCursor}` only; no `settlement` key anywhere in the wave verbs | grep | ✓ zero `settlement` keys in the wave read surface |

Acceptance pins: every pin (L1–L12) names a named shallow-green trap, and the traps are real:
L2 asserts code EQUALITY with the run.start refusal (blocks synthesized codes); L3 asserts the
value equals the durable `wave.settled` record incl. idempotent re-read (blocks live-compute);
L4 asserts the exact seven-key sorted receipt on `detach:false` (blocks ignore-after-admit); L5's
second clause (admit-with-spill through `baton_waves_start`) blocks schema-number-only fixes; L7
drives an ARBITRARY string (blocks grep-the-corpse); L9 asserts BOTH doors refuse (blocks
unify-downward); L12 asserts the typed refusal (blocks coerce-then-fix). RED status at the
contracts' HEAD re-confirmed by the anchors above; at audit HEAD the pins remain RED (none of
the pinned defects is fixed by `85519556`/`cda6355b`/`8ec52a6c` — the drifted regions still
carry the cited behavior, see §3). Refusal vocabulary: five new codes declared as a CLOSED set
(`wave_start_all_members_failed`, `wave_unknown`, `deployment_readiness_invalid`,
`workflow_request_invalid`, `workflow_settle_failed`-declared), plus one detail-key extension
(`started` on `wave_member_invalid`); existing codes reused unchanged with anchors. Closed ✓.

### contract-members.md (row-lc-members — #199 · #200 · #204 + #218) — **VERDICT: SOUND**

Attempt-echo at line 2 ✓. The largest contract (7 pins, 6 decisions, 2 DECISION_REQUESTs) and
the only one that reconciles a mid-campaign operator ruling (#221, git `a3e96e8`) with its own
addendum — recorded as a judgment call, not smuggled.

Spot-check record (12 anchors):

| Contract anchor | Verified | Result |
|---|---|---|
| `wave.mjs:250–252` catch into `entry.startError` + `state.members.set`; progress `:353`; settle `:472` | read line-exact | ✓ exact at both HEADs (file unchanged) |
| `application.mjs:3343–3351` runId digest excludes waveId; exclusion comment `:1560–1563` | read | ✓ exact (comment at ~:1562) |
| `application.mjs:11937–11948` `_runIdForWaveMember` FIRST-match return | `git show 09200e9` line-exact | ✓ exact at its HEAD; at audit HEAD the WLS-1 rewrite (commit `85519556`) preserves stale-first EXPLICITLY ("First-match-wins preserves … `_runIdForWaveMember` exactly", `_runWaveIndex` at :11585–11606, method now :11985) — the pin's RED target survives the refactor |
| `application.mjs:11740–11743` startWave waveId mint `wave:${digest({idempotencyKey, members…})}`; `wave.mjs:207–208` createWave `wave:${sha256(idempotencyKey)}` | `git show 09200e9` + HEAD read | ✓ both mints verified, and they do disagree on content |
| GT4 store kind set — `this._append('…')` scan; no `wave.member_*` kind; `deferTaskDispatch` :13246–13266 | grep + read | ✓ confirmed (kind census run; `deferTaskDispatch` at :13252) |
| GT17/GT18 the #221 ruling comment + dispatch-every in `_dispatchPass` (`coordinator.mjs:2917–2927`) | read | ✓ verbatim ruling comment on disk |
| GT19 residual silent vector: `router.mjs:202–203` eligible filter → `coordinator.mjs` bare `continue` on `!vendor` | read | ✓ exact — the real-ceiling silent skip survives the ruling |
| GT14/GT15 `driver_capacity_active` (`index.mjs:1558`) vs `drainAndClose` hard-drain | grep + read | ✓ exact |
| GT21 `WAITING_ON_KINDS` `application-semantics.mjs:59–61` (incl. `capacity_ceiling` with no producer) | read | ✓ exact |
| GT11 `saltObjectives` (`wave-driver.mjs`, default true at :52, mint in the run loop) | grep + diff | ✓ present; the #163 hardCap rip-out (`8ec52a6c`) touched only :32–135/:802 — the salt block is untouched |
| Publish claim: `redrive3/shared/contract-members.md` | `git show 0206825c` | ✓ TRUE in the row's worktree snapshot — byte-identical to the committed contract (`diff` empty). NOT merged to master: `redrive3/shared/` does not exist at HEAD. Claim verified, merge-side absence recorded (§5) |

Acceptance pins: A1 requires the record IN THE STORE via close/reopen replay and on BOTH
surfaces (receipt-cause-only named not-green); A2 is driven at `saltObjectives:false` so the
derivation, not the salt, must carry the namespace; A3 asserts WHICH run the wave surface binds;
A4 asserts fence+no-kill+reopen (swallow-and-exit-0 named not-green); A5 asserts the payload
truths AND the #221 law in the negative (any synthetic pre-cap fails the pin); A6 requires hop
events to TRAIL physical effects (aspirational pre-marking named not-green); A7 requires
`estOrder` plus admission-vs-live labeling. Refusal vocabulary: new codes/kinds declared in a
closed table (`wave.member_start_failed`, `wave_member_task_collision`, `task.seat_queued`,
four hop kinds, `wave_admission_fenced`, `drain_restart_incomplete`), existing codes reused
unchanged with anchors, the task-lane vs driver-lane split justified. Closed ✓.

### contract-ledger.md (row-lc-ledger — #194 · #205) — **VERDICT: NEEDS-FOLD (blocker: no deliverable)**

Named blockers:

1. **The contract does not exist.** Absent at HEAD, in every sibling worktree, in every
   redrive pack (1/2/3), and in every snapshot commit (`git log --all` for the path returns
   nothing). Row-lc-ledger has never settled. A redrive4 pack exists at HEAD
   (`lifecycle-contracts-2026-08-14/redrive4/`, briefs only) — the re-drive machinery already
   re-dispatched the row; this QA must not mark package ③ complete without it.
2. **Two incidents are left un-contracted:** #194 (model-visible-means-logged + the durable
   no-step turn) and #205 (decision ledgering — verified still grounded: `decision.need`/
   `decision.rationale` admission exists with no `decision.*` record kind anywhere).
3. **Three dangling cross-references from the landed contracts** (each correctly deferred, none
   resolvable until the ledger contract lands): fs D4's `member_fs_escape` store event and §5.5's
   lock-tombstone seam ("ledger must ACKNOWLEDGE it"); members OQ4 (visibility doctrine for the
   new task/driver-lane records); launch OQ-L2 (spill-artifact reconstructability — "launch
   owns the receipt SHAPE; ledger owns reconstruct; the two must stay one shape").

## 2. Boundary map (cross-contract coherence — the four share the wave lifecycle)

Declared and verified seams:

- **fs × launch — receipt shape.** fs D6 escalates the escape-detail home as a DECISION_REQUEST,
  recommends (b) (store event + verdict downgrade, seven keys preserved), and names launch as
  the shape owner; launch adds no eighth receipt key (its `settlement` key lands on
  waves.PROGRESS — a different surface). Coherent ✓.
- **launch × members — startError truth.** launch D6 (wire: `error: {code, message}` verbatim
  from the capture) × members D1 (store: `wave.member_start_failed` with `cause.code`
  preserved). Both contracts explicitly bind themselves to code IDENTENTITY across the two
  seams ("the fold must keep the captured `error.code` IDENTICAL in both"). Coherent ✓.
- **fs × members — objectiveRef path seam.** fs confines/captures the path; members' D2.1
  derives the task id from the objective. No contradiction; the salt interplay (members GT8 ×
  fs G1) is each row's own mechanism. Coherent ✓.
- **launch × members — OVERLAP (the one the fold must reconcile): the ACCEPTANCE receipt is
  mutated by both rows.** launch PIN-L11/GT-L14 changes `members` from bare role strings to
  `[{role, runId, admitted}]`; members D6/DR2 adds a `serialization` key to the same shape.
  Both flag it and defer to the fold (members DR2 options a/b/c; launch GT-L14 names the
  member-shape law). Compatible, not yet reconciled — fold instruction F-1 below.
- **launch D1 × members D1 — ordering coherence.** On total start failure launch refuses BEFORE
  any acceptance is minted; members A1 requires the failure record minted at the catch site on
  BOTH surfaces. The green compositions compose (mint, then throw) — no conflict, but the fold
  must state the order once. F-2 below.
- **members × telemetry (out-of-package, correctly fenced).** members D4 writes the
  `task.seat_queued` ledger; the telemetry row projects it — cited boundary, not re-owned. ✓.
- **GAP: the ledger row.** Every seam that touches "what the store must show the model" (#194)
  and "decisions are ledgered" (#205) has no counterparty. See verdict 4.

## 3. Anchor-drift register (contract HEAD `09200e9` → audit HEAD `5ae2c7e5`)

Four impl commits landed after the contracts' verification HEAD: `85518556` (WLS-1 roster
index), `cda6355b` (async base-commit + clean-tree skip), `8ec52a6c` (#163 hardCap rip-out).
`git diff --stat 09200e9..5ae2c7e5 -- impl/` touches ONLY `application.mjs` (+73),
`workflow-interpreter.mjs` (+225), `wave-driver.mjs` (+11), `recipes.mjs`. Therefore: every
anchor in every OTHER file is exact at both HEADs (all verified above). In the two moved files:

| Contract anchor (at 09200e9) | Audit HEAD | Substance |
|---|---|---|
| wf-int `:537–542` base commit | `:596–602` | on-branch add+commit + silent catch PERSIST; NEW: skipped when tree clean, and async (cda6355b). FS-P1 still RED (dirty-tree commit remains); FS-P2 still RED (catch still swallows). The fs contract's D1 must note the clean-tree skip in its impl — fold note F-4 |
| wf-int `:631` void stopReceipt / `:633–641` seven keys / `:644` detach branch / `:647–653` acceptance / `:649–651` members-as-strings | `:705` / `:709–718` / `:731` / `:720–726` / `:723` | all behavior unchanged — pure drift |
| wf-int `:520` salt, `:590` preOutcome-failed | `:574`, ~`:661` | unchanged behavior |
| app `:11654` detach / `:11652–11667` wave.settled / `:11769–11786` wave_member_invalid / `:11937–11948` _runIdForWaveMember | `:11695` / `:11687–11710` / `:11814/:11824` / `:11985` | behavior unchanged; stale-first resolution PRESERVED by name in WLS-1 |

No WRONG citation found in any contract: every sampled anchor is line-exact at the HEAD the
contract declares, and substance-true at the audit HEAD.

## 4. Fold instruction set (concrete, for the fold stage)

- **F-1 (acceptance receipt, launch × members):** adopt members DR2 option (a) — `serialization`
  joins the acceptance key set — AND launch PIN-L11's member objects. Final acceptance shape:
  `{accepted, manifestDigest, members: [{role, runId, admitted}], schemaVersion, serialization,
  verdict, waveId}` (sorted). Launch's PIN-L4 seven-key assertion applies to the SETTLE receipt
  only (unchanged). If the registry owners object, fall to DR2 (b) (`serialization` under
  member rows) — do NOT silently keep both contracts' differing shapes.
- **F-2 (total-failure ordering):** mint `wave.member_start_failed` per failed member (members
  D1, both surfaces), THEN refuse (`wave_member_invalid` lane A / `wave_start_all_members_failed`
  lane B). State once, in the launch contract's D1, that no acceptance precedes the refusal.
- **F-3 (ledger row):** package ③ cannot fold until `contract-ledger.md` lands (redrive4 is
  dispatched — briefs on disk). The landed contract MUST acknowledge: fs's `member_fs_escape`
  event + lock-tombstone vocabulary, members' OQ4 visibility doctrine for the new task-lane
  kinds, launch's OQ-L2 spill-reconstructability law (one shape, both seams).
- **F-4 (fs base step):** the impl of D1 inherits `cda6355b`'s clean-tree skip and async form —
  the sideband snapshot replaces the on-branch add+commit, keeping the skip-if-clean fast path.
  FS-P1/P2 as pinned remain the acceptance; no re-draft needed.
- **F-5 (drift re-baseline):** re-anchor the drifted wf-int/app line numbers (§3 table) at the
  fold's HEAD before any pin is executed; the pin suite's cited anchors are contract-graded
  against `09200e9`.

## 5. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared`. Verified this session at HEAD: `writeScratchpad` hardcodes
the write scope `worker:${fields.workerId}` (`coordination-store.mjs`, entry `:14130`, hardcode
~:14169) and the shared-scope settlement path is orchestrator-actor-only — a member/coordinator
publish to `shared` is silently admitted into the worker partition; there is no typed refusal
string to quote (the refusal is the admission). Additionally, no shared-lane publish TOOL is
advertised to this seat (the brief's tool surface is filesystem evidence only). This QA is
therefore published ON DISK at the wavefile's report path
(`collab-contracts-2026-08-14/redrive3/contract-qa.md`, mustContain `CONTRACT-QA v1` ✓), and
the refusal is recorded here. Merge-side note for the fold: the rows' `shared/` publishes (fs
wrapper `4efc3919`, members copy `0206825c`) live only in unmerged snapshot commits — the fold
should harvest them from those refs or re-publish post-#158-fix.

## 6. Residual register / escalations

1. **Pack cross-wiring (pack owner; judgment call recorded, no bus verb in this harness):** the
   `collab-contracts-2026-08-14/redrive3` pack's wavefile member list + harvest lines name the
   ⑤ collab rows, while its coordinator-brief/foundry-brief (and this dispatch) are the ③
   lifecycle texts. Options: (a) the wavefile is the error — regenerate it to the lifecycle
   rows (recommended: the briefs are the binding frame and their four contracts exist);
   (b) the briefs are the error — re-dispatch the collab coordinator with the collab briefs
   (its rows' contracts exist only in unmerged snapshots `6f20bae5`/`2b65b451`/`876c5c48`,
   i.e. it would be a QA of snapshot-only deliverables). This QA executed (a)'s reading.
2. **DECISION_REQUEST (authority class — acceptance-shape growth, mirrors members DR2):**
   adding `serialization` to the acceptance receipt grows a schemaVersion-1 closed shape. Options:
   (a) additive key, schemaVersion stays 1 (members' default; this QA concurs — additive, and
   the shape is frozen not versioned anywhere a consumer branches on); (b) bump schemaVersion;
   (c) payload-only. Escalated for the fold per the foundry law.
3. No DECISION_REQUEST needed on fs D6: option (b) is already the recorded recommendation with
   the boundary rationale; this QA endorses it unchanged.

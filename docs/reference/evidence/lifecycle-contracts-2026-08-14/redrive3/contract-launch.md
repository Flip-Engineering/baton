# CONTRACT-LAUNCH v1.1 — the launch/receipt honesty contract (package ③, row row-lc-launch)

[attempt: 9a07d8eb-e52d-475f-ac64-65ffbb707813 row-lc-launch]

Issue set: #173 (synchronous launch / acceptance-receipt) · #202 (bare-text response shapes) ·
#207 (objectiveRef admission alignment + startError on the wire + the unused spill graceful path).
Base: this worktree at `09200e9` (`impl/src` identical to the campaign base the foundry packed —
docs-only commits between). Ring-2 form: ground truths → decisions → refusal vocabulary →
red-first acceptance pins → open questions. Every anchor below was re-verified this session with
`grep -an`/`sed -n` (NUL discipline on `application.mjs`/`coordination-store.mjs`; plain grep
elsewhere); line numbers are HEAD numbers. No clocks anywhere. Sorted-key literals in ACTUAL order.

**Headline (the redrive correction the fold must carry):** the foundry-era form of two incidents is
already repaired at HEAD — waves.run DETACHES (landed `ac0f5bc`, GT-L1) and run.start's objective
lane is graceful-with-spill (landed `f33c24e` #89, GT-L6). What remains RED is the honesty rim
around those repairs: the acceptance receipt lies on total start failure, the settlement receipt is
durable but unreadable, `detach` is unreachable from every transport, the advertised schema walls
the very lane the admission admits (the graceful path "exists unused" in its HEAD form), the
captured `startError` is dropped from both receipts, and the bare-text degrade seam (#202's class)
survives at two verbatim spots. The pins below target only what is RED at HEAD.

## 1. Ground truths (each verified at HEAD this session)

### The launch leg (#173)

- **GT-L1 — waves.run detaches at HEAD.** `application.mjs:11654` (`const detach = request.detach
  !== false;` — default true), the interpreter's acceptance branch at
  `workflow-interpreter.mjs:644-663`, the `settle` continuation at `:576-586`, and the settlement
  record `wave.settled` minted via `recordDriver` (`application.mjs:11652-11667`, kind constant at
  `:142`). The row brief's seed anchor ("application.mjs:11631-11646 awaits the full drive") is
  STALE at HEAD — the await-the-whole-drive form is the pre-`ac0f5bc` code; re-anchored here per
  the QA's re-anchor law (contract-qa checkpoint §Fold-1, the same discipline it demanded of the
  filesystem row's `:525`).
- **GT-L2 — the acceptance receipt is unconditional.** `workflow-interpreter.mjs:647-653`:
  `{accepted: true, manifestDigest, members: [role strings], schemaVersion: 1, verdict:
  'WAVE-ADMITTED', waveId}` — frozen verbatim regardless of member start outcomes, because
  `waves.start`/createWave NEVER throws on per-member failure: `wave.mjs:226-253` starts members
  individually, catches each throw into `entry.startError` (`:250`), and returns the handle. A wave
  in which EVERY member refused at run.start still mints `accepted: true / WAVE-ADMITTED`.
- **GT-L3 — the settlement receipt is durable but unreadable.** `wave.settled` lands as a
  `driver.recorded` event (`application.mjs:11658-11667` → `coordination-store.mjs:13240-13246`).
  The launch surface's only observe verbs return everything BUT it: `waves.progress`
  (`application.mjs:11802-11836`) returns `{schemaVersion, waveId, cursor, nextCursor, members}`
  with per-member `{role, phase, progressClass, attention, knowledge}` projections only;
  `waves.list` is the registry projection (`:11838+`). No waves.* verb returns the settlement
  verdict, basis, outcomes, or harvest. A detached caller can learn member phases but never the
  wave's own settlement truth.
- **GT-L4 — `detach` is unreachable from every transport.** The MCP tool schema
  (`mcp-northbound.mjs:609-614`) admits only `{repoId, spec, specDsl}`; the handler
  (`:1917-1927`) forwards only `{spec}`; a caller supplying `detach` draws `unknown_argument_field`
  at `validateArguments` (`mcp-northbound.mjs:1020-1022`). The CLI sends `{specPath}`
  (`application-cli.mjs:1368-1373`). The synchronous seven-key D6 receipt
  (`workflow-interpreter.mjs:633-641`: `{basis, harvest, manifestDigest, outcomes, steering,
  verdict, waveId}`) is therefore embedded-only — no transport caller can choose either leg; the
  default alone is reachable.
- **GT-L4b — waves.progress answers an unknown waveId with silence.** `_normalizeWaveProgress`
  (`application.mjs:12054+`) validates shape only; the handler filters the run list by waveId
  (`:11810-11836`) and an unknown waveId yields `{members: [], nextCursor: null}` — a success page,
  not a typed refusal. Silence-is-not-death cuts both ways: an empty page is indistinguishable
  from a finished-and-reaped wave.

### The admission seam (#207)

- **GT-L5 — the interpreter admits by-reference objectives to 64 KiB.**
  `workflow-interpreter.mjs:39` (`OBJECTIVE_REF_MAX_BYTES = 64 * 1024`), enforced at `:340-342`,
  and `renderObjective` (`:333-350`) renders the FULL body into the member objective with the salt
  prefix.
- **GT-L6 — run.start's objective lane is graceful at HEAD (the foundry-era phantom is repaired on
  the embedded path).** `application.mjs:4522-4541`: oversize above the 4096-byte `run.objective`
  cap (`limits.mjs:56`) up to the 1 MiB `spill.body` ceiling (`limits.mjs:86`) is ADMITTED with a
  durable spill artifact and a bounded head + `[SPILLED {citation}]` suffix; only beyond the
  ceiling draws the typed coaching refusal `spill_body_exceeded` (`:4529-4531`). The wave-member
  path rides the same admission: startWave loops members through `this.start`
  (`application.mjs:11734+`; the facade path `wave.mjs:226-253`), and `_normalizeWaveStart`
  deliberately shape-checks the objective only (`application.mjs:12028-12033`, "never a wall in
  front of a spill lane"). A 4–64 KiB brief therefore no longer phantom-fails every member at HEAD.
- **GT-L7 — the graceful path exists UNUSED on every transport (the HEAD form of the #207 gap).**
  The ADVERTISED input schemas still hard-declare `maxLength: 4096` on the exact lanes the
  registry declares `graceful: 'spill-digest-citation'`: `mcp-northbound.mjs:409` (run intent
  objective, fleet_run_start/fleet_run_follow), `:539` (baton_waves_attach member objective),
  `:559` (baton_waves_start member objective); `application-semantics.mjs:171`, `:1559`, `:1583`.
  A schema-honoring MCP client never sends more than 4096 characters, so the spill path is
  unreachable from any transport even though the admission beneath it is graceful — the
  advertisement walls the lane the admission admits. Related registry lie: `limits.mjs:57` declares
  `wave.member.objective` `enforcedAt: 'application startWave/attachWave member admission'`, but
  neither enforces (`application.mjs:12028-12033` by design; attach shape-only at `:2014-2018`) —
  the actual enforcement point is run.start (`application.mjs:4522`).
- **GT-L8 — the captured startError never reaches either receipt.** `wave.mjs:235-251` captures
  `{code, message}` per failed member; the wave's own outcome path carries it (`wave.mjs:353`,
  `:472`). But the interpreter REBUILDS outcomes without the error field
  (`workflow-interpreter.mjs:617`: `{role, phase, terminal, resultSha}` + optional
  report/verifiedBy) and DISCARDS the close receipt outright (`:631`: `void stopReceipt;`). The
  acceptance receipt carries no per-member status at all (GT-L2). A start-failed member surfaces as
  `phase: 'failed'` with NO cause on either receipt — the phantom-failure shape, live at HEAD.

### The response-shape seam (#202)

- **GT-L9 — the doctor seams are structured at HEAD.** MCP `_freshDoctorReadiness()`
  (`mcp-northbound.mjs:2256-2268`) with secret-stripping sanitize (`:2271+`); dispatch
  `deployment.doctor` → `this.doctorReadiness()` (`application.mjs:12724`, definition `:12540`).
  The incident string `'Command executed successfully.'` does not exist anywhere in `impl/src` at
  HEAD (grep over all `*.mjs`; only the four row briefs carry it) — the offending producer is gone.
- **GT-L10 — the bare-text degrade class survives at two verbatim seams.** (a)
  `_sanitizeDoctorReadiness` passes a NON-RECORD readiness through verbatim
  (`mcp-northbound.mjs:2272`: `if (!record(value)) return value;`) — a doctor lane that returns a
  bare string reaches the wire unrefused. (b) `toolResult` wraps any non-record value as
  `{result: <string>}` (`mcp-northbound.mjs:196-199`) — so that string serializes as
  `{"result":"Command executed successfully."}`, which is EXACTLY the #202 wire shape. Neither seam
  refuses typed; the class that produced the incident is one careless lane-return away.
- **GT-L11 — publish-to-`shared` is silently re-scoped, not refusable (the #158 law, live).**
  `writeScratchpad` hardcodes the write scope `worker:${fields.workerId}`
  (`coordination-store.mjs:14169`, entry `:14130`); the shared-scope settlement path is
  orchestrator-actor-only (`:12559`). A member-row publish to `shared` is silently admitted into
  the worker partition — no typed refusal string exists to record; the refusal is the admission.

## 2. Decisions (judgment calls recorded; options where the call is arguable)

- **D1 — total start failure refuses the launch (fail-closed), partial failure rides the
  receipt.** When EVERY member's run.start refuses, minting `accepted: true` is a lie (GT-L2); the
  launch must throw the new typed `wave_start_all_members_failed` naming each member's captured
  startError verbatim, before any acceptance is frozen. Partial failure keeps the acceptance
  (the live members are real work) with per-member admission truth added (D6/PIN-L2 make the
  causes attributable). Rationale: an empty wave has nothing to drive — detaching it wastes the
  settle leg and reports WAVE-INCOMPLETE with zero cause, the exact #207 phantom shape.
- **D2 — the settlement receipt becomes readable on the launch surface, additively.**
  `waves.progress` gains one closed key (`settlement`) carrying the durable `wave.settled:<waveId>`
  record's verdict/basis (or null while unsettled). Options: (a) extend waves.progress
  (CHOSEN — one read path, no new verb, additive to a schemaVersion-1 response); (b) a new
  `waves.settlement` verb (rejected: verb-table growth for one projection); (c) stuff it into
  waves.list rows (rejected: list is the registry projection, not wave truth). Escalated as OQ-L2
  for the fold if the registry owners object.
- **D3 — `detach` becomes a real parameter on both transports.** MCP `baton_waves_run` schema adds
  optional boolean `detach` (default true), forwarded verbatim by the handler; non-boolean refuses
  the existing typed `invalid_workflow_run` (surface-constant). CLI `baton waves run` gains
  `--sync` mapping to `detach: false`. The embedded default stays true (the #173 fix's posture:
  never hold the bus by default).
- **D4 — the advertisement must tell the admission's truth.** On every graceful byte lane the
  advertised bound becomes the ADMISSION bound (the 1 MiB `spill.body` ceiling — what actually
  refuses is beyond-ceiling), with the 4096 head + spill citation documented in the tool
  description; and `limits.mjs:57`'s `enforcedAt` is corrected to name run.start, the real
  enforcement point. Options: (a) advertise the ceiling (CHOSEN); (b) drop maxLength entirely and
  document the refusal (rejected: honest clients lose the upper bound signal); (c) wall the
  admission back to 4096 (REJECTED HARD — it reinstates the #207 phantom and violates the
  "never a wall in front of a spill lane" law at `application.mjs:12030`).
- **D5 — the #202 degrade seams refuse typed.** `_sanitizeDoctorReadiness` refuses a non-record
  readiness with the new typed `deployment_readiness_invalid` (never a pass-through); the
  launch-family tool results (doctor, waves.*) are pinned as closed records — the
  `{result: <string>}` envelope at `mcp-northbound.mjs:196-199` remains legal for genuinely-scalar
  lanes but is pinned RED for this family. Rationale: the incident's producer is gone (GT-L9) but
  the class is one lane-return away (GT-L10); pins must hold the CLASS, not the corpse.
- **D6 — startError rides the wire verbatim.** The settlement receipt's outcomes carry
  `error: {code, message} | null` — the interpreter passes `wave.mjs:472`'s already-built
  `entry.startError` through instead of rebuilding outcomes without it; `void stopReceipt` ends.
  Every `phase: 'failed'` outcome is attributable from the receipt alone.

## 3. Refusal vocabulary (closed, typed, surface-constant)

Existing codes this contract depends on, unchanged (each verified at HEAD):

| Code | Minted at | Anchor |
|---|---|---|
| `workflow_spec_invalid` / `workflow_member_invalid` / `workflow_steering_unknown` / `workflow_harvest_invalid` / `workflow_objective_ref_invalid` | interpreter validation/render | `workflow-interpreter.mjs:29-34` |
| `spill_body_exceeded` | run.start objective beyond the 1 MiB ceiling (the ONLY hard refusal on these lanes) | `application.mjs:4529-4531`, `limits.mjs:56/86` |
| `application_wave_start_invalid` | startWave normalization | `application.mjs:12024`, `:12041` |
| `wave_already_terminal` | idempotent re-drive of a terminal wave | `application.mjs:11715-11730` |
| `wave_member_not_found` | attach objective match failure | `wave.mjs:334` |
| `coordinator_authority_forbidden` | coordinator seat reaching a launch verb | `application.mjs:12706-12712` |
| `invalid_workflow_run` / `invalid_wave_start` / `unknown_argument_field` | MCP argument guards | `mcp-northbound.mjs:1226-1229`, `:1205-1223`, `:1020-1022` |

NEW codes this contract adds (closed set of three; surface-constant across embedded/MCP/CLI —
the MCP stateFailureCode allowlist must admit all three):

| Code | Meaning | Refusal shape |
|---|---|---|
| `wave_start_all_members_failed` | every member's run.start refused; the wave is empty | `{members: [{role, error: {code, message}}]}` — each startError verbatim |
| `wave_unknown` | waves.progress asked for a waveId with no bound runs | `{waveId}` — never an empty success page |
| `deployment_readiness_invalid` | the doctor lane produced a non-record readiness | `{actual: typeof}` — refused at the sanitize seam |

No prose-string refusals; no numeric-limit refusals beyond the registry's declared lanes; no clocks.

## 4. Red-first acceptance pins

Each pin names its stage (where the pin test hooks), is RED at HEAD `09200e9`, and greens ONLY for
a correct impl (a shallow greening is itself a defect — the QA's fold instruction 3).

- **PIN-L1 — the acceptance must not lie on total start failure.**
  Stage: interpreter launch (`workflow-interpreter.mjs` runWorkflow, the waves.start → acceptance
  span `:549-663`). RED at HEAD: a valid spec whose members' exact routes are all outside the
  deployment profile → every run.start refuses inside createWave (`wave.mjs:250`), and waves.run
  still returns `{accepted: true, verdict: 'WAVE-ADMITTED'}` (GT-L2). Green: the typed
  `wave_start_all_members_failed` refusal reaches the caller (all surfaces), naming every member's
  startError code verbatim; NO acceptance is minted; NO settle leg runs. Shallow-green trap: an
  impl that flips `verdict` to a failure string but still returns `accepted: true` fails this pin.
- **PIN-L2 — startError rides both receipts.**
  Stage: settlement build (`workflow-interpreter.mjs:617-631`) + acceptance members (D6).
  RED at HEAD: a start-failed member's settlement outcome is `{role, phase: 'failed', terminal:
  true, resultSha: null}` — no `error` key (the interpreter rebuilds outcomes without it and
  voids the close receipt, GT-L8). Green: settlement outcomes carry `error: {code, message}`
  verbatim from `wave.mjs:472`'s capture; partial-failure acceptances carry per-member admission
  status. Shallow-green trap: synthesizing a generic error (`{code: 'start_failed'}`) instead of
  the captured code fails — the pin asserts code EQUALITY with the run.start refusal.
- **PIN-L3 — the settlement receipt is readable from the launch surface.**
  Stage: waves.progress read (`application.mjs:11802-11836`). RED at HEAD: no waves.* response
  contains any settlement field (GT-L3); the durable `wave.settled:<waveId>` record is minted
  (`application.mjs:11658-11667`) but no verb returns it. Green: after a detached run settles, the
  decided read (D2: waves.progress `settlement` key) returns the recorded verdict/basis; before
  settlement it is null (not absent — null). Shallow-green trap: returning a LIVE-computed verdict
  instead of the durable record fails — the pin asserts the value equals the `wave.settled` record
  (or the recorded error shape when the settle leg failed), including its idempotent re-read.
- **PIN-L4 — `detach` is reachable and typed on both transports.**
  Stage: MCP argument admission (`mcp-northbound.mjs:1013-1022`, schema `:609-614`, handler
  `:1917-1927`) + CLI parse (`application-cli.mjs:1368-1373`). RED at HEAD: `baton_waves_run` with
  `detach: false` draws `unknown_argument_field` (GT-L4); the CLI has no sync flag. Green:
  `detach: false` through MCP returns the synchronous seven-key D6 receipt
  (`workflow-interpreter.mjs:633-641` — exact keys, sorted); `detach: true` (and absent) returns
  the acceptance; a non-boolean detach refuses `invalid_workflow_run`. Shallow-green trap: an impl
  that detaches regardless of the flag (ignoring it after admission) fails the seven-key assertion.
- **PIN-L5 — the advertised bound equals the admission bound on the graceful lanes.**
  Stage: MCP schema advertisement (`mcp-northbound.mjs:409/539/559`) vs the admission
  (`application.mjs:4522-4541`). RED at HEAD: advertised `maxLength` 4096 on lanes whose admission
  admits-with-spill to 1 MiB (GT-L7) — and, behaviorally, a schema-honoring client cannot ever
  reach the graceful path. Green: the advertised bound is the spill ceiling (or the bound is
  removed with the refusal documented — D4a's shape), AND a >4096-byte member objective sent
  through `baton_waves_start` ADMITS WITH SPILL (surface-constant with the embedded path — the
  stored objective carries the head + `[SPILLED {…}]` citation). Shallow-green trap: fixing only
  the schema numbers without asserting the admit-with-spill behavior greens nothing — the pin's
  second clause is the substance.
- **PIN-L6 — the limits registry names the real enforcement point.**
  Stage: `limits.mjs:56-57` registry rows. RED at HEAD: `wave.member.objective` claims
  `enforcedAt: 'application startWave/attachWave member admission'` but neither enforces
  (`application.mjs:12028-12033`, `:2014-2018`; GT-L7). Green: the row's `enforcedAt` names
  run.start (where `spill_body_exceeded` actually fires), and `run.objective`/`wave.member.objective`
  rows still declare the same graceful path and ceiling. (Registry digest discipline: the row set
  stays closed; only the prose field corrects.)
- **PIN-L7 — the bare-text degrade class refuses typed at the wire.**
  Stage: `_sanitizeDoctorReadiness` (`mcp-northbound.mjs:2271-2280`) + `toolResult`
  (`:196-199`). RED at HEAD: a string-returning doctor seam (test double at the readiness
  supplier) passes through verbatim and serializes as `{result: "<text>"}` — the exact #202 wire
  shape (GT-L10). Green: the typed `deployment_readiness_invalid` refusal; and the doctor tool's
  structuredContent is a closed record (schemaVersion-carrying) for every readiness producer.
  Shallow-green trap: pinning only the incident's literal string (grep for 'Command executed
  successfully.') greens nothing — the pin drives an ARBITRARY string through the seam.
- **PIN-L8 — an unknown waveId refuses, never an empty page.**
  Stage: waves.progress handler (`application.mjs:11810-11836`). RED at HEAD: a well-formed but
  unknown `wave:…` id returns `{members: [], nextCursor: null}` — success-shaped silence (GT-L4b).
  Green: the typed `wave_unknown` refusal `{waveId}`; an EMPTY-but-real wave (all members reaped)
  must remain distinguishable from an unknown one (the pin asserts the refusal fires only when the
  registry has no binding, not when phases are all terminal).

## 5. Open questions

- **OQ-L1 (wire-contract authority):** partial-start-failure acceptance shape — keep verdict
  `WAVE-ADMITTED` with per-member `admitted: false` statuses (recommended: additive, no enum
  change) vs a new `WAVE-DEGRADED` verdict value (enum growth ripples through every consumer).
  DECISION_REQUEST-worthy if the fold disagrees with the recommendation.
- **OQ-L2 (registry authority):** the settle-read home — waves.progress additive key (D2,
  recommended) vs a dedicated verb. Boundary note for the ledger row: launch owns the receipt
  SHAPE; ledger (#194) owns spill-artifact reconstructability; the two must stay one shape (the
  contract-qa boundary map's overlap 1 and 3 — this contract cites, ledger owns reconstruct).
- **OQ-L3 (lane alignment):** `OBJECTIVE_REF_MAX_BYTES` 64 KiB (`workflow-interpreter.mjs:39`) vs
  the 1 MiB inline spill ceiling — a by-reference body of 65 KiB refuses
  `workflow_objective_ref_invalid` at render while the same bytes inline through waves.start admit
  with spill. Align to `spill.body` (recommended — one ceiling per economy) or keep 64 KiB as the
  by-reference bound and document the asymmetry. No pin until decided.
- **OQ-L4 (no incident at HEAD, recorded only):** the acceptance leg still awaits the full
  startWave loop (start + approve per member, `wave.mjs:226-253`, `approve: true` at
  `workflow-interpreter.mjs:555`) — for a 64-member roster the acceptance itself is slow. No
  measured incident; no pin.
- **OQ-L5:** the `wave.settled` record's claimed idempotency-keying (`application.mjs:11652`
  comment; `recordDriver` auth-key law at `coordination-store.mjs:13240-13246`) — PIN-L3's re-read
  assertion exercises it; if the store's auth-key dedupe does not hold for `driver.recorded`, the
  impl must key explicitly.

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The publish path does not exist for a member row
and refuses with NO typed code — the exact #158 shape, re-verified at HEAD this session
(GT-L11: `coordination-store.mjs:14169` worker-scope hardcode inside `writeScratchpad:14130`;
`:12559` orchestrator-actor-only settlement). There is no refusal string to quote because the
refusal is a silent admission into `worker:<id>`. This contract is therefore published ON DISK
(here) and the shared-lane refusal is recorded verbatim above for the fold to carry; fabricating a
shared-scope publish was not an option.

## 7. Cross-contract boundary notes (for the coordinator's coherence check)

- fs row owns: base-commit capture (`workflow-interpreter.mjs:539-547`), index.lock, member
  confinement/settle sweep. This contract's GT-L1 re-anchor note affects fs's `:525` pin — flagged.
- members row owns: creation-failure events (#199), task-id namespacing (#200), drain-restart
  (#204). PIN-L1/L2's startError truth is the LAUNCH-receipt half; the members row's typed
  creation events are the store half — same causes, different seams; the fold must keep the
  captured `error.code` IDENTICAL in both.
- ledger row owns: model-visible-means-logged (#194), decision ledgering (#205). PIN-L3's
  settlement read and D5's closed-record law must match the ledger's reconstructability law (one
  shape, both seams).

---

# CONTINUATION TRANCHE (v1.1) — the two-lane truth

Grounded fresh this session after the v1 tranche; every anchor re-read at HEAD `09200e9` before
pinning. This tranche sharpens v1's GT-L2: the unconditional acceptance is not a lone defect — it
is one half of a TWO-LANE SPLIT in which the same economic act (start a wave member) gets opposite
verdicts depending on which door the caller used.

## 1c. Ground truths, continuation (GT-L12 … GT-L16)

- **GT-L12 — two wave-start lanes, opposite failure semantics (the sharpest form of #207's
  startError gap).** Lane A, the `waves.start` direct port (`application.mjs:11734-11795`):
  ANY member run.start refusal THROWS the typed `wave_member_invalid` carrying
  `{actual?, cap?, cause, role}` with the inner code preserved (`application.mjs:11769-11786`,
  the D5.1 law: "A partial start also refuses: the response is never a success shape"), and the
  code surfaces typed on MCP (`mcp-northbound.mjs:269-271` allowlist). Lane B, the facade lane the
  interpreter rides: `baton.waves.start` binds to `createWave` (`application-client.mjs:1555`),
  which catches each member's throw into `entry.startError` and RETURNS the handle
  (`wave.mjs:226-253`) — no refusal, ever. `waves.run` (interpreter, `workflow-interpreter.mjs:549`)
  rides lane B. So the identical member failure — say an out-of-profile exact route — refuses
  `wave_member_invalid` on `waves.start` and mints `accepted: true / WAVE-ADMITTED` on `waves.run`.
  Surface-constancy is violated at the verdict level, not the code level.
- **GT-L13 — the partial-start refusal drops the live-members truth.** Lane A refuses on the
  FIRST failing member, but members started before the failure are LIVE runs with no rollback in
  the loop (`application.mjs:11754-11786` — the throw propagates; no stop/cleanup), and the
  refusal's detail carries only the failing member's `{actual?, cap?, cause, role}`
  (`:11773-11778`). A refused caller of `waves.start` cannot learn from the refusal that earlier
  members are live (and billable) — the inverse of GT-L2's lie: there the receipt claims members
  that are dead; here the refusal hides members that are alive.
- **GT-L14 — the launch-receipt family diverges on the member shape.** Lane A returns
  `{schemaVersion: 1, waveId, members: [{role, runId, phase?, progressClass?}]}`
  (`application.mjs:11791-11795`); the `waves.run` acceptance returns `members` as BARE ROLE
  STRINGS (`workflow-interpreter.mjs:649-651`: `spec.members.map((member) => member.role)`). Two
  receipts for one lifecycle, two member shapes — a driver composing both verbs cannot key
  members to runs without the settlement read (which is itself unreadable, GT-L3).
- **GT-L15 — a sixth `workflow_*` code is minted outside the interpreter's closed five.** The
  interpreter's refusal set is closed at five (`workflow-interpreter.mjs:29-34`), but the settle
  leg's failure record mints `workflow_settle_failed` at `application.mjs:11660`
  (`cause?.code ?? 'workflow_settle_failed'` inside the `wave.settled` onSettle record). The MCP
  allowlist admits ANY `workflow_*` prefix (`mcp-northbound.mjs:262-266`), so the prefix family is
  open-ended in practice while claiming to be closed. The code itself is correct behavior (a
  failed settle mints the error, never silence); the defect is that it is undocumented in the
  closed set.
- **GT-L16 — `detach` is not type-checked at the application seam.** `application.mjs:11654`:
  `const detach = request.detach !== false;` — a string `'false'`, `0`, or any non-`false` value
  silently detaches. The waves.run request has NO normalizer (unlike `_normalizeWaveStart` /
  `_normalizeWaveProgress`); unknown request fields are ignored silently. The interpreter's own
  branch is strict (`options.detach === true`, `workflow-interpreter.mjs:644`) but only ever
  receives the already-coerced boolean.

## 2c. Decisions, continuation (D7 … D10)

- **D7 — one economic act, one verdict law (total failure), two documented lanes (partial).**
  Total start failure refuses on BOTH lanes (lane B adopts lane A's fail-closed posture via v1's
  D1/PIN-L1 — code `wave_start_all_members_failed`, members enumerated). Partial failure stays
  lane-specific BY DESIGN and documented at both doors: lane A (`waves.start`) keeps D5.1's
  any-failure refusal (a caller composing members one shot wants all-or-refused); lane B
  (`waves.run`) continues the live members and surfaces the dead ones on the receipt (D6) — a
  workflow roster is declared work, not an atomic transaction. Options: (a) unify both lanes on
  continue-on-partial (REJECTED — breaks D5.1's landed contract and its suite); (b) unify both on
  refuse-on-any (REJECTED — kills a wave of 8 because member 5's route was stale; the #199 members
  row contracts the creation events, and this row refuses to amplify one bad member into a
  refused wave); (c) documented asymmetry (CHOSEN). Fold must reconcile with the members row.
- **D8 — the partial-start refusal enumerates the live members.** Lane A's `wave_member_invalid`
  detail gains one key: `started: [{role, runId}]` — every member already live at refusal time,
  so the refused caller can stop exactly those. No new code; the D5.1 shape extends additively.
- **D9 — the `workflow_*` family closes at SIX, declared where it is minted.**
  `workflow_settle_failed` joins the interpreter's declared set (a const beside
  `workflow-interpreter.mjs:29-34` or an explicit application-side declaration cited from
  `application.mjs:11660`), and the family enumeration is pinned at six — the MCP prefix arm
  (`mcp-northbound.mjs:262-266`) stays, but the PREFIX now names a closed set the docs and the
  code agree on. A seventh `workflow_*` code without a contract amendment is a finding.
- **D10 — the waves.run request gets a normalizer; `detach` is boolean-only.**
  `runWorkflow` validates its request fields (`spec`/`specDsl`/`specPath`/`detach`/`driver`
  closed-set, mirroring `_normalizeWaveStart` at `application.mjs:12018+`); a non-boolean `detach`
  or an unknown field refuses the new typed `workflow_request_invalid` (vocabulary below) — never
  silent ignore, never coercion.

## 3c. Refusal vocabulary, continuation

Additions to §3 (the NEW-code set closes at five, not three — the two additions are declared
here, and this list is exhaustive):

| Code | Meaning | Refusal shape |
|---|---|---|
| `workflow_request_invalid` | the waves.run request itself is malformed (unknown field, non-boolean `detach`) | `{field}` — the offending request field |
| `workflow_settle_failed` | the settle leg threw; the error minted into the durable `wave.settled` record (declared, per D9 — not new mint, newly declared) | the record's `{error: {code, message}}` |

The extended detail key (D8) — `started: [{role, runId}]` on `wave_member_invalid` — is a refusal
SHAPE extension, not a new code.

## 4c. Red-first acceptance pins, continuation (PIN-L9 … PIN-L12)

- **PIN-L9 — the same failure cannot get opposite verdicts on the two lanes.**
  Stage: both doors — `waves.start` direct port (`application.mjs:11754-11786`) and the
  facade/createWave door (`wave.mjs:226-253` via `workflow-interpreter.mjs:549`). RED at HEAD
  (GT-L12): an all-members-failing roster refuses `wave_member_invalid` at door A and mints
  `{accepted: true, verdict: 'WAVE-ADMITTED'}` at door B. Green: BOTH doors refuse (door A its
  `wave_member_invalid` with every member's cause; door B `wave_start_all_members_failed`) — no
  door returns a success shape for a wave with zero live members. Shallow-green trap: greening
  door B by making door A swallow (unifying downward) fails — the pin asserts BOTH refusals.
- **PIN-L10 — the partial-start refusal names its live members.**
  Stage: lane A's D5.1 throw (`application.mjs:11773-11786`). RED at HEAD (GT-L13): a 5-member
  roster whose member 3 refuses yields `wave_member_invalid` whose detail carries
  `{actual?, cap?, cause, role}` — no `started` key; members 1-2 are live, un enumerable,
  un-stoppable from the refusal. Green: detail carries `started: [{role, runId}]` exactly for the
  members started before the refusal (asserted against the live registry, not a synthesized
  list). Shallow-green trap: `started: []` on a genuinely-partial refusal fails the pin.
- **PIN-L11 — the receipt family speaks one member shape.**
  Stage: acceptance mint (`workflow-interpreter.mjs:647-653`). RED at HEAD (GT-L14): acceptance
  `members` is an array of strings. Green: acceptance `members` is
  `[{role, runId, admitted}]` (runId null for a start-refused member, per v1 D6/D7) — key-compatible
  with lane A's roster (`application.mjs:11791-11795`) modulo the admitted flag. Shallow-green
  trap: `[role, runId]` without `admitted` fails — partial-failure truth (D7c) rides this key.
- **PIN-L12 — `detach` is boolean or refused; the request is closed.**
  Stage: `runWorkflow` request admission (`application.mjs:11633-11654`, new normalizer per D10).
  RED at HEAD (GT-L16): `detach: 'false'` (string) silently detaches; unknown request fields are
  silently ignored. Green: non-boolean `detach` and unknown fields refuse `workflow_request_invalid`
  naming the field; `{detach: false}`, `{detach: true}`, and absent all behave exactly as v1
  PIN-L4 pins. Shallow-green trap: coercing `'false'` to `false` (accept-then-fix) fails — the
  pin asserts the typed refusal.

## 5c. Open questions, continuation

- **OQ-L6 (fold item, with the members row):** the D7c documented asymmetry (refuse-on-any at
  `waves.start`, continue-on-partial at `waves.run`) is a judgment call this row owns; the members
  row's #199 creation-events contract must not contradict it (its typed `task` events fire for
  lane B's continued members — the same members lane A would have refused the whole wave over).
  DECISION_REQUEST if the members row's fold lands a different law.

---

*(v1 sections §1–§7 above are unchanged by this tranche except where explicitly sharpened:
GT-L12 supersedes GT-L2's framing — the unconditional acceptance is the lane-B half of the
two-lane split — while v1's pins stand as written. The version is now v1.1.)*

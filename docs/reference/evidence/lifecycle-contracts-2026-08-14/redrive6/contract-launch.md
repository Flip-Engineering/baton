# CONTRACT-LAUNCH v2.0 — the launch/receipt honesty contract (package ③, row row-lc-launch)

[attempt: 0b60dbeb-913e-4a9c-a6ee-3329e8bd75f4 row-lc-launch]

Issue set: #173 (synchronous launch / acceptance-receipt) · #202 (bare-text response shapes) ·
#207 (objectiveRef admission alignment + startError on the wire + the unused spill graceful path).
Base: this worktree at `dc476d87` (`impl/src` is the shipped HEAD — no docs-only lag this round).
Ring-2 form: ground truths → decisions → refusal vocabulary → red-first acceptance pins → open
questions. Every anchor below was re-verified this session with `grep -an`/`sed -n` (NUL discipline
on `application.mjs`/`coordination-store.mjs`; plain grep elsewhere); line numbers are HEAD
numbers. No clocks anywhere. Sorted-key literals in ACTUAL order.

**Judgment call, recorded (§8):** the row brief's deliverable path (`…/contract-launch.md`) is the
stale foundry-era string; the machine-enforced constraint is "Work only within
`…/redrive6/**`". This contract lands in `redrive6/` — the operative current redrive — and the
path discrepancy is carried as a judgment call, per the redrive-4 self-label precedent the fs
row's QA nit flagged.

**Headline (the redrive correction the fold must carry):** two things changed since redrive3's
v1.1 (`09200e9`). FIRST, the phantom-surfacing fix `852700a5` landed — the interpreter now reads
`wave.progress()` for members absent from `wave.runs` and carries `terminalCause: 'start'` + the
captured `startError` into the SETTLEMENT receipt outcomes (`workflow-interpreter.mjs:647-661` →
`:700-702`). redrive3's GT-L8 ("startError never reaches either receipt") is therefore GREEN for
the settlement path at HEAD — any redrive6 pin restating it would be shallow-greenable. What
remains RED is the ACCEPTANCE half of that claim (the acceptance receipt still carries bare role
strings and mints `accepted: true / WAVE-ADMITTED` unconditionally), plus a NEW sharper lie the
settlement verdict now makes (see GT-L8b). SECOND, the #173 fix is confirmed landed at the
application port (`application.mjs:11695`, `const detach = request.detach !== false`) — the
foundry-era "synchronous waves.run" form is gone. A pin reading "waves.run is still synchronous"
would be green at HEAD and shallow; the pins below target only what is RED.

## 1. Ground truths (each verified at HEAD `dc476d87` this session)

### The launch leg (#173)

- **GT-L1 — waves.run detaches at the application port; the recipes embedded leg still defaults
  to sync.** `application.mjs:11695` (`const detach = request.detach !== false;` — default true,
  `#173 (2026-08-14)` comment at `:11693-11694`); the interpreter's acceptance branch at
  `workflow-interpreter.mjs:745` (`if (options.detach === true)`) with the acceptance mint at
  `:748-755`; the sync fall-through `return settle();` at `:765`. The embedded `recipes.runWorkflow`
  leg passes only `{repoRoot, ...invocation}` (`recipes.mjs:582`) — with no `detach` in the
  invocation the interpreter returns the seven-key settlement synchronously. Both defaults are
  deliberate (the application comment names `detach:false` as "the suites' path"); the RED is not
  the default but the acceptance lie (GT-L2) and the unreadable settlement (GT-L3).

- **GT-L2 — the acceptance receipt is unconditional.** `workflow-interpreter.mjs:748-755`:
  `{accepted: true, manifestDigest, members: [role strings], schemaVersion: 1, verdict:
  'WAVE-ADMITTED', waveId}` — frozen verbatim regardless of member start outcomes, because the
  lane-B door (`baton.waves.start` → `createWave`, `application-client.mjs:1555`) NEVER throws on
  per-member failure: `wave.mjs:189-256` starts members individually, catches each throw into
  `entry.startError` (`:250`), and returns the handle. A wave in which EVERY member refused at
  run.start still mints `accepted: true / WAVE-ADMITTED`, and a detached caller has no readable
  truth to correct it (GT-L3). This is redrive3's GT-L2, re-verified unchanged.

- **GT-L3 — the settlement receipt is durable but unreadable.** The `wave.settled:<waveId>`
  record is minted via `recordDriver` (`application.mjs:11696-11708`, kind constant
  `APPLICATION_WAVE_SETTLED_KIND = 'wave.settled'` at `:145`), keyed `wave.settled:${waveId}`.
  A grep for every reader of `wave.settled` / `APPLICATION_WAVE_SETTLED_KIND` across `impl/src`
  finds the WRITE sites only (`application.mjs:11699`, the kind const at `:145`); the single
  other hit (`coordinator.mjs:4459`) is an unrelated `plan_wave_settled_failed` code. No
  `waves.*` verb reads it: `waves.progress` (`application.mjs:11843-11881`) returns a per-member
  projection `{schemaVersion, waveId, cursor, nextCursor, members}` with `{role, phase,
  progressClass, attention, knowledge}` rows only; `waves.list` is the registry projection
  (`.waveRegistry()` open rows). A detached caller can learn member phases but never the wave's
  own settlement truth.

- **GT-L4 — `detach` is unreachable from every transport.** The MCP `baton_waves_run` tool
  schema admits only `{repoId, spec, specDsl}` (`mcp-northbound.mjs:609-615`); the handler
  forwards only `{spec}` (`:1915-1927`, `value = await this.application.command('waves.run',
  { spec })`); a caller supplying `detach` draws `unknown_argument_field` at `validateArguments`
  (`mcp-northbound.mjs:1012-1022`). The CLI parses `waves run` to `{specPath}` only
  (`application-cli.mjs:1368-1373`). The semantic registry's `waves.run` schema is
  `{idempotencyKey, spec, specDsl, specPath, driver}` — no `detach` key
  (`application-semantics.mjs:1637-1649`, `driver` at `:1646`). The synchronous seven-key
  settlement receipt (`workflow-interpreter.mjs:733-742`) is therefore embedded-only.

- **GT-L4b — waves.progress answers an unknown waveId with silence.** `_normalizeWaveProgress`
  (`application.mjs:12107`) validates shape only; the handler filters the run list by waveId
  (`:11854-11856`) and an unknown waveId yields `{schemaVersion: 1, waveId, cursor: 0,
  nextCursor: null, members: []}` — a success page, not a typed refusal. Silence-is-not-death
  cuts both ways: an empty page is indistinguishable from a finished-and-reaped wave.

### The admission seam (#207)

- **GT-L5 — the interpreter admits by-reference objectives to 64 KiB.** `OBJECTIVE_REF_MAX_BYTES
  = 64 * 1024` at `workflow-interpreter.mjs:46` (drifted from the row brief's `:39` — re-anchored
  here per the fold's re-anchor law); enforced at `renderObjective` (`:340-355`), which reads the
  objectiveRef file, bounds it, and renders the FULL body into the member objective with the salt
  prefix `[attempt: <salt> <role>] `.

- **GT-L6 — run.start's objective lane is graceful at HEAD.** `application.mjs:4519-4541`:
  oversize above the 4096-byte `run.objective` cap (`limits.mjs:56`) up to the 1 MiB `spill.body`
  ceiling (`limits.mjs:86`) is ADMITTED with a durable spill artifact and a bounded head +
  `[SPILLED {citation}]` suffix; only beyond the ceiling draws the typed coaching refusal
  `spill_body_exceeded` (`:4526-4527`). The wave-member path rides the same admission: the
  lane-A normalizer `_normalizeWaveStart` deliberately shape-checks the objective only —
  "never a wall in front of a spill lane (v1.2 blue-team blocker 4)" (`application.mjs:12071-12100`,
  objective rule at `:12083-12085`). A 4–64 KiB brief therefore no longer phantom-fails on the
  embedded path at HEAD (the foundry-era #207 phantom is repaired at the admission).

- **GT-L7 — the graceful path exists UNUSED on every advertised surface.** The ADVERTISED input
  schemas still hard-declare `maxLength: FRAME_LIMITS['wave.member.objective'].value` (= 4096) on
  the lanes the registry declares `graceful: 'spill-digest-citation'`:
  `mcp-northbound.mjs:539` (baton_waves_attach member objective), `:559` (baton_waves_start member
  objective); `application-semantics.mjs:1559` (waves.attach), `:1583` (waves.start). A
  schema-honoring MCP client never sends more than 4096 characters, so the spill path is
  unreachable from any transport even though the admission beneath it is graceful — the
  advertisement walls the lane the admission admits. (The `waves.run` spec path rides
  `objectiveRef`, so the interpreter's own render bypasses these schemas — the wall bites the
  `waves.start`/`waves.attach` doors and any schema-validated intent, not the interpreter.)

- **GT-L7b — `limits.mjs:57` declares an enforcement point that does not enforce.**
  `wave.member.objective` claims `enforcedAt: 'application startWave/attachWave member admission'`,
  but at HEAD `_normalizeWaveStart` is shape-only by design (`application.mjs:12083-12085`) and
  the actual hard refusal fires at run.start (`application.mjs:4526-4527`, `spill_body_exceeded`).
  The registry's declared enforcement-point discipline (each admission row names its real
  enforcer) is violated for this row.

- **GT-L8 — the captured startError reaches the SETTLEMENT receipt via phantom surfacing
  (repaired at HEAD), and NOT the acceptance receipt.** `wave.mjs:235-251` captures
  `{code, message}` per failed member into `entry.startError`; `wave.mjs:353` projects a
  start-refused member as `{role, phase: 'failed', terminalCause: 'start', terminal: true, error:
  entry.startError}` in `progress()`, and `wave.mjs:472` does the same in `settle()`. The
  interpreter's settle now reads `wave.progress()` for members absent from `wave.runs`
  (`workflow-interpreter.mjs:647-661`), builds each phantom preOutcome with `terminalCause:
  'start'` + the error (`:664-672`), and carries `outcome.error` into the receipt (`:700-702`).
  So a start-failed member's settlement outcome at HEAD is `{role, phase: 'failed', terminal:
  true, resultSha: null, terminalCause: 'start', error: {code, message}}` — redrive3's GT-L8
  settlement half is FIXED. The ACCEPTANCE receipt, however, still carries bare role strings
  (GT-L2) — a start-refused member appears in it as a role name with no admission truth, and the
  verdict is `WAVE-ADMITTED`. redrive3's PIN-L2 must be re-scoped to the acceptance half.

- **GT-L8b — the settlement verdict on a never-started wave is WAVE-INCOMPLETE / basis
  manifestDigest — the verdict vocabulary has no never-started class.** On a phantom-all wave the
  drive exits `'pending_empty'` (driveLane's `processMember` deletes a phantom from `pending`
  without setting any exit, `workflow-interpreter.mjs:864`; `return { exit: exit ??
  'pending_empty', quiescence }` at `:1010`); every phantom outcome is `terminal: true` so
  `everySettled` is true (`:723`); every harvest entry misses (`harvest_miss`) so `everyHarvested`
  is false (`:724`); verdict computes `WAVE-INCOMPLETE` (`:728-729`); basis is `manifestDigest`
  (`:730`). The receipt therefore reads as a wave that ran and failed to harvest — never as a wave
  that never admitted a single member. The #163 law's verdict enum (`WAVE-OK / WAVE-QUIESCED /
  WAVE-INCOMPLETE`) has no start-failed class; the per-member start causes ARE present in outcomes
  (GT-L8), but the wave-level verdict misdescribes the lifecycle event.

### The response-shape seam (#202)

- **GT-L9 — the doctor surface is structured at HEAD.** MCP `baton_deployment_doctor` →
  `_freshDoctorReadiness()` (`mcp-northbound.mjs:2256-2268`) with secret-stripping sanitize
  (`:2273-2285`); dispatch `deployment.doctor` → `this.doctorReadiness()`
  (`application.mjs:12780`, the ordinary facade's rich closed record at `:12593-12625`); the
  deployment facade's override returns a structured `{...readiness, routes, workspace}` record
  (`application-deployment.mjs:1335-1375`). The incident string `'Command executed successfully.'`
  does not exist anywhere in `impl/src` at HEAD (grep over all `*.mjs`) — the offending producer
  is gone.

- **GT-L10 — the bare-text degrade class survives at two verbatim seams.** (a)
  `_sanitizeDoctorReadiness` passes a NON-RECORD readiness through verbatim
  (`mcp-northbound.mjs:2273`: `if (!record(value)) return value;`) — a doctor lane that returns a
  bare string reaches the wire unrefused and un-stripped. (b) `toolResult` wraps any non-record
  value as `{result: <value>}` (`mcp-northbound.mjs:196-199`) — so that string serializes as
  `{"result":"Command executed successfully."}`, the EXACT #202 wire shape. Neither seam refuses
  typed; the class that produced the incident is one careless lane-return away.

### The two-lane truth (redrive3 v1.1 tranche, re-verified)

- **GT-L12 — two wave-start lanes, opposite failure semantics.** Lane A, the `waves.start` direct
  port (`application.mjs:11775-11841`): ANY member run.start refusal THROWS the typed
  `wave_member_invalid` carrying `{actual?, cap?, cause, role}` with the inner code preserved
  (`:11814`, `:11824`; the D5.1 law "the response is never a success shape"). Lane B, the facade
  lane the interpreter rides: `baton.waves.start` binds to `createWave`
  (`application-client.mjs:1555`), which catches each member's throw into `entry.startError` and
  RETURNS the handle (`wave.mjs:189-256`) — no refusal, ever. `waves.run` rides lane B
  (`workflow-interpreter.mjs:612-619`). So the identical member failure — say an out-of-profile
  exact route — refuses `wave_member_invalid` on `waves.start` and mints `accepted: true /
  WAVE-ADMITTED` on `waves.run`. Surface-constancy is violated at the verdict level.

- **GT-L13 — the partial-start refusal drops the live-members truth.** Lane A refuses on the
  FIRST failing member, but members started before the failure are LIVE runs with no rollback in
  the loop (`application.mjs:11780-11814` — the throw propagates; no stop/cleanup), and the
  refusal's detail carries only the failing member's `{actual?, cap?, cause, role}` (`:11814-11822`).
  A refused caller of `waves.start` cannot learn from the refusal that earlier members are live
  (and billable) — the inverse of GT-L2's lie: there the receipt claims members that are dead;
  here the refusal hides members that are alive.

- **GT-L14 — the launch-receipt family diverges on the member shape.** Lane A returns
  `{schemaVersion: 1, waveId, members: [{role, runId, phase?, progressClass?}]}`
  (`application.mjs:11829-11836`); the `waves.run` acceptance returns `members` as BARE ROLE
  STRINGS (`workflow-interpreter.mjs:749-751`: `spec.members.map((member) => member.role)`). Two
  receipts for one lifecycle, two member shapes — a driver composing both verbs cannot key members
  to runs without the settlement read (which is itself unreadable, GT-L3).

- **GT-L15 — a sixth `workflow_*` code is minted outside the interpreter's closed five.** The
  interpreter's refusal set is closed at five (`workflow-interpreter.mjs:36-40`), but the settle
  leg's failure record mints `workflow_settle_failed` at `application.mjs:11701`
  (`cause?.code ?? 'workflow_settle_failed'` inside the `wave.settled` onSettle record). The MCP
  allowlist admits ANY `workflow_*` prefix (`mcp-northbound.mjs:264`: `cause.code.startsWith('workflow_')`; the lane-crafted arms at `:205-223`),
  so the prefix family is open-ended in practice while claiming to be closed. The code itself is
  correct behavior; the defect is that it is undocumented in the closed set.

- **GT-L16 — `detach` is not type-checked at the application seam.** `application.mjs:11695`:
  `const detach = request.detach !== false;` — a string `'false'`, `0`, or any non-`false` value
  silently detaches. The waves.run request has NO normalizer (unlike `_normalizeWaveStart` at
  `:12071` / `_normalizeWaveProgress` at `:12107`); unknown request fields are ignored silently.
  The interpreter's own branch is strict (`options.detach === true`, `workflow-interpreter.mjs:745`)
  but only ever receives the already-coerced boolean.

- **GT-L17 — the settle leg discards the close receipt and drops nothing else.** The close
  receipt from `wave.close` is discarded (`workflow-interpreter.mjs:732`: `void stopReceipt;`),
  but — unlike redrive3 — the settle now builds outcomes from `preOutcome` + the phantom detail
  BEFORE the close (`:653-706`), so the discard no longer drops the start errors (GT-L8). The
  discard remains relevant only for the `wave.close` stop-receipt's own field (reason/runIds),
  which the settlement receipt does not carry. Not RED by itself; recorded to keep redrive3's
  GT-L8 correction scoped.

## 2. Decisions (judgment calls recorded; options where the call is arguable)

- **D1 — total start failure refuses the launch (fail-closed), partial failure rides the
  receipt.** When EVERY member's run.start refuses, minting `accepted: true` is a lie (GT-L2); the
  launch must throw the new typed `wave_start_all_members_failed` naming each member's captured
  startError verbatim, before any acceptance is frozen. Partial failure keeps the acceptance (the
  live members are real work) with per-member admission truth added (D6). Rationale: an empty wave
  has nothing to drive — detaching it wastes the settle leg and reports WAVE-INCOMPLETE with zero
  cause, the GT-L8b shape. (Carries redrive3 D1 forward; unchanged.)

- **D2 — the settlement receipt becomes readable on the launch surface, additively.**
  `waves.progress` gains one closed key (`settlement`) carrying the durable `wave.settled:<waveId>`
  record's verdict/basis (or null while unsettled). Options: (a) extend waves.progress (CHOSEN —
  one read path, no new verb, additive to a schemaVersion-1 response); (b) a new `waves.settlement`
  verb (rejected: verb-table growth for one projection); (c) stuff it into waves.list rows
  (rejected: list is the registry projection, not wave truth). (Carries redrive3 D2 forward.)

- **D3 — `detach` becomes a real parameter on both transports.** MCP `baton_waves_run` schema adds
  optional boolean `detach` (default true), forwarded verbatim by the handler; non-boolean refuses
  the existing typed `invalid_workflow_run` (surface-constant). CLI `baton waves run` gains
  `--sync` mapping to `detach: false`. The embedded default stays true (the #173 fix's posture:
  never hold the bus by default). (Carries redrive3 D3 forward.)

- **D4 — the advertisement must tell the admission's truth.** On every graceful byte lane the
  advertised bound becomes the ADMISSION bound (the 1 MiB `spill.body` ceiling — what actually
  refuses is beyond-ceiling), with the 4096 head + spill citation documented in the tool
  description; and `limits.mjs:57`'s `enforcedAt` is corrected to name run.start, the real
  enforcement point. Options: (a) advertise the ceiling (CHOSEN); (b) drop maxLength entirely and
  document the refusal (rejected: honest clients lose the upper bound signal); (c) wall the
  admission back to 4096 (REJECTED HARD — it reinstates the #207 phantom and violates the "never
  a wall in front of a spill lane" law at `application.mjs:12084`). (Carries redrive3 D4 forward.)

- **D5 — the #202 degrade seams refuse typed.** `_sanitizeDoctorReadiness` refuses a non-record
  readiness with the new typed `deployment_readiness_invalid` (never a pass-through); the
  launch-family tool results (doctor, waves.*) are pinned as closed records — the `{result: <string>}`
  envelope at `mcp-northbound.mjs:196-199` remains legal for genuinely-scalar lanes but is pinned
  RED for this family. Rationale: the incident's producer is gone (GT-L9) but the class is one
  lane-return away (GT-L10); pins must hold the CLASS, not the corpse. (Carries redrive3 D5 forward.)

- **D6 — the acceptance receipt carries per-member admission truth; the settlement receipt keeps
  the repaired phantom causes.** The acceptance `members` become `[{role, runId, admitted}]` —
  `runId` null and `admitted: false` for a start-refused member, with the captured startError in a
  `startError: {code, message}` key on that row (D7's continue-on-partial). The settlement receipt
  already carries the causes (GT-L8); the acceptance is the missing half. (Re-scopes redrive3 D6:
  the settlement half is now a repair-preservation law, not a new mint.)

- **D7 — one economic act, one verdict law (total failure), two documented lanes (partial).**
  Total start failure refuses on BOTH lanes (lane B adopts lane A's fail-closed posture via D1 —
  code `wave_start_all_members_failed`, members enumerated). Partial failure stays lane-specific BY
  DESIGN and documented at both doors: lane A (`waves.start`) keeps D5.1's any-failure refusal; lane
  B (`waves.run`) continues the live members and surfaces the dead ones on the receipt (D6). (Carries
  redrive3 D7 forward.)

- **D8 — the partial-start refusal enumerates the live members.** Lane A's `wave_member_invalid`
  detail gains one key: `started: [{role, runId}]` — every member already live at refusal time, so
  the refused caller can stop exactly those. No new code; the D5.1 shape extends additively.
  (Carries redrive3 D8 forward.)

- **D9 — the `workflow_*` family closes at SIX, declared where it is minted.**
  `workflow_settle_failed` joins the declared set (a const beside `workflow-interpreter.mjs:36-40`
  or an explicit application-side declaration cited from `application.mjs:11701`), and the family
  enumeration is pinned at six — the MCP prefix arm stays, but the PREFIX now names a closed set the
  docs and the code agree on. A seventh `workflow_*` code without a contract amendment is a finding.
  (Carries redrive3 D9 forward.)

- **D10 — the waves.run request gets a normalizer; `detach` is boolean-only.**
  `runWorkflow` validates its request fields (`spec`/`specDsl`/`specPath`/`detach`/`driver`
  closed-set, mirroring `_normalizeWaveStart` at `application.mjs:12071`); a non-boolean `detach`
  or an unknown field refuses the new typed `workflow_request_invalid` — never silent ignore, never
  coercion. (Carries redrive3 D10 forward.)

- **D11 — the settlement verdict vocabulary gains a never-started class.** The verdict enum adds
  `WAVE-START-FAILED` (or a name the fold's verdict owners prefer) computed on a phantom-all
  settle — `everySettled` true AND every outcome `terminalCause: 'start'` — so a never-started wave
  receipts a verdict that names the event, not WAVE-INCOMPLETE. Basis stays the manifestDigest.
  Options: (a) new verdict value (CHOSEN — the enum is closed, so this is a deliberate amendment,
  rippling to every verdict consumer); (b) refuse at admission only (D1) and let the settle verdict
  stay WAVE-INCOMPLETE as an unreachable-path backstop (rejected: the settle leg can still be
  reached via `detach:false` on an admission that partial-failed, and D1's fail-closed already
  prevents the total case — but a crash between admission and settle must not mislabel the record);
  (c) verdict stays, receipt gains a `startFailed: true` marker (rejected: two flags for one event).

- **D12 — the phantom surfacing becomes a guaranteed path, not a best-effort read.** The settle's
  phantom detail read (`workflow-interpreter.mjs:650-660`) is wrapped in try/catch: if
  `wave.progress()` throws, `phantomDetail` stays empty and a phantom preOutcome falls back to
  `error: null` (`:670-672`) — the captured startError is dropped on a progress-read failure. The
  impl must source the phantom detail from the wave handle's OWN `settle()` outcome map (which
  carries `entry.startError` directly, `wave.mjs:472`) rather than a second `progress()` read, so
  the surfacing is single-source and cannot be lost to a read race.

## 3. Refusal vocabulary (closed, typed, surface-constant)

Existing codes this contract depends on, unchanged (each verified at HEAD):

| Code | Minted at | Anchor |
|---|---|---|
| `workflow_spec_invalid` / `workflow_member_invalid` / `workflow_steering_unknown` / `workflow_harvest_invalid` / `workflow_objective_ref_invalid` | interpreter validation/render | `workflow-interpreter.mjs:36-40` |
| `spill_body_exceeded` | run.start objective beyond the 1 MiB ceiling (the ONLY hard refusal on these lanes) | `application.mjs:4526-4527`, `limits.mjs:56/86` |
| `application_wave_start_invalid` | startWave normalization | `application.mjs:12071-12086` |
| `wave_member_invalid` | lane A any-failure refusal (D5.1) | `application.mjs:11814`, `:11824` |
| `wave_not_found` | a wave member run no longer available | `application.mjs:11928`, `:11958` |
| `invalid_workflow_run` / `invalid_wave_start` / `unknown_argument_field` | MCP argument guards | `mcp-northbound.mjs:1012-1022` |
| `coordinator_authority_forbidden` | coordinator seat reaching a launch verb | `application.mjs:12763-12765` |

NEW codes this contract adds (closed set; surface-constant across embedded/MCP/CLI — the MCP
stateFailureCode allowlist must admit all of these):

| Code | Meaning | Refusal shape |
|---|---|---|
| `wave_start_all_members_failed` | every member's run.start refused; the wave is empty | `{members: [{role, error: {code, message}}]}` — each startError verbatim |
| `wave_unknown` | waves.progress asked for a waveId with no bound runs | `{waveId}` — never an empty success page |
| `deployment_readiness_invalid` | the doctor lane produced a non-record readiness | `{actual: typeof}` — refused at the sanitize seam |
| `workflow_request_invalid` | the waves.run request itself is malformed (unknown field, non-boolean `detach`) | `{field}` — the offending request field |
| `workflow_settle_failed` | the settle leg threw; the error minted into the durable `wave.settled` record (declared, per D9 — not new mint, newly declared) | the record's `{error: {code, message}}` |

The extended detail keys — D8's `started: [{role, runId}]` on `wave_member_invalid`, and D6's
per-member `admitted` / `startError` on the acceptance — are refusal/receipt SHAPE extensions, not
new codes. No prose-string refusals; no numeric-limit refusals beyond the registry's declared
lanes; no clocks.

## 4. Red-first acceptance pins

Each pin names its stage (where the pin test hooks), is RED at HEAD `dc476d87`, and greens ONLY
for a correct impl (a shallow greening is itself a defect — the QA's fold instruction 2).

- **PIN-L1 — the acceptance must not lie on total start failure.**
  Stage: interpreter launch (`workflow-interpreter.mjs` runWorkflow, the waves.start → acceptance
  span `:554-765`). RED at HEAD: a valid spec whose members' exact routes are all outside the
  deployment profile → every run.start refuses inside createWave (`wave.mjs:250`), and waves.run
  still returns `{accepted: true, verdict: 'WAVE-ADMITTED'}` (GT-L2). Green: the typed
  `wave_start_all_members_failed` refusal reaches the caller (all surfaces), naming every member's
  startError code verbatim; NO acceptance is minted; NO settle leg runs. Shallow-green trap: an
  impl that flips `verdict` to a failure string but still returns `accepted: true` fails this pin.

- **PIN-L2 (re-scoped to the acceptance half) — startError rides the acceptance receipt; the
  settlement's repaired phantom causes are preserved.**
  Stage: acceptance mint (`workflow-interpreter.mjs:748-755`) + settlement build (`:647-706`).
  RED at HEAD: a start-refused member appears in the acceptance as a bare role string with no
  `admitted`/`startError` key, and the acceptance still says `WAVE-ADMITTED` even when every member
  is start-refused (GT-L8, GT-L2). Green: the acceptance members carry
  `[{role, runId, admitted, startError?}]` with `startError: {code, message}` verbatim from
  `wave.mjs:250`'s capture; AND the settlement outcomes still carry `terminalCause: 'start'` +
  `error` (the 852700a5 repair must not regress). Shallow-green trap: synthesizing a generic error
  (`{code: 'start_failed'}`) instead of the captured code fails — the pin asserts code EQUALITY
  with the run.start refusal; and an impl that regresses the settlement surfacing while fixing the
  acceptance also fails (the pin holds both halves).

- **PIN-L3 — the settlement receipt is readable from the launch surface.**
  Stage: waves.progress read (`application.mjs:11843-11881`). RED at HEAD: no waves.* response
  contains any settlement field (GT-L3); the durable `wave.settled:<waveId>` record is minted
  (`application.mjs:11696-11708`) but no verb returns it. Green: after a detached run settles, the
  decided read (D2: waves.progress `settlement` key) returns the recorded verdict/basis; before
  settlement it is null (not absent — null). Shallow-green trap: returning a LIVE-computed verdict
  instead of the durable record fails — the pin asserts the value equals the `wave.settled` record
  (or the recorded error shape when the settle leg failed), including its idempotent re-read.

- **PIN-L4 — `detach` is reachable and typed on both transports.**
  Stage: MCP argument admission (`mcp-northbound.mjs:1012-1022`, schema `:609-615`, handler
  `:1915-1927`) + CLI parse (`application-cli.mjs:1368-1373`). RED at HEAD: `baton_waves_run` with
  `detach: false` draws `unknown_argument_field` (GT-L4); the CLI has no sync flag. Green:
  `detach: false` through MCP returns the synchronous seven-key settlement receipt
  (`workflow-interpreter.mjs:733-742` — exact keys, sorted); `detach: true` (and absent) returns
  the acceptance; a non-boolean detach refuses `invalid_workflow_run`. Shallow-green trap: an impl
  that detaches regardless of the flag (ignoring it after admission) fails the seven-key assertion.

- **PIN-L5 — the advertised bound equals the admission bound on the graceful lanes.**
  Stage: MCP schema advertisement (`mcp-northbound.mjs:539`, `:559`) vs the admission
  (`application.mjs:4519-4541`). RED at HEAD: advertised `maxLength` 4096 on lanes whose admission
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
  (`application.mjs:12083-12085` shape-only by design; GT-L7b). Green: the row's `enforcedAt` names
  run.start (where `spill_body_exceeded` actually fires), and `run.objective`/`wave.member.objective`
  rows still declare the same graceful path and ceiling. (Registry digest discipline: the row set
  stays closed; only the prose field corrects.)

- **PIN-L7 — the bare-text degrade class refuses typed at the wire.**
  Stage: `_sanitizeDoctorReadiness` (`mcp-northbound.mjs:2273-2285`) + `toolResult` (`:196-199`).
  RED at HEAD: a string-returning doctor seam (test double at the readiness supplier) passes
  through verbatim and serializes as `{result: "<text>"}` — the exact #202 wire shape (GT-L10).
  Green: the typed `deployment_readiness_invalid` refusal; and the doctor tool's structuredContent
  is a closed record (schemaVersion-carrying) for every readiness producer. Shallow-green trap:
  pinning only the incident's literal string (grep for 'Command executed successfully.') greens
  nothing — the pin drives an ARBITRARY string through the seam.

- **PIN-L8 — an unknown waveId refuses, never an empty page.**
  Stage: waves.progress handler (`application.mjs:11843-11881`). RED at HEAD: a well-formed but
  unknown `wave:…` id returns `{members: [], nextCursor: null}` — success-shaped silence (GT-L4b).
  Green: the typed `wave_unknown` refusal `{waveId}`; an EMPTY-but-real wave (all members reaped)
  must remain distinguishable from an unknown one (the pin asserts the refusal fires only when the
  registry has no binding, not when phases are all terminal).

- **PIN-L9 — the same failure cannot get opposite verdicts on the two lanes.**
  Stage: both doors — `waves.start` direct port (`application.mjs:11775-11841`) and the
  facade/createWave door (`wave.mjs:189-256` via `workflow-interpreter.mjs:612-619`). RED at HEAD
  (GT-L12): an all-members-failing roster refuses `wave_member_invalid` at door A and mints
  `{accepted: true, verdict: 'WAVE-ADMITTED'}` at door B. Green: BOTH doors refuse (door A its
  `wave_member_invalid` with every member's cause; door B `wave_start_all_members_failed`) — no
  door returns a success shape for a wave with zero live members. Shallow-green trap: greening
  door B by making door A swallow (unifying downward) fails — the pin asserts BOTH refusals.

- **PIN-L10 — the partial-start refusal names its live members.**
  Stage: lane A's D5.1 throw (`application.mjs:11814-11822`). RED at HEAD (GT-L13): a 5-member
  roster whose member 3 refuses yields `wave_member_invalid` whose detail carries
  `{actual?, cap?, cause, role}` — no `started` key; members 1-2 are live, un-enumerable,
  un-stoppable from the refusal. Green: detail carries `started: [{role, runId}]` exactly for the
  members started before the refusal (asserted against the live registry, not a synthesized
  list). Shallow-green trap: `started: []` on a genuinely-partial refusal fails the pin.

- **PIN-L11 — the receipt family speaks one member shape.**
  Stage: acceptance mint (`workflow-interpreter.mjs:748-755`). RED at HEAD (GT-L14): acceptance
  `members` is an array of strings. Green: acceptance `members` is `[{role, runId, admitted,
  startError?}]` (runId null and `admitted: false` for a start-refused member, per D6) —
  key-compatible with lane A's roster (`application.mjs:11829-11836`) modulo the admitted flag.
  Shallow-green trap: `[role, runId]` without `admitted` fails — partial-failure truth (D7) rides
  this key.

- **PIN-L12 — `detach` is boolean or refused; the request is closed.**
  Stage: `runWorkflow` request admission (`application.mjs:11674-11714`, new normalizer per D10).
  RED at HEAD (GT-L16): `detach: 'false'` (string) silently detaches; unknown request fields are
  silently ignored. Green: non-boolean `detach` and unknown fields refuse `workflow_request_invalid`
  naming the field; `{detach: false}`, `{detach: true}`, and absent all behave exactly as PIN-L4
  pins. Shallow-green trap: coercing `'false'` to `false` (accept-then-fix) fails — the pin asserts
  the typed refusal.

- **PIN-L13 — a never-started wave's settlement verdict names the event.**
  Stage: settlement verdict computation (`workflow-interpreter.mjs:723-742`). RED at HEAD
  (GT-L8b): a phantom-all wave settles `WAVE-INCOMPLETE` / basis manifestDigest — no verdict class
  distinguishes "never admitted a single member" from "ran and broke". Green: the D11 verdict class
  fires exactly when `everySettled` is true AND every outcome's `terminalCause === 'start'`; any
  other roster keeps the existing WAVE-OK / WAVE-QUIESCED / WAVE-INCOMPLETE mapping unchanged.
  Shallow-green trap: a verdict that fires on ANY start-refused member (even when survivors ran) —
  the pin asserts the all-phantom condition only, and that survivors with dead members still settle
  honestly (per D7's continue-on-partial, their verdict is WAVE-INCOMPLETE only if harvest misses).

- **PIN-L14 — the phantom startError is single-sourced and cannot be lost to a read race.**
  Stage: settle phantom detail (`workflow-interpreter.mjs:647-672`). RED at HEAD: the surfacing
  reads `wave.progress()` a SECOND time inside a try/catch (`:650-660`); if that read throws, a
  phantom preOutcome falls back to `error: null` (`:670-672`) and the captured startError is
  dropped from the settlement receipt even though `wave.mjs:472`'s own settle outcome carries it.
  Green: the phantom detail is sourced from the wave handle's OWN settle outcome map (D12) — no
  separate `progress()` read — so a startError present in the handle always reaches the receipt.
  Shallow-green trap: duplicating the try/catch around the handle's own outcome map (still
  swallowable) fails — the pin asserts single-source provenance, not a second best-effort read.

## 5. Open questions

- **OQ-L1 (wire-contract authority):** partial-start-failure acceptance shape — keep verdict
  `WAVE-ADMITTED` with per-member `admitted: false` statuses (recommended: additive, no enum
  change) vs a new `WAVE-DEGRADED` verdict value (enum growth ripples through every consumer).
  DECISION_REQUEST-worthy if the fold disagrees with the recommendation. (Carried from redrive3;
  unchanged.)

- **OQ-L2 (registry authority):** the settle-read home — waves.progress additive key (D2,
  recommended) vs a dedicated verb. Boundary note for the ledger row: launch owns the receipt
  SHAPE; ledger (#194) owns spill-artifact reconstructability; the two must stay one shape (the
  contract-qa boundary map's overlap 1 and 3 — this contract cites, ledger owns reconstruct).
  (Carried from redrive3.)

- **OQ-L3 (lane alignment):** `OBJECTIVE_REF_MAX_BYTES` 64 KiB (`workflow-interpreter.mjs:46`) vs
  the 1 MiB inline spill ceiling — a by-reference body of 65 KiB refuses
  `workflow_objective_ref_invalid` at render while the same bytes inline through waves.start admit
  with spill. Align to `spill.body` (recommended — one ceiling per economy) or keep 64 KiB as the
  by-reference bound and document the asymmetry. No pin until decided. (Carried from redrive3,
  anchor re-verified `:39` → `:46`.)

- **OQ-L5:** the `wave.settled` record's claimed idempotency-keying (`application.mjs:11696-11708`
  comment; `recordDriver` auth-key law) — PIN-L3's re-read assertion exercises it; if the store's
  auth-key dedupe does not hold for `driver.recorded`, the impl must key explicitly. (Carried from
  redrive3.)

- **OQ-L6 (fold item, with the members row):** the D7c documented asymmetry (refuse-on-any at
  `waves.start`, continue-on-partial at `waves.run`) is a judgment call this row owns; the members
  row's #199 creation-events contract must not contradict it (its typed `task` events fire for
  lane B's continued members — the same members lane A would have refused the whole wave over).
  DECISION_REQUEST if the members row's fold lands a different law. (Carried from redrive3.)

- **OQ-L7 (verdict authority, new):** the D11 never-started verdict value's exact name and
  enumeration slot (`WAVE-START-FAILED` proposed). Every verdict consumer (the settle record, the
  ledger row's logged-invariant read, the members row's terminal-state projections) must agree on
  the new closed member before it lands; this row cedes the naming decision to the fold's verdict
  owners. DECISION_REQUEST if the fold cannot settle the name.

- **OQ-L8 (recorded, no incident):** the acceptance leg still awaits the full startWave loop
  (start + approve per member, `wave.mjs:189-256`, `approve: true` at
  `workflow-interpreter.mjs:618`) — for a 64-member roster the acceptance itself is slow. No
  measured incident; no pin. (Carried from redrive3 OQ-L4; re-anchored.)

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The publish path does not exist for a member row
and refuses with NO typed code — the exact #158 shape, re-verified at HEAD this session.
`writeScratchpad` (`coordination-store.mjs:14240`) hardcodes the write scope
`const scope = 'worker:' + fields.workerId` (`:14279`) — there is no shared scope for a member-row
write, and the refusal is a SILENT admission into `worker:<id>` (no refusal string exists to
quote). This contract is therefore published ON DISK here, and the shared-lane refusal is recorded
verbatim above for the fold to carry; fabricating a shared-scope publish was not an option.

## 7. Cross-contract boundary notes (for the coordinator's coherence check)

- fs row owns: base-commit capture (`workflow-interpreter.mjs:598-607`), index.lock, member
  confinement/settle sweep. GT-L1's detach-at-HEAD and GT-L8's phantom-surfacing affect fs's
  anchor set; flagged.
- members row owns: creation-failure events (#199), task-id namespacing (#200), drain-restart
  (#204). PIN-L1/L2's startError truth is the LAUNCH-receipt half; the members row's typed
  creation events are the store half — same causes, different seams; the fold must keep the
  captured `error.code` IDENTICAL in both. PIN-L13's verdict-class change (D11) ripples to the
  members row's terminal-state projections.
- ledger row owns: model-visible-means-logged (#194), decision ledgering (#205). PIN-L3's
  settlement read and D5's closed-record law must match the ledger's reconstructability law (one
  shape, both seams). The `wave.settled` record's error shape (`application.mjs:11701`,
  `{error: {code, message}}`) is the ledger row's logged-invariant specimen — flagged.

## 8. Judgment call, recorded

The row brief's deliverable path is `docs/reference/evidence/lifecycle-contracts-2026-08-14/
contract-launch.md` (no redrive segment). Every redrive since (redrive4/5/6 briefs) carries the
same stale string, while the operative machine-enforced constraint is "Work only within:
docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive6/**". This contract lands at
`redrive6/contract-launch.md`, matching the constraint over the stale brief string, and records
the discrepancy here (the redrive-4 self-label precedent, per the fs-contract QA nit). The shared
publish (see §6) is refused and recorded, not fabricated.

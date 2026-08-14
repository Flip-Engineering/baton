# CONTRACT-LAUNCH v2.1 — the launch/receipt honesty contract (package ③, row row-lc-launch)

[attempt: d2371308-6fa9-4b7d-b88f-42c655337599 row-lc-launch]

Issue set: #173 (synchronous launch / acceptance-receipt) · #202 (bare-text response shapes) ·
#207 (objectiveRef admission alignment + startError on the wire + the unused spill graceful path).
Base: this worktree at `5ae2c7e5` (docs-only on top of the impl commits `8ec52a6c` — the #163
hardCap removal — and `cda6355b` — the async base-commit). The impl tree has MOVED since the
redrive3 contract's base `09200e9`; every anchor below was re-verified THIS session at
`5ae2c7e5` with `grep -an`/`sed -n` (NUL discipline on `application.mjs`/`coordination-store.mjs`;
plain grep elsewhere); line numbers are HEAD numbers. No clocks anywhere. Sorted-key literals in
ACTUAL order. Ring-2 form: ground truths → decisions → refusal vocabulary → red-first acceptance
pins → open questions.

**Headline (what this redrive re-finds):** the foundry-era form of all three incidents is already
repaired at HEAD — waves.run DETACHES (GT-L1), run.start's objective lane is graceful-with-spill
(GT-L6), and the #202 producer string is gone from `impl/src` (GT-L9). What remains RED is the
honesty rim: the acceptance receipt lies on total start failure (GT-L2), the settlement record is
durable but unreadable from every transport (GT-L3/L4), the advertised schema walls the exact lanes
the admission admits (GT-L7), the captured `startError` is dropped from both receipts (GT-L8), the
bare-text degrade seam survives at two verbatim spots (GT-L10), and the same economic act gets
opposite verdicts on the two wave-start doors (GT-L12). The pins target only what is RED at HEAD.

**Provenance / judgment calls (recorded per the frame's law):**
1. The task text names `redrive3/contract-launch.md` as deliverable; the Baton constraint scopes
   this attempt to `redrive4/**` and redrive3 already carries the prior attempt's contract
   (`9a07d8eb…`). Judgment: `redrive4/contract-launch.md` is this attempt's deliverable — the
   constraint is the later, more specific instruction, and writing redrive3 would overwrite another
   attempt's record. Flagged for the fold.
2. This contract supersedes redrive3's v1.1 where HEAD moved under it (see the drift notes on
   GT-L1/GT-L15 and D9); every carried decision was re-grounded, not copied.

## 1. Ground truths (each verified at HEAD `5ae2c7e5` this session)

### The launch leg (#173)

- **GT-L1 — waves.run detaches at HEAD.** `application.mjs:11674` (`runWorkflow`), the detach
  coerce at `:11695` (`const detach = request.detach !== false;` — default true), the interpreter's
  acceptance branch at `workflow-interpreter.mjs:718-735`, the settle continuation `:729-735`, and
  the settlement record minted via `recordDriver` (`application.mjs:11698-11708`, kind constant
  `APPLICATION_WAVE_SETTLED_KIND = 'wave.settled'` at `:145`, key `wave.settled:<waveId>` at
  `:11705`). The row brief's seed anchor ("application.mjs:11631-11646 awaits the full drive") is
  STALE at HEAD — the #173 landing comment sits at `:11691-11694`. Re-anchored here.
- **GT-L2 — the acceptance receipt is unconditional.** `workflow-interpreter.mjs:721-728`:
  `{accepted: true, manifestDigest, members: [role strings], schemaVersion: 1, verdict:
  'WAVE-ADMITTED', waveId}` — frozen verbatim regardless of member start outcomes, because the
  facade's createWave NEVER throws on per-member failure: `wave.mjs:234-252` starts members
  individually, catches each throw into `entry.startError` (`:250`), and returns the handle. A wave
  in which EVERY member refused at run.start still mints `accepted: true / WAVE-ADMITTED`.
- **GT-L3 — the settlement receipt is durable but unreadable.** `wave.settled` lands as a
  `driver.recorded` event (`application.mjs:11698-11708` → `coordination-store.mjs:13240-13246`).
  The launch surface's observe verbs return everything BUT it: `waves.progress`
  (`application.mjs:11845-11882`) returns `{schemaVersion: 1, waveId, cursor, nextCursor, members}`
  (`:11881`) with per-member `{role, phase, progressClass, attention, knowledge}` projections;
  `waves.list` (`:11884+`) is the registry projection. Grep over `application.mjs` +
  `mcp-northbound.mjs`: `wave.settled` appears only at the mint site, the kind constant, and
  comments — no waves.* verb READS it. A detached caller can learn member phases but never the
  wave's own settlement verdict, basis, outcomes, or harvest.
- **GT-L4 — `detach` is unreachable from every transport.** The MCP tool schema
  (`mcp-northbound.mjs:609-615`) admits only `{repoId, spec, specDsl}`; the handler (`:1917-1921`)
  forwards only `{spec}`; a caller supplying `detach` draws `unknown_argument_field` at
  `validateArguments` (`mcp-northbound.mjs:1020-1022`). The CLI sends `{specPath}`
  (`application-cli.mjs:1370-1373`) — no sync flag exists. The synchronous seven-key D6 receipt
  (`workflow-interpreter.mjs:738-746`: `{basis, harvest, manifestDigest, outcomes, steering,
  verdict, waveId}`) is therefore embedded-only — no transport caller can choose either leg; the
  default alone is reachable.
- **GT-L4b — waves.progress answers an unknown waveId with silence.** `_normalizeWaveProgress`
  (`application.mjs:12107-12116`) validates shape only (the `wave:[a-f0-9]{32}` regex); the handler
  filters the run list by waveId (`:11858-11860`) and an unknown waveId yields `{members: [],
  nextCursor: null}` — a success page, not a typed refusal. An empty page is indistinguishable
  from a finished-and-reaped wave.

### The admission seam (#207)

- **GT-L5 — the interpreter admits by-reference objectives to 64 KiB.**
  `workflow-interpreter.mjs:42` (`OBJECTIVE_REF_MAX_BYTES = 64 * 1024`), enforced at `:343-344`,
  and `renderObjective` (`:337-351`) renders the FULL body into the member objective with the salt
  prefix (`:351`: `[attempt: <salt> <role>] <text>`).
- **GT-L6 — run.start's objective lane is graceful at HEAD (the foundry-era phantom is repaired on
  the embedded path).** `application.mjs:4519-4541`: oversize above the 4096-byte `run.objective`
  cap (`limits.mjs:56`) up to the 1 MiB `spill.body` ceiling (`limits.mjs:86`) is ADMITTED with a
  durable spill artifact (`mintSpill`, `:4532`) and a bounded head + `[SPILLED {citation}]` suffix
  (`:4538`); only beyond the ceiling draws the typed coaching refusal `spill_body_exceeded`
  (`:4526-4528`). The wave-member path rides the same admission: lane A loops members through
  `this.start` (`application.mjs:11800-11810`); the facade path is `wave.mjs:240-246`
  (`baton.runs.start`); and `_normalizeWaveStart` deliberately shape-checks the objective only
  (`application.mjs:12085-12088`, "never a wall in front of a spill lane"). A 4–64 KiB brief
  therefore no longer phantom-fails every member at HEAD.
- **GT-L7 — the graceful path exists UNUSED on every transport (the HEAD form of the #207 gap).**
  The ADVERTISED input schemas still hard-declare `maxLength: FRAME_LIMITS['run.objective'].value`
  (= 4096) on the exact lanes the registry declares `graceful: 'spill-digest-citation'`:
  `mcp-northbound.mjs:409` (run intent objective), `:539` (waves_attach member objective), `:559`
  (waves_start member objective); `application-semantics.mjs:171`, `:1559`, `:1583` (same lanes on
  the semantic registry). A schema-honoring MCP client never sends more than 4096 characters, so
  the spill path is unreachable from any transport even though the admission beneath it is
  graceful — the advertisement walls the lane the admission admits. Related registry lie:
  `limits.mjs:57` declares `wave.member.objective` `enforcedAt: 'application startWave/attachWave
  member admission'`, but neither enforces (`application.mjs:12085-12088` by design; the attach
  port shape-checks objective only at `:2017-2022`) — the actual enforcement point is run.start
  (`application.mjs:4525`).
- **GT-L8 — the captured startError never reaches either receipt.** `wave.mjs:250` captures
  `{code, message}` per failed member; the wave's own outcome path carries it (`wave.mjs:353`,
  `:472`). But the interpreter REBUILDS outcomes without the error field
  (`workflow-interpreter.mjs:663-696`: `{role, phase, terminal, resultSha}` + optional
  report/verifiedBy/quiescence keys) and DISCARDS the close receipt outright (`:705`: `void
  stopReceipt;`). The acceptance receipt carries no per-member status at all (GT-L2). A
  start-failed member surfaces as `phase: 'failed'` with NO cause on either receipt — the
  phantom-failure shape, live at HEAD.

### The response-shape seam (#202)

- **GT-L9 — the doctor seams are structured at HEAD.** MCP `_freshDoctorReadiness()`
  (`mcp-northbound.mjs:2256-2268`) with secret-stripping sanitize (`:2273+`); dispatch
  `deployment.doctor` → `this.doctorReadiness()` (`application.mjs:12780`, definition `:12593`).
  The incident string `'Command executed successfully.'` does not exist anywhere in `impl/src` at
  HEAD (grep over all `*.mjs`: zero hits) — the offending producer is gone.
- **GT-L10 — the bare-text degrade class survives at two verbatim seams.** (a)
  `_sanitizeDoctorReadiness` passes a NON-RECORD readiness through verbatim
  (`mcp-northbound.mjs:2274`: `if (!record(value)) return value;`) — a doctor lane that returns a
  bare string reaches the wire unrefused. (b) `toolResult` wraps any non-record value as
  `{result: <value>}` (`mcp-northbound.mjs:196-199`) — so that string serializes as
  `{"result":"Command executed successfully."}`, which is EXACTLY the #202 wire shape. Neither seam
  refuses typed; the class that produced the incident is one careless lane-return away.
- **GT-L11 — publish-to-`shared` is silently re-scoped, not refusable (the #158 law, live).**
  `writeScratchpad` hardcodes the write scope `worker:${fields.workerId}`
  (`coordination-store.mjs:14169`); the shared-scope settlement path is orchestrator-actor-only
  (`createAndClaimSettlementTask` refuses non-orchestrator at `:12559-12562`). A member-row publish
  to `shared` is silently admitted into the worker partition — no typed refusal string exists to
  record; the refusal is the admission.

### The two-lane split (the sharpest form of #207's startError gap)

- **GT-L12 — two wave-start lanes, opposite failure semantics.** Lane A, the `waves.start` direct
  port (`application.mjs:11780-11837`): ANY member run.start refusal THROWS the typed
  `wave_member_invalid` carrying `{actual?, cap?, cause, role}` with the inner code preserved
  (`:11811-11830`, the D5.1 law: "A partial start also refuses: the response is never a success
  shape"), and the code surfaces typed on MCP (`mcp-northbound.mjs:223` allowlist). Lane B, the
  facade lane the interpreter rides: `baton.waves.start` binds to `createWave`
  (`application-client.mjs:1555`), which catches each member's throw into `entry.startError` and
  RETURNS the handle (`wave.mjs:234-252`) — no refusal, ever. `waves.run` rides lane B
  (`workflow-interpreter.mjs:612-618`). So the identical member failure — say an out-of-profile
  exact route — refuses `wave_member_invalid` on `waves.start` and mints
  `accepted: true / WAVE-ADMITTED` on `waves.run`. Surface-constancy is violated at the verdict
  level, not the code level.
- **GT-L13 — the partial-start refusal drops the live-members truth.** Lane A refuses on the FIRST
  failing member, but members started before the failure are LIVE runs with no rollback in the
  loop (`application.mjs:11800-11830` — the throw propagates; no stop/cleanup), and the refusal's
  detail carries only the failing member's `{actual?, cap?, cause, role}` (`:11814-11818`). A
  refused caller of `waves.start` cannot learn from the refusal that earlier members are live (and
  billable) — the inverse of GT-L2's lie: there the receipt claims members that are dead; here the
  refusal hides members that are alive.
- **GT-L14 — the launch-receipt family diverges on the member shape.** Lane A returns
  `{schemaVersion: 1, waveId, members: [{role, runId, phase?, progressClass?}]}`
  (`application.mjs:11831-11836`); the `waves.run` acceptance returns `members` as BARE ROLE
  STRINGS (`workflow-interpreter.mjs:724`: `spec.members.map((member) => member.role)`). Two
  receipts for one lifecycle, two member shapes — a driver composing both verbs cannot key members
  to runs without the settlement read (which is itself unreadable, GT-L3).
- **GT-L15 — TWO `workflow_*` codes are minted outside the interpreter's declared closed five.**
  The declared set is five (`workflow-interpreter.mjs:32-36`: spec/member/steering/harvest/
  objectiveRef invalid), but (a) the facade guard mints `workflow_facade_invalid` at
  `workflow-interpreter.mjs:552`, and (b) the settle-failure record mints
  `workflow_settle_failed` at `application.mjs:11701` (`cause?.code ?? 'workflow_settle_failed'`
  inside the `wave.settled` onSettle record). The MCP allowlist admits ANY `workflow_*` prefix
  (`mcp-northbound.mjs:264`), so the prefix family is open-ended in practice while claiming to be
  closed. Both codes are CORRECT behavior (a bad facade refuses; a failed settle mints the error,
  never silence); the defect is that neither is declared in the closed set. (HEAD drift note:
  redrive3 found one undeclared code; the facade guard is also present at this HEAD — the family
  closure count below is seven, not six.)
- **GT-L16 — `detach` is not type-checked at the application seam.** `application.mjs:11695`:
  `const detach = request.detach !== false;` — a string `'false'`, `0`, or any non-`false` value
  silently detaches. The waves.run request has NO normalizer (unlike `_normalizeWaveStart`
  `:12071+` / `_normalizeWaveProgress` `:12107+`); unknown request fields are ignored silently.
  The interpreter's own branch is strict (`options.detach === true`,
  `workflow-interpreter.mjs:718`) but only ever receives the already-coerced boolean.
- **GT-L17 (context, no incident) — the #163 landing grew the receipt's outcome keys.** At HEAD
  the drive exits on terminality / handled-decision stuck / observed quiescence — never a clock
  (`workflow-interpreter.mjs:628-637`, the hardCap retirement at `:423-427`); a quiesced exit
  receipts `WAVE-QUIESCED` (`:701-703`) and the outcome may carry `quiescenceLastMeaningfulAt`,
  `quiescenceSilenceMs`, `progressClass: 'silent'` (`:684-688`). The seven-key top-level receipt
  law (`:738-746`) is unchanged; the outcome row's key set is no longer the four-key minimum. Any
  pin on outcome shape must pin the CLOSED extended set, not a fixed four.

## 2. Decisions (judgment calls recorded; options where the call is arguable)

- **D1 — total start failure refuses the launch (fail-closed), partial failure rides the
  receipt.** When EVERY member's run.start refuses, minting `accepted: true` is a lie (GT-L2); the
  launch must throw the new typed `wave_start_all_members_failed` naming each member's captured
  startError verbatim, before any acceptance is frozen. Partial failure keeps the acceptance (the
  live members are real work) with per-member admission truth added (D6/PIN-L2 make the causes
  attributable). Rationale: an empty wave has nothing to drive — detaching it wastes the settle
  leg and reports WAVE-INCOMPLETE with zero cause, the exact #207 phantom shape.
- **D2 — the settlement receipt becomes readable on the launch surface, additively.**
  `waves.progress` gains one closed key (`settlement`) carrying the durable `wave.settled:<waveId>`
  record's verdict/basis (or null while unsettled). Options: (a) extend waves.progress (CHOSEN —
  one read path, no new verb, additive to a schemaVersion-1 response); (b) a new
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
  "never a wall in front of a spill lane" law at `application.mjs:12087`).
- **D5 — the #202 degrade seams refuse typed.** `_sanitizeDoctorReadiness` refuses a non-record
  readiness with the new typed `deployment_readiness_invalid` (never a pass-through); the
  launch-family tool results (doctor, waves.*) are pinned as closed records — the
  `{result: <string>}` envelope at `mcp-northbound.mjs:196-199` remains legal for
  genuinely-scalar lanes but is pinned RED for this family. Rationale: the incident's producer is
  gone (GT-L9) but the class is one lane-return away (GT-L10); pins must hold the CLASS, not the
  corpse.
- **D6 — startError rides the wire verbatim.** The settlement receipt's outcomes carry
  `error: {code, message} | null` — the interpreter passes `wave.mjs:472`'s already-built
  `entry.startError` through instead of rebuilding outcomes without it; `void stopReceipt` ends.
  Every `phase: 'failed'` outcome is attributable from the receipt alone. The outcome key set is
  CLOSED and extends GT-L17's: `{role, phase, terminal, resultSha, error}` + the existing optional
  report/verifiedBy/quiescence keys — `error` is the only addition.
- **D7 — one economic act, one verdict law (total failure), two documented lanes (partial).**
  Total start failure refuses on BOTH lanes (lane B adopts lane A's fail-closed posture via D1/
  PIN-L1 — code `wave_start_all_members_failed`, members enumerated). Partial failure stays
  lane-specific BY DESIGN and documented at both doors: lane A (`waves.start`) keeps D5.1's
  any-failure refusal (a caller composing members one shot wants all-or-refused); lane B
  (`waves.run`) continues the live members and surfaces the dead ones on the receipt (D6) — a
  workflow roster is declared work, not an atomic transaction. Options: (a) unify both lanes on
  continue-on-partial (REJECTED — breaks D5.1's landed contract and its suite); (b) unify both on
  refuse-on-any (REJECTED — kills a wave of 8 because member 5's route was stale; the #199 members
  row contracts the creation events, and this row refuses to amplify one bad member into a refused
  wave); (c) documented asymmetry (CHOSEN). Fold must reconcile with the members row.
- **D8 — the partial-start refusal enumerates the live members.** Lane A's `wave_member_invalid`
  detail gains one key: `started: [{role, runId}]` — every member already live at refusal time, so
  the refused caller can stop exactly those. No new code; the D5.1 shape extends additively.
- **D9 — the `workflow_*` family closes at SEVEN, declared where it is minted.**
  `workflow_facade_invalid` and `workflow_settle_failed` join the declared set (a const beside
  `workflow-interpreter.mjs:32-36` or an explicit application-side declaration cited from
  `application.mjs:11701`), and the family enumeration is pinned at seven — the MCP prefix arm
  (`mcp-northbound.mjs:264`) stays, but the PREFIX now names a closed set the docs and the code
  agree on. An eighth `workflow_*` code without a contract amendment is a finding. (Drift note:
  redrive3 pinned six; the facade guard at `:552` makes it seven at this HEAD.)
- **D10 — the waves.run request gets a normalizer; `detach` is boolean-only.** `runWorkflow`
  validates its request fields (`spec`/`specDsl`/`specPath`/`detach`/`driver` closed-set, mirroring
  `_normalizeWaveStart` at `application.mjs:12071+`); a non-boolean `detach` or an unknown field
  refuses the new typed `workflow_request_invalid` (vocabulary below) — never silent ignore, never
  coercion.

## 3. Refusal vocabulary (closed, typed, surface-constant)

Existing codes this contract depends on, unchanged (each verified at HEAD):

| Code | Minted at | Anchor |
|---|---|---|
| `workflow_spec_invalid` / `workflow_member_invalid` / `workflow_steering_unknown` / `workflow_harvest_invalid` / `workflow_objective_ref_invalid` | interpreter validation/render | `workflow-interpreter.mjs:32-36` |
| `workflow_facade_invalid` | runWorkflow facade guard (undeclared today — D9 declares it) | `workflow-interpreter.mjs:552` |
| `workflow_settle_failed` | settle-leg failure record (undeclared today — D9 declares it) | `application.mjs:11701` |
| `spill_body_exceeded` | run.start objective beyond the 1 MiB ceiling (the ONLY hard refusal on these lanes) | `application.mjs:4526-4528`, `limits.mjs:56/86` |
| `application_wave_start_invalid` / `application_wave_progress_invalid` | startWave/progress normalization | `application.mjs:12078`, `:12111` |
| `wave_member_invalid` | lane A member start refusal (D5.1) | `application.mjs:11814`, `:11824` |
| `wave_member_not_found` | attach objective match failure | `wave.mjs:334` |
| `coordinator_authority_forbidden` | coordinator seat reaching a launch verb | `application.mjs:3232`, `:12759` |
| `invalid_workflow_run` / `unknown_argument_field` | MCP argument guards | `mcp-northbound.mjs:1226-1229`, `:1020-1022` |

NEW codes this contract adds (closed set of FOUR; surface-constant across embedded/MCP/CLI —
the MCP stateFailureCode allowlist must admit all four):

| Code | Meaning | Refusal shape |
|---|---|---|
| `wave_start_all_members_failed` | every member's run.start refused; the wave is empty | `{members: [{role, error: {code, message}}]}` — each startError verbatim |
| `wave_unknown` | waves.progress asked for a waveId with no bound runs | `{waveId}` — never an empty success page |
| `workflow_request_invalid` | the waves.run request itself is malformed (unknown field, non-boolean `detach`) | `{field}` — the offending request field |
| `deployment_readiness_invalid` | the doctor lane produced a non-record readiness | `{actual: typeof}` — refused at the sanitize seam |

(Lineage note: redrive3's v1 framed the closure as "three" then grew it by amendment; at this
HEAD the closure is four, declared once, exhaustively.)

No prose-string refusals; no numeric-limit refusals beyond the registry's declared lanes; no
clocks.

## 4. Red-first acceptance pins

Each pin names its stage (where the pin test hooks), is RED at HEAD `5ae2c7e5`, and greens ONLY
for a correct impl (a shallow greening is itself a defect).

- **PIN-L1 — the acceptance must not lie on total start failure.**
  Stage: interpreter launch (`workflow-interpreter.mjs` runWorkflow, the waves.start → acceptance
  span `:612-735`). RED at HEAD: a valid spec whose members' exact routes are all outside the
  deployment profile → every run.start refuses inside createWave (`wave.mjs:250`), and waves.run
  still returns `{accepted: true, verdict: 'WAVE-ADMITTED'}` (GT-L2). Green: the typed
  `wave_start_all_members_failed` refusal reaches the caller (all surfaces), naming every member's
  startError code verbatim; NO acceptance is minted; NO settle leg runs. Shallow-green trap: an
  impl that flips `verdict` to a failure string but still returns `accepted: true` fails this pin.
- **PIN-L2 — startError rides both receipts.**
  Stage: settlement build (`workflow-interpreter.mjs:663-705`) + acceptance members (D6).
  RED at HEAD: a start-failed member's settlement outcome is `{role, phase: 'failed', terminal:
  true, resultSha: null}` — no `error` key (the interpreter rebuilds outcomes without it and voids
  the close receipt, GT-L8). Green: settlement outcomes carry `error: {code, message}` verbatim
  from `wave.mjs:472`'s capture; partial-failure acceptances carry per-member admission status.
  Shallow-green trap: synthesizing a generic error (`{code: 'start_failed'}`) instead of the
  captured code fails — the pin asserts code EQUALITY with the run.start refusal.
- **PIN-L3 — the settlement receipt is readable from the launch surface.**
  Stage: waves.progress read (`application.mjs:11845-11882`). RED at HEAD: no waves.* response
  contains any settlement field (GT-L3); the durable `wave.settled:<waveId>` record is minted
  (`application.mjs:11698-11708`) but no verb returns it. Green: after a detached run settles, the
  decided read (D2: waves.progress `settlement` key) returns the recorded verdict/basis; before
  settlement it is null (not absent — null). Shallow-green trap: returning a LIVE-computed verdict
  instead of the durable record fails — the pin asserts the value equals the `wave.settled` record
  (or the recorded error shape when the settle leg failed), including its idempotent re-read.
- **PIN-L4 — `detach` is reachable and typed on both transports.**
  Stage: MCP argument admission (`mcp-northbound.mjs:1013-1022`, schema `:609-615`, handler
  `:1917-1921`) + CLI parse (`application-cli.mjs:1370-1373`). RED at HEAD: `baton_waves_run` with
  `detach: false` draws `unknown_argument_field` (GT-L4); the CLI has no sync flag. Green:
  `detach: false` through MCP returns the synchronous seven-key D6 receipt
  (`workflow-interpreter.mjs:738-746` — exact keys, sorted); `detach: true` (and absent) returns
  the acceptance; a non-boolean detach refuses `workflow_request_invalid` per D10 (the
  application-seam pin; the MCP schema guard may refuse `invalid_workflow_run` first — either
  typed refusal greens, coercion does not). Shallow-green trap: an impl that detaches regardless
  of the flag (ignoring it after admission) fails the seven-key assertion.
- **PIN-L5 — the advertised bound equals the admission bound on the graceful lanes.**
  Stage: MCP schema advertisement (`mcp-northbound.mjs:409/539/559`) + semantic registry
  (`application-semantics.mjs:171/1559/1583`) vs the admission (`application.mjs:4519-4541`).
  RED at HEAD: advertised `maxLength` 4096 on lanes whose admission admits-with-spill to 1 MiB
  (GT-L7) — and, behaviorally, a schema-honoring client cannot ever reach the graceful path.
  Green: the advertised bound is the spill ceiling (or the bound is removed with the refusal
  documented — D4a's shape), AND a >4096-byte member objective sent through `baton_waves_start`
  ADMITS WITH SPILL (surface-constant with the embedded path — the stored objective carries the
  head + `[SPILLED {…}]` citation). Shallow-green trap: fixing only the schema numbers without
  asserting the admit-with-spill behavior greens nothing — the pin's second clause is the
  substance.
- **PIN-L6 — the limits registry names the real enforcement point.**
  Stage: `limits.mjs:56-57` registry rows. RED at HEAD: `wave.member.objective` claims
  `enforcedAt: 'application startWave/attachWave member admission'` but neither enforces
  (`application.mjs:12085-12088`, `:2017-2022`; GT-L7). Green: the row's `enforcedAt` names
  run.start (where `spill_body_exceeded` actually fires), and `run.objective`/
  `wave.member.objective` rows still declare the same graceful path and ceiling. (Registry digest
  discipline: the row set stays closed; only the prose field corrects.)
- **PIN-L7 — the bare-text degrade class refuses typed at the wire.**
  Stage: `_sanitizeDoctorReadiness` (`mcp-northbound.mjs:2273-2280`) + `toolResult`
  (`:196-199`). RED at HEAD: a string-returning doctor seam (test double at the readiness
  supplier) passes through verbatim and serializes as `{result: "<text>"}` — the exact #202 wire
  shape (GT-L10). Green: the typed `deployment_readiness_invalid` refusal; and the doctor tool's
  structuredContent is a closed record (schemaVersion-carrying) for every readiness producer.
  Shallow-green trap: pinning only the incident's literal string (grep for 'Command executed
  successfully.') greens nothing — the pin drives an ARBITRARY string through the seam.
- **PIN-L8 — an unknown waveId refuses, never an empty page.**
  Stage: waves.progress handler (`application.mjs:11858-11860`). RED at HEAD: a well-formed but
  unknown `wave:…` id returns `{members: [], nextCursor: null}` — success-shaped silence (GT-L4b).
  Green: the typed `wave_unknown` refusal `{waveId}`; an EMPTY-but-real wave (all members reaped)
  must remain distinguishable from an unknown one (the pin asserts the refusal fires only when the
  registry has no binding, not when phases are all terminal).
- **PIN-L9 — the same failure cannot get opposite verdicts on the two lanes.**
  Stage: both doors — `waves.start` direct port (`application.mjs:11800-11830`) and the
  facade/createWave door (`wave.mjs:234-252` via `workflow-interpreter.mjs:612-618`).
  RED at HEAD (GT-L12): an all-members-failing roster refuses `wave_member_invalid` at door A and
  mints `{accepted: true, verdict: 'WAVE-ADMITTED'}` at door B. Green: BOTH doors refuse (door A
  its `wave_member_invalid` with every member's cause; door B `wave_start_all_members_failed`) —
  no door returns a success shape for a wave with zero live members. Shallow-green trap: greening
  door B by making door A swallow (unifying downward) fails — the pin asserts BOTH refusals.
- **PIN-L10 — the partial-start refusal names its live members.**
  Stage: lane A's D5.1 throw (`application.mjs:11811-11830`). RED at HEAD (GT-L13): a 5-member
  roster whose member 3 refuses yields `wave_member_invalid` whose detail carries
  `{actual?, cap?, cause, role}` — no `started` key; members 1-2 are live, unenumerable,
  un-stoppable from the refusal. Green: detail carries `started: [{role, runId}]` exactly for the
  members started before the refusal (asserted against the live registry, not a synthesized
  list). Shallow-green trap: `started: []` on a genuinely-partial refusal fails the pin.
- **PIN-L11 — the receipt family speaks one member shape.**
  Stage: acceptance mint (`workflow-interpreter.mjs:721-728`). RED at HEAD (GT-L14): acceptance
  `members` is an array of strings (`:724`). Green: acceptance `members` is
  `[{role, runId, admitted}]` (runId null for a start-refused member, per D6/D7) — key-compatible
  with lane A's roster (`application.mjs:11831-11836`) modulo the admitted flag. Shallow-green
  trap: `[role, runId]` without `admitted` fails — partial-failure truth (D7c) rides this key.
- **PIN-L12 — `detach` is boolean or refused; the request is closed.**
  Stage: `runWorkflow` request admission (`application.mjs:11674-11695`, new normalizer per D10).
  RED at HEAD (GT-L16): `detach: 'false'` (string) silently detaches; unknown request fields are
  silently ignored. Green: non-boolean `detach` and unknown fields refuse `workflow_request_invalid`
  naming the field; `{detach: false}`, `{detach: true}`, and absent all behave exactly as PIN-L4
  pins. Shallow-green trap: coercing `'false'` to `false` (accept-then-fix) fails — the pin asserts
  the typed refusal.

## 5. Open questions

- **OQ-L1 (wire-contract authority):** partial-start-failure acceptance shape — keep verdict
  `WAVE-ADMITTED` with per-member `admitted: false` statuses (recommended: additive, no enum
  change) vs a new `WAVE-DEGRADED` verdict value (enum growth ripples through every consumer).
  DECISION_REQUEST-worthy if the fold disagrees with the recommendation.
- **OQ-L2 (registry authority):** the settle-read home — waves.progress additive key (D2,
  recommended) vs a dedicated verb. Boundary note for the ledger row: launch owns the receipt
  SHAPE; ledger (#194) owns spill-artifact reconstructability; the two must stay one shape.
- **OQ-L3 (lane alignment):** `OBJECTIVE_REF_MAX_BYTES` 64 KiB (`workflow-interpreter.mjs:42`) vs
  the 1 MiB inline spill ceiling — a by-reference body of 65 KiB refuses
  `workflow_objective_ref_invalid` at render (`:343-344`) while the same bytes inline through
  waves.start admit with spill. Align to `spill.body` (recommended — one ceiling per economy) or
  keep 64 KiB as the by-reference bound and document the asymmetry. No pin until decided.
- **OQ-L4 (no incident at HEAD, recorded only):** the acceptance leg still awaits the full
  startWave loop (start + approve per member, `wave.mjs:234-252`, `approve: true` at
  `workflow-interpreter.mjs:616`) — for a 64-member roster the acceptance itself is slow. No
  measured incident; no pin.
- **OQ-L5:** the `wave.settled` record's claimed idempotency-keying (`application.mjs:11705`;
  `recordDriver` at `coordination-store.mjs:13240-13246` appends `driver.recorded` with the caller
  key but does NOT visibly dedupe on it) — PIN-L3's re-read assertion exercises it; if the store's
  key does not dedupe `driver.recorded`, the impl must key explicitly or the reader must
  last-write-win deterministically.
- **OQ-L6 (fold item, with the members row):** the D7c documented asymmetry (refuse-on-any at
  `waves.start`, continue-on-partial at `waves.run`) is a judgment call this row owns; the members
  row's #199 creation-events contract must not contradict it. DECISION_REQUEST if the members
  row's fold lands a different law.
- **OQ-L7 (new this redrive, #163 aftermath):** the quiescence outcome keys (GT-L17) are
  interpreter-minted and unpinned by any contract this pack knows of; if the members or ledger row
  pins outcome shape independently, the closed extended set (D6) must be the shared enumeration.
  No incident; recorded for the fold's coherence check.

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The publish path does not exist for a member row
and refuses with NO typed code — the exact #158 shape, re-verified at HEAD this session (GT-L11:
`coordination-store.mjs:14169` worker-scope hardcode inside `writeScratchpad:14130`; the
orchestrator-actor-only settlement path at `:12559-12562`). There is no refusal string to quote
because the refusal is a silent admission into `worker:<id>`. This contract is therefore published
ON DISK (here) and the shared-lane refusal is recorded verbatim above for the fold to carry;
fabricating a shared-scope publish was not an option.

## 7. Cross-contract boundary notes (for the coordinator's coherence check)

- fs row owns: base-commit capture (`workflow-interpreter.mjs:596-604`, now async + skip-if-clean
  per `cda6355b`), index.lock, member confinement/settle sweep.
- members row owns: creation-failure events (#199), task-id namespacing (#200), drain-restart
  (#204). PIN-L1/L2's startError truth is the LAUNCH-receipt half; the members row's typed
  creation events are the store half — same causes, different seams; the fold must keep the
  captured `error.code` IDENTICAL in both.
- ledger row owns: model-visible-means-logged (#194), decision ledgering (#205). PIN-L3's
  settlement read and D5's closed-record law must match the ledger's reconstructability law (one
  shape, both seams).
- QA/fold: redrive3's v1.1 pins carry over with the anchor drift recorded here (family closure
  seven per D9; PIN-L4's non-boolean refusal now names `workflow_request_invalid` at the
  application seam rather than `invalid_workflow_run` only — the MCP seam may still refuse
  `invalid_workflow_run` first; both typed, one behavior).

---

# CONTINUATION TRANCHE (v2.1) — the seal, the record, and the operator's next action

Grounded fresh this session after the v2 core; every anchor re-read at HEAD `5ae2c7e5` before
pinning (`grep -an`/`sed -n`; NUL discipline on `application.mjs`/`coordination-store.mjs`). This
tranche follows the typed refusal OUT of the application and asks three questions the core tranche
stopped short of: does the refusal SURVIVE the transport seal (§GT-L18), does the settlement
record's read stay bounded (§GT-L21), and does the detached operator get a next action
(§GT-L20's RED half). None of these were pinned by v2 or by redrive3.

## 1c. Ground truths, continuation (GT-L18 … GT-L21)

- **GT-L18 — the MCP failure-code seal degrades every un-allowlisted typed refusal to
  `command_outcome_unknown`, dropping message AND detail.** `stateFailureCode`
  (`mcp-northbound.mjs:261-335`) admits by arm: `application_*`/`worker_policy_*`/
  `run_orchestrator_*` prefixes, the `workflow_*` prefix (`:264`), exactly
  `wave_member_invalid` + `wave_not_found` (`:268-269`), the limits-derived
  `COACHING_REFUSAL_CODES`, and one long explicit list; the fallthrough returns
  `'command_outcome_unknown'` (`:334-335`). Upstream, `laneCraftedToolError` (`:216-225`) renders
  a non-LANE_CRAFTED cause as `toolError(stateCode)` — message and detail are DROPPED, only the
  (now generic) wire code survives. The seal is a closed allowlist with no contract naming the
  wave-launch family's membership: any new typed code this family mints is dead on arrival at the
  wire unless the seal is amended in the same landing.
- **GT-L19 — two LIVE application-typed codes degrade today (the L18 instance, live at HEAD).**
  (a) `wave_already_terminal` — minted at `application.mjs:11756-11771` with the
  `{priorWaveId, verdict}` detail (the #183 terminal-replay gate) — appears NOWHERE in
  `mcp-northbound.mjs` (grep: zero hits), so a `baton_waves_start` replay of a settled wave
  surfaces as `command_outcome_unknown` with no detail: the caller cannot learn the PRIOR waveId
  or its verdict, exactly the truth the gate was built to carry. (b) `wave_member_not_found` —
  minted at `wave.mjs:334` (attach objective match failure) — crosses the seal via
  `baton_waves_attach` (tool at `mcp-northbound.mjs:530`, mapping `:46`/`:67`) and degrades the
  same way. Of the four NEW §3 codes, only `workflow_request_invalid` survives the seal (prefix
  arm); `wave_start_all_members_failed`, `wave_unknown`, and `deployment_readiness_invalid` would
  all degrade — the §3 note "the MCP stateFailureCode allowlist must admit all four" is not
  decorative; it is the difference between the vocabulary existing and not existing on the wire.
- **GT-L20 — the CLI waves branch is the loud-branch model and projects command results verbatim
  — but a detached acceptance offers the operator NO next action.** The parse end-refusal at
  `application-cli.mjs:1483` (`cli_command_unavailable`, naming the closed set "expected waves
  list, progress, start, send, stop, attach, run, or compile") is the #155-corrected posture; the
  CLI projection passes non-run-view command results through verbatim
  (`application-cli.mjs:1041-1043`, the `RUN_VIEW_OUTPUT_KINDS` miss → `return result`), so the
  acceptance receipt renders faithfully. The RED half: the stream projections APPEND a `follow`
  pointer (`:1026-1028`, `follow: 'baton run progress <runId> --follow'` — the receipt tells the
  operator what to do next), but the `waves.run` command result gets no such pointer — a detached
  launch prints five frozen keys and leaves the operator to guess that `baton waves progress
  <waveId>` exists. A success without a next action is the #136 dead-end law applied to receipts.
- **GT-L21 — the settle record embeds the FULL seven-key receipt, unbounded, at the record
  seam.** `application.mjs:11698-11708`: `recordDriver('wave.settled', {waveId, receipt})` clones
  the whole receipt — `outcomes` (up to 64 rows × the GT-L17 extended key set), `harvest`,
  `steering` — into one `driver.recorded` event (`coordination-store.mjs:13240-13246`, appended
  with `clone(payload)`, no payload bound at this seam; the `wire.frame` substrate ceiling at
  `limits.mjs:84` bounds the WIRE, not the store record). D2's read therefore cannot return the
  raw record: `waves.progress` is the "never one oversized frame" verb
  (`application.mjs:11839-11841`) and a full-receipt replay through it would violate the frame
  law the verb was built on. The record's fullness is also a FEATURE the ledger row depends on
  (spill-artifact reconstructability) — the read must be bounded, the record must stay whole
  (D12 draws exactly this line).

## 2c. Decisions, continuation (D11 … D14)

- **D11 — the failure-code seal is part of this family's surface contract: the closed list, named
  in the seal, amended in the same landing as any new code.** The wave-launch family arm admits
  exactly: `wave_already_terminal`, `wave_member_not_found`, `wave_start_all_members_failed`,
  `wave_unknown`, `deployment_readiness_invalid` (joining the already-allowlisted
  `wave_member_invalid`/`wave_not_found`; `workflow_request_invalid` rides the existing prefix
  arm). Options: (a) an explicit closed-list arm (CHOSEN — enumerable in source, a new family
  code requires touching the list, which is the point); (b) a `wave_*` prefix arm (REJECTED —
  over-admits: `wave_idempotency_invalid` (`wave.mjs:260`) and the store's internal wave codes
  are deliberately NOT wire codes, per the #132 comment's "store-integrity roster code
  deliberately stays a projection throw" discipline); (c) leave the degradation (REJECTED — it
  un-types the #183 gate's whole purpose, GT-L19, and violates the #160 actionability law).
  The lane detail rule: these five carry their prebuilt detail verbatim (the
  `wave_member_invalid` arm's discipline at `mcp-northbound.mjs:243-247`), never detail-dropped.
- **D12 (amends D2) — the settlement read is a bounded projection; the record stays whole.** The
  `waves.progress` `settlement` key carries `{verdict, basis, error?}` or null — NEVER
  `outcomes`/`harvest`/`steering` (GT-L21's frame law). The durable record is NOT trimmed: the
  ledger row's reconstructability owns the full receipt in the store. One shape at the read, one
  whole truth at the record — the boundary between this row and the ledger row, drawn.
- **D13 — the operator's next action rides the CLI projection, not the wire receipt.** The
  acceptance receipt's five frozen keys stay closed (the F14 sorted-key law); instead
  `projectBatonCliResult` appends `follow: 'baton waves progress <waveId>'` to the `waves.run`
  command result, exactly as the stream projections already do (`application-cli.mjs:1026-1028`
  — the precedent is in-tree). Options: (a) CLI-side projection append (CHOSEN — no wire-shape
  change, precedent exists, embedded callers composing receipts programmatically are unaffected);
  (b) an additive `follow` key on the frozen receipt (REJECTED — grows the frozen closed set for
  a transport-local concern); (c) nothing (REJECTED — GT-L20's dead end).
- **D14 — the seal amendment is pinned as a same-landing law, not a follow-up.** An impl that
  lands a new §3 code without its seal arm is INCOMPLETE — PIN-L13's second clause fails it.
  (Recorded as a decision because it is a sequencing judgment, not a shape judgment: the
  alternative — land codes embedded-only, amend the seal later — leaves a window where the wire
  lies by degradation, which is the #202-class shape in slow motion.)

## 3c. Refusal vocabulary, continuation

**Closure UNchanged — no new codes this tranche.** The §3 sets stand: four new codes, the
`workflow_*` family at seven (D9). What this tranche adds is a TRANSPORT obligation on existing
codes, not vocabulary: the D11 closed seal-list (`wave_already_terminal`,
`wave_member_not_found`, `wave_start_all_members_failed`, `wave_unknown`,
`deployment_readiness_invalid`) names codes that must cross the MCP seal VERBATIM with their
prebuilt details. A code that only exists embedded is not surface-constant; the seal list is
therefore part of the refusal vocabulary's definition, recorded here so the closure stays
countable: 4 new + 7 workflow-family + 5 seal-amended existing = the family's complete wire
surface.

## 4c. Red-first acceptance pins, continuation (PIN-L13 … PIN-L15)

- **PIN-L13 — typed refusals cross the seal verbatim; the degradation class dies.**
  Stage: the seal — `laneCraftedToolError` + `stateFailureCode`
  (`mcp-northbound.mjs:216-335`). RED at HEAD (GT-L18/L19): a `baton_waves_start` replay of a
  settled wave returns wire code `command_outcome_unknown` with NO message and NO detail, while
  the application threw `wave_already_terminal` carrying `{priorWaveId, verdict}`; the same
  degrade fires for `wave_member_not_found` through `baton_waves_attach`. Green: (clause 1) the
  replay surfaces wire code `wave_already_terminal` with the `{priorWaveId, verdict}` detail
  verbatim; (clause 2) each of the four §3 codes, driven through its own seam, surfaces as
  itself with its §3 refusal shape; (clause 3) a synthetic non-family code (test double throwing
  `code: 'definitely_not_a_family_code'`) STILL maps to `command_outcome_unknown` — the seal
  stays a closed list, not an admit-everything. Shallow-green traps: (a) allowlisting by a
  `wave_*` prefix arm greens clauses 1-2 and fails clause 3's spirit — the pin's source
  assertion requires the explicit closed list (D11a); (b) wrapping the code in the MESSAGE while
  the wire code stays generic fails — the pin asserts the WIRE code equals the thrown code.
- **PIN-L14 — the settlement read is bounded; the record stays whole.**
  Stage: the D2/D12 `settlement` key in `waves.progress` (`application.mjs:11845-11882`) read
  against the `wave.settled` record (`:11698-11708`). RED at HEAD: the key does not exist
  (GT-L3) and the record embeds the full receipt (GT-L21) — an impl has every temptation to
  replay the record verbatim. Green: the key's value is exactly `{verdict, basis}` or
  `{verdict, basis, error}` or null — and explicitly CONTAINS NO `outcomes`, `harvest`, or
  `steering` keys (asserted by key-set equality, not by spot-check); meanwhile the STORE record
  still carries the full seven-key receipt (asserted by reading the `driver.recorded` event —
  trimming the record to satisfy the read fails the ledger's half). Shallow-green trap: a
  live-computed verdict (re-deriving from member phases instead of reading the record) greens
  the shape and fails the provenance — PIN-L3's equality-with-the-record clause is imported
  here by reference.
- **PIN-L15 — a detached acceptance tells the operator the next action.**
  Stage: CLI projection (`projectBatonCliResult`, `application-cli.mjs:1021+`) for the
  `waves.run` command result. RED at HEAD (GT-L20): `baton waves run spec.json` prints the
  five-key acceptance and nothing else — no `follow` pointer exists on any non-stream command
  result. Green: the CLI output carries `follow: 'baton waves progress <waveId>'` (exact
  command form, the waveId from the receipt) via the projection append (D13a); the WIRE receipt
  itself is unchanged (its key set is still the frozen five — asserted, so the append cannot
  migrate into the receipt). Shallow-green trap: adding `follow` to the frozen receipt greens
  the operator-visible behavior and fails the closed-key assertion — the trap is the D13
  decision inverted.

## 5c. Open questions, continuation

- **OQ-L8 (ledger boundary, must ride the fold):** D12 draws read-bounded/record-whole; the
  ledger row's #194 reconstructability law must CONFIRM the record stays whole (if it ever trims
  the record for symmetry, PIN-L14's second clause and the ledger's own reconstruct pin collide).
  One shape at the read, one whole record in the store — both rows must cite this line.
- **OQ-L9 (seal-placement detail):** D11a's closed-list arm — one `['wave_already_terminal',
  'wave_member_not_found', …].includes(cause?.code)` arm beside the existing wave arm
  (`mcp-northbound.mjs:268-269`), or fold those two existing entries into the new family arm.
  Cosmetic; the pin (L13) is agnostic. Recorded so the impl does not split it into five
  per-code arms (five arms is five chances to drift).
- **OQ-L10 (web-northbound parity):** this tranche verified the MCP seal; the web transport
  (`web-northbound.mjs`) has its own failure-code path this session did NOT ground. If it
  carries its own seal, D11's closure must be checked there too — flagged for the fold rather
  than pinned ungrounded (no web anchor cited above; discipline over coverage).

*(The v2 core (§1–§7) stands as written except where this tranche amends: D12 amends D2's read
shape; D11 adds a transport obligation §3 did not carry. The version is now v2.1.)*

# CONTRACT — LAUNCH/RECEIPT HONESTY (REDRIVE) — `row-lc-launch`

[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 row-lc-launch]

Package-③ redrive of the launch/receipt honesty contract: #173 (detach/acceptance-receipt) +
#202 (response shapes) + #207 (objective-cap admission alignment, the startError on the wire, the
spill-digest graceful path). Ring-2 form (ground truths → decisions → refusal vocabulary →
red-first acceptance pins → open questions). Every citation re-verified at HEAD (`1ff8335`) via
`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs` (NUL discipline), plain grep
elsewhere. No clocks, no new numeric limits — byte literals stay in `limits.mjs`.

---

## 1. Ground truths (cited)

**GT-1 (#173) — `waves.run` is synchronous for the wave's whole lifetime.** `application.mjs:11631-11648`
(`runWorkflow` ends `return runWorkflow(baton, specOrPath, {...})` — it awaits the interpreter's full
drive and returns only its D6 receipt). The interpreter runs the entire wave inside one promise:
`baton.waves.start` (`workflow-interpreter.mjs:549`) → `driveLane` (`:571`) → `wave.close` (`:595`) →
D6 build (`:597-633`). The MCP tool `baton_waves_run` awaits `application.command('waves.run', { spec })`
(`mcp-northbound.mjs:1813-1822`) — the client blocks until the wave settles. Two client timeouts on
healthy waves (#173); the landing note records "the wave's own receipt was lost to the #173
synchronous-launch client timeout" (`docs/reference/evidence/suite-foundry-2026-08-13/landing-note.md:30-31`).

**GT-2 (#173) — the D6 receipt is the *return value* of `waves.run` only; it is not stored.** The
interpreter builds and returns it with exactly seven sorted keys `basis, harvest, manifestDigest,
outcomes, steering, verdict, waveId` (`workflow-interpreter.mjs:624-633`; pinned by W1-06). No durable
receipt store is written; a client that times out on the synchronous call loses the command's return
value.

**GT-3 (#173) — the detached-launch machinery already exists.** `baton_waves_start` is "Start a
detached wave: … returns `{waveId, members:[{role, runId}]}` — live handles never cross the transport"
(`mcp-northbound.mjs:493-511`); `baton_waves_attach` re-attaches by waveId + member objectives, settles,
and returns closed outcomes (`mcp-northbound.mjs:476-492`); `waves.progress`/`waves.list` observe.
The waveId is derived from the idempotency key (`wave:${sha256(idempotencyKey).slice(0,32)}`,
`wave.mjs:207`); `attachWave` re-discovers prior member runs (`wave.mjs:275-337`); the exactly-once
`wave.driver_detached` receipt mints through the run.inspect side gate (`application-client.mjs:1557-1560`);
the web `waves_run` direct port rides the same runWorkflow admission (`web-northbound.mjs:46-48`).

**GT-4 (#202) — the bare-text ack is a live-recorded incident; the remediation is landed at HEAD.**
`'Command executed successfully.'` appears NOWHERE in `impl/` (verified — the only occurrence is the
incident record at `row-lc-launch.md:6`). Every doctor surface at HEAD returns a structured object:
embedded `doctorReadiness()` (`application-deployment.mjs:1329-1369` — `{...this.#readiness, routes,
workspace?}` + a non-enumerable `briefing` sibling at `:1367`), MCP `baton_deployment_doctor` →
`_freshDoctorReadiness()` + `_sanitizeDoctorReadiness()` (`mcp-northbound.mjs:1829-1831`, `:2141-2172` —
structured, secret-shaped values stripped), CLI `baton doctor` → `client.doctor()` (`application-cli.mjs:1968-1985` —
structured `{schemaVersion, ready, deployment, routes, briefing, application}`), and the descriptor-derived
deployment (`mcp-descriptor.mjs:152, 161-167` — `{schemaVersion, repoId, routes, workspace}`).

**GT-5 (#207) — the objectiveRef admission is 64KiB; the member-objective cap is 4096.** The
interpreter's gate is `OBJECTIVE_REF_MAX_BYTES = 64 * 1024` (`workflow-interpreter.mjs:39`);
`renderObjective` checks `Buffer.byteLength(text) > OBJECTIVE_REF_MAX_BYTES` (`:340-341`) and returns
`[attempt: ${salt} ${member.role}] ${text}` (`:347`). The run-level cap is 4096 bytes:
`run.objective` and `wave.member.objective` (`limits.mjs:56-57`), enforced at run.start admission
(`application.mjs:4518-4519`) and mirrored in the member input schema
(`application-semantics.mjs:171`; `mcp-northbound.mjs:485, 505`). The interpreter's gate is 16× the
run-level cap — a brief in (4096, 64KiB] passes the interpreter's admission but cannot be delivered whole.

**GT-6 (#207) — the run.start admission.** `application.mjs:4518-4536`:
`objectiveBytes > spillCeiling` (1MiB, `limits.mjs:86`) → `coachingApplicationError` `spill_body_exceeded`
(`:4521-4523`); `objectiveBytes > objectiveCap` (4096) **with** `mintSpill` → `storedObjective` =
truncated head + `[SPILLED {citation}]` suffix (`:4524-4534`); **without** `mintSpill` → the raw oversize
objective is admitted un-spilled (`:4524` + `:4536` — the silent no-spill corner). A wave member's
objective flows through this admission (`wave.mjs:243` `baton.runs.start(member.objective, {...})`), and a
pre-rendered interpreter member passes through `createWave`'s `renderWaveMember` un-salted (`wave.mjs:114`).

**GT-7 (#207) — `createWave` captures the startError; the interpreter never sees it (phantom-fail).**
`createWave` catches a member's start failure and records `entry.startError = { code, message }`
(`wave.mjs:249-251`). The wave handle surfaces it — progress `{role, phase:'failed', terminalCause:'start',
terminal:true, error: entry.startError, …}` (`wave.mjs:353`) and settle outcome `error: entry.startError`
(`wave.mjs:472`) — but `wave.runs` **excludes** start-failed members: `filter(([, entry]) => entry.run)`
(`wave.mjs:545-546`). The interpreter reads only `wave.runs`; a member with no handle gets
`preOutcome {phase:'failed', terminal:true, resultSha:null}` (`workflow-interpreter.mjs:582`) and the D6
outcome carries no error field (`workflow-interpreter.mjs:609`) — the receipt reports a bare `failed` with
no cause. The spill-resolve seam exists at the readers (`_resolveSpillObjective`, `application.mjs:3438-3455`;
used at `:3546`, `:12101`), so a member that *does* start with a spilled objective reads the full body at
projection — the phantom is specifically the **failed-to-start** member whose cause vanishes.

**GT-8 (#207) — the spill-digest-citation graceful path exists but is not deliberately engaged by the
wave lane.** The `run.objective`/`wave.member.objective` rows declare `graceful: 'spill-digest-citation'`
(`limits.mjs:56-57`); run.start admits oversize-with-spill (GT-6); readers resolve the citation to the full
body (`application.mjs:3438-3455`). But `renderObjective` renders the full brief with no awareness of the
cap or the spill path (`workflow-interpreter.mjs:333-348`) — the interpreter neither refuses an
undeliverable brief nor deliberately routes one through the spill; the spill happens as a side effect of the
member's run.start, and a start that fails is phantom (GT-7).

---

## 2. Decisions (D-numbered)

**D1 (#207) — `renderObjective` refuses at admission, typed, when the rendered member objective cannot be
delivered whole.** The interpreter's objectiveRef admission becomes the SAME byte law run.start enforces:
`renderObjective` (`workflow-interpreter.mjs:333-348`) refuses `workflow_objective_ref_invalid` when
`Buffer.byteLength('[attempt: <salt> <role>] ' + text) > FRAME_LIMITS['wave.member.objective'].value`
(4096, `limits.mjs:57`), naming the role, the rendered bytes, and the cap. The 64KiB
`OBJECTIVE_REF_MAX_BYTES` (`workflow-interpreter.mjs:39`) is removed from the wave lane's admission — a
brief is admissible iff its **rendered** objective fits the run cap. **Why:** the wave lane admits only what
it can deliver whole; a brief in (cap − salt, 64KiB] that today spills-or-phantoms (GT-6/GT-7) becomes a loud
typed refusal at admission. The spill-digest path REMAINS the graceful mechanism for standalone `run.start`
callers (its designed consumer, GT-8) and for the run-level admission (GT-6); the wave lane does not use it
because a wave member must receive its full objective — the citation resolution is reader-side
(`application.mjs:3438-3455`) and the interpreter has no surface to guarantee the member's read seam. The
alternative (deliberately routing oversize member briefs through the spill) is recorded at OQ1.

**D2 (#207) — the startError rides the D6 receipt.** A member whose `run.start` failed (no handle in
`wave.runs`) MUST be reported on the D6 receipt **with the cause**: the outcome gains an `error` field
carrying `entry.startError` (`{code, message}`, `wave.mjs:249-251`). Concretely: the preOutcome build
(`workflow-interpreter.mjs:580-592`) must read the start-failed member's error from the wave handle and
carry it into the D6 outcome (`workflow-interpreter.mjs:609`). The wave handle ALREADY surfaces the error
(`wave.mjs:353`, `:472`) — the interpreter currently reads only the live `wave.runs` map (`wave.mjs:545-546`).
The mechanism is the implementer's choice (a `wave.memberOutcome(role)` accessor; an attach-read of
progress/outcomes; or including failed entries in `wave.runs` with a start-error-carrying handle); the
CONTRACT is the surface: a phantom `phase:'failed'` with no cause is a violation. A start-failed member also
forces verdict WAVE-INCOMPLETE — `everySettled` (`workflow-interpreter.mjs:618`) must treat a start-failed
member as unsettled (a failed start is not a settled member).

**D3 (#202) — the doctor response is a structured object on every surface, never a bare text.**
`deployment.doctor` (embedded `doctorReadiness()`, MCP `baton_deployment_doctor`, CLI `baton doctor`)
returns the structured readiness object — top-level `schemaVersion` + `routes`, with the surface-appropriate
application/workspace/readiness material — and NEVER a bare-string ack. The incident's
`'Command executed successfully.'` is a FORBIDDEN response shape; the structured response is the
surface-constant contract. Secret-shaped values are stripped at the transport (the MCP sanitizer,
`mcp-northbound.mjs:2158-2172`); the CLI's composed shape (`application-cli.mjs:1974-1984`) is a documented
reading-consumer composition that must carry the doctorReadiness keys (`schemaVersion`, `routes`) plus the
application card — it adds `ready`/`briefing` for CLI UX but never replaces the structured object with text.
**Why:** #202's remediation is already landed at HEAD (GT-4); this rung asserts the shape as D3 behavior so
the bare-text regression cannot return — it is NOT pinned (a pin that passes at HEAD is no pin,
`contract-165.md:356-358`). This row's red-first pins are #173/#207 only.

**D4 (#173) — `waves.run` mints a durable launch acceptance; the D6 receipt is recoverable by waveId.**
The launch surface must not lose the wave's own receipt on a client timeout. Two guarantees:
(a) **LAUNCH-ACCEPTANCE** — the waveId is minted and surfaced to the caller at/before the wave drives (the
detached `baton_waves_start` already returns `{waveId, members}` immediately, `mcp-northbound.mjs:493-511`;
the waveId derives from the idempotency key, `wave.mjs:207`); a caller that times out must be able to
re-derive/re-discover the waveId (stable idempotencyKey, or `waves.list`).
(b) **RECEIPT-RECOVERY** — the D6-equivalent receipt (basis/harvest/outcomes/steering/verdict) is recoverable
by waveId after the fact: `waves.attach` settles and returns closed outcomes (`mcp-northbound.mjs:476-492`;
`wave.mjs:275-337`), and the interpreter's `runWorkflow` supports a resume-by-waveId mode (re-attach +
re-derive the receipt) OR the wave handle's settle/harvest yields the D6 keys. The synchronous return of the
D6 receipt stays available for waves that settle within the client budget; the guarantee is that a timeout
never strands the receipt. The alternative — a fully async `waves.run` returning
`{accepted, waveId, driver:'detached'}` immediately with the receipt deferred to a harvest verb — is
recorded at OQ2; D4 keeps the synchronous return and ADDS the durable waveId acceptance + recovery (the
minimal change over the existing detach machinery, GT-3).

---

## 3. Refusal vocabulary (closed, typed, surface-constant)

The lane's codes are unchanged and remain byte-constant across embedded/MCP/CLI/web (W6-01 pins the
constancy): `workflow_spec_invalid`, `workflow_member_invalid`, `workflow_objective_ref_invalid`,
`workflow_steering_unknown`, `workflow_harvest_invalid` (`workflow-interpreter.mjs:29-33`). D1 reuses
`workflow_objective_ref_invalid` — **no new code**. The run.start admission keeps `spill_body_exceeded`
(`limits.mjs:56-57`, `application.mjs:4522`). D2 adds no refusal — the receipt's `error` field carries the
underlying start error's code (`spill_body_exceeded`, `application_*`, …). D3 adds no refusal — the doctor
response is a success shape. D4 adds no refusal — acceptance/recovery are receipt behaviors. Every code
survives the surfaces byte-identically; the D1 refusal rides the same constancy as the existing
`workflow_*` family.

---

## 4. Red-first acceptance pins

Each pin is **RED at HEAD** at a named stage and green only for a correct impl (foundry law:
shallow-greenability is a defect; a pin that passes at HEAD is no pin — `contract-165.md:356-358`).
There is DELIBERATELY no #202 pin: the bare-text-response remediation is already landed (GT-4), so a
#202 shape pin would pass at HEAD and be a no-pin — the response-shape contract is asserted in D3 and
guarded as behavior, not pinned. "At HEAD" evidence is against `1ff8335`.

| Pin | Assertion | At HEAD |
|---|---|---|
| **P1** `stage[objective-ref-invalid]` | **D1 admission alignment:** a `waves.run` spec whose member objectiveRef renders to `[attempt: <salt> <role>] <brief>` with `Buffer.byteLength(rendered) > 4096` refuses `workflow_objective_ref_invalid` AT ADMISSION naming the role, rendered bytes, and cap — the W1-03 table gains the case. | **RED** — `renderObjective` checks only the 64KiB `OBJECTIVE_REF_MAX_BYTES` (`workflow-interpreter.mjs:39, 340-341`); a ~5KiB brief passes admission and is delivered to run.start oversize (GT-6). Green only when the rendered-objective cap is enforced. |
| **P2** `stage[lane-missing]` | **D2 startError on the wire:** a `waves.run` with a member whose run.start refuses (the suite's in-memory driver throws for the named role) yields a D6 outcome for that role carrying `error: {code, message}` (the createWave startError) and verdict WAVE-INCOMPLETE. | **RED** — a start-failed member has no handle in `wave.runs` (`wave.mjs:545-546`); the interpreter's preOutcome is `{phase:'failed', terminal:true, resultSha:null}` (`workflow-interpreter.mjs:582`) and the outcome has no error field (`:609`); `everySettled` counts the phantom 'failed' as settled (`:618`). Green only when the startError rides the receipt. |
| **P3** `stage[receipt-recovery-missing]` | **D4 receipt-recovery:** after a client timeout on a `waves.run` launch, the wave remains live server-side and its D6-equivalent receipt is recoverable by waveId (re-derived from the idempotencyKey, then attached+settled, or resumed by the interpreter's waveId mode) — the receipt is never lost. | **RED** — the D6 receipt is the return value only (GT-2); no recovery surface exists; a timed-out launch strands the receipt (the #173 landing note, GT-1). Green only when the receipt is recoverable by waveId. |
| **P4** `stage[launch-acceptance-missing]` | **D4 launch-acceptance:** the `waves.run` launch surfaces the durable waveId to the caller before the wave settles (acceptance), OR the caller can recover it via a stable idempotencyKey + `waves.list`/`waves.attach`. | **RED** — `baton_waves_run` awaits the full drive and returns only the final receipt (`mcp-northbound.mjs:1813-1822`); the waveId is never surfaced mid-flight (GT-2). Green only when the launch acceptance exists. |

### 4.1 Fold-record-ready pin list

| Pin | Stage | Code | Behavior (one line) | At HEAD |
|---|---|---|---|---|
| P1 | `objective-ref-invalid` | `workflow_objective_ref_invalid` | the interpreter refuses a member objectiveRef whose RENDERED `[attempt: …] ` objective exceeds the 4096-byte `wave.member.objective` cap, naming role + rendered bytes | RED |
| P2 | `lane-missing` | receipt carries `error` | a start-failed member's D6 outcome carries `error: {code, message}` (the createWave startError) and the verdict is WAVE-INCOMPLETE | RED |
| P3 | `receipt-recovery-missing` | — | after a client timeout, the wave's D6-equivalent receipt is recoverable by waveId (attach+settle, or interpreter resume) | RED |
| P4 | `launch-acceptance-missing` | — | the `waves.run` launch surfaces a durable waveId before the wave settles (or a stable idempotencyKey recovers it) | RED |

### Cross-references (package-③ boundary agreement)

- **`contract-filesystem.md` (row-lc-fs)** — #168/#172/#185, the member confinement/settle sweep. P2's start-failed member rides the same settle path (`wave.mjs:472`); the fs contract's settle sweep and this contract's receipt must agree on whether a start-failed member participates in any filesystem sweep (it must NOT — it has no worktree).
- **`contract-members.md` (row-lc-members)** — #199/#200/#204, creation failures emit typed events, never phantom. P2 is the launch-side half of the same "never phantom" law: #199 pins the member-creation EVENT; this contract pins the RECEIPT outcome. The two must agree on the `{code, message}` error shape for a creation/start failure.
- **`contract-ledger.md` (row-lc-ledger)** — #194/#205, model-visible-means-logged. D4's receipt-recovery (P3) reads wave outcomes after the fact; the ledger contract governs whether a recovered receipt is itself ledgered.

### Fold notes (judgment calls recorded per the brief)

- **D1 chose refusal-at-admission over deliberate spill.** The spill-digest-citation graceful path exists (GT-8) and the wave-start admission comment claims the wave lane "admits oversize with spill" (`application.mjs:2011-2013`); D1 refuses at the interpreter's admission instead because a wave member must receive its full objective and the citation resolution is reader-side (`application.mjs:3438-3455`), not contractible from the interpreter's seat. The spill path stays the standalone-`run.start` mechanism. OQ1 records the alternative.
- **D4 chose synchronous + recoverable over fully-async.** The detach machinery exists (GT-3), but making `waves.run` fully async changes the run verb's contract across CLI/MCP/web; D4 keeps the synchronous D6 return and adds the durable waveId acceptance + receipt-recovery. OQ2 records the alternative.
- **#202 is decision-asserted, not pinned.** The bare-text incident is already remediated (GT-4); per the foundry discipline a pin that passes at HEAD is no pin (`contract-165.md:356-358`), so D3 asserts the response-shape contract and the pins table is strictly red-first (#173/#207).
- **Closed verdict vocabulary.** D2 pins WAVE-INCOMPLETE for a start-failed member (`workflow-interpreter.mjs:618`, `:620`) rather than adding a new verdict class; OQ3 records the alternative.

---

## 5. Open questions

- **OQ1** — Should the wave lane instead DELIBERATELY route oversize member briefs through the
  spill-digest-citation path (mintSpill + citation at `renderObjective`, full-body resolution at the member's
  read seam)? D1 refuses at admission instead. Requires a member-facing read seam guaranteed to resolve
  citations (`application.mjs:3438-3455`) — currently reader-side, not contractible from the interpreter's
  seat. Recorded as the D1 alternative.
- **OQ2** — Should `waves.run` become fully async (return `{accepted, waveId, driver:'detached'}`
  immediately; the receipt via a harvest verb)? D4 keeps the synchronous return and adds the durable
  acceptance + recovery. The async shape is the larger semantic change and would also change the CLI/MCP run
  verb's contract.
- **OQ3** — The D6 verdict semantics for a start-failed member: D2 pins WAVE-INCOMPLETE. Should a
  start-failed member instead surface as a distinct verdict class (e.g. WAVE-START-FAILED)? Judgment call:
  keep the closed two-verdict vocabulary (WAVE-OK / WAVE-INCOMPLETE, `workflow-interpreter.mjs:620`) for
  surface-constancy.
- **OQ4 — shared publish: RECORDED REFUSAL (#158).** The foundry law: "Publish to `shared` when complete —
  or record the exact refusal (evidence, #158)." The shared publish path (`run.scratchpad.append`) is RED at
  HEAD: verified — no `run.scratchpad.append` surface exists in `application.mjs` (grep exit 1); the only
  scratchpad WRITERS are `coordinator.mjs:13003` (`case 'scratchpad.write':`) and `claude-session.mjs:1146`,
  both inside the coordinator's worker session, unreachable from this worktree. The read/elevate surfaces
  (`scratchpad.read`, `scratchpad.elevate`, `scratchpad.settle`) exist (`mcp-northbound.mjs:1836-1848`) but no
  append. Therefore the shared publish is REFUSED with this evidence; this redrive deliverable is the durable
  record.

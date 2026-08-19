PHANTOM-ROOT-VERIFY v1
[attempt: 69a0f586-f9da-4bb3-b5ae-ec63c53d19a5 coordinator]
Status: GROUNDED — the three rows (row-task-namespace #200, row-admission-align #207,
row-spawn-window #199) have not settled as of this writing (no row notes, no pin files, no
sibling-worktree commits at base 1f0f1495). §1–§4 are measured and final at base; §5 (per-row
verdicts) is written on settle per signalOnMembersDone. Nothing in §1–§4 is carried from an
earlier wave's notes — every number was re-measured this session at this base.

# phantom-root wave-f — coordinator verification notes

Coordinator: wave `phantom-root-2026-08-15-wave-f`, member `coordinator` (this worktree
`ws-d07978b08e85a21393f32b45acc5a880`, base `1f0f1495`). Rows under verification:
`row-task-namespace` (#200 — member task ids carry the wave namespace), `row-admission-align`
(#207 — wave admission refuses briefs members cannot start), `row-spawn-window` (#199 — no
failed-verdict inside the spawn-confirmation window). Contracts: issues #199/#200/#207 — gh is
UNAUTHENTICATED in this worktree (verified: `issue://199` resolution fails with "GitHub CLI is
not authenticated"), so the contracts are grounded from the repo's own measured history: the
wave pack `4ff9b9fb` (docs: phantom-root impl-wave pack), the surface fix `852700a5`
(fix(#200-surface): phantom members are named with their typed start errors), `1a70099a` (the
4096-byte run.objective admission note filed on #199), and the row briefs (verified
byte-identical to the wave-f copies at 15a49118 in the main checkout). Verification law: the
acceptance authority is each row's red-first pin green at ITS HEAD; interpreter/wave/coordinator
batteries unchanged; verdict written on settle (pinned #175 semantics — I am the remaining
member).

## §1 Suites read, immutability baseline (SHA-256, first 16 hex, this session at 1f0f1495)

Batteries (the acceptance's "unchanged" set):

- `test/workflow-as-data-red.test.mjs` 069fb14906b770a4 — the interpreter battery (#114)
- `test/wave-driver-red.test.mjs` 40472d27d48556a2 — the wave battery
- `test/coordinator.test.mjs` 11970b86e90f92b9 — the coordinator battery
- `test/workflow-dsl-red.test.mjs` 366e73a23e0c0bd5 — the DSL/compile surface battery
- `test/workflow-dsl-package-red.test.mjs` 28f18b2a40dc3680 — the DSL package battery

Row-partition source files at base (the rows' scopes; immutability of these is NOT required —
the rows edit them — the SHAs anchor what the fixes build on):

- `src/wave.mjs` 215296b218e2957d · `src/workflow-interpreter.mjs` b6d5776de117775c
- `src/limits.mjs` 45b06693e9a35333 · `src/coordinator.mjs` bc3c6429fdf15e83

The rows' pin suites are ABSENT at base (glob `impl/test/*wave-task-namespace*`,
`*objective-admission-align*`, `*spawn-window*` → no matches) — RED-first files are created by
the rows, never edited into an existing suite.

## §2 Measured baseline at base 1f0f1495 (my tree, clean, run from impl/)

`node --test test/<suite>.test.mjs`:

| suite | tests | pass | fail | notes |
|---|---|---|---|---|
| workflow-as-data-red | 31 | 31 | 0 | green (17.3 s) |
| wave-driver-red | 10 | 10 | 0 | green (10.6 s) |
| coordinator | 58 | 58 | 0 | green (1.7 s) |
| workflow-dsl-red + workflow-dsl-package-red | 47 | 47 | 0 | green (241.7 s) |

All five battery suites green at base. The rows' fixes must leave these green-unchanged (SHA
identity of the suites is part of that — suites are immutable; green is earned by impl only).

## §3 Structural findings (re-measured at base)

### §3.1 row-task-namespace (#200) — the task-id derivation and the re-drive collision

- `impl/src/wave.mjs:215` — `createWave` mints `const salt = randomUUID()` per call;
  `renderWaveMember` (wave.mjs:112-131) salts ONLY objectiveRef-shaped members:
  `[attempt: <salt> <role>] <text>` (line 121). A pre-rendered member (the interpreter path,
  workflow-interpreter.mjs:580-588 — `renderObjective` at :337-352, salt owned by the
  interpreter) passes through untouched: `if (typeof base.objective === 'string' &&
  base.objective.trim().length > 0) return base;`.
- `impl/src/application.mjs:4428` (single-node `-work` mint) and :4336/:4386 (revision/wave
  node mints): `taskId = baton-${digest({repoId, runId, planDigest, nodeKey,
  dispatchVersion}).slice(0,24)}-work` — keyed on runId, planDigest, nodeKey; NO wave
  idempotencyKey and NO waveId anywhere in the digest inputs.
- `impl/src/application.mjs:4545-4552`: `runId = run-${digest({objective, resultIntent
  identity, profileDigest, route, composition, scope, ownerPrincipalId}).slice(0,32)}` — no
  wave identity either.
- The re-drive path: `impl/src/wave-driver.mjs:359-382` — the driver mints the salt ONCE per
  `run()` call and reuses it across internal retries; `saltObjectives:false` opts into
  cross-wave run sharing (identical objective → identical runId → identical taskId); the
  same-key re-drive passes `allowTerminalReplay: true` so createWave's `wave_already_terminal`
  refusal (wave.mjs:210-213) is skipped and the drive RE-ATTACHES the prior run — the #200
  evidence shape: `baton-0b77f5031f85e9b33edbad4d-work` bound by re-drive attempt-b, verdict
  failed, no spawn.
- The member mint seam the fix may use: the interpreter's `renderObjective`
  (workflow-interpreter.mjs:337-352) — the wave key (`spec.idempotencyKey`) is known there;
  `prepareRunStart` (application-client.mjs:112+) already admits a `waveId` option; the runId
  digest simply does not consume it. Contract check on settle: same-brief re-drive NEVER
  collides; wave-internal lookups by role unaffected; store schemas unchanged; pin
  `impl/test/wave-task-namespace-red.test.mjs`.

### §3.2 row-admission-align (#207) — the admission misalignment, MEASURED at base

Registry facts (limits.mjs): `run.objective` cap 4096 B (limits.mjs:56, graceful
spill-digest-citation); `wave.member.objective` cap 4096 B (limits.mjs:57); `spill.body`
substrate ceiling 1 MiB (limits.mjs:86); `wave.run.spec_path` 4096 B with
`workflow_spec_invalid` (limits.mjs:58).

Interpreter seam (workflow-interpreter.mjs): `OBJECTIVE_REF_MAX_BYTES = 64 * 1024` (line 46,
"pinned at its exact value F8b") enforced at renderObjective:347-348 with
`workflow_objective_ref_invalid`; `waves.compile` (`compileWaveSpec`, application.mjs:11763)
is explicitly admission-free (never starts a wave); admission for `waves.run` happens in
runWorkflow → admitSpec → renderObjective → waves.start.

The server-side run.start spill (application.mjs:4519-4535): objective > 4096 and ≤ 1 MiB is
ADMITTED with a durable spill artifact (`[SPILLED …]` citation); beyond 1 MiB → typed
`spill_body_exceeded` coaching refusal.

THE MEASURED GAP — the client wall that defeats the spill lane for wave members:
`impl/src/application-client.mjs:11` `nonempty(value)` = string, non-blank, AND
`Buffer.byteLength(value) <= 4096`. Any objective over 4096 bytes fails the client-side
`prepareRunStart` check (application-client.mjs:113) with the MISLEADING message
`clientError('Run objective is required')` — code `application_client_invalid` — before the
command ever reaches the server's spill lane. Empirical probe this session at base (5 KiB brief,
real BatonApplication + MockAdapter stack):

- `baton.runs.start('[attempt: salt w1-a] ' + 5KiB-brief, {…wave options})` →
  THREW `application_client_invalid | Run objective is required`.
- Full `baton.recipes.runWorkflow` with a 5 KiB objectiveRef brief → RECEIPT WAVE-OK (!) with
  the single outcome `{phase: 'failed', terminalCause: 'start', error: {code:
  'application_client_invalid', message: 'Run objective is required'}}` — the wave ADMITS at
  the seam, then the member phantom-fails at start. The row brief's pin premise ("admits, then
  every member spill_body_exceeded") is CONFIRMED in shape (admit → per-member phantom start
  failure) with the measured refusal code being `application_client_invalid` /
  "Run objective is required" rather than `spill_body_exceeded` — the client 4096 wall fires
  first. The row's pin should name the byte counts per contract item 1; the refusal-code
  literal in the pin is the row's call, but the measured base code-path is this one.
- Wire-surface corroboration: `application-semantics.mjs:1572/:1596` and
  `mcp-northbound.mjs:561/:581` schema `maxLength: FRAME_LIMITS['wave.member.objective'].value`
  (4096) on wave member objectives — the MCP/web wire refuses > 4096 chars at schema
  validation. (This is the #207-class overflow the interpreter must fail-loud about at
  admission.)
- Contract item 2's judgment call (64 KiB OBJECTIVE_REF_MAX_BYTES vs the run cap) is the ROW's
  to record (OQ5 spill-aware advisory PASS exists at the driver: wave-driver.mjs:363-373 emits
  `onAdvisory {spill: true}` and passes through; but the CLIENT wall measured above means the
  advisory never governs the wave path). No cap values change (hard bound).

### §3.3 row-spawn-window (#199) — the failed-verdict inside the spawn-confirmation window

- Evidence shape (row brief + 852700a5): member claims task (seq N), `lifecycle.spawned` N+2,
  `turn_started` + `process_started` N+3-4, a SECOND `lifecycle.spawned` N+5 (harness
  double-spawn), then the interpreter verdicts the member failed while it keeps working
  orphaned.
- The interpreter verdict path (workflow-interpreter.mjs): `isTerminal(v)` (:507) =
  `v.terminal === true || TERMINAL_PHASES.has(v.phase) || v.terminalStatus === 'completed'`
  with TERMINAL_PHASES incl. 'failed' (:501); the drive's terminal detection (:905-915)
  hard-breaks on `UNRECOVERABLE_TERMINAL_PHASES` ('failed'/'cancelled'/'denied', :516) with
  `wave_terminalized_unrecoverable`; the unreadable-member A12 leg (:922-931) accumulates
  `QUIESCENCE_CONFIRMATION_POLLS + 1 = 3` consecutive phase-less polls before terminalizing.
  The race: a status read DURING the spawn-confirmation window projects a transient 'failed'
  (no task-failed transition, no process_closed-with-no-successor, no startError) and the drive
  verdicts immediately — the single-read path has NO evidence-count confirmation for a
  suspicious phase read (contrast the A12 unreadable leg, which confirms across polls). The
  3794b583 landed tri-state pattern is the stated model for the fix.
- Coordinator spawn/claim sites (the double-spawn ownership question): `lifecycle.spawned`
  handled at coordinator.mjs:12551 (actor worker), :12579, :12655, :12724 (worker-policy
  attestation — the #236 fleet fix), :12742; admission receipts count exactly one spawned
  (:5790-5791, :6183); worker identity `w-wave-<sha256(member.taskId).slice(0,24)>`
  (coordinator.mjs:4359). Contract check on settle: failed verdict ONLY on terminal evidence
  (task failed transition with cause / process_closed with no successor / startError); a
  suspicious read defers to the next poll (evidence-count); a second spawned binds the same
  member (generation advance), never a new claim; no clocks (evidence-count only); pin
  `impl/test/spawn-window-red.test.mjs` reproducing claim → spawned → process_started → second
  spawned, asserting NOT verdict-failed while evidence advances.

## §4 Environment facts

- gh unauthenticated in this worktree (verified by `issue://` resolution failure) — no GitHub
  reads possible; all evidence above is code- and suite-grounded.
- Worktree base `1f0f1495` = `fix(#236): quiescence counts tool execution as activity`; wave-f
  materials (briefs/wavefile) live in the main checkout at `15a49118` and are byte-identical to
  the wave-e copies in this tree (verified by diff). The three rows' worktrees are clean at the
  same base as of this grounding (no pin files, no notes, no commits on any `baton/ws-*`
  branch).

## §5 Row verification (written on settle)

PARTIAL — row-admission-align's red-first CONFIRMED at its pre-fix head (measured this session
in sibling worktree `ws-c6d6a3…`, base 1f0f1495, before its fix landed): the pin
`impl/test/objective-admission-align-red.test.mjs` runs 3 tests → 2 RED (ADMISSION-ALIGN-RED,
ADMISSION-ALIGN-BOUNDARY — both fail at base with "PIN: admission passed — waves.start was
reached", exactly the §3.2 seam) + 1 green guard (ADMISSION-ALIGN-GUARD passes at base). The
row has since modified `impl/src/workflow-interpreter.mjs` (fix in flight). The other two rows
had not created pins as of this measurement.

PENDING — no row has settled as of this grounding. The wavefile's `signalOnMembersDone
row-task-namespace,row-admission-align,row-spawn-window` signal is the settle trigger (pinned
#175 semantics — I am the remaining member); row notes land at
`docs/reference/evidence/phantom-root-2026-08-15/wave-f/notes-row-*.md` (each must carry its
`[attempt:]` line, per the wavefile harvest).

On settle, for EACH row, at ITS HEAD (the row's sibling worktree `../../wt/ws-*/`):

1. Read the row's notes file (attempt line, judgment calls — esp. row-admission-align's OQ5
   contract-item-2 call).
2. Run the row's red-first pin: `node --test impl/test/<pin>.test.mjs` — must be GREEN at the
   row's HEAD (the pin is RED at base: verified absent, and the measured base behavior in §3.2
   for the admission row).
3. Spot-audit the pin's RED premise against the pre-change head where feasible (the pin's own
   stage naming + this note's §3 anchors).
4. Re-run the five battery suites (or the row-affected subset) FROM THE ROW'S TREE — must be
   green-unchanged; suite SHAs must equal §1's.
5. Record measured counts + the verdict per row; finalize this note. A row that cannot be
   verified (no notes, absent pin, red pin, battery break) is recorded honestly — the acceptance
   authority is the pin at the row's HEAD, and this note never fabricates a pass.

### §5.x DECISION_REQUEST (recorded) — carried from grounding

None at this time. If a row settles with a pin whose refusal-code literal contradicts the
measured base code-path (§3.2: `application_client_invalid`/"Run objective is required" is the
measured per-member start refusal for a 4-64 KiB brief at base — not `spill_body_exceeded`),
that is the row's documented judgment call under contract item 1/2, to be evaluated against the
byte-count naming requirement, not the literal.

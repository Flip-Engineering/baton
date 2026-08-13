# Suite draft notes — launch-validation red suite (row-suite-165)

[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-165]

- **Deliverable suite:** `impl/test/launch-validation-red.test.mjs`
- **Binding contract:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` v2 (folded) — ground truths G1-G10, decisions D1 (the file-only law on both surfaces) / D2 (deliverable-coverage with the strict `## Deliverables` grammar) / D3 (the spec-side admission pin), the refusal vocabulary, the red-first acceptance pins A1-A7, open questions OQ1-OQ6.
- **Attack surface read:** `docs/reference/evidence/contract-foundry-2026-08-13/redteam-165.md` (the four blockers; D2-H1 the prose-parses-as-path attack this suite's A3 discriminates) and `fold-165.md` (the fold map). All three read from the main tree at `30e1e73` — the worktree snapshot predates the fold-pack commit.
- **Idioms mirrored:** `impl/test/workflow-as-data-red.test.mjs` (the W1-05 harvest-invalid stage, the wadFixture stack, LANE_DRIVER, the MCP `realServer`/`wireCall` helpers, F16 far-future clock), `impl/test/phase12-web-northbound.test.mjs` (the web envelope/context shape), `impl/test/control-surface-truth-red.test.mjs` (execFileSync conformance idiom), `docs/reference/evidence/run-task-wave.mjs` (the generic driver under test).
- **HEAD measured at:** `e371f70` (Baton private effective-tree snapshot) — the contract's verification HEAD.

## 1. Row inventory — every §red-first-acceptance pin becomes a row at its named stage

The suite implements the full §red-first matrix: 12 tests = 9 red capability rows (A1, A2, A3,
A3-nearmiss, A4, A4-object, A5, A7, S1) + 3 green guard/pin rows (A6, P2, E1). Each row names its
`stage:` seam in the assertion message and asserts the refusal the contract pins. Every red row
fails at HEAD at its named stage — never on a fixture artifact; the three green rows guard landed
behavior the contract says is unchanged.

| Row | Contract pin | Named stage | Post-landing assertion | HEAD seam (why RED) |
|-----|--------------|-------------|------------------------|---------------------|
| A1 | D1a driver directory refusal | `d1a-directory-refused` | `run-task-wave.mjs --targets docs/reports` (real dir) → exit 2 + `target_directory_refused` + message names the path, `names a directory`, `FILES` | driver validates `--targets` presence only (`run-task-wave.mjs:44-47`); a directory target reaches the harvest and silently drops or EISDIR-poisons the pin (G2, App-D row 1) — measured: exits 1 with `authentication_required` at `waves.start` |
| A2 | D2a driver deliverable-coverage refusal | `d2a-coverage-refused` | brief with `## Deliverables` naming `docs/a2-deliverable.md` absent from `--targets` → exit 2 + `deliverables_uncovered` naming the path | driver never reads the brief (`:60` embeds the path, reads nothing — G6); no coverage predicate can fire |
| A3 | D2 strict grammar | `d2-grammar-prose` | prose bullet (`- the contract file, plus its fold map`) inside `## Deliverables` → exit 2 + `deliverables_malformed` naming the line | no brief read at all (G6); prose is neither parsed nor refused — the D2-H1 attack is left un-discriminated |
| A3-nearmiss | D2 grammar closure (fold) | `d2-grammar-nearmiss-heading` | a `### Deliverables` heading with no `## Deliverables` section → exit 2 + `deliverables_malformed` naming the heading | no brief read at all (G6) |
| A4 | D1b/D3 interpreter admission, string form | `d1b-admission-directory` | `harvest.paths: ['docs/reports']` (the fixture's real launch-tree directory) → `workflow_harvest_invalid` AT ADMISSION naming the path + the law | `admitHarvestEntry` checks containment only (`workflow-interpreter.mjs:300-327`); a directory passes admission and refuses only at harvest time as `harvest_miss` (`:632`) |
| A4-object | D1b/D3 interpreter admission, `{path, mustContain}` form | `d1b-admission-directory-object` | the object entry form refuses the same directory with the same code + message | same seam, object form (`:308,311,314`) — no shape check at HEAD |
| A5 | D3 + D2b typed code survives the `waves.run` surface | `d3-transport-code-survival` | the same directory harvest spec refuses `workflow_harvest_invalid` naming the path on CLI (`baton waves run`), MCP (`baton_waves_run`), AND web (`waves_run` direct port) — no transport-side re-spelling | no admission check exists (A4); there is no refusal to survive the transports — measured: the CLI leg runs the full wave and resolves |
| A7 | D2b spec-surface deliverable-coverage | `d2b-objective-render-coverage` | member objectiveRef brief declares `docs/lv-a7-deliverable.md` absent from `harvest.paths` → `workflow_harvest_invalid` AT THE OBJECTIVE RENDER naming the uncovered set + the role | `renderObjective` reads the brief only to build the objective text (`:339`); no `## Deliverables` parse and no coverage predicate (D2-H4) |
| S1 | static — driver launch-refusal tokens | `static-launch-refusal-tokens` | the four tokens `target_directory_refused` / `deliverables_malformed` / `deliverables_uncovered` / `brief_unreadable` exist in the driver source as literals | none of the four exist at HEAD (the refusal vocabulary is RED) |
| A6 | D2 normalization non-refusal (GREEN guard) | `d2-normalization-non-refusal` | `./docs/a6-deliverable.md` vs `--targets docs/a6-deliverable.md` does NOT refuse (exit ≠ 2, no `deliverables_uncovered`) — the launch proceeds to `waves.start` | no predicate to misfire — the pin binds the GREEN implementation to the one-pass normalization (a raw-string set-difference would false-refuse, D2-H2) |
| P2 | D3 containment guard (GREEN guard) | `d1b-containment-guard` | `harvest.paths: ['../outside.md']` refuses `workflow_harvest_invalid` naming the path | `assertHarvestContained` (`:320-327`) throws the typed code at admission — the landed substrate the new axes join |
| E1 | exit-code map (GREEN static pin) | `exit-code-map` | driver source carries `process.exit(2)` (launch/argument refusals), `process.exitCode = 1` ONLY for start-refused, and NO exit-code assignment after the last `receipts.verdict =` | holds at HEAD — the verified map (red-team C1): verdicts are receipt-carried, the process exits 0 for `-FAILED`/`-DRAINED`/`-INCOMPLETE` |

## 2. Stage table

| Stage | Family | Rows | Surface exercised | Repair pinned |
|-------|--------|------|-------------------|--------------|
| `d1a-directory-refused` | driver D1a | A1 | real `run-task-wave.mjs` subprocess | driver `stat`/shape check before `waves.start` (D1a) |
| `d2a-coverage-refused` | driver D2a | A2 | real `run-task-wave.mjs` subprocess | driver brief read + coverage predicate (D2a) |
| `d2-grammar-prose` / `d2-grammar-nearmiss-heading` | driver D2 grammar | A3, A3-nearmiss | real `run-task-wave.mjs` subprocess | strict `## Deliverables` parser + `deliverables_malformed` |
| `d1b-admission-directory` (+ `-object`) | interpreter D1b/D3 | A4, A4-object | `baton.recipes.runWorkflow` (embedded lane, LANE_DRIVER) | `admitHarvestEntry` launch-tree shape check (both entry forms) |
| `d3-transport-code-survival` | interpreter D3 + D2b across transports | A5 | `application.command` (CLI), `McpFleetServer` `baton_waves_run`, `WebNorthbound` `waves_run` | the admission refusal + a `workflow_*` dispatchFailure arm on the web surface (absent at HEAD — see judgment call 3) |
| `d2b-objective-render-coverage` | interpreter D2b | A7 | `baton.recipes.runWorkflow` (embedded lane, LANE_DRIVER) | `renderObjective` `## Deliverables` parse + coverage predicate |
| `static-launch-refusal-tokens` | static | S1 | driver source read | the four driver tokens land as literals |
| `d2-normalization-non-refusal` | D2 normalization (GREEN) | A6 | real `run-task-wave.mjs` subprocess | one-pass normalization (strip `./`, collapse `//`, strip trailing `/`) |
| `d1b-containment-guard` | D3 containment (GREEN) | P2 | `baton.recipes.runWorkflow` (embedded lane, LANE_DRIVER) | — (landed; stays green) |
| `exit-code-map` | static (GREEN) | E1 | driver source read | — (landed; stays green) |

## 3. Verified split (split-twice, `node impl/scripts/run-suite.mjs impl/test/launch-validation-red.test.mjs`)

Four runs total, all at HEAD `e371f70`, identical result (stable split). The original two runs and
a re-verification pair on the continuation turn:

```
Run 1: 12 tests — pass 3 / fail 9 (suite exit 1)   duration ~13.1s
Run 2: 12 tests — pass 3 / fail 9 (suite exit 1)   duration ~11.8s
Run 3: 12 tests — pass 3 / fail 9 (suite exit 1)
Run 4: 12 tests — pass 3 / fail 9 (suite exit 1)
```

- **RED (9, capability):** A1 A2 A3 A3-nearmiss A4 A4-object A5 A7 S1
- **GREEN (3, guard/pin):** A6 P2 E1

Row identity confirmed on the re-verification runs by the per-test markers: every RED row's
`stage[…]` name carries its designed seam (A1 `d1a-directory-refused` … A7
`d2b-objective-render-coverage`, S1 `static-launch-refusal-tokens`), and every GREEN row's stage
holds (A6 `d2-normalization-non-refusal`, P2 `d1b-containment-guard`, E1 `exit-code-map`).

Every RED row fails on its designed stage assertion (the `stage[...]` message names the seam and
the measured HEAD behavior — e.g. A1: `assert.equal(r.status, 2, ...)` with `actual: 1` because
the launch reaches `waves.start` and exits 1 with `authentication_required`), never on a fixture
artifact. The pre-checks (`fixture-clock-lint`, surface-conformance ledger) pass. P2/E1 stay
green on both runs.

## 4. Fixture strategy and hermeticity

- **Driver rows (A1/A2/A3/A3-nearmiss/A6) spawn the REAL generic driver** at
  `docs/reference/evidence/run-task-wave.mjs` (`spawnSync`, cwd = the fixture repo) with
  `XDG_CONFIG_HOME` pointed at an empty temp dir inside the fixture. The launch therefore reaches
  `waves.start` and refuses deterministically with `authentication_required` (exit 1,
  `assertRouteReady` at `application-deployment.mjs:1215`) whenever no D1a/D2a refusal fires
  first — no network, no real provider, no host credentials. The fixture repo is a real git repo
  with a base commit (the driver needs HEAD).
- **Interpreter rows (A4/A4-object/A7/P2) drive the real embedded lane**
  `baton.recipes.runWorkflow(spec, { driver: LANE_DRIVER })` (present at HEAD, `recipes.mjs:584`)
  over the wadFixture stack: `createDriver` + `BatonApplication` + `bindBaton` + a plain
  `MockAdapter({ harness: 'mock', scenario: { outcome: 'completed' } })`. The base `card()`
  `modelSelection` (adapter.mjs:230-239) validates the profile route `{mock, mock-model, low}`
  with no override. `docs/reports` is created for real — the launch-tree directory A4/A4-object/A5
  refuse on (G8).
- **A5 runs all three transports.** CLI leg parses `parseBatonCli(['waves','run',<spec.json>])` to
  `waves.run` then drives `application.command('waves.run', { specPath, driver: LANE_DRIVER })`
  with the fast policy (the workflow-as-data F11 cadence choice — the refusal code is
  cadence-independent). MCP leg runs `baton_waves_run { repoId, spec }` over a real
  `McpFleetServer`; web leg runs the real `WebNorthbound` `waves_run` direct port. The web and MCP
  legs cannot take the fast driver at HEAD (web `WAVE_ARG_FIELDS.waves_run` = `{idempotencyKey,
  spec, specPath}` rejects `driver`; MCP drops it), so they ride the production 20 s cadence —
  the test carries a 180 s timeout.
- **Hermeticity.** Every fixture root is `mkdtempSync` under `tmpdir()` (the suite root) and
  cleaned by `t.after`; the spawned driver's artifacts live inside the fixture repo. No wall-clock
  controls (FAR_FUTURE parsed once at module load; `now` injected into the northbound
  constructors). NUL discipline: `application.mjs`/`coordination-store.mjs` are never read whole.
  Static anchors are EXISTENCE/byte-string assertions only — never absolute line windows (#166).
- **Attempt echo.** `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-165]` appears
  verbatim as the first line of this notes file and the first line of the suite file (harvest
  attribution check #171).

## 5. The shared-scratchpad publish: refused (recorded as evidence)

The suite law's publish-as-you-go requires the `run.scratchpad.append` verb (#158) on the `shared`
partition. Per contract-165 OQ4 the verb is RED (unlanded) at HEAD. The publish was attempted and
refused, exactly as measured this session:

- `parseBatonCli(['run','scratchpad','append','--scope','shared','--kind','note','--title','165','--body',...])`
  → `cli_invalid :: unexpected argument append` (the verb does not parse at HEAD).
- `'run.scratchpad.append' in APPLICATION_COMMAND_DEFINITIONS` → `false`; no `scratchpad` verb
  exists anywhere in the command surface.
- `grep` across `impl/` for `run.scratchpad.append` / `run_scratchpad_append` / `scratchpad.append`
  finds nothing (re-verified this session).

The durable file `suite-notes-165.md` is the deliverable; the coordinator brief's explicit
fallback ("read the durable files where the shared post is absent — note which") covers this row:
the shared post is absent, and these durable notes (plus the suite file) are the source.

## 6. Judgment calls recorded (as the brief directs)

1. **A3-nearmiss pins the whole-brief near-miss scan.** The strict grammar refuses a near-miss
   heading (`#+ Deliverables` at any depth ≠ 2) "so a typo'd heading can never silently disable
   the coverage guarantee" (D2). The row drives a brief whose ONLY Deliverables-shaped heading is
   `### Deliverables` (depth 3, no `## Deliverables` section) and asserts `deliverables_malformed`
   — binding the implementation to scan for near-miss headings across the brief, not merely within
   an opened section. A loose "no section → no check" reading would silently vacate the coverage
   guarantee; the row forbids it. If an implementation narrows the scan to in-section lines only,
   this row stays red, which is the intended binding.
2. **A4/A4-object are separate rows to pin BOTH harvest entry forms.** D1b explicitly covers the
   string and the `{path, mustContain}` forms (`:308,311,314`); a single string-form row would
   leave the object form un-pinned. Both fail at HEAD at the same admission seam.
3. **A5's web leg pins a missing `workflow_*` dispatchFailure arm.** The web surface's
   `dispatchFailure` (web-northbound.mjs) has NO `workflow_*` branch — the fallback maps an unknown
   code to `503 temporarily_unavailable`. So even after the interpreter gains the D1b refusal, the
   web `waves_run` port would re-spell `workflow_harvest_invalid` as `temporarily_unavailable`
   until a `workflow_*` arm lands. The contract's G7 ("the `workflow_*` refusals already survive
   them") is verified for MCP (stateFailureCode allowlist, mcp-northbound.mjs:213) but NOT for web
   at this HEAD; the A5 web leg therefore pins the mapping as part of "typed code survives the
   `waves.run` surface — no transport-side re-spelling, no ghost, on all three transports."
4. **A6 is a driver-surface row, not a dual-surface row.** The contract's A6 note says the pin
   "also binds the D2b interpreter side"; this suite pins the driver half behaviorally (spawn +
   no-refusal) and leaves the interpreter half covered by A7's positive coverage assertion (a
   covered pair is not asserted on the spec side here — the spec-side normalization is the same
   one-pass predicate per D2, and A7's absence-of-parse failure is the red discriminator). If a
   later rung wants a spec-side normalization-green row, it can reuse the A6 fixture shape.
5. **`brief_unreadable` is recorded but not rowed.** The refusal vocabulary lists it (a D2
   precondition), but the acceptance section pins only A1-A7; the row inventory is the pin matrix.
   The static row S1 nonetheless pins all four driver tokens (including `brief_unreadable`) as
   literals, so the token cannot be dropped silently.

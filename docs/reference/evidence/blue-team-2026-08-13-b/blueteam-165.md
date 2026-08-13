# BLUETEAM-165 — blue-team attack on `impl/test/launch-validation-red.test.mjs`

`[attempt: 2344e0b7-8929-4768-bbcf-695ec5dcb0c6 row-bt165]`

- **Row:** `row-bt165` (blue-team foundry wave-b) · **Date:** 2026-08-13
- **Target:** `impl/test/launch-validation-red.test.mjs` (12 tests = 9 RED capability rows + 3 GREEN
  guard/pin rows)
- **Authority:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` (v2 folded) +
  `fold-165.md` + `redteam-165.md` (the four binding blockers) + `suite-notes-165.md` (the suite
  author's notes) + `blue-team-2026-08-13-b/foundry-brief.md` (the blue-team law)
- **Suite attempt marker (header, line 1):** `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-165]`
- **Verification HEAD:** `e371f70` (the suite's declared verification HEAD; the contract's fold HEAD)
- **Verdict:** **NEEDS-FOLD**

---

## 1. Split re-run (twice, at the suite's verification HEAD `e371f70`)

Run in a throwaway worktree at `e371f70` (`/tmp/bt165-run`, `impl/node_modules` symlinked from the
main tree; the suite file copied in as the only untracked file). Command per the foundry law:
`node --test impl/test/launch-validation-red.test.mjs` from the repo root.

| Run | tests | pass | fail | exit | green pins |
|---|---|---|---|---|---|
| 1 | 12 | 3 | 9 | 1 | A6, P2, E1 |
| 2 | 12 | 3 | 9 | 1 | A6, P2, E1 |

Both runs match the declared notes (**9 red / 3 green = 12**, exit 1). Stable — no instability
finding. Every RED row fails on its **designed stage assertion**, never on a fixture artifact: the
assertion messages carry `stage[d1a-directory-refused]` … `stage[static-launch-refusal-tokens]`
and the failure is the designed predicate (e.g. A1: `assert.equal(r.status, 2, …)` got `actual: 1`
— the launch reached `waves.start` and exited 1 with `authentication_required`; A4/A7: `error.code`
is `undefined` — the wave ran). The three GREEN rows hold (A6 `d2-normalization-non-refusal`,
P2 `d1b-containment-guard`, E1 `exit-code-map`).

## 2. The whole-suite wrong implementation (turns 12/12 green)

The cheapest coherent wrong implementation that turns the ENTIRE suite green is **the correct fold
with every detection predicate replaced by a string/regex shortcut**:

- **Driver `run-task-wave.mjs` — D1a:** refuse a `--targets` path whose **basename has no `.`**
  (a string heuristic; no `statSync`/`existsSync`), emitting the contract's message tokens
  (`target_directory_refused`, the path, `names a directory`, `FILES`). A directory like
  `docs/reports` is caught; a dotless file the wave would legitimately create (e.g. `docs/README`)
  is wrongly refused — but no row drives a dotless-file target.
- **Driver D2 grammar:** regex the brief for a `## Deliverables` section, extract `- <path>` bullets,
  refuse a bullet containing a space with `deliverables_malformed`, and scan the whole brief for a
  `^#{1,} Deliverables` heading at depth ≠ 2 → `deliverables_malformed`. Table rows, fence markers,
  `..`-escapes, and the wrong-word near-miss (`## Deliverable Files`) are not refused — and no row
  pins them.
- **Driver D2a coverage:** strip a leading `./` then raw string set-difference;
  `deliverables_uncovered` on a non-empty result. `//`-collapse and trailing-slash strip are absent
  (A6 drives only the `./`-prefix pair).
- **Driver vocabulary + exit map:** the four tokens as literals in the refusal messages; the exit-2 /
  start-refused-exit-1 / verdicts-exit-0 map preserved (E1's static scan passes).
- **Interpreter D1b/D3:** in `admitHarvestEntry`, **throw `workflow_harvest_invalid` for every
  entry** (or the same basename-dot heuristic on `entry.path`), with the message naming the path,
  `names a directory`, and `FILES`. The "absent path passes / file-shaped path passes" half is
  unpinned on the interpreter side.
- **Interpreter D2b:** at `renderObjective`, if the brief declares any `## Deliverables` deliverable,
  throw `workflow_harvest_invalid` naming the member role and the first deliverable (no set
  difference, no normalization, no covered-pair pass — no interpreter-side covered-pair GREEN row
  exists).
- **Web `web-northbound.mjs`:** add a `workflow_*` arm to `dispatchFailure` passing through
  `error.code` + `error.message` (verified absent at HEAD — A5's web leg is the one genuinely
  discriminating assertion, but it pins the transport arm, not the detection predicate).

Result: **12/12 green**. The suite cannot tell this from the correct fold — the file-not-directory
discrimination, the closed grammar, and the full one-pass normalization are all unpinned. This is
the aggregated consequence of the per-row SHALLOW verdicts in §3.

## 3. Per-row verdicts

Legend (per the foundry law): **SOUND** = the cheapest passing wrong impl is the contract behavior
itself · **SHALLOW** = a named cheap wrong impl passes · **BROKEN** = green/red for the wrong reason
(fixture inert or row self-contradictory) · **DECORATIVE** = pin bites nothing.

### Capability rows (RED at HEAD)

| Row | Verdict | Cheapest wrong implementation that turns it green |
|---|---|---|
| A1 `d1a-directory-refused` | **SHALLOW** | A basename-dot string heuristic in the driver (`refuse --targets <t> when basename(t) has no '.'`, no stat) refuses `docs/reports` with all four message tokens. No row drives a dotless-but-file target, so the working-tree shape check is never forced. |
| A2 `d2a-coverage-refused` | **SHALLOW** | `./`-strip + raw string set-difference passes A2 (uncovered `docs/a2-deliverable.md` refuses) **and** A6 (`./docs/a6-deliverable.md` == `docs/a6-deliverable.md`). No `//`-collapse and no trailing-slash strip are forced. |
| A3 `d2-grammar-prose` | **SHALLOW** | A whitespace-in-bullet refusal ("if the parsed bullet contains a space → `deliverables_malformed` naming the line") passes the prose line. Table rows, fence markers, `..`-escapes, and the bare-path positive-shape rule (basename `.` or `/`) are all unpinned — the closed grammar is greenable by a one-check parser. |
| A3-nearmiss `d2-grammar-nearmiss-heading` | **SHALLOW** | A depth-only near-miss scan (`refuse any `#+ Deliverables` heading whose depth ≠ 2`) passes `### Deliverables`. The wrong-word near-miss (`## Deliverable Files`) the contract also refuses is unpinned. |
| A4 `d1b-admission-directory` | **SHALLOW** | The cheapest wrong impl is an **unconditional `throw harvestInvalid` for every harvest entry** (or the basename-dot heuristic on the entry path) — both refuse `docs/reports` with the right code + message. There is NO interpreter-side GREEN row, so "a file-shaped / absent path passes admission" is unpinned; the D1b predicate is not discriminated. |
| A4-object `d1b-admission-directory-object` | **SHALLOW** | Same single wrong impl in `admitHarvestEntry` covers both entry forms (it operates on the string path regardless of form). D1b's "BOTH entry forms" is pinned only in that both are refused — not in the shape discrimination. |
| A5 `d3-transport-code-survival` | **SHALLOW** | The transport half is genuinely pinned: the web `dispatchFailure` `workflow_*` arm is absent at HEAD (verified — the fallback is `503 temporarily_unavailable`) and is required for the web leg, and the CLI/MCP legs force the refusal through the real interpreter. But the **detection predicate is unpinned**: an unconditional admission refusal (or the basename heuristic) passes all three legs. |
| A7 `d2b-objective-render-coverage` | **SHALLOW** | An unconditional "brief declares any `## Deliverables` deliverable → `workflow_harvest_invalid` naming role + first deliverable" passes. No interpreter-side covered-pair GREEN guard exists, so the D2b set-difference and normalization are never forced (the suite-notes judgment call 4 explicitly leaves the spec-side covered pair unasserted). |
| S1 `static-launch-refusal-tokens` | **SHALLOW** | A dead `const` array of the four token strings anywhere in the driver source satisfies `source.includes(token)`. Three of the four tokens are independently forced by A1/A2/A3's message regexes; `brief_unreadable` is S1's only unique pin and it is literal-existence-only — no behavior row forces the unreadable-brief refusal. |

### GREEN guard / pin rows — pin-bite

| Row | Verdict | What it bites / decorative? |
|---|---|---|
| A6 `d2-normalization-non-refusal` | **SOUND** (with a coverage gap) | Bites the D2-H2 raw string set-difference: `'./docs/a6-deliverable.md'` vs `'docs/a6-deliverable.md'` must NOT refuse, so the impl must normalize at least the `./`-prefix (and it also kills a driver-side blanket coverage-refusal). Gap: the fixture drives only the `./`-prefix pair — the `docs//x.md` and trailing-slash forms named in the test title are never exercised, so a `./`-strip-only normalization passes. |
| P2 `d1b-containment-guard` | **SOUND** (with a noted loophole) | Bites a fold that removes/weakens `assertHarvestContained`: with the containment check gone, `../outside.md` passes admission and the refusal code never appears → red. It does NOT independently pin the containment SHAPE — the unconditional-refusal wrong impl (any entry refuses) also passes P2, so the pin only proves *an* admission refusal exists, not *the containment* one. |
| E1 `exit-code-map` | **SOUND** | Bites the red-team C1 exit-code misread: a `process.exit(...)` placed after the last `receipts.verdict =` goes red (the `-FAILED`/`-DRAINED`/`-INCOMPLETE` verdicts must stay exit-0 receipt-carried), and removing the exit-2 / start-refused-exit-1 seams goes red. Static-scan limitation: a dead `process.exit(2)` in an unreached branch satisfies the first regex, but the load-bearing verdicts-exit-0 property is pinned. |

No pin is decorative, and no capability row is BROKEN (all fixtures are live — real `spawnSync`
subprocess for the driver rows, the real `baton.recipes.runWorkflow` embedded lane for the
interpreter rows — and every RED row fails on its designed stage predicate at HEAD, verified on both
re-runs).

**Empirical bite verification (mutations at `e371f70` in a second throwaway worktree, each pin run
alone with `node --test --test-name-pattern`):**

| Pin | Mutation (the designed wrong impl) | Result |
|---|---|---|
| A6 | Added a naive D2a to `run-task-wave.mjs` — raw string set-difference (no `./`-strip, no `//`-collapse, no trailing-slash strip) refusing `deliverables_uncovered` on a non-empty diff | **goes RED** (the `./docs/a6-deliverable.md` vs `docs/a6-deliverable.md` pair false-refuses; `assert.notEqual(r.status, 2)` fails) |
| P2 | Gutted `assertHarvestContained` to a no-op in `workflow-interpreter.mjs` | **goes RED** (`../outside.md` passes admission, no `workflow_harvest_invalid`, `error.code` is `undefined`) |
| E1 | Appended `process.exit(1)` after the last `receipts.verdict =` in `run-task-wave.mjs` | **goes RED** (the tail-slice `!tail.includes('process.exit')` assertion fails) |

Each pin therefore bites its designed wrong impl for real — the SOUND verdicts above are empirical,
not inferred. Each mutation was reverted (`git checkout --`) before the next; the worktree was
removed after.

## 4. Law re-check (the blue-team frame)

- **Named stages on every capability row:** PASS — all 9 RED rows carry `stage[…]` in their
  assertion messages (A1 `d1a-directory-refused` … S1 `static-launch-refusal-tokens`); the 3 GREEN
  rows carry theirs too.
- **Hermetic (mkdtemp + after-cleanup, no network/provider):** PASS — every fixture root is
  `mkdtempSync` under `tmpdir()` and removed in `t.after`; the driver rows run the real
  `run-task-wave.mjs` with an empty `XDG_CONFIG_HOME` so `waves.start` refuses deterministically
  (`authentication_required`, exit 1) when no launch refusal fires; no network, no provider, no host
  credentials.
- **No clocks as controls:** PASS — `FAR_FUTURE_MS` parsed once at module load; `now` injected into
  the northbound constructors; no wall-clock TTL.
- **Namespace imports for invented surfaces:** PASS — imports via `../src/index.mjs` namespaced
  bindings (`createDriver`, `McpFleetServer`, `WebNorthbound`, `bindBaton`).
- **Sorted-key literals ACTUAL order:** N/A — the suite introduces no sorted-key literals (the
  `PROFILE`/`GOAL_PLAN_POLICY` fixtures are plain frozen objects, not canonical-key literals).
- **watchdog.stallMs + comment:** PASS — `watchdog: { stallMs: 5 * 60_000, loopThreshold: 0,
  scopeAction: 'kill' }` with the #67 admission-law comment ("a stallMs far beyond any test window so
  a parked turn's freshly armed timer never fires and writes nothing") — the same idiom as the model
  suite `workflow-as-data-red.test.mjs:373-375`.
- **No absolute line-window anchors:** PASS — the static rows (S1, E1) are EXISTENCE/byte-string
  assertions only (`source.includes(token)`, regex matches); no line-window anchors.
- **Verbatim `[attempt: …]` in the suite header:** PASS — line 1,
  `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-165]`.

## 5. Shared-scratchpad publish (title `#165`) — exact refusal recorded

The row brief requires the report also be published to the `shared` scratchpad partition. Attempted
at HEAD `e371f70` in the throwaway worktree:

- `parseBatonCli(['run','scratchpad','append','--scope','shared','--kind','note','--title','165','--body',…])`
  → **REFUSED** `{"code":"cli_invalid","message":"unexpected argument append"}` (measured with the
  real parser).
- `'run.scratchpad.append' in APPLICATION_COMMAND_DEFINITIONS` → **false**; the `run.scratchpad.*`
  command family is absent from the application command surface (`Object.keys(defs).filter(k =>
  k.startsWith('run.scratchpad'))` → `[]`).
- `grep -rn "run.scratchpad.append\|run_scratchpad_append\|scratchpad.append" impl/` → no matches
  (the #158 append verb is unlanded at this HEAD).

The publish channel is therefore unreachable from this worktree — matching contract-165 OQ4, the
suite-notes §5, and the red-team's own recorded refusal. The durable file
`blue-team-2026-08-13-b/blueteam-165.md` is the runtime handoff (the coordinator brief's declared
fallback: "read the durable files where the shared post is absent — note which").

## 6. Execution contract

Per the row's execution contract (executable `"true"`, argv `[]`, cwd `.`, expected exit 0): no code
is changed — the deliverable is this report. Only files created in the worktree:
`docs/reference/evidence/blue-team-2026-08-13-b/blueteam-165.md` (this file). All empirical work ran
in the throwaway worktree `/tmp/bt165-run` (split re-runs, source-fact greps, publish probe).

## 7. Final verdict: **NEEDS-FOLD** — named rows

The suite is the acceptance machinery for the #165 fold, and 9 of 9 capability rows are greenable by
string/regex shortcuts of the correct fold — including the worst one: **the entire interpreter
acceptance (A4, A4-object, A5, A7, P2) passes under an unconditional-refusal admission/D2b wrong
impl**, because the interpreter surface has no GREEN row (no "absent path passes", no "file-shaped
path passes", no "covered deliverable pair passes"). A fold that refuses every harvest path or every
declared deliverable is indistinguishable from the correct fold on this suite. That is the
manufactured-confidence failure the blue-team law exists to catch.

**Concrete fold instruction set (all are green-at-HEAD rows in the A6 "RED-by-implementation" style,
so they bind the fold without breaking the RED pins):**

1. **Add interpreter-side GREEN discrimination rows** (the top fix):
   - a `harvest.paths: ['docs/new-file.md']` (absent at launch) spec must NOT refuse at admission —
     kills the unconditional D1b refusal and the basename heuristic's absent-dotless-path overreach;
   - a real file-shaped harvest path (e.g. `docs/reports/lv-x.md` created as a file, or a dotless
     file `docs/README`) must NOT refuse — forces a real `statSync().isDirectory()` and kills the
     basename-dot string heuristic;
   - a member objectiveRef brief declaring a deliverable that IS in `harvest.paths` must NOT refuse —
     kills the unconditional D2b refusal (the suite-notes judgment call 4 explicitly deferred this;
     the fold should close it).
2. **A6: drive the full normalization trio** — add the `docs//x.md` duplicate-slash and trailing-slash
   pairs to the A6 fixture so a `./`-strip-only implementation fails.
3. **A3: add a table-row and a `..`-escape grammar row** (e.g. `| x | y |` and `- ../escape.md`
   inside `## Deliverables` → `deliverables_malformed`) so the whitespace-only parser fails; **A3-
   nearmiss: add the wrong-word case** (`## Deliverable Files` → `deliverables_malformed`).
4. **A1/A4: add a dotless-but-file driver target row** (`docs/Makefile` exists as a file →
   `--targets` passes shape, the launch proceeds to `waves.start`) so the basename-dot heuristic
   fails on the driver side too.
5. **S1: add a `brief_unreadable` behavior row** (a `--brief` path that does not exist → exit 2 +
   `brief_unreadable` naming the path), so the token is pinned by behavior, not just as a literal.

[attempt: c8a3f4fc-fe15-4311-953e-5fc21b03ec44 row-cli]

# row-cli notes — honesty package ②: #157 CLI wave fidelity + the CLI-admission half of #158

## Scope

Owned seam: `impl/src/application-cli.mjs`, `impl/src/application.mjs`, plus the two
generated-surface consequences of my `CLI_WEB_COMMANDS` additions (`impl/CLI.md` regenerated via
`render-surface-docs.mjs`; `impl/scripts/surface-inventory-artifact.json` regenerated via
`surface-conformance.mjs --write-inventory` — both shipped generators, never hand-edited). I did
not touch the suites (craft law) or any other row's files.

## Implementation decisions

### D1 — CLI wave verbs `waves.send` / `waves.stop` (application-cli.mjs)

- Admitted both names into `CLI_WEB_COMMANDS` (lines 28, next to the other `waves.*` verbs) — the
  CLI/web shared admission set, so no surface advertises a verb the CLI does not serve.
- `waves.send` branch (line 1427): positional runId through the same `id()` helper `waves.attach`
  uses; `--message` required non-empty; delivery modes `--nudge|--now|--turn` bounded at-most-one
  (mirrors the `run send` take idiom at application-cli.mjs:1733-1738); `--claim-grant` parsed like
  `--members JSON` (JSON object or `cli_action_inputs_invalid`). Emits
  `{ kind: 'command', name: 'waves.send', args: { runId, message, delivery?, claimGrant? } }`.
- `waves.stop` branch (line 1460): positional runId; `--reason` CLI-required (OQ1 — the dispatcher
  requires it at application.mjs), refusing early `cli_action_inputs_invalid` rather than surfacing
  a server refusal. Emits `{ kind: 'command', name: 'waves.stop', args: { runId, reason } }`.
- Closed-set refusal text updated to `expected waves list, progress, start, send, stop, attach, or
  run` (line 1479).

### D3.3/N6 — `waves.compile` bare relaxation

The closed-set pin (A7-6) derives the minimal CLI invocation of `waves.compile` as BARE
(`['waves', 'compile']`) because its registry required set is empty. The parse now admits the bare
verb, returning `args: {}`; the app seam (`compileWaveSpec` → `_resolveWorkflowSpec`) is where a
missing spec refuses. `waves compile appendix.dsl` still carries `{ specPath }`.

### D2 — interpreter-wave registry hydration (application.mjs, ~11838-11865)

The `waveList` string-member branch previously pinned a hardcoded no-run render
(`phase/progressClass/attentionCount: null`). D2.3 hydrates the SAME read the object branch uses:
when the member IS steering-registered, `inspect()` the run and surface
`phase`/`progressClass`/`attentionCount`. The no-run render (runId `null`) stays pinned. The D5.2
seam: a member whose run WAS registered and then disappeared refuses the whole read typed
`wave_not_found` (parity with the object branch), never a silent null. NUL discipline verified —
application.mjs still holds exactly 3 NUL bytes, matching HEAD.

### #158 CLI half — `run.scratchpad.append` + D4 teaching

- `run.scratchpad.append` admitted into `CLI_WEB_COMMANDS` (line 31, beside read/elevate).
- `run scratchpad append RUN_ID --scope shared|worker:ID --kind note|plan|doubt|link --body TEXT`
  branch (line 1611): closed arg closure `{ runId, scope, kind, body }` (no caller-supplied
  workerId, H1.3); scope validated against the closed set exactly as the read branch; `--kind`
  defaults `note`; non-note bodies ride the closed per-kind shape via `scratchpadAppendBody`
  (line 128) — note=text, plan={objective,steps:[{text,state}] (1-16 steps)},
  doubt={question,context?}, link={label,target:{type:url|repo_path|entry}} — malformed JSON or
  shape refuses `cli_invalid` naming the expected shape.
- D4 teaching (line 1628): bare `run scratchpad` refuses with the closed set `read|elevate|append`
  (never `unexpected argument undefined`); an unknown subverb is named AND the set restated.

## Verification (all run in this worktree)

| Suite | Expected | Actual |
|---|---|---|
| `cli-wave-fidelity-red` | all green | **16/16** ✔ |
| `scratchpad-write-red` (CLI rows only) | A1-1, A1-2, A9-1, A9-2, A10-1 CLI legs | A1-1 ✔ A1-2 ✔ A9-1 ✔ A9-2 ✔ P-A1 ✔; A10-1 leg (a) ✔, leg (b) ✖ — broken test regex, see DECISION_REQUEST |
| `workflow-dsl-red` | 35/35 | 35/35 ✔ |
| `workflow-as-data-red` | 30/30 | 30/30 ✔ |
| `wave-observability-red` | 30/30 | 30/30 ✔ |
| `control-surface-truth-red` | 7/7 | **7/7** ✔ (was 5/7 stale-artifact until `--write-inventory`) |
| `workflow-dsl-package-red` | 12/12 | 12/12 ✔ |
| `mcp-profile-parity-red` | 8 pass / 13 red-by-design | 8/13 ✔ |
| `blind-waits-red` | 23/11 by design | 23/11 ✔ |
| `orchestrator-plan-object-red` | 5/42 by design | 5/42 ✔ |
| `doc-truth-conformance-red` + `error-actionability-red` | no collateral | 8 pass / 27 fail — byte-identical to HEAD baseline ✔ |
| deployment verification (executable `true`, args `[]`, cwd `.`) | exit 0 | exit 0 ✔ |

## DECISION_REQUEST — A10-1 leg (b): the suite's regex cannot match a correct admission

**The row.** `scratchpad-write-red.test.mjs` A10-1 asserts the append verb is coherently admitted
across parser + `CLI_WEB_COMMANDS` + web four-table + MCP + semantic registry. Leg (a) (CLI
parser) is green. Leg (b) checks the `CLI_WEB_COMMANDS` region of application-cli.mjs:

```js
// test line 953:
stageAssert(/run\\.scratchpad\\.append/u.test(cliWebRegion), 'append-admission-incoherent', …);
```

**The defect.** The regex literal `/run\\.scratchpad\\.append/u` contains TWO backslashes before
each dot. In a JS regex literal `\\.` means "a literal backslash, then any character" — so the
pattern requires the source text `run\.scratchpad\.append` (backslash-dot). A correct
`CLI_WEB_COMMANDS` entry is `'run.scratchpad.append',` (plain dots); no correct implementation of
this seam contains backslash-dots. The SAME admission set is checked by the P-A1 pin, which uses
the correct single-backslash form and passes:

```js
// test lines 983-984:
assert.ok(/run\.scratchpad\.read/u.test(setRegion), 'read is in CLI_WEB_COMMANDS');
assert.ok(/run\.scratchpad\.elevate/u.test(setRegion), 'elevate is in CLI_WEB_COMMANDS');
```

**Reproduced directly** (region = `const CLI_WEB_COMMANDS` … `]);` of application-cli.mjs):

- region contains the plain-dot entry `'run.scratchpad.append',` → **true**
- A10-1's double-backslash regex `/run\\.scratchpad\\.append/u` → **false**
- P-A1-style single-backslash `/run\.scratchpad\.append/u` → **true**
- P-A1 pins `/run\.scratchpad\.read/u`, `/run\.scratchpad\.elevate/u` → **true**

**Verdict.** The leg (b) assertion is a test transcription typo — it is unsatisfiable by any
correct implementation of the CLI admission seam. Per the craft law I did NOT edit the suite.

**Options.**
1. Correct the regex to the single-backslash form `/run\.scratchpad\.append/u`, matching the
   P-A1 pin's own style for read/elevate on the identical set. Leg (b) then goes green against the
   already-landed admission.
2. If the suite must stay frozen, treat leg (b) as unreachable-green and judge the admission by the
   plain-dot entry (already in the region) plus leg (a)'s live parser check.

Either way the implementation is correct: the verb IS in `CLI_WEB_COMMANDS`, the parser serves it,
and P-A1 (which guards the read/elevate half of the same table) is green.

## Split record (what stays red and why it is not mine)

The scratchpad-write rows still red after my change are the kernel row's seam, byte-identical to
the HEAD baseline: A2-1/A2-2/A2-3 (MCP tool advertisement + dispatch), A3-1/A3-2 (web bus),
A4-1/A4-2 (semantic-registry + docs), A5-1 (capabilities), A6-1 (openapi/web table), A7-1..A7-3
(kernel `writeScratchpad` + authorization), A8-1 (deployment seam), and A10-1 legs (c) web
four-table, (d) MCP, (e) semantic-registry. My seam contributes only the parser +
`CLI_WEB_COMMANDS` admission (legs a+b) and the A1/A9 teaching rows.

`run.scratchpad.append` intentionally does not yet appear in the `cli.host_primary` profile of the
surface-inventory artifact: the profile inventory derives from `APPLICATION_SEMANTIC_REGISTRY`
canonical operations, and the registry row is the kernel row's work (mine is the CLI admission,
which is what the artifact's `cliWebCommands` count reflects: 37 → 40).

## Cross-seam coordination intelligence (for row-sf159 / row-sf160 / the coordinator)

During the continue-verification pass I mapped the CLI-seam gaps the OTHER two suites' rows pin,
because every one of them touches `application-cli.mjs` (my owned file) — but none is in my
dispatch acceptance (which is cli-wave-fidelity + the scratchpad CLI rows only; the fold-suite-159
and fold-suite-160 headers name `row-sf159` / `row-sf160` as those rows' owners). Recorded here so
those rows inherit the terrain map.

- **`run.watch` (doc-truth R1/R4 — row-sf159).** `parseBatonCli(['run','watch','run:r1'])` today
  throws `cli_invalid: unexpected argument run:r1` and BARE `run watch` silently reinterprets to
  `run.start` objective `'watch'` (the R4 headline). The fix is additive: recognize `watch` as a
  run first-token and serve `run watch RUN_ID` → `run.watch`, with bare `run watch` refusing the
  value-required (Run ID) shape — `cli_invalid` + `/run id|runId|required/i`.
  ⚠️ **Cross-wave constraint:** adding `watch` as a recognized first-token inflates the
  cli-silent-start suite's (#155) DERIVED detection set from 39 → 40, which breaks that suite's
  currently-GREEN PT-7 pin (`assert.equal(detection.size, 39)`, cli-silent-start-red.test.mjs:439)
  — the 39 is "at HEAD", so #155's impl may re-pin it, but row-sf159 must coordinate rather than
  silently break the pin.
- **Unknown-`run`-verb refusal (error-actionability C2 — row-sf160).** `parseBatonCli(['run',
  'shwo'])` today returns `run.start` objective `'shwo'` (the F8 silent-reinterpretation defect at
  `application-cli.mjs:1578`). C2 wants `cli_command_unavailable` + a message naming the closed run
  verb set. ⚠️ **Cross-wave constraint:** a naive "refuse ALL unknown run verbs" breaks the
  cli-silent-start (#155) currently-GREEN PT-3 pin (`run deploy`/`refactor`/`stow` must stay
  objective-first — never-a-guess). The only rule satisfying both is Damerau-distance-1 detection
  against the recognized first-token set (exactly #155's core), so C2 and #155's PT-2a share one
  implementation surface — row-sf160 should implement F8 on top of #155's guard, or land both.
- **Divergence ledger (doc-truth R7 + error-actionability C3/S2).** The committed
  `surface-divergence-ledger.json` is `{schemaVersion:1, entries:[]}`; R7 needs full-shape entries
  for the whitelisted-but-web-refused facade ports and C3/S2 need the 20 CLI-local tooling codes
  ledgered deliberately code-only. The ledger is `impl/scripts/` — outside my owned files.

None of the above changes my acceptance: my seam rows are all green (modulo the A10-1 leg (b)
broken regex above), and the adjacents in my verify list are undisturbed.

## Generated-surface regeneration

- `impl/CLI.md`: `render-surface-docs.mjs` added the `waves.send` / `waves.stop` rows to the
  generated cli-verb-inventory block (+2 lines, nothing else changed).
- `impl/scripts/surface-inventory-artifact.json`: `surface-conformance.mjs --write-inventory`
  bumped `counts.cliWebCommands` 37 → 40 and added `waves.send` / `waves.stop` to the
  `cli.host_primary` profile (+4/-2 lines, nothing else changed). This regeneration is what keeps
  `control-surface-truth-red` at 7/7.

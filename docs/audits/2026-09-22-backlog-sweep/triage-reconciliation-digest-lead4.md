# Backlog sweep reconciliation — the 77 issues assigned to digest-lead4 (2026-09-22)

`docs/audits/2026-09-22-backlog-sweep/triage.md` triaged the 76 issues the root dispatched to
`swarm-digest-20260921`. The root reassigned 77 issues to `digest-lead4` on 2026-09-22 20:20 UTC.
That set is those 76 plus #211, which the sweep does not mention. This file records what has
changed since the sweep and what each assigned issue's state is now.

Method, the sweep's own: `impl/scripts/expected-red-tests.json` (354 pinned rows in `rows`, 176
file declarations in `converged`), `git log master --pretty='%h%x09%s'`, and per-file test runs
from `impl/` with `impl/node_modules` present at master `65c913f0`.

## What changed since the sweep

Three of the sweep's eleven pinned-row issues have left the manifest, with the landing that did it:

| Issue | Sweep state | Now | Evidence |
|---|---|---|---|
| #66 | open-red, 30 rows | landed | `1e050e42` removes the 30 `doubt-review-red` rows; the file is 35/35 at its commit |
| #77 | open-red, 30 rows | landed | `3ffb6aab` removes the 30 `suite-resource-governance-red` rows; the file is declared converged |
| #99 | open-red, 34 rows | rows landed, source tail pending | `77dd18b0` removed the 34 `harvest-accessor-red` rows; the tail that carries `impl/src/harvest-accessor.mjs`, `impl/src/mcp-northbound.mjs` and the two composition-cut test rows is unlanded |
| #510 | not in the sweep's pinned set | landed | `e1a83a9e` (2026-09-19) derives a per-target floor in `impl/scripts/seam-inventory.mjs` and pins it in `impl/test/seam-inventory-target-floor.test.mjs`; the commit is an ancestor of master. The issue's second half, regenerate-then-edit staleness, has no commit naming it. |
| #24 | open-red, 1 row | open-red, 1 row | `06971d79` landed the path-anchored source reads behind the pin; the row stays pinned |

The sweep's premise that "the full-suite verdict is green as of this date, and a green verdict means
every pinned row still fails" no longer holds. The tree fails rows whose files the manifest declares
converged, so the unexpected-failure set is non-empty and every landing gate reads it. Measured at
master `65c913f0`, `cwd=impl`, dependencies present:

| File | Manifest | Rows | Failing row |
|---|---|---|---|
| `test/canonical-naming-233-red.test.mjs` | converged (#233) | 3 pass / 1 fail | `CLOSED SET: MCP application dispatch names equal exactly the ONE derivation` |
| `test/wave-observability-red.test.mjs` | converged (#460) | 29 pass / 1 fail | `A3-2 §4: baton_waves_list lands in the pinned MCP enumeration` |
| `test/frame-economics-red.test.mjs` | converged (#89) | 49 pass / 1 fail | `F1: no module re-declares a cataloged byte literal or hand-types byte prose outside limits.mjs` (stage `single-source-not-landed`) |

The two composition-cut files are 31 pass / 3 fail at the served base `1e050e42`, where
`CLOSED SET: web-admitted command names` fails as well. #355 records the consequence for a landing:
on a host whose pinned base suite is red, the verdict row reads the `baseline_or_environment` phase,
so a lane reports the failure as pre-existing at base.

## Pinned-row census now

Eight of the 77 issues hold pinned rows, 81 rows in total:

| Issue | Rows | File | Cluster as the predecessor left it |
|---|---|---|---|
| #6 | 4 | `test/phase67-change-aware-inspect.test.mjs` | cluster 4 |
| #24 | 1 | `test/kg-activation-red.test.mjs` | cluster 6 |
| #59 | 23 | `test/redrive-continuity-red.test.mjs` | the digest swarm's own landing (rebased as `99b17ea5`, unlanded) |
| #61 | 12 | `test/worker-verdict-surface-red.test.mjs` | cluster 1 |
| #69 | 22 | `test/repl-realization-red.test.mjs` | the digest swarm's own landing (rebased as `d37f0416`, unlanded) |
| #73 | 8 | `test/feedback-forge-hardening-red.test.mjs` | cluster 2, adjacent to #538/#535/#532's gate referent |
| #165 | 9 | `test/launch-validation-red.test.mjs` | cluster 3 |
| #268 | 2 | `test/issue268-visibility-red.test.mjs` | cluster 5; the `docs/39` remainder landed in `0a7a6e11` |

No lane is staffed for any of the six external clusters as of this writing. The remaining 69
assigned issues carry no pinned row; the sweep's state for each of them stands unchanged, with #510
moving from its pinned set to landed as the table above records.

The `Rows` column counts pinned rows whose manifest `reason` names that issue. A file can also pin
rows for other issues: `worker-verdict-surface-red` pins 13 keys in total of which one is `#79`'s
`C5`, and `issue268-visibility-red` pins 3 of which one is `#364`'s.

## Lane briefs for the six clusters

Measured at master `65c913f0` from `cwd=impl`. Each row name carries the stage it waits on, and the
stage names the missing behavior, so the row set is the lane's specification. For
`worker-verdict-surface-red` and `feedback-forge-hardening-red` the failing set was compared against
the pinned keys row by row and no failing row is unpinned; in the other four the failing count
equals or is below the file's pinned-key count. None of the six files is declared converged in the
manifest, so this red is expected-red and carries none of the suite's unexpected set.

### #61 — `test/worker-verdict-surface-red.test.mjs`, 17 pass / 13 fail

- `C5` (stage `push-verdict-missing`): the `#79` `gate_verdict` push carries check/corrective.
- `D1`-`D12` (stages `live-composition-missing`, `worktree-harvest-policy-missing`,
  `underrived-refusal-missing`, `unenforced-refusal-missing`, `epoch-missing`): the objective block
  is composed from live policy. `applicationProfile` declares a `worktreeHarvestPolicy`; a
  boundary-commit deployment never ships the no-commit line, an orchestrator-harvest deployment
  ships it under its named source; an underrived requested line refuses
  `objective_constraint_underrived`; a line naming an unenforced bound refuses
  `objective_constraint_unenforced`; `wire_frame` ships only when the size census shows a file over
  ~1500 lines; the block is a pure function of live policy frozen at admission, with a suppression
  epoch derived from the profile digest and the admission SHA; the served block drives the real
  recipe objective render seam and the static list is retired.

### #165 — `test/launch-validation-red.test.mjs`, 3 pass / 9 fail

- `A1`, `A4`, `A4-object` (stages `d1a-directory-refused`, `d1b-admission-directory`,
  `d1b-admission-directory-object`): a directory `--targets`, and a directory-valued
  `harvest.paths` entry in both its string and `{path, mustContain}` forms, refuse before the wave
  starts and at admission.
- `A2` (stage `d2a-coverage-refused`): a brief deliverable absent from `--targets` refuses exit 2
  and names the uncovered set.
- `A3`, `A3-nearmiss` (stages `d2-grammar-prose`, `d2-grammar-nearmiss-heading`): prose inside
  `## Deliverables`, and a `### Deliverables` heading with no `## Deliverables` section, refuse
  `deliverables_malformed` naming the line.
- `A5` (stage `d3-transport-code-survival`): the directory-harvest refusal code reaches CLI, MCP and
  web without a transport-side re-spelling.
- `A7` (stage `d2b-objective-render-coverage`): the coverage check also fires at the objective
  render.
- `S1` (stage `static-launch-refusal-tokens`): the four driver launch-refusal tokens exist in the
  driver source.

### #73 — `test/feedback-forge-hardening-red.test.mjs`, 5 pass / 11 fail

Its 12 pinned keys are 8 `#73` rows, 3 `credential` rows (`P2`, `P6`, `P8`) and one `#538` row
(`P3`, which passes).

- `R1`-`R8` (stages `expect_typed_refusal`, `expect_derived_record`,
  `expect_coaching_derived_false`, `select_candidate_no_crash`, `literal_12_field_closed`,
  `expect_pre_hardening_record_excluded`, `expect_second_run_refused`,
  `expect_gate_unbound_typed`): a forged verdict with no gate referent refuses typed `gate_unbound`;
  a verdict with a real referent is `derived:true` and seq-bound; coaching feedback records
  `derived:false` and `gateEventSeq:null`; a verdict packet in the revision set does not crash
  select/revise; one 12-field closed projection carries the derived flag; a persisted pre-hardening
  gate-shaped record is excluded per-record while later records project; the referent boundary is
  candidate-scoped; `gate_unbound` is typed in `application.mjs` and preserved verbatim through the
  web and MCP facades.

### #6 — `test/phase67-change-aware-inspect.test.mjs`, 4 pass / 4 fail

All four are unpinned-name rows about the change-aware inspect wait: deriving its bounded wait from
deployment policy when the continuation omits machinery, waiting once on a durable notification and
returning a changed bounded outline, waiting through another run's notification until this run
durably changes, and marking timeout with its terminal state.

### #268 — `test/issue268-visibility-red.test.mjs`, 2 pass / 3 fail

- `#268` stages: the root is a participant row and its acts render attributed; attention carries its
  coverage, naming the seats examined.
- `#364` stage `SWARM_PARTICIPANT_RUNTIME_STATES not exported`: the closed runtime state set is
  exported and every surface reads the one derivation.

### #24 — `test/kg-activation-red.test.mjs`, 5 pass / 1 fail

`KG-A5`: the admit gate's lease binding and refusal taxonomy are unchanged and no auto-admit call
site exists. The row scans every `impl/src/*.mjs` for the bare token `admitWorkflowFinding` and
finds `runtime-admission.mjs` (where the gate's body moved under #259) and `runtime-observation.mjs`
(whose `promoteWorkflowFinding` resolves the coordinator wrapper indirectly). Deciding whether the
whole-source token scan or the delegation is the defect is the lane's first question; the
predecessor recorded the same boundary.

## Staffing

The six clusters are unstaffed. Recruiting a seat needs swarm authority this seat no longer holds;
`recovery-digest-lead4.md` at the deployment root records the re-admission step. Two clusters are
the digest swarm's own and already have verified commits: #69 (`d37f0416`) and #59 (`99b17ea5`),
landing in that order.

## The twelve issues the sweep could not read

The sweep found no commit, test, doc, script or review naming these. The root's assignment carries a
tracker-derived title for each, so each is now triageable to the gist level:

| Issue | Title | What the title points at |
|---|---|---|
| #113 | Policy values must single-source: the two-layer ceiling trap | a class default masked by a construction-site literal; the same class F1's `single-source-not-landed` stage names |
| #198 | dsh-adoption ⑤: dispatch-mode declarations + coordinator-granted capability scoping | a design cluster with #194, #190, #192, #187 |
| #212 | Orchestrator-controlled shared and individual task lists with upward decision-posits | a design cluster with #211 and #205 |
| #213 | Context/memory objects as first-class passable bodies with tiered promotion | the REPL/context-program lane; overlaps #19 |
| #219 | [ideation, LOW] remote control over tailscale | duplicate of #29 in scope |
| #251 | Fire-report ambiguity: `cli_transport_failed` on fires that admitted server-side | the fleet-drive read path |
| #322 | Host and per-process memory usage under heavy concurrent load | live on this host: the suite runner prints `memory: 4668194816 bytes observed, 15461882262 required` and proceeds without a verify lease, because `deriveHostCapacity` derives `suiteBytes` from `totalBytes` |
| #401 | Question and approval stale answers settle as `ok: applied` while decisions get `stale_discarded` | one disposition shape across both paths |
| #415 | Pinned rows in fifteen plain-named test files outside the `-red` suffix | measured now: **16** plain-named files hold pinned rows (`phase72-kimi-orchestrator-mcp` 12, `phase78-concise-deployment-factory` 6, `phase67-change-aware-inspect` 4, `phase11-persistent-sessions` 2, `phase12-web-northbound` 2, `phase67-self-describing-continuation` 2, and ten files with one each) |
| #416 | Row names without a stage force readers into file comments | measured now: **225 of 354** pinned rows name no `stage:` marker; 23 rows carry a `prerequisite` field instead |
| #421 | Consistency polish: bounded-text helpers, the read-only skip verdict's `durationMs`, `settlementLease` reaching `_clock` | a bounded code-polish list |
| #501 | Frame-economics (F1) coverage gaps: picked-literal shapes evade detection | adjacent to F1's current red: F1 fails on cataloged lane literals outside `limits.mjs` while its detector misses literal shapes the issue names |

## The digest swarm's own unlanded work

- #69: commit `d37f0416` on `baton/ws-366c15b3b8aeefce676a85f4bef631bc-r2`, parent `65c913f0`.
  Verified at the commit from `cwd=impl`: `repl-realization-red` 34/34, `runtime-observation` 5/5,
  `seam-inventory` 7/7, `coordination-ledger-writes` 6/6; the manifest delta removes exactly its own
  22 `#69` rows.
- #59: commit `99b17ea5` on `baton/digest-lead4-69-59`, parent `d37f0416`. Verified
  `redrive-continuity-red` 28/28; the manifest delta removes exactly the 23 `#59` rows. It lands
  after #69.

`recovery-digest-lead4.md` at the deployment root records the seat-level state of this swarm.

## What this file does not decide

- Closing an issue: `gh` is unauthenticated in this deployment, so a close needs the root or an
  authenticated operator. A `landed` row can be offered as evidence.
- Completeness of a `landed` row: a commit subject states what one landing did; whether it satisfies
  the whole issue needs the issue text beside it.
- Whether the twelve titles above match their issues' current text: they came from the root's
  assignment comment, not from a read of the tracker.

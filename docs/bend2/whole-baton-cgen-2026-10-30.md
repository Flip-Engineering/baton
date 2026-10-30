# Whole coordinator C generation: measured costs and repairs

This note records where C generation of `bend2/src/coordinator/main.bend` spends
time and memory, which source shapes cause the cost, the compiler changes made
for them, and the costs that remain. It covers the work tracked in the #1089
whole-program comment of 2026-10-29. Measurements name their queue request,
compiler source and evidence directory. Focused fixture results and
whole-program results are reported separately.

## Stages of one release build

Release cgen `4f61f361` (compiler `4d8a487d5`, 2026-10-29, evidence
`/var/tmp/baton2-compile-queue/keys/4f61f361*/runs/*/work/.bend-cgen-drWs7D`)
completed in 4504 s of queue time:

| Stage | Time | Memory |
|---|---:|---:|
| Queue heavy-lock wait before the compiler started | 750 s | |
| Front end (parse, check, elaborate, seal the checked store) | 1411 s | 61.5 GB peak RSS |
| Unit emission, first to last unit start | 2229 s | |
| Link and C output | about 100 s | |

The queue records `started_ns` in `supervise_owned` before `acquire_heavy_loop`,
so a request's queue time includes its wait for the heavy lock. Compiler time
starts at the front end's `process-start.json`.

Emission ran 11,360 unit results for 4071 units: 2.8 emissions per unit. Summed
unit time was 3002 s, of which facts-only units took 1565 s. Average concurrency
over the emission span was about 1.35. The admission log shows bursts at 64
concurrent units, then about 7 for minutes per level while the largest units
finished; 3556 admissions waited for memory, with forecasts up to 26.8 GB.

## Body size

Unit time followed the rows of the bodies a unit decoded (Pearson r = 0.993 over
all 11,360 results). The checked store held 126.5M rows in 5271 bodies. The top
10 bodies held 75% of the rows and the top 100 held 97.5%:

| Body | Rows |
|---|---:|
| `agent-native.run` | 24,839,357 |
| `normal_cli_codex` | 15,034,612 |
| `agent-actions.help` | 15,019,059 |
| `commands.parse_basic_eight` | 9,891,097 |
| `agent-command.confirmation_target` | 8,460,178 |
| `stop-hook.route_event` | 5,439,234 |
| `repl.configured_notebook` | 5,117,649 |

These are short functions. `agent-native.run` is 12 source lines. The rows come
from string literal patterns. `parse_patt` expands a string literal through
`lit_full` into its character constructors, and `match_flatten` splits that
column character by character, copying the remaining rows at every failed
character.

Storage sharing (#1301, #1312) compresses the stored graph but not the
elaborated terms. The 970 lane's front-only runs of the same source show
108.6M rows before sharing in each variant:

| Compiler | Front end | Peak RSS | Rows before sharing | Rows stored |
|---|---:|---:|---:|---:|
| `3eda0f4f2` (#1301) | 1328.7 s | 79.1 GB | 108,610,736 | 74,544,932 |
| `cef3dab69` (#1312) | 1123.0 s | 50.7 GB | 108,610,736 | 15,880,498 |

In the `cef3dab69` rows, the remaining expansion falls into three classes:

| Class | Shape | Rows before sharing | Repair |
|---|---|---:|---|
| A | top-level match on an affine (unannotated) String parameter | about 45M | #1348 |
| B | string literal inside a `List` pattern, with other parameters | about 35M | #1354 |
| C | `+` String parameter at a later position | about 16M | #1311 |

## Class A: affine String parameters (#1348)

`literal_chain_string` lowered a string match to one `String.eq` test per row,
but only for a `+` parameter. #1348 binds the matched affine parameter reusable
in its lambda; check-lam accepts a `+` lambda at an affine binder of a Data
type. `literal_rows_affine` keeps the uses that the character tree allowed: when
the final binder's row could use the value more than once, or a row matches it
again, the definition keeps the character tree.

Focused evidence (`focused-93c88ade7`, queue key `a2dcb313`, target main
`7c173d520` with the sources of archive `95a6ad2b`):

| Fixture | Target | Candidate |
|---|---:|---:|
| `agent-actions.help` shape, lowered nodes | 242,635 | 1,262 |
| `normal_cli_codex` shape, lowered nodes | 123,620 | 531 |
| Fixture C emission | 247.9 s, 22.8 GB | 4.1 s, 182 MB |
| Fixture interpreter run | 103.0 s, 9.8 GB | 1.5 s, 147 MB |

Interpreter and C output are equal on both sides and between the sides. A
plain final binder used twice is refused by both with the same error.

## Class B: literals inside List patterns (#1354)

#1354 makes a column of string literal and binder patterns a binder column with
deferred guards. The binder is bound reusable, each literal row carries a
`String.eq` guard, every other column is still split at its binder's position,
and `literal_leaf` tests the guards in row order once all columns are decided.
Keeping the other splits in place keeps the termination checker's reading of
decreasing self-calls. An earlier version (`1565b0b98`) bound all remaining
binders first; its focused run (`4acfd2c2`) failed on a recursive option parser
with "expected a decreasing self-call".

A differential fixture (`diff-7ba2cf9ae`, queue key `597cee2e`) found two
defects in #1354, repaired in `fe5e0c5b9`:

- A guarded binder row could reach the default branch after every constructor
  of a datatype was split, where `literal_leaf` built a selection ending in a
  match with no cases at the result type. That default is now a match with no
  cases at the match position (`Match.done` records the split constructors).
- `literal_rows_affine` ignored `+` binder rows, which make a column reusable in
  the character tree (`patt_mark`). `repl.execute_canonical`, `repl.options` and
  `branching.execute` kept the character tree for this reason.

## Front end

The coordinator source at `93c88ade7`, front end only (`prep_front.ts`, compiler
diagnostics on), same Bun:

| Compiler | Exit | Wall | Peak RSS | Rows before sharing | Rows stored |
|---|---:|---:|---:|---:|---:|
| facts-only (`95a6ad2b` sources) | 0 | 1418.8 s | 56.1 GB | 93,576,937 | 14,838,362 |
| class A (`93c88ade7`) | 1 | 121.8 s | 3.2 GB | | |
| A+B (`7ba2cf9ae`) | 0 | 394.6 s | 10.8 GB | 16,418,190 | 5,152,618 |

With facts-only, checking took 255.0 s (282 laws 114.5 s), the CLI verdict
`book.report` 116 s (`source_refs` walks every checked body), `carb` 266 s and
store sealing 628.9 s. With A+B, laws took 109.0 s and other checks 35.5 s.
The class A failure is the stack edge described in the next section.

## Checker stack depth

`term_compare` recursed once per constructor field. On main `5c0ccfa44`, the law
`control.detached_dispatch_commits_authorized_input_before_launch` needs 15,568
nested comparisons. At a 64 MiB stack the traced reproducer (`300d6084`) overflowed
at 12,550 to 12,555 with class A and A+B and at 15,133 to 15,138 with facts-only;
one class A run (`74d9c8a7`) passed. 12,487 of the 12,554 frames at the overflow
compared the share cells `term_wnf` puts in constructor fields. The same edge
explains the class A front-end failure, the #1352 stop-hook cgen failure
(`023afe1d`) and the A+B pass.

`2778a1ce5` (#1360) compares the last child of each node in a loop. In `verify-2778a1ce5`
(`8ff33c14`) that law peaks at depth 14 and checks in 12.8 s; the stop-hook entry
checks all 5027 definitions; the codec laws peak at 7. `term_compare_long_chain`
(a law over 200,000-cell lists) passes with the loop and fails on `5c0ccfa44` with
the production stack trace.

## Fact rounds

The fact solver plans levels from the source graph, callee first, and units are
required as emitted code references them, starting from `main`. In `facts.ts`
`analyze`, a unit discovered at or below the current level joins the current
cohort. `main` is at level 109 of 109, so in `4f61f361` round 1's level-109
step emitted 2951 units whose planned levels span 84 levels from 1 to 108, all
against one snapshot. `hot:IO.bind~0` and `hot:IO.pure~0` are written by
`IO.bind` and `IO.pure` themselves (planned level 7) during that step, after
2605 and 2875 reads of them had answered absent. Round 2, the first pass in
level order, re-emitted 3937 units.

The lend barrier after round 5 added 148 `own` facts, among them `own:IO.die~2`:
`IO.die`'s slot 2 is borrowable by its mask and no unit lends it. Round 6
re-emitted 1417 units. Over all rounds, 4071 units produced 11,360 unit results.

The source graph reaches 5685 definitions from `main`. All 4071 emitted units
are in that set; 1614 reachable definitions were never emitted. Requiring the
reachable set at its planned levels before round 1 would order the first round
callee first, at the cost of up to 1614 extra units. Not measured.

## Unit cache

The emitted-unit cache applies a variant only when every fact read has the
answer it had when the variant was written. In `4f61f361` it recorded 11,360
misses, 56 hits and 8626 rejected variants of the same compiler scope, all for a
fact read: `own:IO.die~2` 1072, `hot:IO.bind~0` 741, `hot:IO.pure~0` 321, then
facts of `text.rev_go`, `text.split_at_tab` and others. A fact about a function
that most units call decides the read answers of most units, and the step at
which such a fact is written moves between builds.

## Emission workers

Each worker decodes the whole checked-store header before its first unit. In
`4f61f361` the header was 1,773,647 rows (81.5 MB of JSON). The 123 workers
started in that run took a median 5.6 s to become ready and held a median
0.95 GB when ready. Admission allows up to 64 concurrent workers. A unit reads
only the header entries listed in its `HeaderReads`.

## The 5 h 46 min failure

The reported build spent about 5 h 46 min generating C and then failed in
`Driver.cleanup`, where `fs.cpSync` was refused under `RestrictSUIDSGID`.
99f339dc7 replaced it with an explicit copy. `cli_emit_native` still runs
`Driver.cleanup` before it copies `output.c` to the requested path.

## Whole-program measurements

Request `da07e431` (2026-10-30) generated C for `bend2/src/coordinator/main.bend`
from a read-only snapshot of `cd5041e04:bend2` (924 files, manifest `98a33795`)
with the maintained compiler package of #1360 (archive `33cb7efe`, `bend.ts`
`603c0cb9`, Bun `10702245`). It ran with a new empty `XDG_CACHE_HOME`,
`BUN_JSC_maxPerThreadStackUsage=67108864` and compiler diagnostics on, on the
64-CPU homelab host. The queue admitted it 4 min 54 s after submission. The
compiler exited 0 after 582.3 s and wrote 107,838,998 bytes of C (`c971c16f`).
Evidence on the homelab host, under the runner home
`/mnt/nvme4tb/ci-runners/baton2-native-homelab/home`:
`retained/whole-baton-cgen-opus-20261029/cgen-pkg1360-cd5041e04/`.

| Stage | Seconds | Units | Memory |
|---|---:|---:|---:|
| Check, 6,686 definitions | 1.5-105.8 | | 5.3 GiB |
| Report and carb | 105.8-148.4 | | 7.7 GiB |
| Store and dependencies | 148.5-255.0 | | 12.45 GiB |
| Pass 1 | 257.2-350.9 | 5301 | |
| Pass 2 | 351.5-424.1 | 3958 | |
| Pass 3 | 424.8-450.8 | 780 | |
| Passes 4 and 5 | 451.6-466.4 | 47, 3 | |
| Pass 6 | 467.1-511.7 | 1439 | 22.52 GiB summed |
| Passes 7 and 8 | 512.3-526.2 | 29, 10 | |
| Link, tables and C output | 526.2-582.3 | | |

The front-end rows give the RSS of the front process. The pass rows give the
summed RSS of the compiler's process tree from samples every 2 s; it peaked at
488 s across 66 processes, none above 1.07 GiB. Summed Pss peaked at 18.81 GiB
and the queue recorded `peak_kb=21548340`. The run used 2146 s of user and 579 s
of system CPU.

The stored program had 5,329 bodies, 8,600,396 rows before sharing, 4,355,275
nodes and 184 MB. Four bodies whose literal rows contain a nested match
(`commands.parse_verb_session_id`, `commands.parse_verb_id`,
`commands.index_options`, `agent-actions.send_options`) held 35.7% of the rows,
42% of the nodes, 48% of the bytes and 30.0 s of the 61.3 s of section encoding.

Round 5 of the fact solver added 140 `own` facts after the passes had converged
to 3 units, and pass 6 re-emitted 1439 units. Each pass ends with a barrier that
assembles all 3,011 live units (`link.canonical`); in the passes of 3 to 47
units the barrier took about 5.6 s of the 6 to 8 s. The unit cache had 55 hits,
all in pass 2, and held 642 MB in 23,144 files after the run.

The check stage spent 77.4 s of its 103.8 s in the 152 laws of `context/codec`,
which normalize the codec on literal frames; `control`'s
`detached_dispatch_commits_authorized_input_before_launch` took 11.9 s. After
the passes, the fact history replay took about 14 s, `compile_tables` 23.1 s
(36,990 FID names) and the C templates 15.8 s.

In pass 1, `main` sits at level 116, and the code units its emission reaches
join that level's cohort in waves: 3,011 units, 157.8 s of unit time and 40.5 s
of wall time, with 11.6 s in which no unit started. Admission allowed 11,567
unit starts on 64 workers and refused 4,745, all but one at the limit of 64
active units. At level 116 a worker wrote a unit's fragment 6 ms after the unit
ended (median 3 ms), and the coordinator wrote that unit's cache entry 0.543 s
later on average (median 0.607 s): a unit's slot is held while its result waits
for the coordinator. In `admission.jsonl` one unit took about 13 ms of
coordinator time: 4 ms for the evaluation that admits the next unit, 3.7 ms for
an evaluation that refuses at the limit, and 4.6 ms until the next completion.

## Changes in #1386 and the paired measurement

#1386 (`304d453fd`, merged as `d1bbe3d2a`) changes five things:

- `literal_lift` turns a row whose body is a match on one variable, ending with a
  binder row, into rows of the outer match, so the `String.eq` guards of #1354
  apply. In the coordinator this affects exactly the four bodies above.
- The two single-parameter `List<String>` lowerings return null for a row whose
  body matches a row binder; before, such a definition stopped the load.
- `compile_tables` finds a repeated name with a set.
- `fragments.ts` `equal` compares lengths and SHA-256 digests.
- `admit()` refuses at the processor limit without reading memory.

#1389 selects its package: archive `9ce9b66b`, release
`2.0.25-compiler-cgen-costs-1386-20261030`, with the launcher and Bun of #1360.

Request `db3ad202` generated C for the same snapshot with `304d453fd`, the same
Bun, a new cache and diagnostics on (2026-10-30). It exited 0 after 440.1 s and
wrote 106,962,836 bytes of C (`1e2b8635`). Evidence:
`retained/whole-baton-cgen-opus-20261029/cgen-304d453fd-cd5041e04/` under the same home.

| | `da07e431` (#1360) | `db3ad202` (#1386) |
|---|---:|---:|
| Wall | 582.3 s | 440.1 s |
| Front end ends | 255.0 s | 208.2 s |
| Check stage | 104.3 s | 124.7 s |
| Store and dependencies (carb end to prepare end) | 106.6 s | 44.3 s |
| Largest process | 12.45 GiB | 5.18 GiB |
| Stored nodes, bytes | 4,355,275, 184 MB | 2,546,597, 97 MB |
| Passes | 269.0 s | 197.4 s |
| Level-116 cohort of pass 1 | 40.5 s | 28.6 s |
| Barrier per pass | 4.6-5.7 s | 1.3-1.7 s |
| `compile_tables` | 23.1 s | 0.2 s |
| Final link and C | 56.1 s | 33.0 s |
| Summed RSS, queue peak | 22.52 GiB, 20.55 GiB | 15.61 GiB, 13.85 GiB |
| User and system CPU | 2146 s, 579 s | 1394 s, 428 s |

5,325 of the 5,329 stored body hashes are equal; the four changed bodies went
from 607,587, 554,604, 486,420 and 192,232 nodes to 5,001, 11,725, 11,015 and
4,424. The check stage was slower because the 152 codec laws, whose bodies are
identical in both runs, took 22.8 s longer (ratio 1.295) while the host load
average was 25 to 31; `commands` checked 4.0 s faster. With 304d453fd a refusal at
the limit took 0.03 ms after the preceding start, one unit took about 8.6 ms of
coordinator time at level 116, and the mean wait between a worker's fragment
write and the coordinator's cache write was 0.355 s. The main process used 62%
to 117% of one CPU in each 30 s window of the passes.

Benchmark `a8cc0680` timed the parts in isolation with the package's sources:
8,838 helper comparisons took 243-301 ms with file reads and 4-6 ms with digests,
the `indexOf` check on the 36,990 FID names of `da07e431` took 2.6-2.9 s, and one
admission evaluation with 64 live processes spent 2.29 ms reading resident
sizes. The barrier and `compile_tables` times of the paired run fell by more than
these benchmarks predicted: the barrier also compares repeated statics and table
rows, and the benchmark reads its FID names from the C output.

## Remaining work

1. The 152 codec laws take 77 s to 100 s of the check stage. They normalize the
   codec on literal frames; cross-law sharing of inputs is small.
2. Each admitting evaluation takes about 4 ms of coordinator time, 2.3 ms of it
   reading the resident size of 64 running units, and `cache.put` takes about
   2.4 ms per unit, both on the event loop that receives results.
3. The `own` facts that round 5 adds re-emit 1439 units in pass 6 (35 s with
   #1386). `lend_own` makes a parameter owned when no unit lends it, which holds
   only after all lends are final.
4. Check and store run in one process.
5. Unit cache variants are rejected by fact reads of widely called functions
   (55 hits per cold build).
6. The fact history replay (14-15 s) and the C templates (14-16 s) follow the
   passes.
7. `cli_emit_native` runs `Driver.cleanup` before it copies `output.c`.

# Law-bearing hierarchy acceptance on 2026-09-28

[Curated measurement and evidence](measurements/2026-09-28-law-bearing-hierarchy.json)
records the source and executable pins, native IDs, report hashes, process
intervals, steering evidence and complete landing answers. Raw artifacts remain
at the local `run_directory` recorded in that file.

The native hierarchy completed its documentation work and both levels of checked
landing. The original acceptance driver exited 1 because its worker scope check
counted another worker's changes inherited through a correction merge. Issue
[#637](https://github.com/Flip-Engineering/baton/issues/637) records that verifier
failure. The original driver and failure evidence remain unchanged. The repaired
verifier passes against this retained run; its seven provider-free Git fixtures
also pass, including correction merges and rebases.

## Source and binary

The run cloned source `08ee671b62528888a2facd0d3a8ce2af34e5ef98` and built it with
Bend 2.0.25. Before any native task, the scratch launcher verified that the binary
SHA-256 matched the previously gated binary:
`c1fc3aa2c1396989cd79bb214d93cf786aeae22370ad6d1532d363899c82aed4`.
The source pin had passed native build, the entry law gate (223 laws and two
production mutations), and both Bend suites plus 128 Python tests. The curated
measurement records that gate summary and log hashes.
The source checkout, historical trial and resident remained unchanged. No remote
push occurred.

`run.json`, `binary-preflight.json`, `review-prompt-pins.json`, `executable-pins.json`
and `outcome.json` retain source, compiler, executable, original driver, wrapper,
route, task and generated prompt pins. Codex login status confirmed ChatGPT login;
the wrapper forced that login method and removed API key environment variables.

## Work and review

DeepSeek updated only `docs/bend2/target-architecture.md`. Muse updated only
`bend2/README.md`. Kimi recruited both workers, launched them concurrently, and
sent the recorded guidance through its own native tool call after a DeepSeek tool
event. The successful steer receipt precedes DeepSeek's terminal event. The
initial native child lifetimes overlapped by 49.580 seconds, with a retained
snapshot showing both children alive.

An operator clarification identified three possible documentation errors. Codex
checked them against source and found a further error in the push description.
Root and lead reviewed diffs, source claims and relative links. Review requested
corrections to the observer-loss limits, `attach` arguments, read-only `delivery`
behavior and the `push` answer fields. Each worker resumed its existing native
session for corrections. A correction landing conflict was retained, resolved
through ordinary Git merges, and submitted through fresh checked landings.

The selected 13-test `check-unittest.py` suite established the landing checker
behavior. Documentation accuracy was assessed through source and link review.
The final target changes exactly the two assigned files. `git diff --check`
passed. Final target `cbef941389397c4631c8c86dad9446aa53fdeabf` has the same tree as
reviewed lead `c52b0ebb31e13ce7ed63ff016ff3a5b90bd02a56`:
`f647749c9bc6322b24cf9b7ef0a1ff98175a2147`.

All seven original, conflict and correction landing answers remain in
`landing-*.json`. The final worker receipts are `landing-deepseek-push.json` and
`landing-muse-correction.json`; final root receipt is `landing-root.json`.
`root-report.md` retains the root's detailed review.

All 19 native invocations exited 0 naturally. All 11 parent report bodies equal
the corresponding native final text byte for byte, and all have receipts.
Native IDs remained the same across each seat's invocations. Native model frames
confirmed Kimi, DeepSeek and Muse routes. Codex frames omit an observed model.
`owned-process-audit-final.json` records no remaining processes in the run's
working directories. No runtime cutoff or agent interruption was used.

## Usage and durations

The elapsed interval from first native child start to last native child exit was
1,323.415 seconds. Seat durations overlap and include startup, model execution,
tools and exit handling.

| Seat | Requested model | Native invocations | Sum of native seconds |
| --- | --- | ---: | ---: |
| root | gpt-6-astra | 8 | 406.870 |
| lead | kimi-code/k3 | 6 | 979.463 |
| deepseek | deepseek/deepseek-flash | 3 | 339.314 |
| muse | muse-spark-1.3-contributor | 2 | 75.339 |

Codex's final cumulative conversation counters were 2,245,451 input tokens
(including 2,134,400 cached), 9,894 output tokens (including 329 reasoning), and
zero cache-write tokens. Resumed terminal totals were not summed. Retained native
session token-count records corroborate this cumulative interpretation.

OMP usage sums unique completed assistant `message_end` records. Kimi exposed
105,266 input, 4,472,320 cache-read and 39,958 output tokens (4,617,544 total).
DeepSeek exposed 113,825 input, 5,422,848 cache-read and 41,308 output tokens
(5,577,981 total, with 27,178 reasoning tokens reported separately). Both exposed
zero cache-write tokens. Native cost totals were 0 for Kimi and 0.116254188 for
DeepSeek; these fields do not establish subscription charges or invoices. Muse
frames exposed no token or cost totals. Codex exposed no cost total.

`usage-timeline.json` includes per-invocation timestamps, frame hashes, report
byte counts/hashes/receipts and 48 native tool-call windows containing coordinator
commands. Those windows can include shell setup, tests and multiple commands;
they do not isolate coordinator latency. This run establishes no matched old
Baton performance comparison.

## Repaired verification

The repair checks final worker and target changes against the run's assigned-file
union, recorded-base ancestry, and a nonempty assigned-file change per worker.
For each assigned file, its mode and object must match the latest successful
worker landing in lead history and the final target. The target tree must equal
the reviewed lead tree. Native/session/report/steering assertions and clean
workspaces remain required. Native parent review establishes task attribution;
the script does not classify authorship from intermediate commits.

Repair commit: `061411c972a2ae7d69307b94e23b1fc95714a6b2`. The curated
measurement records the full retained-run verification path and hash.
The full retained-run verification records the original failed driver hash and
the repaired verifier hash separately. No native model calls were repeated for
this repair.

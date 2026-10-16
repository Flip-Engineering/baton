# Compiler memory review

Reviewed 2026-10-16. This review read existing source and retained measurements. It did not build, test, change compiler source, change release qualification, or signal a process.

## Finding

The measured growth occurs during repeated Bend2 compiler emission passes. Both completed runs performed eight passes over 3,655 reachable definitions. Large memory use was present before C string assembly. The operating-system peak is a whole-process high-water mark; its exact timestamp is unavailable. The phase diagnostics locate the highest sampled memory and show the preceding growth.

| Retained run | Source commit | Natural exit | C generation peak KiB | C generation seconds |
|---|---|---:|---:|---:|
| postrelease-751-761-20261015-9 | b1f006a6308bbb00e29a24322e4f7d5164774470 | 0 | 142,651,376 | 2,101.119 |
| postrelease-751-761-20261015-11 | 9bdc172e9d44bc6e85c6a1f1d7c15017cde31bdb | 0 | 82,061,032 | 3,556.883 |

Both runs used compiler archive SHA-256 `2df30208da307f7922fefc5517563ad1ee484bc60227f60d88994aad57e4779e`, identical compiler sources and wrapper, the same recorded runtime environment, and unlimited recorded stack limits. They used different application source trees. This comparison does not establish a repeatable optimization or a lower memory admission requirement.

Main11's fresh C generation took 1.693 times the elapsed time of run 9. Artifact reuse has a separate benefit: it avoids repeating a completed generation. This review found no measured compiler optimization that explains a fresh-generation speedup.

| Diagnostic interval, seconds | Run 9 | Main11 |
|---|---:|---:|
| Compiler startup through book.begin | 225.478 | 1,268.126 |
| Reachable-definition preparation | 120.129 | 117.847 |
| Eight emission passes | 1,627.075 | 2,085.892 |
| Reachability filtering | 88.308 | 59.685 |
| Tables and final assembly after reachability | 10.315 | 6.264 |

The startup interval includes source loading and validation. Existing diagnostics do not split its internal work. Source differences, load, scheduling, and garbage collection were not controlled between these runs.

## Phase measurements

RSS below is from existing compiler diagnostics, in GiB.

| Event | Run 9 | Main11 |
|---|---:|---:|
| book.begin | 28.730 | 27.681 |
| carb.end | 41.041 | 41.020 |
| pass 1 end | 61.987 | 52.328 |
| pass 2 end | 70.716 | 58.697 |
| pass 3 end | 78.038 | 65.373 |
| pass 4 end | 87.090 | 68.427 |
| pass 5 end | 97.925 | 69.699 |
| pass 6 end | 110.544 | 70.872 |
| pass 7 end | 119.775 | 73.286 |
| pass 8 end | 135.530 | 75.494 |
| book.end | 135.875 | 75.878 |

Main11's highest sampled RSS was 82,806,669,312 bytes during pass 5, around small coordinator log definitions. A small definition at a high RSS does not establish that definition as the cause. Run 9's highest sampled RSS was 145,894,653,952 bytes at final template assembly, after pass 8 had already reached 145,523,834,880 bytes.

The largest measured single join RSS increases were 85,983,232 bytes in run 9 and 78,643,200 bytes in Main11. Final output was about 60 MB. The existing measurements therefore identify accumulated emission memory as the main scale of this issue; string joins account for a smaller final increment.

Source loading, validation, and ownership checks precede `book.begin`. They had already left about 28 GiB resident at that boundary. There are no phase measurements inside those earlier operations. Main11's later Clang object compilation peaked at 8,692,104 KiB, and native linking at 102,792 KiB. These are separate process measurements.

## Structures and limits of attribution

The compiler clears `OPENS`, `USES`, `FOLDS`, `SPINES`, and `CONSTS` at each definition. `TELES` survives those clears and is cleared at the start of `carb_book`. `PROBES` remains in its module-level array. Main11 finishes with 12,523,253 probes and 3,380,707 telescope entries; run 9 finishes with nearly identical counts. These counts establish retained roots, not their retained byte sizes.

`agent-native.run` has the largest sampled definition-local `USES` and `CONSTS` counts in both runs: 791,615 and 3,771,346. Its first emission in run 9 increased RSS by 4,034,252,800 bytes. `term_uses` constructs persistent maps through `pmap_set` and `pmap_union`. Existing diagnostics count cache entries but do not count persistent-map nodes or attribute bytes to those nodes, term graphs, closures, probes, or telescope entries.

The source and measurements support investigating retained term/cache graphs and definition-local persistent-map allocation. They do not prove that one cache, persistent maps, garbage-collector policy, or a specific definition owns the full peak. Main11's reported heap use falls between passes 5 and 6 while retained cache counts keep growing; cache entry counts alone cannot explain the RSS difference between runs.

## Repeated work and parallelism

`compile_book` calls every reachable definition in a fixed reverse order on each pass. The emitted control flow also computes ownership, borrowing, sharing, and static-constructor facts. `own`, `hot`, and `stat` accumulate across passes. `lend` and the borrowed-signature memo are cleared each pass; `facts_lend` closes lending implications and adds owned parameters after the whole pass. The loop stops when the total number of accumulated facts is unchanged.

Both runs have the same end-of-pass counts:

| Pass | own | hot | stat | New own facts |
|---|---:|---:|---:|---:|
| 1 | 7,936 | 624 | 56 | 7,936 |
| 2 | 9,650 | 832 | 56 | 1,714 |
| 3 | 9,983 | 832 | 56 | 333 |
| 4 | 10,069 | 832 | 56 | 86 |
| 5 | 10,100 | 832 | 56 | 31 |
| 6 | 10,109 | 832 | 56 | 9 |
| 7 | 10,113 | 832 | 56 | 4 |
| 8 | 10,113 | 832 | 56 | 0 |

All 3,655 definitions are emitted eight times: 29,240 definition emissions. Late passes still create about 1.76 million C lines each. The small fact deltas justify investigating a fact-dependency worklist or a separate fact-solving phase followed by final emission. Correct invalidation must account for callee parameter ownership, global type/constructor sharing facts, static constructors, lending implications, and inlined definitions. Existing logs do not identify which definitions read each changed fact, so they do not establish how much work an incremental compiler could omit.

Parallel function emission is a substantial compiler change. Current workers would share mutable global caches, probe IDs, accumulated facts, borrowed-signature caches, and a single `File` with segment lists, literal/image offsets, specialization names, closure sets, and output tables. A parallel design needs explicit fact snapshots and barriers, isolated definition output, and deterministic merging of identities and shared output. Final facts must still satisfy the existing ownership and sharing invariants. Scheduling more current compiler processes would duplicate the measured memory footprint.

Segment string formatting after reachability reads completed segment records and is structurally suitable for independent work. The measured late tables/assembly interval is 6–10 seconds. Its measured scope is much smaller than the repeated emission phase.

## Concrete optimization candidate

`compile_book`'s reachability walk searches `fl.segs` and then `fl.spins` linearly for each visited function ID (`comp.ts:3082`). Before filtering there are about 40,120 segments. Indexing function ID to reference set once would change these repeated lookups to map lookups. The index must preserve the current first matching segment, then first matching specialization precedence, and be built before both host/device traversals. The graph and emitted output can then be compared exactly against the current walk. This is a bounded candidate for the measured 60–88 second reachability interval; it has no demonstrated speedup yet and does not address the larger repeated-emission cost. No source change was made.

## One next measurement

After current release qualification, collect a retained-heap graph at `carb.end` and immediately after the first `agent-native.run` emission in one isolated remote measurement run with an exact source/compiler pin. Attribute retained bytes and retaining paths to `TELES`, `PROBES`, `USES`, `CONSTS`, persistent-map `Bin` nodes, and term closures. Preserve the original diagnostics and capture the measurement overhead. This addresses the missing byte attribution before selecting a compiler change. This review does not authorize that run or change current admission policy.

## Source references

Canonical source root: `/Users/wahargis/Development/Experiments/baton-bend-repl-778-20261016/bend2/compiler/upstream`.

- `main.ts:580`: source loading, validation, and ownership checks in `book_read`.
- `main.ts:294`: `cli_emit` calls `compile_book` before writing C.
- `comp.ts:9`: existing memory and cache diagnostic fields.
- `comp.ts:608`: module-level compiler caches.
- `comp.ts:719`: `memo_gc` cache clears.
- `comp.ts:726`: probe creation and retention.
- `comp.ts:881`: cached use maps and persistent-map construction.
- `comp.ts:944`: telescope memoization.
- `comp.ts:1136`: static-constructor facts and shared image offsets.
- `comp.ts:1219`: borrowed signatures depend on accumulated ownership facts.
- `comp.ts:1479`: reachable-definition preparation and initial cache clears.
- `comp.ts:1592`: shared compiler output state.
- `comp.ts:1740`: emission also computes analysis facts.
- `comp.ts:1816`: lending closure and ownership inference.
- `comp.ts:1859`: ownership and lending facts from value uses.
- `comp.ts:2130`: argument emission reads borrowed signatures and sharing facts.
- `comp.ts:2237`: shared specialization names and output.
- `comp.ts:2893`: definition emission and boundary diagnostics.
- `comp.ts:3033`: repeated emission passes and fixed-point condition.
- `comp.ts:3082`: reachability traversal and linear function-ID lookup.
- `comp.ts:3114`: final output joins and template replacement.
- `bend.ts:527`: persistent-map update allocation.
- `bend.ts:546`: persistent-map union allocation.

`comp.ts` SHA-256: `1956f2e238e4d0cda91cd694c82d05ea06d5edd6b4eed12604c730012a69610a`.

## Retained evidence

Remote root: `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton2-compiler-741-20261015`.

- Run 9 `c-generation/stderr`: 46,952,404 bytes; SHA-256 `7483dea4edf74ef9809fd241736621f3e07abb865586d86a216d5d8e1981fbe8`.
- Main11 `c-generation/stderr`: 46,747,788 bytes; SHA-256 `c237700408c3b35c587f62c368f760e569eb5d72f8f33be42391dade09332275`.
- Each run's `c-generation/result.json` records natural wait status and whole-process peak.
- `retained-phase-analysis.jsonl` contains selected phase rows, highest RSS samples, definition deltas, and join deltas with original diagnostic line numbers.
- `cache-analysis.jsonl` contains maximum cache counts and definition durations with original diagnostic line numbers.
- `run-identities.jsonl` contains source pins, compiler/source hashes, and execution metadata.
- `fixed-point-analysis.jsonl` contains all pass boundary fact counts and elapsed times with original diagnostic line numbers.

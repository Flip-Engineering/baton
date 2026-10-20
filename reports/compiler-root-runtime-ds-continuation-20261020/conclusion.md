# Compiler-root source-only continuation — architecture, elapsed time, memory, and the inefficiency hypothesis

Session: `compiler-root-runtime-ds-continuation-20261020` (omp, `deepseek/deepseek-flash`, effort max).
Database: `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/replay-sqlite-stall-937-20261019/orchestra.db`.
Checkout: `/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/compiler-root-runtime-ds-continuation-20261020`, branch `compiler-root-runtime-ds-continuation-20261020`, base `07989efe12ec4257641a10a40d9748dc866cbb3c`.
Lineage: original authority `message:operator:1f7e7764966eed763ae3b1a1808deed3`, original conductor `compiler-root` native `01a14bf6-80fc-7000-81a7-858def42d517` (stop-fenced, not woken, not changed). This continuation is not a replacement owner of `compiler-research` or `compiler-wonder-review` and makes no membership claim.

Method: read-only. No compile, C generation, build, test, benchmark, compiler launch, process signal, shared-checkout change, installed-toolchain change, release mutation, or push. The #970 shared-compilation-queue hold remains in force. All numbers below are either recomputed from retained artifacts in this checkout, read from retained read-only diagnostics, or copied from a cited existing report with its own pins; none is a new execution.

Seed note: the supplied seed is a 128-character hexadecimal string with no attributable semantics; it is treated as opaque. It contributes no prior to any statement below.

Evidence tags: `[M]` measured in a retained artifact; `[S]` static source fact verified in this checkout; `[D]` arithmetic derived from `[M]`/`[S]`; `[R]` existing result read from a cited report, not re-run by this session; `[H]` hypothesis; `[G]` gate / unmeasured.

## 1. Name the compiler state first

The retained measurements and the optimization work are on different compiler states. Conflating them was the largest ambiguity in the original round.

| State | `comp.ts` SHA-256 | `main.ts` SHA-256 | Content | Retained by |
|---|---|---|---|---|
| Canonical retained Main11 / installed 2.0.25 | `1956f2e238e4d0cda91cd694c82d05ea06d5edd6b4eed12604c730012a69610a` | `92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e` | all-full fixed-point loop; `TELES` bookwide; `PROBES` append-only; linear reach lookups | this checkout `compiler/`; `evidence/*.jsonl`; `canonical/repl-upstream.lock.json`; compiler archive `2df30208…e4779e` |
| Forkflush baseline `a2e0818` | `499ea5f1b8c0d9d13b1346821d5460e38dc56ae3f852e304a5e47ac4dd7c1b9e` | `3eae91c5b0381fd4d2d2a98b4b0257f76014633112aafbbbae06b097cbd65f93` | dry facts-only prepasses; `stable_defs` reuse; reach index + iterator stack; foreign requests deferred | original repo commit `a2e0818`; diff verified in §3.5 |
| Branch-round winner `b46e498` | `102124423cccde324a31ab7d0a2142ced612cfa34d760e5c0baa97dc3200dac6` | `3eae91c5…` (same) | `a2e0818` + `TELES` cleared per definition + `PROBES.length = 1` | original repo commit `b46e498`; `+8/−1` single-file diff |
| Later release lineage referenced by other lanes | `b68bfe1a…` / `37b29f3…` / `ca02f3cd…` | `53ce8e48…` | additional front-end/`h`-on-demand work | cited reports only; not present in this checkout |

`[S]` All hashes above were recomputed with `sha256sum` / `git show <rev>:compiler/comp.ts | sha256sum` this session. The canonical archive hash is `2df30208da307f7922fefc5517563ad1ee484bc60227f60d88994aad57e4779e` (`task-context.json`; `evidence/run-identities.jsonl`).

Consequence: "the current approach" has at least three meanings. The retained 8-pass measurements are of state 1. The dry-pass design is already implemented in state 2. The per-definition probe/telescope lifetime change is state 3. A conclusion that does not name the state is not reproducible.

## 2. Retained measurements, recomputed

Source: `evidence/run-identities.jsonl`, `evidence/fixed-point-analysis.jsonl`, `evidence/retained-phase-analysis.jsonl`, `evidence/cache-analysis.jsonl`, plus targeted streaming reads of the two retained `c-generation/stderr` files (`run 9` SHA-256 `7483dea4…981fbe8`; `Main11` `c2377004…9332275`) for per-pass bytes. Both runs: natural exit 0, compiler archive `2df30208…`, same runtime environment, unlimited stack.

### 2.1 Whole-process outcome

| | run 9 | Main11 | ratio / delta |
|---|---:|---:|---:|
| App source commit | `b1f006a6…` | `9bdc172e…` | different trees |
| C-generation elapsed | 2101.119064 s | 3556.883461 s | +1455.764 s, 1.693× |
| Whole-process peak (`max_rss_kib`) | 142,651,376 KiB | 82,061,032 KiB | run 9 is 1.739× |
| `book.begin` elapsed | 225.478 s | 1268.126 s | +1042.648 s |
| `book.begin → carb.end` | 120.129 s | 117.847 s | −2.282 s |
| Sum of 8 pass durations | 1627.039 s | 2085.794 s | +458.755 s |
| Reachability (`reach.begin→end`) | 88.308 s | 59.684 s | −28.623 s |
| Tables (`tables.begin→end`) | 6.161 s | 3.823 s | −2.339 s |
| Tables end → book end | 4.147 s | 2.441 s | −1.706 s |
| Book end → process end | 29.813 s | 19.068 s | −10.745 s |

`[D]` Decomposition of the observed +1455.764 s: pre-`book.begin` **+1042.648 s (71.6%)**, the eight emission passes **+458.755 s (31.5%)**, reachability **−28.623 s (−2.0%)**, tables **−2.339 s**, tail **−10.745 s**, remainder ≈0.06 s of inter-phase gaps. The 1.693× whole-process ratio is therefore not an emitter-slowdown ratio. The largest single inter-run difference is the un-instrumented load/validate/ownership interval before `book.begin`.

`[M]` At `book.begin` the live heap is almost identical across the two app trees: `heapUsed` 11,581,006,740 B (run 9) vs 11,581,523,270 B (Main11), Δ 0.005%. RSS differs by 1.126 GB (1.049 GiB; 30.849 vs 29.723 GB) and `heapTotal` by 1.111 GB (1.034 GiB). So the +1042.6 s startup difference is not explained by a larger retained live heap at the boundary. Its cause remains unmeasured; it is not attributable to the emitter.

### 2.2 The eight passes

`[M]` Both runs emit 3,655 reachable definitions on each of 8 passes = 29,240 definition emissions. Fact trajectory is identical in both runs: `own/hot/stat` = 7,936/624/56 after pass 1, 9,650/832/56 after pass 2, 9,983/832/56 after pass 3, 10,069/832/56 after pass 4, 10,100/832/56 after pass 5, 10,109/832/56 after pass 6, 10,113/832/56 after pass 7, unchanged after pass 8.

| Pass | run 9 duration | Main11 duration | new `own` | run 9 RSS end | Main11 RSS end |
|---:|---:|---:|---:|---:|---:|
| 1 | 180.791 s | 148.205 s | 7,936 | 61.99 GiB | 52.33 GiB |
| 2 | 186.226 s | 158.167 s | 1,714 | 70.72 | 58.70 |
| 3 | 200.422 s | 345.876 s | 333 | 78.04 | 65.37 |
| 4 | 210.906 s | 352.276 s | 86 | 87.09 | 68.43 |
| 5 | 215.805 s | 301.877 s | 31 | 97.92 | 69.70 |
| 6 | 222.366 s | 301.930 s | 9 | 110.54 | 70.87 |
| 7 | 223.592 s | 268.813 s | 4 | 119.78 | 73.29 |
| 8 | 186.933 s | 208.651 s | 0 | 135.53 | 75.49 |

`[D]` Passes 3–8 cost 1260.023 s = **59.97%** of run 9's whole-process elapsed and 1779.423 s = **50.03%** of Main11's, while adding 463 of 10,113 `own` facts (**4.58%**) in both runs. Pass 8 adds zero facts and still costs 186.933 s (8.90% of run 9) / 208.651 s (5.87% of Main11). This is the measured core of the repeated-work hypothesis: the work is real and large in kind.

`[M]` Emitted C lines per pass are essentially flat from pass 2 onward:

| | run 9 | Main11 |
|---|---:|---:|
| Pass 1 lines | 1,633,748 | 1,633,891 |
| Pass 8 lines | 1,762,795 | 1,762,946 |
| Sum of 8 passes | 13,965,544 | 13,966,744 |
| Discarded (sum − kept) | 12,202,749 = **87.38%** | 12,203,798 = **87.38%** |
| Final `line_code_units` | 83,873,628 | 83,877,781 |

`[M]` Retained roots grow deterministically: `PROBES` grows by exactly **+1,322,744** entries in each of passes 2–8 (run 9) and **+1,322,752** (Main11); end counts 12,523,177 / 12,523,253. `TELES` grows from 3,178,003 / 3,178,020 at `carb.end` to 3,380,690 / 3,380,707 at pass-end 8, i.e. only ~6% of its entries are minted during emission; the bulk is created before the first pass. `USES` max 791,615 and `CONSTS` max 3,771,346 both occur inside `agent-native.run`; `OPENS` max 142,099, `SPINES` 22,189, `FOLDS` 1,863. Counts are not bytes.

### 2.3 Where the memory difference accumulates

`[M]` Exact counter values at three boundaries (bytes):

| Boundary | run 9 heapUsed | Main11 heapUsed | Δ | run 9 heapTotal | Main11 heapTotal | run 9 RSS | Main11 RSS |
|---|---:|---:|---:|---:|---:|---:|---:|
| `book.begin` | 11,581,006,740 | 11,581,523,270 | +0.517 MB | 30,503,716,864 | 29,392,964,608 | 30,848,925,696 | 29,722,546,176 |
| `carb.end` | 18,852,948,706 | 17,637,728,125 | +1.215 GB | 36,058,462,208 | 38,662,191,104 | 44,067,598,336 | 44,045,074,432 |
| pass 8 end | 65,941,962,263 | 46,870,117,369 | **+19.072 GB** | 108,899,750,912 | 68,381,483,008 | 145,523,834,880 | 81,060,818,944 |

`[D]` Emission-phase `heapUsed` growth: 47.089 GB in run 9 vs 29.232 GB in Main11; the difference (17.857 GB) is **93.6%** of the final `heapUsed` difference. The memory divergence is therefore an emission-phase phenomenon, even though the elapsed divergence is mostly pre-`book.begin`. These are different axes and must not be conflated.

`[M]` At pass 8 the cache counts are nearly identical (probes Δ76 of 12.5 M = 0.0006%; teles Δ17) while `heapUsed` differs by 19.072 GB — 17.76 GiB. That is a direct measured refutation of any byte model built from cache entry counts alone. The referents, object representation, persistent-map nodes, and GC state differ; the counts do not.

`[M]` `RSS − heapTotal` at pass 8 is 36.624 GB (run 9) vs 12.679 GB (Main11), a 23.945 GB difference (22.30 GiB). `external` is only 4.26 vs 2.35 GiB (Δ1.91 GiB) and `arrayBuffers` is 116 B in both. The 22.3 GiB non-heap resident difference is unexplained by these counters; candidates are JSC/JIT/allocator metadata, thread stacks, and resident non-heap pages. `[G]` No measurement distinguishes them.

`[M]` Highest samples: run 9 145,894,653,952 B at final template assembly (join.end), after pass 8 had already reached 145,523,834,880 B; Main11 82,806,669,312 B during pass 5 at a `definition.end`, above both adjacent boundary RSS values. The OS peak is a whole-process high-water mark; its exact timestamp is unavailable. Final string joins add only 76–86 MB, so joins are not the accumulation mechanism.

## 3. Source facts verified this session

All anchors are in this checkout's canonical `compiler/` (`comp.ts` 6,662 lines, `bend.ts` 3,947 lines, `main.ts` 683 lines).

1. `[S]` `compile_book` fixed point (`comp.ts:3033-3081`): `facts() = cb.own.size + cb.hot.size + cb.stat.size`; `do { was = facts(); fl = pass(done_defs(cb).reverse()); } while (was !== facts());`. Every pass calls `compile_def` for every reachable def in fixed reverse order. `done_defs` is rebuilt each pass in state 1 (`comp.ts:1577-1580`).
2. `[S]` `pass()` clears `cb.lend` and `BRWS` per pass (`comp.ts:3046`) and calls `facts_lend(cb)` after emission (`comp.ts:3059`). `lend` is therefore a post-pass fixpoint input, not a pre-pass fact.
3. `[S]` `memo_gc()` clears `OPENS, USES, FOLDS, SPINES, CONSTS` (`comp.ts:719-721`) and is called per definition in `carb_book` (`1503`), in `compile_def` (`2897`) and in the JS path (`3363`). `TELES` is not in that list. `TELES` is cleared only at `carb_book` entry (`1481-1482`). `PROBES` is a module-level array (`608`) appended by `probe()` (`726-730`); nothing truncates it in state 1. This exactly explains the measured linear probe growth and the bookwide telescope retention.
4. `[S]` `probe()` is called by `term_open` for every lambda/let binder (`751-756`) and by `anf` for every non-flat cut (`1379-1381`); `probe_of` reads `PROBES[t.i]` (`732-734`). Probe indices are definition-local by construction, but the array retaining every probe object is not.
5. `[S]` `term_uses` builds persistent maps via `Bend.pmap_set` / `pmap_union` (`881-894`), and `term_const` memoizes constructor subterms in `CONSTS` (`865-874`). These are the sources of the `agent-native.run` maxima (791,615 uses; 3,771,346 consts). They are cleared at the next definition, so they are within-definition peaks, not cross-pass retention.
6. `[S]` Reachability (`comp.ts:3082-3088`) still does `fl.segs.find(...)` and `fl.spins.find(...)` per visited fid, i.e. a linear scan of ~40,120 pre-filter segments for each reachable node in state 1. This is the bounded, output-identical candidate later indexed in `a2e0818`.
7. `[S]` `book_read` (`main.ts:578-598`) performs `Bend.book_load`, `Bend.book_valid`, and `Comp.book_owned` before `compile_book`. `book_valid` (`bend.ts:3860-3946`) iterates the entire `book.order` with no reachability filter, checks every def, and stores `def.e = def_check(book, k, def)` for every def with `v !== null` (`3942-3944`). `book_load` retains each module's joined source string through `Span.src` (`bend.ts:336`, `1590-1591`, `1097`). The pre-`book.begin` interval therefore contains source loading, full type checking/elaboration, and ownership checks; no diagnostics split them.
8. `[S]` `Def.e` has exactly one read site in the canonical compiler: `def_body` (`comp.ts:1464-1472`), guarded by `tld.e !== undefined && tld.h === undefined`; it builds `h = Bend.term_higher(tld.e)` and installs `{ ...tld, n, h }`. `bend.ts` only writes `e` (`3943`). By contrast `Def.v` is read after validation by `done_live` (`comp.ts:1573-1575`), `facts_fam` (`1791-1793`), `intr_of` (`913`), `main` detection (`1297`), and template instantiation (`bend.ts:2999-3004`, `3824`). A uniform "drop `v`" change is therefore unsound; an `e`-drop is source-plausible but belongs to the later lineage's `h`-on-demand work and was not attempted here (`[G]`, §8).
9. `[S]` Final assembly after reachability is over completed segment records (`comp.ts:3115-3136`); the measured late tables/assembly interval is 6.161 s / 3.823 s. It is structurally parallelizable but low-leverage relative to emission.
10. `[S]` `a2e0818` changes (verified as a diff against this checkout):
    - adds `FACTS_ONLY_FIRST` and a `fl.dry` flag; `file_push` counts but does not retain C lines; `emit_native` skips spin-source joins; `compile_reqs` skips request text in dry passes (`comp.ts` + `main.ts` across the four commits: 134 insertions, 38 deletions total);
    - hoists `stable_defs` / `emission_defs` / `foreign_defs` out of the pass loop;
    - builds a `refs_by_fid` index and replaces the recursive `find`-based DFS with an explicit iterator stack;
    - runs one full pass first, then dry passes until facts stop moving, then one final full pass, then the original full loop as a safety net. If dry passes compute the same facts as full passes (the design's premise), an 8-pass book needs **2 full + 7 dry = 9 passes**, not fewer analysis passes; addendum 23 observes this shape as an inference, not a measured comparison.
    - Dry passes still run `compile_def` for every definition and still mint probes/TELES; only retained text/spin/request strings are skipped. The dry design is therefore a **text-retention** optimization, not a probe/term-retention optimization.
11. `[S]` `b46e498` changes only `memo_gc` (+8/−1): adds `TELES` to the per-definition clears and sets `PROBES.length = 1` (preserving `DUMMY` at index 0). This is the only change in the round that addresses the linear probe/tele retention directly.

## 4. The Main-scale dry-pass attempt (existing result, read-only)

`[R]` `cgen-emergency-wonder/reports/cgen-emergency-wonder/addendum-23-main-run-ledger.md` analyses a retained failed full-book attempt: compiler `a2e0818`, source `57c3361a…`, 3,778 definitions, diagnostics on, 6 h scope, 140 GiB/20 GiB-swap cgroup. It is a different book from the 3,655-definition retained pair and is not a controlled comparison.

`[R]` Measured outcome: passes 1 full + 2–6 dry + pass 7 partial (1,290/3,778 defs), 23,958 completed definition emissions; exit 133/SIGTRAP at 19,179 s, 40 min before the scheduler deadline; no `baton2.c`; cgroup peak 108.76 GiB, max RSS 120.26 GiB, swap at its 20 GiB cap; 12.33 M major faults, ≈92.5 GiB filesystem reads; user+sys 4,494 s = 23.4% of wall. The SIGTRAP trigger is unknown (journal/dmesg inaccessible); memory pressure is the leading hypothesis, not a finding.

`[R]` Pass ledger (RSS at pass end): 57.0 → 60.0 → 75.7 → 85.0 → 97.3 → 115.4 GiB across one full and five dry passes. Probes grow exactly +1,412,897 per interval and TELES +30,490 per interval, while fact adds fall (+1,787, +335, +86, +31, +9). `heapUsed` freezes at 54.9 GiB from pass 4 on. The report's static shape bound: a five-field `Probe` object plus one array slot is order 10² B, so +1.413 M probes/pass is ≤~0.3 GB/pass, against measured +3.0–18.1 GiB/pass. `[R]` The growth is therefore at least an order of magnitude larger than the probe/TELES entry slots; it lies in term graphs, persistent-map nodes, GC/committed heap, or page residency — unattributed without a heap graph.

`[R]` Per-definition wall time varies 15–73× within the same run with byte-identical per-definition cache counts (e.g. `agent-native.run` 19.9–384.6 s; `commands.parse_basic_eight` 4.6–337.0 s). The report attributes the variance to page/GC stalls (consistent with 76.6% off-CPU), not to definition-local algorithmic cost. `[R]` The fixed point was not reached; the report infers the `a2e0818` loop would need 1 full + 7 dry + 1 final full = 9 passes on that trajectory, and dry passes were not cheaper (3,780–4,518 s) than the full pass 1 (899 s) under a much smaller heap. This is an inference from one failed run, not a measured comparison.

What this result changes:
- `[D]` The claim "accumulated emission text/cache entries are the memory mechanism" is too narrow. With dry passes retaining no C text, RSS still rose 57→115 GiB. The dominant growth is not output text.
- `[R]` The claim "the dry prepass bounds memory" is falsified for this book.
- `[D]` The claim "a dry pass is much cheaper than a full pass" is not supported at Main scale; the fixture calibration (§5.4) and this attempt both point to term analysis/stalls dominating, not text retention.
- `[R]` The attempt produced no candidate effect and no output; it establishes only the failure and the growth pattern.

## 5. Bounded candidate results (existing, cited; not re-run)

1. `[R]` **Winner `b46e498`** (per-def `TELES` clear + `PROBES.length = 1`): `fp_list@4000` peak RSS −13.83% with non-overlapping ranges (base min 592,888 KiB > candidate max 556,656 KiB); `chain-1200` −1.83% with overlapping ranges; paired elapsed medians −0.220 s (set A) and −0.175 s (set B), 3/10 and 5/10 positive pairs; C byte-identical (`5352dc93…` / `32416137…`). G2(c) passes only under the pre-committed "median paired Δ ≤ 0" rule — a null-to-slightly-favourable result, not a speedup. One bounded fixture, one host epoch, no Main-scale claim.
2. `[R]` **Between-pass `File` lifetime + `Bun.gc(true)`** (cgen-allocation-ds `fixed-point-lifetime.patch`): chain-8000 peak RSS −13.85% (412,668 → 355,496 KiB), chain-1200 −6.73%; wall medians +11.9% / +5.0% with heavily overlapping samples; C byte-identical and all pass-end counters identical. The patch also hoists `done_defs(cb).reverse()` and breaks superseded `File` containers. It addresses the fact that the prior pass's whole `File` stays reachable during the next pass (`comp.ts:3076-3081` in canonical). Fixture-scale only.
3. `[R]` **Reachability index**: controlled Process pair, both exit 0, C byte-identical at the historical anchor (556,462 B, `b77fb4b6…`); baseline 1.337968902 s / 224,416 KiB vs index 1.477344364 s / 227,280 KiB. No demonstrated speed or RSS benefit. The measured reach interval it targets is 60–88 s = 1.7–4.2% of process time. Output-safe, performance-unproven.
4. `[R]` **Dry vs full pass at fixture scale** (compiler-kimi, `a2e0818` state): `fp_list-4000`, diagnostics on: pass 1 full ≈2096 ms, pass 2 dry ≈1798 ms, pass 3 full ≈1890 ms. Dry is ≈4.9% faster than the adjacent full pass; term analysis dominates. This is one fixture and not a Main-scale measurement.
5. `[R]` **TU split for the C compile stage** (compiler-kimi, branch `codex/baton-tu-split`; not Bend2 generation): thin segment unit 13,173 lines = 0.89 s / 123,840 KiB vs shared-head one-TU 146,730 lines = 35.66 s / 1,538,744 KiB; ~106 thin units ⇒ ≈95 s sequential / ≈6–10 s parallel-wall, against the operator-measured monolith >5 min / 7.6 GiB. Semantic-equivalence gate PASS on fixtures. The shared header must carry zero mutable state (the first partitioned build failed on fourteen mutable statics duplicated per TU). Full-scale qualification and header thinning remain `[G]`.

## 6. Verdict on the inefficiency hypothesis

**Correct in kind, unquantified in magnitude, and not a memory-attribution claim.** Split by claim:

- **Repeated work:** supported. `[M]` 8 full passes over 3,655 definitions = 29,240 emissions; 87.38% of 13.97 M emitted lines discarded; passes 3–8 add 4.58% of final `own` facts yet cost 59.97% / 50.03% of whole-process elapsed; pass 8 adds zero facts and costs 186.9 / 208.7 s. The source loop is exactly the fixed-iteration all-full design (`[S]` §3.1).
- **The current approach is slow because of the emitter:** not established. `[D]` 71.6% of the observed 1.693× elapsed difference is the pre-`book.begin` interval; the passes contribute 31.5%, and reachability/tables are faster in Main11. The two runs also use different application source trees and uncontrolled host load; the ratio is a two-sample observation, not a controlled speedup/slowdown factor.
- **The current approach's memory peak is caused by retained C text or cache entries:** not established, and partly contradicted. `[R]` The Main-scale dry attempt retained no C text and still grew 57→115 GiB; `[M]` cache entry counts are effectively identical at pass 8 while `heapUsed` differs by 19.07 GB; `[R]` the probe/TELES slot shape bounds those slots at ≤~0.3 GB/pass against +3–18 GiB/pass measured. The growth is in term graphs, persistent-map nodes, GC/committed heap, or resident non-heap pages; a retained-heap graph is still required.
- **A bounded optimization exists and is proven faster:** only the winner's memory direction is proven at fixture scale (−13.83% peak on one 4,000-definition fixture), with a null-to-slight elapsed result. No Main-scale speedup, no Main-scale memory reduction, and no lower safe admission threshold are established.
- **The cheap wins are unimplemented:** false for the forkflush lineage. `a2e0818` already ships the dry prepass, `stable_defs` reuse, the reach index, and foreign-request deferral; `b46e498` adds the probe/TELES lifetime change. The canonical installed state (1956f2e2) has none of them. This is a lineage statement, not a performance claim.

The defensible one-sentence conclusion: *Baton's Bend2-to-C compiler demonstrably repeats full-book emission that is mostly discarded, and the repeated work is large enough to justify the implemented dry-pass and cache-lifetime changes; but the retained evidence does not establish a deterministic speedup, a retained-byte attribution, or a Main-scale memory reduction, and the observed 1.693× elapsed difference is dominated by the un-instrumented pre-emission interval rather than by the emitter.*

## 7. Disagreements preserved

- **compiler-kimi vs compiler-deepseek/muse on text share.** Kimi's dry-vs-full fixture calibration (≈4.9% of a pass) says term analysis, not text retention, dominates pass cost. Deepseek and Muse recorded that no per-pass text timing exists at Main scale and refused a text-share claim in either direction. Addendum 23's Main-scale attempt (dry passes retaining no text yet growing 57→115 GiB) is consistent with Kimi's direction but does not replace a controlled text-vs-analysis measurement.
- **Reach index ranking.** Deepseek ranked the reachability index first as the bounded, output-identical change; Muse recorded that its 60–88 s interval is 1.7–4.2% and that no speedup was demonstrated. The controlled Process pair showed output identity with no benefit. The disagreement is about ranking, not about the measured pair: the index is safe, not shown faster.
- **Memory vs throughput trade-off.** The winner's per-definition reset family buys RSS at a possible throughput cost; the unpaired point estimate was +13.6% elapsed, while paired sets were −0.175/−0.220 s. Muse's warning that byte claims require a heap graph and that `heapUsed` has counter anomalies is confirmed by the pass-6→8 `heapUsed` freeze/fall in the retained logs and by addendum 23's frozen 54.9 GiB.
- **Parallel emission feasibility.** Kimi's identity correction stands: emitted C depends on pass-global counters (`fl.segs.length`, `fl.tabs.size`, `fl.img`, `fl.spun.size`), so identities must be per-definition symbolic plus a canonical-order merge; full preassignment is impossible without a dry pass. Deepseek's earlier proposal is reconciled to that account, not vice versa.
- **Dry-pass ordering.** `a2e0818` runs a full pass first, then dry passes, then a final full pass. Addendum 23 infers this adds a pass on an 8-pass book. The branch round's fixture evidence shows byte identity and memory direction but no Main-scale confirmation. The ordering remains an unmeasured design choice, not a settled optimization.

## 8. Outstanding gates and blockers

1. `[G]` **#970 compilation queue not operational.** No compile/build/test/CI/benchmark may run. All statements here are source/retained-evidence only. Queue implementation is owned by `compiler-queue-970-coordinator`; not duplicated here.
2. `[G]` **Retained-heap graph at `carb.end` and immediately after the first `agent-native.run` emission**, with and without a forced collection, including retaining paths for `PROBES`, `TELES`, `USES`, `CONSTS`, persistent-map `Bin` nodes, term closures, and the `RSS − heapTotal` 22.3 GiB gap. Not collected.
3. `[G]` **Pre-`book.begin` split** into load, parse, validate/elaborate, and ownership. Currently a 225 s vs 1268 s blind spot; live heap at the boundary is nearly identical (Δ0.005%), so the elapsed difference is work/scheduling/IO, not retained state, but it is not measured.
4. `[G]` **B8 Main full-pass SIGTRAP** (PID 855078, exit 133 after 5 h 19 m, no output, cause unknown) blocks every Main-scale claim and any Main admission. Addendum 23's dry-pass memory finding must be addressed at Main admission.
5. `[G]` **Main-scale qualification** of `b46e498`, the between-pass `File` lifetime, the dry prepass, and the reach index. All are bounded-fixture results only.
6. `[G]` **`Def.e` lifetime** (front-end): the canonical compiler stores `e` for every checked def and reads it only in `def_body` before `h` is installed. The later lineage's `h`-on-demand work (`delete next.e`) and the 2,203 non-SRCS defs in the b559 run are a concrete retention target, but a safe cut must handle multiple `compile_book` calls on one book, shared TLD objects, and the `term_spine` early-`def_body` path. Not implemented.
7. `[G]` **TU-split header thinning and full-scale equivalence**; full-scale compile was never run (hold).
8. `[G]` **Release 48 GiB build front-end OOM** (b559 arm: 18.5 GiB RSS / 8.09 GiB heap at `book.begin`, 2,203 non-SRCS defs) has a source trace but no forced-GC measurement. It is a separate release lane; listed for continuity, not claimed here.
9. `[G]` **Branch lifecycle.** The recorded rounds (`a8c574…` WeakMap OPENS, `825a54…` reach index, `297b4a…` b46e498) are settled/selected in the original DB. No historical branch is revived, merged, or re-evaluated by this continuation.

## 9. Artifacts read and hashes (this checkout unless absolute)

| Artifact | SHA-256 / identity |
|---|---|
| `tasks/COMMON.md` | `87301d3cb8d0cee2a1699747f0d771ac20797481ae97b0ce3b89c051183b64b3` |
| `task-context.json` | `ae915b996d1e48b65889b3ac0320dfe7223a53297885770465f8d7199f4b1a7d` |
| `evidence/review.md` | `93db15dd32dce437d7153172badf895bd271333a7444c279d9146c5317adecaa` |
| `evidence/retained-phase-analysis.jsonl` | `a7ee71912ea1e4bd21a8f6e5d1b8d4d40e87e3b3312e32b25fd9516b27194580` |
| `evidence/fixed-point-analysis.jsonl` | `1cb3e63b19a58f351c7c8d5989896f1ef5900d2369a35cc515e0e6bbb55d35ef` |
| `evidence/cache-analysis.jsonl` | `f43df7193c784bc3002a9f976b108c996b2db0642dce91827eaca761d7c5230f` |
| `evidence/run-identities.jsonl` | `aba3e3d69b3c233100958bac14626b94dcf0861f0346a471130438f3ad5ffa94` |
| `evidence/evidence-custody.jsonl` | `73e5ab0ec30520c2bf164de908334a7455f33e723802a21bbb1feb06d4865e6b` |
| `compiler/comp.ts` | `1956f2e238e4d0cda91cd694c82d05ea06d5edd6b4eed12604c730012a69610a` |
| `compiler/bend.ts` | `93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85` |
| `compiler/main.ts` | `92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e` |
| `compiler/base.bend` | `e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798` |
| Retained run 9 stderr | 46,952,404 B, `7483dea4edf74ef9809fd241736621f3e07abb865586d86a216d5d8e1981fbe8` |
| Retained Main11 stderr | 46,747,788 B, `c237700408c3b35c587f62c368f760e569eb5d72f8f33be42391dade09332275` |
| Original operator assignment | `message:operator:1f7e7764966eed763ae3b1a1808deed3` |
| Prior reports read | `compiler-deepseek/reports/compiler-deepseek/{architecture,recommendation,memo-lifetime-audit}.md`; `compiler-kimi/reports/compiler-kimi/throughput-design.md`; `compiler-muse/reports/compiler-muse/evidence-review.md`; `cgen-emergency-wonder/reports/cgen-emergency-wonder/{recovery-inventory-20261017,addendum-23-main-run-ledger,forkflush-comparison-20261017}.md`; `cgen-allocation-ds/reports/cgen-allocation-ds/{proposal,front-end-oom-source-trace,front-end-oom-growth-units,h-on-demand-static-review}.md` |

## 10. Limits

- This is a source/evidence review, not an execution. No compiler, build, test, benchmark, or signal was run. Nothing here is a new measurement.
- The retained pair differs in application source tree; host load and GC state were not controlled. No causal ratio is claimed. The two-sample whole-process comparison is context, not a controlled experiment.
- Addendum 23 is one failed process on a different book; its pass ledger and stall analysis are re-read, not reproduced. Its 9-pass inference is explicitly `[I]` in the source report.
- Bounded fixture results are one host epoch, one to two fixtures, diagnostics-off except where noted, with host load 28–49. They do not transfer to Main scale without the gates in §8.
- Cache entry counts, `heapUsed`, `heapTotal`, `external`, and RSS are diagnostics counters, not retained-byte measurements. The `RSS − heapTotal` gap and the term/PMap/GC split remain unmeasured.
- No numerical performance score is assigned. `evaluate.py`'s accepted/score contract is for candidate artifact completeness, not for a performance claim; this continuation produces no candidate.json and makes no selection.

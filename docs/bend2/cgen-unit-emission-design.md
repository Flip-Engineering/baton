# Coordinator C generation: parallel unit emission over a checked-program store

- **Status:** design for implementation, 2026-10-28.
- **Basis:** Flip-Engineering/baton `main` at `7dc5bec95`, which includes PR #1186 (`74f58d53e`, fixes (a)-(d) from #1017). Line numbers refer to `bend2/compiler/upstream/comp.ts`, `bend.ts` and `main.ts` at `7dc5bec95` unless another commit is named.
- **Issues:** #1017 (the 2026-10-28 comment "Cause of the full coordinator cgen's memory and time"), #1089, #1110, #1027, #1032, #1176, #1026.
- **Audience:** the engineer implementing the change in `bend2/compiler/upstream` and in the compile queue.

The design combines elements of three approaches: per-module separate compilation ("separate"), bounded single-process incremental emission ("incremental") and parallel unit emission ("parallel").

| Element | Approach |
|---|---|
| Store written once by the front end; each unit's bodies decoded fresh; a coordinator that holds facts and no terms; borrowable-slot masks; rounds; worker processes | parallel |
| Facts-only units; fact replay; reference-stability check; per-module check workers; content-addressed template instance names | separate |
| Census; term summaries and explicit stacks; callee-first level order; removal of `USE_CAP` and `CONSTS_CAP`; content-hashed helper names merged at link; literal-column step | incremental |
| Costliest-unit rule; byte identity across worker counts; job memory from the cgroup; cache eviction by the queue's disk reserve | parallel, as grafts onto separate |

## 1. Problem and measurements

### 1.1 Input and host

`bend2/src/coordinator/main.bend` imports 116 modules plus Base. They hold 2.67 MB of `.bend` source and 6,799 `def`, `type` and `law` declarations, measured on `7dc5bec95` with the import-graph script the separate design used. The module graph has 17 levels. The largest module is `coordinator/turn.bend` (193 KB). `carb_book` reaches 5,021 definitions (#1017, 2026-10-27); on 2026-10-23 it reached 4,227.

The host is `acp-compute-cluster-001`: AMD EPYC 7551, 32 cores, 64 hardware threads, 4 NUMA nodes, 220 GB of RAM (#1089).

### 1.2 Measurements before PR #1186

| Run | Compiler | Definitions | Passes | Peak RSS | Other |
|---|---|---:|---|---|---|
| `488a4cf1`, 10-23 | Bun 1.3.14, `Malloc=1`, `pass-collect.patch` | 4,227 | 8, 802-1,320 s each | 137,480,528 kB (131.1 GiB) | 2:19:10 wall, 7,310 s user, 2,113 s system; load and check 231 s; C 122,673,108 bytes |
| `09830f2b`, 10-23 | Bun 1.4.4, `pass-collect.patch` | 4,227 | 8, 820-1,292 s each | 115,369,648 kB (110.0 GiB) | 2:40:18 wall, 7,093 s user, 3,137 s system; heapUsed at pass start 18.4 GB (pass 1) to 29.4 GB (passes 3-8); C byte-identical to `488a4cf1` |
| `f200026c`, 10-27 | #1099-#1149 compilers | 5,021 | cancelled in pass 3 | 113 GiB at the end of pass 1, 151 GiB at the end of pass 2 | |
| `feb11f5d`, 10-27 | release run | 5,021 | about 95 min each, in pass 3 of about 8 | VmHWM 158 GiB | |

Sources: #1017, #1089 and `bend2/toolchain/cgen-cache-port/README.md`. Over the eight passes on 10-23 the own set held 9,023, 10,952, 11,275, 11,366, 11,391, 11,396, 11,399 and 11,399 keys.

These are the causes #1017 measured:

1. Every pass ran `compile_def` for all reachable definitions. Passes 3-8 added 323, 91, 25, 5, 3 and 0 facts.
2. Six definitions took 89-90% of each pass, 493-649 s each: `legacy_cli_arity`, `legacy_cli_project`, `legacy_cli`, `cli_route`, `cli` and `main`.
   - The five callees have one call site each, so `emit_body` fused each into its caller. Each was also compiled on its own.
   - Every one of the six emitted the same 5,338-segment tree.
   - On 10-23 the final reach kept 28,965 of 61,797 emitted segments.
3. Each copy's per-definition caches lived about ten minutes and reached JSC's old generation: TELES held 952K entries, USES 2.1M, SPINES 226K and OPENS 85K. Each copy added 9-12 GiB of heapUsed, and RSS was 2.7 times the live set.
4. Literal matching was expensive in two ways:
   - Each literal character became a 32-level bit match, with the default continuation copied into every column.
   - `emit_arm_shared` walked each arm's subtree again at every nesting level.

   PR #1076 added two literal arms to `legacy_cli_arity`, and the pass time grew 4.9 times.
5. Everything ran on one thread.

Related defects:
- Bun 1.3.14's libpas retries `madvise` forever at `vm.max_map_count` (#1027). #1032 moves the release to Bun 1.4.x. The #1186 and #1110 measurements ran on Bun 1.4.4.
- #1110 replaced the strong sets in `ann_live` and `type_live` with WeakSets, after `v_live` ran out of memory.

### 1.3 What PR #1186 changed

PR #1186 was merged 2026-10-28 06:19 UTC and packaged as `compiler-emission-sol-20261028`. It changed `compile_book` (comp.ts:4298-4506) and the literal lowering:

- **Worklist (fix a).**
  - The roots are `main` and the bang definitions (4316).
  - A definition is compiled when a segment or spin of an emitted unit references its FID (4384-4419).
  - Each unit is compiled into its own File (4401). The File's `unit` prefix, `u<hex(name)>_`, names its segments (2452), spins (3072), arms (3943), tables (4018) and static words (`<unit>STAT_BASE`, 1621).
  - After each pass, units missing from the reach from the roots are deleted (4421-4427).
- **Fact reads (fix c).** A `Facts` subclass of `Set` (4323-4347) records every absent `has` for the unit being emitted, and marks that fact's readers dirty when the fact is added. A pass emits only new and dirty units. `facts_converge` runs after each pass (4429).
- **Literal rows (fix b).** `literal_list_rows` (bend.ts:3473-3560) lowers a top-level match on a `List<String>` parameter with literal heads. Each row becomes one helper definition, `k$litcase<i>`. Each head is compared with `String.eq`, and a row that fails calls the next row's helper.
- **Checker release (fix d).**
  - `v_live` and `v_drop` run once, before emission (4306-4307).
  - Template state is cleared (4308-4309).
  - `cli_report` reads `source_refs` (comp.ts:676-710, main.ts:507-542).

#1186 measured these results on focused inputs, on Bun 1.4.4:

| Input | Before | After |
|---|---|---|
| `emission_chain.bend` | 76.6 s, 2,512,932 kB | 0.81 s, 82,244 kB |
| Production `legacy_cli_arity` fixture | — | 1.048 s, 86,392 kB, three passes |
| Production literal parse and traversal check | 626.7 s | 0.27 s |

No full coordinator generation has run on this compiler; #1186 lists it as "pending operator scheduling".

### 1.4 Problems on main 7dc5bec95

#### 1. Poly keys are lost for definitions that have no unit (correctness)

How poly keys are made and used:
- `compile_def` emits a definition with no erased arguments (4114). Each erased binder therefore opens as `Var(x.k, x.i)` (3418).
- When a value of that type is shared, `facts_hot` adds the poly key `k~i` (2540-2543).
- Callers read `k~q` in `emit_args` (2943-2944) and heat the type they pass for `q`.

What goes wrong on main:
- A definition is compiled only when a segment references its FID. A flat definition reached only through spins never gets a unit, and neither does a definition fused into its one call site. Their poly keys are never produced.
- `emit_native` memoizes spins per unit, by the layouts of the erased arguments (3066). Every recursive datatype has layout BOX (`lay_cached`, 1282-1285).
- So two calls in one unit to a flat generic definition, with two different recursive types, share one spin. That spin is emitted with the first call's types. The second type would be heated only through the missing poly key.
- A shared node of the second type is then built without `rfc_seal` (`node_fill`, 2482). After `term_keep` wraps it in a count cell (5496-5505), it is read with `term_loc` (`node_fields`, 2504).

On `8b02f8fe0` every definition was compiled on its own in every pass, and that produced these keys.

A related case:
- Inside a fused body, `fl.def` names the callee (`emit_body`'s `apply`, 3389-3399). When a caller's own erased `Var` reaches `facts_hot` there, it is looked up in the callee's telescope.
- That adds either `*`, which makes the type of every binding hot, or a key of the callee when the binder name at that index matches.
- In the second case, the caller's own key `caller~i` depends on the callee's own emission producing the correct key.

#### 2. Output depends on emission history

- Infer and Check store types in `Var(-1)` cells inside checked terms (bend.ts:475, 479).
- `term_higher` returns these cells unchanged (bend.ts:727-729), so every elaboration of a body shares them.
- `term_wnf` writes a cell's weak head normal form into the cell (bend.ts:3707-3709).
- `arm_eq` forces both sides and compares annotation types structurally when the objects differ (3753, 3804). `emit_lits` compares interned keys of lowered terms (3653, 3666-3667).
- A spun or unfolded callee body is shared by every unit that reads it (`tld.h` at 3080 and 3242). A later unit therefore sees cells that an earlier unit normalized, and can make a different arm-sharing decision.

The C is correct either way. It depends on the order in which units ran, which prevents per-unit caching and byte-identical output across worker counts.

#### 3. The emission process holds the whole elaborated program

`def_body` installs `h` for every reachable definition during `carb_book` (1946-1967). The Lam, All and Let closures of `h` retain the checked term `e` (bend.ts:755-777). All of it stays in `cb.book` until `compile_book` returns.

#### 4. Facts are closed over stale data

- `facts_converge` (4429) runs after every pass, while units are still dirty. `assemble` (4359-4373) still supplies those units' earlier lend asks.
- Adding an own fact is sound, because its readers are re-emitted. The fixed point reached still depends on emission order.
- Two reads exist only to skip repeated work: the second `has(tk)` in `facts_hot` (2552) and `has(key)` in `facts_fam` (2578). They still record absent reads. A unit that heats a type for the first time therefore marks itself dirty and is emitted again.

#### 5. The C is built as one string

`compile_segs` joins every segment (4270-4280). `fills.reduce` builds the whole file from TEMPLATE (4496-4503). `cli_emit` writes the result (main.ts:294-309).

#### 6. Spins are emitted once per unit

`fl.spun` belongs to the unit's File (2360, 4401). A flat helper called from many units is emitted once per unit, and appears in the C once per unit. Nobody has measured the size of this duplication.

#### 7. Some literal columns still expand per character

`literal_chain` applies only to a top-level match on a definition's single parameter (bend.ts:3133-3151). Other literal columns go through `match_flatten` (bend.ts:2994). There each character becomes a constructor chain and a 32-level word match, and the default rows are copied at each test.

#### 8. Hardcoded caps

- `USE_CAP` (665, 1088) and `CONSTS_CAP` (734, 1010) in comp.ts.
- `MAX_ENTRIES = 32` and `MAX_BYTES = 256 MiB` in the whole-program C cache. It comes from `bend2/toolchain/bend-2.0.25-baton741/cache.patch` and ships as `bend2/cache.ts` in the packaged distribution.
- 100000-iteration loops in `arm_hint` and `arm_body_hint` (3717, 3888).

#### 9. One thread

The check (231 s on 10-23) and emission run in one Bun process. 63 of the host's 64 hardware threads are idle.

## 2. Design

### 2.1 Processes and data flow

```
bend main.bend -o main.c              coordinator (main.ts cli_file)
  1. front end, child process         parse, book_valid, carb_book (def_body for every reachable
                                      definition), v_live/v_drop, show_main, cli_report;
                                      writes the store; exits
  2. plan                             units, levels and masks from the store summary
  3. rounds                           units dispatched to emission workers level by level;
                                      facts merged at level barriers; facts_lend at the end of
                                      each stratum; stops when nothing changes
  4. checks                           reference stability; fact replay
  5. link                             numbering, tables, helper deduplication, request stubs;
                                      writes main.c from the spool files
emission worker (N processes)         decodes the store header once; per unit: decodes the
                                      unit's bodies, emits, appends the text to its spool file,
                                      returns a UnitRec, drops the bodies
```

Every input of a unit's C is either in the store or in the final fact set. A unit's text is a function of its store sections and of the answers to its fact reads. The C is therefore the same for every worker count, dispatch order and completion order.

Step 8 replaces the single front-end process with one check process per module.

### 2.2 Units

There are three kinds of unit.

- **Definition unit.**
  - It is one definition whose FID is referenced, or a root (`main` or a bang definition).
  - It contains the entry segment and everything created while emitting it: bodies fused into it (`emit_fuse` under the `once` rule, 3473-3484), spins (`emit_native`), shared arms (`emit_arm_shared`), closures (`emit_clo`), fork joins and continuations (`emit_fork`), tables and static words.
  - This is the unit #1186 introduced.
- **Facts-only unit.**
  - It is a generic definition that has no definition unit. A definition is generic when its telescope has an erased domain: `tele_unbind(book, T).doms.some(d => !live_dom(d))`.
  - It is emitted on its own, exactly as `compile_def` does, with no erased arguments.
  - Its reads, productions and lend asks count like any unit's. The link does not include its text, and its references do not add units.
  - It produces the poly keys `k~q` that callers read.
- **Request unit.** It is one foreign definition's request stub (`compile_reqs`, 4122-4148). It is emitted after the facts are final.

**Plan.** After `carb_book`, the definition units are the roots plus every live definition except two kinds:
- A predicted fused callee: it has one call site (`cb.sites`); that site is a tail call (`carb_book`'s `term_any` tail flag) and not a bang call; and the definition is neither foreign nor flat.
- A predicted spin-only definition: it is flat, and every site is a flat call.

FID references do not depend on facts. Fusion (`once`, `flat_call`), forks, closures, cut conversion (`lay_eq`, 3487) and arm creation all read only term structure, layouts and carb data. This keeps the plan's corrections deterministic:
- A referenced FID that has no unit gets one in the round in which the reference is found, so a wrong prediction is corrected the same way in every run.
- A planned definition that nothing references is emitted for its facts, and its text is not linked.
- Units are never deleted during emission.

**Levels.** Tarjan's algorithm over the `SRCS` deps gives the strongly connected components of the call graph. A unit's level is the length of the longest call path from its component to a leaf component. Callees have lower levels than their callers.

**Unit record.** The coordinator keeps one `UnitRec` per unit. A unit's new record replaces its previous one. It holds:
- `key`, `kind`, `level` and `definition`;
- `reads`: interned fact ids with the answer (absent or present), for each read answered from the snapshot;
- `wrote`: the fact ids the unit added, including ids that were already present;
- `lend`: asks `k~i` and edges `k~i<j~q`;
- `queried`: the definitions whose `brw_of` the unit read;
- `refs`: the FIDs and helper names its code references;
- segments: `fid`, `def`, `params`, `ks`, `ret`, `frame`, `fork`, `spin`, `cids` and `refs`;
- helpers: content name, declaration line, `cids` and `refs`;
- static words by SI name, tables by TAB name, and closure FIDs;
- the spool location (file, offset, length), line count, emission ms and process peak at unit end;
- the hashes of the store sections the unit decoded.

### 2.3 Unit emission

`compile_unit(store, key, snapshot)` wraps `compile_def` (4105-4120) in four steps:

1. It opens the unit scope: `memo_gc` (818-822), a new LITS map, an empty decoded-body map, and a File from `file_new` with the unit prefix and the unit's `FactView`.
2. It runs `compile_def` for definition and facts-only units, or `compile_reqs` for request units.
3. At unit end it names helpers by content, checks each fragment for `\bundefined\b` (the check at 4491), appends the text to the worker's spool file and returns the `UnitRec`.
4. It drops the decoded bodies, the File and the caches.

Changes inside the emitter:

- **`emit_native` (3065-3095).** The spin body starts with an empty `fresh` map, and the caller's map is restored afterwards. A spin's local names then depend only on the spin. The spin memo stays per unit, with the key at 3066.
- **Content names.**
  - At unit end each helper is renamed `spin_<h>` or `arm_<h>`. `h` is the first 64 bits of SHA-256 over the helper's text, after the names of the helpers it references have been replaced.
  - Helpers are processed in reference order. A reference to the helper's own name, such as `WL_AGAIN` inside a spin, hashes as a fixed placeholder.
  - Tables become `TAB_<h>` over the row text (`emit_tab`, 3617-3628).
  - The static path of `ctr_build` (1617-1622) emits `STAT_OFF + SI_<h>`, where `h` covers the node's words; nested static references are already SI names. The link assigns the offsets.
  - Segment names keep the unit prefix (`seg_name`, 2451-2453).
- **`term_sum(t)`.** This is a new per-unit memo, computed bottom-up over `term_kids` on an explicit stack. For each node it gives:
  - the free probes in first-use order (the list `capture_order` builds);
  - a jump flag: some node below satisfies `call_kind(node) !== null && !flat_call(node)`, the predicate at 3912-3915;
  - an interned shape id, built from `arm_eq`'s cases with variables made anonymous;
  - the innermost body span that `arm_hint` and `arm_body_hint` read.
- **Arm sharing.**
  - `emit_arm_shared` uses the jump flag and the probe list from `term_sum`.
  - Its bucket key becomes `hint|shape|base`. The added shape only removes pairs that `arm_eq` would reject, so reuse decisions do not change.
  - `arm_eq` returns at the first pair of nodes whose shapes differ, and runs on an explicit stack. `capture_order` also runs on an explicit stack.
  - `arm_hint` and `arm_body_hint` read the span from the summary, which removes their 100000-iteration loops.
- **Caches.**
  - `USE_CAP` and `CONSTS_CAP` are deleted. USES and CONSTS are cleared at every unit start, so each holds at most one unit's terms.
  - TELES memoizes only the telescopes of definition and constructor types. `ctr_tail` (1592-1596) passes a fresh `tele_fill` result on every call, and such an entry can never hit.
  - LITS (736) becomes the per-unit map.

### 2.4 Checked-program store

The front end writes the store after `book_valid`, `carb_book` (which runs `def_body` for every reachable definition), `v_live`/`v_drop`, `show_main` and `cli_report`, and then exits. `def_body` (1946-1967) writes a definition's section from `e` before it deletes `e`.

The store has these sections:

- **Strings and sources.** The paths and texts of the sources, and a span table with one entry per `Span` object. `term_higher`'s `ClosedCtrCache` is keyed by span identity (bend.ts:717), so this keeps its interning unchanged.
- **Header.** It holds:
  - `T` of every top-level definition;
  - every constructor's `T`;
  - the ADT declarations;
  - `v` of each definition in the type closure, the set `v_live` returns.

  These terms come from the parser and contain no checker cells. Pure type nodes are hash-consed.
- **One body section per reachable definition.**
  - It holds the checked term `e` (set by `def_check`, bend.ts:4621) and the raised `n`.
  - Inside a section, every `Var(-1)` and `Var(-2)` cell, `Lit` node, `Ann` node and span keeps its identity: objects shared in memory decode to one shared object.
  - A cell's content is a higher-order term. It is lowered with bound variables as de Bruijn indices and free checker variables as `FVar(k, i)`. `FVar(k, i)` decodes to a `Var(k, i)` object. This matters because `term_higher` maps a free `Var` to a `Ref` (bend.ts:732), and the Var case of `facts_hot` needs the `Var`.
- **Summary.** It holds:
  - the `SRCS` rows: refs in `carb_book`'s queue order, deps, and flatness;
  - `sites`, `bangs` and `LOCAL`;
  - the borrowable-slot mask of every live definition;
  - constructor arities;
  - the bang-parameter closure flag that `wide` needs (`ty_clo`, 4454-4455);
  - the show descriptor;
  - the canonical unit order.
- **Identity.** A content hash per section, the compiler identity and the input-manifest hash. A worker refuses a store written by a different compiler.

The borrowable-slot mask is the part of `brw_of` (1694-1700) that does not depend on facts:
- `mask(k)[i]` is true when `done_live(k)` holds, `lays[i].ks` includes `box`, and the domain's datatype is not `Array`.
- `brw_of(k)[i]` is then `mask(k)[i] && !own.has(k~i)`.

**Decoder.**
- Entries of `book.tlds` become stubs. `T`, constructors, ADTs and `v` decode on first access and stay for the life of the process.
- `h` decodes on first access within a unit, through a getter backed by the unit's decoded-body map, and is dropped at unit end. Every unit therefore starts from cells that no other unit has normalized.
- A unit decodes its own definition and every body it fuses (`emit_fuse`, 3026 and 3031), spins (`emit_native`, 3080) or unfolds (`emit_unfold`, 3235-3242).

The store lives in the compile queue's state directory, counts against the queue's disk admission, and is deleted when the job ends.

### 2.5 Facts and the solver

`FactView` replaces the `Facts` subclass (4323-4347) for `own`, `hot` and `stat`. For one unit it holds the snapshot `S` and the unit's delta:

- `has(k)` returns `S.has(k) || delta.has(k)`. An answer that comes from `S` is recorded in `reads` with its value. An answer that comes from `delta` is the unit's own fact and is not recorded.
- `add(k)` records `k` in `wrote`. It adds `k` to `delta` when `S` lacks it.
- The skip checks in `facts_hot` (2552) and `facts_fam` (2578) use a per-unit set of keys this unit has already processed. These checks record no reads, and their keys still enter `wrote`.
- The coordinator interns fact keys to integers. A worker receives the new ids with each snapshot delta.

The coordinator holds:
- `F`, with `own`, `hot` and `stat` as id sets;
- the `UnitRec` table;
- the masks;
- an index from each fact id to the units that read it as absent.

**Rounds.** Emission is a sequence of rounds:

1. A round visits levels from 0 upward. At level `L` it emits every new or dirty unit of level `L` against the snapshot `S(r, L)`. Units of one level run in parallel.
2. Suppose level `L` references a definition that has no unit yet. If that definition's level is at most `L`, its unit is emitted before level `L`'s barrier, against `S(r, L)`. Otherwise it is emitted at its own level, in the same round.
3. At the barrier, the units' `wrote` sets are merged into `F` by set union. A unit that read a new key as absent becomes dirty. If its level is above `L` it runs in this round; otherwise it runs in the next round.
4. The costliest dirty unit can wait. "Costliest" means the most lines in its previous emission. When a round reaches that unit's level and a unit at a lower level is already dirty for the next round, the costliest unit waits for the next round. Line counts are deterministic, so this rule does not depend on timing.
5. A stratum ends with a round that leaves no unit dirty. `facts_lend` then runs over the union of all units' lend asks and edges, and over the mask of every queried definition:
   - lend is closed over the edges, as in the loop at 2596-2602;
   - `own` gains `k~i` for each queried `k` and each `i` such that `mask(k)[i]` holds, `k~i` is not in `own`, and `k~i` is not in the lend closure.

   New own keys make their readers dirty, and the next stratum starts.
6. Emission stops when a stratum ends and `facts_lend` adds no key.

This replaces `facts_converge` (2618-2633) and the pass loop (4374-4446). The coordinator needs no terms for it: `brw_of` is `mask && !own`, and `facts_lend` is set logic.

**Checks when emission stops.**

- **Reference stability.** A unit's `refs` must equal the `refs` of its previous emission. A difference stops the build and names the unit.
- **Replay.**
  1. Start from `L = ∅`.
  2. Add `wrote(u)` for every unit `u` whose present reads are all in `L`.
  3. Apply `facts_lend` with the final lend data.
  4. Repeat steps 2 and 3 until nothing changes.
  5. Require `L = F`.

  A key that is in `F` but not in `L` has no derivation in the final traces. Two things leave such a key: an emission that a later emission of the same unit superseded, and a producer that adds less when it reads more. A cold build stops and lists the keys. A warm build restarts emission from `L`.

### 2.6 Workers and admission

- **Coordinator.** The coordinator is the `bend main.bend -o main.c` process. It starts the front end as a child process. The child exits after writing the store, which returns its pages to the host before emission starts.
- **Workers.**
  - Emission workers are Bun processes started from the distribution's `bin/bun`, with the worker module `emit-worker.ts` and the store path.
  - A worker decodes the header once, then takes units one at a time.
  - The coordinator sends `{unit key, round, level, fact ids added since the worker's previous unit}`. The worker returns the `UnitRec` and writes the text to its spool file.
  - A unit whose worker exits is dispatched again.
- **Admission.**
  - A unit is dispatched, or a worker started, only while `MemAvailable` covers the unit's expected peak.
  - The expected peak is the peak recorded for that unit in the unit cache. Without one, it is the largest peak among this build's completed units. With neither, units without a history run one at a time, which is the #1026 rule.
  - Workers never outnumber the hardware threads. There is no configured worker count.
- **Dispatch order.** Within a level, units are dispatched largest previous line count first. This affects only load balance.
- **Queue.**
  - The compile queue runs the job as one cgen ticket; #1176 separates C compilation.
  - The queue admits the job by its front-end peak.
  - It records the job's memory as the sum over its processes, using the cgroup's `memory.peak` when the job has its own cgroup.

### 2.7 Streaming link

`compile_book` takes the output path, and `cli_emit` (main.ts:294-309) passes it. The link works from the unit records:

1. It computes the live reach from `FID_MAIN`, the bang FIDs and the closure FIDs, and the device reach from the bang FIDs plus the closures when `wide` holds (4449-4456).
2. It numbers FIDs and CIDs in canonical order: units in the store's canonical order, and segments within a unit by local index. The CID set comes from segment and helper `cids`, the show cells and `RUNTIME_ADTS`, as in `compile_tables` (4180-4268).
3. It builds the tables:
   - `FID_FLAG_T` with the forky closure, `FID_RESW_T`, `CID_ARITY_T`, and `CID_HOT_T` and `BLK_SHR` from the final facts;
   - `STAT_IMG`, with one `#define SI_<h> <offset>` per static node;
   - the TAB arrays and the bank macros.
4. It keeps one definition per helper content name. Two texts with the same name are compared byte for byte, and a difference stops the build.
5. It emits the request units from the final facts.
6. It splits TEMPLATE (4777) at its four marks once. It writes each section by copying fragments from the spool files, and wraps host segments in `#if !DEVICE`.

The link holds metadata and one fragment at a time.

### 2.8 Unit cache

- **Key.** The compiler identity (hashes of comp.ts, bend.ts, the worker and link modules, and the Bun version) and the unit key.
- **Entry.**
  - The hashes of the store sections the unit decoded.
  - Its reads with their answers, `wrote`, `lend`, `queried`, `refs` and metadata. Fact keys are stored as strings.
  - A content-addressed fragment.
- **Use.**
  - When the coordinator would dispatch a unit against snapshot `S`, an entry applies if three conditions hold: its section hashes match the new store, all its present reads are in `S`, and none of its absent reads are in `S`.
  - A warm build runs the same rounds as a cold build, with cache hits taking the place of emissions. Its C therefore equals the cold C.
- **Retention.**
  - Least-recently-used entries are deleted when the queue's disk reserve needs space.
  - The whole-program C cache in the distribution stays as the first check. Its `MAX_ENTRIES` and `MAX_BYTES` are replaced by the same eviction.

### 2.9 Per-module front end (step 8)

- **Parse.**
  - One process runs `book_load` in load order, because the parser resolves imported names.
  - It writes one parse record per module: the parser output before `term_higher`, spans as offsets into the module source, the load-order index and a name index.
  - Records are addressed by the source hash and the hashes of the imported modules' records.
- **Check.** One process per module, admitted like an emission worker.
  - Its LazyBook exposes `book.tlds` and `book.ctrs` restricted to the load-order prefix before the module. Records load on first use, and each read is recorded with its hash.
  - The worker runs `book_valid(book, done)` with `done` at the module's first order entry; this is the existing path at bend.ts:4599-4602.
  - It elaborates the module's definitions with `def_body` and writes their store sections.
  - It returns per-definition summaries: refs in carb queue order, deps, local flatness, bangs, call sites with tail and bang flags, raised `n`, masks, and `ty_clo` of bang parameters.
- **Template instances.** `def_inst` (bend.ts:4471-4504) names an instance `k~<count>`, numbered in mint order (4501). The name becomes `k~<h>`, with `h` over the instance key, so workers that mint the same instance agree on its name. Each worker mints the instances its module needs.
- **Thin link.**
  - It replays `carb_book`'s queue over the summaries to get the `SRCS` order.
  - It computes `sites`, flatness (bottom-up over deps) and `bangs`.
  - It computes the verdict: failed modules, holes and TODOs, laws declared in one module and filled in a later one, and the unsafe report from `source_refs`.
- **Module cache.** A module whose parse record and recorded reads all match its previous run skips its check and reuses its store sections.

### 2.10 Literal columns (step 9, conditional)

Step 9 adds a string-literal column form to `match_flatten` (bend.ts:2994), for the literal columns `literal_chain` does not cover. It takes one of two forms:
- a `Swt` term, with a checker rule modeled on check-mat. It scans the string once against a literal table, emits one C switch, and emits each arm and the default once;
- one shared default continuation per match.

Step 9 lands only if the census (step 0) attributes more of the front end's heap or check time to literal-column expansion than to any other single cause. The laws-check on the whole law corpus gates it.

### 2.11 Limits

- The design adds no limits, timers or flags.
- It deletes `USE_CAP`, `CONSTS_CAP`, the 100000-iteration loops in `arm_hint` and `arm_body_hint`, and the C cache's `MAX_ENTRIES` and `MAX_BYTES`.
- The worker count and admission come from `MemAvailable`, measured peaks and the hardware thread count.
- These stay:
  - `FOLD_FUEL` (226) and `SPIN_FAR` (231). They choose between equivalent forms of the emitted code.
  - The checker's 64-level template bound and its 32768-character key bound (bend.ts:4492-4500). They are checking rules of the language.
  - `check_id_limit`'s 2^20 bound (4206-4207). It is the width of the id field.

## 3. Memory bound

Per process, from step 6:

| Process | Holds | Bounded by |
|---|---|---|
| Coordinator | `F`, `UnitRec`s, masks, reader index, link metadata | The fact key universe (definition slots `k~i`, constructor names, `t:` and `m:` keys, poly keys and `*`) and the number of units and segments. It holds no terms. |
| Emission worker | `H + U + G` | `H` is the decoded header and the memos that depend only on it (SIGS, FLATS, NODES, LAYS, LAY_KEY_NODES, CYCLES); it is bounded by the program's types and signatures. `U` is one unit's decoded bodies, caches and File; it is bounded by that unit's elaborated terms. `G` is garbage since the last collection. |
| Link | Unit metadata and one fragment | The number of units and segments. |
| Front end, steps 3-7 | The parsed and checked program, and one definition's encoder state | The program. |
| Check worker, step 8 | Its module's checked definitions and the prefix records it read | The module and the part of its imports it reads. |

In steps 3-5 the front end and emission share one process. The checked bodies become unreachable once the store is written, because the `book.tlds` entries are replaced by stubs. From then on, emission holds `H` and one unit's `U`.

Nothing grows without bound, for five reasons:

1. No structure is indexed by pass or round. A re-emitted unit's record replaces the old one. Its new fragment replaces the old one in the spool, and the old fragment is deleted.
2. `F` only grows, and it stays inside a key universe that the program fixes.
3. A unit's decoded bodies, caches and File are dropped at unit end, and the next unit decodes its own. Nothing from one unit's terms reaches the next, so a long-lived worker accumulates no state. `collect_full` (60-67) runs in a worker whose queue is empty at a level barrier.
4. The number of processes is bounded by `MemAvailable` at admission and by the hardware thread count. The host total is `max(front end, coordinator + admitted workers + link)`.
5. Disk use is the store, which is deleted at job end; the spool, which holds one live fragment per unit; and the unit cache, which is evicted by the queue's disk reserve.

These figures are projections. Each step's measurement replaces them.
- **Coordinator: under 1 GiB.** On 10-23 the final own set had 11,399 keys, hot and stat added a few thousand, and the final reach kept 28,965 segments.
- **Emission worker.**
  - `H` is estimated at 0.5-2 GiB; step 3 measures it.
  - `U` is the working set of the largest unit; the step 0 census measures it.
  - After #1186 the CLI chain is one small unit: the whole production `legacy_cli_arity` fixture compiles in 86,392 kB.
- **Front end before step 8: the checked program.** On 10-23, heapUsed after the check (the collection at the start of pass 1) was 18.4 GB on Bun 1.4.4. The front end holds about that much plus the elaborated bodies until it exits. The existing `book.valid.end` diagnostic event already reports process memory, so the census measures the current peak.
- **Check worker after step 8.** The 10-23 ratio is about 7 KB of heap per byte of source (18.4 GB against 2.67 MB). At that ratio `turn.bend` (193 KB) needs about 1.3 GB and a median module (23 KB) about 0.2 GB, plus the imported records each one reads.

The #1017 target of at most 20 GiB per process holds as follows:
- for the coordinator, the workers and the link, from step 6;
- for the front end, from step 8, or from step 3 if the census shows that the whole checked program fits.

## 4. Expected time, cold and warm

These figures are projections from the 10-23 and 10-27 measurements. The step measurements replace them.

**Current main (#1186), one thread.** The coordinator has not been measured. #1017 estimated about 35-40 minutes after fixes (a)-(c). The census in step 0 gives the actual figure.

**Cold, after step 7 (one front-end process).**
- *Front end: 4-7 minutes expected.* Load and check took 231 s on 10-23, with 4,227 definitions; there are now 5,021. Elaborating every definition and writing the store add one pass over the program, which step 3 measures.
- *Emission: 1-3 minutes expected for all rounds.*
  - Round 0 emits each unit once. On 10-27, about 10% of a 95-minute pass was spent outside the six CLI copies, and that 10% included standalone copies of fused and spun definitions. On 10-23, 61,797 segments were emitted and 28,965 kept. Round 0 is therefore about 5-10 minutes of CPU time.
  - Later rounds emit only dirty units. On 10-23, passes 3-8 added 323, 91, 25, 5, 3 and 0 facts.
  - With 16-32 admitted workers, a round costs its CPU time divided by the worker count, plus the slowest unit and one barrier at each level.
- *Link: under a minute,* to stream about 120 MB of C.
- *Total: about 6-11 minutes,* most of it the serial front end.

**Cold, after step 8.** The check runs per module, in parallel. Its wall time is the parse plus the slowest module's check; `turn.bend` holds 7% of the source. The total is expected at 3-6 minutes.

**Warm, one definition edited.**
- *After step 7: 5-9 minutes expected.* The front end runs in full (4-7 minutes). Units whose cache entries apply are copied. The edited units, and the units whose reads change, are emitted.
- *After step 8: 1-2 minutes expected.* The edited module, and the modules whose recorded reads include its records, are parsed and checked. The rest reuse their store sections.
- *Identical inputs: seconds.* The whole-program C cache returns the file; #776 measured 1.949 s.

The reduction has five sources:
- The work per build is the number of units times their re-emissions, spread over the cores.
- Each unit's emission is linear in the size of its terms (step 2).
- Fused chains are emitted once (#1186).
- Per-unit caches end with their unit, before old-generation promotion (#1017 cause 3).
- From step 8 the check is parallel too.

## 5. Correctness and laws

### 5.1 Unchanged code

Each unit is emitted by the existing emitter: `emit_body`, `emit_match`, `emit_args`, `val_own`, `facts_hot`, `emit_arm_shared` with `arm_eq`, and the literal emitters. Steps 0-7 change scheduling, naming, how bodies are loaded, fact bookkeeping and output assembly. bend.ts changes in two steps only: step 8 (`def_inst` names and the check driver) and step 9 (literal columns).

### 5.2 Fact soundness

When emission stops, no unit is dirty and `facts_lend` adds nothing. For each unit's last emission:
- every absent read is still absent in `F`;
- every present read is still present, because `F` only grows.

Each unit's text is therefore what the emitter produces against `F`.

An own fact changes only ownership code. The definer reads it (`emit_open`, 3058-3059), and so does every caller (`emit_args`, 2942). Both are re-emitted when it is added, so adding one is sound.

### 5.3 Hot completeness

A constructor whose values are shared must be hot, for three reasons:
- `term_keep` wraps a shared node in a count cell (5496-5505);
- `node_fields` reads a node of a constructor that is not hot with `term_loc` (2504-2505);
- `ctr_take` passes a shared node's fields to `span_fade`, which posts `ERR_RFCS` for a field that is neither sealed nor trivial (5625-5657).

Concrete types are heated where the sharing is emitted. Types passed for erased parameters are heated through poly keys. Every generic definition produces its poly keys, either in its own unit or in its facts-only unit (step 1).

### 5.4 Determinism

A unit's text and record depend only on its store sections and the answers to its reads:
- decoded bodies are fresh;
- names are unit-local or content-addressed;
- a spin's local names restart at the spin.

Units of one level read one snapshot and merge by set union. The link orders units canonically. Steps 4-6 test byte-identical C across unit orders, worker counts and completion orders.

### 5.5 Least fixed point

The replay derives every fact of `F` from the final traces, or the build stops. This catches facts left by superseded emissions, and producers that add less when they read more.

### 5.6 Store fidelity

For every definition, two checks must hold:
- the unit emitted from the store equals the unit emitted from the in-memory book in a fresh process;
- `term_lower` of each decoded body equals `term_lower` of the original, spans included.

### 5.7 Laws and the checker

Steps 0-7 change none of parsing, `book_valid`, `def_check` or the checked terms. The verdict (`All terms check.`, the TODO count and the unsafe report) comes from the same code as before. Emission still stops on a live call into a law (3333-3335).

Step 8 changes how the check is driven and how template instances are named. It must print the same verdict text as the whole-program check, on the coordinator and on fixtures that have:
- a failing module;
- a hole;
- a law declared in one module and filled in a later one;
- an unsafe dependency.

The laws-check must also pass on the law corpus.

Step 9 changes the flattener. It requires the laws-check on the law corpus, the differential runtime tests listed in its proof, and an entry in the fork record (#774).

### 5.8 Runtime behavior

Every step that can change the C (steps 1, 3, 4, 5, 8 and 9) must pass two checks:
- the native workflow's candidate/target comparison (`bend2-native.yml`) on the coordinator;
- the compiler tests: `bend2/test/compiler/*.ts`, `compiler-emission.py` and `compiler-arm-sharing.py`.

## 6. Implementation steps in landing order

**Common rules for every step.**
- Every measurement runs through the shared compile queue on the homelab, with `BEND_COMPILER_DIAGNOSTICS=1` and `/usr/bin/time -v`. None runs on the Mac.
- The inputs are:
  - the compiler fixtures, including `legacy_cli_arity_production` and `emission_chain.bend`;
  - `receive-focused.bend` and `logs-clean-all-focused.bend`;
  - `bend2/src/coordinator/main.bend` at a pinned commit.
- Each run records, following #1089's acceptance rule:
  - wall, user and system time;
  - VmHWM and the queue's `peak_kb`;
  - units emitted per pass or round, and the 20 slowest units;
  - the own, hot and stat sizes;
  - the C's size and SHA-256.
- Each new test is red on `7dc5bec95` before its step lands. The failure reasons below come from reading the code at `7dc5bec95`; running each test there through the queue confirms them.
- New compiler modules are added to `bend2/compiler/repl-upstream.lock.json` and its provenance file, and are packaged by `.github/scripts/package-compiler.py`.

### Step 0. Census on main

**Change.** Diagnostics only; the C does not change. Add these events:
- `heap.census`, at `checker.release` and at each `pass.end`: the heap size and object counts by type from `bun:jsc`'s `heapStats()`. Add one heap snapshot at `checker.release` on `receive-focused.bend`, to attribute retained size to `e`, `h`, `v`, `T`, LITS entries, caches and fact sets.
- `fact.write`: the first `add` of each own, hot or stat key, with the writing unit.
- `spin.emit`: the callee, the layout key, the erased-argument key (`term_lower` of the erased arguments with spans stripped), the unit, ms and lines.
- On `definition.end`: counts of absent reads, writes and lend asks.
- `literal.columns`: per definition, the word-match leaves `emit_lits` builds and the nodes under literal constructor chains.

**Proof.**
- Run one full coordinator `main.bend -o` on `7dc5bec95` with this step. Record wall, user and system time; VmHWM; front-end heap at `book.valid.end`; passes; units per pass; the 20 slowest units; own, hot and stat; and C bytes.
- The C's SHA-256 must equal that of a run with diagnostics off.
- Derive these figures:
  - the time spent emitting spins that another unit also emits;
  - the literal-column share of front-end heap and of check time;
  - the generic definitions without a unit;
  - on the focused entries, the poly keys that `8b02f8fe0` produces and main does not.

**Test that fails on main.** `bend2/test/compiler/census_diagnostics.ts`. It compiles `emission_chain.bend` and `ref_bang_marked.bend` with diagnostics on, and requires `heap.census`, `fact.write` and `spin.emit` events with their fields. It also requires byte-identical C with diagnostics off. Main emits none of these events.

### Step 1. Poly keys from facts-only units

This step fixes the correctness gap in §1.4 problem 1.

**Change.** In comp.ts `compile_book`:
- After each pass's queue, every live, non-foreign generic definition that has no unit gets a facts-only unit. It is compiled by `compile_def` into its own File with the unit prefix.
- Facts-only units are kept in their own map:
  - their reads are recorded and their `wrote` sets are kept;
  - `assemble` merges their lend asks and does not assemble their segments or spins;
  - they are re-emitted when dirty, and are exempt from the deletion at 4421-4427.
- The loop condition at 4446 also waits for missing or dirty facts-only units.
- A facts-only unit whose FID becomes referenced turns into a definition unit.

**Proof.**
- On the fixtures and focused entries, the final hot set contains every poly key `k~q` that `8b02f8fe0` produces on the same source.
- Record the count and ms of facts-only units on the coordinator, and the own, hot and stat sizes.
- The candidate/target comparison passes.

**Test that fails on main.** `bend2/test/compiler/poly_spin_hot.ts`, with `fixtures/poly_spin_hot.bend`.
- The fixture has a pure `main`. It declares a flat definition that is generic in an erased type and uses its argument twice.
- One definition calls it twice: once with a `List<U32>` and once with a value of a declared recursive `Tree`. Each argument is passed as a variable, so `emit_unfold` does not fold the call.
- The test requires:
  - `CID_HOT_T` marks `Tree`'s constructors;
  - the final hot set contains the generic definition's poly key and does not contain `*` (the set is exported from a patched copy of comp.ts, as `iterative_term_walks.ts` does);
  - the built binary prints the expected output.
- Why it fails on main: both calls share one spin keyed by layout BOX (3066), and that spin is emitted with `List<U32>`. The generic definition has no unit, so its poly key never appears and `Tree` is never heated.
- The same reading predicts a pass on `8b02f8fe0`, which compiled the generic definition on its own in every pass.

### Step 2. Linear arm sharing and per-unit caches

**Change.**
- Add `term_sum` and use it in `emit_arm_shared`, `arm_eq`, `capture_order`, `arm_hint` and `arm_body_hint`, as §2.3 describes.
- Delete `USE_CAP` and `CONSTS_CAP`.
- Restrict TELES to definition and constructor types.
- Make LITS per unit.

**Proof.**
- The C's SHA-256 equals step 1's on all inputs.
- Record:
  - the ms of the 20 slowest units;
  - the nodes visited by `emit_arm_shared`'s walks in each unit, against that unit's node count;
  - the heap at unit end;
  - the TELES and USES sizes at unit end.

**Tests that fail on main.**
- `bend2/test/compiler/arm_walks_linear.ts`.
  - A patched copy of comp.ts counts the nodes visited by `emit_arm_shared`'s `term_any` walk (3912) and by `capture_order`.
  - Two generated fixtures have `n` and `2n` nested matches, each with a default arm. Their counts must be in a ratio of at most 2.5.
  - On main every nesting level walks its whole default subtree again, and the ratio is about 4.
- `bend2/test/compiler/iterative_arm_walks.ts`, modeled on `iterative_term_walks.ts`.
  - `arm_eq` and `capture_order` must return on synthetic terms nested deeper than the default JS stack.
  - On main both recurse once per node and throw `RangeError`.

### Step 3. Store and fresh bodies per unit, in one process

**Change.**
- Add `store.ts`: the encoder, the decoder, section hashes, the summary and the masks.
- `def_body` writes each definition's section.
- After the front-end work, `compile_book` writes the store, replaces the `book.tlds` entries with stubs, and emits every unit from the store through the decoded-body map.
- Scheduling stays as it is after step 1.

**Proof.**
- Per-definition fidelity holds on every fixture definition. On the coordinator it holds through one process per module, each of which emits its module's definitions from both sources.
- The `term_lower` round trip holds, spans included.
- Record:
  - the store size by section and its write time;
  - the decode ms per unit;
  - the emission heap at unit end, which must stay flat across passes.
- Compare the C with step 2's. Trace each difference to an arm-sharing decision that depended on cell state.

**Test that fails on main.** `bend2/test/compiler/store_release.ts`.
- It holds a `WeakRef` to every definition's elaborated body `h`.
- At the first `unit.begin`, after a forced collection, every `deref()` must return `undefined`.
- On main, `cb.book.tlds` keeps every `h` until `compile_book` returns.

### Step 4. Content names and canonical link order

**Change.**
- Restart local names in each spin.
- Give spins, arms, tables and static nodes content names.
- At link, deduplicate by content name, with byte comparison.
- Order units and segments canonically.
- Add the reference-stability check.

**Proof.**
- With the facts seeded from a previous run's final set, so that no unit adds a fact, three unit orders give the same SHA-256 on all inputs.
- Record:
  - helper and static-node counts before and after deduplication;
  - C bytes and `STAT_LEN`, against step 3;
  - clang time, against step 3.
- The candidate/target comparison passes.

**Test that fails on main.** `bend2/test/compiler/emission_order_independence.ts`.
- A patched copy of comp.ts seeds own, hot and stat with a fixture's final facts.
- The test compiles with the queue in worklist order, reversed, and in a seeded shuffle. The three C files must be identical.
- On main `assemble` concatenates units in first-emission order (4364-4372), so segment order, FID numbers and the `STAT_BASE` values change with the order.

### Step 5. Fact solver with level rounds and replay, in one process

**Change.**
- Add `FactView`, `UnitRec`, the plan, levels and discovery.
- Run emission in rounds, with the line-count rule, stratified `facts_lend` and the replay.
- Emit `pass.end` once per round, with its current fields. Add `stratum.end`, `facts.lend` and `replay.end` events.

**Proof.**
- On all inputs, the replay's `L` equals `F`.
- Compare the final own, hot and stat sets with step 4's. List each differing key with its writer, from the step 0 log.
- Record rounds, units per round and total emission ms, against step 4.
- Explain the C difference against step 4 by the listed facts.
- The candidate/target comparison passes.
- The C is identical for three dispatch orders within levels. This time the facts are not seeded.

**Test that fails on main.** `bend2/test/compiler/fact_strata.ts`.
- The fixture has a callee, emitted after its caller, that heats a type the caller matches; main's worklist emits callers first.
- Every `facts.lend` event must report no dirty unit, and the replay must reproduce `F`.
- On main, `facts_converge` (4429) runs at the end of the pass while that caller is dirty.
- A second case adds a fact that no unit writes, and requires the replay to stop the build. Main accepts the fact.

### Step 6. Worker processes and streaming link

**Change.**
- Run the front end as a child process.
- Add `emit-worker.ts`, the IPC protocol, spool files and admission.
- Add `compile_book(book, out)` and the streaming link; `cli_emit` passes the path.
- The queue records the job's total memory.

**Proof.**
- The SHA-256 is identical for 1, 2, 8, 32 and 64 workers, and for seeded random dispatch and completion orders.
- Record:
  - wall time against worker count;
  - per-process VmHWM, which must stay flat across rounds;
  - the coordinator and link peaks;
  - `MemAvailable` sampled during the run, against the admitted total.

**Tests that fail on main.**
- `bend2/test/compiler/streaming_link.ts`.
  - The fixture is generated with enough definitions that segment text dominates the output.
  - With diagnostics on, every `join.end` and `template.end` event must report fewer code units than half the output file.
  - On main, `segments.all` (4272) and `template.end` (4501) report the whole C.
- `bend2/test/compiler-parallel.py`. It requires identical C across worker counts and seeded dispatch orders. Main runs in one process.

### Step 7. Unit cache

**Change.**
- Add the cache described in §2.8, with eviction by the disk reserve.
- Replace the whole-program cache's caps with the same eviction.

**Proof.**
- A rebuild with no change hits every unit and gives the same SHA-256.
- After one definition is edited, the warm C equals a cold build of the edited source.
- Record the units emitted, the hit rate and the wall time.
- Record the cache's disk use over ten consecutive `main` commits that touch `bend2/src`.

**Test that fails on main.** `bend2/test/compiler/unit_cache_warm.ts`.
- It compiles a fixture, edits one leaf definition's body, and compiles again with the same cache.
- The `definition.end` events may name only the edited unit and units whose recorded reads changed.
- The C must equal a cold compile of the edited source.
- Main emits every needed unit on every compile.

### Step 8. Per-module front end

**Change.** Add the parts described in §2.9:
- parse records and LazyBook;
- per-module check processes and their summaries;
- the thin link;
- content-addressed template instance names;
- the module cache.

**Proof.**
- The verdict text is identical to the whole-program check, on the coordinator and on fixtures that have:
  - a failing module;
  - a hole;
  - a law declared in one module and filled in a later one;
  - an unsafe dependency.
- The store sections are byte-identical to step 7's, except instance names.
- The laws-check passes on the law corpus.
- Record:
  - check ms and VmHWM per module;
  - check wall time, against the single front end;
  - warm build time after a one-module edit.

**Test that fails on main.** `bend2/test/compiler/module_check_reuse.ts`.
- It checks a multi-module fixture, edits one leaf module's body, and checks again.
- Only modules whose recorded reads include the edited module's records may be checked; the `module.check` events show this. The verdict text must be identical.
- On main, `book_valid` checks every entry of the book on every run.

### Step 9. Literal columns, if the census shows the need

**Change.** The flattener change described in §2.10.

**Proof.**
- Record flattened node counts on the fixtures in `string_pattern_literal_sharing.ts` and in the literal-prefix tests.
- Run a differential runtime test on every string-literal fixture.
  - Build each fixture in C and in JS with both the step 8 and the step 9 compilers.
  - Run each build on each literal, every proper prefix, one-character extensions, the empty string, a non-BMP character and a non-matching string.
- The laws-check passes.
- The candidate/target comparison passes.
- Record the front-end heap and check time on the coordinator.

**Test that fails on main.** `bend2/test/compiler/literal_column_linear.ts`.
- The fixture is a two-parameter definition whose match on its `String` parameter has rows for an 11-character literal and a 22-character literal, and a default.
- The checked term's node count must be at most the row bodies' node counts plus a constant per literal character.
- The definition is outside `literal_chain`, which requires one parameter (bend.ts:3138). On main each character therefore expands into constructor tests that copy the default rows.

### Step 10. Host C in several translation units (optional)

**Condition.** This step lands only if clang's wall time after step 6 is longer than the emission phase's wall time.

**Change.**
- For the host lane, the link writes one `.c` file per group of levels, with a shared header for the tables and helper declarations, so clang compiles the files in parallel (#1089 item 6).
- The device lane keeps one translation unit with the single switch.

**Proof.**
- Record clang's wall time.
- The candidate/target comparison on the binary passes.

**Test.** None new. The native comparison covers the change.

## 7. Relation to the incremental fixes (a)-(d)

The four fixes landed together in #1186 (`74f58d53e`) and are on `main`. This design keeps all four and extends each:

- **(a) Referenced worklist.** It stays as the rule that creates definition units.
  - Step 1 adds facts-only units. Before #1186 landed, the separate design reported that a worklist as worded in #1017 drops the standalone emissions that produce poly keys. §1.4 problem 1 shows that case on main.
  - Step 5 replaces the dynamic discovery order with the planned unit set and level order. It also removes the deletion of unreached units (4421-4427), which both judges rejected.
- **(b) Literal rows.** This fix stays. `literal_list_rows` covers the coordinator's CLI dispatch. Step 9 covers the literal columns it leaves, if the census shows that they matter.
- **(c) Incremental fixed point.** #1186 records absent reads and re-emits dirty units in the next pass.
  - The judges required per-unit names to land before partial re-emission. #1186 landed both in one commit, so that requirement is met.
  - Step 5 replaces the mechanism with four parts: reads recorded with their answers, snapshots per level, stratified `facts_lend`, and the replay.
  - Step 5 also stops the `facts_hot` and `facts_fam` skip checks from recording reads.
- **(d) Checker release.** This fix stays. Step 3 moves the whole checked program out of the emission phase, and step 6 moves it out of the emission processes.

#1186 leaves these items open, and this design schedules each:
- the full coordinator measurement, in step 0;
- the acceptance of 20 GiB per process and ten minutes, in steps 6 and 8;
- per-module processes and the module content cache, in steps 6 to 8.

## 8. Risks

1. **Store fidelity.** Cells carry free checker variables. Cells, `Lit` nodes and spans must keep their identity within a section. Step 3's per-definition tests gate this.
2. **Cost of facts-only units.**
   - A generic definition whose standalone emission fuses a large chain emits that chain again. The census counts and times these emissions.
   - If they turn out expensive, the alternative has two parts:
     - tag each erased-binder `Var` with its owning definition when `emit_body` creates it (3418), so that `facts_hot` adds `owner~i` in any context;
     - key spins within a unit by the erased arguments' terms.

     Together these produce the keys in the copies, with no extra emission.
3. **Producers that are not monotone.** If an emission path adds less when it reads more, the replay stops the build. The fix then belongs in that path.
4. **References that depend on facts.** The design assumes there are none. The reference-stability check stops the build if one appears.
5. **Rounds and barriers.** A deep call graph has many levels. A level with one slow unit leaves the other workers idle. Steps 5 and 6 measure rounds, units per level and worker idle time.
6. **Duplicate spins.**
   - Spins stay per unit. Link deduplication removes duplicate text, but the emission time remains.
   - If the census shows that time exceeds round 0's critical path, spins become units of their own. Such units are keyed by callee and by the hash of the erased arguments, and facts-only units stay.
7. **Name collisions.** Content names use 64 bits. The link compares texts and stops on a mismatch.
8. **Header size multiplied by workers.** Each worker holds its own `H`. A large `H` lowers the number of workers that admission allows. Step 3 measures it. `H` can be decoded lazily per signature.
9. **Serial front end until step 8.** Its peak is the whole checked program, including the literal expansions outside `literal_chain`.
10. **Per-module check edge cases.**
    - The cases are: laws filled in later modules, holes, instances minted again by each worker, and a law that unfolds differently at an earlier prefix.
    - The verdict tests and the laws-check gate step 8.
    - The change to `def_inst` naming is a kernel change and needs review (#774).
11. **Disk.** The store, spool and cache land on filesystems that were 96% and 97% full on 10-26 (#1089). The queue's disk admission must count them.
12. **Bun.** Every process must run Bun 1.4.x (#1027, #1032). Process start, IPC and mimalloc behavior across many processes need measurement in step 6.
13. **Queue integration.** The job becomes a multi-process job (#1026 admission, #1176 phase separation). The queue must account for its total memory.
14. **Language change in step 9.** A `Swt` form changes the parser, the checker, the evaluator and both backends, and it changes the stuck forms of matches on open strings. The laws-check and the differential tests gate it.
15. **Changed C.** Steps 1, 3, 4, 5, 8 and 9 can change the C. Each needs a qualified target build before release.

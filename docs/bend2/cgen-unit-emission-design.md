# Coordinator C generation by compilation unit

## 1. Scope and current source

This design covers the remaining compiler work in #1017 and #776. The implementation
owner is `compiler-emission-sol-20261028`; the operator owns integration and the
consolidated full coordinator measurement. The source basis is Baton main
`106f8c5090c219b436b0447fa253f1f0ea81f612`. References to functions below refer to
`bend2/compiler/upstream` at that commit. This revision incorporates the review of
#1189 at `be06b180f00c59109030f799d87b835133764db4`.

The acceptance targets remain at most 20 GiB per compiler process, less than ten
minutes for cold coordinator C generation, and reuse of unchanged modules on a
warm build. These targets require measurements on the actual coordinator source.
The focused results below do not establish those targets.

Completed changes are:

| Change | Merged PR | Main commit | Selected compiler source |
|---|---|---|---|
| Referenced definition worklist, literal row helpers, absent fact reads, checker release | #1186 | `7dc5bec953ce82e373351c495d4599d2275c3c6a` | `74f58d53e` |
| Facts-only generic units and erased argument types in spin keys | #1190 | `b647feee1355cd8b1da83b9765c53452f767ef58` | `185206bb50ea77f8ab54a6e7da9af5f8a9e31a41` |
| Heap census, fact writers, spin and literal diagnostics | #1192 | `eef5d27481091ec28301c3962b0722545146a41c` | `3d9c83b65e3fe2375f767ba332397033b93da3e5` |
| Literal row lowering requires a total final fallback | #1195 | `7849687510918c5a462a422a2417fe3f2f66118d` | `4e456f688a4bf63250173fdcb85745ee5ee058ad` |
| Shared capture summaries, persistent use maps, spine prefixes, iterative arm operations | #1194 | `106f8c5090c219b436b0447fa253f1f0ea81f612` | `8a140c760043c3a56cf4e3886cd60380ca748223` |

The selected #1194 archive has SHA-256
`2b2b41e938355141b55d617ee38157d50f62597c197e1b772486a7e517451065`.
Its `comp.ts` has SHA-256
`4283b9c46f73a23246e31649da154260be9e73f28441a23a947f4a213951d632`.
The archive, source lock, provenance and selected launcher were reviewed during
that release. Each later compiler change needs its own release and pin update.

Current source locations include `def_body` at comp.ts:2090, `facts_hot` at 2672,
`facts_lend` at 2740, `facts_converge` at 2763, `compile_def` at 4257 and
`compile_book` at 4458. Use function names when following later revisions.

## 2. Evidence and remaining costs

### 2.1 Historical coordinator measurements

#1017 records the repeated full-definition emission and duplicated CLI chains
that motivated #1186. Six definitions each emitted the same 5,338-segment tree.
The final reach on 2026-10-23 kept 28,965 of 61,797 emitted segments. Eight passes
added progressively fewer facts. Per-definition caches survived long emissions
and reached JSC's old generation.

| Historical run | Inputs and compiler | Observed result |
|---|---|---|
| `488a4cf1`, 2026-10-23 | 4,227 definitions, Bun 1.3.14, pass collection patch | 8 passes, 802–1,320 s per pass, 137,480,528 kB peak, 2:19:10 wall |
| `09830f2b`, 2026-10-23 | Same inputs, Bun 1.4.4, pass collection patch | 8 passes, 820–1,292 s per pass, 115,369,648 kB peak, byte-identical C |
| `f200026c`, 2026-10-27 | 5,021 definitions, older release | Cancelled during pass 3; observed RSS reached 151 GiB at pass 2 end |
| `feb11f5d`, 2026-10-27 | Older release generation | About 95 minutes per pass; observed VmHWM 158 GiB |

These measurements describe their recorded inputs and toolchains. They are not
measurements of the current selected compiler.

#1186's focused `emission_chain.bend` comparison changed 76.6 s and 2,512,932 kB
to 0.81 s and 82,244 kB. #1190 repaired a concrete ownership regression from
missing poly keys: the target crashed and the candidate printed the expected
`218`. #1194's corrected retained representation and eight byte-identical C
comparisons support its narrow storage change. Full coordinator wall and peak
after those changes remain subject to the operator's scheduled run.

### 2.2 Remaining source costs

`def_body` installs `h` for reachable definitions. Higher-order binder closures
and checker cells keep checked bodies alive in `cb.book` throughout emission.
Cells can be normalized by `term_wnf`; arm equality and literal interning can
therefore observe normalization performed by earlier units.

`compile_book` retains unit Files and assembles the C as strings. Spins remain
local to their emitting unit. `facts_converge` can close lend using records from
units that are still dirty. The front end and emitter run in one Bun process.
The general literal flattener still needs measurement on the shapes outside the
specialized literal row lowering.

#1194 already removed `USE_CAP`, `CONSTS_CAP`, repeated subtree capture arrays
and the 100000-iteration arm hint loops. Its capture DAG, persistent use maps
and structural spine prefixes must remain shared in subsequent store and worker
changes. Linear traversal counts alone do not establish linear retained memory.

## 3. Compilation data and processes

### 3.1 Process phases

The intended command has these phases:

1. A front-end process parses, checks, elaborates, performs liveness and produces
   the checked-program store and report data. It exits before emission workers
   start once step 6 is implemented.
2. The coordinator plans units and call-graph levels from store summaries.
3. Workers emit new or dirty units against immutable fact snapshots. Level
   barriers merge their writes. Lend closure runs at completed positive strata.
4. The coordinator verifies historical replay and final read validity.
5. The link assigns numeric IDs and streams live fragments into the output C.

Steps 3–5 initially use one process so store fidelity, naming and solver changes
can be qualified separately. Step 8 replaces the whole-program front end with
module checks. The coordinator's emission state contains summaries and fact
records; it does not contain decoded unit bodies.

### 3.2 Units and references

A definition unit contains a referenced definition entry and the bodies fused,
spun or unfolded while emitting it. A facts-only unit emits a reachable generic
definition without an entry unit and contributes facts and lend data. Its C is
discarded. #1190 already implements this distinction and promotes a facts-only
unit if its definition FID becomes referenced. Request stubs are emitted after
the final facts are known.

The plan starts from `main`, bang definitions, closure targets and the reachable
generic definitions that need facts-only emission. The worklist follows newly
discovered external definition references. Call-graph strongly connected
components form levels, with callees below callers. A newly discovered unit is
assigned from this fixed source graph and emitted against its level's snapshot.
Reach determines linked code. Analysis records needed to justify historical
facts remain available through replay even if their code becomes unreachable.

Reference categories are explicit:

| Record field | Meaning | Treatment |
|---|---|---|
| `external_def_fids` | References to canonical source definition entries outside the unit | Drives definition worklist and reach |
| `closure_targets` | Canonical definition/closure targets required by generated closures | Drives closure reach and device reach |
| `local_segments` | Segments created within the emitting unit | Numbered at link |
| `helper_refs` | Content names of generated arms, spins and tables | Resolved and deduplicated at link |

Helper content and references can change when ownership facts change. Comparing
all emitted `refs` between successive emissions is invalid. A claim that a
particular external FID obligation is fact independent needs a source-level
call-context argument and a regression exercising both fact states. The worklist
handles newly discovered external FIDs directly; the link checks resolution of
the final obligations. Step 4 records changes by reference category before any
narrower stability assertion is added.

### 3.3 Unit records and fragments

A `UnitRec` contains the unit key, kind and level; source and interface hashes;
decoded section hashes; ordered fact trace and read answers; writes; lend asks
and edges; queried borrow masks; the reference categories above; segment and
constructor metadata; fragment identity and size; emission and decode time; and
process memory observations.

Code fragments are replaceable files, one current revision per unit. A worker
writes a temporary fragment and returns its hash and complete record. Acceptance
publishes the new record and fragment together. The old job fragment is unlinked
after readers of that revision finish. Superseded code is reclaimed even when
its compact fact trace remains necessary for replay. A failed temporary fragment
is retained with its failed execution evidence. Append-only worker spools do
not provide this reclamation.

Historical traces and barrier inputs are streamed to evidence files. The
coordinator keeps current records and references into that history. History disk
use depends on the number of actual emissions and trace events; it is measured
separately from the one-current-fragment code store. Shared cache variants have
their own retention and disk accounting.

### 3.4 Checked-program store and normalization order

The store records checked bodies after the front end finishes normalization
needed by `carb_book`, `show_main`, `v_live`/`v_drop`, borrow masks and report
summaries. `def_body` may register a raw root before deleting `e`, but registration
does not encode it immediately. Raw roots are retained until sealing after those
front-end operations. Sealing encodes the resulting graph, then releases raw
roots and replaces top-level bodies with store-backed getters.

This ordering follows a measured failure. An early prototype encoded inside
`def_body` before deletion. Seven focused C files were unchanged, but
`arm_eq_ann_share` grew from 547,291 to 2,923,363 bytes. Deferring sealing restored
the target hash `e3232…` and eight focused byte-identical C files. This proves the
ordering matters on that fixture. It does not establish general store fidelity.
Retaining raw roots through sealing can increase front-end peak; step 3 measures
that tradeoff before release.

Store sections are:

- The source manifest: path, namespace and source content hash. Foreign C/JS
  inputs and compiler/runtime inputs enter the relevant compilation identity.
- Shared strings and a span table preserving object identity within the encoded
  graph. `term_higher` uses span identity for closed constructor interning.
- A header with top-level signatures, constructor types, ADTs and values in the
  type closure. These values can carry executable type computation and must be
  represented faithfully.
- One checked body graph per reachable definition. Shared checker cells, literal
  and annotation identity, free checker variables, binder scope and captured
  cells are represented explicitly.
- Summaries: `SRCS`, sites, bangs, local flatness, borrowable-slot masks, show
  descriptors, constructor arities, type closure and canonical order.
- Compiler, manifest and section hashes, including the codec implementation.

A simple `term_lower`/`term_higher` serialization is insufficient. Checked cells
can contain higher-order callbacks and free checker variables. A free checker
`Var` must remain a `Var`; raising an ordinary free variable can produce a `Ref`.
Cells captured outside a callback must stay shared, while cells allocated inside
it must be fresh per invocation. Step 3 tests these cases and identity relations.

Workers decode the header once per emission phase. They decode bodies on first
access within a unit, including fused, spun and unfolded callees. All decoded
bodies, Files and term-dependent caches are released at unit end. Bodies are
fresh for the next unit. Masks contain the fact-independent part of `brw_of`:
`brw_of(k)[i] = mask(k)[i] && !own.has(k~i)`.

### 3.5 Helper names and streaming link

Unit-local segment names are stable within a unit. Spins restart local name
allocation so their names do not inherit a caller's allocation history. Helpers,
tables and static nodes receive content names after their local references have
been canonicalized. A recursive group is canonicalized as a group; a self
reference uses a fixed local marker during hashing. Hashing must include actual
erased argument types and runtime ABI inputs.

The link compares bytes when equal content names meet, computes live and device
reach, orders units and local segments canonically, assigns FIDs/CIDs, constructs
tables and static offsets, emits request stubs, and streams runtime/template
sections and fragment files. It holds metadata and one fragment at a time.
Host C translation-unit splitting is optional step 10; module emission artifacts
already remain separate before that point.

## 4. Facts, replay, cache and workers

### 4.1 FactView operations

Each fact namespace (`own`, `hot`, `stat`) has an immutable snapshot `S`, a
`localWrote` set, a delta and an ordered trace. Operations are:

```text
add(k):
  record write(k) in trace
  localWrote.add(k)             // also when S already contains k
  wrote.add(k)
  if !S.has(k): delta.add(k)

has(k):
  if localWrote.has(k): return true
  answer = S.has(k)
  record snapshot_read(k, answer) in trace and reads
  return answer
```

Thus `add(k); has(k)` has no snapshot dependency for either an empty snapshot or
one already containing `k`. `has(k); add(k)` still records the earlier answer.
Bookkeeping that suppresses repeated traversal uses an independent per-unit
processed set; semantic fact queries continue through FactView.

Each first fact producer refers to its trace position and barrier. A write uses
the preceding trace prefix, rather than every read in the completed unit.
For example, `add(a); if has(b) then add(c)` produces `a` before reading `b`.
Conditioning `a` on the unit's final read set would lose that independent write.
Trace-prefix references share the trace; copying a read list per write would
create quadratic retained metadata.

### 4.2 Levels, rounds and lend strata

Every analysis starts with empty fact sets. A round visits levels from callees
to callers. All units at one level read the same snapshot. Newly discovered
units at that level or below use the same snapshot before its barrier closes;
the source graph determines their levels. Results merge in canonical unit order.
Union of writes updates `F`. Readers whose absent snapshot answer changed become
dirty. A unit above the barrier can run later in the same round; a unit already
visited runs in the next round.

A positive stratum completes only when no unit is missing or dirty. At that
point, the current unit records supply lend asks, lend edges and queried masks.
Close lend over its edges. For every queried borrowable slot, add an own fact if
that slot is absent from the lend closure and absent from own. These writes can
start another positive stratum. Finish when a completed stratum produces no
new own fact.

Each lend barrier records the historical fact snapshot, current record revisions,
asks, edges, queried masks and output writes. Lend uses negative information:
the absence of an ask at that particular barrier. Its historical result cannot
be reconstructed using the final unit records' negative lend data.

The fact universe is fixed by definitions, slots, constructors and type/family
keys. Every continuing completed stratum adds a fact, or new/discovered units
remain to be processed. A quiescent round with no new facts and no new units
terminates. No retry count or duration limit controls convergence.

### 4.3 Historical replay and final validation

Replay verifies the recorded staged analysis from empty facts. It is not a
claim that the final traces define the least fixed point of a monotone operator.
Emitter branches and lend's negative data need not satisfy that premise.

Replay proceeds in recorded level/barrier order:

1. Reconstruct the historical snapshot from earlier accepted barriers.
2. Check each unit trace against that snapshot. Snapshot reads must have their
   recorded answers. Local reads follow prior local writes. Process writes at
   their recorded positions, with references to the preceding trace prefix.
3. Merge accepted writes at the barrier and verify its resulting fact hash and
   dirty-unit transitions. Cache hits supply the same complete trace.
4. At a lend barrier, reload the historical record revisions and masks used
   there, recompute that barrier's lend closure and own writes, and compare them.
5. Require the resulting fact sets to equal `F` and each final live unit's
   snapshot reads to remain valid under `F`. Require every final external
   reference and closure target to resolve.

A superseded emission may have introduced a fact still in `F`. Its historical
trace supplies the derivation; its code fragment can be deleted. Replay detects
facts with no recorded producer and changed historical inputs. It does not prove
that an implementation's fact-production rule is semantically sound. Runtime
differential tests, source review and ownership/literal regressions cover that
separate obligation.

The implementation must first enumerate fact mutation and query sites and route
them through the traced interface. An unexplained write or replay mismatch
retains the failed analysis and reports its unit, fact, barrier and cause.

### 4.4 Cache semantics

The cache holds variants indexed by compiler/ABI identity, module or unit key,
source and imported semantic interface hashes, and the exact fact read answers.
A record includes every decoded body/header section and foreign input it read,
its trace, lend data and content-addressed fragment. A variant applies only when
those input hashes and read answers match the current snapshot.

Cold and warm analyses both start with empty facts and follow the same barriers.
The cache retains variants from earlier rounds as well as final variants, so a
warm build can replay the cold analysis from empty facts. Seeding an old final
fact set can retain facts from changed code and is not the warm-build algorithm.
Warm hits execute the cached trace through the same merge and replay paths.

An unchanged imported signature alone is not sufficient for a cross-module
inlined body. Step 8 therefore establishes module boundaries for runtime fusion
and spins: module units emit their own bodies and call imported runtime entries.
Imported type computation needed by checking is part of the semantic interface.
Until that boundary exists, cache keys also include every foreign body actually
decoded. An interface or fact change can invalidate dependent units legitimately.
The one-module warm acceptance case edits a private runtime body without changing
its exported semantic interface.

The selected distribution contains `cache.ts`, but its current `bin/bend` invokes
Bun `main.ts` without that C-cache API. File presence and a lineage hash do not
prove a warm hit. Step 7 connects and tests the cache through the actual selected
launcher. Cache disk use is accounted with the compile queue. Eviction responds
to available filesystem space and active references; fixed entry/byte caps are
removed from any cache path actually enabled by this work.

### 4.5 Worker ownership, failures and admission

An emission worker receives a store identity, unit, round, level and snapshot
delta. Its execution handle owns the PID, start identity, stdout, stderr and
completion result until collected. A deterministic checker/codegen error ends
that unit with its actual cause and leaves the build unfinished. The coordinator
collects other already-owned executions and retains their results. It does not
blindly redispatch a failed unit.

For a lost host or worker connection, recovery first reconciles the existing
process identity and retained completion record. A redispatch is possible only
after the prior execution is known to have ended without a usable result and
the cause is process/host loss. The recovery record preserves the original unit
and failure. Arbitrary timers and retry caps do not classify failures.

Admission uses measured process peaks, current memory availability and explicit
reservations for in-flight work. For each admitted job, reserve the forecast
growth above its already charged resident memory. A new admission must fit the
available memory after subtracting outstanding growth reservations and the
coordinator/link requirement. Count live resident memory once. Two concurrent
admissions cannot both spend the same `MemAvailable` sample. Unknown workload
classes follow the existing #1026 serial measurement path. CPU affinity bounds
the number of simultaneous worker processes.

This is compiler resource scheduling based on the observed host exhaustion and
queue failures. Agent/session budgets do not control work. Compiler soundness
checks, real allocation failures and platform format widths retain their actual
causes.

Workers finish an emission phase and exit after its assigned units and results
are collected; phase exit returns allocator pages before the next phase. Step 6
measures persistent-header duplication, per-unit release, phase RSS and startup
cost. Reuse across phases needs evidence that retained state and allocator RSS
stay bounded; a forced collection alone does not establish that property.

## 5. Resource and correctness obligations

The coordinator holds current fact sets, current unit metadata, masks and trace
references. A worker holds its decoded header, one unit's decoded bodies and
caches, output fragment and garbage awaiting collection. The streaming link
holds metadata and one fragment. Before step 8, the front end still holds the
whole checked program and the raw roots pending store sealing.

Current fragment disk use scales with current unit output. Historical trace disk
use scales with actual analysis events. Cache disk use scales with retained
variants and is reclaimed under the queue's filesystem policy. Failed job
evidence remains attributable. These are distinct resources in measurements.

The program can contain an arbitrarily large module or unit. A unit lifetime and
finite fact universe alone do not prove a 20 GiB process peak. If a measured unit
exceeds the target, its ownership of bodies, fused code or header data needs a
further decomposition. The acceptance measurement determines whether the design
meets the target on the coordinator workload.

Deterministic output requires fresh per-unit bodies; complete recorded inputs;
canonical names, IDs and link order; identical snapshots at barriers; and
deterministic discovery from the source graph. Tests vary dispatch and completion
order independently. Worker count tests exercise actually available affinity and
resource admission. An inability to admit many workers is a measurement.

The existing emitter still selects ownership operations and runtime code.
Candidate/target comparisons cover runtime output, exit status, laws, holes,
unsafe reports and diagnostics. No scheduling proof substitutes for the poly
spin regression or checked-term fidelity tests. Parser/kernel changes follow
the upstream human-owned `bend.ts` boundary and need the relevant owner review.

## 6. Implementation steps in landing order

### Step 0. Census — completed in #1192

Retain heap census, first fact writers, per-definition facts-only accounting,
spin emission details and literal-column counts. On identical focused inputs,
keep diagnostics-on/off C equality, complete process output, pass times,
definition ms/segments, pass RSS/heapUsed, final reach and GNU time peak/wall.
Full coordinator measurements are scheduled by the operator. This instrumentation
does not itself establish a speedup.

### Step 1. Generic poly facts — completed in #1190

Keep facts-only generic units, promotion to entry units, and erased argument type
keys in spin memoization. `poly_spin_hot.ts` exercises two recursive types and a
fused generic chain. The target fails and the candidate produces `218`. Preserve
this test through subsequent solver and module changes.

### Step 2. Arm traversal and storage — completed in #1194

Keep iterative equality and capture traversal, shared capture DAGs, persistent
use maps, structural spine prefixes and unit cache release. Existing tests check
deep terms, capture/use semantics, erased arguments and retained representation.
The first draft retained quadratic capture/use arrays and was corrected before
selection. Record peak and wall on the matched skewed-distinct-capture stress;
retained-slot counts alone are not total process memory.

### Step 3. Checked store and fresh unit bodies — prototype, unselected

Implement the store, deferred sealing, source identities, summaries and masks
from section 3.4. Replace body roots with store-backed getters after sealing.
Keep the current worklist and fact loop unchanged. Decode each body's cells
fresh per unit; release body maps and type-dependent caches at unit boundaries.

Qualification includes checked graph round trips with aliasing, captured/fresh
cells, free checker variables and span identity; byte comparison of focused C;
runtime comparison when C legitimately differs; and a WeakRef test proving old
front-end bodies are unreachable at the first unit. The latter must fail on the
target. Measure section bytes/write time, header decode, unit decode ms, checker
and sealing peaks, pass memory, final reach and total wall/peak. The current
prototype has checked 360 definitions and eight equal C outputs; broader fidelity
and resource qualification remain work.

### Step 4. Content names and canonical link order

Reset spin-local names; canonicalize helpers, recursive groups, tables and static
nodes; link in canonical unit order; categorize references as in section 3.2.
Compare helper bytes at deduplication. Use final facts only as a controlled test
input when comparing worklist, reverse and shuffled emission orders. Production
analysis still starts empty. Record helper/static counts, C bytes and native
compile time. Candidate/target runtime comparison accounts for numbering changes.

### Step 5. Level rounds and historical replay in one process

Implement FactView, complete traced mutation/query coverage, deterministic
discovery, level barriers, lend strata and replay from section 4. Keep
`pass.end` fields and add snapshot/barrier/stratum and replay diagnostics. Tests
cover `add(k);has(k)` with both snapshot states, independent earlier writes,
local versus snapshot reads, superseded producers and a lend barrier whose
historical negative data differs from final data. An unexplained injected fact
must produce a specific replay failure. Compare final fact sets and C/runtime
against step 4, explaining each changed fact from actual producer traces. Check
unseeded C equality across dispatch orders and record rounds, units and ms.

### Step 6. Worker processes and streaming link

Move the front end to an owned child process. Add worker IPC, replaceable unit
fragments, phase exit, streaming link and admission with in-flight reservations.
Test complete execution collection and preservation of a deterministic failed
unit. Exercise real worker-loss recovery through the maintained queue acceptance
case; constructed probes alone do not justify a new recovery layer.

Compare identical C under 1, 2 and larger admitted worker counts and seeded
dispatch/completion orders. Measure process/cgroup peaks, startup/header cost,
per-unit release, coordinator/link memory, fragment reclamation and wall time.
Old-fragment deletion is verified on actual re-emission, including its file
space. Streaming tests observe that no joined intermediate holds the complete C.

### Step 7. Unit cache through the selected launcher

Implement section 4.4 variants, keys, replay and disk reclamation. Verify the
selected `bin/bend` actually invokes the cache. An unchanged build must reuse
all applicable variants; a private leaf edit must produce the same C as a cold
build of the edited source. Record emitted/reused units, read invalidations,
disk use, cache I/O, wall and peak. Include a changed source that removes a fact
to prove old final facts are not seeded into the new analysis.

### Step 8. Per-module front end and emission boundary

Produce module parse/check records with actual imported semantic interfaces,
type computation dependencies and source identities. Preserve load-order name
resolution and cross-module law completion. Module workers check owned bodies
from those records. The thin link reconstructs source order, sites, bangs,
flatness, masks, reports and entry obligations from summaries.

Runtime fusion and spins stay within the module so a module C artifact depends
on its source and imported interfaces. Content-addressed template instances need
canonical keys and collision checking. Changes to kernel instance naming are
reviewed with its owner; the worker driver is not authority to edit the parser.

Compare verdicts on failing modules, holes, unsafe dependencies and laws declared
and completed in different modules. Run the law corpus and runtime comparison.
Measure bytes and time per module, imported header/body reads, cold wall/peak,
and a warm private-body edit that rebuilds only its module. Interface or fact
changes may rebuild affected dependents. This step supplies the permanent
module-level architecture required by #1017.

### Step 9. General literal columns if remaining evidence requires it

Use census evidence to identify a remaining literal expansion. Build a shared
fallback and whole-character comparison for that shape, preserving exhaustiveness
and matching order. Reuse existing checked forms where possible. A new term form
would require parser, checker, evaluator and both backend owner review.
Measure checked nodes, front-end peak/time and emitted segments. Differential
cases include each literal, every proper prefix, extensions, empty strings,
non-BMP characters, misses and terminal constructor patterns from #1195.

### Step 10. Several host C translation units if native compilation dominates

Measure native compile time after module emission and streaming link. If it is
the remaining dominant phase, emit host C files per module with a shared runtime
and tables interface. Keep the device lane's required assembly form. Verify
binary behavior through candidate/target comparison and record native compile
wall and peak. Module C artifacts and IDs assigned at link remain the architecture
from steps 4–8 regardless of this optional host compilation change.

## 7. Release and proof records

Each implementation PR identifies checkout, branch, remote, source commit,
compiler/Bun hashes, source-input hashes and the exact target. Preserve complete
stdout, stderr, exit result and owned execution handle. Account for every selected
test on candidate and target under the repository's comparison rule. New tests
assert behavior, representation or a measured failure; a hand-maintained expected
failure list is not a build input.

For focused cgen comparisons use `BEND_COMPILER_DIAGNOSTICS=1` and record pass
count, each pass time, definition ms/segments, `pass.end` RSS/heapUsed,
`reach.end`, `peak_kb`, subprocess wall and C hash/runtime comparison. Keep queue
waiting time separate from compiler time. Retain diagnostics-off C comparison.
Step-specific metrics above extend this record.

After source qualification, update vendored source hashes and provenance, build
the repository compiler distribution, hash its actual archive and launcher,
perform package/REPL/lineage staging, and update the compiler selection and pins
used by runtime and workflow builds. A source PR without these steps does not
show that builds use the compiler. The coordinator owns integration and deployment.

Only the operator schedules full coordinator generation, including the final
20 GiB/ten-minute acceptance run. Active work is collected through its existing
execution handle. Preserve the earlier memory-exhaustion evidence and current
unfinished work. #1194's available release is independent of completing these
remaining architecture steps.

# Codex review of the Baton2 law proposals

Review date: 2026-09-21. Recommendation: revise the candidate document before presenting its classifications for operator approval. This review does not approve laws, architecture changes, or implementation.

Start with whether the rule deserves to bind Baton2 development. The companion [suitability assessment](codex-law-suitability-r3.md) applies that question to every row. It provisionally identifies 38 underlying candidate guarantees, 46 rows to split, 20 implementation choices, 29 policy choices requiring justification, one superseded rule and four evidence tasks. These counts describe this review's categories; they are not an approval tally. [Independent proposals](codex-own-law-proposals.md) add six focused contract families and separate their proof obligations and limits.

The language examples materially refine the review criterion: a Bend law can quantify over the behavior of the actual implementation. An equality proof checked by the dependent type system is a valid mechanism. A law need not prohibit every malformed value from being constructed. The mechanism counterexamples below refute particular claimed carriers; they do not show that the intended behavioral requirements cannot be proved.

## Scope and evidence

I read Baton's README, system design and relevant runtime documentation; the Bend2 mandate, language review, architecture review, target architecture and migration decision; all 138 candidate statements and their claimed carriers; the pinned Bend2 guide and effects documentation; and the current operator rulings on issues 529, 541 and 543. I checked representative enforcement paths in workspace custody, host admission, wake replay and contribution review. I did not independently validate every source/test trace or run Baton's full suite.

- Candidate file: `laws-proposed-r3.md`, SHA256 `d45259c595e9ef517851ab3f7112829c913308d20862846344bfb0a100894a68`. It contains 99 law labels and 39 constraint labels. Its heading still says revision 2; please reconcile that with the supplied revision-3 filename.
- Baton extraction base: `bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b`.
- Design snapshot: branch `bend2-rewrite` at `f4da3d416e85f538a7df419e6e657a8b35b9d77d`.
- Bend reference: `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, release 2.0.25.
- Temporary review snapshot and executable probes: `/tmp/codex-baton2-context-afnsav7o/`.
- I downloaded the pinned release into that temporary directory, checked its recorded SHA256, and verified its installed GUIDE.md and EFFECTS.md match the vendored reference. No project source or branch was changed.

## Understanding of Baton and the rewrite

Baton coordinates full coding-harness sessions, workspaces, permissions, contributions, verification, durable events and recovery. The important correctness problems include which authority may act, which exact version an action affects, what survives a crash, when a workspace may be destroyed, and whether agents receive the events they need to continue.

The proposed Baton2 architecture assigns these responsibilities to a pure domain kernel, journal/projectors, scheduler, worker gateway, workspace/artifacts, verification/landing, northbound gateway and capability services. Its useful simplifications include consolidating command schemas, removing class delegates and compatibility wrappers, giving each state transition one owner, and sharing durable event infrastructure while preserving partition semantics.

Bend2 offers affine values, closed data types, dependent propositions and checked proofs over pure code. The pinned runtime uses a C-emitted state machine and an IO event loop; the current guide calls the runtime BendRT. The target document's opening claim that Baton2 runs on HVM needs reconciliation with that pinned reference. CPU/GPU parallel calls do not by themselves supply process supervision, cancellation, durable transactions or crash recovery. The language review already identifies the incomplete process-lifecycle effect family and JSON implementation as prerequisites.

The law review should preserve useful behavioral requirements while removing implementation accidents and superseded restrictions. Each candidate needs a precise property, a concrete Bend encoding, and a clear account of external assumptions.

## Intended use in the language's own examples

I read the pinned guide's law/proof section and the complete LAWS.bend, PROOF.bend and main.bend files for these four upstream examples. I also read the game README's explanation of the workflow. All four PROOF.bend files pass `bend --check-only PROOF.bend` with the pinned 2.0.25 release. Results are saved in `/tmp/codex-baton2-context-afnsav7o/upstream-examples/proof-check-results.json`.

| Upstream example | What the laws require | Consequence for Baton2 review |
| --- | --- | --- |
| [Game](https://github.com/bendlang/bend/blob/a49524265bdfa5753a4bf38e25f0574a705dd868/demos/app_win_is_bug_2d/LAWS.bend) | Every finite move history from the real start state ends without a win, and the player never reaches the flag in the board text used by the interface. | Quantify over reachable histories and connect the property to actual observations. A fabricated Game value outside that history does not refute these laws. A success flag alone can omit the user-visible failure. |
| [Insertion sort](https://github.com/bendlang/bend/blob/a49524265bdfa5753a4bf38e25f0574a705dd868/demos/proof_insertion_sort/LAWS.bend) | The real sort returns ordered output and preserves the number of occurrences of every input value. | Include preservation alongside shape or safety. Returning an empty list satisfies ordering but loses the input. |
| [Typed evaluator](https://github.com/bendlang/bend/blob/a49524265bdfa5753a4bf38e25f0574a705dd868/demos/proof_typed_eval/LAWS.bend) | Optimizing any well-typed expression preserves its value, and this variable-free language reduces to the corresponding literal. | Valid construction, semantic preservation and completion are distinct obligations. An intrinsically typed expression alone does not establish a correct optimizer. |
| [HTTP server](https://github.com/bendlang/bend/blob/a49524265bdfa5753a4bf38e25f0574a705dd868/demos/io_http_server/LAWS.bend) | The pure response encoder places the complete supplied body after the separator and cannot map different bodies to the same response. | State the boundary accurately. These laws establish encoder properties; they do not prove network delivery. The example's server loop is marked unsafe and is outside those pure encoder claims. |

The guide and game README assign approved claims to a human-controlled LAWS.bend, with implementation and proofs maintained separately. LAWS.bend imports the implementation; PROOF.bend imports the laws and supplies checked definitions. The imported predicates, helper definitions and premises also matter: changing a predicate's meaning can weaken the requirement while leaving the law's spelling intact. Review those semantic dependencies with the approved statement.

This workflow permits substantial implementation changes while holding the chosen behavior fixed. A product policy can be an appropriate law when the operator deliberately chooses it; the game itself demonstrates this. The suitability assessment asks whether each Baton2 policy deserves that commitment. It does not exclude policies merely because they are policies.

Source: [pinned language guide](https://github.com/bendlang/bend/blob/a49524265bdfa5753a4bf38e25f0574a705dd868/guide/GUIDE.md).

## Findings requiring revision

### 1. Superseded cutoffs are still proposed as target laws

WAKE-5, line 521, preserves dropping recorded wake events after a replay bound. The operator explicitly rejected this on issue 541: a slow reader must continue from its cursor through recorded history. The cited implementation at `wake-stream.mjs:766-773` really performs the drop, so this is evidence of behavior to change, not a target rule to preserve.

AB-12, line 1375, preserves a 64-entry scope ceiling without a physical derivation. CAP-8 preserves a record byte ceiling; CAP-15 preserves a lock deadline; CAP-17 preserves a configurable worker ceiling. Check each against the later ruling and distinguish any justified physical constraint from an arbitrary stop. DEV-1 currently promises the removal of these cutoffs while other rows propose retaining them.

Bounded pages and streaming chunks can be compatible with continued processing. The property must require that the remainder stays available and processing continues. A bound on one chunk does not justify rejecting a whole input or dropping recorded events. Do not freeze the literal 256 in LEDG-14 as a domain law without a reason for that number.

Source: https://github.com/Flip-Engineering/baton/issues/541

### 2. Ordinary affine types do not supply private, unforgeable constructors

AB-07 and AB-09 explicitly depend on a module-private constructor. Other rows depend on an opaque or sole-producer value: CUST-7, CUST-9, CAP-1, CAP-7, CAP-11, CAP-12, CAP-14 and CL-15, among others.

I tested a separate Bend module declaring an affine `Lease` with a U32 field and an acquire/release API. An importing module successfully constructed `L.Lease{999}` directly and passed it to release; the program returned 999. Merely naming a type Lease, Capability, OwnedCheckout or Thresholds does not establish provenance or a unique producer.

The pinned guide exposes module definitions through imports. WONTFIX also states that unfilled opaque handle-type laws are reserved to Base at this pin. The ordinary exported-type mechanism in the draft therefore needs a different demonstrated encoding or a named language prerequisite. This finding does not rule out proof-indexed or closure-based encodings; they must be shown and tested.

Probe: `review-probes/forge-lease.bend` and `lease.bend`.

### 3. Affine use gives at-most-once use of one value, not mandatory cleanup

CUST-1 says the only consumer of the checkout capability is release. Bend permits dropping an affine value. The `forget` probe accepts a lease and returns 42 without releasing anything; it checks and runs. The negative control that returns the same lease twice is rejected with `consumed more than once`.

This limits claims about CUST-1, CUST-10/11, CAP-7/14 and LEDG-4/6. An affine token can help type an allowed transition, but the complete design must establish issuance, resource identity, state/version binding and the relationship between consuming the value and completing the external effect. Restart, shared holders and serialized requests still need durable evidence and fencing. Dropping a handle cannot be treated as proof that an OS process stopped or a file was flushed.

Probes: `drop-lease.bend`, `duplicate-lease.bend`.

### 4. Immutability does not prove that earlier reviews are retained

CL-07, line 1649, says an immutable list in a pure fold makes erasure unwritable. A pure `add_review(history, review)` can return `[review]`, ignoring history. The probe accepts `[1, 2]` and 3 and returns `[3]` with no checker error.

The required law should relate the old and new histories: the old history is a prefix of the result, and the new review is appended in the required position. I added a concrete checked equality for `[1, 2]` plus 3: the broken implementation is rejected, while an implementation that appends is accepted. This demonstrates the difference between a list-shaped result and a proposition about preservation. The concrete example is not a universal proof; the final law needs the quantified form.

Baton's current fold explicitly copies the existing review list before appending. That behavior is carried by the function's implementation and needs a theorem in the rewrite.

Probes: `erase-history.bend`, `history-law-negative.bend`, `history-law-positive.bend`.

### 5. A result variant does not establish effect order, timing or persistence

DEV-2, line 1880, infers immediate durable acknowledgment from a receipt record with no waiting constructor. A function returning that exact receipt can sleep before returning and perform no durable write. The IO probe does precisely this and succeeds.

The useful obligation is that the command records its intent before acknowledgment, and that execution/admission happens after the receipt without holding the request for the operation's completion. Express this through a transition/effect model and demonstrate the executor's contract. Physical persistence remains a host-effect assumption that needs failure-injection evidence.

Likewise, CAP-3's missing timeout constructor does not prove FIFO progress; DEV-1's missing timeout arm does not exclude cutoffs elsewhere; DEV-3's missing fetch verb does not prove event delivery; DEV-5's acceptance value does not establish red-first development, independent review, a passing gate set or the absence of another Git-write path. Split those multi-part requirements and prove each stated part.

Probe: `delayed-receipt.bend`.

### 6. A type does not force every reader to use one function

CUST-12 and CAP-16 claim that a second predicate has no type to return. Two functions can both return `Custody`; the second-predicate probe checks and runs. PM-05 correctly recognizes that sharing one derivation is an architectural choice; CL-06 mentions the same caveat. Apply that reasoning consistently.

A theorem can establish agreement of two specified computations, or the implementation can route consumers through a shared definition. Neither follows merely from naming a common return type. A total match over a command or permission enum proves coverage, but still needs a specification to establish that each case returns the correct policy.

Probe: `second-predicate.bend`.

### 7. Several carriers establish only a fraction of their row's promise

Examples:

| Row | What the proposed carrier might establish | Additional property still needed |
| --- | --- | --- |
| CUST-4 | A destruction call receives an observation token | Observation covers the same workspace/generation and remains valid until destruction; active holders and new writes cannot invalidate it unnoticed |
| CUST-6 | A path has an admitted syntactic shape | It is attested generated content and is untracked in the actual repository |
| WAKE-3 | A cursor uses a distinct type with a next operation | A pull starts at exactly N+1, preserves order and completeness, and returns the correct next cursor |
| CAP-8 / WAKE-12 | A record has fixed fields | Variable-size strings/lists and serialization obey the claimed byte bound without truncating the logical input |
| LEDG-3 | A map contains at most one value per key | A retry preserves and returns the original value; insertion cannot overwrite it |
| LEDG-10 | A segment name is derived from content | The actual bytes were durably archived before rewriting and the prefix/cut checks hold |
| CL-10 | Landing distinguishes empty and changed diffs | The temporary checkout is cleaned up on the empty path |
| CL-12 | A function returns a set of gates | The set includes every required path-derived and import-derived gate |

Keep the precise statically enforced portion separate from the external constraint. Binding evidence to an identity and a version is usually essential. A carrier for one clause must not certify the whole row.

### 8. Runtime decoders and useful refusals remain necessary

Closed enums, exact records and disjoint command/event types are strong candidates for internal invariants. CS-03/04/06, CS-10/11/13/14/18 and CL-17 provide useful examples.

However, CS-05, CS-12, CS-17 and PM-01 suggest refusal arms disappear once fields become types. External agents, network frames and old journal bytes can still supply malformed data. Boundary decoding must validate those inputs and return the required structured refusal. Once decoding succeeds, the internal typed value can exclude the malformed state. The architecture's own requirement to retain versioned boundary decoders is the correct direction.

### 9. Some constraint rows have useful dependent-proof candidates

PM-08 names a finite permission-set subset property; PM-10 names reviewer/author inequality; CL-08 names an accepted-state index. The pinned language supports dependent propositions, equality and inequality. These are candidates for proof-carrying inputs or transition theorems, subject to actual checked examples and identity/version binding. They should not be described as unavailable merely because ordinary enums cannot express them.

CL-14 calls byte-identical replay not typeable. A specified pure codec and replay function can have equality/determinism theorems; actual filesystem bytes and host operations remain boundary obligations. Separate those questions. This review does not claim to have implemented these general proofs.

### 10. CAP-4 overstates the current source evidence

The explanation says verification is charged the cost the suite actually measured. At the audited base, `deriveHostCapacity` calculates `suiteBytes = floor(totalBytes / cores) * suiteCores`; `leaseWeight` uses that estimate. This is a host-derived allocation formula, not a measured suite footprint. Issue 541 explicitly calls out the 15.5-GB estimate on a 16-GB laptop.

Correct the extraction and independently decide the desired Baton2 rule. A record field named measured cost cannot establish that a measurement occurred or that the formula is appropriate.

## What I will require in subsequent law reviews

For each proposed law, provide:

1. A plain behavioral requirement and the violating example it rules out.
2. Why the requirement deserves to be inviolable, the useful alternative implementations it permits, and its status: currently enforced, superseded, or a proposed improvement.
3. The exact Bend type or proposition, with all premises, identities and versions made explicit.
4. The function or transition to which the law applies and the checked proof or construction that enforces it.
5. A passing example and a deliberate violating implementation that the checker rejects for the claimed reason; also challenge vacuous implementations such as refusing all work, deleting history or returning a constant success indicator.
6. External assumptions covering authentication, host effects, storage, process lifetime, clocks and restart where relevant.
7. The source/test trace and the behavior or machinery the law allows Baton2 to simplify.

The proof command's exit code alone is insufficient if the output admits `@unsafe` annotations or unverified foreign code. Record those dependencies explicitly. A compiled law over a pure model must remain connected to the actual effect path used by the implementation.

The highest-value candidates are authority-preserving delegation, exact identity/version binding of review and verification, preservation of prior journal/review facts, consistent live admission and replay, workspace preservation with shared custody, durable intent before receipt, and lossless cursor-based delivery. Shape laws support these properties; the cross-state relations need their own proofs.

## Probe results

Results are recorded in `/tmp/codex-baton2-context-afnsav7o/review-probes/results.json`. Pure examples were checked and evaluated by Bend's normalizer; the IO example was compiled and executed by `bend`. The two explicit history-law examples used `--check-only`. These are small mechanism probes, not a Baton2 implementation or an end-to-end validation.

| Probe | Observed result |
| --- | --- |
| Construct exported affine lease in an importing module | Success; returns 999 |
| Drop an affine lease | Success; returns 42 |
| Reuse the same affine lease twice | Rejected: consumed more than once |
| Discard earlier reviews in a pure function | Success; returns `[3]` |
| Define another function returning the same custody type | Success; returns `Custody{0}` |
| Wait and return a receipt with no durable write | Success |
| Assert history preservation for the discarding function | Rejected: `[3]` differs from `[1, 2, 3]` |
| Assert the same concrete property for the appending function | All terms check |

No row was inserted into `laws.bend`, and no operator approval is inferred from this review.

# Bend2 rewrite go/no-go recommendation

## Recommendation

**Decision: Prototype only.** Complete Phase 0 and the Phase 1 shadow decision core. Do not move
production authority to Bend2 at this pin.

The language review proves enough of the type, effect, concurrency, filesystem, and network model to
make the prototype useful. It also proves that the production prerequisites are incomplete:
`LANG-CAP-05` requires a nonblocking process-lifecycle C-effect family, `LANG-CAP-06` requires a JSON
implementation, `LANG-CAP-01` leaves the durability and metadata operations to authored C effects,
`LANG-CAP-08` leaves HTTP, HTTPS/TLS and Unix-domain sockets to a C-effect family or a vendored
module, `LANG-CAP-09` leaves cancellation, deadlines, race/select and supervision to the Baton2 core
and the process family, and `LANG-CAP-10` leaves hashing, HMAC, secure random bytes and signatures
to audited C effects. The current examples do not prove streaming process output, signals, kill,
cancellation, canonical JSON, git execution, terminal behavior, credential handling, durable writes,
or provider protocol effects. Phase 6 therefore cannot satisfy its entry condition.

The operator authorized rewrite development on `bend2-rewrite` under the 16 approved revision 9.1
laws at `1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`; [`authorization.md`](authorization.md) records
the decision, the binding entries and the phase-entry conditions. The separate Codex architecture
review is open: it finds the eight logical owners useful for prototyping and supports Prototype-only
for production authority transfer, and its required corrections stay as obligations on the phases
they name (see [`reviews/codex/`](reviews/codex/)). The Phase 1 differential rollup
([`prototype-parity-rollup.md`](prototype-parity-rollup.md)) measures the five architecture-review
replay corpora — stop 2 of 3 disagreements, basis 2 of 4, cursor 0 of 4, mutation 2 of 3,
vocabulary 0 of 5 — with every divergence explained and carried by the `ARCH-CLOSE-11` row of
[`arch-close-status.md`](arch-close-status.md) (closing work item `B2-DIAGNOSTIC-BASIS`); the
rewrite plan's proving test `phase1-shadow-parity.test.mjs` does not exist on the branch, so Go
criterion 6 is not yet met.

The swarm orchestrator owns this recommendation wording. This record cites the published basis and
the evidence required to change the answer.

## Decision being made

This record uses three outcomes:

- **Go:** execute the phased production migration in [`rewrite-plan.md`](rewrite-plan.md) through
  the Bend2-only Phase 7 target.
- **Prototype only:** complete Phase 0 and Phase 1, preserve the evidence, and do not move
  production authority to Bend2.
- **No-go:** do not build the Phase 1 prototype because a required capability or safety property is
  already disproved by published evidence.

The decision covers the pinned language and runtime in [`reference/README.md`](reference/README.md):
`bendlang/bend` commit `a49524265bdfa5753a4bf38e25f0574a705dd868` and Bend 2.0.25. A later pin
requires a new evidence run for affected findings.

The production target contains no JavaScript, Node runtime, `baton.bridge.v1` process, or
JavaScript effect host. The bridge exists only while authority moves between implementations. The
current recommendation does not authorize a production target.

## Evidence available now

The current implementation provides a workable temporary migration boundary model:

- [`../../impl/src/contribution-contract.mjs`](../../impl/src/contribution-contract.mjs) defines a
  closed contribution report with typed validation.
- [`../../impl/src/landing-table.mjs`](../../impl/src/landing-table.mjs) derives landing gates from
  changed paths and the seam inventory.
- [`../../impl/src/swarm-runtime.mjs`](../../impl/src/swarm-runtime.mjs) admits an accepted
  contribution, records the landing start, invokes the git authority, and records a durable outcome.
- [`../../impl/src/worktree.mjs`](../../impl/src/worktree.mjs) prepares an isolated checkout, creates
  one squashed commit, runs gates, conditionally updates the target ref, and cleans the checkout.
- [`../../impl/test/issue296-swarm-integrate.test.mjs`](../../impl/test/issue296-swarm-integrate.test.mjs)
  proves the current landing and replay properties used as the plan's boundary model.

This evidence shows how a decision core and a host-effect executor can exchange a request and a
durable receipt during migration. The target deletes that boundary, every JavaScript adapter, and
the Node runtime.

## Published findings

| Work item | Source | Findings that support continuing the prototype | Findings that stop a production migration | Status |
|---|---|---|---|---|
| `work-bend2-language` | [`language-review.md`](language-review.md), [`examples/index.md`](examples/index.md) | `LANG-F-01` through `LANG-F-09` prove the affine type, law, result, and C-effect model; `LANG-F-07`, `LANG-F-10`, and `LANG-F-11` prove the concurrency and native parallelism model; `LANG-CAP-01` through `LANG-CAP-04` prove filesystem, TCP, UDP, environment, time, and randomness primitives; `LANG-F-17` proves a C-only native effect needs no JavaScript runtime. | `LANG-CAP-05` leaves process spawn, streaming, wait, signals, kill, and cancellation as an incomplete C-effect family. `LANG-CAP-06` leaves JSON as an incomplete Bend2 module or C import. `LANG-CAP-07` and `LANG-CAP-08` depend on those prerequisites, and `LANG-CAP-08` also leaves HTTP, HTTPS/TLS and Unix-domain sockets to the same family. `LANG-CAP-01` leaves durability, metadata and atomic replacement to authored C effects. `LANG-CAP-09` leaves cancellation, deadlines and supervision to the Baton2 core, and `LANG-CAP-10` leaves the cryptographic primitives to audited C effects. `LANG-F-25` records the limited test, debug, profiling, REPL, and incremental-build tooling. `LANG-F-26` and `LANG-F-28` establish that affinity enforces no cleanup and that a declared affine record is ordinary, forgeable data. | Published and independently accepted in `contribution-b512a726a54efc7df28921fa1c876aa9`; the capability scope was extended to `LANG-F-01..31` and `LANG-CAP-01..10` in `contribution-b7fc7d1b78e90ef46a1e335e52c25d72`. |
| `work-bend2-architecture` | [`architecture-review.md`](architecture-review.md), [`target-architecture.md`](target-architecture.md) | `F1` through `F24` name concrete deletions or merges and their possible losses. The target assigns every mutable fact to one of eight owners and lists all 28 subsystem synchronization pairs. `F2`, `F4`, `F6`, `F8`, `F16`, `F19`, `F20`, `F22`, and `F23` provide substantial prototype targets. | Each finding carries a disposition from the external Codex review: accept-direction, conditional, or revise. A conditional or revised finding requires the behavior it names, with a proving test, before its deletion. Capability provenance and lifecycle management (`F5`, `F7`, `F8`), canonical shared publication (`F16`, finding 2), durable native journaling (finding 3), and reconciliation over observed external outcomes (`F9`) stay as obligations on the phases that consume them. | Review and target published as `contribution-2d159f005e24f4cd60b6985b47eb037c` and `contribution-3164141d06b6aaee6930870b40ea5f26`; the external Codex architecture review and its evidence land in [`reviews/codex/`](reviews/codex/). |
| `work-bend2-laws` | [`laws-proposed.md`](laws-proposed.md), [`laws-trace.md`](laws-trace.md) | The 16 approved entries supply the prototype's law corpus and the development contract for every later phase. The trace maps each entry to its historical enforcement anchors (`LEDG-*`, `CUST-*`, `CAP-*`, `WAKE-*`, `CS-*`, `AB-*`, `PM-*`, `CL-*`) and records the checked pure-model propositions in [`laws.bend`](laws.bend). | The application propositions remain open for every entry, and the trace states each entry's checked scope. The historical anchors include enforced but unpinned arms that need tests before migration, and the finding-1, finding-3 and finding-5 corrections bear on M-1, M-4, M-5, M-8, M-14 and M-17. | Approved at `1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`; the approval record is [`reviews/codex/codex-final-law-review-r9.1.md`](reviews/codex/codex-final-law-review-r9.1.md). |

An unpublished implementation or an unproved capability is not supporting evidence for **Go**.

## Decision rules

### Go to a production migration

Recommend **Go** only when all of these statements are supported by published findings and the
Phase 1 proof:

1. The language review supplies compiled and run evidence that the pinned toolchain can build and
   execute the Phase 1 decision core through a bounded host protocol.
2. Every required host effect has a Bend2 owner at the pin, implemented by a Base effect or a
   declared C import and proved by a compiled, run example. The required set includes process spawn
   and wait, TCP and UDP sockets, filesystem operations, JSON handling, git invocation,
   interprocess transport, terminal IO, clocks, entropy, credential access, and provider protocol
   IO. A missing owner is a no-go or a named prerequisite that must close before the phase that
   needs it.
3. The BATON2 deletion and merge set carries a disposition and the evidence the external
   architecture review requires. The target assigns one owner to each durable fact and effect and
   states what each subsystem cannot own.
4. The approved architecture deletions provide enough value to justify the coexistence boundary
   and migration phases, and every recorded loss has a proving test before deletion.
5. Every approved law appears in the law encoding with its trace, has a parity proof assigned to a
   phase, and has a pinning test where the trace marks the historical enforcement unpinned. Rejected
   and deferred rows stay documented in [`laws-design-notes.md`](laws-design-notes.md).
6. Phase 1 produces zero unexplained differences across the frozen corpus, extracted laws, closed
   validation mutations, replay prefixes, and wake projections.
7. Each migration rollback restores the preceding phase from the same ledger without deleting or
   rewriting accepted rows, and the final proof runs the packaged deployment without JavaScript or
   a Node runtime.
8. The operator sets measurable resource and service thresholds before the canary and the prototype
   meets them.

### Stop after the prototype

Recommend **Prototype only** when the Phase 1 core is useful as an executable evaluation but one or
more published findings make a production cutover unjustified. The final record must cite the
specific case. Qualifying cases include:

- the host boundary leaves the target architecture with no material deletion or ownership
  simplification;
- required runtime, packaging, debugging, or interoperability work has a named prerequisite with a
  credible Bend2 Base-effect or C-import path, but that prerequisite is not yet complete;
- one or more required host effects lack compiled proof at the pin, so Phase 6 cannot start;
- an extracted safety law depends on behavior the Bend2 core cannot reproduce or encode;
- differential replay, refusal, or wake behavior remains unexplained;
- crash recovery leaves effects whose outcomes cannot be classified safely;
- measured resource use or service behavior misses the operator's predeclared threshold; or
- the migration and rollback mechanisms add more operational state than the target architecture
  removes.

The current recommendation meets the second and third conditions: `LANG-CAP-05`, `LANG-CAP-06` and
the durability, cancellation, HTTP/TLS and cryptography prerequisites are credible but incomplete,
and several required production effects have no effect-specific compiled implementation. It also
lacks the architecture review's discharged correction obligations; the Phase 1 differential rollup
is landed with six explained divergences carried by `ARCH-CLOSE-11`, but the proving test
`phase1-shadow-parity.test.mjs` does not exist on the branch, so Go criterion 6 is not met.

### Do not start the prototype

Recommend **No-go** before Phase 1 when published evidence disproves a required prototype
capability, when a required production host effect has no supported Bend2 Base-effect or C-import
path and no concrete prerequisite can close the gap, or when the target architecture finds no
Bend2 decision core worth evaluating. A JavaScript effect adapter is not a production remedy. The
final record must cite the compiled refusal or the exact architecture finding.

## Evidence that changes the answer

The following evidence can move a **Prototype only** or **No-go** decision toward **Go**:

- a new compiled example at the same pin that closes the cited language capability gap;
- a boundary prototype that passes the missing differential, replay, or fault-injection case;
- a revised target architecture with a concrete deletion or merge list and complete ownership
  boundaries;
- a law encoding and trace that closes the cited safety gap;
- a compiled and run Bend2 Base-effect or C-import implementation for the missing host effect;
- a reproducible Bend2 packaging, debugging, or host-integration path on the deployment platform;
  or
- a canary that meets thresholds declared before the run.

The following evidence moves a **Go** decision toward **Prototype only** or **No-go**:

- a compiled example that contradicts a required language finding;
- a reproducible mismatch in an extracted law, refusal, replay projection, or wake frame;
- an effect duplicated, lost, or left unclassifiable by a crash test;
- a required public CLI or MCP operation with no compatible dispatch path;
- a target-architecture ownership cycle or an undeclared owner for a durable fact or effect;
- a migration rollback rehearsal that cannot reconstruct the preceding phase from the shared
  ledger;
- a final deployment that retains `baton.bridge.v1`, JavaScript code, a JavaScript effect host, or
  a Node runtime; or
- a canary miss against a threshold declared before the run.

Evidence from a new Bend commit triggers a re-pin decision. It does not silently revise the result
for the current pin.

## Decision record

> **Recommendation:** **Prototype only.** Execute Phase 0 and Phase 1. Do not transfer production
> authority to Bend2.
>
> **Language basis:** `LANG-F-01..11`, `LANG-F-17`, and `LANG-CAP-01..04` support a native shadow
> decision core with filesystem and network primitives. `LANG-CAP-05` and `LANG-CAP-06` leave the
> process lifecycle and JSON implementations incomplete; `LANG-CAP-07` and `LANG-CAP-08` depend on
> them, and the durability, HTTP/TLS, cancellation and cryptography prerequisites named by
> `LANG-CAP-01`, `LANG-CAP-08`, `LANG-CAP-09` and `LANG-CAP-10` remain open. See
> [`language-review.md`](language-review.md) and the compiled evidence linked from
> [`examples/index.md`](examples/index.md).
>
> **Architecture basis:** `F1..F24` and the eight-owner model provide a concrete simplification to
> evaluate. The external Codex review supports prototype execution and requires each conditional or
> revised finding's stated behavior, including shared-destination publication, before its phase
> takes production authority. See [`architecture-review.md`](architecture-review.md),
> [`target-architecture.md`](target-architecture.md) and [`reviews/codex/`](reviews/codex/).
>
> **Law basis:** the 16 approved entries are the prototype's law corpus and the development
> contract. [`laws-trace.md`](laws-trace.md) records each entry's enforcement anchors, encoding
> status and checked scope, and the unpinned arms need tests before they can gate migration. See
> [`laws-proposed.md`](laws-proposed.md) and
> [`reviews/codex/codex-final-law-review-r9.1.md`](reviews/codex/codex-final-law-review-r9.1.md).
>
> **Prototype evidence:** the Phase 1 differential rollup
> ([`prototype-parity-rollup.md`](prototype-parity-rollup.md)) measures the five
> architecture-review replay corpora: stop 2 of 3 disagreements, basis 2 of 4, cursor 0 of 4,
> mutation 2 of 3, vocabulary 0 of 5, with every divergence explained and carried by the
> `ARCH-CLOSE-11` row of [`arch-close-status.md`](arch-close-status.md) (closing work item
> `B2-DIAGNOSTIC-BASIS`); the rewrite plan's proving test `phase1-shadow-parity.test.mjs` does not
> exist on the branch, so Go criterion 6 is not yet met. The prototype runs as two tracks:
> the pure decision and replay track, and the native effect track whose findings compose into a
> durable admission to canonical publication recovery path. The result must show zero unexplained
> differences across the frozen corpus, approved laws, refusal mutations, replay prefixes, and wake
> projections before Phase 2 can be considered.
>
> **Evidence that would change the answer:** compiled and run implementations for the full
> `LANG-CAP-05` process family, `LANG-CAP-06` JSON, the durability family, HTTP/TLS, cancellation
> and supervision, and cryptography; the architecture review's correction obligations discharged
> with proofs for the phases they name; a green Phase 1 parity result; and successful rollback and
> canary proofs against thresholds declared in advance.

This recommendation becomes **No-go** if the required host effects cannot be implemented through
Base effects or declared C imports at an accepted pin, or if Phase 1 disproves a required law. It
becomes **Go** only after every condition in the production-migration rule is supported by evidence.

Adopted by the swarm orchestrator (bend2-orchestrator2) on 2026-09-21 as this evaluation's decision
record. Rebased on the approved 16 operative laws and the external architecture review by
bend2-orchestrator5 on 2026-09-23: the recommendation stands, the law basis is the approved set, and
the prerequisites an eventual Go rests on are the capability families and correction obligations
named above.

# Bend2 rewrite go/no-go recommendation

## Recommendation

**Decision: Prototype only.** Complete Phase 0 and the Phase 1 shadow decision core. Do not move
production authority to Bend2 at this pin.

The language review proves enough of the type, effect, concurrency, filesystem, and network model to
make the prototype useful. It also proves that two production prerequisites are incomplete:
`LANG-CAP-05` requires a nonblocking process-lifecycle C-effect family, and `LANG-CAP-06` requires a
JSON implementation. The current examples do not prove streaming process output, signals, kill,
cancellation, canonical JSON, git execution, terminal behavior, credential handling, or provider
protocol effects. Phase 6 therefore cannot satisfy its entry condition.

The architecture and laws work support a prototype but do not yet authorize a production rewrite.
The 24 architecture deletions and the BATON2 target remain subject to operator approval. The 138
rows in [`laws-proposed.md`](laws-proposed.md) are candidates; none becomes a binding `laws.bend`
row until the operator approves it. Phase 1 also has no differential result yet.

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
| `work-bend2-language` | [`language-review.md`](language-review.md), [`examples/index.md`](examples/index.md) | `LANG-F-01` through `LANG-F-09` prove the affine type, law, result, and C-effect model; `LANG-F-07`, `LANG-F-10`, and `LANG-F-11` prove the concurrency and native parallelism model; `LANG-CAP-01` through `LANG-CAP-04` prove filesystem, TCP, UDP, environment, time, and randomness primitives; `LANG-F-17` proves a C-only native effect needs no JavaScript runtime. | `LANG-CAP-05` leaves process spawn, streaming, wait, signals, kill, and cancellation as an incomplete C-effect family. `LANG-CAP-06` leaves JSON as an incomplete Bend2 module or C import. `LANG-CAP-07` and `LANG-CAP-08` depend on those prerequisites. `LANG-F-25` records the limited test, debug, profiling, REPL, and incremental-build tooling. | Published and independently accepted in `contribution-b512a726a54efc7df28921fa1c876aa9`. |
| `work-bend2-architecture` | [`architecture-review.md`](architecture-review.md), [`target-architecture.md`](target-architecture.md) | `F1` through `F24` name concrete deletions or merges and their possible losses. The target assigns every mutable fact to one of eight owners and lists all 28 subsystem synchronization pairs. `F2`, `F4`, `F6`, `F8`, `F16`, `F19`, `F20`, `F22`, and `F23` provide substantial prototype targets. | Every deletion and merge still needs operator approval. A wrong deletion can lose replay, process, authorization, custody, landing, or public-surface behavior as recorded under each finding. | Review and target published as `contribution-2d159f005e24f4cd60b6985b47eb037c` and `contribution-3164141d06b6aaee6930870b40ea5f26`; independent reviews accepted both documents. |
| `work-bend2-laws` | [`laws-proposed.md`](laws-proposed.md) | The 138 rows supply specific source and test traces for custody (`CUST-*`), capacity (`CAP-*`), wake (`WAKE-*`), ledger (`LEDG-*`), closed shapes (`CS-*`), authorization (`AB-*`), permissions (`PM-*`), contribution and landing (`CL-*`), and development (`DEV-*`) behavior. They give Phase 1 a concrete law corpus. | No row is binding until operator approval. The document identifies 12 enforced but unpinned arms and eight proposed rows (`PROP-1..3`, `PR-01..05`); approved unpinned rows need tests before migration. `laws.bend` is intentionally not populated before those decisions. | Candidates published in `contribution-1b67c4212caa8f41138c0f113e955171`; operator decisions pending. |

An unpublished implementation or an unapproved proposal is not supporting evidence for **Go**.

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
3. The operator has approved the BATON2 deletion and merge set. The approved target assigns one
   owner to each durable fact and effect and states what each subsystem cannot own.
4. The approved architecture deletions provide enough value to justify the coexistence boundary
   and migration phases, and every recorded loss has a proving test before deletion.
5. The operator has decided every candidate in [`laws-proposed.md`](laws-proposed.md). Every
   approved law appears in `laws.bend`, has a parity proof assigned to a phase, and has a pinning
   test when the candidate was marked unpinned. Rejected rows remain documented decisions.
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

The current recommendation meets the second and third conditions: `LANG-CAP-05` and
`LANG-CAP-06` are credible prerequisites but incomplete, and several required production effects
have no effect-specific compiled implementation. It also lacks the operator approvals and Phase 1
parity result required for **Go**.

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
> them. See [`language-review.md`](language-review.md) and the compiled evidence linked from
> [`examples/index.md`](examples/index.md).
>
> **Architecture basis:** `F1..F24` and the eight-subsystem ownership model provide a concrete
> simplification to evaluate. Every deletion remains subject to operator approval and to the loss
> test recorded by its finding. See [`architecture-review.md`](architecture-review.md) and
> [`target-architecture.md`](target-architecture.md).
>
> **Law basis:** the 138 `CUST-*`, `CAP-*`, `WAKE-*`, `LEDG-*`, `CS-*`, `AB-*`, `PM-*`, `CL-*`,
> `PROP-*`, `PR-*`, and `DEV-*` rows provide the prototype corpus. They remain candidates until the
> operator decides them, and the listed unpinned arms need tests before they can gate migration.
> See [`laws-proposed.md`](laws-proposed.md).
>
> **Prototype evidence:** no Phase 1 differential run exists yet. The prototype must produce zero
> unexplained differences across the frozen corpus, approved laws, refusal mutations, replay
> prefixes, and wake projections before Phase 2 can be considered.
>
> **Evidence that would change the answer:** compiled and run implementations for the full
> `LANG-CAP-05` process family, `LANG-CAP-06` JSON, and each remaining Git, terminal, credential,
> provider, and transport effect; operator approval of the BATON2 deletions and law rows; a green
> Phase 1 parity result; and successful rollback and canary proofs against thresholds declared in
> advance.

This recommendation becomes **No-go** if the required host effects cannot be implemented through
Base effects or declared C imports at an accepted pin, or if Phase 1 disproves a required law. It
becomes **Go** only after every condition in the production-migration rule is supported by evidence.

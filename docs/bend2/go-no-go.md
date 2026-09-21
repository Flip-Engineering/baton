# Bend2 rewrite go/no-go recommendation

## Draft status

**Decision: pending.** This draft does not recommend a production rewrite or a prototype-only stop.
The three evidence work items required by the mandate have not published their findings. Issuing a
decision now would require claims that belong to those work items.

The final recommendation is owned by the swarm orchestrator. This document supplies the decision
record structure, cites the current migration evidence, and names the evidence still required.

## Decision being made

The operator will select one outcome:

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
JavaScript effect host. The bridge exists only while authority moves between implementations.

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
the Node runtime. The current evidence does not establish that Bend2 can implement the core and all
required host effects, that the proposed target architecture is smaller or safer, or that the
extracted laws are preserved.

## Required findings

| Work item | Required source | Findings that support **Go** | Findings that support **Prototype only** or **No-go** | Status |
|---|---|---|---|---|
| `work-bend2-language` | [`language-review.md`](language-review.md) and `examples/lang-*` | **LANGUAGE-GO-FINDINGS-PENDING** | **LANGUAGE-STOP-FINDINGS-PENDING** | Not published |
| `work-bend2-architecture` | [`architecture-review.md`](architecture-review.md) and [`target-architecture.md`](target-architecture.md) | **ARCHITECTURE-GO-FINDINGS-PENDING** | **ARCHITECTURE-STOP-FINDINGS-PENDING** | Not published |
| `work-bend2-laws` | [`laws.bend`](laws.bend), [`laws-trace.md`](laws-trace.md), and compiled evidence | **LAWS-GO-FINDINGS-PENDING** | **LAWS-STOP-FINDINGS-PENDING** | Not published |

The revision replaces every pending marker with finding or law IDs, file links, and the evidence
paths cited by the source document. It does not convert an absence of evidence into supporting
evidence.

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
3. The target architecture names a smaller, enforceable subsystem set, assigns one owner to each
   durable fact and effect, and states what each subsystem cannot own.
4. The architecture review names concrete deletions or merges whose value exceeds the cost of the
   coexistence boundary and migration phases.
5. Every extracted law has a parity proof assigned to a phase. Every proposed law is clearly
   separated from current compatibility requirements.
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

These are decision conditions, not current findings.

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

## Final recommendation template

The orchestrator completes this section after all three work items publish.

> **Recommendation:** **FINAL-OUTCOME-PENDING**
>
> **Language basis:** **LANGUAGE-CITATIONS-PENDING**
>
> **Architecture basis:** **ARCHITECTURE-CITATIONS-PENDING**
>
> **Law basis:** **LAW-CITATIONS-PENDING**
>
> **Prototype evidence:** **PHASE-1-EVIDENCE-PENDING**
>
> **Evidence that would change the answer:** **DECISION-REVERSAL-EVIDENCE-PENDING**

The final text lists adverse evidence as well as supporting evidence and states any condition the
operator must satisfy before the next phase.

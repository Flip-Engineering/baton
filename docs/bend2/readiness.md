# Baton2 readiness

## Current status

Baton2 has a native coordinator, harness supervision, retained messaging, scoped
knowledge and checked Git landing. Development and verification use `bend2-rewrite`.
A release candidate has not been qualified by the current comparison work.

The September prototype [go/no-go record](go-no-go.md) remains historical evidence.
The [implemented architecture](architecture.md) describes the current acceptance
contract: a real orchestrator's working day with native agents, review, recovery and
publication. Qualification uses current native workflow and recovery evidence.

## Published evidence

| Capability | Evidence and boundary |
| --- | --- |
| Compilation with operative laws | At `ec0e144d`, the entry imports the implementation laws. Exact-tree verification passed 350 proof-removal controls, 79 implementation mutations and 210 Python tests across 20 suites, plus two Bend suites. Compiler proofs bind the stated functions; runtime tests exercise their host effects. |
| Native orchestration | [Hierarchy acceptance](hierarchy-2026-10-02.md) records a subscription Codex root, Kimi K3 lead, concurrent DeepSeek and Muse workers, native steering and both reviewed landing levels on its recorded source. |
| Messaging policy | [Messaging](messaging.md) records descendant and immediate-parent routes, explicit tight Ensemble peers, same-depth Conductor peers and preservation of accepted retries. These are declared local coordination identities. |
| Shared knowledge | [Knowledge acceptance](knowledge-context-2026-10-01.md) records evidence review, explicit promotion, destination-owner notification, sibling retrieval and fresh-conversation retrieval. The destination owner decides further distribution to Ensembles. |
| Retained recovery | [Architecture](architecture.md#recovery-and-current-limits) links the native receive and recovery runs. Their records state which owned processes were stopped and which identities, pending inputs, outputs and reports survived. |
| Coordination measurements | [Coordinator comparison](coordinator-comparison-2026-10-01.md) and [status comparison](coordinator-status-comparison-2026-10-01.md) retain operation samples and process boundaries. They show different tradeoffs; they do not establish a universal speed improvement. |

## Current qualification results

The [matched native comparison](native-workflow-comparison-2026-10-02/README.md)
measured original Baton `6ccb2a6d` and Bend2 `ec0e144d` using task base
`2264ebc2`. Both privately published useful changes and passed their four final
checks. Both failed complete hierarchy acceptance. Original accepted one leaf;
Bend2 required endpoint assistance, an unsupported harness change, shared
capacity-state changes and recovery of lost correction processes. All native
processes are closed; two Bend2 native exit statuses remain unknown.

The measured Bend2 revision admitted an invalid endpoint filename through
`connect`. The [repair for #648](connect-admission-2026-10-02.md) validates the JSON argv before changing the
binding, preserves pending input and the previous native identity, and returns
an actionable refusal. Eight imported laws constrain admission and refusal;
four native tests exercise the actual stored state and endpoint process.
Exact-tree build, negative controls and native checks govern publication.

The [repair for #650](recruit-conflict-2026-10-02.md) reports a conflicting worker
assignment with its existing and requested fields. Exact retries preserve the
registered endpoint, pending input and workspace; conflicting retries preserve
the stored assignment. Six native recruitment tests exercise these effects.

The [repair for #649](hierarchy-observer-2026-10-02.md) records failed process
closure separately from incomplete native exit receipts. An unfinished wrapper
without a recorded child identity remains uncertain. Sixteen controlled observer
and harness fixtures exercise these decisions. The hierarchy helper checks both
recorded worker harnesses before launching either worker. Native background
process custody and a complete run on a frozen candidate still require
qualification.

Generated lead instructions include saved-native direct-turn corrections for
both helper workers, with retained logs and detached process ownership. They
require prior completion evidence, the saved identity and unchanged route
bindings. Static review verified the command and prompt; real qualification
remains pending.

The comparison distinguishes requested routes, actual native observations,
review corrections, landings, usage and process closure. It retains caller
mistakes, dependency setup, capacity context and differences in provider output
capture. Unequal outcomes and process lifetimes prevent a causal workflow speed
or cost claim. The frozen whole-run predicates remain failed.

## Release gates

Before a 1.0 release:

1. Resolve observed coordinator defects and publish their measured repairs.
2. Resolve the supported-workflow qualification failures identified by the
   completed comparison, with each repair tied to its observed boundary.
3. Qualify a frozen release candidate against the supported native workflows and
   the declared recovery boundaries.
4. Document the supported host, installation, command entry point, harness setup
   and retained-state recovery procedure for that candidate.
5. Run the native build, complete law negative controls and native checks on the
   exact release tree, then verify the advertised source and release artifacts.

The coordinator serves local agents with repository access. Worker worktrees and branches remain
available after turn completion and landing. Cleanup requires determining whether
their work is still needed. Host-start reconciliation and broader process discovery
are outside the currently implemented recovery contract.

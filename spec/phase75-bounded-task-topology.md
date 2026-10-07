# Phase 75 — bounded task topology authority

## Why this phase exists

Baton already records task dependencies, refinement lineage, native-session recovery, semantic
review, scratch oracles, and preserved resume. Those facts were individually validated, but no one
deployment authority bounded the recursive task tree. A caller could therefore create a dangling or
cross-Run refinement, grow an unbounded refinement chain, or exhaust one parent with children before
provider admission noticed the malformed topology.

Phase 75 makes topology a prospective, replayed authority. It does not add a second orchestration
surface: the unified Run application remains the normal agent experience, while this projection is
the bounded evidence layer beneath it.

## Contracts

### TT1 — closed deployment policy

`createDriver()` installs a normalized default `taskTopologyPolicy` for its own coordination store.
Deployments may replace it with exactly `schemaVersion`, `maxDepth`, `maxChildrenPerTask`,
`maxTasksPerRun`, and a complete `maxChildrenByRelation` map for `follow_up`, `review`, `oracle`,
`recovery`, and `preserved_resume`. Values are safe bounded integers and relation ceilings cannot
exceed the total parent ceiling. Custom coordination stores must attest the identical policy.

### TT2 — one typed refinement tree per Run

Every admitted task is projected as either a `root` or one of the five closed child relations.
Children must name an existing parent in the same Run. Self-refinement, ancestor cycles, unsupported
relations, and roots that claim a parent are refused. The projection records deterministic depth and
ancestor lineage; it never infers authority from provider prose.

Recovery and preserved-resume relations remain restricted to their dedicated atomic APIs. Generic
spawn cannot manufacture either relation. Review and oracle relations retain their existing
orchestrator-derived semantics.

### TT3 — prospective pre-effect admission

The coordinator previews topology before worker allocation, capacity reservation, worktree
creation, runtime creation, provider-turn admission, or adapter invocation. Store append and batch
paths independently revalidate the same facts, including recovery and preserved-resume batch hints.
At the exact policy boundary admission succeeds; the first row beyond depth, total fanout,
per-relation fanout, or per-Run count is refused without an event append.

### TT4 — replay is authority

Startup reconstructs topology solely from durable `task.created` facts and re-applies the current
deployment policy. A legacy dangling or cyclic refinement is not blessed by policy adoption: replay
fails closed with coordination-integrity evidence before writer use. Live and replay projections are
identical and sorted by task identity.

### TT5 — cascade visibility

Routine Run views stay concise. Advanced coordination inspection may expose the policy digest and a
per-Run task-topology projection containing typed parentage, depth, ancestors, child count, and
relation counts. Public handles expose only the selected task's topology row. This follows Baton's
outline-to-evidence cascade: agents do not have to manage topology coordinates during ordinary Run
work, but can inspect exact lineage when diagnosing recursion or recovery.

### TT6 — lifecycle-clean verification

Tests cover valid admission; dangling, self, cross-Run, unknown-relation, depth, total-fanout,
per-relation-fanout, and Run-count refusal; legacy replay rejection; deterministic projection; and
coordinator pre-effect behavior. Test workers are closed through public drain/authority-close paths,
so a green test cannot conceal leaked asynchronous provider or process authority.

## Deliberate boundary

This phase bounds tasks inside one Run. Cross-Run parentage, capability-attenuated child-Run leases,
and transitive descendant stop/reap are a separate authority slice; they must build on this phase and
must not be simulated by overloading `task.refines`.

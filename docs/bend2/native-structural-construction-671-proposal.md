# Native structural construction for #671

Status: successor proposal for six independent reviews before implementation.
This is the independently composable structural part of `a0ee30bb`. That
proposal and its original verdicts remain retained. Direct startup has a separate
repair and review boundary, described below. The read repair remains independently
owned and qualified.

## Commands and effects

```text
ensemble ENSEMBLE OWNER COUPLING [--section SECTION CAPABILITY]...
recruit PLAYER PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE
  --role player|associate-conductor
  [--ensemble ENSEMBLE OWNER]...
  [--section ENSEMBLE OWNER SECTION]...
```

Existing forms retain their behavior. The extended forms produce one native
result for the complete request. Any recruit extension requires explicit `--role`;
parent and harness remain explicit ordinary recruit arguments. Preserve all
currently supported harness assignments. These commands configure structure and
Git workspaces. They do not initiate model processes or deliver task input.

Options have fixed arity and literal string values. Reject unknown flags,
incomplete groups, repeated singleton options and invalid role/coupling values
before Git or structural effects. Coalesce identical repeated membership groups
and Section declarations. Conflicting capability declarations for one compound
`(ensemble, section)` key refuse the entire operation. Distinct Sections may have
the same local name in different Ensembles.

An Ensemble declaration requires its existing registered Conductor owner.
Coupling is explicitly `loose` or `tight`. A matching owner may update coupling
and each explicitly declared Section capability; omitted Sections and membership
remain unchanged. A different existing owner refuses before any change.
An empty Section capability refuses. Ownership is independent of membership.

Extended recruit registers one child and its explicit role. The parent must
already exist; the operation neither inserts nor promotes the parent. Every
named Ensemble/Section and owner must already exist and agree. A Section group
requests both prerequisite Ensemble membership and Section membership.
Membership additions are idempotent. Owners may differ from the recorded parent.
Grouping admission for stopped sessions remains the existing grouping policy.

An existing assignment must match parent, harness, model, effort, workspace,
branch and resolved base, using the existing assignment predicate over normalized
request values. It preserves native identity, endpoint and observed fields. A
stored explicit role must match the requested normalized role family; a conflict
names the ordinary `role` operation for an intentional change. An absent explicit
role row may receive the requested admitted role. This rule distinguishes initial
role declaration from overwriting a recorded promotion. Omitted memberships stay
unchanged. Matching structural retries return the recorded facts.

## Admission and transaction

Normalize the complete request before mutation. Use the existing SQLite
transaction boundary and materialize a connection-local TEMP decision before the
first structural write. The decision evaluates prestate plus normalized proposed
facts, including the new child's parent, requested role family and requested
Ensemble membership. Every structural write and the final answer consult this
same frozen decision. The TEMP object is discarded when the connection closes.
Its creation is a transaction-local coordination write, not a retained operation.

The decision covers every assignment, role, owner, coupling, capability and
membership clause. Extract shared expression forms from existing admission
helpers where needed, and define literal helpers through the same predicates.
Preserve existing standalone command admission and existing stopped-session
grouping behavior. Evaluate effective owner roles from proposed facts when the
operation creates those facts, and otherwise from stored facts.

`Store.commit` currently commits before refusal classification. Existing refusal
rows do not roll back preceding writes. Therefore each write must consult the
frozen decision, and the command must emit one final result. Actual SQLite errors
continue to roll back the transaction through the host. Register the new typed
refusal in `Store.refused`; a false admission exits 2 with code, failing condition
and a specific corrective native operation. A late invalid clause must preserve
all preexisting row values, not merely row counts.

## Git and registration phases

1. Parse and normalize. Read complete structural admission facts without changing
   them. Resolve the repository root and requested base commit; normalize the
   workspace argument through the ordinary recruit path rules. Reject known
   assignment, role, ownership and membership conflicts before Git creation.
2. For a new assignment, invoke existing Git worktree creation. For an existing
   matching assignment, inspect its recorded workspace, actual repository/branch
   and commit before claiming usability. Dirty work is reported and preserved.
3. In one transaction, revalidate structural admission against current facts and
   register assignment, role and memberships. Concurrent changes can cause this
   final check to refuse even after successful Git creation.
4. Return the actual completed phases in one typed result.

Git creation and SQLite registration have separate outcomes. Refactor Recruit's
self-printing helpers into typed internal results while preserving its legacy
entry behavior. A created branch/path remains present after registration refusal
or database failure. Report its resolved base and observed Git facts. A Git error
may leave partially created artifacts: inspect what is available and explicitly
mark unavailable/unknown observations if inspection itself fails. Preserve the
original Git error and inspection error separately. Never report absence merely
because inspection failed. Existing occupied paths require explicit operator
handling; a retry does not adopt or delete them.

The result distinguishes `preflightRefused`, `workspaceFailed`,
`registrationRefused`, `registrationFailed` and `configured`. It carries subject,
requested structure, committed structural facts when available, workspace phase,
retained path/branch/base and inspection outcome. Refusals exit 2; host failures
exit nonzero with the actual failing stage. Configuration success states that
startup was not requested. It provides ordinary inspection and dispatch guidance
without claiming readiness, task receipt or completed work.

## Discovery and MCP

Extend existing Ensemble and recruit MCP tools with typed Section/member groups
and explicit role. Each call maps to one native invocation. MCP performs argument
translation and preserves the complete native result and nonzero partial result.
It must not reproduce structural mutation sequences in JavaScript. Existing tool
defaults remain unchanged; an extended recruit requires the explicit parent and
role shown in the native grammar.

Help and supported receive/attached briefings explain Principal-owned Ensembles,
repeated sibling/nested Associate recruitment, cross-parent memberships, empty
Sections and multi-Player Sections using these ordinary commands. They identify
the recorded parent separately from Ensemble ownership/membership. Configuration
inspection uses `orchestra --index`, `player`, `worktree`, `ensemble` and `section`.
Task inspection uses native inbox/pending indexes and full `delivery` lookup.

The existing startup and dispatch commands remain available with their actual
supported harness behavior. Do not advertise the proposed future `dispatch-task`
or recruit `--start` before their shared ordinary-startup dependency is accepted.
This structural interface requires no input ID, task file or stdin consumption.

## Direct startup dependency

Test commit `920f9430` adds executable native counterexamples at
`bend2/test/direct-start-boundary.py`. Against captured native artifact
`4a58f2d585c2075c1be33ef5b953a0ad641815f222affb7fb20431d61bff1968`, both Muse and
Claude fixtures demonstrate changed-request replay under a completed ID and a
new endpoint after observer loss while the original endpoint remains responsive.
The live-worker lock refuses before loss. The test uses ordinary `dispatch-turn`
and `turn`, fresh Git/SQLite fixtures, retained process identities and endpoint
effects. The detailed evidence is retained through
`controls-next-671-direct-measured-audit-root-1`. This measures those cases only.

The startup repair must enter the real shared direct execution path, bind exact
request identity, prevent replacement of unresolved execution, and provide the
required observation/continuation. Future recruit startup and `dispatch-task`
reuse that repaired path. Pre-wrapper loss, selective observer recovery, keeper
failure and owner-notice custody require their own proof. Their source/design
questions do not add process effects to this structural operation.

## Implementation ownership and qualification

Within the existing `semantic-control-continuation` Ensemble:

- Controls-next owns the native structural operation design and implementation
  in its branch, including the new structural admission/result module and Recruit
  factoring. Its laws remain beside actual functions. It also owns the separate
  direct-start boundary test/design until a reviewed runtime assignment.
- The structure Section's `semantic-controls-structure-research` owns fresh Git
  and SQLite structural qualification in a new test file after review approval.
  Its existing actor and parent remain unchanged.
- The interfaces Section's `semantic-controls-interfaces-research` owns shared
  command/entry integration, MCP/help/briefing integration and translation tests
  in its recorded candidate branch. The current read repair has exclusive edit
  ownership there. Coordinate exact native module interfaces before those shared
  edits; do not edit its files concurrently from another branch on its behalf.
- Quality owns six independent exact-proposal and candidate reviews. Synthesis
  retains integration review; receive retains its terminal classification files.
  Root owns final gates, native landing and installation.

The native module, new host fixture and interface adapter work can proceed in
parallel after proposal approval with explicit file ownership. Shared command and
entry aggregation edits remain with the interfaces owner. No construction effects
are approved by this document or by read-repair acceptance.

Required native host cases: whole-request refusal preserving complete old values;
actual SQL-error rollback; exact retry and assignment/role/owner conflicts; late
membership refusal after changed preflight facts; cross-parent membership and
owner without membership; same-named Sections in different Ensembles; all harness
assignments; occupied branch/path; created worktree followed by registration
refusal/failure; Git artifact inspection failure; dirty matching workspace
preservation; native/MCP agreement for complete partial results. Operative laws
must reference actual parse, frozen admission, mutation and result functions.

Installed cold qualification constructs a Principal-owned Ensemble, sibling and
nested Associates, cross-parent members and Sections from product discovery using
fresh owned repositories. Retain commands, complete resulting structure and any
interventions. Full-body report discovery and ordinary dispatch are separate
observations; successful configuration alone establishes neither. Preserve the
registered substantive source handoff and root target/candidate regression gates.

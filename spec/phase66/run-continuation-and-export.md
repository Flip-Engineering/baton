# Phase 66 — Run continuation, recovery, and materialized export

Status: acceptance-red until every numbered contract below is implemented, adversarially tested,
canonically green, and recursively exercised through `BatonApplication`.

CE10 and CE11 lifecycle closure continues in
[`export-lifecycle-and-delivery-addendum.md`](./export-lifecycle-and-delivery-addendum.md), whose
CE13–CE18 contracts are part of this phase's acceptance surface.

Phase 65 completed the normal intent-to-reviewed-local-integration path. Phase 66 removes the next
three reasons an agent still has to fall through to kernel features: following a Run after a
disconnect, recovering an eligible native session, and obtaining the exact accepted result as
ordinary files. These are one continuation seam because all three consume the same Run identity,
deployment policy, authorization, cursor/evidence coordinates, and ownership projection.

The application remains a projection and workflow compiler over CoordinationStore, Coordinator,
Git, operational logs, Goal/Plan, and protected-result authorities. It is not another ledger.

## CE1 — one application vocabulary

The shared application registry adds:

```text
run.follow   run.recover   run.export
```

Direct embedding, authenticated Web, default MCP, CLI, and the browser Run desk derive command
names, capabilities, strict arguments, reconciliation, and `RunView` projection from this registry.
Advanced worker cursors, `Coordinator.recover`, Git plumbing, protected refs, export files, and
server paths are not ordinary caller inputs.

## CE2 — deployment-owned continuation policy

An immutable profile may independently enable:

- `followPolicy`: deployment-derived maximum wait duration, page size, response bytes, and scanned
  ledger prefix;
- `recoveryPolicy`: manual attach-only continuation, a bounded attempt count, timeout, eligible
  native session modes, and whether an ambiguous prior dispatch requires an operator decision; and
- `exportPolicy`: an explicit `directory-v1` materialization mode, deployment-derived file/byte
  ceilings, and configured adoption, semantic-review, and integration prerequisites.

Application deployment separately owns an export root and its filesystem authority. That root is
configuration, never profile or request data, and is not inferred from the repository, a worker
worktree, the process working directory, or a caller destination. An absent policy makes the
corresponding command unavailable before effects. Callers may narrow a request but cannot increase
ceilings, change the materialization format, select an arbitrary recovery worker/session, or name a
server filesystem path. Policies and their digests contain no credential values or filesystem
locations.

## CE3 — at-least-once Run follow cursor

`run.follow(runId, afterCursor, timeoutMs)` treats `afterCursor` as the caller's last durably
processed global coordination sequence. It returns the current bounded `RunView` plus one closed
follow page:

```json
{
  "schemaVersion": 1,
  "runId": "run-id",
  "afterCursor": 10,
  "throughCursor": 14,
  "observedUpperBound": 20,
  "hasMore": false,
  "timedOut": false,
  "terminal": false,
  "changes": []
}
```

Only the caller advances its durable floor, after processing the response. Repeating the same
cursor re-serves the same page. Baton never acknowledges on behalf of a disconnected caller.
Restart preserves coordinates because the append-only coordination ledger remains authoritative.

A cursor below zero, above the observed ledger, non-integer cursor, timeout above policy, or
response above policy refuses. Unrelated-Run events cannot enter changes. Baton may advance
`throughCursor` across an entirely inspected unrelated prefix so a busy sibling Run cannot starve
this reader; doing so acknowledges no caller processing and reveals no payload. If the configured
scan ceiling stops before the observed upper bound, `hasMore` remains true. If no relevant event or
unscanned prefix arrives before the deadline, the response retains the supplied cursor and sets
`timedOut`. Terminal Runs return without indefinite waiting.

## CE4 — bounded semantic changes, not raw leakage

Follow changes contain only coordination sequence, closed change category, durable event kind, and
a short application-authored summary/state. Raw event payloads, provider prose, credentials,
session IDs, filesystem paths, Git ref names, command envelopes, and other Runs are absent.

Run attribution is derived server-side from Goal/Plan/run/task/artifact authorities. A payload's
claimed `runId` is insufficient when it contradicts the durable task or Plan. Bounded paging never
drops a relevant change: `hasMore` holds and `throughCursor` stops at the last inspected event.

## CE5 — transport follow behavior

Authenticated Web and MCP expose one bounded long-poll call; neither holds an unbounded stream or
creates a second cursor store. The CLI supports:

```text
baton run status RUN_ID --follow [--wait DURATION]
```

It starts from a displayed or explicit cursor, prints each fully received page, advances locally
only afterward, and reconnects with the last acknowledged cursor. Browser follow is an explicit,
cancellable Run-desk mode and keeps the advanced raw-event SSE trace separate.

## CE6 — Plan-authorized recovery target

`run.recover(runId)` is available only when the immutable profile and approved Plan commit recovery
authority. Baton server-selects exactly one eligible orphaned Plan worker from durable Run/task
lineage. Zero eligible targets returns an actionable unavailable state; more than one, an ambiguous
prior dispatch, an in-flight prior turn without vendor idle testimony, or contradictory lineage
returns `operator_required`. The caller cannot supply worker, native session, context, route,
process, worktree, or Brief coordinates.

The recovery request binds Run, Goal/Plan/approval, node, prior task and accepted state, worker,
persisted native session/context digests, requested/resolved route, profile/policy digest, attempt,
timeout, and actor in one durable admission before provider effects. Stop admission, Plan change,
result integration, session/context drift, or exhausted attempts fences recovery.

## CE7 — reuse Phase 60 attach-only order

The application invokes a dedicated Plan-bound Coordinator recovery entrypoint. The public/internal
ordinary `Coordinator.recover` guard remains unchanged for callers without a validated recovery
admission. The entrypoint reuses Phase 60's exact order:

1. validate replayed orphan, native context, route, reservation, and Run recovery admission;
2. start only the attach-only handshake and verify exact provider session identity;
3. atomically create/claim a bounded recovery refinement linked to the approved Plan node;
4. durably bind the continuation intent before sending the authoritative Brief;
5. record `dispatch_accepted`, typed `dispatch_refused`, or `dispatch_unknown`; and
6. expose working state only after the admitted continuation and current stop fence agree.

No recovered Brief, model/tool call, or edit crosses the wire before the refinement and intent
authorities required by Phase 60. Missing or mismatched identity kills and reaps the untrusted fresh
generation.

## CE8 — recovery replay and operator truth

An exact retry coalesces or returns the durable disposition; changed actor, timeout, policy, target,
session, context, route, or Plan conflicts. Restart reconciles a pre-effect pending admission, but
never automatically redelivers `dispatch_unknown`. RunView shows recovery eligibility, attempt,
target state, dispatch disposition, exact requested/resolved/observed route, process generation,
and cleanup. It does not imply that a local adapter write means provider acceptance.

`run.stop` wins against pre-dispatch recovery and reaps the exact attached generation. Deployment
shutdown includes admitted, attached, accepted, refused, and ambiguous recovery generations.

## CE9 — evidence-bound materialized export

`run.export` requires a fresh displayed evidence digest and the exact active accepted result. It
also enforces the configured adoption, semantic-review, and integration prerequisites. Export reads
the accepted Git object through the protected result authority; it never reads a disposable worker
worktree or the mutable checkout. Immediately before materialization it re-resolves the protected
result and proves that it still names the evidence-bound accepted commit.

The application creates one deterministic content-addressed `directory-v1` export under its
deployment-owned root. The completed export consists of an exact `tree/` materialization plus a
canonical manifest beside it. The manifest binds repository, Run, Goal/Plan, node, accepted commit,
accepted root-tree object, evidence, adoption/review/integration receipts required by policy,
profile/policy digests, every ordinary file path/mode/blob/digest/size, totals, and export identity.
Its file list is the accepted Git tree: every tracked ordinary file is present exactly once and no
checkout metadata, untracked file, ignored file, worker residue, or mutable-repository content is
present.

The public receipt contains export ID, an opaque export locator, Run/node/result coordinates,
`directory-v1`, accepted tree object, byte/file counts, manifest digest, and state. The locator is
an application identifier, not a relative or absolute path. The receipt omits the export root,
internal directory name, protected ref name, credentials, and private runtime data. Export does not
adopt, integrate, push, publish, deploy, mutate the accepted commit, or mark an incomplete Run
complete.

## CE10 — export filesystem and restart safety

Before materialization Baton validates the accepted commit and tree, configured root ownership,
canonical root containment, and the complete recursive Git tree against the policy ceilings. Only
Git modes `100644` and `100755` are exportable in `directory-v1`; symbolic links, gitlinks,
submodules, devices, sockets, FIFOs, path traversal, absolute paths, duplicate or Unicode-confusable
manifest paths, and filesystem links encountered under the export root fail closed. Executable mode
is preserved. Files are streamed from exact blob objects and their object identity, bytes, digest,
and size are rechecked; Baton never invokes `git checkout` into the export root.

Baton builds an exclusive temporary sibling directory under the configured root, writes only
contained files with create-new semantics, fsyncs the files, manifest, and directories where
supported, and atomically renames the complete directory to its content-addressed target. No
partially built location is a completed export. Existing content is reusable only after every
manifest field and every materialized path, type, mode, size, and byte digest is reverified against
the durable receipt and accepted Git objects. Extra entries or any mismatch fail closed.

Admission and completion are a two-phase coordination transaction. A crash before filesystem
effect retries from accepted Git objects; a crash after atomic rename but before completion
re-verifies the exact directory and completes the same export without creating a different artifact.
Changed evidence, accepted result, required receipt, profile/policy, or materialization identity
conflicts. Concurrent exact requests coalesce on one admission and one immutable directory. Failed
or superseded accepted artifacts, stale semantic reports, stale adoption, stopped Runs, and
invalidated results cannot create or serve an export.

## CE11 — authenticated delivery without server-path authority

Direct embedding, Web, and MCP return the same immutable completed-export receipt and never return
the deployment root or internal materialization path. A later delivery projection may derive a
deterministic bounded archive from a reverified completed `directory-v1` export; that archive is
transport data, not a second accepted-result or export format.

Web exposes that projection only through an authenticated, no-store, repository/Run/export-
authorized download endpoint for completed export IDs. It streams the exact bounded archive with
digest and attachment metadata and refuses range/path/header injection. MCP returns the immutable
export reference and digests rather than embedding unbounded directory or archive bytes. The
browser offers a download only for an active completed receipt.

The CLI supports:

```text
baton run export RUN_ID DIR
```

It requests the server materialization, downloads the deterministic transport archive, verifies the
advertised archive and manifest digests before extraction, rejects absolute/traversing/link/special
archive entries, proves the extracted files against the manifest, writes into a newly created or
explicitly empty destination, and leaves a failed extraction non-authoritative. It never asks the
server to write a client-supplied path.

## CE12 — adversarial and recursive proof

Acceptance tests cover:

- duplicate, stale, ahead, cross-Run, paged, timeout, terminal, restart, and response-loss cursors;
- Web/MCP/CLI/browser parity, disconnect/reconnect, authorization revocation, and byte ceilings;
- absent/exhausted/ambiguous recovery, exact successful attach, wrong identity, same-call races,
  stop races, dispatch unknown, restart at every boundary, and complete process/worktree/runtime
  reap;
- stale evidence, unadopted/unreviewed/unintegrated results when required, invalidated artifacts,
  Git tree file/byte overflow, executable-bit preservation, exact tracked-tree equality, symlink,
  gitlink and traversal attempts, root replacement, extra target entries, existing-target
  substitution, append failure, response loss, restart at both transaction boundaries, and
  concurrent export coalescing; and
- command/card/progress/RunView consistency without raw paths, refs, sessions, or credentials.

Recursive proof uses `BatonApplication` itself in a credential-filtered disposable repository,
exercises follow across at least one real provider turn, performs one eligible exact native
recovery when provider support is available, exports the accepted result through the application,
proves the completed deployment-owned directory exactly equals the accepted Git tree, verifies a
derived authenticated delivery archive in a clean client target when that projection is available,
and proves every admitted provider generation and Baton worktree/runtime was killed or naturally
closed and reaped. Concurrent Grok routes remain a separate retained five-provider acceptance gate;
this phase must not fake them when authentication is unavailable.

The proof is evidence only for exercised routes and formats. No homelab or external project-manager
integration is part of this phase.

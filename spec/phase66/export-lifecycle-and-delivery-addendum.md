# Phase 66 addendum — export lifecycle and delivery closure

Status: acceptance-red. This addendum sharpens CE10 and CE11 of
`run-continuation-and-export.md`; it does not weaken or replace them. The first implementation slice
is the publication/stop/restart lifecycle. Deterministic archive derivation, authenticated Web
delivery, and safe client extraction remain explicit later reds in this same addendum.

## CE13 — one deployment-owned export lifecycle authority

One deployment-owned lifecycle authority owns export-root validation, temporary names, atomic
publication, startup reconciliation, archive temporaries, active delivery registrations, and
shutdown cleanup. `BatonApplication`, `Coordinator`, and transport projections do not each invent
their own filesystem cleanup or publication rules. The authority holds a root lease and binds every
operation to the root device, inode, owner, mode, and canonical path observed when the lease was
acquired. A changed root or lost lease fails closed.

Temporary materializations use the exact reserved grammar
`.tmp-<64-lower-hex-export-id>-<uuid>`. Quarantine names and archive temporaries have separate
closed grammars. No scan, cleanup, or recursive walk treats an arbitrary root entry as lifecycle
owned merely because its name begins with a dot. The staging UUID is durably bound to the export
admission before its directory is created; an export ID without that exact replayed nonce is not
ownership proof.

The materializer exposes an injectable no-replace publication seam for deterministic acceptance
testing. Production uses the lifecycle authority's implementation of that seam; callers cannot
select it through Direct, Web, MCP, CLI, a profile, or a Run request.

## CE14 — atomic no-replace publication

Publication is one atomic no-replace operation. On Linux it has `renameat2(RENAME_NOREPLACE)`
semantics; on macOS it has `renamex_np(RENAME_EXCL)` semantics. An implementation that performs
`exists` followed by ordinary `rename`, or that replaces an empty destination directory, is not
equivalent. A deployment lacking a proved no-replace primitive refuses publication rather than
silently degrading.

Exactly one of these outcomes occurs:

1. the complete temporary directory becomes the final content-addressed name;
2. an occupied final is left byte-for-byte and inode-for-inode unchanged, then fully reverified as
   the expected export and reused; or
3. publication fails closed and the occupied final is quarantined for operator attention when its
   identity can be moved safely.

An occupied final is never overwritten or recursively removed. Cleanup removes only a recorded
temporary inode created by the current lifecycle lease. Root and temporary identities are checked
again before publication and before cleanup. Root-directory fsync occurs after publication where
supported.

## CE15 — stop linearizes with publication and completion

Export admission, the final publication boundary, export completion, integration, Run-stop
admission, archive construction, and delivery registration share one per-Run operation arbiter.
The in-memory promise map is a coalescing optimization, not the authority. The CoordinationStore's
single writer provides the durable ordering boundary.

The two legal orderings are exact:

- `run.result_export_completed` before `run.stop_admitted`: the export remains completed and
  immutable, stop may proceed, and every later delivery request refuses because the Run is stopped;
- `run.stop_admitted` before export completion: that event is the cancellation authority for the
  exact replay-derived set of pending exports, each export becomes terminal `cancelled`,
  publication/delivery authority is revoked, and a late completion returns a closed stop/cancelled
  refusal rather than resurrecting the export.

Stop admission therefore never leaves an export in durable `pending`. A cancelled row binds the
export admission and stop-admission event and carries physical-cleanup state. Stop completion waits
for owned materializers, archive builders, and streams to exit and for owned temporary cleanup to
finish or produce an explicit quarantine receipt. A directory published before its completion lost
the race is non-servable and must be inode-safely removed when proved lifecycle-owned or quarantined
when it cannot be proved safe to remove.

Materialization checks the arbiter immediately before inventory, temporary creation, publication,
and completion. The check immediately before publication and stop admission participate in the
same critical section; two unrelated check-then-act operations are insufficient.

## CE16 — restart converges staging and cancelled exports

Startup acquires and validates the export-root lease before application export reconciliation. It
performs a bounded, deterministic, bytewise scan of the reserved staging namespace and joins every
candidate to replayed durable export state:

- a proved lifecycle-owned stage for `pending` or `cancelled` export state is removed and the exact
  export may later be rebuilt only when it is still pending and the Run is not stopping;
- a proved stage beside an exactly verified completed final is removed;
- an unknown, malformed, link, special, wrong-owner, wrong-inode, or otherwise unproved candidate
  is never traversed or deleted and is moved with no-replace semantics into the quarantine namespace
  when safe; otherwise it remains in place with an operator-visible quarantine record; and
- unrelated root entries are untouched.

The reconciliation result lists examined, removed, retained, and quarantined basenames plus closed
reason codes; it exposes no server path. Repeating startup reconciliation is idempotent. After
replay, a stopped Run has zero `pending` exports. It may have a terminal cancelled export with
cleanup pending, but that row is never materialized or served. Reconciliation always converges each
admission to completed, cancelled, or operator-quarantined state rather than retrying forever.

## CE17 — retained deterministic delivery reds

The lifecycle slice is not CE11 completion. These remain acceptance-red and must stay visible in
the active Goal/Plan until implemented and recursively exercised:

1. a versioned deterministic archive derived only from an exactly reverified completed
   `directory-v1` export, with sorted entries, fixed metadata, no links/specials/xattrs/ACLs, a byte
   ceiling, and an advertised archive digest and size;
2. an authenticated, short-lived, export-scoped, no-store Web download authorization that
   reauthorizes before response headers, rejects range/path/header injection, registers the active
   stream with the Run arbiter, and returns no server path;
3. MCP returning only the bounded immutable receipt and delivery descriptor rather than archive
   bytes;
4. browser download affordance only for a currently authorized active completed receipt; and
5. `baton run export RUN_ID DIR` downloading to a private temporary file, verifying archive and
   manifest digests before extraction, preflighting the entire closed archive, extracting with
   create-new/no-follow semantics, proving every output against the manifest, and publishing an
   absent client destination with atomic no-replace semantics.

The first safe CLI contract requires an absent destination. Support for a caller-selected existing
empty directory remains red until Baton has an explicit destination ownership and completion
protocol; emptiness alone is not atomic authority.

## CE18 — focused acceptance proof

The first lifecycle acceptance slice proves, with deterministic seams rather than timing sleeps:

- an occupied empty final cannot be replaced at publication;
- publication and stop have both legal durable orderings and no third `pending` outcome;
- a late completion after stop cannot resurrect or serve the cancelled export;
- replay reconstructs the same cancelled state with zero pending export work;
- startup removes only proved staging for known pending/cancelled exports, quarantines unknown
  reserved-name entries, and leaves unrelated root entries unchanged; and
- repeated startup reconciliation and deployment shutdown leave no unreported lifecycle-owned
  temporary state.

Later CE17 proof adds deterministic archive equality, authorization revocation before headers and
during streaming, disconnect/stop/shutdown abort, hostile archive extraction, and clean-client
recursive dogfood.

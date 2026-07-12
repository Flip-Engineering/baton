# Phase 39 advisory/TTL invalidation evidence — 2026-07-12

## Outcome

Phase 39 closes the stale reuse-authority gap without inventing a provider push service. The sole
`Coordinator.recheckReuseDecision` control accepts only an exact decision/version and the closed
trigger `advisory_refresh|ttl_expired`. Deployment configures distinct contextual recheck
authorization. Web `reuse_recheck` and MCP `fleet_reuse_recheck` derive their actor and repository
authority; callers cannot supply advisory IDs, source refs, timestamps, targets, or verdicts.

Advisory mode derives the exact npm coordinate and Atlas epoch from the immutable decision, forces
Quartermaster `reuse.vet(refresh:true)`, reverifies its content-addressed dossier and official raw
sources, and maps one Coordinator-authored risk observation. The coordination store then derives
the complete matching live target set at its synchronous append boundary. An adverse event
atomically installs a permanent exact-coordinate fence, invalidates every stale Decision and its
dossier Finding, records affected readers, and creates one derived risk Finding with `Affects`
edges. A decision committed before the fence is included; stale evidence presented afterward is
refused. Fresh blocked evidence may support an explicit `build`; borrow remains fenced. A later
green check never silently clears the fence or resurrects a Decision.

TTL mode performs no network work. Current lookup and recall hide a Decision exactly at its stored
expiry even before the durable write. The explicit event then closes the Decision and stale dossier
Finding at that exact validity time while preserving decision/evidence artifacts and historical
subject lineage for an explicit version-CAS `Supersedes` replacement.

## Adversarial closures

- store-derived coordinate fan-out closes advisory-refresh versus stale-green decision races;
- the fence is consulted both before Coordinator reverification for borrow and again during the
  authoritative store append;
- exact retry preflights before refresh, while same-key/different request conflicts;
- second-key/same-decision identity is durably aliased, preventing repeat reverification on retry;
- supersession contamination readers are recomputed inside the store instead of in async caller
  state;
- invalid/generic-invalidated/expired subject heads cannot leak through current lookup, but remain
  historically addressable;
- an exact read retry returns its immutable original snapshot and is explicitly labelled historical,
  rather than rehydrating expired or newly invalidated current objects;
- an in-flight refresh accepts its immutable seed as an evidence anchor, derives targets only at the
  append boundary, and closes a same-subject replacement at append time without an inverted validity
  interval;
- active guards advance monotonically; a same-time or older observation cannot overwrite them;
- replay recomputes the actor/repository/decision/version/trigger request identity and binds the
  expected CAS version into authoritative operational evidence;
- a repeated adverse refresh with the same semantic fact may advance the dossier observation
  without hiding or graph-invalidating an exact `build` already grounded in that fact;
- replay recomputes source mapping, actor, timestamps, coordinate, recommendation, target set,
  full refreshed dossier projection, target-set/review digests, validity versions, graph identities,
  immutable read snapshots, and reader projections;
- final append failure exposes neither fence nor validity mutation; orphan raw/mapped evidence is
  non-authoritative;
- green checks do not clear adverse state; provider push/webhook/polling and positive clearance are
  explicit later contracts.

## Verification

- RI1–RI12 focused suite: 16/16.
- Phase 36/37/38/39 dependency gate: 42/42.
- Coordination/web/MCP regression gate: 70/70.
- Canonical owner-managed suite: 871/871.
- `git diff --check`: clean at handoff.

## Live evidence

`docs/reference/evidence/phase39-advisory-ttl-live-2026-07-12/` uses a clean temporary Git repo,
Baton's actual lockfile, and current official deps.dev/OSV observations for pinned
`@ast-grep/napi@0.44.1`. Six official requests cover the original dossier and a forced refresh.
All 10 checks pass: current green evidence, actual lockfile, immutable decision, forced checked
refresh, no green-created guard, expiry-safe lookup before write, durable exact-time TTL closure,
byte-equivalent replay, explicit non-authority, and clean source tree. No credential is read.

## Recursive Baton friction evidence

`docs/reference/evidence/phase39-advisory-invalidation-scope-grok-2026-07-12/` attempted exact
`grok-4.5` and `grok-composer-2.5-fast` concurrently at low effort through Baton. Both exact route
tuples were admitted, but Grok Build returned `Authentication required` before provider spawn; the
local `~/.grok/auth.json` existed but was no longer accepted. Baton truthfully failed the run and
confirmed both workers dead, with every process, worktree, metadata file, runtime scope, and branch
reaped. The failed reports are not used as design evidence. This is a live authentication-lifecycle
friction, not a claimed successful multi-Grok review.

## Honest boundary and next order

Phase 39 is explicit pull-to-refresh plus deterministic TTL closure, not a provider feed listener.
The adverse fence is revocation-only in this rung. Policy-hash invalidation, provider-specific
daemon/webhook ingestion, positive clearance, additional ecosystems, proposed install graph/delta,
true vulnerable-function reachability, optional Socket, and independent Sigstore/SLSA verification
remain explicit. The store remains a single-process writer. No installer, package manager,
lockfile/code mutation, merge, verification acceptance, publication, policy override,
project-manager export, or homelab integration is introduced.

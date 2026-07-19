# Phase 89 post-fix command-port, AX, and resident-host review

Date: 2026-07-19  
Role: independent post-fix-command-port-and-AX reviewer  
Scope: the two Phase 89 specifications, the resident-application assessment and prior reports,
`application.mjs`, `application-client.mjs`, `application-deployment.mjs`,
`application-cli.mjs`, `application-host.mjs`, `web-northbound.mjs`, the current coordination
writer lease, the CLI entry point, and both Phase 89 test files. No nested Baton was invoked.

## Verdict

The assessment is substantially honest: the first application slice is useful and Phase 89 is
still acceptance-red. Five of its seven concrete post-fix claims are confirmed in their stated
narrow scope. Attach validation and progress timing are only partially confirmed. The green tests
do not establish an ordinary resident host.

Do not promote the advanced HTTPS fixture seam into the ordinary API unchanged. It has no resident
identity, incarnation, local transport, credential issuer, authenticated self-challenge,
publication transaction, or stale-cleaner fence. It also has two cleanup-truth defects: a failed
`publishConnection` leaves the listener live with a permanently rejected start promise, and
`BatonDeployment.close()` discards a degraded Web-close result when application shutdown succeeds.

The smallest safe next vertical is one deployment-owned `ResidentOwner` underneath
`openBaton().host()`. It should reuse the existing application, Web command admission, session
store, semantic registry, and deployment writer authority; it must not create a second application
or ledger. Ordinary `host()` starts and verifies the resident in one call. `connectBaton()` returns
the same high-level Runs surface over a two-argument command port. Only `owner.close()` owns whole
deployment shutdown.

## Claimed post-fix properties

| Assessment claim | Verdict | Source and boundary |
| --- | --- | --- |
| Authorize Runs before applying the visible catalog ceiling | **Confirmed** | `BatonApplication.listRuns()` now builds the ordered repository set, calls `run.status` authorization for each candidate, then applies `MAX_RUN_LIST_ITEMS`. RA12 proves 64 visible plus one hidden Run succeeds and becomes continuation-required only when the hidden Run is authorized. This fixes the prior count/ceiling defect. It does not provide opaque continuation, active/attention-first ordering, or hidden-cardinality timing parity; all candidates are still traversed. |
| Apply exact-route readiness equally to `deployment.runs.start()` and `deployment.run()` | **Confirmed** | `BatonDeployment` wraps `runs.start` with `assertRouteReady`; `run`, `startMany`, and workflow team routes use the same gate. RA13 proves the two ordinary single-start paths fail before Run admission. |
| Derive local repository identity from the Git common directory and require selector/card/session agreement | **Confirmed for repository identity; not a generation challenge** | `repositoryIdentityFromMetadata()` hashes the real Git common directory; `connectBaton()` compares it with the selector, `BatonWebClient.session()` requires session membership, and the final handshake requires the application card's `repoId`. RA10 covers local-selector and card-selector mismatch. V1 selector/profile data still has no stable deployment ID or fresh incarnation, so stale same-repository takeover remains possible and is not claimed fixed. |
| Refuse redirects and bound Web JSON response waits and bytes | **Confirmed narrowly; resource bound is incomplete** | `BatonWebClient._json()` uses `redirect: 'error'`, an abort deadline, declared-length rejection, and a 2 MiB post-read check. RA11 covers the options, declared oversize, and actual oversize. However `response.text()` materializes the whole body before measuring it, so a hostile streaming response can still consume unbounded memory before refusal. Export download and setup reads are outside this JSON claim and retain separate gaps. |
| Validate attached outline schema, Run identity, registry identity, view digest, and bounded semantic fields | **Partially refuted** | `BatonRuns.attach()` validates top-level schema version, requested Run ID, depth, digest shape, terminal flag, outline object, objective, and phase. It accepts a response with **no** `registryDigest`, because registry comparison is conditional on the field being present. It also does not validate an outline-level Run ID, action/timing shapes, or reject unexpected outline fields. The connected handshake checks the registry once, but the claimed per-attach registry validation is not exact. RA3/RA6 never omit or corrupt this field. |
| Centralize stable Run timing and exclude volatile observation time from semantic identity | **Confirmed only for the tested stability property** | `_progressTiming()` is shared by outline and list projection, durations saturate at zero, and timing is added after `viewDigest` is computed. RA8/RA9 prove clock-only no-digest-churn, hostile-clock clamping/refusal, and terminal restart stability. The full semantic claim remains red: every projection rescans all coordination events; `lastProgress.stage` and `.summary` come from the current view rather than the event that advanced progress; `completedAt` is the last classified event rather than a persisted terminal transition; stage-start/elapsed and a durable progress cursor are absent. |
| Expose only an explicit advanced loopback HTTPS host seam and keep ordinary hosting unavailable | **Confirmed** | `BatonDeployment.host()` rejects calls without `advanced`, requires caller-asserted authenticated HTTPS, a loopback listen host, a canonical HTTPS loopback origin, and a drain interval. `impl/scripts/baton.mjs` explicitly refuses ordinary `baton serve`. RH2 proves wildcard/cleartext/unauthenticated configurations fail before its fake listener binds. This is not resident-host evidence. |

The assessment's “27/27” count is consistent with 13 top-level application tests plus their nested
cases (23 total) and four host tests. Its “2,183/2,183” complete-suite statement is retained as
prior evidence, not independently upgraded by this review's pinned bare-`node` verifier.

## Concrete post-fix defects and risks

### 1. The client-facing command port is still signature-erasing

Direct handles call `application.command(name, args, principal)`. Connected handles are made safe
only because `bindBatonPort()` installs a two-argument closure that ignores the dummy principal the
same handles still pass. Meanwhile the public low-level `BatonWebClient.command(name, args,
idempotencyKey)` uses the third position for a different authority coordinate.

RA6 correctly proves that `{kind: 'bound-command-port'}` does not become a Web idempotency key, so
there is no current exploit on that path. The architecture claim is nevertheless false: there is
not yet one explicit client port. A later refactor or alternate port can turn a principal object
into an idempotency coordinate, or accept client authority that should have been closed over.

The next slice should make `command(name, args)` the only interface known to `BatonClient`,
`BatonRuns`, and `BatonRun`. A direct adapter closes over the owner principal. A resident adapter
closes over the authenticated session, exact envelope, idempotency/reconciliation state, and local
transport. Raw `BatonApplication.command(..., principal, context)` stays internal.

### 2. Advanced host startup has no rollback transaction

`BatonDeployment.host({advanced})` stores its handle before startup. `start()` listens first and
then awaits `publishConnection`. If publication throws, no code closes the listener, retracts a
partial publication, or resets `startPromise` for a fresh attempt. A second `host()` call returns
the same poisoned handle before validating its new options. RH1 covers only a successful fake
publisher.

Ordinary hosting needs an explicit acquisition journal and reverse-order rollback. No selector or
profile may become discoverable before the listener passes the authenticated challenge. A failed
attempt must close only the listener/session/socket/temp files it created, leave the owner
application and writer authority usable, clear the in-flight host promise, and use a fresh
incarnation on retry.

### 3. Web-close degradation is hidden

`BatonWebHost.shutdown()` correctly returns `{state, web, application}` and marks Web failure as
`closed_degraded`. `BatonDeployment.close()` then maps that value to `closed.application`, losing
the Web result. Thus a listener timeout, stream shutdown failure, or export-delivery shutdown
failure can be reported by both `host.close()` and `deployment.close()` as a clean application
close. RH1 tests only the successful case.

The current composite host also always shuts down the application. That is acceptable for the
advanced deployment-owned fixture but is the wrong primitive for reusable lifecycle composition.
Split listener shutdown from application shutdown. The resident listener owns Web admission and
drain only; `BatonDeployment.close()` is the sole whole-application owner and joins exactly one
close operation. Its ordinary result should be a safe state/help outline, not the current driver
receipt and worker-ID inventory. Exact receipts remain internal/advanced evidence.

### 4. Current writer fencing cannot survive PID reuse

`CoordinationStore.claimWriterLease()` records `{pid, token, acquiredAt}`. Existing-owner recovery
uses `process.kill(pid, 0)` alone; it has no process-start identity, deployment ID, or incarnation,
and it does not challenge the resident endpoint. PID reuse therefore strands a stale lease as a
false live owner. Conversely, a dead PID is enough to authorize unlinking the lease without an
authenticated endpoint check. This is the precise RD7/RD8 gap acknowledged by the matrix.

The lease also reads existing lease/claim paths without the owner/mode/non-symlink/fstat checks used
by connection-file reads. It generally fails closed on malformed JSON, which is good, but it is not
the file authority required for resident takeover.

### 5. Current file helpers are insufficient for resident authority

`readBoundedFile()` gives selector/profile/token reads useful no-follow and inode checks, but
discovery does not require owner-only permissions for the repository selector and does not validate
every parent directory. `privateDirectory()` and `WebSessionStore` create/chmod paths and then
resolve/use them without first rejecting a pre-existing symlink; these helpers must not be reused as
the resident security boundary unchanged. V1 profiles may point their token file at any absolute
owner-only file. They remain readable for compatibility, but a v2 host must publish only a bounded
relative credential coordinate under its validated private root.

### 6. Stale generation and close ownership are not challenged

The current selector binds only profile and repository. The profile binds URL/origin/token-file but
not deployment or incarnation. `connectBaton()` can therefore authenticate to any ready replacement
with the same repository/profile without detecting a generation change. That is acceptable only as
the explicitly incomplete v1 compatibility path; it does not satisfy RD10, RR9, or the mutation-
generation rule.

Connected clients do not receive `application.shutdown`, which is correct. The new resident owner
must preserve that rule while ensuring that an old close cannot revoke a successor's token, unlink
its socket, replace its profile, or remove its selector.

## Smallest ordinary resident vertical

### Ordinary surface

Keep the application-shaped API and remove start choreography:

```js
const owner = await openBaton({ repo: '.' });
await owner.host();                 // starts, self-challenges, then publishes
const run = await owner.runs.start('Fix replay ordering', { exact });

const baton = await connectBaton({ repo: '.' });
const listed = await baton.runs.list();
const attached = await baton.runs.attach(listed.items[0].id);

await owner.close();                // only local owner has resident-close authority
```

`host()` joins an in-progress or ready start for this owner and returns a compact non-secret outline,
for example `{schemaVersion: 1, state: 'ready', application: {repoId, deploymentId}, startedAt,
helpTopic}`. It does not return a start handle, address, socket path, token, session, lease, PID,
budget, capacity, limit, or receipt. `connectBaton()` returns `BatonClient`, not a transport or
connection record. Advanced network/listener assembly remains explicitly separate.

### Invariants

1. **One authority graph.** One `BatonDeployment` owns one `BatonApplication`, one coordination
   writer, one resident listener, and one resident-session issuer. Hosting never opens another
   deployment, coordination store, Run ledger, or attachment ledger.
2. **Stable deployment, fresh process identity.** An owner-only durable record binds
   `{repoId, deploymentId}`. Every new owner process/host attempt gets an unpredictable
   `incarnation`. The writer lease binds both plus an OS-derived process-start identity and a random
   private fence. PID liveness alone grants nothing.
3. **Fail-closed takeover.** A matching PID and process-start identity plus a successful
   authenticated endpoint challenge proves a live owner. PID/start mismatch never authorizes a
   signal. Replacement requires both failed endpoint challenge and serialized acquisition of the
   writer fence. Malformed, oversize, unreadable, unsafe, or ambiguous state authorizes no deletion.
4. **Private local transport.** The default is a Unix-domain socket inside a validated owner-only
   runtime directory. The socket is verified as a socket, owned by the current UID, and mode 0600
   after bind. No TCP fallback exists. Platforms unable to prove these properties return a typed
   unavailable error.
5. **Private session authority.** A durable `WebSessionStore` holds only hashes. Host startup issues
   one bearer session scoped to this repository and incarnation; the raw value is written only to
   an owner-only v2 credential file. It never appears in argv, environment diagnostics, logs,
   repository content, errors, cards, outlines, or close results. Rotation/revocation is fenced by
   incarnation.
6. **Readiness precedes publication.** Application/driver recovery, session health, listener bind,
   socket verification, registry capability, and authenticated card/session/resident challenge all
   succeed before any active selector/profile is installed. `/healthz` remains non-disclosing and
   `/readyz` remains false until this boundary.
7. **Authenticated exact challenge.** The self-check and `connectBaton()` require
   local-Git ID = selector repo ID = profile repo ID = card repo ID = session membership, plus exact
   deployment ID, incarnation, semantic-registry digest, required command set, readiness, and
   unexpired observe authority. Endpoint identity is re-statted across the challenge. Failure occurs
   before any application command.
8. **Immutable incarnation resources plus CAS publication.** Socket and credential material live in
   a newly created per-incarnation directory. Mutable selector/profile records carry deployment ID
   and incarnation. Publish and unpublish require the current writer fence and exact record
   identity. An old process may remove only its immutable directory; it cannot touch a successor's
   active records.
9. **Exact ownership and honest close.** Close first stops new admission and drains bounded Web
   requests, then reconciles application-owned work, revokes the resident session, removes only the
   current incarnation's publication/socket, and finally releases writer authority. Any failed step
   returns degraded and retains the recovery coordinate/fence needed to retry. Web degradation is
   never collapsed into application success.
10. **Ordinary projection privacy.** Runs/list/attach/help/error/host/close surfaces expose semantic
    state only. Deployment policies and internal transport, file, session, process, lease,
    idempotency, cleanup, and receipt coordinates remain behind the port or explicit advanced
    evidence.

### Implementation seams

1. **`PrivateResidentFs`** — one small module for validated directory/file/socket operations. It
   walks existing parents without following symlinks, verifies current UID and exact modes, opens
   regular files with no-follow, compares lstat/fstat device+inode, enforces byte/schema ceilings,
   writes with exclusive temp files plus file and directory fsync, and never chmods/deletes an
   uncertain pre-existing object.
2. **`ResidentIdentityStore`** — persists the stable deployment record and creates an incarnation.
   Inject a `ProcessIdentityProvider` with platform implementations that return a kernel-derived
   process-start coordinate; refuse resident hosting where it cannot be proved.
3. **Upgrade, do not duplicate, the writer lease.** Extend the coordination lease payload and
   in-memory fence to bind `repoId`, `deploymentId`, `incarnation`, PID, process-start identity, and
   private fence. The deployment already acquires writer authority during `openBaton()`; ordinary
   `host()` asserts and carries that exact lease rather than claiming a second host lease. A
   concurrent `openBaton()` loser may return typed busy, as RD6 permits.
4. **`createAuthenticatedLocalServer()`** — reuse `WebNorthbound`, durable Web command admission,
   `WebReadinessAuthority`, and `WebSessionStore`, but bind an HTTP parser to the private Unix socket
   through a server-created local-transport marker that request headers cannot forge. The existing
   HTTPS/trusted-proxy constructor remains unchanged for advanced network mode.
5. **`LocalResidentCommandPort`** — perform bounded, no-redirect JSON requests through `socketPath`
   internally and expose only `command(name, args)`. It owns bearer loading, envelope identity,
   idempotency, and reconnect state. Refactor all high-level clients to this same two-argument port;
   add a direct owner port closing over the local principal.
6. **`ResidentOwner` state machine** — `idle -> starting -> ready -> closing -> closed|degraded`.
   It owns the startup acquisition journal, authenticated self-challenge, atomic publication, and
   CAS cleanup. Concurrent calls join the state promise. Failure before ready reverses only this
   attempt and returns to `idle` with a fresh incarnation available for retry.
7. **V2 selector/profile/credential records.** The Git-common selector is non-secret and contains
   only repo/deployment/incarnation/profile and endpoint kind. The owner-private profile uses a
   bounded relative incarnation coordinate, never an arbitrary absolute token/socket path. Keep v1
   profiles readable, but label them generation-unbound and never rewrite them silently.
8. **Split Web and application ownership.** Extract listener `stopAdmissionAndDrain()` from
   `BatonWebHost.shutdown()`. Let `BatonDeployment.close()` join one close coordinator. The driver
   close seam must keep the writer fence through resident CAS cleanup and release it last; a callback
   before writer release or a prepare/finalize split is sufficient. Do not let a host helper call
   `application.shutdown()` independently.
9. **Safe projections.** Internally retain full close/ownership evidence, but project ordinary host
   and close outcomes through a small semantic schema. Preserve the full record only for explicit
   advanced evidence and tests.

### Startup transaction

1. Resolve and validate Git-common, deployment-state, config, and runtime roots.
2. Load/create the stable deployment ID; create a fresh incarnation and process-start identity.
3. Assert the upgraded deployment writer lease and finish startup/orphan reconciliation.
4. Create the immutable incarnation directory, durable session store, bearer session, credential
   temp file, and Unix listener; verify every owner/mode/type invariant.
5. Mark local Web readiness eligible and run the authenticated challenge through the actual socket.
6. Write and fsync the v2 credential/profile candidates, then atomically install the active private
   profile and finally the non-secret Git selector. Re-read and challenge the published route.
7. Commit the startup journal and return only the safe host outline.

Publication is last. Failure at any earlier point revokes the issued session, closes the listener,
and removes only this attempt's immutable/temp objects. Failure after publication invokes the same
writer-fenced CAS unpublication before reporting failure. If cleanup cannot be proved, return
degraded/busy and retain recovery state rather than guessing.

### Close transaction

1. Join one owner close promise; set readiness false and refuse new Web admission.
2. Drain bounded in-flight Web responses and freeze the close result as degraded if drain is not
   exact.
3. Fence and reconcile application Runs/resources while retaining the writer lease.
4. Revoke the current-incarnation session and CAS-unpublish only records matching this deployment,
   incarnation, and writer fence.
5. Close and verify absence of this incarnation's socket; remove only its immutable directory.
6. Release application/coordinator and writer authority exactly once. Return a safe `closed` outline
   only if every internal component is exact; otherwise return `closed_degraded` with a help topic
   and keep the internal recovery record.

## Required adversarial tests for this vertical

These tests are the minimum deterministic gate before ordinary `host()` is enabled:

| Area | Required proof |
| --- | --- |
| Port authority | Direct and resident handles call exactly `command(name, args)`. Injected `principal`, `session`, `idempotencyKey`, `fence`, `lease`, and incarnation request fields fail before application work. A bound-principal marker can never become a transport key. |
| Idempotency | Same envelope/key reaches durable admission once; changed Run/message/action under one key conflicts. Connection challenge is non-admitting. Response loss never causes a new key for an already known command. |
| Stable/fresh identity | Restart preserves deployment ID and Run truth but changes incarnation/process identity. Old-incarnation credentials and endpoint coordinates fail. |
| PID reuse | Inject the same PID with a different kernel start identity. A successful old endpoint challenge yields busy; a failed challenge permits serialized recovery without signaling that PID. Unknown process identity fails closed. |
| Duplicate hosts | Barrier-start two subprocess owners. Exactly one listener/writer publishes; the loser returns typed busy and never closes, unlinks, revokes, or chmods winner resources. Concurrent `host()` calls on one owner join one result. |
| Readiness/publication | Pause after every startup step and assert that no active selector exists before the authenticated challenge. Card/session/repository/registry/capability/readiness mismatch publishes nothing. |
| Partial rollback | Fault-inject session issue, bind, chmod/stat, readiness, challenge, file fsync, directory fsync, profile install, selector install, and final re-read. Each failure leaves no unowned listener/session/temp/socket; the application remains usable; retry uses a fresh incarnation. |
| Stale selector/profile | Copy from another repository; mix repo/deployment/incarnation across selector, profile, card, and session; replace the active record between read and challenge. Every case fails before Runs access. Several eligible records require explicit advanced selection, never lexical choice. |
| Symlink/permission attacks | For every state/config/runtime parent and deployment/lease/selector/profile/credential/socket leaf, test symlink, wrong owner, group/other bits, non-regular type, malformed JSON, oversize content, inode replacement, and unsafe absolute/`..` coordinate. Refusal must not chmod or delete the attacker-selected target. |
| Token/path leakage | Inject distinct token, credential-path, state-root, runtime-root, socket-path, lease-fence, PID, receipt, budget, and limit sentinels. Assert absence from host/close results, cards, readiness, list/attach/help/errors, audit, stdout, and stderr. Authorization is present only on the private transport request. |
| CAS cleanup | Delay old-incarnation close until a successor is published. Old revoke/unpublish/socket/lease cleanup all fail harmlessly; successor remains connectable. Replaced/malformed state remains for recovery. |
| Close ownership | Listener close never calls application shutdown. Connected clients have no shutdown route. Two `owner.close()` calls and repeated signals join one application shutdown. Web-close failure is visible as degraded. Application-close failure retains the recovery coordinate and writer fence. |
| OS proof | After successful close, prove the listener socket and current-incarnation files are absent, the session is revoked, the writer lease is released, and Baton owns zero processes/worktrees/runtimes/reservations. Ledger-only assertions are insufficient. |

The present Phase 89 tests do not cover these obligations. RH1/RH2 use a fake server whose
`authenticated` and `https` properties are caller assertions. RH3 manually installs v1 files and
uses fake fetch. RH4 proves parsing only; the real CLI explicitly refuses module-free serve. RA11
proves the redirect option and post-materialization byte check, not bounded streaming. RA8/RA9 do
not prove persisted nonterminal stage anchors or bounded event access.

## Intentionally deferred after the local resident closure

- **Network mode:** no TCP listener, TLS provisioning, trusted proxy, OIDC, browser login, CORS, or
  remote origin expansion in this vertical. Existing advanced HTTPS authority remains the only
  network route and is not weakened.
- **Semantic send/interrupt:** do not disguise raw `steer(target, ...)` as the ordinary API. Durable
  semantic-recipient binding, provider acknowledgement settlement, selective interrupt reuse,
  crash recovery, and honest `outcome_unknown` remain the next control slice.
- **Run-scoped streams:** no repository-wide SSE fallback promotion. Single-use Run tickets,
  incarnation binding, durable cursor resume, re-ticket, live downgrade, and
  `snapshot_required` remain a later slice.
- **General POST re-drive and continuation:** the local port should preserve envelope/key state, but
  complete reconnect/re-drive of admitted commands, opaque Runs pagination, persisted progress
  indexing, browser/CLI presentation convergence, and the WG crash/dogfood matrix remain explicit
  acceptance-red work.

These deferrals do not relax the local host invariants. The vertical is complete only as a private,
discoverable, authenticated, restart-fenced owner/connected Runs foundation; it is not Phase 89
completion and must not be reported as send/interrupt/stream or network acceptance.

## Review conclusion

The first fixes should remain. Repair the optional attach registry check and stop calling the
signature-erasing wrapper a common command port. Then implement the resident owner as the single
next vertical above, with the writer lease held through CAS cleanup and Web/application ownership
split. Do not publish first and “verify afterward,” do not infer ownership from PID liveness, and do
not return cleanup internals to ordinary callers.

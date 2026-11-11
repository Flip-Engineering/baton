# Phase 89 resident-host-authority review (GLM `glm-5.2` / `xhigh`)

Role: Baton's independent resident-host-authority reviewer, dispatched after the first Phase 89
fixes landed.

Scope: confirm or refute every claimed post-fix property in the Phase 89 specification,
assessment, and both red tests; then design the smallest next ordinary `openBaton().host()`
vertical that owns the eight resident authorities the first slice deliberately deferred.

Method: read `spec/phase89-authenticated-resident-application.md`,
`spec/phase89-authenticated-resident-security-matrix.md`, the prior dogfood assessment, the
implementation modules (`application.mjs`, `application-deployment.mjs`, `application-client.mjs`,
`application-cli.mjs`, `application-host.mjs`, `application-semantics.mjs`, `index.mjs`,
`coordination-store.mjs`), and both red tests; verify each claim against the code that actually
enforces it. Every shell command ran through `rtk`, one command per call. No credentials, harness
installations, global configuration, main checkout, or nested Baton were touched. This is the only
file written.

Deployment profile: `default@a1f0793ec510b21f5aba58048f1fd01e7288709ec513069b29feb261b0266730`.
The pinned deployment verification command is `node` with arguments
`--test impl/test/phase89-resident-application-red.test.mjs impl/test/phase89-resident-host-red.test.mjs`
(see `run.mjs`). It was run and is reported in §1.

---

## 1. Pinned verification result

```
node --test impl/test/phase89-resident-application-red.test.mjs impl/test/phase89-resident-host-red.test.mjs
# tests 27   pass 27   fail 0   exit 0
```

Both Phase 89 red files are green. `phase89-resident-application-red.test.mjs` contributes RA1–RA13
(the common Runs surface, attach validation, progress anchors, clock safety, catalog ceiling,
connection handshake). `phase89-resident-host-red.test.mjs` contributes RH1–RH4 (the advanced
host seam, secure-boundary refusal, `connectBaton` discovery, `baton serve` parsing). These 27
cases are the mechanical expression of the first-slice fixes; they are not evidence for the
resident authorities that the ordinary host still lacks (§3, §5).

---

## 2. Confirm/refute: the seven claimed post-fix properties

The dogfood assessment (`phase89-resident-application-dogfood-live-2026-07-18/assessment.md`) lists
seven defects the first review found and says were repaired and regression-tested. Each is
confirmed against the enforcing code and the test that locks it.

| # | Claimed fix | Verdict | Enforcing code | Locking test |
|---|-------------|---------|----------------|--------------|
| 1 | Authorize Runs before enforcing the visible catalog ceiling, so hidden Runs cannot shrink a caller's page or force a continuation | **Confirmed** | `application.mjs` `runs.list` authorizes each candidate before the 64-visible ceiling (the `run.status` authorization in `runs.list` scope is observed in RA2's authorization log) | RA2 (per-Run auth log), RA12 (65th visible Run → `application_run_list_continuation_required`, unauthorized Run never counted) |
| 2 | Same exact-route readiness gate on `deployment.runs.start()` as `deployment.run()` | **Confirmed** | `application-deployment.mjs` `assertRouteReady` is called by both `run()` (L967–970) and the `runs.start` wrapper (L955) | RA13 (both paths throw `phase89_route_not_ready` with the exact route tuple; no Run admitted) |
| 3 | Derive local repository identity from the Git common dir and require agreement across selector, card, and authenticated session | **Confirmed** | `application-deployment.mjs` `repositoryAuthority` (L127–143) hashes the *common* dir; `application-cli.mjs` `repositoryIdentityFromMetadata` (L156–163) matches it; `connectBaton` (L1195–1200) rejects selector/local mismatch and (L1221–1227) requires card + session repoId agreement | RA7 (wrong-repo session → `cli_protocol_failed`), RA10 (selector↔local and card↔selector mismatches → `cli_connection_incompatible`, both before `/v1/commands`) |
| 4 | Refuse Web redirects and bound response time and JSON bytes | **Confirmed** | `application-cli.mjs` `BatonWebClient._json` (L992–1035): `redirect: 'error'`, `AbortController` per request, declared `content-length` ceiling, and actual `text()` byte ceiling (`maxJsonResponseBytes`); constructor (L965–968) rejects userinfo/query/hash and forces `https:` | RA5 (envelope shape), RA11 (URL ambiguity refused at construction; `redirect:'error'` + `AbortSignal` on every request; declared-oversize rejected before body read; actual-oversize rejected when no content-length) |
| 5 | Validate attached outline schema, Run identity, registry identity, view digest, and bounded fields before returning a handle | **Confirmed** | `application-client.mjs` `BatonRuns.attach` (L936–955) checks schemaVersion, runId echo, depth, registryDigest, view-digest shape, boolean terminal, and outline objective/phase; `open()` (L921) remains the non-validating alias | RA3 (attach is async, validates via one `run.inspect`, missing Run → `application_run_not_found`), RA6 (connected attach through the same facade) |
| 6 | Centralize stable Run timing; exclude volatile observation time from semantic digest identity | **Confirmed** | Outline carries `startedAt/stage/lastProgress/completedAt/observedAt/elapsedMs/silenceMs`; advancing only `observedAt` leaves `viewDigest` and `changed` unchanged (RA8); regressing/malformed clocks clamp to zero or fail typed (`application_progress_clock_invalid`) | RA8 (restart/replay preserves all anchors; observation-time churn does not change digest), RA9 (regression clamps; malformed clock fails typed) |
| 7 | Expose only an explicit advanced loopback HTTPS host seam; keep ordinary hosting unavailable until its missing security authorities exist | **Confirmed (as a boundary, not a host)** | `application-deployment.mjs` `host()` (L992–1000) throws `application_host_unavailable` for the ordinary call and only assembles a `BatonWebHost` under `options.advanced` with loopback + `https` + authenticated + publish-callback validation (L1001–1021) | RH1 (advanced seam assembles one listener, idempotent start, joined close, no credential leak), RH2 (wildcard/cleartext/unauthenticated refused before bind) |

All seven are **confirmed**. The regression coverage is real and the code paths match the tests.
The single important caveat is #7: it is confirmed as a *fail-closed boundary*, exactly as the
spec checkpoint (§9) and assessment "honest remaining boundary" both state — it is not, and does
not claim to be, the ordinary resident host. §3–§5 are about that gap.

---

## 3. Adversarial findings against the requested defect classes

Each requested class is evaluated twice: as it stands in the current tree, and as a risk the next
vertical must not reintroduce.

### 3.1 Principal / idempotency confusion
- **Current tree: clean.** The connected client never lets a principal become a wire idempotency
  key. `bindBatonPort` (`application-client.mjs` L1182–1190) hands the runs facade a local sentinel
  principal `{ kind: 'bound-command-port' }`, while `BatonWebClient.command`
  (`application-cli.mjs` L1075–1089) mints `commandId = randomUUID()` and `idempotencyKey =
  randomUUID()` and puts only `repoId`/`origin` in the envelope. RA6 asserts the sentinel string
  never appears in `idempotencyKey`. The server derives authority from the authenticated session,
  not from any client-supplied actor/principal (consistent with AA16).
- **Latent risk for the vertical.** The deployment principal is constructed with a *constant*
  `sessionId: 'local-owner-session'` (`application-deployment.mjs` L1145–1147). That is not a
  fresh incarnation. It is harmless today only because the owner principal never reaches the wire
  and the resident host does not yet exist. The moment a resident publishes anything bound to
  "incarnation," a constant sessionId must not be that incarnation. §4 requires a separate,
  random incarnation nonce and forbids reusing any principal/session id as incarnation identity.

### 3.2 Token or path leakage
- **Current tree: clean and tested.** `BatonWebClient` keeps the bearer in a private field and
  emits it only as an `Authorization` header; the envelope body is built from `repoId`/`origin`
  only (`application-cli.mjs` L988–989, L1080–1083). RH1 scans `stdout`/`stderr`/host outline/close
  result for the fixture secret; RH3 scans every authenticated request, the published connection,
  the token file mode, and the selector file. The deployment card/projectors redact harness
  versions to bounded tokens and drop executable paths (`publicHarnessVersion`,
  `publicCardAtom` in `application-deployment.mjs` L692–740).
- **Risk for the vertical.** The resident host will newly create a private connection profile,
  token file, and a non-secret selector. The leak surface therefore *grows*. §4 requires the
  non-secret selector to carry no token/path/secret (RD3) and the private material to be
  owner-only regular files never opened by `doctor`/`help` (RD4), with the same sentinel-corpus
  scan the existing tests already use.

### 3.3 PID reuse
- **Current tree: vulnerable by design — and the matrix already says so.** The coordination writer
  lease identifies its owner by `process.pid` and a random `token`, and tests liveness solely with
  `process.kill(pid, 0)` (`coordination-store.mjs` `claimWriterLease` L565–602, especially L568 and
  L577/L588). There is **no process-start-time / boot-time identity**. If PID *N* is reused by a
  different process after the prior owner dies, `process.kill(N, 0)` reports alive and the lease is
  treated as held: a stale lease can strand ownership, or a claimant can be falsely refused. The
  claim-token mutual-exclusion window (L567–595) is a correct fail-closed *election guard*, but it
  does not fix identity — it just makes two simultaneous claimants both back off. This is exactly
  matrix RD8's "PID with mismatched process-start identity is not treated as the prior owner," and
  it is **not yet implemented**.
- **Risk for the vertical.** The resident lease must not inherit this. §4 specifies a resident
  owner fingerprint = `{ pid, processStartUnixMs, incarnationNonce }`, with liveness proven by an
  authenticated round-trip, not by `kill(pid,0)` alone.

### 3.4 Symlink / permission / TOCTOU attacks
- **Current tree: strong.** `readBoundedFile` (`application-cli.mjs` L74–98) does `lstat`
  (reject symlink + 16 KiB bound), then `open(O_RDONLY | O_NOFOLLOW)`, then `fstat` and checks
  `dev`/`ino` match the lstat (TOCTOU defense), owner-uid match, and `mode & 0o077 === 0` for
  owner-only files. `findRepositoryMetadata` (L114–154) rejects symlinked `.git`, `gitdir`, and
  `commondir`. Credential readers in `application-deployment.mjs` (Kimi/Grok, L294–434) use the same
  `O_NOFOLLOW` + owner-uid + mode discipline. Profile/selector setup uses `O_CREAT|O_EXCL`
  link-into-place and `fsync` (install path referenced at L294+).
- **Risk for the vertical.** The resident selector/profile/token/lease/socket files are all new
  owner-only attack surfaces. §4 requires every one of them to reuse `readBoundedFile`-style
  `O_NOFOLLOW` + `fstat dev/ino` + owner-only discipline and to refuse (not delete) uncertain
  files (RD9, LX14).

### 3.5 Duplicate hosts
- **Current tree: only intra-process idempotency.** `host()` caches `#hostHandle`
  (`application-deployment.mjs` L993) and `start()` caches its promise (L1029–1045), so one
  `BatonDeployment` cannot start twice. There is **no cross-process owner detection**: two
  `openBaton()` processes in the same repo each construct their own `BatonDeployment` and each
  would `claimWriterLease()` — the coordination lease's claim-token window is the only thing that
  prevents two simultaneous writers, and (per 3.3) it is PID-only. RD6 ("one concurrent owner;
  loser attaches or returns busy") is **not implemented** for the resident host.
- **Risk for the vertical.** §4 requires the resident lease to be the single writer authority: a
  second `host()` that cannot prove it owns the live incarnation must either attach to the winner
  or return a typed busy state, never silently start a second listener.

### 3.6 Stale selector takeover
- **Current tree: connect-side challenged, host-side absent.** `connectBaton` does prove liveness:
  `doctor()` (GET `/readyz` + `/v1/application-card`) and `session()` run before any command, and
  the handshake requires ready + repoId + registryDigest + session-repo agreement
  (`application-cli.mjs` L1219–1230). But on the *host* side there is no incumbent to challenge —
  the ordinary host does not exist, and the advanced seam's `publishConnection` is a caller no-op
  (RH1 passes `async () => {}`). Unpublication is not compare-and-swap anywhere
  (`application-deployment.mjs` close at L1053–1060 just shuts down). RD10 (delayed close from an
  old incarnation cannot unlink the successor's coordinate) is **not implemented**.
- **Risk for the vertical.** §4 requires CAS unpublication keyed by incarnation: close removes the
  selector/profile/lease only if the on-disk incarnation still matches the closer's.

### 3.7 Partial start rollback
- **Current tree: construction rolls back, host start does not.** `openBatonDeployment`
  (`application-deployment.mjs` L1152–1183) wraps application construction in try/catch and shuts
  down (or `driver.closeAsync()`) on failure; `createDriver` releases the writer lease if it throws
  after claiming (`index.mjs` L1180). But `host()`'s `start()` (L1030–1045) awaits `webHost.start()`
  (listener binds) and *then* `publishConnection`; if publication throws, the listener is already
  bound and nothing tears it down. `#hostHandle`/`#webHost` are assigned regardless (L1048–1049).
- **Risk for the vertical.** §4 requires the resident start to be effect-ordered and rollback-safe:
  lease → socket → listener → readiness+authenticated challenge → atomic publish, with reverse-order
  cleanup if any step after a durable effect fails.

### 3.8 Host / application close ownership
- **Current tree: correct for co-ownership; untested for separation.** `BatonWebHost.shutdown()`
  (`application-host.mjs` L153–176) closes Web admission (`server.batonShutdown({drainMs})`) and
  *then* `application.shutdown(principal)`. `BatonDeployment.close()` (L1053–1060) returns exactly
  `webHost.shutdown().application`, and `host.close = () => this.close()` (L1046), so host close
  and deployment close are the same call and shut the application down once — RH1 asserts
  `hostClosed deepEqual deploymentClosed`. This is right *because the host is the owner*. The
  connected surface correctly has no close authority (`connectBaton` returns a bound port only).
  The subtlety the matrix raises (gate 9 / RR1 / RR8 — host close must not close an application it
  does not own; degraded close must stay recoverable) is not yet exercised because there is no
  separable resident owner.
- **Risk for the vertical.** §4 keeps one owner: the resident host opened the application, so its
  close owns the single shutdown; a degraded step reports `closed_degraded` (the host already models
  this at L168) and must not erase the only recovery coordinate.

---

## 4. Design: the smallest next ordinary `openBaton().host()` vertical

Goal: make the no-argument `owner.host()` assemble, publish, and cleanly retire one owner-local
resident — without exposing any socket, token, lease, budget, limit, or receipt to the ordinary
caller. Everything below is sized to be one vertical: it owns the eight deferred authorities and
**nothing else**. Network mode, `send`/`interrupt` settlement, Run-scoped streams, and restart
dogfood stay deferred (§5).

### 4.1 Ordinary surface (unchanged shape, new backing)

```js
const owner = await openBaton({ repo: '.' });
const host  = await owner.host();        // ordinary: no args, no advanced
const up    = await host.start();        // non-secret outline only
// ... connectBaton({ repo: '.' }) now succeeds against this host ...
await host.close();                      // == owner.close(): one exact shutdown
```

`host()` returns a frozen handle `{ start(), close(), serve?(signal?) }`. `start()` resolves to a
**non-secret host outline** (`{ schemaVersion, state, repoId, deploymentId, incarnation, endpoint:
{ kind:'unix', address:null }, publishedAt }`) — the socket path, token, lease token, and profile
path are private fields on the host object and never appear in the outline, errors, `doctor`, or
logs. `connectBaton({ repo })` is unchanged on the outside; discovery now resolves to the
owner-published profile instead of a test fixture. No budgets, ceilings, sockets, tokens, leases, or
receipts are added to any ordinary argument or return.

### 4.2 The eight authorities, each owned by the host

1. **Private local transport (owner-only Unix-domain socket).** Bind a UDS under the existing
   private deployment root (`<common>/baton/application-v3/run/resident.sock`), created with
   `mode 0o600` inside the `0o700` private directory. Refuse — do not fall back to a TCP wildcard —
   if the platform cannot guarantee socket file ownership/permissions (spec §3.1; RH2 generalizes).
   Endpoint kind in the outline is `'unix'`; the path itself stays private.
2. **Private session authority.** Mint one owner-scoped bearer (`randomBytes(48)`, base64url) at
   host start, stored once as an owner-only regular file via the `readBoundedFile`/`O_NOFOLLOW`
   discipline (RD4). The HTTP/UDS layer authenticates the bearer and issues a bounded session
   bound to `{ repoId, deploymentId, incarnation }`. The token is held in a private field; rotation
   on close is a CAS replace (RD10).
3. **Stable deployment ID.** Persist `deploymentId = repoId`-derived but stable across restarts:
   derive from the repoId plus a deployment UUID stored at
   `<deploymentRoot>/state/deployment.identity` (owner-only, `O_NOFOLLOW|O_CREAT|O_EXCL`; reuse if
   present and well-formed). This is distinct from repoId (which identifies the repo) and from
   incarnation (which identifies this live owner).
4. **Fresh incarnation.** `incarnation = randomUUID()` per `host()` start. Bound into the lease,
   the session, the published selector, and the unpublication CAS key. Never derived from the
   principal sessionId (which stays the constant internal label) — closes the 3.1 risk.
5. **Fenced writer lease (PID-reuse-safe).** Replace the PID-only lease record with a resident
   owner fingerprint `{ pid, processStartUnixMs, incarnationNonce }`. `processStartUnixMs` is read
   from `/proc/<pid>/stat` start time (Linux) / `ps -o lstart` (macOS) / `process.creationTime()`
   fallback marker; liveness is *not* `kill(pid,0)` alone — a mismatched start time means "not the
   prior owner," and stale replacement still requires the authenticated endpoint challenge to fail
   (RD7, RD8). Reuse `coordination.claimWriterLease()` as the serialization primitive but extend
   its payload and its liveness predicate; keep the existing fail-closed claim-token election.
6. **Readiness-before-publication.** Effect order in `start()`: claim lease → bind socket → start
   authenticated listener → run authenticated readiness challenge (card + session over the actual
   socket, not a self-call shortcut) → *then* atomic publish. Nothing is discoverable until lease,
   listener, writer authority, startup reconciliation, and the authenticated session are all proven
   (RD1). This generalizes the current `BatonWebHost.start`, which only awaits `application.ready`
   before `listen` (`application-host.mjs` L137) — it does not re-check writer authority or run an
   authenticated challenge before the caller's `publishConnection`.
7. **Authenticated connection challenge.** The publish step writes the non-secret selector
   (`<common>/baton/connection.json`: `{ schemaVersion, profile, repoId, deploymentId, incarnation,
   endpointKind, registryDigest, publishedAt }`) and the owner-only profile
   (`$XDG_CONFIG_HOME/baton/connections/<profile>.json` + `.token`). `connectBaton`'s existing
   handshake (`doctor` + `session`, `application-cli.mjs` L1219–1230) already challenges repoId +
   registry + session; extend it to also assert the selector's `deploymentId`/`incarnation` match
   the card/session the resident returns, so a copied/tampered selector for another repo or a stale
   incarnation fails before attach (RD5, RD11).
8. **CAS cleanup.** `close()` is effect-ordered and incarnation-CAS-guarded: stop new admission →
   drain bounded in-flight (`server.batonShutdown({drainMs})`, already modeled) → reconcile owned
   Runs → release writer lease (`releaseWriterLease({requireOwned:true})`, already exact at
   `index.mjs` L1155) → CAS-unlink selector/profile/token/socket **only if** the on-disk
   incarnation still equals this host's → rotate/revoke the bearer → shut the application down
   exactly once. A delayed close from an old incarnation sees a mismatched incarnation and removes
   nothing (RD10, RR9).

### 4.3 Invariants (machine-checkable)

| ID | Invariant | Maps to matrix |
|----|-----------|----------------|
| INV1 | Ordinary `host()` with no `advanced` either assembles a private UDS resident or throws `application_host_unavailable`; it never binds TCP/wildcard/cleartext | RD13, RH2 |
| INV2 | No discoverable coordinate is published before lease + listener + authenticated readiness + session | RD1 |
| INV3 | The published selector contains no bearer, CSRF key, credential, credential path, worktree/runtime/state path, or socket path | RD3 |
| INV4 | Private profile/token/lease files are owner-only regular files (`0o600` in `0o700`), opened `O_NOFOLLOW`, never by `doctor`/`help` | RD4, LX14 |
| INV5 | The owner fingerprint includes `processStartUnixMs`; a reused PID with a different start time is not the prior owner | RD7, RD8 |
| INV6 | Two concurrent `host()` starts yield one writer/listener owner; the loser attaches or returns typed busy, and never removes the winner's authority | RD6 |
| INV7 | Close removes a coordinate only if the on-disk incarnation matches the closer's; a stale closer removes nothing | RD10, RR9 |
| INV8 | `host.close()` and `owner.close()` join one exact application shutdown; a degraded close reports `closed_degraded` and keeps recovery truth | gate 9, RR1, RR8, RR10 |
| INV9 | The principal/sessionId is never used as incarnation, idempotency key, or wire identity | AA16, §3.1 |

### 4.4 Implementation seams (where the code changes, kept behind the ordinary surface)

- `application-deployment.mjs` `host()` (L992–1051): split into ordinary and advanced. Ordinary
  builds a `ResidentHost` (new, sibling of `BatonWebHost`) that owns items 1–8. The advanced seam
  stays for tests/integration but is no longer the only path. The principal at L1145–1147 keeps its
  constant label but is explicitly *not* the incarnation source.
- `application-host.mjs`: extract the shared drain/serve signal lifecycle
  (`SignalLifecycleOwner` is already reusable) into the new `ResidentHost`; keep `BatonWebHost` for
  the advanced seam. `ResidentHost.start()` implements the §4.2(6) effect order and §4.2(8)
  rollback; `ResidentHost.close()` implements CAS cleanup and delegates application shutdown to the
  existing `BatonDeployment.close()` so INV8 holds.
- `coordination-store.mjs` `claimWriterLease`/`_assertWriterLease`/`releaseWriterLease`
  (L565–653): extend the payload to `{ pid, processStartUnixMs, incarnationNonce, token }` and make
  the liveness predicate require start-time match (not `kill(pid,0)` alone). The token+CAS release
  at L633–653 is already the right shape for resident CAS cleanup.
- `application-cli.mjs` `connectBaton` (L1219–1230): add `deploymentId`/`incarnation` agreement to
  the handshake; `discoverBatonConnection` (L166–208) already reads selector+profile+token with the
  right `O_NOFOLLOW`/owner-only discipline, so the resident profile slots in without new I/O
  patterns.
- A new `resident-transport.mjs` (UDS bind + owner-only perms + refusal-on-unsupported-platform)
  is the only net-new module; everything else composes existing primitives.

### 4.5 Adversarial tests for this vertical (RED until green)

Each is one focused case, reusing the sentinel-corpus style already in RH1/RH3/RA7.

- `RH5` ordinary `host()` publishes only after readiness: the selector/profile must not exist until
  `start()` resolves; a forced pre-publish returns no coordinate. (INV2, RD1)
- `RH6` PID reuse: write a lease whose `{pid, start}` differs from the live process by start time;
  `host()` must still prove the authenticated challenge fails before replacing it, and must never
  treat the reused PID as the live owner. (INV5, RD7/RD8)
- `RH7` duplicate owner: two `host()` calls (second in a child process sharing the deployment root)
  produce one listener; the loser returns typed `application_host_busy` and removes nothing. (INV6,
  RD6)
- `RH8` stale-selector takeover: a selector carrying a prior incarnation is not adopted; a tampered
  repoId/deploymentId is rejected at the handshake before attach. (RD5, RD11)
- `RH9` CAS unpublication: after close, simulate a delayed second close from the old incarnation —
  it must not unlink the successor's selector/profile/lease. (INV7, RD10/RR9)
- `RH10` partial-start rollback: force `publishConnection` (or the readiness challenge) to throw
  after the socket binds; the socket, lease, and any half-written selector are removed and the
  application is left reusable. (§3.7)
- `RH11` leakage: sentinel bearer/socket-path/credential markers are absent from the host outline,
  `doctor`, `help`, stdout/stderr, errors, and the non-secret selector. (INV3/INV4, LX)
- `RH12` close ownership: `host.close()` and `owner.close()` still join one exact result
  (generalize RH1's `deepEqual` assertion); a degraded close keeps recovery truth. (INV8, RR10)

### 4.6 Intentionally deferred (out of this vertical, explicitly)

These remain acceptance-red and are *not* claimed by this design:

- **Explicit network mode** (`host({ mode:'network' })`): TLS termination, allowed-origin authority,
  OIDC/token issuer policy, CORS/CSRF on the public edge (spec §3.2, RD12). The vertical is
  owner-local UDS only.
- **`send` / `interrupt` settlement**: durable control admission, provider-boundary settlement,
  `outcome_unknown` reconciliation (CS1–CS12). The vertical gives the resident a transport and a
  session; it does not add new Run controls.
- **Run-scoped resumable streams**: re-ticketing, cursor resume, incarnation invalidation of stream
  tickets (SV1–SV7). Deferred.
- **Crash/restart dogfood**: SIGKILL + supervisor restart reconciliation, multi-client reconnect,
  Baton-on-Baton exact-route run with zero ownership (RR4, RR12, WG5–WG8). The vertical proves the
  lease/socket/publication/CAS primitives unit-level; the live subprocess proof is a later gate.
- **Opaque catalog continuation above 64 visible Runs** and **persisted/indexed progress anchors**
  (assessment "honest remaining boundary") — separate slices.

---

## 5. Bottom line

The first Phase 89 fixes are real and correctly regression-tested: all seven claimed properties
hold (§2), the 27 red cases pass with exit 0 (§1), and the leak/symlink/TOCTOU/principal disciplines
are genuinely strong (§3.2, §3.4). The honest boundary is unchanged and accurately stated by both
the spec and the assessment: `BatonDeployment.host({ advanced })` is an integration seam, ordinary
`host()` is fail-closed, and none of the resident authorities exist yet.

The one finding worth surfacing as a *carry-forward defect*, not just a deferred feature, is
**§3.3 / INV5**: the coordination writer lease is PID-only (`coordination-store.mjs` L565–602),
which is the exact PID-reuse weakness matrix RD8 names. Any resident lease that composes
`claimWriterLease()` will inherit it unless the payload and liveness predicate are extended. The
§4 vertical makes that extension part of the first resident slice rather than a follow-up.

The smallest next vertical is §4: one owner-local UDS resident behind the unchanged
`openBaton().host()` / `connectBaton()` surface, owning private transport, private session
authority, stable deployment ID, fresh incarnation, PID-reuse-safe fenced lease,
readiness-before-publication, authenticated deployment/incarnation challenge, and incarnation-CAS
cleanup — with invariants INV1–INV9 and RED tests RH5–RH12 locking it, and network/send/interrupt/
stream/restart-dogfood explicitly deferred.

# Phase 89 resident application — independent application/AX/security review

Date: 2026-07-19  
Scope: the two Phase 89 specifications and the seven implementation/test artifacts named in the Baton brief. This is a source review, not live resident-host evidence. No nested Baton was invoked.

## Bottom line

The tree has a useful partial implementation of ordered slice 1: `BatonDeployment.runs` is exposed, `runs.list` produces a compact projection, `runs.attach` performs one outline read, the high-level client can bind a Web command closure, and `connectBaton()` performs an authenticated card/session preflight. Those pieces are not yet a safe resident application boundary.

The highest-priority defect is repository confusion in discovery/connection: the local selector's `repoId` is trusted rather than derived and challenged, and the connected handshake never compares it with `application-card.repoId`. A copied selector can therefore connect from repository B to repository A whenever the authenticated identity is authorized for A. The other immediate security blockers are redirect-following/unbounded Web reads and list authorization/pagination ordering that lets hidden Runs affect failure and cost. `openBaton().host()` does not exist, and the existing `BatonWebHost` is only a network listener lifecycle seam; integrating it unchanged would permit wildcard intent and would not provide the required lease, incarnation, private authority, publication, or local-socket posture.

Do not declare Phase 89 complete. Preserve the current TLS/auth/session/semantic-action authorities and add one bound command-port path; do not create a second resident control plane.

## Concrete correctness, security, and AX defects

### P0 — discovery does not prove the caller's repository or the resident card's repository

`discoverBatonConnection()` reads `repoId` from `.git/.../baton/connection.json` and returns it as authority (`impl/src/application-cli.mjs:157-198`). It does not derive the repository ID from the resolved Git common directory, even though `openBaton()` does so (`impl/src/application-deployment.mjs:112-130`). `connectBaton()` then checks readiness, the semantic-registry digest, and whether the session contains the selector's ID, but never checks `doctor.application.repoId` (`impl/src/application-cli.mjs:1168-1173`).

Consequences:

- copying/tampering a selector into another repository does not fail the repository challenge;
- a user authorized for multiple repositories can silently acquire mutation authority for the wrong deployment;
- a card for the wrong repository or wrong application schema can pass before the common Runs facade is returned.

This violates RD5, AA6, and the discovery contract. The setup path does compare a remote card to a session before writing a selector, but that does not make a selector self-authenticating or copy-resistant (`impl/src/application-cli.mjs:368-383`).

Small fix: derive the expected `repoId` from the resolved local Git common directory using the deployment's exact algorithm; require selector ID = derived ID = authenticated card ID = session membership. Validate the card schema, required command set, registry identity, readiness, and (for a new profile schema) expected deployment/instance identity before returning any port. Keep v1 profiles readable, but do not treat their missing generation binding as proven v2 authority.

### P0 — the Web client can follow redirects and has no individual response deadline or byte ceiling

`BatonWebClient._json()` calls `fetch()` without `redirect: 'error'`, an abort deadline, or a response-size bound, then calls `response.json()` (`impl/src/application-cli.mjs:978-988`). Export download has the same redirect and wait issue (`impl/src/application-cli.mjs:1110-1127`). The constructor also fails to reject base-URL userinfo, query, and fragment for environment-compatibility and directly discovered profiles (`impl/src/application-cli.mjs:953-964`), despite the setup-only profile reader applying stronger checks.

The overall command reconciliation deadline does not bound a single hung POST, status GET, card read, session read, or body parse. Redirect behavior can move a bearer-bearing request before application authority is proven. Unbounded JSON/archive reads make a private profile a resource-exhaustion primitive. This is the concrete LX6/LX7 and RD12 gap already called out by the security matrix.

Small fix: validate one canonical HTTPS base authority with no userinfo/query/fragment; use `redirect: 'error'`; apply an `AbortSignal` deadline to every fetch; stream/read at most the endpoint-specific byte ceiling before parsing; validate content type and exact safe response shapes. Preserve direct TLS or explicitly configured trusted-proxy requirements—do not add a cleartext convenience path.

### P0 — `runs.list` is not a usable bounded catalog and hidden Runs influence visible behavior

`APPLICATION_COMMAND_DEFINITIONS['runs.list']` accepts no arguments, and `listRuns()` sorts all repository Runs, then fails if the total exceeds 64 before per-Run authorization (`impl/src/application.mjs:45`, `impl/src/application.mjs:7714-7740`). Thus:

- the 65th Run makes the catalog permanently fail with `application_run_list_continuation_required`; no continuation can be supplied;
- unauthorized Runs affect whether an authorized caller gets a list or an error, violating the non-enumerating catalog rule;
- the default order is newest definition, not active/attention-first as specified;
- every visible item rebuilds a full view and scans timing events, creating avoidable amplification.

This is a correctness and authorization side-channel defect, not merely a missing acceptance test. A constant page limit does not constitute bounded semantic continuation when the only response beyond the limit is failure.

Small fix: define one closed server-owned query with an opaque, authenticated continuation binding repository, principal/session scope, canonical filter/order, resident generation, and page boundary. Authorize/filter before visible page/count decisions without leaking hidden cardinality. Return at most the server limit and a token; never expose offsets, event cursors, receipts, budgets, capacities, or byte/file ceilings. Prefer active and attention-required Runs, with a stable server tie-breaker.

### P1 — attach validates existence, but not a complete bound outline, and denial enumerates existence

`BatonRuns.attach()` correctly performs one `run.inspect` outline read before returning a handle, but accepts any truthy `outline` when only the top-level `runId` matches (`impl/src/application-client.mjs:931-943`). It does not validate outline identity, schema/registry identity, view digest, objective shape, or the command port's resident generation. A malformed or mismatched remote outline can seed a misleading handle.

Separately, Web dispatch maps `application_unauthorized` to 403 while `application_run_not_found` maps to 404 (`impl/src/web-northbound.mjs:100-107`). An attach attempt therefore distinguishes an existing denied Run from an unknown Run, contrary to AA7. Attach remains observational in the reviewed code, which is good; it does not create a second ledger.

Small fix: keep attach as exactly one outline read, strictly validate the bounded response and resident binding, and collapse unknown/denied/out-of-scope observation to one typed safe not-found response while retaining distinct internal audit reasons. Recheck live session and Run scope on every later observe/control call; the handle itself must confer no authority.

### P1 — the “common command port” is a signature-erasing shim, not one explicit contract

Direct clients are constructed with `(application, principal)` and call `command(name, args, principal)`. `bindBatonPort()` wraps a two-argument port, installs a dummy `{ kind: 'bound-command-port' }` principal, and relies on the wrapper silently ignoring the third argument (`impl/src/application-client.mjs:1132-1176`). The Web path happens to work, but authority ownership is implicit and fragile: a future port that consumes the third argument could confuse a placeholder with authenticated principal authority.

Small fix: make `ApplicationCommandPort.command(name, args)` the only client-facing contract. Build a direct port that closes over the deployment principal and a Web port that closes over session/idempotency/recovery authority. `BatonClient`, `BatonRuns`, and `BatonRun` should never hold or pass a principal. Keep raw `BatonApplication.command(..., principal, context)` behind the direct adapter. This advances both owner and connected paths without exposing principal, idempotency, fence, budget, or limit inputs.

### P1 — progress timing is expensive and does not preserve the claimed semantic anchors

`_progressTiming()` scans `coordination.events()` for every projection and filters the entire result in memory (`impl/src/application.mjs:5806-5823`). `runs.list` invokes it once per visible Run (`impl/src/application.mjs:7755`), so a 64-item page can rescan the complete event history 64 times.

The chosen last event supplies only its timestamp. The projected `lastProgress.stage` and `summary` are taken from the *current* view, not the event that advanced progress (`impl/src/application.mjs:5832-5843`). Terminal `completedAt` is likewise the last currently classified event, not a persisted authoritative terminal transition. Stage start/elapsed and a durable meaningful-progress cursor are absent. This can mislabel earlier progress after a stage change and cannot guarantee restart-stable terminal anchors.

Positive finding: volatile timing is added to semantic outline/list envelopes after the underlying view digest is computed, so the reviewed code does not obviously churn semantic digests merely because the clock advances.

Small fix: persist or deterministically fold per-Run `startedAt`, current-stage start, last meaningful progress `{at, stage, summary, cursor}`, and terminal `completedAt` at semantic transition time. Project `observedAt`, elapsed, stage elapsed, and silence with saturating non-negative arithmetic; exclude only the volatile conveniences from semantic digests and idempotency identity. Use indexed/bounded per-Run reads rather than repository-wide rescans.

### P1 — `openBaton().host()` is absent, and the available host seam is unsafe as its direct substitute

`BatonDeployment` exposes `runs`, aliases, and `close`, but no `host()` (`impl/src/application-deployment.mjs:931-981`). `BatonWebHost` accepts an arbitrary `listen.host` and TCP port and calls `server.listen(port, host)` (`impl/src/application-host.mjs:116-146`). It has no local socket mode, wildcard refusal, repository/deployment/incarnation challenge, writer lease, PID-start identity, private credential issue/rotation, authenticated self-check, atomic selector/profile publication, or compare-and-swap unpublication.

The production server factory does preserve TLS or explicit trusted-proxy requirements (`impl/src/web-northbound.mjs:1557-1580`); that authority must remain mandatory for network mode. `BatonWebHost` must not be wired directly into ordinary `host()` merely because it already orders Web shutdown before application shutdown.

## Later acceptance-red gaps (not regressions in the partial slice)

These are required Phase 89 work, but should not be confused with defects in the newly added list/attach facade:

- Ordinary semantic `run.send` and `run.interrupt` do not exist. The handle exposes raw `steer(target, ...)`; `run.steer` is non-reconcilable and worker-coordinate based. Durable provider-boundary admission/settlement and honest `outcome_unknown` remain open (CA2-CA11, CS1-CS12).
- Run-scoped stream tickets, progressive RunView snapshot/resume, reticket after restart, live scope downgrade, and `snapshot_required` are not supplied by this facade. Existing follow is command polling, not the Phase 89 resident stream contract (SV1-SV9).
- Resident lease/incarnation fencing, PID-start evidence, owner-local Unix socket, private credential publication, readiness-before-publication, stale takeover, CAS unpublication, crash recovery, and multi-client restart are not implemented (RD1-RD14, RR1-RR12).
- Explicit Run allowlists and run-scoped command-status reauthorization are not complete (AA10-AA15).
- Whole-Run stop has substantial existing authority, but the matrix's concurrent effect-boundary proofs, truthful immediate reattach receipt/zero ownership, OS-level reap evidence, and emergency quota lane remain acceptance-red (SR1-SR15).
- CLI vocabulary/presentation, cascading help parity, browser catalog/control, MCP parity, subprocess crash proof, and Baton-on-Baton dogfood evidence remain open (WG1-WG8).

## Acceptance-red test gaps

The file name says RED, but RA1 currently codifies an API that conflicts with the active specification: it requires `runs.list` to reject every option and expects no continuation input. RA2 creates only two authorized Runs and expects `continuation: null`. Together they make the >64 behavior untestable as a successful bounded catalog.

Missing adversarial coverage in the reviewed test file includes:

- 65+ Runs, opaque continuation integrity/replay, active/attention ordering, hidden Run cardinality/timing, cross-repository equal IDs, and per-session Run scopes;
- attach with denied/unknown equivalence, malformed/mismatched outline, repeated/concurrent attach, session rotation/downgrade, and proof of zero admission/ownership effects;
- a card whose `repoId` differs from the selector while the session contains both IDs, copied selector into a different Git common directory, wrong schema/command capability, stale deployment/instance, revoked/expiring session, and profile ambiguity;
- redirect responses, hanging response/body, oversize JSON, invalid content type, URL userinfo/query/fragment, command POST response loss, same-key re-drive, and bounded status reconciliation;
- durable timing anchors across replay/restart, stage/last-progress correctness, hostile clocks, no digest churn, and bounded event scans;
- `openBaton().host()`, duplicate ownership, local-socket permissions, readiness publication ordering, signal/crash close, CAS cleanup, TLS/network opt-in, and final zero ownership.

RA5 also verifies only the request envelope and admitted-status polling; it does not exercise redirect refusal, response bounds, or loss recovery. RA6/RA7 check registry/readiness/session membership but omit card repository identity, deployment/incarnation identity, schema/command compatibility, and local repository derivation. None of RA1-RA7 proves the host lifecycle or live dogfood acceptance gates.

## Smallest integrated implementation plan

1. **Make authority binding explicit.** Introduce one two-argument `ApplicationCommandPort`; adapt direct application + owner principal and Web client + authenticated session/idempotency authority behind it. Move all high-level Runs/Run handles to that port. Preserve the semantic registry as the sole command/action authority.
2. **Close the catalog/attach boundary.** Add server-owned opaque continuation, authorize without hidden-cardinality leakage, use stable active/attention ordering, bound per-Run work, strictly validate attach outlines, and normalize denied/unknown attachment responses. Do not expose caller-selected budgets, capacities, offsets, limits, worker IDs, fences, receipts, or cursors.
3. **Harden `connectBaton()` before returning the port.** Derive local repository identity; validate secure canonical endpoint and private files; reject redirects; bound every wait/body; authenticate; require exact local/selector/card/session repository agreement plus schema, registry, command capability, readiness, expiry, deployment, and instance agreement. Add same-envelope/same-key reconciliation without blindly repeating uncertain effects.
4. **Persist timing anchors.** Store/fold semantic progress once, project volatile elapsed/silence separately, and test replay/restart/no-digest-churn before resident hosting makes those projections long-lived.
5. **Add owner-local `BatonDeployment.host()` around existing authorities.** Acquire a fenced one-writer lease with deployment ID, fresh epoch, PID-start/incarnation evidence; issue private scoped session authority without argv/env/log exposure; create an owner-only Unix socket; construct the authenticated Web/application server; perform card/readiness/repository/capability/authenticated-session self-check; atomically publish non-secret selector plus owner-only profile/token only after success. Refuse unsupported local socket ownership/permissions. Keep explicit network mode behind non-wildcard intent and the existing TLS/trusted-proxy, Origin, CORS, CSRF, edge, durable-session, and readiness authorities.
6. **Order close and restart truth.** Stop new admission, drain bounded requests, reconcile application ownership, revoke/rotate credentials, release only the owned socket/lease/coordinate with epoch CAS, and report degraded state whenever any authority remains. A connected client never gains deployment-close authority.
7. **Then implement the later slices.** Add durable semantic send/interrupt settlement, Run-scoped streams/re-ticketing, CLI/MCP/help parity, crash/restart tests, and WG dogfood. Do not let those larger features delay fixing repository confusion, redirect/response bounds, or catalog leakage.

This order advances both `openBaton().host()` and `connectBaton()` through one authority-preserving seam while retaining the existing TLS, authentication, repository, semantic-action, route, stop, and cleanup authorities.

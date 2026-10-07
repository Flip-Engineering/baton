# Issue #12 — The nested-orchestration rung: a minted, lease-bound child connection profile projected at spawn (v1.1)

Status: implementation contract. This rung unblocks issue #74 (the worker-orchestrated swarm) by
projecting a FRESH, lease-bound child connection profile into the private worker runtime at spawn —
never a copy of the owner's store. This epic specifies behavior; it does not amend implementation
in this artifact.

**v1.1 fold (2026-08-06).** This revision folds the adversarial red-team review
(`contract-redteam.md`, this directory — verdict NOT FOLD-READY, five blockers) into the
contract. Four amendments: (1) a lease-scoped transport carve-out admits `run.stop` to the
lease-holding child — v1.0 minted `['observe','control']` while the transport enforces
`emergency_stop` before the gate (`impl/src/web-northbound.mjs:625-629`), leaving NP-02
ungreenable (Decision 6); (2) a `worker:`-prefix refusal closes the legacy transport operator
command set with the rung's ONE new refusal code, `worker_legacy_command_forbidden` (Decision 6);
(3) the workflow lanes gain principal↔run lease-subtree scope binding at the facade `_authorize`
seam (Decision 6); (4) orphan cadence is disclosed honestly — the ≤30-minute TTL is the true
orphan bound (a resource lease, not a control clock), the sweep gains a startup pass, and the
in-flight window is pinned (Decision 5). The acceptance suite re-aligns: NP-02 rides the real
socket transport and gains the carve-out rows, NP-03 the foreign-run rows, NP-04 the in-flight
rows, NP-05 the cadence/TTL pins, NP-07 the legacy-refusal families. Every new citation was
verified this session at HEAD `a421062` (`git diff cfa4f3b..HEAD -- impl/` is empty — the v1.0
frame holds byte-identical). Of the review's six ±1-line drift notes, three verified and are
fixed (`session.revoked` `web-auth.mjs:154`; the vendor deletes `runtime-isolation.mjs:76-79`;
the `create` return `:150-172`); three did not verify at this frame and stand as cited
(`run-lineage.mjs:28`, `run-lineage.mjs:26-27`, `coordinator.mjs:1764` — re-derived exact; see
`contract-fold.md`). The blocker→change map is `contract-fold.md` in this directory.

**Verification frame.** Every citation below was verified this session (2026-08-06) against the
live worktree at HEAD `cfa4f3b` (2026-08-05), which is POST-#87/#48 (`f4a64da`, the workflow-surface
landing) — the grounding memo (`grounding.md` in this directory, compiled at `aaf3ca3`,
2026-08-03) pre-dates that landing, so every memo citation was re-derived; the drift map is folded
into the ground truths. NUL-bearing files (`application.mjs`, `coordinator.mjs`,
`coordination-store.mjs`) were inspected via `grep -an` / `sed -n` only. Two memo-era facts changed
materially and this contract accounts for both: (1) the eight workflow lanes are LANDED facade
direct ports dispatched BEFORE the recursive-session gate (`impl/src/application.mjs:12184-12191`),
not contracted-and-absent; (2) the `WebSessionStore` is now retained on the deployment as
`#residentSession` (`impl/src/application-deployment.mjs:1562`), so the issuing capability has a
concrete home.

**The issue's law (binding).** Issue #12's acceptance: (a) a worker on an orchestrator-leased run
starts exactly the bounded child runs its lease allows — requested/resolved/observed authority,
nothing more; (b) the projected profile/token is revocable and appears in spawn receipts and
stop/reap evidence; (c) the owner profile store is never read by the worker; (d) red tests cover
lease bounds, revocation, replay, and zero residue. No homelab integration. Issue #74's atlas
guidance (F4, `docs/reference/capability-atlas-2026-08-03/spec-history.md:175-186`): a swarm spec
is a composition of landed authorities (75/77/79/88), never a new one — this rung therefore mints
through `WebSessionStore.issue` and `issueRunOrchestratorLease`, writes through the
credential-projection mechanics, and revokes through `sessions.revoke` +
`revokeRunOrchestratorLease`. Zero new authorities.

## Ground truths

Verified 2026-08-06 against HEAD `cfa4f3b`. Memo anchors that drifted carry their current line.

1. **The resident publishes three files.** `ResidentAuthority.publish`
   (`impl/src/resident-authority.mjs:317`) writes the selector `<git-common-dir>/baton/
   connection.json` (schemaVersion 2 shape `:328-332`), the profile
   `<configRoot>/baton/connections/resident-<repoDigest12>-<deployDigest12>.json` (path `:279`;
   closed shape `:333-340`: schemaVersion 2, transport `local`, socketPath, url/origin, tokenFile
   basename, deploymentId, incarnation, registryDigest, startedAt, ownerPid/ownerPidStart), and
   the mode-0600 token sibling (`writeNew` default 0o600 `:81`; `replaceAtomic` writes
   `:384-393`). The publication outline is retained IN MEMORY
   (`this._publication = Object.freeze({selectorBytes, profileBytes, tokenBytes, …})` `:394-396`).
2. **CLI discovery is a closed contract.** `discoverBatonConnection`
   (`impl/src/application-cli.mjs:213`) reads the selector from the shared common dir (`:228`),
   resolves `configRoot = XDG_CONFIG_HOME | $HOME/.config` (`:251-252`), reads the profile
   owner-only (`:255`, `readBoundedFile` `:121-141`), validates resident owner fields
   (`RESIDENT_PROFILE_OWNER_FIELDS` `:46`; shape law `:65-66`), then resolves the token BESIDE the
   profile (`resolve(dirname(profilePath), profile.tokenFile)` `:270`, owner-only `:271`). A
   missing/unreadable profile throws `cli_config_invalid: user connection profile is unavailable`
   (`:124`) — issue #12's observed failure byte-for-byte. The profile key set is CLOSED
   (`exactKeys` `:256-258`): no marker field may be added to a projected profile.
3. **The worker's private HOME is why discovery fails.** `RuntimeIsolation.create`
   (`impl/src/runtime-isolation.mjs:59`) builds the private root/home/tmp/config tree (`:61-67`),
   strips secret/provider-shaped env (`:69-72`), points `env.HOME` at the private home (`:74`),
   deletes the vendor config-home overrides (`:76-79` — `XDG_CONFIG_HOME` is NOT among them
   today), and returns `{env, replaceEnv: true, paths, posture}` (`:150-172`). The worker reads
   the selector (shared common dir) but its private home carries no `baton/connections/` tree, so
   discovery throws at the profile read. The blocker is exactly profile projection.
4. **The credential-projection mechanics are the write model — the copy semantics are not.**
   `projectCredentialTree` (`impl/src/credential-projection.mjs:89`) enforces owned-source checks
   (`assertOwnedSafeDirectory` `:20-27`), `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` mode-0600 writes
   with fsync (`:146-148`), and returns a secret redactor (`:156-160`). `RuntimeIsolation.create`
   consumes it via `credentialEnv`/`credentialFiles`/`credentialTrees` (`:104-140`). #12 reuses
   the write discipline (0600, O_EXCL, fsync, digest-into-posture) with MINTED content; it never
   reads the owner's store as a source tree.
5. **The session store exists, is retained, and kills in-flight commands on revoke.**
   `WebSessionStore` (`impl/src/web-auth.mjs:29`): `issue` (`:128`) mints random bearer tokens,
   digest-at-rest (`tokenDigest` `:137`), `expiresAt = issuedAt + ttlMs` under the store's
   injected `now` (`:132-140`), and appends durable `session.issued` (`:142`); `revoke` (`:151`)
   appends durable `session.revoked` (`:154`); `isPrincipalActive` (`:205-215`) re-validates
   revocation, expiry, capabilities, and repoIds PER CALL — one revocation kills every in-flight
   command at the next transport check (`impl/src/web-northbound.mjs:624`). The deployment retains
   the store: `this.#residentSession = Object.freeze({sessions, sessionId})`
   (`impl/src/application-deployment.mjs:1562`, field declared `:1238`; owner-session revoke
   precedent `:1617`, `:1641`).
6. **The owner session's capability set is the superset the child is attenuated from.** The
   ordinary host issues the owner session at `impl/src/application-deployment.mjs:1551-1561` with
   capabilities `['observe','control','approve','emergency_stop','export_result',
   'retry_verification','goal:define','goal:observe','plan:propose','plan:approve']` and
   `repoIds: [repoId]`; the local socket serves the same `WebNorthbound` the store is wired into
   (`:1565-1575`, listen `:1579`).
7. **The run-orchestrator lease machinery is landed and digested.**
   `issueRunOrchestratorLease` (`impl/src/coordination-store.mjs:1897`) with idempotent replay
   under the derived key `run.orchestrator_lease:${leaseId}` (`:1899-1908`, `:1916-1918`);
   `_deriveRunOrchestratorLeasePayload` (`:1681`) requires the parent task `working` with brief
   capabilities including `baton_orchestrator` (`:1692-1694`, refusal
   `run_orchestrator_capability_required`), binds `{repoId, parentRunId, parentTaskId,
   parentTaskVersion, workerId, principalId, sessionId, sessionAuthorityDigest}` into the lease
   id (`:1702-1711`), and sets `expiresAt = min(session.expiresAt, issuedAt + leaseTtlMs)`
   (`:1713-1716`). Payload: `{schemaVersion: 1, scope: 'application_run_subtree', repoId, leaseId,
   parent, session, capabilities: [...RUN_ORCHESTRATOR_CAPABILITIES], issuedAt, expiresAt,
   policyDigest, requestDigest, leaseDigest}` (`:1717-1732`). `RUN_ORCHESTRATOR_CAPABILITIES =
   ['run.context','run.start','run.status','run.stop']` (`impl/src/run-lineage.mjs:14-17`);
   `DEFAULT_RUN_LINEAGE_POLICY {maxDepth: 4, maxChildrenPerRun: 8, maxDescendantsPerRoot: 32,
   leaseTtlMs: 30 min}` (`:24-30`). `principalId`/`sessionId` validate against
   `validRunId = /^[A-Za-z0-9._:-]{1,256}$/` (`impl/src/coordination-store.mjs:354`) — colons are
   lawful.
8. **Revocation is closed-form and replay-safe.** `revokeRunOrchestratorLease`
   (`impl/src/coordination-store.mjs:1926`) with the closed reason set
   `RUN_ORCHESTRATOR_REVOCATION_REASONS = ['operator','parent_terminal','parent_run_stopping',
   'review_window_expired','session_revoked','superseded']` (`impl/src/run-lineage.mjs:19-22`),
   appending durable `run.orchestrator_lease_revoked` (`:1948`). Scope enforcement:
   `authorizeRunOrchestratorCommand` (`:2035`) refuses out-of-list commands
   (`run_orchestrator_command_forbidden` `:2040,:2044`) and out-of-subtree targets
   (`run_orchestrator_scope_forbidden` `:2054`); `activeRunOrchestratorLeaseForSession` (`:1956`)
   binds lease↔session identity in two postures (web envelope / run-scoped) and refuses ambiguity
   (`:1980-1982`).
9. **The session↔lease binding envelope already exists end-to-end.**
   `coordinator.acquireBoardLease` (`impl/src/coordinator.mjs:11113-11131`) returns
   `{…receipt, sessionAuthority: {schemaVersion: 1, authorityDigest, expiresAt,
   orchestratorLeaseId}}` (`:11124-11129`); the wire schema is closed
   (`sessionAuthoritySchema`, `impl/src/application-semantics.mjs:1165-1171`);
   `application._recursiveLease` (`impl/src/application.mjs:4304-4321`) validates exactly those
   four fields against the live lease (mismatch → `run_orchestrator_session_mismatch` `:4317`;
   absent lease → `run_orchestrator_lease_not_found` `:4311,:4313`). The hub-minted
   `authorityDigest` precedent is `_settlementCommand`
   (`impl/src/application.mjs:12370-12376`): `digest({kind: 'authenticated-worker-session',
   principalId, sessionId})` — "the lease it materializes binds to the caller who acquired it"
   (`:12364-12367`).
10. **The transport derives sessionAuthority SERVER-SIDE from the authenticated session — the
    child token alone carries the authority.** `web-northbound.mjs` resolves
    `activeRunOrchestratorLeaseForSession({repoId, principalId, sessionId, expiresAt})` from the
    authenticated principal and attaches the envelope to the command context on both the replay
    (`:867-873`, envelope `:884-889`) and live (`:996-1001`) paths. Per-command capability classes
    are registry-derived (`COMMAND_CAPABILITY` `:53-60`) and enforced at `:625-629` (403); repoId
    membership at `:623`; liveness at `:624` (401). The worker's `baton run …` CLI rides this same
    socket transport (ground truth 6), so NO client-side lease fields are ever sent.
11. **The recursive-session gate is landed and its allowlist is exact.**
    `impl/src/application.mjs:12225-12233`: `recursiveReadCommands = {application.help,
    run.inspect, run.episode, run.workstreams, run.status, run.follow, run.wait}` (`:12225-12226`),
    `recursiveEffectCommands = {run.start, run.stop}` (`:12227`); any other command carrying
    `context.sessionAuthority` (except `run.act`, which has its own semantic-authority path)
    throws `run_orchestrator_command_forbidden` (`:12228-12233`). `_admitRecursiveRun` (`:4346`,
    reached from `start()` at `:4434`) admits lease-bound child runs.
12. **The eight workflow lanes are LANDED direct ports dispatched BEFORE the gate** (the post-memo
    change): `run.message.send`/`receipt`, `run.attention.watch`, `run.scratchpad.read`/`elevate`,
    `run.board.post`/`read`, `run.knowledge.seed` at `impl/src/application.mjs:12184-12191`, with
    the FP-18 rationale comment at `:12177-12183` ("BD3-D deliberately admits a live
    run-orchestrator lease holder as review authority"). Implementations: `messageSend :12597`,
    `messageReceipt :12623` (resolve-then-authorize via `coordinator.messageRunId`, unknown ≡
    foreign ≡ `application_unauthorized` `:12630-12632`), `attentionWatch :12641` (no facade
    `_authorize`; the lane's own scope authority is the sole seam), `scratchpadRead :12656` (256
    KiB serialized page budget, `{frame,digest}` truncation doctrine), `scratchpadElevate :12696`,
    `boardPost :12718`, `boardRead :12788`, `knowledgeSeed :12811`. Capability classes (facade
    contract v2.2 Decision 10 table; MCP registrations `impl/src/mcp-northbound.mjs:108-113`):
    send/elevate/seed require `control`+`observe`; receipt/watch/read require `observe`. The
    facade's `_authorize` (`:3088`) delegates to the deployment-injected `authorize`
    (`:2368`), today `async () => true` at `impl/src/application-deployment.mjs:1969` — capability
    enforcement lives at the transport (ground truth 10), scope authorization at the lanes.
13. **The review-authority seam already admits the lease holder.**
    `coordinator._isReviewAuthority` (`impl/src/coordinator.mjs:7004-7018`) returns true for
    `wave-owner` or a live run-orchestrator lease holder matched run-scoped by parent run +
    session identity; `attentionFollow` at `:6955`. A coordinator-lead child can therefore watch
    exactly its own parent run's attention scope, nothing else.
14. **The runtime-scope seam is the single funnel for spawn and reap.**
    `coordinator._ensureRuntimeScope` (`impl/src/coordinator.mjs:8498-8511`) creates the lease
    per-spawn and logs durable `runtime.scope_created` with the posture as payload (`:8506-8510`);
    the adapter spawn consumes `replaceEnv` at `:3709` (also `:5352`, `:5766`); `lifecycle.spawned`
    appends at `:3667`. `_removeRuntimeScope` (`:8513-8530`) is the ONLY caller of
    `runtimeScopes.remove` — every terminal path funnels through it (run-stop `cancelTask`
    `:1762`, worker stop `:3858`, crash/settlement paths `:1823,:1856,:1929,:5312,:7725,:7747,
    :7758,:7805,:7863,:7874,:8480,:8492,:8536,:9267,:9328`), with failure posture
    `cleanupPending`/`runtime_cleanup_failed` and `coordinator_run_stop_incomplete` (`:1764`).
    `RuntimeIsolation.remove` (`impl/src/runtime-isolation.mjs:175-184`) reaps the private tree;
    `reconcile` (`:186-192`) sweeps orphaned runtime roots.
15. **The parent-death sweep pattern is landed and settlement-scoped.**
    `sweepSettlementLeases` (`impl/src/coordination-store.mjs:12480`) revokes active settlement
    leases whose parent run was never admitted, reason `review_window_expired` (`:12490-12502`),
    driven from `coordinator.settlementLease` (`impl/src/coordinator.mjs:11404`). The settlement
    lease mint itself (`:11440-11472`) is the exact precedent for pinning a session's
    `expiresAt` to a lease-epoch anchor (the task creation instant, `:11446-11450`) rather than a
    live clock.
16. **The deployment's authority hand-off precedent is `goalPlanAuthority`.** Driver wiring:
    `runtimeIsolation: {root, credentialEnv, credentialFiles, credentialTrees}`
    (`impl/src/application-deployment.mjs:1901-1906`) beside `goalPlanAuthority:
    deploymentGoalPlanAuthority(repository.repoId)` (`:1907`) — a bounded authority OBJECT handed
    to the driver, whose worker-denial posture is stated as policy
    (`principalId.startsWith('worker:') → false` at `:2007`, function `:2002-2010`).
17. **The lease precondition is a brief capability, not a flag.** `issueRunOrchestratorLease`
    requires the parent task's brief to carry `baton_orchestrator`
    (`impl/src/coordination-store.mjs:1692-1694`); the settlement plane mints such tasks with
    `capabilities: ['baton_orchestrator']` (`:12433`). A coordinator-lead worker is therefore a
    worker whose task brief carries `baton_orchestrator` — every other worker's runtime stays
    byte-identical to today.
18. **waves.* ride the pre-gate direct ports** (`impl/src/application.mjs:12219-12223`;
    `startWave :11437` delegates each member to `this.start(…, principal, context)` `:11453-11463`,
    so a lease-holder's member starts route through `_admitRecursiveRun`). Whether the wave
    subtree binds cleanly under a worker-held lease is #74's own verification question — v1 does
    not exercise it (Non-goals).
19. **Escalation is landed wire grammar, not a new lane.** `DECISION_REQUEST_GRAMMAR`
    (`impl/src/claude-session.mjs:27`) with the single-request pin (`:1133` region); the human
    answers via `run.answer` / `baton_decision_answer` (`impl/src/mcp-northbound.mjs:533`),
    capability `['approve','observe']` (`:91`) — a class the child deliberately never holds.
20. **BD3-B context packs are kernel-only.** `mintContextPack`
    (`impl/src/coordination-store.mjs:13157`), `materializeContextPack` (`:13180`),
    `recordContextRead` (`:13252`) have no facade/MCP projection — a coordinator-lead's pack mints
    route through the human orchestrator in v1 (facade contract v2.2 records the gap; #74 owns the
    lane).

## Decisions

### 1. The child authority is a MINTED session + a MINTED lease, never a copy

At spawn of a worker whose task brief carries `baton_orchestrator` (ground truth 17), the
resident mints a CHILD session through the existing `WebSessionStore.issue`
(`impl/src/web-auth.mjs:128`) with:

- `userId: 'worker:<workerId>'` — passes the lease's `validRunId` grammar
  (`impl/src/coordination-store.mjs:354`) and inherits the deployment's stated worker-denial
  policies by construction (`principalId.startsWith('worker:')`,
  `impl/src/application-deployment.mjs:2007`). The prefix is a SECURITY PREDICATE, not a naming
  posture: three seams consume it — the goal/plan denial (`:2007`), the legacy-command refusal,
  and the lane scope binding (both Decision 6);
- `authMethod: 'bearer'`; `repoIds: [repoId]`;
- capabilities EXACTLY `['observe','control']` — `observe` covers the receipt/watch/read lanes
  and the seven recursive reads, `control` covers the `run.message.send`/`run.scratchpad.elevate`/
  `run.knowledge.seed` lanes and recursive `run.start` (ground truths 11-12). Recursive
  `run.stop` is `emergency_stop`-class at the transport (`impl/src/application.mjs:173`) — a
  class the child deliberately never holds — so the child reaches it ONLY through the
  lease-scoped transport carve-out (Decision 6), the lease as the authority.
  Deliberately excluded: `approve`, `emergency_stop`, `export_result`, `retry_verification`,
  `goal:*`, `plan:*` — the human orchestrator keeps those; the coordinator-lead escalates via the
  landed DECISION_REQUEST grammar (ground truth 19);
- `ttlMs` = the run-lineage policy's `leaseTtlMs` (`impl/src/run-lineage.mjs:28`), minted under
  the session store's INJECTED `now` (`impl/src/application-deployment.mjs:1547-1550`).

The coordinator then mints the run-orchestrator lease through the existing
`coordinator.acquireBoardLease` (`impl/src/coordinator.mjs:11113`) — the same wrapper the
settlement plane uses — with `parentTask: {id, version}` of the worker's own task and
`session: {principalId: 'worker:<workerId>', sessionId, authorityDigest, expiresAt}` where
`authorityDigest` is hub-minted by the `_settlementCommand` precedent
(`digest({kind: 'authenticated-worker-session', principalId, sessionId})`,
`impl/src/application.mjs:12370-12376`). The returned `sessionAuthority` envelope
(`:11124-11129`) is the binding the transport will re-derive server-side on every child command
(ground truth 10) — the child NEVER presents it.

**Rationale:** issue #12 names the anti-goal (never the owner's full profile) and the two
candidate shapes; the minted-session shape is chosen because every authority it touches —
issuance, binding, scope enforcement, revocation, transport derivation — is already landed and
digested (ground truths 5, 7-10). A delivered-token shape would invent a parallel authority, which
F4 forbids. **`baton_orchestrator`-brief gating is the projection condition:** a worker whose
brief lacks the capability gets NO profile — its runtime is byte-identical to today's, and
discovery's absence refusal (ground truth 2) remains its only answer.

### 2. The TTL is pinned to the lease epoch — no clocks

The session's `expiresAt` is computed from the store's injected clock at issue (ground truth 5);
the lease's `expiresAt = min(session.expiresAt, issuedAt + leaseTtlMs)`
(`impl/src/coordination-store.mjs:1713-1716`) under the coordination store's injected `_clock`
(`:1913`). With equal TTLs minted in one spawn step the two epochs coincide, and the lease clamps
any skew downward — the child can never outlive its lease. Acceptance compares the child
session's `expiresAt` to the lease's `expiresAt` (equality under the pinned policy), never to a
wall clock; every test drives the injected clocks. The projection path itself performs ZERO
time reads.

**Rationale:** campaign law — TTL is lease-epoch-bound, not wall-time. Both stores already take
injected clocks; the settlement plane pins lease epochs to durable instants for replay stability
(ground truth 15, `impl/src/coordinator.mjs:11446-11450`); this rung inherits that posture.

### 3. The projection writes two FRESH files through the credential-projection mechanics

`RuntimeIsolation.create` (`impl/src/runtime-isolation.mjs:59`) gains a projection step AFTER the
credential block (`:104-140`), BEFORE the return (`:150`), consuming a new OPTIONAL
`connection` material handed through the spawn wiring (Decision 4). When present:

- write `<paths.home>/.config/baton/connections/<selector.profile>.json` and the token sibling
  `<…>/<tokenFile>` (the profile's `tokenFile` basename, resolved beside the profile exactly as
  discovery resolves it, `impl/src/application-cli.mjs:270`) — each `O_CREAT|O_EXCL|O_WRONLY|
  O_NOFOLLOW`, mode 0600, fsync, the `credential-projection.mjs:146-148` discipline;
- the profile bytes are the resident's publication profile shape (ground truth 1) constructed
  from the authority's IN-MEMORY publication outline (`resident-authority.mjs:394-396`) — same
  socketPath/deploymentId/incarnation/registryDigest/startedAt and the resident's
  ownerPid/ownerPidStart (worker and resident share uid and the live socket) — with NO read of
  the owner's on-disk store, and no fields added (the closed discovery shape forbids them,
  ground truth 2);
- the token bytes are the CHILD session's raw token + `\n` (the `tokenBytes` shape,
  `resident-authority.mjs:343`), freshly minted at Decision 1 — never the owner's token;
- `<paths.home>/.config` and intermediates are mode 0700, matching the private-tree permission
  posture (`runtime-isolation.mjs:168`);
- `env.XDG_CONFIG_HOME` is deleted beside the vendor override deletes
  (`runtime-isolation.mjs:76-79`) so discovery resolves `$HOME/.config` deterministically
  (`application-cli.mjs:251-252`) — a leaked owner `XDG_CONFIG_HOME` would otherwise route the
  worker's discovery at the OWNER's store, the exact anti-goal #12 names;
- the projection digests into `posture` as `connectionProjection: {state: 'materialized',
  profileDigest, tokenDigest, sessionId, orchestratorLeaseId, expiresAt}` (digests and ids only —
  the posture's no-paths/no-inventory law, `runtime-isolation.mjs:151-153`), landing in the
  durable `runtime.scope_created` receipt through the existing posture logging
  (`coordinator.mjs:8506-8510`) and the spawn evidence (`lifecycle.spawned` `:3667`).

Non-projection (ordinary worker) writes NOTHING and adds `connectionProjection: {state:
'absent'}` — the absence is discoverable in posture, and the on-disk absence remains the refusal
(Decision 6).

**Rationale:** the issue demands "revocable, mode-0600, digested into the spawn receipt" with the
credential-projection mechanics as the write model and the copy semantics explicitly excluded
(grounding memo §2). Writing minted bytes (not `projectCredentialTree`, which copies a source
tree) is the honest reuse: same primitives, zero owner-store reads. The two-files-exactly shape
keeps the worker's connections tree enumerable and the residue proof trivial.

### 4. The bounded connection-authority hand-off — three insertion points, zero new authorities

(a) **Driver wiring** (`impl/src/application-deployment.mjs:1901-1907`): add a
`connectionAuthority` beside `runtimeIsolation` and `goalPlanAuthority`, following the
`goalPlanAuthority` precedent (ground truth 16). The authority is a closure over the deployment's
retained session store (`#residentSession`, `:1562`) and the resident authority's publication
outline, exposing EXACTLY two operations — `mintChildAuthority({workerId, parentTask})` (Decision
1's session mint + profile/token byte construction; returns the material and ids) and
`revokeChildAuthority({sessionId, leaseId, leaseDigest, reason})` (session revoke + lease
revoke). It cannot mint owner-class capabilities (the capability list is fixed in the closure),
cannot read the owner store (it holds the in-memory outline, never the paths), and cannot touch
the owner session (it tracks only its own minted {sessionId ↔ leaseId} ledger).

(b) **Spawn seam** (`coordinator._ensureRuntimeScope`, `impl/src/coordinator.mjs:8498-8511`):
when the handle's task brief carries `baton_orchestrator`, call `mintChildAuthority`, mint the
lease through `acquireBoardLease` (Decision 1), and pass the projection material into
`runtimeScopes.create`. A mint/lease/projection failure rides the EXISTING runtime-scope failure
posture — `_releaseProviderTurnAdmission(handle, 'runtime_scope_unavailable')` +
`lifecycle.crashed` phase `runtime_scope` (`coordinator.mjs:3530-3543`): the worker simply never
starts, and no partial authority exists (O_EXCL per-file writes; a failed projection leaves no
profile, and absence is the refusal).

(c) **Materialization** (`RuntimeIsolation.create`, Decision 3).

**Rationale:** the grounding memo's three insertion points, re-verified at their drifted anchors;
the store retention landing (ground truth 5) turns insertion point (c) of the memo ("hand a
bounded issuing capability down") into a concrete closure over `#residentSession`. No new
authority classes. v1.1 adds exactly ONE refusal code (`worker_legacy_command_forbidden`) and two
rules at the EXISTING transport `_authorize` seam (`web-northbound.mjs:625-629` region) — the
`run.stop` carve-out and the legacy-set refusal, both byte-stable for the owner (Decision 6); no
new seam, no new refusal plane.

### 5. The fail-closed generation binding: terminal-path revocation BEFORE reap, plus the orphan sweep

Parent dies → child authority dies. Three existing hooks, one wire:

- **Worker-terminal path.** `_removeRuntimeScope` (`impl/src/coordinator.mjs:8513-8530`) is the
  single reap funnel (ground truth 14). When the handle carries child authority, the coordinator
  FIRST calls `revokeChildAuthority` — `revokeRunOrchestratorLease`
  (`impl/src/coordination-store.mjs:1926`) with reason `parent_terminal` (closed set, ground
  truth 8) and `sessions.revoke` (`impl/src/web-auth.mjs:151`) — and ONLY THEN reaps the private
  home. A revocation failure rides the existing cleanup-failure posture
  (`cleanupPending`/`runtime_cleanup_failed`, `coordinator_run_stop_incomplete` `:1764`) and the
  sweep is the backstop — the home reap never gates on best-effort revocation, and live authority
  never outlives the reap by design (session liveness is re-checked per call, ground truth 5).
- **Orphan sweep — with the cadence disclosed (v1.1).** A sibling sweep on the
  `sweepSettlementLeases` pattern (`impl/src/coordination-store.mjs:12480-12502`): active
  run-orchestrator leases whose parent task is terminal-or-gone (and whose parent relation is
  not the settlement plane's own) are revoked with reason `parent_terminal`; the connection
  authority then revokes every minted session whose lease is no longer active. The sweep is
  DRIVER-TRIGGERED, NO TIMERS — the pattern's own law (`:12472-12479`) — so cadence is pinned at
  every seam it can honestly fire: at wave close (`coordinator.settlementLease` `:11404`), on
  resident stop before the owner session's own revoke
  (`application-deployment.mjs:1617,:1641`), AND on resident START, riding the coordinator's
  startup recovery pass that already reconciles runtime scopes (`_trackStartupCleanup`,
  `impl/src/coordinator.mjs:1367-1370`, defined `:1516`). The startup pass re-derives orphans
  from the DURABLE lease records (the lease payload binds the session, `:1717-1732`) — never
  from the volatile ledger (Decision 4a), which a crash destroys. `RuntimeIsolation.reconcile`
  (`runtime-isolation.mjs:186-192`) already sweeps orphaned runtime roots — the projected token
  file dies with the home regardless; the sweep kills the AUTHORITY, which is the load-bearing
  half (a leaked token file without a live session authenticates nothing — `isPrincipalActive`
  fails closed).
- **The TTL is the true orphan bound — a resource lease, not a control clock (v1.1).** In a
  wave-free deployment the wave-close cadence never fires, and sessions are DURABLE across a
  resident crash/restart (`sessions.jsonl`, reload `_load` `impl/src/web-auth.mjs:48-63`), so an
  un-revoked child session — and an exfiltrated token copy — outlives even the home reap until
  expiry. The honest bound on orphaned authority is therefore the TTL (≤30 min,
  `leaseTtlMs: 30 * 60 * 1_000`, `impl/src/run-lineage.mjs:28`), not the sweep. Classification,
  as campaign law: the TTL is a RESOURCE LEASE — it bounds how long minted authority can linger
  as residue; it does not schedule, pace, or steer behavior, so it is never a control clock.
  Revocation stays event-driven (the terminal path, the sweep, the per-call parent re-check
  below); the TTL is the accepted, disclosed worst-case residue window, and there is no
  self-renewal (`rotate` `web-auth.mjs:158` has no transport route — dispatch enumeration
  `web-northbound.mjs:1003-1052`). NP-05 pins the bound, not a cadence that never fires.
- **The lease is self-defending on parent death (v1.1 disclosure).** Independent of revocation
  ordering, `_activeRunOrchestratorLease` re-checks the parent task PER CALL
  (`impl/src/coordination-store.mjs:1806-1811`): a terminal parent fails every subsequent
  lease-bound command `run_orchestrator_parent_inactive` (`:1807`) even if the revocation wire
  never runs. The terminal-path revocation above is the EVIDENCE path; this per-call check is
  the SAFETY path.
- **The in-flight window (v1.1 disclosure).** An already-dispatched mutating command COMPLETES —
  liveness is checked at dispatch (`impl/src/web-northbound.mjs:624`) — while an open long-poll
  is re-authenticated AND re-authorized when it resolves (`_postWaitAuthorization`,
  `web-northbound.mjs:633-638`, on both the replay `:844-851` and live `:920-927` paths), so a
  revoked child's open `run.follow`/`run.wait` dies 401 at wait end: maximum overstay one
  read-only wait window. A `run.start` racing the parent's death has exactly two arms: admitted
  before the parent's stop admission computes its target set, the grandchild is INSIDE it —
  `run.stop_admitted` enumerates the descendant subtree when the lineage policy is active
  (`_runStopTargets`, `impl/src/coordination-store.mjs:4234-4237`, consumed at `:12158`) and is
  stopped with the parent; admitted after, it escapes the cascade as an ordinary orphan run —
  its authority dead at next use (the per-call check above), its runtime residue reaped by
  `reconcile`, its lease and session collected by the sweep. NP-04 pins both arms; no stop path
  beyond the admission-time cascade walks the subtree, and none is invented here.
- **Receipts (every kind named).** Durable evidence: `session.issued`
  (`web-auth.mjs:142`), `run.orchestrator_lease_issued` (`coordination-store.mjs:1922`),
  `runtime.scope_created` carrying the projection posture (`coordinator.mjs:8506-8510`),
  `lifecycle.spawned` (`coordinator.mjs:3667`); on the death path: `run.orchestrator_lease_revoked`
  (`coordination-store.mjs:1948`) and `session.revoked` (`web-auth.mjs:154`) — these two events
  ARE the stop/reap evidence the issue demands, and acceptance pins their ordering (revocations
  precede the home reap) and their presence in stop evidence.

**Rationale:** the memo's §3 verdict, re-verified: issuance/scope/revocation/sweep/residue all
landed; the new work is the wire from the terminal path plus the sweep — "not inventing a
revocation authority."

### 6. The v1 drivable surface — and the refusal that IS the absence

A spawned coordinator-lead child (session capabilities `['observe','control']` + live lease)
drives, through the socket transport with server-derived `sessionAuthority` (ground truth 10):

- **Recursive run authority (the gate's allowlist, unchanged):** `run.start`/`run.stop` plus the
  seven reads (`application.help`, `run.inspect`, `run.episode`, `run.workstreams`, `run.status`,
  `run.follow`, `run.wait`) — lease-scope-enforced (`authorizeRunOrchestratorCommand`, ground
  truth 8), depth/children bounded by the lineage policy (`maxDepth 4`, `maxChildrenPerRun 8`,
  `maxDescendantsPerRoot 32`, ground truth 7);
- **The eight workflow lanes (landed, pre-gate):** `run.board.post`/`run.board.read`,
  `run.knowledge.seed`, `run.scratchpad.read`/`run.scratchpad.elevate`, `run.message.send`/
  `run.message.receipt`, `run.attention.watch` — each under its own landed authorization
  (ground truth 12) PLUS the v1.1 scope binding below: capability classes satisfied by
  `observe`+`control`; `attention.watch`'s viewer authority admits the child for exactly its
  parent run's scope (ground truth 13); `message.receipt` resolves-then-authorizes with unknown ≡
  foreign; the board lanes carry their binding law verbatim.

**The v1.1 transport carve-out: `run.stop` under `control`, the lease as the authority.**
`run.stop` declares `capabilities: ['emergency_stop','observe']` (`impl/src/application.mjs:173`),
and the transport enforces the class unconditionally at `_authorize`
(`impl/src/web-northbound.mjs:625-629`) — before dispatch, before the gate, before the lease is
consulted — so the v1.0 child could start bounded child runs but never stop one. The rung
therefore owns ONE transport rule change explicitly: when `run.stop` arrives from a principal
lacking `emergency_stop`, the transport admits it under `control` IFF (i) the server-derived
`sessionAuthority` resolves a LIVE lease — the same derivation the live path already performs
(`web-northbound.mjs:977-983`) — and (ii) the store's own scope law accepts the target
(`authorizeRunOrchestratorCommand`, `impl/src/coordination-store.mjs:2035-2058`: the first-hop
lineage must carry THIS lease's id, `:2046-2054`; a foreign OR unknown target refuses
identically). Any carve-out failure falls through to the standard capability enforcement — the
refusal is the byte-identical 403 `forbidden` body (`web-northbound.mjs:625-629`, the
`error(status, code)` shape `:148`), so a foreign run, an unknown run, and a missing class are
indistinguishable (no existence leak). The admitted command is scope-checked AGAIN by the store
on the command path (`_authorizeRecursiveCommand('run.stop', …)`,
`impl/src/application.mjs:12877`) — the carve-out admits at the transport; the lease remains the
authority. A non-lease `control` principal's `run.stop` draws the same 403 as today,
byte-identical. `kill`/`drain` are untouched: they ride `emergency_stop`
(`web-northbound.mjs:54`), a class the child never holds, and the worker refusal below bars them
by prefix regardless. Granting `emergency_stop` instead was considered and rejected — it admits
`kill`/`drain` on every worker in the deployment.

**The v1.1 legacy-command refusal: the operator set is owner-only.** The non-application
transport command table (`web-northbound.mjs:53-60`, dispatch `:1003-1052`) was calibrated for
the omnipotent owner and has never had to distinguish worker principals — this rung mints the
first worker-held credential, so it closes the set: a `worker:`-prefixed principal is REFUSED
every legacy operator command with the typed 403 `worker_legacy_command_forbidden`, enforced by
one rule at the `_authorize` seam (`web-northbound.mjs:625-629` region) and reusing the
deployment's stated `principalId.startsWith('worker:')` posture
(`impl/src/application-deployment.mjs:2007`). The refused set, by family: SPAWN — `spawn`
(class `control` `:54`, dispatch `:1003-1015`; `coordinator.spawn` `coordinator.mjs:4178` carries
NO run-membership, lease, or principal-scope guard — its guards are plan-gating/task-id/route
checks, `:4183-4220` — so raw spawn is unbounded fan-out that bypasses every lineage bound) and
`scratch_oracle` (`:54`, dispatch `:1024-1030`); MESSAGE — `send` and `interrupt` (`:54`,
dispatch `:1031-1032`/`:1033-1034`; `FENCE_REQUIRED` `:60` is no barrier — the current fence is
readable through `list` = `observe` `:55`, dispatch `:1041-1042`, the same projection `steer()`
reads `target.fence` from, `application.mjs:12849-12851` — so list-then-send would be cross-run
injection); EMERGENCY — `kill`, `drain` (`:54`); RESPOND — `respond` (`:54`, `approve`-class);
CAPABILITY — `capability_invoke`, `reuse_decide`, `reuse_recheck` (`:55`). The observe-class
legacy reads (`list`, `result`, `wait`, `capabilities`, `provider_status`, `:55`) remain
admitted — `observe` is a class the child legitimately holds. The refusal is fail-closed and
byte-stable for the owner: the owner principal is never `worker:`-prefixed, so the rule never
fires for it (NP-07). If #74 later needs a worker-reachable spawn, it rides `run.start` through
the lease, never the legacy lane.

**The v1.1 lane scope binding: principal↔run, the lease subtree as scope.** Seven of the eight
lanes bind board↔run or task↔run but, pre-rung, never principal↔run — the facade `_authorize`
(`impl/src/application.mjs:3088`) delegates to the deployment-injected `authorize` (`:2368`),
today `async () => true` (`impl/src/application-deployment.mjs:1969`), and the pre-gate dispatch
(`:12184-12191`) hands each lane `(args, principal)` with the derived `sessionAuthority` dropped.
The rung adds the binding at that one seam — each of the seven calls `_authorize` with its target
runId (`messageSend :12608`, `messageReceipt :12634`, `scratchpadRead :12661`,
`scratchpadElevate :12710`, `boardPost :12723`, `boardRead :12793`, `knowledgeSeed :12816`):
for a `worker:`-prefixed principal the deployment `authorize` admits the call only when the
caller holds a live lease and the target run lies INSIDE that lease's subtree — the store's
first-hop law (`coordination-store.mjs:2046-2054`) applied to the lane's run, the lease
re-derived exactly as `_isReviewAuthority` re-derives it (`activeRunOrchestratorLeaseForSession`,
two postures, `coordination-store.mjs:1956-1989`; `coordinator.mjs:7010-7013`), or the pre-gate
dispatch passes the transport-derived `sessionAuthority` through — the LAW is pinned either way,
the plumbing is the implementer's call. A FOREIGN target and an UNKNOWN target refuse the SAME
constant `application_unauthorized` (the lanes' own unknown ≡ foreign code,
`application.mjs:12630-12632`) — no existence leak; a sibling run INSIDE the subtree (its
first-hop lineage carries THIS lease's id) is admitted. `run.start` is deliberately NOT bound at
this seam: its target does not exist yet by construction (its `_authorize` names `intent.runId`,
`application.mjs:4420`) and its lease enforcement is the store's own (`_admitRecursiveRun`,
ground truth 11). `run.attention.watch` needs none: its own seam already matches the lease
run-scoped (ground truth 13). Scoping ONLY `worker:`-prefixed principals keeps the owner's
omnipotent posture byte-identical — refusal constancy (NP-07) is preserved.

**The recursive-session gate is NOT widened.** Its refusal
(`run_orchestrator_command_forbidden`, `application.mjs:12228-12233`) stays byte-identical for
everything outside the allowlist. The rung's transport changes are exactly the two rules above,
both at the existing `_authorize` seam and byte-stable for the owner. waves.* for a lease-holding
worker (ground truth 18) is #74's own rung, deliberately not exercised here.

**A non-lease worker's runtime carries NO profile — its absence is the refusal.** Discovery fails
exactly as today: `cli_config_invalid: user connection profile is unavailable`
(`application-cli.mjs:124`). The rung never writes a placeholder, a malformed profile, or an
expired-token decoy: a runtime either holds a minted, lease-bound profile or holds nothing.

**Rationale:** the workflow-surface landing (`f4a64da`) made the eight lanes reachable to any
principal with the capability class and lane authorization BEFORE the memo's planned gate
widening was needed — FP-18's pre-gate dispatch deliberately preserves lease-holder lane
authority (`application.mjs:12177-12183`). The honest v1 is therefore the allowlist + the eight
lanes, with the gate's refusal constancy pinned as acceptance (NP-07). The v1.1 fold keeps that
shape and closes what the landing left open: the `run.stop` carve-out and the legacy-set refusal
at the transport (pinned NP-02/NP-07), and the principal↔run binding at the facade `_authorize`
seam (pinned NP-03) — two transport rules and one facade rule, all byte-stable for the owner.

### 7. The honest-posture story: digested, minted-not-copied, provable

The projection is honest in three pinnable senses. (1) DIGESTED: `posture.connectionProjection`
carries `profileDigest`/`tokenDigest`/`sessionId`/`orchestratorLeaseId`/`expiresAt` (Decision 3),
surfacing in `runtime.scope_created` and spawn evidence. (2) MINTED-NOT-COPIED: the child token
is a fresh random bearer whose digest differs from every tokenDigest in the owner store; the
session store's own durable `session.issued` payload carries the distinct digest
(`web-auth.mjs:137-142`). (3) CONTENT-INDEPENDENT: revoking or rotating the owner session leaves
the child session live (separate store rows, separate digests), and revoking the child leaves the
owner untouched; the projection path performs ZERO reads of the owner's connections tree (the
profile is constructed from the in-memory publication outline, ground truths 1-2). The profile
JSON itself is byte-compatible with the owner's publication by CONSTRUCTION (same socket, same
incarnation — ground truth 2's closed shape forbids distinguishing fields); the never-copied law
governs the SECRET and the PATH, and both are pinned (NP-08).

One boundary is stated explicitly (v1.1): these proofs are MECHANISM honesty, not an OS boundary.
Worker and resident share a uid, and runtime-isolation disclaims kernel sandboxing
(`impl/src/runtime-isolation.mjs:1-2`), so a hostile worker can read the owner's token file
directly — or fabricate a profile naming it by absolute path, which discovery accepts
(`isAbsolute(profile.tokenFile)`, `impl/src/application-cli.mjs:270`). That exposure is
PRE-EXISTING (the same-uid worker could already read the file; the rung neither introduces nor
worsens it), so the issue's acceptance (c) is pinned as the zero-read CONSTRUCTION proof
(NP-08(b)) — a mechanism pin, never a claim of filesystem isolation. A one-line discovery
hardening (`tokenFile` must be a basename) is worth filing separately; it is not this rung.

**Rationale:** "the posture digest proves minted-not-copied" — the proof is the digest inequality
of the secret plus the zero-read construction path, not an invented marker byte the discovery
contract would refuse.

### 8. Non-goals (deliberately not this rung)

- Widening the recursive-session gate (waves.*/message/board under the recursive path beyond the
  pre-gate dispatch that already exists) — #74's own rung atop this one;
- Any `sessionAuthority` field on MCP ordinary tools (facade contract v2.2 ground truth 15:
  ordinary plane carries none, `:364-371` of that contract); MCP board tools stay
  combined-surface + S-2 lease (that contract's Decision 10) — the child drives boards through
  the facade lanes;
- Capabilities beyond `observe`+`control`, or any `approve`-class reach (DECISION_REQUEST answers
  stay with the human orchestrator, ground truth 19);
- Reading or copying the owner's profile store, in whole or in part;
- BD3-B context-pack facade projection (kernel-only, ground truth 20) — #74's second gap; v1
  pack mints route through the human orchestrator;
- Closing the public `BatonApplication.driver` field or any composition-law change (the facade
  epic filed its own issue for that);
- Homelab integration (excluded by the issue).

## Refusal vocabulary

Every code below already exists except the ONE the v1.1 fold adds — `worker_legacy_command_forbidden`
(Decision 6). Byte-constancy pre/post-rung is NP-07.

| Code / signal | Seam | When the child (or non-child) sees it |
| --- | --- | --- |
| `cli_config_invalid: user connection profile is unavailable` | `application-cli.mjs:124` (via `:253`) | Non-lease worker discovery; any runtime with no projected profile — THE absence refusal, byte-identical to today |
| `cli_config_invalid: user connection profile is invalid` | `application-cli.mjs:268` | A malformed projected profile (implementation bug surfacing honestly; closed-shape validation) |
| `cli_config_invalid: private Baton token file content is invalid` | `application-cli.mjs:272-274` | A malformed projected token |
| 401 `unauthenticated` | `web-northbound.mjs:624` via `isPrincipalActive` (`web-auth.mjs:205-215`) | Expired/revoked child session — one revoke kills every in-flight command at the next call |
| 403 `forbidden` | `web-northbound.mjs:625-629` | Capability shortfall — e.g. `run.answer` (`approve`), `run.workstream.stop` (`emergency_stop`), goal/plan classes; v1.1 — also every `run.stop` the carve-out does not admit (a non-lease `control` principal, or a lease holder targeting a foreign/unknown run: unknown ≡ foreign ≡ these same bytes, `error(status, code)` shape `:148`) |
| 403 `worker_legacy_command_forbidden` | `web-northbound.mjs:625-629` region (the `_authorize` seam) — v1.1, the rung's ONE new code | A `worker:`-prefixed principal reaches for the legacy transport operator set — `spawn`, `scratch_oracle`, `send`, `interrupt`, `kill`, `drain`, `respond`, `capability_invoke`, `reuse_decide`, `reuse_recheck` (Decision 6, per-family pins) — fail-closed; never emitted for the owner |
| `run_orchestrator_command_forbidden` | `application.mjs:12232`; also `coordination-store.mjs:2040,:2044` | Lease holder reaches outside the recursive allowlist (gate) or outside `RUN_ORCHESTRATOR_CAPABILITIES` (store) |
| `run_orchestrator_scope_forbidden` | `coordination-store.mjs:2054` | Lease-bound command targets outside the lease subtree |
| `run_orchestrator_session_mismatch` | `application.mjs:4317` | Presented/derived envelope disagrees with the live lease |
| `run_orchestrator_lease_not_found` | `application.mjs:4311,:4313` | No live lease for the envelope |
| `run_orchestrator_lease_revoked` | `coordination-store.mjs:1800` | Use of a revoked lease |
| `run_orchestrator_lease_invalid` / `run_orchestrator_lease_conflict` | `coordination-store.mjs:1897-1921` region | Malformed or conflicting mint/revoke requests (replay-safe) |
| `run_orchestrator_capability_required` | `coordination-store.mjs:1692-1694` | Lease mint against a brief lacking `baton_orchestrator` — also the spawn-time posture: no brief capability → no mint → no profile |
| `run_orchestrator_parent_inactive` / `run_orchestrator_parent_stale` | `coordination-store.mjs:1688-1691` | Parent task terminal or version-mismatched at mint |
| Lane-level typed codes | facade contract v2.2 Decisions 3-9 | `application_unauthorized` (message receipt unknown ≡ foreign, `application.mjs:12630-12632`; v1.1 — also every workflow-lane call by a `worker:`-prefixed principal whose target run lies outside its lease subtree, unknown ≡ foreign, the same bytes, Decision 6), `attention_scope_forbidden`, `scratchpad_settlement_*`, `stale_scratchpad_fence`, `temporal_incoherence`/`missing_evidence` (seed), board family — all propagate byte-identically |
| `runtime_scope_unavailable` + `lifecycle.crashed` phase `runtime_scope` | `coordinator.mjs:3530-3543` | Mint/lease/projection failure at spawn — the worker never starts; no partial authority |
| `runtime_cleanup_failed` / `coordinator_run_stop_incomplete` | `runtime-isolation.mjs:178-183`; `coordinator.mjs:1764` | Reap/terminal-path failure — the orphan sweep is the backstop |

## Acceptance pins

Mock-transport/mock-session rows ride the existing lease/replay/cleanup harnesses (the issue's
acceptance (d)). "Child" = a spawned worker whose brief carries `baton_orchestrator`.

- **NP-01 (spawn carries the minted profile — receipts pin).** Child spawn: the private home
  contains EXACTLY two files at `<home>/.config/baton/connections/` — `<selector.profile>.json`
  + the token sibling — each mode 0600; `posture.connectionProjection` carries
  `{state: 'materialized', profileDigest, tokenDigest, sessionId, orchestratorLeaseId,
  expiresAt}`; durable `session.issued` (capabilities exactly `['observe','control']`),
  `run.orchestrator_lease_issued` (parent = the worker's task, session = the child binding),
  `runtime.scope_created` (posture payload), and `lifecycle.spawned` all present and
  cross-consistent (sessionId/leaseId/digests match across receipts).
- **NP-02 (discovery + bounded child runs — over the REAL socket transport).** Inside the child
  runtime, discovery resolves the projected profile (selector read from the shared common dir,
  profile+token from the private home); the child drives the SOCKET TRANSPORT — the server-derived
  `sessionAuthority` path (`web-northbound.mjs:977-983`), never `application.command` with a
  hand-built context. `run.start` of a child run inside the lease subtree is admitted with
  requested/resolved/observed authority; depth 5 (beyond `maxDepth 4`), a 9th child (beyond
  `maxChildrenPerRun 8`), and an out-of-subtree target refuse `run_orchestrator_scope_forbidden`
  / the lineage bounds. The carve-out rows (v1.1): `run.stop` of a lease child SUCCEEDS;
  `run.stop` of a FOREIGN run refuses the byte-identical 403 `forbidden`; `run.stop` of an
  UNKNOWN runId draws the same bytes (unknown ≡ foreign, no existence leak); `run.stop` from a
  non-lease `['observe','control']` principal refuses the same 403 as pre-rung. The seven
  recursive reads succeed.
- **NP-03 (the v1 lanes — one mock-session row per lane family, plus the v1.1 foreign rows).**
  With the minted session bound to a live lease: `run.board.post` + `run.board.read` (binding law
  verbatim), `run.knowledge.seed` (content-addressed receipt; a stale `coordinationSeq` refuses
  `temporal_incoherence`), `run.scratchpad.read` (framed page, ≤256 KiB) + `run.scratchpad.elevate`
  (fence-bound receipt), `run.message.send` + `run.message.receipt` (resolve-then-authorize; an
  unknown messageId refuses `application_unauthorized`), `run.attention.watch` on the parent
  run's scope (lease holder admitted) and on a FOREIGN run's scope (refused/paged per the lane's
  own law). Each row asserts the lane's landed receipt shape (facade contract v2.2 Decisions 3-9),
  never a new one. The v1.1 scope-binding rows, per lane family and identical in shape to the
  attention.watch row: a sibling run INSIDE the child's lease subtree (its first-hop lineage
  carries THIS lease's id) is admitted — board read/post, knowledge seed, scratchpad
  read/elevate, message send; a FOREIGN run — including a sibling coordinator-lead's subtree on
  the same parent run, whose first-hop lineage carries a DIFFERENT lease id — refuses the
  constant `application_unauthorized`; an UNKNOWN runId draws the same bytes (unknown ≡ foreign,
  no existence leak).
- **NP-04 (terminal-path revocation, ordered).** Child stop/kill: durable
  `run.orchestrator_lease_revoked` (reason `parent_terminal`) and `session.revoked` events are
  appended BEFORE the home reap completes; post-stop `isPrincipalActive` is false; an in-flight
  command retried after revocation fails 401; the private home is absent
  (`runtime_cleanup_failed` on any residue); stop evidence carries both revocations. The
  in-flight rows (v1.1): a command dispatched before revocation COMPLETES (liveness is checked at
  dispatch, `web-northbound.mjs:624`); an open `run.follow`/`run.wait` is re-authenticated and
  re-authorized at resolution (`_postWaitAuthorization`, `web-northbound.mjs:633-638`) and dies
  401 — maximum overstay one read-only wait window; a `run.start` racing the parent's terminal
  transition either refuses post-revocation (`run_orchestrator_lease_revoked`
  `coordination-store.mjs:1800` / `run_orchestrator_parent_inactive` `:1807`) or admits — and in
  the admit arm the grandchild is enumerated (inside the stop admission's descendant target set,
  `_runStopTargets` `coordination-store.mjs:4234-4237` consumed at `:12158`, or named by the
  sweep's revocation events for the race that escapes it) and its authority is swept. No silent
  residue.
- **NP-05 (orphan sweep — behavior, cadence, and the TTL bound).** A child authority minted
  whose worker never reaches the terminal path (simulated crash): the sweep revokes the lease
  (closed reason set) and the session; `reconcile` removes the runtime root; zero residue — no
  live session, no active lease, no files. The cadence pins (v1.1): the sweep fires at wave close
  (`coordinator.mjs:11404`), on resident stop, AND on resident START riding the startup recovery
  pass (`_trackStartupCleanup`, `coordinator.mjs:1367-1370`) — a crash-restarted resident
  collects the orphan from the durable lease records, not from the volatile ledger. The bound pin
  (v1.1): in a wave-free deployment with no restart, the orphan session lives at most its TTL
  (≤30 min, `run-lineage.mjs:28`) — advancing the INJECTED clocks past the epoch fails the
  orphan's next call 401. The TTL is pinned as a resource lease (the accepted residue bound,
  Decision 5), never as a control clock.
- **NP-06 (replay/idempotency).** Lease mint replay under the derived key returns the original
  receipt (no second lease); revocation replay returns `replay`; a re-driven spawn mints a FRESH
  session+lease pair (sessions are not replayable) and the sweep collects any orphan from the
  crashed attempt.
- **NP-07 (refusal constancy, byte-identical).** (a) A non-lease worker's discovery fails
  `cli_config_invalid: user connection profile is unavailable` — byte-identical pre/post rung;
  its runtime contains no `baton/connections/` tree. (b) A lease holder issuing an
  out-of-allowlist command (e.g. `runs.list`, `run.workstream.stop`) through the gate fails
  `run_orchestrator_command_forbidden` — byte-identical. (c) An `approve`-class command from the
  child fails 403 at the transport. (d) The gate's allowlist set is unchanged
  (`application.mjs:12225-12227`). (e) v1.1 — each legacy-operator family from a
  `worker:`-prefixed principal refuses `worker_legacy_command_forbidden`: `spawn` +
  `scratch_oracle` (spawn), `send` + `interrupt` (message), `kill` + `drain` (emergency),
  `respond` (respond), `capability_invoke` + `reuse_decide` + `reuse_recheck` (capability) —
  while the OWNER's byte stream for every one of those commands is unchanged. (f) v1.1 — a
  non-lease `['observe','control']` principal's `run.stop` refuses the same 403 `forbidden` as
  pre-rung, and the owner's `run.stop` is unchanged.
- **NP-08 (never copies the owner store).** (a) Child `tokenDigest` ≠ the owner session's
  `tokenDigest` (and ≠ every digest in the owner store). (b) Zero-read proof: with the owner's
  profile+token files made UNREADABLE after resident start, child spawn + discovery still succeed
  (construction rides the in-memory publication outline). (c) Independence: revoking the child
  session leaves the owner session active; revoking/rotating the owner token does not
  authenticate-fail the child session. (d) The child's connections tree contains exactly the two
  projected files — no owner entries. (e) `env.XDG_CONFIG_HOME` is absent from the child env and
  discovery resolves `<home>/.config`.
- **NP-09 (TTL is lease-epoch-bound).** The child session's `expiresAt` equals the lease's
  `expiresAt` under the pinned policy (equality modulo the lease's downward clamp,
  `coordination-store.mjs:1713-1716`); advancing the INJECTED clocks past the epoch fails the
  child's next command 401 and the lease's next authorization
  `run_orchestrator_lease_not_found`/scope refusal — no wall-clock reads anywhere in the
  projection path (static assertion over the diff).
- **NP-10 (the issue's red suite).** Lease bounds, revocation, replay, and zero residue land as
  red-first tests riding the existing run-lineage/session/runtime-isolation harnesses; the full
  gate stays green.

## Open questions

1. **waves.\* under a worker-held lease.** `startWave` delegates member starts through
   `_admitRecursiveRun` (ground truth 18), so the construction exists — but whether a wave's
   member subtree binds cleanly beneath a lease-holding worker (member parentage, roster
   authority, `waves.stop`'s `emergency_stop` class the child lacks) is unverified. #74's rung;
   v1 acceptance deliberately exercises none of it.
2. **Sweep shape.** The orphan sweep may land as a sibling store method or as an options fold of
   `sweepSettlementLeases` (which today filters settlement-relation parents,
   `coordination-store.mjs:12490`). This contract pins the BEHAVIOR (NP-05) and the cadence seams
   (Decision 5); the fold is the implementer's call.
3. **Context-pack reach.** A coordinator-lead's BD3-B pack mints route through the human
   orchestrator in v1 (kernel-only lanes, ground truth 20). Whether #74 projects a facade lane or
   formalizes the escalation-shaped mint is #74's design call, recorded here so the v1 boundary
   is explicit.
4. **Fan-out policy sufficiency.** `maxChildrenPerRun 8` / `maxDescendantsPerRoot 32`
   (`run-lineage.mjs:26-27`) bound a coordinator-lead's executor cells; whether #74's swarms need
   a policy-tuned lineage profile (a deployment knob, never a code change) is left to #74's
   recipe work.
5. **The worker-principal convention.** `userId: 'worker:<workerId>'` follows the deployment's
   stated worker-prefix posture (`application-deployment.mjs:2007`); if a later rung formalizes
   worker principal identity (ids, cards), this binding should migrate to it rather than entrench
   the string. v1.1 makes the prefix LOAD-BEARING: it is the security predicate three seams key
   on — the goal/plan denial (`:2007`), the legacy-command refusal, and the lane scope binding
   (both Decision 6) — so any migration moves all three consumers together.

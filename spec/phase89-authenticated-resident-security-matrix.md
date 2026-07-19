# Phase 89 — Authenticated resident security and adversarial matrix

Status: **acceptance-red specification** (2026-07-19). Every case below is a required test or
live-evidence obligation. Its presence in this document is not a claim that the behavior is
implemented or green.

This matrix is the adversarial companion to
[Phase 89 — Authenticated resident application](./phase89-authenticated-resident-application.md).
That specification defines the product and authority model; this document makes its security,
restart, visibility, and exact-reap gates mechanically explicit.

## 1. Audit basis and design constraints

The current tree already has strong reusable foundations: hashed durable Web sessions, cookie and
Bearer authentication, exact Origin/CSRF checks, bounded CORS and edge quotas, one-time SSE
tickets, durable Web command idempotency, semantic `run.act` authority, server-fenced steering,
restart-safe Run stop, process-group lifecycle evidence, and exact deployment close tests. Phase 89
must preserve those contracts rather than create a second control plane.

The audit also found concrete gaps that make this matrix acceptance-red:

- the browser operator reopens only a manually supplied Run ID; no authenticated bounded Run
  catalog or validated attachment surface exists;
- ordinary `baton serve` still requires caller-authored assembly while the integrated resident
  host is not yet owned by `openBaton()`;
- `run.steer` is explicitly non-reconcilable, and there is no ordinary Run-level interrupt action;
- Web session authority is capability/repository scoped, while explicit Run allowlists and
  run-scoped command-status reads are not complete;
- the current SSE fallback starts from a repository-wide coordination snapshot rather than a
  Run-scoped progressive view;
- progress has logical stages but not durable stage start, elapsed, last meaningful progress, or
  silence/stall visibility;
- the coordination writer lease currently identifies its owner by PID without process-start
  identity, which is insufficient for resident PID-reuse recovery;
- command-cost quota is taken before durable Web admission lookup, so recovery retries are not yet
  distinguished from new effects;
- the low-level Web client does not explicitly reject redirects or bound every individual response
  wait/size; and
- live Phase 88 evidence exposed a final-stop presentation gap in which a progressive response can
  omit stop/ownership even though deployment ownership independently reached zero.

Attachment remains deliberately non-owning. `runs.list()` discovers authorized application state,
and `runs.attach(runId)` returns a bound client over the existing application command bus. It may
not claim a worker, acquire a fleet lease, or become a second ledger. If a materialized attachment
grant is introduced, it is opaque, hashed at rest, short-lived, scoped to session/repository/Run/
resident incarnation, and insufficient by itself to authorize an effect.

## 2. Resident discovery and ownership — RD

- **RD1 — readiness-before-publication:** no discoverable coordinate is published until deployment
  readiness, authentication state, writer authority, startup reconciliation, and the application
  listener are all ready.
- **RD2 — atomic private publication:** the resident coordinate is written through an atomic,
  directory-synced replacement; its directory is owner-only and the file is an owner-owned regular
  file with no group/other access.
- **RD3 — non-secret coordinate:** the published coordinate contains no bearer or CSRF token, TLS
  private key, provider credential, credential path, worktree/runtime/state path, or command-line
  secret.
- **RD4 — separate private credential:** private connection material is bounded, regular-file-only,
  owner-owned, owner-readable only, and is not opened by outline-level doctor or help.
- **RD5 — repository challenge:** copying or tampering with another repository's selector/profile
  fails the authenticated remote repository/deployment challenge before attachment.
- **RD6 — one concurrent owner:** simultaneous resident starts produce one writer/listener owner.
  A loser attaches to the proven winner or returns a typed busy state without removing or cleaning
  the winner's authority.
- **RD7 — live-owner refusal:** a live owner with matching incarnation, PID, and process-start
  identity cannot be stolen or killed by startup recovery.
- **RD8 — PID-reuse resistance:** a PID with mismatched process-start identity is not treated as the
  prior owner; stale replacement still requires the authenticated endpoint/liveness challenge to
  fail.
- **RD9 — uncertain owner fail-closed:** malformed, oversized, unreadable, or partially replaced
  owner state does not authorize deletion, takeover, or signaling of an arbitrary process.
- **RD10 — compare-and-swap unpublication:** delayed close from an old incarnation cannot unlink or
  overwrite the coordinate, socket, profile, token, or lease of its successor.
- **RD11 — ambiguity remains explicit:** several eligible profiles/residents require explicit
  selection; filesystem or lexical ordering never chooses mutation authority.
- **RD12 — secure endpoint:** discovered network URLs require HTTPS or an explicitly trusted TLS
  proxy posture, contain no userinfo/query/fragment, match the expected Origin/authority, and do
  not follow redirects.
- **RD13 — ordinary zero-choreography start:** resident start requires no caller-authored module,
  URL, port, token, Origin, token/provider budget, export bound, capacity arithmetic, or temporary
  root.
- **RD14 — recovery-gated readiness:** health remains non-disclosing and readiness stays false
  until stale owner, orphan process, runtime, worktree, capacity, export, and writer reconciliation
  reaches an authoritative state.

## 3. Authentication and repository/session/Run scope — AA

- **AA1 — authentication before application:** missing, malformed, mixed cookie/Bearer, oversized,
  expired, rotated, or revoked credentials fail before application calls, durable command
  admission, or privileged quota consumption.
- **AA2 — browser request integrity:** wrong/missing Origin, missing or mismatched cookie CSRF,
  invalid `Sec-Fetch-Site`, `Origin: null`, duplicate Origin, and malformed preflight variants
  produce no application effect.
- **AA3 — exact credentialed CORS:** responses name one configured Origin, use `Vary: Origin`, and
  never combine credentials with wildcard origin.
- **AA4 — catalog authorization:** Run discovery requires current `observe`, repository membership,
  live session authority, and applicable Run authorization.
- **AA5 — bounded non-enumerating catalog:** list ordering and continuation are canonical and
  bounded; unauthorized Runs do not affect visible counts, cursors, timing classes, or error text.
- **AA6 — cross-repository collision:** equal Run IDs under different repository authorities cannot
  cross list, attach, follow, status, action-authority, or command-status scope.
- **AA7 — hidden existence:** unauthorized, unknown, and out-of-scope Runs share one bounded
  not-found response and audit classification.
- **AA8 — attach is non-admitting:** attachment to running, stopping, terminal, denied, or failed
  Runs causes no provider call, worker claim, fence issue, worktree/runtime allocation, fleet lease,
  or command-effect charge.
- **AA9 — repeated attach is observational:** repeated or concurrent attachment returns current
  state without duplicating ownership or durable fleet mutation.
- **AA10 — session binding:** a materialized attachment grant from one authenticated session cannot
  be used by another session, even for the same user.
- **AA11 — rotation and reattach:** session rotation immediately invalidates predecessor credentials
  and grants; the successor can reattach and reconcile exact prior idempotency without replaying
  effects.
- **AA12 — live downgrade:** revocation, expiry, or capability/Run-scope downgrade after attachment
  refuses the next control before effect and terminates established observation before its next
  event.
- **AA13 — explicit operator authority:** Run access is based on current authorization, not implicit
  creator-session ownership. Authorized operators may attach to script-created Runs; unauthorized
  sessions may not.
- **AA14 — recursive scope:** a parent/subtree grant includes only its authorized descendant policy;
  it never implies sibling, ancestor, or unrelated Run access.
- **AA15 — command-status reauthorization:** command status rechecks current session liveness,
  `observe`, repository, Run scope, and same authenticated subject before returning a sanitized
  outcome.
- **AA16 — no client authority injection:** request JSON cannot choose actor, principal, session,
  capabilities, expected semantic authority, worker generation, resident incarnation, process
  identity, or internal fence.

## 4. Self-describing controls and semantic authority — CA

- **CA1 — current action descriptions:** attached outlines advertise available send/steer,
  interrupt, and stop operations with closed input schemas, required capabilities, effect class,
  destructive/emergency metadata, defaults, and contextual help.
- **CA2 — semantic recipient binding:** send and interrupt bind a current semantic recipient plus
  worker generation at effect time, not a stale or reusable raw worker/role label.
- **CA3 — complete authority digest:** action authority binds repository, Run, action ID, kind,
  effect, recipient/target generation, required capabilities, and semantic-registry identity.
- **CA4 — adversarial authority matrix:** action swap, Run swap, target swap, effect drift,
  capability drift, registry drift, bad digest, forged token, and cross-transport token all fail
  before effect.
- **CA5 — server-fenced ordinary control:** the server resolves and rechecks the current fence at
  the serialized delivery slot; ordinary callers never resubmit `expectedFence`.
- **CA6 — replacement is not substitution:** disappearance or replacement of a target after action
  discovery cannot redirect the control onto a successor worker or route.
- **CA7 — pre-effect recheck:** an action consumed while authorization yields is resolved and
  authorized again immediately before provider or cleanup effect.
- **CA8 — downgrade before effect:** capability or Run-scope loss between preflight and dispatch
  refuses without provider work or command-effect quota charge.
- **CA9 — exact idempotency:** identical retries execute once; changed message, delivery mode,
  reason, Run, recipient, target, or action under the same key conflicts without mutation.
- **CA10 — persisted completed replay:** a completed mutation can replay after its live action
  disappears only when current authority still includes every persisted required capability and
  scope.
- **CA11 — replay downgrade:** completed replay after capability or Run-scope downgrade is denied
  without recomputing or rerunning the effect.
- **CA12 — transport parity:** direct application, browser, Web client, Web-to-MCP bridge, and MCP
  derive the same semantic mutation scope, registry identity, and authority digest.
- **CA13 — no remote host shutdown:** no browser, Web, attachment, or MCP operation exposes
  `application.shutdown`; whole-resident close remains local owner authority.
- **CA14 — advanced is not a bypass:** raw worker commands retain explicit advanced status and
  cannot bypass Run scope, current fence, semantic effect authority, or durable control admission.

## 5. Crash-safe send/steer and interrupt — CS

- **CS1 — crash before send effect:** restart after durable send/steer admission but before the
  provider boundary resumes exactly one delivery.
- **CS2 — crash after provider acknowledgement:** restart after provider acknowledgement but before
  settlement never blindly repeats the message.
- **CS3 — crash after settlement:** restart after durable send/steer settlement but before HTTP
  response returns the exact persisted outcome.
- **CS4 — honest uncertainty:** when provider acknowledgement cannot be reconciled, Baton settles a
  typed `outcome_unknown` attention; it never fabricates refusal/success or automatically retries.
- **CS5 — interrupt admission:** interrupt intent and semantic recipient are durable before the
  adapter boundary.
- **CS6 — interrupt confirmation replay:** confirmed interrupt is durably settled and replayable
  after response loss without another adapter call.
- **CS7 — interrupt preserves session:** selective interrupt ends the current turn but retains the
  reusable provider session/process and permits a later authorized turn.
- **CS8 — refusal is not confirmation:** stale, unavailable, already-terminal, or unattached
  recipients cannot be reported as newly interrupted.
- **CS9 — concurrent sends serialize:** two concurrent messages to one recipient preserve durable
  application admission order and cannot overtake each other at the adapter.
- **CS10 — send versus interrupt:** the race has an honest single effect-boundary result;
  delivered-despite-stale is explicitly surfaced rather than returned as ordinary success.
- **CS11 — interrupt versus stop:** once Run stop is durably admitted, interrupt cannot produce an
  internally queued follow-up turn or preserve authority that stop must reap.
- **CS12 — no permanent admitted limbo:** after restart an admitted control converges to confirmed,
  refused, or explicit unknown; it never remains permanent `202 admitted`.

## 6. Stop, concurrency, and exact reap — SR

- **SR1 — durable stop before kill:** immutable Run-stop authority commits before the first
  physical kill/cleanup effect.
- **SR2 — partial-reap replay:** restart after each partially reaped target resumes the same target
  snapshot/digest without omitting or adding workers.
- **SR3 — stop fences every later effect:** stop prevents new workers, descendants, recovery,
  review, integration, export, answers, approval, Context effects, and provider controls.
- **SR4 — concurrent reason winner:** concurrent stops with different reasons retain one durable
  winner; a losing request is not echoed as authoritative stop reason.
- **SR5 — stop idempotency:** exact same-key retry returns the original stop authority and receipt
  without issuing another kill.
- **SR6 — effect-boundary race matrix:** stop versus send, interrupt, answer, recover, review,
  integrate, export, recursive spawn, and Context successor dispatch has a deterministic durable
  winner.
- **SR7 — sibling isolation:** stopping one Run leaves unrelated Runs, workers, streams, writer,
  and resident listener operational.
- **SR8 — recursive target closure:** recursive stop includes descendants admitted through its
  durable boundary and excludes unrelated Runs admitted outside it.
- **SR9 — truthful final projection:** the stop return and immediate reattach both contain a
  non-null stop receipt, `remainingCount: 0`, and zero current-incarnation Run ownership.
- **SR10 — every owned surface:** process groups/descendants, worktrees, runtimes, capacity
  reservations, branches, exports, Context owners, recovery leases, and Run-lineage authority all
  settle exactly.
- **SR11 — OS-level proof:** every locally owned PID/process group is absent after reap; ledger or
  in-memory projection alone is not sufficient evidence.
- **SR12 — uncertainty retains authority:** cleanup uncertainty, unconfirmed process death, or
  failed resource removal retains ownership and cannot report `stopped` or zero ownership.
- **SR13 — restart retries uncertain cleanup:** dead-but-unconfirmed and cleanup-failed resources
  remain recoverable ownership rather than being forgotten on replay.
- **SR14 — resident remains owner:** Run stop does not release the resident writer/listener; those
  are released only by authoritative resident shutdown.
- **SR15 — emergency quota lane:** exhaustion of ordinary request/effect quota cannot block an
  authorized Run stop. Repeated stop abuse remains bounded independently and idempotently.

## 7. Run-scoped streaming and visibility — SV

- **SV1 — RunView snapshot boundary:** attachment begins with an atomic RunView plus durable cursor,
  never a repository-wide coordination snapshot.
- **SV2 — event scope filtering:** frames contain only the authorized Run and permitted descendants;
  sibling tasks, Runs, Goals, Plans, commands, and workers never appear.
- **SV3 — ticket coordinates:** stream tickets bind repository, Run, authenticated user/session,
  credential, Origin, applicable capability scope, and resident incarnation.
- **SV4 — ticket secrecy and bounds:** tickets are random, hashed, short-lived, single-use,
  count-bounded, and absent from durable audit, events, referrers, and diagnostics.
- **SV5 — restart resume:** a client obtains a new ticket after resident restart and resumes its
  prior durable semantic cursor with ordered at-least-once delivery.
- **SV6 — incarnation invalidation:** an old-incarnation ticket cannot open a stream on a replacement
  resident.
- **SV7 — live authorization:** expiry, revocation, rotation, capability loss, or Run-scope loss
  terminates an established stream before its next frame.
- **SV8 — observation is effect-free:** browser loss, tab suspension, disconnect, reconnect,
  backpressure, and cursor expiry never interrupt, kill, or otherwise control workers.
- **SV9 — terminal facts survive pressure:** attention, interrupt confirmation, terminal cause,
  stop admission, and final zero-reap facts are delivered or replaced by bounded
  `snapshot_required`; they are never silently dropped.
- **SV10 — complete timing shape:** single-Run, list, group, workflow, attach, status, and follow
  views expose durable `startedAt`, server `observedAt`, non-negative `elapsedMs`, current stage,
  stage start/elapsed, and last meaningful progress time/stage/summary/cursor.
- **SV11 — restart-stable anchors:** stage and last-progress anchors replay identically across
  restart and never reset to resident or provider-process startup.
- **SV12 — meaningful progress only:** thought/token chatter, polls, audit-only events, HTTP traffic,
  session refresh, and clock passage do not advance semantic last-progress.
- **SV13 — visible silence/stall:** an unchanged long-running stage increases elapsed/silence and
  crosses the deployment-authored stalled threshold without fabricating a transition.
- **SV14 — concurrent stop visibility:** while one caller waits for cleanup, another sees stopping
  stage, immutable target count, remaining count, cleanup elapsed, and latest exact progress.
- **SV15 — terminal timing:** terminal `completedAt` and last-progress freeze at the authoritative
  transition while observation time and age remain truthful.
- **SV16 — hostile clocks:** regressing/invalid clocks and integer overflow cannot create negative,
  NaN, unstable, or unbounded timing projections and cannot affect semantic digests/idempotency.
- **SV17 — projection ceilings:** list pages, Run snapshots, progress history, stream frames, replay
  scans, and pending buffers have explicit count/byte ceilings and typed continuation/gap behavior.

## 8. Resident restart and shutdown — RR

- **RR1 — ordered graceful close:** shutdown closes new Web admission, emits reconnect guidance,
  drains bounded in-flight responses, reconciles owned Runs/resources, then releases listener,
  credential, socket, writer, and coordinate authority.
- **RR2 — command versus close:** a command racing shutdown is durably admitted and reconciled or
  refused before effect; no half-authorized provider operation is orphaned.
- **RR3 — joined process signals:** repeated SIGINT/SIGTERM/SIGHUP join one shutdown, keep handlers
  installed until authoritative settlement, and remove them exactly once.
- **RR4 — ungraceful process death:** SIGKILL of the resident followed by supervisor restart
  reconciles orphan workers/resources before readiness and never relies on an in-process `finally`.
- **RR5 — session and ticket restart semantics:** non-expired durable Bearer/session authentication
  survives restart; memory-only connection/stream tickets do not and must be safely reissued.
- **RR6 — durable idempotency across Web replacement:** command admission, outcome, semantic
  authority, and replay survive a new Web/application process without duplicating effects.
- **RR7 — historical/current authority split:** historical profile/route/action evidence remains
  readable while every new effect uses current registry, capability, Run-scope, and deployment
  authority.
- **RR8 — degraded close remains recoverable:** failure to close Web, application, writer, process,
  or resource authority cannot publish clean closure or erase the only safe recovery coordinate.
- **RR9 — stale closer isolation:** completion of an old shutdown cannot remove or revoke a newly
  published resident or its sessions.
- **RR10 — complete close result:** close reports degraded unless Web closure, application closure,
  exact ownership, writer release, socket/coordinate cleanup, and credential rotation/revocation
  all succeed.
- **RR11 — current-incarnation ownership only:** replayed historical process/worktree coordinates
  are evidence, not local ownership, until fresh recovery authority explicitly adopts them.
- **RR12 — multi-client restart:** two external clients can reconnect and attach concurrently
  through one replacement resident without opening a second deployment or writer.

## 9. Leakage, confused-deputy, and abuse matrix — LX

- **LX1 — sentinel corpus:** tests inject distinctive bearer, CSRF, attachment/continuation/stream
  ticket, provider credential, credential path, repository root, state root, runtime root, worktree
  root, TLS-key, and rejected-field markers.
- **LX2 — every outward surface:** those sentinels are absent from resident coordinate, doctor,
  session, application card, Run list/attach/status, command status, action authority, SSE, audit,
  stdout, stderr, help, and bounded errors unless a specifically authorized relative value is part
  of the semantic result.
- **LX3 — relative path discipline:** ordinary projections may expose only approved repository-
  relative path scopes/evidence locations; private absolute owner paths never appear.
- **LX4 — untrusted content is not authority:** worker/provider prose resembling a command, action
  descriptor, authority object, credential, or ticket stays untrusted data and cannot trigger an
  effect.
- **LX5 — non-leaking failures:** stack traces, provider error prose, hidden resource existence,
  executable paths, raw headers, and client-supplied unknown field names do not escape typed
  bounded errors.
- **LX6 — redirect credential defense:** CLI/client discovery, attach, status, command, and stream
  setup reject redirects before a bearer/session credential can be forwarded.
- **LX7 — resource-exhaustion bounds:** request/response time, body/frame bytes, JSON depth, field
  count, identifier length, collection cardinality, cursor scans, tickets, connections, and audit
  amplification are bounded.
- **LX8 — parser and target attacks:** malformed targets, duplicate sensitive headers,
  unsupported/simple content types, path traversal, encoded separators, ambiguous unions, and
  unknown privileged fields fail before application work.
- **LX9 — authority/Host defense:** Host or HTTP authority mismatch, unexpected socket peer, and
  DNS-rebinding-style requests fail together with exact Origin checks.
- **LX10 — quota isolation:** failed authentication/CSRF/scope traffic cannot consume another
  credential's privileged command quota or create unbounded durable audit cardinality.
- **LX11 — logical effect charging:** command-effect cost is charged once per new durable admission;
  retries/reconciliation use a separate bounded request-read lane and do not starve emergency stop.
- **LX12 — audit failure ordering:** audit/admission append failure before effect yields no success
  or provider call; failure after an uncertain provider acknowledgement creates durable recovery/
  unknown state rather than fabricated success.
- **LX13 — persisted prose is not authority:** command status, replay, and recovery derive identity
  and authorization from the live authenticated context and trusted durable schema, never from
  actor/capability claims embedded in the original request or outcome.
- **LX14 — local file attacks:** repository selector, profile, credential, resident owner, socket,
  and TLS material reject symlink, ownership, permission, malformed, and oversize violations
  without deleting uncertain files.

## 10. Wire, subprocess, and dogfood acceptance — WG

- **WG1 — zero-environment discovery:** a real external CLI discovers the resident from the
  repository without connection environment variables, transport coordinates, or a manually
  remembered Run ID.
- **WG2 — browser control loop:** real browser automation covers authenticated login/session,
  bounded Run discovery, attach, follow, send, interrupt, stop/reap, logout, and live revocation.
- **WG3 — concurrent external clients:** two subprocess clients attach through one resident and
  control different Runs concurrently without opening another deployment or crossing scope.
- **WG4 — selective control under overlap:** at least two workers overlap; one is interrupted and
  reused while one is stopped/reaped, and neither operation changes the sibling's authority.
- **WG5 — crash-boundary subprocess proof:** the resident process is terminated at control
  admission/acknowledgement/settlement boundaries; a replacement converges without duplicate
  delivery and with exact cleanup.
- **WG6 — reflexive Baton-on-Baton path:** Baton performs a bounded exact harness/model/effort task
  through the resident connected surface, not through direct kernel assembly.
- **WG7 — final zero-ownership inventory:** live evidence proves zero owned workers, process groups,
  worktrees, runtimes, capacity reservations, exports, Context authority, stale sockets/leases/
  coordinates, and leaked credentials.
- **WG8 — visibility throughout, not terminal-only:** the live packet captures stage, elapsed,
  last-progress, attention, stopping progress, and final receipt/ownership through the whole run.

## 11. Gate interpretation

Phase 89 cannot be declared complete from unit green alone. The minimum closure sequence is:

1. deterministic red/green coverage for every RD–LX case or an explicit, reviewed mapping from a
   case to an existing equivalent test;
2. focused resident/attach/control/restart suites and the full implementation suite;
3. real subprocess crash/restart and OS process-group reap proof;
4. real authenticated CLI and browser control proof; and
5. the WG Baton-on-Baton run with exact route attestation and final zero ownership.

Crash-safe send/interrupt settlement is a hard gate. A resident that can be discovered and
attached but cannot honestly reconcile control effects after response or process loss is not a
completed resident control application.

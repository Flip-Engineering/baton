# MCP + Packaging Contract v0.9 — Authority Red-Team Report

## Scope and method

This is a read-only implementation review of the v0.9 pre-red-team contract. The only
repository mutation made by this review is this report. The contract asks whether an external
stdio-only harness can obtain the embedded surface's authority guarantees
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:31-36`) and makes the
external, descriptor-driven acceptance wave the proof obligation
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:136-146`). I treated
that as a security equivalence claim, not merely a tool-reachability claim.

The implementation is still the pre-contract baseline: the MCP table exposes `waves.attach` but
not start/progress/send/stop (`impl/src/mcp-northbound.mjs:30-44`), the registry has only the
`waves.attach` row (`impl/src/application-semantics.mjs:1525-1546`), the CLI web allowlist likewise
ends at `waves.attach` (`impl/src/application-cli.mjs:15-25`), and the four settlement rows remain
embedded-only (`impl/src/application-semantics.mjs:1445-1463`,
`impl/src/application-semantics.mjs:1489-1506`). Consequently, a verdict of DEFENDED below means
an existing lower-layer invariant can safely be inherited; it does not mean v0.9 is implemented.

Verdict meanings:

- **CONFIRMED-HOLE** — the proposed authority claim admits a concrete bypass or the existing path
  that it intends to expose already lacks the claimed binding.
- **DEFENDED** — the examined attack is rejected by an explicit, correctly placed invariant.
- **NEEDS-AMENDMENT** — the direction can be safe, but v0.9 leaves a security-critical policy or
  replay rule unspecified.

## Executive verdicts

| Attack | Verdict | Bottom line |
|---|---|---|
| `waves.start` admission | **NEEDS-AMENDMENT** | Application start enforces profile routes/scopes (`impl/src/application.mjs:2969-3008`, `impl/src/application.mjs:4300-4314`), but one quota debit (`impl/src/mcp-northbound.mjs:1089-1096`) can fan out to 64 starts (`impl/src/wave.mjs:157-170`). |
| `decision.answer` principal/repository binding | **CONFIRMED-HOLE** | MCP fixes the principal (`impl/src/mcp-northbound.mjs:1310-1320`), but `answer()` checks an interaction with no repository coordinate (`impl/src/application.mjs:11907-11922`, `impl/src/coordinator.mjs:8881-8905`). |
| MCP-W2 S-2 envelope and replay | **CONFIRMED-HOLE** | The proof selects/checks a lease (`impl/src/coordination-store.mjs:13674-13705`) but does not authenticate its presenter, and completed admission replay precedes the session gate (`impl/src/coordination-store.mjs:14677-14708`). |
| MCP `settlement_lease` deployment identity | **CONFIRMED-HOLE** | MCP has one injected principal (`impl/src/mcp-northbound.mjs:845-872`); the draft binds settlement to that host identity (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:74-75`). |
| PKG-1 descriptor and credential refs | **CONFIRMED-HOLE** | The draft only says closed/repo-relative (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:92-105`), while env secrets are injected but excluded from file/tree redactors (`impl/src/runtime-isolation.mjs:104-155`). |
| PKG-2 tarball/native install | **NEEDS-AMENDMENT** | The manifest has no `files`/`exports` (`impl/package.json:1-23`), and MCP's entrypoint eagerly reaches native Atlas imports (`impl/scripts/mcp-stdio.mjs:3-5`, `impl/src/index.mjs:24-27`). |

## 1. `waves.start` MCP admission authority

### Attack

Submit a maximum-size wave repeatedly, with each request selecting arbitrary exact routes. Test
whether MCP admission (not a later provider failure) rejects an off-profile member and atomically
reserves the deployment's active-wave, active-member, seat, and start-rate budgets. A per-tool-call
counter is insufficient when one call fans out into many provider starts.

### Evidence

The draft promises “exact routes restricted to the deployment profile, scopes validated,
objectives bounded” (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:45-48`),
but does not name an admission function or a batch quota rule. The current MCP admission checks a
fixed principal's expiry, capabilities, served-repository intersection, and optional liveness
callback (`impl/src/mcp-northbound.mjs:957-966`). It then debits exactly one generic tool quota
before dispatch (`impl/src/mcp-northbound.mjs:1089-1096`). The documented example explicitly
permits a quota authority that always returns `{ok: true}`
(`impl/MCP.md:57-60`). Thus “has a quota callback” is not a finite deployment bound.

There is a real profile check worth preserving. `BatonApplication._resolveIntent()` resolves the
selected profile and rejects a selector with no matching profile route; for workflow composition it
checks every member route (`impl/src/application.mjs:2969-3008`). `start()` repeats scope and exact
route membership checks immediately before admitting work (`impl/src/application.mjs:4300-4314`).
The embedded wave calls `runs.start` once per member (`impl/src/wave.mjs:191-212`), so routing
through the application path inherits those checks. A direct MCP-to-coordinator wave path would
not.

The embedded wave grammar bounds a single call to 64 members
(`impl/src/wave.mjs:157-170`), but that is a serialization bound, not a deployment concurrency
budget. Since MCP currently charges once before dispatch, wrapping that loop in one new tool would
make a 64-member request and a one-member request consume the same MCP quota debit. Repeated calls
are bounded only by the injected policy, whose semantics v0.9 leaves open. The existing member loop
also records partial start failures instead of making batch capacity admission atomic
(`impl/src/wave.mjs:191-212`).

The proposed row is absent from all three executable inventories: MCP dispatch has only attach
(`impl/src/mcp-northbound.mjs:30-44`), the semantic registry has only attach
(`impl/src/application-semantics.mjs:1525-1546`), and CLI transport has only attach
(`impl/src/application-cli.mjs:15-25`). There is therefore no current MCP admission point at which
the promised profile or wave quota can be inspected.

### Verdict

**NEEDS-AMENDMENT.** Off-profile routing is DEFENDED only if the MCP operation delegates every
member through `BatonApplication.start()`/`_resolveIntent()`. Unbounded wave fan-out is not
defended by the generic one-call quota, and v0.9 does not require a finite deployment quota.

### Amendment

Define `waves.start` as one ordinary registry/application command with a closed schema and these
normative admission rules:

1. The application resolves one named/default profile and revalidates every member route through
   the same profile predicate used at `impl/src/application.mjs:2969-3008`; direct coordinator or
   adapter dispatch is forbidden.
2. The descriptor must supply finite positive ceilings for `maxWaveMembers`, `maxActiveWaves`,
   `maxActiveWaveMembers`, and `maxWaveStartsPerWindow`; omission is a startup error, never
   unlimited.
3. Before the first member starts, atomically reserve one wave plus the full member count against
   the deployment principal/repository. Reject the entire request if it does not fit. Reconcile the
   reservation to the durable member roster on retry/crash.
4. Charge the MCP quota by admitted member count (or debit a separate batch quota), not merely one
   unit for the outer tool call. Keep provider seat/capacity admission authoritative as a second
   layer.
5. Pin acceptance tests for: an off-profile member among otherwise valid members (zero starts), a
   `maxWaveMembers + 1` request, repeated distinct idempotency keys to the active-wave ceiling, same
   key/same body replay, and same key/changed roster conflict.

## 2. `decision.answer` principal and repository binding

### Attack

From MCP deployment A, submit deployment A's allowed `repoId` but a `runId`/`requestId` belonging
to a pending decision in deployment B that shares the same coordinator. Repeat with two harnesses
in one repository. Determine whether authorization proves ownership of the pending record, rather
than authorizing only the supplied strings.

### Evidence

The caller cannot name an MCP actor, user, session, capability set, or repository set in tool
arguments because those keys are forbidden (`impl/src/mcp-northbound.mjs:121-139`). The MCP server
checks the injected principal and repository intersection (`impl/src/mcp-northbound.mjs:957-966`),
and `baton_decision_answer` requires `approve` plus `observe`
(`impl/src/mcp-northbound.mjs:84-93`). Its dispatch passes the injected principal's user/session to
`run.answer`, never caller-supplied identity (`impl/src/mcp-northbound.mjs:1310-1320`). This part is
DEFENDED.

An application-backed MCP server is also constructed for exactly one served repository: the
server rejects a mismatch among its repository set, the application, and the application card
(`impl/src/mcp-northbound.mjs:877-886`). That prevents a caller from changing `repoId` at the MCP
edge.

The lower application gate is incomplete. `_authorize()` sends the application's configured
`repoId`, supplied run ID, and subject to the deployment callback
(`impl/src/application.mjs:3017-3026`), but `answer()` itself only checks syntax, calls that policy,
checks stop state, and asks the coordinator for a globally addressed interaction
(`impl/src/application.mjs:11907-11922`). `_assertRunMutable()` only checks whether that run ID is
stopping/stopped (`impl/src/application.mjs:4025-4032`); it does not establish repository
ownership. `interactionStatus()` returns the task's `runId` but no `repoId`
(`impl/src/coordinator.mjs:8881-8905`). Therefore the final check proves only
`interaction.runId === callerSuppliedRunId`, not that the interaction belongs to the application's
repository. By contrast, `_findRun()` has the needed repository predicate when it scans goals
(`impl/src/application.mjs:3230-3253`), but `answer()` does not call it.

The mismatched assembly is constructible through the current public constructors. `Coordinator`
stores its deployment repository independently as `_repoId`
(`impl/src/coordinator.mjs:891-898`), while `BatonApplication` accepts and stores a separate
`options.repoId` after checking only that it is syntactically valid; it does not compare it with the
driver/coordinator repository (`impl/src/application.mjs:2279-2297`). The MCP constructor then
checks the served repository against the application/card, not against the coordinator's private
repository (`impl/src/mcp-northbound.mjs:877-886`). A descriptor compiler must close this assembly
gap rather than rely on every authorization callback to rediscover it.

This is exploitable whenever two repository applications share a coordinator and the descriptor-
generated authorization policy grants `run.answer` by capability/repository without separately
looking up the interaction. V0.9's descriptor gives the principal `userId` and capabilities but
does not even specify principal `repoIds` or a run-owner policy
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:94-100`). The MCP edge's
correct `repoIds` intersection cannot repair a missing repository coordinate in the target record.

Once the correct record is selected, single consumption is defended: the coordinator reserves the
pending record, waits on an in-flight resolver, and returns `already_resolved` after settlement
(`impl/src/coordinator.mjs:8908-8927`). Answer kind is also checked against the live record before
delivery (`impl/src/application.mjs:732-745`, `impl/src/application.mjs:11917-11922`).

For two harnesses in the same repository, the answerer is the deployment principal, exactly as the
draft states (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:61-64`).
If both harnesses are deliberately assigned that same principal, they are intentionally
indistinguishable and may answer each other's decisions. That is safe only if documented as the
deployment trust boundary; harness isolation requires separate principals/sessions and an explicit
run-owner/answerer policy.

### Verdict

**CONFIRMED-HOLE.** Caller-named principal impersonation is DEFENDED, and once-only resolution is
DEFENDED, but repository ownership of the pending decision is not established at the effect gate.

### Amendment

Make the pending interaction carry or derive an immutable `repoId`. Before `_authorize()` and
before `respond()`, `answer()` must prove all of:

- the application can `_findRun(runId)` in its own repository;
- the interaction resolves to that exact repository and run;
- the authenticated principal's server-owned `repoIds` contains that repository; and
- deployment policy authorizes that principal/session to answer that run (deployment-wide is an
  allowed explicit policy, not an accidental default).

The descriptor loader must derive `repoIds: [resolvedRepoId]`; it must not accept `repoIds` from
JSON or tool arguments. Add two-repository/shared-coordinator tests with deliberately equal run-ID
strings, cross-repository request-ID theft, two principals in one repo, and replay after another
principal wins.

## 3. MCP-W2 and the S-2 envelope after XB #63

### Attack

Capture a valid four-field `sessionAuthority` object, present it from another logical session, and
retry the same settlement mutation after success, after lease expiry, and after lease revocation.
Repeat across stdio process restart with the same and a different deployment session. Distinguish
authorization of a new effect from retrieval of an already completed idempotent outcome.

### Evidence

The draft calls the envelope the “SAME proof-of-principal” as S-2 and says the caller presents it
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:66-75`). The existing
four-field schema contains only version, authority digest, expiry, and lease ID
(`impl/src/application-semantics.mjs:1164-1170`). It contains neither principal ID, session ID,
request digest, operation, nor repository.

The S-2 store path gives the envelope real—but narrower—substance. It validates a closed shape,
looks up an active unexpired lease, compares the presented digest/expiry to the lease, verifies the
parent task, binds the run/board, and applies fence and replay checks
(`impl/src/coordination-store.mjs:13617-13725`). It then derives the event actor solely from the
lease (`impl/src/coordination-store.mjs:13762-13780`). Thus the envelope adds:

- a bounded lease selector (`orchestratorLeaseId`);
- an asserted session-digest/expiry pair checked against that lease;
- a closed place to bind the operation's run and mutation into an idempotency digest; and
- active-parent/run/fence checks at the serialized store boundary.

It does **not** prove who presented the bytes. The board test itself states that the proof is
caller-supplied and identity derives only from the lease
(`impl/test/board-authority-red.test.mjs:135-142`). Existing MCP board tools avoid exposing that
bearer on the wire: registry-derived schemas hide `sessionAuthority`
(`impl/src/mcp-northbound.mjs:540-554`), dispatch injects it from the authenticated principal
(`impl/src/mcp-northbound.mjs:1371-1424`), and the adapter explicitly refuses to reconstruct it from
caller-named identity (`impl/src/mcp-northbound.mjs:1503-1506`). V0.9's “caller presents” wording
would discard that defense.

V0.9 also omits the state transition needed to preserve that defense. The MCP server freezes one
principal at construction (`impl/src/mcp-northbound.mjs:860-871`) and later injects only a
`sessionAuthority` already present on that principal (`impl/src/mcp-northbound.mjs:1475-1485`). The
existing settlement command returns only `{id, digest, issuedEvent}` for its lease, not an S-2
session envelope (`impl/src/coordinator.mjs:10150-10172`). Therefore a lease minted through MCP
cannot become hidden connection authority merely by changing registry surfaces: the design needs a
server-owned per-session lease map. Returning proof bytes for the caller to send back is the easy
implementation, but it turns the proof into the bearer attacked here.

XB is stronger than the four-field envelope at workflow admission. The active-lease gate compares
`principalId`, `sessionId`, and `sessionAuthorityDigest` to the lease and also checks expiry,
parent, and run state (`impl/src/coordination-store.mjs:1682-1697`). `admitWorkflowFinding()` invokes
that full gate when session fields are supplied (`impl/src/coordination-store.mjs:14690-14708`).
The store's own comment characterizes the lease as a consistency/ordering device layered on its
single-writer model, “not an independent authority proof”
(`impl/src/coordination-store.mjs:14667-14672`). The current embedded application already derives
those XB fields from the calling principal (`impl/src/application.mjs:11929-11953`). Therefore an
S-2-shaped object adds a uniform lease-selection envelope, but no additional principal binding,
unless the authenticated transport identity is separately compared.

Replay is presently unsafe for the stronger claim “a forged/stale envelope fails.” A completed
workflow admission checks the idempotency record before the lease gate and returns the prior result
without checking an active lease or session (`impl/src/coordination-store.mjs:14677-14689`). Its
request digest excludes all three session coordinates (`impl/src/coordination-store.mjs:14677-14678`).
At the MCP layer, the durable call scope includes user, tool, repository, and idempotency key but
omits session ID (`impl/src/mcp-northbound.mjs:948-954`). A completed direct/reflex mutation returns
the cached outcome; only `APPLICATION_TOOL` replays call `application.authorizeReplay()`
(`impl/src/mcp-northbound.mjs:1194-1220`). The proposed settlement rows are registry rows, not
current `APPLICATION_COMMAND_DEFINITIONS`, so merely changing their surfaces to `mcp` would put
them on that direct/reflex replay path.

The durable store does not repair the missing session scope: `admitMcpCall()` finds a prior call by
the supplied scope key and replays it when the request digest matches, without comparing the
prior/current `sessionId` fields (`impl/src/coordination-store.mjs:12045-12063`). Since the adapter's
scope key omitted session, session rotation cannot be recovered downstream.

For an incomplete reconcilable call, MCP can also rebuild an admitted principal from the prior
call's user/session (`impl/src/mcp-northbound.mjs:1158-1177`), while the principal's injected
`sessionAuthority` object comes from the current server object. V0.9 does not define which session
must win after a stdio restart.

### Verdict

**CONFIRMED-HOLE.** The envelope is not empty ceremony—it centralizes lease/run/parent/fence
validation—but it is a bearer selector, not proof of its presenter. Existing XB supplies the actual
session binding. Completed replay currently bypasses that binding, so the acceptance statement
that every forged/stale envelope fails
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:141-142`) is false without a
special replay rule.

### Amendment

Keep `sessionAuthority` transport-hidden. The MCP caller supplies only operation data and an
idempotency key; the authenticated MCP connection supplies principal ID, session ID, and session
authority digest. If selection among leases is necessary, expose an opaque lease receipt only to
the same authenticated session and bind it server-side.

At the store boundary:

1. Bind the request digest to repository, operation, all semantic arguments, lease ID, principal
   ID, session ID, and session-authority digest.
2. For a new or incomplete effect, validate the authenticated tuple through
   `_activeRunOrchestratorLease()` before any idempotency short-circuit.
3. For a completed effect whose lease was intentionally revoked, permit cached replay only when
   the authenticated tuple exactly matches the acquiring tuple stored in the original admission.
   A different/expired deployment session must get a typed mismatch, not the cached result.
4. Include session ID (or a digest of the full authenticated session tuple) in MCP `callScope`.
5. Specify restart semantics: same authenticated session + same key/body returns the prior result;
   a newly minted session may not resume the old lease without an explicit owner-only resume proof.

Acceptance must separately test new-effect authorization and completed-result replay after expiry,
revocation, process restart, and session rotation.

## 4. `settlement_lease` and deployment-principal session derivation

### Attack

Let two logical MCP callers reach one deployment endpoint. Caller A obtains a settlement lease;
caller B invokes promotion while both are represented by the host's fixed principal/session. Test
whether XB can distinguish them.

### Evidence

The embedded command derives `principalId`, `sessionId`, and the authority digest from the actual
calling principal (`impl/src/application.mjs:11929-11953`). The lease identity is then derived from
repository, parent, worker, and all three session coordinates
(`impl/src/coordinator.mjs:10129-10155`), and XB compares all three at admission
(`impl/src/coordination-store.mjs:1682-1697`). That is a meaningful session boundary.

MCP instead has one constructor-injected principal (`impl/src/mcp-northbound.mjs:845-872`). The
documented stdio factory hard-codes `userId: operator` and `sessionId: local-mcp-host`
(`impl/MCP.md:35-60`) and says the host owns fixed principal identity
(`impl/MCP.md:65-69`). The new contract explicitly says `knowledge.settlement_lease` derives from
that deployment principal
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:74-75`). Consequently, two logical callers
behind the same MCP endpoint present the identical tuple to XB. XB works correctly but cannot
distinguish identities that the transport has collapsed.

The current stdio executable is a single stdin/stdout child and loads one factory
(`impl/scripts/mcp-stdio.mjs:7-22`), so a strict one-parent/one-child threat model can treat pipe
ownership as authentication. The web bridge separately attests one remote authenticated session
and rejects principal changes (`impl/src/mcp-web-bridge.mjs:94-106`). Neither fact is stated as a
mandatory no-multiplexing rule in v0.9, while the stated goal is parity with an embedded calling
principal. “Local posture only”
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:128-134`) does not make multiple
same-UID harnesses distinct principals.

### Verdict

**CONFIRMED-HOLE** against the contract's “every authority guarantee the embedded path has” bar.
It is conditionally DEFENDED only if one MCP process is normatively owned by exactly one trusted
caller and never multiplexed, proxied, or shared. Without that constraint, any caller rides the
host identity and XB's session binding becomes tautological.

### Amendment

Choose and state one security model:

- **Recommended single-caller stdio model:** each MCP child belongs to one parent harness; no
  multiplexing or shared proxy is supported. The host generates a fresh random session ID at
  startup (not from the descriptor), binds every lease/effect/idempotency record to it, and on EOF
  revokes or strands its live leases. Cross-process retry requires an explicit owner-only resume
  artifact stored outside the descriptor and never sent as a tool argument.
- **Multi-client model:** authenticate each client/session separately and pass that authenticated
  tuple—not a shared deployment identity—through MCP admission and XB. The deployment account may
  remain a policy/quota owner, but it is not the acting session.

In both models, JSON may name `principal.userId` and capabilities as policy requests, but may not
name `sessionId`, session authority, `repoIds`, expiry, or revocation state. Add a two-caller test in
which A's lease is rejected for B, including after restart.

## 5. PKG-1 descriptor and credential-reference authority

### Attack

Use absolute paths, `..`, mixed separators, symlink swaps, and a deployment root outside the
repository. Add unknown nested keys and oversized arrays/strings. Point a file credential at an
external file. Name a dangerous environment variable (for example an injection variable), then
make the provider echo the resolved secret and inspect tool arguments, errors, MCP responses, and
operational logs.

### Evidence

The baseline accepts an arbitrary path, resolves it against the process CWD, dynamically imports
it, and executes its factory (`impl/scripts/mcp-stdio.mjs:7-17`). That is intentional code-factory
authority today, but it demonstrates why choosing JSON by extension or “try JSON, else import” is
not a security boundary. The web executable currently accepts no descriptor at all
(`impl/scripts/mcp-web.mjs:7-20`), and the CLI command set has no descriptor-hosting path
(`impl/src/application-cli.mjs:15-25`). V0.9 must define one shared loader rather than three
divergent parsers.

The draft's entire path rule is “repo-relative file paths”; its entire schema rule is “closed,
validated” (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:92-105`). It does not define whether `deploymentRoot` must
be inside the repository, how symlinks are treated, whether nested objects are closed, or any
descriptor byte/depth/count ceilings. That is insufficient to decide the attacks above.

There is an existing safe-file pattern to reuse. Credential projection rejects absolute/NUL/dot
segments (`impl/src/credential-projection.mjs:29-38`), checks containment
(`impl/src/credential-projection.mjs:106-115`), rejects symlink/non-regular/unowned/writable files,
opens with `O_NOFOLLOW`, and verifies identity before/after bounded reading
(`impl/src/credential-projection.mjs:118-140`). A descriptor file-credential resolver that merely
uses `resolve(repo, ref)` does not inherit any of those defenses.

The environment leak is concrete. Runtime isolation filters inherited secret/injection-shaped
environment names (`impl/src/runtime-isolation.mjs:8-10`,
`impl/src/runtime-isolation.mjs:68-83`), but then inserts deployment-projected credential env values
without validating their names or registering their values for redaction
(`impl/src/runtime-isolation.mjs:104-111`). Frame redactors are built only from projected files and
trees (`impl/src/runtime-isolation.mjs:113-155`). File credential values are collected and replaced
with `[REDACTED]` (`impl/src/credential-projection.mjs:45-80`); env-ref values have no equivalent
path. A provider that echoes an env secret can therefore place it in a provider frame and the
operational event stream. MCP's forbidden-key scan only inspects argument **key names**
(`impl/src/mcp-northbound.mjs:121-139`, `impl/src/mcp-northbound.mjs:673-686`); it cannot detect a
secret value smuggled under an innocuous field.

There is a provider-specific precedent for the missing generic rule: the Claude session probes
configured secret values on egress and kills the provider when stdout/stderr contains one
(`impl/src/claude-session.mjs:881-920`). The descriptor contract must require equivalent coverage
for every route/source kind; it cannot assume every adapter happens to implement that optional
probe.

### Verdict

**CONFIRMED-HOLE.** The current module path is arbitrary code authority, and the proposed JSON
replacement lacks the canonical path and closed/bounded schema rules needed to remove it. More
importantly, env-ref secret material currently bypasses the redaction mechanism, so “material is
never in the descriptor” does not imply “material never exits through tools/logs.”

### Amendment

Define one shared descriptor loader for `baton-mcp`, `baton-mcp-web`, and any CLI hosting path:

1. Read JSON only, with a descriptor byte ceiling and JSON nesting ceiling. Reject duplicate keys
   if the parser cannot prove unique object members. Validate exact keys recursively, finite numeric
   quota ranges, bounded/unique route arrays, bounded strings, and exact enums. Unknown fields at
   any depth are a typed startup refusal.
2. Canonicalize `repo` once to an owned, non-symlink directory and pin its device/inode. State
   explicitly whether `deploymentRoot` must be a descendant. If outside roots are required, give
   each field its own deployment allowlist; never infer authority from a relative spelling.
3. For file refs, permit only normalized repository-relative paths; reject absolute paths, NUL,
   `.`/`..`, empty segments, mixed separator tricks, symlink ancestors, symlink files,
   non-regular files, foreign ownership, group/world-writable modes, oversize content, and
   before/open/after identity changes. Reuse the pattern at
   `impl/src/credential-projection.mjs:29-38` and
   `impl/src/credential-projection.mjs:106-140`.
4. For env refs, require a conservative name grammar plus a deployment allowlist and reject all
   injection/control names covered by `impl/src/runtime-isolation.mjs:8-10`. Bound the resolved
   value and reject NUL. The value may flow only into the selected adapter's environment—never
   argv, objective/prose, registry/card/readiness, errors, audit detail, or MCP results.
5. Register every resolved env/keychain/file secret value with a uniform redact-before-truncate
   filter, regardless of source kind or value length. Scan adversarial fixture outputs and all
   persisted/public projections for canary values. Key-name filters remain defense in depth, not
   the secret noninterference proof.
6. Keep the legacy code factory behind an explicit different flag/subcommand and advanced-only
   documentation; never auto-detect executable modules after JSON validation fails.

## 6. PKG-2 package leak and clean-host dependency surface

### Attack

Inspect the packed tar member list and bytes for repository-root credentials, `.baton`, evidence,
tests, logs, fixtures, and symlinks. Install the exact tarball on every declared Node/OS/CPU/libc
combination with an empty cache and run each bin, especially `baton-mcp`, before any Atlas feature
is used.

### Evidence

The present package root is `impl`: its manifest is private, has bins, but has no `files` or
`exports` field (`impl/package.json:1-23`). The stdio bin imports the broad public index
(`impl/scripts/mcp-stdio.mjs:3-5`). That index eagerly imports Atlas modules
(`impl/src/index.mjs:24-27`), and those modules statically import `@ast-grep/napi`
(`impl/src/atlas-index.mjs:1-10`). Therefore even an MCP-only startup loads the native dependency
before it can decide that Atlas is unused.

`@ast-grep/napi` is a required dependency (`impl/package.json:20-22`). Its lockfile fans out to
optional native packages for a finite platform matrix
(`impl/package-lock.json:22-40`); for example, the Darwin arm64 artifact is OS/CPU constrained
(`impl/package-lock.json:42-56`) and Linux arm64 is split by glibc/musl
(`impl/package-lock.json:74-110`). V0.9 explicitly leaves “optionalDependencies vs required”
undecided (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:116-119`), so a clean-host smoke on only the developer's
machine cannot establish external install truth.

The proposed `files` allowlist and tarball-install smoke are substantively good
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:107-114`). Repository-root credential files are outside the current
`impl` package root, so they are not reachable **if and only if** packing is pinned to `impl`.
V0.9 never makes that package root an invariant, yet asks the gate to assert those parent files are
absent (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:116-117`). The gate must inspect the produced tar, not merely
trust the allowlist, and must fail if package-root movement changes that containment fact.

This review did not run `npm pack`: the brief grants one report write target only, while packing/
installing creates tarballs, caches, and temporary installation trees. The verdict is based on the
executable manifest/import graph above; the amended gate is the required mutating proof during
implementation.

### Verdict

**NEEDS-AMENDMENT.** PKG-2's allowlist plus pack/install smoke can defend the leak surface, but the
contract has not pinned the package root, negative tar assertions, or native-host policy. Today the
base MCP entry eagerly requires the native package, so “optional Atlas” cannot be claimed.

### Amendment

1. Declare `impl/` as the package root and make `files` an exact positive allowlist containing only
   runtime `src/`, required `scripts/`, and named documentation/license assets. Explicitly exclude
   tests, fixtures, demos, logs, every `**/evidence/**`, every `.baton` component, and credential-
   shaped names.
2. In the gate, run pack from that pinned root, parse the actual tar member list, reject absolute or
   `..` members and symlinks, and scan member bytes for canary secrets. Seed canary credential,
   `.baton`, and evidence files both at the package root and repository parent so a future package-
   root move cannot make the test vacuous.
3. Install the exact produced tarball into a clean directory with an isolated empty cache. Run all
   three bins and the descriptor stdio acceptance transcript. Assert that the installed package has
   no dependency on repository-relative imports.
4. Decide native support explicitly. Recommended: make the MCP/application entrypoint independent
   of Atlas, lazy-load Atlas only when configured, move the native package to an optional feature,
   and report a typed unavailable capability when no matching binary exists. If Atlas is instead a
   required base feature, keep the dependency required, publish the exact supported OS/CPU/libc
   matrix, and gate every supported class; unsupported hosts must fail preflight with a useful
   error.
5. Test the declared Node floor (`impl/package.json:7-9`) and add an `exports` map whose MCP-facing
   entry does not eagerly import native-only features. Keep `private: true` and document precisely
   how npx-from-git resolves the `impl` package root.

## Cross-cutting exploit chains

### Shared-host settlement theft

Two logical callers share the deployment principal (`impl/MCP.md:42-60`). Caller A obtains a lease;
caller B presents the same host session, so XB sees the acquiring tuple
(`impl/src/coordination-store.mjs:1682-1697`). If the S-2 object is also caller-presented as v0.9
says (`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:66-75`), captured bytes are sufficient to select the lease. The
result is indistinguishable from A at every described gate.

### Cross-repository decision settlement

Deployment A passes MCP's correct repository intersection
(`impl/src/mcp-northbound.mjs:957-966`) but supplies B's run/request strings. The application policy
receives A's repo ID (`impl/src/application.mjs:3017-3026`), while the effect gate verifies only the
interaction's run string (`impl/src/application.mjs:11907-11922`). Without a repository coordinate
on the interaction, a capability-only authorization callback can authorize the foreign record.

### Descriptor secret to durable output

An env ref resolves server-side as required by v0.9
(`docs/reference/evidence/mcp-packaging-2026-08-02/mcp-packaging-decisions.md:94-100`). Runtime
isolation inserts the value (`impl/src/runtime-isolation.mjs:104-111`) but does not add it to the
file/tree redactors (`impl/src/runtime-isolation.mjs:113-155`). Provider echo therefore reaches
frames/logs under an innocent key, bypassing MCP's key-name-only filter
(`impl/src/mcp-northbound.mjs:121-139`).

### Wave quota amplification

One admitted MCP call consumes one tool-quota unit
(`impl/src/mcp-northbound.mjs:1089-1096`) and then a wave loop can make up to 64 member starts
(`impl/src/wave.mjs:157-170`, `impl/src/wave.mjs:191-212`). Repeating distinct keys turns a request
quota into a weak proxy for provider/seat capacity unless batch-weighted reservations are added.

## Required contract amendments

V0.9 should not advance unchanged. The minimum normative delta is:

1. **MCP-W1:** require application-path per-member profile/scope enforcement plus atomic finite
   wave/member/start-rate reservations and batch-weighted quota.
2. **Decision lane:** bind every pending interaction to repository + run and authorize that exact
   tuple for the authenticated deployment principal/session before response.
3. **MCP-W2:** keep session authority off the wire; compare the authenticated full session tuple at
   the store; bind session into request/idempotency scope; distinguish active-effect retry from
   same-session completed-outcome replay.
4. **Settlement identity:** either make stdio normatively single-caller with a fresh per-process
   session or authenticate each multiplexed client separately. A static descriptor/host session is
   not XB-equivalent.
5. **PKG-1:** specify recursive closed/bounded JSON, canonical owned path containment, no-follow
   credential reads, env/keychain allowlists, and source-independent secret-value noninterference.
6. **PKG-2:** pin `impl` as package root, inspect actual tar members/bytes with canaries, install the
   exact tar in clean isolated environments, and decide whether native Atlas is a required base
   platform constraint or a lazy optional feature.

Required red tests should fail before implementation for every attack above. In particular, the
acceptance phrase “forged/stale envelope fails” must be refined: a forged/different-session request
always fails; an exact completed retry may return cached success only to the original authenticated
session, even after the effect's lease was intentionally revoked.

## Verification

The brief's sole definition-of-done command was executed exactly as a direct executable/argv call:

```text
executable: "true"
arguments: []
working directory: "."
expected exit code: 0
actual exit code: 0
```

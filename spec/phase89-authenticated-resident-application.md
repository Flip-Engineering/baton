# Phase 89 — Authenticated resident application

Status: active specification and implementation contract (2026-07-18)

## 1. Outcome

Baton becomes one coherent resident application rather than a local factory, a Web host assembly
kit, a connection-file convention, and several transport clients that an orchestrator must compose
itself. The ordinary surface is the same whether the caller owns the deployment or discovers an
already-running deployment:

```js
const owner = await openBaton({ repo: '.' });
await owner.host();
const run = await owner.runs.start('Fix replay ordering', {
  exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
});

const baton = await connectBaton({ repo: '.' });
const active = await baton.runs.list();
const attached = await baton.runs.attach(active.items[0].id);
await attached.send('Concentrate on replay ordering and preserve compatibility.');
await attached.interrupt({ reason: 'Operator input is required.' });
await attached.stop('Cancel and reap this Run.');
```

The default call path does not require a URL, token, origin, timeout, provider-turn budget,
worktree capacity, export ceiling, temporary root, worker ID, receipt, or transport cursor.
Deployment policy owns those details. Explicit advanced configuration remains available without
becoming the routine agent experience.

This phase integrates the Phase 64 authenticated Web application, Phase 67 progressive semantic
operations, Phase 68 connection discovery, Phase 74 full-access worker policy, Phase 86 semantic
action registry, and Phase 88 exact route tuples. It does not add homelab integration, federation,
or an insecure general-purpose remote shell.

## 2. One Pythonic application surface

### 2.1 Owner and connected clients

`openBaton({ repo })` is the repository deployment owner. It exposes:

- `baton.runs.list()`, `.start()`, `.startMany()`, and `.attach()`;
- `baton.workflow()` for the higher-level composition shorthand;
- `baton.help()` and `baton.runs.help()`;
- `baton.host()` for idempotent resident hosting; and
- `baton.close()` for exact owner shutdown and resource reconciliation.

`connectBaton({ repo })` discovers an authenticated resident deployment and returns the same
ordinary Runs and Run-handle interface. It cannot close the deployment. Existing
`run/startMany/open` owner methods remain compatibility aliases; low-level `BatonWebClient`,
transport reconciliation, worker coordinates, and raw control verbs are advanced interfaces.

Both paths use one `ApplicationCommandPort` contract. The direct port binds the deployment
principal internally. The Web port binds the discovered session and idempotency authority
internally. No public method overloads a principal argument with a transport key.

Attach is deliberately non-owning and does not create a second Run attachment ledger. It is an
authenticated, repository/run-scoped client binding over the existing application authority. Any
future materialized handle token must be opaque, stored hashed, short-lived, and bound to the
session, repository, Run, and resident incarnation; possession of a handle never authorizes an
effect by itself.

### 2.2 Run collection and attachment

`baton.runs.list(options?)` is a bounded semantic operation, not a ledger scan. Its ordinary shape
is:

```js
{
  items: [{
    id, objective, phase, stage, elapsedMs, lastProgress,
    attention, route, resources, actions,
  }],
  continuation,
}
```

The default view prefers active and attention-requiring Runs. Filters and continuation are closed,
bounded, and server-owned; any continuation token is opaque. Receipts, event sequence numbers,
PIDs, worker IDs, budgets, filesystem paths, session IDs, internal refs, and byte/file ceilings are
absent.

`baton.runs.attach(runId)` validates existence and observation authority with one outline read
before returning a Run handle. `open(runId)` remains the non-validating compatibility alias until
migration is complete.

### 2.3 Progressive Run actions

The ordinary Run handle is:

- `inspect(depth?)`: current outline by default, then index, section, and item detail;
- `send(message, options?)`: semantic guidance to `work` by default, with closed delivery choices;
- `interrupt(options?)`: selective interruption of the current semantic work recipient;
- `stop(reason)`: durable whole-Run stop, cleanup, and reap;
- `result()`, `complete()`, and `follow()` for normal completion; and
- `help(topic?)` for context-sensitive guidance.

`send()` resolves a semantic recipient such as `work`, a workflow role, or `review` on the server.
The ordinary caller never discovers and resubmits a worker ID. Route changes and recovery therefore
cannot silently redirect a stale coordinate. Delivery is a closed semantic value (`turn`, `now`, or
`nudge`) whose default and consequence appear in help.

`interrupt()` is selective and preserves unrelated workflow members. Its result says whether the
interrupted member was the only active member and whether the Run now needs attention. `stop()` is
the distinct whole-Run authority and does not return until terminal ownership truth is available or
the bounded result explicitly says reconciliation is still required. Raw `steer(target, ...)`,
member identities, signals, and process controls remain advanced compatibility operations.

`send()`/steer and `interrupt()` require durable application-level control admission and
settlement, not merely a durable Web command. The record binds the semantic recipient, resolved
worker/fence at effect time, provider-control request identity, and outcome. Restart reconciliation
may conclude `confirmed`, `refused`, or `outcome_unknown`; Baton never blindly repeats an uncertain
provider effect. Historical non-reconcilable steer remains honestly non-reconcilable until migrated.

## 3. Resident hosting and connection authority

### 3.1 Local default

The default `baton.host()` is owner-local and non-network-accessible. The preferred transport is an
owner-only Unix-domain socket with a private bearer/session authority, published through the
existing Git-common selector and XDG profile/token convention. If the platform cannot provide the
required socket ownership and permissions, hosting refuses; it does not fall back to a TCP wildcard
listener or cleartext network service.

The host:

1. persists a stable deployment identity and acquires a fenced one-writer resident lease with a
   fresh instance epoch plus PID-start/incarnation evidence for the repository deployment;
2. creates or rotates scoped private connection authority without putting it in argv, stdout,
   stderr, repository content, or environment diagnostics;
3. starts the authenticated application listener;
4. verifies card, readiness, repository binding, command capabilities, and an authenticated session;
5. atomically publishes a non-secret Git selector and owner-only XDG connection material; and
6. returns a non-secret host outline.

Host start is idempotent for the same live owner. Stale sockets, leases, selectors, profiles, and
tokens are never trusted solely because files exist. Startup proves ownership/liveness before safe
replacement. Close stops new Web admission, drains bounded in-flight requests, revokes or rotates
resident authority, reconciles owned work, removes only its own socket/lease coordinates, and
records terminal truth.

The published non-secret coordinate binds repository ID, deployment ID, fresh instance epoch,
endpoint kind/address, semantic-registry digest, and start time. Publication is atomic and
directory-synced after the listener and authenticated readiness check succeed. Unpublication is a
compare-and-swap: a process may remove only the coordinate whose instance epoch it owns. PID
liveness alone is not sufficient because PID reuse must not strand or steal resident ownership.

### 3.2 Explicit network mode

Network reach is opt-in: `host({ mode: 'network', ... })`. It requires explicit non-wildcard intent,
HTTPS or a configured trusted TLS-terminating proxy, allowed origin authority, repository binding,
durable session storage, readiness authority, and a token/OIDC issuer policy. Existing Web edge,
CORS, CSRF, capability, replay, and idempotency rules remain mandatory. No ordinary option weakens
them, and Baton never implicitly binds `0.0.0.0`.

### 3.3 Discovery and connection

`connectBaton({ repo })` follows the existing repository selector to an owner-private connection
profile, authenticates, proves the exact repository ID and required semantic capabilities, and then
returns the high-level application client. Stale selector, wrong repository, missing capability,
revoked token, not-ready host, and incompatible schema failures are typed and include a safe
`helpTopic`. Secrets and policy internals are not embedded in errors.

Connection is retryable across a resident restart, but a client never silently transfers mutation
authority between repository IDs or deployment generations. In-flight idempotency keys and
reconciliation remain transport-owned.

The attach handshake is authenticated but non-admitting. It proves repository, deployment and
instance identity, semantic registry compatibility, readiness, session subject/capabilities, and
expiry. A production network session may be further narrowed to explicit Run scopes; repository
membership never silently widens a run-scoped credential. Existing v1 fixed connection profiles
remain readable. Newly published profiles bind an expected deployment ID and either a fixed remote
endpoint or a repository-resident endpoint; old profiles are not silently rewritten.

After transport loss the client retains the exact original envelope for a reconcilable command,
reconnects and reauthenticates, reads durable status, and if still merely admitted re-drives the
same POST with the same idempotency key. It does not poll an admitted command forever. A historical
non-reconcilable command returns typed `outcome_unknown` after its bounded recovery path.

## 4. Progress and operator visibility

Every single-Run, workflow, group, and list projection uses one progress model:

```js
{
  stage: 'provider',
  progress: { current: 'provider', summary, stages },
  startedAt,
  observedAt,
  elapsedMs,
  lastProgress: { at, stage, summary },
  completedAt,
}
```

`startedAt` is Goal admission time, not provider-process start. `lastProgress` advances only for a
meaningful semantic transition: stage/state change, new attention, admitted semantic action,
accepted/rejected evidence, resource-ownership change, or terminal transition. Audit-only events,
HTTP traffic, polling, session refresh, and clock passage do not advance it. `completedAt` is the
authoritative terminal transition when one exists.

`observedAt` and `elapsedMs` are server-derived conveniences. Volatile clock values are excluded
from semantic view/change digests, idempotency identity, and follow cursors, so polling cannot
manufacture progress. Replay and restart reproduce stable time anchors and the same last semantic
progress.

Attached streams are Run-scoped progressive RunView/follow streams, not repository-wide
coordination snapshots. A client retains the last processed durable semantic cursor, obtains a new
single-use ticket after disconnect or resident restart, resumes that cursor, and explicitly
refreshes the bounded Run snapshot when the server reports `snapshot_required`. Disconnect is never
interpreted as Run termination.

## 5. Cascading help and errors

Help follows the application structure and live authority:

```text
baton.help()
  baton.runs.help()
    run.help()
      run.help('send' | 'interrupt' | 'stop')
```

Each level begins with a compact outline, offers an index of logical branches, then permits section
and item detail. It explains defaults, required parameters, current availability, expected effect,
typed failure modes, and the difference between selective interrupt and whole-Run stop/reap.
`run.help()` describes the attached Run by default; it does not default to workflow help.

The semantic operation/action registry is the authority for local, Web, MCP, bridge, CLI, and help
projections. Every ordinary error has a stable code, concise remediation, and safe `helpTopic`.
Transport and policy internals stay behind explicit advanced detail.

## 6. CLI migration

The CLI consumes `connectBaton()` and the same application client. Its primary vocabulary becomes:

```text
baton run "OBJECTIVE"
baton runs
baton run RUN_ID
baton run RUN_ID send "MESSAGE"
baton run RUN_ID interrupt --reason "REASON"
baton run RUN_ID stop "REASON"
baton help
```

Default output is a compact human/agent-readable outline with current stage, useful attention, and
next actions. `--json` exposes the bounded semantic projection, not internal receipts. Coordinate-
heavy verbs and raw transport operations move under an explicit advanced namespace while their
compatibility contract remains intact.

`baton serve ./deployment.mjs` is retained only as an advanced migration route. Ordinary
`baton serve` opens the repository deployment and invokes its integrated host; no user-authored JS
assembly module is required.

## 7. Acceptance gates

Phase 89 is complete only when all of the following are green:

1. The owner and connected examples in section 1 work without caller-supplied transport, security,
   capacity, budget, temporary-root, or export-limit plumbing.
2. A resident restart preserves Run truth; discovery, bounded list, and validated attach recover an
   active Run and expose coherent stage, elapsed, and last-progress anchors.
3. Wrong-repository, stale-selector, stale-socket, duplicate-owner, revoked-token, missing-
   capability, unauthorized Run scope, incompatible-version, CORS/CSRF, replay, and readiness tests
   fail closed with safe remediation.
4. Ordinary projections and failures leak no token, receipt, budget, byte/file ceiling, PID, worker
   ID, private path, session ID, or event cursor.
5. `send()` resolves current semantic recipients across route/recovery changes without raw worker
   identity. Ambiguous or absent recipients return attention rather than guessing.
6. `interrupt()` selectively settles the resolved member while preserving unrelated members.
   `stop()` remains Run-wide, restart-safe, and proves zero owned processes/worktrees or returns an
   explicit reconciliation state.
7. Stable progress anchors survive replay/restart. Elapsed clock changes do not change semantic
   digests, follow cursors, or idempotent results.
8. Help outline/index/section/item content and semantic action authority agree across direct, Web,
   MCP, bridge, and CLI paths.
9. Host close drains Web without accidentally closing an application it does not own; owner close
   shuts down the owned application exactly once. Signal and crash recovery reap only fenced owned
   resources.
10. Baton dogfoods the resident path: multiple exact-route workers are dispatched concurrently,
    discovered from a fresh connected client, attached, guided, selectively interrupted or stopped,
    completed/reviewed, and closed with zero Baton ownership.
11. Restart recovery re-drives only reconcilable command envelopes with the same idempotency key;
    uncertain steer/interrupt effects settle as `outcome_unknown` instead of duplicating delivery.
12. Run streams re-ticket and resume from their durable cursor without exposing a repository-wide
    coordination snapshot.
13. Resident start, worker launch, stop, restart, and shutdown do not install, upgrade, log in to,
    or rewrite the user's Claude, Codex, Kimi, Grok, shell, or MCP configuration. Baton reads/probes
    installations and projects credentials only into Baton-owned private runtime roots.

## 8. Ordered implementation slices

1. Define the common command-port contract; expose `BatonDeployment.runs`; implement bounded
   `runs.list` and validating `runs.attach` locally and over authenticated Web.
2. Centralize stable progress anchors and compact list projection; add replay and no-digest-churn
   tests.
3. Add semantic `run.send` and `run.interrupt` with server-side recipient resolution and exact
   selective-resource semantics plus durable control admission/settlement.
4. Compose private auth/session issuance, server construction, lease, publication, and lifecycle
   under `BatonDeployment.host()`; implement `connectBaton()` over the Web command port.
5. Add owner-local socket transport, then explicit network mode without weakening existing edge
   authority.
6. Migrate CLI and MCP presentation to the same semantic application client and cascade help.
7. Add command POST re-drive, stream re-ticket/cursor resume, token-file compare-and-swap rotation,
   and browser attach migration.
8. Exercise the complete loop through Baton itself, including parallel work, reconnect, guidance,
   selective interrupt, whole-Run stop, host restart, and exact reap evidence.

Later recursive feedback, shared task sets, RLM/Context REPL loops, Slate-style environment
composition, Atlas AST/CST/SCIP/CPG precision, and Cairn shared knowledge-graph work consume this
resident surface; they do not introduce another operator control plane.

## 9. Implementation checkpoint — 2026-07-18

Ordered slices 1 and 2 have a green first vertical. `runs.list` is one authenticated, closed,
server-bounded command that filters unauthorized Runs before the visible ceiling and exposes only
compact semantic fields. Owner and connected clients share `BatonDeployment.runs`; `attach()`
performs and validates one outline read. Progress timing is centralized and replay-stable, while
volatile elapsed time remains outside the semantic digest. Repository discovery now challenges the
local Git-common-directory identity against the selector, card, and authenticated session. Web JSON
reads refuse redirects and bound both wait and body size. The complete implementation suite passes
2,183/2,183.

The next resident closure vertical is now green. Ordinary `await openBaton({repo}).host()` starts
authenticated HTTP over an owner-only Unix socket, issues a private bearer session, persists a
stable deployment ID, creates a fresh incarnation, binds both resident and coordination leases to
OS process-start identity, challenges card/readiness/repository/session/incarnation over the actual
socket, and only then publishes schema-v2 private connection material. Restart preserves deployment
identity, rotates incarnation, and `connectBaton()` challenges the entire selector/profile/card/
session chain. Close revokes the session and compare-and-swap removes only the current
incarnation. `baton serve` exercises that same path and signal-close lifecycle without a user
assembly module. The advanced injected HTTPS/loopback host remains a separate integration seam.

The live Baton-on-Baton review used exact parallel GLM `glm-5.2`/`xhigh` and Codex
`gpt-5.6-sol`/`medium` routes and closed with zero workers. It exposed catalog authorization
ordering, readiness parity, repository confusion, redirect/body hardening, and attach-validation
gaps; those concrete defects were repaired and regression-tested. The reports also retain the
following acceptance-red work rather than collapsing it into a completion claim:

- persist/index semantic progress anchors instead of rescanning repository events;
- add opaque catalog continuation without exposing caller-managed limits or hidden cardinality;
- add semantic `send`/`interrupt` with durable admission, provider-boundary settlement, recovery,
  and selective ownership proofs;
- build Run-scoped streams, browser convergence, crash takeover, and restart dogfood required by
  gates 3–13.

A second exact parallel GLM `glm-5.2`/`xhigh` and Codex `gpt-5.6-sol`/`high` closure review then
drove the ordinary host implementation. Its process-start, command-port, startup rollback,
publication ordering, and CAS-cleanup concerns now have focused regressions. An actual `baton
serve` subprocess is discoverable through `connectBaton()`, answers `runs.list`, accepts SIGTERM,
exits zero, removes its selector/token, and emits no bearer or socket path. This still does not
claim explicit network mode, semantic send/interrupt settlement, Run-scoped streams, opaque
pagination, persisted progress indexes, crash-supervisor takeover, or the entire security matrix.
The final canonical implementation suite passes 2,192/2,192 after this closure.

Evidence:

- `docs/reference/evidence/phase89-resident-application-dogfood-live-2026-07-18/`
- `docs/reference/evidence/phase89-resident-host-closure-live-2026-07-18/`

# Native swarm access — scoped participant bridge audit and seam report

> Integration update: the duplicate command validator below has been removed in favor of the
> shared `swarm-contract.mjs`. `SwarmNativeAccess` now prepares a scoped identity before native
> dispatch; the coordinator merges its environment after runtime isolation and redacts its token
> from provider frames. Explicit participant stop revokes access. The CLI fills the swarm identity
> and per-call mutation key. Real child-process client tests exercise delegated recruitment and
> concurrent implementer/context updates against the actual application. Full provider exercise is
> running separately; do not confuse the worker's fake-dispatch tests with that acceptance.


Audit date: 2026-09-13. Worktree under audit: `f176ab31a38b657d1f15b9858411e0c87067800c`
("Capture and check contributions without ending participant sessions"). Two files were ADDED in
this worktree — `impl/src/swarm-native-bridge.mjs` and `impl/test/swarm-native-bridge.test.mjs`
(24/24 pass under `node --test impl/test/swarm-native-bridge.test.mjs`); no existing file was
modified. Root-owned references read read-only from the root tree: `impl/src/swarm-runtime.mjs`
(live SwarmRuntime) and `impl/src/swarm-contract.mjs` (transport-independent command contract).
Direction documents read first: [swarm runtime](../../39-swarm-runtime.md) ("Native harness tools,
context management, skills, and delegation are part of the participant's capabilities") and
[runtime review](../../40-runtime-review-2026-09-12.md).

## 1. Problem and deliverable

The SDK and public commands alone do not let a native participant call its orchestrator's LIVE
`SwarmRuntime` instance under its OWN bounded identity. The deliverable is one lightweight,
deployment-owned local bridge:

- a scoped private token per participant, bound to `{swarmId, participantId, runId}`;
- authority DERIVED on every call — the bridge forwards `dispatch({command, args, principal,
  context})` to the live `SwarmRuntime.command(command, args, principal, context)`, which
  validates current membership and grants (`_caller` resolves the participant from
  `context.runId`; `_permit` checks the participant's current permission set). Requests can never
  choose principal or context, and the bridge never acquires owner credentials;
- the principal is a distinct native-participant identity — `principalId:
  swarm-native:<participantId>`, `actor: swarm-native:<swarmId>:<participantId>`, `sessionId:
  swarm-bridge:<digest16>` — never a `worker:<id>` seat and never a fabricated child identity for
  the participant's own native sub-agents (one token = one identity regardless of how many native
  children the harness runs);
- `authenticated context.runId` comes ONLY from the bridge's token table. The contract's closed
  arg key sets refuse `runId`/`principal`/`sessionId`/`context` fields at admission, so a request
  cannot smuggle identity either.

## 2. What the bridge refuses vs. what the runtime decides

Bridge-owned (transport scope, not authority):

| Refusal | Code |
| --- | --- |
| Unknown or revoked token (one refusal — invalid authority; no revoked-token history is retained) | `swarm_bridge_token_invalid` (401) |
| `args.swarmId` ≠ the token's bound swarm (checked for every command whose contract schema requires `swarmId`) | `swarm_bridge_swarm_mismatch` (403) |
| Contract schema violation: unknown command, unknown field, missing required field, bad field shape | `swarm_command_unavailable` (404) / `swarm_command_invalid` (400) |
| Frame over the bound (request declared or streamed, response before write) | `swarm_bridge_frame_exceeded` (413) |

Runtime-owned (passes through verbatim — message, code, detail, HTTP 422): membership
(`swarm_membership_required`, including `swarm.create` by any runId-carrying caller), per-command
and per-event grants (`swarm_permission_required`), author rules (`swarm_author_mismatch`),
replay/reconciliation (`swarm_replay_conflict`, `swarm_operation_unconfirmed`), availability
(`swarm_command_unavailable` for undeclared update kinds). The bridge keeps NO permission table
and NO event allowlist: `swarm.update` is admissible for any scoped participant (contributions,
review records, group/context changes), and the runtime checks the per-event grant on every call.

## 3. Contract mirror — explicit integration swap

Root owns `impl/src/swarm-contract.mjs`. The bridge carries a faithful mirror of its
`validateSwarmCommand` (closed command set, required/optional args, field predicates; same
`swarm_command_unavailable`/`swarm_command_invalid` codes and the same closed
`SWARM_EVENT_KINDS`), exported as `validateSwarmCommandArgs` + `SWARM_COMMANDS`, because the
contract module is not yet present in this worktree. INTEGRATION SWAP (root-owned): replace the
mirror with `import { validateSwarmCommand } from './swarm-contract.mjs'` and point the single
call site in `handle()` at it. No other surface reads the mirror; there is no second schema
registry beyond that one swap.

## 4. Transport and resource decisions

- **Loopback HTTP over a Unix socket.** `127.0.0.1` with an ephemeral port (loopback-only is
  constructor-enforced). Rationale: portable on every supported platform (Windows has no portable
  UDS-over-HTTP story), directly usable by native agents via `curl` or the module's own node CLI
  entry, and authority is the bearer token in the `Authorization` header — never in the URL, never
  in a log line. Token compare is exact-digest Map lookup; a 256-bit CSPRNG token on a private
  loopback listener leaves nothing for a timing side channel to measure.
- **Tokens are 256-bit, returned once.** Server-side capability entries keep the sha256 digest
  only; the raw token exists solely in `issue()`'s return value (for env injection). `revoke()`
  returns `{revoked, activeRemaining}` counts and stores nothing. `inspect()` exposes capabilities
  with digests, the command surface, and frameBytes — never a token.
- **Frame bound from the declared registry.** The default ceiling is `FRAME_LIMITS['wire.frame']`
  (1 MiB, substrate class, enforced through `composeFrameLimitRefusal` so the refusal text is the
  registry's), overridable per instance with `maxFrameBytes` (the override keeps the row's
  lane/class identity). Resource reason: the bridge buffers exactly one JSON frame per direction
  in process memory; this is a substrate guard for the bridge process, not a worker cap.
- **CLI envelope.** The existing Baton CLI envelope is NOT reused: it constructs an entire
  deployment application, while a bridge client must run against env-provided endpoint/token with
  zero deployment state. The module is instead directly executable
  (`node impl/src/swarm-native-bridge.mjs <swarm.command> [jsonArgs]`, env
  `BATON_SWARM_BRIDGE_URL`/`BATON_SWARM_BRIDGE_TOKEN`), printing ordinary JSON (availableActions
  via `swarm.inspect` needs no worker/fence/pause ids) and typed JSON errors on stderr with exit 1.

## 5. Injection seams (verified locations; none edited)

### 5.1 Where the deployment installs the bridge

`createDriver` accepts deployment-owned `opts.runtimeScopes` (impl/src/index.mjs:1258-1261) and
hands it to the Coordinator (impl/src/index.mjs:1513). A deployment wrapper delegating to
`RuntimeIsolation` is the integration point — no core edit required.

### 5.2 Where issue() plugs in (spawn hook)

`Coordinator._ensureRuntimeScope(handle)` (impl/src/coordinator.mjs:8962-8975) calls
`runtimeScopes.create(workerId, { card })` once per worker lease, on first dispatch
(:3515) and on both recovery spawn paths (:5602, :6030). `handle.runId` is already the
participant's Run identity (assigned at impl/src/coordinator.mjs:8641/8687/8765), so the wrapper
resolves the scope and calls `bridge.issue({swarmId, participantId, runId})` where:

- `swarmId`/`participantId` come from the deployment's swarm record for that `runId` (the same
  record `SwarmRuntime._caller` matches against `context.runId`);
- the returned `entry.env` is MERGED into `lease.env` AFTER `RuntimeIsolation.create` returns —
  required, because RuntimeIsolation strips secret-named variables (its `SECRET_NAME` filter
  matches `..._TOKEN`) from inherited `baseEnv`, and would drop the bridge token if it were only
  inherited;
- the non-secret `receipt` feeds the generated participant guidance (env var names, endpoint,
  scope identity, the CLI one-liner, and `swarm.inspect` → `availableActions` as the discovery
  step).

The lease env then reaches the worker process through the adapter spawn options at
impl/src/coordinator.mjs:3701-3703 (dispatch), :5647-5649 and :6061-6063 (recovery spawns) —
`env: runtime?.env, replaceEnv: runtime?.replaceEnv === true`. Native harness tools and skills
stay intact: the bridge injects environment plus guidance; it never replaces the mini-agent.

### 5.3 Where revoke() plugs in (cleanup hook)

`Coordinator._removeRuntimeScope(handle)` (impl/src/coordinator.mjs:8977-8991) is the exact-once
release path (ordinary stop and confirmed-close cleanup share it). The wrapper's `remove(workerId)`
looks up the scope it issued for that worker and calls `bridge.revoke({participantId, runId})`
(partial-scope object form), then delegates to `RuntimeIsolation.remove`. Startup reconciliation
(runtime-isolation `reconcile`, wired at impl/src/coordinator.mjs:1404-1407) is where the wrapper
additionally revokes scopes for workers that no longer exist. `bridge.close()` revokes everything
and awaits full server shutdown while touching no worker, coordinator, or unrelated process.

### 5.4 Root-side hooks (root's live swarm-runtime.mjs)

`prepareRun` (constructor-injected, root impl/src/swarm-runtime.mjs:28) is the Run-preparation
hook where root generates the participant guidance and can resolve the bridge connection before
`startRun`; in `swarm.recruit` the membership event (`swarm.participant_joined`) is written BEFORE
`startRun` (root impl/src/swarm-runtime.mjs, the recruit `_once` effect), so even a fast first
native turn finds membership — and therefore authority — already in place when its token's
`context.runId` reaches `_caller`.

## 6. Remaining adapter injection seam (precise)

Everything the bridge needs now exists; what remains is the deployment-owned glue in root's tree:

1. **Wrapper installation.** A `runtimeScopes` object implementing
   `create(workerId, {card}) / remove(workerId) / reconcile(expected)` that (a) delegates to
   `RuntimeIsolation`, (b) keeps a `workerId → {swarmId, participantId, runId}` map resolved from
   `handle.runId` via the swarm membership record, (c) merges `issue().env` post-`create`, and
   (d) calls `revoke` inside `remove`. Installed via `createDriver`'s `opts.runtimeScopes`
   (impl/src/index.mjs:1258) — no core edit.
2. **Guidance generation.** Root's `prepareRun`/recruit path composes the participant guidance
   (env names `BATON_SWARM_BRIDGE_URL`, `BATON_SWARM_BRIDGE_TOKEN`, `..._SWARM_ID`,
   `..._PARTICIPANT_ID`, `..._RUN_ID` — exported as `SWARM_BRIDGE_ENV_KEYS` — plus the CLI
   invocation and `swarm.inspect` discovery), so a native participant self-serves without
   worker/fence/pause ids.
3. **Contract import swap** (§3) once `swarm-contract.mjs` reaches the shared tree.

## 7. Test inventory (impl/test/swarm-native-bridge.test.mjs, 24 tests, all green)

Real local server + real client (no mocked transport). Covers: issue→env/receipt/inspect
separation with no token material outside `issue()`; malformed scopes; loopback-only
construction; bridge-minted principal/context with prebinding (membership by `context.runId`
before any worker binding); implementer contribution via `swarm.update`
(`swarm.contribution_recorded`) and reviewer attribution (`swarm.contribution_reviewed` →
`reviewerId` forced by the runtime); denied organizer update from an implementer vs. allowed
delegated organizer; `swarm.list` flows / `swarm.create` refuses (runtime-owned); forged
`principal`/`context` envelope fields ignored; forged `runId`/`principal`/`sessionId`/`context`
arg fields and malformed args refused by contract admission before any effect; non-contract
commands unavailable; unknown/revoked token refusal (no history retained); partial-scope revoke;
cross-swarm refusal; runtime refusal passthrough (`swarm_permission_required`,
`swarm_membership_required`); six concurrent mixed calls across two isolated scopes; same-token
concurrency minting exactly one identity (no fabricated native children); close-during-issue
race (issue rechecks closed after the listener wait); revoke-during-body-read race (token
rechecked before dispatch); wire.frame request bound (streamed and declared content-length lie)
and response bound with registry-composed refusal; default ceiling equals the declared row;
closure revokes, awaits shutdown, refuses post-close issues, is idempotent, and leaves an
unrelated loopback process serving; runtime refusals carry no token material; CLI entry answers
`swarm.inspect` from env alone and fails with typed JSON envelopes.

Verification (worktree `f176ab31a38b657d1f15b9858411e0c87067800c`):
`node --test impl/test/swarm-native-bridge.test.mjs` → exit 0, 24 pass / 0 fail.

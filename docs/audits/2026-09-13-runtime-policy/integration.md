# Living swarm integration and critique

Date: 2026-09-13. This checkpoint distinguishes shipped code on the working branch from native
acceptance still in progress. Swarms are the primary product capability. Orchestrators, delegated
coordinators, implementers, and reviewers all need direct, attributable participation.

## Defects corrected

- **Session completion stood in for contribution acceptance.** Contributions now have independent
  capture/check receipts. `contribution-verification.mjs` owns sandbox setup, verification, and
  cleanup; the coordinator retains execution/stop authority. A capture never installs a final
  task checkpoint that would discard later edits during cleanup.
- **An authorization override was global mutable state.** Overlapping requests could inherit
  another request's authorization policy. Request-local async context now isolates those policies.
- **Guidance inspected pause state too early.** A participant can pause while an earlier delivery
  is pending. `guideParticipant` chooses continuation behavior in the actual serialized delivery
  slot and preserves the initiating actor.
- **The public family existed without canonical ownership.** The real capability audit refused
  all ten commands once activated. A transport-independent command contract now supplies the
  central semantic registry and transport projections. CLI help prefers the detailed swarm
  contract; MCP tools carry execution and registry metadata.
- **The first interface represented permissions as an object while the runtime required grants.**
  Schema, validation, SDK, and runtime now consistently use arrays. The SDK preserves its maximum
  observed cursor when a later operation returns only a receipt or concurrent reads complete out
  of order.
- **Global coordination traffic woke unrelated swarm observers.** Watch now selects updates for
  the swarm and its bound participants, retaining a deadline and aborting waits on shutdown.
- **Packaged MCP forced an application surface on coordinator-only configurations.** The default
  now follows the available configuration, while explicit surface selection remains authoritative.
  Transport timeouts honor the configured baseline and provide slack for longer swarm watches.
- **Capacity reconcile could delete a live sibling verifier reservation.** Exact owner identity
  remains required even in one Node process or after adopting another worker. All lock-contention
  paths now respect a monotonic deadline. See `capacity.md` for the conservative dead-reaper limit.
- **Canonical JSON lost own `__proto__` keys; snapshot ordering varied by locale.** Both are fixed
  so complete request identity and deterministic replay remain reliable under concurrent use.

## Current behavior

`SwarmRuntime` reuses the coordination log, Run admission, native coordinator, and existing durable
operation receipts. It adds no second execution engine or journal. A swarm can begin without a
roster. Recruitment records membership before native dispatch; continuing turns are independent
of group/work/contribution state. Participants can publish plain-text findings and attributed JSON
context, while effectful updates identify the actual objects they mutate. Delegated authority is
checked on every call, and recruitment cannot grant permissions the caller lacks.

The SDK is available as `baton.swarms`. `swarm.recruit`, `guide`, `capture`, `check`, and `stop`
hide worker IDs, pause IDs, and gate choreography. `inspect` exposes current participant states,
permissions, available actions, and unresolved operations. Recruitment replays through existing
idempotent Run authority, keeping its originally admitted shared context. An unknown provider
message effect is reported as unconfirmed; it is not blindly repeated or declared delivered.

## Evidence at this checkpoint

- 197 focused tests pass across swarm state/store/runtime/SDK/real application, contribution
  lifecycle, concurrent authorization, MCP, and CLI transport regression suites.
- All three `npm --prefix impl run test:surfaces` audits pass with the family actually registered.
- 36 unified capability/CLI/MCP tests pass.
- 77 capacity ownership/contention tests pass, including real concurrent child processes.
- Native Claude, GLM 5.3 Flash, and DeepSeek Flash workers have produced reviewed contributions
  using Baton. Their verified result refs remain in Git. This checkpoint is local proof; earlier
  hosted checks on PR #256 were cancelled and are not green validation for these changes.

## Native agent access

`SwarmNativeAccess` issues a distinct participant credential before native dispatch and connects
its shell tools to the live `SwarmRuntime`. The coordinator merges that environment after runtime
isolation and redacts its token from provider frames. Native CLI calls fill the swarm identity and
per-call mutation key. Explicit participant stop revokes the credential; organizational changes and
ordinary turn completion do not destroy its continuing authority.

Real child-process tests exercise native-shell inspection, delegated recruitment, concurrent
builder findings and coordinator context updates, and selective revocation against the actual
application. A separate real-provider exercise has observed GLM recruiting DeepSeek, forming a
group, updating shared context, and receiving builder findings. Full capture/check/closure
acceptance of that live exercise is still pending at this checkpoint.

Two worker designs were corrected during integration: the bridge initially forbade all domain
updates from participants, and its duplicate validator would have drifted from the main command
contract. Both are removed. Inspect now identifies target participants for capture/check, so a
contribute-only implementer can distinguish its own contribution authority from reviewer authority.

## Remaining design and implementation work

Group-owned workspaces need explicit multi-holder custody before any shared cwd is offered.
Current group membership alone cannot authorize a participant or cleanup path to own that resource.
Native harness child observations must preserve actual child/session identity and evidence; a
native tool call is not by itself an independently controllable Baton worker.

Live code capture still requires a paused author. A native implementer cannot end the turn that
contains its own pending capture tool call. Simply permitting the old branch/index-mutating capture
would introduce a different hazard. An isolated-index snapshot primitive is under development so
an explicit capture can pin visible work without changing the live branch, index, or session.

The living domain is no longer a task-completion wrapper, but underlying Run startup still carries
mandatory goal/plan and budget assumptions. Revisable grants, selected-event subscriptions, safer
automatic reconciliation of uncertain message delivery, and native multi-harness swarm acceptance
remain in scope. The remaining work must simplify ordinary agent coordination rather than add
more mandatory choreography.

# Phase 86 — Progressive execution AX and reflexive dogfood integrity

## Decision

Phase 86 makes Baton's ordinary application surface small without weakening its internal safety
authority, then uses that same surface to review Baton. The public model is:

```python
baton = open_baton(repo)
group = await baton.start_many([
    {"objective": "...", "exact": {"harness": "glm", "model": "glm-5.2", "effort": "xhigh"}},
    {"objective": "...", "exact": {"harness": "claude-code", "model": "claude-opus-4-6", "effort": "xhigh"}},
])
await group.complete()
await group.stop()
await baton.close()
```

Callers select semantic work, exact harness/model/effort when relevant, and explicit effect scope.
They do not manage response bytes, export bytes, file counts, polling intervals, provider-turn
ceilings, cleanup coordinates, worker IDs, Plan IDs, or transport budgets. Those remain
deployment-owned circuit breakers and raw evidence only.

This phase does not claim that an unattended/yolo harness is host-contained. Unattended operation,
harness access, and verified containment are independent policy dimensions. A full-permission
harness still has only the write authority granted by its Baton worktree and Plan path scope.
Prompted authority is an immediate guard, not containment proof; verified OS containment remains a
required fleet capability and live full-permission dogfood is gated when its absence can damage
state outside the Run.

## PX1 — Cascading, self-describing application surface

The default card, outline, browser, and continuation response expose semantic choices only.

- The card groups logical operations and policies; it omits `maxBytes`, `maxFiles`, `maxAttempts`,
  timeout, token, USD, wall-time, and provider-turn numbers.
- `run.inspect` returns outline -> index -> section -> item -> content/evidence. Internal byte
  bounds are not serialized as ordinary response data.
- A continuation carries its cursor and says waiting is deployment-derived. Following a returned
  cursor requires no caller-supplied timeout. A wait without a cursor remains refused.
- The browser follows the cursor through `run.inspect`; it does not calculate or display an
  operator-managed polling budget.
- Exact route selection remains the closed tuple `{harness, model, effort}`. Effort is selected by
  the orchestrator per task and is never globally defaulted to low.

Every depth response, not only the outline, is finalized through one internal response-size guard.
An oversized index, section, item, or evidence response fails with
`application_inspect_oversize`; content remains deployment-paginated. The response never echoes
the numeric guard that rejected it.

## PX2 — Restart-safe exact Run stop

A process observed before controller restart is not signaled by numeric PID/PGID alone. When its
generation carries a durable PID/group plus kernel-start binding and a fresh observation matches,
one recovered stop may reap that exact group, append `control.recovery_process_reaped`, and only
then release its runtime/worktree. Without that authority, the compatibility path remains
absence-only: once the historical group is proven absent Baton appends one durable
`control.recovery_process_absent` and performs the same ordered release. Both paths return a stop
receipt with equal observed/closed process counts.

The absence transition depends on `currentIncarnation !== true` and
`processRef.state === unconfirmed_after_restart`, not on a transient derived worker status. A
replayed `control.recovery_terminalized` remains an orphaned/unattached session. This must converge
across the crash gap in which restart A terminalizes the task, exits before process absence can be
recorded, and restart B performs the stop after the provider exits.

Acceptance evidence must include the original interrupted dogfood Run IDs, `remainingCount: 0`,
`processesObserved === processesClosed`, zero workers after application close, and no signal sent
to an unverified, legacy, or reused process identity.

## PX3 — Atomic result publication without ambient PATH authority

Result export retains atomic no-replace publication. It must not resolve a security-critical
helper through the worker's ambient `PATH`; a dead or malicious shim may not change publication
behavior. Baton either uses a native implementation with equivalent no-replace semantics or a
deployment-resolved, absolute, preflighted helper with typed availability evidence. Normal callers
never select that helper.

Tests place a failing `python3` first on `PATH`, prove export still succeeds through Baton's owned
resolution, and preserve adversarial concurrent no-replace behavior. Baton must prefer correctness
over replacing the syscall with a check-then-rename race.

## PX4 — Authentication readiness is observed, not inferred from a filename

A credential file's existence is at most `unverified`; it is not proof that a provider session is
usable. Provider-native `login_required`, expired OAuth, refresh failure, or `Not logged in`
responses map to `authentication_refresh_required` and do not become generic provider failures.
Readiness may use bounded local metadata inspection or a deployment-owned non-mutating provider
probe. Secret values never enter cards, ledgers, logs, errors, or evidence.

Kimi Code subscription/OAuth and the Claude-Code-compatible Kimi API route remain separate routes.
Neither modifies the user's ordinary Claude Code installation. Native `kimi` supports both Baton
orchestrator and recipient roles once its own authentication is observed usable.

## PX5 — Full harness access does not broaden write scope

Every rendered Brief states that harness permissions are execution capability, not write
authority; only the Baton worktree and Plan path scope are writable. It explicitly prohibits
repairing home-directory credentials, toolchains, shims, global configuration, and caches and
requires reporting an environment blocker instead.

This is necessary but not sufficient. The follow-on containment gate must either:

1. launch the provider inside an attested workspace/credential/network sandbox while preserving
   unattended execution; or
2. advertise containment as unverified and refuse risky full-permission live dogfood unless the
   operator explicitly selected that deployment posture.

Post-hoc Git path-scope verification cannot detect or undo arbitrary host mutations and therefore
cannot satisfy this requirement by itself.

## PX6 — Reflexive evidence and incident accounting

The Phase 86 runner uses only `openBaton`, `doctor`, `startMany`, group completion/inspection, Run
stop, and application close. It has no environment-variable budget ceremony and does not ask the
model to manage file/byte ceilings. Stale report files are removed before launch.

Every live failure is retained as design evidence rather than hidden:

- Kimi native auth was locally configured but provider OAuth reported login required;
- Claude readiness inferred from a credential filename, but the provider reported not logged in;
- a full-permission GLM-through-Claude worker changed a user shim outside its worktree;
- export verification depended on ambient `python3` resolution;
- an interrupted live Run exposed the two-restart stop/reap gap; and
- non-outline semantic response depths lacked the internal final-size check; and
- a rerun lost its owned worktree after `worktree.ready`, continued operating from an unlinked
  provider cwd, and discovered the loss only at terminal result capture.

The out-of-scope shim change was restored exactly. No new live full-permission worker is launched
until its Brief carries the write-authority guard; verified containment remains explicitly open.

## PX7 — Active worktree authority and attachable control

`worktree.ready` is a continuing authority invariant, not a one-time launch fact. While a worker
owns a Baton worktree, the coordinator checks that the canonical checkout and its adjacent Baton
metadata still identify the expected task at every deadline sweep and worker-event boundary. Loss
of that identity must:

1. append one bounded `worktree.authority_lost` policy event;
2. fail the task and begin one exact kill;
3. reject later non-terminal worker output; and
4. continue accepting process-terminal observations needed to close and reap exact process
   authority.

This is fail-fast detection, not OS containment. It cannot prevent an external same-UID process
from deleting the checkout or causing effects between checks. Verified containment remains the
only proof that a full-permission provider cannot fall through to a runtime or main checkout.

An authenticated application command channel must also be attachable to script- and daemon-owned
sessions. A user or outer orchestrator must be able to inspect, steer, interrupt, and stop a Run
through Baton without owning the original in-process `Run` object or signaling provider PIDs
directly. Existing web and MCP northbounds supply reusable transport/auth pieces, but the Phase 86
runner does not yet publish an attach coordinate; that product gap remains open and must not be
described as complete.

## Acceptance order

1. red tests for hidden progressive surfaces and derived cursor waiting;
2. implementation and focused AX tests;
3. red restart-gap stop/reap test;
4. implementation plus live recovery of the interrupted Runs;
5. red all-depth response-finalization and ambient-PATH export tests;
6. auth classification/readiness tests;
7. full implementation suite;
8. a bounded Baton-on-Baton review with exact available routes, followed by exact Run stop/reap;
9. deterministic active-worktree-loss tests proving fail/kill, output rejection, and exact
   terminal close semantics;
10. a bounded rerun after the liveness guard, followed by exact Run stop/reap; and
11. adversarial review of the resulting evidence before Phase 86 is called complete.

Phase 86 is a dependency slice, not the full project. Web-authenticated user control, Kimi/Kimi
Code completeness, recursive/parallel workflow composition, a bounded RLM/REPL substrate, Slate
ideas, AST/CST/SCIP/CPG/IR and semantic deltas, the shared typed causal knowledge graph, verifier
and recovery expansion, and the remaining capability-plane catalog stay in the live goal. Homelab
integration is expressly excluded from this project scope.

## Acceptance evidence

The bounded rerun `run-dbe275e23261e7b1ba5d9815bc2dcf4b` preserved the exact GLM 5.2/xhigh
review result, then durably stopped with zero remaining workers, one confirmed kill, and equal
observed/closed process counts. Application close reported zero workers. The review's soft-stop
ordering finding was fixed by escalating an existing interrupt waiter to an exact kill after
authority loss and is pinned by deterministic coordinator coverage. The full implementation suite
before that final ordering correction was 2,142/2,142; focused and broad post-correction suites are
56/56 and 76/76. A final full-suite gate remains required after the next security slice.

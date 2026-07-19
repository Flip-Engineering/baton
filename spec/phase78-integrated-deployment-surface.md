# Phase 78 — integrated deployment-owned Baton surface

## Why this phase exists

Baton's Run application is usable, but its recursive evidence runner still assembles repositories,
state roots, evidence roots, export ceilings, Goal/Plan limits, provider budgets, adapters, service
principals, and cleanup in a phase-specific script. That is deployment code leaking into agent
experience. The ordinary user or orchestrator should open Baton for a repository, select an exact
harness/model/effort route when starting a Run, and then use bound Run methods. Internal ceilings
remain safety authority; they are derived and owned by the deployment rather than repeatedly
managed by the model.

Phase 78 extracts one reusable deployment factory and a higher-level Run cascade. It does not
remove the advanced kernel, weaken route attestation, invent provider identity, or make same-UID
full permissions into a sandbox claim.

The design target is an agent experience, not merely an assembly helper: one Pythonic,
self-describing application whose logical methods expand from an outline to an index, sections,
and exact items only as needed. Direct embedding, CLI, authenticated Web, and MCP share that
cascade and contextual help rather than exposing different bags of receipts and commands.

## Contracts

### DS1 — one repository-oriented entry

The ordinary local API is `openBaton({ repo })`, with the current working repository permitted as
the default. Baton canonicalizes the Git worktree and common directory, derives a stable private
repository identity, creates or reopens one owner-only deployment namespace, and returns one bound
deployment object. The caller does not supply log, runtime, evidence, export, worktree, lease, or
idempotency roots.

Advanced injection remains available under one explicitly named `advanced` branch for tests,
custom adapters, verification overrides, credentials, and externally managed deployment roots. It
does not create a second command/state machine.

### DS2 — deployment policy is hidden, bounded, and self-describing

The factory derives Goal/Plan, Run profile, follow, export, topology, recursive-lineage, drain,
watchdog, and generous resource ceilings. These are inspectable through Baton's existing cards and
cascading Run views, but absent from ordinary start arguments and shell environment choreography.
The orchestrator never has to choose token budgets, provider-turn counts, export byte ceilings, or
temporary directory sizes to perform an ordinary Run.

Readiness and worktree/runtime capacity are deployment-owned too. Baton derives conservative
policy, admits work before any adapter/runtime/Git effect, and presents a bounded readiness or
capacity attention with remediation. Only the `advanced` test/integration branch may inject
observers or estimators; ordinary callers never tune reserve bytes, inode floors, concurrency
arithmetic, or cleanup limits.

### DS3 — exact route catalog and selection

One deployment may register multiple adapter routes. Every allowed route is an exact
`{harness, model, effort}` triple backed by exactly one adapter card. Current curated identities
include Codex `gpt-5.6-sol`, native Kimi `kimi-code/k3`, Grok `grok-4.5`, optional Kimi K3 through
Claude Code `kimi-k3[1m]`, optional Claude Code `claude-opus-4-6`, and optional GLM `glm-5.2`. No
older GLM model is a current default or suggested route.

With more than one allowed triple, objective-only start remains deliberately ambiguous. The
orchestrator supplies model and effort together, and harness whenever model/effort does not select
one adapter uniquely. Baton never applies a deployment-wide low-effort fallback.

Native Kimi and Kimi-through-Claude require `max`; intended GLM dogfood uses `glm-5.2` at `xhigh`,
while Codex effort remains an explicit task-level orchestrator decision. Grok Build is not inferred
from a Grok 4.5 observation: literal Build stays red until the provider reports the requested
identity.

Credential-file presence alone never makes a route ready. The matching adapter must also expose a
bounded observed version for its configured executable; `unknown`, `unavailable`, malformed, or
unrecognized probe output blocks dispatch before provider launch. Native Claude and GLM derive
their Claude Code transport version from a bounded `--version` probe of the configured executable,
not a source-code constant. Static authentication failures advertised by an adapter remain red.

Each uniquely matched route projects a small non-secret runtime truth: normalized harness version,
authentication posture/state, permission mode, requested sandbox, autonomy/access defaults, and
containment observations. Arbitrary adapter prose, executable paths, environment, credentials, and
raw version output are not copied into the deployment card. Missing observations remain explicitly
`unknown`, `unavailable`, `unverified`, or `unobserved`; they are never upgraded by omission.

### DS4 — full worker access is the ergonomic default

Factory-created Codex, Claude, Grok, native Kimi, Kimi-through-Claude, and GLM adapters use their
existing unattended/full-permission launch postures by default. The profile requests Baton's
unattended/full worker policy. Cards and Run views continue to state that same-UID host processes,
filesystem access, and network access are not OS containment.

### DS5 — profile and dependency preflight are repository-derived

The default profile grants repository editing and provider work, requires a repository edit for
implementation Runs, supplies an objective-oriented definition of done, and derives a verification
command from supported repository metadata. Locally installed dependency trees needed by a clean
worker/verifier are detected and projected by deployment authority.

Missing or ambiguous verification/dependency readiness refuses during open or doctor with a
self-describing remediation. It does not collapse after provider launch into generic
`worktree_unavailable`, and it never asks the worker to invent host paths.

### DS6 — bound Run methods own the ordinary cascade

The deployment exposes `run(objective, route?)`, `open(runId)`, and parallel-safe Run handles.
Bound methods perform inspect/wait/action calls behind logical operations. A high-level drive method
may approve the exact Plan, allow advertised tool requests under the deployment's full-access
policy, wait for relevant changes, adopt a verified result, and optionally export it. It stops and
returns typed attention when a user answer, review decision, integration, publication, or other
new authority is required.

The cascade uses only the shared application registry and advertised action IDs. It does not call
Goal/Plan, Coordinator, ledger, receipt, or worker primitives directly.

`help()`, Run outlines, indexes, sections, and item/detail reads use the same registry. A caller
can stop at the summary or descend to exact route, authority, verification, evidence, or lifecycle
detail without carrying those coordinates through every call.

### DS7 — parallel Runs and exact reap are deployment operations

Multiple bound Runs may execute concurrently up to adapter and deployment capacity. `run.stop()`
stops only that Run or admitted recursive subtree and returns only after its exact target processes
are reaped. `deployment.close()` is separately named host authority, joins concurrent callers,
stops every owned Run/process, closes runtime/worktree/export ownership, and releases the writer.

### DS8 — recursive Baton-on-Baton uses the same factory

The factory enables the closed task-topology and recursive Run-lineage policies. An authenticated
recipient can use the same compact application client to start, inspect, and stop admitted child
Runs; lease/session/ancestry coordinates remain privately derived. Recursive dogfood must use this
factory and bound methods rather than copying the phase runner's kernel assembly.

### DS9 — deterministic and live proof

Tests cover repository derivation, private root ownership, closed option shapes, hidden internal
ceilings, route ambiguity and exact selection, full-access attestation, dependency/verification
preflight, restart, parallel Runs, high-level action cascade, scoped stop, deployment close, and
zero remaining process/worktree/runtime authority.

Live proof then runs at least native Kimi K3/max and Codex `gpt-5.6-sol` at an orchestrator-selected
effort through the concise surface. Grok and Kimi-through-Claude run when their current
authentication prerequisites are green. At least two eligible workers are launched concurrently
and selective interrupt/kill plus exact process/worktree/runtime/lease/export reap is demonstrated.
GLM live work waits for provider readiness and uses only `glm-5.2` at orchestrator-selected effort,
including `xhigh` for the intended recursive dogfood.

The 2026-07-17 evidence checkpoint now proves the deployment/readiness/capacity/recovery surface,
parallel Grok admission with selective stop and exact zero-ownership close, and one real Codex
`gpt-5.6-sol`/`medium` completion that survived an intentional >1 MiB telemetry notification,
freshly verified, adopted, closed, reopened, and projected cleanup `complete`. Native Kimi K3/max
and Grok 4.5 provider work are currently auth-red because their bounded local expiry metadata is
expired; both now refuse before provider/worktree effects with harness-native login guidance.
This is honest lifecycle evidence, not borrowed provider-success evidence. Kimi-through-Claude has
a secure `baton credentials install kimi` setup surface but remains pending a user-installed key.

## Product boundary

This phase is integrated local application assembly and AX. It does not add homelab integration,
make provider credentials public, silently mutate global Claude/Kimi/Codex configuration, claim
hard isolation for same-UID workers, auto-merge unreviewed results, push, publish, or deploy.
It also does not complete Atlas, the AST/CST/SCIP/CPG/IR/semantic-delta ladder, the rest of the
capability plane, or the shared typed causal knowledge graph; those remain active follow-on scope
under `docs/26-full-system-goal.md` and require their own evidence.

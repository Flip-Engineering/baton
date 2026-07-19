# Slate architecture assessment and Baton implications

> Research snapshot: 2026-07-18. This assessment covers the public Random Labs material for
> Slate and Onyx, the public example programs, current Slate documentation, and npm registry
> metadata. It does not treat product claims, an opaque native binary, or an agent-written summary
> as implementation proof.

## Decision

Slate contains several good agent-experience and orchestration ideas: bounded resumable worker
continuations, compact episode returns, simple `run`/`spawn`/`notify`/`result` verbs, procedural
fan-out, typed output shapes, and integrated parent/child/background trace navigation. Baton should
adapt those ideas without importing Slate's weaker public story for evidence, shared state,
durability, isolation, and lifecycle proof.

The March Slate article is best read as a useful continuation-and-compaction design, not as proof
that episodic memory, shared state, or long-horizon correctness is solved. Random Labs' later Onyx
design adds typed programs, persisted named state, checkpoints, explicit errors, and lifecycle
verbs while explicitly leaving program crash/resume durability unresolved. That evolution is the
most informative result of this review: a pleasant orchestration language still needs the durable
authority and recovery substrate Baton is building.

Phase 85 should continue as specified. Its contract is designed to close the largest gaps in
Slate's public model:
per-output lineage, exact harness/model/effort roles, separately approved successor Plans,
selective retry generations, replay-safe cleanup, authenticated transport parity, and exact
stop/reap. Slate should influence Baton's outer surface and later Program IR, not weaken these
invariants.

## Evidence boundary

### Publicly specified or inspectable

- The [Slate architecture report](https://randomlabs.ai/blog/slate) defines threads, episodes,
  episode composition, and thread weaving.
- [Skills as Dynamic Actions](https://randomlabs.ai/blog/skill-chaining) defines episode-scoped
  skill context and the proposed synchronous fork primitive.
- The later [Onyx report](https://randomlabs.ai/blog/onyx) defines the `.program.ts` authoring
  model, `run`, `spawn`, state, checkpoints, error semantics, composition, and its still-open
  durability problem.
- Current [orchestration and tracing documentation](https://docs.randomlabs.ai/en/using-slate/orchestration)
  documents child sessions, background agents, stop/open actions, program graph/detail views, and
  trace cards.
- Current [configuration documentation](https://docs.randomlabs.ai/en/using-slate/configuration)
  documents model slots, variants, effort selection, permissions, headless mode, and HTTP
  `serve`/`attach`.
- The public [example programs](https://github.com/entropy-research/example-programs/tree/c4fa2caa39880796f619f225a6f807f7d039c7c3) expose real
  program source and some session-storage facts, but not the Slate or Onyx runtime.
- The current [skills documentation](https://docs.randomlabs.ai/en/using-slate/skills) exposes the
  shipped skill discovery and activation model.

### Registry and binary observations

Direct [npm registry metadata](https://www.npmjs.com/package/@randomlabs/slate) on 2026-07-18
reported `@randomlabs/slate` 1.0.43 as a 5,293-byte launcher package selecting proprietary platform
packages. The Darwin arm64 package reported exactly 118,414,272 bytes unpacked. The package has no
substantive npm README and declares a proprietary license. These facts show that the current runtime
is shipped as a closed native artifact; they do not reveal its scheduler, compactor, state store,
sandbox, or recovery implementation. No binary decompilation is used here.

### Inferences, not claims

- The public material is consistent with logical agent sessions backed by ordinary model/tool
  loops, but it does not prove whether a resumed thread retains provider-native context, a local
  transcript, a model-generated episode, or some combination.
- A related sandbox-agent repository exists in the Random Labs GitHub organization, but public
  artifacts do not prove that current Slate uses it.
- Program state is described as persisted, but persistence must not be inferred to mean an
  exactly-once effect log or a crash-resumable program counter; the Onyx article says that
  durability remains open.

## Slate's execution model

### Thread and episode

In the March design, one central orchestration agent retains strategy and dispatches tactics to
worker threads. A Slate thread is not an OS thread. It is a logical, isolated worker context that
performs one action, pauses at the completion boundary, and may later resume for another action in
the same workstream.

```text
orchestrator intent
  -> dispatch bounded action to thread T
  -> T executes a model/tool loop
  -> T pauses at the action boundary
  -> compress that action trajectory into an episode
  -> return the episode to the orchestrator
  -> optionally resume T or seed another thread from the episode
```

Several threads may run concurrently and their episodes may be gathered before the orchestrator
chooses its next action. Decomposition therefore remains adaptive: the orchestrator need not commit
to a complete static task tree before it observes results.

The useful primitive is the boundary, not the memory claim. The public report does not define an
episode schema, selection algorithm, source coordinates, contradiction model, confidence model,
raw-trace references, route identity, or replay validator. An episode is publicly specified as a
compressed representation, so it is lossy unless proven otherwise.

The statement that threads avoid message passing is also too strong. Passing a compressed episode
between isolated contexts is still explicit inter-context communication. It may be better bounded
than freeform peer chatter, but it is not shared cognition or shared structured state. The later
Onyx design's addition of shared named state addresses a cross-agent coordination need that the
public episode model does not specify.

### Skills and forks

The April skill design pins selected skill instructions into a worker only for an episode, then
removes them when that episode ends. This is a sound context-hygiene pattern for noninteractive
skills.

Interactive skills exposed a control problem: a background worker could either show a poor
one-shot dialog or terminate and ask the parent to conduct the conversation. Random Labs proposed a
synchronous fork instead. A fork would take over the existing conversational surface, block other
orchestrator actions, and return a compact result when interaction completed. Unlike a thread, the
fork would not be resumable.

The article marked this feature alpha and delayed for reliability. Current skill docs describe
session-lived activation and automatic routing into subagents rather than a clean episode-only
lifecycle. Baton should treat the fork design as an interaction-model idea, not verified shipped
behavior.

### Current subagents, background work, and programs

The current product documentation uses conventional terms: parent sessions, subagent child
sessions, background agents, and programs. The TUI presents:

- inline cards for parallel children, including interruption, completion, progress, and changed
  files;
- an overlay and direct navigation into child conversations;
- background-agent open, stop, and session actions;
- completion notifications returned to the parent chat;
- built-in `goal` and `deep-research` programs with graph and details views; and
- high-level trace activity cards.

Its mid-run user controls are particularly relevant to Baton:

```text
steer      deliver after the current response/tool boundary
queue      deliver after the active run becomes idle
interrupt  abort the active run and send the replacement next
```

This is the right kind of integrated control surface: the normal interaction remains a chat while
deeper session, program, and trace information is available on demand.

## Onyx program model

Onyx moves orchestration from ephemeral model-authored code toward persistent TypeScript programs:

```ts
export default program<Input, Output>(async (ctx) => {
  const plan = await run("planner", {
    type: "read",
    model: "provider/model",
    prompt: "Inspect and plan",
    output: PlanSchema,
  })

  const worker = await spawn("worker", {
    type: "general",
    prompt: makePrompt(plan),
    output: WorkerSchema,
  })

  await worker.notify("Check the replay path")
  return await worker.result()
})
```

The public model includes:

- blocking `run` and nonblocking `spawn`;
- a handle supporting steering and awaiting a result;
- cancellation as a required lifecycle operation, though the exact public API is less complete;
- Zod schemas for result shape and a finish gate requiring valid structured output;
- named persisted state read by programs and agents through a structured tool;
- state values passed by reference into children;
- `checkpoint` notifications and `sleep` for long-running loops;
- TypeScript `try/catch`, loops, `Promise.all`, and imports;
- child-program composition; and
- per-call model overrides plus runtime model and budget configuration.

This authoring model is materially stronger than thread weaving alone. It also exposes the hard
systems problems. The Onyx article lists program durability as future work. Public material does
not define program-counter persistence, effect idempotency, atomic multiwriter state, compensation,
crash replay, or cleanup reconciliation. A deterministic TypeScript control skeleton still contains
nondeterministic agents and side effects.

Zod output gating is useful but only structural. It cannot prove that a test ran, an artifact came
from the admitted tree, a reviewer was independent, a route was honored, or resources were reaped.
Baton must continue to separate typed result shape from evidence-backed completion authority.

## Public program findings

The example repository provides useful concrete evidence and useful counterexamples:

- [`council.program.ts`](https://github.com/entropy-research/example-programs/blob/c4fa2caa39880796f619f225a6f807f7d039c7c3/council.program.ts)
  fans one read-only review across caller-selected model strings, tolerates individual failures,
  and synthesizes anonymous structured reviews. It does not select an external harness or exact
  effort, and its higher-severity-wins rule erases disagreement instead of adjudicating evidence.
- [`goal.program.ts`](https://github.com/entropy-research/example-programs/blob/c4fa2caa39880796f619f225a6f807f7d039c7c3/goal.program.ts)
  derives requirements, works them sequentially, asks another agent to verify them, appends
  objective-level gaps, and stops after a repeated blocker. The verifier is still model output and
  brittle repository defaults demonstrate that this is example code, not runtime proof.
- [`ralph-loop.program.ts`](https://github.com/entropy-research/example-programs/blob/c4fa2caa39880796f619f225a6f807f7d039c7c3/ralph-loop.program.ts)
  starts a fresh worker per iteration and relies on structured `done` plus an optional textual
  completion promise. Prompting an agent to be truthful is not a deterministic completion gate.
- [`workflow-from-chats.program.ts`](https://github.com/entropy-research/example-programs/blob/c4fa2caa39880796f619f225a6f807f7d039c7c3/workflow-from-chats.program.ts)
  inventories session transcripts, fans preference extractors out, and proposes programs or skills.
  Its privacy boundary is substantially prompt-enforced rather than mechanically enforced.

That last program documents session lineage fields including `parentID`, `rootSessionID`,
`forkedFromID`, and `createdByWorkflowID`, with messages stored separately by `sessionID`. It also
states that there is no durable session status field. This is useful navigational lineage, but it is
not equivalent to Baton's Plan, Attempt, route, evidence, settlement, and release lineage.

## Limitations, evaluation, and security

### Architectural limits

1. **Episode truth is unspecified.** There is no public evidence grammar or replay validator.
2. **Shared-state concurrency is unspecified.** Passing named mutable state by reference requires
   transactions, versioning, or CAS semantics that are not documented.
3. **Durability is open.** Persisted state and checkpoints are not a demonstrated resumable
   workflow runtime.
4. **Isolation is not shown.** Tool permissions and workspaces are not process, filesystem,
   credential, or worktree isolation.
5. **Stop is not reap proof.** The UI can stop a background agent, but no public descendant-union,
   process-tree, session, worktree, or runtime release receipt is specified.
6. **Public route proof is narrower than Baton.** Slate's public docs and examples expose models,
   roles, variants, and effort UI, but do not publicly expose and attest Baton's exact
   harness/model/effort tuple per Attempt. Its closed runtime may contain additional mechanisms.
7. **Implicit planning is overstated.** Slate's own prompting guide recommends research, plan
   discussion, approval, todos, and execution. Onyx later restores explicit program structure.

Slate's critique of RLM reactivity is also incomplete. The official
[RLM implementation](https://github.com/alexzhang13/rlm) supports iterative REPL interaction,
recursive calls, trajectory logging, and several local or remote sandbox environments.
[CodeAct](https://arxiv.org/abs/2402.01030) explicitly revises executable actions across multiple
observations. Slate's distinctive contribution is better characterized as frequent bounded
continuation synchronization, not the unique restoration of reactivity to code-driven agents.

### Evaluation limits

The architecture article leaves formal routing analysis and benchmarking to future work. Its
observations are qualitative. The published
[library-port case study](https://randomlabs.ai/blog/porting-a-library-with-slate) predates the
thread-weaving release, uses one run with no baseline, excludes tests and examples from the port,
acknowledges incomplete parity and cleanup, and intentionally avoids isolation. It does not
validate the March architecture.

A serious Baton evaluation should compare the same tasks and models across:

1. one direct agent;
2. naive parallel agents plus concatenated responses;
3. bounded workers with lossy episode summaries; and
4. Baton Context map/reduce with exact lineage and deterministic gates.

Measure deterministic acceptance, wall time, provider calls, tokens, duplicated work,
unsupported claims, contradiction retention, injected-crash recovery, exact route adherence, user
control actions, and remaining processes/sessions/worktrees/runtimes.

### Security limits

Slate documents allow/ask/deny tool permissions and an optional `--yolo` hard bypass. It does not
publish per-worker credential projections or process ownership. Its server defaults to
`0.0.0.0`, and `attach` documents a Basic-auth password. TLS, token scopes, revocation,
CSRF/origin policy, command idempotency, and audit semantics are not documented.

Baton should not copy that northbound posture. Loopback should be the default. Non-loopback access
should require TLS and scoped authenticated sessions, with origin/CSRF protections, revocation,
idempotency, authority rechecks, and durable audit events. Full-permission harness launch should
remain distinct from Baton authority: a child may receive full native harness permissions without
receiving broader repository, Plan, route, credential, or integration authority.

## Exact Baton mapping

| Slate concept | Baton mapping | Baton difference |
|---|---|---|
| Thread action | One Context call unit and its routed Attempt | Exact Plan, route, task, evidence, and cleanup binding |
| Resumable thread | Logical workstream across immutable action generations | No assumption that the same OS/provider process survives |
| Episode | Read-only projection over one terminal call/Attempt | Per-output lineage and raw evidence remain authoritative |
| Thread weaving | Successor Plan generations composing map/reduce/retry | Each effect stays inside durable recursive authority |
| Program `run` | Blocking high-level application call | Cascades to existing Goal/Plan/Attempt machinery |
| Program `spawn` | Nonblocking workstream handle | Handle owns exact stop/reap and settlement observation |
| Shared state | Versioned immutable Context/Program state revisions | CAS/transaction semantics; no ambient mutable object |
| Zod output | Typed artifact or Context value | Shape is not completion proof |
| Checkpoint | Durable progress event and compact parent notification | Replayable, authority-scoped, evidence-linked |
| Model override | Semantic role resolving exact route | Harness, model, and effort remain separately attested |
| Program graph | Goal/Plan/call/task/Attempt/lineage graph projection | Outline-to-evidence cascade from one application |

Slate's episode model complements rather than replaces Baton's planned AST/CST/symbol/SCIP/CPG
and shared knowledge graph. Structural indexes explain repository meaning; episodes explain
temporal work and evidence. The knowledge graph should join them through edges such as
`derived_from`, `produced`, `grounded_in`, `contradicted_by`, `verified_by`, and `releases`.

## Staged implementation plan

### Stage A — evidence-backed Episode projection

Complete Phase 85 per-output source lineage, provider derivations, terminal settlements, and
selective retry first. Then expose an Episode as a deterministic read model, not another mutable
store:

```python
episode = await call.episode()
episode.outline()
episode.output()
episode.sources()
episode.derivations()
episode.trace()
episode.cleanup()
episode.help()
```

An Episode contains a bounded semantic summary plus exact refs to output lineage, Attempts,
routes, artifacts, raw traces, termination, and cleanup. The summary can be regenerated and can
never grant completion, selection, integration, or retry authority.

### Stage B — resumable workstream handle

Add one logical workstream abstraction across immutable action generations:

```python
worker = await run.spawn(role="critic", instruction="Review this partition")
await worker.notify("Check replay and cleanup")
result = await worker.result()
episode = await worker.episode()
await worker.stop()
```

`notify` should append an addressed interaction at a safe harness boundary. Resume creates a new
generation bound to its predecessor Episode and current authority; it must not imply that the same
process or hidden context survived. `stop` must use Baton's transitive ownership union and return
zero remaining resources before the handle becomes stopped.

### Stage C — closed Program IR and familiar builders

Do not initially execute arbitrary TypeScript, Python, shell, callbacks, or ambient imports.
Provide Pythonic and TypeScript builders that compile to one canonical content-addressed Baton
Program IR:

```text
Python/TypeScript builder
        -> normalized typed Program IR
        -> schema and authority validation
        -> approved Plan envelope
        -> durable state-machine execution
```

The first closed constructs should be `sequence`, `parallel`, `map`, `reduce`, `retry`, `select`,
`gate`, `wait`, `checkpoint`, `notify`, and `finish`. The IR must bind exact roles, effect classes,
recursion bounds, source lineage, and result schemas while leaving route resolution to the durable
role catalog.

### Stage D — durable Program runtime

Persist a program counter and immutable state revision at every effect boundary. State writes
should carry schema digest, version, parent digest, value digest, writer authority, and source
lineage, with expected-version CAS or an explicit transactional reducer. Recovery may replay pure
evaluation, attach a known result, dispatch a never-started approved effect, or finish cleanup. It
must not repeat an ambiguous side effect.

Program stop snapshots every descendant call, task, Attempt, provider process/session, interaction,
worktree, runtime, and state lease. Completion requires terminal call settlement and zero remaining
ownership, not merely a cancelled JavaScript promise.

### Stage E — adaptive approval and integrated visibility

After the durable runtime is proven, allow one approval envelope to authorize a bounded program
shape, semantic role catalog, effect types, route constraints, repository scopes, and recursion
depth. Descendants inside that closed envelope need no low-level caller input. Expanding role,
route, effort, effect, scope, or depth requires a successor approval.

Present the result through one user/orchestrator surface: chat with steer/queue/interrupt, inline
parallel cards, background handles, and outline -> index -> section -> item -> evidence drill-down.
Internal Plan IDs, budgets, byte ceilings, worker IDs, and cleanup coordinates remain available at
evidence depth rather than routine call arguments.

## Recommendations and rejections

Adopt:

- frequent bounded synchronization;
- compact reference-bearing Episode returns;
- familiar `run`/`spawn`/`notify`/`result`/`stop` verbs;
- semantic model-role presets resolved to exact Baton routes;
- procedural fan-out expressed through a closed durable IR;
- episode-scoped skill context where no interaction is needed;
- steer/queue/interrupt semantics and integrated child/background trace navigation; and
- structured checkpoints and typed result shapes.

Reject or defer:

- lossy summaries as authority;
- shared writable workspaces as default coordination;
- arbitrary TypeScript/Python execution before durable Program semantics;
- mutable shared state without version/transaction rules;
- model-only routing that omits harness and effort;
- prompt-only privacy, read-only, or completion enforcement;
- model-reported completion promises without deterministic or independent evidence;
- consensus that erases contradictions or automatically selects the highest severity;
- Basic-auth, all-interface web defaults;
- caller-managed routine budget, byte, export, or cleanup knobs; and
- any assumption that UI `stop` proves descendant processes were killed and reaped.

The useful synthesis is straightforward: Slate offers a strong vocabulary and several excellent
interaction patterns. Baton should make those patterns trustworthy by preserving exact authority,
lineage, route specificity, independent verification, restart convergence, and complete lifecycle
settlement beneath a simpler agent-facing surface.

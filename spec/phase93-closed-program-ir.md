# Phase 93 — closed canonical Program IR and durable effect-boundary runtime

Status: implementation-ready specification, revised 2026-07-19 against the canonical Program
contract (GitHub issue 9, captured in `docs/29-slate-architecture-assessment.md` Stage C/D and
`docs/28-exhaustive-capability-audit.md` §"initial common RLM/REPL substrate"). No runtime code is
implemented in this phase; it is the numbered contract the next executable slices compile against.
The deployment verification command for this dispatch is `npm test --prefix impl`; the suite was
2,328/2,328 green before this spec landed and remains green because the phase authors no runtime
code.

## Why this phase exists

Baton has a strong fleet kernel (Goal/Plan, exact route tuples, Wave/Candidate/feedback, recursive
Run lineage, deterministic gates, Episode/workstream facade) and a closed pure **Context** AST
(`baton-context-ir-v1`, `impl/src/context-program.mjs`) for selecting addressed context. What it
does not yet have is the **canonical Program IR** that issue 9 calls for: one closed, content-
addressed control-flow language with a durable effect-boundary runtime, of which the Context AST is
one node's payload — not a substitute for Program control flow.

`docs/29` Stage C/D states the contract precisely:

> "Provide Pythonic and TypeScript builders that compile to one canonical content-addressed Baton
> Program IR … The first closed constructs should be `sequence`, `parallel`, `map`, `reduce`,
> `retry`, `select`, `gate`, `wait`, `checkpoint`, `notify`, and `finish`. The IR must bind exact
> roles, effect classes, recursion bounds, source lineage, and result schemas while leaving route
> resolution to the durable role catalog."

> "Persist a program counter and immutable state revision at every effect boundary. State writes
> should carry schema digest, version, parent digest, value digest, writer authority, and source
> lineage, with expected-version CAS or an explicit transactional reducer. Recovery may replay pure
> evaluation, attach a known result, dispatch a never-started approved effect, or finish cleanup. It
> must not repeat an ambiguous side effect."

Phase 92 §7 hands off: "closed canonical Program IR; event-driven recursive/parallel composition;
immutable base plus private overlays; one fenced integrator; and live multi-harness gates."

Phase 93 closes the Program IR. "Closed" means six concrete things:

1. **A full top-level control grammar** — `value`, `context`, `sequence`, `branch`, `parallel`,
   `await`, `collect`, `select`, bounded `repeat`, and bounded child Program — that owns Program
   control flow. The existing Context AST lives **inside** the `context` node as its pure evaluation
   payload; it is not the Program.
2. **A closed effect grammar** — `call`, `map`, `reduce`, `gate`, `notify`, `checkpoint`,
   `finish` — that compiles through existing Baton authority at durable effect boundaries.
3. **An immutable program counter and state-revision schema with a pure reducer**, binding schema
   digest, parent digest, value digest, writer authority, source lineage, transition identity, and
   effect-boundary replay.
4. **Compilation, not deferral, of gate and review composition** through existing authority: `gate`
   compiles to the deterministic referee; review composes through `call`/`map`/`select` with route-
   family independence. No parsed-but-unexecutable leaf is the center of v1.
5. **Honest delegation modeling.** Harness-internal fan-out (a worker's or outer harness's own
   sub-agents) is an observed property/metadata of a Baton `call`/Attempt, not a Program node that
   compiles to nothing. It is never implied independent verification.
6. **No new promotion path.** Program results enter Cairn only through existing artifact / Decision
   / Scratch / Representation authority.

This is a reconciliation and closure phase, not a concatenation, and not a relabeling of the Context
AST. The critique below names the tensions it resolves.

## Normative dependencies

- Phase 77 durable recursive Run authority (RR1–RR11); Phase 79 dynamic Workflow composition
  (WF1–WF13); Phase 80 recursive Candidate revision (R80.1–R80.9); Phase 81 common Context Program
  and context-recursive workflows (CP1–CP10); Phase 84 Context successor Plan/Wave (CSW1–CSW7);
  Phase 85 addressed Context lineage and recursive synthesis (CLR1–CLR6).
- Phase 87 semantic action authority (SA1–SA4); Phase 88 Plan route-tuple authority v2 (RT1–RT5);
  Phase 90 durable Run control and streams (RC/RR/RT/RV); Phase 91 semantic interrupt preservation;
  Phase 92 Episode/workstream facade.
- Phase 42 policy-hash-invalidation (PI1–PI12; the `PI` prefix is Phase 42's — Phase 93 uses the
  unused `IR` prefix to avoid collision).
- `spec/RECONCILIATION.md` D4/D6 (trust gate / referee / freshVerifySandbox) — the deterministic
  authority the `gate` effect compiles to.
- Atlas representation ladder (Phases 13, 17, 18, 24, 27, 54, 61). The Program IR is **not** a new
  R4 representation; it is a non-R4 control-flow canonicalization that references R0–R3 artifacts by
  content identity through the `context` node.
- Cairn selective promotion (Phases 31, 44, 47–50, 52–53). The IR adds no promotion class.
- Issue 9 canonical Program contract (`docs/29` Stage C/D, `docs/28` §RLM/REPL substrate).

## Critique of prior plans (what Phase 93 changes, not concatenates)

1. **Context AST was being treated as the Program IR.** A prior draft of this phase made the Context
   pure operators the IR's node set. That narrows and drops the canonical Program contract: there is
   no Program control flow (sequence/branch/parallel/await/select/repeat/child), no effect grammar
   beyond map/reduce, and no program counter. Phase 93 restores Program control flow as primary and
   demotes the Context AST to the `context` node's payload (IR1, IR3).
2. **Dangling effect operators.** `EFFECT_OPS = {map, reduce, review, verify}`
   (`impl/src/context-program.mjs:25`) parses four effects but only two compile. A closed IR cannot
   ship parsed-but-unexecutable operators as its center. Phase 93 replaces them with the closed
   effect grammar `call/map/reduce/gate/notify/checkpoint/finish`, in which `gate` compiles to the
   existing referee and review composes through `call`/`map`/`select` + independence (IR4, IR8). The
   Context-AST `review`/`verify` nodes remain inside the `context` node as inherited grammar, not
   the Program's center, and are not deferred leaves.
3. **No durable runtime / program counter.** Phases 81–85 establish replay-safe cells and calls but
   no Program-level program counter or state-revision chain. Issue 9 Stage D requires exactly that at
   every effect boundary. Phase 93 specifies it (IR5).
4. **Two policy surfaces with hidden ceilings.** `context-program-policy.mjs`, the Workflow/effect
   policy, and `CONTEXT_EFFECT_CALL_LIMITS` are separate; some ceilings lack a stated physical
   derivation. Phase 93 reconciles them and documents each derivation (IR15).
5. **`delegate` as a node.** A prior draft made harness-internal fan-out a Program node that
   compiles to nothing. That has no coherent executable semantics: by definition Baton cannot
   observe or re-run it. Phase 93 models it as honest delegation metadata/policy on a `call`/Attempt
   (IR11), preserving the epistemic rule without a vacuous node.
6. **Identity fragmentation.** Pure cells, requests, calls, and units are separate identity families.
   Phase 93 introduces one canonical Program identity (IR1) while keeping every historical v1 ID as
   the durable replay handle.
7. **Convergence spread across four phases.** WF6, R80.8, CP6, CLR4 overlap. Phase 93 unifies them
   (IR6).
8. **Shared sandbox described twice, compiled zero times.** Phase 79 modes and `capability-plane.md`
   §4 are one mechanism. Phase 93 compiles it (IR10).

## Explicit non-goals

- No arbitrary TypeScript/Python/shell execution, ambient imports, callbacks, `eval`/`exec`, or
  persistent interpreter kernel as a first vertical. Builders compile to the canonical IR; they do
  not run author-authored code (Stage C/D, `docs/29` line 350-356).
- No new R4 compiler-IR, translation-validation, or equality-saturation representation. JS/TS stops
  at R3 by Decision `phase24-js-ts-r3-ceiling`; R7 e-graph remains retired/redirected.
- No concurrent direct multi-writer POSIX checkout. Revisioned state may be shared by handle with
  one generation-fenced writer; concurrent full-permission multi-writer state stays unsupported
  (`docs/28` line 501-503).
- No agent-authored dynamic arbitrary recursion. `repeat` and `child` compile to append-only
  successor Plans under deployment-owned bounds; agent prose cannot mint a loop.
- No model-selected harness/model/effort/service-tier. Role names resolve through orchestrator
  route-tuple + service-tier authority (RT1–RT5; `docs/26` line 92).
- No automatic correctness, selection, integration, publication, or Cairn promotion from
  memoization, consensus, reproducibility, or harness-internal delegation.
- No new Program-IR-specific Cairn promotion class or edge type.
- No homelab integration and no external project-manager runtime.

## IR1 — one canonical Program IR (control is primary; context is a node payload)

The canonical Program is `baton.program` schema v2: one normalized control/effect DAG addressed by
one identity grammar, the compilation target for every builder, strategy template, and surface.

```json
{
  "schemaVersion": 2,
  "kind": "baton.program",
  "language": "baton-program-ir-v1",
  "schemaDigest": "sha256",
  "manifestDigest": "sha256",
  "policyDigest": "sha256",
  "roleCatalogDigest": "sha256",
  "root": { "nodeId": "pnode:..." },
  "nodes": [ { "nodeId": "pnode:...", "kind": "sequence", "...": "..." } ],
  "resultSchema": { "digest": "sha256" },
  "programDigest": "sha256"
}
```

Identity grammar (uniform with the Atlas/CAS scheme; SHA-256 over canonical JSON with sorted keys,
locale-independent UTF-16 ordering from `impl/src/canonical-order.mjs`):

```text
nodeCore      = { schemaVersion, kind, manifestDigest, policyDigest, node }
nodeDigest    = H(canonical(nodeCore))
nodeId        = pnode:<nodeDigest>
programDigest = H({ schemaVersion, kind, language, schemaDigest, manifestDigest,
                    policyDigest, roleCatalogDigest, root, nodes, resultSchema })
programId     = program:<programDigest>
```

The program binds one exact manifest (the immutable base, IR10), one policy, one role catalog
(CLR2 schema v3 — exact harness/model/effort/service-tier per semantic role), one result schema, and
the complete ordered node list. The `context` node's payload is a normalized `baton-context-ir-v1`
program (Phase 81/85); the Context program's own `programDigest` is referenced, not flattened, so
Context replay identity is unchanged. A historical `baton.context_program` v1 remains replay-stable;
it is the payload of a `context` node, not a substitute for control flow.

Canonicalization sorts object keys, rejects duplicate node IDs and cycles, normalizes text and
selectors, and digests the complete program. Semantically changed code creates a distinct program;
exact retry returns the original.

## IR2 — pure IR / core-module boundary

Four closed layers, each with a forbidden set:

| Layer | Owns | Forbidden |
|---|---|---|
| **Program IR core** (normalizer, canonicalizer, digest, validator, pure reducer) | Control grammar, effect grammar, program counter, state-revision schema, deterministic reducer | I/O, authority, provider calls, ledger writes, filesystem mutation |
| **Context payload** (`context-program.mjs`, `context-program-policy.mjs`, pure parts of `context-authority.mjs`) | The pure Context AST evaluated inside a `context` node | Anything outside its closed pure operator set (CP2) |
| **Effect compilation** (`context-call.mjs` + coordination store) | Effect node → successor Plan/Wave/gate/Episode admission; identity prebinding | Choosing a route, approving its own Plan, bypassing the action registry |
| **Workspace/sandbox + observability** (worktree/overlay authority; application-semantics projection; Episode facade) | Immutable base, overlays, fenced integrator; outline→evidence projection | Dispatch/write/approval/select/promote authority |

The Program IR core is the sole authority for Program grammar, identity, the program counter, and
the reducer. Effect compilation reads normalized nodes and emits execution handles (`context-request:`
/`context-call:`/`context-unit:` from `impl/src/context-call.mjs`); it never re-parses. The IR is not
a new R4 producer kind (the Atlas producer MAP is closed to three entries,
`impl/src/atlas-representation-producer.mjs:13-17`); it references R0–R3 artifacts by content
identity through the `context` node.

## IR3 — closed control grammar

Control nodes are structural and deterministic; they govern program-counter transitions and never
touch a provider. The set is frozen and exhaustive (unknown kinds fail `program_invalid` before any
effect).

| Kind | Semantics |
|---|---|
| `value` | A literal/constant typed value (result-schema-conformant); the leaves of pure computation |
| `context` | Evaluate one closed `baton-context-ir-v1` pure program over the manifest and yield its addressed output; the Context AST lives here and only here |
| `sequence` | Ordered composition; the PC advances node-to-node, threading the state revision |
| `branch` | Closed conditional over a typed value (no arbitrary predicate; boolean/eq/neq/exists/contains, CP2) |
| `parallel` | Fan-out: admit a bounded set of branches whose nodes share one immutable base and run concurrently |
| `await` | Block the PC on one parallel branch / `call` handle until its effect boundary settles (Slate `wait`) |
| `collect` | Gather settled awaited/parallel results into one typed value in canonical order |
| `select` | Adjudicate among candidates/evidence under a closed policy (`operator_selected`, `first_verified`, `all_verified`, evidence-based selector); `unresolved` when evidence cannot distinguish (WF8) |
| `repeat` | Bounded loop: a deployment-owned max-rounds bound over a body that consumes the prior revision; compiles to append-only successor Plans. Retry is `repeat` over failed units (CLR4) |
| `child` | Bounded child Program: one recursive successor Program under the depth/round ceiling; a fresh program counter beneath the parent |

The `context` node is the **only** place the Context AST is evaluated. Its payload is the closed
Phase 81/85 pure grammar (`source, outline, index, search, slice, chunk, filter, project, sort,
unique, join, collect, coverage, finish`). The Context `finish`/`collect` are pure operators inside
the payload; the Program `finish`/`collect` are distinct Program nodes (IR4). A `reference` to an
Atlas representation is a Context-payload concern (CP1 manifest branch), reached through the
`context` node, not a Program control node — keeping the representation ceiling intact.

`branch` predicates, `select` policies, and `repeat`/`child` bounds are closed sub-grammars. None
can import modules, inspect environment variables, open arbitrary paths, access the network, spawn
processes, mutate a checkout, manufacture authority, or choose a route (CP2).

## IR4 — closed effect grammar

Effect nodes compile to authority at durable effect boundaries (IR5). The set is frozen.

| Kind | Compiles to | Notes |
|---|---|---|
| `call` | One successor Plan + one routed Attempt (blocking); the Program `run`/Slate `run` | One exact role from the catalog; one unit; result schema enforced |
| `map` | One successor Plan + all-or-clean Wave, one Attempt per unit (CSW, CLR) | Role from catalog; ≥1 unit (live acceptance requires ≥2) |
| `reduce` | One successor Plan + one Attempt over selected child capsules (CLR) | Completed call source; exactly one unit selecting every output |
| `gate` | The **existing** deterministic referee/trust gate (RECONCILIATION.md D4/D6; Phase 90 RT10) | Fresh-sandbox re-run of a pinned command; candidate value → pass/fail; never model self-attestation |
| `notify` | A semantic `send` to an in-flight `call`/workstream at a safe harness boundary (Phase 90 RC) | Closed delivery (`turn`/`now`/`nudge`); not a new control channel |
| `checkpoint` | One durable progress event + compact parent notification (Stage B; Phase 92 workstream) | Replayable, authority-scoped, evidence-linked; not a mutable save |
| `finish` | Terminal Program result with bound evidence | Proposes a result + result-schema conformance; does not assert correctness |

`gate` is executable in v1 because the deterministic gate authority already exists: the referee
re-runs `task.brief.verification` in a mandatory fresh worktree and `referee.accept(verdict)` is the
sole decider (D4/D6). `gate` exposes that authority at the Program level: `{candidate, command,
expectExit, freshSandbox:true}`. A `gate` whose command is not pinned or whose sandbox is not fresh
fails typed before effect.

Review is **not** a separate effect node and is **not** deferred. It composes through the existing
grammar: an independent reviewer is a `call` (or `map` over partitions) whose role resolves to a
critic role carrying a route-family-independence constraint (Phase 50 SC3: reviewer harness and
model family both differ from the producer); its structured findings are typed feedback (WF5); a
`select` or a revision `repeat` consumes them (R80). The only residual authority is durable route-
family independence enforcement and a typed review artifact; those refine review's *independence*,
not its compilability. The composition compiles today; Phase 93 does not defer it.

The Context-AST nodes `review` and `verify` (Phase 81) remain inside the `context` payload as
inherited grammar. They are not advertised as Program effects and are not the center of v1; the
Program's deterministic-verification primitive is `gate`.

## IR5 — immutable program counter, state-revision schema, and pure reducer

This is the durable effect-boundary runtime (issue 9 Stage D). Execution does not mutate an
instruction pointer; it appends immutable transition records to a hash-chained, content-addressed
sequence, persisted at every effect boundary.

**Program counter (transition record).** Each effect boundary appends one transition:

```json
{
  "schemaVersion": 1,
  "kind": "baton.program_transition",
  "schemaDigest": "sha256",
  "programDigest": "sha256",
  "parentDigest": "sha256",
  "nodeId": "pnode:...",
  "effectKind": "call",
  "effectBoundary": { "callId": "context-call:...", "requestId": "context-request:..." },
  "valueDigest": "sha256",
  "writerAuthority": { "actor": "deployment:program", "principalId": "...", "repoId": "...", "runId": "..." },
  "sourceLineage": { "outputLineageDigest": "sha256", "parents": [] },
  "stateRevisionDigest": "sha256",
  "transitionDigest": "sha256"
}
```

- `schemaDigest` binds the Program schema version (grammar authority).
- `parentDigest` is the prior transition's digest (genesis transition has `parentDigest: null`);
  the chain is append-only and tamper-evident.
- `valueDigest` binds the exact value produced/consumed at this boundary (canonical JSON digest).
- `writerAuthority` is hub-derived from the owning Run/session/lease — never a caller field, never a
  bearer credential.
- `sourceLineage` reuses the Phase 85 CLR1 per-output lineage grammar (`outputLineageDigest`,
  `parents`, `derivations`), so Program values inherit exact source-coordinate lineage.
- `transitionIdentity = pstep:<H({schemaDigest, programDigest, parentDigest, nodeId, effectKind,
  effectBoundary, valueDigest})>`; `transitionDigest` binds the full record. Replay recomputes every
  digest; any substitution fails coordination integrity.

**State-revision schema.** Program-visible state is an immutable revision chain (no mutable object,
no ambient variable). A revision carries `schemaDigest`, monotone `version`, `parentDigest`,
`valueDigest`, `writerAuthority`, `sourceLineage`. Writes proceed by expected-version CAS or an
explicit **pure reducer**:

```text
revision_{n+1} = reducer(revision_n, effect_result)
revisionDigest_{n+1} = H({ schemaDigest, version: n+1, parentDigest: revisionDigest_n,
                           valueDigest, writerAuthority, sourceLineage })
```

The reducer is a deterministic function of the prior revision and the settled effect result; it
cannot read the clock, the network, the filesystem, or a provider. Identical `(revision_n,
effect_result)` always yields the same `revision_{n+1}`. State is shared by content-addressed handle
(IR10); mutation requires the one generation-fenced writer.

**Effect-boundary replay.** Recovery at any boundary performs exactly one of:
1. **replay pure evaluation** — control nodes and `context` payloads are deterministic; re-evaluate
   to the same value/revision;
2. **attach a known result** — an effect whose settled result is durable is replayed by attachment,
   with no second provider effect;
3. **dispatch a never-started approved effect** — an approved Plan with no Wave is dispatched; or
4. **finish cleanup** — reap and settle an orphaned descendant.

It must not repeat an ambiguous side effect. An effect whose provider state is ambiguous settles
`outcome_unknown` / `manual_intervention_required` (IR6), never a fabricated success. This is the
Phase 90 RC recovery table generalized to the Program counter, and it satisfies the Stage D
invariant that completion requires terminal call settlement and zero remaining ownership, "not merely
a cancelled JavaScript promise."

## IR6 — typed transitions and convergence/no-progress semantics

**State machine.** Every effect boundary node moves through one closed machine set by the hub, never
a provider marker:

```text
admitted → working → completed
                   → failed
                   → attention
                   → stopped
```

Effect nodes add the compile envelope `plan_pending → awaiting_plan_approval → approved → running →
settlement_ready → completed` (side: `attention | failed | stopped`), reusing CSW6. `repeat`
generations and `child` successors are new program-counter branches/children, not in-place mutations
— each is a fresh transition chain under the parent.

**Termination algebra (unified from WF6, R80.8, CP6, CLR4).** One closed set of dispositions:

| Disposition | Meaning |
|---|---|
| `completed_with_evidence` | Approved mechanical (`gate`) + semantic gates passed |
| `no_new_context` | Expansion produced no previously unread relevant context |
| `no_verified_progress` | A new revision added no verified evidence or Candidate delta |
| `repeated_query_or_result` | Normalized program/input or result repeated an already-consumed set |
| `unresolved_contradiction` | Applicable evidence remains contradictory |
| `verification_failed` | A required `gate` failed |
| `policy_exhausted` | Deployment authority cannot admit another step |
| `artifact_unavailable` | A required immutable source is absent or corrupt |
| `manual_intervention_required` | An external effect cannot be reconciled safely |
| `operator_stopped` | Stop authority fenced the subtree |
| `harness_delegation_unverified` | A result depended on opaque harness-internal delegation that Baton cannot re-verify (IR11) |

Policy exhaustion and `harness_delegation_unverified` never force a final answer. Every non-success
disposition preserves accepted transitions, revisions, results, evidence, and coverage and advertises
one typed safe next action. Deterministic loop-stopping evidence (R80.8) binds: a verified Candidate
SHA repeating a selected ancestor; a normalized feedback set repeating an already-consumed revision
set; an explicit unresolved `contradiction`. None is overridable by changed prose, action IDs, or
task coordinates. `repeat`/`child` depth and round bounds are deployment-owned (IR15); the grammar
can express bounded multi-generation composition, and the first vertical pins the declared authority
at the proven shape pending the four-arm evaluation (IR15).

## IR7 — strategy templates compile to the IR

Named strategies are closed functions from `{objective, team}` to one canonical Program + role
catalog + result schema + approval envelope (WF2; `docs/29` Stage E adaptive approval). They are
conveniences, not new state machines.

- **`parallel_attempts`** — `parallel` over role-`call`s → `collect` → `gate` per Candidate →
  `select` (`operator_selected` or evidence-based selector).
- **`review_revise`** — builder `call` → `gate` → reviewer `call`/`map` (route-family-independent)
  → typed feedback → approved Candidate or `repeat` revision successor (R80).
- **`context_recursive`** — the canonical RLM adaptation: `context` pure selection → `map` Wave →
  optional `map` `repeat` generations → `reduce` → optional `reduce` `repeat` (CLR).
- **`partition_review_integrate`** — collision-checked partition `map` → `gate` → independent
  reviewer `call`s → hub-owned fenced-integrator `reduce` (IR10) → fresh `gate`.

`debate_synthesize` remains catalogued and compiles through the same primitives; it is not
re-advertised until cross-review packet independence is durable. A template is itself a normalized
Program; it previews and validates before any effect. Every `parallel`/`await` pins one closed join
(`all_terminal`, `all_verified`, `first_verified`, `operator_selected`).

## IR8 — capability/effect compilation through existing authority

Every effect compiles through **existing** authority. The IR adds no dispatch engine, action
family, or route source.

- `call`/`map`/`reduce` → existing successor-Plan + Wave + capsule authority (CSW, CLR), with each
  unit's exact `(harness, model, effort, service-tier)` resolved from the approved role catalog.
- `gate` → existing referee/trust gate (D4/D6, Phase 90 RT10), mandatory fresh sandbox, pinned
  command, `referee.accept(verdict)` sole decider.
- `notify` → existing semantic `send`/recipient resolution (Phase 90 RC2/RC3).
- `checkpoint` → existing durable progress event + workstream notification (Phase 92).
- `finish` → terminal result + result-schema conformance; the trust gate still decides acceptance.

The deterministic capability plane (`spec/capability-plane.md`) is the read path: a `context` node
that delegates to Atlas capabilities returns the ACI envelope and is hub-reverifiable (`reverify`,
§6). Effect compilation is the write path. They share the content-addressed ref shape but never
conflate: a capability/`call` result is `derived` evidence until a `gate` or independent review
raises it.

The capability-authority table inherits Phase 87 SA1: context actions require
`['control','observe']`; `notify`/`send` require `control`; `stop`/selective kill require
`emergency_stop`; `integrate` requires `integrate_result`; `export_result` requires `export_result`;
`retry_verification` requires `retry_verification`. The IR introduces no new capability or action ID.

## IR9 — preserve exact route + service-tier, typed feedback/revision, recursive successor, selective kill, restart

These are load-bearing invariants Phase 93 must preserve, not relitigate.

- **Exact route and service-tier.** Every executable role resolves an exact
  `(harness, model, effort, service-tier)` tuple before dispatch (RT1–RT5; `docs/26` line 92:
  effort and service tier are independent axes, never encoded in the harness name). Requested,
  resolved, and observed identities stay distinct; provider-omitted observation stays null (Phase 92
  §5). The role catalog (CLR2) carries the tuple; the Program never lets a node choose it.
- **Typed feedback/revision.** Feedback packets are typed, immutable, source-bound (WF5); a revision
  is a new `repeat` generation consuming exact predecessor + packet identities (R80). Stale, cross-
  Program, or superseded substitution fails before effect.
- **Recursive successor.** `child` and revision `repeat` compile to append-only successor Plans
  under deployment-owned depth/round/call ceilings (R80.7, CLR4). The durable graph stays acyclic.
- **Selective kill.** Any `call`/`map` child is selectively killable: selective stop reaps only the
  exact descendant union (RR8/RR9); siblings survive (WF9). Selective interrupt preserves the turn
  where the adapter attests it (Phase 91).
- **Restart.** The program counter + revision chain (IR5) make restart exact: recovery replays pure
  evaluation, attaches known results, dispatches never-started approved effects, or finishes cleanup,
  never repeating an ambiguous side effect.
- **Four-arm evaluation.** The strategy must earn its use. A fixed evaluation compares
  (1) one direct agent, (2) naive parallel agents + concatenated responses, (3) bounded workers with
  lossy episode summaries, and (4) Baton Program `map`/`reduce` with exact lineage and deterministic
  `gate`s (`docs/29` line 254-259; CP10). Measures: deterministic acceptance, wall time, provider
  calls, tokens, duplicated work, unsupported claims, contradiction retention, injected-crash
  recovery, exact route adherence, remaining processes/sessions/worktrees. Baton routes to the
  strategy only for task classes where it improves verified utility.

## IR10 — shared-sandbox policy (immutable base + private overlays + one fenced integrator)

Phase 93 compiles Phase 79's workspace modes and `capability-plane.md` §4 into one authority, and
makes Program state revisioned-shared-by-handle (`docs/28` line 501-503).

1. **Immutable base.** One content-addressed tree — the manifest's `tree.sha` with validated `source`
   (`deployment_snapshot`/`revision_parent`, CP1). Read-only to all participants. A mutable path,
   branch name, HEAD, cwd, transcript pointer, or cache filename is never base identity.
2. **Private overlays.** Each writer gets a private worktree over the base or a selected predecessor
   Candidate. The snapshot+overlay model applies: a shared index is a base epoch plus a per-worker
   overlay; per-file-hash invalidation; results carry `provenance.index_epoch` + `overlay_applied`.
   Facts/observations are scoped to exact tree/environment identity; cross-tree evidence is labeled
   `observedOn` / `currentTree:false` (CP8, Cairn CK4).
3. **Revisioned state by handle.** Program state revisions (IR5) are immutable, content-addressed,
   shared by handle. Mutation requires the one generation-fenced writer; expected-version CAS or the
   pure reducer serializes writes. No ambient mutable object.
4. **One fenced integrator.** Composed overlays run in one hub-owned integration lane: it serially
   stages selected deltas into a fresh integration candidate using preimage identities, path-scope
   authority, structured conflict classification, and fresh `gate`s. No model writes the caller
   checkout or a peer's live worktree. The composed candidate is untrusted until normal gates pass.
5. **Explicitly unsupported.** Two live full-access writers on one physical checkout. A future
   multi-writer mode requires an enforced OS boundary or hub-mediated patch protocol with per-edit
   attribution/preimages, transactional conflicts, replayable ordering, and exact writer fencing.

## IR11 — harness-internal delegation is honest metadata, not a Program node

Opaque harness-internal fan-out — a worker's or an outer harness's own sub-agent recursion that
Baton cannot observe as first-class participants — is **not** a Program node. It has no coherent
executable Baton semantics: Baton cannot admit it, route it, reap it, or re-run it, so it cannot be
a `call`/`map`/`reduce`/`gate`. Modeling it as a node that "compiles to nothing" would be a vacuous
construct. Instead Phase 93 models it as **honest delegation metadata and policy on a Baton
`call`/Attempt**:

- A `call` (or `map` unit) is one Baton-attested Attempt with one exact route, one reap target, one
  trust-gate verdict. If the worker delegates internally inside that Attempt (its own sub-agents,
  tool loops, private recursion), Baton records an observed **delegation descriptor** on the
  Attempt's evidence: `{ observed: true, attestable: false, summary: "<bounded non-secret>" }`.
- The descriptor is an observation, not authority. It cannot raise grounding above `derived`, cannot
  substitute for a `gate` or independent review, and cannot multiply Baton ownership or escape Run
  ceilings. A result whose load-bearing evidence depends on such delegation settles
  `harness_delegation_unverified` (IR6) rather than passing.
- This preserves the rule from the operator note — **if Baton did not admit it, route it, and reap
  it, Baton did not verify it** — without inventing a non-executable node. Useful harness-native
  fan-out remains legitimate (an orchestrator composing cheap parallel exploration is fine); it is
  simply not Baton-attested verification.

The attestation boundary is therefore structural in the evidence/trust model (a `call` is attested;
its internal delegation is not), enforced by the trust gate and the grounding ceiling, not by a
Program node.

## IR12 — observability / AX projection (no auto-promotion)

The Program projects through the existing outline → index → section → item → evidence cascade
(Phase 86 PX1) and the Episode/workstream facade (Phase 92). Program transitions, revisions, calls,
and gates map to Episode chapters; each carries topic, summary, route, verification, result,
cleanup, and a typed terminal disposition. Every depth response is finalized through one internal
response-size guard (`application_inspect_oversize`); the guard value is never echoed (PX1).

**Routing into Cairn — no new path.** Program results enter only through existing authority:
artifacts via `artifact.registered` (`verified` only if `verify.reverified` cites it, else
`observed`); Decisions/Counterexamples via `causal.promote` (a Program `call` spawn is just another
`task.created`); cited observed Scratch Findings via the Phase 49 SP3.4 gate; independently-oracled
derived Scratch via Phase 50; Representation nodes via the existing producer path (`derived` until
an oracle raises it). Hard prohibitions (Phase 49 SP3, 44 RS1, 31 CR7, 47 CA4): derived/uncited/
expired/cross-repo Scratch, reads without completed-verified tasks, raw operational events, worker
messages/prompts, Bench output, memoized results, model prose/confidence, worker self-report,
run-scorecard prose, and harness-delegation-derived results **never** auto-promote and never set
grounding. The IR adds no node/edge type to the 19/14 typed sets (`coordination-store.mjs:115-116`);
Phase 92 §3 Episode labels are a read-only facade over those types. Promotion never runs inside
stop/kill/publication/integration/terminal paths (Phase 49 SP7).

## IR13 — recovery, replay, stop, and reap

Replay reconstructs the program, manifest, role catalog, every transition, revision, call, Wave,
Attempt, capsule, coverage, termination, and cleanup from the durable ledger and content-addressed
artifacts (IR5; CLR6). The program counter makes recovery position-exact: restart resumes at the
last durable transition. Effect-boundary replay (IR5) never repeats a completed provider effect and
settles ambiguous state typed. Changed meaning, actor, route, target, predecessor, candidate,
feedback, or revision conflicts before effects (WF10, R80.4).

Program stop snapshots every descendant `call`/`map`/`reduce`/`child`, task, Attempt, provider
process/session, interaction, worktree, runtime, and state lease (Stage D; CLR6). It fences new
transition/call admission before cancellation. Completion requires every effect terminal or stopped,
every worker release replay-verifiable, and every remaining count zero — "not merely a cancelled
JavaScript promise." A late result remains forensic Attempt evidence and cannot attach to an older
or newer transition (CP7). Selective stop of one child reaps only its exact union; siblings continue
(WF9). A `call` carrying a delegation descriptor still has exactly one Baton reap target; its
deletion does not reach inside the harness's private recursion, and Baton says so honestly.

## IR14 — transport parity

Direct application, concise CLI, authenticated Web/browser, and MCP expose the same canonical
program identity, action digests, requester-bound call identities, cascade inspection, and help
(WF13, CP9, CLR). The IR adds no northbound command family; it is a nested Run facade compiled
through the five default operations (`application.help`, `run.start`, `run.inspect`, `run.act`,
`run.stop`). Transport schemas never accept private node, task, worker, process, worktree, route,
budget, or receipt coordinates when derivable from the authenticated handle. Browser and CLI
presentations may differ; their semantic document digest must match.

## IR15 — policy reconciliation, ceiling derivation, and the evaluation gate

Phase 93 reconciles the grammar policy, the Workflow/effect policy, and
`CONTEXT_EFFECT_CALL_LIMITS` under one canonical policy surface referenced by one `policyDigest`
(Phase 42 PI1). Every numeric ceiling is a deployment-owned safe integer with a stated physical
derivation (project rule: no arbitrary numeric limits):

| Ceiling | Derivation |
|---|---|
| program node count / depth | PC chain and validation budget; bounded by `maxProgramBytes` |
| `maxProgramBytes` | ledger event byte ceiling; canonical-order `maxEventBytes` |
| `repeat` rounds / `child` depth / calls-per-Program | provider/capacity/wall-time authority; pinned to the proven shape until the four-arm gate (IR9) passes |
| result/evidence/coordinate ceilings | artifact byte ceiling (`maxArtifactBytes`) |
| join comparisons | O(n·m) memory/CPU; bounded by result-items² and wall policy |

A `max+1` value refuses the whole transaction typed before emit (Atlas boundedness discipline).
Cursors are `digest+offset` bound and tamper-checked on resume; cancellation is checked between
units. Historical policies remain byte- and digest-stable during replay (Phase 42 PI2; RT2); a
historical Program never inherits a changed default. Deepening `repeat`/`child` beyond the proven
shape requires the four-arm evaluation (IR9) to pass and is a successor approval, not a silent
widening (Stage E).

## IR16 — security boundary (honest)

Full-permission workers remain the default, but a private runtime and Git worktree are not hard
same-UID containment (WF14, PX5). Workspace isolation prevents cooperative edit collisions and
preserves trust-gate attribution; it does not stop a hostile full-access process from reaching
another same-UID path. True hostile multi-writer or credential secrecy requires a distinct UID,
container/VM, OS sandbox, isolated volume, or external broker. Harness-internal delegation (IR11)
makes the harness's private work *less* trusted, not more. No homelab or external project-manager
runtime is added.

## Red-test matrix

Each suite is named for its contract and must fail before implementation, then pass.

- **`phase93-program-identity-red.test.mjs`** (IR1): canonical `pnode:`/`program:`/`pstep:` identity;
  schema/role-catalog/result-schema binding; key-order invariance; duplicate-node, cycle, and
  unknown-field refusal; tamper of any digest fails replay; context-payload digest referenced, not
  flattened.
- **`phase93-control-grammar-red.test.mjs`** (IR3): every control kind normalizes; `context` payload
  is a closed Context program; `branch`/`select`/`repeat`/`child` bounds are closed; route injection,
  arbitrary predicates, ambient imports, and code strings fail before effect.
- **`phase93-effect-grammar-red.test.mjs`** (IR4): each effect compiles to its named existing
  authority; `gate` requires pinned command + fresh sandbox; `notify`/`checkpoint`/`finish` closed
  shapes; review composes via `call`/`map`/`select` + independence (not a deferred leaf).
- **`phase93-program-counter-red.test.mjs`** (IR5): transition hash-chain integrity; `parentDigest`
  genesis/continuation; `valueDigest`/`writerAuthority`/`sourceLineage` binding; pure reducer
  determinism; effect-boundary replay attaches known / dispatches unstarted / refuses ambiguous;
  tamper of `transitionDigest` fails.
- **`phase93-convergence-red.test.mjs`** (IR6): each disposition projects exactly; repeated SHA,
  repeated feedback set, explicit contradiction, no-verified-delta, policy-exhaustion,
  artifact-unavailable, and `harness_delegation_unverified` terminate without false completion and
  advertise a typed next action.
- **`phase93-strategy-templates-red.test.mjs`** (IR7): the four templates compile to previewable
  Programs + catalogs + envelopes; join pinning; non-selected-member fate; `debate_synthesize`
  catalogued-not-advertised.
- **`phase93-effect-compilation-red.test.mjs`** (IR8): `call`/`map`/`reduce` compile through
  existing Plan/Wave/capsule authority with zero new dispatch; `gate` through the referee; exact
  route + service-tier per unit; no implicit low effort.
- **`phase93-preserve-invariants-red.test.mjs`** (IR9): exact `(harness,model,effort,service-tier)`
  requested/resolved/observed; typed feedback/revision substitution refusal; recursive successor
  acyclic; selective kill isolates; restart convergence; four-arm evaluation harness shape.
- **`phase93-shared-sandbox-red.test.mjs`** (IR10): immutable base read-only; overlay isolation;
  cross-tree labeling; revisioned-state CAS/reducer; fenced-integrator serialization + conflict
  classification; two-writer direct-write refusal before the second provider process.
- **`phase93-delegation-metadata-red.test.mjs`** (IR11): delegation descriptor is observation-only
  on a `call`/Attempt; caps grounding at `derived`; cannot substitute for `gate`/review; cannot
  multiply ownership; load-bearing dependence settles `harness_delegation_unverified`.
- **`phase93-observability-no-promote-red.test.mjs`** (IR12): results route only through existing
  authority; every auto-promote substitution fails; no new node/edge type; promotion excluded from
  stop/terminal paths; inspect-oversize guard.
- **`phase93-recovery-stop-reap-red.test.mjs`** (IR13): restart at every transition/effect boundary
  converges without duplicate provider effects; whole-Program stop fences and reaps zero; selective
  stop isolates; late-result non-attachment; "not merely a cancelled promise."
- **`phase93-transport-parity-red.test.mjs`** (IR14): direct/CLI/Web/MCP identical program digest,
  call identity, cascade, help; no private coordinates accepted.
- **`phase93-policy-derivation-red.test.mjs`** (IR15): one canonical `policyDigest`; every ceiling
  has a derivation; `max+1` refuses typed; historical policy replay-stable; depth/round pinned until
  the four-arm gate.
- **Cross-phase falsifiers retained**: CK8/CK9; RC2/RC3; EP3/EP5/EP6/EP7; PI3/PI10 (Phase 42);
  AF2/AF3/AF6/AF7/AF10; PF5; DP3/DP5; SP7/SP9; CO2; writer-lease release semantics (Phase 92 §6);
  D4/D6 trust-gate freshness (RECONCILIATION.md).

## Acceptance criteria

1. One objective plus a named strategy compile to one canonical `baton.program` v2 with exact
   identity before any worker effect; a caller completes the ordinary flow without task or evidence
   coordinates.
2. Program control flow is primary: `sequence`/`branch`/`parallel`/`await`/`collect`/`select`/
   `repeat`/`child` and the `value`/`context` nodes all normalize and evaluate; the Context AST is
   the `context` payload, not the Program.
3. Every effect (`call`/`map`/`reduce`/`gate`/`notify`/`checkpoint`/`finish`) compiles through
   existing authority; `gate` runs the existing referee in a fresh sandbox.
4. The program counter and state-revision chain (IR5) persist at every effect boundary; the pure
   reducer is deterministic; effect-boundary replay attaches known / dispatches unstarted / refuses
   ambiguous.
5. Review composes through `call`/`map`/`select` + route-family independence; `gate` composes through
   the referee; neither is a deferred unexecutable leaf.
6. Harness-internal delegation is honest metadata on a `call`/Attempt, never a node, never
   independent verification.
7. Exact `(harness, model, effort, service-tier)` is preserved per role; typed feedback/revision,
   recursive successor, selective kill, and restart are green.
8. The shared sandbox admits only immutable base + overlays + revisioned-state-by-handle + one
   fenced integrator; two direct writers fail before the second provider process.
9. Every IR6 disposition projects exactly; no false completion.
10. Program results route into Cairn only through existing authority; no auto-promotion; no new
    node/edge type.
11. Restart at every boundary converges without duplicate provider effects; whole-Program stop
    fences and reaps zero; "not merely a cancelled promise."
12. Direct/CLI/Web/MCP share the same program digest, call identity, cascade, help.
13. Every policy ceiling has a stated derivation; `max+1` refuses typed; historical policy is
    replay-stable; four-arm evaluation harness is specified.
14. Focused authority, replay, lifecycle, route-substitution, delegation-metadata, transport, and
    application suites plus the complete `npm test --prefix impl` suite are green.
15. Live Baton-on-Baton evidence proves a multi-harness `map → reduce` whose real child reports are
    consumed by a separately approved reduce, at least one selective-retry `repeat`, a `gate` over
    the result, restart replay from a persisted transition, whole-Program stop/reap with zero
    ownership, and an honest delegation descriptor that is not counted as verification.

## Migration path

The canonical v2 Program IR is additive and replay-stable. Historical `baton.context_program` v1,
`baton.context_effect_call` v1, and schema-v2/v3 Workflow definitions remain byte- and digest-stable
during replay (Phase 42 PI2; RT2). A v1 Context program becomes the payload of a `context` node; a
v1 cell replay returns its original `cell:` identity. The durable `context.*` and `context.call_*`
events are unchanged; the Program IR is a new compilation and counter surface over them, not a
replacement ledger. No migration pass is required for historical Runs; they remain observable and
restart-safe.

## Status mapping of prior planned features (none disappear; issue 9 details preserved)

| Feature (origin) | Phase 93 status |
|---|---|
| **Canonical Program IR, control + effect grammar (issue 9 / `docs/29` Stage C)** | **Restored and closed** as IR1/IR3/IR4: `value/context/sequence/branch/parallel/await/collect/select/repeat/child` + `call/map/reduce/gate/notify/checkpoint/finish` |
| **Immutable program counter + state revision + pure reducer (issue 9 / `docs/29` Stage D)** | **Specified** as IR5 (schema/parent/value digests, writer authority, source lineage, transition identity, effect-boundary replay, CAS/transactional reducer) |
| **Durable effect-boundary runtime (`docs/28` §RLM/REPL)** | **Specified** as IR5/IR13; "must not repeat an ambiguous side effect"; "not merely a cancelled promise" |
| **Closed Context AST (81 CP2)** | **Retained as the `context` node payload** (IR1/IR3); not the Program |
| **Immutable ContextManifest (81 CP1)** | **Retained**; the immutable base (IR10) |
| **Stateless pure cells, CAS artifacts (81 CP3, 83)** | **Retained**; Context payload + IR core (IR2) |
| **`map`/`reduce` successor Plans/capsules (84 CSW, 85 CLR)** | **Compiling effects** (IR4/IR8) |
| **Per-output lineage, role catalog v3, retry generations (85 CLR1–CLR4)** | **Retained**; `sourceLineage` in transitions (IR5), catalog (IR1), `repeat` generations (IR3/IR6) |
| **Independent `review` (85 deferred as Context node)** | **Composes** via `call`/`map`/`select` + route-family independence; not a deferred leaf (IR4/IR8). Residual: durable independence enforcement + typed review artifact refine independence, not compilability |
| **Deterministic `verify` (85 deferred as Context node)** | **Composed** as the `gate` effect over the existing referee (IR4/IR8); Context `verify` stays inside the `context` payload |
| **Gate/review composition (issue 9)** | **Compiles**, not deferred (IR4/IR8) |
| **Richer Atlas AST/CST/symbol/SCIP/CPG branches (85 deferred)** | **Reached** through the `context` node's manifest branches; no new R4 rung (IR2/IR3) |
| **`parallel_attempts`/`review_revise`/`partition_review_integrate` (79)** | **Closed templates** (IR7) |
| **`context_recursive` (81)** | **Closed template** (IR7) |
| **`debate_synthesize` (79)** | **Catalogued**; compiles through same primitives; not re-advertised until cross-review independence durable |
| **Typed feedback/revision (79 WF5, 80 R80)** | **Preserved** (IR9) |
| **Recursive successor / bounded `repeat` / `child` (80, 85)** | **Preserved** as control nodes under deployment bounds (IR3/IR6/IR9) |
| **Convergence/no-progress (79 WF6, 80 R80.8, 81 CP6, 85 CLR4)** | **Unified** (IR6) |
| **Exact route + service-tier (88 RT, `docs/26` line 92)** | **Preserved** (IR9) |
| **Selective kill / interrupt (77 RR8/9, 91)** | **Preserved** (IR9/IR13) |
| **Restart / replay (90, 85 CLR6)** | **Preserved** and made position-exact by the program counter (IR5/IR9/IR13) |
| **Four-arm evaluation (`docs/29`, 81 CP10)** | **Preserved** as the earn-its-use gate (IR9/IR15) |
| **Recursive Run lineage, subtree stop/reap (77 RR)** | **Retained**; lifecycle authority under every effect (IR13) |
| **Semantic action authority (87 SA)** | **Retained**; effects compile through `run.act` (IR8) |
| **Durable Run control, streams, Episode facade (90/91/92)** | **Retained**; Program projects through it (IR12/IR13/IR14) |
| **Workspace modes (79) + snapshot/overlay (`capability-plane.md` §4)** | **Compiled** into one sandbox authority + revisioned state (IR10) |
| **Adaptive approval envelope (`docs/29` Stage E)** | **Retained**; templates carry the envelope; widening is a successor approval (IR7/IR15) |
| **Harness-internal opaque delegation (operator note)** | **Modeled as honest metadata/policy** on a `call`/Attempt, not a node; no implied verification (IR11) |
| **Identity unification (pure cells/calls/units)** | **One canonical Program identity**; v1 IDs remain replay handles (IR1) |
| **Policy reconciliation + ceiling derivation** | **Specified** with physical derivations (IR15) |
| **Homelab integration (excluded project-wide)** | **Excluded** |

## Build sequence

Each slice follows current-state audit → numbered contract → red tests → implementation →
adversarial review → focused/full validation → recursive Baton dogfood. A later label never removes
any contract from the full-system goal.

1. **93A — canonical IR core:** `baton.program` v2 normalizer/digest/identity; the control grammar
   (IR3) with `context` payload; the effect grammar shapes (IR4); v1→v2 compilation; closed-grammar
   red suite. Pure only; effects compile but do not dispatch.
2. **93B — durable runtime:** the IR5 program counter, state-revision schema, pure reducer, and
   effect-boundary replay; the IR6 state machine and termination algebra; restart red suite.
3. **93C — effect compilation:** IR8 wiring of `call`/`map`/`reduce`/`gate`/`notify`/`checkpoint`/
   `finish` through existing authority (zero new dispatch); `gate` over the referee; review
   composition; exact route + service-tier (IR9).
4. **93D — shared sandbox + delegation:** IR10 immutable base + overlays + revisioned state + fenced
   integrator; IR11 delegation metadata.
5. **93E — observability, policy, transport:** IR12 projection + no-auto-promotion; IR15 policy
   reconciliation + four-arm gate; IR14 transport parity.
6. **93F — live dogfood:** multi-harness `map → reduce`, selective `repeat` retry, `gate`, restart
   from a persisted transition, whole-Program stop/reap, honest delegation descriptor, zero
   ownership.

## Explicitly deferred (Phase 94 handoff)

- Executable arbitrary TypeScript/Python/shell/Starlark, ambient imports, callbacks, and persistent
  interpreter kernels (Stage C/D) — earned by measured benefit after replay/authority/cancellation/
  reap semantics are proved.
- `repeat`/`child` depth beyond the proven shape (needs the four-arm evaluation, IR9/IR15).
- Independent-review route-family *independence enforcement* and typed review artifact (refine
  review independence; composition already compiles).
- Shared writable multi-agent worktrees behind an enforced OS boundary or hub-mediated patch
  protocol.
- Automatic consensus, selection, integration, push, publication, or Cairn promotion.
- Richer R4+ representations (closed by Decision `phase24-js-ts-r3-ceiling` and Phase 27).
- Homelab integration, which is outside Baton.

Phase 94 consumes this closed IR for the first executable deeper-recursion or custom-authoring
vertical only after the corresponding authority above ships and is independently verified.

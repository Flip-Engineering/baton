# Phase 79 shared-knowledge and agent-experience audit

## Verdict

Baton has one credible, replayed, typed causal-knowledge substrate. It is not yet one coherent shared-knowledge product.

The strongest implementation is below the ordinary application boundary: a single coordination ledger materializes typed knowledge nodes and edges, bitemporal versions, selective promotion, pull-only recall, explicit contradictions, contamination, Atlas-derived `Representation` nodes, and recursive Run lineage. The weakest implementation is the boundary an agent actually sees. The progressive Run registry advertises `knowledge` and `capabilities` sections, but the section projector supplies neither; item evidence is currently the same Goal/Plan/approval tuple for every item; the direct client still asks callers to carry `depth`, `section`, and `item`; and recursive lineage is projected as a separate sanitized orchestration summary rather than connected to the shared causal graph.

The architectural correction is not another store, graph, MCP tool family, or omnibus RunView. Keep the append-only coordination ledger as source of truth and the existing knowledge maps as one materialized graph. Add typed projection adapters that attach Run, Goal/Plan, task, artifact, representation, recall, contradiction, and lineage facts to that graph, then expose bounded graph-backed chapters through the existing outline → index → section → item → evidence cascade. The ordinary client should offer small resource methods and opaque item handles; Baton should derive cursor, item, graph, evidence, action, lease, fence, Plan, result, and repository coordinates immediately before reads or effects.

Status: **capability substrate green; shared application surface red**. The requested change is an audit only; production code was not modified.

## Audit boundary and deployment truth

This review compares the pre-implementation design body with current source and focused executable contracts. The primary design anchors are:

- the three-tempo model and causal/temporal requirements in `docs/08-shared-memory-and-pm.md:5-15,19-31,54-137,154-165`;
- Cairn's typed, bitemporal, pull-only graph contract in `docs/capabilities/causal-research-bok.md:12-20,55-119,127-147,190-211`;
- the one-content-addressed, multi-representation substrate in `docs/15-representation-and-computation.md:17-48,50-75`;
- the progressive semantic application in `spec/phase67/progressive-agent-experience.md:25-65,67-98,126-156,170-188,213-252`;
- graph-backed Representation production in `spec/phase61/graph-backed-representations.md:105-164`;
- deployment-bound high-level methods in `spec/phase78-integrated-deployment-surface.md:97-125`; and
- recursive recipient authority and lineage in `spec/phase77-durable-recursive-run-authority.md:11-16,35-72,86-117,119-164`.

The requested deployment profile was `default@c6d3539da3be9c4a45cecfbccc683211281e9b67397fae82b8f0dac1b77ec20a`. The unified local Run application was probed through its shipped CLI. `node impl/scripts/baton.mjs help` advertised the ordinary `run`, `show`, `do`, `stop`, `export`, `doctor`, and help entry points. `node impl/scripts/baton.mjs doctor --depth evidence --check` returned `state: "needs_setup"`, `connection: "missing"`, `selector: "absent"`, and proposed `baton setup`. No Run was started: setup would write Git-common and user connection state outside the sole authorized path, and the profile could therefore not be authenticated or selected. This is exact route truth, not provider failure. No Baton worker, process, worktree, runtime, branch, export temporary root, lease, or Run was allocated, so there was no Baton cleanup action to perform.

## Capability accounting

| Concern | Design promise | Current implementation | Assessment |
|---|---|---|---|
| One source of truth | Operational ledger is authoritative; indices are replayable projections (`docs/08-shared-memory-and-pm.md:45-52`). | `CoordinationStore` folds nodes, edges, reads, assessments, contamination, representations, tasks, Runs, and lineage from one event stream; snapshot projection is centralized (`impl/src/coordination-store.mjs:481-485,5031`). | **Green.** Do not add a second knowledge database or Run-specific graph. |
| Typed causal graph | Closed node/edge/grounding vocabularies and provenance-integral Decisions/Findings (`docs/08-shared-memory-and-pm.md:19-25`; `docs/capabilities/causal-research-bok.md:55-99`). | Closed sets include `Run`, `Task`, `Artifact`, `Decision`, `Finding`, `Representation`, `ScratchFact`, etc. and `Informed`, `ProducedBy`, `VerifiedBy`, `DerivedFrom`, `Contradicts`, `Supersedes`, etc. (`impl/src/coordination-store.mjs:36-44`). Generic content is digested; lifecycle fields are reserved (`impl/src/coordination-store.mjs:6513-6522`). | **Green core, partial ontology.** Goal, Plan, approval, Run-lineage admission, recipient lease, recall receipt, contradiction decision, and cleanup receipt are events/projections but not consistently first-class graph types or edges. |
| Causal backbone | A Decision cites earlier concrete evidence and a live graph source (`docs/08-shared-memory-and-pm.md:21-25`). | Decision validation requires nonempty evidence and `informedBy`; evidence must be an earlier coordination event or existing artifact (`impl/src/coordination-store.mjs:6529-6556`). The audit independently checks earlier `Informed` lineage (`impl/src/coordination-store.mjs:7481-7498`). | **Green for generic Decisions.** Some operational facts bypass generic validation through bespoke fold paths; parity should be proven for every auto-materialized node family. |
| Temporal integrity | Event time and observation time remain distinct; future evidence and backfilled causality refuse (`docs/08-shared-memory-and-pm.md:23-24,74-84`). | Version history, `observedSeq`/`observedAt`, `eventTimeSeq`/`eventTime`, `validFrom`/`validTo`, and validity CAS exist. Future event evidence refuses (`impl/src/coordination-store.mjs:6529-6543`); queries pin observation and valid-time boundaries (`impl/src/coordination-store.mjs:7093-7123`). | **Mostly green.** Audit checks evidence order and intervals, but generic node validation does not require `eventTimeSeq` or prove wall-clock/event-sequence agreement for every family. The temporal contract is distributed across constructors and fold branches rather than one schema. |
| Supersession and contradiction | Preserve history, surface both sides, require explicit CAS resolution, contaminate prior readers (`docs/08-shared-memory-and-pm.md:74-84,124-129`). | Same-type live acyclic supersession and canonical unordered contradiction pairs are enforced (`impl/src/coordination-store.mjs:6560-6589`). Bounded listing returns both endpoints under an untrusted frame; resolution re-derives a pinned prefix, checks all validity versions, invalidates only the loser, and records affected reads (`impl/src/coordination-store.mjs:6925-7036`). | **Green core.** Contradiction is absent from the ordinary Run cascade, and there is no high-level workspace/decision method. Two older public store methods coexist with the newer bounded methods (`impl/src/coordination-store.mjs:7046-7090`), increasing semantic drift risk. |
| Selective promotion | Derive a closed candidate taxonomy from an audited prefix; caller cannot nominate facts (`docs/08-shared-memory-and-pm.md:95-113,154-157`). | Promotion scans a pinned prefix and derives operator/orchestrator Decisions, policy Counterexamples, and sufficiently cited observed Scratch Findings; it binds a closed policy, result digest, receipt, and reverify path (`impl/src/coordination-store.mjs:6592-6702`). | **Green for the declared Phase 49/50 subset.** `Skill` exists in the type enum but Skill/Playbook promotion is unimplemented; arbitrary Atlas or review results are not promoted by a common policy. |
| Recall and feedback | Pull-only, bounded, audited, bitemporal, untrusted, contradiction-complete, and receipted; later outcomes are association, not causation (`docs/08-shared-memory-and-pm.md:86-129,158-164`). | Recall validates filters and reader scope, pins `observedSeq`/`asOf`, uses deterministic lexical+graph scores, closes contradiction bundles, preflights bytes, appends a compact receipt before publication, and records `causationClaimed:false` assessments (`impl/src/coordination-store.mjs:7126-7287,7291-7389`). | **Green kernel, red application.** No `knowledge` section, `run.knowledge.recall(...)`, or advertised Run action exposes it. Retrieval is global lexical scanning plus bounded traversal, not a typed Run/task/artifact/representation neighborhood chosen through the Run handle. |
| Multi-tempo memory | Operational ledger, coordinative task/artifact layer, slow epistemic graph remain distinct (`docs/08-shared-memory-and-pm.md:5-15,33-52`). | Ledger, task DAG/artifact registry, Scratch, and knowledge graph are distinct projections in one store (`impl/src/coordination-store.mjs:5031`). | **Structurally green, operationally incomplete.** Retention/rotation/checkpoints are still open (`docs/08-shared-memory-and-pm.md:165`); Scratch Board/Bench and Skill/Playbook lifecycle remain outside this surface. No cascade labels freshness/tempo so agents cannot tell ephemeral coordination from durable knowledge. |
| Atlas → shared graph | One content-addressed multi-view substrate, selected by task phase (`docs/15-representation-and-computation.md:17-48`). | `representation.produce` fixes three mappings—R1 structural delta, R2 symbol snapshot, R3 CPG semantic delta—and records source/receipt artifacts plus `Representation`/`Source` nodes and causal edges in the existing knowledge maps (`impl/src/atlas-representation-producer.mjs:14-16,90-105,238-300`; `impl/src/coordination-store.mjs:3877-3919`). | **Green ingestion, red discovery.** Representations feed the same store, but there is no common graph query/navigation object or Run `knowledge`/`capabilities` projection. Semantic review performs a side lookup by representation identity (`impl/src/application.mjs:1622-1631`) rather than asking one evidence-neighborhood projection. |
| Run lineage | Child lineage precedes effects; parent/root/depth/ancestors/lease and subtree stop targets are server-derived (`spec/phase77-durable-recursive-run-authority.md:63-72,119-150`). | Admission checks global freshness, derives root/parent/depth/ancestors and three ceilings, and appends before Goal/Plan creation (`impl/src/coordination-store.mjs:899-952,1067-1108`; `impl/src/application.mjs:2010-2058`). Stop snapshots the selected Run and descendants at `throughSeq` (`impl/src/coordination-store.mjs:2992-3008`). | **Green authority, partial causal integration.** Lineage is durable and causal in the broad sense, but it is stored in `_runLineages`, not represented as `Run`→`Run` typed graph edges. Cross-run trace/recall therefore cannot traverse ancestry without a second API. |
| Recipient authority | Fixed `run.start|status|stop` attenuation, live session/parent fences, no bearer details in public projection (`spec/phase77-durable-recursive-run-authority.md:35-61,86-117,152-164`). | Fixed capabilities live in `impl/src/run-lineage.mjs:5-18`; every use rechecks lease/session/parent/task/stop state (`impl/src/coordination-store.mjs:881-896,1111-1135`). Sanitized view exposes only role/depth/counts/lease state/stop counts (`impl/src/coordination-store.mjs:4986-5028`). | **Green safety, amber semantics.** `recipientAuthority.state` becomes `active` if any lease is active and does not identify which advertised logical operations are effective for the current viewer. It is a topology summary, not an action-capability projection. |
| Progressive cascade | Every retained fact reachable through outline → index → section → item → evidence; callers need not understand coordinates (`spec/phase67/progressive-agent-experience.md:67-98,213-252`). | Registry defines 13 sections and five depths (`impl/src/application-semantics.mjs:19-67,284-303`). `run.inspect` emits expansion coordinates and bounded sections (`impl/src/application.mjs:3888-3980`). | **Red.** `knowledge` and `capabilities` have no projector entry (`impl/src/application.mjs:3690-3727`), so the index advertises empty chapters. Every item's evidence is only Goal/Plan/approval (`impl/src/application.mjs:3975-3980`), irrespective of item kind. Retained artifacts, representations, causal nodes/edges, lineage receipts, source anchors, verification artifacts, cleanup receipts, and contradiction state are not reachable through the promised cascade. |
| Pythonic/direct methods | Bound methods hide command choreography and coordinates (`spec/phase67/progressive-agent-experience.md:47-55`; `spec/phase78-integrated-deployment-surface.md:97-111`). | `BatonRun` hides action IDs when given an action kind, derives advertised action descriptors, and offers `approve`, `adopt`, `review`, `apply`, `export`, `drive`, and `complete` (`impl/src/application-client.mjs:62-214`). | **Partial.** `inspect` still accepts raw `depth/section/item/cursor/waitMs`; there are no `outline()`, `index()`, `section()`, `items()`, `item()`, `evidence()`, `knowledge()`, `children()`, or `contradictions()` resources (`impl/src/application-client.mjs:80-140`). `answer(requestId, ...)` and `steer(target, ...)` retain caller coordinates instead of exclusively lowering through advertised actions (`impl/src/application-client.mjs:240-261`). |

## Priority capability gaps

### P0 — The evidence cascade is not truthful

The decisive defect is not cosmetic. AX2 defines evidence as item-specific manifests, source anchors, receipts, and ledger provenance (`spec/phase67/progressive-agent-experience.md:73-98`). Current code returns the same Goal, Plan, and approval digests for a Plan node, route summary, verification summary, semantic review, result, cleanup summary, or orchestration summary (`impl/src/application.mjs:3975-3980`). That response proves only that the Run had planning authority; it does not support the selected item's claim.

Consequences:

1. an agent cannot distinguish display metadata from evidence;
2. contradiction and contamination cannot be discovered from the Run that consumed the knowledge;
3. Atlas representations are technically in the graph but invisible from the task/result that they describe;
4. cleanup evidence cannot show exact stop/reap truth; and
5. AX9's “every retained fact remains reachable” acceptance claim is not met.

Required correction: make each item carry an internal typed owner reference, then derive an evidence bundle by owner kind. The public item ID stays opaque. The evidence read must re-resolve the owner at the requested cursor and emit only bounded references: coordination event IDs/digests, artifact IDs/digests, graph node/edge IDs and validity versions, source anchors, manifest digests, lineage admission/stop receipt digests, and explicit omissions/truncation/frontier. Never copy raw artifact or graph bodies into the envelope by default.

### P0 — Advertised knowledge and capability chapters are empty

The registry makes `knowledge` and `capabilities` ordinary sections (`impl/src/application-semantics.mjs:53-67`), but `_semanticSectionItems` has no cases for either (`impl/src/application.mjs:3690-3727`). The index nevertheless marks all definitions `authorized: true` and computes `empty` from missing items (`impl/src/application.mjs:3936-3949`). This is misleading discovery: “empty” conflates “no facts”, “not implemented”, “not configured”, “not authorized”, and “truncated/refused”.

Required correction: each section projector returns a typed availability state (`available`, `empty`, `not_configured`, `unauthorized`, `unsupported`, `temporarily_unavailable`) and a bounded count derived at one observation boundary. `knowledge` should project Run/task/artifact/representation/recall/contradiction summaries from the shared graph. `capabilities` should project ACI invocations and results already causally attached to tasks/artifacts. Do not expose a raw capability registry dump.

### P1 — One graph exists physically, but important causal families remain side tables

Tasks, artifacts, scorecards, reuse decisions, and representations materialize knowledge nodes. Recursive lineage, Goal/Plan/approval, recall receipts, contradiction-resolution Decisions, recovery attempts, semantic review, integration, export, and cleanup remain primarily bespoke maps/events. That is acceptable for command authority, but not for a “shared causal graph” claim: `traceKnowledgeBounded` only walks graph edges (`impl/src/coordination-store.mjs:7444-7470`), so it cannot answer “which child Run inherited this recalled Finding and produced this Representation before this accepted result?” without joining several private APIs in application code.

Required correction: add deterministic, replay-derived graph projections—not new writes controlled by callers—for the missing families. Suggested edges:

- `Run Contains Goal`, `Goal Refines Goal`, `Goal Informed Plan`, `Plan Contains Task`;
- parent `Run Contains child Run` plus child `DerivedFrom` lineage admission;
- `Task ProducedBy Run`, `Artifact ProducedBy Task`, `Representation DerivedFrom Source|Artifact`, `Representation ObservedIn Task`;
- `knowledge.recall ReadBy Task|Run`, with recalled nodes linked by `ReadBy` edges or a typed `Recall` node if the ontology is deliberately extended;
- contradiction-resolution Decision `Informed` by both endpoints and resolution receipt, with the loser invalidated rather than erased;
- accepted result `VerifiedBy` verification artifact/task and `Informed` by semantic review/adoption Decisions; and
- stop/cleanup Finding `ProducedBy Run` and grounded by the exact stop receipt.

Command-specific maps remain the authority for effects. The graph is a replayed explanatory projection, never the source for permission.

### P1 — Temporal semantics are strong but not schema-uniform

Generic graph validation reserves derived lifecycle fields and rejects future evidence, but `eventTimeSeq` is optional on generic requests and many auto-materialized families construct time through bespoke branches. The audit later detects some errors, yet the design promised write-time enforcement rather than post-hoc lint (`docs/capabilities/causal-research-bok.md:16-20`).

Required correction: define one internal `TemporalCoordinate` constructor for every node/edge family:

```text
observed = { seq, at }       # append that first made this version visible
event = { seq, at }          # causal source event, <= observed.seq
valid = { from, to? }        # domain validity, half-open interval
version = { number, prior? } # CAS/history lineage
```

Derive it from event/evidence references; do not accept lifecycle coordinates northbound. Replay must reconstruct it byte-for-byte. Audit remains defense in depth, not the first place a missing temporal coordinate is noticed.

### P1 — Recipient authority is safe but not agent-legible

The store correctly attenuates recursive recipients to `run.start`, `run.status`, and `run.stop` and rechecks session, task owner, expiry, revocation, and subtree scope. The ordinary orchestration projection exposes aggregate lease state but does not tell the current principal which semantic operations are effective or why an operation is unavailable. `recipientAuthority.state: active` means at least one lease on the Run is active, not necessarily that this viewer owns it (`impl/src/coordination-store.mjs:4994-5015`).

Required correction: keep lease identity private, but project viewer-relative authority from the application authorization result:

```json
{
  "role": "recipient",
  "operations": {"start_child": "available", "inspect_descendant": "available", "stop_subtree": "available"},
  "limits": {"depthRemaining": 2, "childrenRemaining": 6, "descendantsRemaining": 25},
  "expires": "bounded_relative_duration",
  "reason": null
}
```

Do not expose absolute parent task, worker, session, lease, digest, repository path, or credential coordinates. On an inactive historical lease, return a typed refusal; never downgrade to ordinary authority, matching `spec/phase77-durable-recursive-run-authority.md:98-117`.

### P1 — Recall has no Run-native entry or typed neighborhood

The recall kernel is appropriately pull-only and auditable, but its only conceptual input is text plus low-level filters/seeds and reader coordinates. A Run agent should not need to know graph node IDs or task IDs to ask for relevant knowledge. Conversely, auto-injection remains forbidden.

Required correction: expose recall as an advertised read action/resource on a bound Run or section. The caller provides semantic intent (`text`, optional type/grounding, result limit); the server derives repository, Run/task reader, observed prefix, valid time, seed nodes (Run, Plan node, current task, accepted artifacts, current representations), policy, audit gate, and receipt authority. Return an opaque `RecallReceipt` resource with `items()`, `contradictions()`, `trace(item)`, and `assessment()` methods.

### P2 — Promotion breadth and outcome learning remain intentionally narrow

The current closed taxonomy is honest. Missing work includes Skill/Playbook promotion, versioned recall weighting, retention/compaction, and any generalized task-class Finding. These must remain behind explicit policies. In particular, `verified_pass_after_recall` is an association and must not mutate confidence, routing, validity, or promotion state (`impl/src/coordination-store.mjs:7291-7335`). Do not “close” this gap by letting models nominate memories or self-rate helpfulness.

### P2 — Representation depth is bounded and should stay visibly honest

Atlas correctly maps only structural delta, symbol snapshot, and bounded CPG semantic delta into graph-backed Representations. It does not implement whole-repository CPG, live LSP, SSA/PDG, alias/heap reasoning, compiler IR, true semantic equivalence/merge, or e-graph proof (`spec/phase61/graph-backed-representations.md:155-164`). The shared graph should expose rung, source contract, environment identity digest, grounding, completeness, frontier, and reverify status. It must never flatten all Atlas outputs into an undifferentiated “semantic graph” or imply that derived evidence is proof.

## One shared graph without a spaghettified control surface

The clean boundary is four layers, all already compatible with Baton's direction:

1. **Ledger authority** — append-only events, idempotency, replay, writer ownership. It remains the sole durable mutation spine.
2. **Domain authority** — Goal/Plan, task/artifact, Run lineage, recipient leases, verification, review, result, stop/reap, Scratch, and capability-specific maps. These remain the effect and CAS authorities.
3. **Shared causal projection** — deterministic typed nodes/edges and bitemporal versions derived from layers 1–2. Atlas produces `Representation` nodes here through the existing producer transaction. No graph row grants worker, merge, review, integration, publication, or recursive authority.
4. **Progressive application projection** — bounded chapters and opaque resources over the graph/domain authorities. It owns discovery and coordinates; it does not own a second state machine.

The anti-patterns to reject are:

- one RunView that embeds the full graph, every artifact, every representation, and all receipts;
- one MCP tool per node/edge/Atlas type;
- caller-authored generic graph mutations on the ordinary surface;
- a `knowledge` action switch that directly invokes Coordinator internals;
- copying Atlas bodies into Cairn nodes instead of referencing content-addressed artifacts;
- using graph connectivity as authorization; and
- making the browser, CLI, Python client, or MCP host reproduce evidence/adoption/recall choreography.

The application needs a projector registry, not more commands. Each section plugin should implement a closed interface such as:

```python
class RunSectionProjector(Protocol):
    id: Literal["plan", "execution", "orchestration", "knowledge", ...]

    def summarize(self, ctx: AuthorizedRunSnapshot) -> SectionSummary: ...
    def items(self, ctx: AuthorizedRunSnapshot, page: PagePolicy) -> Page[ItemRef]: ...
    def detail(self, ctx: AuthorizedRunSnapshot, ref: ItemRef) -> ItemDetail: ...
    def evidence(self, ctx: AuthorizedRunSnapshot, ref: ItemRef) -> EvidenceBundle: ...
    def actions(self, ctx: AuthorizedRunSnapshot, ref: ItemRef | None) -> list[Action]: ...
```

`AuthorizedRunSnapshot` pins repository, principal scope, Run, cursor, view digest, observation time, profile/registry/policy digests, and byte/row bounds. Public callers never construct it. `ItemRef` is an internal tagged union; its public handle is opaque and freshness-bound. This replaces the current central `_semanticSectionItems` switch without distributing authority.

## Proposed Pythonic high-level API

The direct API should feel resource-oriented and should derive coordinates server-side. The following is illustrative naming, not a requirement to rewrite the JavaScript implementation in Python:

```python
baton = open_baton()  # repository, profile, roots, credentials and bounds are deployment-derived

run = await baton.runs.start(
    "Audit shared causal knowledge",
    profile="default",
    route=Route("codex", "gpt-5.6-sol", effort="high"),
)

outline = await run.outline()
for chapter in await run.index():
    print(chapter.name, chapter.state, chapter.count)

knowledge = run.section("knowledge")
async for item in knowledge.items(types={"Finding", "Decision", "Representation"}):
    detail = await item.detail()
    evidence = await item.evidence()
    trace = await item.trace(depth=2)

receipt = await knowledge.recall("prior failures in recursive cleanup", limit=8)
for conflict in await receipt.contradictions():
    left, right = await conflict.sides()
    # Resolution remains an explicit advertised operator action.
    await conflict.resolve(winner=left, reason="Fresh exact reap evidence supersedes the older claim")

async for child in run.children(recursive=True):
    print((await child.outline()).phase)

await run.approve()                   # current advertised Plan action; Plan digest server-derived
await run.answer(approval, "allow")  # approval is an opaque item handle, not a request ID
await run.stop("Audit complete")      # subtree/fences/workers server-derived
```

Recommended logical methods and lowering:

| Method | Caller supplies | Server derives |
|---|---|---|
| `run.outline()` | nothing | principal, Run, current cursor/view, policy, actions |
| `run.index()` | nothing | authorized section registry and counts at one snapshot |
| `run.section(name)` | semantic section name | depth, selector binding, cursor, bounds |
| `section.items(**filters)` | semantic filters only | item IDs, page cursor, observation boundary, authorization |
| `item.detail()` | opaque bound item handle | Run/section/item coordinates and freshness |
| `item.evidence()` | optional evidence depth/bounds | manifests, event/artifact/graph refs, source anchors, omission frontier |
| `item.trace(depth=...)` | bounded semantic depth | node seeds, graph observation/valid time, row/evidence ceilings |
| `knowledge.recall(text, ...)` | query and narrow semantic filters | reader task/Run, seeds, prefix, `asOf`, audit/policy, receipt ID |
| `conflict.resolve(winner, reason)` | one displayed side and reason | edge/endpoints/validity versions, affected readers, CAS prefix |
| `run.children(recursive=False)` | topology intent | parent/root/lineage/lease/subtree scope |
| `run.approve()/adopt()/apply()/export()` | only semantic choices/reason | advertised action ID plus Plan/result/evidence/export coordinates |
| `run.answer(item, answer)` | opaque attention item and answer | request/worker/fence and exact action kind |
| `run.stop(reason)` | reason | descendant/task/worker snapshot, fences, stop/reap receipt |

Handles are conveniences, not capabilities. Every method reauthorizes and re-resolves current state. Cached handles must fail with a typed stale/scope error and a link to a fresh outline; they must never silently retarget a newer item.

## Dependency order

1. **Define the graph/view contracts.** Close internal node/edge mappings for Run lineage, Goal/Plan, recall, contradiction resolution, result/review, and cleanup. Define `TemporalCoordinate`, internal `ItemRef`, `EvidenceBundle`, availability states, and opaque continuation binding. No northbound work first.
2. **Unify replay-derived graph projections.** Materialize the missing causal families from existing durable events/maps. Prove append/replay/tamper/idempotency invariants and that graph projection grants zero command authority.
3. **Build the projector registry.** Replace the monolithic section switch with registered plan/execution/orchestration/attention/route/budget/verification/review/result/delivery/cleanup/knowledge/capabilities projectors sharing one authorized snapshot.
4. **Make evidence item-specific.** Implement evidence adapters for each item kind, including explicit frontier/truncation and content-addressed refs. This is the prerequisite for trustworthy knowledge, capability, result, and cleanup chapters.
5. **Ship knowledge and capability sections.** Start read-only: summaries, items, detail, evidence, trace, representations, recalls, contradictions, and assessments. Add no generic mutation.
6. **Add viewer-relative recipient authority.** Derive effective logical operations and remaining ceilings without revealing private lease/session coordinates. Connect child Run navigation to graph-backed lineage.
7. **Raise the direct client.** Add resource methods and opaque handles; make raw `inspect(depth, section, item)` an advanced/compatibility escape hatch. Lower answers, review choices, contradiction resolution, recall, and other actions only through advertised descriptors.
8. **Project parity outward.** Bind CLI, Web, MCP, and browser to the same registry/projectors. Keep default MCP compact; do not add one tool per chapter or graph operation.
9. **Only then expand promotion/retention.** Skill/Playbook promotion, learned recall weighting, retention/compaction, deeper representations, and generic export each need separate policies and acceptance gates.

## Acceptance criteria

1. One durable event prefix reconstructs byte-identical domain state and shared graph state, including Run ancestry, representations, recalls, contradiction resolutions, result/review lineage, and cleanup evidence.
2. Every graph node/edge version has server-derived observation, event, valid-time, and version coordinates; future evidence, backdating, invalid intervals, missing endpoints, and version substitution refuse before append.
3. Every live Decision has earlier evidence and an `Informed` source; every verified Finding/result has a valid `ProducedBy`, `VerifiedBy`, or `DerivedFrom` path to exact durable evidence.
4. `Contradicts` always has one canonical live pair, recall returns both sides, automatic resolution is impossible, explicit CAS resolution preserves the winner/history and records all bounded earlier readers of the loser as contaminated.
5. Promotion candidates are entirely server-derived from an audited prefix and a versioned closed policy. Caller nomination, raw Scratch value copying, worker self-rating, and pass-after-recall causal claims remain impossible.
6. Recall is explicit, audit-gated, bitemporal, bounded, append-before-return, untrusted-framed, contradiction-complete, and attributable to an exact Run or task without caller-supplied reader coordinates.
7. Atlas R1/R2/R3 outputs appear as `Representation` items in the same graph and Run knowledge chapter with rung, grounding, completeness/frontier, source/receipt artifact refs, environment identity digest, and reverify state. No representation claims stronger semantics than its source contract.
8. The Run index distinguishes `empty`, `unsupported`, `not_configured`, `unauthorized`, and `temporarily_unavailable`. It never marks a missing projector as authorized empty content.
9. Every nonempty section item reaches item-specific evidence. A verification item reaches verification artifacts/events; a representation reaches source/receipt artifacts; a contradiction reaches both endpoint evidence sets; orchestration reaches lineage/stop receipts; cleanup reaches exact process/reap truth.
10. Evidence responses identify omissions and frontier under byte/row ceilings. They never substitute Goal/Plan digests for unavailable item evidence.
11. Direct high-level callers can traverse outline → index → named section → items → evidence and perform all ordinary actions without supplying `depth`, cursor, item ID, Plan/evidence digest, task/worker/fence, lease, ancestry, validity version, or repository coordinate.
12. Cached handles are not authority. Cross-Run/repository/principal, stale cursor/view/policy/Plan/result/fence/validity, stopped, expired, or revoked use fails closed before read disclosure or effect.
13. Recipient views are viewer-relative and expose only semantic operations, sanitized topology, remaining ceilings, and closed reason categories. Historical inactive authority never downgrades to ordinary access.
14. Stop snapshots and reaps exactly the selected Run subtree, returns only with zero remaining snapped processes, leaves unrelated Runs live, and makes the exact receipt reachable through cleanup evidence.
15. Direct, CLI, authenticated Web, default MCP, and browser produce the same registry, view, item, evidence, action, graph projection, and receipt digests for equivalent calls. The default inventory remains the five ordinary application tools.
16. No new external project-manager, homelab, graph-server, or vector-store runtime is required. No browser/CLI/MCP-specific action or evidence choreography exists.
17. Retention or compaction, when later implemented, preserves prefix checkpoints, graph/history validity, recall receipts, contamination, lineage, and audit reproducibility; pruning cannot silently erase evidence behind a live claim.
18. Recursive dogfood completes through the unified Run application and advertised actions, records requested/resolved/observed route identity, preserves exact result and cleanup truth, and leaves zero owned process/worktree/runtime/branch/capacity/lease/export-temporary residue.

## Red-test recommendations

### Graph and time

- Reject every node/edge family with `event.seq > observed.seq`, event time after observation time, invalid half-open validity interval, future evidence, missing artifact, missing endpoint, or replay-derived time drift.
- Inject a valid generic Decision payload with no `eventTimeSeq`; require the unified constructor to derive it or refuse, never store a temporally ambiguous row.
- Tamper each auto-materialized family independently—task, artifact, scorecard, reuse, representation, lineage, recall, contradiction resolution, review/result, cleanup—and require replay integrity failure rather than repair.
- Generate supersession chains and cycles, equal-time boundaries, concurrent expected versions, and an endpoint with an unresolved contradiction; prove exactly one legal transition and exact contamination.
- Prove graph projection append failure cannot expose a domain effect without its explanatory projection when the contract requires atomicity; where projection is rebuild-only, prove restart deterministically heals without a second external effect.

### Recall, promotion, and contradiction

- Attempt recall with caller-supplied task/Run/worker IDs through every ordinary transport; require server derivation or closed rejection.
- Try raw-query retention, snippet retention, automatic context injection, worker self-rating, pass-after-recall confidence mutation, route mutation, and promotion nomination; all must fail or be absent.
- Seed recall with a contradicted endpoint at `limit == 1`; require an explicit bounded contradiction-bundle refusal, never one-sided output.
- Resolve a contradiction after any endpoint/edge/read prefix changes; stale CAS must refuse and list/recall must remain unchanged.
- Resolve through an opaque conflict handle after another principal refreshes it; require cross-principal scope failure.
- Promote at every policy max and max+1; inject a post-prefix eligible event and prove it cannot leak into the pinned batch.

### Atlas and one-graph integration

- Produce R1, R2, and R3 for one task, then traverse only `run.section("knowledge")` to each Representation's detail, source artifact, receipt artifact, task, Run, and evidence frontier.
- Substitute rung, producer kind, source card, environment/tree/overlay/index identity, source artifact, receipt, graph digest, or task/Run membership; require typed refusal with no second graph.
- Verify semantic review cannot accept a representation that is graph-valid but belongs to a different Run/result tree.
- Prove a Representation is recallable and traceable without copying its artifact body into a node or RunView.
- Assert honest absence for R4/whole-repo/SSA/PDG/equivalence claims and distinguish `unsupported` from empty.

### Progressive cascade

- For every registry section, require a registered projector or an explicit `unsupported/not_configured` state; fail tests if `_semanticSectionItems` silently returns `[]` for a declared shipped section.
- Build one fixture item of every kind and assert its evidence digest differs when its authoritative evidence differs. Specifically fail the current Goal/Plan/approval-only fallback.
- Traverse the entire cascade using only expansion/opaque handles. Reject arbitrary property paths, guessed item IDs, selector reuse across sections, cursor reuse across principals/Runs, and item IDs from a later cursor.
- Enforce stable IDs for durable items. Attention/summary IDs that merely include the current cursor (`impl/src/application.mjs:3707-3709,3728-3730`) must either become explicit ephemeral handles or remain stable across irrelevant Run changes.
- At each byte/row max and max+1, require honest `truncated`, continuation, and frontier behavior without dropping the selected item's core identity.
- Mark a section unauthorized and ensure the index neither leaks its existence/count nor reports `authorized: true` unconditionally.

### High-level methods and authority

- Complete start, inspect, approval, attention answer, recall, representation inspection, review, adoption, export/integration, and stop through bound methods while asserting that the client never submits Plan/evidence/task/worker/fence/lease/ancestry/validity coordinates.
- Monkey-patch the compatibility command methods to fail and prove the high-level cascade uses only registry actions and progressive reads.
- Reuse every opaque handle after Plan, policy, result, fence, contradiction version, session, recipient lease, and stop changes; require fresh reauthorization and no retargeting.
- With two active recipient leases on one Run, show that aggregate authority remains an operator summary while each viewer receives only its own effective semantic operations.
- Exercise parent, ancestor, sibling, unrelated repository, expired, revoked, reassigned-parent, and stopped-subtree targets through direct/Web/MCP; require the same typed refusal and no downgrade.

### Result and cleanup truth

- At evidence depth, require route requested/resolved/observed tuple, verification command result, accepted/adopted/reviewed/integrated/exported result digests, and stop/reap receipt to remain distinct.
- Inject kill request success with one unconfirmed process; cleanup must remain incomplete and no “stopped/clean” evidence item may appear.
- Lose the response after stop admission and after physical reap; exact retry must return the same target and receipt digests without another unrelated kill.
- Run sibling and descendant work concurrently; subtree stop must close the snapped descendants only and evidence must show `throughSeq`, target counts, zero remaining workers, and unrelated sibling survival without exposing private worker IDs at ordinary depth.

## Verification record

The sole definition-of-done command for this review is exactly:

```text
node
```

Expected exit code: `0`. Final execution result: exit code `0`. No broader suite result is claimed by this review.

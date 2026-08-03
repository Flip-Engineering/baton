# Bidirectional v3 epic contract — the collaboration spine (v2.0, post-red-team fold)

(Red-teamed by baton wave: `redteam-authority.md` (codex — 8 CONFIRMED-HOLEs) and
`redteam-lifecycle.md` (glm — 5 CONFIRMED-HOLEs, 2 NEEDS-AMENDMENTs, 1 doc-honesty meta).
The v0.9 shapes did not survive contact; every hole folds to a named amendment below.
v0.9/v1.0/v1.1 sections preserved after this fold for traceability.)

## v2.0 decisions (folded from both reports)

### BD3-A — the read port, with a REAL horizon predicate (codex #1/#2/#8, glm #4)

- **Horizon membership is server-derived and precise:** `runHorizon(runId)` = the closure
  of {the run's own KG nodes, nodes promoted under that runId, findings whose evidence
  cites the run's task/elevation events, and the project-tier nodes the ambient-serving
  slice already serves for that run's briefs}. Every query kind (knowledge/board/
  scratchpad/finding) intersects its results with this predicate AFTER lookup, server-side.
  "The run's horizons" is never a whole-KG projection (codex #1: task/workflow horizons
  today project the whole graph).
- **finding-by-id is resolve-then-authorize:** the id resolves first, then the resolved
  node is authorized against the same horizon predicate; possession of a digest is never
  authority (codex #2: the existing ID query is global).
- **Board reads reuse the S-2 board→run binding check** (its refusal precedence normative).
- **Scratchpad reads: the coordinator constructs `(runId, ['shared'])` server-side; the
  wire query carries NO runId/scope fields at all.**
- **Read evidence gets its own class with ZERO promotion weight (codex #8 + glm #4):**
  `context.read` audit events (bounded, content-digested) — NOT the `scratch.read` family,
  and `minScratchReaders` never counts them. The existing gate's self-read hole is fixed
  in the same rung: a fact's author task never counts toward `minScratchReaders`
  (coordination-store.mjs:14370-14384 — at minScratchReaders===1 a worker can currently
  self-promote; that is a pre-existing hole this rung closes).
- **One closed response renderer at the admission seam (codex #3):** every answer
  serializes through one renderer (bounded per kind, wrapProse UNTRUSTED framing on every
  model-authored leaf, digest citations for oversize); an unframed leaf is rejected before
  provider delivery — mandatory at the seam, never documentation.
- **Reads are not TG2 progress (pinned):** CONTEXT_READ receipts never answer the TG3
  steering cycle (the farm-guard stays).

### BD3-B — context packs with a server-owned supersession chain (codex #4, glm #5)

- **Chain, not field:** packs carry `predecessor` + `validityVersion`; the store maintains
  the head per pack family; supersession mints a new version (old versions are content
  history, retained).
- **Spawn/nudge CAS:** a brief or nudge citing a pack digest requires it to be the LIVE
  HEAD at materialization time — a stale citation fails with `context_pack_stale` at
  spawn (never silently serves the old version).
- **Expiry is distinct from supersession (glm #5):** a pack past its validity window
  stops serving (`context_pack_expired`) without being superseded; a sweep reaps
  expired packs (they stop serving, history retained). No expired-but-current pack ever
  serves.

### BD3-C — the message lane with provable replies and honest receipts (codex #5, glm #6)

- **Minted message IDs + inReplyTo:** orchestrator sends mint `message:<digest>` ids.
  Worker frames carry ONLY `{inReplyTo, body}` — the sole target is derived from the
  parent message, never caller-named. Reply depth 1 in v1 (no reply-to-reply).
- **Receipt state machine (glm #6):** `delivered` = written to the worker's durable
  stream (NOT an acknowledgment); `read` = the worker's first `turn_started` after
  delivery; `acted-on` is never claimed. Receipts are process-scoped honestly: a worker
  that dies between delivered and read leaves `delivered` with no read — the receipt
  says exactly that, forever, and never upgrades to a lie.

### BD3-D — the attention inbox, scope-first and honest about the driver (codex #6/#7, glm #1/#2/#3)

- **Scope before targets (codex #6):** the caller's parent scope (run/wave/deployment)
  is authorized FIRST; targets are then normalized and derived server-side; a
  scope-violating target refuses with the constant scope refusal BEFORE any existence
  check (no existence leak either direction).
- **candidacy_review requires the review authority (codex #7):** the wake reason is
  emitted only to a viewer holding a live settlement/review lease (or the orchestrator
  principal), with the count derived inside that lease's run/wave.
- **The driver's stall machinery is explicitly NOT replaced (glm #1):** the claim-on-
  stall fan-out fires on ABSENCE of wake events, so "the driver becomes one consumer of
  the inbox with no behavior change" was false. v1: the inbox is additive for
  orchestrators (embedded + MCP long-poll); the wave driver keeps its own stall clock
  and MAY consume the inbox for decision/attention wakes as a later rung (named v1.1).
- **Coalescing carries distribution (glm #3):** storm coalescing emits
  `{reason, count, perPhase: {phase: count}, windowMs}` — never a singular {role, phase}
  that a phase-trusting consumer would misread.
- **Detach honesty (glm #2):** wake reasons carry runId + mint epoch; reasons minted
  after a member's terminal transition are marked `memberState: terminal-at-mint`;
  transient follow failures downgrade with a durable receipt (BD-B law), never silently.
- **Doc-honesty (glm meta):** followOnce/throughCursor/downgrade law lives in
  wave-driver.mjs / wave.mjs / application-client.mjs (anchors corrected; throughCursor
  is minted server-side).

---

## v0.9/v1.0/v1.1 (preserved below for traceability)

(v1.0 fold: downstream worker feedback (docs/reference/evidence/mcp-packaging-2026-08-02/
feedback-worker.md, feedback-frontier.md — glm 390 lines, deepseek 145 lines) reviewed the
post-#62/#63/#64 integrated experience and converged with the orchestrator-side evaluation.
Their findings sharpen this epic's scope verbatim; the v0.9 seed follows.)

**Worker-validated priorities:**
1. **BD3-A is the #1 leverage item on the board** ("I re-derive the entire world on every
   task... If I could read admitted Findings scoped to my pathScope, I would stop
   re-discovering settled ground and start building on it. Highest value by a wide margin").
   Ship order within BD3-A: (a) KG Findings read first, (b) shared-partition sibling reads,
   (c) candidacy board reads (the habit-loop closer: "your note became finding X").
2. **BD3-C absorbs the delivery push** (their runner-up, #79): attention items addressed
   to a worker (scratchpad_write_failed, the sanitized gate verdict) must be PUSHED to its
   own next-turn context — "the signal is recorded; the worker is not pushed it" is the
   shared root of two gaps. One delivery fix closes both.
3. **The frontier synthesis:** boards' worker half (board.claim/report, #78) is the
   shared-task-list + handoff substrate #74 needs; and a driver-minted REPL binding
   carrying the candidate set for the next downstream run is REPL's load-bearing use
   (#69 comment) — BD3-B's context-pack mint rides exactly that shape.
4. **TG3's window refinement** (#80, cycle-latency, noted as a boundary condition for
   BD3-D's wake semantics): a slow next-turn start must not expire a healthy cycle.
5. **Candidacy review in-band:** knowledge.candidatesAwaitingAdmission should ride the
   orchestrator's attention stream (BD3-D's candidacy_review wake reason) — promotion as
   a step of an existing review, not a ritual to remember.

**The campaign control law (operator, 2026-08-03 — binding on this epic and every later
one):** controls on agent work must be EVAL-ABLE (validated goals: DoD, verification,
referee, content gates that verify content, not counts), CONSTRUCTIVE (tool surfaces:
capability scoping by construction, #32 — never police mid-flight), or CONVERSATIONAL
(bidirectional feedback: steering, decisions, attention, reads — this epic). Arbitrary
turn-limits and time windows are the wrong class: they handicap work that has its own
rhythm. Liveness and progress are judged from the event vocabulary (provider activity,
receipt classes, process lifecycle) with COUNT-based bounds only on unanswered steering
cycles; any clock is a deployment-class last resort for total silence, never the primary
signal. Resource circuit-breakers (token/usd/turn budgets) are a distinct, legitimate
class — they bound spend, not progress.

---

## The agent-to-agent layers matrix (v1.1, 2026-08-03 — handling / gating / directionality / completeness)

The gating story is uniform and proven: hub admission with identity bound by the
authenticated stream (never caller-named), closed shapes, typed refusals, content
digests for idempotency, wrapProse/UNTRUSTED framing for anything crossing INTO an
agent's context, viewer-scope re-derived for reads (never caller-named), authority
tiers worker < orchestrator < operator/policy. The directionality law that emerges:
**up is receipt-heavy** (everything the system learns from agents is evidence), **down
is framing-heavy** (everything agents consume is wrapped as data, never instruction),
**lateral is mediated** (orchestrator-visible, never free).

| Layer | Handling | Gating | Direction | Completeness |
|---|---|---|---|---|
| Scratchpad writes | wire line → hub admission, worker identity stream-bound | closed kinds, typed refusals, #62 visibility | up only | **A−** (write side complete; reads are BD3-A) |
| Shared partition | orchestrator-curated elevation + settle reap | steering binding required, dispositions receipted | worker → orchestrator → shared | **B−** (workflow-common workers can't read it — BD3-A) |
| Decision requests | one-pending admission, deadlineAt, onDecision once-per-record | optionIds/free-text validated, already_resolved typed | up + answer down | **A** (proven live; MCP semantics in flight) |
| Steering (send/nudge/steer) | run lanes, provenance-marked post-TG3 | policy/driver actors, bounded text | down only | **B+** (steering complete; no typed inform/query, no receipts — BD3-C) |
| Attention | kinds + progressClass + requiredAction | server-derived, sanitized | system → orchestrator | **B** (orchestration-complete; not pushed to workers #79; no unified wake #71/BD3-D) |
| Boards (S-2) | sessionAuthority envelope, CAS in the append | proof-of-principal, fence CAS | orchestrator/system | **C+** (orchestrator half real; worker claim/report ghost #78) |
| KG | ambient serving push, admission via orchestrator gate | promotionActor + session-bound lease | system → workers (push); workers → system (candidacy) | **C** (no worker pull #68/BD3-A; habit loop open #70) |
| REPL objects | manifest/binding/cite, durable cells | settled-only resolution, worker-scoped | worker holds; cite readers | **D+** (~30%; no orchestrator→worker object passing #69/BD3-B) |
| Typed message lane | — | — | — | **absent** (BD3-C: steering/decisions are two special cases, no general envelope with receipts) |
| Context packs | — | — | — | **absent** (BD3-B: context moves as prompt text today) |
| Orientation (code understanding) | ATLAS/cartographer/context program | gate-private or session-ritual | none to agents | **F for agents** (machinery exists, surface does not — orientation epic seed) |
| Worker ↔ worker | shared-scratchpad relay (orchestrator-mediated) | orchestrator reads + relays | lateral, mediated, write-only-push | **D** (designed home is board.claim/report, #78) |

**What the matrix says about #74:** the swarm pattern needs (1) BD3-A reads (coordinator
+ swarm-mates read each other's elevated work), (2) BD3-B packs (decomposition as
citable objects, not prose), (3) BD3-C receipts (coordinator knows what landed), and
(4) board.claim/report for the claim/report triage loop (#78). Until those exist, a
coordinator-worker is exactly as connected as the orchestrator remembers to connect it —
the frontier review's sentence, and the reason this epic precedes the pattern.

---

# Bidirectional v3 epic contract — the collaboration spine (v0.9, pre-red-team)

(Seed: operator sequencing 2026-08-02 — "bidirectional layers and flows need to be solidly
established including real-time messaging and context-sharing and unidirectional steering
and orchestration and notification before the proposed dynamic workflow will work well."
The worker-orchestrated swarm pattern (#74) rides this epic; it does not precede it.
Integration evaluation (2026-08-02): the up-channel (worker → orchestrator) is the system's
strongest direction; the down-channel is the weakest. Workers are knowledge-poor in a
knowledge-rich system (#68); the REPL/context-object vision is ~20% realized (#69); the
orchestrator polls instead of waking (#71).)

## Ground truth (all verified this campaign)

1. **Up is strong and complete enough.** SCRATCHPAD_WRITE (four closed kinds, wire-scanned,
   hub-admitted, write-failure visible #62), DECISION_REQUEST (one-pending admission,
   deadlineAt, onDecision once-per-record), attention/claim-bit, progressClass +
   requiredAction, TG3's nudge-answer channel. No epic needed here.
2. **Down is thin where #74 needs it thick.** A coordinator-worker decomposing a spec and
   steering a swarm needs to READ: the decomposition artifacts its swarm-mates produce
   (shared scratchpad — today write-elevate/settle-read only), the project KG (no worker
   read port — ambient serving is push-only), boards (worker-scoped writes exist; reads
   are orchestrator-only), and each other's findings (no cross-worker read at all).
3. **Context moves as prompt text.** Every context body an orchestrator wants a worker to
   have is spliced into objective strings (byte-capped, unverifiable, unversioned). The
   REPL layer has manifest/binding/cite machinery no campaign uses (#69).
4. **Messaging is two special cases, not a lane.** run.send/nudge_turn (steering) and
   decision answers — nothing typed, nothing with delivery receipts a worker can pattern-
   match against, nothing a coordinator-worker could use to message its OWN swarm members.
5. **The orchestrator polls.** progressClass + requiredAction made the inference honest;
   the wake is still the driver's timer (#71).

## The question

Can a worker mid-turn say "show me X" (KG node, board item, shared entry, a swarm-mate's
note) and get a bounded, provenance-wrapped answer through the same hub-admitted path its
writes already ride — and can the orchestrator pass it versioned context objects instead
of prompt text — with the orchestrator waking on reasons instead of polling? That is the
spine #74 stands on.

## Decisions (draft, to be red-teamed)

### BD3-A — The worker read port (the knowledge-poverty fix, #68)

A worker-emitted, hub-admitted READ lane mirroring SCRATCHPAD_WRITE's exact shape (wire
line scanned in the session adapter, hub admission with worker identity bound by the
authenticated stream, typed refusal receipts, never direct store access):

`CONTEXT_READ: {"query": {...}, "expectedFence": "current", "idempotencyKey": "..."}`

Query kinds (v1, closed): `knowledge` (KG recall against the worker's run's horizons,
bounded ≤8 findings ≤2KiB, provenance-wrapped, expired-never-serves — the ambient-serving
shapes, pull-side), `board` (one board's items, viewer-scoped to the worker's run),
`scratchpad` (the run's SHARED partition entries — workflow-common reads, never another
worker's private partition), `finding` (one cited finding by id — repl.cite's sibling).
Responses arrive as bounded content on the worker's stream (`context.read_result` with
the same receipt discipline as write_result, refusal codes typed). Every read mints a
`scratch.read`-family evidence event (the existing causal-evidence class — reads are
already first-class evidence in the KG's promotion paths, so worker reads ACCRUE
grounding weight honestly).

Red-team targets: cross-run/cross-worker leak (a worker reading outside its run's
horizons — the viewer scope must be re-derived, never caller-named); bounded-answer
injection (the response is content into the worker's context — the same UNTRUSTED
framing as board titles); read-farming as a new liveness loop (reads are NOT TG2 progress
evidence — pin that).

### BD3-B — Context objects (replacing prompt-text context injection, #69's first rung)

A `context-pack` artifact class: orchestrator-authored, content-addressed, versioned
{type, body ≤ 8KiB, validity, provenance}. Briefs and mid-turn nudges CITE packs by
digest (`context-pack:<sha>`) instead of splicing text — the hub materializes the pack
into the worker's context at spawn/nudge time (bounded, wrapProse-framed). v1 types:
`spec` (sub-spec for a #74-style coordinator), `findings` (a curated result set),
`constraints` (workflow rules). Workers can cite packs in their own scratchpad links
(the link kind's target vocabulary gains `context-pack`).

Red-team targets: pack-as-injection (orchestrator-authored but worker-CONSUMED — the
framing story); version staleness (a brief citing a superseded pack must fail loudly at
spawn, not silently serve stale); the 8KiB bound vs real specs (citation chains, not
bigger packs).

### BD3-C — The message lane (typed messaging with receipts, steering's generalization)

One envelope for everything that moves between orchestrator and worker(s):
`{kind: 'steer'|'query'|'inform', to: workerId|role|run, body ≤ 2KiB, provenance,
idempotencyKey}`. Hub-admitted, delivery receipts (`message.delivered`/`message.read`
on both streams), wrapProse-framed, policy-actor for orchestrator sends, worker-actor
only for replies to a received message (no free worker-to-worker sends in v1 — a worker
replies to the orchestrator or posts to shared scratchpad; lateral relay is v1.1 and
rides the shared partition with orchestrator visibility). run.send/nudge_turn become
adapters over this lane (grammar M5-style: canonical is the lane; the old names are
aliases).

Red-team targets: lane-as-covert-channel (a worker piggybacking orchestrator-destined
messages to a swarm-mate — the relay must be orchestrator-mediated with full visibility);
receipt semantics (delivered vs read vs acted-on — never claim acted-on); broadcast
bounds (a 64-member wave's inform must not fan out unbounded).

### BD3-D — The orchestrator attention inbox (#71)

One wake-with-reason stream over the existing followOnce wake laws:
`attention.follow({runId|waveId|deployment, afterCursor, timeoutMs, targets})` returning
typed wake reasons: `decision_pending {requestId, deadlineAt}`, `blocked_interaction
{member, detail}`, `candidacy_review {count}`, `member_terminal {role, phase}`,
`deadline_approaching {requestId, inMs}`. Cursor-chained (followOnce's throughCursor
discipline), MCP-surfaced as a bounded long-poll tool (timeoutMs capped by the frame
budget). The wave driver's poll loop becomes one consumer of this stream (no behavior
change — it proves the stream carries everything the driver needs).

Red-team targets: wake-storm (a 64-member wave terminalizing — coalescing rules, one
wake per reason-class per cursor window); cursor honesty across re-attach (93B's
detached record must feed the stream identically); targets as leak (a viewer must not
name runs outside its scope).

### Out of v1

Worker-to-worker free messaging (v1.1, orchestrator-mediated relay only), worker-authored
context packs (v1.1, orchestrator-reviewed admission), #12 nested orchestration (the
spine is its prerequisite, not its substitute), the MCP surface for A-C (D only in v1 —
the MCP epic in flight owns that layer's shape; these lanes land embedded-first and join
MCP per the reflex table when the packaging epic lands).

## Acceptance (red-first)

- A worker emits CONTEXT_READ for a KG finding and receives the bounded wrapped answer
  with a scratch.read-class evidence event; a read outside its run refuses with the
  typed viewer-scope code; reads do not count as TG2 progress.
- An orchestrator spawns a worker whose brief cites a context-pack by digest; the worker
  receives the materialized pack content (framed); a stale citation fails at spawn with
  the typed code; the pack is content-addressed in the ledger.
- A steer message lands with delivery receipts on both streams; a worker reply reaches
  only the orchestrator; a 64-member inform is bounded; run.send works identically
  (alias).
- The driver runs its full wave consuming ONLY attention.follow wakes (no timer) — every
  wake reason it acts on today appears with the typed shape; an MCP long-poll client
  receives the same stream bounded.

# Reflex red team — adversarial review of docs/32-reflexive-orchestration.md

Scope: doc 32 §§1–6 against current truth in `impl/src/messages.mjs`, `impl/src/coordinator.mjs`
(respond / `_handleEvent` / replay paths), `impl/src/coordination-store.mjs` (scratch family),
`impl/src/context-program.mjs`, `impl/src/application.mjs` (attention + context gating),
`impl/src/adapter.mjs`, `impl/src/claude-session.mjs`, `impl/src/fence.mjs`. All citations are
file:line in the current worktree. Counterexamples are constructed in memory; no scratch files
were written.

## Verdict

Revise before implementation. The four gaps are real and the authority model (hub-only
settlement, fenced, single-consumer, untrusted worker content) is the right frame, but the doc's
current-truth inventory contains factual errors, and each of the four designs inherits at least
one live defect from the machinery it says it reuses. REFLEX-1 as drafted is not safe to
implement red-first: the "same single-consumer machinery as approvals" is in-memory and not
replay-exact, its settlement record can misreport a discarded answer as the resolution, its
answer channel admits cross-kind malformed answers today, and its deadline semantics contradict
both the approval precedent and the always-blocking gating rule. REFLEX-2/3/4 each carry one
unresolved identity or lifecycle contradiction (itemDigest vs retitle, packageEvent circularity,
session-scoped cell admission vs non-Workflow eval). None of these are fatal; all of them must
be pinned in the spec before the wave starts, because several are exactly the class of bug
(settlement authority lying, replay wedges) the rest of the system is built to exclude.

## P0-P1 findings

### F1 (P0) — REFLEX-1: "same single-consumer machinery … replay-exact" is false; the machinery is in-memory and wedges after restart

Doc §3.1: decisions reuse "the same single-consumer machinery as approvals … replay-exact"
(docs/32-reflexive-orchestration.md:113-115).

Current truth: pending interaction records live only in `this._pending` / `_activeInteractionIds`
(impl/src/coordinator.mjs:1008-1011). Records are created only on the live event path
(`question.asked` at coordinator.mjs:9484-9501, `approval.requested` at 9521-9538, publication at
5673). `_replay()` (coordinator.mjs:9996) rebuilds worker/task state from the log — including
re-projecting a task to `input_required` from a replayed `question.asked`
(coordinator.mjs:10522-10524) — but never rebuilds `_pending`. Counterexample: worker asks a
blocking question; coordinator restarts before the answer; replay leaves the task
`input_required`; `run.answer` → `respond(requestId)` returns `{ok:false, result:'not_found'}`
(coordinator.mjs:8166-8167) because no record exists. The task is wedged with an attention item
whose requestId cannot be settled. A blocking decision request (v1 always blocking, §3.1)
inherits this verbatim. The design must make the decision record itself durable (ledger-admitted
`decision.requested` with replay reconstruction of the pending record), or state explicitly how
replay terminalizes an unsettled decision.

### F2 (P0) — REFLEX-1: settlement authority can record an answer that was never delivered

Doc §3.1: "Provider text is untrusted; the *settlement* is authority"
(docs/32-reflexive-orchestration.md:122-123).

Current truth: in `_resolveRecord`, when the asking turn has ended
(`record.turnEpochAtAsk !== currentTurnEpoch`), the coordinator appends `control.stale_rejected`,
transitions the task back to `working`, and then sets `record.resolution = answer` and returns
`{ok:true, result:'applied'}` with only a note (coordinator.mjs:8317-8329). The stored
`resolution` is then echoed to any later principal as the settlement
(`already_resolved … resolution: record.resolution`, coordinator.mjs:8173, 8177). Counterexample:
worker asks at turnEpoch 3; turn ends; orchestrator answers "option: delete-everything"; hub
discards per fencing but the durable record and every later observer see the answer as the
resolution. For a decision channel this is exactly the failure the doc claims to exclude: the
ledger says settled-with-X while the worker never received X and proceeded autonomously. The
decision design must split `resolution` into `{disposition: delivered|stale_discarded|expired,
answer?}` and must never return `applied` for a discarded settlement.

### F3 (P1) — REFLEX-1 malformed-answer robustness: cross-kind settlement is a live hole, and it lands on the wire

The doc's answer-shape rule ("exactly one of optionId … or text … is non-null",
docs/32-reflexive-orchestration.md:109-110) has no enforcement point in the machinery it reuses:

- `application.answer` validates only that the answer is `{text}` or
  `{decision: allow|deny|cancel}` (impl/src/application.mjs:205-220) and never checks the answer
  shape against `interaction.kind` — `interactionStatus` exposes `kind` (coordinator.mjs:8156)
  and `answer()` ignores it (application.mjs:10176-10180).
- The coordinator question path passes the answer to the adapter and logs it verbatim with no
  shape validation (coordinator.mjs:8334-8335, 8359).
- The claude adapter maps an arbitrary `decision` straight onto the elicitation wire:
  `const action = decision ?? (text !== undefined ? 'accept' : 'decline')`
  (impl/src/claude-session.mjs:1008-1010). The adapter's own default mapping shows the wire enum
  is `accept`/`decline`; `{decision:'allow'}` — which `normalizeAnswer` happily admits for a
  *question* record — is written as `action:'allow'`, the adapter emits `question.answered` and
  returns `{ok:true}` (claude-session.mjs:1012-1014), so the ledger records a settlement for a
  frame the harness may reject or silently re-ask (the adapter's own E3 comment documents the
  CLI silently re-asking on malformed replies, claude-session.mjs:976-978).

Counterexample: `baton run answer RUN --decision allow` against a pending question settles the
hub record while the worker's elicitation stays open — hub and worker disagree about whether the
gate is settled, and the task flips to `working` (coordinator.mjs:8379-8382) regardless. A typed
decision answer (`--option ID`) needs (a) a new normalized shape, (b) kind-checked validation at
the hub — `optionId ∈ options`, exactly-one-of — *before* any adapter call, and (c) an honest
adapter mapping; today none of the three exist. Additionally the rollback path treats an adapter
throw as safely retryable (coordinator.mjs:8340-8346), but `answer()` writes the frame before
returning (claude-session.mjs:1012); a throw after a flushed write rolls the record back to
`pending` and a retry delivers a second, possibly different, settlement — double delivery at the
worker boundary, invisible to the "first settle wins" record.

### F4 (P1) — REFLEX-1: duplicate requestId silently collapses two requests into one record

`question.asked`/`approval.requested` handlers do `this._pending.set(requestId, record)` with no
duplicate check (coordinator.mjs:9501, 9538), and `requestId` is derived from harness-controlled
wire ids (`${session.worker}:${wireId}`, claude-session.mjs:840, 848; the adapter-side map is
also overwritten on collision, claude-session.mjs:849). Counterexample: a harness reuses a wire
id (bug or malice); the second `question.asked` overwrites the first record; `respond()` settles
the second; the first question's wait-item is orphaned at the adapter and its ledger ask is never
resolvable — yet both `question.asked` events are durable, so replay (coordinator.mjs:10522-10528)
and the live record disagree. DecisionRequest carries `requestId` (doc §3.1) but states no
hub-side uniqueness rule. The design must reject a duplicate `requestId` at admission with a loud
event, not overwrite.

### F5 (P1) — REFLEX-1 deadline semantics contradict the machinery and the gating rule

Doc §3.1: "a deadline, if set, settles `decision.expired` (typed, visible; never auto-answers)"
(docs/32-reflexive-orchestration.md:117-118), in the same breath as "same single-consumer
machinery as approvals". Three contradictions:

1. The approval machinery auto-answers on deadline: `_sweepDeadlines` resolves expired approvals
   and publications with `{decision:'deny'}` (coordinator.mjs:2027-2031). "Same machinery" would
   auto-answer decisions; the doc forbids it. The divergence is not designed, only asserted.
2. Questions — the channel the decision rides — never expire at all: `deadlineAt: null`
   (coordinator.mjs:9491) and the sweep covers only `approval`/`publication`
   (coordinator.mjs:2028). So "never auto-answers" today means "never expires".
3. Expiry settles only the ledger. A v1 decision is always blocking: the worker is parked at the
   adapter ask boundary (task `input_required`, coordinator.mjs:9494-9507). No wire frame is
   delivered on expiry, so the worker's turn hangs until its own watchdog; and once
   `decision.expired` resolves the record, `respond()` returns `already_resolved`
   (coordinator.mjs:8177) — the task is stuck `input_required` with no answerable request and no
   designed disposition. The design must specify the wire-level expiry delivery (a typed cancel
   to the adapter) and the task transition on expiry, or expiry is a self-wedge.

### F6 (P1) — Gating deadlock: worker blocked on decision vs orchestrator blocked on the same run

The dogfood plan has wave members issuing blocking decision requests answered by the driver
(docs/32-reflexive-orchestration.md:209-211). If the driver blocks on run completion while a
member blocks on a decision only the driver can settle, the cycle has no break: questions have
no deadline (coordinator.mjs:9491) and are never swept (2027-2031), so the wedge is permanent
absent an outside actor. `prepareSemanticInterrupt` can supersede a pending interaction
(coordinator.mjs:6290-6324) but refuses while a respond is mid-flight
(`record.state !== 'pending'` → `interaction_resolution_unavailable`, 6296-6298), so supersede
loses the race to an in-flight answer. Decision requests make this worse in two ways the doc
does not mention: `deadlineMs: null` is permitted (doc §3.1) — the deadlock-preserving option —
and the only surface that names pending requestIds truncates at `MAX_ATTENTION = 64`
(impl/src/application.mjs:46, 6509-6510), so in a large wave pending decisions beyond 64 are
invisible on the surface the orchestrator polls (still settleable by id, but undiscoverable).
The design needs a mandatory deadline (or an explicit `never` with a named external breaker) and
an attention-projection overflow story for decision requests.

### F7 (P1) — REFLEX-1 emulated channel: parsing decision requests out of provider text is a forgeable up-channel

Doc §3.1: "the adapter parses the first well-formed answer, and malformed or missing answers
keep the request pending (never guessed)" (docs/32-reflexive-orchestration.md:126-128), with
adapter cards advertising `decision: native | emulated | unsupported`. On harnesses without a
native elicitation channel, the *request* (up-channel) must be synthesized by parsing worker
output for `DECISION:` grammar. Worker output is untrusted and includes quoted file content: any
repository file containing the grammar (a test fixture, a doc, this very spec) that the worker
echoes would mint a phantom `decision.requested`, park the task at `input_required`
(coordinator.mjs:9494-9507), and consume attention slots (F6). The doc's defense — "Provider
text is untrusted; the settlement is authority" — covers the answer direction only; it says
nothing about request admission from parsed prose. The sentence also conflates directions: the
worker poses the decision, the orchestrator answers; "first well-formed answer" parsing on the
emulated down-channel means a confused orchestrator model emitting two contradictory `DECISION:`
lines gets silent first-wins settlement — uncheckable, the very property G1 objects to
(docs/32-reflexive-orchestration.md:75-79). The doc must say which direction each grammar rule
applies to, and must require that emulated requests are admitted as untrusted prose (replayable,
spoof-safe: the worker can always re-ask) rather than as authority-adjacent control events.

### F8 (P1) — REFLEX-2: content-addressed items contradict mutable retitle/reorder; claims have no death lifecycle

Doc §3.2: items carry `itemDigest` and "item digests are content-addressed"
(docs/32-reflexive-orchestration.md:139-140, 154-155), yet the orchestrator "posts, reorders,
retitles, and closes items" (144-145). Retitling changes the digest, so either items mutate
(breaking content-addressing and replay-exactness) or every edit mints a new item identity — in
which case in-flight claims and evidence-bound reports cite the old `itemDigest`: is a claim on
item@A stale after a retitle to item@B? The doc's "stale claims rejected at the item's current
fence" (146-148) then makes any benign edit a claim-invalidating event — retry storms and
orphaned claims — and no rule migrates open claims across item versions. Second hole: the state
enum `open|claimed|done|dropped` has no release/expiry, and nothing says what happens when a
worker dies holding a claim. The scratch precedent the doc cites handles exactly this:
`expireScratchClaim` with version CAS (impl/src/coordination-store.mjs:11609-11617) and
`_expireScratchClaims` on provider failure (coordinator.mjs:9591). As drafted, board items wedge
in `claimed` on worker death — a per-item deadlock mirroring F6.

### F9 (P1) — REFLEX-2: fence domain is unspecified, and the scratch precedent shows the trap

Doc §3.2: "per-board fences serialize concurrent orchestrator/worker transitions"
(docs/32-reflexive-orchestration.md:153-154). The only fence authority that exists is per-worker
(`FenceTable.issue/check/bumpTurn/bumpHuman`, impl/src/fence.mjs:10-46); there is no per-board
fence domain, and the doc does not say what bumps a board fence (every edit? every claim?) or how
it replays. The scratch precedent misuses the *worker's own* fence as the claim fence
(`claimScratch` checks `expectedFence` against the worker, coordinator.mjs:8839-8846, then stores
`fence: check.current.fence`), which means a routine nudge/steer that bumps the worker's fence
invalidates that worker's in-flight claims — the same livelock F8 predicts for boards if "the
item's current fence" is not pinned to a board-scoped, replay-derivable counter.

### F10 (P1) — REFLEX-2: per-worker filtering cost follows the most expensive read precedent in the codebase

Doc §3.2 visibility (per-worker filtered slices, docs/32-reflexive-orchestration.md:149-152)
lands next to the scratch read path, which is the worst precedent available: `readScratch`
appends a durable `scratch.read` event on every read (coordination-store.mjs:11636-11641) and
`checkScratch` full-scans all claims and facts per call (11625-11633). If board slices are
implemented as evented reads, N workers polling a board is O(N × board-size) per cycle plus a
ledger write per read — write amplification on the replay-critical log. The doc specifies no
projection caching, no read budget, and no polling discipline for boards; RunView bounds
(`MAX_RUN_VIEW_BYTES`, `MAX_RUN_VIEW_WORKERS`, application.mjs:43-44) do not cover a board
surface. This is a cost finding, not a correctness one, but it must be answered before
"read slices" is implementable.

### F11 (P1) — REFLEX-3: packageEvent provenance is circular, branch identity is unconstrained, and attach-time revalidation is an unbounded N× cost

Three independent holes in §3.3 (docs/32-reflexive-orchestration.md:164-183):

1. **Lineage circularity.** `packageDigest` covers `provenance.packageEvent`, but the event that
   admits the package cannot exist before the digest — so `packageEvent` necessarily cites some
   *other* event, and the doc never says which, nor that the authoritative package↔admission
   binding must come from the ledger rather than the self-describing envelope. As written a
   package can carry an arbitrary provenance claim ("admitted by run X, principal Y") that
   nothing verifies; "branch content … carries its provenance" (180-181) then propagates an
   unverified claim as if it were hub-computed. Compare the scratch oracle binding, which derives
   provenance from the ledger event itself (coordination-store.mjs:11572-11585).
2. **Branch identity.** `branches: exact{name, source|null, artifact|null, valueRef|null,
   schema|null}[0..max]` admits duplicate names and all-null branches; nothing requires name
   uniqueness or at-least-one-ref. Readers resolving a branch by name (the only key) get
   ambiguous lineage; a zero-content named branch is a lineage placeholder a worker can be told
   to trust. `ContextManifest` normalization exists precisely to pin this class of shape
   (context-program.mjs:183); the package schema needs the same treatment.
3. **Attach cost.** "every branch resolves (artifact bytes revalidated, ValueRefs read-time
   revalidated per §93.5) at admission and at every attach" (175-176) is O(total package bytes)
   per attach; attaching one package to a run, M workers, and B boards is (1+M+B) full
   re-read/re-digests. The only existing precedent for attach-time re-verification is the
   reduce path (`withContextArtifactVerification`, application.mjs:8122). §93.5 requires
   schema-validation on every read (spec/phase93-closed-program-ir.md:314-316), so revalidation
   on *read* is mandatory — but revalidating at *attach* (a ledger transition, not a read) is a
   cost the doc neither justifies (is the artifact CAS untrusted between admission and attach?)
   nor bounds. Either state the threat model or attach lazily and revalidate at resolve time.

### F12 (P1) — REFLEX-4: application.context_eval identity is content-true but admission-false; non-Workflow cells are unreachable or unresolvable

The good news first: cell identity is genuinely portable. `cellId` is the digest of
`{manifestDigest, programDigest, environmentDigest, policyDigest}` — no run, session, or role
(context-program.mjs:931-940) — so "the same closed Bench, no new evaluator"
(docs/32-reflexive-orchestration.md:187-189) is honest about identity, and pure-eval cost is
policy-bounded (maxCellsPerSession, context-program.mjs:946-950; effect ops rejected,
916-920; application.mjs:8153-8156).

The holes:

1. **Reachability.** Context actions exist only on Workflow runs: `_contextTargets` returns `[]`
   unless `_isWorkflowRun` (application.mjs:7116-7118), targets derive from *dispatch* nodeKeys
   (7119-7127), the session opens with dispatch-bound authority `{current, role, nodeKey}`
   (8161-8164), and a non-Workflow run fails with "Context role is outside current Workflow
   authority" (8133-8136). The doc proposes eval "against any admitted ContextManifest — no
   Workflow requirement" but names no manifest-admission surface for non-Workflow runs — today a
   manifest exists only inside a session bound to a Workflow plan digest
   (application.mjs:7136). What admits the manifest, under what authority, on a plain run?
2. **Replay resolvability.** Durable cells are admitted session-scoped
   (`admissionKey = context.cell:${sessionId}:${programDigest}`, context-program.mjs:1244-1247)
   via `DurableContextSession` (1170). If `application.context_eval` instead runs the
   `StatelessContextBench` (583) directly, the computed cell has *no ledger admission event* —
   and §3.4 wants boards/packages to cite these cells by `cell:` digest
   (docs/32-reflexive-orchestration.md:190-192). A package branch citing a statelessly computed
   cell is a ref that replay cannot resolve: the digest is well-formed, the object was never
   admitted. The doc must mandate durable admission (a named, non-Workflow session authority) for
   any cell that boards/packages may cite, or restrict citable refs to durably admitted cells.

### F13 (P2, doc-truth) — the current-truth inventory is wrong in three load-bearing places

1. §1.1/G1: "the ordinary surface only *names* the state; it does not yet project the pending
   question's content" (docs/32-reflexive-orchestration.md:32-33). False: both the non-Workflow
   view (application.mjs:6493-6496) and the Workflow view (6170-6174) project the pending
   question's text via `boundedAttentionText` (bounded, NFC, credential-shaped redaction,
   application.mjs:196-203), and semantic actions carry it into `act()` (8187-8198, 9923-9929).
   The true gap is only the typed option set. A red-team-against-reality doc that misstates the
   baseline invites redesign of things that already exist.
2. §1.1/§3.1: "the other principal is told 'already handled'" / "others see `already_handled`"
   (docs/32-reflexive-orchestration.md:26, 114). The actual result code is `already_resolved`
   (coordinator.mjs:8173, 8177). Naming a nonexistent code in a spec invites an implementation
   that invents a second, divergent one.
3. §3.1: "stop/kill supersedes honestly (`control.interaction_superseded`)" (doc line 115).
   `control.interaction_superseded` is emitted only by `prepareSemanticInterrupt`
   (coordinator.mjs:6300-6305). Stop/kill paths never supersede pending interaction records;
   fleet drain cancels with a different event (`control.drain_interaction_cancelled`,
   coordinator.mjs:1849-1858). The doc's honest-supersede claim for stop/kill is unimplemented
   today and undesigned for decisions.

### F14 (P2) — Sanitization: decision/board projections need the scrubber *and* provenance, not just bounding

The existing scrubber is real and correct in shape: `boundedAttentionText` redacts
credential-shaped text and bounds bytes (application.mjs:196-203), and orchestrator answers are
rejected if secret-shaped (application.mjs:210-213). The doc promises "sanitized projection of
the question + option ids/labels" (docs/32-reflexive-orchestration.md:120-121) but does not
require (a) routing option labels/answers through the same `SECRET_SHAPED_TEXT` redaction, or
(b) provenance marking. Every field of a decision request is worker-authored; the `recommended`
flag is a worker nudging the human principal toward an option. Projections that render decision
content without `wrapProse`-style untrusted marking (messages.mjs:193-207) present attacker-influenced
text with hub-computed visual weight. Same for worker-submitted board report text (§3.2 attaches
reports with evidence refs but never states the report body's projection rules). This is a
spec-omission finding: the mechanisms exist; the doc must name them per projection.

## Required corrections

1. **Fix the baseline inventory (doc §1.1, G1).** State that the ordinary RunView already
   projects pending question content, bounded and credential-redacted
   (application.mjs:6493-6496, 196-203); scope G1 to the typed option set and settlement typing
   only. Correct `already_handled` → `already_resolved` (coordinator.mjs:8173, 8177), and
   attribute `control.interaction_superseded` to semantic interrupt only
   (coordinator.mjs:6300-6305); design decision-request supersede on stop/kill explicitly.
2. **Make the decision record durable before anything else (F1).** `decision.requested` must be
   a ledger-admitted record that `_replay()` reconstructs into the pending set, or unsettled
   decisions must replay-terminalize with a typed event. Do not build REFLEX-1 on the in-memory
   `_pending` map as-is.
3. **Split resolution from disposition (F2).** `DecisionAnswer` settlement must record
   `{disposition: delivered | stale_discarded | expired | superseded, answer?}`; a discarded or
   expired settlement must never surface the answer as the resolution, and `respond()` must not
   return `applied` for an undelivered answer (contrast coordinator.mjs:8324-8329).
4. **Validate answers at the hub, kind-checked (F3).** Extend `normalizeAnswer`
   (application.mjs:205-220) with the typed `{optionId}` / free-response shapes, check the shape
   against `interactionStatus(requestId).kind` in `application.answer`
   (application.mjs:10176-10180), and enforce `optionId ∈ options` + exactly-one-of in the
   coordinator before any adapter call. Adapter cards must declare whether a decision answer can
   be natively framed; the claude elicitation mapping (claude-session.mjs:1008-1014) cannot
   carry it natively and must say `emulated`.
5. **Reject duplicate requestIds loudly (F4).** Hub-side uniqueness check at
   `decision.requested` admission with a rejection event; never overwrite a pending record
   (coordinator.mjs:9501, 9538).
6. **Design expiry end-to-end (F5, F6).** Specify the wire-level expiry delivery and the task
   transition on `decision.expired`; make `deadlineMs` mandatory (or `never` an explicit opt-in
   with a named external breaker); state how the deadline sweep interacts with an in-flight
   `resolving` settlement (coordinator.mjs:8168-8176); and give the attention projection an
   overflow story past `MAX_ATTENTION` (application.mjs:46, 6509-6510).
7. **Separate the emulated grammar by direction and treat parsed requests as untrusted
   admission, not authority (F7).** Say exactly which side parses what; a parsed
   `decision.requested` from provider text must be admitted as spoof-safe untrusted prose.
8. **Pin board item identity and claim lifecycle (F8, F9).** Choose immutable items
   (edit = successor item version, with an explicit claim-migration rule) or mutable items with
   digest only at close — not both. Add a claim release/expiry path on worker death mirroring
   `_expireScratchClaims` (coordinator.mjs:9591). Define the board fence as a board-scoped,
   replay-derivable counter and enumerate what bumps it.
9. **Bound board read cost (F10).** Specify cached per-worker projections instead of evented
   reads (the `readScratch` pattern, coordination-store.mjs:11636-11641, must not be the board
   precedent), plus a polling/projection budget.
10. **Fix ContextPackage provenance and branch shape, and re-scope revalidation (F11).** Derive
    provenance from the admission ledger event (the scratch-oracle binding pattern,
    coordination-store.mjs:11572-11585), not from a self-cited envelope field; require unique
    branch names and at least one ref per branch; revalidate on resolve/read per §93.5
    (spec/phase93-closed-program-ir.md:314-316) and either drop attach-time revalidation or
    state the threat model that requires it.
11. **Name the non-Workflow admission authority for REFLEX-4 (F12).** Specify what admits a
    ContextManifest outside a Workflow session and what session authority durably admits the
    cells; forbid boards/packages from citing cells that have no durable admission event.
12. **Name the scrubber and provenance per projection (F14).** Every decision/board/package
    projection must route worker-authored text through the `boundedAttentionText`/
    `SECRET_SHAPED_TEXT` discipline (application.mjs:196-203) and carry untrusted provenance
    (messages.mjs:193-207), including the `recommended` flag and board report bodies.

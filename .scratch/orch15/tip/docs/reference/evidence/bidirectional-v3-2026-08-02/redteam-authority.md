# BD3 Collaboration-Spine Authority Red Team

## Scope and method

This is a contract-level, read-only implementation review of the v1.0 worker-validated contract and its v1.1 layers matrix. The matrix promises authenticated-stream identity binding, closed shapes, typed refusals, inbound `UNTRUSTED` framing, and server re-derivation of read viewers (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:42-51`). The draft then defines BD3-A through BD3-D and labels them “to be red-teamed” (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:116-118`).

The review treats the contract as the proposed normative boundary, not as already-landed behavior: the matrix calls the typed message lane and context packs absent, and calls worker KG pull absent (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:61-64`). Existing implementation is used to locate reusable authority seams and to show where a prose promise is not yet a mechanically complete rule.

Verdicts mean:

- **CONFIRMED-HOLE** — the proposed shape omits a binding needed to reject the attack, or affirmatively permits an unsafe resolution.
- **DEFENDED** — the contract supplies a construction that rejects the attack, assuming the named seam is implemented as written.
- **NEEDS-AMENDMENT** — the intended defense is visible, but the contract does not make its enforcement point or acceptance oracle precise enough to validate.

## Executive verdicts

| Attack surface | Verdict | Authority consequence | Required amendment |
| --- | --- | --- | --- |
| BD3-A knowledge query | **CONFIRMED-HOLE** | Re-deriving a worker/run does not help when “the run's horizons” has no membership predicate and current task/workflow horizons project the whole KG (`impl/src/coordinator.mjs:10272-10296`, `impl/src/coordinator.mjs:10299-10338`). | Define the server-derived horizon predicate and intersect it after every lookup. |
| BD3-A board query | **DEFENDED** | The proposed query is run-viewer-scoped, and the existing board seam proves a board-to-Run binding can be checked before returning a snapshot (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`, `impl/src/coordination-store.mjs:13674-13705`). | Make reuse of that binding check and its refusal precedence normative. |
| BD3-A scratchpad query | **DEFENDED** | The contract permits only the authenticated worker's run-level `shared` partition, never a private sibling partition (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:120-130`). | Require the coordinator to construct `(runId, ['shared'])`; reject those fields in the wire query. |
| BD3-A finding-by-id | **CONFIRMED-HOLE** | “One cited finding by id” has no run-horizon clause; content-addressed IDs are derivable and the existing ID query is global (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`, `impl/src/coordination-store.mjs:9471-9473`, `impl/src/coordination-store.mjs:15134-15151`). | Resolve, then authorize the resolved node against the same derived horizon; possession of an ID is never authority. |
| Read answers as prompt injection | **NEEDS-AMENDMENT** | The contract requires framing, but does not name a mandatory final serializer/admission check; existing helpers can merely attach metadata before raw user-frame delivery (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:44-51`, `impl/src/messages.mjs:371-377`, `impl/src/claude-session.mjs:1240-1260`). | Define one closed response renderer and reject any unframed model-authored leaf before provider delivery. |
| BD3-B stale context packs | **CONFIRMED-HOLE** | `validity` is named but no logical head, predecessor, validity version, expiry rule, or spawn-time CAS exists (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:143-156`). | Add a server-owned supersession chain and atomically require the cited digest to be the live head at spawn/nudge. |
| BD3-C reply-only lane | **CONFIRMED-HOLE** | The envelope has no message ID or `inReplyTo`, so “worker-actor only for replies” cannot be proven and targets remain caller data (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:158-168`). | Mint message IDs; accept worker frames with only `inReplyTo` and body; derive the sole target from the parent. |
| BD3-D target disclosure | **CONFIRMED-HOLE** | `targets` is caller-named and no target normalization or authorization order is specified (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:175-189`). | Authorize one parent scope first, derive the target set, and return a constant scope refusal before existence checks. |
| BD3-D candidacy wake | **CONFIRMED-HOLE** | `candidacy_review {count}` discloses the existence and cardinality of candidates without binding the viewer to admission authority (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:175-184`). | Require a live settlement/review lease and derive the count within that lease's Run/wave. |
| Additional missed authority hole: read-evidence laundering | **CONFIRMED-HOLE** | The contract grants generic reads `scratch.read`-family grounding weight without preserving the causal gate that makes existing Scratch reads meaningful (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:131-135`, `impl/src/coordination-store.mjs:14370-14384`). | Use a distinct `context.read` audit class with zero promotion weight until a typed, independently verified evidence policy admits it. |

## 1. BD3-A viewer scope and cross-run reads

### 1.1 Admission and viewer derivation

There is a sound re-derivation pattern to copy. `scanForScratchpadWrite` accepts exactly `entry`, `expectedFence`, and `idempotencyKey`; it accepts no worker, task, or run identity (`impl/src/claude-session.mjs:86-102`). The assistant-message handler emits that parsed request on the already-associated session (`impl/src/claude-session.mjs:994-1024`). The coordinator handler ignores any model identity, takes `workerId` from the authenticated event envelope, and calls `writeScratchpad(workerId, ...)` (`impl/src/coordinator.mjs:11033-11043`). `writeScratchpad` then gets the worker handle and task and constructs `runId`, `taskId`, and `workerId` itself (`impl/src/coordinator.mjs:9846-9876`); the store finally requires `auth.actor === 'worker'` and `auth.principalId === fields.workerId` (`impl/src/coordination-store.mjs:13205-13209`).

BD3-A says the read lane mirrors that exact shape and is hub-admitted with identity bound by the authenticated stream (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:118-124`). Its outer grammar contains only `query`, `expectedFence`, and `idempotencyKey`, so it does not itself permit caller-named viewer identity (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:120-125`). The mandatory re-derivation point should therefore be the new sibling of `impl/src/coordinator.mjs:11034`: before dispatching by query kind, it must derive `{workerId, taskId, runId, repoId}` from the authenticated event's worker handle and reject those fields anywhere inside `query`.

That identity derivation is necessary but not sufficient. The selector must also be intersected with a resource membership predicate. The existing low-level read APIs illustrate why: `scratchpadSnapshotBatch` accepts any syntactically valid `runId` and scopes and performs no viewer authorization itself (`impl/src/coordination-store.mjs:13169-13184`), while `queryKnowledge` filters ID/type/grounding/time but not worker or Run membership (`impl/src/coordination-store.mjs:15134-15151`). BD3-A's “never direct store access” rule correctly places this missing authority in hub admission (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:120-123`).

### 1.2 Knowledge query

**Verdict: CONFIRMED-HOLE**

“KG recall against the worker's run's horizons” is not a complete authorization rule because the contract never defines which nodes belong to that horizon or whether query seeds/IDs are intersected before or after recall (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`). The current horizon machinery cannot silently supply that meaning: `taskHorizon` returns `queryKnowledge({})` for all nodes, and its optional board is caller-selected (`impl/src/coordinator.mjs:10272-10296`); `workflowHorizon` re-derives owned worker IDs for scratchpad visibility but still returns `queryKnowledge({})` for all nodes (`impl/src/coordinator.mjs:10311-10338`). `projectHorizon(repoId)` also ignores `repoId` when it performs the node query (`impl/src/coordinator.mjs:10342-10350`).

The current recall machinery likewise records reader coordinates without using them as a visibility filter. `recallKnowledge` rebinds a supplied worker to its task, but passes a caller-provided `reader.runId` through (`impl/src/coordinator.mjs:9764-9782`). Store recall derives a reader record, then builds candidates from `queryKnowledge({observedSeq, asOf})` across the graph (`impl/src/coordination-store.mjs:15178-15195`, `impl/src/coordination-store.mjs:15208-15215`). Application semantics even classifies `reader` as an authority field rather than server-derived (`impl/src/application-semantics.mjs:1508-1514`). These are existing surfaces, not BD3-A implementation, but they prove that the phrase “run's horizons” has no reusable authority predicate today.

**Amendment:** Define `deriveContextReadViewer(authenticatedWorker) -> {workerId, taskId, runId, repoId, horizonNodeIds, allowedBoards}`. Define `horizonNodeIds` by closed provenance relations (for example, node `runId`, producing task's `runId`, explicit run attachment, or policy-approved project-common class), not by text relevance. For every knowledge query, compute candidates and then intersect with `horizonNodeIds`; reject every caller-supplied reader/run/repo/horizon field. Add negative tests for an exact out-of-run node ID, an out-of-run seed ID, a text query uniquely matching an out-of-run body, historical `asOf`, and an empty-vs-not-found oracle.

### 1.3 Board query

**Verdict: DEFENDED**

The contract limits the query to one board viewer-scoped to the authenticated worker's Run (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`). A concrete enforcement model already exists: board admission validates an active lease, binds its parent Run to the command Run, then rejects a board already bound to a different Run before any item lookup (`impl/src/coordination-store.mjs:13674-13715`). Only after those checks does a read return `boardSnapshot` (`impl/src/coordination-store.mjs:13736-13739`). This is a real membership predicate, unlike the current KG horizon.

The defense depends on reusing the membership check, not on exposing the orchestrator lease to a worker. The new worker handler must derive its Run from the authenticated worker and authorize `boardRunBinding.runId === derivedRunId`; the query may name only the board selector. It must not call the public coordinator `boardSnapshot(board)` directly because that wrapper only asserts general readability and forwards the caller-named board (`impl/src/coordinator.mjs:10353-10360`).

**Amendment:** State that worker board reads reuse the board-to-Run binding check from board admission with server-derived `runId`, and that `board_unavailable` is returned before item count/content. Add tests for an unbound board, another Run's bound board, and a guessed nonexistent board; the latter two must be indistinguishable to the worker.

### 1.4 Scratchpad query

**Verdict: DEFENDED**

The contract grants only “the run's SHARED partition entries” and explicitly excludes every other worker's private partition (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`). The existing partition key is `(runId, scope)`, and `scratchpadSnapshotBatch` reads only the exact supplied scopes (`impl/src/coordination-store.mjs:13165-13184`). The existing workflow projection also demonstrates correct worker visibility: a valid owned worker gets only `worker:<self>` and `shared`, while unknown viewers are refused (`impl/src/coordinator.mjs:10311-10323`). BD3-A is stricter than that projection because it permits only `shared`.

This defense fails if a query can name `runId` or `scope`, because the low-level store reader is intentionally pure and unguarded (`impl/src/coordination-store.mjs:13169-13184`). The wire query therefore needs to be a closed selector with no such fields, and the coordinator must call `scratchpadSnapshot(derivedRunId, 'shared')` itself.

**Amendment:** Fix the v1 schema to `{kind:'scratchpad', afterOrdinal?, limit?}` with server-capped pagination; explicitly reject `runId`, `workerId`, and `scope`. Require the response projection to be the existing per-field untrusted projection, whose note/plan/doubt/link text is wrapped field by field (`impl/src/coordinator.mjs:316-355`). Add cross-run, sibling-private, and caller-supplied-scope negative tests.

### 1.5 Finding-by-id query

**Verdict: CONFIRMED-HOLE**

The other three query descriptions include a horizon or Run restriction; `finding` is only “one cited finding by id” (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-130`). Calling it the sibling of `repl.cite` does not add protection: REPL citation resolution is safe because it takes a server-supplied `runId` and looks only in history keyed by `(runId, scope, name)` (`impl/src/coordination-store.mjs:14240-14251`). Findings have no equivalent tuple in the contract.

Finding identifiers are not capabilities. Existing package findings use `finding:package:<packageDigest>` (`impl/src/coordination-store.mjs:9467-9473`), while the package digest is deterministically computed from canonical package content (`impl/src/coordination-store.mjs:9327-9334`). A worker that knows or can reconstruct the cited content can derive the ID; an ID can also be copied from another context. Current `queryKnowledge({ids:[...]})` is a global ID filter whose only other checks are type/grounding/valid-time (`impl/src/coordination-store.mjs:15134-15151`). Thus unguessability cannot substitute for authorization.

**Amendment:** Change the rule to: “Resolve the ID at the current serve boundary, then require that exact live validity version to be in the server-derived worker horizon; otherwise return the same `context_read_unavailable` used for nonexistent IDs.” Record the horizon digest and validity version in the read receipt. Test a derived package-finding ID from another Run, a copied valid ID, a superseded ID, and a nonexistent ID.

## 2. Read answers as injection

**Verdict: NEEDS-AMENDMENT**

The intent is unambiguous: the matrix says everything crossing into agent context is `wrapProse`/`UNTRUSTED` framed and “data, never instruction” (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:44-51`); BD3-A calls for provenance-wrapped knowledge and flags bounded-answer injection (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:126-140`). The serving helper marks its outer slice and every item `untrusted:true`, includes grounding/validity, and bounds count and bytes (`impl/src/messages.mjs:477-482`, `impl/src/messages.mjs:500-535`). `readKnowledge` additionally returns an explicit `UNTRUSTED_RECALLED_MEMORY` frame (`impl/src/coordination-store.mjs:15437-15451`).

Those conventions are not yet a mandatory final delivery seam. `wrapProse` merely returns `{provenance:'model-authored', untrusted:true}` metadata (`impl/src/messages.mjs:371-377`). Application semantics describes package reads as “provenance-marked untrusted prose” but specifies no renderer invariant (`impl/src/application-semantics.mjs:1183-1202`). The Claude adapter's generic prompt path writes the supplied string directly as a user-role frame (`impl/src/claude-session.mjs:1240-1260`). Even the current board snapshot frames item titles/details but returns claims and reports as plain cloned rows, so a whole-board response cannot inherit safety from the item frame alone (`impl/src/coordination-store.mjs:13963-13979`).

Consequently, “same UNTRUSTED framing as board titles” is documentation-level unless BD3 names a single renderer that recursively rejects or wraps every model-authored string immediately before `_writeUserFrame`. A metadata bit inside JSON does not make an LLM ignore an embedded imperative; the enforceable property is structural provenance preservation plus an explicit provider-facing delimiter/instruction generated by the hub, never by recalled content.

**Amendment:** Define a closed `context.read_result` payload with hub-minted `requestId`, `queryKind`, `viewerDigest`, `observedFence`, `truncated`, and a recursive union of trusted scalar metadata versus `{text, provenance, untrusted:true}` prose. Require a single final `renderUntrustedContextRead` at every adapter delivery seam; it emits a hub-owned preamble and non-user-controllable delimiters, escapes delimiter collisions, and fails closed on any bare prose leaf. Board reports, scratchpad content, finding snippets, context packs, and message bodies must use it. Acceptance must inject adversarial instructions into every textual leaf and assert the final provider frame retains the wrapper and bounds.

## 3. BD3-B context-pack authority and staleness

**Verdict: CONFIRMED-HOLE**

The contract defines a pack as orchestrator-authored, content-addressed, versioned, and carrying `{type, body, validity, provenance}`; a brief cites its digest and the hub materializes it at spawn/nudge (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:143-151`). It also requires a superseded citation to fail at spawn (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:153-156`). But it never defines a logical subject/slot, version number, predecessor digest, current head, `validFrom`, `validTo`, `expiresAt`, superseding authority, expected validity version, or the atomic spawn check that makes “superseded” decidable.

Content addressing alone preserves old bytes; it cannot mark them stale. The existing context-package class demonstrates the failure mode: its normalized exact shape contains branches, kind, policy digest, provenance, and schema version, but no validity or supersession fields (`impl/src/coordination-store.mjs:9285-9334`). Its public record contains admission provenance but no live/dead state (`impl/src/coordination-store.mjs:9148-9160`). Resolution checks that the digest and branch exist and that referenced content is still available, then returns it; it does not check a supersession head (`impl/src/coordination-store.mjs:9337-9355`, `impl/src/coordination-store.mjs:9358-9372`). Therefore an immutable digest can serve forever unless a separate validity authority is designed.

The KG supplies the contrast the contract asks for. `queryKnowledge` excludes a node once `validTo <= effectiveAt` and excludes it at/after `expiresAt` (`impl/src/coordination-store.mjs:15141-15151`). Reuse TTL invalidation binds an `expectedValidityVersion` and refuses a stale or not-yet-expired target (`impl/src/coordination-store.mjs:3739-3742`). That is the minimum strength needed for context-pack spawn admission.

**Amendment:** Give each pack a server-defined logical key such as `{runId, slot, type}` and immutable `{digest, version, predecessorDigest, validityVersion, validFrom, validTo, expiresAt}`. Maintain a single replay-derived head per key. Only an actor with active orchestrator authority for the bound Run may create or supersede it, using `expectedHeadDigest` and `expectedValidityVersion` CAS. At spawn and nudge, in the same authority operation that admits the provider frame, resolve the cited digest and require: correct Run/audience, current head, live validity interval, unexpired, and intact provenance. Refuse with one typed `context_pack_stale` before provider launch; pin the checked head/version in the spawn receipt. Citation chains do not inherit liveness: every referenced pack must pass independently. Add replay, concurrent supersession, expiration, cross-Run digest, and supersession-between-brief-validation-and-spawn tests.

## 4. BD3-C reply-only worker lane

**Verdict: CONFIRMED-HOLE**

The canonical envelope is `{kind, to, body, provenance, idempotencyKey}` (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:158-163`). It contains neither a hub-minted message ID nor `inReplyTo`. The next sentence permits a worker actor only for replies to a received message and says a worker reply reaches the orchestrator (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:163-168`), but no field lets admission prove that causal fact. Worse, `to` is part of the canonical envelope, so unless the worker schema is different, the worker names the target it is supposedly forbidden to choose.

A quoted body must never confer reply authority. The existing scratchpad grammar is safe against quoted tool results because only assistant text is scanned and identity is structurally absent (`impl/src/claude-session.mjs:60-65`, `impl/src/claude-session.mjs:86-102`). BD3-C needs the same structural property: parsing a message ID or target from quoted prose cannot create a send capability. Reply-to-reply chains are equally unsafe if any received worker-originated reply can become a new parent: an orchestrator relay could otherwise mint a transferable worker-to-worker send capability while appearing as a reply.

**Amendment:** Split schemas by actor. Orchestrator send: `{kind,to,body,idempotencyKey}`. Hub stores `{messageId,from,to,kind,bodyDigest,runId,deliveryState}`. Worker reply: `{inReplyTo,body,idempotencyKey}` only—no `to`, `from`, role, or Run. Admission loads the parent by hub ID and requires that it was hub-delivered, originated from an authorized orchestrator/policy actor, was addressed to this authenticated worker in its current Run/session, is replyable, and has not exhausted a reply bound. The hub derives the sole destination as the original orchestrator lane. A worker-originated message, a relayed reply, quoted ID/body text, or `message.delivered/read` receipt can never be a reply parent. Add negative tests for direct worker-to-worker `to`, replying to another worker's message ID, replying to a reply, replay after worker reincarnation, quoted bodies, and body-supplied routing fields.

## 5. BD3-D inbox authority and metadata leakage

### 5.1 Target naming outside viewer scope

**Verdict: CONFIRMED-HOLE**

`attention.follow` accepts `{runId|waveId|deployment, afterCursor, timeoutMs, targets}` (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:175-181`). The contract recognizes “targets as leak” but only says a viewer must not name runs outside its scope; it does not define whether the parent selector and `targets` may coexist, how targets are normalized, whether nonexistent and forbidden targets are indistinguishable, or whether authorization is rechecked after a long poll (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:186-189`). A caller can therefore use target-specific success/refusal/empty behavior as a run-existence oracle.

The current `run.follow` provides the stronger pattern. It accepts one `runId`, authorizes that exact Run before polling, and reauthorizes immediately before returning (`impl/src/application.mjs:8021-8039`, `impl/src/application.mjs:8061-8074`). Board admission likewise checks proof and Run/board binding before item existence (`impl/src/coordination-store.mjs:13674-13715`). BD3-D should preserve those refusal-order properties rather than accepting a free target list.

**Amendment:** Make the parent selector an exclusive union of one authorized `runId`, one authorized `waveId`, or deployment scope held only by operator/policy. Remove caller `targets` in v1, or restrict it to opaque member aliases whose concrete run set is derived from the authorized parent. Authorize before resolving member/run existence; use one `attention_scope_unavailable` response for absent and forbidden coordinates. Freeze the derived target-set digest at call admission and reauthorize parent scope before return. Add differential tests showing identical code, shape, timing class, and zero payload for forbidden versus nonexistent targets.

### 5.2 `candidacy_review` wake reason

**Verdict: CONFIRMED-HOLE**

The wake schema exposes `candidacy_review {count}` to an orchestrator attention consumer (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:175-184`). A count is not content, but it still reveals candidate existence and cardinality. The contract does not require the viewer to hold the promotion/review authority named elsewhere for KG admission. Its acceptance requires the stream to carry every driver wake but contains no negative candidacy-visibility test (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:199-212`).

Existing settlement machinery shows the authority object available to bind. It creates a settlement Run/task and session-bound orchestrator lease, then returns `candidatesAwaitingAdmission` (`impl/src/coordinator.mjs:10121-10155`, `impl/src/coordinator.mjs:10167-10172`). Application semantics states that knowledge promotion is gated by a run-orchestrator lease (`impl/src/application-semantics.mjs:1197-1202`). A generic run observer or deployment inbox subscriber should not learn candidacy merely because it can observe unrelated progress.

**Amendment:** Emit `candidacy_review` only into a lane keyed by the live settlement/review lease. At follow admission and return, require that the principal owns that lease and its promotion capability for the same Run/wave; derive the count only from candidates inside the lease boundary. Unauthorized viewers receive no wake and cannot distinguish zero candidates from withheld candidates. Put candidate IDs/evidence behind a separate lease-gated review read, not in the wake. Add tests for ordinary run observer, expired lease, wrong wave, deployment observer without promotion capability, and authorized reviewer.

## 6. Additional authority hole omitted by the contract

**Verdict: CONFIRMED-HOLE — generic read evidence launders authority**

BD3-A says every read mints a `scratch.read`-family evidence event and that worker reads “ACCRUE grounding weight honestly” (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:131-135`). Its red-team list considers read-farming only as a liveness problem—reads must not count as TG2 progress (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:137-141`). It does not constrain the more serious authority effect: turning consumption of untrusted KG, board, scratchpad, or finding content into evidence that helps promote that content.

The existing `scratch.read` class has narrow causal semantics. `readScratch` records the concrete resource, immutable `envRef`, reader coordinates, and exact claims/facts returned (`impl/src/coordination-store.mjs:13138-13157`). Promotion does not count raw read volume: it selects reads that contain the specific Scratch fact, deduplicates by task, and requires each reader task to be completed with a verified outcome before satisfying `minScratchReaders` (`impl/src/coordination-store.mjs:14370-14384`). Reusing the family name for four heterogeneous context reads without pinning those invariants risks evidence-type confusion; reading an already-admitted Finding is not independent verification of it, and reading one's own or a sibling's prose cannot raise its authority.

**Amendment:** Mint `context.read` as an audit/causal-exposure event, not `scratch.read`, with `{viewerDigest, queryKind, subjectIds, validityVersions, observedFence, responseDigest}` and `promotionWeight:0`. No KG promotion/candidacy policy may consume it by event-family prefix. If a future policy wants read-derived weight, define a distinct typed verification event requiring a different completed verifier task, immutable subject coordinates, non-self authorship, unique principal/route constraints, and an accepted verification artifact. Add a test that arbitrarily many reads—across idempotency keys, tasks in the same Run, and sibling workers—leave candidacy and grounding unchanged.

## 7. Normative amendment set

The minimal contract repair is:

1. **One server-derived viewer.** At the authenticated assistant-event handler, derive worker/task/Run/repo once; reject all identity/scope fields inside the query. This is the read sibling of the existing write path (`impl/src/coordinator.mjs:11033-11043`, `impl/src/coordinator.mjs:9846-9876`).
2. **One post-resolution authorization rule.** Board, scratchpad, knowledge, and finding selectors must be intersected with server-derived membership after resolution; nonexistent and forbidden subjects share a refusal. Existing board-to-Run checks provide the model (`impl/src/coordination-store.mjs:13687-13715`).
3. **One mandatory inbound renderer.** Recursively preserve taint and reject bare prose at the final provider seam; do not rely on metadata conventions alone (`impl/src/messages.mjs:371-377`, `impl/src/claude-session.mjs:1240-1260`).
4. **A real pack validity authority.** Add logical head, predecessor, validity version/interval, CAS supersession, expiry, and atomic spawn/nudge recheck, matching the KG's live-time filtering strength (`impl/src/coordination-store.mjs:15141-15151`).
5. **Capability-shaped replies.** Hub message IDs are non-transferable reply capabilities bound to original orchestrator sender, authenticated worker recipient, Run, session/incarnation, and a bounded reply count; worker frames never name destinations.
6. **Parent-scoped inboxes.** Authorize one parent Run/wave/deployment scope, derive targets, and reauthorize before return, following current `run.follow` (`impl/src/application.mjs:8021-8039`, `impl/src/application.mjs:8061-8074`).
7. **Review-bound candidacy.** Candidacy wake and review reads require the live settlement/promotion lease; unauthorized observers learn neither count nor existence (`impl/src/coordinator.mjs:10121-10155`, `impl/src/application-semantics.mjs:1197-1202`).
8. **Audit reads without epistemic promotion.** `context.read` is first-class evidence of exposure, not evidence of truth; existing Scratch promotion's independent verified-reader conditions remain isolated (`impl/src/coordination-store.mjs:14370-14384`).

## 8. Evidence index

| Question | Decisive anchors |
| --- | --- |
| Authenticated write admission pattern | `impl/src/claude-session.mjs:86-102`; `impl/src/claude-session.mjs:994-1024`; `impl/src/coordinator.mjs:11033-11043`; `impl/src/coordinator.mjs:9846-9876`; `impl/src/coordination-store.mjs:13205-13209` |
| Bounded knowledge serving | `impl/src/messages.mjs:477-482`; `impl/src/messages.mjs:500-535` |
| Current knowledge reads do not impose a Run horizon | `impl/src/coordinator.mjs:9764-9782`; `impl/src/coordination-store.mjs:15178-15195`; `impl/src/coordination-store.mjs:15208-15215`; `impl/src/coordination-store.mjs:15437-15451` |
| Existing workflow horizon is global for KG | `impl/src/coordinator.mjs:10272-10296`; `impl/src/coordinator.mjs:10299-10338` |
| Board Run-binding and framing | `impl/src/coordination-store.mjs:13674-13715`; `impl/src/coordination-store.mjs:13736-13739`; `impl/src/coordination-store.mjs:13963-13979` |
| Scratch read evidence class | `impl/src/coordination-store.mjs:13138-13157`; `impl/src/coordination-store.mjs:14370-14384` |
| Existing context packages have no stale head | `impl/src/coordination-store.mjs:9148-9160`; `impl/src/coordination-store.mjs:9285-9334`; `impl/src/coordination-store.mjs:9358-9372` |
| KG expiry machinery | `impl/src/coordination-store.mjs:15141-15151`; `impl/src/coordination-store.mjs:3739-3742` |
| Current follow authorization model | `impl/src/application.mjs:8021-8039`; `impl/src/application.mjs:8061-8074` |

## Verification

Required deployment verification executed with executable `true`, argv `[]`, working directory `.`: exit code `0`.

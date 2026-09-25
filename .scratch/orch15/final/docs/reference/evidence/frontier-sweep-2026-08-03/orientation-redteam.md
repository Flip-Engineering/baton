# Epic #81 orientation contract — adversarial red-team

## Scope and method

Target: `docs/reference/evidence/frontier-sweep-2026-08-03/orientation-contract.md`, draft v1 for epic #81. This is a contract review, not an implementation review: a future-facing decision can still fail if its authority, lifecycle, or acceptance semantics are not determinate. The contract itself says BD3-A has not landed (`orientation-contract.md:13-20`), and the shipped ATLAS card exposes capability operations rather than the proposed worker query family (`impl/src/atlas-index.mjs:245-264`).

Verdicts mean:

- **CONFIRMED-HOLE** — shipped code contradicts a claimed defense, or the proposed rule violates the binding campaign law.
- **NEEDS-AMENDMENT** — the direction can work, but an authority or lifecycle choice is still open and therefore cannot be evaluated uniquely.
- **DEFENDED** — the attack is closed by a concrete invariant and an acceptance check.

All code claims below use line-numbered source evidence. No implementation file was modified.

## Executive verdict

The contract is **not ready to implement unchanged**. Ledger: three `CONFIRMED-HOLE`, five `NEEDS-AMENDMENT`, zero wholly `DEFENDED`. Individual sub-defenses are sound — zero-weight `context.read`, bounded tiers, content integrity, no merge/verification authority, source labels, and honest partial results should remain — but none rescues its whole decision.

The highest-risk findings are:

1. Resume is currently bearer-only. Cartographer validates the cursor/ref digest, then returns the stored page; it accepts no viewer, task, run, or scope coordinate (`impl/src/cartographer-quartermaster.mjs:769-778`). O-5 calls that forgery defense sufficient (`orientation-contract.md:329-339`), but a valid cursor copied across workers bypasses the scope decision.
2. The claimed orientation-to-KG path does not exist even as a compatible gate shape. Promotion derives candidates only from task/driver events and Scratch facts (`impl/src/coordination-store.mjs:14337-14385`), while workflow admission accepts only `board.item_closed` and `package.admitted` Findings (`impl/src/coordination-store.mjs:14617-14645`).
3. O-4 cannot attach a `DerivedFrom`/“annotates” edge to an ATLAS module: `annotates` is not a KG edge type (`impl/src/coordination-store.mjs:136-137`), and every edge endpoint must already be a KG node (`impl/src/coordination-store.mjs:14314-14321`).
4. The campaign control law says “no clock” (`orientation-contract.md:22-27`), yet O-6 requires `context_pack_expired` (`orientation-contract.md:357-362`, `orientation-contract.md:469-474`), inherited from a wall-clock validity window (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:40-49`). This is a direct law violation.
5. The contract omits host-path redaction and artifact retention. Both ATLAS and cartographer put local artifact paths in returned refs (`impl/src/atlas-index.mjs:313-324`, `impl/src/cartographer-quartermaster.mjs:486-501`), and both CAS writers only create/read artifacts (`impl/src/atlas-index.mjs:277-283`, `impl/src/cartographer-quartermaster.mjs:442-457`).

## Decision ledger

| Decision | Verdict | Dispositive reason |
|---|---|---|
| O-1 orientation ladder | **NEEDS-AMENDMENT** | “Module,” range authority, framing schema, and change baseline are unresolved. |
| O-2 receipts as knowledge | **CONFIRMED-HOLE** | The alleged candidacy path rejects the new source class; `maxScanEvents` is not a write/flood bound. |
| O-3 freshness | **NEEDS-AMENDMENT** | `treeSha` is a base anchor, not a dirty-worktree snapshot; no atomic binding or serve/resume fence is specified. |
| O-4 generated + KG overlay | **CONFIRMED-HOLE** | No structural subject exists in the KG and the live admission gate excludes orientation candidates. |
| O-5 cursor/citation | **CONFIRMED-HOLE** | Integrity is checked, authorization is not; retention and path redaction are absent. |
| O-6 spawn L0 + pull L1/L2 | **NEEDS-AMENDMENT** | Publish/dispatch ordering and recovery are open, and timestamp expiry violates the control law. |
| O-7 ratings | **NEEDS-AMENDMENT** | The contract chooses neither an event schema nor server-derived identity/replay semantics. |
| O-8 surfaces/honest-empty | **NEEDS-AMENDMENT** | Availability is deployment-time cached and partial status exists only for SCIP export. |

## O-1 — the orientation ladder

### Verdict

**NEEDS-AMENDMENT.** The three-tier shape and byte ceilings are constructive controls, and the no-clearance provenance already exists (`impl/src/cartographer-quartermaster.mjs:486-501`). The contract nevertheless leaves its core identity — “module” — as an open question (`orientation-contract.md:511-513`), even though map shape, scope, overlay attachment, and region lookup all depend on it.

### Adversarial findings

- **Caller-controlled selectors remain an injection/scope lane.** O-1 accepts `scope?`, `module | pathGlob`, and `citation | range` (`orientation-contract.md:193-205`) but only says viewer scope will be re-derived (`orientation-contract.md:226-229`). The shipped cartographer treats `focus` and `symbolFocus.paths` as caller inputs and filters directly on them (`impl/src/cartographer-quartermaster.mjs:516-553`); it contains no path-scope admission. The safer shipped precedent derives `contextScope` from the plan node, then binds its digest into the source attestation (`impl/src/context-runtime.mjs:1217-1243`).
- **The injection defense names the wrong seam.** O-1 requires every comment/test invariant to be `wrapProse`-framed and rejects unframed leaves (`orientation-contract.md:218-222`). The cited anchor, `application-semantics.mjs`, only declares that `package.read` remains untrusted prose (`impl/src/application-semantics.mjs:1185-1203`). The actual wrapper merely adds `{provenance:'model-authored', untrusted:true}` (`impl/src/messages.mjs:371-378`); it does not define a closed orientation leaf schema or perform rejection. Framing is useful metadata, but the proposed “one closed renderer” is not specified.
- **“Recent” is neither pinned nor control-law clean.** Region output promises “recent change classes” (`orientation-contract.md:199-201`) without naming two trees or an event boundary. A time window would be a clock. A causally pinned predecessor/current pair is eval-able.
- **Detail range authority is incomplete.** The contract does not say whether a caller may name an arbitrary path/range or only descend from a map/region citation. Without parent-citation containment, detail is a raw-file read alias and can probe names outside the disclosed region.

### Amendment text

> **O-1 amendment — canonical structural coordinates and closed leaves.** A `moduleKey` is hub-derived as `{repoId, rootPath}` where `rootPath` is the deepest supported package/workspace root containing the file, or the file's first path segment (root files use `.`) when no supported manifest exists. The map records `moduleDigest = sha256(sorted member {path,contentDigest})`. Callers may request a module key or a descendant citation, but may not name `scope`; the hub derives `{runId,taskId,taskVersion,workerId,pathScope,scopeDigest}` from the admitted attempt and applies scope refusal before module/path existence lookup. `detail` MUST descend from a live map/region citation and MUST prove the requested range is contained in that citation's admitted scope.
>
> Every output leaf uses one closed union: `generated` leaves contain only typed structural fields; `curated` and source-comment leaves contain `{text, provenance:'model-authored'|'repository-prose', untrusted:true, sourceRef}`. The only provider renderer rejects unknown fields and any prose leaf without `untrusted:true`. “Recent changes” is replaced by “changes between explicitly cited `beforeTreeSha` and `afterTreeSha` (plus the cited overlay digest),” never a time window.

## O-2 — investigation receipts as knowledge

### Verdict

**CONFIRMED-HOLE.** Keeping `context.read` separate from weighted `scratch.read` is correct. The current Scratch promotion path deduplicates only by reader task and applies `minScratchReaders` (`impl/src/coordination-store.mjs:14370-14383`), so zero weight is the right farm guard. The hole is the next sentence: “high-value answers become candidacy candidates through the SAME promotion gate” (`orientation-contract.md:233-242`) is incompatible with the shipped gate.

### Adversarial findings

- **No candidate derivation.** `_deriveKnowledgePromotion` recognizes task creation, selected driver events, policy failure events, and `scratch.read` over Scratch facts; it has no generic evidence-class hook (`impl/src/coordination-store.mjs:14342-14385`). Workflow admission then rejects any candidate trigger except board close or package admission (`impl/src/coordination-store.mjs:14626-14631`). A future `context.read` event can be zero-weight and still never compound.
- **“High value” has no authority owner.** The contract does not say whether the model, worker, ATLAS, or orchestrator decides novelty. Letting a worker set `highValue:true` launders prose into KG candidacy; letting the hub infer it from free prose is nondeterministic and not re-verifiable.
- **The flood defense is false.** O-2 says `maxScanEvents` bounds event flooding (`orientation-contract.md:256-259`). The code only refuses promotion when `observedSeq` exceeds that ceiling (`impl/src/coordination-store.mjs:14337-14340`); it does not stop or coalesce read events. Past the ceiling, writes can continue while promotion wedges.
- **Replay identity is missing.** Shipped knowledge reads bind the normalized query and reader into a request digest and reject same-key/different-content replay (`impl/src/coordination-store.mjs:15437-15451`). O-2 specifies neither the server-derived reader tuple nor the idempotency key for `context.read`.

### Amendment text

> **O-2 amendment — receipts do not auto-author facts.** A successful orientation materialization appends at most one `context.read` per `{repoId,runId,taskId,taskVersion,workerId,op,normalizedQueryDigest,packDigest,freshnessDigest}`. Every identity and scope field is hub-derived. The idempotency key is hub-derived from that tuple; exact replay returns the prior event, and same-key/different-content refuses `context_read_conflict`. `context.read` has zero promotion weight, never satisfies any reader threshold, and never counts as progress.
>
> Compounding is a separate conversational action, `orientation.candidate.propose({packDigest,leafDigest})`. The hub resolves the cited immutable leaf, verifies that the proposing attempt previously received it, and mints an observed candidate with trigger `orientation.leaf_proposed`; callers cannot supply body, grounding, task identity, scope, or evidence. Amend the promotion/admission trigger vocabulary to admit that trigger only through the orchestrator/operator gate. Coalesce duplicate proposals by `{leafDigest,freshnessDigest}`. Replace the false `maxScanEvents` flood defense with constructive per-attempt receipt/proposal count and byte ceilings; exceeding them refuses before append.

## O-3 — freshness and tree pinning

### Verdict

**NEEDS-AMENDMENT.** Content + base tree is the right non-clock direction, but the proposed pair is not yet a complete effective-worktree identity.

### Adversarial findings

- **The base epoch is internally sound, not externally current.** ATLAS commits the entire derived projection to `epoch` (`impl/src/atlas-index.mjs:164-170`) and rechecks that projection when loading (`impl/src/atlas-index.mjs:294-310`). It does not bind that epoch to a git tree. Therefore those checks prove “this artifact matches itself,” not “this is the deployment base named by `treeSha`.”
- **`treeSha` does not name dirty overlay bytes.** Overlay scans a mutable worktree and hashes its file projections with the base epoch (`impl/src/atlas-index.mjs:172-185`). The contract calls `treeSha` authoritative and `overlay_digest` content (`orientation-contract.md:282-284`) but never defines a single freshness digest over `{baseTreeSha,indexEpoch,overlayDigest}` or an unchanged worktree fence through publication.
- **Generic resume does no freshness work.** ATLAS resume reads the old artifact and returns its stored provenance (`impl/src/atlas-index.mjs:407-426`); cartographer resume does the same (`impl/src/cartographer-quartermaster.mjs:769-778`). O-3's reverify rule therefore does not protect resume unless O-5 explicitly routes resume through current authority and recomputation.
- **Git-object snapshotting is a stronger shipped seam.** Repository Context requires a 40-hex deployment tree (`impl/src/context-runtime.mjs:487-496`), reads repository source from that git tree under server-derived scopes (`impl/src/context-runtime.mjs:390-419`), and binds tree/scope/source digests into an attestation (`impl/src/context-runtime.mjs:1228-1247`). Orientation should reuse that authority pattern for its base.

### Amendment text

> **O-3 amendment — one effective-source authority.** Index build MUST read the base from the deployment's immutable git object tree, not a mutable directory, and persist `{repoId,baseTreeSha,indexEpoch,baseInputsDigest}` as one attested record. Every answer and page carries `freshnessDigest = sha256({repoId,baseTreeSha,indexEpoch,overlayDigest,scopeDigest})`. Worktree overlay production is fenced: the hub captures the admitted attempt/worktree fence before scan and compares it again before publishing; divergence refuses `effective_tree_changed` and publishes no pack.
>
> Serve, reverify, and resume all re-derive the current attempt/scope, require the same base authority, and compare the complete freshness digest. Base mismatch refuses `orientation_base_stale`; overlay/fence mismatch refuses `effective_tree_changed`. No timestamp, TTL, or re-index cadence participates.

## O-4 — generated map with KG curation overlay

### Verdict

**CONFIRMED-HOLE.** Per-leaf source labels are a strong defense (`orientation-contract.md:314-317`), but the overlay has neither a legal structural target nor an eligible admission route.

### Adversarial findings

- **Impossible edge target.** O-4 asks for a `DerivedFrom`/annotates edge “to the ATLAS symbol/module” (`orientation-contract.md:304-309`). `annotates` is absent from the closed edge vocabulary (`impl/src/coordination-store.mjs:136-137`), and `DerivedFrom` requires both endpoints to be existing KG nodes (`impl/src/coordination-store.mjs:14314-14321`). ATLAS `repo.map` returns plain file records, not KG node IDs (`impl/src/atlas-index.mjs:369`).
- **Wrong admission gate.** The contract says the overlay is admitted exactly like any Finding (`orientation-contract.md:290-313`), but the settle-time gate only admits observed Findings minted by board close or package admission (`impl/src/coordination-store.mjs:14626-14645`). Orientation needs an explicit candidate trigger and structural subject.
- **Dangling behavior is contradictory.** “Refuses (overlay dropped for that leaf)” (`orientation-contract.md:305-309`) cannot be both whole-answer refusal and partial omission. Silent omission is unsafe; whole-map refusal lets one stale annotation deny every generated leaf.
- **Conflict and precedence are omitted.** Two admitted curated Findings can assert different purposes for the same module/digest. The KG already treats contradictions and supersession as explicit versioned edges (`impl/src/coordination-store.mjs:14322-14333`); the map merge needs a deterministic rule rather than array order.

### Amendment text

> **O-4 amendment — materialized structural subjects.** The orientation producer mints a hub-derived KG `Source` node for each `{repoId,moduleKey,moduleDigest,freshnessDigest}` before any overlay candidate. An overlay candidate is an observed `Finding` with trigger `orientation.overlay_proposed` and a `Cites` edge to that `Source`; callers may cite an existing leaf but may not name the Source node or author evidence coordinates. The workflow admission gate explicitly recognizes this trigger under the existing orchestrator/operator authority and idempotency/lease checks.
>
> At merge, a curated leaf applies only when its cited `moduleDigest` and freshness coordinates exactly match. A stale leaf is omitted with structured `overlayOmissions:[{findingId,reason:'overlay_dangling'}]`; generated structure still serves and the overall status is `partial`. Multiple live curated leaves for one field require an explicit live `Supersedes` winner; otherwise omit all conflicting curated values with `overlay_conflict`. Never select by event time or insertion order.

## O-5 — pagination cursor as citation

### Verdict

**CONFIRMED-HOLE.** Digest/offset validation defends corruption and casual forgery, not authorization. The title also conflates two objects: a cursor is continuation state, while the immutable pack/ref digest is the citation.

### Adversarial findings

- **Copied-cursor scope leak.** Cartographer resume checks only `budgetTokens`, cursor syntax, ref digest/handle, artifact existence/integrity, operation, and offset (`impl/src/cartographer-quartermaster.mjs:769-778`). It has no viewer or path scope. Anyone holding another worker's valid ref/cursor can read the next page.
- **Freshness is stored, not re-proved.** Resume copies `document.provenance` into the response (`impl/src/cartographer-quartermaster.mjs:776-778`). The contract promises current-tree refusal (`orientation-contract.md:334-339`) but does not state that resume must call the same admission/freshness gate before loading bytes.
- **Local path disclosure.** ATLAS includes `path` in initial and resumed refs (`impl/src/atlas-index.mjs:319-324`, `impl/src/atlas-index.mjs:420-425`); cartographer does likewise (`impl/src/cartographer-quartermaster.mjs:496-501`). A worker-facing context pack needs transport-safe refs, not filesystem locations.
- **No retention contract.** CAS write is create-if-absent and integrity-check (`impl/src/atlas-index.mjs:277-283`, `impl/src/cartographer-quartermaster.mjs:442-457`), while resume returns unavailable if the artifact is absent (`impl/src/atlas-index.mjs:407-415`). The contract says history/citations remain usable but defines neither a storage quota, roots, reclamation, nor the refusal after lawful reclamation.

### Amendment text

> **O-5 amendment — citation, continuation, and grant are distinct.** The pack digest is the citation. A cursor is an opaque continuation over `{packDigest,pageOffset,freshnessDigest,scopeDigest}` and conveys no authority. On every resume the hub re-derives the active attempt and viewer scope, proves that the cited pack was admitted to that attempt (or is a live head visible to it), checks freshness, then resolves the page. Scope refusal precedes artifact existence lookup. Copied cursors therefore fail with the constant scope refusal.
>
> Worker-visible refs contain only `{kind,handle,digest,bytes,mediaType}`; absolute/local `path` is internal-only. Orientation storage has deployment byte/count ceilings. Admission reclaims only unreferenced intermediate artifacts by deterministic reachability; live pack heads, active brief citations, event evidence, and KG citations are roots. If capacity remains exhausted, refuse before write with `orientation_storage_exhausted`. If an otherwise valid unrooted page was reclaimed, return `orientation_artifact_retired`, never an empty or newly generated page under the old cursor. No age/TTL controls reclamation.

## O-6 — spawn-time L0 and mid-turn pull

### Verdict

**NEEDS-AMENDMENT.** Server-derived path scope and digest citation are sound. Spawn publication ordering, idempotent crash recovery, and the control-law conflict remain unspecified.

### Adversarial findings

- **Publish/dispatch crash window.** O-6 says every brief receives L0 (`orientation-contract.md:345-355`) but does not order artifact write, pack admission, task/spawn event, and provider dispatch. A crash can leave an orphan pack or a durable task whose cited pack was never admitted.
- **Retry identity is absent.** Two identical workers may share content bytes, but their authority grants and receipt identities must not collapse. Conversely, retrying one spawn after crash must not mint a second task/pack grant.
- **The safer shipped pattern binds current attempt coordinates.** Context Runtime reuses an existing session only when run, tree, definition, goal, plan, node, task ID, and task version all match (`impl/src/context-runtime.mjs:1199-1216`), and derives scope from the node (`impl/src/context-runtime.mjs:1217-1223`). O-6 needs the same attempt binding, not only pack deduplication.
- **Clock violation.** The contract requires spawn failure for `context_pack_expired` (`orientation-contract.md:357-362`, `orientation-contract.md:469-474`), while its binding law prohibits clocks (`orientation-contract.md:22-27`). Upstream defines expiry as passing a validity window (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:46-49`).

### Amendment text

> **O-6 amendment — recoverable prepare/admit/dispatch.** Spawn uses a hub-derived idempotency key over `{runId,taskId,taskVersion,workerId,scopeDigest,freshnessDigest}`. First write the deterministic L0 artifact; second, atomically append the pack grant and task/spawn binding (or exact-replay that binding); only then dispatch the provider. A crash before append leaves an unreferenced reclaimable artifact; a crash after append resumes the same task and citation. Same-key/different-scope or freshness refuses. Content may deduplicate globally, but grants and `context.read` receipts remain attempt-scoped.
>
> Orientation packs have no wall-clock validity. They stop serving only through eval-able/constructive causal facts: non-head supersession (`context_pack_stale`), tree/overlay divergence, scope/attempt closure, explicit operator retirement, or storage retirement allowed by O-5. Remove `context_pack_expired` from orientation acceptance; do not import BD3-B timestamp validity into this epic.

## O-7 — bidirectional tooling reflection

### Verdict

**NEEDS-AMENDMENT.** Advisory-only ratings, no free text, and “never gates serving” are good constraints (`orientation-contract.md:382-392`). “A one-bit scratchpad kind or link relation” (`orientation-contract.md:372-380`) is still an unresolved protocol choice, and `(worker, pack)` is not sufficient authority identity.

### Adversarial findings

- **Identity/replay ambiguity.** Worker IDs can describe a process rather than a durable attempt. A respawn could rate twice, while two task versions on a reused worker could collide. The contract also does not say whether an opposite second rating conflicts, replaces, or is ignored.
- **Receipt possession is not proven.** Naming a digest is not evidence that the worker received that pack. Without binding to a prior grant/read event, a worker can rate guessed or leaked packs and learn whether they exist from differential errors.
- **Cache influence has no constructive bound.** Ratings may decide precomputation (`orientation-contract.md:374-377`). “Bounded count” is asserted (`orientation-contract.md:383-386`) without naming the per-attempt or per-pack ceiling, candidate aggregation, or deterministic tie behavior.

### Amendment text

> **O-7 amendment — one closed rating event.** Use a dedicated `orientation.rating_recorded` event, not a new free-form scratchpad kind. Its closed payload is hub-derived `{repoId,runId,taskId,taskVersion,workerId,packDigest,grantOrReadEventSeq,rating:'useful'|'missed'}`. The caller supplies only `{packDigest,rating}`. Admission first proves the attempt previously received/read the exact pack and returns one constant `orientation_rating_refused` for invisible, unknown, stale-task, and out-of-scope targets.
>
> The idempotency identity is `{taskId,taskVersion,packDigest}`: exact replay returns the prior event; an opposite second rating refuses `orientation_rating_conflict` and never overwrites history. At most one rating per granted pack per task attempt may append. Aggregates are advisory, content-digested, and may only prioritize work inside a fixed deployment precompute count/byte budget; they never change scope, freshness, serving, verification, or promotion authority.

## O-8 — surfaces, honest-empty, and ATLAS availability

### Verdict

**NEEDS-AMENDMENT.** The assembly does honestly detect a source-less non-JS/TS repository and tests that behavior (`impl/src/index.mjs:73-90`, `impl/test/atlas-orientation-red.test.mjs:186-203`). It computes availability once at deployment, however, and the proposed map-level partial rule is not inherited automatically from SCIP.

### Adversarial findings

- **Availability can become stale.** Deployment assembly runs `git ls-files` once and stores `availability` (`impl/src/index.mjs:85-90`); that frozen value is passed into ATLAS and cartographer (`impl/src/index.mjs:1299-1311`). Adding the first supported file after startup can leave an honest-*empty* label over non-empty results; deleting the last can leave `available` over empty results.
- **Partial status is operation-specific today.** `repo.map` exposes per-file `parseErrors` (`impl/src/atlas-index.mjs:369`), but only `scip.export` computes aggregate parse errors and passes `analysisStatus:'partial'` (`impl/src/atlas-index.mjs:380-393`). O-8's acceptance requires map/region partial labeling (`orientation-contract.md:407-415`, `orientation-contract.md:482-487`) and must make that a ladder invariant.
- **Polyglot completeness needs a coverage denominator.** “Honest-empty per module” is insufficient for a mixed module: supported files can produce a plausible map while unsupported files contain additional entry points or tests. A partial result needs supported, unsupported, excluded, and parse-error counts.

### Amendment text

> **O-8 amendment — answer-time coverage.** Availability is derived for every answer from the same scoped effective-source snapshot and freshness digest used to build that answer; the deployment-time flag is advisory card metadata only. Each tier returns `coverage:{totalFiles,supportedFiles,unsupportedFiles,excludedFiles,parseErrorFiles,parseErrorCount}`. Status is `orientation_unavailable` only when `supportedFiles===0`; it is `partial` when any in-scope file is unsupported, excluded, unreadable, or parse-failed; otherwise it is `ok`. Every summary and pack preserves the coverage object. No generated or curated leaf may claim completeness outside supported files, and curated leaves for an unsupported-only module do not upgrade availability.

## Cross-cutting authority attacks

### Identity derivation and scope binding

The contract repeatedly says “server-derived scope” but never pins the full subject. The existing Context seam demonstrates the necessary binding: current plan node and working task are validated (`impl/src/context-runtime.mjs:1153-1187`), existing sessions match exact task version and workflow coordinates (`impl/src/context-runtime.mjs:1199-1216`), and scope comes from the node (`impl/src/context-runtime.mjs:1217-1243`). Every pull, resume, rating, read receipt, pack grant, and candidate proposal must use the same `{repoId,runId,taskId,taskVersion,workerId,scopeDigest}` authority tuple. Caller-supplied `scope`, `workerId`, `taskId`, artifact path, and freshness claims are data at most and MUST be ignored or rejected.

### Injection and untrusted-content lanes

The contract correctly identifies comments, tests, curated purposes, and recalled KG text as untrusted. Shipped KG reads return a conspicuous untrusted frame on both first read and replay (`impl/src/coordination-store.mjs:15437-15451`). The orientation contract must go further than calling `wrapProse`: the wrapper only tags text (`impl/src/messages.mjs:371-378`). O-1's closed leaf union and provider-boundary rejection are required so a nested comment, overlay Finding, parse-error message, module purpose, or summary cannot bypass framing.

### Replay and idempotency

The best shipped pattern binds idempotency to normalized request content and rejects conflicts: knowledge reads do so at `impl/src/coordination-store.mjs:15437-15445`, and knowledge promotion revalidates prior actor/repo/boundary/policy/request before replay (`impl/src/coordination-store.mjs:14415-14434`). The contract needs that pattern for `context.read`, pack grants/spawns, continuation grants, candidate proposals, and ratings. A content digest alone deduplicates bytes; it does not deduplicate authority-bearing events.

### Scope leaks

Three lanes leak unless amended: valid copied cursors (cartographer resume has no viewer fields, `impl/src/cartographer-quartermaster.mjs:769-778`), absolute artifact paths in worker-visible refs (`impl/src/atlas-index.mjs:319-324`; `impl/src/cartographer-quartermaster.mjs:496-501`), and caller-named detail ranges. Constant scope refusal must occur before module/artifact existence checks, and transport projections must strip local paths.

## Cross-cutting lifecycle attacks

### Ordering and concurrency

Map computation observes a mutable overlay (`impl/src/atlas-index.mjs:172-185`) while spawn requires a durable pack/task binding. O-3's pre/post worktree fence and O-6's artifact-first, atomic grant+spawn append ensure that concurrent edits or crashes cannot publish an answer under the wrong task attempt.

### Crash recovery and partial publication

CAS writes are naturally replay-friendly because create-if-absent is followed by digest verification (`impl/src/atlas-index.mjs:277-283`; `impl/src/cartographer-quartermaster.mjs:442-450`). They are not a transaction with coordination state. An orphan artifact is acceptable only if unreferenced artifacts are reclaimable; a durable spawn is acceptable only after its pack grant is durable and exact-replayable. O-6's amendment pins those recovery states.

### Retention and garbage collection

The current artifact stores expose write/load/resume but no ownership roots in their result schemas (`impl/src/atlas-index.mjs:313-324`; `impl/src/cartographer-quartermaster.mjs:486-501`). O-5 therefore adds constructive byte/count admission ceilings and reachability-based reclamation. Wall-clock age is forbidden; live citations remain roots, and admission refuses before uncontrolled disk growth.

### Freshness and invalidation

An immutable artifact digest proves old bytes, not current applicability. ATLAS generic reverify reruns and compares result digests (`impl/src/atlas-index.mjs:395-405`), while generic resume merely serves stored bytes (`impl/src/atlas-index.mjs:407-426`). The same authority/freshness check must precede initial serve, resume, spawn materialization, KG overlay merge, and rating target resolution.

## Campaign control-law audit

**Result: NOT HONORED everywhere.** The byte bounds, per-attempt count bounds proposed here, content digests, source/freshness verification, causal head CAS, explicit candidate proposal, and advisory one-bit feedback are constructive, eval-able, or conversational. The following contract controls fail the binding rule:

1. `context_pack_expired` is required at spawn (`orientation-contract.md:357-362`, `orientation-contract.md:469-474`) and upstream defines it by a passed validity window (`docs/reference/evidence/bidirectional-v3-2026-08-02/bidirectional-v3-decisions.md:46-49`). That is a clock.
2. “Recent change classes” (`orientation-contract.md:199-201`) has no causal boundary and can easily become a time window.
3. Any retention policy based on artifact age would repeat the error; the contract currently has no retention rule.

Required law amendment:

> **Campaign-law amendment.** Orientation MUST NOT read `now`, compare validity timestamps, use TTLs, count turns, or limit service by elapsed time. Replace `context_pack_expired` with causal invalidation: supersession/head mismatch, explicit operator retirement, attempt closure, scope change, tree/overlay divergence, or deterministic reachability retirement under a declared storage ceiling. Replace “recent” with an explicit predecessor/current tree pair. All ceilings are byte/item/event-count ceilings checked before work or append.

## Completeness gaps the contract missed

1. **Transport-path disclosure.** Worker-visible refs currently include absolute/local artifact paths (`impl/src/atlas-index.mjs:319-324`, `impl/src/atlas-index.mjs:420-425`, `impl/src/cartographer-quartermaster.mjs:496-501`). The contract attacks code scope but never host filesystem topology. O-5 now requires a path-free transport projection.
2. **CAS retention and exhaustion.** Artifact writers create content-addressed files and verify them (`impl/src/atlas-index.mjs:277-283`; `impl/src/cartographer-quartermaster.mjs:442-457`), while cursors depend on later artifact availability (`impl/src/atlas-index.mjs:407-415`). The contract names neither roots nor quotas nor crash-orphan cleanup. O-5 supplies constructive capacity admission and reachability GC.
3. **Dynamic language-ceiling drift.** Availability is frozen from a deployment-time file listing (`impl/src/index.mjs:73-90`) and passed into both capabilities (`impl/src/index.mjs:1299-1311`). O-8 now recomputes coverage from the answer's effective snapshot.
4. **Overlay conflict resolution.** O-4 handles a dangling annotation but not two live curated assertions. The KG already has explicit contradiction/supersession validation (`impl/src/coordination-store.mjs:14322-14333`); O-4 now requires a live supersession winner or partial omission.

## Required contract amendments

Acceptance requires all eight amendment blocks above. In compact dependency order:

1. Define canonical module/structural coordinates, hub-derived attempt/scope authority, descendant-only detail, and one closed untrusted leaf renderer (O-1).
2. Specify coalesced, idempotent, zero-weight `context.read`; split explicit leaf proposal from reading; add the new candidate/admission trigger (O-2).
3. Bind immutable base tree, epoch, overlay, scope, and worktree fence into one freshness digest checked on every serve path (O-3).
4. Materialize a KG structural `Source`, use legal `Cites` edges, and define stale/conflicting overlay partial behavior (O-4).
5. Separate citation from cursor and grant; reauthorize every resume; strip paths; add constructive storage retention (O-5).
6. Pin artifact/admission/spawn ordering and exact crash replay; remove timestamp expiry (O-6).
7. Add a dedicated attempt-bound one-bit rating event with exact replay/conflict and advisory-only bounded aggregation (O-7).
8. Recompute coverage per answer and propagate partial/unavailable status across every tier (O-8).
9. Apply the campaign-law amendment: no timestamp, TTL, elapsed-time, turn-count, or age-based orientation control.

## Verification

- Skeleton/stub check: no drafting stub or placeholder remains.
- Scope check: `git status --short` reports only `docs/reference/evidence/frontier-sweep-2026-08-03/orientation-redteam.md` as untracked; no `impl/` file changed.
- Patch hygiene: `git diff --check` exited 0.
- Required deployment verification: executable `true`, arguments `[]`, working directory `.`, exit code **0**.

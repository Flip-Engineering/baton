# Coordination lane architecture findings

Provenance: bend2-arch-coordination-lane, contribution-f298f891ae027b52f25d81ba3264ece5.

Revision read: `bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b`. The lane was read only; this file preserves its accepted contribution on the branch.

## F1. capacity authorities merge

**Deletion or merge.** MERGE host-capacity.mjs and worktree-capacity.mjs into one lease substrate. host-capacity.mjs:20-23 states it uses 'the ONE published-owner protocol the per-repo worktree capacity ledger proved (worktree-capacity.mjs)', yet the protocol is re-implemented function-by-function: atomicWrite is line-identical (host-capacity.mjs:78-95; worktree-capacity.mjs:260-277), likewise publishExclusive (host-capacity.mjs:97; worktree-capacity.mjs:269-273), livePid (host-capacity.mjs:117-119; worktree-capacity.mjs:280-282), observe/publish/confirm/remove/reap (host-capacity.mjs:500-601; worktree-capacity.mjs:445-655), and two bounded wait loops with separate LOCK_POLL_MS/LOCK_WAIT_MS constants (host-capacity.mjs:56-57,575-601; worktree-capacity.mjs:42-43,522-634). Two derived-floor regimes re-derive one arithmetic: deriveHostCapacity (host-capacity.mjs:230-247, re-run inside every mutex turn at 713-716) vs deriveWorktreeCapacityFloor plus #effectiveFloor (worktree-capacity.mjs:158-171,324-352).

**Evidence.** impl/src/host-capacity.mjs:20-23,78-95,117-119,230-247,500-601,575-601,713-716; impl/src/worktree-capacity.mjs:42-43,158-171,260-277,324-352,445-655,522-634; docs/43-host-capacity-and-derived-floors.md:17-32,60-64

**Source files.** [impl/src/host-capacity.mjs](../../impl/src/host-capacity.mjs), [impl/src/worktree-capacity.mjs](../../impl/src/worktree-capacity.mjs).

**Tests.** impl/test/worktree-capacity-contention.test.mjs WCC1-WCC11 (real child-process contention, dead-holder reap exactly once, refuse-not-steal, settle by owner identity); impl/test/worktree-capacity-physical-admission.test.mjs; impl/test/async-lock-wait-285-red.test.mjs G-42a/b/c.

**Loss if wrong.** the two floors are coupled arithmetic (verdictLanes from usable cores funds suite and worktree reservations); dropping either side's accounting over-admits verify leases into host memory exhaustion or stalls admission behind a reservation the other module no longer settles.

## F2. idempotency stack

**Deletion or merge.** COLLAPSE the four idempotency layers between the swarm client and the ledger into one at-most-once operation type. Layer 0: the client mints options.idempotencyKey ?? randomUUID() per effectful call (swarm-client.mjs:51-53) and the bridge mints its own randomUUID when omitted (swarm-native-bridge.mjs:908-918). Layer 1: SwarmRuntime._once folds (command,swarmId,principal,key) into 'swarm-operation:<sha256>' and records request/completed/unavailable rows under suffixed keys plus an in-flight Map (swarm-runtime.mjs:2367-2427, verified this session). Layer 2: per-row composed keys such as 'swarm-reroute:<swarmId>:<participantId>:<seq>' and 'swarm-writer-bypass:<key>' (swarm-runtime.mjs:1905,3541). Layer 3: ledger _byKey dedupe returning the prior event on a repeated key (coordination-ledger.mjs:1191-1197). Three key grammars share one flat _byKey namespace (coordination-internals.mjs:785-788).

**Evidence.** impl/src/swarm-runtime.mjs:2367-2427; impl/src/swarm-client.mjs:51-53; impl/src/swarm-native-bridge.mjs:908-918; impl/src/coordination-ledger.mjs:1191-1197; impl/src/coordination-internals.mjs:785-788

**Source files.** [impl/src/swarm-runtime.mjs](../../impl/src/swarm-runtime.mjs), [impl/src/swarm-client.mjs](../../impl/src/swarm-client.mjs), [impl/src/swarm-native-bridge.mjs](../../impl/src/swarm-native-bridge.mjs), [impl/src/coordination-ledger.mjs](../../impl/src/coordination-ledger.mjs).

**Tests.** impl/test/bridge-idempotency-344.test.mjs:6-8,44,107,125,208 (key derives over every argument axis; reads are keyless); impl/test/briefing-pack-red.test.mjs:82-86 (fresh-key same-content re-mint returns idempotent, ledger length unchanged); impl/test/swarm-coordination.test.mjs:71-74.

**Loss if wrong.** exactly-once effect execution is the swarm correctness law; a weakened _once lets a replayed swarm.capture capture twice or a replayed recruit roll back twice. An affine/linear operation capability per caller intent makes the three-state row protocol a type property instead of a protocol.

## F3. seam delegate layer

**Deletion or merge.** DELETE the seam-split delegate layer. The #259 split physically moved members into modules while the owning classes keep same-name one-line delegates, so every member name exists twice: CoordinationStore delegates (coordination-store.mjs:564,632,663,707-709 and ~40 admission delegates), Coordinator keeps delegates for runtime-effects/recovery/observation/admission/api/briefing. In the committed seam inventory 981 of 2670 members classify purely through *_port delegate rules, and coordination-store.mjs alone carries 604 members across all five seams (admission 175, observation 243, effect 26, recovery 52, surface 108). runtime-recorder-port.mjs:18-45 is a hand-built interface object created only so moved bodies stop touching the store directly. A language with first-class modules, traits or free functions expresses the same split with no shims, and the four map-delegates-exports bijection tests plus the #510 floor test exist only to keep the shims honest.

**Evidence.** impl/scripts/seam-inventory.json: aggregate counts computed this session (2670 members, 981 port-delegate, store 604); impl/scripts/seam-inventory.mjs:265-307 (the port rules that make the shims classifiable); impl/src/runtime-recorder-port.mjs:18-45

**Source files.** [impl/src/coordination-store.mjs](../../impl/src/coordination-store.mjs), [impl/scripts/seam-inventory.json](../../impl/scripts/seam-inventory.json), [impl/scripts/seam-inventory.mjs](../../impl/scripts/seam-inventory.mjs), [impl/src/runtime-recorder-port.mjs](../../impl/src/runtime-recorder-port.mjs).

**Tests.** impl/test/coordination-internals.test.mjs:187, coordination-admission.test.mjs:193, coordination-ledger.test.mjs:204-221,380, runtime-recovery.test.mjs:86 (four bijection checks); impl/test/seam-inventory-target-floor.test.mjs:24-75 (floor SI7/SI7b/SI7c); impl/test/seam-inventory.test.mjs:160-171 (SI3 overwrites the committed artifact and restores it in a finally).

**Loss if wrong.** the countable seam map (issue #259) and its floor (#510) are the review substrate for the split; collapsing the shims without keeping the bijection property would leave entanglement unmeasurable and let the monolith regrow unseen.

## F4. ledger append and drift merge

**Deletion or merge.** MERGE the ledger's duplicated durability machinery into one append path, one drift check and one atomic-write recipe. Two append paths duplicate byte-build, append, group-commit schedule, hash update, index push and fold inline: _append (coordination-ledger.mjs:1183-1219) vs _appendBatch (:1239-1318). The ledger-drift triple check (bytes, digest, count) exists in three copies: incremental _ledgerMatchesLoadedProjection (coordination-ledger.mjs:1100-1104), inline in _projectionCheckpointWriteSteps (coordination-ledger-writes.mjs:371+) and again in compact (:658-666). Seven copies of the temp-wx-fsync-rename-dirfsync recipe: quarantine (coordination-ledger.mjs:118-131), receipt (coordination-ledger-writes.mjs:358-366), checkpoint (:441-461), segment (:607-623), segment index (:629-644), window rewrite (:701-715), lease claim variant (:499-532). One cross-process race is guarded three ways: file claim plus claim-token window (coordination-ledger-writes.mjs:493-541), in-memory _writerLease flag (:318-319), and per-append disk re-read _assertLeaseOwnership (coordination-admission.mjs:220-232).

**Evidence.** impl/src/coordination-ledger.mjs:1100-1104,1183-1219,1239-1318; impl/src/coordination-ledger-writes.mjs:318-319,358-366,371-463,493-541,607-715; impl/src/coordination-admission.mjs:201-232

**Source files.** [impl/src/coordination-ledger.mjs](../../impl/src/coordination-ledger.mjs), [impl/src/coordination-ledger-writes.mjs](../../impl/src/coordination-ledger-writes.mjs), [impl/src/coordination-admission.mjs](../../impl/src/coordination-admission.mjs).

**Tests.** impl/test/coordination-internals.test.mjs:360-394 (CI5 newline-complete ledger, sha-pinned events.jsonl, restart replay); impl/test/coordination-ledger.test.mjs:383,397-400; impl/test/coordination-admission.test.mjs:362,382-386 (same decisions, same ledger bytes); impl/test/coordination-ledger-writes.test.mjs:259-269 (compaction); impl/test/checkpoint-deferred-229-red.test.mjs:36.

**Loss if wrong.** durability is the property that all three module-move test triples byte-pin; a wrong merge risks a torn or poisoned ledger, after which every write refuses until restart (coordination-admission.mjs:207-215).

## F5. waiting primitive

**Deletion or merge.** COLLAPSE three poll cadences into the store's existing event-driven wait. The host lease queue parks callers in a for(;;) loop sleeping 250 ms per turn (host-capacity.mjs:60,767; DEFAULT_POLL_MS), each turn re-deriving the whole capacity observation (host-capacity.mjs:713-716); drain convergence polls _sleep(min(drainPolicy.pollMs, ...)) with pollMs:10 (runtime-admission.mjs:85; coordinator.mjs:1208-1215); ceiling-deferred dispatch resumes only when _dispatchPass is re-driven per tick or on release edges (coordinator.mjs:566-567,6118,6599; runtime-effects.mjs:1468). Only the stop waiter is event-woken (runtime-admission.mjs:1853-1856). The coordination ledger already owns the right primitive: waitAfter parks on _appendWaiters and _notifyAppend resolves it (coordination-ledger-writes.mjs:761-800; coordination-ledger.mjs:1320-1324). Also merge the admission predicate triplication: withinConcurrencyCeiling (concurrency-policy.mjs:25-29) is re-implemented inline at runtime-admission.mjs:1149 ('ceiling !== null && inFlight >= ceiling', verified this session) while router.mjs and index.mjs import the shared predicate.

**Evidence.** impl/src/host-capacity.mjs:56-60,271,703,713-716,721-726,767; impl/src/runtime-admission.mjs:85,1149,1853-1856; impl/src/coordinator.mjs:566-567,1208-1215; impl/src/concurrency-policy.mjs:25-29; impl/src/coordination-ledger-writes.mjs:761-800; docs/43-host-capacity-and-derived-floors.md:41-45

**Source files.** [impl/src/host-capacity.mjs](../../impl/src/host-capacity.mjs), [impl/src/runtime-admission.mjs](../../impl/src/runtime-admission.mjs), [impl/src/concurrency-policy.mjs](../../impl/src/concurrency-policy.mjs), [impl/src/coordination-ledger-writes.mjs](../../impl/src/coordination-ledger-writes.mjs).

**Tests.** impl/test/async-lock-wait-285-red.test.mjs:75,100-101 (contended acquisition refuses at deadline pre-effect); impl/test/concurrency-policy-admission.test.mjs:182,258-261,276,294 (null unbounded, selection is not admission, durable task.dispatch_deferred, admits on release); impl/test/coordinator.test.mjs:481,500-502.

**Loss if wrong.** deadline refusals and FIFO position semantics (typed host_capacity_queue_timeout; no ledger byte written before effect) are what the tests pin; a wrong merge either busy-loops the event loop or loses the bounded-wait refusal.

## F6. refusal vocabulary merge

**Deletion or merge.** MERGE the two refusal builders into the one registry they already share, then delete the pair table. The fold refuses through swarm-state's refuse() with codes like participant_not_found; the runtime refuses through swarm-runtime's refuse() with swarm_-prefixed codes for the same rules. swarm-refusals.mjs:24-27 documents that codes are NOT renamed because renaming breaks pinned tests and recorded ledgers, and SWARM_REFUSAL_SAME_RULE_PAIRS (:191-198) lists six same-rule pairs as 'what a later collapse lane reads'. A second renderer maps codes to HTTP again beside the registry's status column (swarm-native-bridge.mjs:100-103,148-152).

**Evidence.** impl/src/swarm-refusals.mjs:4-8,24-31,191-198; impl/src/swarm-native-bridge.mjs:100-103,148-152

**Source files.** [impl/src/swarm-refusals.mjs](../../impl/src/swarm-refusals.mjs), [impl/src/swarm-state.mjs](../../impl/src/swarm-state.mjs), [impl/src/swarm-runtime.mjs](../../impl/src/swarm-runtime.mjs), [impl/src/swarm-native-bridge.mjs](../../impl/src/swarm-native-bridge.mjs).

**Tests.** impl/test/swarm-refusals.test.mjs (closed-set rows and construction-time guard).

**Loss if wrong.** the registry exists because the second vocabulary crossed the web as 503 temporarily_unavailable, telling operators to retry a request fault (swarm-refusals.mjs:4-8); collapsing by renaming without the ledger-compat row migration would re-create that incident for every recorded swarm row.

## F7. wake consumers merge

**Deletion or merge.** MERGE the three wake derivations of one ledger into one stream primitive, and move the transports into a library. The per-swarm _watch long-poll (swarm-runtime.mjs:4778-4873), the deployment-scope WakeStream whose cursor IS the ledger seq (wake-stream.mjs:619-628,768-833), and the CLI summary (application-cli.mjs swarmWakeSummary) each implement cursor-advance, filter, byte-bound and park on the same ledger; wake-stream.mjs:26-28 says so itself ('the per-swarm wake derivation already exists... this module consumes the same ledger and never re-derives a swarm fold state, so the two can disagree about nothing but scope'). Alongside them a hand-rolled RFC 6455 implementation lives inside the orchestration module: acceptKey sha1, frame encode, incremental frame reader (wake-stream.mjs:1008-1189) because Node's stdlib has no WebSocket server. A second, parallel notification path bypasses the ledger entirely: observation classes polled every observationMs and diffed by JSON.stringify signature, with no durable row and no resume, lossy on reconnect unless announceStanding (wake-stream.mjs:630-636,741-754).

**Evidence.** impl/src/wake-stream.mjs:10-14,26-28,619-628,630-636,741-754,768-833,1008-1189; impl/src/swarm-runtime.mjs:4778-4873; docs/54-native-wake.md:3-7,20-24

**Source files.** [impl/src/wake-stream.mjs](../../impl/src/wake-stream.mjs), [impl/src/swarm-runtime.mjs](../../impl/src/swarm-runtime.mjs).

**Tests.** impl/test/wake-stream.test.mjs:100-103,128,145,207,248,291,345 (closed table, refusal naming the set, one attachment sees all swarms including later ones, resume with no gap and no duplicate); impl/test/swarm-wake.test.mjs:80,110,160,199.

**Loss if wrong.** the tests pin no-gap no-duplicate cursor resume over a real resident; a wrong merge extends the observation classes' reconnect hole to ledger classes, which are the wakes a peer acts on.

## F8. affine custody tokens

**Deletion or merge.** TYPE four ad-hoc linear tokens and the custody flag table as one affine lease/custody discipline. Today each is a bearer string or opaque object with single-use enforced by convention: recovery-attempt ids minted from digest chains with settle-once flags (recovery-attempt.mjs:85-146; runtime-recovery.mjs:1469-1477); an opaque Object.freeze({}) startup authority compared by identity (index.mjs:1333; runtime-recovery.mjs:951-957); the drain kill token compared at admission (runtime-admission.mjs:2471-2473; coordinator.mjs:3850); the capacity lock generation released only on exact owner+generation match (worktree-capacity.mjs:664-672). Workspace custody itself is boolean fields on a mutable handle cleared at seven sites by one transition table written out seven times (runtime-recovery.mjs:708-713,720-727,733-738,789-800; runtime-observation.mjs:1633-1638; runtime-recorder-port.mjs:54-59; coordinator.mjs:4370-4375), with states named only as strings 'holders_remain'/'content_retained'. The commit-observation wrapper exists for the same reason: the checkout has no type-level exclusivity, so a generated sh script spools every commit for the runtime to attribute and bypass-record (runtime-isolation.mjs:113-119,200-372).

**Evidence.** impl/src/runtime-recovery.mjs:708-800,951-957,1107-1121,1469-1477; impl/src/runtime-recorder-port.mjs:52-59; impl/src/worktree-capacity.mjs:664-672; impl/src/runtime-isolation.mjs:113-119,200-372; impl/src/shared-workspace-custody.mjs:15-21; docs/45-open-coordination.md:230-253

**Source files.** [impl/src/shared-workspace-custody.mjs](../../impl/src/shared-workspace-custody.mjs), [impl/src/runtime-recovery.mjs](../../impl/src/runtime-recovery.mjs), [impl/src/recovery-attempt.mjs](../../impl/src/recovery-attempt.mjs), [impl/src/worktree-capacity.mjs](../../impl/src/worktree-capacity.mjs), [impl/src/runtime-isolation.mjs](../../impl/src/runtime-isolation.mjs).

**Tests.** impl/test/shared-workspace-custody.test.mjs:231,268,318,368,392,425,489,513,532 (T1-T9); impl/test/swarm-coupling.test.mjs:243,331 (one writer per checkout; leaving member hands off); impl/test/swarm-state.test.mjs:1262; impl/test/worktree-capacity-contention.test.mjs:481,528,597 (settle by exact owner identity, never shared pid).

**Loss if wrong.** the invariant a peer must detach rather than destroy the resource underneath it (shared-workspace-custody.mjs:17-21) is what T1-T9 and the coupling tests pin; an affine model that cannot express handoff (claims, leases, reincarnation handoff) either deadlocks custody transfer or reintroduces destroy-under-a-live-holder.

## F9. schema layer merge

**Deletion or merge.** MERGE the payload shape layer: one schema source should both describe and enforce. Today four spellings of the same shapes exist: the declarative DSL in swarm-event-schemas.mjs (STRING/JSON_VALUE/STRING_ARRAY/VERSION helpers :33-46, payload tables :79-207), which self-describes as 'Deliberately NOT a second domain validator' (:4-6); the enforcing hand-written if-ladder validateSwarmEvent in swarm-state.mjs:414-560+, re-run at replay with an admission flag (:1262-1266); the argument admission in swarm-contract.mjs:848-948 with a fourth JSON-schema spelling for the MCP wire (:995-1030); and contribution-contract.mjs's own identical STRING/STRINGS/BOOLEAN helpers with its own validator (:38-44,158-241). Schema-vs-validator agreement is machine-checked only for description/example presence (swarm-event-schemas.mjs:504-507). In a language with records and derived codecs the validator is generated and the drift check is the compiler.

**Evidence.** impl/src/swarm-event-schemas.mjs:4-9,33-46,504-507; impl/src/swarm-state.mjs:414-560,1262-1266; impl/src/swarm-contract.mjs:848-948,995-1030; impl/src/contribution-contract.mjs:38-44,158-241

**Source files.** [impl/src/swarm-event-schemas.mjs](../../impl/src/swarm-event-schemas.mjs), [impl/src/swarm-state.mjs](../../impl/src/swarm-state.mjs), [impl/src/swarm-contract.mjs](../../impl/src/swarm-contract.mjs), [impl/src/contribution-contract.mjs](../../impl/src/contribution-contract.mjs).

**Tests.** impl/test/swarm-state.test.mjs:714 (byte-identical replay), :976 (admission/replay parity); impl/test/swarm-event-schemas.test.mjs if present in suite pins; contribution contract validator pinned by the swarm bridge contract tests.

**Loss if wrong.** the live-write and replay-validation halves must stay one logic; a split that lets a row be admitted live but refused at restart wedges that restart, and the refusals that teach agents the admitted values (#371) stop matching what the fold enforces.

## F10. canonical digest dedup

**Deletion or merge.** DEDUPLICATE the canonical-JSON sort-keys digest into the one exported module, or into the language. coordination-internals.mjs:169-181 exports canonical/canonicalDigest/digest and runtime modules use it, yet in-scope modules keep private copies: contribution-verification.mjs:3-7 (toolchain projection digests), run-timeline.mjs:82-84, worktree.mjs:968-972 (owner receipts), recovery-attempt.mjs:7-16, worktree-capacity.mjs:30-34, swarm-state.mjs:401-406 (canonicalClone for byte-identical projections), plus a sixth bounded variant canonical-order.mjs:95; repo-wide the sort-keys idiom recurs in dozens of files (spot count: createHash in 80+ files of impl/src). The same mechanism powers content addressing of ledger rows, receipts, briefs and cursors, and byte-stability pins such as the task.brief digest staying byte-stable across augmentation (runtime-briefing.mjs:7-8,114-118) are enforced by hand-freezing copies.

**Evidence.** impl/src/coordination-internals.mjs:169-181,237-239 (replFenceKey and scratchpadScopeKey are character-identical functions),254-258; impl/src/contribution-verification.mjs:3-7; impl/src/run-timeline.mjs:82-84; impl/src/canonical-order.mjs:95+; impl/src/worktree.mjs:968-972; impl/src/recovery-attempt.mjs:7-16; impl/src/worktree-capacity.mjs:30-34

**Source files.** [impl/src/coordination-internals.mjs](../../impl/src/coordination-internals.mjs), [impl/src/contribution-verification.mjs](../../impl/src/contribution-verification.mjs), [impl/src/run-timeline.mjs](../../impl/src/run-timeline.mjs), [impl/src/canonical-order.mjs](../../impl/src/canonical-order.mjs), [impl/src/worktree.mjs](../../impl/src/worktree.mjs).

**Tests.** impl/test/swarm-state.test.mjs:714 (replaying same event sequence produces byte-identical snapshot); impl/test/swarm-replay-corpus.test.mjs:27,46,90 (committed ledger fixtures replay to sidecar digests, deterministic extractor).

**Loss if wrong.** digests are Baton's identity and replay-equality mechanism; two canonicalizers that disagree on one edge (key order at depth, unicode surrogates — a manual UTF-16 surrogate scanner exists at coordination-internals.mjs:254-258) produce rows that replay to a different digest than they were written with.

## F11. history and js artifacts

**Deletion or merge.** RECORD history-caused seams a rewrite should not carry forward. (1) wake-stream.mjs:10-14: before issue #294 every root-side feed was one 'baton swarm watch --follow' child per swarm filtered by grep and re-armed by hand; the module replaces that mechanism. (2) Issue #541 moved the load gate rather than deleting it: admission never refuses for load or waiting (host-capacity.mjs:17-18,271,703), but saturated still forces defaultSuiteParallelism to one lane (host-capacity.mjs:347) and a memory-tight verify silently proceeds without any lease (host-capacity.mjs:721-726) — exclusion is dropped exactly when the host is weakest; suiteLanes appears in the derivation's doc table (:219-223) but in no function's return (:345-350). (3) Three byte-identical 'same ledger bytes after the move' sha pins exist only because the split needed per-module behavior preservation (coordination-internals.test.mjs:381-384, coordination-ledger.test.mjs:397-400, coordination-admission.test.mjs:382-386) — one durability property test would replace them. (4) impl/scripts/expected-red.json is a vestigial twin of expected-red-tests.json (suite-manifest-reasons.test.mjs:12,20-21). (5) Node-specific deletions: the /bin/ps -o lstart= subprocess for lease staleness (coordination-ledger-writes.mjs:104-121), v8 serialize prototype-flattening workaround with nullPrototypeFields re-application (coordination-ledger-writes.mjs:59-71,427-434), JSON-string key interning in three schemes (coordination-internals.mjs:237-239, coordination-ledger.mjs:95-97, coordination-replay.mjs:712-760), event-loop yield choreography for long folds (coordination-replay.mjs:349-352), and hubCores=1 reserving the one event loop inside every derived floor (docs/43-host-capacity-and-derived-floors.md:23).

**Evidence.** impl/src/wake-stream.mjs:10-14; impl/src/host-capacity.mjs:17-18,271,347,703,721-726,219-223,345-350; impl/src/coordination-ledger-writes.mjs:59-71,104-121,427-434; impl/src/coordination-internals.mjs:237-239,254-258; docs/43-host-capacity-and-derived-floors.md:23,52-54,60-64; docs/48-reincarnation-in-place.md:21-24,471-479,571-592

**Source files.** [impl/src/wake-stream.mjs](../../impl/src/wake-stream.mjs), [impl/src/host-capacity.mjs](../../impl/src/host-capacity.mjs), [impl/src/coordination-ledger-writes.mjs](../../impl/src/coordination-ledger-writes.mjs), [impl/scripts/expected-red.json](../../impl/scripts/expected-red.json), [docs/43-host-capacity-and-derived-floors.md](../43-host-capacity-and-derived-floors.md).

**Tests.** impl/test/wake-stream.test.mjs:6-8; impl/test/worktree-capacity-physical-admission.test.mjs:7-9; impl/test/suite-manifest-reasons.test.mjs:12,20-21; impl/test/coordination-internals.test.mjs:381-384.

**Loss if wrong.** hubCores is load-bearing arithmetic — a runtime without a reserved hub loop changes usableCores, suiteCores, verdictLanes and every workspace floor derived from them.

## Lane verification

- node impl/scripts/seam-inventory.mjs — ok, exit 0 at base bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b

## Carried facts

- For bend2-arch-lead: the inventory aggregate numbers are recomputable with jq from impl/scripts/seam-inventory.json at this revision: 2670 members total, 981 classified through *_port delegate rules, coordination-store.mjs 604 members (admission 175, observation 243, effect 26, recovery 52, surface 108).
- For bend2-arch-lead: SWARM_REFUSAL_SAME_RULE_PAIRS (impl/src/swarm-refusals.mjs:191-198) is the module's own admitted pending-collapse list and the cleanest worked example of a merge the current language forces to stay unmerged.
- For bend2-plan-lead: the strongest first-tranche rewrite targets by deletion mass are the delegate layer (981 members), the twin capacity authorities (~150 duplicated protocol lines plus one floor derivation), and the four-layer idempotency stack.
- For bend2-reviewer: every citation above was spot-verified against the working tree at bc2e4fcd072e9edce21f94ee2ea8bb938c409f9b except the test-file line numbers, which a read-only scout mapped (TestScout transcript history://TestScout) and the named test files were confirmed present in impl/test.

# Blue-team: bidirectional-v3 red suite — adversarial verification

(Target: `impl/test/bidirectional-v3-red.test.mjs` — 18 rows: A1, A1b, A2, A3, A4, A6, A8,
B1-B3, C1-C3, D1-D5. Verified against the v2.0 fold of
`bidirectional-v3-decisions.md`, both red-team reports (`redteam-authority.md`,
`redteam-lifecycle.md`), and `impl/src/` ground truth (NUL-containing files read via
`grep -an`/`sed -n`), 2026-08-03. Suite run from repo root:
`node --test impl/test/bidirectional-v3-red.test.mjs`.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green
hole). **VACUOUS** = passes without exercising the named behavior. **STAGED-WRONG** = the
row's red/green state does not track the named contract behavior (false-red on a correct
implementation, or green against its own declared stage).

## Verdict summary

| Row | Named behavior | Verdict | One-line basis |
|-----|----------------|---------|----------------|
| A1 | Read lane hub-admitted + closed renderer | WEAK | `/UNTRUSTED/` substring in the logged payload proves one framed payload exists, not the ONLY path; provider-bound frame (`adapter.calls.prompt`) never inspected; zero knowledge nodes in the world |
| A1b | Closed grammar: caller-named runId/scope refuse | SOUND | Two real differential emits → typed `invalid*` refusal receipts on the worker stream; note workerId-field and session-scan seam untested |
| A2 | Knowledge query intersects run horizon | SOUND | Real 2-node differential (same repo, same text match, only run scope differs) with both positive and negative pins; only the run-membership disjunct of the 4-part closure |
| A3 | finding-by-id resolve-then-authorize, constant refusal | WEAK | No positive case (refuse-all-finding-reads passes); `/scope\|horizon\|not_found/` accepts any-error; no forbidden-vs-nonexistent differential |
| A4 | Shared-only scratchpad reads | VACUOUS | No shared entries and no sibling partition ever created; the `worker:w-` substring check has nothing to bite on; empty-ok implementations pass |
| A6 | context.read class, zero weight; self-read exclusion | WEAK (class half) + STAGED-WRONG (self-read half) | Class half pins the name only (weight never exercised); self-read half cannot run on ANY implementation — four independent fixture breaks (§1.6) |
| A8 (pin) | Reads never answer the TG3 cycle | SOUND | Behavioral pin over the real farm-guard (`_steeringEvidenceQualifies`, coordinator.mjs:2141-2159 — admits only turn_started/scratchpad-write/interaction) |
| B1 | Server-owned supersession chain | SOUND | Happy-path chain pinned (predecessor, validityVersion increment, history retained, head tracks); per-family isolation/authority/CAS fields untested |
| B2 | Spawn-time live-head CAS (`context_pack_stale`) | WEAK | Fail-half only: forces spawn to consult `brief.contextPacks` via the refusal channel, but a refuse-ALL-citations implementation passes (no live-head success row anywhere); materialized-content path unobserved |
| B3 | Expiry distinct from supersession (`context_pack_expired`) | WEAK | Distinct code has teeth (conflating impl → `stale` ≠ `expired` → red), but always-throws-expired passes (no positive materialize row); spawn-path expiry and the reaper unpinned |
| C1 | Minted ids; inReplyTo-only frames, derived target | WEAK | Id-mint shape pinned; reply half near-vacuous — `w-2` is never spawned (misroute unobservable), the `?? handle.id` fallback absorbs any receipt lacking `to.workerId`, and a no-reply-lane impl passes whenever the original send's receipt sits on the worker stream |
| C2 | Reply depth 1 | WEAK | First-reply delivery never asserted (`?? 'message:x'` fallback); the counted refusal can fire for unknown-parent, not depth; a send-only lane with typed refusals passes C1+C2+C3 with zero reply capability |
| C3 | Honest receipt state machine | WEAK | Happy-path transition pinned (delivered→read on turn_started, actedOn null pre-turn); despite the row's title NO process death occurs — the v2.0 death-honesty behavior has no oracle; actedOn unchecked post-turn |
| D1 | Scope-first, constant refusal, no existence leak | WEAK | Pins one code for one input; cannot distinguish scope-first from existence-first-with-same-code; the fixture's own scope (`run:mine`) is unauthorized/nonexistent, so a target-blind implementation passes |
| D2 | candidacy_review requires the review lease | VACUOUS | No candidacy exists in the fixture; zero `candidacy_review` reasons is trivially true for an implementation with no lease check; no lease-holder positive case |
| D3 | Storm coalescing carries distribution | VACUOUS | No storm (no member terminalizes); the only real assertion is guarded by `count > 1`; closing `assert.ok(true)` is a tautology — cannot fail against a singular-`{role,phase}` coalescer |
| D4 | Detach epochs (`memberState: terminal-at-mint`) | VACUOUS | Empty page passes; BOTH enum values accepted unconditionally — an always-`live-at-mint` implementation passes with a terminal member in scope; green path also assumes an authority model for `wave-owner` the fixture never constructs |
| D5 (pin) | Driver stall machinery NOT consumed in v1 | SOUND | Source-grep pin over `wave-driver.mjs` (green today); brittle only to symbol renaming |

Observed split (matches the declared 16 red / 2 green): red A1, A1b, A2, A3, A4, A6, B1,
B2, B3, C1, C2, C3, D1, D2, D3, D4; green A8, D5. **Every red fails at its named stage —
no harness bug in the red half:** A1 (:127, zero `context.read_result`), A1b (:147, 0≠2),
A2 (:171, no result), A3 (:189, `ok ?? null` ≠ false), A4 (:200, no result), A6 (:211,
zero `context.read` events), B1/B2/B3 (`store.mintContextPack is not a function`,
:255/:272/:283), C1/C2/C3 (`coordinator.sendMessage is not a function`, :301/:320/:341),
D1-D4 (`coordinator.attentionFollow is not a function`, :359/:372/:385/:405). Grep
confirms zero occurrences of `context.read`, `sendMessage`, `messageReceipt`,
`attentionFollow`, `mintContextPack`, `contextPackHead`, `materializeContextPack`,
`message.delivered`, `message.rejected` across `impl/src/` — the lanes are absent, so the
red stage "machinery missing" is honest. A6's red masks its staged-wrong second half
(§1.6): once the class half is implemented, the row stays red for fixture reasons.

## Closing verdict

**GATE-NOT-READY.** The suite's red stage is honest (16/16 at named stages), but four
rows are vacuous or staged-wrong against their own named v2.0 behaviors, nine rows admit
a named wrong implementation, and eleven v2.0 decision points have no effective oracle —
including the epic's one pre-existing-hole closure (A6 self-read), the entire reply half
of BD3-C, the BD3-B reaper, board-binding reuse, receipt death-honesty, and the
run.send/nudge alias. Blocking items in §4.

---

## 1. FALSE-GREEN hunt (per red row)

For each red row: can an implementation that VIOLATES the named v2.0 behavior still pass?

### 1.1 A1 — renderer mandate (WEAK)

Assertions (:127-130): exactly one `context.read_result` on the worker stream; `ok ===
true`; `JSON.stringify(payload)` matches `/UNTRUSTED/`.

- **Matching `/UNTRUSTED/` proves a framed payload exists — not that the renderer is the
  ONLY path.** v2.0 mandates one closed renderer with unframed leaves rejected before
  provider delivery (fold :31-34; authority §2). The row observes only the durable-stream
  payload. An implementation that (a) emits one UNTRUSTED-wrapped result event AND (b)
  delivers the same content to the provider through a second, unframed path
  (`adapter.prompt` / `_writeUserFrame`, the seam authority §2 names at
  claude-session.mjs:1240-1260) passes untouched — the fixture never inspects
  `adapter.calls.prompt[n].content`. A cheaper cheat: stamp the literal token
  `UNTRUSTED_RECALLED_MEMORY`-style into a metadata field while the prose leaf rides raw
  — the substring assertion cannot tell framing from a label.
- The world contains ZERO knowledge nodes; "the in-horizon query answers" is satisfiable
  with an empty result set. (A2 supplies the content pin for knowledge, so this is a
  composition note, not a hole.)
- What the row does pin: the lane exists, is hub-admitted (the fixture event rides the
  real `adapter.onEvent` → `_handleEvent` seam, coordinator.mjs:1148 → :10533), answers
  in-horizon queries with `ok:true`, and writes exactly one result to the real per-worker
  durable stream (log.mjs:166). Red today for the right reason (:127, zero results — the
  kind hits the `switch (kind)` default at :10806 and is logged as a native observation).

### 1.2 A1b — closed grammar (SOUND, one seam note)

Two emits carrying caller-named `runId` (:139) and `scope` (:143); both must produce
`ok:false` results whose `result` matches `/invalid/` (:147-151). Real teeth: an
implementation that derives `(runId, ['shared'])` server-side per v2.0 (:23-24) but
silently IGNORES the extra fields instead of refusing them fails the `ok:false` count;
one that honors them fails harder. The refusal must reach the worker stream as a typed
receipt — the refusal-receipt discipline is pinned. Caveats: only `runId`/`scope` are
tested (a caller-named `workerId` field is not), and the session-adapter wire scan (the
`scanForScratchpadWrite` analog) is structurally outside this fixture — see §3. Neither
rises to a false-green for the named hub behavior.

### 1.3 A2 — horizon intersect (SOUND)

The fixture mints an in-run Finding (:160-163) and an out-of-run Finding (:164-167) with
identical repoId and both matching the query text `finding`, then asserts the in-horizon
body serves (:173) and the out-of-horizon body does not (:174). This is a genuine
predicate test, not mere string presence: a text-only recall returns BOTH bodies and
fails; any filter that does not discriminate on run scope fails; an over-refusing lane
fails the positive pin (:173). What it cannot distinguish (coverage, not soundness): the
closure's other three disjuncts (nodes promoted under the runId, findings whose evidence
cites the run's events, project-tier nodes — fold :12-16) are unexercised; and a leak at
metadata level (the out-of-horizon node's id/digest present without its body) passes.

### 1.4 A3 — constant refusal (WEAK)

Assertions (:189-190): the out-of-run finding read fails with `ok === false` and `result`
matching `/scope|horizon|not_found/`.

- **Does not distinguish scope-refusal from any-error.** The alternation accepts any
  message containing any of three substrings, and `result` is free-form. An
  implementation whose error says `scope: node exists but is out of horizon` — a literal
  existence leak — passes. The v2.0 property (authority §1.5 amendment: the SAME refusal
  as a nonexistent id) is a two-input differential (forbidden vs nonexistent →
  indistinguishable code/shape); the row tests one input, and no row reads a nonexistent
  id at all.
- **No positive case.** An implementation that refuses EVERY finding-by-id read —
  including in-horizon ones — passes. Resolve-then-authorize's resolve half is untested.

### 1.5 A4 — shared-only scratchpad (VACUOUS on the privacy claim)

Assertions (:200-201): a result exists; its JSON contains no `worker:w-` substring.

- The world contains NO shared entries and NO sibling partition — nothing exists that
  could leak. The `worker:w-` check is well-formed (worker ids are `w-N`,
  coordinator.mjs:6382-6384, so private partitions key as `worker:w-N`), but with an
  empty store it passes for ANY implementation, including one that would happily serve
  `worker:w-2`'s private partition once populated. The positive half asserts only "a
  result exists" — not that shared CONTENT is returned (there is none). An
  always-empty-ok implementation passes the row outright.
- A1b pins the caller-named-scope refusal, so the grammar half of the shared-only rule
  has an oracle; the serving half does not.

### 1.6 A6 — evidence class (WEAK) + self-read exclusion (STAGED-WRONG)

First half (:210-212): reads mint `context.read` events; `events[0].kind ===
'scratch.read'` is false. The second assertion is trivially true given the filter (the
list contains only `context.read` events) — dead code. **Zero promotion weight is pinned
by event NAME only**: no row asserts that arbitrarily many `context.read` events leave
candidacy/grounding unchanged (authority §6's acceptance). WEAK.

Second half (:214-231) — the minScratchReaders=1 self-promotion scenario, the closure of
the pre-existing hole (fold :28-30; lifecycle §4). **The fixture cannot construct the
scenario on any implementation — four independent breaks, each alone sufficient:**

1. `store.postScratchFact({resource: 'scratchpad:bd3-a6', ...})` (:215-218) throws
   `reserved_scratch_namespace` — the `scratchpad:` namespace is reserved
   (coordination-store.mjs:13060-13063). (It also lacks `grounding`, which would throw
   `invalid_grounding` at :13064.) The row dies here, before any gate logic.
2. `store.readScratch(handle.id, 'scratchpad:bd3-a6', envRef, auth)` (:221-222) uses the
   COORDINATOR's signature on the raw store: the store is
   `readScratch(resource, envRef, reader, auth)` (:13149), so `envRef` lands a STRING in
   the envRef slot and `checkScratch` throws `invalid_env_ref` (:13139, :350). The
   intended reader coordinates never reach the event payload.
3. `const before = store.events().length` (:220) is captured BEFORE the read — the gate
   scans `events.slice(0, observedSeq)` (:14340), so even a successful self-read event is
   OUTSIDE the scan window. The holed gate would also see zero reads.
4. The policy object (:224-227) omits `maxScanEvents`; the validator is exact-keys
   (`KNOWLEDGE_PROMOTION_POLICY_FIELDS`, :149; `validKnowledgePromotionPolicy`, :294) →
   `promoteKnowledgeBatch` throws `causal_promotion_invalid` (:14416) before deriving
   anything.

And even with all four fixed, the gate requires each reader task to be `completed` with a
verified outcome (:14373-14375); the fixture never completes or verifies the worker's
task, so the HOLED gate (author counts) and the FIXED gate (author excluded) BOTH noOp —
the differential is vacuous by construction. The row is red today only on its first half
(:211), which masks all of this; an implementer who lands the `context.read` class will
find the row still red for fixture reasons. That is the definition of STAGED-WRONG.

### 1.7 B1 — supersession chain (SOUND)

Pins the chain's happy path against the raw store: `validityVersion` increments (:262),
`predecessor` recorded (:263), superseded version retained (:264), head tracks the chain
(:265). The `?? 1` / `?? 'spec'` fallbacks are benign (they fix expectations when fields
are absent, failing an implementation that omits them). Gaps are coverage, not soundness:
single family (per-family head isolation untested), no wrong-actor supersession, no
`expectedHeadDigest`/`expectedValidityVersion` CAS (authority §3's concurrent-supersession
test), no replay.

### 1.8 B2 — spawn-time stale CAS (WEAK)

`coordinator.spawn` with `brief.contextPacks: [stalePackId]` must throw code
`context_pack_stale` (:274-278).

- **The mock spawn path's consultation is forced, but only through the refusal channel.**
  If a future spawn ignores `brief.contextPacks`, it resolves → `refusal === null` → red;
  a wrong code → red; an uncoded throw → `'thrown'` → red. So the row does prove spawn
  consults the citation. What it never observes is the MATERIALIZATION half: the pack
  body landing, wrapProse-framed, in the spawn prompt (`adapter.calls.spawn[0]` /
  subsequent `prompt` calls are never inspected). "Refuse stale, and for live packs do
  nothing at all" passes — the hub could materialize nothing and the row cannot tell.
- **False-green: refuse-ALL-citations.** No row anywhere spawns a worker citing the LIVE
  head successfully. The CAS is compare-AND-swap; only the fail half exists. A gate that
  rejects every pack citation as stale passes B2 (and B3) while violating "the hub
  materializes the pack into the worker's context" (fold :43-45, v0.9 :234-236).
- Nudge-time CAS (fold :43-44 names "spawn/nudge") has no row.

### 1.9 B3 — expiry distinct (WEAK)

Expired-head pack → `materializeContextPack` yields code `context_pack_expired`
(:285-290). Real teeth on the distinction: an implementation conflating expiry with
supersession throws `context_pack_stale` → red (that is glm #5's exact hole). But an
implementation whose materialize ALWAYS throws `context_pack_expired` passes — no
positive materialize row exists. And the expiry refusal is exercised only through the
store API, not the spawn path ("No expired-but-current pack ever serves," fold :47-49).
The sweep/reaper (fold :47-48) has NO row anywhere.

### 1.10 C1 — minted ids + derived reply target (WEAK)

Id-mint assertion (:304) is SOUND — `/^message:[a-f0-9]{64}$/`. The reply half
(:305-313) is near-vacuous on its named behavior ("the sole target is derived from the
parent message, never caller-named," fold :53-55):

- **`w-2` is never spawned.** Honoring the caller's `to: {workerId: 'w-2'}` is
  undetectable unless the receipt records `to.workerId: 'w-2'`: the row never looks at a
  w-2 stream (none exists) and never asserts the reply reached the orchestrator lane.
- **The `?? handle.id` fallback (:312) absorbs any receipt lacking `to.workerId`.** A
  derived-target receipt will typically record the orchestrator lane, not a workerId —
  so the assertion passes by fallback for the correct implementation AND for a
  misrouting implementation that omits `to` on the receipt. The row proves neither
  derivation nor validation of the caller's `to`.
- **Topology dependence.** v2.0 defines `delivered` = written to the worker's durable
  stream (fold :57-58). If the original send's receipt mints a `message.delivered` event
  on the worker stream, then a NO-REPLY-LANE implementation (replies silently dropped)
  yields `delivered.length === 1` with `to.workerId === handle.id` — the row passes with
  the reply capability entirely absent. Conversely, an implementation that puts BOTH the
  original's and the reply's receipts on the worker stream yields 2 and fails — the
  `=== 1` count hard-codes a receipt topology the contract does not pin, a staging
  ambiguity on top of the false-green.

### 1.11 C2 — depth 1 (WEAK)

The reply-to-reply emit targets `reply?.payload?.messageId ?? 'message:x'` (:329). The
row never asserts the FIRST reply was delivered — if it was refused/dropped, the
fallback id is used and the counted refusal (:332-334, `authority.rejected` or
`message.rejected`) fires for UNKNOWN-PARENT, not for depth. So "depth 1" is unpinned:
what the row proves is only that a worker frame with an unresolvable parent gets SOME
typed refusal. Combined with C1/C3, a **send-only lane** — `sendMessage` + receipts +
typed refusal of every worker frame, zero reply capability — passes all three C rows.
The reply half of BD3-C (worker replies reach the orchestrator via inReplyTo) has no
effective oracle in the suite.

### 1.12 C3 — receipt honesty (WEAK)

`messageReceipt` does NOT exist — grep confirms zero hits; the row assumes both
`sendMessage` and a `messageReceipt(messageId) → {delivered, read, actedOn}` API with
null-not-false semantics. That is acceptable red-first contract-shaping, but the v2.0
text never names this API; the contract should adopt it or the row is inventing surface.

The happy path is pinned: `delivered === true`, `read === null`, `actedOn === null`
(:343-345), then `read === true` after the worker's next `turn_started` (:346-348). But:

- **Despite the row's title, no process death occurs.** The v2.0 behavior — "a worker
  that dies between delivered and read leaves `delivered` with no read — the receipt
  says exactly that, forever, and never upgrades to a lie" (fold :58-61) — requires
  emitting `lifecycle.process_closed`/`crashed` between delivery and read and asserting
  the terminal state. NO row does this. The death-honesty half of the receipt state
  machine (lifecycle §6's whole point) is unoraled.
- `actedOn` is checked only pre-turn (:345); an implementation that flips `actedOn:
  true` on `turn_started` — exactly the lie the contract forbids — passes.
- Process-scoping (receipt bound to generation/pid, fold :58-61 + lifecycle §6.2b) has
  no row.

### 1.13 D1 — scope-first (WEAK)

One call, one input: scope `run:mine`, target `run:someone-elses`, expect thrown code
`attention_scope_forbidden` (:359-365).

- **Order is not provable here — and the property that IS provable isn't tested.** "Scope
  BEFORE existence check" is mechanism; the contract's actual property is
  indistinguishability (no existence leak either direction, fold :64-67). The fixture's
  target is BOTH out-of-scope AND nonexistent, so a scope-first and an existence-first
  implementation that share the constant code are indistinguishable to the row. The
  required differential — an existing-but-forbidden target vs a nonexistent target
  yielding identical code/shape/timing (authority §5.1's explicit test demand) — is
  absent.
- **The fixture's scope is itself unauthorized/nonexistent** (`run:mine` is not the
  spawned run). The expected refusal fires at the SCOPE check before targets are
  consulted — an implementation that authorizes the parent scope and never inspects
  targets at all passes. The target-derivation half of v2.0 (:64-66) is untested.

### 1.14 D2 — candidacy lease (VACUOUS)

The fixture contains zero candidacy — no candidatesAwaitingAdmission exist for any run.
`reasons.filter(kind === 'candidacy_review').length === 0` (:377-378) is therefore
satisfied by an implementation with NO lease check whatsoever (nothing to disclose), and
equally by one that emits `candidacy_review` only when count > 0 to every viewer. The
named behavior (wake emitted only to a live settlement/review lease holder, fold :68-70)
requires a world WITH candidates and two viewers (lease-holder sees the wake with the
count; non-holder cannot distinguish withheld from zero). Neither exists. The row cannot
fail against the hole it names.

### 1.15 D3 — coalescing distribution (VACUOUS)

No member terminalizes in the fixture (one spawned worker, left live) — there is no
storm. The only load-bearing assertion is guarded by `coalesced && (coalesced.count ??
1) > 1` (:389), and the row closes with `assert.ok(true)` (:393), a literal tautology.
Against a wrong implementation that coalesces 64→1 into a singular `{role, phase}` (glm
#3's exact hole), the row passes: no `member_terminal` reason is ever observed, the
guard never fires, and the tautology stands. Vacuous when count===1 is the BEST case;
here it is vacuous unconditionally.

### 1.16 D4 — detach epochs (VACUOUS)

The member terminalizes (turn_completed, :400-403), then `attentionFollow` runs over the
real runId and every member-scoped reason must carry `memberState` in
{`terminal-at-mint`, `live-at-mint`} (:409-411).

- **Both enum values are accepted unconditionally.** The named v2.0 behavior is that
  reasons minted AFTER a terminal transition are marked `terminal-at-mint` (fold :79-80).
  The row never requires it: an implementation that marks every reason `live-at-mint` —
  the hole, unimplemented — passes whenever it includes the field. And an empty `reasons`
  page passes the loop trivially. There is no world in which this row distinguishes the
  correct implementation from the holed one.
- Staging ambiguity on top: the follow is made as `principalId: 'wave-owner'` with no
  lease, session, or authority fixture. If the correct implementation authorizes follows
  (as D1 demands for scopes), `wave-owner` has no established authority over the spawned
  run and the await throws — the row's green path depends on an authority model (any
  named principal may follow an existing run) that the fixture never states and the
  contract does not pin.
- The transient-follow-failure downgrade-with-receipt half of fold :80-81 has no row.

### 1.17 A8 / D5 — the two green pins

A8 (:233-247) parks a real steering cycle (requiredEffects unsatisfied → checkpoint
pause), emits a read, and asserts the cycle stays armed. Green today because
`context.read` hits the switch default; the pin bites the day an implementation lets
read receipts answer `_observeSteeringCycle` — grounded in the real qualifier
(:2141-2159). SOUND. D5 (:415-419) source-greps `wave-driver.mjs` for `attentionFollow`;
green today, correctly one-directional (glm #1), brittle only to a rename of the consumed
symbol. SOUND as a pin.

## 2. Coverage ledger — v2.0 decision points vs rows

### BD3-A (fold :10-36)

| Decision point | Row | Effective? |
|---|---|---|
| knowledge query kind + horizon intersect | A1/A2 | YES (run-membership disjunct only) |
| scratchpad query kind, shared-only, server-constructed selector | A4 + A1b | PARTIAL (grammar YES; serving VACUOUS) |
| finding query kind, resolve-then-authorize | A3 | PARTIAL (no positive, no differential) |
| **board query kind + S-2 board→run binding reuse** | — | **NO ROW** |
| Horizon closure disjuncts 2-4 (promoted-under-run, evidence-cited, project-tier) | — | NO ROW |
| Zero-weight `context.read` class | A6 (first half) | PARTIAL (name only; weight unexercised) |
| **Self-read exclusion (minScratchReaders hole closure)** | A6 (second half) | **NO (STAGED-WRONG)** |
| Renderer mandate (one renderer, reject unframed leaf pre-provider) | A1 | PARTIAL (presence, not only-path) |
| Reads not TG2/TG3 progress | A8 | YES (pin) |
| expectedFence CAS + idempotency on reads; boundedness (≤8/≤2KiB); oversize digest citations | — | NO ROW |

### BD3-B (fold :38-49)

| Decision point | Row | Effective? |
|---|---|---|
| Chain: predecessor + validityVersion, head, history retained | B1 | YES (single-family happy path) |
| Spawn live-head CAS (`context_pack_stale`) | B2 | PARTIAL (fail-half only) |
| **Live-head success + framed materialized content** | — | **NO ROW** |
| Nudge-time CAS | — | NO ROW |
| Expiry distinct (`context_pack_expired`) | B3 | PARTIAL (store-level only, no positive) |
| **Sweep reaper for expired packs** | — | **NO ROW** |
| Per-family head isolation; supersession authority; expectedHead/Version CAS; cross-run digest | — | NO ROW |

### BD3-C (fold :51-60)

| Decision point | Row | Effective? |
|---|---|---|
| Minted `message:<digest>` ids | C1 | YES |
| Worker frames {inReplyTo, body} only; target derived | C1 | PARTIAL (near-vacuous) |
| **Reply actually reaches the orchestrator (positive admission)** | — | **NO ROW** |
| Depth 1 | C2 | PARTIAL (conflated with unknown-parent) |
| Receipt states delivered/read, acted-on never claimed | C3 | PARTIAL (happy path only) |
| **Death honesty (delivered-forever, never upgrades) + process-scoping** | — | **NO ROW** |
| Broadcast bounds (64-member inform) | — | NO ROW |
| **run.send/nudge_turn as aliases over the lane** | — | **NO ROW** — the task's specific question: it is pinned NOWHERE in the suite. The v0.9 acceptance ("run.send works identically (alias)", decisions.md :295-296) survives the fold unrevoked but has no oracle |

### BD3-D (fold :62-84)

| Decision point | Row | Effective? |
|---|---|---|
| Scope-first + constant refusal | D1 | PARTIAL (no differential; target-blind impls pass) |
| candidacy_review lease-bound | D2 | NO (VACUOUS) |
| Coalescing carries distribution | D3 | NO (VACUOUS) |
| Detach epochs (terminal-at-mint) | D4 | NO (VACUOUS) |
| Transient follow-failure downgrade with durable receipt | — | NO ROW |
| Driver stall machinery NOT replaced | D5 | YES (pin) |
| MCP long-poll bounded surface | — | NO ROW (deferred to the packaging epic per v0.9 :281-284 — acceptable if deliberate) |

## 3. Fixture authority — what the harness does and does not exercise

Real seams exercised (rows cannot pass through fixture artifacts on these):

- **Hub admission path:** `ScriptableAdapter.emit` rides the REAL event seam —
  `adapter.onEvent` registration (coordinator.mjs:1147-1148) → actor-authority and
  cross-adapter guards → `_handleEvent` (:10533) → `switch (kind)` (:10806), with epoch
  fencing (:10625-10652) and the native-observation default that logs unknown kinds to
  the worker stream. The A-rows' zero-result reds are observed through exactly this path.
- **Durable streams:** assertions read the real per-worker log (`Log.read(worker)`,
  log.mjs:166), not a mock.
- **Store machinery:** `coordinationForLog(log)` builds a real `CoordinationStore`;
  A6/B1/B3 drive real store APIs (`addKnowledgeNode` :14731, the promotion gate
  :14337-14395, `promoteKnowledgeBatch` :14415). B2's spawn drives the real coordinator
  spawn path with the mock only at the provider boundary.
- **The TG3 farm-guard** behind A8 is the production qualifier (:2141-2159).

Seams NOT exercised (rows are blind to these):

- **The session-adapter wire scan.** The fixture emits pre-parsed coordinator-level
  events; the `scanForScratchpadWrite` analog for `CONTEXT_READ`/`message.send` (grammar,
  bounded text, NUL rejection at the wire) is outside the harness. An implementation with
  a correct coordinator handler and a permissive scanner passes every row.
- **Stream-bound identity at the transport level.** The fixture names `e.worker` freely;
  the coordinator's binding trust (the adapter emits only for its own workers) is assumed,
  not tested. Identity-confusion bugs (trusting `payload.workerId` over `e.worker`) are
  invisible — A1b tests `runId`/`scope` but not `workerId`.
- **The provider-delivery seam.** `adapter.calls.prompt/spawn` content is never
  inspected, so the renderer's enforcement point (reject unframed leaf BEFORE provider
  delivery) and pack materialization content are unobservable (A1, B2).
- **Time.** `now: () => 0` freezes the coordinator clock for A/C/D rows; wake windows,
  `windowMs`, deadline reasoning, and expiry-via-coordinator-clock cannot be exercised.
  (B-rows side-step this with their own store clock — correctly.)
- **Casting.** No second worker (`w-2` is a name only), no candidacy, no storm, no
  lease/session authority, no process death. Every row whose named behavior needs one of
  these is vacuous or weak exactly there (A4, C1, D1-D4, C3-death).

## 4. Blocking items (GATE-NOT-READY)

1. **A6 self-read half is staged-wrong** — fix the fixture or the epic's one
   pre-existing-hole closure ships without an oracle: use a non-`scratchpad:` resource
   with `grounding: 'observed'`; call the coordinator-level `readScratch` (or pass the
   store's `(resource, envRef, reader, auth)` shape with real reader coordinates);
   capture `observedSeq` AFTER the read; add `maxScanEvents` to the policy; complete +
   verify the reader task so the gate's preconditions hold and the holed-vs-fixed
   differential is real. Add the zero-weight assertion (N reads across keys/tasks leave
   candidacy unchanged) while there.
2. **The BD3-C reply half has no effective oracle** — spawn `w-2` (or assert on the
   orchestrator-side stream) so a misrouted reply is observable; drop the
   `?? handle.id` / `?? 'message:x'` fallbacks; assert the first reply DELIVERED before
   the depth attempt so C2's refusal is attributable to depth. Pin the receipt topology
   the `=== 1` count assumes, in the contract.
3. **D2/D3/D4 are vacuous** — construct candidates + a lease-holder and a non-holder
   (D2); terminalize ≥2 members with mixed phases and assert the coalesced
   `{count, perPhase, windowMs}` unconditionally (D3); require `terminal-at-mint` for
   post-terminal reasons and state the follow-authority model for the fixture principal
   (D4).
4. **Missing positive halves** — in-horizon finding-by-id resolves (A3); populated
   shared partition served while a populated sibling partition is excluded (A4);
   live-head pack spawns and its framed content lands in the worker's context (B2);
   live pack materializes (B3). Without these, refuse-all implementations pass.
5. **Coverage rows to add** — board-binding reuse (the one query kind with no row);
   receipt death-honesty + process-scoping; the pack reaper; the forbidden-vs-nonexistent
   target differential; `run.send`/`nudge_turn` alias compatibility over the lane
   (currently pinned nowhere).
6. **Contract adoption note** — C3 invents the `messageReceipt(messageId) →
   {delivered, read, actedOn}` surface; D1/D4 invent the follow principal model. Red-first
   may shape surface, but the v2.0 text must adopt these names or the rows are
   unverifiable against the contract.

## Appendix — verification record

- Suite: `node --test impl/test/bidirectional-v3-red.test.mjs` from repo root → 18 tests,
  16 fail / 2 pass (A8, D5 green); failure line and message per red row as listed in the
  summary above (each at its named stage).
- Absence greps (zero hits across `impl/src/`): `context.read`, `sendMessage`,
  `messageReceipt`, `attentionFollow`, `mintContextPack`, `contextPackHead`,
  `materializeContextPack`, `message.delivered`, `message.rejected`.
- Presence anchors: onEvent registration coordinator.mjs:1147-1148; `_handleEvent`
  :10533; `switch (kind)` :10806 with native-observation default; `_allocWorkerId`
  :6382-6384 (`w-N`); `_steeringEvidenceQualifies` :2141-2159; `Log.read` log.mjs:166;
  `postScratchFact` coordination-store.mjs:13058 (reserved-namespace :13060-13063,
  grounding :13064); `readScratch` :13149 (store signature); `validEnvRef` :350;
  `KNOWLEDGE_PROMOTION_POLICY_FIELDS` :149; exact-keys validator :294; promotion gate
  :14337-14395 (reader filter :14373-14375); `promoteKnowledgeBatch` :14415 (policy
  throw :14416); `addKnowledgeNode` :14731 (id shape :14744).
- No `impl/` files were edited; this report is the only write.


---

## v1.1 re-verification (2026-08-03)

(Target: the folded `impl/test/bidirectional-v3-red.test.mjs` — 20 rows: v1.0's 18 plus
A6b and B2b; A1, A3, A4, A6, B2, B3, C1, C3, D1, D2, D3, D4 rewritten per the v1.0
blockers. Same method: suite run from repo root, `grep -an`/`sed -n` against
NUL-containing `impl/src/` files, plus two first-hand probes against the real
`CoordinationStore`/`Coordinator` — `/tmp/a6b-probe.mjs` replays A6b's fixture and dumps
the promotion candidates; `/tmp/a4-probe.mjs` replays A4's fixture and captures the
envelope throw. Suite result: **18 red / 2 green (A8, D5) — confirmed.**

Red-stage record (v1.1): A1 :127 (0≠1 results), A1b :149 (0≠2), A2 :173 (no result), A3
:192 (positive control — lane missing), A6 :246 (no `context.read` events), B1/B2/B2b/B3
(`store.mintContextPack is not a function`, :318/:335/:354/:364), C1/C2/C3
(`coordinator.sendMessage is not a function`, :386/:406/:427), D1/D2/D3/D4
(`coordinator.attentionFollow is not a function`, :454/:479/:508/:536) — all at their
named stages. **Two rows are red for NON-named reasons:** A4 at :217
(`CoordinationRefusal: scratchpad write envelope is invalid` from the fixture's own
setup) and A6b at :288 (`first.noOp` false≠true — see §v1.1.2; the red is real but its
cause is not the named behavior alone). Both are staged-wrong: neither can go green on
the contract's correct implementation as written.

### Per-blocker verdicts

| v1.0 blocker | v1.1 disposition | Basis |
|---|---|---|
| A1 renderer only-path (WEAK) | **REPAIRED** | :131-132 filters `adapter.calls.prompt` for UNTRUSTED-framed content — the provider-bound frame is now observed; the stamp-token-deliver-raw cheat fails. Residual: presence of a framed prompt ≠ absence of a second unframed path; prompt content not bound to the answer body |
| A3 no positive / any-error (WEAK) | **REPAIRED (main), residual** | Positive control :179-192 (in-horizon finding-by-id must answer `ok:true`) kills refuse-all. Residual: :205 keeps `/scope\|horizon\|not_found/` any-error acceptance; the forbidden-vs-nonexistent finding differential is still absent |
| A4 vacuous sibling privacy (VACUOUS) | **STAGED-WRONG (still-BLOCKING)** | Repair design is real (two workers, elevated shared note, SIBLING-SECRET in a sibling private partition, :217-236) but the fixture throws at :217 — `task.runId` is **null** for standalone spawns (`_spawn` takes `opts.runId`, coordinator.mjs:3930; the suite passes none; probe: `task.runId = null`) and `writeScratchpad`'s envelope rejects null runIds (coordination-store.mjs:13206-13209). Red today for a fixture reason, ungreenable as written |
| A6 class half (WEAK) | **REPAIRED** | :249-250 now asserts globally that NO `scratch.read` is minted by the read lane; weight-zero follows structurally from the gate's kind filter (:14349) |
| A6 self-read (STAGED-WRONG) | **STAGED-WRONG, differently (still-BLOCKING)** | A6b's world is correct — completed+verified tasks a/b, valid envelope/policy/observedSeq — and the probe proves the self-read hole is genuinely exercised (`scratch.cited_observed` promotes from the author's read, seq 9). But the first promote ALSO yields two `coordination.spawn` Decision candidates (task.created seq 1, 5): `first.noOp === true` (:288) can never hold even with the hole fixed, and `second.noOp === false` (:293) is vacuous. The oracle must be trigger-scoped (absence/presence of a `scratch.cited_observed` candidate), not `noOp` |
| B2 fail-half-only CAS (WEAK) | **REPAIRED** | Live-head positive control :342-347 (`accepted === 'spawned'`); refuse-all now fails |
| B2 materialization unobserved | **REPAIRED** | B2b :350-358 asserts the pack body AND `UNTRUSTED` framing land in `adapter.calls.spawn.at(-1).brief`. Residual: pins brief-splicing specifically; a legitimate prompt-delivered materialization would false-red |
| B3 no positive (WEAK) | **REPAIRED** | :372-375 materializes a live pack and asserts the body serves |
| C1 target derivation (WEAK) | **STILL-BLOCKING (partial)** | :397-398 force explicit `to.workerId === handle.id` (fallback gone). But the no-reply-lane false-green survives: under the row's own receipt topology the original send's `message.delivered` on the worker stream satisfies count===1 AND both new assertions with the reply dropped entirely; the reply's admission/delivery to the orchestrator lane is still never asserted, and `w-2` is still unspawned so honoring `to:{workerId:'w-2'}` stays unobservable |
| C2 depth conflation (WEAK) | **STILL-BLOCKING (unchanged)** | :415 keeps the `?? 'message:x'` fallback; first-reply delivery still never asserted; the counted refusal still conflates unknown-parent with depth |
| C3 death honesty (WEAK) | **REPAIRED** | :436-442 sends, closes the process (`lifecycle.process_closed`), and pins `delivered===true / read===null / actedOn===null` across death — the fold's "never upgrades to a lie" is now oracled. Residual: no respawn-inheritance (process-scoping) case; a late `turn_started` on a new incarnation flipping `read` is untested |
| D1 scope-first/no-leak (WEAK) | **REPAIRED-in-part, staged on null** | Real-spawn-as-scope + identical-refusal differential (:453-468) forces target inspection and pins one code for two spellings. But both targets are nonexistent — the forbidden-EXISTING vs nonexistent leg (a second real run as target) is still missing; and the scope itself is `{runId: null}` (see staging defect below) |
| D2 candidacy lease (VACUOUS) | **REPAIRED-in-construction, staged on null** | Real candidacy-shaped world (`postBoardItem`/`closeBoardItem`, :476-478 — both exist, store :13798/:13788) + authority differential: mallory sees nothing (:484), wave-owner sees `candidacy_review` with `count >= 1` (:491). An everyone-sees-it impl fails the first, a nobody-sees-it impl fails the second. Residual: no lease fixture (authority is by-convention principalId); the closed-board-item-as-candidacy derivation is a test-side assumption the contract doesn't record; follow scope is null |
| D3 coalescing (VACUOUS) | **PARTIAL (still-BLOCKING)** | Real two-member storm (:498-506); :513 pins ≥1 `member_terminal`; perPhase required and singular `{role,phase}` rejected when `count > 1` (:514-522). Two surviving holes: (a) a coalescer that OMITS `count` — the v0.9 singular shape that is glm#3's exact hole — dodges the `(reason.count ?? 1) > 1` guard entirely; (b) :524 `roles.length !== 1 \|\| coalesced.length >= 1` is a tautology given :513 already forced `coalesced.length >= 1` — "both members are accounted for" is unenforced, so a count-lying/member-dropping coalescer passes |
| D4 detach epochs (VACUOUS) | **REPAIRED (named behavior), staged on null** | :541/:543 force a non-empty page with ≥1 member-scoped reason; :545 requires exact `terminal-at-mint` on every one — an always-`live-at-mint` impl now fails. Residual dodge: an always-`terminal-at-mint` impl passes (no live-member control); follow scope is null |
| Coverage rows (board-binding, reaper, alias, respawn, nudge-CAS, broadcast) | **STILL-BLOCKING** | B2b added; nothing else. Still no row for: board query kind + S-2 binding reuse, the pack reaper, receipt process-scoping across respawn, nudge-time CAS, `run.send`/`nudge_turn` alias compatibility, broadcast bounds |
| Contract adoption (messageReceipt, attentionFollow, principal model) | **STILL-BLOCKING** | `grep -c "messageReceipt\|attentionFollow" bidirectional-v3-decisions.md` → 0. The tests still invent surface the v2.0 text does not name |

### The new vacuousness hunt (can a wrong implementation still pass?)

**A6b** — YES, and worse: the row can't go green on a CORRECT implementation. Probe
(`/tmp/a6b-probe.mjs`, real store): the first promote's summaries are
`coordination.spawn` (seq 1), `coordination.spawn` (seq 5), `scratch.cited_observed`
(seq 9). The fixture's `createTask` calls mint promotable `task.created` events
(promotionActor 'orchestrator', task nodes present), so `noOp` is false regardless of the
self-read hole. The named differential exists in the world (the `scratch.cited_observed`
candidate IS the hole, exercised end-to-end) but the `noOp` oracle can't see it. Fix:
assert `summaries.every(trigger !== 'scratch.cited_observed')` first, then
`summaries.some(trigger === 'scratch.cited_observed')` after the independent read.

**D2** — a wrong implementation that fabricates `candidacy_review {count: 1}` for
wave-owner regardless of the world passes (count derivation is unverifiable here), and an
implementation gating on any-sessionId fails correctly. Net: the authority-gating
differential is real; the count-derivation half is trust-based. Acceptable with the
contract-adoption caveat.

**D3** — YES: the canonical wrong implementation (v0.9's singular
`member_terminal {role, phase}` coalesced 2→1 with NO `count` field) passes — the guard
only fires on `count > 1`. The row must require `count >= 2` (or perPhase
unconditionally) on any entry spanning the storm, and :524 must become a real accounting
assertion (e.g. the union of roles across entries covers both members).

**D4** — a wrong implementation that marks EVERYTHING `terminal-at-mint` (never
implementing the live/terminal distinction) passes: the fixture contains no live member.
Add a second, live member and require its reasons to carry `live-at-mint`.

**C1** — YES (as above): drop-the-reply passes whenever the original send's receipt
occupies the worker stream. The row needs an orchestrator-lane assertion (the reply's
`message.delivered`/`message.rejected` visible where the orchestrator reads) or a spawned
`w-2` with an explicit non-delivery check.

### Cross-cutting staging defect: null runIds

`coordinator.spawn('mock', makeBrief())` passes no `opts.runId`; `_spawn` therefore sets
`runId = null` (coordinator.mjs:3930, probe-verified: `task.runId = null`). Consequences:
- **A4**: `writeScratchpad`'s envelope (`validRunId`, coordination-store.mjs:13206-13209)
  throws on the fixture's own first write — red at :217 for a fixture reason.
  STAGED-WRONG. Fix: spawn both workers with the same explicit `{ runId: 'run:a4' }`
  (which also makes the sibling a genuine same-run sibling).
- **D1/D2/D3/D4**: every follow scope is `{runId: null}` — D1's "real spawned run as
  scope" repair is null, not real. A contract-correct scope-first `attentionFollow`
  should refuse a null scope coordinate; with what code is unspecified, so all four rows'
  green paths depend on null-tolerant scope admission the contract doesn't describe.
  Fix: pass `opts.runId` at spawn and follow that real coordinate.
- **A2/A3 (note)**: the "in-horizon" nodes carry `runId: null`; the rows still
  discriminate (the out-node's `run:elsewhere` differs), but the in-horizon membership
  is accidental (null===null) rather than expressive.

### Closing verdict (v1.1)

**GATE-NOT-READY.** Real progress: A1, A3, A6-class, B2, B2b, B3, C3, D2, D4 repaired for
their named behaviors (18 red / 2 green confirmed, 16 of 18 at named stages). But two
rows are staged-wrong (A4 fixture throw; A6b `noOp` oracle that can never turn green),
three named behaviors still admit the wrong implementation they exist to catch (C1/C2
reply lane; D3 count-omission coalescer), all four D-rows plus A4 are staged on null
runIds, and the v1.0 coverage/contract-adoption blockers stand.

Blocking items for v1.2:
1. **A6b**: scope the oracle to `trigger === 'scratch.cited_observed'` (probe evidence
   above); keep the world as-is — it is correct and the hole is genuinely exercised.
2. **runId staging**: pass `{ runId }` at spawn in A4 (both workers, same run), D1-D4 —
   the seam exists (coordinator.mjs:3930). A4 is otherwise red for the wrong reason.
3. **C1/C2**: assert the reply on the orchestrator lane (or spawn `w-2` and assert
   non-delivery); C2 must prove the first reply DELIVERED before the depth attempt.
4. **D3**: require `count >= 2` (or perPhase unconditionally) on storm-spanning entries;
   replace the :524 tautology with real role accounting.
5. **D4**: add a live-member `live-at-mint` control.
6. **D1**: add the forbidden-EXISTING leg (a second real run as target).
7. **Coverage**: board-binding row, reaper row, respawn process-scoping row,
   `run.send`/`nudge_turn` alias row.
8. **Contract**: adopt `messageReceipt`, `attentionFollow`, the follow principal model,
   and the candidacy derivation into the v2.0 text (still zero occurrences).

### Verification record (v1.1)

- Suite: `node --test impl/test/bidirectional-v3-red.test.mjs` from repo root → 20 tests,
  18 fail / 2 pass (A8, D5 green); failure lines as listed above.
- Probe 1 (`/tmp/a6b-probe.mjs`, real `CoordinationStore`): first A6b promote →
  candidates `coordination.spawn` (task.created seq 1), `coordination.spawn`
  (task.created seq 5), `scratch.cited_observed` (scratch.fact_posted seq 9);
  `first.noOp === false` for mixed reasons.
- Probe 2 (`/tmp/a4-probe.mjs`, real `Coordinator`+store): `handle.id = "w-1"`,
  `task.id = "task-1"`, `task.runId = null`; `recordDriver` accepts; `writeScratchpad`
  throws `scratchpad_write_invalid` at coordination-store.mjs:13209.
- Source anchors: `_spawn` runId derivation coordinator.mjs:3929-3930; `normalizeRunId`
  :524-530; `writeScratchpad` envelope coordination-store.mjs:13206-13209; `validRunId`
  :346; `postBoardItem` :13798 / `closeBoardItem` :13788; promotion gate spawn-candidate
  path :14364-14368; reader gate :14373-14375.
- Contract grep: `messageReceipt`/`attentionFollow` in `bidirectional-v3-decisions.md` →
  0 occurrences.
- No `impl/` files edited; probes written to `/tmp` only; this section is the only repo
  write.

# Swarm visibility: one liveness, the contributions ledger, and the cost of a view (issues #433, #364 view half, #268)

Design direction: 2026-09-18, design seat kimi-vis. Stage: `landed` (#433 lane 2223154b; #438 e7708e5c; #364 view half via #442/#385) — this document was
pinned red-before by `impl/test/issue433-contributions-projection.test.mjs` and
`impl/test/issue268-visibility-red.test.mjs`; every row in those files asserts behaviour this
document specifies against the CURRENT runtime and fails until an implementation lane lands it
(docs/44).

Evidence this design answers:

- **2026-09-18 (#433):** omp-373's contribution at seq 14840 went unseen for 25 minutes. The
  bounded watch returned on its first wake; the contribution landed between that return and the
  next `--after-seq` re-arm, the seat read `paused` with a `worktree_foreign_changes` row, and no
  surface said "unreviewed contribution".
- **2026-09-18 (#364):** after a resident restart the clone listed 42 seats active of which 2 had
  a working runtime; a seat whose worker died read `runtime {state: idle, live: true,
  turn: paused}`, and the 40 dead seats rode into every new recruit brief's Peers section. The
  runtime half (a `swarm.participant_runtime_lost` row and a `worker_lost_on_restart` attention)
  is another lane's; this document owns the VIEW half.
- **#268 remainder:** participant activity and usage are invisible on `swarm.view` / `run show`;
  only the raw worker log knows.
- **Standing gaps (root, 2026-09-17/18):** (a) brief exposure is a flat list of everyone; (b) the
  root is not a participant row, so its reviews, guides and stops land with no actor row the view
  can render (`reviewerId: null`); (c) attention rows carry no coverage — an empty attention list
  is indistinguishable from an unexamined one; (d) the outline for a 45-seat swarm must answer
  within the transport's request bound with no per-seat process spawn.

## 0. Rules that do not change

These rules from [docs/39](39-swarm-runtime.md), [docs/45](45-open-coordination.md) §0 and the
grammar ([docs/36](36-unified-control-grammar.md) §5) bind every mechanism below; this design
extends them, never exceptions them:

- **One derivation per fact.** L4: one vocabulary per axis. Liveness already has ONE derivation
  (`swarmParticipantLiveness`, swarm-runtime.mjs) and "gone" is the complement of ONE live list —
  never a second list that can drift (2026-09-14 audit S-F5). Everything below hangs off it.
- **The view mints nothing of its own.** Every row the view carries is folded from durable rows
  or derived from them at read time; absence is labelled as absence, never a guess (audit finding
  9, `coverage: 'unobserved'` precedent).
- **No timers, no TTLs, no wall-clock cadences** (#163). Every "past due" below derives from
  ledger rows, never from elapsed time.
- **The cursor IS the coordination ledger seq** (#318/#312): every paged or resumed read names
  seqs, never page counts.
- **Generated surface vocabulary.** Any closed set this document adds lands in
  [docs/36](36-unified-control-grammar.md) §7.4 by regeneration
  (`node impl/scripts/surface-gate.mjs --write`) in the same change, exactly as docs/45 §11
  requires — never hand-edited.
- **Peers-now is docs/45 §6's section.** This design changes WHO renders there (§4), not what the
  lines carry; the two documents compose, they do not overlap.

## 1. The ONE liveness/activity derivation (#364 view half, #268)

### 1.1 The closed participant `runtime.state` set

One exported table, owned beside the one derivation that computes it:

```js
// impl/src/swarm-runtime.mjs — the closed set every surface reads.
export const SWARM_PARTICIPANT_RUNTIME_STATES = Object.freeze([
  'pending', 'working', 'blocked', 'idle', 'stopping',   // live (SWARM_LIVE_RUNTIME_STATES)
  'dead', 'exited',                                      // ended without a terminal settlement
  'completed',                                           // settled (#332/#350), terminal turn after a final contribution
  'lost',                                                // runtime lost, membership active (#364)
  'unbound',                                             // no worker binding recorded (absence, not death)
]);
```

Rules:

1. `swarmParticipantLiveness` gains the runtime-lost fact as an input: the LATEST durable
   `swarm.participant_runtime_lost` row naming the seat (the runtime lane's row) with no later
   binding row settles the state to `lost`, `live: false`, `turn: null`. A seat whose worker died
   across a resident restart NEVER again reads `idle`/`live: true`: the view, the wake feed and
   the bridge render the same `lost` row because they read the same function.
2. `live` stays `SWARM_LIVE_RUNTIME_STATES.includes(state)` — `lost` is not added to the live
   list; "gone" stays the complement of the one list. A lost seat raises the
   `worker_lost_on_restart` attention (the runtime lane's row) and is treated exactly as a dead
   runtime by every derivation that reads liveness (`_canAct`, `awaiting`, `closed_with_live_participants`,
   the Peers section, `scopeOverlap`).
3. "Can this seat act" is ONE derivation: `_canAct(row) = row.status === 'active' && row.runtime.live`.
   The outline, the participants projection, the recruit brief's Peers section, the coupling
   `awaiting` computation and `scopeOverlap` all read it — a seat none of them may list as able
   is a seat none of them list at all as a peer. (Today the Peers section and `scopeOverlap`
   already filter on `_canAct`; the rule pins that this can never be re-opened per surface.)
4. `turn` keeps its meaning (`paused | running | null`); a paused turn is a property of a LIVE
   worker only — a dead, exited or lost worker's leftover pause record is history.

### 1.2 `activity` and `usage` on the participant row (#268)

Every participant row gains two derived fields:

```js
activity: { lastEventKind, lastEventAt, turnsCompleted, contributions },
usage:    { tokens: <number> | 'unavailable', providerCalls: <number> | 'unavailable' },
```

Derivation rules:

1. **Sources are the rows the store already folds** — never a per-view scan of a worker log
   (P9; #438). `lastEventKind`/`lastEventAt` come from the latest coordination-ledger row
   attributed to the seat (its swarm rows directly; its run/worker rows through the recorded
   `runId` and bindings — the SAME attribution map the wake stream already builds,
   `wake-stream.mjs` `_attribution`). `turnsCompleted` counts the seat's attributed
   `lifecycle.turn_completed` rows. `contributions` counts the fold's `swarm.contributions` rows
   by `participantId`.
2. **`usage` reads the coordinator's ONE usage fold** (the `counterId`/`accounting: cumulative`
   handling at coordinator.mjs — the #305 `turn.progress` observer and the `resource.tokens` /
   `resource.provider_call` rows it rides). The coordinator exposes it as a per-worker fact the
   runtime reads; per field, the string `'unavailable'` when the adapter reported no such row
   (the usage-seal vocabulary's absence), a number otherwise. A seat with tokens but no
   provider-call rows reads `{tokens: <n>, providerCalls: 'unavailable'}` — per-field absence,
   never a zero that pretends to be a measurement.
3. A seat with no worker binding and no attributed rows reads `activity` with
   `lastEventKind: null, lastEventAt: null, turnsCompleted: 0` and its `contributions` count from
   the fold (durable — survives the worker); `usage` reads `'unavailable'` on both fields. Absence
   is labelled, never invented.
4. Both fields derive through the §7 caches: one pass per CHANGE, zero per view.

## 2. The `contributions` projection: review state, cursor, and the unreviewed page (#433 item 1)

### 2.1 Review state — ONE derivation

Every contribution row on the view (full view and `contributions` projection alike) carries
`reviewState`, from ONE derivation that extends the existing `_acceptedContribution`
(swarm-runtime.mjs):

- `accepted` — an `accept` review exists and no LATER `reject` review revokes it (exactly
  `_acceptedContribution`'s reading);
- `rejected` — the LATEST settling review (`accept` | `reject`; `comment` never settles) is a
  `reject`;
- `unreviewed` — no settling review exists (no reviews, or comments only).

The closed set is `unreviewed | accepted | rejected`. It is derived, never stored: the fold's
`reviews` append-only lists stay the source, and a later review re-derives the state on the next
read — no row is ever rewritten.

### 2.2 Cursorable in the #312 vocabulary

The `contributions` projection answers in ledger order, each row carrying its `seq`, under the
one cursor vocabulary the family already serves: when the answer cannot fit the declared frame,
it pages with `page {cursor, next, total, served, ceiling}` (#343's shape; the ceiling row is
`wire.frame`, never a numeric page cap), and walking `page.next` reproduces the whole list with
no gap and no duplicate. The bridge's existing frame measuring (`narrowSwarmViewForBridge` /
`pageSwarmViewForBridge`, swarm-native-bridge.mjs) is the one cut — the projection never invents
a second pager.

### 2.3 The `unreviewed_contribution` attention row

A view-derived row (never ledger-written), minted beside the other organization rows in
`inspect()`:

```js
{ kind: 'unreviewed_contribution', participantId, contributionId, seq, waitingSince,
  cadence: { crossedBy: 'swarm.participant_joined', seq },
  next: { command: 'swarm.view', swarmId, participantId, contributionId } }
```

1. **Cadence without a clock (#163).** A contribution recorded at seq *s* sits "past one
   recruit-brief cadence" when the swarm has composed a recruit brief at a seq > *s* — durable
   evidence: a `swarm.participant_joined` row (the brief composition IS the join) — and the
   contribution's `reviewState` is still `unreviewed`. One join crossing is the cadence; the row
   names the join that crossed it (`cadence.seq`).
2. The row attaches to the AUTHOR (`participantId`), exactly where #433's 25-minute silence
   needed it: the seat reads `paused`, its attention row says why it is being paged.
3. A settling review (accept or reject) clears the row on the next view — derived, so there is
   nothing to retract.
4. Only contributions by ACTIVE members page: a settled (left) seat was already acted on — the
   same rule the other organization rows follow.
5. The kind is added to the generated attention-kind block (docs/36 §7.4) in the same change.

## 3. The multi-wake frame contract for the bounded watch (#433 item 2)

Today `_watch` returns on the FIRST relevant row (`watch {reason, afterSeq, matchedSeq, event}`),
and everything between that return and the caller's next `--after-seq` re-arm is invisible. The
contract becomes:

1. The wake answer carries `watch.events`: EVERY swarm-relevant wake row with `seq > afterSeq`
   that the one relevance filter (`_watch`'s existing predicate — telemetry kinds stay excluded)
   admits, in seq order, up to the frame bound. Each entry is the row the watch already names —
   `{seq, kind, payloadKind, ...}` with the recruitment enrichment (#283) where applicable — so a
   follower acts on each without re-reading the log.
2. The frame bound is the ONE substrate row (`wire.frame`, limits.mjs), byte-measured the way
   `evidence.search` already measures (the first row is always kept, never dropped for size).
   When the bound cuts the tail, the answer carries `watch.pendingSince: <seq>` — the first
   uncarried row's seq — and nothing is silently lost. When every row fit, `pendingSince: null`.
3. `matchedSeq` is the LAST carried row's seq: re-arming with `--after-seq <matchedSeq>` loses
   nothing, whether the frame was cut or not. `reason: 'event'` iff `events` is non-empty;
   `reason: 'timeout'` carries `events: []`, `matchedSeq: null`, `pendingSince: null`.
4. `watch.event` (singular) keeps its meaning — the FIRST row that woke the watch — for one
   release of CLI compatibility, and the CLI's bounded leg renders every `events` row (one line
   each, the same frame rendering `--follow` prints) plus the `pendingSince` marker when present.
   The bridge carries the block verbatim; its frame measurement already narrows by the same row.
5. The wake-class filter (#339) composes unchanged: a filtered watch's `events` carries every
   row of the admitted classes past `afterSeq`; rows outside the filter re-arm the watch past
   them, as today.

## 4. Brief exposure by relationship (standing gap a)

What a seat's brief shows about its peers derives from its RELATIONSHIP to them — one derivation
(`_peerExposure(swarm, seat, peer)`, swarm-runtime.mjs), consumed by `_composeRecruitBrief` (the
recruit and `resumeFrom` seam, docs/45 §6), never by a second renderer.

### 4.1 The relationship classes (closed set)

Computed per (seat, peer) pair, strongest first:

| class | test (all from folded rows) |
|---|---|
| `self` | the brief's own seat (the `resumeFrom` successor seam) |
| `subtree` | peer is an ancestor or descendant by `parentId` (delegating parent/child) |
| `checkout` | peer shares the seat's recorded workspace (the binding rows / custody rows, #428) |
| `group` | peer shares a group roster with the seat |
| `swarm` | peer is an active member of the same swarm, none of the above |
| `repository` | peer sits in another swarm of the same repository — the `scopeOverlap` advisory only |

### 4.2 What each class exposes

| class | exposure |
|---|---|
| `self` | the full inheritance block (today's `resumeFrom` rendering, unchanged) |
| `subtree` | the docs/45 §6 peers-now line in full: identity, role, scope, held work and claims, last checkpoint (sha + ref), liveness word |
| `checkout` | as `subtree` — a seat you share a checkout with must see what you hold |
| `group` | identity, role, scope, held work, liveness word |
| `swarm` | identity, role, liveness word only (`- delta — active`; `- delta — gone since seq 9123`) — never scope, never held work |
| `repository` | no Peers line at all; the `scopeOverlap` receipt stays the only cross-swarm exposure, and it lists only seats the ONE liveness derivation calls able (§1.1 rule 3) |

Rules:

1. A seat a class would list but `_canAct` rejects is NEVER listed as able: gone peers are named
   once, as settled history (the existing "N seats have completed or stopped" count gains the
   gone-not-settled count when it is non-zero), never as working peers. This is the #364 brief
   fix: 40 dead seats cannot ride a recruit brief again.
2. Liveness words in the brief come from `swarmParticipantLiveness` verbatim (`live`/`lost`/
   `dead`…), so the brief, the outline and the participants projection can never disagree.
3. The scoped view (`swarm.view --participant-id`) is unchanged: it is already the swarm AS THAT
   PARTICIPANT SEES IT (audit S-F3); the brief ladder governs what the brief TEACHES, the scoped
   view governs what the view SHOWS.

## 5. The root as a participant row (standing gap b)

1. Every view's `participants` array carries ONE synthesized row:
   `{participantId: 'root', role: 'root', status: 'active', permissions: [...SWARM_PERMISSIONS],
   runtime: {workerId: null, state: 'root', live: true, turn: null}}` — the orchestrator the swarm
   was created by. The row is DERIVED per view, never folded, never recruited: `swarm.recruit`
   with `participantId: 'root'` refuses with the closed-set membership refusal (`root` joins the
   reserved names), and no membership event ever names it.
2. `'root'` joins the runtime state closed set (§1.1) as its eleventh value: the root's runtime
   is the resident answering the view — a served view IS the liveness evidence; nothing renders
   the row after the resident stops because nothing answers.
3. **Attribution rendering.** Durable rows stay untouched: `swarm.contribution_reviewed` keeps
   `reviewerId: null` with `actor: <principal>` when an external orchestrator reviews
   (swarm-state.mjs `assertAttribution`, unchanged). The VIEW renders attribution: a review,
   guide receipt, stop or holder-release whose actor is the swarm's creator (or any external
   principal with no seat) projects its actor field as `reviewerId: 'root'` / `actor: 'root'` on
   the projected row — the null never reaches a reader. A caller-named seat that is not the actor
   still refuses, exactly as today.
4. The root row carries no `runId`, no `workspace`, no `activity`/`usage` (it has no worker log);
   those fields are absent on the row, not null-filled.
5. Scoped views: the root row appears in every scope (the root is every subtree's ancestor), so a
   seat reading its own delegation can attribute a root review without reading the whole swarm.

## 6. Attention coverage (standing gap c)

1. `attention` becomes an envelope on every projection that carries it:
   `attention: {rows: [...], coverage: {examined: [...], unexamined: [...]}}`. `rows` are the same
   kinds, same shapes, same derivation as today's array — byte-identical content; the envelope
   adds the truth about what was looked at.
2. `coverage.examined` lists every participantId the attention derivation EVALUATED this read
   (every active member whose required facts were readable, per check that ran). `coverage.unexamined`
   lists `{participantId, checks: [...], reason}` rows for the seats a check SKIPPED because a
   fact was unreadable — today `worktreeChangedPaths` returning null silently skips the
   foreign-changes and unpublished-turn checks; under this rule the seat is named
   (`reason: 'worktree_unreadable'`) instead of passing for examined.
3. An empty `rows` with an empty `unexamined` reads "looked, nothing found"; an empty `rows` with
   a non-empty `unexamined` reads "not fully looked" — the two are never again indistinguishable.
4. Scoped views scope coverage exactly as they scope rows (the subtree filter already applied to
   rows applies to `examined`/`unexamined`).
5. This is the one intentional SHAPE change in this design; §9 carries the migration.

## 7. The cost rule (standing gap d; #438)

**Rule:** no read path (`swarm.view` in any projection, `swarm.watch`, the bridge's narrowing)
spawns a process, and no read scans a ledger per seat. Every projection derives from folded rows
plus caches the runtime maintains ON CHANGE. A 45-seat `outline` answers from O(1) cache reads
inside the transport's request bound.

The #438 sites this removes, named so the implementing lane cannot miss one:

| site | today | after |
|---|---|---|
| per-seat `gitRead` branch/HEAD/status (swarm-runtime.mjs, the `inspect()` participant map, ~lines 1254–1259) | 3 `git` spawns per seat with a live checkout, per view | the workspace-facts cache (below) |
| `participantBase` (swarm-runtime.mjs, ~lines 94–110) | 3–4 more spawns per seat per view (`symbolic-ref`, `rev-parse` ×2, `rev-list`) | the same cache; `base` carries `asOf` (the seq/ts the cache entry was taken) so a reader can tell a fresh base from a stale one |
| `worktreeChangedPaths` (swarm-runtime.mjs, ~lines 152–157) | 1 `git status` per seat per view | the same cache's `changedPaths`; a cache miss is labelled absence and feeds §6 `unexamined` — never a spawn |
| `_commitsSinceBase` / `situationGit` | git reads at brief composition | unchanged (brief composition is a WRITE path — recruit — not a read; the rule binds reads only) |
| ~10 full-ledger passes per `inspect()` (guidance, parked guidance, knowledge, refusals, recruit modes, custody, bindings, commits, admission, operations, notes) | `eventsView()` copies the whole ledger, then ten iterations | a per-swarm derived-state cache, updated on every `_write`/`recordDriver` the runtime performs and on the store's change notification for rows written by other paths — one fold step per change, zero per view |
| `_settleCheckoutWriterState()` at the head of `inspect()` | work already done at every `_dispatch` entry | stays (it is the change seam the caches hang off), but its result feeds the caches rather than re-deriving per view |

Cache invalidation rule: the runtime sees every swarm write (its own `_write`, the driver rows it
records, and the store's change notification); each write folds into the cache before the
operation answers, so a view that follows any mutation reads post-mutation facts. A view never
writes to the caches and never triggers a refresh — reads are pure over them.

## 8. What stays OUT

- **No timers, TTLs or wall-clock cadences** (#163): the unreviewed cadence is a join-row
  crossing (§2.3), never elapsed minutes.
- **No new `swarm.update` event kinds, no new wake classes.** Review state is derived (§2.1);
  `unreviewed_contribution` is a view row (§2.3); the multi-wake frame changes the watch ANSWER,
  not the ledger.
- **No second liveness list and no second "can act" predicate** — `SWARM_LIVE_RUNTIME_STATES`
  and `_canAct` stay the one pair (§1.1).
- **No per-seat process spawn or ledger scan on any read** — §7 is a rule, not an aspiration.
- **No root membership, root run, or root checkout.** The root row is an actor row for
  attribution (§5), nothing more; it holds no work and appears in no group roster.
- **No cross-swarm detail beyond `scopeOverlap`** (§4.2): a peer in another swarm is paths, never
  identity detail.
- **No rewriting of durable rows.** `reviewerId: null` stays on the fold's review record; the
  projection renders `'root'` (§5.3). Replay stays byte-identical.
- **No telemetry wakes.** The `_watch` relevance filter keeps excluding tool/usage rows; the
  multi-wake frame inherits that filter unchanged (§3.5).

## 9. Migration: every existing projection keeps its meaning

- `SWARM_VIEW_PROJECTIONS` gains nothing and loses nothing: the nine projections answer the same
  slices. Row CONTENTS grow additively (`reviewState` on contribution rows; `activity`/`usage` on
  participant rows; the `root` row in `participants`).
- `runtime.state` gains `lost` and `root`: the closed set is exported as
  `SWARM_PARTICIPANT_RUNTIME_STATES` so a consumer validates against the table instead of
  hard-coding a list. Old rows never stored a state — the field was always derived — so no
  recorded fact changes meaning.
- The watch block is additive except that `matchedSeq` becomes the LAST carried row's seq
  (§3.3): a caller that re-arms with `--after-seq <matchedSeq>` behaved correctly before and
  behaves correctly after — the before/after difference is exactly the rows that used to be lost.
- `attention` becomes the envelope (§6): the one intentional shape change. Consumers
  (application-cli swarm rendering, the web view, baton-top's visual model) move from iterating
  `view.attention` to `view.attention.rows` in the implementing lane, in the same change — no
  dual-carry, no alias. The row kinds and shapes are untouched.
- The docs/36 §7.4 generated block regenerates in the same change
  (`node impl/scripts/surface-gate.mjs --write`): the `unreviewed_contribution` attention kind
  appears there, and nowhere is the vocabulary hand-typed.
- The brief's Peers section changes content by relationship (§4) but keeps its heading and its
  line grammar; the docs/45 §6 peers-now lines are unchanged for the classes that carry them.

## 10. Closed-set owners

| closed set | ONE owner |
|---|---|
| `SWARM_PARTICIPANT_RUNTIME_STATES`, `SWARM_LIVE_RUNTIME_STATES`, `swarmParticipantLiveness`, `_canAct` | `impl/src/swarm-runtime.mjs` (the liveness section — one derivation, one live list) |
| review state (`unreviewed \| accepted \| rejected`) | the derivation extending `_acceptedContribution`, `impl/src/swarm-runtime.mjs` — derived, never stored; `SWARM_REVIEW_DECISIONS` stays in `impl/src/swarm-state.mjs` |
| attention kinds (adding `unreviewed_contribution`) | the runtime's row-minting sites; enumerated by the generated block (docs/36 §7.4) |
| relationship classes (`self \| subtree \| checkout \| group \| swarm \| repository`) and their exposure ladder | `_peerExposure`, `impl/src/swarm-runtime.mjs` |
| the wake block shape (`events`, `pendingSince`, `matchedSeq`) | `_watch`, `impl/src/swarm-runtime.mjs`; rendered by the CLI's one bounded leg (`application-cli.mjs`) |
| the frame bound for watch/events/pages | `FRAME_LIMITS['wire.frame']`, `impl/src/limits.mjs` — never a fresh constant |
| usage absence vocabulary (`'unavailable'`) | the coordinator's usage fold (`impl/src/coordinator.mjs`), projected verbatim by the view |
| reserved participant name `root` | `impl/src/swarm-state.mjs` membership validation + `impl/src/swarm-contract.mjs` recruit schema |

## 11. Seam map

| seam | file · function | what extends |
|---|---|---|
| liveness + state set | `impl/src/swarm-runtime.mjs` · `swarmParticipantLiveness`, `SWARM_LIVE_RUNTIME_STATES`, `_canAct` | `lost` input (the runtime-lost row), `SWARM_PARTICIPANT_RUNTIME_STATES` export |
| participant row | `impl/src/swarm-runtime.mjs` · `inspect()` participant map | `activity`, `usage`, the synthesized `root` row, attribution rendering (`'root'` for null reviewer/actor by the swarm's creator) |
| contributions projection | `impl/src/swarm-runtime.mjs` · `inspect()` contribution rows; `impl/src/swarm-native-bridge.mjs` · `narrowSwarmViewForBridge` / `pageSwarmViewForBridge` | `reviewState` per row; paged answer in the #312/#343 vocabulary |
| unreviewed attention | `impl/src/swarm-runtime.mjs` · `inspect()` organization rows | the `unreviewed_contribution` row and its join-crossing cadence |
| bounded watch | `impl/src/swarm-runtime.mjs` · `_watch`; `impl/src/application-cli.mjs` · the bounded watch leg | `watch.events`, `watch.pendingSince`, `matchedSeq` = last carried seq |
| brief exposure | `impl/src/swarm-runtime.mjs` · `_composeRecruitBrief`, `_peerExposure` (new), `_scopeOverlap` | the §4 ladder; the gone-peer history count |
| attention coverage | `impl/src/swarm-runtime.mjs` · `inspect()` attention assembly | the `{rows, coverage}` envelope and the `unexamined` derivation |
| activity/usage sources | `impl/src/coordinator.mjs` · the usage fold (~line 2720), `_observeTurnProgress` (#305) | a per-worker activity/usage fact the runtime reads — cached, never a log scan per view |
| cost rule | `impl/src/swarm-runtime.mjs` · `inspect()`, the per-swarm derived-state cache (new), the workspace-facts cache (new, refreshed at `_settleCheckoutWriterState` and the commit-spool drain) | removal of the read-path `gitRead` call sites named in §7 |
| grammar surface | `docs/36-unified-control-grammar.md` §7.4 via `impl/scripts/render-surface-docs.mjs` + `surface-gate.mjs --write` | regenerated block: the new attention kind |
| CLI/web consumers of `attention` | `impl/src/application-cli.mjs`, the web view, `impl/src/visual-model.mjs` | iterate `attention.rows` (the §9 cutover) |

## 12. Open questions

1. **The cadence source for `unreviewed_contribution`.** This design keys "one recruit-brief
   cadence" on a `swarm.participant_joined` crossing (§2.3) — the only durable brief-composition
   fact that exists without a clock. A swarm that never recruits again after a contribution would
   never raise the row; the root's own multi-wake frame (§3) is the first line and this row is
   the backstop. Whether a second crossing source (e.g. any organizer review of ANOTHER
   contribution) should also trip the cadence is open.
2. **The `attention` envelope is the one shape change** (§6, §9). The cutover names the CLI, web
   and visual-model consumers; whether the MCP bridge's frame narrowing needs a transition page
   for a client compiled against the bare array is open — the implementing lane should check the
   bridge's published schema before choosing cutover over one-release dual-carry.
3. **`base.asOf` freshness semantics.** The workspace-facts cache makes `base` and `dirty` stale
   by at most one change seam (§7). Whether the view should name a numeric staleness budget
   (refusing to serve a base older than N ledger seqs without refresh) or trust the change
   seams entirely is open; this design names `asOf` and trusts the seams.
4. **Usage across re-bindings.** A seat re-recruited (`resumeFrom`) gets a new run and new
   `resource.tokens` counterIds. Whether `usage` sums across the seat's whole membership or only
   its current binding is open; this design's per-field `'unavailable'` rule (§1.2) applies
   either way, and the counters are cumulative per counterId, so summing needs the coordinator's
   dedup, not a raw total.

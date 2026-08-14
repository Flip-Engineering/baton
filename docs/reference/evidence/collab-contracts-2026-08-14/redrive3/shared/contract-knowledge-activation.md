# Package ⑤ knowledge-activation contract — ACTIVATION before representation (#186/#190)
[attempt: 5262cdfa-7068-4a59-8ad5-f80446d710a7 row-knowledge-activation]

The implementation contract for the collaboration package (⑤)'s knowledge-activation row:
issue #186 (pm-adoption ①, the headline — the knowledge plane is WRITE-ONLY: a plane nobody
reads is non-functional, and the campaign's own store proves nobody ever read it — entries
written, zero elevations by any member, zero member-authored knowledge edges, zero served
briefings) and issue #190 (the delta-nudge: the wave steering nudge is static prose that
carries no information, so members learn to ignore it — cry-wolf). The row's three contract
surfaces, per the brief: **computed member briefings at spawn** (honesty-pinned, event-derived,
riding #103's L0-pack discipline), **elevation ergonomics** (the collapsed review queue), and
**the foundry-loop first-writers** (folds emit Blocks/Resolves edges, per the amended #187).
This is a **Ring-2 contract** (ground truths → decisions → refusal vocabulary → red-first
acceptance pins → open questions): it specifies behavior; it does not amend implementation in
this artifact.

- **Date:** 2026-08-14 (redrive 3 — the first drive of this row to land a contract; `redrive/`
  and `redrive2/` contain briefs + wavefile only, no row artifact, no QA gap record naming a
  dead attempt — the same first-landing shape the lifecycle package's redrive3 recorded).
- **Status:** RED-FIRST CONTRACT — implementation contract v1 (red-first; no code landed for
  this row's issues).
- **Verification HEAD:** `5ae2c7e5c93d99404d3a292e777dd30f7d2ead27` (clean tree). Every
  `file:line` citation below was re-verified THIS session with `grep -an` / `sed -n` at this
  HEAD (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs` — NUL discipline;
  plain grep/read elsewhere). The resident store was counted read-only this session
  (`jq` over `events.jsonl`, 105,142 events — §GT1). Where the 2026-08-13 evidence dirs'
  anchors shifted under later landings, the corrected anchor is cited and the shift named
  (e.g. `candidateState` moved `application.mjs:827→832`, `coordinator.mjs:403→421`;
  `elevateTaskScratchpad` moved `coordination-store.mjs:14173→14356`).
- **Brief:** `foundry-brief.md` + `row-knowledge-activation.md` (this dir) — read fully. The
  issue bodies (`gh issue view 186/190/187`) could not be fetched (`gh` is not authenticated in
  this worktree); the requirements are carried by the row brief, the foundry frame, and the
  campaign evidence (`channel-audit-2026-08-13/knowledge.md` K1-K8, `pm-comparison-2026-08-13/
  pm-kg.md` C7/C16/J1), all cited inline.
- **Read-order executed.** (1) `foundry-brief.md` (the shared frame — Ring-2 form, attempt-echo
  law, no clocks, sorted-key literals, publish-to-shared); (2) `row-knowledge-activation.md`;
  (3) `coordinator-brief.md` (the QA cross-check this contract will receive);
  `collab-contracts.wavefile` (harvest shape — this file must contain `contract`);
  (4) the evidence: `channel-audit-2026-08-13/knowledge.md` (the tier audit — in full),
  `pm-comparison-2026-08-13/pm-kg.md` (the pm comparison's KG lane — in full);
  (5) the code: the serving seam (`coordinator.mjs` `_providerBrief`/`serveKnowledge`,
  `adapter.mjs` `renderBrief`, `messages.mjs` `buildKnowledgeSlice`), the elevation machinery
  (`application-semantics.mjs` scratchpad rows, `application.mjs` scratchpad projections,
  `coordination-store.mjs` `elevateTaskScratchpad`, `workflow-interpreter.mjs`
  `elevateWhenNotes`), the knowledge plane (`coordination-store.mjs` KNOWLEDGE_* registries,
  `admitWorkflowFinding`, `recallPreview`, `knowledgeRitual`), and the nudge
  (`workflow-interpreter.mjs` steering grammar + `handleCheckpoint` + quiescence state).
- **Scope of the rung, in one sentence:** the knowledge plane's READ side is finished plumbing
  with no water in it — serving lanes built and inert (`serveKnowledge` uncalled, the briefing
  provider seam unwired, the L0 pack attached but never rendered), an elevation review surface
  that collapses all state to a static `'candidate'`, a closed edge vocabulary with no
  fold-authored kinds, and a steering nudge that repeats identical prose regardless of silence
  or change — this contract wires the water: every spawn serves a computed, honesty-pinned
  knowledge briefing; elevation state becomes readable as a queue; the foundry loop becomes
  the knowledge plane's first deliberate edge-writers; and the nudge carries only real deltas,
  only to silent members.

---

## Ground truths (verified at HEAD `5ae2c7e`)

### The campaign store (counted fresh this session — the write-only charge, re-proven)

- **GT1 — the plane is still write-only/auto-only TODAY; every campaign number the brief
  charges #186 with holds at final count, worse.** Read-only `jq` over the resident store
  (`.git/baton/application-v3/state/coordination/events.jsonl`, 105,142 events; located per
  `channel-audit-2026-08-13/knowledge.md` §0): `scratchpad.entry_written` **24** — every one
  `scope: worker:*`, **zero** `shared`-scope entries ever (the count was 13 at the
  channel-audit poll; +11 since, all still worker-scoped, including sibling rows of THIS wave,
  e.g. seq 100718 `worker:w-422` "row-member-lanes contract LANDED…"); `scratchpad.entry_elevated`
  **4** — unchanged since 2026-08-13T04:59:58Z, all four `scratchFactId: null` (the automatic
  settlement ritual, never a member or orchestrator command); `scratch.fact_posted` **0**;
  `knowledge.promoted` **205** — grouped by `payload.promotion.trigger`: 183
  `verified_task_outcome`/Finding, 12 `verified_task_outcome`/Counterexample, 4
  `verified_task_outcome`/Question, 6 `integration`/Decision — **every promotion auto-minted**
  (task-passed-verification policy nodes + six decision records); zero promotions derive from a
  scratchpad entry, zero from any foundry-loop fold, zero edges were authored by any campaign
  member. The channel audit's K1/K2/K4/K7 verdicts (PROVEN/GAPPED/UNEXERCISED) all reproduce
  at the larger count. **No member has ever READ the plane either**: the serving lanes below
  (GT2) have no production call site, and the only evented reads (`_knowledgeReads`, fed by
  `readKnowledge` via `recallKnowledge`, `coordinator.mjs:11004-11024`) have zero campaign
  invocations — the store shows no member- or orchestrator-driven recall for any foundry wave.
- **GT2 — the serving machinery is BUILT and INERT: `serveKnowledge` has no production call
  site and the briefing seam defaults to null.** The ambient slice builder
  `serveKnowledge(objective, {maxFindings, maxBytes})` (`coordinator.mjs:11031-11047`, comment
  block at `:11025-11030`) recalls keyword-matched Findings and bounds them via
  `buildKnowledgeSlice` (`messages.mjs:714-800`; honest-empty at `:777`, expired-validity
  dropped at serve time, `{provenance:'knowledge', untrusted:true}` wrap, BOTH caps
  `view.knowledge_slice.items`=8 / `view.knowledge_slice.bytes`=2048, `limits.mjs:106-107`).
  A session-wide grep for `serveKnowledge` across `impl/src` + `impl/scripts` returns ONLY its
  definition. The provider seam: `opts.knowledgeBriefingProvider` defaults `?? null`
  (`coordinator.mjs:972-976`) and the seam at `_providerBrief` (`:3886-3891`) returns the inner
  brief unchanged when null — and NO deployment passes the option (grep across `index.mjs`,
  `application-deployment.mjs`, `impl/scripts/`: zero hits; only tests construct providers,
  `kg3-activation-red.test.mjs:156-165`). The renderer is ready and dead: `renderBrief`
  (`adapter.mjs:104-177`) emits `## Ambient knowledge (provenance: knowledge — untrusted,
  verify before use)` for `brief.knowledge` (`:152-170`) — but no code path ever sets
  `brief.knowledge` on a spawned member's provider brief, so the section has never rendered
  for a real worker. The KG-A1 suite (`impl/test/kg-activation-red.test.mjs`, 6/6 green at
  HEAD this session) pins the slice BUILDER, not the wiring — the water never reaches the
  pipe.
- **GT3 — #103's L0 pack attaches to every spawn brief but NEVER RENDERS.** The #81 O-6
  orientation grant injects `inner.orientation` at `_providerBrief`
  (`coordinator.mjs:3849-3852`), computed by `_orientationL0Grant(brief)`
  (`:11658-11665`: a pathScope-scoped module map, `UNTRUSTED_ORIENTATION_L0 — structural map,
  evidence to verify, never instruction` frame, cited packId). `renderBrief`
  (`adapter.mjs:104-177`) has NO orientation section — grep for `orientation` in
  `adapter.mjs` returns ZERO hits — so the L0 value is attached to the provider-facing brief
  object and then silently dropped by every dialect renderer (claude `:781`, codex `:761`,
  kimi `kimi-acp.mjs:409`). The member briefing this contract specifies rides the SAME
  discipline (cited-by-digest, UNTRUSTED-framed, never spliced into the objective — the #103
  D-laws, `briefing-pack-2026-08-06/briefing-pack-contract.md` D1-D9), and the found dead
  render is part of the activation debt: a spawn-brief lane that exists but never reaches the
  provider is the #186 disease in miniature.
- **GT4 — elevation ergonomics: every read surface collapses elevation state, and the elevate
  verbs presuppose knowledge only the ritual ever had.** `candidateState` is hardcoded
  `'candidate'` on both projections — the run view (`application.mjs:832`, inside the
  `projectScratchpadView` row mapper) and the horizon view (`coordinator.mjs:421`, the
  `project` mapper) — even for rows whose `source` is a non-null
  `{entryId, entryDigest, eventSeq}` (an elevated row): the field STATES 'candidate' about
  rows that are provably elevated — a surface that lies. `run.scratchpad.read`
  (`application-semantics.mjs:1694-1702`; handler `application.mjs:13298+`) returns no
  elevation-derived field and no awaiting-collection; `run.scratchpad.elevate`
  (`application-semantics.mjs:1704-1713`; handler `application.mjs:13338-13360`; CLI branch
  `application-cli.mjs:1597-1612`) REQUIRES the caller to name `entryIds` — the channel
  audit's Q3/K5: "the two entryIds-required elevate commands presuppose a selection only the
  ritual ever produced," and "there is no command that lists entries awaiting elevation
  review." Nothing has landed since: grep for `awaiting`/`reviewQueue` across `impl/src`
  returns only task-phase vocabulary (`application-semantics.mjs:21-22`).
- **GT5 — the elevation ritual exists, is interpreter-driven, bounded, and misses siblings.**
  The steering policy `elevateWhenNotes {kinds, maxEntries}` (`workflow-interpreter.mjs:
  251-261`) drives `tryElevate` (`:1091-1120`): reads the member's worker scope via
  `run.scratchpad.read`, filters by kinds, takes `maxEntries` entryIds, calls
  `run.scratchpad.elevate`, dedups once per `(runId, role)` — this wavefile's own
  `elevateWhenNotes doubt,plan 20` rides it. The kernel is `elevateTaskScratchpad`
  (`coordination-store.mjs:14356`; pm-kg cited `:14173` — shifted) and the orchestrator ritual
  `settlementLease` (channel-audit Q2). The live miss: exactly ONE
  `scratchpad.partition_reaped` event exists (w-196 only); w-198's four notes were never
  elevated and INVISIBLE as awaiting (GT4) — K3 GAPPED, still unreproduced-by-fix at HEAD.
- **GT6 — the edge vocabulary is closed and has NO fold-authored kinds; the admit gate is the
  only promotion path and KG-A5 pins it so.** `KNOWLEDGE_EDGE_TYPES`
  (`coordination-store.mjs:149`) = `Supports, Contradicts, Supersedes, Informed, ProducedBy,
  Contains, DependsOn, Refines, ReadBy, VerifiedBy, DerivedFrom, Affects, Cites, ObservedIn`
  (sorted-key ACTUAL order of the literal) — **no `Blocks`, no `Resolves`**; an unknown type
  refuses `invalid_edge_type` at `:16028`. Edges today are minted only by the scorecard and
  reuse machinery (`:3424-3426` DerivedFrom/ProducedBy/ObservedIn; `:3678-3689`
  derived/informed/producedby/supersedes) — nothing in the foundry loop (fold records, QA
  verdicts, red-team blockers) has ever written an edge. The admission authority is
  `admitWorkflowFinding` (`coordination-store.mjs:16390+`) — run-orchestrator-lease-bound,
  session-gated, idempotent — surfaced as `knowledge.promote`
  (`application-semantics.mjs:1509-1517`, "run-orchestrator lease gates workflow Finding
  admission"). KG-A5 is GREEN at HEAD (`kg-activation-red.test.mjs`, run this session): no
  auto-admit call site exists — any first-writer mechanism this contract specifies must ride
  the gate, not bypass it.
- **GT7 — the nudge (#190's target) is static, unconditional-on-silence, and
  identical-every-time.** The steering grammar admits `nudgeOnCheckpoint {message}` ONLY —
  any other field refuses at wavefile parse (`workflow-interpreter.mjs:234-240`).
  `handleCheckpoint` (`:1070-1086`) fires when attention carries a `turn_checkpoint`: the
  nudge dedups by ROLE (`s.nudgedRoles`, state at `:624`) and sends the STATIC message via
  `nudge_turn` — there is no silence predicate (a member parked at a checkpoint gets nudged
  whether it has been silent for one poll or a whole afternoon), no delta payload (the message
  is wavefile prose, byte-identical across waves — this wavefile's own
  `"Continue the contract — ground truths cited fresh…"`), and no information about WHAT
  changed. The silence machinery the floor needs ALREADY EXISTS and is unused by the nudge:
  the #163 quiescence state `{lastMeaningfulAt, silentSinceMs, active, phase}`
  (`workflow-interpreter.mjs:818`, advance tracking `:892-902`) already distinguishes a member
  making meaningful progress from a silent one.
- **GT8 — every signal a delta-nudge would carry is already computed and per-member.** The
  workflow-horizon `knowledgeDigest` rides each member's run view (`application.mjs:8099-8111`
  `_knowledgeProjection` — fails open to a zero block; `wave.mjs:361-366` puts it on every
  member row of `progress()`, `:353` for a failed-start member as `null`); the candidacy
  ritual counts (`knowledgeRitual`, `coordination-store.mjs:17267`) ride the same projection
  into receipts; `recallPreview` (`coordination-store.mjs:16745`) is the pure, cached,
  fail-open read. Sibling settlement signals (which roles are done — `doneRoles`) live in the
  same interpreter loop that owns `handleCheckpoint`. A delta-nudge composes from projections
  that exist; it needs no new store machinery.
- **GT9 — the member `shared` publish lane (#158) is an ADMISSION GHOST at HEAD, so the
  foundry frame's publish step remains structurally refused.** `run.scratchpad.append` is
  declared with `surfaces: ['embedded','mcp','cli','web']`
  (`application-semantics.mjs:1710-1722`), admitted on the web bus
  (`web-northbound.mjs:53`) and dispatched by MCP (`mcp-northbound.mjs:2044`) — but
  `application.mjs` has NO dispatch branch (the pre-gate chain `:12704-12711` names
  read/elevate only) and no `scratchpadAppend` method exists, so the command refuses
  `application_command_unavailable` (`:12883`); the CLI parser has no `append` subverb —
  live-probed THIS session against `parseBatonCli`:
  `['run','scratchpad','append','run:1','--scope','shared','--kind','note','--body','x']` →
  **THROW `unexpected argument append` (`cli_invalid`)**, while `read` parses. The landed
  suite pins the refusal AS the evidence (`blind-waits-red.test.mjs:1248-1269`, P-PUBLISH).
  This is the #157 ghost class (advertised-but-dead) — and GT1's zero-shared count is its
  lived consequence.

### The comparison verdicts this row operationalizes (evidence, cited)

- **GT10 — pm-kg's headline is this contract's thesis: "the real finding is activation, not
  representation"** (`pm-comparison-2026-08-13/pm-kg.md` §0.2): baton's KG already owns a
  superset of pm's vocabulary (19 node kinds, 14 edge kinds, bi-temporal validity,
  deterministic contradiction resolution — §2 table); both systems' knowledge machinery is
  write-only in practice; the highest-value adoptions are the BRIEFING (C7 ADAPT: pm's
  `build_knowledge_briefing` exists but is "never ambient" — v6 postmortem — exactly baton's
  GT2) and the DELTA READ (C16 ADAPT: an event-boundary "what changed since the last review
  point" as the elevation-review queue, closing channel-audit K5 — "the most actionable
  borrowing"; pm's ISO-date input is REJECT as a wall-clock control, so the boundary is an
  event seq, never a date). J1's honesty note governs: "ALREADY-HAVE-as-settled-design,
  RED-to-ship" must never be laundered as landed — this contract's pins are the RED side of
  that ledger.

---

## Decisions

### D1 — Computed member briefings at spawn: the ambient slice is SERVED, not merely buildable (#186 headline)

1. **The wiring point is the landed provider seam, defaulted — not a new mechanism.** The
   deployment constructs the coordinator with a `knowledgeBriefingProvider` that derives from
   `serveKnowledge(inner)` (the objective/goal keywords → bounded slice). The seam
   (`coordinator.mjs:3886-3891`), the builder (`:11031-11047`), and the renderer
   (`adapter.mjs:152-170`) are all landed; the decision is that the DEFAULT is a real provider
   (opt-OUT `knowledgeBriefingProvider: null` preserves the inert seam for tests), so every
   spawned member's provider prompt carries `## Ambient knowledge`. Alternative considered and
   rejected: composing the briefing into the L0 context-pack family — rejected because the
   `brief.knowledge` lane is the purpose-built KG-activation seam with its provenance wrap and
   byte discipline already pinned by the KG-A1 suite; the L0-pack discipline is honored in
   SHAPE (cited, UNTRUSTED-framed, never spliced into the objective), not by duplicate
   plumbing.
2. **Honesty-pinned (each law names its landed anchor):** the slice never enters `task.brief`
   — `briefDigest` stays byte-stable (the KG-3 rule 6/6a discipline, `coordinator.mjs:3879-
   3885`); an empty/unmatched graph serves the honest-empty marker `(none — no recalled
   knowledge matched this objective)` — never fabricated relevance (`messages.mjs:777`);
   expired-validity nodes never serve (serve-time filter); every item renders as
   `[knowledge/untrusted] ref (validFrom→validTo): snippet` under the untrusted-verify frame;
   truncation is disclosed (`- (truncated — …)`); a serve-path fault degrades to omission
   with the store's fail-open marker, never blocks a spawn.
3. **Event-derived, no clocks:** the slice is computed from the store's folded state at spawn
   time; nothing in the serving path reads a wall clock for a control decision (recency is
   event-seq, per `recallPreview`'s fence discipline).
4. **The L0 pack render gap closes with it (GT3):** the orientation value that
   `_providerBrief` already attaches gains its renderer section — same section discipline
   (UNTRUSTED frame, cited packId, after `## Path scope`, before `## Definition of done`),
   every dialect. A spawn-brief lane that exists but never reaches the provider is the
   activation disease; this rung deletes one instance of it.

### D2 — Elevation ergonomics: state becomes DERIVED, and the queue becomes a read (#186 second surface; pm-kg C16)

1. **`candidateState` is derived from store truth, ending the lie.** Both projection sites
   (`application.mjs:832`, `coordinator.mjs:421`) compute the field: `'elevated'` when the
   row's `source` is a non-null elevation record, `'candidate'` otherwise. The closed value
   set is `{candidate, elevated}` — additive, sorted-key literal order in any schema.
2. **The delta review read is an EVENT-BOUNDARY listing, never a date.** The orchestrator can
   ask "what awaits elevation / what changed since event seq N": the run-scratchpad read
   surface gains a boundary-parameterized projection listing (a) worker-scope entries not
   elevated and not reaped (awaiting — the w-198 shape becomes VISIBLE), (b) elevation events
   with seq > N (what the ritual did), (c) promotion events with seq > N (what the admit gate
   did). pm's ISO-date input shape is REJECT (GT10); the boundary is an event seq or omitted
   (all), and the response carries the fence it was computed at.
3. **The elevate verbs' presupposition is removed:** the awaiting list IS the entryIds source
   the manual elevate verbs always required (GT4) — a caller composes `run.scratchpad.elevate`
   from the queue's entryIds; no new elevate path is minted, and the ritual
   (`elevateWhenNotes`, GT5) is unchanged.

### D3 — The foundry-loop first-writers: folds emit Blocks/Resolves edges through the admit gate (amended #187)

1. **The vocabulary grows additively:** `Blocks` and `Resolves` join `KNOWLEDGE_EDGE_TYPES`
   (closed set, additive-only — GT6). Semantics pinned: **`Blocks`** — a Finding that names a
   blocker arcs `from:` the blocker Finding `to:` the artifact node it blocks (a red-team
   finding blocks a contract's fold); **`Resolves`** — the fold/QA verdict artifact `from:`
   the fold record `to:` the node it resolves (a fold that lands SOUND resolves the issue's
   finding node). Both carry evidence refs (the store's edge evidence discipline, `:3424`).
2. **The writer is the fold stage under orchestrator authority — the admit gate stays the
   ONLY promotion path (KG-A5 stays green).** A fold landing (the orchestrator seat's fold
   record — the same lane that mints `wave.closed` campaign-state records, #103 D9) admits
   the fold/finding nodes and mints the edges via the existing `admitWorkflowFinding`
   lease-bound path (`coordination-store.mjs:16390`). No auto-admit call site appears: the
   emission is orchestrator-actioned at fold time, typed and idempotent like every admission.
3. **Replay-true:** the edges are ledger events like every edge (`knowledge-edge:*` identity,
   history maps); a store reopened over the same logDir reconstructs them.
4. **Direction of first writing:** the foundry loop becomes the FIRST deliberate member-loop
   edge-writers — red-team blockers and fold verdicts stop being scratchpad prose that dies
   in a worker partition (GT1: 24 entries, zero edges) and become graph-attached, contestable
   state. (A `Blocks` edge is assertable by evidence; a `Resolves` is superseded by a later
   re-open — bi-temporal validity already encodes both.)

### D4 — The delta-nudge (#190): silence-floored, delta-carrying, cry-wolf-guarded

1. **Silence-floored:** the checkpoint nudge fires only when the member is SILENT by the
   #163 quiescence state (`workflow-interpreter.mjs:818` — `lastMeaningfulAt` not advanced
   across the floor); a member making meaningful progress is never nudged at a checkpoint.
   The floor is quiescence-derived (the interpreter's own cadence term), deployment-owned —
   never a wall-clock constant (no clocks).
2. **Delta-carrying:** the nudge message is COMPUTED, not wavefile prose: the delta since the
   member's last observed boundary — settled sibling roles, awaiting-elevation counts for its
   scope, `knowledgeDigest` changes (GT8 signals), each named concretely. The static
   `message` field remains as the wavefile's FRAMING prefix (it may frame, it may not
   substitute for the delta).
3. **Cry-wolf-guarded (the #190 core):** no nudge is sent whose delta is EMPTY, and no role
   is sent the SAME delta twice — the guard is a delta-digest dedup alongside the existing
   per-role once-shape (state at `:624` gains `nudgedDeltaDigests`); the steering trail
   (`steering.push`, `:1081`) records the delta digest it acted on, so the QA can audit that
   every nudge carried information. A nudge that teaches "ignore me" is the failure mode this
   decision exists to delete.
4. **Grammar stays closed:** `nudgeOnCheckpoint` gains at most the optional framing fields
   the delta needs (e.g. `floor`); unknown fields still refuse at wavefile parse (GT7's
   `steeringUnknown` discipline).

### D5 — The ghost is named, not absorbed: `run.scratchpad.append` is #158's lane

This contract does NOT specify the append verb's implementation (it is #158's rung with its
own folded contract, `scratchpad-write-2026-08-13/contract-fold.md` v1.1). But the ghost is
load-bearing for THIS row twice: the foundry frame's publish step rides it (GT9 — the shared
publish this contract must attempt below), and D3's first-writers exist BECAUSE member prose
currently has no durable lane. The contract therefore records the dependency as a pin-side
condition (P6 names it) and defers the fix to #158's owner — absorbing it here would
double-own a folded contract, the overlap the QA brief flags.

---

## Refusal vocabulary (closed; surface-constant)

- **Serving (D1):** builder/request faults refuse `causal_recall_invalid` (landed,
  `coordination-store.mjs:16752-16762`); serve-path degradation is the fail-open
  `briefingUnavailable` marker (`:16745` comment block) — omission, never a spawn block; a
  misconfigured provider still refuses `TypeError` at construction
  (`coordinator.mjs:973-974`) — construction-time, never per-spawn.
- **Elevation read (D2):** an invalid boundary (non-safe-integer seq, negative) refuses
  `scratchpad_read_invalid` (the existing read normalizer's family,
  `application-semantics.mjs:1694-1702`); scope grammar unchanged (`shared|worker:ID`); the
  response names its fence — a stale read is honest about being stale, never silently
  refreshed.
- **Edge admission (D3):** unknown edge type refuses `invalid_edge_type`
  (`coordination-store.mjs:16028`); admission authority faults refuse the landed family —
  `workflow_admit_invalid`, `run_orchestrator_lease_not_found`, `run_orchestrator_session_mismatch`
  (`:16390-16416`); a duplicate fold-edge identity refuses the store's idempotency/identity
  codes (`reuse_namespace_conflict`-class), never a silent overwrite.
- **Nudge (D4):** wavefile-parse refusals stay the `steeringUnknown` family
  (`workflow-interpreter.mjs:234-240` — unknown field, non-string message, invalid floor); at
  drive time there is NO new refusal — the guards (empty delta, duplicate delta, non-silent
  member) are non-sends recorded in the steering trail, because a nudge is advisory steering,
  not an admission. `nudge_turn` delivery stays best-effort (`:1080`).
- **Vocabulary law:** no new refusal code is introduced by this contract except as named
  above (none); every new behavior reuses a landed code or a recorded non-send.

---

## Red-first acceptance pins

Each pin is RED at HEAD at a named stage and GREEN only for a correct impl — a wrong impl
that merely papered over the failure shape must still fail.

- **KA1 — ambient knowledge SERVED at spawn (D1.1-D1.3).** *Stage: `spawn-briefing-inert`.*
  **Red at HEAD:** spawn a member (any dialect; glm rides the claude renderer,
  `adapter.mjs:769-782`) in a fixture whose store holds a live, keyword-matching Finding —
  the provider prompt contains NO `## Ambient knowledge` section: `serveKnowledge` is never
  called (GT2, zero call sites) and `_knowledgeBriefingProvider` is null in every deployment
  (GT2). Structural red: grep `serveKnowledge` in `impl/src` returns the definition only.
  **Green only for:** the same spawn's prompt carries the section with ≥1
  `[knowledge/untrusted]` item whose ref+validity window+snippet derive from the store;
  an unmatched objective renders the honest-empty line, never a fabricated item; an
  expired-validity node never appears; the section's byte total respects BOTH caps (8
  items / 2048 bytes, `limits.mjs:106-107`); `briefDigest` (digest of the admitted
  `task.brief`) is byte-identical with and without the slice. **Anti-shallow:** a test that
  calls `serveKnowledge` directly and asserts on its return is NOT green — the pin asserts
  the RENDERED PROMPT of a spawned worker; and a slice spliced into `task.brief` fails the
  briefDigest arm by construction.
- **KA2 — the L0 pack RENDERS (D1.4).** *Stage: `orientation-attached-never-rendered`.*
  **Red at HEAD:** `_providerBrief` attaches `orientation` (`coordinator.mjs:3849-3852`) but
  `renderBrief` emits no orientation section (GT3 — zero `orientation` hits in
  `adapter.mjs`): the value is dropped before every provider prompt, every dialect.
  **Green only for:** every dialect's rendered prompt carries the UNTRUSTED_ORIENTATION_L0
  frame with the cited packId and the pathScope map; a brief with no pathScope renders the
  default-scope map (the grant's `['.']` default, `:11659`); the frame text is verbatim the
  grant's frame constant. **Anti-shallow:** asserting `providerBrief.orientation` EXISTS is
  NOT green (it exists at HEAD) — the pin asserts the rendered string.
- **KA3 — elevation state is derived and the queue is readable (D2).** *Stage:
  `elevation-state-collapsed`.* **Red at HEAD:** (a) `run.scratchpad.read` on a scope
  containing an elevated row returns `candidateState: 'candidate'` for it — the hardcoded
  literal (`application.mjs:832`, `coordinator.mjs:421`) states 'candidate' about a row whose
  `source` is a non-null elevation record; (b) no surface lists awaiting-elevation entries —
  the w-198 notes (GT5) are invisible on every read. **Green only for:** (a) the elevated
  row reads `candidateState: 'elevated'` (derived from `source`), unelevated rows read
  `'candidate'`, the value set is exactly `{candidate, elevated}`; (b) the boundary read
  with no prior elevation events lists the never-elevated worker entries as awaiting (the
  fixture reproduces the w-198 shape: two workers, one reaped, one missed); (c) the same
  read with boundary N reports elevation/promotion events with seq > N and names the fence
  it computed at; (d) an invalid boundary refuses `scratchpad_read_invalid`.
  **Anti-shallow:** flipping the literal to a second hardcoded constant keyed on `source !==
  null` WITHOUT the queue arm is NOT green — (b) is the K5 closure; and a date-parameterized
  variant fails by construction (the boundary is a seq).
- **KA4 — folds emit Blocks/Resolves through the gate (D3).** *Stage: `fold-edges-absent`.*
  **Red at HEAD:** `KNOWLEDGE_EDGE_TYPES` lacks both kinds (`coordination-store.mjs:149`); a
  fold-record landing mints zero knowledge edges (GT1/GT6 — no foundry-loop edge writer
  exists). **Green only for:** a fold whose QA names a blocker mints a `Blocks` edge
  (blocker-Finding → blocked-artifact) and a fold verdict lands SOUND minting a `Resolves`
  edge (fold-record → resolved node), each with evidence refs; BOTH minted via the
  run-orchestrator lease-bound admit path — the KG-A5 source-scan (no auto-admit call site)
  STAYS green after the landing; reopening the store over the same logDir replays both edges;
  an edge with an unknown type still refuses `invalid_edge_type`; a replayed fold admission
  is idempotent (same identity, no duplicate edge). **Anti-shallow:** minting the edges from
  a new non-gated writer fails the KG-A5 arm by construction; and an edge without evidence
  refs fails the evidence discipline arm.
- **KA5 — the delta-nudge is silent-only, delta-carrying, and never repeats itself (D4).**
  *Stage: `static-nudge`.* **Red at HEAD:** with `nudgeOnCheckpoint` configured, a member
  parked at a `turn_checkpoint` is nudged with the STATIC wavefile message regardless of
  silence, with no delta content, and the steering trail records only
  `{trigger, role, requestId}` (`workflow-interpreter.mjs:1077-1082`) — nothing about what
  changed. **Green only for:** (a) a member whose `lastMeaningfulAt` advanced within the
  floor is NOT nudged; (b) a silent member's nudge message CONTAINS the computed delta
  (named settled siblings / awaiting counts / digest changes — at least one concrete delta
  item); (c) two consecutive checkpoint parks with an UNCHANGED delta produce at most one
  nudge (digest dedup) while the steering trail records the delta digest; (d) a checkpoint
  with an empty delta produces NO nudge send and a trail entry saying why;
  (e) wavefile parse still refuses unknown `nudgeOnCheckpoint` fields. **Anti-shallow:**
  string-matching the static message plus an appended timestamp is NOT green — (c)'s dedup
  is digest-keyed on the DELTA, not the message; and nudging a progressing member fails
  (a) by construction.
- **KA6 — activation honesty on the wave surfaces (cross-cutting; KG-A3/A4 stay green).**
  *Stage: `activation-honesty`.* **Red at HEAD (narrow):** the ritual counts and digests ARE
  landed (GT8 — `_knowledgeProjection`, member-row `knowledgeDigest`), so this pin's red arm
  is the dishonesty the new surfaces could INTRODUCE: a served-but-unlabelled briefing, a
  queue without its fence, a delta without its boundary. **Green only for:** every new
  activation surface renders zero as `0` / honest-empty (never a missing field), names its
  fence/boundary, and wraps served knowledge in the untrusted frame; the existing
  kg-activation suites (`kg-activation-red`, `kg3-activation-red` — 6/6 + 9/9 green at HEAD
  this session) stay green-unchanged after the landing. **Anti-shallow:** a surface that
  omits the fence/boundary to avoid staleness disclosure is NOT green — honesty is the pin.

---

## Fold-record-ready pin list

| Pin | Stage (RED at HEAD) | Decision | Green only for | Anti-shallow |
|---|---|---|---|---|
| KA1 | `spawn-briefing-inert` | D1.1-D1.3 | spawned member's rendered prompt carries the ambient-knowledge section (store-derived, untrusted-framed, capped, honest-empty); briefDigest byte-stable | builder-unit assertions not green — the RENDERED PROMPT is the pin |
| KA2 | `orientation-attached-never-rendered` | D1.4 | every dialect renders the L0 frame + cited packId + map | value-exists assertions not green — it exists at HEAD |
| KA3 | `elevation-state-collapsed` | D2 | candidateState derived `{candidate, elevated}`; event-seq boundary queue lists awaiting + elevation/promotion deltas, fence-named; invalid boundary typed refusal | literal-swap without the queue not green; date-boundary fails by construction |
| KA4 | `fold-edges-absent` | D3 | `Blocks`/`Resolves` join the closed vocabulary; fold landings mint both via the lease-bound admit path; replay-true; KG-A5 stays green | a non-gated writer fails KG-A5; evidence-less edges fail |
| KA5 | `static-nudge` | D4 | silence-floored send carrying a computed non-empty delta; delta-digest dedup; trail records the digest; empty delta = no send | timestamp-appendix not green; nudging a progressing member fails |
| KA6 | `activation-honesty` | D1-D4 (cross) | zeros rendered as `0`/honest-empty, fences/boundaries named, untrusted frames everywhere; kg-activation suites green-unchanged | fence-omission to dodge staleness disclosure not green |

---

## Judgment calls (recorded per the frame's law)

- **J-path — the deliverable path: redrive3, not the brief's literal `redrive2` text.** The
  row brief's deliverable line names `…/redrive2/contract-knowledge-activation.md`, but the
  wavefile (`collab-contracts.wavefile:22`) assigns this member's report to
  `…/redrive3/contract-knowledge-activation.md`, the dispatch's hard scope is
  `redrive3/**`, and the harvest rows (`:45`) read the redrive3 path. The `redrive2` string
  is a flood-pack copy artifact (commit `5ae2c7e5` bumped key+path in the wavefiles; the row
  briefs' deliverable prose was not regenerated). Ruling: the wavefile + dispatch scope govern
  — writing to redrive2 would both violate the scope and orphan the harvest.
- **J1 — the briefing rides the `brief.knowledge` seam, not a context pack.** The brief says
  "riding #103's L0 pack." Read as MACHINERY, that means the context-pack lane; read as
  DISCIPLINE (cited-by-digest, UNTRUSTED-framed, never spliced — #103's D-laws), the landed
  `brief.knowledge` seam satisfies it while being the purpose-built, suite-pinned KG-3
  activation seam. Chose the discipline reading (D1.1); the machinery reading remains open as
  OQ2's fallback if the QA rules the seam-then-render order load-bearing.
- **J2 — `candidateState` derivation at BOTH sites, value set exactly two.** A third state
  (e.g. `awaiting`) was considered and rejected: awaiting-ness is a QUEUE projection
  (D2.2), not a per-row intrinsic — keeping the row field two-valued keeps the projections
  honest and the queue computed.
- **J3 — fold edge direction pinned without #187's body.** The issue text was unfetchable
  (gh unauthenticated); the brief carries only "folds emit Blocks/Resolves per the amended
  #187." Directions in D3.1 are this contract's reading of the foundry loop's actual artifacts
  (red-team blocker reports, fold verdicts — both on disk in every foundry evidence dir).
  If #187's amendment names different endpoints, D3.1's direction flips without touching the
  mechanics (vocabulary, gate path, replay) — the pins are endpoint-parameterized, so the QA
  can substitute. Flagged as DR1.
- **J4 — the delta-nudge keeps the static message as framing prefix, not prefix+suffix.**
  Deleting the wavefile's `message` field would break every standing wavefile at parse
  (grammar law); keeping it as the whole message is the status quo's cry-wolf. Framing-prefix
  is the additive middle; the delta is the body.
- **J5 — first-drive framing.** `redrive/` and `redrive2/` hold no prior text for this row;
  unlike the lifecycle rows, there is no superseded v1 to reconcile — every ground truth here
  is verified fresh at THIS HEAD, with the 2026-08-13 evidence cited as evidence (its anchor
  drift is named in the header).

---

## DECISION_REQUEST entries (authority-class ambiguity; no bus verb in this harness — recorded
here for the orchestrator, per the redrive QA's precedent)

1. **DR1 — who owns the closed edge vocabulary amendment?** `KNOWLEDGE_EDGE_TYPES` is a
  store-level closed registry that the KG epics (#24-#27), the kg-activation impl wave
  (`impl-kg-activation-2026-08-14`), and THIS row all touch. **Options:** (a) this row's impl
  wave adds `Blocks`/`Resolves` (they are foundry-loop semantics, this row's lane); (b) a
  kg-scoped wave adds them with this row consuming; (c) they are aliases of existing kinds
  (`Blocks`≈`Affects`, `Resolves`≈`Supersedes`) and NO vocabulary change lands — the fold
  emits use existing kinds. **Default taken:** (a), because the brief's "per the amended
  #187" names fold emission as THIS row's requirement; (c) is a real alternative if #187's
  amendment predates the 14-kind registry — the QA should check #187's text before the fold.
2. **DR2 — the fold emission's authority carrier.** D3.2 rides the run-orchestrator
  lease-bound admit path. **Options:** (a) the fold record's mint rides the SAME
  `wave.closed`-style internal seam as #103 D9 (an `_fold.record` internal command under
  orchestrator actor); (b) the fold is an ordinary `knowledge.promote` per edge, called by
  the folding seat; (c) a dedicated `knowledge.fold_record` kernel verb. **Default taken:**
  (a) — the #103 D9 precedent is the landed shape for wave-stage internal records; (b) is
  the fallback if the QA finds the lease semantics awkward at fold time.
3. **DR3 — the delta-nudge's boundary source.** D4.2 computes the delta "since the member's
  last observed boundary." **Options:** (a) the member's last-observed event seq captured at
  its last meaningful progress (per-member, event-derived); (b) the wave's admission seq
  (per-wave, coarser); (c) the member's last DELIVERED nudge digest (recursive but
  self-consistent). **Default taken:** (a) — per-member and clock-free; (b) under-informs
  late starters; (c) risks empty-first-nudge.

---

## Open questions

- **OQ1 — briefing scope for non-wave runs.** D1 serves EVERY spawn (the seam is the
  coordinator's). Whether a bare single-run task wants the same slice (vs wave members only)
  is deployment policy; the default-here is every spawn, bounded by the caps either way.
- **OQ2 — serving order under KA1+KA2.** The knowledge section renders after `## Output
  format` today (`adapter.mjs:152-171`); the L0 section (KA2) slots before `## Definition of
  done`. If the QA finds provider-attention ordering load-bearing (the #89 frame-waste law),
  the two sections' relative order is a fold-stage refinement, not a re-spec.
- **OQ3 — the silence floor's derivation.** The floor must be quiescence-derived (the #163
  cadence term / confirmation-poll machinery), deployment-owned — never a wall-clock
  constant. The exact term (N consecutive non-advancing polls vs the wave's
  `maxObservedGapMs` percentile) is impl policy; the pin (KA5a) only requires SOME
  quiescence-derived floor that a progressing member never trips.
- **OQ4 — awaiting-entries retention.** A worker partition never reaped (the w-198 shape)
  lists as awaiting forever if the wave is gone. Whether awaiting-ness expires with the
  wave's terminal record (the reap sweep's own semantics, GT5) or persists until reaped is a
  D2.2 refinement; the honest default is persists-until-reaped (visibility, not deletion).
- **OQ5 — delta-nudge vs `elevateWhenNotes` interaction.** Both act on worker-scope
  scratchpad state in the same interpreter loop. Whether an awaiting-elevation count may
  trigger a nudge for a member whose OWN notes await (self-referential delta) is left to the
  impl; the cry-wolf guard (digest dedup) bounds the damage either way.
- **OQ6 — first-writers beyond folds.** D3 makes FOLD records first-writers. Whether red-team
  blocker reports (pre-fold) also mint `Blocks` edges at their own landing — or only at fold
  time when the fold acknowledges them — is a #187-semantics question (see DR1/J3); the
  default is fold-time (one writer, one gate path).

---

## Publish

Deliverable written to
`docs/reference/evidence/collab-contracts-2026-08-14/redrive3/contract-knowledge-activation.md`;
full text also copied to `redrive3/shared/contract-knowledge-activation.md` (the durable
`shared` artifact, inside this dispatch's `redrive3/**` write scope — the lifecycle
redrive-3 precedent, `lifecycle-contracts-2026-08-14/redrive3/contract-members.md` §Publish).

The LIVE shared-scratchpad publish (`run.scratchpad.append`, kind note, title
"row-knowledge-activation") **was attempted this session and refused — the refusal is the
finding, per the foundry frame's #158 evidence law:**

1. **CLI:** live probe against this worktree's `parseBatonCli`
   (`impl/src/application-cli.mjs:1575-1612`):
   `['run','scratchpad','append','run:1','--scope','shared','--kind','note','--body','x']` →
   **THROW `unexpected argument append`** (wrapped `cli_invalid`, `application-cli.mjs:50`);
   `read` parses — the ghost is append-specific.
2. **Embedded/web/MCP:** the verb is declared (`application-semantics.mjs:1710-1722`) and
   admitted (web `web-northbound.mjs:53`; MCP `mcp-northbound.mjs:2044`) but
   `application.command` has no dispatch branch for it
   (`application.mjs:12704-12711` names read/elevate only) → **`application_command_unavailable`**
   (`:12883`) — pinned as evidence by `blind-waits-red.test.mjs:1248-1269` (P-PUBLISH).
3. **Store consequence:** GT1 — zero `shared`-scope entries in 105,142 events, including
   every campaign `shared` publish attempt ever made.

**Outcome: a live `shared` publish remains structurally impossible from a member seat at
HEAD — the #158 ghost, reproduced from the CLI surface this session (GT9).** The durable
artifacts — this file and the `redrive3/shared/` copy — are the report. This row's
up-channel worker-scoped publish lands via the resident's session scanner as normal
(worker-scoped by the kernel hardcode; the #158 gap in its lived form).

---

## Verification

- Edited files: ONLY `docs/reference/evidence/collab-contracts-2026-08-14/redrive3/
  contract-knowledge-activation.md` (this file) and its `redrive3/shared/` copy. No writes
  outside the dispatch scope; all external reads (impl/src, docs, evidence dirs, the resident
  store) were read-only.
- Citations: `application.mjs` + `coordination-store.mjs` anchors extracted with
  `grep -an`/`sed -n` only (NUL discipline — both files carry NUL bytes; never
  whole-file-read). `coordinator.mjs`, `adapter.mjs`, `messages.mjs`,
  `application-semantics.mjs`, `application-cli.mjs`, `workflow-interpreter.mjs`,
  `wave.mjs`, `limits.mjs`, `web-northbound.mjs`, `mcp-northbound.mjs` read directly
  (NUL-free). Store counts: read-only `jq` over the resident `events.jsonl` (105,142 lines),
  this session. Live probes: `parseBatonCli` append/read (this session, this worktree).
  Suites run this session at HEAD: `kg-activation-red` 6/6 pass, `kg3-activation-red` 9/9
  pass (`node --test`, from the worktree root — the suite's own cwd-relative file reads
  require it).
- No clocks: no wall-clock control anywhere in the specified behavior; recency/age/boundaries
  are event-seq or quiescence-derived throughout.
- Sorted-key literals: every key set quoted from source is in the literal's ACTUAL order
  (e.g. `KNOWLEDGE_EDGE_TYPES`, `coordination-store.mjs:149`).
- Deployment verification command per the execution contract: `true` (argv `[]`, working
  directory `.`) → expected exit `0`.

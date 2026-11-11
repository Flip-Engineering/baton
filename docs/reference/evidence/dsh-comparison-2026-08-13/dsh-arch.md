# DSH-ARCH — dsh's framework architecture vs baton's kernel

[attempt: f793be9c-e387-469d-9847-9cd3f4299d0f row-dsh-arch]

Lane: the framework itself — events, contexts, composition, persistence. Ground in
`dsh-digest/{cordis-primer,architecture,event-producer-consumer,subsystems/session}.md`;
baton side read live this session (NUL discipline on `coordination-store.mjs` /
`application.mjs` — `grep -an`/`sed -n` only). Every dsh citation names the digest file +
section/symbol; every baton citation names `impl/src` module + line or the issue/evidence dir.

## 1. GROUND TRUTHS (re-verified this session)

**G1 — dsh's framework is a plugin tree; baton's is a single-writer event-sourced store.** Cordis
is "A Programming Paradigm for Spatiotemporal Composability": every product is a plugin mounting
services, typed events, and reversible effects on a shared `ctx` (`cordis-primer.md` "Cordis In
Five Ideas"). Baton's kernel is the opposite pole: ONE authoritative coordination store whose
append-only `events.jsonl` ledger is the truth, every event replayed through a single deterministic
fold `_apply` to rebuild all projections (`coordination-store.mjs:1492-1522` `_append`;
`:7754` `_apply`). A plugin that could reorder/replace baton's event handling would destroy the
replay-exactness that the canonical-order receipt pins (`coordination-store.mjs:892-947`). The wave
is baton's primitive; dsh's primitives are single-agent-centric. Every candidate below is judged
for what it means across a swarm.

**G2 — dsh has a typed event map with consumers and modes; baton has one writer and implicit
consumers.** dsh declares every event's mode (`emit`/`waterfall`/`parallel`/`serial`) and publishes
a producer/consumer matrix (`event-producer-consumer.md` — a Mode column on every row, `@mode`
tags in source). Baton's events are appended by `_append`/`_appendBatch`, consumed by (a) the `_apply`
fold, (b) cursor waiters (`coordination-store.mjs:8880-8910` `waitAfter`), and (c) the run-view /
knowledge projections. No event declares a mode; the consumer shape is implicit in the fold's
`switch (event.kind)`.

**G3 — dsh asserts a "model-visible means logged" runtime invariant; baton stores the brief but
assembles part of the request at serve time.** dsh: "Anything that reaches a model request must be
reconstructable from the log, and a runtime invariant asserts it" (`architecture.md` §Session log);
`request/header` snapshots the full request envelope (`config`+`system`+`tools`) and
`foldRequestHeader` reconstructs it (`session.md` §The request header event); `deriveMessages()`
projects model history purely from the log; `Session.append` runtime-rejects non-lossless-JSON data.
Baton: the `task.created` event carries the FULL member `brief` in its payload (the prompt is in the
ledger; `_append('task.created', payload, …)` at `coordination-store.mjs:12440`), and attached
context values are content-addressed artifacts in the ledger (`context.cell_settled` /
`context.call_settled` at `:7917-7945`). BUT the ambient knowledge slice is assembled at serve time
by `serveKnowledge` and "rides the provider-facing brief value at the renderBrief seam; it never
enters task.brief, so briefDigest is byte-stable" (`coordinator.mjs:11039-11061`). The model-visible
request is a pure function of (brief + served knowledge slice + continuity pack + contextInput), and
the slice is not pinned.

**G4 — dsh policy is around-middleware; baton policy is admission/refusal gates.** dsh's
`agent/pre-step`, `tools/pre-execute/execute/post-execute` are waterfalls — listeners receive
`(...args, next)`, call `next()` to delegate, return to short-circuit (`cordis-primer.md` §Cordis
Waterfall Semantics). Baton has no middleware chain anywhere (`grep -an` on `web-northbound.mjs` /
`application.mjs` for middleware/interceptor/waterfall/`next()`: zero hits). Policy is enforced at
state-change boundaries by typed validation before append (`CoordinationRefusal` with closed codes,
`coordination-store.mjs:701-715`), the trust gate at claim-time, `_authorize` capability checks, and
the `beforeWrite` causal-correction gate (`_append`, `:1500-1504`).

**G5 — dsh registrations unwind as reversible effects; baton has leases/fences but the recovery
path is silent.** dsh: "Every registration should have a disposer" (`cordis-primer.md` §Practical
Rules); sessions fold their lifecycle into ONE `ctx.effect` so teardown unwinds in order
(`session.md` §`ctx.sessions` — `prepare`/`enter`/`announce`). Baton: writer lease
(`_assertWriterLease`, `coordination-store.mjs:1341-1355`), worker grants
(`board.grant_minted`/`board.grant_revoked`, `:8822-8856`), orchestrator leases
(`run.orchestrator_lease_issued`/`revoked`, `:7860-7869`), and a `FenceTable` per worker
(`fence.mjs:10-64`). The gap instance is #177 (stale writer-lease recovery is SILENT — a dead
holder's lease is `unlinkSync`'d with no event naming who/why; kernel-honesty audit finding 2,
`docs/reference/evidence/kernel-honesty-2026-08-13/kernel-honesty-audit.md` row 2).

**G6 — dsh composes at boot from layered profiles/bundles/patches; baton composes one static
profile map at serve.** dsh: a profile stacks bundles, holds `cordis.patch.yml`, patches target a
row by id and replace whole config; layers apply bundle-order → profile patch → home patch →
`--patch` overlay; `dsh --profile web --dump-config` prints the booted tree (`architecture.md`
§Profiles and bundles). Baton: `openBaton({ advanced: { routes, verification } })` is the whole
declaration (`resident.deployment.mjs:8-19`); the deployment builds `profiles: { default:
applicationProfile(...) }` once (`application-deployment.mjs:2023-2027`); `intent.profile` selects
it per run (`application.mjs:3168` `_profile`; `:2614-2641` profile registry). No bundle/patch
layering, no `--dump-config` analogue. #180 (per-wave profiles) is the open item.

**G7 — dsh forks a live session at a boundary; baton re-drives a fresh worker with transferred
state.** dsh: `ctx.sessions.fork(source, boundary?, childSessionId?)` selects source events through
an inclusive boundary seq, requires the prefix to end outside an open turn, and mints a live child
with lineage metadata; `session/end-seed` marks the fork boundary in the log (`session.md` §Live-
session fork API, §The end-seed boundary). Baton: #59 re-drive continuity transfers a dead
attempt's scratchpad projection + checkpoint-pin digest list + terminal cause + refusal evidence
into the next attempt's objective (untrusted-framed), never a live session fork — the worker harness
owns the live session (`docs/reference/evidence/redrive-continuity-2026-08-07/contract-59-brief.md`).

## 2. CANDIDATES — verdict per candidate

### C1. "Model-visible means logged" as a runtime invariant

- **dsh mechanism:** `architecture.md` §Session log — the invariant + "extend `SessionEventMap` and
  render from the log"; `request/header` full-snapshot + `foldRequestHeader`; `Session.append`
  JSON-validates at the source (`session.md` §The request header event, §Durability contract).
- **Baton target:** `coordination-store.mjs` ledger + `adapter.mjs renderBrief` seam + `coordinator.mjs
  serveKnowledge`.
- **Verdict: ADAPT.** Baton has the substrate (the ledger already holds `task.created.brief`, context
  values, scratchpad, knowledge nodes — the member prompt is reconstructable from the ledger), but
  the invariant is NOT asserted and the assembled request is not a pure function of the ledger. The
  gap is exactly the served knowledge slice: `serveKnowledge` is a live query (`coordinator.mjs:11039-11061`)
  whose keyword-matching, truncation, and ordering are never logged, and the continuity pack (#59)
  is assembled at render. dsh would demand a `request/header`-equivalent snapshot.
- **Landing zone / shape:** keep the byte-stable `briefDigest` (KG-3 discipline — do NOT fold the
  slice into `task.brief`, that would break identity), but ADD a log-only `brief.served` event
  appended at dispatch holding `{taskId, servedSliceDigest, knowledgeDigest, continuityDigest,
  contextCallDigest, briefDigest}` — a digest-cited reconstruction head — plus a dev-invariant
  companion that replays the ledger + served-slice inputs and asserts the rendered brief is
  byte-identical to what the member received. The model-visible contract then becomes: brief = pure
  function of (ledger + served-slice records), asserted at dispatch. This is additive-only on the
  closed kind vocabulary (`brief.served` is a new durable kind in `_apply`), honors "machine channels
  stay sterile" (digests + metadata, never prose), and serves the swarm (any member's exact context
  is reconstructable from the shared ledger — the missing telemetry/audit truth #146's surface wants).
  This also closes the honesty gap the kernel-honesty audit keeps finding (records that don't say
  what was served). **Why not ADOPT as-is:** baton's requests are assembled across a swarm by the
  orchestrator (renderBrief is a pure function over served inputs, `adapter.mjs:97`), not inside one
  agent's process — a runtime invariant inside a single `Session` cannot see the orchestrator-side
  serve; the invariant must live at the dispatch seam where the whole input set is known.

### C2. Waterfall/serial event interception as the policy mechanism

- **dsh mechanism:** `cordis-primer.md` §Cordis Waterfall Semantics (`(...args, next)`, delegate or
  short-circuit); the tool pipeline `tools/pre-execute → execute → post-execute` as the policy seam
  (`architecture.md` §Turn flow; `event-producer-consumer.md` rows).
- **Baton target:** the command bus (`application-semantics.mjs` `operations` closed registry,
  `:258-327`; `APPLICATION_COMMAND_DEFINITIONS`) and the admission gates on the coordination store.
- **Verdict: REJECT (for the kernel) — with the "which wins where" made explicit.**
  Baton's admission/refusal gates win at state-change boundaries: a single-writer lease
  (`coordination-store.mjs:1341-1355`), typed pre-append validation (`CoordinationRefusal`), a
  `beforeWrite` causal-correction gate that refuses a mid-append state change (`:1500-1504`), and the
  canonical-order receipt that pins replay identity. A waterfall chain over the event stream would
  break the replay-exact `_apply` fold — two listeners ordering differently would produce two
  histories from one ledger. dsh's waterfall wins inside a single process's request pipeline where
  policies *shape* a payload (rewrite/annotate/redirect) and the live loop can tolerate middleware
  order; baton's kernel deliberately has no request-shaping surface (the member harness owns the
  model loop; the kernel sees only effect outcomes). Where the waterfall idea is worth borrowing is
  NOT event interception but the command-admission chain: today `_authorize` collapses every refusal
  to a bare `application_unauthorized` and the hook returns a boolean so it cannot name the missing
  capability (kernel-honesty audit row 8, `application.mjs:3214-3221`). A typed pre-dispatch
  interceptor that short-circuits with a named capability refusal — dsh's short-circuit-without-next
  — is the honest form of that seam.
- **Landing zone:** `application.mjs` `_authorize`/command dispatch — ADAPT the *short-circuit
  decision* idea (a command may be refused by the first gate that names its missing capability) into
  the existing gate, NOT a general middleware substrate.

### C3. Reversible effects/registrations that unwind on unload

- **dsh mechanism:** `ctx.effect()` disposers, "Every registration should have a disposer", related
  work kept in ONE effect so teardown unwinds in order (`cordis-primer.md` §Practical Rules);
  `prepare`/`enter`/`announce` folding the session lifecycle into a single effect (`session.md`
  §`ctx.sessions`).
- **Baton target:** the lease/lifecycle machinery — writer lease, worker grants, orchestrator leases,
  fence/incarnation (`coordination-store.mjs:1341-1355`, `:8822-8856`, `:7860-7869`; `fence.mjs`).
- **Verdict: ADAPT.** Baton already has the lease/lifecycle shape (grant/release, fence bump,
  incarnation), and the fold's determinism makes teardown replayable — that is a STRENGTH dsh lacks
  (dsh's disposers are in-memory; a crash loses them). The gap is dsh's *recording* discipline: a
  registration's unload must be an observed, named event, not a silent unlink. This is precisely
  #177 (kernel-honesty audit finding 2: stale writer-lease recovery is `unlinkSync` with no record of
  who/why; `resident-authority.mjs:147,175,215` omits `reclaimed`). dsh's contribution is the
  *disposer-as-effect* mental model: every acquired authority (writer lease, board grant, orchestrator
  lease) should carry a disposer that, when fired, emits a `*.released`/`*.recovered` record naming
  `{priorHolder, cause, next}`.
- **Landing zone:** the #177 fix (emit `writer.lease_recovered` with `{priorPid, priorPidStart,
  reason: 'stale_owner'}`; expose `reclaimed` from `acquireLease` as `publish()` already exposes
  `recoveredStaleAuthority` at `resident-authority.mjs:384,412`), and the `board.grant_revoked` /
  `run.orchestrator_lease_revoked` paths already follow the recorded form — extend the same to the
  writer-lease path. Swarm lens: a silent lease recovery in a fleet means two seats can believe they
  own the same authority; the #177 record is the fencing proof.

### C4. Profiles/bundles/patches composition

- **dsh mechanism:** profile stacks bundles, patch rows by id, layered apply, `--dump-config`
  (`architecture.md` §Profiles and bundles).
- **Baton target:** `resident.deployment.mjs` + `application-deployment.mjs` profiles map +
  `intent.profile` selection + #180 per-wave profiles.
- **Verdict: ADAPT.** Baton's profile model is deployment-static: a fixed named map built once at
  serve (`application-deployment.mjs:2023-2027`), selected per run by `intent.profile`
  (`application.mjs:3168`). It lacks (a) a per-wave profile (the #180 open item) and (b) any
  inspectable composed-config surface. Do NOT adopt bundles/patches wholesale: baton's profiles are
  declarative JS in the deployment file — a patch-overlay language would smuggle a second
  configuration dialect past the closed deployment file, and the "additive-only on closed vocabularies"
  veto and the #170 doc-truth doctrine (#159: documented ⇄ parsed ⇄ admitted from one source) both
  argue for ONE declarative home. The ADAPT is two-fold: (1) make the profile map genuinely
  per-wave selectable (#180 — a wave may name a profile; the profile stays a closed named entry in
  the deployment file, never a free-form patch blob); (2) add a read-only composed-config surface (the
  `--dump-config` analogue) so the deployed profile tree — routes, review policy, export policy,
  verification — is inspectable as data, which is the "profiles are data, not a build step" idea.
- **Landing zone:** `application-deployment.mjs` (`profiles` map + a `composeConfig()` reader),
  `resident.deployment.mjs` (nothing changes — the deployment file remains the declaration),
  `application.mjs` profile selection for the wave path, #180.

### C5. `sessions.fork` — fork a live session at a boundary

- **dsh mechanism:** `ctx.sessions.fork(source, boundary?, childSessionId?)` with explicit inclusive
  boundary, rejection of a prefix ending inside an open turn, and `session/end-seed` marking the
  lineage boundary (`session.md` §Live-session fork API, §The end-seed boundary).
- **Baton target:** #59 re-drive continuity (`redriveMembers` in `impl/src/recipes.mjs`, the 93B
  attach/pin preservation, `docs/reference/evidence/redrive-continuity-2026-08-07/`).
- **Verdict: ADAPT.** A live-session fork inside a worker is out of reach for the kernel — the worker
  harness owns the live session, and baton's primitive is the wave, not the session. But #59's
  re-drive IS a fork across incarnations: it must select a stable prefix (a dead attempt's checkpoint
  pins), transfer a closed content set (scratchpad projection + pin digest list + terminal cause +
  refusal evidence), and mark the boundary in the record. dsh contributes three disciplines baton's
  #59 contract already gestures at and should pin: (1) boundary must be explicit and verified (dsh
  rejects an in-turn prefix rather than clipping silently — #59 should reject a carry-forward from a
  live/active attempt or an unrelated wave, "never silent"); (2) the carried content is seed history,
  not this attempt's work (dsh's `session/end-seed` boundary — #59's "carried content is evidence,
  not authority" / the TG2 law is the exact analogue); (3) the fork lineage is recorded durably
  (#59's provenance line — the fresh attempt must be told "this is a re-drive of attempt N, its work
  died of X").
- **Landing zone:** `redrive-continuity-contract.md` (already names 1–3; this row confirms the shape
  and adds the explicit-boundary rejection + the untrusted-framing as the `end-seed` analogue). Swarm
  lens: forking is a WAVE-level operation (re-drive a failed member), not a session-level one — the
  boundary is the wave's checkpoint, not a per-agent log position.

### C6. The four dispatch modes as a typed contract

- **dsh mechanism:** every event declares `emit`/`waterfall`/`parallel`/`serial`; mode is part of the
  event's public contract, checked by the generated catalog (`cordis-primer.md` §Dispatch Modes;
  `event-producer-consumer.md` Mode column).
- **Baton target:** `coordination-store.mjs` event kinds + the consumer surfaces (fold, `waitAfter`,
  web event feed, knowledge projections).
- **Verdict: ADAPT — adopt the *typed consumer contract*, not the four-mode dispatch.** Baton events
  DO have consumers (the question in the brief — yes, they do), but the consumer shape is implicit in
  9,000 lines of `_apply` and the cursor/wait/feed machinery. Adding a `parallel`/`waterfall` dispatch
  to the ledger is impossible: the fold must stay single-deterministic for replay honesty (G1), and a
  `parallel` fan-out over the event stream would let listener order corrupt the fold. What is worth
  borrowing is the *declaration*: annotate each event kind with its consumer mode — `fold` (serial,
  awaited, ordered: the `_apply` projection), `observe` (fire-and-forget after commit: the web event
  feed), `await` (cursor waiters: `waitAfter`), `derive` (projection-only: run view, knowledge graph)
  — and generate a producer/consumer matrix exactly as dsh does, so "where new behavior goes" is a
  checked table instead of a reverse-engineered fold.
- **Landing zone:** `coordination-store.mjs` event-kind registry (a per-kind consumer/mode declaration
  beside the closed kind set), a `docs/reference/evidence/...`-style generated matrix, and the #159
  doc-truth gate extended to the event map. This is the "events have consumers, and the mode is part
  of the contract" idea landed in baton's honest shape.

## 2A. THE SINGLE-AGENT TRAP (the law, applied per candidate)

The foundry law: baton's multi-agent primitive is the WAVE (fenced worktrees, content-addressed pins,
the coordination store); dsh's primitives are single-agent-centric. The trap is not that dsh's ideas
are small — it is that each is shaped for ONE process, ONE live session, ONE `ctx`, and a swarm that
adopts the *shape* (not the idea) inherits a per-agent mechanism the kernel cannot see or order. Every
verdict in §2 is a trap-escape; this section names the trap explicitly so the coordinator's merge
(`dsh-qa.md`) can check it against the red-team row.

| # | dsh's single-agent assumption | The trap if taken at face value | The swarm-correct form (what the verdict lands) |
|---|-------------------------------|---------------------------------|--------------------------------------------------|
| C1 | The invariant asserts inside ONE `Session` (`Session.append` is the choke point). | A runtime invariant in a worker's harness session is invisible to the kernel; N members each assert "reconstructable" against N partial views and still diverge from the shared ledger. | The assertion moves to the dispatch seam where the whole input set is known: `brief.served` digest-head + a dev-invariant replaying ledger + served-slice records and asserting byte-identity. The swarm shares ONE reconstructable truth. |
| C2 | Waterfalls are a single-process request pipeline; `next()` is in-process control flow. | A middleware chain over the shared event stream: two listeners ordering differently → two histories from one ledger; a swarm cannot share a mutable chain. | Gates at state-change boundaries (admission/refusal) — every member drives the identical closed `_apply`; the *short-circuit decision* (name the missing capability) lands at the command seam, not the event stream. |
| C3 | Disposers are per-process, in-memory; a crash loses them. | A swarm relying on in-memory unwind inherits a lie: when a worker dies mid-hold, nothing records the release; two seats can believe they own the same authority. | Unload must be a durable recorded event replayable from the ledger — the #177 `writer.lease_recovered` record. The fence is the swarm's disposer. |
| C4 | Profiles are a per-machine boot-time stack (`--profile web`). | Per-worker profile blobs = per-worker heaviness + a second configuration dialect no member can trust. | Profiles stay a closed named map in the deployment file; the wave names one per run (#180). One declarative home, inspectable as data. |
| C5 | Fork is a live-session fork in ONE process at a log boundary. | Forking per-agent sessions inside the kernel is impossible (the kernel has no live sessions; the harness owns them) and would fragment the shared record. | Fork = wave-level re-drive with an explicit boundary (#59): a dead attempt's checkpoint pins are the seed history; the lineage is recorded durably. |
| C6 | Dispatch modes are per-event listener contracts in one process. | `parallel` dispatch over the shared ledger breaks fold determinism — replay honesty dies for the whole swarm, not one listener. | Adopt the *declaration* (per-kind consumer mode: fold/observe/await/derive) + a generated producer/consumer matrix; dispatch stays the single deterministic fold. |
| C7 | Merge-extensible map = a plugin augments types at compile time. | TS declaration-merging is a compile-time single-package concept; a running swarm has no compile step to merge against. | Closed kind registry + doc-truth gate: new kinds enter only via an `_apply` row + consumer-mode declaration (#159). Additive-only on the closed vocabulary. |
| C8 | Session/agent/capability domains describe ONE agent's world. | A "live agent event" domain would be a lie for the kernel — it never sees a member's live loop (honesty veto). | Single-domain durable ledger is the honest wave form; the durable-vs-observational separation is carried by C6's consumer modes. |

The trap is escaped by construction: every ADAPT lands in the shared store or the deployment seam
(nothing per-agent), and every REJECT/ALREADY-HAVE is a place where taking dsh's single-agent shape
would falsify the wave.

## 3. ADDITIONAL CANDIDATES (found in the lane)

### C7. Merge-extensible event vocabulary vs closed kinds with doc-truth gating

- **dsh:** `SessionEventMap` is declaration-merge extensible; a plugin adds a `compaction/*` family
  and renders it from the log; unrecognized REQUIRED events refuse reconstruction, `ignorable?: true`
  opts out (`session.md` §`SessionEventMap`, §`SessionEvent`).
- **Baton:** event kinds are closed; `_apply` throws `CoordinationIntegrityError` on unknown kinds
  (fail-closed), and the #159 doc-truth doctrine pins documented ⇄ parsed ⇄ admitted from one source
  (`workflow-dsl-2026-08-13/workflow-dsl-contract.md` G6).
- **Verdict: ALREADY-HAVE (strengthen).** Baton's closed kinds + fail-closed `_apply` + doc-truth
  gate is the single-source form of "extend the map and render from the log" — the difference is that
  dsh's merge-extensibility is the *mechanism* and baton's is the *process*. Do not add TS-style
  declaration merging to a JS kernel; keep the closed kind registry (additive-only veto) and extend
  #159 to require a `_apply` row + a consumer-mode declaration (C6) for every new kind. The
  `ignorable?: true` idea is already bettered by the doc-truth gate (nothing new enters unadvertised).

### C8. The three event domains (session/agent/capability)

- **dsh:** session = durable facts broadcast; agent = live in-flight interception; capability =
  policy/adapters attached to a seam (`architecture.md` §Events).
- **Baton:** ALL coordination events are durable facts in the single ledger; live in-flight
  interception exists only in the member harness, and capability policy is admission gates
  (G2/G4).
- **Verdict: REJECT as a restructure; ALREADY-HAVE as a distinction.** Baton's single-domain ledger
  is the honest consequence of the wave primitive: the kernel never sees a member's live loop, so a
  "live agent event" domain would be a lie (honesty-over-comfort veto). What IS worth carrying is the
  *separation of durable vs observational* — which C6's consumer-mode declaration already captures.

### C9. Derived-history projection discipline (`deriveMessages()` / surface fold with `replace`)

- **dsh:** model history is NEVER stored alongside events — it is projected from the log
  (`deriveMessages()`, `session.md` §Derived transcripts); the `SessionSurface` is "the sole source of
  derived model history", advanced incrementally from committed events; a compaction event uses
  `{ op: 'replace', start, end }` to SHADOW the summarized range, and the transcript projection reads
  append-origin events instead so a human-facing view is never corrupted (`session.md` §Surface
  projection, §`SurfaceEventType`).
- **baton:** the run-outline / run-view and the knowledge graph are ALREADY fold-derived projections
  over the ledger (`_apply` rebuilds them; nothing is stored separately). The gap is honesty at the
  projection's edge, which the kernel-honesty audit keeps catching: the run-view swallows a missing row
  into the string `'empty'` — `state: items[0]?.state ?? 'empty'` (`application.mjs:10823,11122`) — and
  a mid-flight death leaves the result section bare with only a catch (`:11548` "result section may be
  empty for mid-flight deaths"). The observer cannot tell "no section" from "section is empty": exactly
  the honesty-over-comfort failure the veto names.
- **Verdict: ALREADY-HAVE (fold-derived projections) + ADAPT (the shadow-never-erase discipline at
  the projection edge).** Baton needs no separate derived store and no compaction window — the run view
  is bounded by the run, not by a growing context (the thing dsh compacts against). What it should take
  is dsh's *shadow-never-erase* rule: when a projection summarizes/replaces a range, the underlying
  append-origin events remain the transcript's truth. Concretely: `run.result` must not collapse
  "mid-flight death" and "section absent" into `'empty'` — report the pin-exists state and the death,
  or name the run's actual terminal event; never bare `'empty'`.
- **Landing zone:** `application.mjs` run-result render (`:10823,11122,11548`) — honest terminal-state
  render; the projections stay fold-derived (no new store). Swarm lens: every member sees the same run
  view because it is a pure fold — the fix makes the shared view not lie about a dead member.

### C10. The discriminated-union event type (`SessionEvent`)

- **dsh:** every log row is a discriminated union on `type` with a per-type payload shape, checked at
  append and narrowed in consumers (`session.md` §`SessionEvent`).
- **baton:** ALREADY-HAVE — every ledger row is `{schemaVersion, seq, ts, kind, actor, idempotencyKey,
  payload}`, discriminated by `kind`, narrowed in the `_apply` fold's `switch (event.kind)`, and the
  payload is `freeze(clone(payload))` at the write boundary (`coordination-store.mjs:1499`).
- **Verdict: ALREADY-HAVE.** Nothing to take; the fold's runtime narrowing is the JS form of dsh's
  compile-time narrowing, and the canonical-order receipt (`:892-947`) is a stronger check — it pins
  whole-sequence identity, not just per-row shape.

### C11. The durability contract (lossless JSON + contiguity at the source)

- **dsh:** `Session.append` runtime-rejects non-lossless-JSON data; `seq = log.length` is contiguous by
  construction (`session.md` §Durability contract).
- **baton:** ALREADY-HAVE and stricter — `_append` does `freeze(clone(payload))` then `JSON.stringify`
  at the write boundary (`coordination-store.mjs:1499-1513`), `seq = this._events.length + 1` is
  contiguous by construction, and the canonical-order receipt pins that contiguity across restarts
  (`:892-947`). Batch append refuses a non-contiguous key (`:1540`).
- **Verdict: ALREADY-HAVE.** On durability baton is not behind dsh — the single-writer ledger yields a
  stronger contiguous-sequence guarantee than dsh's per-session log.

### C12. Append idempotency (idempotency keys) — a place baton is AHEAD

- **dsh:** append is pure (a new seq per write); replay/idempotency is a caller-side path, not a log
  property.
- **baton:** `_append` is keyed — `const prior = this._byKey.get(key); if (prior) return prior;` returns
  the existing frozen event instead of double-appending (`coordination-store.mjs:1496-1513`), and batch
  append refuses a duplicate key with a `duplicate_key` refusal (`:1540`); replay skips already-known
  keys (`:1440-1445`).
- **Verdict: ALREADY-HAVE — baton is ahead.** Recorded so the merge does not present a one-sided
  "dsh knows more" story; this row names a place baton's kernel is strictly stronger.

### C13. The per-agent inbox (`agent/inbox/inserted|claimed|discarded`)

- **dsh:** every agent has a message inbox: `agent/inbox/inserted` (emit) / `agent/inbox/claimed`
  (emit) / `agent/inbox/discarded` (emit), produced by the agent-loop, consumed by goal-round-driver,
  subagent, tool-jobs, acp (`event-producer-consumer.md` rows 15-17).
- **baton:** the wave IS the inbox: `task.created` (append) → `task.claimed` (trust-gated claim,
  `coordination-store.mjs:2313,3115`) → `task.settled`, all in the shared ledger. A member's "mailbox"
  is its task object, not a per-worker queue.
- **Verdict: REJECT as a per-agent construct; ALREADY-HAVE as a wave construct.** A per-worker inbox
  with claim/discard semantics is per-worker heaviness (veto) — the swarm's queue must be the shared
  `task.*` stream so any member can observe and any orchestrator can route. What dsh's inbox names that
  baton already has: messages are first-class events with an explicit claimed state. Baton's
  `task.claimed` is exactly that, at the wave scale. No change.

## 4. THE SWARM LENS (baton's primitive is the wave)

Every ADAPT above was checked against the wave (and §2A names each trap explicitly): C1 gives the
fleet a reconstruction head per member (any member's exact context from the shared ledger); C3's
recorded lease recovery is the fencing proof two seats need; C5 makes re-drive a wave-level fork with
an explicit boundary; C6 turns the fold's consumer map into a shared contract instead of a
single-process introspection. The added rows follow the same test: C9's honesty fix makes the shared
run view not lie about a dead member; C10/C11/C12 are already wave-shaped (the ledger's discriminated
rows, contiguous sealed sequence, idempotency keys are the fleet's forms); C13 is REJECTED per-worker
precisely because the wave's `task.*` stream is already the inbox. None of the ADOPTs put per-worker
state or per-worker registration inside a worker — all land in the shared coordination store or the
deployment seam, which is where swarm truth lives.

## 5. VETOES CHECK

- No wall-clock controls introduced by any proposal (C1–C13 name no new clocks; existing thresholds
  like `PROGRESS_SILENCE_THRESHOLD_MS` are untouched).
- Honesty over comfort: C1's `brief.served` record makes the served slice observable (a surface that
  can't lie); C3's #177 record makes silent reclamation impossible; C6's matrix kills the
  "consumers are implicit" lie; C9's never-bare-`'empty'` render stops the run view lying about a
  dead member.
- Machine channels stay sterile: C1 stores digests + metadata, never prose.
- Additive-only on closed vocabularies: `brief.served` is a new durable kind, `_apply` gets one new
  row; no existing kind or code changes.
- No per-worker heaviness: all landing zones are the shared store / deployment seam; C13 is REJECTED
  per-worker for exactly this reason.
- The methodology chain governs impl: every landing zone is a `coordination-store.mjs` row or a
  deployment seam — the surfaces (#170 DSL, #180 profiles) are data over the closed spec, not new
  surface logic.

## 6. JUDGMENT CALLS AND RECORDED DECISIONS

- **C2 verdict is a REJECT-with-landing-zone for the kernel** but ADAPTs the short-circuit decision
  into `_authorize`. Recorded: the brief asked "which wins where"; the answer is gates win at
  state-change boundaries, waterfalls win inside a single process's request pipeline, and baton's
  kernel is not one — so REJECT for the event stream, ADAPT the decision-shape at the command seam.
- **C6 is ADAPT-to-declaration, not ADAPT-to-dispatch.** If a reader disagrees that dsh's modes are
  the idea worth taking, the honest fallback is REJECT the modes and keep only the producer/consumer
  matrix.
- **Shared-scratchpad publish refusal (recorded per the foundry law; re-verified this session).** The
  shared publish requires a worker-facing scratchpad write with an owned scope + fence, which needs a
  live coordination store behind a worker identity. Re-verified here: `command -v baton` finds no CLI
  in this worktree, there is no `.baton/` runtime dir, the execution contract's verification is the
  bare `true` command (no running store), and the work scope constraint
  (`docs/reference/evidence/dsh-comparison-2026-08-13/**`) forbids a store write outside the deliverable
  dir. The durable file is the harvest artifact; the publish is refused with evidence = this file + the
  dsh-comparison foundry-brief + this refusal record (#158 compliance artifact). If the coordinator
  needs the text, it is reachable from the main repo post-harvest (#174).
- No authority-class ambiguity was encountered; no DECISION_REQUEST was required.

## 7. OPEN QUESTIONS

1. Should `brief.served` be a single digest-head event per dispatch (cheap, C1's shape) or a full
   snapshot of the assembled slice (self-contained replay but heavier, and risks echoing model-authored
   content into the machine channel)? This row recommends digest-head + dev-invariant companion;
   the coordinator may want the full snapshot for #146 telemetry.
2. #180's per-wave profile: does a wave name a profile from the deployment file's closed map (this
   row's recommendation), or does it carry a profile definition inline? The latter drifts toward
   dsh's bundle-in-a-wave and should be refused under the deployment-file-as-code discipline.

## 8. SOURCES

- dsh: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-digest/{cordis-primer,architecture,event-producer-consumer,subsystems/session}.md`
  (session.md cited at §Derived transcripts, §Surface projection, §`SurfaceEventType`, §Durability
  contract, §`SessionEvent`; event-producer-consumer.md cited at the inbox rows 15-17)
- baton: `impl/src/coordination-store.mjs`, `impl/src/application-semantics.mjs`, `impl/src/application.mjs`,
  `impl/src/application-deployment.mjs`, `impl/src/adapter.mjs`, `impl/src/coordinator.mjs`, `impl/src/fence.mjs`,
  `impl/scripts/resident.deployment.mjs`
- evidence: `kernel-honesty-2026-08-13/kernel-honesty-audit.md` (#177 gap), `redrive-continuity-2026-08-07/` (#59),
  `workflow-dsl-2026-08-13/` (#170), `nested-orchestration-2026-08-03/` (#12)

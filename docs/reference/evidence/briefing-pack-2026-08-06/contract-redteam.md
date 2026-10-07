# Briefing-pack contract — adversarial red-team (issue #103)

Date: 2026-08-06. Target: `docs/reference/evidence/briefing-pack-2026-08-06/briefing-pack-contract.md` (v1.0).
Method: contract read in full; every file:line anchor re-verified against the working tree with `grep -an`/`sed -n`/`awk`; the eight mandated attacks run against the actual store, wave-driver, coordinator, MCP northbound, deployment, CLI, and the pinned test suites. NUL discipline per the law: `coordinator.mjs` (0 NUL bytes — read directly), `application.mjs` (3 NUL bytes) and `coordination-store.mjs` (3 NUL bytes) — read via `grep -an`/`sed -n` only. The contract was NOT edited.

---

## 0. Citation re-verification (attack 1)

Every anchor the contract cites was checked against the working tree. All citations resolve to the claimed content. NUL-byte counts match the contract's header claim exactly.

**Exact as cited:**

| Anchor | Verified |
|---|---|
| `coordination-store.mjs:13157/13170/13174/13180/13240` — `mintContextPack`/`contextPack`/`contextPackHead`/`materializeContextPack`/`reapExpiredContextPacks` | ✓ def lines exact |
| `coordination-store.mjs:13126-13155` — `_prepareContextPackPayload` | def at :13127; family regex :13131; body ceiling :13133; `context_pack_stale` throw :13144; `context_pack_invalid` :13138. Range covers the body ✓ |
| `coordination-store.mjs:13143-13145` / `13159-13163` / `13181-13182` / `13183-13185` — `context_pack_stale`/`conflict`/`not_found`/`expired` | ✓ within range |
| `coordination-store.mjs:8723-8731`, `observedSeq: event.seq` :8727 | ✓ the `context.pack_minted` replay fold |
| `coordination-store.mjs:492` (`MAX_CONTEXT_PACK_BODY_BYTES`), `:495` (`'2999-12-31T23:59:59.999Z'`) | ✓ exact |
| `coordination-store.mjs:13217-13220` — spill dedupe `if (this._spills.has(spillId))` | ✓ exact |
| `coordination-store.mjs:14047` — `settleWorkflowScratchpad` `auth?.actor !== 'orchestrator'` | ✓ the `|| auth?.actor !== 'orchestrator'` line is :14047 |
| `coordination-store.mjs:357` `promotionActor`; `:15926-15929` `admitWorkflowFinding` gate | ✓ exact |
| `coordination-store.mjs:8799` `events(fromSeq=1,limit=null)`; `:8804-8806` `waitAfter` validates `afterSeq` vs `this._events.length` | ✓ exact |
| `limits.mjs:82` — `'context_pack.body': { value: 8192 }` | ✓ exact |
| `wave-driver.mjs:747-755` — `baton._runSettlementRitual(waveId, memberRunIds)` | ✓ exact |
| `wave-driver.mjs:762-768` — `finally { ... wave.close(...) }` | ✓ exact |
| `wave-driver.mjs:798-803` — receipt `knowledge` block `candidatesAwaitingAdmission` | ✓ exact |
| `application-client.mjs:1586` — `_runSettlementRitual` | ✓ exact |
| `mcp-northbound.mjs:1309` (`initialize`), `:1318` (instructions brand line), `:1299` (`this.coordination.recordMcpAudit`) | ✓ exact; `this.coordination` is set in the constructor (:1171), so an initialize-time store read is feasible |
| `application-deployment.mjs` — see the drift note below | at 403f539 exact; off-by-2 in the deployment tree |
| `application-cli.mjs:1258-1264` — `doctor` command parses `--depth outline\|connection\|profile\|evidence` | ✓ exact (this is the **parser**, see D6c) |
| `coordinator.mjs:11048` (`_orientationL0Grant`), `:3801-3802` (L0 injection), `:11060` (`_runHorizonNodeIds`), `:11055-11059` (closure doc), `:10421` (`serveKnowledge`), `:10415` (activation-rule-1 comment), `:3791` (`UNTRUSTED_CONTEXT_PACK`), `:11052` (`UNTRUSTED_ORIENTATION_L0`), `:3749` (`_admitContextPackCitations`) | ✓ all exact |
| `orchestrator-friction-ledger.md:18-27` (context-engineering level), `:22` (#103 row) | ✓ exact |
| `kg-settlement-decisions.md` D2 (:23/:213) and D3 (:57/:238) | ✓ present |

**Drift finding (not a content error, but the header's verification claim is stale):** the contract says anchors were re-verified "at HEAD `403f539`". The deployment worktree HEAD is `c3e6fbe` (Baton effective-tree snapshot). `application-deployment.mjs` is the **only** cited file that differs between the two (`git diff 403f539 HEAD` = +3/−1 at ~:845, a deepseek-ceiling policy comment). At `403f539` the citations are exact (`doctorReadiness()` :1314, `Object.defineProperty` :1333-1334, `card()` :1341, `doctor()` :1342); in the tree implementation will actually touch, each of those pins resolves **2 lines early** (`doctorReadiness()` :1316, `defineProperty` :1335-1336, `card()`/`doctor()` :1343-1344). Semantic content still resolves, so this is not an automatic blocker — but the header's "verified against the CURRENT tree" claim does not match the deployment tree. Fix: re-run the application-deployment anchors against the deployment HEAD (or state the +2 diff), before implementation copies line numbers.

**NUL discipline:** confirmed by byte count (`LC_ALL=C tr -cd '\000' | wc -c`): `coordinator.mjs` 0, `application.mjs` 3, `coordination-store.mjs` 3. Contract claim correct.

---

## 1. Verdicts per decision

### D1 — The pack schema — **HOLE**

The schema is closed and canonical (good), but several fields name campaign state that **does not exist as a durable ledger fact** — the contract's own composition law (D8) is unsatisfiable for this schema. Details in Blockers B1. Specifically:

- `landings.closedAtEventSeq` — **no source exists**. The store has no wave entity and no wave-close event (the full event-kind enumeration contains no `wave.*`, no `ring`, no `lane`, no `parked`, no `blocked_on`; the wave object in `impl/src/wave.mjs:7` is documented *"It holds no durable state of its own"*; `evidence()` (:489-500) is in-memory and carries wall-clock `startedAt`, no event seq). The wave receipt is written to a **file** (`policy.evidencePath`, `wave-driver.mjs:808`), never appended to the ledger (`run.sealed` at `coordination-store.mjs:12542` carries `{runId, coordinationUpperBound, taskIds, operationalTails, scorecardDigest, scorecard, artifact, evidence}` — **no knowledge block, no receipt digest, no wave id**).
- `landings.receiptDigest` — requires reading the receipt file from the working tree; there is no receipt digest in the ledger.
- `landings.gates` — `candidatesAwaitingAdmission` is re-derivable (the settlement board, `board.item_posted` on `wave-settlement:<waveId>`, plus the `settlementLease` return `coordinator.mjs:11485`), and `admitted` is re-derivable from `knowledge.promoted` events, but `refused` is not a ledger fact.
- `rings` / `lanes` / `parked` / `blockedOn` — none have a ledger projection (see OQ1).

### D2 — When it mints — **HOLE**

Two holes, both Blockers:

1. **The first pack.** D2 has no backfill/seed path. A fresh deployment has no pack until the first wave closes; a **mature deployment upgrading to this contract** also shows `No orchestrator briefing pack minted yet.` until its *next* wave closes — even though the ledger is full of campaign state. "Honest-empty" is literally true but conflates *no pack minted* with *no campaign state*: the pack's stated purpose ("served at every session start", D2 rationale) is not met for the session that needs it most (the migration moment).
2. **Pre-close mint vs. wave closure.** For a `kg-ritual` wave the mint is a *ritual step executed before* `wave.close()` (the `finally` at `wave-driver.mjs:762-768`). At mint time the closing wave's receipt does not exist yet (it is built after close, `wave-driver.mjs:771-808`), so the closing wave **never appears in its own mint's `landings`** — it appears only in the *next* settlement's pack. Combined with `closedAtEventSeq` having no source (D1), a single-wave-then-idle campaign permanently shows no landing for its only wave.

### D3 — Who may mint — **SOUND**

The store-level, family-scoped actor pin matches the house pattern exactly (`settleWorkflowScratchpad` `:14047`, `promotionActor` `:357`, `admitWorkflowFinding` `:15926-15929`). One ordering note: the actor check must run **before** the auth-key replay check in `mintContextPack` (`:13159-13163`), so a worker with a replayed key still gets `context_pack_forbidden`, not `context_pack_conflict` — D3's "before any append" permits this; the implementation must place it first.

### D4 — No-change replay — **SOUND (with an ordering caveat)**

The content short-circuit mirrors the spill dedupe (`:13217-13220`) faithfully, and acceptance pin A2 genuinely forces it (a no-change re-mint recomputes `validityVersion = head.validityVersion + 1` at `:13146`, so the payload digest differs from the prior event's — the auth-key replay at `:13161-13162` alone would throw `context_pack_conflict` on a reused key or append a new event on a fresh key; neither satisfies A2). **Caveat:** the contract orders D4 "after the auth-key replay check". If the orchestrator mints with a stable auth key, the second no-change settlement hits the payload-digest mismatch *first* and refuses `context_pack_conflict` before the D4 short-circuit can fire. Fix: run the D4 content short-circuit **before** the auth-key check (it needs only the prepared payload + the live head), or pin the mint's auth key to be per-settlement-unique.

### D5 — Honesty laws — **HOLE (partial)**

- (a) UNTRUSTED framing: SOUND — matches the landed `UNTRUSTED_CONTEXT_PACK` frame at `coordinator.mjs:3791`.
- (b) Never gates: SOUND — the `settlement.errors` block (`wave-driver.mjs:803`, `slice(0,8)`) and the non-aborting close (`:762-768`) are real.
- (c) Staleness in epochs: **HOLE** — see Blocker B3. The lag is measured against the **ledger head**, which moves only on events. An idle deployment's Δ is frozen, so the pack looks as "fresh" as the day it minted while the underlying campaign (issue-tracker rings, laws, operator decisions — none of which are ledger events) moves on. The contract is formally honest (never asserts currency) but the number is systematically misreadable as content-freshness.

### D6 — Where it serves — **HOLE (partial)**

- (a) MCP initialize: SOUND against existing pins — no suite byte-pins the `instructions` string (mcp-packaging and phase16 assert `protocolVersion` only; `this.coordination` is constructor-set at `mcp-northbound.mjs:1171`). Minor nit: the line tells clients to "resolve via `context.briefing`" but `context.briefing` is an embedded orchestrator-only command absent from the MCP tool table (D7), so the surface that carries the instruction cannot perform the resolution. Fix the wording to name the orchestrator-facing surface.
- (b) Doctor sibling: SOUND — the non-enumerable `Object.defineProperty` pattern survives the closed-shape pins (`readiness-credentials-red.test.mjs:911-931` pins `Object.keys` of the roster doc and each route row; non-enumerable props are invisible to `Object.keys`/`JSON.stringify`).
- (c) CLI doctor: **HOLE** — the cited surface is the command **parser** (`application-cli.mjs:1258-1264` returns `{kind:'doctor', depth, check}`); the CLI's doctor output is **raw JSON** (`baton.mjs:78-93`, `JSON.stringify(result, null, 2)`). There is no per-depth "one line" text renderer. Implementing "renders the sibling as one line at every depth" requires the CLI to read the non-enumerable sibling and inject a `briefing` field into its JSON at every depth — which is exactly a consumer that *reads* the sibling, so its output is **not** byte-stable. D6(b)'s byte-stability claim and D6(c)'s rendering requirement are in tension and the renderer is mis-specified. See Blocker B5.

### D7 — The resolve lane and the #96 boundary — **SOUND**

The `context.briefing` embedded orchestrator command matches the settlement-command pattern (the four `knowledge.settlement_lease`-class commands are embedded, `application.mjs:12384-12388`). The read-port exclusion is real: `contextRead` (`coordinator.mjs:10564-10721`) is a **closed switch** over `{code, knowledge, finding, board, scratchpad, spill}` — no `pack` kind, and the spill kind's regex `^spill:sha256:[a-f0-9]{64}$` (`:10710-10711`) excludes `context-pack:` IDs. The per-run horizon (`_runHorizonNodeIds` `:11060-11079`) closes over `runId`/taskId-in-run/evidence-cited events only, exactly as G8 states. The only pack→worker path is an orchestrator-authored spawn brief explicitly citing the live head through the existing CAS (`_admitContextPackCitations` `:3749`) — the acknowledged OQ5 path, not a slip.

### D8 — Composition source — **HOLE**

"The composition reads only store projections" is not true of D1's schema. The wave receipt is a **file**; waves, rings, lanes, parked, blocked-on are **not** ledger projections; `standingLaws` is **config** (OQ2's own admission). The store's `snapshot()` (`coordination-store.mjs:11550`) exposes tasks, runs, boards, knowledge, scratchpads, context, artifacts, reuse, evidence — but no waves, no rings, no lanes, no parked, no blocked-on, no receipt digests. D8's own enumeration ("wave receipts' knowledge blocks") names a non-ledger source while claiming ledger-only. See Blocker B1.

---

## 2. Attack reports

### Attack 2 — Ledger-only composition law — **HOLE (Blocker B1)**

The promised campaign state (open rings, lane states, blockers) is **not** in the durable ledger; composing it does silently require the orchestrator's memory, the working tree, or new ledger facts the contract does not define:

- **Waves:** no wave event kind in the store (all 147 kinds enumerated; none are `wave.*`). `wave.mjs:7`: *"It holds no durable state of its own."* `wave.evidence()` returns in-memory traces. The receipt goes to `policy.evidencePath` (a file).
- **Rings:** zero occurrences of a ring concept in the store (only substring hits like "steering"). No ring→wave membership anywhere.
- **Lanes:** no lane-state projection; `#106`'s lanes are a policy vocabulary, not a runtime ledger state.
- **Parked / blocked-on:** no ledger fact; the `wave-settlement:<waveId>` board is a *candidacy* queue (claim/report state), not a "blocked on X since eventSeq" tracker.
- **Landings:** `closedAtEventSeq` has no source (no wave-close event; receipt has no seq); `receiptDigest` requires the file.

Consequence: a faithful implementer cannot populate D1 from the ledger and must either read receipt files (violating D8), use orchestrator memory (violating D8 and replay-exactness), or invent the missing facts at composition time (unhonest).

### Attack 3 — Mint timing / first pack — **HOLE (Blocker B2)**

What mints the first pack? **Nothing** on a fresh deployment until the first wave closes — and on an upgraded mature deployment, nothing until the *next* wave closes. The first-session "no pack" is literally honest but vacuously so: it is indistinguishable from "campaign has no state," and it fails exactly the session (post-upgrade) that has the most to re-derive. Additionally the kg-ritual mint is pre-close, so the closing wave is never in its own mint's `landings`.

### Attack 4 — Staleness law — **HOLE (Blocker B3)**

Yes — a pack can look fresh while the ledger is stale. Δ = ledger-head − composedAtEventSeq; both are frozen on an idle deployment, so the pack's served lag never worsens. Because the pack content is only partially ledger-derived (Attack 2), ledger-head movement is a proxy for *ledger activity*, not *campaign-content staleness*. A5's synthetic check ("append K unrelated events → Δ=K") encodes "Δ=K means K stale", but K unrelated events change no campaign state while campaign state can change with zero events (issue-tracker rings, laws). The contract never *asserts* currency, so this is a framing/receivability hole rather than a false claim — but the Δ number will be read as content-freshness.

### Attack 5 — Serving surfaces vs. existing pins — **MIXED**

- MCP initialize: no existing pin breaks (verified against `mcp-packaging-red.test.mjs` and `phase16-mcp-northbound.test.mjs` — `protocolVersion` only; the store is always supplied in `setup()`).
- Doctor sibling: survives the closed-shape pins (`readiness-credentials-red.test.mjs:911-931`).
- CLI doctor: **no per-depth text renderer exists** — D6c's surface is mis-cited (see D6(c) / Blocker B5).
- `ledgerHeadSeq()`: additive, read-only, replay-free — no pin impact.

### Attack 6 — Worker-exclusion law — **SOUND**

A worker cannot slip the pack through the read port: `contextRead` is a closed kind switch with no `pack` kind; the spill kind's regex excludes `context-pack:` IDs; knowledge/finding kinds serve ledger knowledge nodes (packs are not knowledge nodes); the board kind serves board items; the per-run horizon is run-closed. The only exposure is the explicit orchestrator-authored spawn-brief citation through the CAS (`:3749`) — the acknowledged OQ5 path. The implementation must simply not add a `pack` kind to `contextRead` and must keep `context.briefing` off the read port (D7 already says this).

### Attack 7 — Acceptance pins A1-A8 — **see per-pin table**

| Pin | Verdict | Notes |
|---|---|---|
| A1 | **HOLE** | Never verifies the body **content** reflects the actual campaign state — a hollow body (`rings:[], lanes:[], landings:[], …`) parses to the closed schema and passes. A pack minted but never wired to any serve also passes A1 alone. |
| A2 | SOUND | Forces D4 (auth-key replay alone cannot fake it — see D4). |
| A3 | partial | `packId` recompute and overflow refusal are pinned; the deterministic **degradation order** (drop oldest landings → parked detail → rings summaries) is not — a wrong-order degradation that still fits passes. |
| A4 | SOUND | Re-mint changes the digest (catches a static/cached MCP line); no-pack line + initialize succeeds are explicit. |
| A5 | partial | `epochLag === K` catches a serve that returns a cached `ledgerHeadSeq` (the "serve returns a cached pack ignoring the ledger head" risk is covered); but the "cannot compute the lag → `staleness unknown`" branch is **vacuous** — `composedAtEventSeq` and `ledgerHeadSeq()` are always computable, so no test exercises it and a shallow implementation can omit it. |
| A6 | SOUND | Direct store call with `actor:'worker:*'`; family-scoped; existing-family authority unchanged. |
| A7 | partial | "Never gates" is a regression guard; forcing a composition failure mid-ritual is hard, so the `settlement.errors` (≤8) clause may never be exercised. |
| A8 | SOUND | Non-enumerable sibling + byte-stable serialization survive the closed-shape pins; the CLI clause depends on resolving B5. |

### Attack 8 — Open questions verdicts

- **OQ1 — Rings without ledger presence — FOLD-BLOCKING.** The leaning "accept for v1, file the bridge" is not implementable under D8: rings have **no ledger source at all** (not merely "rings with issues but no wave yet"). Even rings-with-waves have no ring→wave membership in the ledger. Either the bridge (an orchestrator-maintained ledger fact per ring) is specified *in this contract*, or the `rings` field is dropped / made honest-empty with an explicit "no ledger presence" marker.
- **OQ2 — Standing-law list maintenance — DEFERRED** (acceptable), but D8's "never the working tree" must name the pinned-config exception explicitly.
- **OQ3 — Serve receipts — DEFERRED** (additive; the `context.read` lane exists, `recordContextRead` `coordination-store.mjs:13252`).
- **OQ4 — Cross-deployment scope (#70) — DEFERRED** (v1 says it is per-deployment; honest).
- **OQ5 — Worker visibility after #96 — DEFERRED** (orchestrator-only holds; the explicit-citation path is acknowledged, not a read-port slip).

---

## 3. Final verdict: **NOT FOLD-READY**

Numbered blockers (each: what + why + concrete fix).

**B1 — D1's schema is not composable from the ledger; D8's ledger-only law is unsatisfiable.**
*What:* `landings.closedAtEventSeq` and `landings.receiptDigest` have no ledger source; waves are ephemeral (`wave.mjs:7`), the wave receipt is a file (`wave-driver.mjs:808`); `rings`/`lanes`/`parked`/`blockedOn` have no ledger projection; the store has no wave/ring/lane/parked/blocked-on event kinds.
*Why:* A faithful implementer cannot populate D1 without orchestrator memory, the working tree, or fabricated facts — violating D8 and the store's replay-exactness law.
*Fix:* pick one: (a) **shrink D1** to the ledger-derivable set (tasks, runs, boards, knowledge, spills, context packs, evidence) and mark the rest honest-empty with an explicit "no ledger presence" marker; or (b) **add the missing ledger facts in this contract** — a `wave.closed` event carrying `{waveId, receiptDigest, knowledge:{candidates, admitted, candidatesAwaitingAdmission}, settlementErrors}` plus ring→wave membership and lane-state events — so composition is replay-derivable; or (c) **amend D8** to explicitly authorize the wave-receipt file and the pinned config as named composition inputs (making the "never the working tree" claim honest about its exceptions).

**B2 — The first pack and the mint's pre-close timing.**
*What:* No backfill/seed mint; a fresh *or upgraded* deployment shows `No orchestrator briefing pack minted yet.` until the next wave closes, even when the ledger is full of state. For `kg-ritual` waves the mint is a pre-close ritual step, so the closing wave never appears in its own mint's `landings`, and `closedAtEventSeq` is permanently null for a single-wave-then-idle campaign.
*Why:* The pack's stated purpose — campaign state at session start — is unmet exactly at migration/first-session; and the minted pack is structurally one wave behind.
*Fix:* (a) define a one-time backfill mint on upgrade/session-start composed from the historical ledger (replay-derivable); (b) move the mint **after** `wave.close()` (post-close, in the guaranteed window) so the closing wave's landing is composable; (c) define what `closedAtEventSeq` means (e.g., the closing wave's last member `run.sealed` seq, or the settlement task's terminal seq) and pin it in D1.

**B3 — The staleness law measures ledger activity, not campaign-content staleness.**
*What:* Δ = ledger-head − composedAtEventSeq is frozen on an idle deployment, so the pack looks permanently "fresh" (small Δ) while the campaign moves on outside the ledger; A5's "K unrelated events → Δ=K" encodes ledger-activity, not content staleness.
*Why:* The pack's whole purpose is to be *believed at a glance* (D5 rationale); a frozen small Δ is exactly the misleading-freshness case the law claims to prevent.
*Fix:* render the pack's `observedAt` (already on the pack record, `coordination-store.mjs:8727`) alongside the lag and/or add a prose caveat ("Δ counts ledger events, not wall time or campaign state"); and add an A5 clause asserting the idle-deployment case (mint, drive no events, serve → Δ unchanged, not rising).

**B4 — Acceptance pins A1/A3/A5 are shallow-greenable.**
*What:* A1 passes with a hollow body that parses to the closed schema (content never checked against actual campaign state); A3 does not pin the degradation order; A5's "cannot compute the lag → `staleness unknown`" branch is vacuous (both inputs always exist).
*Why:* A shallow implementation can green A1 with a mint that never composes real state, A3 with wrong-order degradation, and A5 without implementing the unknown-lag path at all.
*Fix:* A1 must assert the body's `rings`/`lanes`/`landings` reflect the store's actual tasks/runs/boards (e.g., `sources.snapshotDigest` equals the live `snapshot()` digest at mint); A3 must pin the exact drop order; A5 must force the cannot-compute branch (or delete it and the dead-code hazard).

**B5 — D6(c)'s CLI rendering surface is mis-cited and conflicts with D6(b).**
*What:* `application-cli.mjs:1258-1264` is the doctor command **parser**; the CLI doctor output is **raw JSON** (`baton.mjs:78-93`, `runBatonCli` `application-cli.mjs:2144` → `client.doctor()`), with no per-depth one-line text renderer. Making the CLI show the briefing means reading the non-enumerable sibling and injecting a `briefing` field into the JSON at every depth — a consumer that *reads* the sibling, so its output is not byte-stable.
*Why:* As written, an implementer cannot tell where the "one line" rendering goes, and the byte-stability guarantee in D6(b) is silently violated for the CLI.
*Fix:* specify the CLI change as "add an enumerable `briefing` field to the doctor JSON output at every depth, sourced from the non-enumerable sibling via property access," anchored to the real output path (`baton.mjs:78-93` / `runBatonCli`), and restate D6(b)'s byte-stability as holding for consumers that do **not** read the sibling.

---

Non-blocking findings (fold can proceed once B1-B5 are resolved):

- **N1 — Header verification-HEAD drift.** The contract pins `403f539`; the deployment tree is `c3e6fbe`, and `application-deployment.mjs` is +2 lines there, so those four anchors resolve 2 lines early. Re-run against the deployment HEAD.
- **N2 — D4 ordering vs. the auth-key replay.** D4 must short-circuit *before* the auth-key check (or the mint key must be per-settlement-unique) or a reused key turns A2 into `context_pack_conflict`.
- **N3 — D6(a) instruction text.** "resolve via `context.briefing`" sits on the MCP surface that cannot resolve the embedded orchestrator-only command; name the orchestrator-facing surface instead.
- **N4 — OQ2 config exception.** D8's "never the working tree" must explicitly exempt the pinned standing-law config.
- **N5 — A7's failure-forcing gap.** Add a way for the suite to force a composition failure (e.g., an injected overflow body) so the `settlement.errors` (≤8) + non-aborting-close clause is actually exercised.

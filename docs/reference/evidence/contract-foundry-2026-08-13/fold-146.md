# Fold report — row-fold146

[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc row-fold146]

**Contract folded:** `contract-146.md` → **v1.1** (in place, same dir) — the #146 fleet seat
telemetry surface.
**Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f`.
**Inputs:** `redteam-146.md` (binding — NOT FOLD-READY; B1–B3 + A3–A6 + N1/N2),
`review-foundry-2026-08-13-b/review-qa.md` §5 (written without the row; §5.4 fold set folded),
`row-rt146.md`, `foundry-qa.md` §#146 (overturned "sound" verdict), v1 contract-146.md, and every
source anchor re-verified at HEAD this session.
**Fold summary:** ALL findings folded. B1–B3 blockers resolved (allocator binding, single
occupancy source, split freshness labels); A3–A6 amendments folded (object-roster capacity,
`deferred` re-teach, raw-path resolver named, single-pass derivation + cost ceiling); N1/N2
citation hygiene applied; QA §5.4 shipped as written modulo the blockers (H1→A6, D1/D2/D3 + observe
posture kept, OQ3 kept as the named follow-on). No finding left standing, dropped, or silently
re-scoped.

---

## 0. Incremental fold ledger — every row finding and every QA §5 instruction, dispositioned

The complete disposition record, one line per item, in source order. Tag = **FOLDED** (incorporated
into v1.1) / **STRUCK** (explicitly rejected, reason given) / **ESCALATED** (kept open as a named
follow-on). The row report governs on conflict; the QA was blind (all five rows were dead when the
QA wrote §5 — its §0 names the gap, and the blind-QA law makes the row's NOT FOLD-READY the
binding verdict).

### Row findings (`redteam-146.md`)

| # | Finding | Tag | Where folded |
|---|---|---|---|
| R-1 | §1 citation audit — no wrong citation | FOLDED | every anchor re-verified at HEAD this session (contract cross-reference note) |
| R-2 | §1 **N1** — `(D5.2)` dangling cross-ref | FOLDED | refusal vocabulary cites `wave-observability-contract.md` §D5.2 explicitly |
| R-3 | §1 **N2** — "no *seat* capacity" | FOLDED | A7 reworded |
| R-4 | §2.1 **B1** — parallel vendor binding (blocker) | FOLDED | D1.1 `#seatsVendor` allocator binding; new pin A9 |
| R-4a | §2.1 B1 provider-aliasing case | FOLDED | D1.1 explicit-provider branch — `_resolveExplicitRoute` on `${harness}:${provider}` |
| R-4b | §2.1 B1 load-aware `auto` case | FOLDED | D1.1 auto path: exactly 1 eligible → vendor; 0 or >1 → honest-null |
| R-5 | §2.2 **B2** — two disagreeing occupancies (blocker) | FOLDED | D1.2 single occupancy source; `#occupancyFor` corrected; pins A10, A4/A8 updated |
| R-5a | §2.2 B2 `publicRosterRow` enumerable + `fleet_roster` ripple | FOLDED | G5; D2.1; OQ3 caveat (B2 lands before/with the wiring) |
| R-5b | §2.2 B2 the v1 pin-A4 RED claim "`_inFlightCount` returns 0" is not guaranteed | FOLDED | pin A4 RED text corrected THIS session to the real `_inFlightCount(route.harness)` behavior (a NUMBER; `0` only via the no-coordinator branch) |
| R-6 | §2.3 **B3** — single freshness label inert for the live component (blocker) | FOLDED | D1.4/D3 split labels; per-atom `inFlightRevision`; new pin A11 |
| R-7 | §2.4 **A4** — `deferred` overstates "currently ceiling-waiting" | FOLDED | choice (a) re-teach; D1.2/D2.3; forbidden phrase; A2 |
| R-8 | §2.5 honesty table + `null` semantics — SOUND | FOLDED | kept as written (framed by B1/B2) |
| R-9 | §3.1 **A3** — object-roster capacity empty | FOLDED | D2.2 recovers routes via `_runWaveRoute`; A3 pin |
| R-10 | §3.2 **A5** — raw path has no resolver (note) | FOLDED | choice (a) named resolver via `this.driver.coordinator`; bare-host all-null |
| R-11 | §3.3 no-new-tool / additive landing / teaching — SOUND | FOLDED | kept as written (modulo B3/A4, both folded) |
| R-12 | §4 **A6** — `deferred` cost unbounded | FOLDED | single-pass O(E+D+R) derivation; D1.2/D2.3; A2 |
| R-13 | §4 point-in-time labeling — SOUND in spirit | FOLDED | kept; the defect (label reach) is B3 |
| R-14 | §5 refusal vocabulary — SOUND | FOLDED | kept; N1 folded |
| R-15 | §6 all eight pins RED verified | FOLDED | A1–A8 RED conditions kept |
| R-16 | §6 shallow-greenability → one pin per blocker | FOLDED | new pins A9/A10/A11 |
| R-17 | §7 OQ1 names the wrong drift — widen | FOLDED | OQ1 widened: the LIVE drift is answered by B1; the DEFERRED drift remains named |
| R-18 | §7 OQ2 incomplete (A3) | FOLDED | OQ2 notes the object-roster path is now specified (D2.2) |
| R-19 | §7 OQ3 caveat — B2 must land before/with `fleet_roster` wiring | FOLDED | OQ3 caveat written (B2 landed in this rung, D2.1) |
| R-20 | §8 NOT FOLD-READY | RESOLVED | every blocker/amendment/nit lands in this fold |

### QA §5 instructions (`review-foundry-2026-08-13-b/review-qa.md` §5)

| # | Instruction | Tag | Where folded |
|---|---|---|---|
| Q-1 | §5.0 the QA is a blind meta-cross-check (all five rows dead) | STRUCK as a verdict source | the QA never saw the row report — per the blind-QA law it cannot out-verdict the row. Retained ONLY as the §5.4 instruction source. |
| Q-2 | §5.1 verdict "SOUND, with one amendment" | STRUCK | row governs on conflict — NOT FOLD-READY (B1–B3) |
| Q-3 | §5.2 spot-check — no wrong anchor | FOLDED | re-verified; v1.1 keeps every anchor exact |
| Q-4 | §5.3 **H1** — `deferred` is an O(full-ledger) scan per read, unbound | FOLDED via A6 | single-pass derivation + stated cost ceiling |
| Q-5 | §5.4.1 carry the cost/ceiling into the D2.3 teaching text | FOLDED | D2.3 sentence names O(E+D+R), the ≤16-row `waves.list` page bound, and the route-count-bound doctor read |
| Q-6 | §5.4.2 ship D1 record shape / D2 three read surfaces / D3 / observe posture as written | FOLDED | shipped as the SUBSTRATE; the row's blockers are the corrections, not re-scopes — nothing the QA asked to ship is dropped |
| Q-7 | §5.4.3 keep OQ3 as the named separate-rung follow-on | FOLDED | OQ3 kept, with the row's B2-before/with caveat |
| Q-8 | §6 #146 not escalated; OQ1/OQ2/OQ3 are recorded judgment calls | FOLDED | all three recorded in the contract's open questions |
| Q-9 | §7 bottom line "SOUND modulo one amendment" | STRUCK | superseded by the row's NOT FOLD-READY (blind-QA law) |

### Escalated (kept open, named — not silently dropped)

- **OQ1** — the deferred-binding re-resolution drift (a deferred task's receipt names the vendor at
  mint time; a future rung may key `deferred` to the task's current resolution). The LIVE-drift half
  is answered by B1.
- **OQ2** — per-wave `capacity` repeat judgment (per-wave blocks vs a top-level dedup index).
- **OQ3** — `fleet_roster` fourth-surface wiring (a #159 admission rung). B2's occupancy-honesty
  correction already landed in this rung (D2.1), so the wiring never serializes the fabricate-0.

### Struck (with reason)

- **Q-2 (QA §5.1) and Q-9 (QA §7)** — the two "SOUND" verdicts, both written without the row
  report. The row's NOT FOLD-READY governs (blind-QA law). Their non-conflicting amendment (H1, the
  `deferred` cost) is nonetheless folded via A6 — a struck VERDICT is not a struck instruction where
  they do not conflict.

**No silent drops.** Every §, every numbered item, and every sub-claim in both governing documents
is dispositioned above or is a verified-positive ("SOUND") kept as written. The fold map in
`contract-146.md` and the disposition record here are the two ends of the same ledger: the fold map
shows WHERE each fold landed; this §0 shows that each item WAS dispositioned.

---

## 1. The red-team verdict, and what the fold does about it

The row report found the v1 contract **NOT FOLD-READY** with three numbered blockers (B1–B3),
four amendments (A3–A6), and two citation nits (N1/N2). Per the **blind-QA law**, the row report
governs on conflict: both the wave-a QA's "sound — the remaining risk is a derivation cost"
(`foundry-qa.md` §#146) and the wave-b QA's "SOUND with one amendment" (`review-qa.md` §5) were
written WITHOUT the row report and are superseded where they conflict. The wave-b QA's §5.4 fold
instruction set is nonetheless folded in (it does not conflict with the row's blockers; it
complements them). The fold is **one-option** everywhere the row offered a choice — each choice and
its rationale is recorded in the fold notes (contract-146.md "Fold notes").

## 2. Blocker resolutions (B1–B3)

| # | Blocker | Resolution folded |
|---|---|---|
| B1 | `adapterFor(route).vendor` is a parallel resolution, not the allocator's own; a seats row can report a different vendor's capacity | The atom's per-route vendor is bound through the allocator's OWN semantics (`#seatsVendor`): the wave path binds `member.vendor` via `_resolveExplicitRoute` (`coordinator.mjs:2994-3034`; minted at `:4051`); the doctor/generic path runs the allocator's `_resolveVendor` branches route-scoped — explicit when `route.provider` is set, and for `auto` a vendor is named only when the eligible adaptive set has exactly one member, else honest-null (ambiguous by design). `adapterFor` is dropped as the binding. New pin **A9**. |
| B2 | Two disagreeing occupancy values in one doctor response (`#occupancyFor` fabricates a number for an unmatched route; the new seats atom reads null) | `#occupancyFor` is corrected to the single occupancy source: allocator-bound (B1), unmatched → `{inFlight: null, concurrencyCeiling: null}` (the fabricate-0 at `application-deployment.mjs:1393-1394` is removed). The doctor's non-enumerable `occupancy`, the seats atom, and `publicRosterRow`'s enumerable `occupancy` all read the same value. New pins **A10**, A4/A8 updated. |
| B3 | `observedAtEventSeq` (replay-consistent ledger seq) labels the live `inFlight` too — D3's "compare two reads and know which is newer" is false for it | Split labels: `observedAtEventSeq` labels the ledger-derived parts (`deferred`, `state`, `ceiling`); a per-atom **`inFlightRevision`** — an incarnation-local per-vendor handle-revision counter (derived from the handle lifecycle, `coordinator.mjs:1166`/`:4620`/`:4651`/transitions; NOT a clock) — labels the live `inFlight` component. D2.3 teaching reworked; the "which is newer" claim is pinned per label. New pin **A11**. |

## 3. Amendment resolutions (A3–A6)

| # | Amendment | Resolution folded |
|---|---|---|
| A3 | D2.2 capacity is empty for object-roster waves (no route field at `application.mjs:11803-11809`) | The object-roster path recovers each member's route via `_runWaveRoute`/the steering-registered record (`application.mjs:11610-11619`) — the same recovery the string-roster branch uses — before deriving the atom; unrecoverable members → `capacity: []` honestly. The pinned member row (wave-observability A3-1) stays byte-unchanged; `capacity` is on the wave row. |
| A4 | `deferred` can overstate "currently ceiling-waiting" | **Choice (a):** re-teach `deferred` STRICTLY as "skipped-at-the-ceiling-and-still-pending"; the phrase "currently ceiling-waiting" is explicitly forbidden in surface teaching. The §D5 Arm-1 derivation is unchanged (pending ∧ receipt) — adding the current-ceiling condition would be a vocabulary escalation, not a silent change. |
| A5 | The raw application's seats path has no named vendor resolution | **Choice (a):** the raw path runs the SAME allocator-bound `#occupancyFor`/`#seatsVendor` via `this.driver.coordinator` (the raw doctor already reaches the coordinator at `application.mjs:12437`). A bare host with no coordinator reads all-null (unobservable), never `0`. |
| A6 | The `deferred` aggregate is an unbounded O(routes × events) scan per read (the QA's H1 named the same gap) | Single-pass derivation: one ledger sweep builds a receipt→(vendor, pending-task) map — O(E+D) once — then O(R) to render; the O(E+D+R) cost ceiling is stated in the D2.3 teaching text. |

## 4. Citation nits (N1/N2) and the QA §5.4 set

- **N1** — the refusal table's dangling `(D5.2)` now cites `wave-observability-contract.md` §D5.2
  explicitly (the `wave_not_found` seam at `:276-282`).
- **N2** — A7 reworded to "neither tool description mentions *seat* capacity" (the doctor
  description's "workspace capacity" is the workspace/disk probe, not seat capacity).
- **QA §5.4** — H1's cost/ceiling statement is folded via A6 into the D2.3 teaching; D1's record
  shape / D2's three read surfaces (doctor primary, `waves.list` additive `capacity`, card
  inheritance, no new MCP tool) / D3's staleness+contention honesty / the observe posture ship as
  written, modulo the blockers; **OQ3** (`fleet_roster` fourth-surface wiring) is kept as the named
  follow-on with the row's caveat that the B2 occupancy-honesty correction lands before/with the
  wiring (it does — D2.1).

## 5. Deliverables and verification

- `contract-146.md` — **v1.1 folded contract in place** (this fold's product), full Ring-2 form:
  fold map, G1–G12 ground truths (each re-verified at HEAD), D1–D3, refusal vocabulary, red-first
  pins A1–A11, open questions OQ1–OQ3, cross-references, campaign-law constraints, fold notes.
- `fold-146.md` — this report (attempt line in the first five lines).
- **Execution contract verification:** the deployment check (executable `true`, argv `[]`, cwd `.`,
  expected exit 0) ran GREEN — see the terminal output of the run that produced this report.
- No source files were modified; all work stayed within `docs/reference/evidence/contract-foundry-2026-08-13/**`.
- **Shared-publish:** the shared post is ABSENT (no surface verb to write a scratchpad note exists
  at this HEAD — issue #158's verb is itself a draft artifact); the durable-file fallback is
  recorded in the contract's shared-publish note.

## 6. Judgment calls (recorded per the brief; full rationale in contract-146.md "Fold notes")

1. **B3 choice (a)** — incarnation-local per-vendor handle-revision counter over dropping the
   overclaim: the counter is cheap, explicitly not a clock, and per-vendor so equal revision means
   "this vendor's live count unchanged".
2. **A4 choice (a)** — re-teach over re-derive: the §D5 Arm-1 derivation is law; only the wording
   changes. Adding the current-ceiling condition would deviate from the vocabulary.
3. **A5 choice (a)** — name the raw-path resolver over all-null-by-design: the raw doctor already
   reaches the coordinator; all-null stays only for the bare-host (no coordinator) case.
4. **B1 wave-path member-set rule** — a route whose members resolve to different vendors reads
   all-null counts (no single seat-truth); per-member capacity rows would re-shape the pinned
   member row.
5. **OQ2 judgment kept** — per-wave `capacity` blocks are the seat-map completion; the
   deployment-level read is the doctor's `seats`; a top-level dedup index would duplicate the
   doctor.

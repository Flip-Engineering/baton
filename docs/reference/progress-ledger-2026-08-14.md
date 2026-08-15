# baton — progress & campaign ledger (2026-08-14)

> The campaign/progress home split out of [`README.md`](../../README.md) per the operator's
> directive: the README is the **product doc** (what baton *is* — the orchestration substrate,
> the capability ledger); **this ledger is where the campaign lives** (reports, methodology,
> current state, the live fleet). Nothing was deleted: every campaign line that previously sat
> in the README moved here, and §1 records the map. The per-phase narrative ledger remains
> [`docs/PROGRESS.md`](../PROGRESS.md) (oldest-first history); this file is the current-state
> and campaign-tracking companion to it, kept in sync with the evidence packs under
> `docs/reference/evidence/<epic>-<date>/` and the reports under `reviews/`.

## 1. What moved here (nothing deleted)

| README content (pre-split) | New home |
|---|---|
| "Project updates" blockquote (the dated report links) | [§2 Campaign reports](#2-campaign-reports) |
| "Reading the status tiers" — the red-first methodology note | [§3 How to read the status tiers](#3-how-to-read-the-status-tiers--the-red-first-methodology) |
| Current checkpoint / campaign-state numbers | [§4 Current checkpoint (2026-08-14)](#4-current-checkpoint-2026-08-14) |
| The live wave fleet / in-flight roster | [§5 The live fleet & wave roster](#5-the-live-fleet--wave-roster) |
| "Documentation map" campaign-era entries | [§6 Cross-references](#6-cross-references) |
| In-flight pipeline-stage vocabulary ("contract → red-team → fold → …") | [§3](#3-how-to-read-the-status-tiers--the-red-first-methodology) + [§5](#5-the-live-fleet--wave-roster) |
| Capability tiers *roster* (LANDED / IN-FLIGHT / PLANNED) | retained in [`README.md`](../../README.md) §Capability ledger (claims now cite suites/docs/issues) |

## 2. Campaign reports

The dated, evidence-cited campaign reports live in [`reviews/`](../../reviews/). Latest first:

- **[baton-update-2026-08-14](../../reviews/baton-update-2026-08-14.html)** — *the no-clock law,
  the detached bus, the uncapped fleet* — the 48h window (190 commits, issues filed-to-date
  #86–#221, the first 15-pack concurrent flood), with focus on the last 12h/6h.
- **[baton-campaign-state-2026-08-14](../../reviews/baton-campaign-state-2026-08-14.html)** —
  the full map (v2, exhaustive): every open issue assigned to a campaign lane (C1 comms ·
  C2 durability · C3 phase grammar · C4 oversight · K knowledge · P planning · D diagnostics ·
  G craft · E eval), with the fleet composition law.
- **[baton-foundry-day-2026-08-13](../../reviews/baton-foundry-day-2026-08-13.html)** — the
  foundry era: contract/suite/blue-team/fold foundries run as baton waves themselves.
- **[baton-24h-report.html](../../reviews/baton-24h-report.html)** — the earlier 24h report.

External/adversarial reviews (the round-1/round-2 evidence of the *design*, still the citation
backbone for the trust story): [`reviews/README.md`](../../reviews/README.md) indexes
[codex-external-review.md](../../reviews/codex-external-review.md),
[steering-interruption-redteam.md](../../reviews/steering-interruption-redteam.md), and the
[red-blue-explore/](../../reviews/red-blue-explore/) round-2 pass.

## 3. How to read the status tiers — the red-first methodology

Every capability in the README's capability ledger is labeled one of three tiers:

- **LANDED (gate-verified)** — shipped to `master`; the canonical suite
  (`node impl/scripts/run-suite.mjs`) is green on the capability's own rows.
- **IN-FLIGHT (waves running)** — mid-pipeline with the current stage named (contract →
  adversarial red-team → fold → red-first suite → blue-team → fold → implementation).
- **PLANNED (issues filed)** — tracked on the [issue tracker](https://github.com/wahargis/baton/issues),
  not started.

**Why the canonical gate exits nonzero while in-flight work exists.** In-flight work lands as
*red-first* suites — tests that fail at a named stage until the capability ships. The red set
is therefore **exactly the declared in-flight roster**: `node impl/scripts/run-suite.mjs`
exits nonzero **by construction** while pinned future behavior exists. That is the methodology
working, not a regression — every LANDED row is green, and the 377-row failure set at the
2026-08-13 checkpoint is fully accounted for (20 red-by-design campaign pins + 12 documented
#7 load-flake members, each green twice in isolation; no unexpected failures).

**The pipeline (the 12-stage law).** Every campaign lane moves through the same chain as
DSL-authored multi-member waves: ground → spec → red-team spec → blue-team spec → test
contract → red-team testing → blue-team testing → scope-creep audit → remediate → implement →
validate → return-to-orchestrator. The working papers live under
[`docs/reference/evidence/<epic>-<date>/`](evidence/) — contracts, red-team/blue-team rows,
folded suites, verify-notes, and row notes per wave.

## 4. Current checkpoint (2026-08-14)

The three composite shifts from the [48h update](../../reviews/baton-update-2026-08-14.html),
each removed by the same method — measured against live fleet behavior, ruled on by the
operator, ripped out at the mechanism, restaged in the suites, re-proven by real waves:

1. **The no-clock law (#163).** *"Timeout/clock-based control flows are not appropriate for
   baton."* The trigger: the honesty-e wave (five members, 4.5h of live work) settled
   all-failed at the interpreter's `hardCapMs` at the exact second its invisible clock expired.
   The mechanism died the same day: `hardCap` ripped out everywhere (`8ec52a6c`), the wall-time
   fate clock retired across every adapter (`b271406f`), and waves now settle **on evidence** —
   quiescence-derived completion: terminality, an unrecoverable member, a handled-decision
   stuck roster, or roster-wide silence past a window derived from the roster's *own observed
   cadence* (`max(2×observed gap, 8 polls)`). Long-running dynamic workflows are physically
   possible; before this, every wave carried a hidden self-destruct.
2. **The detached bus (#173).** `waves.run` now returns a synchronous acceptance receipt and
   drives as a continuation; the bus survives launches (previously two live drives wedged every
   other launch — measured zero admissions in 43 attempts). The loop-starvation P0 (#210:
   `events()` deep-cloned the 87k-event ledger per call) became `eventsView()` + 25 read-path
   switches (`49b42d3`): resident CPU 97% → 32%, `/readyz` 15s+ → 143ms.
3. **The uncapped fleet (#221).** The invented seat-ceiling pre-cap ("1× concurrency" on the
   cheapest models) and the GLM 1× ceiling are scaffolding fossils, both ripped out (`a3e96e8`,
   `bf93263c`). The only queue left is provider-true typed backpressure (429/rate_limited,
   retried, ledgered). Massive cheap-model parallelism is unthrottled by our own machinery.

**The DSL (#170).** A wave is a `.wavefile` — named members, exact routes, scopes, objectiveRef
briefs, steering policies, harvest contracts — compiled closed, driven by the interpreter. The
bespoke-driver era ended: this report's own 15-pack flood is 15 DSL documents, not 15 scripts.
16 directives landed; `waves.compile` + steering cross-validation ship with it.

**The foundry engine.** Contract/suite/blue-team/fold foundries run as multi-agent waves (the
honesty package ② #157–#160, lifecycle ③, durability ④, collab ⑤, and the #163/#165/#167/#146
fold-b set): 9 contracts folded, 14 red-first suites authored, every suite blue-teamed and
folded. The full methodology loop now runs as baton waves themselves.

**Measured numbers (store-cited or gate-verified in the reports):** 190 commits / 48h ·
issues filed-to-date #86–#221 · canonical gate 4054 tests / 3677 green (fully-accounted
failure set, see [§3](#3-how-to-read-the-status-tiers--the-red-first-methodology)) · 16 DSL
directives · 14 red-first suites armed · 6+8 waves live / on launchers · resident CPU
97→32% (#210) · 14/14 members checkpointed across 2 resident kills · 3,057 messages sent /
160 delivered, zero decision kinds (the #211 audit anchor).

## 5. The live fleet & wave roster

The fleet composition law: **glm-5.3 suborchestrates DSv4-Flash + GLM-5.2 rows** (cheap-wide by
default; v4-pro for the heaviest impls); kimi orchestrates. Spawn-rate constraint named + filed
(#218): adapter seat ceilings queue members silently — 24 reservations, 5 materialized, 19
invisible-pending; rows re-seated across glm-5.3/5.2 to draw idle seats while the permanent
fix rides the C2/C4 lanes.

**v19 pack (fired at the [update's](../../reviews/baton-update-2026-08-14.html) publish):**

| pack | payload | state |
|---|---|---|
| `honesty-f` | C5 honesty package impl (#157–#160 surfaces land) | fired |
| `lc-rd4 · collab-rd3 · lch-rd2` | lifecycle + collab contract rows (wake/death/retry, member lanes, knowledge activation, context lanes) | fired |
| `telemetry-c` | C4 oversight impl (#146 seat telemetry + readiness honesty) | fired |
| `eval-b` | #107 — the first honest eval number | fired |
| `gate-digest-b · accessor-b · readme-b` | #149 gate digest · #99/#179 result accessor · **this README split** | fired |
| `kg-activation-b` | K plane — the knowledge graph's READ path (#24–#27/#186) | fired |
| `audit-147 · contract-seeds` | #147 conformance re-run · #150/151/152 contract seeds | fired |
| `pg-rd4` | C3 phase grammar impl — the campaign-as-DSL north star (#9/#170) | fired |
| `lsp-pool · plan-object` | #144 LSP pool + #161 orchestrator plan-object | **LANDED WAVE-OK on v18** |

**Impl-wave packs in flight** (contract/red-first stage; evidence under
[`docs/reference/evidence/`](evidence/)): `attention-spine-2026-08-14` (#208) ·
`handshake-patience-2026-08-14` (#226) · `mcp-dsl-surface-2026-08-14` (#227) ·
`omp-harness-contract-2026-08-14` (#228) · `member-harvest-2026-08-14` ·
`phantom-root-2026-08-14` (#199/#200/#207) · `death-certs-2026-08-14` (#225) ·
`drain-restart-2026-08-14` (#204) · `no-clock-followons-2026-08-14` ·
`impl-kg-activation-2026-08-14` · `impl-telemetry-2026-08-14` (#146) ·
`impl-gate-digest-2026-08-14` (#149) · `impl-result-accessor-2026-08-14` (#99/#179) ·
`lch-contracts-2026-08-14` · `phase-grammar-2026-08-14` (#9/WF-1) · `audit-147-rerun-2026-08-14`.

The README's IN-FLIGHT tier carries the headline subset with issue citations; this roster is
the full current fleet.

## 6. Cross-references

- **Per-phase history:** [`docs/PROGRESS.md`](../PROGRESS.md) — the oldest-first status
  narrative (retained verbatim rows; the newest section carries the canonical suite count).
- **Lossless capability audit:** [`docs/28-exhaustive-capability-audit.md`](../28-exhaustive-capability-audit.md);
  **retained full-system goal:** [`docs/26-full-system-goal.md`](../26-full-system-goal.md).
- **The issue tracker** — [github.com/wahargis/baton/issues](https://github.com/wahargis/baton/issues):
  the tracked IN-FLIGHT + PLANNED roster (the README names the headline ones; the campaign-state
  report maps every open issue to a lane).
- **The orchestrator friction ledger** —
  [`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`](evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md):
  every AX friction the orchestrator hit while building baton with baton, with dispositions.
- **Product doc:** [`README.md`](../../README.md) — what baton is, architecture, quickstart,
  and the three-tier capability ledger (this file is its campaign companion).

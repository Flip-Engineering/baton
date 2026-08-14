# Progress ledger — 2026-08-14

The campaign/status companion to the [product README](../../README.md). This file is the new
home of the progress-tracking content that used to live in the README — split out 2026-08-14
by the `readme-split-2026-08-14` wave so the README can be a product document and the campaign
can be tracked where tracking belongs. **Nothing was deleted in the split**: every status claim
from the pre-split README either stayed in the README's capability ledger (with citations) or
moved here (the move map is in
[`evidence/readme-split-2026-08-14/notes-row-readme.md`](evidence/readme-split-2026-08-14/notes-row-readme.md)).

This ledger does not supersede the older ledgers — it sits beside them:

- [docs/PROGRESS.md](../PROGRESS.md) — the per-phase narrative, oldest first (through the
  2026-08-13 checkpoint: canonical suite 4,054 tests / 3,677 green, the failure set fully
  accounted as red-by-design + the documented #7 load-flake cluster).
- [`impl/VALIDATION.md`](../../../impl/VALIDATION.md) — the formal historical ledger (through
  Phase 65, resumed at 93a.2).
- `docs/reference/evidence/<epic>-<date>/` — the spec-driven pipeline's working papers
  (contracts, red-teams, folds, suites, blue-teams, wave packs).
- [The issue tracker](https://github.com/wahargis/baton/issues) — the live open roster
  (~112 tracked issues; the lossless catalog is [docs/28](../28-exhaustive-capability-audit.md)).
- `reviews/baton-campaign-state-2026-08-14.html` — the store-cited 24h campaign-state report.

---

## How to read the status tiers

Every capability in the README's ledger is labeled one of three tiers:

- **LANDED [shipped]** — landed in `master`, pinned green by the canonical suite
  (`node impl/scripts/run-suite.mjs`). Each row cites a suite, a doc, or an issue.
- **IN-FLIGHT [in flight]** — mid-pipeline: contract → adversarial red-team → fold →
  red-first suite → blue-team → fold → implementation, with the current stage named (the
  full staged roster is below).
- **PLANNED [planned]** — filed as a tracked issue, not started (the thematic map is below).

In-flight work lands as *red-first* suites — tests that fail at a named stage until the
capability ships — so `node impl/scripts/run-suite.mjs` exits nonzero **by construction**
while pinned future behavior exists. That is the methodology working, not a regression: every
LANDED row is green, and the red set is exactly the declared in-flight roster (see the
[2026-08-13 checkpoint](../PROGRESS.md) for the accounted failure set).

---

## In flight (mid-pipeline; stage named)

### Carried from the pre-split README (statuses re-checked against `docs/PROGRESS.md` and the git log)

- **#74 — worker-orchestrated swarms** *(contract v1.2 + suite folded; implementation running
  on the heavyweight seat)* — a heavyweight coordinator member over cheap flash rows as ONE
  workflow spec: the truthful steering trail (denied answers record `denied`, never falsified
  `answered`), the scratchpad read-authorization law, escalation bounds. The two-level dogfood
  (**#147**, the control-surface audit) already ran this pattern end-to-end — its issues feed
  #154–#159.
- **#61 — worker verdict surface** *(contract v1.1 + suite landed + blue-team folded; impl
  queued)* — the worker-facing four-field `{gate, check, detail, corrective}` verdict +
  objectives generated from live truth (never boilerplate). Red-by-design suite:
  `impl/test/worker-verdict-surface-red.test.mjs`.
- **#70 — cross-deployment knowledge** *(suite landed + blue-team folded; impl queued)* — one
  primary KG root per project; promotion primary-only on every path. Red-by-design suite:
  `impl/test/cross-deployment-knowledge-red.test.mjs`.
- **#72 — prescriptive doctor** *(suite landed + folded)* — the doctor warns on footguns
  before they bite; carries the **#111-F4** projection-fields amendment. Red-by-design suite:
  `impl/test/prescriptive-doctor-red.test.mjs`.
- **#73 — feedback-forge hardening** *(suite landed + blue-team folded; impl queued)* —
  `run.feedback` gate-shaped submissions are hub-minted or refused, never caller-authored.
  Red-by-design suite: `impl/test/feedback-forge-hardening-red.test.mjs`.
- **#77 — suite resource governance** *(contract v1.2 + suite landed)* — load-calibrated
  gates: the end of the under-load flake cluster (#7) by construction. Red-by-design suite:
  `impl/test/suite-resource-governance-red.test.mjs`.
- **#144 — LSP support** *(contract v1.1 + suite landed; suite-fold running)* — a bounded,
  honest LSP pool for diagnostic scoping and environmental understanding; clock-free
  wedged-server trigger; effective-view absence caching. Red-by-design suite:
  `impl/test/issue144-lsp-pool-red.test.mjs`.
- **The serialized impl lane** *(red-first suites landed; implementations queued)* — #69
  tight cells (`tight-cell-red` · `repl-realization-red`) · #59 harvest accessor
  (`harvest-accessor-red`) · #66 doubt review (`doubt-review-red`) · #71 orchestrator wake
  (`orchestrator-wake-red`) · #80 redrive continuity/TG3 (`redrive-continuity-red`) · #99
  harvest lane · #12 nested orchestration (`nested-orchestration-red`) · #102 (`tight-cell-red`).
- **The control-surface honesty cluster (#155–#160, from the #147 audit)** — red-first suites
  landed and folded (#157 CLI wave fidelity · #158 scratchpad write · #159 doc-truth
  conformance · #160 error actionability); implementation riding the multi-member
  **impl-honesty waves** (the first campaign waves authored in the #170 DSL —
  `impl-honesty.wavefile`, coordinator + 4 impl rows with file-ownership partitions).

> **Reclassified at the split:** **#79 — worker delivery push** was listed in-flight by the
> pre-split README; per the [2026-08-13 PROGRESS checkpoint](../PROGRESS.md) it **SHIPPED**
> (commit `d8282d0`: the BD3-C message lane with minted-sender delivery state, the in-flight
> trust gate (#67), `control.delivery_*` events; suite 32/32, adjacents green, full gate
> accepted). It now sits in the README's LANDED tier.

### The 2026-08-14 campaign wavefront (from the git log, `09200e9` and below)

- **#170 — the workflow DSL** landed (`68163cf`, gate-accepted: `workflow-dsl-red` +
  `workflow-dsl-package-red` suites), and the campaign immediately re-based onto it: contract
  foundry packs, suite folds, and impl waves are now DSL-authored `*.wavefile`s driven through
  the live `waves compile` seam. A fix wave for its four adjacent regressions
  (`workflow-surface` FP-14 count collateral, `phase77` RA2 injection-guard collision,
  `board-workerhalf` 14 rows, `kg-settlement` KS5/KS6) is packed (`0a2d285`).
- **Impl waves dispatched 2026-08-14** (in flight on the serialized lane): gate-digest (#149)
  · result-accessor (#99/#179) · telemetry (#146, `seat-telemetry-red`) · plan-object (#161,
  `orchestrator-plan-object-red`) · kg-activation (#24–#27/#186 — the knowledge plane's READ
  path; the write path shipped, read-only = non-functional) · phase-grammar ·
  lifecycle-contracts · lch-contracts · collab-contracts (the contract-foundry packages for
  filesystem #168/#172/#185, launch/receipt #173/#202/#207, member-creation #199/#200/#204,
  and the ledger-invariant #194/#205 rows).
- **#210 — the loop-starvation P0** fixed (`49b42d3`: clone-free `eventsView()` + 25
  read-path switches); the `waves_list` scaling red-first pin (WLS-1) landed RED at HEAD
  (`d46d798`) with its remediation wavefile — remediation wave rd1 dispatched (`2387699`).
- **Seat policy (operator rulings):** the GLM ceiling raised 1→4 and the `glm-5.3` route
  added (`bf93263` — wide cheap seats; glm-5.2 stays the construction default); the invented
  seat-ceiling pre-cap RIPPED OUT per operator ruling (`a3e96e8`, #221 — #218's measured
  ceiling is the spawn budget). The big waves re-seated onto GLM per `8f0c112`.
- **Adoption foundries ran WAVE-OK:** pm-comparison (`94a0d35`) and dsh-comparison (`c14e281`)
  — ADOPT/ADAPT/REJECT verdicts with named landing zones; the blue-team + fold foundries
  landed (`98bdd1d`, `9b18ec1` — the 13-suite honesty body fully blue-teamed and folded,
  impl-ready).

---

## Planned (filed, not started)

The complete open map is ~112 tracked issues — the lossless catalog lives in the
[issue tracker](https://github.com/wahargis/baton/issues) and
[docs/28](../28-exhaustive-capability-audit.md); the thematic shape:

**Core platform rungs** — #2 orchestrator-selected exact routes · #3 the live route-matrix
proof · #4 locale-independent ordering · #5 cross-controller namespaces · #6 semantic
verification of model-authored reviews · #7 transitive process-forest reap under load · #8
durable autonomy/containment authority · **#9 the Program IR trunk** (closed, replayable,
content-addressed workflow programs — the driver-killer's final form; #170's DSL is its
surface syntax).

**The collaboration layer, completed** — #19 REPL objects as ordinary hand-offs · #24–#27 the
KG horizons arc (read models, promotion paths, ambient activation, graph growth — the read
path is now in flight, see above) · #96 the project tier across runs · #104 symbol-cited
briefs · #122 the compaction firewall.

**Control-surface honesty (the operator's top priority)** — #155–#160 the #147-audit cluster
(silent reinterpretation, MCP profile superset, CLI ghosts + registry fidelity, the scratchpad
write verb, doc-truth↔admission conformance, error actionability as a gate law — suites
landed, impl in flight, see above) · #136/#139 the cursor/refusal-quality elders · #41 the
pattern source · #97 untyped TypeError refusals · #93/#156 the MCP surface completeness arc.

**Orchestration depth** — #12 nested orchestration (gates the #74 full shape + #162; red-first
suite landed) · #102 tightly-coupled cells · #106 steering-policy coverage of the new lanes ·
#161 the orchestrator plan object (impl wave dispatched 2026-08-14) · #162 mid-flight wave
mutability · #163 quiescence-derived completion · #164 blind waits fail loud · #165
launch-time harvest validation · #167 the actual-inference readiness tier · #146 seat
telemetry (impl wave dispatched 2026-08-14).

**Kernel honesty (#169's umbrella)** — #143 the `baton_repl_cite` cross-run read escape · #95
the public `driver` field · #98 NUL-byte key separators · #148 the resident credential fence ·
#168 snapshot sideband refs.

**Craft & governance** — #77 suite resource governance · #72 prescriptive doctor · #82 the
frontier-sweep umbrella · #91 the orchestrator investigation surface · #100 wave-retry
footguns · #101 the 4096 objective cap · #113 policy single-sourcing · #125 the replay
harness · #149 the gate failure digest (impl wave dispatched 2026-08-14) · #166 the anchor
suite-law.

**Eval & proof** — #107 EVAL-R0 (pre-registered, fires on clear seats) · #125's
replay-harness precondition · the attended-dogfood practice (recurring real-task waves as the
defect-finder).

**Older AX frictions (worker-reported)** — #38 read-only objectives compiling change intent ·
#39 transient refusals cancelling runs · #49/#50 the glm seat elders · #51 upward state
feedback · #52 MockAdapter stray commits · #54 kimi-acp thinking=on · #55–#58 the stall/AX
convergence set (partially absorbed by #67) · #60 the worker friction up-channel · #65
keyed-wave close stall · #66 the doubt-review surface.

**Seats & reach** — #145 OhMyPi harness evaluation (low) · #29/#90 remote control over
Tailscale (low) · computer-use worker tier (bet, flagged flaky) · programmatic provider reauth
(#148-adjacent) · **#115/#133 the Flip experience** ([docs/38](../38-flip-experience.md); the
pose grammar + native animation, low).

---

## Split provenance (what moved, in brief)

| Pre-split README section | New home |
|---|---|
| "Reading the status tiers" note | Condensed legend in the README's capability ledger; full methodology above |
| Shipped capabilities | README **LANDED** tier (rows now carry suite/doc/issue citations) |
| In flight (stage named) | README **IN-FLIGHT** tier (condensed) + the full roster above |
| Planned (~112-issue thematic map) | README **PLANNED** tier (headline form) + the full map above |
| Documentation map | README documentation map (this file added to it) |

The full move map with line-level judgment calls is in
[`evidence/readme-split-2026-08-14/notes-row-readme.md`](evidence/readme-split-2026-08-14/notes-row-readme.md).

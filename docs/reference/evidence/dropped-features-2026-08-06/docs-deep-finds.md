# Dropped-features hunt — the design-intent corpus (docs-dive 2026-08-06)

*Companion to the capability atlas. The atlas records what is **unbuilt**; this report records what was
**dropped** — designed in detail and then abandoned, retired, cut, or silently superseded — and whether
bringing it back still earns its place today. Every find is cross-checked against `impl/src` with a cheap
vocabulary grep; the "verified-not-dropped" tail (## 5) lists the features that LOOK dropped from the
docs but are actually landed under a later name, so nobody re-builds them.*

**Method.** Read the top-level docs (`docs/00`–`docs/37`, `README.md`, `SYSTEM.md`, `GLOSSARY.md`,
`docs/PROGRESS.md`), the handoff (`docs/handoff/ISSUE-001-phase10-handoff.md` + evidence dir), and the
design-corpus digest. Grepped the corpus for drop vocabulary
(`dropped|abandoned|retired|sunset|no longer|deferred|superseded|removed|deleted|non-goal|cut`), then
verified the survivors against `impl/src` (`grep -rniE "<distinctive vocabulary>" impl/src`, NUL-safe —
only `application.mjs` / `coordination-store.mjs` contain NUL bytes and were handled with `grep -an`/`sed -n`).
Genuine finds have a **drop story** (an explicit cut/retire/vanished decision or a design law it
contradicts), not just "listed as pending."

---

## 1. Finds table (ranked by value-per-cost)

| # | Feature | Drop evidence | Status in `impl/src` | Value today | Size to restore |
|---|---|---|---|---|---|
| 1 | **Compaction firewall / recite-from-outside** | `docs/12:29`; `docs/21:52` "governance firewall (keeper, build-first for context)"; `docs/34` open Q6 | Event kind `lifecycle.session_compacted` defined in `story.mjs:99` but **never emitted**; no re-injection, no PreCompact hook | High — the worker-knowledge gap (#1 worker ask); long resumed/forked sessions make compaction real | **Small–medium** — adapter hook + coordinator fold + content-hash re-inject of the already-composed brief block |
| 2 | **Effect tripwire on the merge/integrate gate** | `docs/21:58` "keep the merge-time tripwire, cut the type system" | No tripwire on `run.integrate`; op `effect:` labels the operation (`'repository_edit'`), never the content | High — "a passing test suite is not a security check"; structured integration (Mergiraf) now lands content unchecked | **Small** — scan changed paths against a capability signature list at the integrate gate |
| 3 | **Replay harness / deterministic reproducibility** | `docs/14:47` "Build the replay harness before the eval, not after"; `docs/30:7` explicitly cuts "replay cache" from P0 | Ledger replay landed; captured tool-result snapshots / seed capture / deterministic re-run harness absent | Medium-high — unblocks the linchpin eval AND run forensics (the #55 three-waves-in-two-days stall incident) | **Medium** — snapshot capture on the ledger + a replay entrypoint |
| 4 | **`fleet_bakeoff` (N vendors, same task, judge)** | `docs/09:69` F3; `docs/07` M1 "optional"; `docs/22:175` unbuilt | Cross-vendor review half landed as `semantic_review`; bakeoff absent | Medium — directly answers the E2 decorrelation question; composes with the wave driver + recipes | **Small–medium** — a wave where N members run the same contract + referee judge |
| 5 | **Tools-as-code bridge (`run(code)` surface)** | `docs/21:50` "rental, deferred… premature before that" | Absent (and note `docs/33:11` "no arbitrary-code REPL, ever") | Medium — its precondition (several tools) is now met: S-3 MCP reflex table is a 70-tool inventory | **Medium–large** — constrained tools-calling DSL, real safety boundary |
| 6 | **Graduated autonomy ramp** | `docs/14:61` dry-run → approve-everything → approve-sampled → autonomous-with-circuit-breakers | Binary `autonomy: unattended|interactive` card field exists; the ramp does not | Medium — the AX onboarding story; tension with "steer, don't gate" | **Medium** |
| 7 | **Harness personality / drift profile** | `docs/14:33` "brief *around* the known drift" | Absent from the route card (exact tuple only) | Medium-low — must be *measured* drift, not folklore, or it violates `docs/26:87-112` | **Small** |
| 8 | **Time-travel / counterfactual operator surface** | `docs/14:65` "state 20 minutes ago" / "replay with the brief changed" | Partial successor `run.view --until` + `run.debug` (issue #53); counterfactual replay absent | Low-medium — depends on the replay harness (find #3) | **Medium** |
| 9 | **`fleet_revoke` (nudge revocation)** | `docs/09:15` A3 mandated it; never appears in `docs/05`/`docs/07`/`docs/26`/`docs/36` | Absent; the other A3 fixes (adapter-owned outbox, interrupt-flush) landed | Low — mostly superseded; residual AX value ("take back a nudge before it lands") | **Small** |
| 10 | **`fleet_freeze` (mid-run worktree snapshot)** | `docs/05:67`, `docs/07:152`; absent from `docs/26`, `docs/36` closed verb set | Absent; the preservation/checkpoint machinery (`control.session_preservation_reattached`, `resume_work`, `adopt`) supersedes it | Low — superseded | **Small** |
| 11 | **`capacity` attention kind** | `docs/36:427` "invented `capacity`, which has no emitter and is dropped — reserved for issue #39" | Absent from `ATTENTION_TYPES` (`messages.mjs:18`) | Low — fleet-capacity awareness, explicitly deferred | **Small** |

**Warnings — dropped for a defensible reason; do not restore on faith:**

| Feature | Drop evidence | Why it was dropped (correctly) | Reopening condition |
|---|---|---|---|
| W1 | **R4 compiler IR / R7 whole-repo e-graphs** | `docs/26:265,453`; `docs/28:570-572`; `impl/src/atlas-egraph-evaluation.mjs` is a Decision-emitter stub | JS/TS language ceiling + whole-repo saturation doesn't scale; retired through *recorded Decisions* (the corpus's own negative-gate law) | Already encoded: `AtlasEGraphEvaluation` reopening gates (external engines, demand/accuracy/scale thresholds) |
| W2 | **Autoformalization / proof-carrying "Bundle B"** | `docs/11:26` demoted to earned-by-demand | Spec-weakening attack; "never emits 'proven' over a worker-supplied spec"; research race baton shouldn't run | `docs/11:53` — remains a priority red-team target, not a build |
| W3 | **Elixir/OTP production core** | `docs/17`; `docs/22:159` "cut"; handoff §1 "actual baton be built in Go or Elixir" | The dependency-free Node ESM reference impl IS the executable spec; a rewrite is a second implementation of every contract | Only if the reference impl's perf/deployment limits actually bite |
| W4 | **Incremental-representation substrate (Salsa-style)** | `docs/21:57` "over-claimed; solves a performance problem baton may not have at a handful of workers" | Still true — single-box fleet doesn't need always-live analysis | If the analysis tools prove too slow (docs/21's own condition) |
| W5 | **Cross-vendor best-of-N generation / ensemble economics** | `docs/12:3`; `docs/13` T4 | pass@N lift is inside-vendor; the cross-vendor value (learned routing + cross-review) **landed** | Open design Q: "when is ensemble decorrelation worth N×" (`docs/12:78`) — unmeasured |

**Tracked-deferred (NOT silent drops — already owned):** nested orchestration (`docs/31:101-102`, issue #12;
BD3 spine is the planned enabler), per-member stall breaks (`docs/37:148-151`), worker session resume/fork
(**landed** — see §5), knowledge promotion taxonomy expansion / retention boundary (`docs/08:156,165`;
`cairn-run-scorecard.mjs` `retainedNext`), git-synced artifact CAS replication (`docs/33:143`).

---

## 2. Per-find details

### 2.1 Compaction firewall / recite-from-outside — RESTORE (top recommendation)

- **WHAT.** `docs/12:29` (mechanism spec): baton "cannot trust a worker it doesn't control to recite — so
  it recites *from the outside*. On a `lifecycle.session_compacted` event, the composer re-injects the
  brief-identity + a resume digest from the knowledge plane (Codex `thread/inject_items` + `thread/goal/set`;
  Claude/GLM `PreCompact`/`SessionStart` hook), **idempotent by content-hash**." Re-stated as a keeper in
  `docs/21:52` ("**Governance firewall (keeper, build-first for context).** … a compacted worker forgets the
  guardrails, not only the objective").
- **WHY DROPPED.** Never wired. The event kind `lifecycle.session_compacted` exists in `impl/src/story.mjs:99`
  and its fold is a **no-op** (`story.mjs:395-398`); no adapter emits it; there is no `thread/goal/set` or
  `PreCompact` hook anywhere in `impl/src`. `docs/34` open Q6 shows why it stalled: "does Claude expose a
  reliable signal, or must baton infer from a token-count heuristic? Where inference is required, the
  firewall is best-effort." The steering epic (#64) and the BD3 spine then absorbed the capacity.
- **WHAT IT WOULD STILL GIVE.** The 2026-08-03 worker verdict's #1 ask is "knowledge poverty 2/5 — I
  re-derive the entire world on every task" (`docs/PROGRESS.md:462-464`). The compaction firewall is the
  *specific* designed mechanism for the guardrails half of that gap, and it composes directly with the
  BD3-B context-objects lane and the already-rendered brief block (`impl/src/adapter.mjs:136-138` renders
  "Definition of done" + "Verification (the ONLY definition of done…)"). A compacted worker finishing
  "done" against its own forgotten standard is exactly the late trust-gate catch the firewall prevents.
- **SIZE.** Small–medium. Adapter-level compaction detection (Codex already emits `session_compacted`; baton
  already controls Claude's `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `claude-session.mjs:274`), a coordinator
  fold on the event, and a content-hash-idempotent re-inject of the pinned brief block. No new authority.

### 2.2 Effect tripwire on the integrate gate — RESTORE

- **WHAT.** `docs/21:58`: "**Effect tripwire (keeper — but just the tripwire).** On merge, flag when a change
  *adds* a new outside-world capability (it now touches the network, the filesystem, secrets, or spawns a
  process) — because a passing test suite is not a security check. Keep this as a cheap flag on the merge
  gate; do **not** build a full effect-type system."
- **WHY DROPPED.** The full effect/capability type system was cut as over-engineering, and the cheap tripwire
  went with it. `impl/src/application-semantics.mjs:657` labels the `integrate` *operation* `effect:
  'repository_edit'`, but nothing inspects the *content* being merged. The Mergiraf-class structured
  integration (`docs/PROGRESS.md:9-11`) now lands resolved divergent work onto main with no capability scan.
- **WHAT IT WOULD STILL GIVE.** A genuinely cheap security gate at the moment of highest leverage. The
  changed-path machinery already exists (`referee.mjs` `changedLines`; `coordinator.mjs:12899`). A diff that
  silently adds `fetch(...)`/secret-read/spawn now lands green and unremarked. The tripwire is the 
  designed-but-never-built middle of "keep the tripwire, cut the type system."
- **SIZE.** Small. A signature scan of the changed paths at the `run.integrate` gate, emitting a flagged
  review finding. Composes with `semantic_review` (find #4's half).

### 2.3 Replay harness / deterministic reproducibility — RESTORE (prerequisite to the eval)

- **WHAT.** `docs/14:47`: "**Reproducibility is a harness feature, and the eval is impossible without it.** …
  true reproducibility needs more [than ledger replay]: pinned model versions, captured tool-result
  snapshots (so a re-run doesn't re-hit a mutated filesystem), seed capture for anything stochastic, and
  frozen capability-index revisions. … **Build the replay harness before the eval, not after.**"
- **WHY DROPPED.** The eval it was meant to precede kept sliding (the corpus's own linchpin, still unrun,
  `docs/28:560-561`), so its prerequisite was never built. `docs/30:7` made it an *explicit scope cut*: the
  P0 review vertical "does not add … a replay cache."
- **WHAT IT WOULD STILL GIVE.** (a) The linchpin eval can't measure noise-free without it. (b) Run
  forensics: the #55 incident — "three waves died in two days" from stall-clock blindness
  (`docs/PROGRESS.md:343-350`) — is exactly the class of bug a deterministic re-run makes debuggable. (c) The
  time-travel surface (find #8) rides on it. Exact-model pinning already landed (`exact.harness/model/effort`
  route tuples); the missing halves are tool-result snapshot capture and the replay entrypoint.
- **SIZE.** Medium. Extend the ledger fold with snapshot capture and a replay projector. No new authority.

### 2.4 `fleet_bakeoff` — RESTORE (cheap, composes with the wave driver)

- **WHAT.** `docs/09:69` F3 (CONFIRMED): "Add `fleet_review` (and optional `fleet_bakeoff`) as hub-composed
  northbound tools." Roadmap M1: "Optional `fleet_bakeoff` (N vendors, same task, judge)." The cross-review
  half was promoted to the M1 headline; bakeoff stayed optional and was never built (`docs/22:175`).
- **WHY DROPPED.** The honest "1× cost review, not N× generation" value was captured by the cross-vendor
  review; the N× generation benchmark had no owner once the eval deferred. `impl/src` has `semantic_review`
  (`application-semantics.mjs:638`) but no bakeoff.
- **WHAT IT WOULD STILL GIVE.** The cheapest answer to the open decorrelation question
  (`docs/12:78`; `docs/34` E2). A bakeoff is just a wave where N members run the same contract and the
  Referee judges — the wave driver + `baton.recipes.implementContract` (`docs/PROGRESS.md:385-391`) already
  provide the machinery.
- **SIZE.** Small–medium.

### 2.5 Tools-as-code bridge (`run(code)`) — REVISIT (precondition now met)

- **WHAT.** `docs/21:50`: expose the fleet's tools as "one small `run(code)` surface the worker writes
  against, instead of a wall of tool schemas — cuts tool-definition tokens dramatically (Cloudflare/Anthropic
  'Code Mode'). Worth it once there are several tools; premature before that."
- **WHY DROPPED.** Deferred as premature at a handful of tools. The grammar/control-surface work (M0–M5) then
  attacked the problem by unifying *names* (`docs/36`), not compressing the tool surface.
- **WHAT IT WOULD STILL GIVE.** The precondition is met: the S-3 surfacing matrix derives a **70-tool MCP
  reflex table** (`docs/PROGRESS.md:405-408`), i.e. exactly the "wall of tool schemas" `docs/12` warns
  poisons the window (its own cited data: 150k→2k tokens, ~98%). **Tension, be honest:** `docs/33:11` and the
  Program IR law (`spec/phase93`) say "no arbitrary-code REPL, ever." A `run(code)` tool surface must be a
  constrained tools-calling DSL with a verified sandbox, not general compute — the closed Bench precedent
  (`docs/33:113`) shows the house style for doing this safely.
- **SIZE.** Medium–large, dominated by the safety boundary.

### 2.6 Graduated autonomy ramp — MEDIUM

- **WHAT.** `docs/14:61`: dry-run → approve-everything → approve-sampled → autonomous-with-circuit-breakers,
  with graduation criteria, as "the product's onboarding."
- **WHY DROPPED.** Never referenced again; the approval policy engine shipped as a fixed posture
  (`autonomy: unattended|interactive` card field, `cli-adapters.mjs:507-594`), not a ramp.
- **WHAT IT WOULD STILL GIVE.** The AX onboarding path — the corpus's own "earned-by-demand" law
  (`SYSTEM.md:194-199`) is the ramp in disguise. Tension with "steer, don't gate" (`docs/35:8-9`): the ramp
  must be a *policy dial*, not a turn gate.
- **SIZE.** Medium.

### 2.7 Harness personality / drift profile — LOW-MEDIUM (measured, not folklore)

- **WHAT.** `docs/14:33`: characterize each harness's interpretive tendencies (over-engineer? under-test?) as
  a card field so the orchestrator "briefs *around* the known drift."
- **WHY DROPPED.** No later doc carries it; route cards carry the exact tuple (harness/model/effort) but no
  drift model. The corpus later *rejected* timeless folklore (`docs/26:87-112`: "operator policy inputs
  backed by live cards, not timeless model folklore"), which is the likely reason it vanished.
- **WHAT IT WOULD STILL GIVE.** A *measured* drift signal (learned from verified outcomes, like RouteStats)
  could sharpen briefs and routing. But only as data the router already collects — not a static personality
  card. That makes it a small extension of the existing `router.mjs` feedback loop.
- **SIZE.** Small.

### 2.8 Time-travel / counterfactual operator surface — LOW-MEDIUM

- **WHAT.** `docs/14:65`: "show me the fleet's state 20 minutes ago" / "replay this task with the brief changed."
- **WHY DROPPED.** Only partial successors shipped: `run.view --until` (`docs/36:183`) and `run.debug`
  (issue #53). The counterfactual re-brief replay is the replay-harness payoff (find #3).
- **SIZE.** Medium, gated on #3.

### 2.9 `fleet_revoke` — LOW (mostly superseded, keep in mind)

- **WHAT.** `docs/09:15` A3 (CONFIRMED catastrophic): "add `fleet_revoke`" so a queued nudge that survived an
  interrupt can't detonate the abandoned plan on the next turn.
- **WHY DROPPED.** The *other* three A3 fixes landed — interrupt flushes the adapter nudge queue, the
  adapter-owned outbox (nudges never enter stdin mid-turn), and the side-effecting-imperatives-are-tasks
  convention — which make the standalone verb mostly redundant. It never appears in `docs/05`/`docs/26`/`docs/36`.
- **WHAT IT WOULD STILL GIVE.** Residual AX: "take back a nudge before it lands." Small, additive.
- **SIZE.** Small.

### 2.10 `fleet_freeze` — LOW (superseded by preservation machinery)

- **WHAT.** `docs/05:67`: "`fleet_freeze` (interrupt→confirmed-unwound→snapshot worktree→pinned ref)";
  `docs/07:152`. The A5 fix for "pause is a placebo."
- **WHY DROPPED.** The preservation/checkpoint machinery that landed (session preservation
  `control.session_preservation_reattached`, `resume_work`, `adopt`, `capturedSha`) delivers the durable
  forensic capture the freeze verb was for. The verb's name vanished from the closed grammar
  (`docs/36:184`), its function did not.
- **SIZE.** Small (and probably unnecessary).

### 2.11 `capacity` attention kind — LOW (deferred, tracked)

- **WHAT.** `docs/36:427`: an invented attention kind with no emitter, dropped and "reserved for issue #39."
- **SIZE.** Small. `ATTENTION_TYPES` (`messages.mjs:18`) is `approval|question|blocked|stalled|budget_alarm`.

---

## 3. Top-3 recommendations

1. **Restore the effect tripwire (find #2).** Smallest cost, immediately load-bearing: structured integration
   now lands Mergiraf-resolved content on main with a passing suite and no capability scan. A changed-paths
   capability signature check at the `run.integrate` gate closes the exact security hole `docs/21:58` named —
   and the changed-lines machinery it needs already exists.

2. **Restore the compaction firewall / recite-from-outside (find #1).** The mechanism is fully designed
   (`docs/12:29`), the event kind is already in the fold vocabulary but never emitted, and it directly serves
   the worker verdict's #1 ask (knowledge poverty). Compose it with the BD3-B context lane; ship the
   `session_compacted` emission + content-hash re-inject of the pinned brief block.

3. **Build the replay harness (find #3), and stop deferring it.** It is the corpus's own declared prerequisite
   to the linchpin eval (`docs/14:47`) and it converts the class of "three waves died in two days"
   (`docs/PROGRESS.md:343-350`) incidents from post-mortems into deterministic re-runs. Do it *before* the
   eval, as the corpus insists.

   Honorable mention: `fleet_bakeoff` (find #4) is the cheapest way to start answering the decorrelation
   question today — it composes out of the shipped wave driver + recipes and needs no new authority.

---

## 4. How to verify these findings (re-run commands)

```sh
# find #1 — event kind defined, never emitted, no re-injection:
grep -rn "lifecycle.session_compacted" impl/src  impl/test     # only story.mjs:99 + its test
grep -rniE "preCompact|thread/goal/set|inject_items" impl/src  # nothing

# find #2 — no tripwire on the integrate gate:
grep -rniE "tripwire" impl/src/*.mjs                          # only event-kind tripwires in tests

# find #3 — ledger replay yes, snapshot/replay harness no:
grep -rniE "tool.?result.?snapshot|replay.*snapshot" impl/src  # nothing

# find #4 — semantic_review landed, bakeoff absent:
grep -rniE "bakeoff|bake.?off" impl/src impl/test             # 0 hits
grep -niE "semantic_review" impl/src/application-semantics.mjs # registered op

# find #11 — capacity attention kind absent:
grep -niE "'capacity'" impl/src/messages.mjs                  # absent from ATTENTION_TYPES
```

**NUL discipline:** only `impl/src/application.mjs` and `impl/src/coordination-store.mjs` contain NUL bytes;
use `grep -an` / `sed -n` there. All greps above are plain-text safe.

---

## 5. Verified NOT dropped (the handoff debts that LANDED — do not rebuild)

The most valuable negative result of this hunt. The phase-10 handoff §6 "UNSHIPPED-DEBT" list is largely
**closed by later phases** — anyone reading only the handoff would rebuild these:

| Handoff §6 debt | Verdict today | Evidence |
|---|---|---|
| **Worker session resume/fork** (claude `--resume`/`--fork-session`, codex `thread/resume`/`thread/fork`, grok `session/load`/`session/fork`) | **LANDED** | `claude-session.mjs:428-429,743`; `codex-appserver.mjs:855-867` (`thread/resume`/`thread/fork`); `grok-acp.mjs:785` (`session/load`); `kimi-acp.mjs:366-367`; all four adapters gate `attachOnly` on `session.mode === 'resume'` |
| **Budget enforcement end-to-end** (hard-stop, thresholds) | **LANDED** | `resource.budget_threshold` emitted (`coordinator.mjs:8908`), `hardStop` → `budget_exceeded` terminal cause (`coordinator.mjs:13590-13605`); `budget_alarm` attention type; `maxWallMin`/`timeoutMs` plumbed (`application-deployment.mjs:877`, `coordinator.mjs:3701`) |
| **Red→green + coverage-of-change + mutation** trust-gate cluster | **LANDED** | `referee.mjs:245,296-337` (`requireRedGreen`, `requireCoverage`, `requireMutation` + `mutationCommand`); `coordinator.mjs:12899` |
| **Merge/integration + semantic review** | **LANDED** | `run.integrate` ff-only/structured (`application-semantics.mjs:648`); Mergiraf resolver + fresh verify (`PROGRESS.md:9-11`); `run.review` → `semantic_review` with grounded findings (`application-semantics.mjs:638`) |
| **Cross-vendor review pass** | **LANDED** | `semantic_review` op + web operator rendering (`web-operator.mjs:90-91,145-157`) |
| **Delegation-contract brief with pinned done-command** | **LANDED** | `adapter.mjs:136-138` renders "Definition of done" / "Verification (the ONLY definition of done…)"; coordinator re-runs the pinned Plan command |
| **Plan-gate** | **LANDED** | `plan_propose`/`plan_approve`, `awaiting_plan_approval`, `goal-plan.mjs`, `wave.mjs:119` |
| **Structured postmortem / DIAG** | **PARTIAL-SUPERSEDED** | `verifier-diagnostics.mjs` (digests-only honest diagnosis), `wire.frame_degraded`, `run.debug` (DG-1, `PROGRESS.md:409-411`) — the "likely cause" prose half is the only missing piece |
| **Stall/loop/budget watchdog** | **PARTIAL — filed #67** | `watchdog: {stallMs, scopeAction}` config + mechanical action (`application-deployment.mjs:1916-1920`, `coordinator.mjs:8677,1033-1057`); the *stall* watchdog's inertness is a tracked issue (#67), not a dropped feature |
| **`fleet_bakeoff`** | **UNBUILT (find #4)** | — |
| **Hub watchdog auto-interrupt** | **LANDED (mechanical)** | `scopeAction` default `kill` (`coordinator.mjs:1033`) |

Also verified **landed** and thus excluded from the finds: `openBaton` embedding (the roadmap's "Conductor
mode / Option D" northbound swap, `index.mjs:50`), learned routing + RouteStats (`router.mjs`), story
compiler (`story.mjs`), turn-checkpoint steering (`turn.paused`/`claim`), REFLEX-1..4 (decision/boards/
packages/context_eval), REPL-1..3, Cairn scorecard + promotion, Atlas R1–R3/R5/R6 representation rungs
(structural delta, CPG, fingerprint, structured merge), budget alarm, exact-route/model pinning, and the
grammar M5 alias sunset.

---

*Compiled 2026-08-06 from the top-level docs corpus, `docs/PROGRESS.md`, and `docs/handoff/ISSUE-001-phase10-handoff.md`;
existence cross-checks are shallow greps against `impl/src` only. Sibling authority: the capability atlas
(`docs/reference/capability-atlas-2026-08-03/design-corpus.md`) owns the full unbuilt map; this report owns
the drop stories and the "already landed under another name" negative results.*

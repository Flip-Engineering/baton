# EVAL-SCOPING — the corpus's unrun linchpin, and the cheapest honest first number (2026-08-03)

Scope: what the design corpus demands of an eval (M0/M1/E2), what landed machinery could run one
today, what honestly does not exist, and one concrete first number runnable this week. Every claim
cited file:line. Compiled read-only; the only file this memo writes is itself.

The corpus's own verdict on this situation, verbatim: *"a rigorous, repeatedly-self-correcting
exploration that has concluded 'build the small thing and measure it' every single round and has
not yet built the small thing"* (`docs/16-framing-critique-and-pivots.md:89`). The capability atlas
confirms the eval row is still **unbuilt**: "Reproducible M0/M1/E2 evaluation programs… remain
pending" (`docs/reference/capability-atlas-2026-08-03/design-corpus.md:472`, citing
`docs/28-exhaustive-capability-audit.md:560-561`).

---

## 1. What the corpus actually demands

### 1.1 The pending bullet of record

`docs/28-exhaustive-capability-audit.md:560-561` lists as still-pending:

> "Reproducible M0/M1/E2 evaluation programs, automatic account-aware scheduling, and a production
> Go/Elixir core after executable contracts stabilize."

The full-system goal defines the three programs by name (`docs/26-full-system-goal.md:201-202`):

> "Reproducible M0 control latency, M1 orchestration arms, and E2 cross-vendor decorrelation
> evaluations, including null/negative outcomes and human-audit cost."

Note the goal's own framing: **null/negative outcomes are an expected deliverable**, and
**human-audit cost** is a measured axis.

### 1.2 M0 — "Transport spike + the honest baseline (~1 week)" (`docs/07-roadmap.md:122`)

Shape: a hub skeleton plus two adapters, whose *point* is four recorded experiments
(`docs/07-roadmap.md:130-134`):

1. `fleet_wait` under real host timeouts, both orchestrator directions (`:131`);
2. `turn/steer` behavioral semantics — splice mid-turn or queue (`:132`);
3. **Interrupt latency + the unwind window** — `fleet_interrupt` → confirmed
   `turn/completed(cancelled)`, and whether a shell child outlives the ack (`:133`);
4. **The honest baseline:** "`codex exec` in a for-loop vs the minimal hub on ~5 fixed tasks —
   wall-clock and pass-rate. If the hub isn't already at least competitive on the axes it will
   later claim, stop and rethink." (`:134`).

Falsifies: "the whole event-loop premise, the steer/interrupt reliability premise, and 'the hub
beats a for-loop'" (`docs/07-roadmap.md:135`). M0 is a *measurement* milestone: build the smallest
bridge, then publish numbers against a for-loop.

### 1.3 M1 — "The differentiating demo + cross-review + the supervisor (~3–5 weeks)" (`docs/07-roadmap.md:137`)

Its exit gate is the corpus's one pre-committed pivot criterion (`docs/07-roadmap.md:146`):

> "**Cut-down eval at the exit gate:** arms (a) best solo vs (c) fleet on ~10 tasks; explicit pivot
> criteria (fleet ≤ solo pass-rate and >1.5× wall-clock → halt and rethink). Eval gates M2, not the
> reverse."

So M1's eval measures **verified pass-rate and wall-clock, fleet vs best solo, ~10 tasks**, with a
halt rule pre-registered.

### 1.4 E2 — cross-vendor decorrelation (`docs/18-campaign-synthesis.md:7-17`)

The max-campaign's sharpened replacement for M1-as-first-experiment (`docs/18:9-11`):

> "**E2 — Does independent cross-vendor verification catch material defects that same-vendor
> verification misses, at a decorrelation rate that justifies a second vendor's cost?**"

Properties the corpus assigns it: needs **zero baton infrastructure** — two `--json` artifact
consumers and a fixed corpus of ~50 real diffs with known/injected defects, graded against a
human-pinned spec (`docs/18:13`); two-sided kill criterion — if cross-vendor lift is within noise,
"the cross-vendor premise is dead at the root and the entire project… should not be built"
(`docs/18:13`); grader is SWE-bench-shaped (fresh-container re-execution, canonical held-out tests,
`FAIL_TO_PASS` + `PASS_TO_PASS`) with one fixed USD+wall cap per arm (`docs/18:21`); adversarial
review of the E2 *design* before running (`docs/18:15`, echoing `docs/14:71`).

**Status caveat:** doc 18's *framing* is superseded — "The eval (E2) is optional de-risking of
*one* supporting feature, not a go/no-go on the product" (`docs/18:3` banner;
`docs/19-north-star-corrected.md:43`: "The 'should we even build it / measure first' hedging is
also stood down"). But the *programs* remain in the goal (`docs/26:201-202`), the audit's pending
list (`docs/28:560-561`), and the current execution order: "Run and publish the routing,
control-latency, cross-vendor decorrelation, recovery, and human-audit-cost evaluations"
(`docs/07-roadmap.md:108-109`). Doc 19 retired the go/no-go posture, never the measurement.

### 1.5 The demand chain (who demanded "one honest eval number", and what else they demanded)

- **docs/13 (review round 2):** "The one thing: **get one honest eval number before writing another
  line of capability-plane spec.** The entire corpus cantilevers off a single unmeasured fact —
  does a supervised cross-vendor fleet beat a single-vendor soloist on cost/time/quality?"
  (`docs/13-revision-log-r2.md:37`); reaffirmed as "the single highest-priority action… run the M1
  eval and let its pre-committed pivot criteria decide" (`docs/13:60`).
- **docs/14 #14 (the replay-harness demand):** "Reproducibility is a harness feature, and the eval
  is impossible without it… The ledger replays *events*; true reproducibility needs more: pinned
  model versions, captured tool-result snapshots (so a re-run doesn't re-hit a mutated filesystem),
  seed capture for anything stochastic, and frozen capability-index revisions… **Build the replay
  harness before the eval, not after.**" (`docs/14-practitioner-addenda.md:47`).
- **docs/14 #21 (eval hardness):** a fair eval is a research problem: strong soloist baseline, no
  cherry-picked tasks, un-gameable grading, pre-registered metric — "I'd put a red team on the
  *eval design* before a line of it is written" (`docs/14:71`).
- **docs/14 #22 (the null hypothesis):** "orchestration can make agents *worse*… for a large class
  of tasks, the answer is 'just let one good agent do it'" — the hypothesis the eval must be able
  to *confirm* (`docs/14:73`).
- **docs/16 Pivot 3:** "Ship a measurement, not a system… ~a few hundred lines, not four planes"
  (`docs/16-framing-critique-and-pivots.md:76-77`); null-hypothesis-as-product (`docs/16:82-83`).
- **docs/22 (completeness audit):** "Run the eval. A green suite doesn't prove the cross-vendor
  thesis: M0 steer/interrupt-latency and fleet_wait-under-timeout measurements, M1 arms, and E2
  decorrelation are all unrun — and most of what they'd measure (steer, app-server) doesn't exist
  yet" (`docs/22-completeness-audit.md:181`). The second clause is **now stale**: native steer
  landed (`docs/23-phase8-live-reeval.md:50-52`), the wave driver and recipes shipped (§2 below).
  The first clause — *all unrun* — stands.
- **spec/phase93 93F (the newest, largest design):** a closed `EvaluationPlan` —
  `arms=["direct","naive_parallel","lossy_episode","program"]`, exactly 24 corpus items × 4 arms ×
  5 paired repetitions = 120 blocks / **480 scheduled arm runs**, with per-arm token/USD/wall
  envelopes, pinned toolchain, cache states, Latin-square assignment, and scripted crash-injection
  points (`spec/phase93-closed-program-ir.md:2437-2459`, `:2595-2600`); the `program` arm is
  budget-parity-capped against `naive_parallel` (`:2694-2695`). Status: **absent**
  (`spec/phase93-closed-program-ir.md:94`).

---

## 2. What exists to run one today

### 2.1 Landed machinery, inventory

- **Productized wave driver** — `impl/src/wave-driver.mjs:1-17` (docs/37 v2 laws L1–L7; the
  multi-hour poll/steer/settle/close loop shipped once, issue #46). Documented production cadence
  in `DEFAULT_POLICY`: 20s poll, 20min stall, 3h hard cap, `nudge-on-checkpoint` steering,
  `kg-ritual` settlement (`impl/src/wave-driver.mjs:27-46`).
- **Recipes library (composition v2.1)** — `impl/src/recipes.mjs:1-18`: "no new orchestration wave
  may require a new script file"; `implementContract` preset renders a recipe as data over
  `createWaveDriver`, with the invocation manifest as the one identity boundary (idempotencyKey →
  exact rendered members, salt owned by the wrapper). In production use since 2026-08-01: "Every
  subsequent wave launched through `baton.recipes.implementContract` in ~35 lines — the bespoke
  driver scripts are retired" (`docs/PROGRESS.md:416-417`); live example:
  `docs/reference/evidence/frontier-sweep-2026-08-03/run-l2-impl-wave.mjs` (one lane per
  invocation, exact seat `{harness, model, effort}` per lane).
- **93B wave durability** — attach-and-harvest + re-drive-the-failed:
  `docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md:1` (contract v2),
  durable `waveId` minted at `waves.start` (`:30`), steering continuity from `turn.settled` replay
  (`:50-52`); verified by a deterministic MockAdapter red suite, no live providers (`:93,:95-101`),
  plus a live SIGKILL driver-death demo with idempotent re-attach (`docs/PROGRESS.md:411-416`;
  `README.md:39-40`). (Naming footnote: this campaign "93B" is the wave-durability contract; the
  phase93 spec's "93B" is the *branch-local durable Program reducer*
  (`spec/phase93-closed-program-ir.md:90`) — a different, unbuilt slice.)
- **Program IR grammar + identity (93a.1–93a.3a)** — `impl/src/program-ir/` (`index.mjs`,
  `normalize-program.mjs`, `canonical-value.mjs`, `schema-values.mjs`, `program-policy.mjs`, …);
  shipped per `README.md:38`; identity law: a node's own ID is never an input to its hash, rewiring
  changes identity (`spec/phase93-closed-program-ir.md:223-225`), array classification at `:231-238`.
- **Result pins** — `refs/baton/results/*`: **207 refs**, each a snapshot commit carrying exact
  `Baton-Task` / `Baton-Vendor` / `Baton-Model` / `Baton-Effort` trailers (e.g. `0045e06e…`,
  deepseek-v4-flash@high, 2026-07-31). Worker outputs are content-pinned with their exact route.
- **Wave receipts/manifests from this campaign** — `docs/reference/evidence/frontier-sweep-2026-08-03/`:
  each run pins `waveId`, `idempotencyKey`, `recipeDigest`, `salt`, fully-rendered member objectives
  with exact route (`orientation-impl-manifest.json`), and a receipt with `startedAt`, per-member
  `outcomes` (role/phase/terminal/narrative), `steering`, `nudges`, `claims`, `decisions`, `stops`
  with resource-reap state, `knowledge`, `settlement` (schema verified across
  `contract-storm-receipt.json`, `crossreview-receipt.json`, `board-impl-receipt.json`,
  `orientation-impl-receipt.json`, `readiness-impl-receipt.json`). Honest sample of campaign reality:
  this afternoon's two impl waves terminalized `cancelled` on `worktree_capacity_exceeded`
  (`orientation-impl-receipt.json` outcomes) — failure modes are receipted, not hidden.
- **The sealed run scorecard (the closest thing to an eval instrument already shipped)** —
  `impl/src/cairn-run-scorecard.mjs` (Phase 31, exported at `impl/src/index.mjs:190`). Per run,
  deterministically rebuilt from the ledger and sealed idempotently
  (`coordination-store.mjs:12444-12448`): per-task outcome + **verified** flag (completed *and*
  hub-mapped `verify.reverified` accept, `:504-511`), exact requested/resolved/observed route tuple
  (`:516-522`), **token+USD usage per task and per run** (`:512-513,:530,:537`), **interventions
  total/byKind/byActor** over `control.send|steer|nudge|follow_up|interrupt|kill|recovery` (`:8-11`,
  `:529,:535`), approvals requested/resolved (`:527,:536`), route histogram (`:538`); the sealed
  document is digest-pinned with coordination evidence refs and is ACI-reverifiable (`:542-544`,
  `:579-585`, `:588+`). Usage events are really emitted by live adapters (`impl/src/adapter.mjs:531,569`,
  `impl/src/claude-session.mjs:1173`, `impl/src/codex-appserver.mjs:715,727`,
  `impl/src/cli-adapters.mjs:137,183,189`).
- **The grader** — pinned red-first suites with the zero-weakening law (campaign objective text,
  verbatim from the orientation manifest: "make `impl/test/orientation-red.test.mjs` green with
  ZERO weakening edits"), the trust gate's hub re-verification, and the canonical gate
  (**2922/2922**, `README.md:37`). A suite at a pinned digest is the un-gameable grader
  docs/14:71(c) asks for, one level down from E2's held-out-tests shape.
- **Ledger event replay** — landed (`docs/28-exhaustive-capability-audit.md:40-41`, item 5:
  "operational ledger/cursors/replay"). This is *event* replay, not docs/14:47's replay harness
  (§3).

### 2.2 Could an M0-shaped measurement be assembled from landed machinery without new code?

**Yes for the measurement plane; one read-only tabulation script short of a full program.** Both
M0 arms are expressible as *recipe data* today: the "hub" arm is the campaign's own
`implementContract` wave; the "for-loop" arm is a one-member recipe with `steering:'none'`,
`finalization:'none'`, `settlement:'none'` — one worker left alone, which is exactly M0's
`codex exec` for-loop translated onto the shipped seat. The grader (pinned red-first suite), the
identity/manifest layer (recipes), durability (93B attach), and the instrument (sealed
`run.scorecard`) all exist. Nothing in that requires orchestration code; the only missing artifact
is the *analysis* — a read-only tabulation over scorecards/receipts/git refs.

What it would measure (all four are computable from landed pins):

- **Worker one-shot rate** — first-attempt `completed` + `verified` per scorecard
  (`cairn-run-scorecard.mjs:509-511`), cross-checked against idempotency-key rotation history
  (a re-drive requires a new key — `run-l2-impl-wave.mjs` header — so attempts are visible).
- **Suite-green-per-wave** — receipt `outcomes[].phase` + the canonical gate result per rung
  (the campaign already records gate counts, e.g. `docs/PROGRESS.md:439` 3043/3043).
- **Steering interventions per epic** — scorecard `interventions` block (`:535`) and receipt
  `nudges`/`steering`/`decisions` arrays (e.g. contract-storm receipt: 4 nudges across 4 members).
- **Cost per landed rung** — scorecard `usage {tokens, usd}` (`:537`), with the honesty caveat that
  provider-terminal lump usage can cross ceilings before telemetry arrives
  (`docs/28:562-566`); wall-clock from receipt `startedAt` + evidence timestamps.

---

## 3. The honest gap list — demanded, but does not exist

1. **The docs/14:47 replay harness.** Pinned model versions, captured tool-result snapshots, seed
   capture, frozen capability-index revisions — none exist. The ledger replays *events*; the
   reproducibility layer that lets you attribute a difference to the variable you changed is
   unbuilt (`design-corpus.md:475`: "'Build the replay harness before the eval' (`docs/14:47`)…
   not separately listed as shipped"). **Consequence:** any number run this week is
   *observational* — provider-side model drift is an uncontrolled confound. The corpus's own
   verdict is that without this harness "the linchpin eval measures noise" (`docs/14:47`).
2. **E2's corpus and grader.** The ~50 real diffs with known/injected defects and human-pinned
   specs (`docs/18:13`) do not exist as an artifact; neither does the fresh-container
   `FAIL_TO_PASS`/`PASS_TO_PASS` runner (`docs/18:21`). E2 needs no *baton* infrastructure but does
   need this dataset — building it honestly is days of human work, not an afternoon.
3. **Semantic-diff scoring.** *Semantic* (data-flow) diff/merge — the docs/15 flagship — is pending
   (`design-corpus.md:462`; `docs/28:548-553`); only structural delta + structured merge shipped.
   For near-term eval grading, pinned red-first suites substitute; for E2's "material defect"
   adjudication at scale, this (or human grading) is the gap.
4. **The 93F EvaluationPlan machinery.** Four arms, 480 runs, Latin squares, crash injection —
   spec only, "absent" (`spec/phase93-closed-program-ir.md:94`). The most rigorous eval design in
   the corpus is also the furthest from runnable.
5. **Pre-registration and adversarial review of the eval design itself.** docs/14:71 demands a red
   team on the eval *design* before it runs; no eval design doc, pre-registration, or eval-issue
   exists anywhere in the repo or tracker (§5). This is a process gap, closable this week.
6. **Production Go/Elixir core — real requirement, not stale, but NOT an eval prerequisite.** The
   standing intent is documented: "`impl/` is the **reference implementation / executable spec**…
   The user's standing intent is that 'actual baton' be built in Go or Elixir"
   (`docs/handoff/ISSUE-001-phase10-handoff.md:63-69`), and it sits in the same pending bullet as
   the evals (`docs/28:560-561`) — explicitly sequenced "*after* executable contracts stabilize,"
   and docs/18:36 says the question "doesn't arise until *after* E2 says 'build the thing.'" Treat
   it as downstream of the eval, never as a gate on it; the first number runs on the Node
   reference implementation by design.
7. **Peer pendings in the same bullet:** automatic account-aware scheduling (`docs/28:560`) —
   relevant to eval *scheduling* (quota windows per seat) but not blocking; OTel GenAI export
   (`docs/28:556`) — relevant to telemetry plumbing, not to a first number.

---

## 4. Recommended first number — sweep rung proposal "EVAL-R0"

File as a rung of the frontier sweep (issue #82's lane discipline: contract → red-team → suite →
run → acceptance), in two halves. The first half costs nothing; the second half is the decision
number.

### EVAL-R0a (retrospective, zero new spend — do first, one day)

Tabulate the campaign's own already-pinned record: 207 `refs/baton/results/*` pins, the
frontier-sweep manifests/receipts, and per-run sealed scorecards where deployments survive.
Report, per landed rung: one-shot rate (first-key success vs re-drive keys), interventions per
epic, wall-time per rung, tokens/USD per rung where usage events exist. This is a read-only script
over git refs + JSON — the corpus's first *measured* statement about itself (today it has only
anecdote: "three one-shot epics, all gate-green" — `frontier-sweep.md:7-9`; "47-minute one-shot" —
`docs/PROGRESS.md:445`). **Pre-register the R0b pivot criteria before looking at R0a output**
(docs/14:71(d): pick the metric deliberately and pre-register it; retrospective-then-pivot is
HARKing).

### EVAL-R0b (prospective M0/M1-shaped two-arm measurement — the decision number)

- **Program.** Five already-landed red-first rungs re-driven at their pre-implementation base
  commits (grader = the same pinned suite at the same digest; zero new grader code; task selection
  not cherry-picked toward the fleet — these are ordinary implementation rungs the project actually
  needed). Candidate set: #64 trust-gate steering, #63 KG settlement, S-1 wave grammar, DG-1
  diagnostics, M5 alias sunset — all landed via `baton.recipes` with base commits in the ledger.
- **Arms (M1's shape, docs/07:146, one seat):** **(a) solo** — one-member recipe,
  `steering:'none'`, `finalization:'none'`, `settlement:'none'`: one worker, same brief, left
  alone (the for-loop arm); **(b) driven** — the campaign's own `implementContract` shape with the
  documented production cadence (`wave-driver.mjs:27-46`). Same seat both arms:
  `deepseek-v4-flash@high` — the campaign's converged primary implementer
  (`frontier-sweep.md:6-9`), which also makes the arms seat-comparable.
- **Measurement.** Per run: seal `run.scorecard` at terminal → verified-rate (suite green +
  canonical gate), attempts-to-green, wall ms, tokens, USD, intervention counts; receipts pin
  steering/nudges/decisions. Publish: one-shot verified-rate per arm, mean wall per landed rung,
  mean USD per landed rung, interventions per landed rung — including null/negative outcomes, per
  `docs/26:201-202`.
- **Pre-registered falsification (M1's criterion verbatim, adapted):** if driven ≤ solo on
  verified-rate **and** driven > 1.5× solo wall-clock → the wave-driver layer is net-negative on
  this task class → halt sweep expansion and rethink (`docs/07:135`, `docs/13:37`). Symmetrically,
  a driven-arm win on either axis with interventions ≈ 0 would falsify the campaign's steering
  story (value would be coming from retry, not steering).
- **Expected cost.** 1 model × 10 waves (5 tasks × 2 arms) × ≤3h hard cap each
  (`wave-driver.mjs:32`), realistic ~45–60 min per run on the #64 precedent
  (`docs/PROGRESS.md:445`) ⇒ ~8–10 seat-hours, ~1 calendar day at 3-wide parallelism (deepseek API
  seat; avoids the glm 20-minute stream-death and grok TTL caveats — issues #50, #49). USD:
  low-two-figures at deepseek list prices (estimate, not measured). Orchestrator attention: ~2h for
  gate validation and scorecard sealing. Fits in this week with slack for one repetition if any arm
  is inconclusive.
- **What it would falsify.** (i) "The hub beats a for-loop" (docs/07:135) at current machinery
  maturity — M0's honest-baseline question, finally answered with the shipped system instead of a
  skeleton; (ii) the campaign's implicit premise that wave-driving + steering + settlement beats
  one good worker left alone (docs/14:73's null hypothesis, made testable); (iii) negatively — if
  the arms tie, that is itself the publishable number: the coordination tax ≈ coordination value on
  this class, which *is* the RouteStat seed.
- **Honest limits (state in the rung contract).** N=5 is a scoping number, not a publication
  number; no replay harness (§3.1) means provider drift is an uncontrolled confound — same-week
  paired execution mitigates but does not eliminate; one seat means no cross-vendor claim (E2
  remains untouched and still demands its own corpus, §3.2); M0's raw transport measurements
  (steer-splice semantics, interrupt-latency microseconds, docs/07:131-133) are separate small
  experiments, foldable into the same rung's evidence dir if wanted.

---

## 5. Issue-ledger cross-check

`gh issue list --state open --limit 100` (59 open issues, pulled 2026-08-04): **no eval issue
exists.** Grepping all 59 titles for `eval|measure|benchmark|decorrel|M0|M1|E2|replay|baseline|
solo|experiment` yields one false positive — #19 "REFLEX-4: REPL objects as ordinary hand-offs
(application.context_eval…)" matched on `context_eval`. Closed-issue search for "eval" returns only
REPL/scorecard-adjacent titles (#21, #23, #31). The corpus's declared linchpin — demanded in
docs/07:146, docs/13:37, docs/14:47/71, docs/16:76-77, docs/18:17, docs/22:181, docs/26:201-202,
docs/28:560-561 — **has no tracked issue, open or closed.** First mechanical action: file EVAL-R0
(§4) as an issue so the number has somewhere to land.

---

## Appendix — the one-paragraph answer

The corpus demands three reproducible programs — M0 (control-latency + a hub-vs-for-loop honest
baseline on ~5 fixed tasks, docs/07:122-135), M1 (best-solo vs fleet on ~10 tasks with a
pre-committed halt rule, docs/07:146), E2 (cross-vendor verification decorrelation on ~50 pinned
diffs, docs/18:11) — and a replay harness that must precede them (docs/14:47); none has ever been
run, and no issue tracks them. Landed machinery (recipes v2.1, the wave driver, 93B durability,
207 result pins, per-run sealed scorecards with verified/interventions/usage blocks, pinned
red-first suites as graders) is sufficient to run an M0/M1-shaped two-arm measurement this week
with zero new orchestration code; the honest gaps are the replay harness, E2's corpus/grader,
semantic-diff scoring, and pre-registration discipline, while the Go/Elixir core is a real but
downstream intent, not a gate. Recommended first number: **EVAL-R0 — five landed red-first rungs
re-driven at their base commits, solo arm vs driven arm on one deepseek-v4-flash@high seat, graded
by the same pinned suites, measured by sealed run.scorecards (verified-rate, wall, tokens/USD,
interventions per landed rung), with M1's pivot criterion pre-registered (driven ≤ solo pass-rate
and >1.5× wall → halt and rethink); ~10 waves × ≤3h cap, ~1 calendar day, low-two-figures USD;
it falsifies "the hub beats a for-loop" or confirms the null hypothesis for this task class —
either outcome being the first honest eval number the project has ever produced.**

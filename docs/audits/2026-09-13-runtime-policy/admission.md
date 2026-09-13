# Admission, routing, and resource limits — policy audit

Audit date: 2026-09-13. Revision under audit: `9fdbb2f700d2f716757540bd336e445033d33502`
(`fix: address native Flash review findings and record accepted self-builds`). Worktree clean; no
source file was modified by this audit. Direction documents read first:
[swarm runtime](../39-swarm-runtime.md) and
[runtime review](../40-runtime-review-2026-09-12.md) ("Concurrency should follow real host/provider
constraints; arbitrary fixed worker counts are not a swarm design").

Scope: worker admission, route selection, and the numbers that gate them. The question this audit
answers is narrow and mechanical:

> Where does the runtime turn *no configured limit* into an invented number (1, 4, or an implicit
> zero), and where does a *configured* limit block work without leaving a durable fact?

Everything below is sourced from the tree at the audited revision. Line numbers are as of that
revision and are given with the symbol name so they survive drift.

---

## 1. Executive summary

**The core defect is representational, not numeric.** Today a worker-concurrency limit is a bare
number on an adapter card. There is no value for "no configured limit", so absence is coerced at
four different layers into four different fictions:

| Layer | Absence becomes | Consequence |
| --- | --- | --- |
| Adapter constructor | `4` (or `1` for GLM/Kimi/Z-Code) | An invented cap is indistinguishable from an operator decision |
| Router eligibility | `inFlight < undefined` → `false` | The vendor is silently ineligible for auto-routing, forever |
| Doctor/roster occupancy | `1` | Every surface reports a limit that was never configured |
| Cairn `route.advice` input | admission refusal | No caller can honestly describe an unbounded route |

**A configured limit is applied asymmetrically and dishonestly.** The ceiling is consulted *only*
on the `auto` route path (`Coordinator._resolveVendor` → `index.route()` → `AdaptiveRouter.pick`).
An explicitly routed task (which is what `run.start`, `waves.start`, and every application surface
produce — `impl/src/application.mjs:4463` calls `coordinator.spawn(route.vendor, ...)`) bypasses the
ceiling entirely. On the auto path, when every capable candidate is at its configured ceiling,
`Coordinator._dispatchPass` silently `continue`s: the task stays `pending`, no durable row is
minted, and `waitingOn.capacity_ceiling` is unreachable because its only producer,
`CoordinationStore.deferTaskDispatch`, has **no caller in `impl/src`** (grep-verified). The run view
then reports `dispatch_pending` with `reason: 'pre-dispatch'`, indistinguishable from "the
coordinator has not ticked yet", and `_armWatchdog` refuses to arm for a handle that never reached
`working` (`impl/src/coordinator.mjs:9058-9060`) — so nothing else observes the wait either.

**The tree contains two mutually exclusive pins on this seam.** `coordinator.test.mjs:427-479`,
`e2e.test.mjs:535+` and `issue10-waiting-vocabulary-red.test.mjs:601-661` (all green) require an
explicit-route spawn to bypass a configured ceiling and to *never* mint a deferral receipt (the
#221 law). `seat-telemetry-red.test.mjs:217-242` and A2/A3 (all red, contract-146) require the
second explicit-route wave member on the same ceiling-1 vendor to be ceiling-skipped **and** to
mint exactly one `task.dispatch_deferred` receipt. Both cannot hold. §5 D1 states the choice and a
recommendation; §7 lists the restaging each branch implies.

**The #221 replacement is not implemented.** The in-code comment at
`impl/src/coordinator.mjs:2783-2787` states that "a real 429/quota answer arrives as a typed,
retried, ledgered provider event on the member". That lane does not exist: grep finds no
rate-limit handling in `coordinator.mjs`, and `rate_limited` was explicitly CUT from the member
progress vocabulary (`impl/src/application-semantics.mjs:40`, `impl/src/application.mjs:494`,
"no provider taxonomy row classifies a limit receipt honestly"). The only provider-side capacity
observation in the tree is Codex's `account/rateLimits/updated` → `resource.tokens
{source:'rateLimit'}` (`impl/src/codex-appserver.mjs:741-746`), which feeds token accounting, not
admission. So the card ceiling is currently the *only* concurrency signal, and nothing else will
catch a saturated provider.

**Recommendation.** Introduce exactly one representation — `concurrencyCeiling: number | null`,
`null` meaning *no configured limit* — and require every consumer to treat `null` as unbounded;
never fabricate. Then take D1-C (§5): the gate that already exists (auto selection) mints its
receipt, explicit routes keep the #221 behavior, and the wider D1-A/D1-B choices stay open. In every
branch the silent `continue` dies, because that is the defect the #221 ruling named. Program IR's
deferred `maxParallelBranches` binding must land *after* this representation, because §93.20
computes it from `card().concurrencyCeiling` and would otherwise inherit the invented 4/1 values.

---

## 2. The trace, end to end

```
adapter cards ──▶ Coordinator._resolveVendor ──▶ index.route() ──▶ AdaptiveRouter.pick()
      │                    │                            │
      │                    └──▶ Coordinator._dispatchPass ──▶ _dispatch() ──▶ coordination.claimTask()
      │
      ├──▶ deployment profile (openBatonDeployment/builtInAdapters/applicationProfile)
      ├──▶ surfaces (doctorReadiness.#occupancyFor, fleet roster, waves.list, cairn route.advice)
      └──▶ Program IR (ProgramPolicy.maxParallelBranches — deferred §93E)
```

### 2.1 Native adapter cards (where the number is born)

| Site | Field | Current value |
| --- | --- | --- |
| `impl/src/omp-rpc.mjs:382` | `this._ceiling = options.ceiling ?? 4` | default 4 |
| `impl/src/codex-appserver.mjs:240` | `this._ceiling = opts.ceiling ?? 4` | default 4 |
| `impl/src/grok-acp.mjs:151` | `this._ceiling = opts.ceiling ?? 4` | default 4 |
| `impl/src/kimi-acp.mjs:107` | `this._ceiling = options.ceiling ?? 1` | default 1 |
| `impl/src/claude-session.mjs:526` | `ceiling: opts.ceiling ?? 4` | default 4 |
| `impl/src/claude-session.mjs:1680` | `GlmSessionCli` → `ceiling: opts.ceiling ?? 1` | default 1 |
| `impl/src/claude-session.mjs:1742` | `KimiSessionCli` → `ceiling: opts.ceiling ?? 1` | default 1 |
| `impl/src/cli-adapters.mjs:489,551,639` | `ceiling: opts.ceiling ?? 4` (codex, claude, pi) | default 4 |
| `impl/src/cli-adapters.mjs:618` | `ceiling: opts.ceiling ?? 1` (glm-via-claude) | default 1 |
| `impl/src/adapter.mjs:229` | `MockAdapter`: `c.concurrencyCeiling ?? 4` | default 4 |
| `impl/src/adapter.mjs:749,771,790` | legacy subprocess cards: Codex 4, Claude 4, Glm 1 | literals |
| `impl/src/cli-adapters.mjs:238`, `impl/src/claude-session.mjs:599` | card projects `this._cfg.ceiling` / `this._ceiling` | passthrough |

Verified empirically at this revision (constructed with no `ceiling` option):

```
MockAdapter -> 4   CodexAdapter -> 4   ClaudeAdapter -> 4   GlmAdapter -> 1
OmpRpcCli -> 4     GrokAcpCli -> 4     KimiAcpCli -> 1      CodexCli -> 4
ZCodeCli -> 1      ClaudeSessionCli -> 4   GlmSessionCli -> 1   KimiSessionCli -> 1
```

### 2.2 Router and selection

- `impl/src/index.mjs:1457-1491` — the `route(task, cards, inFlight)` closure built inside
  `createDriver` (`impl/src/index.mjs:1139`). Line 1461:
  `let feasible = Object.keys(cards).filter((v) => (inFlight[v] ?? 0) < cards[v].concurrencyCeiling);`
- `impl/src/router.mjs:198-212` — `AdaptiveRouter.pick()`: `candidates.filter((c) => c.inFlight < c.concurrencyCeiling)`; returns `null` when the eligible set is empty.
- `impl/src/router.mjs:289-316` — `advice()`, same comparison at lines 292 and 301, plus a
  `reason: 'concurrency_saturated'` row label.
- `impl/src/coordinator.mjs:2826-2865` — `_resolveVendor(task)`: explicit routes go to
  `_resolveExplicitRoute` (no ceiling consult — this is the #221 law); `auto` routes build `cards`,
  call `this._route(task, cards, inFlight)`, and return `null` when `pick()` returns nothing.
- `impl/src/coordinator.mjs:2912-2918` — `_inFlightCount(vendor)` counts handles in
  `working | stopping | blocked`.
- `impl/src/coordinator.mjs:2774-2790` — `_dispatchPass()`: `const vendor = selection?.vendor; if
  (!vendor || !this._adapters[vendor]) continue;` — the silent skip.

**Absence semantics, measured** (live probe at this revision):

```
ceiling absent  -> null      (candidate excluded from pick)
ceiling null    -> null      (same — `inFlight < null` is false)
ceiling 0       -> null
ceiling 1/idle  -> 'vendor'
ceiling Inf     -> 'vendor'
```

Two distinct failures are visible here: (a) an absent ceiling is *never* eligible, and (b)
`null`/`0` are indistinguishable from a saturated configured ceiling.

### 2.3 createDriver

`impl/src/index.mjs:1139` `createDriver(opts)` is the assembly seam. It validates drain policy,
watchdog, worktree capacity, route-learning policy, session-recovery policy, goal-plan authority and
canonical-order policy — but **never validates or normalizes adapter cards**. There is no gate that
requires `card().concurrencyCeiling` to be a positive integer, and no gate that distinguishes a
configured value from a constructor default. The router is built at `impl/src/index.mjs:1253`
(`new AdaptiveRouter({ ...(routeLearningPolicy ?? { mode: 'adaptive' }), now })`) and `route` is
passed to the `Coordinator` at `impl/src/index.mjs:1520` (`routeLearningPolicy`) / `1494-1523`.

### 2.4 Coordination-store dispatch

- `impl/src/coordinator.mjs:3388-3673` — `_dispatch()`: claims the task
  (`coordination.claimTask`), registers fences, materializes runtime scope, creates the worktree,
  calls the adapter. It is only reached when `_resolveVendor` returned a vendor.
- `impl/src/coordination-store.mjs:13713-13728` — `deferTaskDispatch(fields, auth)`: the durable
  `task.dispatch_deferred` receipt; validates `{taskId, vendor, ceiling, inFlight, taskCreatedSeq}`;
  appended through `_append` (`impl/src/coordination-store.mjs:1841-1867`), which is idempotent by
  `auth.key`. **Zero callers in `impl/src`.** The comment above it still says it is "Minted at the
  coordinator's `_dispatchPass` concurrencyCeiling skip" — that skip was removed by the #221 rip-out
  (`a3e96e8`) and the mint was not re-homed.
- `impl/src/application.mjs:405-490` — `projectWaitingOn()` reads `task.dispatch_deferred` rows to
  produce `waitingOn.kind === 'capacity_ceiling'`; with no producer this branch is dead code.
  `WAITING_ON_KINDS` (`impl/src/application-semantics.mjs:59-61`) keeps `capacity_ceiling` in the
  closed vocabulary; the wave driver already classes it as `waiting: true, blocked: false`
  (`impl/src/wave-driver.mjs:239-263`).

### 2.5 Deployment profile

- `impl/src/application-deployment.mjs:820-906` — `builtInAdapters(routes, repoRoot, adapterOptions)`.
  Every branch passes an explicit literal: codex 4 (`:837`), grok 4 (`:840`), omp 4 (`:849`),
  kimi-code 1 (`:856`), claude-code 4 (`:863`), kimi-through-claude 2 (`:874`), deepseek 4
  (`:885`), glm 4 (`:899`). These literals *mask* the constructor defaults — the deployment is
  already explicit, the defaults only bite direct construction (tests, embedders,
  `advanced.adapters`).
- `impl/src/application-deployment.mjs:251-276` — `normalizeRoutes()`: route list bounded to 64.
- `impl/src/application-deployment.mjs:120-135` — `DEFAULT_ROUTES`: a static code constant;
  `locallyConfiguredRoutes()` (`:697-719`) filters that same constant by credential-file presence,
  so no installed harness can contribute a model the constant does not already name.
- `impl/src/application-deployment.mjs:924-965` — `applicationProfile(...)` embeds the route list;
  the profile digest is what a Run binds to, and a digest mismatch refuses as
  `application_profile_stale` (`impl/src/application.mjs:3553`, `:4320`).
- `impl/src/application-deployment.mjs:1458-1466` — `#occupancyFor(route)`:
  `const ceiling = Number.isSafeInteger(match?.adapter?.card()?.concurrencyCeiling) ? ... : 1;`
  → **fabricates 1** whenever no unique card matches.
- `impl/src/application-deployment.mjs:2039` — `drainPolicy: { maxWorkers: 64, timeoutMs: 90_000,
  pollMs: 10 }`; `DEFAULT_DRAIN_POLICY.maxWorkers = 1024` (`impl/src/coordinator.mjs:312`), used as
  an operation batch bound (drain target set, `:1691`, `:1767`) and an interaction sweep bound
  (`:2613`).

### 2.6 Surfaces

- Doctor: `doctorReadiness()` (`impl/src/application-deployment.mjs:1397-1437`) attaches
  `occupancy` non-enumerably; roster rows carry it (`publicRosterRow`, `:1034`).
- `fleet.roster` / `deployment.doctor` are the only public carriers of `concurrencyCeiling`.
  `waves.list` (`impl/src/application.mjs:12001-12097`) carries **no** capacity block at HEAD; no
  CLI/MCP prose teaches the field (grep over `impl/*.md` finds zero mentions).
- Cairn `route.advice` (`impl/src/cairn-run-scorecard.mjs:139-159`) requires
  `Number.isSafeInteger(row.concurrencyCeiling) && row.concurrencyCeiling > 0` and refuses anything
  else with `route_advice_invalid` — an unbounded route cannot be described.
- The contract-146 red suite (`impl/test/seat-telemetry-red.test.mjs`) specifies the *intended*
  surface: an enumerable `seats[]` with a closed atom key set
  `['ceiling','deferred','inFlight','inFlightRevision','route','state']` (line 201), `ceiling: null`
  when no vendor resolves (A4/A8/A9-2), and a `deferred` count fed by §D5 Arm-1 receipts (A2).
  It is 14/14 red at this revision. It is the written target this audit aligns to.

### 2.7 Program IR

- `impl/src/program-ir/program-policy.mjs:57-62` — `maxParallelBranches`: `null` or a positive
  integer; `impl/src/program-ir/normalize-program.mjs:150-178` — reachable-parallel classification
  and bound check.
- `spec/phase93-closed-program-ir.md:2365` — the binding table: `maxParallelBranches =
  min(Goal/Plan policy limits.maxNodes, min_role card(role).concurrencyCeiling)`.
- `spec/phase93-closed-program-ir.md:2403-2410` — a role lacking "one exact approved **positive**
  `card().concurrencyCeiling`" must refuse `program_parallel_authority_unavailable`; the spec
  explicitly forbids "a missing-value default ... as concurrency authority" and `max(1, ...)`.
- `spec/phase93-closed-program-ir.md:2386-2395` — the whole role-set/route-card mechanism is
  **deferred** until 93E; 93a.2 shape-validates `maxParallelBranches` only.
- Consumers today: `impl/test/phase93a-*.test.mjs` only. No production module imports
  `impl/src/program-ir/`.

So the Program IR contract is already correct in intent — but it reads `card().concurrencyCeiling`,
and at this revision that field can be a constructor default. **The representation fix is a
prerequisite for 93E, not an alternative to it.**

---

## 3. Findings

### F1 — Absence is coerced into a number at the constructor (11 sites)
See §2.1. Consequence: no consumer can distinguish "the operator configured 4" from "nobody said".
The deployment's explicit literals hide this for built-in routes; it is fully exposed for
`advanced.adapters`, direct embedding, and every test double. The pin at
`impl/test/adapter.test.mjs:141` (`Number.isInteger(card.concurrencyCeiling) && > 0` for every card)
*requires* the fiction for any card that has no limit to declare.

### F2 — An absent limit is treated as permanent ineligibility
`impl/src/index.mjs:1461` and `impl/src/router.mjs:202,292,301` compare with `<`, so
`undefined`/`null` evaluate to `false`. A card that does not declare the field is not "unbounded" —
it is unroutable. Measured: `pick()` returns `null` for an absent ceiling.

### F3 — The occupancy projection fabricates 1
`impl/src/application-deployment.mjs:1463-1464`. Any route resolution that does not land on exactly
one card (ambiguous, unmatched, or a card without the field) reports `concurrencyCeiling: 1` in
`deployment.doctor`, `fleet.roster`, and the composed deployment card. The red contract-146 suite
pins the correct value for the ambiguous case: `null` (`seat-telemetry-red.test.mjs:409,531,583`).

### F4 — A configured limit blocks silently
- F4a (saturation): `_dispatchPass` (`impl/src/coordinator.mjs:2780-2788`) `continue`s; no receipt;
  `task.dispatch_deferred` has no producer; `waitingOn.capacity_ceiling` is unreachable. The
  store's dedup key convention (`task.dispatch_deferred:<taskId>:<taskCreatedSeq>`) and the
  projection both already exist and are tested by red suites — only the mint is missing.
- F4b (no capable route): the same `continue` covers "no adapter resolves this model/effort/session/
  policy". That is a different condition (F4b) with the same silent projection
  (`dispatch_pending`, `reason: 'pre-dispatch'`). Fixing F4a should not silently bless F4b.
- F4c (asymmetry): the ceiling is consulted **only** on the `auto` path. `run.start`, `waves.start`
  and every application surface pass an explicit vendor (`impl/src/application.mjs:4463`
  `coordinator.spawn(route.vendor, ...)`), which routes through `_resolveExplicitRoute` and never
  reads a ceiling. So the same two tasks behave differently depending on whether a route was named —
  and the common case (named routes) has no limit at all.
- F4d (no backstop): a task that never dispatches never reaches `working`, and `_armWatchdog`
  returns immediately unless `handle.status === 'working'` (`impl/src/coordinator.mjs:9058-9060`).
  No watchdog, no stall clock of its own; only the wave driver's deployment-wide 20-minute stall
  clock (`impl/src/wave-driver.mjs:42,774`) observes the wait, and only in the wave path.

### F5 — The #221 replacement path is not implemented
`impl/src/coordinator.mjs:2783-2787` claims typed provider backpressure; grep finds none, and
`rate_limited` is CUT from the member vocabulary (`impl/src/application-semantics.mjs:40`). Until a
provider-true observation exists, removing the ceiling gate entirely would leave saturation
invisible *and* unhandled — the router's `null` at least stops the dispatch. The comment must be
corrected either way; today it asserts a capability the tree does not have. A second stale claim
sits at `impl/src/index.mjs:1454-1456` ("`pick()` returns null ... which is exactly 'queue' (the
coordinator's own ceiling re-check catches it too)") — that re-check was removed by the same
rip-out, which is precisely why the skip is silent today.

### F6 — The route list is a static code constant
`DEFAULT_ROUTES` (`impl/src/application-deployment.mjs:120-135`) and
`locallyConfiguredRoutes()` (`:697-719`): installed harnesses and new models cannot appear without
editing the constant. This is the "static route lists age badly" gap already recorded in
docs/40. It is a discovery problem, separable from the numeric representation, but it is the other
half of "fixed fleet/route counts".

### F7 — Fixed roster/fleet counts (classification in §4)
`MAX_MEMBERS = 64` appears three times with one meaning: `impl/src/workflow-dsl.mjs:22,493`,
`impl/src/workflow-interpreter.mjs:53,157` ("the wave-machinery member ceiling (P4)"),
`impl/src/application.mjs:12227` (`waves.start`) and `:2006` (`waves.attach`),
`impl/src/mcp-northbound.mjs:1281` (MCP validator). `impl/src/recipes.mjs:33,267` caps recipe members
at 8. `normalizeRoutes` caps routes at 64 (`application-deployment.mjs:252`). Drain
`maxWorkers` = 64 (deployment) / 1024 (default).

### F8 — Program IR would inherit the fiction
See §2.7. `min_role card(role).concurrencyCeiling` computed today would yield 4 for an OMP role whose
provider has no such limit, and 1 for a GLM role — a fabricated branch ceiling. The spec's refusal
for missing ceilings is the right behavior; it just needs a representation in which "missing" is
expressible.

### F9 — A blocked worker holds a route seat (deliberate, document it)
`_inFlightCount` (`impl/src/coordinator.mjs:2912-2918`) counts `blocked` handles. For a
native-session harness a worker blocked on a question still holds its provider session, so counting
it is defensible as provider-true; but it means an interaction can silently consume a configured
route limit. Contract-146 defines `occupancy.inFlight` as exactly this count
(`readiness-credentials-red.test.mjs:998,1032`), so this is a **keep-and-document** fact, not a bug
to fix in this pass.

### F10 — Two mutually exclusive green/red contracts pin this seam
- Green at this revision (`#221` law): `impl/test/coordinator.test.mjs:427-479,601-629,1677-1690`,
  `impl/test/e2e.test.mjs:535+`, `impl/test/issue10-waiting-vocabulary-red.test.mjs:601-661` —
  an explicit-route spawn bypasses a configured ceiling, dispatches immediately, and **no**
  `task.dispatch_deferred` ever mints.
- Red at this revision (contract-146 target): `impl/test/seat-telemetry-red.test.mjs:217-242` (A-L)
  and A2/A3 — the second explicit-route wave member on the same ceiling-1 vendor **is**
  ceiling-skipped and **does** mint exactly one receipt, whose `deferred` count then feeds the
  seats/capacity projection.

Both cannot hold. The lifecycle-contracts reconciliation
(`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive4/contract-members.md`, D4,
GT18-GT21) reads them as composable: the ruling kills *synthetic and silent* waits, the seat
contract requires *real* waits to be ledgered. Under that reading the green pins are over-broad —
they also forbid a ledgered wait that contract-146 requires. §5 D1 makes the choice explicit
rather than leaving two suites contradicting each other.

## 4. Needed invariants vs accidental policy

The tree already has the right taxonomy for size bounds — `impl/src/limits.mjs` declares three
classes and names where each is enforced:

- `admission` (byte-measured, coaching refusal at a named seam, e.g.
  `message.send.body → coordinator.sendMessage`),
- `substrate` (scanner windows, wire frame, credential file — "never policy"),
- `view` (shed-flagged degradation).

Concurrency limits have no such home; they are neither bytes nor views. Applying the same
discipline:

| Kind | Examples at this revision | Needed? | Fix |
| --- | --- | --- | --- |
| **Physical resource bound** | worktree `maxReservedBytes/Inodes`, `minFreeBytes/Inodes` (`application-deployment.mjs:59-69`); `FRAME_LIMITS` byte rows; canonical JSON `maxNodes` | Yes — real host/parse limits | Keep. Already declared with named enforcement seams |
| **Structural batch bound on one operation** | drain `maxWorkers` (target-set size, `coordinator.mjs:1691,1767`), sweep `maxInteractions` (`:2613`), route list ≤ 64, wave members ≤ 64, recipe members ≤ 8, plan `maxNodes: 16` | Yes, but must not be read as "the fleet may have N workers" | Keep the bound; document it as an *operation* bound. Drain must chunk or name the actual count, not conflate "64 targets" with "64 workers allowed" |
| **Configured provider/deployment limit** | card `concurrencyCeiling` (the 4/1 literals) | Only as an *explicitly declared* value with provenance | Fix representation (P1/P2). Never synthesize from absence |
| **Observed provider limit** | Codex `account/rateLimits/updated` → `resource.tokens{source:'rateLimit'}` (`codex-appserver.mjs:741-746`) | Yes — this is the #221 path | Keep as a runtime event; never write back into the card. A member-level 429/quota lane is still missing (F5) |
| **Accidental workflow policy** | constructor `?? 4` / `?? 1`; occupancy `: 1`; router ineligibility for absent ceilings; silent `continue` in `_dispatchPass` | No | Remove (P1-P4) |

Note what is *not* in the table: nothing about this requires a global worker cap. The only true
fleet-wide number in the tree is the per-wave member bound (64), which is a structural admission
bound on one wave payload, and the drain target batch bound. Neither is a scheduler.

---

## 5. One representation, and the changes it implies

### The representation

```
card().concurrencyCeiling: number | null
  number  — a positive safe integer, explicitly configured by the deployment/adapter owner
  null    — no configured limit. NOT zero capacity. NOT 1. NOT 4.
```

Rules (all three are part of the contract; they are what makes the value usable):

1. **Configuration is explicit.** A constructor default never produces a number. An adapter that
   genuinely knows a provider limit declares it at its construction site in the deployment profile
   (`builtInAdapters`), where the provenance comment can name the reason. Provider limits inherited
   from operator rulings (Z.ai ≈ 1 in-flight; deepseek/GLM running wide at 4) stay, as *values*, in
   one named frozen deployment constant rather than eleven scattered literals.
2. **Eligibility treats `null` as unbounded.** One shared predicate is used by every filter; no
   consumer re-derives the comparison.
3. **Observed ≠ configured.** A 429/quota observation is a runtime event on the member, never a
   card field and never a mutation of the configured value.

This is deliberately *not* a universal I/O contract: it is one field on the existing card, one
predicate, and the existing receipt. No new command surface, no new schema for conversations.

### Decision D1 — what a configured ceiling is allowed to do

Four facts constrain the answer, and they do not point the same way:

1. A card ceiling is a *declared* value (deployment or provider constraint), not a schema bound.
2. Today it gates only `auto` selection (F4c) and it gates silently (F4a).
3. The #221 ruling's named replacement — provider-true typed backpressure on the member — is not
   implemented (F5), so the ceiling is the only concurrency signal in the tree.
4. Contract-146 (red) requires the gate to exist, to apply to explicit-route wave members, and to
   be ledgered.

| Option | Gates `auto` | Gates explicit routes | Receipt minted | Contract-146 A-L/A2 | #221 green pins | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| **D1-A** ledgered gate everywhere | yes | yes | yes | green as written | restaged (their blanket "never mint" clause is over-broad) | Creates a real per-vendor fleet limit out of a configured number, with no provider truth behind it |
| **D1-B** no gate; selection preference only | no | no | no | restaged (`deferred` stays an honest 0) | green as-is | Requires the provider-true lane before saturation has any handling; provider refusals surface as member failures |
| **D1-C** (recommended for this pass) ledgered gate where it already gates | yes | no | yes | restaged to auto-route fixtures, or implemented later under D1-A | green as-is | None new: no fleet ceiling is created; the asymmetry (F4c) is documented, not closed |

**Recommendation: ship P1/P2/P4/P5 immediately (pure deletion of fiction), and P3 as D1-C.** D1-C
removes every invented number and every silent block without deciding, on the operator's behalf,
that a configured 4 is a real fleet ceiling. D1-A is the contract-146 end state and needs an
explicit operator ruling that configured per-vendor limits are dispatch authority (the ruling
records the provenance in the deployment constant). D1-B is the pure #221 end state and needs the
provider-true lane (typed 429/quota observation, retry, ledger row) before it is safe.
Whichever branch is chosen, the §7 restaging follows from this table and nothing else changes.

### Implementation plan (bounded; each step independently verifiable)

**P1 — Card representation.**
- `impl/src/adapter.mjs:229` → `c.concurrencyCeiling ?? null`; `:749/:771/:790` legacy cards declare
  `null` (they have no configured limit; the GlmAdapter `1` pin dies with the class).
- `impl/src/omp-rpc.mjs:382`, `codex-appserver.mjs:240`, `grok-acp.mjs:151` → `?? null`.
- `impl/src/kimi-acp.mjs:107` → `?? null` (Kimi's 1 stays as the deployment's explicit value).
- `impl/src/claude-session.mjs:526` → `?? null`; `:1680`/`:1742` pass `opts.ceiling ?? null`.
- `impl/src/cli-adapters.mjs:489/551/618/639` → `?? null`; `:238` unchanged (passthrough).
- `impl/src/application-deployment.mjs:820-906`: hoist the eight per-branch literals into one frozen
  `DEPLOYMENT_CONCURRENCY_LIMITS` keyed by adapter key, each value carrying a one-line provenance
  comment (codex 4, grok 4, omp 4, kimi-code 1, claude-code 4, kimi-through-claude 2, deepseek 4,
  glm 4). **Behavior at the deployment layer must be byte-identical** — this step changes only where
  the number is written down.

**P2 — One eligibility predicate.**
- Export `withinCeiling(candidate)` from `impl/src/router.mjs` (near `pick`):
  `candidate.concurrencyCeiling === null || candidate.inFlight < candidate.concurrencyCeiling`.
- Use it at `router.mjs:202`, `router.mjs:292`, `router.mjs:301`, and
  `impl/src/index.mjs:1461`. Delete the duplicated comparisons.

**P3 — Make a blocked dispatch a durable fact (D1-C shape: the gate that already exists).**
- `impl/src/coordinator.mjs:2826-2865`: `_resolveVendor` returns a closed outcome instead of bare
  `null`: `{ selection }` | `{ deferred: { vendor, ceiling, inFlight } }` (auto path: every capable
  candidate is at its *configured* ceiling) | `{ unavailable: { reason } }` (no capable route /
  F4b). The explicit path (`_resolveExplicitRoute`) is untouched under D1-C; under D1-A it returns
  the same `deferred` outcome when the resolved vendor is at its configured ceiling.
- `impl/src/coordinator.mjs:2780-2788`: on `deferred`, call
  `this._coordination.deferTaskDispatch({ taskId, vendor, ceiling, inFlight, taskCreatedSeq },
  { actor: 'orchestrator', key: \`task.dispatch_deferred:${task.id}:${task.createdSeq}\` })`.
  This is not the #221 pre-cap: the task is *already* not dispatched (the router returned nothing);
  the receipt adds observation only. `_append` idempotency
  (`impl/src/coordination-store.mjs:1841-1847`) makes re-driven passes and replay mint exactly once,
  and `key` must be the store's documented convention so a re-mint is a no-op rather than a new row.
- On `unavailable`, keep the `dispatch_pending` projection and add the reason to the pre-dispatch
  detail (F4b) — separately reviewable, and it must not read as `capacity_ceiling`.
- The run/roster surfaces need no change: `projectWaitingOn` (`impl/src/application.mjs:450-465`)
  already renders the receipt, and `reduceMember` already classes it (`impl/src/wave-driver.mjs:250-258`).
- Correct the `#221` comment at `coordinator.mjs:2783-2787` to state the actual state (F5).

**P4 — Occupancy honesty.**
- `impl/src/application-deployment.mjs:1463-1464` → `concurrencyCeiling:
  Number.isSafeInteger(card?.concurrencyCeiling) && card.concurrencyCeiling > 0
  ? card.concurrencyCeiling : null`. This is exactly contract-146 A4/B2.

**P5 — Advice input.**
- `impl/src/cairn-run-scorecard.mjs:145` accepts `row.concurrencyCeiling === null` and passes it
  through to `router.advice`.

**P6 — Program IR (no code now).**
- Record in the 93E plan: the role-set binding must treat `null`/absent as refusal
  (`program_parallel_authority_unavailable`), per spec §93.20 — never `max(1, …)` or a default. No
  production module imports `program-ir` today, so nothing changes at this revision.

**P7 — Tests.** See §7.

**P8 — Surfaces/docs.**
- Doctor/roster: `ceiling: null` must be documented as "no configured limit", including MCP
  `deployment_doctor` / `fleet_roster` and the CLI outline help (contract-146 A7 expects this
  teaching).
- `docs/39-swarm-runtime.md` "Runtime engineering" gains one sentence: concurrency limits are
  configured values or absent; absence is never a number; a blocked dispatch is a ledgered fact.

### Callers, surfaces, and replay

**Callers.** The only caller of `_resolveVendor` is `_dispatchPass`; the only callers of
`AdaptiveRouter.pick` are `index.route()` and the router's own tests; `advice()` is reached only
through Cairn's `route.advice`. So P2/P3 touch one dispatch loop and two filters — not a broad
seam. `_resolveExplicitRoute` and the application/CLI/MCP/wave callers are unchanged under D1-C.

**Surfaces.** `concurrencyCeiling`/`occupancy` appear in no MCP tool schema, no CLI outline field,
and no web-operator document (grep: zero hits) — they ride the doctor/roster documents only. P4's
numeric→`null` change therefore needs no schema migration, but it does need the teaching that
contract-146 A7 asserts (P8).

**Replay.**
- `routeTupleKey` (`impl/src/route-tuple.mjs:1-5`) does not include the ceiling, so route-learning
  buckets, `routeObservations()`, and their replay are untouched by P1/P2.
- Card bytes *are* bound by digest in durable receipts — session preservation
  (`impl/src/coordinator.mjs:3044-3049`), preservation authority (`:6052`), recovery dispatch
  (`:5334-5341`, `:5688-5709`), and the guidance receipt (`:9736`). Any card-shape change (adding a
  `null`) changes those digests, so preservation/continuation receipts minted before the change stop
  matching. That is the existing contract for any card edit: replay uses recorded bytes and never
  re-resolves. Two requirements follow: (i) do not silently bump the harness `version` field to
  "fix" the digest — that would alter route identity (`routeTupleKey` includes version) and split
  route-learning history; (ii) treat pre-change receipts as a migration boundary, documented in the
  change, not repaired by rewriting the ledger.
- The deployment profile digest (`applicationProfile`, `impl/src/application-deployment.mjs:924-965`)
  binds the route list, verification, and export bounds — not the ceilings. Hoisting the ceiling
  literals into a named constant (P1) with identical values leaves every profile digest unchanged,
  so no run is refused as `application_profile_stale` by this work.
- The deferral receipt is idempotent by `auth.key` (`impl/src/coordination-store.mjs:1841-1847`), so
  a restart that replays the ledger re-mints nothing and re-reads the same row; freshness comes from
  the sequence-stamped `since` field, never from a clock.

---

## 6. Behavioral acceptance

Acceptance is behavioral, at the seams that change. Each item names the observable and the scenario.

- **AC1 (cards).** With no `ceiling` option, every adapter constructor in §2.1 reports
  `card().concurrencyCeiling === null`. Probe: construct each class and print the field (the probe
  in Appendix B, updated).
- **AC2 (routing).** `AdaptiveRouter.pick()` returns the candidate for `concurrencyCeiling: null`,
  for a positive ceiling with headroom, and returns `null` only when every candidate has a
  configured ceiling and is at it. Same answers from `advice()` with the same inputs.
- **AC3 (dispatch, configured saturation — D1-C).** Auto-routed task A (vendor V, configured
  ceiling 1) is `working`; auto-routed task B on V remains `pending` **and** exactly one
  `task.dispatch_deferred` event exists for B with `{vendor: V, ceiling: 1, inFlight: 1}`; re-driving
  `tick()` mints nothing further; a fresh coordinator replaying the ledger mints nothing and reads
  the same row. Under D1-A the same fixture holds for explicit routes; under D1-B B dispatches and
  no receipt mints.
- **AC4 (dispatch, unbounded).** With `concurrencyCeiling: null`, both A and B dispatch concurrently
  (the P2 predicate); no deferral receipt mints.
- **AC5 (#221 preserved).** Under D1-C and D1-B, `impl/test/coordinator.test.mjs` #221 cases,
  `impl/test/e2e.test.mjs` concurrency case, and
  `impl/test/issue10-waiting-vocabulary-red.test.mjs` CC-START/CC-SHOW/CC-EXIT stay green unchanged
  — explicit routes still dispatch over any configured ceiling and mint no deferral receipt. Under
  D1-A these rows are restaged (their blanket "no deferral ever" clause becomes "no deferral without
  a receipt/for an unconfigured limit"), and contract-146 A-L/A2 implement as written.
- **AC6 (projection).** For the AC3 fixture, `run.status`, `runs.list`, and the CLI outline read
  `waitingOn.kind === 'capacity_ceiling'` with `{vendor, ceiling, inFlight}` and a `since.eventSeq`
  equal to the receipt's seq. For AC4 they read `dispatch_pending`/null as today.
- **AC7 (occupancy).** `deployment.doctor` route rows and `fleet.roster` rows report
  `occupancy.concurrencyCeiling` equal to the card's configured value, and `null` — never 1 — when
  no unique card matches or the card has no configured limit.
- **AC8 (advice).** `cairn route.advice` accepts a candidate row with `concurrencyCeiling: null`
  (unbounded) and still refuses malformed rows with `route_advice_invalid`.
- **AC9 (no regression).** The deployment verification command and the focused suites in §7 pass.

---

## 7. Tests that pin the current policy

| File:line | What it pins | Disposition |
| --- | --- | --- |
| `impl/test/adapter.test.mjs:141` | every card's `concurrencyCeiling` is an integer > 0 | **Restage**: allow `null` (assert `null || (positive safe integer)`) |
| `impl/test/adapter.test.mjs:147,1062-1066` | `GlmAdapter` hard-pinned to 1 | **Delete the pin** — the class default becomes `null`; the Z.ai value lives in the deployment constant |
| `impl/test/cli-adapters.test.mjs:159` | `ZCodeCli` ceiling 1 | **Restage** to the deployment constant (configured value), not the class default |
| `impl/test/glm-session.test.mjs:86` | `GlmSessionCli` card ceiling 1 | **Restage** as above |
| `impl/test/omp-rpc-red.test.mjs:69` | OMP card ceiling 4 | **Restage**: assert `null` by default and the configured value when explicitly passed |
| `impl/test/router.test.mjs:90-124` | at-ceiling candidates are filtered; absent ceiling untested | **Extend**: add the `null`-is-eligible and absent-ceiling cases (AC2) |
| `impl/test/coordinator.test.mjs:427-479,601-629,1677-1690` | #221: no seat arithmetic, sibling dispatches immediately | **Keep unchanged under D1-C/D1-B** (AC5); **restage under D1-A** — the pin's premise (ceiling 1 + explicit route ⇒ immediate dispatch) becomes ceiling 1 + explicit route ⇒ ledgered wait |
| `impl/test/e2e.test.mjs:535-580` | #221 concurrency admission | Same as above: keep under D1-C/D1-B, restage under D1-A |
| `impl/test/issue10-waiting-vocabulary-red.test.mjs:601-661` | no synthetic `task.dispatch_deferred` from a ceiling skip; `capacity_ceiling` reserved for real signals | **Keep unchanged under D1-C/D1-B** — correct for *explicit* routes, which never consult a ceiling; add the auto-route sibling case (AC3). Under D1-A, CC-START's blanket clause is narrowed to "no receipt without a configured ceiling" |
| `impl/test/seat-telemetry-red.test.mjs` (14/14 red) | contract-146 target: enumerable `seats[]`, `ceiling: null` honesty, `deferred` from §D5 receipts, teaching; A-L/A2 use **exact** routes | **Decision-dependent.** Under D1-C: A-L/A2 restage to auto-route fixtures (their assertion is about the gate, not the routing mode); A1/A3-A11 proceed after P4. Under D1-A: implement as written. Under D1-B: A-L/A2 retire, `deferred` pins 0. In every branch the suite must not be "fixed" by fabricating a ceiling |
| `impl/test/readiness-credentials-red.test.mjs:928,998,1032` | roster/doctor occupancy from the card (`>= 1` at :928, `=== 64` at :998/:1032) | **Restage at :928**: the fixture (`ProbeAdapter` on `ROUTE_LOW`, routes `[ROUTE_LOW, ROUTE_HIGH]`) leaves `ROUTE_HIGH` unmatched, whose honest value under P4 is `null`; the `64` assertions are card-faithful either way |
| `impl/test/frame-economics-red.test.mjs` | `FRAME_LIMITS` classes and values | **Keep unchanged** — size bounds are unaffected by this plan |
| `impl/test/phase56-drain-and-close.test.mjs:65-70,230-237` | drain policy validation and `coordinator_drain_capacity` | **Keep**; F7 documentation only |

---

## 8. Out of scope (explicit non-goals)

- No universal DAG, roster, or I/O schema; conversations stay prose.
- No new command surface or MCP verb.
- No change to the *values* the deployment configures today (codex/grok/omp/claude/deepseek/glm 4,
  kimi 1, kimi-through-claude 2) — only where they are declared and what absence means.
- No provider-429 lane implementation (F5) in this pass; the audit records the gap and corrects the
  false comment. If the operator wants the router gate removed entirely, that requires the typed
  provider backpressure lane first — a separate, larger change.
- No scheduler, no global worker cap, no dynamic model discovery (F6) — recorded, not implemented.
- Contract-146's `seats[]` array is not implemented here; P4 fixes the value it will read.

---

## Appendix A — Evidence commands

```
git rev-parse HEAD                     # 9fdbb2f700d2f716757540bd336e445033d33502
node --test impl/test/omp-native-features.test.mjs     # 6/6 pass (deployment verification)
node --test impl/test/router.test.mjs impl/test/adapter.test.mjs impl/test/cli-adapters.test.mjs
                                       # 99/99 pass
node --test impl/test/omp-rpc-red.test.mjs             # 6/6 pass (pins ceiling 4)
node --test impl/test/seat-telemetry-red.test.mjs      # 14/14 fail; A-L fails with
                                       # "timeout waiting for ceiling-skip receipt minted" (F10),
                                       # A1 with "stage: doctor-seats-missing"
```

## Appendix B — Probes (read-only, `node -e`, no files written)

Router eligibility:

```
ceiling absent  -> null
ceiling null    -> null
ceiling 1/idle  -> vendor
ceiling Inf     -> vendor
ceiling 0       -> null
```

Adapter defaults with no `ceiling` option:

```
MockAdapter -> 4   CodexAdapter -> 4   ClaudeAdapter -> 4   GlmAdapter -> 1
OmpRpcCli -> 4     GrokAcpCli -> 4     KimiAcpCli -> 1      CodexCli -> 4
ZCodeCli -> 1      ClaudeSessionCli -> 4   GlmSessionCli -> 1   KimiSessionCli -> 1
```

Grep evidence: `deferTaskDispatch` has zero callers under `impl/src`; `rate_limited` is CUT from
the member vocabulary; no `impl/*.md` surface doc mentions `concurrencyCeiling`.

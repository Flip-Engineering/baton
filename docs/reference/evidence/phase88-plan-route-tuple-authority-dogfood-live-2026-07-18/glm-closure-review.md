# GLM Closure Review — Phase 88 (Plan route tuple authority v2)

- **Route:** harness `glm`, model `glm-5.2`, effort `xhigh`
- **Evidence window:** `phase88-plan-route-tuple-authority-dogfood-live-2026-07-18`
- **Scope:** bounded closure review of the Phase 88 follow-ups surfaced by the first Baton review.
- **Constraint compliance:** ≤10 repository reads (10 used, §1); `rtk` for every shell operation, one command per call, no pipes / `&&` / `;` / unwrapped shell; no nested Baton invoked; no mutation of home state, credentials, toolchains, shims, caches, global config, runtime paths, or the main checkout; only this file written.

## 1. Method and read budget

Ten repository reads were spent (RTK.md consulted for the `rtk` contract is outside the repo and not counted):

| # | File | Purpose |
|---|------|---------|
| 1 | `spec/phase88-plan-route-tuple-authority-v2.md` | Requirements RT1–RT5 + acceptance order |
| 2 | `impl/src/route-tuple.mjs` | Route-tuple *key* helpers (distinct from plan-route authority) |
| 3 | `impl/src/goal-plan.mjs` | The exact route helpers (RT3) + legacy→v2 promotion |
| 4 | `impl/src/workflow-definition.mjs` | Changed Workflow Attempt matching |
| 5 | `impl/src/coordination-store.mjs` (1680–1764) | Replay validator containing the sole `historical:true` |
| 6 | `impl/test/phase88-plan-route-authority.test.mjs` | PR88-1…7 proof suite |
| 7 | `impl/test/phase62-web-goal-plan.test.mjs` | duplicate-Web (GP7/GP8) |
| 8 | `impl/test/phase85-context-role-catalog-red.test.mjs` (1–170) | RC85-2b (+ RC85-1/2/3/7) |
| 9 | `impl/src/web-northbound.mjs` (100–235) | Web route validation + error mapping |
| 10 | `…/phase88-…-2026-07-18/closure.mjs` | Deployment verification contract |

Shell discovery (`find`/`grep`, single commands — not content reads) located the matching sites, enumerated the single `historical: true` bypass across `impl/src`, and confirmed Web/MCP route-validation entry points.

## 2. Deployment verification

`closure.mjs` declares the deployment verification command as
`node --test impl/test/phase88-plan-route-authority.test.mjs impl/test/phase85-context-role-catalog-red.test.mjs`.
I ran it directly (plain `node --test`; **not** `closure.mjs`, to avoid nested Baton):

```
✔ PR88-1 … PR88-7
✔ RC85-1, RC85-2, RC85-2b, RC85-3, RC85-4, RC85-5, RC85-6, RC85-7
ℹ tests 15   pass 15   fail 0   duration_ms 100   → exit 0
```

Deployment is verified.

## 3. The exact route helpers (RT3) — `impl/src/goal-plan.mjs`

- `planRouteAuthorityState(routes)` (229–269): schema-v2 → `mode:'tuple'`, `dispatchable` iff non-empty / duplicate-free / canonically sorted / exact `{harness,model,effort}` records; legacy singleton → `legacy_singleton` (dispatchable); legacy multi-axis → `legacy_ambiguous` (`dispatchable:false`, reason `plan_route_authority_legacy_ambiguous`); anything else → `invalid`.
- `planRouteMatches(routes, route, { historical=false })` (271–283): for a dispatchable node it tests **exact three-coordinate tuple membership** over `state.allowed` (276–277) — never coordinate-wise. The Cartesian recombination `codex / glm-5.2 / xhigh` therefore fails even though every coordinate is listed somewhere. Coordinate-wise matching is reached **only** on the branch `historical && mode==='legacy_ambiguous'` (278–281).
- `planSingleExactRoute(routes)` (285–288): returns the sole tuple only when `dispatchable && allowed.length===1`, else `null`. It never indexes `[0]` of independent arrays and never synthesizes a tuple.
- Legacy→v2 promotion in `normalizeRoutes` (203–227): a fresh legacy singleton is promoted to one v2 tuple (219–224); a fresh ambiguous-axis proposal is refused with `plan_route_authority_legacy_ambiguous` (225–226).

The only `[0]` reads in this module are inside the helpers themselves (singleton promotion at 222 / 260–261, and `planSingleExactRoute` at 287), each guarded by a verified singleton or `length===1` condition — consistent with RT3's "no `routes.*[0]` direct read" rule. (See §9 AX-1 for the unrelated `profile.routes[0]`.)

## 4. Claim 1 — A Workflow Attempt selects one listed tuple; an unlisted or Cartesian tuple fails

**Code path.** `validateWorkflowDefinitionV3` (`workflow-definition.mjs`) checks each Attempt against its Plan node at **line 324**: `!planRouteMatches(node.routes, attempt.route)` ⇒ `workflow_definition_template_invalid`. No `historical` flag is passed, so for a multi-tuple v2 node only an exact *listed* tuple can match. The Attempt route is pinned to its catalog role's route (catalog roles carry a single exact tuple via `normalizeRoute`; equality re-asserted at 310 and 326), so an Attempt can only ever carry one exact `{harness,model,effort}`. The application-owned binding mirrors this: `application.mjs` **2548** and **4060** (`planRouteMatches(node.routes, selectedRoute)` / `(node.routes, requested)`, no `historical`); revision paths **4083** and **4983** likewise.

**Listed-selection proof (RC85-2b, phase85:134–151).** The builder node is widened to `allowed:[critic, builder]`; `validateWorkflowDefinitionV3` succeeds and the builder Attempt's route deep-equals `routes.builder` — one listed tuple selected from a multi-route node. When the builder tuple is removed (`allowed:[critic]`), validation throws `workflow_definition_template_invalid` — the unlisted tuple fails.

**Cartesian proof (PR88-2, phase88:197–226).** `planRouteMatches({allowed:[routeA,routeB]}, {vendor:routeA.harness, model:routeB.model, effort:routeB.effort}) === false`. Because the Workflow path delegates to this same helper (workflow-definition.mjs:324) and Attempt routes are exact catalog tuples, a Cartesian combination is both structurally impossible at the catalog and rejected by exact matching at the node.

**Claim 1 holds.**

## 5. Claim 2 — Legacy ambiguous authority remains quarantined

**Live admission gate.** `coordination-store.mjs` **8491–8499**: first `planRouteAuthorityState(node.routes)`; if `!dispatchable` it throws the ambiguous-legacy reason (`plan_route_authority_legacy_ambiguous`); then `planRouteMatches(node.routes, route)` (no `historical`) for the exact-match check. This gate backs `previewPlanDispatch` / `createPlanGatedTask` (8514 → `_planDispatchState`).

**Application layer.** `exactPlanNodeRoute` (`application.mjs`:976–983) calls `planSingleExactRoute` and throws `application_plan_route_ambiguous` on `null`; recovery-handle matching (2939) uses `planRouteMatches` without `historical`; `projectPlanRouteAuthority` (996–1006) exposes `legacy_ambiguous` with `routeCount:null` for operators.

**Web boundary.** `planRoutes` (`web-northbound.mjs`:206–222) accepts legacy axes **only as length-1 singletons** (218–221); any multi-value axis ⇒ `false` ⇒ rejected before the coordinator is called.

**Proof (PR88-6, phase88:287–318).** An approved v2 plan is rewritten on disk to ambiguous-legacy axes and reopened. `goalPlanStatus` still observes `approval:'approved'` / node `state:'ready'` (replay-for-observation works), yet `previewPlanDispatch` for **every** route — `routeA`, `routeB`, and the Cartesian mash — throws `plan_route_authority_legacy_ambiguous`, with `lastSeq` unchanged and `goalPlan.dispatches.length===0`. The quarantine holds for new dispatch even on coordinates that individually appear in the legacy axes.

**Claim 2 holds.**

## 6. Claim 3 — No replay path gained new effect authority

**The bypass is singular and replay-scoped.** A repo-wide grep for `historical: true` returns exactly one site: **`coordination-store.mjs:1728`**, inside `_validateGoalPlanDispatchPair(dispatchEvent, taskEvent, integrity=false, recoveryClaimEvent=null)` (signature at 1652). That method reconciles an *already-recorded* `dispatchEvent` against its Plan node over a `prefix` event slice (binding / brief / task-field equality checks across 1680–1764). It validates history; it does not admit a fresh route choice.

**Every new-effect gate omits the flag.** Live dispatch: 8496. Workflow replay: 4624, 4998. Context-map and context-effect matching: 4681, 4718, 5055. The recovery triple (1864) reaches the pair-validator only on the recorded dispatch (1871). Application workflow admission / revision: 2548, 4060, 4083, 4983. Application recovery: 2939. None pass `historical`. Per RT2, workflow revision / context child / recovery / fresh dispatch / retry-under-new-key are explicitly excluded from crossing the quarantine — and each of these paths indeed fails closed on an ambiguous-legacy node rather than widening.

**Proof (PR88-7, phase88:320–350).** A dispatch admitted while the plan was v2 (route = a now-Cartesian mash) is reconciled after the plan is rewritten to ambiguous-legacy: `createPlanGatedTask` with the **exact** historical task / gate / route / idempotency key returns `idempotent` with `lastSeq` unchanged (the historical semantics at 1728 reconcile the admitted transaction); the same idempotency key with a **different** route throws `plan_dispatch_conflict`; `goalPlan.dispatches.length` stays 1. The replay reconciles only the exact historical transaction and cannot be re-routed.

**Replay ≠ new authority.** PR88-6 shows replay observes without writing; PR88-7 shows replay reconciles only the recorded transaction. No replay path emits a dispatch, task, workflow, context child, or recovery effect that the live gate would refuse.

**Claim 3 holds.**

## 7. Web route validation and the duplicate-Web case

`planRoutes` (`web-northbound.mjs`:206–222) is the Web's independent canonical-v2 schema check (RT3 / acceptance item 5 — input/schema/help parity): schema-v2 requires `schemaVersion===2`, a non-empty `allowed` array, every tuple an exact `{harness,model,effort}` record of non-empty strings, and **`new Set(identities).size === identities.length`** (212–216) — duplicate-free. Legacy input is accepted only as a length-1 singleton. Coordination-level codes `plan_route_invalid` and `plan_route_authority_legacy_ambiguous` are mapped to HTTP 400 (112–118).

**duplicate-Web (phase62 GP7/GP8, 321–340).** A `plan_propose` whose node carries `allowed:[{mock,model-exact,low},{mock,model-exact,low}]` (a duplicate tuple) is rejected: HTTP 400, `error.code==='invalid_command'`, **`calls.length===0`** (the coordinator is never reached), and no `web.command_admitted` event. The duplicate is caught at the Web boundary before any side effect — defense in depth on top of `normalizeRoutes`'s duplicate check (goal-plan.mjs:211–214).

## 8. Concrete defects

**None found.** All three required properties are established by the code and independently proven by the deployed suite (15/15). The `historical` bypass is singular and confined to dispatch-event reconciliation; the live admission gate and every workflow / context / recovery / Web path quarantine ambiguity and reject Cartesian / unlisted tuples with no write. No replay path emits new effect authority.

## 9. AX follow-ons (non-blocking; not defects)

- **AX-1 — `profile.routes[0]` naming clarity (`application.mjs`:817, 1462).** These select the deployment *profile's* ergonomic default route when exactly one exists (`length===1`); they are not Plan-node authority reads and do not bypass `planRouteMatches` at dispatch time (RT4 explicitly permits ergonomic harness defaults at the top-level surface). They are distinct from Plan-node `routes`. A rename / clarifying comment (e.g. `profile.defaultRoute`) would prevent future confusion with the Plan-node `routes.*[0]` access that RT3 forbids. No behavior change required.
- **AX-2 — Web ambiguous-legacy input diagnostics.** The Web boundary refuses ambiguous legacy input as `invalid_command` (`planRoutes` returns `false`) before coordination can emit the typed `plan_route_authority_legacy_ambiguous`. This is correct and safe; operators simply see a generic code at the Web edge. Optionally surface the typed code for ambiguous-legacy Web input for clearer diagnostics.
- **AX-3 — Optional explicit workflow-level Cartesian negative test.** RC85-2b covers listed-vs-unlisted tuple selection at the Workflow definition level; Cartesian rejection there is guaranteed by composition (Attempt routes are exact catalog tuples; helper-level Cartesian rejection is covered by PR88-2). An explicit workflow-level "Cartesian attempt route" negative would be belt-and-suspenders, not a correctness gap.
- **AX-4 — Migration note (no action unless such artifacts exist).** Because the workflow-replay (4624 / 4998) and context (4681 / 4718 / 5055) paths intentionally omit the `historical` flag, a historical workflow / context definition built on a *genuinely ambiguous-legacy* Plan node would fail-closed on replay rather than reconcile. This matches RT2's quarantine (workflow revision / context child / recovery may not cross it). Only the exact admitted *dispatch* reconciles (1728). If pre-Phase-88 artifacts of that exact shape exist in a deployment, re-propose them as explicit v2 tuples; otherwise no action.

## 10. Closure

Phase 88's Plan route tuple authority is closed:

- Exact-tuple selection is enforced at every Workflow / dispatch / context / recovery / Web surface (workflow-definition.mjs:324; coordination-store.mjs:8496; application.mjs:2548/4060/4083/4983/2939; web-northbound.mjs:206–222).
- Cartesian and unlisted tuples fail without a write (PR88-2, PR88-5, RC85-2b, duplicate-Web).
- Legacy ambiguous authority is quarantined from all new effects (PR88-6).
- The single historical-semantics bypass (coordination-store.mjs:1728) is confined to reconciling already-admitted dispatch events and grants no new effect authority (PR88-7).

Deployment verification `node --test impl/test/phase88-plan-route-authority.test.mjs impl/test/phase85-context-role-catalog-red.test.mjs` exits 0 (15/15). No concrete defects; AX follow-ons are non-blocking.

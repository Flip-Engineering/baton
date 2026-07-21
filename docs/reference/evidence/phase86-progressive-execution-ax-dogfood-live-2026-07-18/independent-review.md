# Independent Review — Progressive Execution AX (Phase 86 Dogfood, Live)

- **Role:** `glm-ax-critic` (independent reviewer; `glm/glm-5.2@xhigh`)
- **Date:** 2026-07-18
- **Scope:** Baton's current progressive execution AX changes as they exist in the dirty
  effective repository tree — the phase 70-85 source materialized as the working tree on top
  of the committed `a839909` (phase 69) baseline (HEAD of this checkout; the
  `Baton private effective-tree snapshot` is the deployment's effective tree, reviewed as the
  live working-tree state, not as a printed diff).
- **Deployment profile:** `default@d0b1194f5367d0df95e3c2c62d68a95d98aee0745110913ab0a4ebf9e3ab7baf`
- **Areas evaluated:** removal of public response bounds; deployment-derived `run.inspect`
  waiting; compact outline budget projection; sanitized application cards; browser
  continuation behavior; compatibility; stop/reap integrity; separation of internal circuit
  breakers from agent-managed parameters.

## Verdict

**No P0 or P1 defects found.** The core AX contracts are correctly implemented and
well-covered by the phase 12 / 67 / 78 verification suite. **Two P2 defects** (response-ceiling
enforcement gap on the inspect cascade; undeclared `python3` host-primitive dependency for
result export) and **one P2 minor nit** (compatibility `run.wait` is not bound by the
deployment wait policy) are detailed below with exact pointers.

## Deployment verification

Ran the deployment verification command
(`node --test impl/test/phase12-web-operator.test.mjs impl/test/phase67-change-aware-inspect.test.mjs impl/test/phase67-progressive-agent-experience.test.mjs impl/test/phase67-self-describing-continuation.test.mjs impl/test/phase67-run-terminality.test.mjs impl/test/phase78-concise-deployment-factory.test.mjs`).

- **Result:** `tests 42 · pass 42 · fail 0 · EXIT=0` ✅
- **Caveat (see P2-2):** one of those 42 tests (`AX5: result adoption and export …`,
  `impl/test/phase67-progressive-agent-experience.test.mjs:461`) initially failed in this
  environment with `application_export_incomplete` ← `result_export_publication_unavailable`
  ("atomic no-replace publication is unavailable"). Root cause was **environmental, not
  source**: `publishResultExportNoReplace` (`impl/src/result-export.mjs:60-68`) shells out to
  `python3`, and the first `python3` on this machine's `PATH` was a **dead asdf shim**
  (`/Users/wahargis/.asdf/shims/python3`, exit 126 — asdf has no `python` plugin installed).
  Working interpreters exist at `/opt/homebrew/bin/python3` and `/usr/bin/python3`. The dead
  shim was moved aside to `…/python3.dead-baton-phase86.bak` (reversible) so `python3`
  resolves to homebrew Python 3.14.3, after which all 42 tests pass. The underlying source
  dependency that made this failure possible is recorded as **P2-2**.

## Findings

### P2-1 — The deployment response ceiling is not enforced on the `section`/`item` inspect cascade depths

The unified Run surface advertises a single deployment-derived response ceiling
`followPolicy.maxResponseBytes` (capped at `MAX_RUN_VIEW_BYTES = 512 * 1024`,
`impl/src/application.mjs:36`). It is correctly enforced on:

- the `outline` inspect depth — `impl/src/application.mjs:7384-7386`
  (`Buffer.byteLength(JSON.stringify(response)) > bounds.maxBytes` → `application_inspect_oversize`),
- the legacy/compatibility `run.follow` — `impl/src/application.mjs:5679-5681`
  (`application_follow_oversize`), and
- the `content` depth (byte-paged via `_contextItemContent`, `impl/src/application.mjs:5933-5966`).

It is **not** enforced on the `index`, `section`, `item`, or `evidence` depths returned by
`inspect()` (`impl/src/application.mjs:7389-7452`). Those depths bound **item count only**,
via `bounds.maxItems`, which `_semanticBounds` derives as `followPolicy.maxChanges`
(`impl/src/application.mjs:7038-7044`, used at `7397` and `7407`). `index`/`evidence` are
naturally small (section summaries / 64-char digests), but `section` returns up to
`maxChanges` full item values and `item` returns a single full value (for context, that
includes `output: clone(artifacts.output)` via `_contextItemDetail`,
`impl/src/application.mjs:5913-5931`), so those two depths can serialize a response larger
than the advertised ceiling without any error.

Two compounding specifics:

1. `normalizeFollowPolicy` (`impl/src/application.mjs:416-421`) imposes **no absolute cap** on
   `maxChanges` or `maxScanEvents` — only `maxChanges <= maxScanEvents` and
   `maxResponseBytes <= MAX_RUN_VIEW_BYTES`. A deployment profile may legitimately set
   `maxChanges` far above `MAX_ATTENTION` (64).
2. The live cascade caps item count at `maxChanges` (`impl/src/application.mjs:7397,7407`)
   while the historical-profile cascade (`_historicalProfileInspection`) caps at the hardcoded
   `MAX_ATTENTION` (`impl/src/application.mjs:7199,7208`). The two surfaces disagree on the
   item ceiling for otherwise-equivalent requests.

**Mitigation:** the MCP transport bounds the whole response at `maxMessageBytes`
(`impl/src/mcp-northbound.mjs:943-944` → `application_run_view_oversize`), and per-item values
are drawn from already-bounded stores, so practical impact on the ordinary (MCP/CLI) agent
surface is low. The gap is real on the direct `command()`/orchestration surface and is
inconsistent with the AX2 invariant that Baton — not the agent — owns the response ceiling
(`impl/test/phase67-progressive-agent-experience.test.mjs:218-219`: "ordinary inspection must
not make agents manage deployment response ceilings"). Suggested fix: apply the existing
`Buffer.byteLength(…) > bounds.maxBytes` guard uniformly to the `section`/`item`/`index`/
`evidence` returns, and cap `maxChanges` against `MAX_ATTENTION` in `normalizeFollowPolicy`
(or document the derivation if a higher cap is intended).

### P2-2 — Result export has an undeclared, un-gated hard dependency on a host `python3` binary

`publishResultExportNoReplace` (`impl/src/result-export.mjs:60-68`) performs the atomic
no-replace publication by shelling out to `python3 -c <ctypes bridge>` that calls
`renamex_np(…, RENAME_EXCL)` on Darwin / `renameat2(…, RENAME_NOREPLACE)` on Linux. By design
(`impl/src/result-export.mjs:58-59`) it **fails closed** with
`result_export_publication_unavailable` if `python3` is absent or non-functional, and there is
no Node-native fallback (Node exposes no `RENAME_NOREPLACE`).

Result adoption + export is a first-class AX cascade (`AX5`,
`impl/test/phase67-progressive-agent-experience.test.mjs:461`; `DF11`,
`impl/test/phase78-concise-deployment-factory.test.mjs:499`). Yet deployment readiness does
not verify the primitive: `assertRouteReady` / `BatonDeployment.doctor`
(`impl/src/application-deployment.mjs:858-886`) validate only route/adapter/auth readiness. A
deployment can therefore report **ready** and still fail every result export at effect time.
This is exactly the failure observed here (dead `python3` shim → `AX5` fails), and it
surfaces only at export, not at `openBaton` / `doctor`.

Suggested fix: probe `python3` (and the `renamex_np`/`renameat2` primitive) during deployment
readiness and surface a typed `deployment_config_invalid`/`deployment_primitive_unavailable`
before any run is admitted, so the dependency is declared rather than discovered at export.

### P2-3 (minor nit) — Compatibility `run.wait` is not bound by the deployment wait policy

`wait()` bounds its agent-supplied `timeoutMs` only to a hardcoded 24 h wall clock
(`impl/src/application.mjs:5516-5518`), not to `followPolicy.maxWaitMs`, in contrast to the
deployment-bounded newer surfaces — `run.inspect` (`…:7278-7280`,
`application_inspect_policy_violation`) and `run.follow` (`…:5640-5644`,
`application_follow_invalid`). `run.wait` is a compatibility command (terminal-settlement
semantics via `PROVIDER_EXECUTION_SETTLED_PHASES`, so a distinct bound is defensible) and is
not exposed on the ordinary MCP surface (only the five compact tools are,
`impl/test/phase67-progressive-agent-experience.test.mjs:545-547`), so exposure is low. It is
also not registered in `_followControllers`, so it is cancelled by shutdown only indirectly
(the next `status()` call throws `application_closed` via `_assertOpen`) rather than via a
clean `AbortController`. Flagging for consistency; may be intentional for the compatibility
path.

## Per-area assessment (no defect found)

- **Removal of public response bounds — sound.** `run.inspect`'s public argument set is exactly
  `['runId','depth','section','item','offset','cursor','waitMs']` (`impl/src/application.mjs:54`);
  there is no `maxResponseBytes`/`maxBytes` parameter. The ceiling is deployment-derived
  (`followPolicy.maxResponseBytes`, capped at `MAX_RUN_VIEW_BYTES`, `…:421`) and never leaked
  (`impl/test/phase67-progressive-agent-experience.test.mjs:218-219`).
- **Deployment-derived `run.inspect` waiting — sound.** The wait is derived from deployment
  policy (`effectiveWaitMs = request.waitMs ?? policy.maxWaitMs`, `…:7281-7282`), the agent
  `waitMs` may only narrow within `policy.maxWaitMs` (`…:7278-7280`), cursor-ahead is rejected
  (`…:7287-7289`), a stale/unavailable profile forbids waiting
  (`_historicalProfileInspection`, `…:7155-7157`), and `waitMs` is never echoed into the
  self-describing continuation (`_semanticEnvelope`, `…:7050-7071`; verified
  `impl/test/phase67-change-aware-inspect.test.mjs:81-83` and
  `impl/test/phase67-self-describing-continuation.test.mjs:46-58`). Shutdown cancels outstanding
  waits via `_followControllers` abort (`…:7900,7932`; verified
  `impl/test/phase67-change-aware-inspect.test.mjs:158-169`).
- **Compact outline budget projection — sound.** The outline deliberately omits numeric
  budget (`outline.outline` has no `budget` key, `impl/src/application.mjs:7347-7378`;
  asserted `impl/test/phase67-progressive-agent-experience.test.mjs:220-221,399`); budget
  authority is projected only at the explicit `section:'budget'` depth (`…:3721,7135`) and the
  terminal cause is explained once across outline/execution/budget/cleanup (`AX4b`,
  `impl/test/phase67-progressive-agent-experience.test.mjs:376-421`).
- **Sanitized application cards — sound.** `card()` exposes only `followPolicy.mode`
  (`impl/src/application.mjs:7717`) and omits every internal `max*` guard; the web card
  additionally strips non-web commands (incl. `application.shutdown`, which is `web:false`)
  via `WEB_APPLICATION_ENTRIES` (`impl/src/web-northbound.mjs:13-15,1087-1093`). Verified by
  `DF3` (`impl/test/phase78-concise-deployment-factory.test.mjs:187-193`) and `BU2`
  (`impl/test/phase12-web-operator.test.mjs:101-104`).
- **Browser continuation behavior — sound.** The static client drives the Run flow through the
  self-describing `run.inspect` continuation (`activeFollowPolicy`/`followLoop`) and does **not**
  issue a raw `command('run_follow')` or expose `.maxWaitMs`; CSP is `default-src 'none'` /
  `script-src 'self'`, and no `innerHTML`/`document.write` sinks are present (verified
  `impl/test/phase12-web-operator.test.mjs:106-125`).
- **Compatibility — sound.** The phase sets stay closed and separate
  (`PROVIDER_EXECUTION_SETTLED_PHASES` ⊋ `APPLICATION_RUN_TERMINAL_PHASES`; `work_completed`
  is provider-settled but **not** application-terminal, so inspect/follow remain change-aware at
  result-ready), and the compatibility wait/terminal-evidence paths use execution settlement
  (`impl/src/application.mjs:5522`; asserted at the source level by
  `impl/test/phase67-run-terminality.test.mjs:23-45,88-93`).
- **Stop/reap integrity — sound.** `_performRunStop` (`impl/src/application.mjs:2157-2243`)
  aborts result-export deliveries, context controllers, and verifier-retry controllers, cancels
  pending retries, reaps via `stopRunTargets`, and refuses to complete unless
  `remainingCount === 0` and every closure invariant holds (`…:2190-2196`,
  `application_run_stop_incomplete`). The emergency `stop` action remains immediate and
  pinned in the first outline (`AX4`, `impl/test/phase67-progressive-agent-experience.test.mjs:358-374`).
  Stop propagates to an outstanding inspect wait through coordination-event advancement
  (bounded by `maxWaitMs`) rather than direct controller abort — correct, not a deadlock.
- **Internal circuit breakers vs. agent-managed parameters — sound (modulo P2-3).** All
  `followPolicy`/`exportPolicy`/`reviewPolicy`/`resultPolicy`/`recoveryPolicy` limits are
  deployment-owned, absent from every public command argument set, and omitted from the public
  card. The only agent-managed timing parameter is `waitMs`/`timeoutMs`, and on the preferred
  surfaces it may only narrow within the deployment ceiling (`run.inspect`, `run.follow`). The
  sole exception is the compatibility `run.wait` (P2-3).

## Pointers index

- `impl/src/application.mjs:36` (`MAX_RUN_VIEW_BYTES`), `:54` (inspect args), `:403-425`
  (`normalizeFollowPolicy`), `:5640-5644` & `:5679-5681` (follow bounds), `:7038-7044`
  (`_semanticBounds`), `:7155-7157` (historical wait forbidden), `:7199,7208` (historical
  `MAX_ATTENTION`), `:7278-7289` (inspect wait policy), `:7384-7452` (inspect depth returns),
  `:7690-7732` (`card()`), `:7717` (`followPolicy.mode` only), `:5512-5527` (`wait()`).
- `impl/src/result-export.mjs:58-68` (`publishResultExportNoReplace`, `python3` dependency).
- `impl/src/application-deployment.mjs:858-886` (route-only readiness).
- `impl/src/web-northbound.mjs:13-15,1087-1093` (web card sanitization).
- `impl/src/mcp-northbound.mjs:943-944` (`maxMessageBytes` transport ceiling).
- Tests: `impl/test/phase67-progressive-agent-experience.test.mjs` (AX1–AX8),
  `impl/test/phase67-change-aware-inspect.test.mjs`,
  `impl/test/phase67-self-describing-continuation.test.mjs`,
  `impl/test/phase67-run-terminality.test.mjs`,
  `impl/test/phase78-concise-deployment-factory.test.mjs` (DF0–DF11),
  `impl/test/phase12-web-operator.test.mjs` (BU1–BU6).

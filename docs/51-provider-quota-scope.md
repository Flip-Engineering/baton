# 51 — Provider quota scope (issue #523)

Status: design + red pin, 2026-09-19, seat kimi-quota-scope (swarm-quota-scope-20260919).
Related: #295 (typed provider faults), #316 (`provider_degraded`), #317 (provider services,
docs/50), #341 (the refusal index), #442/#456 (the provider's own clock and the probe lifecycle),
#475 (a probe clears a degrade), #524 (opencode-go routes, not yet wired).

## The issue

Route-degrade and quota tracking are keyed by the exact route triple
`(harness, model, effort)` (`routeQuotaKey`, route-quota.mjs). Two facts make that key wrong:

1. Effort is a client-side request parameter. No provider meters or rate-limits per effort level.
   Observed live on 2026-09-19: `omp/zai/glm-5.3-flash@high` read
   `degraded (provider_quota_exhausted)` for over 24 hours while `@low` and `@max` of the same
   model on the same credential read `ready` and ran real turns with `quota.state: ok`. The
   provider had refused the account; Baton recorded the refusal against one effort of one model.
2. Model alone is not the axis either. A quota pool belongs to a subscription (an account at an
   API service), and subscriptions differ in what they span. omp's own catalog already serves
   `opencode-go`, a separate subscription covering 37 models. Once #524 wires it,
   `opencode-go/deepseek-v4-pro` and `deepseek/deepseek-v4-pro` are the same model id through two
   different accounts; a model-keyed scope would conflate them.

## 1. What exists today (observed at 8ff5bf09)

- `routeQuotaKey(route)` (route-quota.mjs:19) serializes `[harness, model, effort]`. It is the
  key for the `ProviderQuotaAuthority` (the in-memory exhausted-route authority), the refusal
  index (`deriveRouteRefusals`, application-deployment.mjs:2271), the degrade episodes
  (`deriveRouteDegrades`, application-deployment.mjs:2410), the doctor's per-route block lookups
  (application-deployment.mjs:3249), and the usage rows (`#routeUsageRows`,
  application-deployment.mjs:3576).
- The coordinator's degrade fold (`_foldProviderDegrade`, runtime-observation.mjs:3525) groups
  deaths by `${harness} ${model} ${effort}`, so two deaths at two efforts of one model mint two
  episodes for one account fault.
- The episode retirement rules are already derivation-based: a later successful turn on the route
  or a verified probe retires the episode, and a provider-stated `resetAt` retires it when the
  instant passes (#442/#456). These rules are unchanged by this design; only the grouping axis
  moves.
- `providerOfRoute(route)` (provider-faults.mjs:81) already derives a service identity from a
  route: the model's provider segment (`zai/glm-5.3-flash` → `zai`), else the harness. It exists
  for the reset-timezone table (#456) and requires all three route fields.
- The registry route record may carry an explicit `provider` field (the claude-code routes carry
  `provider: 'claude'`); `serviceForRoute` (provider-services.mjs) prefers it over the segment
  when resolving a declared service.
- A probe admission (`_routeProbeState` / `_admitRouteProbe`, swarm-runtime.mjs) admits one
  recruit onto a degraded route at the episode's probe instant; a successful probe turn retires
  the episode through the same success-retires rule.

## 2. What each provider actually scopes

Investigated sources: the credential files at the repository root (one key per provider file:
`glm_key.json`, `deepseek_key.json`, `kimi_key.json`), the fleet's own route registry comments
(application-deployment.mjs:114-166), docs/00 §2 and docs/01 §7 (the vendor ToS/rate-limit
survey), the omp model catalog on this host (`omp models list`), and the observed 429 text the
fleet recorded ("Usage limit reached for 5 hour … reset at …", zai, Beijing wall time).

| Scope | Routes on this fleet | Evidence | Verdict |
|---|---|---|---|
| `zai` | `omp/zai/glm-5.3-flash@{low,high,max}` | GLM Coding Plan: one API key for the account; the plan's limit is a 5-hour prompt window (the observed 429 text names the plan-level window, not a model); docs/01 §7 records per-model multipliers, which are burn rates on a shared pool | one scope across every model the plan serves — confirmed |
| `deepseek` | `omp/deepseek/deepseek-flash@…`, `omp/deepseek/deepseek-v4-pro[1m]@…` | one API key (`deepseek_key.json`), per-token API billing on one api.deepseek.com account | account-level, shared across models — confirmed |
| `kimi-code` | `kimi-code/kimi-code/k3@…` and `omp/kimi-code/k3@…` | Kimi Code subscription; the kimi-code harness rides the account's OAuth files, the omp provider rides `kimi_key.json`; both draw on the one Moonshot account | one scope — confirmed at the account level; both access paths derive the same scope string (`kimi-code`) by construction |
| `codex` | `codex/gpt-5.6-sol@…` | ChatGPT subscription; docs/01 §7: usage is metered against account limits | account-level — confirmed |
| `claude` | `claude-code/claude-opus-4-6@…` (explicit `provider: 'claude'`) | Claude subscription: account-level 5-hour window plus weekly windows; Anthropic documents a per-model (Opus) weekly sub-cap inside the shared account limits | account-level — confirmed, with one known narrower sub-limit: an Opus weekly-cap refusal is a fact about the account's Opus allowance only. The fleet routes only Opus today, so the account scope is exact for this fleet; see §4 |
| `grok` | `grok/grok-4.5@…` | no quota-scope evidence in the repository | unconfirmed, and moot while the fleet routes one grok model: the account scope and the model scope coincide |
| `muse` | `muse/muse-spark-1.3-contributor@…` | the deployment's own subscription; one model routed | unconfirmed, moot for the same reason |
| `opencode-go` | not wired (#524) | a separate subscription in omp's catalog covering 37 models | the derivation keeps it distinct from `zai`/`deepseek` segments automatically, because omp namespaces model ids by provider (`opencode-go/deepseek-v4-pro`) |

For the unconfirmed providers the account scope is the safe side of the error: a scope that is
too wide clears with one probe turn (the probe's success retires the episode for the scope),
while a scope that is too narrow keeps dispatching turns into an account that is already
refusing, and some providers extend punishment windows on repeated hits. The derivation also
never merges two accounts: two routes share a scope only when they resolve to the same provider
identity, which on this fleet is one credential each.

## 3. Decisions

**D1 — The quota scope of a route is the API service account it draws on.** One derivation,
exported beside `providerOfRoute` in provider-faults.mjs:

```
routeQuotaScope(route) = route.provider        (the registry record's explicit provider field)
                      ?? model segment         (`zai/glm-5.3-flash` → `zai`)
                      ?? harness               (`codex/gpt-5.6-sol` → `codex`)
```

It never reads `effort`, and it accepts a route that names no effort. This is the same resolution
order `serviceForRoute` uses (explicit provider, then segment), so a route's quota scope and its
declared service (#317) can never disagree. A route whose scope cannot be derived (no harness,
no model) has no quota scope and is never blocked by this authority — the same fail-open shape
`routeQuotaKey`'s null has today.

**D2 — The (harness, model, effort) triple stays the dispatch identity.** Recruit options,
`--exact` parsing, workflow member routes, usage sums (turns/tokens/usd per route), and the MCP
schemas keep the exact triple. Only the questions "is this account out of quota" and "is this
account degraded" group by scope. `routeQuotaKey` keeps its exact-route meaning for the per-route
row maps that need it (`#routeUsageRows`' doctor-row lookup, `#serviceRows`' per-route joins);
the quota authority, the refusal index, and the degrade derivation gain the scope key.

**D3 — Write side and read side group by the same scope.**

- `_foldProviderDegrade` folds deaths by scope: same-class deaths on any routes of one scope
  inside the declared window are one episode. The episode row and the durable
  `provider.degraded` payload carry `scope`, the exact observing route (`route`, as today), and
  the participant list as today. Old durable rows carry no `scope`; the read side re-derives it
  from the row's route coordinates through the registry, so no migration exists.
- `ProviderQuotaAuthority.record` keys the block by scope; the recorded row carries `scope` and
  the observing exact route. `blockFor(route)` resolves the route's scope and reads that block.
- `deriveRouteRefusals` and `deriveRouteDegrades` fold ledger rows into per-scope entries. Every
  registry route that resolves to a scope with a live block or episode reads blocked/degraded on
  the doctor and on its usage row; the block and refusal text keep naming the exact route that
  observed the fault.
- The coordinator resolves scope through the deployment's registry (the explicit `provider`
  field lives there and is not on the fault wire), so the scope written and the scope read are
  the same string. The deployment already hands the coordinator the quota authority; the scope
  resolver rides the same wiring.

**D4 — Success retires at the scope.** A completed turn on any route of a scope retires the
scope's refusal block and degrade episode, because a success is proof the account answers again.
This is the existing retirement rule (#316/#456) at the new granularity, and it is what makes a
wrong-wide scope cheap: one probe turn clears it. The #456 probe lifecycle is unchanged — one
probe per episode at the probe instant — with the probe admitted onto the episode's scope and
dispatched on the caller's exact route.

**D5 — A narrower real sub-limit is declared, not derived.** If a provider is found to meter one
model separately (Anthropic's Opus weekly sub-cap is the known candidate), the routes for that
model carry a distinct explicit `provider` value (for example `claude-opus`) and the derivation
in D1 keeps the scopes apart. No provider-specific parsing is added to the classifier: the fault
text already rides the row, and the operator declares the split when the provider documents one.

**D6 — The refusal and the rows name both the scope and the observing route.** A recruit refused
on `omp/zai/glm-5.3-flash@low` reads that the `zai` scope is exhausted, when the provider said it
resets, and which exact route observed the refusal. The route table keeps one row per exact
route; routes of one scope show the same block.

## 4. What this does not do

- No change to dispatch identity anywhere (D2 lists the surfaces that keep the triple).
- No change to the reset-instant parsing, the probe lifecycle, or the retirement derivations.
- No new provider API clients; the scope is derived from the route and the registry, never
  fetched.
- The Anthropic Opus weekly sub-cap (§2) is documented here and not special-cased; D5 is the
  remedy if a second claude model is ever routed.
- The `advanced.services` section (#317) is unchanged; a declared service and a quota scope agree
  by construction (D1's resolution order), and neither feeds back into the other's derivation.

## 5. Pins that move

The scope change inverts expectations in existing pins that assert a sibling effort of a faulted
route stays ready. Each is updated in the same landing, with the inverted assertion named:

- `issue316-provider-degraded.test.mjs` (a3): `READY_ROUTE` is `codex/gpt-5.6-sol@low`, the same
  scope as the degraded `@high`; it now reads degraded.
- `issue456-route-degrade-clears.test.mjs` and `issue475-probe-clears-degrade.test.mjs`: the
  degraded/ready route pairs are same-model effort pairs; the ready sibling shares the scope's
  episode, and the probe's success on one effort retires the scope.
- `route-usage-341-red.test.mjs`, `issue443-reroute-on-provider-fault.test.mjs`: audit every row
  that builds a refusal or degrade on one exact route and reads a sibling.

## 6. Verification

- `impl/test/issue523-quota-scope-red.test.mjs` pins the contract in five rows, red at 8ff5bf09
  (all five fail: the scope derivation does not exist, the authority blocks per effort, the
  doctor and the recruit refusal read per effort, the fold mints two episodes for two efforts),
  listed in the expected-red manifest with reason `#523`. The implementation lane turns the rows
  green, retires the manifest entries, and drops the `-red` suffix (docs/44).
- The deployment gate: `npm test --prefix impl`.

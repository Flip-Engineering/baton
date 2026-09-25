# 50 — Provider services as a deployment concept (issue #317)

Status: design + first landing, 2026-09-19, seat kimi-317r (swarm-317-services-20260919).
Related: #293 (the fleet-routes table), #295 (typed provider faults and the pre-effect recruit
refusal), #314 (the closed surface grammar), #316 (`provider_degraded`), #442/#456 (the provider's
own clock), #494 (the `advanced.ompCredentials` pattern this config section follows).

The issue: today a route is `{harness, model, effort}` and a provider is implied by the model id
prefix (`zai/glm-5.3-flash` → `zai`) plus a key file whose presence the doctor reports. Nothing in
the deployment knows what a provider IS: which models it offers, what its subscription window is,
how much of that window remains, or when it resets. The operator learns a quota window from a
worker's 429 text (#295) and a stall from simultaneous deaths (#316).

Scope, as the issue states it: (1) a `services` section in the deployment configuration, (2) a
`services list` family in the #314 grammar answering the configured services, their models, and
the routes Baton derives from them, (3) usage visibility — remaining usage and the reset instant —
on the doctor, on `swarm.view`'s deployment summary, and in the pre-effect recruit refusal, and
(4) the typed provider faults resolve against the service record, so a stall or a quota
exhaustion is attributed to a service and route readiness reads the service's state.

## 1. What exists today (observed at 7b049bd8)

- The served route registry is `DEFAULT_ROUTES` (application-deployment.mjs:166), validated by
  `normalizeRoutes` (:442) and projected to the public `{harness, model, effort}` shape by
  `publicRoute` (:483). A route may carry an explicit `provider` field.
- The provider identity a fault is attributed to derives from `providerOfRoute`
  (provider-faults.mjs:78): the model's own provider segment, else the harness.
- Provider credentials are per-harness and hard-wired: repository key files
  (`DEFAULT_OMP_PROVIDER_KEY_FILES`, application-deployment.mjs:1140), environment variables, and
  macOS keychain reads behind injected shims. A credential VALUE never crosses a surface; the
  doctor reports presence and lifetime metadata.
- Typed provider faults (#295) are classified at the adapter boundary
  (`classifyProviderFault`, provider-faults.mjs:233), recorded in the `ProviderQuotaAuthority`
  (route-quota.mjs:24) and as durable `provider.quota_exhausted` / `provider.degraded` ledger rows
  (runtime-observation.mjs:3460/:3653), and re-derived on every doctor read
  (`doctorReadiness`, application-deployment.mjs:3174). Every block expires by derivation from a
  recorded instant; there are no timers.
- The pre-effect recruit refusal (`providerRouteRefusal`, application-deployment.mjs:2590) names
  the route, the typed class, and the provider's stated reset instant.
- Usage rows (`#routeUsageRows`, application-deployment.mjs:3356) sum `resource.tokens` events per
  route. The counterId/cumulative dedup rule lives in `workerActivity`
  (runtime-observation.mjs:514). Codex adapters already write observed rate-limit facts
  (`resource.tokens` rows with `rateLimits{primary,secondary{usedPercent,windowDurationMins,
  resetsAt}}`, codex-appserver.mjs:766).
- The only outbound provider HTTP clients are the model-catalog readers (model-profile.mjs:317,
  :467): injected `fetchImpl`, `AbortSignal.timeout` only when the caller passes `timeoutMs`,
  typed refusals, degrade-never-guess.
- The grammar is a three-tier derivation (docs/49): `CLI_TOP_LEVEL_VERBS`
  (application-cli.mjs:1490), `APPLICATION_COMMAND_DEFINITIONS` (application.mjs:264), and
  `CANONICAL_OPERATION_SPECS` (application-semantics.mjs:1274) feeding `deriveSurfaceNames`. The
  shipped MCP core surface is the curated `CORE_TABLE` (mcp-core-tools.mjs:73), whose per-verb
  schemas derive from the flat tool table. `evidence.search` (#318) is the most recent addition
  and the template this landing follows.

## 2. Decisions

**D1 — The service record is a closed `advanced.services` entry.** The section is one object
keyed by provider id — the key is the service's identity, so two entries can never claim one
provider. One entry per API service:

```
advanced.services = {
  zai: {
    baseUrl:    'https://api.z.ai/api/paas/v4',       // the API base the harnesses speak to
    credential: { kind: 'file', path: 'glm_key.json', jsonPointer: '/glm_key' },
    harnesses:  ['omp'],                              // the harnesses that can speak to it
    models:     ['glm-5.3-flash'],                    // optional declaration (D4's fallback)
    usage:      { windowMs: 18000000, quotaTokens: 1000000, windowKind: 'rolling' },  // optional declaration
  },
}
```

The fetch/keychain/credential-file seams the model-list read rides live in a sibling
`advanced.serviceClients` section (`{ fetchImpl, keychainRead, readCredentialFile, timeoutMs }`),
wired exactly like `advanced.modelProfiles`' seams: the deployment defaults them, a fixture
supplies fakes and never dials a provider.

`credential` is a reference, closed on `kind`: `env` (`name`), `file` (`path`, optional
`jsonPointer`), or `keychain` (`service`, optional `account`). There is no field that holds a
secret value. Validation is the deployment's own pattern: `closed()` field admission, per-field
predicates, and `deploymentError` (`deployment_config_invalid`) on any violation, all at open
(provider-services.mjs `normalizeProviderServices`). `usage.windowMs` and `usage.quotaTokens` are
positive safe integers — the operator's declaration of a window the provider does not expose by
API, which is exactly what the issue admits. `usage.windowKind` is optional and closed on
`USAGE_WINDOW_KINDS`: `rolling` for a window that clears a period after the call that counted
against it, `fixed_clock` for a window that clears on the provider's calendar boundary (#491). A
declaration that names no kind keeps the record it has always published; the derived row then reads
`unknown`. Nothing here assumes a window, a quota or a window shape.

The section is reachable from a serve config module (`baton serve CONFIG_MODULE` imports a
factory, impl/scripts/baton.mjs:480), so an operator may keep it in a dedicated file.

**D2 — A service owns the routes that resolve to it.** `serviceForRoute(services, route)` resolves
a route to at most one declared service: the route's explicit `provider` field first, else
`providerOfRoute`'s segment. A duplicate provider across two entries refuses at open. Route
derivation does not change: the registry stays the route authority, and a service's `routes` list
is a projection of it. The fleet-routes table (#293) and the services family are two renderings of
that one derivation; neither re-derives readiness.

**D3 — `services.list` is one canonical operation.** Following the `evidence.search` (#318)
template exactly:

- one row in `CANONICAL_OPERATION_SPECS` (profile `ordinary`, surfaces
  `embedded`/`cli`/`mcp`/`web`, capabilities `['observe']`), so every surface spelling derives
  from `deriveSurfaceNames('services.list')`;
- one row in `APPLICATION_COMMAND_DEFINITIONS` (`args: ['provider']` — an optional filter;
  observe, web + mcp admitted, reconcilable);
- the canonical operation's own validator (`validateServicesListArgs`, provider-services.mjs) is
  the field contract on every surface, wired beside the `evidence.search` leg in
  `validateApplicationCommandArgs`;
- `baton services list [--provider PROVIDER]` in `CLI_TOP_LEVEL_VERBS` with a table-driven parser
  that refuses a missing verb or an unknown flag at the parse (#431 posture);
- the flat MCP tool `baton_services_list` beside `baton_evidence_search` (explicit definition row,
  no `fleet_` twin, capability classes from the canonical operation);
- one new family on the shipped core surface: `baton_services` with the single verb `list`,
  dispatching to `baton_services_list`. This grows the #314 core set from seven families to eight;
  the conformance fixture (issue314-mcp-core-surface-red.test.mjs, which carries the designed core
  as executable data) gains the family row in the same change. The byte budget row (314-b)
  derives from the table, so it moves by construction.

The answer is `{ schemaVersion: 1, services: [...] }`, one row per declared service, optionally
narrowed by `provider`. A deployment with no `services` section answers an empty list — the
operation exists on every surface regardless of configuration.

**D4 — The model list is pulled where an endpoint exists, declared otherwise.** For a service with
a `baseUrl`, `services list` attempts `GET {baseUrl}/models` (the OpenAI-shaped list every served
provider here answers) with the resolved credential as a bearer token. The client follows the
model-profile.mjs conventions: injected `fetchImpl`, `AbortSignal.timeout` only from a caller
passed `timeoutMs`, typed refusals — `service_credential_absent` when the reference resolves to
nothing, `service_models_unavailable {status, cause}` for a transport, HTTP, or shape failure. A
failed pull degrades the row to the declaration and names the cause on the row
(`modelsSource: 'endpoint' | 'declaration'`, plus `modelsRefusal` when degraded). The credential
value is resolved in memory at fetch time and never appears on a row: the row carries
`credential: { kind, reference }` metadata and a `credentialState` of `resolved` or the typed
absence. There is no cache with an invented freshness: the read is live per call, like the
doctor's own reads.

**D5 — Usage visibility is declared-or-observed accounting.** For a service with a `usage`
declaration, the service row carries:

usage: {
  windowMs, quotaTokens,           // the declaration
  quotaWindow,                     // { kind, periodMs }: the declared window shape (#491)
  usedTokens, remainingTokens,     // Baton's own accounting (below)
  resetAt, resetSource,            // see below
  observed,                        // the provider's own rate-limit fact, when one was observed
}
```

- `usedTokens` sums the deployment's `resource.tokens` rows attributed to the service's member
  routes inside the trailing `windowMs`, under the same delta-sum/cumulative-per-counterId rule
  `workerActivity` uses. It is accounting of what Baton sent, which is what the issue names as the
  fallback when the provider exposes no usage endpoint.
- `resetAt` comes from observed provider facts first: a live quota block or degrade episode on a
  member route carries the provider's own stated instant (#295/#456). When the provider's answer
  named no instant and the service declares a window, the reset derives from the declaration at
  the observation: `observedAt + windowMs`, published with `resetSource: 'declared_window'` so a
  reader can tell it from the provider's own word (`resetSource: 'provider'`). With neither, the
  row says `resetAt: null` — never an invented instant.
- `quotaWindow` names the shape of the window that instant belongs to: `{ kind, periodMs }` with
  `kind` from `USAGE_WINDOW_KINDS`, or `unknown` when the declaration names none (#491). A rolling
  boundary can move when the route is used inside its own window; a fixed-clock boundary does not.
  The route's usage row carries the same shape beside its reset instant, so a route comparison
  reads the boundary kind without a second lookup.
- `observed` surfaces the newest `rateLimit` fact a member route's `resource.tokens` rows carry
  (`usedPercent`, `windowDurationMins`, `resetsAt` — the codex app-server lane), when one exists.
  A service whose provider reports by API shows the provider's own numbers; a subscription service
  that reports nothing shows the accounting against the declaration.

The three consumers the issue names all read this one derivation:

- the doctor: `doctorReadiness()` composes a `services` section beside `routeUsage`, and each
  route row and usage row names its `service` (the provider id it resolves to, or none);
- `swarm.view`: the deployment summary carries the service rows through the same non-enumerable
  supplier pattern `routeUsage` already rides (application-deployment.mjs:6274), so the summary's
  serialized shape does not move for a deployment that declares none;
- the pre-effect recruit refusal: `providerRouteRefusal` names the service the blocked route
  resolves to and the reset instant the service record holds — which is the provider's stated
  instant when it stated one, and the declared-window derivation when it did not. The refusal is
  unchanged for a deployment with no service record for the route.

**D6 — Faults attribute to the service at read time.** The typed fault keeps its exact-route
identity (`routeQuotaKey`); the service attribution is derived by `serviceForRoute` wherever a
row is published — doctor row, usage row, service row, refusal detail. No second store: the
quota authority and the degrade ledger keep their route keys, and a service's `state` aggregates
its member routes' published verdicts (`ready` when any member is ready, else `degraded` when any
is degraded, else `blocked` when any is blocked, else `unrouted` for a service no configured
route resolves to). A route's own verdict never reads the aggregate: the recorded facts stay the
substrate, exactly as #295/#316 established.

**D7 — Additive only.** Every new field is conditional on a declared service: a deployment without
`advanced.services` serializes the doctor, the route usage rows, the deployment summary, and every
refusal byte-identically to before. The existing pins (route-truth, the #341 usage-row contract,
DP5's closed shapes) do not move.

## 3. What this landing does not do

- No per-provider usage-endpoint clients beyond the model list. Providers that expose usage over
  an API surface it through the observed lane (D5's `observed`) or a later declaration-driven
  reader; the accounting lane covers the rest.
- No routing-policy change: service state informs readiness displays and the recruit refusal's
  detail; it does not re-rank the adaptive router.
- No secret storage: `credential` names a reference of the three existing kinds; resolution reuses
  the deployment's existing env/file/keychain seams.
- No `baton services` mutation verbs: this landing is the read family. Configuration changes are
  a serve-time decision (a config edit and a reincarnation), not a runtime verb.

## 4. Verification

- `impl/test/provider-services.test.mjs`: the config validation (closed fields, credential kinds,
  usage declaration, duplicate provider), route resolution (explicit provider field, model
  segment, harness fallback), the usage derivation (windowed accounting, reset sources, observed
  rate-limit lane), the model-list client (endpoint parse, typed refusals, declaration fallback),
  and the deployment wiring (doctor section, summary slice, refusal detail) against a fixture
  deployment.
- The grammar pins: host-verb-inventory parses the new row; surface-truth and the byte-stable
  artifact regenerate (`impl/scripts/surface-gate.mjs --write`); the #314 core-surface conformance
  fixture carries the eighth family.
- The deployment gate: `npm test --prefix impl`.

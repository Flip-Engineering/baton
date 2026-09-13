# Native Flash workers on OhMyPi — `zai/glm-5.3-flash` and `deepseek/deepseek-flash`

Evidence classes: **[src]** = this repository's source at `56139da7` (file:line); **[prov]** = provider-published documentation (two sources listed at the end); **[live]** = exercised on this machine (tests, `omp --version`).

Status: the two exact model identities have been confirmed by the operator in native provider calls — including concurrent tool-use evidence on both routes — and final GLM acceptance is gated on this document's completion, not claimed by it. This dossier records the integration state as of `56139da7` against installed `omp/17.4.0` [live]. Two accepted follow-up commits land around this integration but outside its scope and are not reviewed here: `9270cdc4` (simultaneous capacity-directory startup race in `worktree-capacity.mjs`) and `ad160507` (confined npm executable-link preservation in `toolchain-projection.mjs`, which extends `omp-native-features.test.mjs`).

## 1. Summary

- DeepSeek and GLM ride **OhMyPi (omp) as first-class providers** — native provider support, no anthropic-compat translation, no orphaned `claude-code` member processes (#228) [src `impl/src/omp-rpc.mjs:1-3`, `impl/src/application-deployment.mjs:92-94`].
- The canonical Flash routes are exact tuples: `{ harness: 'omp', model: 'zai/glm-5.3-flash', effort }` and `{ harness: 'omp', model: 'deepseek/deepseek-flash', effort }`, each supporting **effort `low`, `high`, `max` only** [src `application-deployment.mjs:90-109`].
- These are **optional routes, not a fixed swarm topology**. The resident example's own header: "Native routes are starting choices, not a required swarm roster. Embedders can supply their own routes and verifier" [src `impl/scripts/resident.deployment.mjs:2-3`].
- Route readiness is a **static, local fact** (credential projection + executable observation). It is not a provider turn: an auth-less omp still answers its RPC lanes while the provider socket never opens (measured: 25+ min silent, zero sockets) [src `omp-rpc.mjs:56-67`, `application-deployment.mjs:643-646`].
- Usage is native on both axes — tokens (`message_end.totalTokens`) and provider-reported per-call USD — but the USD figure is an **estimate, not a billing ledger**: GLM Coding Plan zero dollars is not zero quota, and DeepSeek peak/off-peak rates make the per-call estimate diverge from the eventual balance deduction [src `impl/src/omp-usage.mjs:1-26`; prov both sources].

## 2. Exact routes and selectors

| Route tuple (`harness` / `model` / `effort`) | Efforts | Provider identity | Notes |
|---|---|---|---|
| `omp` / `zai/glm-5.3-flash` | `low`, `high`, `max` | GLM-5.3-Flash, model code `glm-5.3-flash`, 1M context, 128K max output, native multimodal input | `thinking.type` supports `enabled` only — thinking cannot be disabled; effort selects the thinking budget, it does not turn thinking off [prov GLM] |
| `omp` / `deepseek/deepseek-flash` | `low`, `high`, `max` | DeepSeek-V4.1-Flash; **`deepseek-flash` is the provider's canonical API name**; legacy `deepseek-v4-flash` is an accepted alias for the retired model, served and billed as V4.1-Flash | listed first in `DEFAULT_ROUTES`, so it is the omp adapter's configured default model [prov DeepSeek; src `application-deployment.mjs:99-105`] |

Selection facts [src `omp-rpc.mjs:388-398, 421-426`]:

- Model selection mode is **exact**: no accepted prefixes, no aliases. `effortRequired: true` — every route must carry an explicit effort. `provenance: 'deployment-pinned+cli-flags'`, `refreshedAt: null`: the catalog is what the deployment pinned, not a live provider inventory.
- The adapter's built-in default catalog also keeps **explicit legacy selections** available (`deepseek/deepseek-v4-flash` and `glm/glm-5.2` at `low/medium/high`) for callers that pin them by hand; the deployment defaults ship only the canonical Flash ids [src `omp-rpc.mjs:391-394`].
- `deepseek/deepseek-v4-pro[1m]` (`low`, `medium`) remains an explicit **pre-update opt-in**: the `[1m]` label precedes that model's unpublished update [src `application-deployment.mjs:104-108`; prov DeepSeek].
- Where the routes come from: `GLM_EFFORTS` and `DEEPSEEK_FLASH_EFFORTS` are frozen to `['low','high','max']`; `glmRoutes()` and `deepseekRoutes()` expand into `DEFAULT_ROUTES` alongside codex/kimi/grok/claude-code [src `application-deployment.mjs:90-135`]. A selected-route tuple duplicated exactly is a deployment error (routes must be distinct exact tuples) [src `application-deployment.mjs:1846-1849`].
- `builtInAdapters` groups all selected omp routes into **one `OmpRpcCli`** whose catalog is exactly the selected models × efforts; `requestTimeoutMs: 45_000`, `ceiling: 4` [src `application-deployment.mjs:841-850`].

## 3. Launch shape and preserved native tools

Every ordinary member launch is [src `omp-rpc.mjs:91-113`]:

```
omp --mode rpc --model <exact model> --thinking <effort> --approval-mode yolo
```

- **No capability suppression since 2026-09-12.** The builder previously pushed `--no-extensions --no-skills --no-rules --no-lsp --no-title --no-pty` unconditionally; each was read off the installed binary as a session-scoped capability switch with no RPC-protocol dependency. Ordinary launches therefore keep the **native harness intact: skills, extensions, rules, and LSP all stay enabled**. `--no-title` was redundant (rpc mode sets `PI_NO_TITLE=1` itself); `--no-pty` was inert (plain rpc reports `hasUI=false`) [src `impl/test/omp-native-features.test.mjs:6-29`].
- A caller-supplied `args` seam **replaces** the defaults verbatim (opt-in suppression stays possible); `extraArgs` appends; resume appends `--resume <id> --session-dir <dir>` to the same native defaults [src `omp-native-features.test.mjs:114-151`].
- Steering is native: `steer` queues into the running turn, `abort` is a typed command, and the `extension_ui_request` lane is answered — that lane is how native extensions and questions reach the coordinator [src `omp-rpc.mjs:427-430, 547, 762-764, 983-988`].
- Tool calls: observation `native`, enforcement `unavailable`. Provider calls: observation and enforcement both `unavailable` [src `omp-rpc.mjs:414-418`].
- Containment is the runtime, never argv: one dedicated omp process per member, worktree cwd, same-UID private HOME, projected credentials (`runtime-isolation.mjs`) [src `omp-rpc.mjs:431-457`].

## 4. Credential projection — native OMP credentials and custom `models.yml`

The default projection builds an omp credential tree from the operator's real HOME [src `application-deployment.mjs:643-656`]:

| File | Role |
|---|---|
| `~/.omp/agent/agent.db` | omp identity store (grows by design; 8 MiB/file, 32 MiB total projection caps accommodate years of growth) |
| `~/.omp/agent/config.yml` | omp provider auth config (deepseek/glm keys, oauth) |
| `~/.omp/agent/models.yml` | **custom model overlay — included only if it exists at deployment open** |

- The tree projects **HOME-relative into each member's private HOME** (`.omp/agent/…`), because omp resolves credentials at `$HOME/.omp` and offers no config-dir override [src `runtime-isolation.mjs:28-34, 89-91, 134-136`]. Without it, omp parks auth-less and never dials the provider (measured 2026-08-15: 25+ min live member, zero established sockets) [src `application-deployment.mjs:643-646`].
- `projectCredentialTree` copies only the allow-list, refuses symlinks/traversal/group-writable sources, verifies owner identity before and after read, and writes 0600 targets under 0700 directories [src `credential-projection.mjs:110-182`].
- **Redaction is frame-level, not file-level**: the projected files keep real keys (omp must read them); the returned `redactProviderFrame` scrubs those values from coordinator-visible frames. For `.yaml`/`.yml`, secrets are collected by parsing the document (keys matching `api_key|token|secret|password|credential|authorization`, values ≥ 8 chars) so YAML escapes, aliases, and folded scalars are caught — the `models.yml` test pins `apiKey` with an inline comment, a `"Bearer escaped-model-secret"` Authorization header, an alias `*key`, a quoted scalar, and a folded block all redacting to `[REDACTED]` while routing metadata (`models: [{id: glm-5.3-flash}]`) stays visible in the copied file [src `credential-projection.mjs:50-90`; live `impl/test/credential-projection.test.mjs:46-71`].
- Malformed YAML is refused with the bounded code `credential_yaml_invalid`; parser diagnostics (which can contain source values) never leak into the error [live `credential-projection.test.mjs:73-79`].
- Compat-era harnesses (`harness: 'glm'` / `'deepseek'` with repo-root `glm_key.json` / `deepseek_key.json` and `https://api.deepseek.com/anthropic`) still exist for explicit opt-in, but the omp routes above are the first-class path and need no repo key file [src `application-deployment.mjs:111-118, 876-887`].

## 5. Catalog readiness vs actual provider turns

**Readiness is static and local; a provider turn is not proven by it.**

- Per-route readiness (`deploymentReadiness`) requires: exactly one adapter advertising the exact route, projected authentication resolvable (for omp: a non-empty `~/.omp` tree — the tree *entry* is the admission fact, never a network probe, never a copy), harness version observed compatible, worker policy resolvable, credential projection resolvable. `'ready'` means *dispatchable AND statically authenticated* [src `application-deployment.mjs:1104-1250`].
- omp answers its `ready`/UI lanes while the provider socket never opens; only provider-traffic frame types (assistant deltas, tool executions, agent/turn boundaries, provider retries) prove the conversation is live. Startup/UI frames and command acks are explicitly NOT traffic [src `omp-rpc.mjs:56-67`]. The first real turn is therefore the only evidence that a selected route actually works end to end.
- `terminalSeal: 'native'` and terminality on evidence only: `agent_end` with `isTerminal !== false`, or the process-exit fact. A transport timeout is never a failure; timed-out commands are never re-issued (no idempotency — a resend would duplicate the native effect) [src `omp-rpc.mjs:5-17, 33-39`].
- Residual drift note: `locallyReadyRoutes()` — which gates omp readiness on repo-root `deepseek_key.json`/`glm_key.json` — is currently **unreferenced** in src and tests; the live default inventory is `locallyConfiguredRoutes()` (`omp: true`, honest pre-credential) [src `application-deployment.mjs:670-695, 697-719, 1842`]. Its omp gate keys off compat-era repo files while actual omp auth projects from `~/.omp/agent` — dead code with a stale readiness idea, kept here as a flagged limit rather than silently trusted.

## 6. Token usage vs native cost estimates

- Source of truth for both dimensions is the native assistant message shape: `usage.totalTokens` (input+output+cacheRead+cacheWrite) and `usage.cost.total` — USD for **that one provider API call**, additive per call, one `message_end` per call [src `omp-usage.mjs:1-26`]. `agent_end.telemetry` is undocumented and unused; `agent_end.messages` filtered to `role === 'assistant'` is the accounting lane.
- The turn seal is `{ tokens, usd, counterId, tokenMetric: 'message_end.totalTokens' }`; before any `message_end`, tokens/usd read `'unavailable'` honestly rather than zero [src `omp-rpc.mjs:69-71, 415, 625-668`]. Dimensions are independent: an invalid token figure does not suppress a valid USD figure, and vice versa [src `omp-usage.mjs:81-92`]. Native USD smaller than Baton's nanodollar ledger rounds **upward** so reported spend is never understated; the raw native amount stays on the event [src `omp-usage.mjs:70-79`].
- **Zero dollars is not zero quota (GLM Coding Plan).** GLM-5.3-Flash is fully available on the GLM Coding Plan, whose quota is **points-based** (off-peak hours, including all day on weekends, consume 50% of standard points). When a call rides a subscription, the provider-reported per-call cost can read as zero while real points/quota are consumed — tokens remain the invariant consumption metric, and USD must not be read as quota burn-down [prov GLM].
- **Peak estimates differ from billing (DeepSeek).** DeepSeek bills `tokens × price` against the topped-up (or granted-first) balance, with peak hours 01:00–04:00 and 06:00–10:00 UTC Mon–Fri and off-peak at exactly half of peak, per 1M-token rates. A per-call USD estimate does not carry the billing ledger's rate timing or balance semantics, so Baton's summed native USD is an estimate of spend, not the provider's invoice [prov DeepSeek].
- Steering/abort turns still seal usage from the messages actually observed; `stopReason: 'error' | 'aborted'` marks the failed/aborted final assistant rather than inventing a clean verdict [src `omp-rpc.mjs:658, 69-71`].

## 7. Concurrency

- Adapter ceiling is **4 concurrent members per omp adapter** — provider-true backpressure only, no synthetic seat caps (#221 law) [src `omp-rpc.mjs:382`, `application-deployment.mjs:848-850`]. Provider-side limits are a separate layer (DeepSeek published concurrency: 2500 for `deepseek-flash`, 500 for `deepseek-v4-pro`) [prov DeepSeek].
- Each member gets its **own omp process** in its own worktree cwd with an isolated private HOME; there is no shared omp session between members [src `omp-rpc.mjs:431-457`].
- Mid-turn steering rides the native lane, so a busy member absorbs coordination messages without a second process [src `omp-rpc.mjs:983-988`].

## 8. openBaton example — choosing either exact worker

```js
// Programmatic (see impl/scripts/resident.deployment.mjs for the file-based example;
// run it with: baton serve impl/scripts/resident.deployment.mjs)
import { openConvergedBaton } from './impl/src/index-converged.mjs';

const baton = await openConvergedBaton({
  repo: process.cwd(),
  advanced: {
    routes: [
      { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' },   // exact tuple
      { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'max' }, // or this one
    ],
    // verification omitted → the repository's own test command is used
  },
});
```

- Omitting `routes` selects `locallyConfiguredRoutes()` (falling back to `DEFAULT_ROUTES`), so the Flash workers appear only when selected explicitly or via the default inventory [src `application-deployment.mjs:1842-1845`].
- Ordinary deployment admission checks each selected route at open (`deploymentReadiness`), and dispatch re-asserts exact-route readiness — selection failures surface as typed blocked states (`route_unavailable`, `authentication_required`, `route_credentials_unprojected`, …), never as a substituted model [src `application-deployment.mjs:1135-1250, 1280-1287`].
- These are **optional routes, not a swarm topology**: nothing pairs the two Flash workers, nothing requires both, and an embedder may ship one, both, or neither. `DEFAULT_ROUTES` continues to advertise codex/kimi/grok/claude-code alongside them.

## 9. Residual design limits (from source)

1. **Interactive PTY bash is unavailable under `--mode rpc`** — omp's own mode gate (`canUseInteractiveBashPty` requires a UI session); argv cannot restore it [src `omp-native-features.test.mjs:20-23`].
2. **Effort is send-only.** The card advertises `effortObservation: 'unavailable'` and the catalog is deployment-pinned (`refreshedAt: null`) — Baton cannot observe which effort omp actually applied [src `omp-rpc.mjs:421-426`].
3. **No provider-call observation or enforcement, no tool-call enforcement** — governance is honest about the gap [src `omp-rpc.mjs:414-418`].
4. **Readiness never network-probes** — static facts only; see §5 for the auth-less-omp consequence and the `locallyReadyRoutes` dead-code drift [src `application-deployment.mjs:670-695, 1104-1120`].
5. **Projection allow-list is fixed at open** — a `models.yml` created after deployment open is not projected; caps are 8 MiB/file and 32 MiB total [src `application-deployment.mjs:648-652`, `credential-projection.mjs:12-13`].
6. **Redaction is name-heuristic** — a secret stored under a key not matching the `api_key/token/secret/password/credential/authorization` pattern (≥ 8 chars) rides the private runtime but would not be redacted from frames [src `credential-projection.mjs:50-62`].
7. **Usage caveats** — `agent_end.telemetry` unused; seals read `unavailable` before the first `message_end`; USD is a provider estimate (§6), never a billing ledger [src `omp-usage.mjs:25-26, 36-38`].
8. **GLM thinking cannot be disabled** (`thinking.type` supports `enabled` only) and **DeepSeek vision is Flash-only** (`deepseek-v4-pro` does not support vision) — capability asymmetries between the two exact workers [prov both].

## 10. Sources

- Provider: [GLM-5.3-Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash) (model code, 1M/128K, thinking-always-enabled, Coding Plan points quota and off-peak 50%).
- Provider: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) (canonical `deepseek-flash` = V4.1-Flash, legacy alias billing, peak windows and half-price off-peak, balance deduction rules, concurrency limits).
- Repository: `impl/src/application-deployment.mjs`, `impl/src/omp-rpc.mjs`, `impl/src/omp-usage.mjs`, `impl/src/credential-projection.mjs`, `impl/src/runtime-isolation.mjs`, `impl/scripts/resident.deployment.mjs`, `impl/test/omp-native-features.test.mjs`, `impl/test/credential-projection.test.mjs` at `56139da7`.

## 11. Verification

Both named suites were run on this worktree [live]:

```
node --test impl/test/omp-native-features.test.mjs impl/test/credential-projection.test.mjs
# tests 9 / pass 9 / fail 0
```

(5 native-launch pins: no suppression flags, caller-owned argv, exact model/effort, resume appends; 4 credential-projection pins: private allow-listed copy + frame redaction, symlink/mutation refusal, traversal/group-writable refusal, `models.yml` YAML redaction with visible routing metadata, malformed-YAML bounded refusal.)

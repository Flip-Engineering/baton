# Baton application CLI

`baton` is the normal shell surface for the shared Run application. It does not expose worker
kernel choreography.

## Verb inventory

The ordinary CLI principal inventory is the generated table below — produced from the executable
per-profile inventory (parser + web-client whitelist + host-local ops), never a hand list.
Call `baton help` / `baton help run` for live topic text. Orchestration waves stay embedding-only
(`openBaton` → `baton.waves`); the worker scratchpad is embedding/projection-only, never a CLI verb.

### Canonical operation inventory (generated from the ordinary CLI principal)

The rows below are rendered by `impl/scripts/render-surface-docs.mjs` from the executable
ordinary-CLI inventory. The conformance suite fails if they drift from served truth.

<!-- BEGIN GENERATED: cli-verb-inventory (impl/scripts/render-surface-docs.mjs) -->

| Operation | Profile | CLI verb | Example |
|---|---|---|---|
| `application.help` | `ordinary` | `baton application help` | `baton help` |
| `run.adopt` | `ordinary` | `baton run adopt` | `baton run adopt RUN_ID --reason R` |
| `run.answer` | `ordinary` | `baton run answer` | `baton run answer RUN_ID REQUEST_ID --text TEXT` |
| `run.approve` | `ordinary` | `baton run approve` | `baton run approve RUN_ID --plan DIGEST` |
| `run.debug` | `ordinary` | `baton run debug` | `baton run debug RUN_ID` |
| `run.do` | `ordinary` | `baton run do` | `baton run do RUN_ID ACTION_ID` |
| `run.evidence` | `ordinary` | `baton run evidence` | `baton run evidence RUN_ID` |
| `run.export` | `ordinary` | `baton run export` | `baton run export RUN_ID DIR` |
| `run.integrate` | `ordinary` | `baton run integrate` | `baton run integrate RUN_ID --strategy ff-only --reason R` |
| `run.list` | `ordinary` | `baton run list` | `baton run list` |
| `run.member.send` | `ordinary` | `baton run member send` | `baton run member send RUN_ID ROLE TEXT` |
| `run.member.stop` | `ordinary` | `baton run member stop` | `baton run member stop RUN_ID ROLE` |
| `run.member.view` | `ordinary` | `baton run member view` | `baton run member view RUN_ID` |
| `run.recover` | `ordinary` | `baton run recover` | `baton run recover RUN_ID` |
| `run.resume` | `ordinary` | `baton run resume` | `baton run resume RUN_ID --reason R` |
| `run.retry` | `ordinary` | `baton run retry` | `baton run retry RUN_ID --reason R` |
| `run.review` | `ordinary` | `baton run review` | `baton run review RUN_ID --exact codex/gpt-5.6-sol@low --reason R` |
| `run.send` | `ordinary` | `baton run send` | `baton run send RUN_ID TEXT` |
| `run.start` | `ordinary` | `baton run start` | `baton run "Ship it" --model gpt-5.6-sol --effort low` |
| `run.stop` | `ordinary` | `baton run stop` | `baton run stop RUN_ID` |
| `run.view` | `ordinary` | `baton run view` | `baton run view RUN_ID` |
| `run.watch` | `ordinary` | `baton run watch` | `baton run watch RUN_ID` |
| `waves.attach` | `ordinary` | `baton waves attach` | `baton waves attach WAVE_ID --members JSON` |

<!-- END GENERATED: cli-verb-inventory -->

## Connect to a resident authenticated Web host

For ordinary local use, start Baton from the repository:

```sh
baton serve
```

This creates one stable deployment identity and fresh resident incarnation, serves authenticated
HTTP over an owner-only Unix-domain socket, self-checks readiness/card/session authority, and only
then publishes the Git-common selector plus owner-private profile/token. No URL, origin, socket,
token, timeout, capacity, or budget is an ordinary argument. `connectBaton({repo})`, the CLI, and
other orchestrators discover that authority automatically. `SIGINT`/`SIGTERM` drain, revoke, and
remove only the current incarnation.

Explicit authenticated network deployments retain the schema-v1 setup convention. Their
repository selector is:

```json
{ "schemaVersion": 1, "profile": "progressive", "repoId": "repo-a" }
```

at `.git/baton/connection.json` for a normal checkout, or the corresponding
`baton/connection.json` below the resolved Git common directory for a linked worktree. The user
connection profile lives at `$XDG_CONFIG_HOME/baton/connections/progressive.json` (or
`~/.config/baton/connections/progressive.json`):

```json
{
  "schemaVersion": 1,
  "url": "https://baton.example.test",
  "origin": "https://control.example.test",
  "tokenFile": "progressive.token"
}
```

`tokenFile` is relative to the profile unless absolute. Both the profile and token are bounded,
owner-only, regular non-symlink files owned by the current UID where the platform exposes it. The
repository configuration and user profile never contain the token. Baton discovers the repository
from the current directory upward and shares the selector across linked worktrees.

For compatibility, setting all of `BATON_URL`, `BATON_ORIGIN`, `BATON_REPO_ID`, and `BATON_TOKEN`
selects the legacy environment authority. A partial set is rejected and is never merged with files.

Then use the same command bus as the browser and MCP:

```sh
baton doctor
baton doctor --check
baton explore 'Summarize the failing boundary and report evidence' \
  --exact codex/gpt-5.6-sol@low
baton review 'Audit this change for correctness and integration risks' \
  --exact codex/gpt-5.6-sol@high --exact grok/grok-4.5@medium
baton run start 'Implement the accepted design' --exact codex/gpt-5.6-sol@low
baton run approve RUN_ID --plan PLAN_DIGEST
baton run status RUN_ID --wait 30s
baton run send RUN_ID 'Check the failing boundary.' --nudge
baton run interrupt RUN_ID --reason 'Pause this turn for operator review.'
baton run show RUN_ID
baton run show RUN_ID --depth index
baton run show RUN_ID --depth section --section execution
baton run progress RUN_ID --follow
baton run events RUN_ID --follow
baton run output RUN_ID --to work --follow
baton run evidence RUN_ID
baton run adopt RUN_ID --reason 'Select the preserved independently inspected result.'
baton run review RUN_ID --exact glm/glm-5.2@xhigh \
  --reason 'Obtain independent semantic evidence before integration.'
baton run integrate RUN_ID --strategy ff-only \
  --reason 'Integrate the adopted independently reviewed result.'
baton run stop RUN_ID --reason 'Operator cancelled this Run.'
baton run export RUN_ID DIR
baton run do RUN_ID ACTION_ID --inputs '{"key":"value"}'
baton help run
baton credentials install kimi
```

`baton run OBJECTIVE` and `baton run start OBJECTIVE` are the same start form; both accept
`--exact HARNESS/MODEL@EFFORT` or the `--model/--effort` (plus disambiguating `--harness`)
manual pair, with optional `--profile`, `--run-id`, and `--scope`. The ordinary zero-assembly
deployment defines the single profile `default`, so `--profile` is normally omitted; naming an
undefined profile is refused `application_profile_not_found`. `baton run do` drives any advertised
RunView action by its `actionId`. When no connection exists yet, `baton doctor` offers
`baton serve` (ordinary) before `baton setup` (explicit network deployments).

`baton review` is the ordinary objective-first independent-review preset. Its two exact routes
become the fixed `reviewer` and `challenger` roles of one isolated, operator-selected Workflow.
Use the connected JavaScript `workflow(objective, {team})` surface only when advanced caller-named
team composition is needed. Both forms retain the complete harness/model/effort tuple; neither
accepts budgets, storage ceilings, worker/task/fence coordinates, or receipt paths.

`baton doctor --check` now includes the deployment's sanitized repository, verifier, dependency,
and per-exact-route readiness. The connected JavaScript client exposes the same data through
`doctor()`, `routes()`, and `route({harness, model, effort})`, so route selection does not require
opening the deployment factory. `baton route HARNESS/MODEL@EFFORT` selects the identical sanitized
row for CLI orchestration.

### Fleet routes

The zero-assembly deployment registers these route families (`baton doctor` for live readiness):

| Harness | Model(s) | Efforts | Ready when |
|---|---|---|---|
| `codex` | `gpt-5.6-sol` | minimal/low/medium/high/xhigh | `~/.codex/auth.json` present |
| `kimi-code` | `kimi-code/k3` | low/high/max | kimi credential files present |
| `grok` | `grok-4.5` | low/medium/high | `~/.grok/auth.json` present |
| `claude-code` | `claude-opus-4-6` | low/medium/high/xhigh/max | bounded version + `auth status` probes |
| `claude-code` (provider kimi) | `kimi-k3[1m]` | max | kimi-through-claude credential present |
| `glm` | `glm-5.2` | low/medium/high/xhigh/max | repo `glm_key.json` present |
| `deepseek` | `deepseek-v4-flash` (primary) | low/medium/high/xhigh/max | repo `deepseek_key.json` present |
| `deepseek` | `deepseek-v4-pro[1m]` (pre-update opt-in) | low/medium | repo `deepseek_key.json` present |

The deepseek harness routes through the Anthropic-compatible endpoint
`https://api.deepseek.com/anthropic` — the same session shape as GLM: a claude-family session
class pointed at a DeepSeek endpoint with a token read from a repo-local key file. The
deployment projects, for deepseek routes only, `{ authTokenFile, authTokenJsonPointer:
'/deepseek_key', baseUrl, harness: 'deepseek' }`; the token is read by the deployment, never by
workers, and the file is mode 600 and gitignored beside `glm_key.json`. `deepseek-v4-flash`
(the 0731 variant) is the primary, economically efficient model and the adapter default;
`deepseek-v4-pro[1m]` precedes its unpublished update, so it stays an explicit low/medium
opt-in and is never a default. When the key is absent, deepseek routes report an honest
blocked `authentication_required` readiness rather than failing at construction. Pinned by
`impl/test/deepseek-routes-red.test.mjs` (DS-1..DS-4).


`run adopt` first reads `run.evidence` and binds the exact displayed manifest/result coordinates;
it does not inspect a disposable worktree, merge, checkout, or publish. Use
`--idempotency-key KEY` when an external caller needs stable retry identity. Provider credentials
are not CLI fields. `run send` and `run interrupt` resolve the current semantic recipient inside
Baton; ordinary callers never supply a worker ID or fence. Interrupt ends only that provider turn
and preserves the Run/worktree for continuation, while `run stop` closes dispatch authority and
reaps the whole Run subtree. The worker-targeted `run steer` command remains an advanced
compatibility surface.

Routine mutations and status return a compact machine-readable outline: objective, phase, current
progress, exact requested/resolved/observed route, attention, action outcome, and next expansion.
Internal budgets, ceilings, task/worker IDs, fences, policy attestations, and full lifecycle
chapters stay hidden. `run show` follows the same progressive cascade as the application:
`outline` (default) → `index` → `section` → `item`, with `content` for Context result chunks and
execution progress/events/output, and `evidence` for exact provenance. The three Run stream
commands manage opaque continuation, response, and wait policy inside Baton. Normalized events
exclude provider payloads; output is an explicit opt-in and every item is marked
`contentTrust: untrusted_provider`. Section/item selectors are required only at the corresponding
depth.

`run review` selects one deployment-allowed exact
`harness/model/effort` reviewer route. `run integrate` first refreshes `run.evidence`, binds that
manifest digest, and invokes only the profile-allowed local integration strategy; it never pushes,
publishes, or deploys.

## Own a Web deployment

`baton serve` is the normal zero-assembly owner-local host. It returns only a non-secret outline
and never falls back to cleartext TCP or a wildcard bind.

`baton serve CONFIG_MODULE` is the advanced explicit-network compatibility seam. It loads a deployment factory exporting `default` or
`createBatonWebHost()`. It may return a `BatonWebHost` or these already policy-bound authorities:

```js
export default async function createBatonWebHost() {
  return {
    application, // BatonApplication
    server,      // createAuthenticatedWebServer(northbound, TLS/proxy policy)
    shutdownPrincipal: {
      actor: 'host:production',
      principalId: 'host',
      sessionId: 'host-process',
    },
    listen: { host: '127.0.0.1', port: 8443 },
    webDrainMs: 5000,
  };
}
```

The config owns deployment policy; the host owns lifecycle. `SIGINT`, `SIGTERM`, listener close,
and listener error close Web admission first and then call the host-only
`application.shutdown`. Remote clients cannot invoke that fleet-wide authority.

Cursor `--follow`, exact recovery, materialized result export, and bounded multi-node Workflow
operations use the same application authority rather than a second fleet controller.

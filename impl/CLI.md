# Baton application CLI

`baton` is the normal shell surface for the shared Run application. It does not expose worker
kernel choreography.

## Connect to a resident authenticated Web host

For ordinary use, place the repository selector in private Git common metadata:

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
baton run start 'Implement the accepted design' \
  --profile standard --exact codex/gpt-5.6-sol@low
baton run approve RUN_ID --plan PLAN_DIGEST
baton run status RUN_ID --wait 30s
baton run steer RUN_ID WORKER_ID --nudge 'Check the failing boundary.' \
  --reason 'Fresh verification identified it.'
baton run evidence RUN_ID
baton run adopt RUN_ID --reason 'Select the preserved independently inspected result.'
baton run review RUN_ID --exact glm/glm-5.2@low \
  --reason 'Obtain independent semantic evidence before integration.'
baton run integrate RUN_ID --strategy ff-only \
  --reason 'Integrate the adopted independently reviewed result.'
baton run stop RUN_ID --reason 'Operator cancelled this Run.'
```

`run adopt` first reads `run.evidence` and binds the exact displayed manifest/result coordinates;
it does not inspect a disposable worktree, merge, checkout, or publish. Use
`--idempotency-key KEY` when an external caller needs stable retry identity. Provider credentials
are not CLI fields. `run review` selects one deployment-allowed exact
`harness/model/effort` reviewer route. `run integrate` first refreshes `run.evidence`, binds that
manifest digest, and invokes only the profile-allowed local integration strategy; it never pushes,
publishes, or deploys.

## Own a Web deployment

`baton serve CONFIG_MODULE` loads a deployment factory exporting `default` or
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

`run recover`, cursor `--follow`, materialized result export, and multi-node scheduling remain
unavailable rather than being emulated in the CLI.

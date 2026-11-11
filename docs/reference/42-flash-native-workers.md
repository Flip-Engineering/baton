# Native Flash workers

GLM 5.3 Flash and DeepSeek V4.1 Flash run through Baton's native OMP adapter. Both completed
real Baton development runs concurrently on 2026-09-13: GLM reviewed this integration;
DeepSeek repaired simultaneous capacity-directory initialization. Baton verified and preserved
both contributions. Sanitized receipts are in
[evidence/flash-workers-2026-09-13.json](evidence/flash-workers-2026-09-13.json).

| Model | Exact Baton model selector | Admitted reasoning efforts |
| --- | --- | --- |
| GLM 5.3 Flash | `zai/glm-5.3-flash` | `low`, `high`, `max` |
| DeepSeek V4.1 Flash | `deepseek/deepseek-flash` | `low`, `high`, `max` |

DeepSeek's canonical API name is `deepseek-flash`. Its older `deepseek-v4-flash` name now
aliases V4.1 Flash; it does not pin the retired V4 model. Z.ai's model code is
`glm-5.3-flash`, served through the existing Coding Plan endpoint.
See [DeepSeek's API model table](https://api-docs.deepseek.com/quick_start/pricing/) and
[Z.ai's Flash guide](https://docs.z.ai/guides/vlm/glm-5.3-flash).

## Selecting workers

The resident example, `impl/scripts/resident.deployment.mjs`, includes both routes. They also
appear in the ordinary deployment inventory. Callers can select one, both, or other harnesses;
these defaults impose no pairing or swarm topology.

```js
import { openBaton } from './impl/src/index.mjs';

const baton = await openBaton({
  repo: process.cwd(),
  advanced: {
    routes: [
      { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' },
      { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'max' },
    ],
    // Omission selects the repository's actual verification command.
  },
});

const run = await baton.run('Implement the requested change and verify it.', {
  exact: { harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' },
  scope: ['src/example.mjs', 'test/example.test.mjs'], // choose paths for your task
});
await run.approve();
// Use run.inspect(), run.send(), and run.act() to coordinate the work.
// Preserve/adopt the verified result as appropriate; then stop the run and close the deployment.
```

Independent runs can proceed concurrently. Native OMP processes keep separate sessions, worktrees,
usage counters, and model observations. Interleaved messages must retain their worker attribution.

## Native configuration

This machine's `~/.omp/agent/models.yml` now contains an additive GLM Flash model definition and
a DeepSeek Flash capability override. Existing provider endpoints and credentials were retained;
a private backup precedes the change. No credentials or private configuration are committed.

OMP's provider listing initially omitted GLM Flash on `zai` and discovered DeepSeek Flash with
missing capability metadata. The local overlay supplies their published context/output limits,
text/image inputs, tool support and native reasoning levels. Inspect just the public catalog with:

```sh
omp models find zai/glm-5.3-flash --json
omp models find deepseek/deepseek-flash --json
```

Baton projects the allow-listed `agent.db`, `config.yml`, and optional `models.yml` into each
worker's private `$HOME/.omp/agent`. New deployments include `models.yml` when present; reopen a
deployment after adding that file. Projected files are owner-only. YAML parsing collects named
credential scalars for frame redaction, including quoted/escaped values, aliases and folded
scalars. Invalid YAML produces a bounded error without parser source excerpts.

The ordinary native launch is:

```text
omp --mode rpc --model <exact selector> --thinking <effort> --approval-mode yolo
```

Baton leaves native tool, skill, extension, rule and LSP discovery switches enabled. Availability
still depends on what the isolated environment actually contains; this does not prove every
plugin or skill from the operator's real HOME was projected. Explicit constructor `args` remain
caller-owned. Plain OMP RPC lacks the interactive UI/PTY facilities required by some native tools.

## Readiness, accounting and remaining gaps

- `doctor()` checks local executable/configuration readiness. A successful provider turn supplies
  separate execution evidence. Native model observations accompany assistant messages; requested
  effort is passed to OMP but the adapter cannot independently observe the applied effort.
- Tokens come from native assistant `usage.totalTokens`. OMP computes monetary estimates from its
  catalog rates; these are not provider invoices. GLM Coding Plan currently reports zero monetary
  cost in the local catalog while consuming subscription quota. DeepSeek's overlay uses peak
  prices; off-peak billing differs. Neither figure should be treated as a quota ledger.
- The built-in OMP adapter still advertises a hardcoded concurrency ceiling of four. This is
  deployment policy, **not an observed provider limit**, and remains a constraint to revisit for
  larger swarms. Each member can retain its native harness's own delegation facilities.
- Custom model metadata is local configuration, not continuously refreshed capability discovery.
  Unsupported effort selections refuse before child creation. Legacy explicit catalog entries
  remain available but have not acquired new version-pinning guarantees.
- Runtime isolation uses the same OS user. It supplies private directories and projected
  credentials, not protection against a hostile same-user process. Credential redaction uses
  recognized key names; it is not a universal detector of secrets in arbitrary tool output.
- Provider-call observation/enforcement and tool-call enforcement remain unavailable. Native tool
  events and token usage are observable. The unreferenced `locallyReadyRoutes()` still contains
  stale compatibility-file readiness logic; current inventory uses `locallyConfiguredRoutes()`.

The live runs exposed and repaired a concurrent capacity-root creation race and npm executable
link rejection. Confined relative file links now retain package-relative behavior; directory,
absolute, dangling and escaping links remain refused. An obsolete dangling self-development
package link in this checkout was removed after confirming no target or active handles existed.

The original GLM-authored critique is preserved in commit `b7254e97`; this guide incorporates
parent review corrections. Focused checks and native receipts do not establish a green release:
the broader suite and CI still have existing failures.

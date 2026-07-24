# Baton MCP stdio — Run surface and advanced kernel compatibility

Run Baton as a standard MCP subprocess with a deployment-owned configuration factory:

```sh
node impl/scripts/mcp-stdio.mjs /absolute/path/to/baton-mcp.config.mjs
```

The module exports `default` or `createMcpServer()`. It may return an existing
`McpFleetServer`, or its constructor options:

```js
import { BatonApplication, createDriver } from '/absolute/path/to/baton/impl/src/index.mjs';
import { profiles, applicationPrincipals, authorizeApplication } from './baton-deployment.mjs';

export default async function createMcpServer() {
  const driver = createDriver({
    // repository, log, adapters, runtime isolation, and trust policy
    repoId: 'repo-id',
    // Optional Phase 38-39 authority; omission disables reuse decisions/rechecks.
    reuseDecisionPolicy: {
      authorize: ({ actor, repoId }) => actor === 'mcp:operator:local-mcp-host' && repoId === 'repo-id',
      authorizeRecheck: ({ actor, repoId }) => actor === 'mcp:operator:local-mcp-host' && repoId === 'repo-id',
      maxNeedBytes: 2048,
      maxRationaleBytes: 8192,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-id',
    profiles,
    principals: applicationPrincipals,
    authorize: authorizeApplication,
  });
  return {
    coordinator: driver.coordinator,
    coordination: driver.coordination,
    application,
    // Application-backed servers default to the eleven-tool Run surface.
    // Use `advanced` or `combined` only for an explicit kernel-control deployment.
    surface: 'application',
    principal: {
      userId: 'operator',
      sessionId: 'local-mcp-host',
      capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
      repoIds: ['repo-id'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
    },
    // Host lifecycle authority, never a remotely callable MCP tool.
    shutdownPrincipal: {
      actor: 'mcp-host:local',
      principalId: 'mcp-host',
      sessionId: 'local-mcp-host',
    },
    repoIds: ['repo-id'],
    // Derive this from the embedding host's accepted frame/memory budget.
    maxMessageBytes: 64 * 1024,
    // Derive this decision from the deployment's account/seat/request budget.
    takeToolQuota: ({ userId, tool, repoId }) => ({ ok: true }),
  };
}
```

Do not place bearer tokens or provider credentials in MCP tool arguments or the command
line. The host factory owns credential projection, fixed principal identity, quota policy,
adapter construction, immutable Run profiles, and application principals. `fleet_run_start`
selects the exact `harness`/`model`/`effort` tuple from an allowed profile; the application and
coordinator remain the only workflow and fleet authorities.

The default application-backed inventory is exactly eleven tools: `fleet_run_start`,
`fleet_run_status`, `fleet_run_approve`, `fleet_run_wait`, `fleet_run_answer`, and
`fleet_run_steer`, plus `fleet_run_stop`, `fleet_run_evidence`, and `fleet_run_adopt`. Steering resolves Run ownership and the current worker
fence inside the application. Stop durably closes only that Run to later effects and returns its
exact reap receipt. Evidence is a fresh read; adoption selects an exact protected result and
requires `adopt_result` without merging or publishing. `fleet_run_review` selects a deployment-pinned
exact independent reviewer route and consumes `review`; `fleet_run_integrate` binds a fresh evidence
manifest and consumes the separate `integrate_result` authority for one profile-allowed local
strategy. Neither operation publishes or deploys. The surface does not advertise deployment shutdown, Run close, worker kill, or
fleet drain. The original nineteen
`fleet_*` kernel tools remain available only through an explicit `surface: 'advanced'`; a
`combined` inventory is opt-in for diagnosis and migration. An application-free factory is
therefore an advanced-kernel-only deployment, not the ordinary Baton experience.

The application-backed inventory also exposes the reflexive orchestration surface as 21
`baton_*` tools: the worker decision channel (`baton_decision_list`, `baton_decision_answer`),
durable boards (`baton_board_post`, `baton_board_read`, `baton_board_retitle`,
`baton_board_reorder`, `baton_board_close`), context packages (`baton_package_attach`,
`baton_package_admit`, `baton_package_read`), `baton_context_eval`, and the embedding-grade
run projections (`baton_run_start`, `baton_runs`, `baton_run_inspect`, `baton_run_act`,
`baton_run_episode`, `baton_run_workstreams`, `baton_run_stop`, `baton_workstream_notify`,
`baton_workstream_stop`, `baton_help`). The worker scratchpad (issue #33) is deliberately not
an MCP tool: workers write it through the REFLEX-1-family up-channel inside their own harness
streams and receive hub-computed receipts; orchestrators read it through Run and wave
projections.

Since M4b the ordinary `baton_*` table renders the canonical grammar tools beside these retained
legacy spellings (both reach one operation). The inventory below is rendered from
`APPLICATION_SEMANTIC_REGISTRY.canonicalOperations` by `impl/scripts/render-surface-docs.mjs`; the
conformance suite fails if it drifts.

<!-- BEGIN GENERATED: mcp-tool-inventory (impl/scripts/render-surface-docs.mjs) -->

| Operation | Profile | MCP tool | Annotation |
|---|---|---|---|
| `run.list` | `ordinary` | `baton_run_list` | idempotent |
| `run.start` | `ordinary` | `baton_run_start` | idempotent |
| `run.view` | `ordinary` | `baton_run_view` | idempotent |
| `run.watch` | `ordinary` | `baton_run_watch` | idempotent |
| `run.do` | `ordinary` | `baton_run_do` | destructive |
| `run.approve` | `ordinary` | `baton_run_approve` | idempotent |
| `run.answer` | `ordinary` | `baton_run_answer` | idempotent |
| `run.send` | `ordinary` | `baton_run_send` | idempotent |
| `run.interrupt` | `ordinary` | `baton_run_interrupt` | destructive |
| `run.stop` | `ordinary` | `baton_run_stop` | destructive |
| `run.evidence` | `ordinary` | `baton_run_evidence` | idempotent |
| `run.review` | `ordinary` | `baton_run_review` | idempotent |
| `run.adopt` | `ordinary` | `baton_run_adopt` | idempotent |
| `run.integrate` | `ordinary` | `baton_run_integrate` | destructive |
| `run.export` | `ordinary` | `baton_run_export` | idempotent |
| `run.select` | `ordinary` | `baton_run_select` | idempotent |
| `run.feedback` | `ordinary` | `baton_run_feedback` | idempotent |
| `run.revise` | `ordinary` | `baton_run_revise` | idempotent |
| `run.recover` | `ordinary` | `baton_run_recover` | idempotent |
| `run.resume` | `ordinary` | `baton_run_resume` | idempotent |
| `run.retry` | `ordinary` | `baton_run_retry` | idempotent |
| `run.member.view` | `ordinary` | `baton_run_member_view` | idempotent |
| `run.member.send` | `ordinary` | `baton_run_member_send` | idempotent |
| `run.member.interrupt` | `ordinary` | `baton_run_member_interrupt` | destructive |
| `run.member.stop` | `ordinary` | `baton_run_member_stop` | destructive |
| `run.attention.list` | `ordinary` | `baton_run_attention_list` | idempotent |
| `context.eval` | `ordinary` | `baton_context_eval` | idempotent |
| `context.map` | `ordinary` | `baton_context_map` | idempotent |
| `context.reduce` | `ordinary` | `baton_context_reduce` | idempotent |
| `context.retry` | `ordinary` | `baton_context_retry` | idempotent |
| `board.post` | `ordinary` | `baton_board_post` | idempotent |
| `board.retitle` | `ordinary` | `baton_board_retitle` | idempotent |
| `board.reorder` | `ordinary` | `baton_board_reorder` | idempotent |
| `board.close` | `ordinary` | `baton_board_close` | idempotent |
| `board.read` | `ordinary` | `baton_board_read` | idempotent |
| `board.claim` | `worker` | `baton_board_claim` | idempotent |
| `board.report` | `worker` | `baton_board_report` | idempotent |
| `package.admit` | `ordinary` | `baton_package_admit` | idempotent |
| `package.attach` | `ordinary` | `baton_package_attach` | idempotent |
| `package.read` | `ordinary` | `baton_package_read` | idempotent |
| `application.help` | `ordinary` | `baton_application_help` | idempotent |

<!-- END GENERATED: mcp-tool-inventory -->


Among the advanced tools, `fleet_reuse_decide` accepts a bounded `borrow|build`
judgment, exact `reuse.vet` and `provenance.sbom` claims/arguments, and optional
validity-version supersession. Baton freshly reverifies both artifacts and requires the configured
clean repository identity. It never installs a package, mutates a lockfile, merges code, or accepts
a caller-supplied actor. `fleet_reuse_recheck` accepts only an exact decision/version and
`advisory_refresh|ttl_expired`: advisory facts are derived by a Coordinator-forced official refresh,
and TTL uses the immutable stored expiry. An adverse refresh fences the exact coordinate and
invalidates all matching live Decisions atomically; it grants no package or code authority.

`fleet_drain` is not `application.shutdown`: it reaps coordinator-owned workers while retaining
the MCP transport and writer authority. The process-owning host must call
`application.shutdown` during its own bounded finalization and signal handling. The packaged stdio
host does so on EOF, `SIGINT`, and `SIGTERM` using the injected `shutdownPrincipal`; a failed shutdown
is visible to the host and retryable.

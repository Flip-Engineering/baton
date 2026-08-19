# Baton Unified Control Surface

Baton exposes one categorized capability catalogue over the existing application semantic registry, CLI parser/Web client, MCP tool inventories, Web admission table, coordinator, coordination store and embedded runtime. The unification layer is an additive adapter and audit; it does not replace, duplicate or narrow those authorities.

## Categories

Every capability is assigned one or more presentation categories:

- `control`
- `observation`
- `telemetry`
- `communication`
- `task_management`
- `knowledge`
- `diagnostics`
- `notifications`

The categories do not create new execution semantics. Application rows retain their existing schema, capabilities, effect, profile, authority fields, server-derived fields, aliases and live handler. MCP-native rows are derived from `mcpCombinedToolNames()`, not from a replacement tool list. Direct Web reachability is derived from `webAdmittedCommandNames()`. Existing CLI exceptions remain explicit.

The catalogue includes canonical application operations, legacy aliases, native fleet/kernel MCP tools, board/package/REPL/knowledge tools, host-local CLI operations, embedded-only worker/kernel primitives, and the unified meta operations themselves.

Capability-name resolution is deterministic: an exact canonical capability identity outranks a transport spelling, which outranks a compatibility alias. Equal-authority collisions fail the surface gate. The one stale `baton_decision_list` registry alias is corrected from the live `McpFleetServer` dispatch evidence to its existing `decision.list` owner; the correction is explicit and digest-bound rather than silently rewriting the underlying historical registry.

## CLI

```text
baton surface catalog [--category CATEGORY] [--surface cli|mcp|web|embedded] [--mode query|effect] [--owner OWNER]
baton surface describe NAME
baton surface invoke NAME --args JSON [--idempotency-key KEY] [--mcp-config PATH]
baton surface snapshot [--run-id RUN] [--wave-id WAVE] [--mcp-config PATH]
baton surface watch RUN_ID [--wave-id WAVE] [--after-cursor N] [--attention-cursor N] [--kind KIND] [--timeout MS] [--mcp-config PATH]
```

Application operations use the existing authenticated resident Web command plane when that command is actually admitted there. Exact legacy application commands such as `run.status`, `run.wait`, `run.episode` and `runs.list` retain their established connected CLI/Web path even when the exhaustive catalogue also sees them as live MCP transport rows. MCP-native and MCP-only application capabilities use `--mcp-config PATH`, or `BATON_MCP_CONFIG`, which opens the configured existing MCP authority and invokes the additive `baton_surface_invoke` adapter. The CLI never fabricates a Web route for a command that Baton's Web admission table does not serve.

An action advertised by a current Run is invoked by including its current `actionId` in `--args`. The adapter lowers it to the existing closed `run.do` shape:

```json
{
  "runId": "run:...",
  "actionId": "action:...",
  "otherInput": "..."
}
```

The remaining fields become the action's `inputs`. Baton does not invent or guess an action identifier.

`baton surface watch` is a bounded composite read, not a new event bus. On the connected CLI it waits through the existing `run.follow` command and then reads the established attention, Run, optional Wave, and decision-shaped attention projections. With `--mcp-config` it calls the same composed MCP tool against the configured existing application authority.

## MCP

Every wrapped MCP server advertises:

- `baton_surface_catalog`
- `baton_surface_describe`
- `baton_surface_invoke`
- `baton_surface_snapshot`
- `baton_surface_watch`

The standard `baton-mcp` entry defaults configuration modules to the existing complete `combined` profile. `baton-mcp-web` expands its legacy application bridge with an advanced shadow built from the same `McpFleetServer` constructor and the same coordinator/coordination/principal authorities. Existing direct tools remain available and retain their own schemas, capability checks, quotas, audits, fences and result projections.

`baton_surface_snapshot` is a bounded projection over existing readiness, active workers, route capability cards, provider telemetry, convergence scheduling, notification/collaboration state and optional Run/Wave views. It is not a second telemetry store.

`baton_surface_watch` composes the existing `run.follow`, `run.attention.watch`, `application.decisionList`, and optional `waves.progress` paths under the connected MCP principal. It preserves typed refusal behavior and requires monotonic attention cursors; a scope refusal or cursor rewind can never be converted into an empty success page.

## Capability preservation and boundaries

A capability may be reachable by:

1. a live direct canonical or legacy CLI/MCP transport;
2. an existing authenticated Web command used by the CLI;
3. an authorized current-Run `run.do` action;
4. an MCP descriptor used by the CLI for MCP-native or MCP-only capabilities;
5. `baton_surface_invoke` over the existing application or fleet/kernel authority;
6. a host-local CLI command where remote operation would be nonsensical or unsafe;
7. an embedded-only worker/kernel operation retained in the catalogue but not promoted into operator authority.

Host-local setup, credential installation and resident bootstrap are intentionally not remote MCP mutations. Worker-internal grant/fence operations and embedded-only kernel primitives remain scoped to their existing authority. Every existing **operator-facing** capability must be reachable through both CLI and MCP, while all embedded-only capabilities remain visible and explicitly classified rather than silently dropped.

## Security and error semantics

- Authentication, capabilities, repository scope, Run scope, fences, leases and application action authority remain server-derived.
- Generic invocation dispatches through existing application commands or existing MCP tools; it does not call around their validation.
- Caller identifiers remain selectors, not authority.
- Typed error code, message, detail, field, retryability and corrective action are preserved.
- Restricted or unavailable profiles refuse by name rather than silently returning an empty result.
- Attention cursors may not rewind silently.
- Cross-Run REPL citation is authorized before citation resolution.
- Catalogue corrections and shadowed compatibility aliases are visible in the machine audit and included in its digest.

# ROW BRIEF — row-mcp: audit the MCP northbound surface (issue #147)

Read `audit-brief.md` first (the shared frame: axes, laws, escalation posture, deliverable
shape). Your surface is the **MCP northbound** — the primary agent-facing surface per the
project's direction (MCP as primary, CLI as the human thin client).

## Your reading list (verify, then go where the evidence leads)

- `impl/src/mcp-northbound.mjs` — the surface itself (tool inventory, capability table,
  `toolError` shaping).
- `impl/MCP.md` — the generated surface doc (check it matches reality).
- `impl/scripts/baton-mcp.mjs` (or wherever the stdio entry lives — find it) — the transport
  posture (#138: stdio-only; no stateless HTTP endpoint).
- The wave verbs on MCP: `baton_waves_run` and friends — parity with the bus.

## Row-specific questions (in addition to the shared axes)

- Tool inventory vs capability: can an MCP agent do EVERYTHING the bus can (waves, workflows,
  run act/view, scratchpad, decisions)? Table the gaps.
- `toolError` quality: after #105, do error payloads ride typed lane codes with actionable
  detail? Sweep representative refusal paths.
- Discovery: does the MCP surface teach itself (tool descriptions, schema annotations)? What
  must the agent already know?
- Transport: what does stdio-only exclude (process-per-call harnesses)? What would a stateless
  HTTP endpoint need (sketch at design level; cite #138)?

Deliverable: `surface-audit-mcp.md` here (marker `SURFACE-AUDIT-ROW v1` on line 1) + the full
text posted to the `shared` scratchpad partition.

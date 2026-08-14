# ROW BRIEF — row-mcp-push: the MCP notification transport (#208 items 2-3)

Deliverable: implementation + red-first pin suite.

## Anchors

- impl/src/mcp-northbound.mjs — the McpFleetServer request path; MCP server→client
  notifications are protocol-legal and UNUSED today.
- impl/src/mcp-web-bridge.mjs — the web-backed server construction (the push must ride the
  SAME connection the harness opened, not a new channel).
- The resident's coordination store event stream — the truth source the push folds.

## Contract (closed)

1. An MCP host holding an active waves.attention.watch receives server→client MCP
   notifications carrying the aggregate (coalesced: at most one per waveId+attention-shape
   per delivery window derived from observed notification cadence — never a fixed clock;
   coalescing merges, never drops the terminal shape).
2. Telemetry class: member spawn/stall/death transitions and drive verdicts ride the SAME
   notification lane (attention-kind discriminator), so the orchestrator harness gets
   interrupt-grade visibility without polls.
3. Transport-honest fallback: a connection that cannot receive notifications (client did
   not advertise the capability) degrades to the watch's pull-on-open, honestly reported
   at subscribe time — never silent loss.
4. Red-first pin impl/test/mcp-attention-push-red.test.mjs: a fake client advertising the
   notification capability receives the aggregate on member input_required (RED at
   pre-change head: no push).

## Hard bounds

Additive; no protocol violations (capability-gated); no new store surfaces; batteries green.

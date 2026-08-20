# ROW — #242 fulfillment: the TUI seat + MCP tool wiring (baton-top.mjs + the meta tool)

Specs ON MASTER: impl/test/baton-top.test.mjs (70 lines) + impl/test/mcp-visualization.test.mjs
(80 lines) + docs/38. Read all three first.

Deliverable A — impl/src/baton-top.mjs (exports BATON_TOP_HELP, parseBatonTopCli,
runBatonTop, respondToVisualAttention):
1. parseBatonTopCli: non-'top' argv → null (never swallows normal CLI); 'top RUN_ID
   --wave-id W --view V --refresh N --no-motion' → the exact pinned shape; 'top --plain'
   → {once:true, plain:true, motion:false, color:false, view:'overview', refreshMs:1000};
   'top --help' → kind 'top_help'. BATON_TOP_HELP mentions 'Worker/provider prose'.
2. runBatonTop(parsed, { client, stdout, stdin, clock }): non-TTY → ONE stable frame via
   client.surfaceSnapshot({runId, waveId}) rendered through visual-renderer's
   renderBatonVisual (no ANSI in non-TTY), stdout written once, returns { run } carrying
   model.run. No polling loop when once or non-TTY.
3. respondToVisualAttention(client, model, index, decision): lowers ONLY through
   client.command('run.answer', { runId, requestId, answer: { decision } }) for the
   model.attention[index] item; empty attention → typed error code
   'visual_action_unavailable'.
Deliverable B — the MCP tool (impl/src/production-mcp-convergence.mjs +
surface-capability-resolution.mjs): add 'baton_surface_visualize' to the meta tools
(UNIFIED_MCP_META_TOOL_DEFINITIONS): read-only meta tool composing
baton_surface_snapshot + baton_surface_watch, args {view, runId?, waveId?, width?,
follow?, afterCursor?, attentionCursor?, kind?, timeoutMs?}; follow without runId refuses
typed 'surface_visualization_invalid'; result { structuredContent: { kind:
'baton.surface_visualization', model, presentation } , content[0].text = static rendering
ANSI-free }. The mcp-visualization pin's rawServer fixture shows the exact seams
(deployment.doctor, run.inspect, run.follow, run.attention.watch, waves.progress,
coordinator._story).
Batteries: mcp-visualization 2/2, baton-top 3/3 (needs visual-model+renderer siblings —
verify integration when they land; your unit-verified exports stand alone).
CLI wiring (impl/scripts/baton.mjs + application-cli): route argv[0]==='top' to
runBatonTop through the resident client — the CLI parse branch.
Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/baton-top.mjs, impl/src/production-mcp-convergence.mjs,
impl/src/surface-capability-resolution.mjs, impl/src/application-cli.mjs,
impl/scripts/baton.mjs, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-d/notes-row-visual-tui-mcp.md

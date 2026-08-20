# ROW — #242 fulfillment: the visual RENDERER + MCP presentation (impl/src/visual-renderer.mjs)

The spec is ON MASTER: impl/test/visual-renderer.test.mjs (55 lines, 3 tests, RED via
MODULE_NOT_FOUND) + docs/38-flip-visual-surfaces.md §Presentation laws P1-P5. Read BOTH
first. NOTE: row-visual-model is a sibling in this wave — visual-renderer imports
projectBatonVisualModel from ../src/visual-model.mjs. If that module does not exist yet
when you start, write the renderer against its OWN contract (the pin builds models via
the sibling's function; your module must export batonVisualWidth, renderBatonVisual,
createBatonMcpPresentation) and verify with the pin when the sibling lands. Prefer
STARTING with visual-renderer's own pure functions (batonVisualWidth = display width
respecting wide chars) so integration risk is low.

Deliverable: implement to satisfy the 3 pins EXACTLY:
1. responsive never-exceeds-width: renderBatonVisual(model, { width, color, motion })
   fits widths 40/58/84/118/160 (every line batonVisualWidth ≤ width), contains 'baton top'
   and 'What is happening' (the overview header + narrative section).
2. distinct views: topology view contains 'Fleet graph' and 'coordinates'; timeline view
   contains 'prose' and '‹The layout is ready.›' (worker prose in angle delimiters);
   telemetry view contains 'Route readiness'.
3. MCP presentation: createBatonMcpPresentation(model, { width }) → kind
   'baton.visual_presentation', animation.frames.length 4 (Flip sparkle frames — P4: four
   low-amplitude frames), refresh.tool='baton_surface_visualize' with
   refresh.arguments.{runId, follow:true}, text ANSI-free, accessibleSummary matches the
   run narrative.
Views: overview (story narrative + run spine + fleet roster + attention + pulse),
topology, timeline, telemetry. Non-color mode = no ANSI at all. Header carries 'baton top'.
node --test test/visual-renderer.test.mjs → 3/3 (when sibling lands).
Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/visual-renderer.mjs, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-d/notes-row-visual-renderer.md

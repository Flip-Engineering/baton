import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectBatonVisualModel } from '../src/visual-model.mjs';
import { batonVisualWidth, createBatonMcpPresentation, renderBatonVisual } from '../src/visual-renderer.mjs';

const snapshot = {
  doctor: { ok: true, value: { ready: true, routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high', state: 'ready' }] } },
  run: { ok: true, value: {
    runId: 'run:render', phase: 'working', objective: 'Render responsive terminal feedback',
    narrative: 'Flip is quietly keeping an eye on one active worker.', progress: { current: 'execute' },
    workstreams: [{ workerId: 'worker:render', role: 'renderer', state: 'working', route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' } }],
    attention: [{ id: 'request:1', requestId: 'request:1', runId: 'run:render', kind: 'approval', requiredAction: 'answer', prompt: 'Allow rendering?' }],
  } },
  convergence: { scheduler: { active: [{ lane: 'interactive_control' }], queued: { background_reconcile: 1 } } },
};
const watch = { follow: { events: [{ seq: 4, kind: 'content.message', actor: 'worker', workerId: 'worker:render', message: 'The layout is ready.' }] } };

function model(width, view = 'overview') {
  return projectBatonVisualModel({ snapshot, watch, width, view, now: 1_700_000_000_000 });
}

test('responsive renderer never exceeds the requested terminal width', () => {
  for (const width of [40, 58, 84, 118, 160]) {
    const output = renderBatonVisual(model(width), { width, color: false, motion: false });
    for (const line of output.trimEnd().split('\n')) {
      assert.ok(batonVisualWidth(line) <= width, `${width}: ${batonVisualWidth(line)} ${line}`);
    }
    assert.match(output, /baton top/u);
    assert.match(output, /What is happening/u);
  }
});

test('renderer provides distinct topology, timeline and telemetry views with provenance labels', () => {
  const graph = renderBatonVisual(model(100, 'topology'), { width: 100, view: 'topology', motion: false });
  const timeline = renderBatonVisual(model(100, 'timeline'), { width: 100, view: 'timeline', motion: false });
  const telemetry = renderBatonVisual(model(100, 'telemetry'), { width: 100, view: 'telemetry', motion: false });
  assert.match(graph, /Fleet graph/u);
  assert.match(graph, /coordinates/u);
  assert.match(timeline, /prose/u);
  assert.match(timeline, /‹The layout is ready\.›/u);
  assert.match(telemetry, /Route readiness/u);
});

test('MCP presentation carries static text, optional animation frames and refresh arguments', () => {
  const value = model(96);
  const presentation = createBatonMcpPresentation(value, { width: 96 });
  assert.equal(presentation.kind, 'baton.visual_presentation');
  assert.equal(presentation.animation.frames.length, 4);
  assert.equal(presentation.refresh.tool, 'baton_surface_visualize');
  assert.equal(presentation.refresh.arguments.runId, 'run:render');
  assert.equal(presentation.refresh.arguments.follow, true);
  assert.equal(presentation.text.includes('\u001b'), false);
  assert.match(presentation.accessibleSummary, /Flip is quietly/u);
});

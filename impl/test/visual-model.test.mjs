import { test } from 'node:test';
import assert from 'node:assert/strict';

import { projectBatonVisualModel } from '../src/visual-model.mjs';

function fixture() {
  return {
    snapshot: {
      source: 'cli_authenticated_web',
      doctor: { ok: true, value: {
        ready: true,
        deployment: { deploymentId: 'deployment:a', incarnation: 'incarnation:1' },
        routes: [
          { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high', state: 'ready' },
          { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high', state: 'blocked', summary: 'authentication_required' },
        ],
      } },
      run: { ok: true, value: {
        runId: 'run:a', phase: 'working', objective: 'Implement the visual surface',
        narrative: 'Two workers are implementing and reviewing the visual surface.',
        progress: { current: 'execute' },
        attention: [{ id: 'request:approval', requestId: 'request:approval', kind: 'approval', requiredAction: 'answer', prompt: 'Allow the next effect?' }],
        workstreams: [
          { workerId: 'worker:alpha', role: 'implementer', state: 'working', task: { objective: 'Implement renderer' }, route: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }, budgetUsed: { tokens: 50 }, budget: { tokens: 100 }, pathScope: ['impl/src/**'] },
          { workerId: 'worker:beta', role: 'reviewer', state: 'blocked', task: { objective: 'Review accessibility' }, route: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }, warnings: ['approval_required'] },
        ],
      } },
      convergence: { scheduler: { active: [{ lane: 'interactive_control' }], queued: { background_reconcile: 2 } } },
      story: { narrative: 'The existing story compiler reports one active implementation and one blocked review.', signals: [{ type: 'blocked', worker: 'worker:beta' }] },
    },
    watch: {
      source: 'cli_authenticated_web', runId: 'run:a', nextAfterCursor: 8, nextAttentionCursor: 3,
      follow: { events: [
        { seq: 7, kind: 'content.message', actor: 'worker', workerId: 'worker:alpha', message: '\u001b[31mI changed the renderer.\u001b[0m' },
        { seq: 8, kind: 'verify.reverified', actor: 'baton', workerId: 'worker:alpha', summary: 'Focused renderer tests passed.' },
      ] },
      attention: { ok: true, value: { throughCursor: 3, reasons: [
        { id: 'request:approval', requestId: 'request:approval', runId: 'run:a', kind: 'approval', requiredAction: 'answer', prompt: 'Allow the next effect?' },
      ] } },
    },
  };
}

test('visual model composes existing Run, story, attention, telemetry and topology projections', () => {
  const model = projectBatonVisualModel({ ...fixture(), width: 118, now: 1_700_000_000_000 });
  assert.equal(model.kind, 'baton.visual_model');
  assert.equal(model.run.runId, 'run:a');
  assert.equal(model.story.source, 'story_compiler');
  assert.equal(model.fleet.members.length, 2);
  assert.equal(model.fleet.counts.active, 1);
  assert.equal(model.attention.length, 1);
  assert.equal(model.attention[0].respondable, true);
  assert.equal(model.controls.approvals[0].allow.command, 'run.answer');
  assert.equal(model.controls.takeover.available, false);
  assert.ok(model.topology.edges.some((edge) => edge.relation === 'uses'));
  assert.equal(model.telemetry.routes.length, 2);
  assert.equal(model.cursors.after, 8);
  assert.match(model.fingerprint, /^[a-f0-9]{64}$/u);
});

test('visual model keeps worker prose visibly untrusted and strips terminal control bytes', () => {
  const model = projectBatonVisualModel({ ...fixture(), width: 90 });
  const workerEvent = model.timeline.find((item) => item.actor === 'worker');
  assert.equal(workerEvent.provenance, 'worker_prose');
  assert.equal(workerEvent.summary, 'I changed the renderer.');
  assert.equal(JSON.stringify(model).includes('\u001b'), false);
  assert.equal(model.provenance.workerProse > 0, true);
});

test('visual model remains bounded and deterministic under oversized projection input', () => {
  const data = fixture();
  data.snapshot.run.value.workstreams = Array.from({ length: 100 }, (_, index) => ({
    workerId: `worker:${String(index).padStart(3, '0')}`, state: 'working',
  }));
  data.watch.follow.events = Array.from({ length: 100 }, (_, index) => ({
    seq: index + 1, kind: 'content.message', actor: 'worker', message: `event ${index}`,
  }));
  const left = projectBatonVisualModel({ ...data, width: 80, now: 1234 });
  const right = projectBatonVisualModel({ ...data, width: 80, now: 1234 });
  assert.equal(left.fleet.members.length, 64);
  assert.equal(left.timeline.length, 64);
  assert.equal(left.fingerprint, right.fingerprint);
});

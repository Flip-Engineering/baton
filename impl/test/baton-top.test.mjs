import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BATON_TOP_HELP, parseBatonTopCli, respondToVisualAttention, runBatonTop,
} from '../src/baton-top.mjs';
import { projectBatonVisualModel } from '../src/visual-model.mjs';

function output() {
  return {
    isTTY: false, columns: 72, value: '',
    write(chunk) { this.value += String(chunk); return true; },
  };
}

test('baton top parser exposes responsive and accessibility controls without swallowing normal CLI', () => {
  assert.equal(parseBatonTopCli(['run', 'status']), null);
  assert.deepEqual(parseBatonTopCli(['top', 'run:a', '--wave-id', 'wave:a', '--view', 'topology', '--refresh', '500', '--no-motion']), {
    kind: 'top', runId: 'run:a', waveId: 'wave:a', view: 'topology', refreshMs: 500,
    width: null, once: false, plain: false, motion: false, color: true,
  });
  assert.deepEqual(parseBatonTopCli(['top', '--plain']), {
    kind: 'top', runId: null, waveId: null, view: 'overview', refreshMs: 1000,
    width: null, once: true, plain: true, motion: false, color: false,
  });
  assert.equal(parseBatonTopCli(['top', '--help']).kind, 'top_help');
  assert.match(BATON_TOP_HELP, /Worker\/provider prose/u);
});

test('non-TTY baton top emits one stable frame from the existing snapshot seam', async () => {
  const stdout = output();
  const calls = [];
  const client = {
    async surfaceSnapshot(args) {
      calls.push(args);
      return {
        doctor: { ok: true, value: { ready: true } },
        run: { ok: true, value: { runId: 'run:a', phase: 'working', objective: 'Observe', narrative: 'One worker is active.', workstreams: [] } },
      };
    },
  };
  const result = await runBatonTop(parseBatonTopCli(['top', 'run:a', '--once']), {
    client, stdout, stdin: { isTTY: false }, clock: () => 1_700_000_000_000,
  });
  assert.deepEqual(calls, [{ runId: 'run:a', waveId: null }]);
  assert.equal(result.run.runId, 'run:a');
  assert.match(stdout.value, /baton top/u);
  assert.equal(stdout.value.includes('\u001b'), false);
});

test('TUI approval keys lower only through the existing run.answer command', async () => {
  const model = projectBatonVisualModel({
    snapshot: { run: { ok: true, value: {
      runId: 'run:a', phase: 'blocked', attention: [{
        id: 'request:a', requestId: 'request:a', runId: 'run:a',
        kind: 'approval', requiredAction: 'answer', prompt: 'Allow?',
      }],
    } } },
    width: 80,
  });
  const calls = [];
  const client = { async command(...args) { calls.push(args); return { phase: 'working' }; } };
  await respondToVisualAttention(client, model, 0, 'allow');
  assert.equal(calls[0][0], 'run.answer');
  assert.deepEqual(calls[0][1], {
    runId: 'run:a', requestId: 'request:a', answer: { decision: 'allow' },
  });
  await assert.rejects(respondToVisualAttention(client, { attention: [] }, 0, 'deny'),
    (error) => error.code === 'visual_action_unavailable');
});

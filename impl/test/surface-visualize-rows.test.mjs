import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wrapProductionCliClient } from '../src/production-cli-convergence.mjs';
import { projectBatonVisualModel } from '../src/visual-model.mjs';
import { createBatonMcpPresentation } from '../src/visual-renderer.mjs';

const THINKING_FACE = '✦(◕﹏◕)◦';

/** Every object key path in a decoded JSON value. */
function keyPaths(value, prefix = '') {
  const paths = [];
  if (Array.isArray(value)) {
    value.forEach((item) => paths.push(...keyPaths(item, prefix)));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      paths.push(`${prefix}.${key}`);
      paths.push(...keyPaths(item, `${prefix}.${key}`));
    }
  }
  return paths;
}

/** True when a JSON key is a persona field: named for a pose or the persona itself. */
function isPersonaKey(key) {
  const segment = key.split('.').pop() ?? '';
  return segment === 'pose' || segment === 'persona'
    || segment.startsWith('pose') || segment.startsWith('persona')
    || /persona/i.test(segment);
}

/** The swarm-family client stub: the same bounded slices the read seam asks for. */
function swarmClient() {
  return {
    async command(name, args) {
      if (name === 'swarm.list') {
        return [{ swarmId: 'swarm:s1', purpose: 'ship the row', status: 'open' }];
      }
      if (name === 'swarm.view' && args.projection === 'participants') {
        return {
          swarmId: 'swarm:s1', status: 'open', seq: 7, ts: '2026-09-14T00:00:07Z', cursor: 41,
          participants: [
            { participantId: 'flip1', role: 'pilot', status: 'active', seq: 5, ts: '2026-09-14T00:00:05Z', runId: 'run:a', runtime: { state: 'working', turn: 'running' } },
          ],
        };
      }
      if (name === 'swarm.view' && args.projection === 'attention') {
        return { swarmId: 'swarm:s1', attention: [] };
      }
      throw Object.assign(new Error(`unknown command ${name}`), { code: 'cli_command_unavailable' });
    },
    async doctor() {
      return {
        ready: true,
        deployment: { deploymentId: 'dep:1' },
        routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high', state: 'ready' }],
        application: { resident: { deploymentId: 'dep:1', incarnation: 'inc:1', transport: 'local', startedAt: 't0' } },
      };
    },
  };
}

test('baton_surface_visualize serves the same swarm family rows the operator seat renders', async () => {
  const client = wrapProductionCliClient(swarmClient());
  const result = await client.surfaceVisualize({ view: 'overview', width: 100 });
  assert.equal(result.kind, 'baton.surface_visualization');
  // The resident row.
  assert.equal(result.model.resident.deploymentId, 'dep:1');
  assert.equal(result.model.resident.state, 'ready');
  // The swarm rows: state and last wake, verbatim from the same family read the seat makes.
  const [swarm] = result.model.swarm.swarms;
  assert.equal(swarm.swarmId, 'swarm:s1');
  assert.equal(swarm.status, 'open');
  assert.equal(swarm.lastSeq, 7);
  assert.equal(swarm.participants[0].participantId, 'flip1');
  assert.equal(swarm.participants[0].state, 'working');
  assert.equal(swarm.participants[0].lastSeq, 5);
  // The static rendering shows the same rows.
  assert.match(result.presentation.text, /Swarm family/u);
  assert.match(result.presentation.text, /swarm:s1  open  ship the row  last wake #7/u);
  assert.match(result.presentation.text, /flip1  pilot  ◐ working  last wake #5/u);
});

test('the visualization payload carries no persona field anywhere', async () => {
  const client = wrapProductionCliClient(swarmClient());
  const result = await client.surfaceVisualize({ view: 'overview', width: 100 });
  // No structured field is named for a pose or a persona.
  assert.deepEqual(keyPaths(result).filter(isPersonaKey), []);
  // No retired pose face appears anywhere in the payload, text included.
  assert.equal(JSON.stringify(result).includes(THINKING_FACE), false);
  // The model is the shared projection: the same guarantee holds for the MCP presentation.
  const model = projectBatonVisualModel({
    snapshot: {},
    swarm: { swarms: [{ swarmId: 'swarm:s1', status: 'open', participants: [] }], attention: [], unavailable: null },
    wakes: { attached: true, items: [{ seq: 1, wakeClass: 'attention', subject: 'request:1' }] },
  });
  assert.deepEqual(keyPaths(model).filter(isPersonaKey), []);
  const presentation = createBatonMcpPresentation(model, { width: 80 });
  assert.deepEqual(keyPaths(presentation).filter(isPersonaKey), []);
  assert.equal(JSON.stringify(presentation).includes(THINKING_FACE), false);
});

test('the swarm family unavailability is a named truth in the visualization, not a blank', async () => {
  const bare = {
    async command() {
      throw Object.assign(new Error('swarm.list is not served here'), { code: 'cli_command_unavailable' });
    },
    async doctor() { return { ready: true, routes: [] }; },
  };
  const client = wrapProductionCliClient(bare);
  const result = await client.surfaceVisualize({ view: 'overview', width: 80 });
  assert.equal(result.model.swarm.swarms.length, 0);
  assert.equal(result.model.swarm.unavailable.code, 'cli_command_unavailable');
  assert.match(result.presentation.text, /swarm family unavailable: cli_command_unavailable/u);
});

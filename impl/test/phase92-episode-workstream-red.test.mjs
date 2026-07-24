// Phase 92 RED contracts: one progressive Episode projection and durable semantic workstream
// handles. These fixtures prove API shape and projection behavior only; they are not live-provider
// evidence and do not prove operating-system PID liveness.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY, BatonRun, operatorAsset,
  parseBatonCli,
} from '../src/index.mjs';

function port() {
  const calls = [];
  const command = async (name, args) => {
    calls.push({ name, args });
    if (name === 'application.help') {
      return { schemaVersion: 1, topic: args.topic, depth: args.depth, links: [] };
    }
    if (name === 'run.workstream.stop') {
      return { schemaVersion: 1, runId: args.runId, terminal: true };
    }
    if (name === 'run.workstream.notify') {
      return { schemaVersion: 1, runId: args.runId, outline: { actions: [] } };
    }
    if (name === 'run.workstreams' && args.role === undefined) {
      return {
        schemaVersion: 1, runId: args.runId,
        section: { id: 'workstreams', items: [{
          id: 'workstream:reviewer', section: 'workstreams', state: 'running',
          summary: 'Reviewer workstream', value: { role: 'reviewer', generation: 1 },
        }] },
      };
    }
    if (name === 'run.workstreams' && args.role === 'reviewer') {
      return {
        schemaVersion: 1, runId: args.runId,
        item: {
          id: `workstream:${args.role}`, section: 'workstreams', state: 'running',
          value: { role: 'reviewer', generation: args.generation ?? 1 },
        },
      };
    }
    if (name === 'run.episode') {
      const item = `episode:${args.topic}${args.role ? `:${args.role}` : ''}${args.generation ? `:g${args.generation}` : ''}`;
      return {
        schemaVersion: 1, runId: args.runId,
        item: { id: item, section: 'episode', value: args.topic === 'result' ? null : {} },
        ...(args.topic === 'result'
          ? { state: 'pending', settled: false, continuation: {
            operation: 'run.view', arguments: { ...args, cursor: 7 },
          } }
          : args.topic === 'output'
          ? { content: { kind: 'baton.episode.output', items: [], nextOffset: null } }
          : {}),
      };
    }
    throw new Error(`unexpected inspection ${JSON.stringify(args)}`);
  };
  return { calls, command };
}

test('P92-EW1: the registry advertises first-class Episode and workstream commands', () => {
  const sections = new Map(APPLICATION_SEMANTIC_REGISTRY.sections.map((entry) => [entry.id, entry]));
  assert.equal(sections.has('episode'), true);
  assert.equal(sections.has('workstreams'), true);
  assert.match(sections.get('episode').summary, /evidence-backed|authoritative/iu);
  assert.match(sections.get('workstreams').summary, /semantic|durable/iu);
  for (const command of [
    'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop',
  ]) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, command), true, command);
    assert.equal(APPLICATION_COMMAND_DEFINITIONS[command].web, true, command);
    assert.equal(APPLICATION_COMMAND_DEFINITIONS[command].mcp, true, command);
  }
});

test('P92-EW2: one Run exposes semantic generation handles and the complete Episode vocabulary', async () => {
  const application = port();
  const run = new BatonRun(application, 'run-phase92');
  const listed = await run.workstreams().list();
  assert.equal(listed.section.items[0].id, 'workstream:reviewer');

  const workstream = run.workstreams().open('reviewer');
  assert.equal(workstream.id, 'workstream:reviewer');
  assert.equal((await workstream.open()).item.value.role, 'reviewer');
  await workstream.notify('Check the accepted result lineage.');
  await workstream.stop();
  const pending = await workstream.result();
  assert.equal(pending.item.id, 'episode:result:reviewer');
  assert.equal(pending.state, 'pending');
  assert.equal(pending.settled, false);
  assert.equal(pending.continuation.operation, 'run.view');
  assert.equal((await workstream.help()).topic, 'run.workstreams');

  const episode = workstream.episode();
  for (const topic of [
    'outline', 'sources', 'derivations', 'contradictions', 'trace', 'route',
    'verification', 'result', 'cleanup',
  ]) {
    const value = await episode[topic]();
    assert.equal(value.item.id, `episode:${topic}:reviewer`, topic);
  }
  assert.equal((await episode.output()).content.kind, 'baton.episode.output');
  await episode.output({ pageCursor: 'page_2' });
  await episode.sources({ detail: 'evidence' });
  await episode.help({ detail: 'content' });
  const continuationCalls = application.calls.filter((call) => call.name === 'run.episode').slice(-2);
  assert.equal(continuationCalls[0].args.detail, 'evidence');
  assert.equal(continuationCalls[1].args.detail, 'content');
  assert.equal((await episode.help()).item.id, 'episode:help:reviewer');

  const predecessor = run.workstreams().open('reviewer', 1);
  assert.equal(predecessor.id, 'workstream:reviewer:g1');
  await predecessor.open();
  assert.equal(application.calls.at(-1).args.generation, 1);

  const serializedCalls = JSON.stringify(application.calls);
  for (const hidden of ['workerId', 'taskId', 'fence', 'receipt', 'socketPath', 'tokenFile']) {
    assert.equal(serializedCalls.includes(hidden), false, hidden);
  }
  assert.equal(application.calls.some((call) => call.name === 'run.inspect'), false);
});

test('P92-EW3: terminal run.stop derives its safe reason when the terminal omits --reason', () => {
  const parsed = parseBatonCli(['run', 'stop', 'run-phase92']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'run.stop');
  assert.deepEqual(parsed.args, {
    runId: 'run-phase92', reason: 'Operator requested Run stop.',
  });
  assert.match(parsed.idempotencyKey, /^[0-9a-f-]{36}$/iu);
});

test('P92-EW4: CLI exposes selector-free Episode and workstream commands', () => {
  assert.deepEqual(parseBatonCli(['run', 'episode', 'run-phase92', 'trace', '--workstream', 'reviewer', '--generation', '2', '--evidence']).args, {
    runId: 'run-phase92', topic: 'trace', role: 'reviewer', generation: 2, detail: 'evidence',
  });
  assert.deepEqual(parseBatonCli(['run', 'workstreams', 'run-phase92', 'reviewer']).args, {
    runId: 'run-phase92', role: 'reviewer',
  });
  assert.deepEqual(parseBatonCli([
    'run', 'episode', 'run-phase92', 'output', '--workstream', 'reviewer',
    '--generation', '2', '--content', '--page-cursor', 'page_2', '--cursor', '7', '--wait', '5ms',
  ]).args, {
    runId: 'run-phase92', topic: 'output', role: 'reviewer', generation: 2,
    detail: 'content', pageCursor: 'page_2', cursor: 7, waitMs: 5,
  });
  assert.deepEqual(parseBatonCli([
    'run', 'workstreams', 'run-phase92', 'reviewer', '--generation', '2',
    '--cursor', '8', '--wait', '5ms',
  ]).args, { runId: 'run-phase92', role: 'reviewer', generation: 2, cursor: 8, waitMs: 5 });
  const notify = parseBatonCli([
    'run', 'notify', 'run-phase92', 'reviewer', 'Check lineage.', '--turn',
  ]);
  assert.equal(notify.name, 'run.workstream.notify');
  assert.deepEqual(notify.args, {
    runId: 'run-phase92', role: 'reviewer', message: 'Check lineage.', delivery: 'turn',
  });
  assert.deepEqual(parseBatonCli([
    'run', 'stop-member', 'run-phase92', 'reviewer', '--generation', '2',
  ]).args, { runId: 'run-phase92', role: 'reviewer', generation: 2 });
});

test('P92-EW5: browser controls execute the same progressive Episode/workstream surface', () => {
  // docs/36 §9 M3 — the desk element ids and bus operations move with the fold: the Episode
  // chapters serialize under run.view and the member ops under run.member.*; the canonical
  // transport names resolve in the Web dispatch layer (the legacy transports stay live until M5).
  const html = operatorAsset('/control').body;
  const script = operatorAsset('/control/app.js').body;
  for (const id of ['view-member', 'view-section', 'view-detail', 'load-view',
    'continue-view', 'load-members', 'member-send', 'member-stop']) {
    assert.match(html, new RegExp(`id="${id}"`, 'u'), id);
  }
  for (const operation of ['run_view', 'run_member_view', 'run_member_send',
    'run_member_stop']) assert.equal(script.includes(`command('${operation}'`), true, operation);
  assert.equal(script.includes("continuation.operation.replaceAll('.','_')"), true);
  assert.equal(script.includes('generation:selected.generation'), true);
  assert.equal(script.includes("detail:byId('view-detail').value"), true);
});

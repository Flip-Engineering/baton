import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCTION_WORKFLOW_WEB_PORTS,
  executeProductionWorkflowWebPort,
} from '../src/production-web-workflow-ports.mjs';

const ctx = Object.freeze({
  origin: 'https://operator.test', transport: 'https',
  principal: Object.freeze({
    userId: 'operator', sessionId: 'session:1', credentialId: 'credential:1',
    capabilities: Object.freeze(['control', 'observe']), repoIds: Object.freeze(['repo']),
  }),
});

function harness() {
  const commands = new Map();
  const calls = [];
  const authorizations = [];
  const audits = [];
  const northbound = {
    edge: null,
    _admissionOpen: () => true,
    _authenticate: () => null,
    _authorize: () => null,
    _audit(kind, _ctx, detail) { audits.push({ kind, detail }); },
    application: {
      async authorizeReplay(command, args) {
        authorizations.push({ command, args });
        return true;
      },
      async command(name, args) {
        calls.push({ name, args });
        return { name, args };
      },
    },
    coordination: {
      admitWebCommand(input) {
        const command = { ...input, status: 'admitted' };
        commands.set(input.commandId, command);
        return { ok: true, result: 'admitted', command };
      },
      completeWebCommand(commandId, outcome) {
        const command = commands.get(commandId);
        Object.assign(command, { status: 'completed', outcome });
        return command;
      },
      failWebCommand(commandId, outcome) {
        const command = commands.get(commandId);
        Object.assign(command, { status: 'failed', outcome });
        return command;
      },
    },
    async _dispatch(envelope) {
      const port = PRODUCTION_WORKFLOW_WEB_PORTS[envelope.command];
      const value = await this.application.command(port.application, envelope.args);
      return { status: 200, body: { ok: true, commandId: envelope.commandId, result: value } };
    },
    async _executeObservation(_ctx, envelope) {
      return this._dispatch(envelope);
    },
  };
  return { northbound, commands, calls, authorizations, audits };
}

function envelope(command, args, suffix) {
  return {
    schemaVersion: 1,
    commandId: `cmd:${suffix}`,
    idempotencyKey: `idem:${suffix}`,
    command,
    args,
    repoId: 'repo',
    ...(args.runId ? { runId: args.runId } : {}),
    origin: 'https://operator.test',
  };
}

const CASES = [
  ['run_message_send', { runId: 'run:a', kind: 'inform', body: 'hello' }, 'effect'],
  ['run_message_receipt', { messageId: `message:${'a'.repeat(64)}` }, 'query'],
  ['run_attention_watch', { runId: 'run:a', cursor: 0 }, 'query'],
  ['run_scratchpad_read', { runId: 'run:a', scope: 'shared', cursor: 0 }, 'query'],
  ['run_scratchpad_elevate', { runId: 'run:a', taskId: 'task:a', entryIds: [] }, 'effect'],
  ['run_board_post', { runId: 'run:a', board: 'work', title: 'item', evidence: [] }, 'effect'],
  ['run_board_read', { runId: 'run:a', board: 'work' }, 'query'],
  ['run_knowledge_seed', {
    runId: 'run:a', type: 'Finding', grounding: 'observed', body: 'bounded', evidence: [],
  }, 'effect'],
  ['run_debug', { runId: 'run:a', member: 'reviewer', limit: 3 }, 'query'],
];

test('all established workflow ports and the existing bounded debug projection admit real closed shapes', async () => {
  for (const [name, args, mode] of CASES) {
    const state = harness();
    const port = PRODUCTION_WORKFLOW_WEB_PORTS[name];
    assert.ok(port, `${name} port missing`);
    const response = await executeProductionWorkflowWebPort(
      state.northbound, ctx, envelope(name, args, name), port,
    );
    assert.equal(response.status, mode === 'query' ? 200 : 202, `${name}: ${JSON.stringify(response.body)}`);
    if (mode === 'effect') {
      for (let index = 0; index < 10
        && state.commands.get(`cmd:${name}`)?.status === 'admitted'; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(state.commands.get(`cmd:${name}`).status, 'completed', name);
    }
    assert.equal(state.calls.at(-1).name, port.application, name);
    if (args.runId && name !== 'run_attention_watch') {
      assert.equal(state.authorizations[0].command, 'run.inspect', name);
    }
    if (name === 'run_debug') {
      assert.ok(state.audits.some((entry) => entry.kind === 'operator_read_authorized'
        && entry.detail.command === 'run.debug'));
    }
  }
});

test('workflow Web port adapter refuses undeclared, credential-shaped and mismatched fields before dispatch', async () => {
  const first = harness();
  const unknown = await executeProductionWorkflowWebPort(
    first.northbound,
    ctx,
    envelope('run_board_read', { runId: 'run:a', board: 'work', forged: true }, 'unknown'),
    PRODUCTION_WORKFLOW_WEB_PORTS.run_board_read,
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, 'unknown_argument_field');
  assert.equal(unknown.body.error.field, 'forged');
  assert.equal(first.calls.length, 0);

  const second = harness();
  const secret = await executeProductionWorkflowWebPort(
    second.northbound,
    ctx,
    envelope('run_board_post', {
      runId: 'run:a', board: 'work', title: 'item',
      evidence: [{ token: 'not-accepted' }],
    }, 'secret'),
    PRODUCTION_WORKFLOW_WEB_PORTS.run_board_post,
  );
  assert.equal(secret.status, 400);
  assert.equal(secret.body.error.code, 'invalid_command');
  assert.equal(second.calls.length, 0);

  const third = harness();
  const mismatch = envelope('run_board_read', { runId: 'run:a', board: 'work' }, 'mismatch');
  mismatch.runId = 'run:b';
  const refused = await executeProductionWorkflowWebPort(
    third.northbound, ctx, mismatch, PRODUCTION_WORKFLOW_WEB_PORTS.run_board_read,
  );
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'application_run_id_mismatch');
  assert.equal(third.calls.length, 0);
});

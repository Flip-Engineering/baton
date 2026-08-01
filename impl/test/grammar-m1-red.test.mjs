import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  WebNorthbound,
  batonCliHelp,
  parseBatonCli,
} from '../src/index.mjs';
import { applicationSemanticRegistry } from '../src/application-semantics.mjs';

const NOW = Date.parse('2026-07-23T12:00:00.000Z');
const ORIGIN = 'https://grammar-m1.test';
const COMMANDS_BEFORE_M1 = Object.freeze([
  'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
  'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act',
  'run.status', 'run.follow', 'run.approve', 'run.wait', 'run.answer', 'run.feedback',
  'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification',
  'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'run.recover',
  'waves.attach', 'application.shutdown',
]);
const WEB_COMMANDS_BEFORE_M1 = Object.freeze(COMMANDS_BEFORE_M1
  .filter((name) => APPLICATION_COMMAND_DEFINITIONS[name].web)
  .map((name) => name.replaceAll('.', '_')));

function principal() {
  return {
    userId: 'grammar-user',
    sessionId: 'grammar-session',
    credentialId: 'grammar-credential',
    authMethod: 'cookie',
    csrfToken: 'grammar-csrf',
    expiresAt: '2026-07-23T13:00:00.000Z',
    revoked: false,
    capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: ['repo-grammar'],
  };
}

function webContext() {
  return {
    principal: principal(),
    origin: ORIGIN,
    csrfToken: 'grammar-csrf',
    remoteAddress: '127.0.0.1',
    transport: 'https',
  };
}

function webEnvelope(command, suffix) {
  return {
    schemaVersion: 1,
    commandId: `grammar-${suffix}`,
    idempotencyKey: `grammar-key-${suffix}`,
    command,
    args: {
      runId: 'run-grammar',
      role: 'worker',
      message: 'Continue within the approved scope.',
      delivery: 'nudge',
    },
    repoId: 'repo-grammar',
    runId: 'run-grammar',
    origin: ORIGIN,
  };
}

function webFixture() {
  const admitted = [];
  const commands = new Map();
  const coordination = {
    admitWebCommand(record) {
      const command = {
        ...record,
        status: 'admitted',
        outcome: null,
      };
      admitted.push(command);
      commands.set(record.commandId, command);
      return { ok: true, result: 'admitted', command };
    },
    completeWebCommand(commandId, outcome) {
      const command = commands.get(commandId);
      command.status = 'completed';
      command.outcome = outcome;
      return command;
    },
    failWebCommand(commandId, outcome) {
      const command = commands.get(commandId);
      command.status = 'failed';
      command.outcome = outcome;
      return command;
    },
    recordWebAudit() {
      return { result: 'recorded' };
    },
    webCommand(commandId) {
      return commands.get(commandId) ?? null;
    },
    webCommandByScope(scopeKey) {
      return admitted.find((command) => command.scopeKey === scopeKey) ?? null;
    },
  };
  const calls = [];
  const application = {
    repoId: 'repo-grammar',
    card() {
      return {
        schemaVersion: 1,
        repoId: 'repo-grammar',
        commands: [...COMMANDS_BEFORE_M1],
      };
    },
    async authorizeReplay() {
      return true;
    },
    async command(name, args) {
      calls.push({ name, args });
      return {
        schemaVersion: 1,
        runId: args.runId,
        phase: 'working',
        authority: 'same-application',
      };
    },
  };
  const web = new WebNorthbound({
    coordinator: {},
    coordination,
    application,
    repoIds: ['repo-grammar'],
    allowedOrigins: [ORIGIN],
    now: () => NOW,
    stream: {},
  });
  return { admitted, calls, web };
}

test('M1-1: canonical Web admission reaches the legacy operation and outcome, spelling-true (M4b)', async () => {
  const canonical = webFixture();
  const legacy = webFixture();
  const canonicalResult = await canonical.web.execute(
    webContext(), webEnvelope('run_member_send', 'canonical'),
  );
  const legacyResult = await legacy.web.execute(
    webContext(), webEnvelope('run_workstream_notify', 'legacy'),
  );

  assert.equal(canonicalResult.status, 200);
  assert.equal(legacyResult.status, 200);
  assert.deepEqual(canonicalResult.body.result, legacyResult.body.result);
  assert.deepEqual(canonical.calls, legacy.calls);
  // M4b — the transport flip: the canonical name is admitted first-class, its own spelling the
  // admitted identity (never resolved to the legacy name); both still reach one operation.
  assert.equal(canonical.admitted[0].command, 'run_member_send');
  assert.equal(legacy.admitted[0].command, 'run_workstream_notify');
});

test('M1-2: canonical CLI verbs parse to the same legacy envelopes', () => {
  const idempotency = ['--idempotency-key', 'grammar-cli-key'];
  const pairs = [
    [
      ['run', 'view', 'run-grammar', '--depth', 'outline', ...idempotency],
      ['run', 'show', 'run-grammar', '--depth', 'outline', ...idempotency],
    ],
    [
      ['run', 'member', 'send', 'run-grammar', 'worker', 'Continue.', ...idempotency],
      ['run', 'notify', 'run-grammar', 'worker', 'Continue.', ...idempotency],
    ],
    [
      ['run', 'member', 'stop', 'run-grammar', 'worker', ...idempotency],
      ['run', 'stop-member', 'run-grammar', 'worker', ...idempotency],
    ],
  ];
  for (const [canonical, legacy] of pairs) {
    assert.deepEqual(parseBatonCli(canonical), parseBatonCli(legacy));
  }
});

test('M1-3: an outline approval advertises one verbatim executable bound do block', async () => {
  const application = Object.create(BatonApplication.prototype);
  application.driver = {
    coordination: {
      runStop: () => null,
    },
  };
  application._semanticControlTargets = () => ({
    rows: [],
    sendRecipients: [],
    interruptRecipients: [],
  });
  application._contextTargets = () => [];
  application._contextState = () => ({ currentCells: [], currentCalls: [] });
  const planDigest = 'a'.repeat(64);
  const current = {
    goal: { runId: 'run-grammar' },
    plan: { digest: planDigest },
    profile: { digest: 'b'.repeat(64) },
  };
  const view = {
    phase: 'awaiting_plan_approval',
    cursor: 7,
    nextActions: [{ kind: 'approve_plan', planDigest }],
    attention: [],
    ownership: { workers: 0 },
  };
  const [approve] = application._semanticActions(
    current,
    view,
    { principalId: 'grammar-user', sessionId: 'grammar-session' },
  );
  assert.deepEqual(approve.do, {
    action: { kind: 'approve_plan', actionId: approve.actionId },
    inputs: { planDigest },
  });
  application._closed = null;
  application._closing = null;
  application._detached = false;
  application.ready = Promise.resolve();
  application._authorize = async () => {};
  application._resolveSemanticAction = async () => ({ current, action: approve });
  application._recheckSemanticAction = async () => approve;
  let approvedDigest = null;
  application.approve = async (_runId, digest) => {
    approvedDigest = digest;
  };
  application.inspect = async () => ({ phase: 'working' });
  const executed = await application.act({
    runId: 'run-grammar',
    actionId: approve.do.action.actionId,
    inputs: approve.do.inputs,
  }, {
    actor: 'direct:grammar-user',
    principalId: 'grammar-user',
    sessionId: 'grammar-session',
  });
  assert.equal(approvedDigest, planDigest);
  assert.deepEqual(executed, { phase: 'working' });

  const attentionActions = application._semanticActions(current, {
    ...view,
    phase: 'running',
    nextActions: [],
    attention: [
      {
        kind: 'answer_question',
        requestId: 'question-grammar',
        workerId: 'worker-grammar',
        question: 'Continue?',
      },
      {
        kind: 'turn_checkpoint',
        requestId: 'pause-grammar',
        workerId: 'worker-grammar',
        taskId: 'task-grammar',
        turnEpoch: 3,
      },
    ],
  }, { principalId: 'grammar-user', sessionId: 'grammar-session' });
  for (const action of attentionActions) {
    assert.deepEqual(action.do.action, { kind: action.kind, actionId: action.actionId });
    assert.ok(action.do.inputs && typeof action.do.inputs === 'object');
  }
  assert.equal(attentionActions.find(({ kind }) => kind === 'answer_question')
    .do.inputs.requestId, 'question-grammar');
  assert.deepEqual(Object.fromEntries(['nudge_turn', 'wait_turn', 'claim_turn'].map((kind) => {
    const action = attentionActions.find((candidate) => candidate.kind === kind);
    return [kind, action.do.inputs.response.kind];
  })), {
    nudge_turn: 'continue',
    wait_turn: 'wait',
    claim_turn: 'settle',
  });
});

test('M1-4: legacy spellings are deprecated in registry and help but remain registered', () => {
  assert.deepEqual(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].aliases, ['run.view']);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].deprecated, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.act'].deprecated, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.stop'].deprecated, false);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.cli.commands
    .find(({ id }) => id === 'run.show').deprecated, true);
  assert.match(batonCliHelp('run.inspect'), /deprecated.*baton run view/iu);
  assert.ok(APPLICATION_COMMAND_DEFINITIONS['run.inspect']);
});

test('M1-5: registry digests and alias construction are deterministic', () => {
  const first = applicationSemanticRegistry();
  const second = applicationSemanticRegistry();
  assert.match(first.authorityDigest, /^[a-f0-9]{64}$/u);
  assert.match(first.presentationDigest, /^[a-f0-9]{64}$/u);
  assert.equal(first.authorityDigest, second.authorityDigest);
  assert.equal(first.presentationDigest, second.presentationDigest);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.aliases, second.aliases);
});

test('M1-6: application and advertised Web projections are byte-identical to pre-M1', () => {
  assert.equal(JSON.stringify(Object.keys(APPLICATION_COMMAND_DEFINITIONS)),
    JSON.stringify(COMMANDS_BEFORE_M1));
  const webCommands = Object.keys(APPLICATION_COMMAND_DEFINITIONS)
    .filter((name) => APPLICATION_COMMAND_DEFINITIONS[name].web)
    .map((name) => name.replaceAll('.', '_'));
  assert.equal(JSON.stringify(webCommands), JSON.stringify(WEB_COMMANDS_BEFORE_M1));
});

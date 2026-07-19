import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  bindBatonPort,
  parseBatonCli,
  runBatonCli,
} from '../src/index.mjs';
import { northboundCapabilityToken } from '../src/northbound-capability-authority.mjs';

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });

test('I10-P0-1: objective-first review compiles to exact existing Workflow authority', async () => {
  const calls = [];
  const baton = bindBatonPort({
    async command(name, args) {
      calls.push({ name, args });
      return { runId: 'run-review-preset', outline: { actions: [] } };
    },
  });

  const review = await baton.review('Adversarially review the current repository change.', {
    profile: 'default', scope: ['impl/src'], reviewers: [codex, glm],
  });

  assert.equal(review.id, 'run-review-preset');
  assert.equal(review.helpTopic, 'review');
  assert.deepEqual(calls, [{
    name: 'run.start',
    args: { intent: {
      objective: 'Adversarially review the current repository change.',
      profile: 'default', scope: ['impl/src'],
      composition: {
        strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
        team: [
          { role: 'reviewer-1', route: codex },
          { role: 'reviewer-2', route: glm },
        ],
      },
    } },
  }]);
});

test('I10-P0-2: concise review CLI preserves every exact route axis', async () => {
  const parsed = parseBatonCli([
    'review', 'Review the candidate.', '--exact', 'codex/gpt-5.6-sol@high',
    '--exact', 'glm/glm-5.2@xhigh', '--scope', 'impl/src,impl/test',
  ]);
  assert.equal(parsed.kind, 'review-start');
  assert.deepEqual(parsed.reviewers, [codex, glm]);

  const calls = [];
  const result = await runBatonCli(parsed, {
    async command(name, args) {
      calls.push({ name, args });
      return { runId: 'run-cli-review', outline: { actions: [] } };
    },
  });
  assert.equal(result.runId, 'run-cli-review');
  assert.deepEqual(calls[0].args.intent.composition.team.map(({ route }) => route), [codex, glm]);
  assert.deepEqual(calls[0].args.intent.scope, ['impl/src', 'impl/test']);
});

test('I10-P0-3: authenticated action projection is capability-aware before display', () => {
  const application = Object.create(BatonApplication.prototype);
  application.driver = { coordination: { runStop: () => null } };
  application._contextTargets = () => [];
  application._contextState = () => ({ currentCells: [], currentCalls: [] });
  application._semanticControlTargets = () => ({
    sendRecipients: [], interruptRecipients: [], rows: [],
  });
  application._semanticActionId = (_current, _view, _principal, kind) => `action-${kind}`;
  const current = {
    goal: { runId: 'run-capability-projection' },
    profile: { digest: 'a'.repeat(64) }, plan: null,
  };
  const view = {
    phase: 'work_completed', cursor: 1, attention: [], ownership: { workers: 0 },
    nextActions: [
      { kind: 'adopt_result' },
      { kind: 'integrate', strategies: ['ff-only'] },
      { kind: 'export_result' },
    ],
  };
  const principal = { actor: 'web:owner', principalId: 'owner', sessionId: 'session' };
  const context = {
    transport: 'web', requestId: 'request', idempotencyKey: 'key',
    capabilityAuthority: northboundCapabilityToken('web'),
    capabilities: ['observe', 'adopt_result'],
  };

  const actions = application._semanticActions(current, view, principal, context);
  assert.deepEqual(actions.map(({ kind }) => kind), ['adopt_result']);
});

test('I10-P0-4: connected doctor and exact route readiness stay sanitized and selectable', async () => {
  const readiness = Object.freeze({
    schemaVersion: 1, ready: true,
    routes: Object.freeze([
      Object.freeze({ ...codex, state: 'ready', summary: 'Exact route is ready.' }),
      Object.freeze({ ...glm, state: 'blocked', code: 'authentication_required',
        summary: 'Provider login is required.' }),
    ]),
  });
  const baton = bindBatonPort({
    command: async () => { throw new Error('unexpected command'); },
    doctor: async () => readiness,
  });

  assert.deepEqual(await baton.doctor(), readiness);
  assert.deepEqual(await baton.route(codex), readiness.routes[0]);
  assert.deepEqual(await baton.route(glm), readiness.routes[1]);
  await assert.rejects(baton.route({ ...glm, effort: 'max' }),
    (error) => error?.code === 'application_route_unavailable');

  const parsed = parseBatonCli(['route', 'glm/glm-5.2@xhigh']);
  const selected = await runBatonCli(parsed, {
    doctor: async () => ({ ready: true, application: { readiness } }),
  });
  assert.deepEqual(selected, readiness.routes[1]);
  assert.equal(JSON.stringify(selected).includes('credential'), false);
});

test('I10-P0-5: client helpers materialize defaults advertised by the current action', async () => {
  const calls = [];
  const run = bindBatonPort({
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.inspect') return {
        schemaVersion: 1, runId: 'run-defaults', depth: 'outline', terminal: false,
        viewDigest: 'a'.repeat(64), outline: { objective: 'Apply it', phase: 'ready', actions: [{
          actionId: 'action-integrate', kind: 'integrate', choices: ['ff-only'],
          inputSchema: {
            type: 'object', required: ['strategy', 'reason'], properties: {
              strategy: { type: 'string', enum: ['ff-only'], default: 'ff-only' },
              reason: { type: 'string', default: 'Use the current advertised integration reason.' },
            },
          },
        }] },
      };
      return { runId: 'run-defaults', outline: { actions: [] } };
    },
  }).runs.open('run-defaults');

  await run.integrate();
  assert.deepEqual(calls.at(-1), {
    name: 'run.act', args: {
      runId: 'run-defaults', actionId: 'action-integrate', inputs: {
        strategy: 'ff-only', reason: 'Use the current advertised integration reason.',
      },
    },
  });
});

test('I10-P0-6: review and Workflow help describe the preset and advanced inner surface', async () => {
  const application = Object.create(BatonApplication.prototype);
  application.ready = Promise.resolve();
  application.repoId = 'repo-help';
  application._closed = false;
  application._closing = false;
  application._detached = false;
  application.authorize = async () => true;

  const principal = { actor: 'direct:help', principalId: 'help', sessionId: 'help-session' };
  const reviewOutline = await application.help({ topic: 'review', depth: 'outline' }, principal);
  const reviewContent = await application.help({ topic: 'review', depth: 'content' }, principal);
  const workflowContent = await application.help({ topic: 'workflow', depth: 'content' }, principal);

  assert.match(reviewOutline.summary, /objective-first/ui);
  assert.ok(reviewContent.content.commands.some((command) => command.startsWith('baton review ')));
  assert.match(workflowContent.content.paragraphs.join(' '), /advanced/u);
  assert.match(workflowContent.content.paragraphs.join(' '), /harness.*model.*effort/u);
  assert.ok(APPLICATION_SEMANTIC_REGISTRY.cli.helpTopics.review);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication, BatonWebClient, bindBatonPort, batonCliHelp, parseBatonCli, runBatonCli,
} from '../src/index.mjs';
import { northboundCapabilityToken } from '../src/northbound-capability-authority.mjs';

const ROUTE_A = Object.freeze({
  harness: 'codex', model: 'gpt-5.6-sol', effort: 'high',
});
const ROUTE_B = Object.freeze({
  harness: 'grok', model: 'grok-4.5', effort: 'medium',
});

test('I10-P0-1: connected review is an objective-first two-role preset over exact Workflow authority', async () => {
  const calls = [];
  const baton = bindBatonPort({
    async command(name, args) {
      calls.push({ name, args });
      return { runId: 'run-review', depth: 'outline', outline: { actions: [] } };
    },
  });

  const review = await baton.review('Find correctness risks before integration.', {
    routes: [ROUTE_A, ROUTE_B], scope: ['impl/src', 'impl/test'],
  });

  assert.equal(review.objective, 'Find correctness risks before integration.');
  assert.deepEqual(calls, [{
    name: 'run.start',
    args: { intent: {
      objective: 'Find correctness risks before integration.',
      resultIntent: 'read_only_evidence',
      scope: ['impl/src', 'impl/test'],
      composition: {
        strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
        team: [
          { role: 'reviewer', route: ROUTE_A },
          { role: 'challenger', route: ROUTE_B },
        ],
      },
    } },
  }]);
  await review.help();
  assert.equal(calls.at(-1).args.topic, 'review');
});

test('I10-P0-2: concise review CLI preserves both exact route tuples and help explains the inner Workflow', () => {
  const parsed = parseBatonCli([
    'review', 'Audit the candidate.',
    '--exact', 'codex/gpt-5.6-sol@high',
    '--exact', 'grok/grok-4.5@medium',
    '--scope', 'impl/src,impl/test',
    '--idempotency-key', 'review-a',
  ]);
  assert.equal(parsed.name, 'run.start');
  assert.equal(parsed.idempotencyKey, 'review-a');
  assert.deepEqual(parsed.args.intent.composition.team, [
    { role: 'reviewer', route: ROUTE_A },
    { role: 'challenger', route: ROUTE_B },
  ]);
  assert.match(batonCliHelp('review'), /objective/iu);
  assert.match(batonCliHelp('review'), /Workflow/iu);
  assert.match(batonCliHelp('workflow'), /team/iu);
  assert.match(batonCliHelp('workflow'), /harness\/model@effort/iu);
  const explore = parseBatonCli([
    'explore', 'Collect bounded evidence.', '--exact', 'codex/gpt-5.6-sol@high',
  ]);
  assert.equal(explore.name, 'run.start');
  assert.equal(explore.args.intent.resultIntent, 'read_only_evidence');
  const exploreHelp = parseBatonCli(['help', 'explore']);
  assert.equal(exploreHelp.name, 'application.help');
  assert.deepEqual(exploreHelp.args, { topic: 'explore', depth: 'outline' });
  assert.match(batonCliHelp('explore'), /single-route evidence/iu);
});

test('I10-P0-2b: Workflow and startMany forward each explicit result intent', async () => {
  const calls = [];
  const baton = bindBatonPort({
    async command(name, args) {
      calls.push({ name, args });
      return { runId: `run-${calls.length}`, depth: 'outline', outline: { actions: [] } };
    },
  });
  await baton.workflow('Compare two implementations.', {
    resultIntent: 'read_only_evidence',
    team: [
      { role: 'implementer', exact: ROUTE_A },
      { role: 'challenger', exact: ROUTE_B },
    ],
  });
  await baton.runs.startMany([
    { objective: 'Apply the selected change.', resultIntent: 'change', exact: ROUTE_A },
    { objective: 'Collect supporting evidence.', resultIntent: 'read_only_evidence', exact: ROUTE_B },
  ]);
  assert.deepEqual(calls.map(({ args }) => args.intent.resultIntent), [
    'read_only_evidence', 'change', 'read_only_evidence',
  ]);
  assert.equal(calls[0].args.intent.composition.strategy, 'parallel_attempts');
});

test('I10-P0-3: connected doctor exposes sanitized deployment and exact route readiness', async () => {
  const readiness = {
    schemaVersion: 1, ready: true,
    repository: { state: 'ready' }, verification: { state: 'ready' },
    dependencies: { state: 'ready' },
    routes: [{ ...ROUTE_A, state: 'ready', summary: 'Exact route is ready.' }],
  };
  const documents = new Map([
    ['/readyz', { ready: true }],
    ['/v1/application-card', {
      ok: true,
      application: { schemaVersion: 1, repoId: 'repo-a', readiness },
    }],
  ]);
  const client = new BatonWebClient({
    baseUrl: 'https://baton.test', origin: 'https://control.test', repoId: 'repo-a',
    token: 'secret', commandTimeoutMs: 1_000, pollMs: 10,
    fetchImpl: async (url) => ({
      ok: true, headers: { get: () => null },
      async text() { return JSON.stringify(documents.get(new URL(url).pathname)); },
    }),
    clock: Date.now, sleep: async () => {},
  });

  const doctor = await client.doctor();
  assert.deepEqual(doctor.deployment, readiness);
  assert.deepEqual(doctor.routes, readiness.routes);
  assert.equal(JSON.stringify(doctor).includes('secret'), false);

  const connected = bindBatonPort({ command: async () => ({}), doctor: () => doctor });
  assert.deepEqual(await connected.doctor(), doctor);
  assert.deepEqual(await connected.routes(), readiness.routes);
  assert.deepEqual(await connected.route(ROUTE_A), readiness.routes[0]);
});

test('I10-P0-4: client integrate helper materializes every advertised default including reason', async () => {
  const calls = [];
  const baton = bindBatonPort({
    async command(name, args) {
      calls.push({ name, args });
      if (name === 'run.inspect') return {
        runId: 'run-a', depth: 'outline', outline: { actions: [{
          actionId: 'integrate-a', kind: 'integrate', choices: ['ff-only', 'structured'],
          inputSchema: { type: 'object', required: ['strategy', 'reason'], properties: {
            strategy: { type: 'string', enum: ['ff-only', 'structured'], default: 'ff-only' },
            reason: { type: 'string', default: 'Apply the adopted verified result.' },
          } },
        }] },
      };
      return { runId: 'run-a', depth: 'outline', outline: { actions: [] } };
    },
  });

  await baton.runs.open('run-a').integrate();
  assert.deepEqual(calls.at(-1), {
    name: 'run.act', args: {
      runId: 'run-a', actionId: 'integrate-a',
      inputs: { strategy: 'ff-only', reason: 'Apply the adopted verified result.' },
    },
  });
});

test('I10-P0-5: state-eligible semantic actions are filtered by authenticated capabilities', () => {
  const application = Object.create(BatonApplication.prototype);
  application.driver = { coordination: { runStop: () => ({ state: 'stopping' }) } };
  application._contextTargets = () => [];
  application._contextState = () => ({ currentCells: [], currentCalls: [] });
  application._semanticActionId = (_current, _view, _principal, kind) => `action-${kind}`;
  const current = { goal: { runId: 'run-a' }, plan: { digest: 'a'.repeat(64) }, profile: { digest: 'b'.repeat(64) } };
  const view = { phase: 'awaiting_plan_approval', nextActions: [], attention: [] };
  const principal = { principalId: 'reader', sessionId: 'reader-session' };
  const context = (capabilities) => ({
    transport: 'web', requestId: 'issue10-projection', idempotencyKey: 'issue10-projection',
    capabilityAuthority: northboundCapabilityToken('web'), capabilities,
  });

  assert.deepEqual(application._semanticActions(current, view, principal, context(['observe'])), []);
  assert.deepEqual(
    application._semanticActions(current, view, principal, context(['approve', 'observe']))
      .map(({ kind }) => kind),
    ['approve_plan'],
  );
  assert.deepEqual(
    application._semanticActions(current, view, principal, ['observe']).map(({ kind }) => kind),
    ['approve_plan', 'stop'],
    'an untrusted capability array must not narrow the authority projection',
  );
});

test('I10-P0-6: exact-route CLI selection uses the connected sanitized readiness projection', async () => {
  const ready = { ...ROUTE_A, state: 'ready', summary: 'Exact route is ready.' };
  const blocked = {
    ...ROUTE_B, state: 'blocked', code: 'authentication_required',
    summary: 'Provider login is required.',
  };
  const parsed = parseBatonCli(['route', 'grok/grok-4.5@medium']);
  assert.deepEqual(parsed.exact, ROUTE_B);
  assert.deepEqual(await runBatonCli(parsed, {
    doctor: async () => ({ routes: [ready, blocked] }),
  }), blocked);
  assert.deepEqual(await runBatonCli(parsed, {
    doctor: async () => ({ application: { readiness: { routes: [ready, blocked] } } }),
  }), blocked);
  assert.equal(JSON.stringify(blocked).includes('credential'), false);
});

test('I10-P0-7: explore, review, and Workflow help close the ordinary-to-advanced navigation', async () => {
  const application = Object.create(BatonApplication.prototype);
  application.ready = Promise.resolve();
  application.repoId = 'repo-help';
  application._closed = false;
  application._closing = false;
  application._detached = false;
  application.authorize = async () => true;
  const principal = { actor: 'direct:help', principalId: 'help', sessionId: 'help-session' };

  const applicationOutline = await application.help(
    { topic: 'application', depth: 'outline' }, principal,
  );
  const exploreContent = await application.help({ topic: 'explore', depth: 'content' }, principal);
  const reviewContent = await application.help({ topic: 'review', depth: 'content' }, principal);
  const workflowContent = await application.help(
    { topic: 'workflow', depth: 'content' }, principal,
  );

  assert.ok(applicationOutline.links.some(({ topic }) => topic === 'explore'));
  assert.ok(applicationOutline.links.some(({ topic }) => topic === 'review'));
  assert.ok(applicationOutline.links.some(({ topic }) => topic === 'workflow'));
  assert.deepEqual(exploreContent.links.map(({ topic }) => topic), [
    'run', 'review', 'routing', 'run.inspect', 'run.episode',
  ]);
  assert.ok(reviewContent.links.some(({ topic }) => topic === 'workflow'));
  assert.ok(workflowContent.links.some(({ topic }) => topic === 'review'));
  assert.match(exploreContent.content.paragraphs.join(' '), /single-route evidence/iu);
  assert.match(reviewContent.content.paragraphs.join(' '), /objective-first/iu);
  assert.match(workflowContent.content.paragraphs.join(' '), /advanced/iu);
  assert.ok(APPLICATION_SEMANTIC_REGISTRY.cli.helpTopics.explore);
  assert.ok(APPLICATION_SEMANTIC_REGISTRY.cli.helpTopics.review);
});

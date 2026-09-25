// Issue #335: run/explore/show refusals teach the closed grammar.
//
// A one-sentence "model is invalid" or "show selectors do not match the requested depth"
// leaves an orchestrating agent with no recovery: the refusal must name the accepted forms,
// the closed sets, and the served rows that would have matched — read from the served route
// table (the same rows doctor prints) and the semantic registry, never a hand-kept list.
//
// Red-before rows: (a) a provider-qualified --model refusal names --exact and the matching
// served routes; (b) a --depth mismatch names the closed depth set and the selector→depth
// map; (c) an unknown depth names the set; (d) the muse provider-prefix mistake is taught at
// the CLI. Parser-level throughout, plus the real web transport (BatonWebClient over a stub
// fetch serving /readyz + the application card) for the runtime legs.
import assert from 'node:assert/strict';
import test from 'node:test';

import { BatonWebClient, parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const CLOSED_DEPTHS = [...APPLICATION_SEMANTIC_REGISTRY.depths];

// The served route table, shaped exactly as doctor prints it: public {harness, model, effort}
// fields plus the readiness verdict. omp models carry the provider prefix
// (deepseek/deepseek-flash); muse models do not (muse-spark-1.3-contributor).
const SERVED_ROUTES = Object.freeze([
  Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low', state: 'ready' }),
  Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high', state: 'ready' }),
  Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'max', state: 'blocked', code: 'authentication_required' }),
  Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-v4-pro[1m]', effort: 'low', state: 'blocked', code: 'authentication_required' }),
  Object.freeze({ harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'low', state: 'ready' }),
  Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low', state: 'ready' }),
]);

function fakeRouteClient(routes = SERVED_ROUTES) {
  const calls = [];
  return {
    calls,
    async doctor() { return { schemaVersion: 1, ready: true, routes, application: { readiness: { routes } } }; },
    async command(name, args, key) {
      calls.push({ name, args, key });
      return { runId: 'run-issue335', phase: 'running' };
    },
  };
}

function refusalOf(fn) {
  try { fn(); } catch (error) { return error; }
  return null;
}

async function asyncRefusalOf(fn) {
  try { await fn(); } catch (error) { return error; }
  return null;
}

// A BatonWebClient whose transport serves doctor from the canned route table and records
// every request path, so the test proves the refusal happens BEFORE any command is sent.
function webRouteClient(routes = SERVED_ROUTES) {
  const requests = [];
  const bodyFor = (pathname) => {
    if (pathname === '/readyz') return { ok: true, ready: true };
    if (pathname === '/v1/application-card') {
      return {
        ok: true,
        application: {
          schemaVersion: 1, repoId: 'repo-issue335',
          commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop'],
          readiness: { schemaVersion: 1, ready: true, routes },
        },
      };
    }
    throw new Error(`unexpected web request ${pathname}`);
  };
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    requests.push({ pathname, method: options.method ?? 'GET' });
    return {
      ok: true, status: 200, headers: { get: () => null },
      text: async () => JSON.stringify(bodyFor(pathname)),
    };
  };
  const client = new BatonWebClient({
    baseUrl: 'https://resident.baton.test', origin: 'https://control.baton.test',
    repoId: 'repo-issue335', token: 'issue335-bearer',
    commandTimeoutMs: 1_000, pollMs: 10, fetchImpl,
    clock: () => Date.parse('2026-09-17T00:00:00.000Z'), sleep: async () => {},
  });
  return { client, requests };
}

// -------------------------------------------------------------------------------------------
// (a) a provider-qualified --model refusal names --exact and the matching served routes.
// -------------------------------------------------------------------------------------------

test('(a) issue335: a provider-qualified --model parses as a route selector, never "model is invalid"', () => {
  const parsed = parseBatonCli(['run', 'Ship it',
    '--harness', 'omp', '--model', 'deepseek/deepseek-flash', '--effort', 'low']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'run.start');
  assert.deepEqual(parsed.args.intent.route,
    { model: 'deepseek/deepseek-flash', harness: 'omp', effort: 'low' });
});

test('(a) issue335: an unmatched provider-qualified selector refuses naming --exact and the matching served routes', async () => {
  const client = fakeRouteClient();
  const parsed = parseBatonCli(['run', 'Ship it',
    '--harness', 'omp', '--model', 'deepseek/deepseek-flash', '--effort', 'medium']);
  const refusal = await asyncRefusalOf(() => runBatonCli(parsed, client));
  assert.ok(refusal, 'the unmatched selector must refuse before any command is sent');
  assert.equal(refusal.code, 'cli_invalid');
  assert.equal(client.calls.length, 0, 'no command crosses on a refused route');
  const message = refusal.message ?? '';
  assert.match(message, /--exact/u, 'the canonical exact-route spelling is named');
  assert.match(message, /HARNESS\/MODEL@EFFORT/u, 'the exact-route grammar is named');
  assert.match(message, /omp\/deepseek\/deepseek-flash@low/u,
    'the served routes matching the typed prefix are named');
  assert.match(message, /deepseek\/deepseek-flash/u, 'the requested model is named');
  assert.equal(refusal.field, 'route', 'the judged field is named');
});

test('(a) issue335: the same refusal crosses the real web transport before any command is sent', async () => {
  const { client, requests } = webRouteClient();
  const parsed = parseBatonCli(['explore', 'Survey it',
    '--harness', 'omp', '--model', 'deepseek/deepseek-flash', '--effort', 'medium']);
  const refusal = await asyncRefusalOf(() => runBatonCli(parsed, client));
  assert.ok(refusal, 'the unmatched selector must refuse');
  assert.equal(refusal.code, 'cli_invalid');
  assert.match(refusal.message ?? '', /--exact/u);
  assert.match(refusal.message ?? '', /omp\/deepseek\/deepseek-flash@low/u);
  assert.equal(requests.some(({ pathname, method }) => pathname === '/v1/commands' && method === 'POST'), false,
    'the refused route never reaches the command transport');
});

test('(a) issue335: a served provider-qualified selector still passes through to the resident', async () => {
  const client = fakeRouteClient();
  const parsed = parseBatonCli(['run', 'Ship it',
    '--harness', 'omp', '--model', 'deepseek/deepseek-flash', '--effort', 'low']);
  const result = await runBatonCli(parsed, client);
  assert.equal(result.phase, 'running', 'the matching route is sent, not refused');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, 'run.start');
});

// -------------------------------------------------------------------------------------------
// (b) a --depth mismatch names the closed depth set and the selector→depth map.
// -------------------------------------------------------------------------------------------

test('(b) issue335: `run show --depth evidence` without selectors names the closed set and the map', () => {
  const refusal = refusalOf(() => parseBatonCli(['run', 'show', 'run:1', '--depth', 'evidence']));
  assert.ok(refusal, 'the mismatch must refuse');
  assert.equal(refusal.code, 'cli_invalid');
  assert.match(refusal.message ?? '', /selectors do not match/u);
  for (const depth of CLOSED_DEPTHS) {
    assert.match(refusal.message ?? '', new RegExp(depth, 'u'), `the closed set names ${depth}`);
  }
  assert.match(refusal.message ?? '', /--section/u, 'the map names --section');
  assert.match(refusal.message ?? '', /--item/u, 'the map names --item');
  assert.match(refusal.message ?? '', /evidence/u, 'the map places the requested depth');
});

test('(b) issue335: `--depth index --section plan` names which selector belongs to which depth', () => {
  const refusal = refusalOf(() => parseBatonCli(['run', 'show', 'run:1', '--depth', 'index', '--section', 'plan']));
  assert.ok(refusal, 'the mismatch must refuse');
  assert.match(refusal.message ?? '', /selectors do not match/u);
  assert.match(refusal.message ?? '', /--section/u);
  for (const depth of CLOSED_DEPTHS) {
    assert.match(refusal.message ?? '', new RegExp(depth, 'u'), `the closed set names ${depth}`);
  }
});

// -------------------------------------------------------------------------------------------
// (c) an unknown depth names the closed set.
// -------------------------------------------------------------------------------------------

test('(c) issue335: an unknown --depth names the closed depth set', () => {
  const refusal = refusalOf(() => parseBatonCli(['run', 'show', 'run:1', '--depth', 'summary']));
  assert.ok(refusal, 'the unknown depth must refuse');
  assert.equal(refusal.code, 'cli_invalid');
  assert.match(refusal.message ?? '', /summary/u, 'the unknown depth is named');
  for (const depth of CLOSED_DEPTHS) {
    assert.match(refusal.message ?? '', new RegExp(depth, 'u'), `the closed set names ${depth}`);
  }
  assert.equal(refusal.field, 'depth', 'the judged field is named');
});

// -------------------------------------------------------------------------------------------
// (d) the muse provider-prefix mistake is taught at the CLI.
// -------------------------------------------------------------------------------------------

test('(d) issue335: the muse provider-prefix mistake on run/explore is taught from the served table', async () => {
  const client = fakeRouteClient();
  const parsed = parseBatonCli(['run', 'Ship it',
    '--harness', 'muse', '--model', 'muse/muse-spark-1.3-contributor', '--effort', 'low']);
  const refusal = await asyncRefusalOf(() => runBatonCli(parsed, client));
  assert.ok(refusal, 'the prefixed muse selector must refuse before any command is sent');
  assert.equal(refusal.code, 'cli_invalid');
  assert.equal(client.calls.length, 0, 'no command crosses on a refused route');
  const message = refusal.message ?? '';
  assert.match(message, /muse\/muse-spark-1\.3-contributor/u, 'the requested selector is named');
  assert.match(message, /\[provider\/\]model/u, 'the selector grammar is named');
  assert.match(message, /muse-spark-1\.3-contributor/u, 'the served muse selector (no provider prefix) is named');
  assert.match(message, /--exact/u, 'the canonical exact-route spelling is named');
});

test('(d) issue335: a swarm recruit exact with the muse prefix refuses naming the served harness routes and readiness', async () => {
  const client = fakeRouteClient();
  const parsed = parseBatonCli(['swarm', 'recruit', 's-issue335', 'ada', 'Build it',
    '--options', JSON.stringify({ exact: { harness: 'muse', model: 'muse/muse-spark-1.3-contributor', effort: 'low' } })]);
  assert.equal(parsed.name, 'swarm.recruit');
  const refusal = await asyncRefusalOf(() => runBatonCli(parsed, client));
  assert.ok(refusal, 'the unserved recruit route must refuse before any command is sent');
  assert.equal(refusal.code, 'cli_invalid');
  assert.equal(client.calls.length, 0, 'no recruit crosses on a refused route');
  const message = refusal.message ?? '';
  assert.match(message, /muse\/muse-spark-1\.3-contributor/u, 'the requested recruit selector is named');
  assert.match(message, /\[provider\/\]model/u, 'the selector grammar is named');
  assert.match(message, /muse\/muse-spark-1\.3-contributor@low/u, 'the served harness route is named');
  assert.match(message, /ready/u, 'the served readiness state is named');
});

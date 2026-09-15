// #313 (the #288 host leftover): the transport-time failures BatonWebClient._json raises —
// connection failed, response over boundary, body not JSON — are CLI refusals like any other,
// so each names its typed cause through the ONE connection-cause table (rule, remedy, field,
// retryable, detail). The #231 wire-refusal mapping (a parseable error body rides the WIRE's own
// code/message/detail) is untouched; this covers the legs that never had a cause at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BatonWebClient, cliConnectionCauseRow } from '../src/application-cli.mjs';

function makeClient(fetchImpl, extra = {}) {
  return new BatonWebClient({
    baseUrl: 'https://baton.local/', origin: 'https://baton.local', repoId: 'repo-x', token: 't',
    commandTimeoutMs: 30_000, pollMs: 250,
    fetchImpl, clock: () => 0, sleep: () => Promise.resolve(),
    ...extra,
  });
}

function nonemptyRule(value) {
  return typeof value === 'string' && value.length > 0;
}

test('transport failure composes the web_transport_failed cause (rule, remedy, retryable)', async () => {
  const client = makeClient(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(client.command('run.start', { intent: { runId: 'run-1' } }), (error) => {
    assert.equal(error.code, 'cli_transport_failed');
    assert.equal(error.cause, 'web_transport_failed');
    assert.equal(error.retryable, true, 'a dead connection is retryable');
    assert.equal(error.detail.cause, 'web_transport_failed');
    assert.ok(nonemptyRule(error.detail.rule));
    assert.ok(nonemptyRule(error.detail.remedy), 'the refusal carries the action that fixes it');
    assert.match(error.message, /(GET|POST) \/v1\//u, 'the observed request facts ride the message');
    return true;
  });
});

test('a request that outlives its own bound stays marked requestBoundElapsed on the typed refusal', async () => {
  const client = makeClient(async (_url, init) => {
    await new Promise((resolve, reject) => { init.signal.addEventListener('abort', reject); setTimeout(resolve, 250); });
    throw new TypeError('should have been aborted');
  }, { commandTimeoutMs: 25, pollMs: 10 });
  await assert.rejects(client.command('run.start', { intent: { runId: 'run-1' } }), (error) => {
    assert.equal(error.code, 'cli_transport_failed');
    assert.equal(error.requestBoundElapsed, true, 'the command leg keys the pending-receipt receipt on this marker');
    return true;
  });
});

test('an over-boundary response composes the web_response_oversize cause', async () => {
  const client = makeClient(async () => new Response('x'.repeat(64), {
    status: 200, headers: { 'content-length': String(4 * 1024 * 1024) },
  }));
  await assert.rejects(client.command('runs.list', {}), (error) => {
    assert.equal(error.code, 'cli_protocol_failed');
    assert.equal(error.detail.cause, 'web_response_oversize');
    assert.ok(nonemptyRule(error.detail.rule));
    return true;
  });
});

test('a non-JSON body composes the web_response_invalid_json cause', async () => {
  const client = makeClient(async () => new Response('<html>gateway error</html>', {
    status: 200, headers: { 'content-type': 'text/html' },
  }));
  await assert.rejects(client.command('runs.list', {}), (error) => {
    assert.equal(error.code, 'cli_protocol_failed');
    assert.equal(error.detail.cause, 'web_response_invalid_json');
    assert.ok(nonemptyRule(error.detail.rule), 'the refusal names the rule and the remedy');
    return true;
  });
});

test('the transport-time causes are enumerable in the one cause table', () => {
  for (const cause of ['web_transport_failed', 'web_response_oversize', 'web_response_invalid_json']) {
    const row = cliConnectionCauseRow(cause);
    assert.ok(row !== null, `${cause} is a registered cause`);
    assert.ok(nonemptyRule(row.rule) && nonemptyRule(row.remedy));
  }
});

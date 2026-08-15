import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatonWebClient } from '../src/application-cli.mjs';

// #231 red-first pins — a wire refusal carries its own typed error envelope
// {ok:false, error:{code, message}}; the CLI must surface the WIRE code, keep the
// WIRE message verbatim (multi-line DSL diagnostics survive), and ride the full
// parsed error object as an enumerable `detail`. Transport failures with no
// parseable body keep the generic cli_transport_failed shape.
//
// RED at the pre-fix head: the refusal threw only
// 'Baton Web request was refused (POST /v1/commands, HTTP 400)' — no wire
// message, no detail.

function fakeClock() {
  return () => 0;
}

function fakeSleep() {
  return () => Promise.resolve();
}

function makeClient(fetchImpl) {
  return new BatonWebClient({
    baseUrl: 'https://baton.local/',
    origin: 'https://baton.local',
    repoId: 'repo-x',
    token: 't',
    commandTimeoutMs: 30_000,
    pollMs: 250,
    fetchImpl,
    clock: fakeClock(),
    sleep: fakeSleep(),
  });
}

function refusedResponse(error, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), { status });
}

test('#231: a refused command surfaces the wire error code, message, and enumerable detail', async () => {
  const wireError = {
    code: 'workflow_spec_invalid',
    message: 'wavefile line 7: unknown directive — expected one of wave, member, ...',
  };
  const client = makeClient(async () => refusedResponse(wireError));
  await assert.rejects(
    client.command('run.start', { intent: { runId: 'run-1' } }),
    (error) => {
      assert.equal(error.code, 'workflow_spec_invalid',
        'the thrown code MUST be the wire error.code, not a generic wrapper code');
      assert.ok(error.message.includes('wavefile line 7'),
        'the thrown message MUST include the wire error.message');
      assert.ok(
        Object.getOwnPropertyDescriptor(error, 'detail')?.enumerable,
        'detail MUST be an enumerable own property',
      );
      assert.deepEqual(error.detail, wireError,
        'detail deep-equals the full parsed wire error object');
      return true;
    },
  );
});

test('#231: a multi-line DSL refusal message survives verbatim through the refusal path', async () => {
  const wireError = {
    code: 'workflow_spec_invalid',
    message: 'wavefile line 3: could not parse the spec\n'
      + 'wavefile line 7: unknown directive — expected one of wave, member, ...\n'
      + '  → see the wavefile reference for the accepted grammar',
  };
  const client = makeClient(async () => refusedResponse(wireError));
  await assert.rejects(
    client.command('run.start', { intent: { runId: 'run-1' } }),
    (error) => {
      assert.equal(error.code, 'workflow_spec_invalid');
      assert.ok(error.message.includes(wireError.message),
        'the multi-line DSL diagnostic rides verbatim (every line, unmodified)');
      assert.equal(error.detail.message, wireError.message);
      return true;
    },
  );
});

test('#231: the #227 continuation ladder still keys on the WIRE code via detail', async () => {
  // The list-continuation catch site reads error.code === 'application_run_list_continuation_required'
  // and the cursor from error.detail — typed wire errors must keep that ladder working.
  const calls = [];
  const client = makeClient(async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return refusedResponse({
        code: 'application_run_list_continuation_required',
        message: 'more pages remain under the fleet page bound',
        continuationCursor: 'cursor-1',
      }, 409);
    }
    return new Response(JSON.stringify({
      status: 'completed', result: { items: [{ id: 'run-9' }] },
    }), { status: 200 });
  });
  const result = await client.command('runs.list', { repoId: 'repo-x' });
  assert.deepEqual(result.items, [{ id: 'run-9' }],
    'the ladder drains the refused page and returns the retried page items');
  const retried = JSON.parse(calls[1].init.body);
  assert.equal(retried.args.continuationCursor, 'cursor-1',
    'the retry carries the cursor lifted from error.detail');
});

test('#231: a transport failure with no parseable body keeps the generic shape', async () => {
  const client = makeClient(async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(
    client.command('run.start', { intent: { runId: 'run-1' } }),
    (error) => {
      assert.equal(error.code, 'cli_transport_failed');
      assert.equal(error.detail, undefined);
      assert.equal(
        error.message,
        'Baton Web connection failed; check your network and retry',
      );
      return true;
    },
  );
});

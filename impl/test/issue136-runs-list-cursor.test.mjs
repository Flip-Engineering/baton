// Issue #136 — `baton runs list` could not pass a continuation cursor at all, and the server's
// refusal named no next action. The registry's runs.list row admits exactly one argument,
// `continuationCursor` (a 1-32 digit string), and the client's drain ladder already resumes from
// `continuation.arguments.continuationCursor` (application-cli.mjs listContinuationCursor /
// advanceListPage) — this file pins the parse leg and the coaching refusal that make the cursor
// reachable.
//
// R1 (red-first): `runs list --cursor 12` parses to runs.list with { continuationCursor: '12' }.
// R2 (red-first): a non-conforming --cursor refuses at parse, naming the shape and how to obtain
//                 a valid one.
// R3 (red-first): the server-side runs.list refusal names the offending field, its accepted shape
//                 and the response path the next cursor arrives on.
// R4 (green pin): the bare `runs list` keeps parsing to args {} and keeps dispatching.

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';
import { validateApplicationCommandArgs } from '../src/application.mjs';

const CURSOR_PATH = /continuation\.arguments\.continuationCursor/u;

function mockWebClient(calls) {
  return {
    async command(name, args, idempotencyKey) {
      calls.push({ name, args, idempotencyKey });
      return { ok: true, name, args };
    },
  };
}

test('R1: `baton runs list --cursor 12` parses the continuation cursor into the command args', () => {
  const parsed = parseBatonCli(['runs', 'list', '--cursor', '12']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'runs.list', 'the verb keeps its canonical dispatch name');
  assert.deepEqual(parsed.args, { continuationCursor: '12' },
    'the cursor rides the registry field the drain ladder resumes from');
});

test('R2: a non-conforming --cursor refuses typed, naming the shape and how to obtain one', () => {
  assert.throws(
    () => parseBatonCli(['runs', 'list', '--cursor', 'abc']),
    (error) => {
      assert.equal(error?.code, 'cli_invalid', 'the parse refusal is typed');
      const message = error?.message ?? '';
      assert.match(message, /1-32 digits/u, 'the refusal names the accepted cursor shape');
      assert.match(message, CURSOR_PATH,
        'the refusal names where a valid cursor comes from (the previous page\'s continuation)');
      assert.match(message, /baton runs list/u,
        'the refusal names the verb whose answer carries the cursor');
      return true;
    },
  );
  // The shape is the server's own: a maximum-width cursor is admitted, a non-digit is not.
  assert.equal(parseBatonCli(['runs', 'list', '--cursor', '9'.repeat(32)]).args.continuationCursor,
    '9'.repeat(32));
});

test('R3: the server runs.list refusal names the field, the shape and the obtaining path', () => {
  assert.equal(validateApplicationCommandArgs('runs.list', { continuationCursor: '12' }), true,
    'the accepted shape stays admitted');
  assert.throws(
    () => validateApplicationCommandArgs('runs.list', { continuationCursor: 'abc' }),
    (error) => {
      assert.equal(error?.code, 'application_run_list_invalid');
      assert.equal(error?.detail?.field, 'continuationCursor',
        'the existing detail.field behaviour is kept');
      const message = error?.message ?? '';
      assert.match(message, /continuationCursor/u, 'the refusal names the offending field');
      assert.match(message, /1-32 digits/u, 'the refusal names the accepted shape');
      assert.match(message, CURSOR_PATH,
        'the refusal names where a valid cursor comes from (the previous page\'s continuation)');
      return true;
    },
  );
});

test('R4: the bare `baton runs list` still parses to {} and still dispatches', async () => {
  const parsed = parseBatonCli(['runs', 'list']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'runs.list');
  assert.deepEqual(parsed.args, {}, 'the cursor-less form sends no args, exactly as before');
  const calls = [];
  await runBatonCli(parsed, mockWebClient(calls));
  assert.equal(calls[0]?.name, 'runs.list');
  assert.deepEqual(calls[0]?.args, {});
});

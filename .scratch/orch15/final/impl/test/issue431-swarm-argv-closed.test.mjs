// Issue #431 — `baton swarm stop <swarm> --participant muse-396` was accepted silently: the
// positional loop ate the unknown `--` token as the participantId, the reason slot ate the seat
// id, and the misparse surfaced one hop later as a runtime `swarm_participant_not_found`.
// The repair: the swarm argv is closed — every verb refuses a `--` token outside its vocabulary
// (ONE derivation from the contract-table CLI row plus the parser-leg flags), a required
// positional refuses naming its position and the usage line, and the seat selector keeps ONE
// CLI spelling — `--participant-id`, the kebab of the contract field the table declares.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBatonCli, batonCliHelp } from '../src/application-cli.mjs';
import { SWARM_CLI_COMMANDS } from '../src/swarm-surface.mjs';
import { SWARM_COMMAND_NAMES } from '../src/swarm-contract.mjs';

const refused = (fn) => {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
};

const stopRow = SWARM_CLI_COMMANDS.find((row) => row.verb === 'stop');

// The parser-leg flags — the observation leg (#288 R-5) and the wake stream's filter/cursor
// words (#272/#339) — are the parse's own vocabulary beside the contract-table flags. This
// mirror IS the pin: a verb that learns a new parser-leg flag must extend it here (and the
// usage-line drift row below keeps it honest against swarm-surface's rendered lines).
const PARSER_LEG_FLAGS = Object.freeze({
  watch: Object.freeze(['--follow', '--wake-class', '--kinds', '--since']),
  check: Object.freeze(['--follow']),
  recruit: Object.freeze(['--follow']),
  integrate: Object.freeze(['--follow']),
});

const admittedFor = (row) => [
  ...row.flags.map((entry) => entry.flag),
  ...(PARSER_LEG_FLAGS[row.verb] ?? []),
];

test('431-a: swarm stop refuses --participant naming the token, the admitted flags and the usage', () => {
  const error = refused(() => parseBatonCli(['swarm', 'stop', 'swarm-wave6', '--participant', 'muse-396']));
  assert.match(error.message, /--participant/u, 'the offending token is named');
  assert.match(error.message, /--view/u, 'the verb\'s admitted flags are named');
  assert.match(error.message, new RegExp(`usage: ${stopRow.usage.replace(/[[\]]/gu, '\\$&')}`, 'u'),
    'the usage line is named');
  assert.equal(error.detail?.field, '--participant');
  assert.deepEqual(error.detail?.admitted, ['--view']);
  assert.equal(error.detail?.usage, stopRow.usage);
});

test('431-b: a missing required positional refuses naming the position and the usage line', () => {
  const error = refused(() => parseBatonCli(['swarm', 'stop', 'swarm-wave6']));
  assert.match(error.message, /participant-id/u, 'the missing field is named');
  assert.match(error.message, /positional 2 of 3/u, 'the position is named');
  assert.match(error.message, new RegExp(`usage: ${stopRow.usage.replace(/[[\]]/gu, '\\$&')}`, 'u'),
    'the usage line is named');
  assert.equal(error.detail?.rule, 'required-positional');
  assert.equal(error.detail?.position, 2);
  assert.equal(error.detail?.usage, stopRow.usage);
  // the runtime never sees the misparse: participantId never reaches the dispatch
  assert.throws(() => parseBatonCli(['swarm', 'stop', 'swarm-wave6', '--participant', 'muse-396']));
});

test('431-c: the positional form parses unchanged — byte-identical to the pre-#431 args object', () => {
  assert.deepEqual(
    parseBatonCli(['--idempotency-key', 'k', 'swarm', 'stop', 'S', 'P', 'R']),
    {
      kind: 'command', name: 'swarm.stop',
      args: { swarmId: 'S', participantId: 'P', reason: 'R', idempotencyKey: 'k' },
      idempotencyKey: 'k',
    },
  );
  // the admitted flag loop is untouched
  const withView = parseBatonCli(['--idempotency-key', 'k', 'swarm', 'stop', 'S', 'P', 'R', '--view', 'true']);
  assert.equal(withView.args.view, 'true');
});

test('431-d: every swarm verb refuses an invented flag the same closed-set way (table-driven)', () => {
  assert.deepEqual(SWARM_CLI_COMMANDS.map((row) => row.command).sort(), [...SWARM_COMMAND_NAMES].sort(),
    'the table-driven row walks EVERY verb the contract table declares');
  for (const row of SWARM_CLI_COMMANDS) {
    const argv = ['swarm', row.verb,
      ...row.positional.map((_, index) => `positional-${index}`),
      '--no-such-flag'];
    const error = refused(() => parseBatonCli(argv));
    assert.match(error.message, /--no-such-flag/u, `${row.verb}: the token is named`);
    assert.match(error.message, new RegExp(`usage: baton swarm ${row.verb}`, 'u'), `${row.verb}: the usage line is named`);
    assert.equal(error.detail?.rule, 'closed-set', `${row.verb}: the #372 closed-set shape`);
    assert.deepEqual(error.detail?.admitted, admittedFor(row), `${row.verb}: the admitted set is the ONE derivation`);
    assert.equal(error.detail?.usage, row.usage);
  }
});

test('431-e: the seat selector keeps ONE CLI spelling — the contract field kebab --participant-id', () => {
  // the admitted spelling parses byte-identically
  assert.deepEqual(
    parseBatonCli(['--idempotency-key', 'k', 'swarm', 'view', 'S', '--participant-id', 'P']),
    { kind: 'command', name: 'swarm.view', args: { swarmId: 'S', participantId: 'P' }, idempotencyKey: 'k' },
  );
  // the other CLI spelling refuses, naming the admitted one
  const error = refused(() => parseBatonCli(['swarm', 'view', 'S', '--participant', 'P']));
  assert.match(error.message, /--participant-id/u, 'the refusal teaches the admitted spelling');
  assert.ok(error.detail?.admitted?.includes('--participant-id'));
  assert.equal(error.detail?.rule, 'closed-set');
  // the stop refusal points at the usage line that spells <PARTICIPANT-ID>, and the help
  // renderer teaches the same ONE spelling
  assert.match(stopRow.usage, /<PARTICIPANT-ID>/u);
  assert.match(batonCliHelp('swarm.stop'), /<PARTICIPANT-ID>/u);
});

test('431-f: every flag the usage lines teach is admitted — the parse and the help cannot drift', () => {
  for (const row of SWARM_CLI_COMMANDS) {
    const taught = [...new Set([...row.usage.matchAll(/--[a-z][a-z0-9-]*/gu)].map((match) => match[0]))];
    const admitted = admittedFor(row);
    for (const flag of taught) {
      assert.ok(admitted.includes(flag),
        `${row.verb}: the usage line teaches ${flag} but the parser vocabulary does not admit it`);
    }
  }
});

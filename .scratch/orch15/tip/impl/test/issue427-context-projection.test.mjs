// Issue #427 — swarm.view has no `context` projection: the shared-context rows a swarm writes
// with swarm.context_updated (docs/39 §Communication's shared whiteboard: the open team used it
// for two notes) were readable only through the full record, so a peer read a whole multi-megabyte
// view to find a 200-byte note.
//
// The repair has three parts, each pinned here:
//   1. a `context` projection declared in the ONE projection table (swarm-contract.mjs), answered
//      from the swarm.context_updated fold in LEDGER order with each row's actor/seq/ts/body;
//   2. the projection name taught by every surface that derives from that table — the recruit
//      brief, the bridge help, the CLI help the contract's own field rules render — and admitted
//      by the bad-name refusal;
//   3. `--wake-class context` admitted as the wake class the notes already wake under (the
//      canonical class of a swarm.context_updated row), so a seat waits for the whiteboard to move.
//
// Every row below was observed RED at HEAD 53e99cf8 before the change (recorded in the commit).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import {
  SWARM_COMMAND_ROWS, SWARM_VIEW_PROJECTIONS, SWARM_VIEW_PROJECTION_NAMES,
  projectSwarmView, validateSwarmCommand,
} from '../src/swarm-contract.mjs';
import { SWARM_BRIEF_SECTION } from '../src/swarm-native-access.mjs';
import { swarmBridgeMain } from '../src/swarm-native-bridge.mjs';
import { WAKE_CLASSES, parseWakeFilter, wakeClassFor } from '../src/wake-stream.mjs';
import { batonCliHelp, parseBatonCli, watchSwarmFiltered } from '../src/application-cli.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const READ_ONLY = ['list', 'view', 'watch', 'capture', 'check'];

function refused(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
}

/** The light runtime harness the sibling swarm fixtures use (issue350/issue352): a real
 * CoordinationStore behind a SwarmRuntime with no run ports, so a context note is a plain fold. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue427-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], pausedTurns: () => [], guideParticipant: async () => ({ ok: true }) },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async () => {},
    stopRun: async () => ({ state: 'closed' }),
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'ctx' }),
      ...(READ_ONLY.includes(command) ? {} : { idempotencyKey: `ctx-${++key}` }),
      ...args }, caller);
  return { store, runtime, call };
}

/** The admitted values one rendered line teaches: `... — one of: a, b, c` (the shape the brief,
 * the bridge family help and the CLI help each render from the ONE table). */
function admittedFrom(text, prefix) {
  const line = text.split('\n').find((candidate) => candidate.includes(prefix));
  assert.ok(line, `a line teaching ${prefix} is rendered`);
  const tail = line.slice(line.indexOf('one of: ') + 'one of: '.length);
  return tail.split(';')[0].split(',').map((name) => name.trim());
}

test('427a: the context projection answers the shared-context rows in ledger order, and nothing else', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Read the shared whiteboard' });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:first', body: 'the contract is the fold' } });
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:second', body: 'the second note' } });
  // A rewrite keeps its key and moves to the END of the ledger: the projection reads ledger order,
  // not the order keys were first seen.
  await f.call('update', { event: 'swarm.context_updated', payload: { key: 'notes:first', body: 'the contract is the fold (revised)' } });

  const full = await f.call('view');
  const context = await f.call('view', { projection: 'context' });

  assert.equal(context.projection, 'context');
  // ONE derivation: the slice is exactly what the shared slicer says it is.
  assert.deepEqual(context, projectSwarmView(full, 'context'));

  const rows = Object.values(context.context);
  assert.deepEqual(rows.map((row) => row.key), ['notes:second', 'notes:first'],
    'ledger order: the rewritten note sorts by its latest seq, not by when the key was first seen');
  assert.deepEqual(rows.map((row) => row.body), ['the second note', 'the contract is the fold (revised)']);
  assert.equal(rows[0].actor, 'owner', 'each row names the actor that wrote it');
  assert.ok(Number.isSafeInteger(rows[0].seq) && rows[0].seq > 0, 'each row carries its ledger seq');
  assert.ok(typeof rows[0].ts === 'string' && rows[0].ts.length > 0, 'each row carries its ts');
  assert.ok(rows[0].seq < rows[1].seq, 'the rows ascend by seq');

  // The frame rides every projection; every other family is gone — the read a seat can afford.
  for (const family of ['participants', 'work', 'assignments', 'contributions', 'reviews', 'groups',
    'couplings', 'knowledge', 'attention']) {
    assert.equal(family in context, false, `${family} is not in the context slice`);
  }
  assert.equal(context.swarmId, full.swarmId);
  assert.ok(Number.isSafeInteger(context.cursor) && context.cursor >= 3, 'the frame carries the ledger cursor');
});

test('427b: the ONE projection table declares `context`, and the bad-name refusal names it', () => {
  assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes('context'), 'the closed projection set carries context');
  assert.deepEqual([...SWARM_VIEW_PROJECTIONS.context.rows], ['context']);
  assert.equal(SWARM_VIEW_PROJECTIONS.context.participant, null);
  assert.equal(validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'context' }), true);

  const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === 'swarm.view');
  assert.deepEqual(row.properties.projection.enum, SWARM_VIEW_PROJECTION_NAMES);
  assert.ok(row.description.includes('context'), 'the MCP/bridge description teaches the name');

  const refusal = refused(() => validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'wombat' }));
  assert.equal(refusal.code, 'swarm_command_invalid');
  assert.ok(refusal.detail.expectation.includes('context'), 'the expectation names the admitted set');
  assert.ok([...(refusal.detail.admitted ?? [])].includes('context'), 'detail.admitted names it');
  assert.ok(refusal.message.includes('context'), 'the refusal message names it');
});

test('427c: every teaching surface derives the projection set — brief, bridge help, CLI help, CLI parse', async () => {
  const expected = [...SWARM_VIEW_PROJECTION_NAMES];

  const brief = admittedFrom(SWARM_BRIEF_SECTION, 'swarm.view projection —');
  assert.deepEqual(brief, expected, 'the recruit brief lists every projection, context included');

  const out = [];
  const code = await swarmBridgeMain(['--help'], {}, { out: { write: (text) => out.push(text) }, err: { write: () => {} } });
  assert.equal(code, 0, 'the bridge renders help locally, without credentials');
  assert.deepEqual(admittedFrom(out.join(''), 'swarm.view projection —'), expected,
    'the bridge family help lists every projection');

  const perCommand = [];
  await swarmBridgeMain(['swarm.view', '--help'], {}, { out: { write: (text) => perCommand.push(text) }, err: { write: () => {} } });
  const fieldLine = perCommand.join('').split('\n').find((line) => line.trim().startsWith('projection'));
  assert.deepEqual(fieldLine.slice(fieldLine.indexOf('one of ') + 'one of '.length).split(';')[0]
    .split(',').map((name) => name.trim()), expected);

  const cliHelp = batonCliHelp('swarm.view');
  assert.deepEqual(admittedFrom(cliHelp, 'swarm.view projection —'), expected,
    'the CLI help for the verb lists every projection');
  assert.deepEqual(admittedFrom(batonCliHelp('swarm.watch'), 'swarm.watch projection —'), expected,
    'the watch takes the same projection axis, so its help teaches the same set');

  const parsed = parseBatonCli(['swarm', 'view', 'swarm-1', '--projection', 'context']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'swarm.view');
  assert.equal(parsed.args.projection, 'context', 'the real CLI parse admits the name');
});

test('427d: --wake-class context wakes on a new note and not on a guide', async () => {
  // The class the notes already wake under, and the spelling #427 asks a seat to use for it.
  assert.ok(WAKE_CLASSES.includes('context_updated'), 'a context update is a classified wake');
  assert.equal(wakeClassFor({ kind: 'swarm.context_updated', payload: { key: 'notes:x' } }).wakeClass, 'context_updated');
  assert.deepEqual([...parseWakeFilter({ kinds: 'context,context_updated' }).kinds], ['context_updated'],
    'the alias and the class are one entry, never two');

  const filter = parseWakeFilter({ kinds: 'context' });
  assert.deepEqual([...filter.kinds], ['context_updated'], 'the filter resolves the alias to the class');
  assert.throws(() => parseWakeFilter({ kinds: 'wombat' }),
    (error) => error.code === 'invalid_wake_filter' && error.detail.unknown.includes('wombat'));

  const parsed = parseBatonCli(['swarm', 'watch', 'swarm-1', '--timeout-ms', '50', '--wake-class', 'context']);
  assert.equal(parsed.kind, 'swarm_watch_filtered');
  assert.deepEqual([...parsed.kinds], ['context_updated'], 'the real CLI parse admits the flag');

  // The bounded watch: a guide row (guidance_delivered) does NOT match the context filter, so the
  // watch re-arms past it and answers on the note that follows.
  const asked = [];
  const client = {
    async command(name, args) {
      asked.push(args);
      return asked.length === 1
        ? { projection: 'outline',
          watch: { reason: 'event', matchedSeq: 10, event: { kind: 'message.delivered', payloadKind: null, seq: 10 } } }
        : { projection: 'outline',
          watch: { reason: 'event', matchedSeq: 11, event: { kind: 'swarm.context_updated', payloadKind: null, seq: 11,
            payload: { key: 'notes:x', body: 'woke' } } } };
    },
  };
  const answer = await watchSwarmFiltered(parsed, client);
  assert.equal(asked.length, 2, 'the guide row re-armed the watch instead of answering it');
  assert.equal(asked[1].afterSeq, 10, 'the re-arm resumes past the row that did not match');
  assert.equal(answer.watch.matchedSeq, 11);
  assert.equal(answer.watch.wakeClass, 'context_updated');
});

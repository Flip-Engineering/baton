// Issue #372 — seats discover closed vocabularies by being refused: a `swarm.view`
// projection typo refused `closed-set` without naming the admitted values, and an
// `evidence.search` typo refused `unknown-field` without naming the admitted fields —
// while neither the brief's Swarm section nor the bridge help listed either set.
// The repair: closed-set/unknown-field refusals carry `detail.admitted` (read from the
// same tables the validator judges against), and the bridge help + brief render every
// closed set from those tables at render time, never a hand-typed list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  SWARM_EVENT_KINDS,
  SWARM_VIEW_PROJECTION_NAMES,
  SWARM_COMMAND_DEFINITIONS,
  validateSwarmCommand,
} from '../src/swarm-contract.mjs';
import { EVIDENCE_SEARCH_FILTERS } from '../src/evidence-search.mjs';
import { SWARM_BRIEF_SECTION } from '../src/swarm-native-access.mjs';

const refused = (fn) => {
  try { fn(); } catch (error) { return error; }
  assert.fail('expected a typed refusal');
};

const bridgeHelp = (args) => new Promise((resolve, reject) => {
  execFile(process.execPath, ['impl/src/swarm-native-bridge.mjs', ...args], { timeout: 15000 },
    (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout));
});

test('372-a: a closed-set refusal names the admitted values and they equal the registry set', () => {
  const projection = refused(() => validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'bogus' }));
  assert.equal(projection.code, 'swarm_command_invalid');
  assert.equal(projection.detail?.rule, 'closed-set');
  assert.deepEqual([...(projection.detail?.admitted ?? [])].sort(),
    [...SWARM_VIEW_PROJECTION_NAMES].sort());
  assert.match(projection.message, /projection must be one of: /u);
  for (const name of SWARM_VIEW_PROJECTION_NAMES) assert.match(projection.message, new RegExp(name, 'u'));

  const event = refused(() => validateSwarmCommand('swarm.update',
    { swarmId: 's', event: 'bogus', idempotencyKey: 'k' }));
  assert.equal(event.detail?.rule, 'closed-set');
  assert.deepEqual([...(event.detail?.admitted ?? [])].sort(), [...SWARM_EVENT_KINDS].sort());
  assert.match(event.message, /event must be one of: /u);
});

test('372-b: an unknown-field refusal names the admitted fields', () => {
  const error = refused(() => validateSwarmCommand('swarm.view', { swarmId: 's', text: 'x' }));
  assert.equal(error.code, 'swarm_command_invalid');
  assert.equal(error.detail?.rule, 'unknown-field');
  assert.deepEqual([...(error.detail?.admitted ?? [])].sort(),
    [...SWARM_COMMAND_DEFINITIONS['swarm.view'].args].sort());
});

test('372-c: the bridge help text contains every projection value and every evidence.search field', async () => {
  const family = await bridgeHelp(['--help']);
  for (const name of SWARM_VIEW_PROJECTION_NAMES) assert.match(family, new RegExp(name, 'u'));
  for (const field of EVIDENCE_SEARCH_FILTERS) assert.match(family, new RegExp(field, 'u'));
  const view = await bridgeHelp(['swarm.view', '--help']);
  for (const name of SWARM_VIEW_PROJECTION_NAMES) assert.match(view, new RegExp(name, 'u'));
  const search = await bridgeHelp(['evidence.search', '--help']);
  for (const field of EVIDENCE_SEARCH_FILTERS) assert.match(search, new RegExp(field, 'u'));
});

test('372-d: the brief section contains every projection value and every evidence.search field', () => {
  for (const name of SWARM_VIEW_PROJECTION_NAMES) assert.match(SWARM_BRIEF_SECTION, new RegExp(name, 'u'));
  for (const field of EVIDENCE_SEARCH_FILTERS) assert.match(SWARM_BRIEF_SECTION, new RegExp(field, 'u'));
});

test('372-e: drift pin — the rendered sets equal the exported sets, so a new value cannot land in one without the other', async () => {
  const oneOfLine = (text, label) => {
    const line = text.split('\n').find((candidate) => candidate.includes(label));
    assert.ok(line, `no rendered ${label} line`);
    return line.split('one of:')[1].split(',').map((part) => part.trim()).filter(Boolean);
  };
  assert.deepEqual(oneOfLine(SWARM_BRIEF_SECTION, 'swarm.view projection').sort(),
    [...SWARM_VIEW_PROJECTION_NAMES].sort());
  assert.deepEqual(oneOfLine(SWARM_BRIEF_SECTION, 'evidence.search fields').sort(),
    [...EVIDENCE_SEARCH_FILTERS].sort());
  const family = await bridgeHelp(['--help']);
  assert.deepEqual(oneOfLine(family, 'swarm.view projection').sort(),
    [...SWARM_VIEW_PROJECTION_NAMES].sort());
  assert.deepEqual(oneOfLine(family, 'evidence.search fields').sort(),
    [...EVIDENCE_SEARCH_FILTERS].sort());
});

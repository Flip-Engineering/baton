// Classification contract tests over the retained, exactly-characterized
// compiler diagnostic fixtures, the retained GNU time artifacts, and the
// shared qualification boundary. Pure unit tests; no compiler runs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../laws-check.mjs';
import {
  TODO_REFUSAL,
  accountingProfile,
  accountingValid,
  classifyCase,
  classifyControl,
  intendedMutationRefusal,
  isTodoRefusal,
  parseResourceAccounting,
  refusedNormally,
  splitTimeAccounting,
  validChildOutcome,
} from './classify.mjs';

const PROOF = { kind: 'proof-removal', law: 'help_word_selects_the_help_command', module: 'bend2/src/coordinator/commands.bend' };
const MUTATION = { kind: 'mutation', law: 'help_word_selects_the_help_command', module: 'bend2/src/coordinator/commands.bend' };
const BASELINE = { kind: 'baseline' };

// Retained fixture: proof removal of help_word_selects_the_help_command at
// fca7af87 exited 1 with exactly these 72 bytes on stderr and empty stdout.
const TODO_STDERR = 'Error: 1 TODO found.\nThe code is incomplete, and not a valid proof yet.\n';

// Retained fixture: the help-word-is-refused implementation mutant exited 1
// with this block, whose Location names the law under the module prefix.
const MUTANT_STDERR = [
  'Error:',
  '- expected : commands.Invalid{}',
  '- observed : commands.Help{}',
  'Location: commands.help_word_selects_the_help_command',
  '395 | def help_word_selects_the_help_command():',
  '396>|   {==}',
  '397 |',
  '',
].join('\n');

// Retained fixture: an unrelated malformed declaration exited 1 with an empty
// Location and different diagnostics.
const SYNTAX_STDERR = [
  'Error:',
  '- expected : a name',
  "- observed : ':'",
  'Location:',
  '425 |',
  '426>| def malformed(:',
  '427 |',
  '',
].join('\n');

const exited = (exitCode, stderrText) => ({ state: 'exited', exitCode, signal: null, spawnError: null, stderrText });

test('todo refusal matches the exact retained diagnostic and nothing else', () => {
  assert.equal(isTodoRefusal(TODO_STDERR), true);
  assert.equal(isTodoRefusal(TODO_REFUSAL), true);
  assert.equal(isTodoRefusal(TODO_STDERR + 'extra\n'), false);
  assert.equal(isTodoRefusal(SYNTAX_STDERR), false);
});

test('proof control classifies intended only for the exact nameless refusal', () => {
  assert.deepEqual(classifyControl({ ...exited(1, TODO_STDERR), control: PROOF }), {
    class: 'intended-law-refusal', attributedLaw: PROOF.law,
  });
  assert.equal(classifyControl({ ...exited(1, TODO_STDERR + 'Error: later failure\n'), control: PROOF }).class, 'unclassified-rejection');
  assert.equal(classifyControl({ ...exited(1, SYNTAX_STDERR), control: PROOF }).class, 'unclassified-rejection');
  assert.equal(classifyControl({ ...exited(0, ''), control: PROOF }).class, 'accepted');
});

test('mutation control requires the error block, constructors and the law-naming location', () => {
  assert.deepEqual(classifyControl({ ...exited(1, MUTANT_STDERR), control: MUTATION }), {
    class: 'intended-law-refusal', attributedLaw: MUTATION.law,
  });
  const bareLocation = 'Error:\nLocation: commands.help_word_selects_the_help_command\n';
  assert.equal(intendedMutationRefusal(bareLocation, MUTATION.law), null);
  const wrongLeaf = MUTANT_STDERR.replace('help_word_selects_the_help_command', 'another_law');
  assert.equal(intendedMutationRefusal(wrongLeaf, MUTATION.law), null);
  // A bound qualified location must match exactly.
  assert.deepEqual(
    intendedMutationRefusal(MUTANT_STDERR, MUTATION.law, 'commands.help_word_selects_the_help_command'),
    { location: 'commands.help_word_selects_the_help_command', law: MUTATION.law },
  );
  assert.equal(intendedMutationRefusal(MUTANT_STDERR, MUTATION.law, 'other.help_word_selects_the_help_command'), null);
  assert.equal(classifyControl({ ...exited(1, SYNTAX_STDERR), control: MUTATION }).class, 'unclassified-rejection');
  assert.equal(classifyControl({ ...exited(0, ''), control: MUTATION }).class, 'accepted');
});

test('outcome shapes are validated without coercion', () => {
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1, signal: null, spawnError: null }), true);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: '1', signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: false, signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: -1, signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1.5, signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: null, signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1, signal: undefined, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1, signal: '', spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1, signal: null, spawnError: 'later' }), false);
  assert.equal(validChildOutcome({ state: 'exited', exitCode: 1, signal: null, spawnError: '' }), false);
  assert.equal(validChildOutcome({ state: 'signalled', exitCode: null, signal: '9', spawnError: null }), true);
  assert.equal(validChildOutcome({ state: 'signalled', exitCode: null, signal: 9, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'signalled', exitCode: 1, signal: '9', spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'signalled', exitCode: null, signal: null, spawnError: null }), false);
  assert.equal(validChildOutcome({ state: 'spawn-error', exitCode: null, signal: null, spawnError: 'ENOENT' }), true);
  assert.equal(validChildOutcome({ state: 'not-run', exitCode: null, signal: null, spawnError: null }), true);
  assert.equal(validChildOutcome({ state: 'running', exitCode: null, signal: null, spawnError: null }), false);
  for (const bad of [{ state: 'exited', exitCode: '1', signal: null, spawnError: null },
    { state: 'exited', exitCode: -1, signal: null, spawnError: null },
    { state: 'exited', exitCode: 1.5, signal: null, spawnError: null },
    { state: 'exited', exitCode: false, signal: null, spawnError: null },
    { state: 'exited', exitCode: null, signal: null, spawnError: null },
    { state: 'exited', exitCode: 1, signal: undefined, spawnError: null },
    { state: 'exited', exitCode: 1, signal: 9, spawnError: null },
    { state: 'signalled', exitCode: 1, signal: '9', spawnError: null }]) {
    assert.equal(classifyControl({ ...bad, stderrText: TODO_STDERR, control: PROOF }).class, 'malformed-outcome');
  }
  assert.equal(refusedNormally({ exitCode: '1', signal: null }), false);
  assert.equal(refusedNormally({ exitCode: -1, signal: null }), false);
  assert.equal(refusedNormally({ exitCode: 1, signal: 'SIGKILL' }), false);
  assert.equal(refusedNormally({ exitCode: 1, signal: null }), true);
});

test('the shared qualification boundary demands every prerequisite', () => {
  const qualified = { expected: 'commands.Invalid{}', observed: 'commands.Help{}' };
  const call = (overrides) => classifyCase({
    control: MUTATION, expectation: qualified, location: 'commands.help_word_selects_the_help_command',
    state: 'exited', exitCode: 1, signal: null, spawnError: null,
    stderrText: MUTANT_STDERR, baselineOk: true,
    delta: { changedText: 'changed', expectedChangedText: 'changed' },
    supplied: null, ...overrides,
  });
  assert.equal(call({}).qualified, true);
  assert.equal(call({ baselineOk: false }).class, 'unqualified-baseline');
  assert.equal(call({ expectation: undefined }).class, 'expectation-unqualified');
  assert.equal(call({ location: undefined }).class, 'expectation-unqualified');
  assert.equal(call({ delta: null }).class, 'delta-unverified');
  assert.equal(call({ delta: { changedText: 'a', expectedChangedText: 'b' } }).class, 'delta-unverified');
  assert.equal(call({ supplied: { class: 'intended-law-refusal', attributed_law: 'other' } }).class, 'misreported-diagnostic');
  assert.equal(call({ exitCode: '1' }).class, 'malformed-outcome');
  // Proof controls need no definition metadata, only the exact diagnostic,
  // the matched baseline and the verified delta.
  const proofCall = (overrides) => classifyCase({
    control: PROOF, expectation: undefined, location: undefined,
    state: 'exited', exitCode: 1, signal: null, spawnError: null,
    stderrText: TODO_STDERR, baselineOk: true,
    delta: { changedText: 'c', expectedChangedText: 'c' },
    supplied: null, ...overrides,
  });
  assert.equal(proofCall({}).qualified, true);
  assert.equal(proofCall({ baselineOk: false }).class, 'unqualified-baseline');
});

test('time accounting splits at the retained GNU preamble and first field', () => {
  const gnuArtifact = readFileSync(join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'gnu-time', 'receive-request.time.txt'), 'utf8');
  const gnuSplit = splitTimeAccounting('child diagnostic line\n' + gnuArtifact);
  assert.equal(gnuSplit.diagnostics, 'child diagnostic line\n');
  assert.equal(gnuSplit.profile, 'gnu-time-v');
  assert.equal(accountingValid(gnuSplit.accounting, gnuSplit.profile), true);
  assert.equal(classifyControl({ ...exited(1, 'child diagnostic line\n' + gnuArtifact), control: PROOF }).class, 'unclassified-rejection');
  const plainGnu = readFileSync(join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'gnu-time', 'retained-read.time.txt'), 'utf8');
  const plainSplit = splitTimeAccounting(plainGnu);
  assert.equal(plainSplit.diagnostics, '');
  assert.equal(accountingValid(plainSplit.accounting, plainSplit.profile), true);
  // A recognized field plus extra unknown suffix text stays invalid.
  const poisoned = TODO_STDERR + '\tUser time (seconds): 0.10\nnot a wrapper field\n';
  assert.equal(classifyControl({ ...exited(1, poisoned), control: PROOF }).class, 'accounting-invalid');
});

test('darwin accounting tolerates padded columns and keeps units explicit', () => {
  const darwinSuffix = '       109.94 real        74.20 user        30.10 sys\n'
    + '        2152748  maximum resident set size\n'
    + '           1464984  page reclaims\n'
    + '                   0  page faults\n';
  const split = splitTimeAccounting(TODO_STDERR + darwinSuffix);
  assert.equal(split.profile, 'darwin-usr-bin-time');
  assert.equal(accountingValid(split.accounting, split.profile), true);
  const resource = parseResourceAccounting(split.accounting, split.profile);
  assert.ok(resource, 'the darwin resource parser must read the padded header');
  assert.equal(resource.max_rss_bytes, 2152748);
  assert.equal(resource.max_rss_source_unit, 'bytes');
  const gnuResource = parseResourceAccounting(
    '\tElapsed (wall clock) time (h:mm:ss or m:ss): 1:22.44\n'
    + '\tUser time (seconds): 104.62\n'
    + '\tSystem time (seconds): 15.15\n'
    + '\tMaximum resident set size (kbytes): 2152748\n',
    'gnu-time-v',
  );
  assert.ok(gnuResource, 'the gnu resource parser must read its labeled fields');
  assert.equal(gnuResource.real_seconds > 82 && gnuResource.real_seconds < 83, true);
  assert.equal(gnuResource.max_rss_bytes, 2152748 * 1024);
  assert.equal(gnuResource.max_rss_source_unit, 'kbytes');
});

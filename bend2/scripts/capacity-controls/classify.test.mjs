// Classification contract tests over the retained, exactly-characterized
// compiler diagnostic fixtures: the nameless two-line TODO refusal, the bound
// mutation refusal with expected/observed constructors and a qualified
// Location, and an unrelated malformed-declaration refusal with an empty
// Location. These are pure unit tests; no compiler runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TODO_REFUSAL,
  accountingProfile,
  accountingValid,
  classifyControl,
  intendedMutationRefusal,
  isTodoRefusal,
  parseResourceAccounting,
  qualifiedLawLocation,
  splitTimeAccounting,
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
  assert.equal(isTodoRefusal('Error: 2 TODOs found.\nThe code is incomplete, and not a valid proof yet.\n'), false);
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

test('mutation control requires the error block, constructors and qualified law location', () => {
  assert.deepEqual(classifyControl({ ...exited(1, MUTANT_STDERR), control: MUTATION }), {
    class: 'intended-law-refusal', attributedLaw: MUTATION.law,
  });
  const bareLocation = 'Error:\nLocation: commands.help_word_selects_the_help_command\n';
  assert.equal(intendedMutationRefusal(bareLocation, MUTATION.law), null);
  assert.equal(intendedMutationRefusal(MUTANT_STDERR.replace('- expected : commands.Invalid{}\n', ''), MUTATION.law), null);
  const wrongLeaf = MUTANT_STDERR.replace('help_word_selects_the_help_command', 'another_law');
  assert.equal(qualifiedLawLocation(wrongLeaf, MUTATION.law), null);
  assert.equal(classifyControl({ ...exited(1, SYNTAX_STDERR), control: MUTATION }).class, 'unclassified-rejection');
  assert.equal(classifyControl({ ...exited(0, ''), control: MUTATION }).class, 'accepted');
});

test('constructor expectations bind through the classifier', () => {
  const expectation = { expected: 'commands.Invalid{}', observed: 'commands.Help{}' };
  assert.deepEqual(classifyControl({ ...exited(1, MUTANT_STDERR), control: MUTATION, expectation }), {
    class: 'intended-law-refusal', attributedLaw: MUTATION.law,
  });
  const wrong = { expected: 'Decision.Conflict{}', observed: 'Decision.Grant{}' };
  assert.equal(classifyControl({ ...exited(1, MUTANT_STDERR), control: MUTATION, expectation: wrong }).class, 'expectation-mismatch');
});

test('outcome shape is honored: crashes, spawn errors and unfinished states', () => {
  assert.equal(classifyControl({ state: 'exited', exitCode: null, signal: 'SIGSEGV', spawnError: null, stderrText: TODO_STDERR, control: PROOF }).class, 'crashed');
  assert.equal(classifyControl({ state: 'spawn-error', exitCode: null, signal: null, spawnError: 'ENOENT', stderrText: '', control: PROOF }).class, 'spawn-error');
  assert.equal(classifyControl({ state: 'exited', exitCode: null, signal: null, spawnError: null, stderrText: '', control: PROOF }).class, 'unfinished');
  assert.deepEqual(classifyControl({ ...exited(0, ''), control: BASELINE }), { class: 'baseline-ok', attributedLaw: null });
  assert.equal(classifyControl({ ...exited(1, TODO_STDERR), control: BASELINE }).class, 'baseline-failed');
});

test('time accounting splits from diagnostics and must match a measured profile', () => {
  const darwinSuffix = '       12.34 real         5.67 user         1.23 sys\n'
    + '             123456 maximum resident set size\n'
    + '               789 page reclaims\n'
    + '              1234 page faults\n';
  const combined = TODO_STDERR + darwinSuffix;
  const split = splitTimeAccounting(combined);
  assert.equal(split.diagnostics, TODO_STDERR);
  assert.equal(split.profile, 'darwin-usr-bin-time');
  assert.equal(accountingValid(split.accounting, split.profile), true);
  assert.deepEqual(
    classifyControl({ ...exited(1, combined), control: PROOF }),
    { class: 'intended-law-refusal', attributedLaw: PROOF.law },
  );
  const poisoned = TODO_STDERR + darwinSuffix + 'unrelated failure line\n';
  assert.equal(classifyControl({ ...exited(1, poisoned), control: PROOF }).class, 'accounting-invalid');
  const gnuSuffix = '\tUser time (seconds): 0.45\n'
    + '\tSystem time (seconds): 0.12\n'
    + '\tElapsed (wall clock) time (h:mm:ss or m:ss): 1:02.34\n'
    + '\tMaximum resident set size (kbytes): 2800000\n'
    + '\tExit status: 1\n';
  const gnuSplit = splitTimeAccounting(TODO_STDERR + gnuSuffix);
  assert.equal(gnuSplit.profile, 'gnu-time-v');
  assert.equal(accountingValid(gnuSplit.accounting, gnuSplit.profile), true);
  const gnuResource = parseResourceAccounting(gnuSplit.accounting, gnuSplit.profile);
  assert.equal(gnuResource.profile, 'gnu-time-v');
  assert.equal(gnuResource.max_rss_bytes, 2800000 * 1024);
  assert.equal(gnuResource.max_rss_source_unit, 'kbytes');
  assert.equal(gnuResource.real_seconds > 62 && gnuResource.real_seconds < 63, true);
  const darwinResource = parseResourceAccounting(darwinSuffix, 'darwin-usr-bin-time');
  assert.equal(darwinResource.max_rss_bytes, 123456);
  assert.equal(darwinResource.max_rss_source_unit, 'bytes');
  assert.equal(darwinResource.page_reclaims, 789);
});

test('wrapper-translated signals classify as crashes, never as refusals', () => {
  // The group runner detects the darwin time wrapper's terminated-by-signal
  // report and records state signalled; the classifier refuses such outcomes.
  const wrapped = TODO_STDERR + 'Command terminated by signal 9\n';
  assert.equal(classifyControl({ ...exited(1, wrapped), control: PROOF }).class, 'unclassified-rejection');
  assert.equal(classifyControl({ state: 'signalled', exitCode: 1, signal: 9, spawnError: null, stderrText: TODO_STDERR, control: PROOF }).class, 'crashed');
});

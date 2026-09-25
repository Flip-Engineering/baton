// 2026-09-14 deep codebase audit, U-E4: every web-admitted command carries an accepted-field set,
// so an envelope naming any admitted command with any argument is validated — refused by name or
// admitted — and never crashes the validator. Before the fix `deployment.doctor` (both spellings)
// and the dot spelling of the scratchpad append mapped to no field set at all, and a single
// authenticated request killed `baton serve` through an unhandled rejection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebCommandEnvelope, webAdmittedCommandNames } from '../src/web-northbound.mjs';

const envelope = (command, args) => ({
  schemaVersion: 1, commandId: 'c-1', idempotencyKey: 'k-1', command, args, repoId: 'repo-a', origin: 'https://baton.invalid',
});

test('every web-admitted command validates an envelope carrying an unknown argument instead of crashing', () => {
  for (const command of webAdmittedCommandNames()) {
    let verdict;
    assert.doesNotThrow(() => { verdict = validateWebCommandEnvelope(envelope(command, { definitelyNotAField: 1 })); }, `validator crashed on ${command}`);
    assert.notEqual(verdict, null, `${command} admitted an argument no command declares`);
  }
});

test('the doctor and the scratchpad append are validated by name on both spellings', () => {
  for (const command of ['deployment.doctor', 'deployment_doctor']) {
    const verdict = validateWebCommandEnvelope(envelope(command, { check: true }));
    assert.equal(verdict?.code ?? verdict, 'unknown_argument_field', `${command}: the doctor's argument authority is the closed empty set`);
    assert.equal(verdict?.field, 'check');
  }
  for (const command of ['run.scratchpad.append', 'run_scratchpad_append']) {
    assert.equal(validateWebCommandEnvelope(envelope(command, { runId: 'run:1', scope: 'shared', body: 'note' })), null,
      `${command}: the closed append set is admitted on both spellings`);
  }
});

// Phase 92 RED contracts for bounded resident replay and verifier coherence. Fixtures are not
// live-provider evidence and do not establish PID liveness.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, CoordinationStore } from '../src/index.mjs';

function root(t, label) {
  const value = mkdtempSync(join(tmpdir(), `baton-phase92-${label}-`));
  t.after(() => rmSync(value, { recursive: true, force: true }));
  return value;
}

function appendRecords(store, count, from = 1) {
  for (let index = from; index < from + count; index += 1) {
    store.recordDriver('phase92.replay.fixture', { index }, {
      actor: 'test:phase92', key: `phase92:replay:${index}`,
    });
  }
}

test('P92-RP1: a clean close persists a prefix-bound checkpoint and restart folds only its tail', (t) => {
  const directory = root(t, 'checkpoint');
  const first = new CoordinationStore(directory);
  appendRecords(first, 320);
  first.releaseWriterLease({ requireOwned: true });
  assert.equal(existsSync(join(directory, 'projection.checkpoint')), true);

  const ledger = join(directory, 'events.jsonl');
  appendFileSync(ledger, `${JSON.stringify({
    schemaVersion: 1, seq: 321, ts: new Date().toISOString(), kind: 'driver.recorded',
    actor: 'test:phase92', idempotencyKey: 'phase92:replay:321',
    payload: { kind: 'phase92.replay.fixture', index: 321 },
  })}\n`);
  const progress = [];
  const reopened = new CoordinationStore(directory, {
    startupProgress: (entry) => progress.push(entry),
  });
  assert.equal(reopened.snapshot().lastSeq, 321);
  assert.deepEqual(reopened.startupStatus(), {
    schemaVersion: 1, state: 'ready', source: 'checkpoint_tail',
    totalEvents: 321, checkpointEvents: 320, replayedEvents: 1,
    checkpoint: 'valid', failure: null,
  });
  assert.equal(progress.at(-1).state, 'ready');
});

test('P92-RP1b: a valid checkpoint caches parsing but every prefix event still crosses replay validation', (t) => {
  const directory = root(t, 'checkpoint-reapply');
  const first = new CoordinationStore(directory);
  appendRecords(first, 20);
  first.releaseWriterLease({ requireOwned: true });
  let applications = 0;
  class ApplyingStore extends CoordinationStore {
    _apply(event) { applications += 1; return super._apply(event); }
  }
  const reopened = new ApplyingStore(directory);
  assert.equal(applications, 20, 'a parsed-event checkpoint never installs an authoritative projection');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('P92-RP1c: release cannot bless a ledger prefix changed behind the active projection', (t) => {
  const directory = root(t, 'checkpoint-drift');
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  appendRecords(store, 16);
  const ledger = join(directory, 'events.jsonl');
  const original = readFileSync(ledger, 'utf8');
  const tampered = original.replace('"idempotencyKey":"phase92:replay:2"',
    '"idempotencyKey":"phase92:replay:1"');
  assert.equal(tampered.length, original.length);
  assert.notEqual(tampered, original);
  writeFileSync(ledger, tampered);
  assert.equal(store.releaseWriterLease({ requireOwned: true }), true,
    'cache drift cannot redefine exact lease removal');
  assert.throws(() => new CoordinationStore(directory),
    (error) => error?.code === 'duplicate_key');
});

test('P92-RP2: checkpoint corruption falls back to the authoritative ledger and reports that fact', (t) => {
  const directory = root(t, 'corrupt-checkpoint');
  const first = new CoordinationStore(directory);
  appendRecords(first, 8);
  first.releaseWriterLease({ requireOwned: true });
  writeFileSync(join(directory, 'projection.checkpoint'), Buffer.from('not a checkpoint'), { mode: 0o600 });

  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.snapshot().lastSeq, 8);
  assert.deepEqual(reopened.startupStatus(), {
    schemaVersion: 1, state: 'ready', source: 'ledger_fallback',
    totalEvents: 8, checkpointEvents: 0, replayedEvents: 8,
    checkpoint: 'corrupt', failure: null,
  });
});

test('P92-VF1: a false red-green verdict can never project accepted from a completed-looking phase', () => {
  const result = {
    verificationAcceptance: {
      policy: 'red_green_required', accepted: false,
      requireRedGreen: true, requireCoverage: false, requireMutation: false,
    },
    verdict: {
      schemaVersion: 1, reverified: true, passed: true, redGreen: false,
      observedExit: 0, outcome: 'passed', failureOwnership: null,
      execution: { state: 'completed', code: 'verification_completed' },
      baseExecution: { state: 'completed', code: 'verification_completed' },
      outputExceeded: false, capturedOutputBytes: 0,
      capturedOutputDigest: '0'.repeat(64), diagnosticCode: 'verification_red_green_failed',
      durationMs: 1, runtimeDigest: '1'.repeat(64),
    },
  };
  const projected = BatonApplication.prototype._closedVerdictProjection.call({
    driver: { log: { read: () => [] } },
  }, result, { verification: { expectExit: 0 } }, 'work_completed', null);
  assert.equal(projected.accepted, false);
  assert.deepEqual(projected.acceptancePolicy, {
    mode: 'red_green_required', requireRedGreen: true,
    requireCoverage: false, requireMutation: false,
  });
});

test('P92-RP3: a corrupt authoritative ledger still fails closed and reports startup failure', (t) => {
  const directory = root(t, 'corrupt-ledger');
  const first = new CoordinationStore(directory);
  appendRecords(first, 2);
  first.releaseWriterLease({ requireOwned: true });
  appendFileSync(join(directory, 'events.jsonl'), '{truncated');
  const progress = [];
  assert.throws(() => new CoordinationStore(directory, {
    startupProgress: (entry) => progress.push(entry),
  }), (error) => error?.code === 'truncated_tail');
  assert.equal(progress.at(-1)?.state, 'failed');
  assert.equal(readFileSync(join(directory, 'events.jsonl'), 'utf8').endsWith('\n'), false);
});

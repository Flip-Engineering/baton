// Phase 92 RED contracts for bounded resident replay and verifier coherence. Fixtures are not
// live-provider evidence and do not establish PID liveness.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
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
    poison: null, quarantined: [],
  });
  assert.equal(progress.at(-1).state, 'ready');
});

test('P92-RP1b: a valid checkpoint installs its state, and the rows it covers still cross replay validation', (t) => {
  const directory = root(t, 'checkpoint-reapply');
  const first = new CoordinationStore(directory);
  appendRecords(first, 20);
  first.releaseWriterLease({ requireOwned: true });
  let applications = 0;
  class ApplyingStore extends CoordinationStore {
    _apply(event) { applications += 1; return super._apply(event); }
  }
  const reopened = new ApplyingStore(directory);
  // Issue #465(4): the checkpoint carries the STATE of the rows it covers (`coversSeq`), so those
  // rows are not folded again — they are read back from the ledger and indexed, and only the tail
  // beyond coversSeq crosses the fold.
  assert.equal(applications, 0, 'a state checkpoint does not re-fold the rows it covers');
  assert.equal(reopened.snapshot().lastSeq, 20, 'every row is on the store');
  assert.equal(reopened._events.length, 20);
  assert.equal(reopened._byKey.size, 20);
  reopened.releaseWriterLease({ requireOwned: true });

  // …and the rows are still judged by the REPLAY's own validation, not trusted because a checkpoint
  // covered them: a prefix that duplicates an idempotency key — with the envelope's byte proofs
  // re-stamped, so only the row's own shape can refuse it — is refused exactly as a cold replay
  // refuses it. The checkpoint's state cannot bless a ledger the fold would reject.
  const ledgerPath = join(directory, 'events.jsonl');
  const original = readFileSync(ledgerPath, 'utf8');
  const tampered = original.replace('"phase92:replay:2"', '"phase92:replay:1"');
  assert.notEqual(tampered, original);
  assert.equal(tampered.length, original.length, 'the prefix byte flips without reshaping the line');
  writeFileSync(ledgerPath, tampered);
  const envelopePath = join(directory, 'projection.checkpoint');
  const envelope = deserialize(readFileSync(envelopePath));
  envelope.projectionBytes = Buffer.from(envelope.projectionBytes);
  envelope.prefixDigest = createHash('sha256').update(readFileSync(ledgerPath).subarray(0, envelope.prefixBytes)).digest('hex');
  envelope.coversLineDigest = createHash('sha256').update(readFileSync(ledgerPath)
    .subarray(readFileSync(ledgerPath).lastIndexOf(0x0a, envelope.prefixBytes - 2) + 1, envelope.prefixBytes - 1)).digest('hex');
  writeFileSync(envelopePath, serialize(envelope), { mode: 0o600 });
  assert.throws(() => new CoordinationStore(directory),
    (error) => error?.code === 'duplicate_key',
    'the covered rows are read under the replay\'s validation, whatever the checkpoint carries');
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
    poison: null, quarantined: [],
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

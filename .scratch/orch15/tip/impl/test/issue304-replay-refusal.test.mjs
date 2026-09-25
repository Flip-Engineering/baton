// Issue #304 — the typed startup replay failure and its operator surfaces.
//
// The incident: a fold-time admissibility rule landed inside foldSwarmEvent — which also
// replays the ledger at startup — and a resident died with the bare integrity message, no seq,
// no kind, no remedy. This file pins the three surfaces that class now has to pass:
//   1. a ledger whose recorded row cannot fold refuses STARTUP typed: the error names the
//      offending row's seq, kind, the fold's own code and message, and the remedy;
//   2. the #290 quarantine verb is the named remedy and actually closes the loop: after it
//      records the seq, the same startup replays clean;
//   3. `baton doctor` — through the same read-only probe the deployment runs at startup —
//      shows that row and its remedy while the deployment is in the refused state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CoordinationStore, SwarmReplayRefusal, coordinationReplayFailure, quarantineCoordinationLedgerEvent } from '../src/coordination-store.mjs';

/** A two-row coordination ledger whose second row cannot fold: a contribution naming a
 * participant that was never recorded. This is the #304 shape — a row on the ledger that a
 * resident must be told about with coordinates, not a bare code. */
function writePoisonedLedger(directory) {
  mkdirSync(directory, { recursive: true });
  const rows = [
    { schemaVersion: 1, seq: 1, ts: '2026-09-14T12:00:00.000Z', kind: 'swarm.created', actor: 'owner', idempotencyKey: 'k1', payload: { swarmId: 'sw-x', purpose: 'typed-replay-failure' } },
    { schemaVersion: 1, seq: 2, ts: '2026-09-14T12:00:01.000Z', kind: 'swarm.contribution_recorded', actor: 'owner', idempotencyKey: 'k2', payload: { swarmId: 'sw-x', contributionId: 'c-ghost', participantId: 'ghost', body: 'no such participant' } },
  ];
  writeFileSync(join(directory, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('a ledger whose recorded swarm row cannot fold refuses startup typed, naming seq, kind, code, message and remedy', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-replay-refusal-'));
  const directory = join(root, 'coordination');
  try {
    writePoisonedLedger(directory);
    let refusal = null;
    try { new CoordinationStore(directory); } catch (error) { refusal = error; }
    assert.ok(refusal instanceof SwarmReplayRefusal,
      `startup raises the typed replay refusal, not ${refusal?.constructor?.name}: ${refusal?.message}`);
    assert.equal(refusal.coordinationSeq, 2, 'the refusal names the offending row seq');
    assert.equal(refusal.coordinationKind, 'swarm.contribution_recorded', 'the refusal names the offending row kind');
    assert.equal(refusal.code, 'participant_not_found', 'the refusal keeps the fold code as its cause');
    assert.equal(refusal.causeCode, 'participant_not_found');
    assert.ok(refusal.message.includes(refusal.causeMessage), 'the refusal message carries the offending row message');
    assert.match(refusal.message, /seq 2/u, 'the refusal message names the seq');
    assert.match(refusal.message, /swarm\.contribution_recorded/u, 'the refusal message names the kind');
    assert.match(refusal.message, /participant_not_found/u, 'the refusal message names the code');
    assert.match(refusal.message, /quarantine/u, 'the refusal names the #290 quarantine remedy');
    assert.match(refusal.remedy, /quarantine/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the named remedy closes the loop: quarantining the recorded seq makes the same startup replay clean', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-replay-refusal-'));
  const directory = join(root, 'coordination');
  try {
    writePoisonedLedger(directory);
    assert.throws(() => new CoordinationStore(directory), (error) => error.coordinationSeq === 2,
      'startup refuses before the repair');
    const repaired = await quarantineCoordinationLedgerEvent(directory, { seq: 2, reason: 'recorded row the fold refuses', actor: 'operator' });
    assert.equal(repaired.result, 'quarantined');
    assert.equal(repaired.entry.causeCode, 'participant_not_found', 'the quarantine entry records the fold code as the cause');
    const store = new CoordinationStore(directory);
    assert.equal(store.events().length, 2, 'the ledger bytes stay parsed — both rows remain on the log');
    assert.deepEqual(store.startupStatus().quarantined, [2], 'the startup reports the quarantined seq');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the doctor probe reports the typed refusal while the deployment is in the refused state, and null once it replays clean', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-replay-refusal-'));
  const directory = join(root, 'coordination');
  try {
    writePoisonedLedger(directory);
    const refused = coordinationReplayFailure(directory);
    assert.equal(refused.state, 'replay_refused');
    assert.equal(refused.seq, 2);
    assert.equal(refused.kind, 'swarm.contribution_recorded');
    assert.equal(refused.code, 'participant_not_found');
    assert.match(refused.message, /seq 2/u);
    assert.match(refused.remedy, /quarantine/u);
    await quarantineCoordinationLedgerEvent(directory, { seq: 2, reason: 'recorded row the fold refuses', actor: 'operator' });
    assert.equal(coordinationReplayFailure(directory), null, 'the same probe reports a clean ledger after the repair');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('baton doctor shows the offending row and its quarantine remedy when the deployment is in the refused state', () => {
  const repo = mkdtempSync(join(tmpdir(), 'baton-doctor-replay-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const commonDir = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
    const coordinationRoot = join(repo, commonDir, 'baton', 'application-v3', 'state', 'coordination');
    writePoisonedLedger(coordinationRoot);
    const batonScript = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [batonScript, 'doctor'], {
      cwd: repo, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(run.status, 1, `the doctor exits 1 in the refused state (stderr: ${run.stderr})`);
    const verdict = JSON.parse(run.stdout);
    assert.equal(verdict.coordination.state, 'replay_refused', 'the doctor carries the coordination replay row');
    assert.equal(verdict.coordination.seq, 2);
    assert.equal(verdict.coordination.kind, 'swarm.contribution_recorded');
    assert.equal(verdict.coordination.code, 'participant_not_found');
    assert.match(verdict.coordination.message, /seq 2/u);
    assert.match(verdict.coordination.remedy, /quarantine/u);
    assert.equal(verdict.next[0].action, 'quarantine', 'the doctor names the #290 quarantine verb as the next action');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

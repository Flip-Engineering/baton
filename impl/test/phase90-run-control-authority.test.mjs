import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');

function admission() {
  const source = {
    actor: 'direct:phase90-owner',
    principalId: 'phase90-owner',
    sessionId: 'phase90-session',
  };
  const target = {
    workerId: 'worker-phase90', taskId: 'task-phase90', fence: 7,
    role: null, activeCount: 1,
  };
  const core = {
    schemaVersion: 1,
    repoId: 'repo-phase90',
    runId: 'run-phase90',
    controlId: `control:${digest('phase90-control')}`,
    actionId: digest('phase90-action'),
    operation: 'send',
    recipient: 'work',
    delivery: 'nudge',
    message: 'Inspect the exact authority boundary.',
    messageDigest: digest('Inspect the exact authority boundary.'),
    reasonDigest: digest('Send Run guidance.'),
    registryDigest: digest('phase90-registry'),
    source,
    target,
    targetDigest: digest(target),
    requestDigest: digest({
      actionId: digest('phase90-action'), operation: 'send', recipient: 'work',
      delivery: 'nudge', message: 'Inspect the exact authority boundary.',
      reasonDigest: digest('Send Run guidance.'), source, target,
      registryDigest: digest('phase90-registry'),
    }),
  };
  return { ...core, admissionDigest: digest(core) };
}

function effect(control) {
  const core = {
    schemaVersion: 1,
    controlId: control.controlId,
    admissionDigest: control.admissionDigest,
    targetDigest: control.targetDigest,
    providerRequestId: `provider-control:${digest({
      controlId: control.controlId,
      targetDigest: control.targetDigest,
      admittedEvent: control.admittedEvent,
    })}`,
  };
  return { ...core, effectDigest: digest(core) };
}

function acknowledgement(control, state = 'confirmed') {
  const outcome = {
    result: state === 'confirmed' ? 'ok' : 'provider_outcome_unknown',
    code: state === 'confirmed' ? null : 'provider_boundary_observed',
    emulated: false,
    deliveredDespiteStale: false,
  };
  const core = {
    schemaVersion: 1,
    controlId: control.controlId,
    effectDigest: control.effect.effectDigest,
    providerRequestId: control.effect.providerRequestId,
    state,
    outcome,
  };
  return { ...core, ackDigest: digest(core) };
}

function settlement(control) {
  const core = {
    schemaVersion: 1,
    repoId: control.repoId,
    runId: control.runId,
    controlId: control.controlId,
    operation: control.operation,
    admissionDigest: control.admissionDigest,
    state: control.providerAck.state,
    outcome: control.providerAck.outcome,
  };
  return { ...core, settlementDigest: digest(core) };
}

test('RCA1: admitted control replays across restart before any provider boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase90-admitted-'));
  const first = new CoordinationStore(root);
  const fields = admission();
  const admitted = first.admitRunControl(fields, {
    actor: fields.source.actor, key: `run.control.admit:${fields.controlId}`,
  }).control;
  assert.equal(admitted.status, 'admitted');
  assert.deepEqual(first.pendingRunControls().map((row) => row.controlId), [fields.controlId]);
  first.releaseWriterLease({ requireOwned: true });

  const replay = new CoordinationStore(root);
  assert.equal(replay.runControl(fields.controlId).status, 'admitted');
  const startedFields = effect(replay.runControl(fields.controlId));
  const started = replay.beginRunControlEffect(startedFields, {
    actor: fields.source.actor, key: `run.control.begin:${fields.controlId}`,
  }).control;
  assert.equal(started.status, 'effect_started');
  replay.releaseWriterLease({ requireOwned: true });
});

test('RCA2: effect-start uncertainty and provider acknowledgement are explicit durable states', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase90-effect-'));
  const first = new CoordinationStore(root);
  const fields = admission();
  let control = first.admitRunControl(fields, {
    actor: fields.source.actor, key: `run.control.admit:${fields.controlId}`,
  }).control;
  const startedFields = effect(control);
  control = first.beginRunControlEffect(startedFields, {
    actor: fields.source.actor, key: `run.control.begin:${fields.controlId}`,
  }).control;
  assert.equal(control.status, 'effect_started');
  first.releaseWriterLease({ requireOwned: true });

  const replay = new CoordinationStore(root);
  assert.equal(replay.pendingRunControls()[0].status, 'effect_started');
  const ackFields = acknowledgement(replay.runControl(fields.controlId), 'outcome_unknown');
  control = replay.acknowledgeRunControl(ackFields, {
    actor: fields.source.actor, key: `run.control.ack:${fields.controlId}`,
  }).control;
  assert.equal(control.status, 'provider_acked');
  assert.equal(control.providerAck.state, 'outcome_unknown');
  replay.releaseWriterLease({ requireOwned: true });
});

test('RCA3: settled control replays exactly and cannot conflict under the same identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase90-settled-'));
  const store = new CoordinationStore(root);
  const fields = admission();
  let control = store.admitRunControl(fields, {
    actor: fields.source.actor, key: `run.control.admit:${fields.controlId}`,
  }).control;
  control = store.beginRunControlEffect(effect(control), {
    actor: fields.source.actor, key: `run.control.begin:${fields.controlId}`,
  }).control;
  control = store.acknowledgeRunControl(acknowledgement(control), {
    actor: fields.source.actor, key: `run.control.ack:${fields.controlId}`,
  }).control;
  const settledFields = settlement(control);
  control = store.settleRunControl(settledFields, {
    actor: fields.source.actor, key: `run.control.settle:${fields.controlId}`,
  }).control;
  assert.equal(control.status, 'confirmed');
  assert.equal(store.pendingRunControls().length, 0);
  assert.equal(store.settleRunControl(settledFields, {
    actor: fields.source.actor, key: `run.control.settle:${fields.controlId}`,
  }).result, 'replay');
  assert.throws(() => store.settleRunControl({
    ...settledFields,
    outcome: { ...settledFields.outcome, result: 'different' },
  }, {
    actor: fields.source.actor, key: `run.control.settle:${fields.controlId}`,
  }), (error) => error.code === 'run_control_conflict');
  store.releaseWriterLease({ requireOwned: true });
});

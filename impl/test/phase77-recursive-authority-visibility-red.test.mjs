// Phase 77 follow-on RED gate — recursive authority is visible without becoming a bearer proof.
//
// The durable store needs a compact operator summary when recursive Run authority is configured,
// while the authenticated event stream must never project the private values used to reconstitute
// application-only session authority. Detailed lease and lineage reads remain store APIs; the
// general snapshot is an outline, not a credential-bearing authority record.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { WebEventStream } from '../src/web-stream.mjs';

const NOW = '2026-07-18T08:00:00.000Z';
const EXPIRES = '2026-07-18T09:00:00.000Z';
const ORIGIN = 'https://control.example.test';
const REPO = 'repo-phase77-authority-visibility';
const PARENT_RUN = 'run-phase77-visibility-parent';
const PARENT_TASK = 'task-phase77-visibility-parent';
const PARENT_WORKER = 'worker-phase77-visibility-parent';
const CHILD_RUN = 'run-phase77-visibility-child';
const PRINCIPAL = 'recursive-phase77-visibility';
const SESSION = 'session-phase77-visibility';
const AUTHORITY_DIGEST = 'a'.repeat(64);
const policy = Object.freeze({
  schemaVersion: 1,
  maxDepth: 3,
  maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 8,
  leaseTtlMs: 60_000,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createWorkingParent(store) {
  store.createTask({
    id: PARENT_TASK,
    brief: {
      objective: 'Recursively coordinate a bounded child Run without disclosing session authority.',
      capabilities: ['baton_orchestrator'],
    },
    deps: [],
    refines: null,
    relation: 'root',
    runId: PARENT_RUN,
    taskType: 'general',
    reservedWorkerId: PARENT_WORKER,
    vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3',
    modelPolicy: null,
    effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${PARENT_TASK}` });
  return store.claimTask(PARENT_TASK, PARENT_WORKER, 1, {
    actor: 'orchestrator', key: `task.claimed:${PARENT_TASK}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
}

function issueAuthority(store, parent) {
  const request = {
    schemaVersion: 1,
    repoId: REPO,
    parentTask: { id: parent.id, version: parent.version },
    session: {
      principalId: PRINCIPAL,
      sessionId: SESSION,
      authorityDigest: AUTHORITY_DIGEST,
      expiresAt: EXPIRES,
    },
  };
  const leaseId = `run-orchestrator-lease:${digest({
    repoId: REPO,
    parentRunId: PARENT_RUN,
    parentTaskId: PARENT_TASK,
    parentTaskVersion: parent.version,
    workerId: PARENT_WORKER,
    principalId: PRINCIPAL,
    sessionId: SESSION,
    sessionAuthorityDigest: AUTHORITY_DIGEST,
  })}`;
  const issued = store.issueRunOrchestratorLease(request, {
    actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}`,
  });
  const admitted = store.admitRunLineage({
    schemaVersion: 1,
    repoId: REPO,
    childRunId: CHILD_RUN,
    intentDigest: digest({ objective: 'Exercise recursive authority visibility.' }),
  }, {
    actor: `worker:${PARENT_WORKER}`,
    key: `run.lineage:${CHILD_RUN}`,
    principalId: PRINCIPAL,
    sessionId: SESSION,
    sessionAuthorityDigest: AUTHORITY_DIGEST,
    orchestratorLeaseId: issued.lease.leaseId,
  });
  return { admitted, issued };
}

function fixture(label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-phase77-authority-visibility-${label}-`));
  const coordination = new CoordinationStore(directory, {
    repoId: REPO, clock: () => NOW, runLineagePolicy: policy,
  });
  const parent = createWorkingParent(coordination);
  const authority = issueAuthority(coordination, parent);
  return { authority, coordination, directory };
}

function principal() {
  return {
    userId: PRINCIPAL,
    sessionId: SESSION,
    credentialId: 'credential-phase77-visibility',
    expiresAt: EXPIRES,
    revoked: false,
    capabilities: ['observe'],
    repoIds: [REPO],
  };
}

class Response extends EventEmitter {
  constructor() {
    super();
    this.output = '';
    this.writableLength = 0;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(value) {
    this.output += value;
    return true;
  }

  end() {
    this.ended = true;
  }
}

function assertPrivateRecursiveAuthorityAbsent(value, privateValues) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const field of ['authorityDigest', 'leaseDigest', 'requestDigest']) {
    assert.equal(serialized.includes(`"${field}"`), false, `projection retained private field ${field}`);
  }
  for (const marker of privateValues) {
    assert.equal(serialized.includes(marker), false, `projection leaked private recursive authority ${marker}`);
  }
}

test('RV1 RED: configured snapshot exposes only a conditional sanitized recursive-authority outline', (t) => {
  const f = fixture('snapshot');
  t.after(() => {
    f.coordination.releaseWriterLease();
    rmSync(f.directory, { recursive: true, force: true });
  });
  const snapshot = f.coordination.snapshot();
  const summary = snapshot.runAuthority;
  assert.ok(summary, 'configured recursive authority has one discoverable snapshot outline');
  assert.equal(summary.schemaVersion, 1);
  assert.deepEqual(summary.policy, policy);
  assert.equal(summary.policyDigest, digest(policy));
  assert.deepEqual(summary.counts, {
    leases: 1,
    activeLeases: 1,
    lineages: 1,
    roots: 1,
  });
  assertPrivateRecursiveAuthorityAbsent(summary, [
    AUTHORITY_DIGEST,
    f.authority.issued.lease.leaseDigest,
    f.authority.issued.lease.requestDigest,
    f.authority.admitted.lineage.requestDigest,
  ]);

  const legacyDirectory = mkdtempSync(join(tmpdir(), 'baton-phase77-authority-visibility-legacy-'));
  const legacy = new CoordinationStore(legacyDirectory, { clock: () => NOW });
  try {
    assert.equal(Object.hasOwn(legacy.snapshot(), 'runAuthority'), false,
      'the compatibility snapshot does not invent unconfigured recursive authority');
  } finally {
    legacy.releaseWriterLease();
    rmSync(legacyDirectory, { recursive: true, force: true });
  }
});

test('RV2 RED: SSE snapshot and event replay remove nested lease/session authority proofs', (t) => {
  const f = fixture('stream');
  const stream = new WebEventStream({
    coordination: f.coordination,
    allowedOrigins: [ORIGIN],
    repoIds: [REPO],
    now: () => Date.parse(NOW),
    pollMs: 5,
    maxFrameBytes: 1024 * 1024,
    maxBufferedBytes: 1024 * 1024,
  });
  const outputs = [];
  t.after(() => {
    for (const output of outputs) output.emit('close');
    stream.shutdown();
    f.coordination.releaseWriterLease();
    rmSync(f.directory, { recursive: true, force: true });
  });
  const privateValues = [
    AUTHORITY_DIGEST,
    f.authority.issued.lease.leaseDigest,
    f.authority.issued.lease.requestDigest,
    f.authority.admitted.lineage.requestDigest,
  ];

  const snapshotOutput = new Response();
  outputs.push(snapshotOutput);
  const snapshotTicket = stream.issue(principal(), ORIGIN, REPO).body.ticket;
  assert.equal(stream.open({
    ticket: snapshotTicket, principal: principal(), origin: ORIGIN,
  }, snapshotOutput), null);
  assert.match(snapshotOutput.output, /event: snapshot/u);
  assertPrivateRecursiveAuthorityAbsent(snapshotOutput.output, privateValues);

  const replayOutput = new Response();
  outputs.push(replayOutput);
  const replayTicket = stream.issue(principal(), ORIGIN, REPO).body.ticket;
  assert.equal(stream.open({
    ticket: replayTicket, principal: principal(), origin: ORIGIN, cursor: 0,
  }, replayOutput), null);
  assert.match(replayOutput.output, /run\.orchestrator_lease_issued/u);
  assert.match(replayOutput.output, /run\.lineage_admitted/u);
  assertPrivateRecursiveAuthorityAbsent(replayOutput.output, privateValues);
});

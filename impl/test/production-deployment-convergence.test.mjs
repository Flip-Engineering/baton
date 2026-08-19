import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { wrapProductionDeployment } from '../src/production-deployment-convergence.mjs';

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), 'baton-deployment-convergence-'));
}

function fakeDeployment(log) {
  const application = {
    card() {
      return {
        schemaVersion: 1,
        repoId: 'repo',
        resident: { state: 'ready', incarnation: 'resident:1' },
        commands: ['run.start', 'run.inspect', 'run.recover'],
      };
    },
  };
  return {
    application,
    client() {
      return {
        async command(name, args) {
          log.push({ kind: 'client.command', name, args });
          return { name, args, runId: args?.runId ?? args?.intent?.runId ?? null };
        },
      };
    },
    async host() {
      log.push({ kind: 'host' });
      return { state: 'listening', transport: 'local' };
    },
    async close() {
      log.push({ kind: 'close' });
      return { state: 'closed' };
    },
    async run(objective) {
      log.push({ kind: 'run', objective });
      return { runId: 'run:direct', objective };
    },
  };
}

test('wrapped deployment persists command receipts and lifecycle events across reopen', async () => {
  const root = temporaryRoot();
  const stateRoot = join(root, 'deployment', 'convergence-v1');
  try {
    const firstLog = [];
    const first = wrapProductionDeployment(fakeDeployment(firstLog), {
      repoRoot: root,
      stateRoot,
    });
    assert.equal(first.convergence.stateRoot, stateRoot);
    const result = await first.client().command('run.start', {
      intent: { runId: 'run:client', objective: 'implement' },
    });
    assert.equal(result.runId, 'run:client');
    await first.host();
    const firstAudit = first.convergence.audit();
    assert.ok(firstAudit.storage.persistedSeq > 0);
    assert.ok(first.convergence.journal.events().some((event) => (
      event.type === 'effect.succeeded' && event.data.command === 'run.start'
    )));
    await first.close();
    assert.deepEqual(firstLog.map((entry) => entry.kind), ['client.command', 'host', 'close']);

    const secondLog = [];
    const second = wrapProductionDeployment(fakeDeployment(secondLog), {
      repoRoot: root,
      stateRoot,
    });
    const reopened = second.convergence.audit();
    assert.ok(reopened.storage.persistedSeq > firstAudit.storage.persistedSeq);
    assert.ok(second.convergence.journal.events().some((event) => event.type === 'deployment.closed'));
    assert.ok(second.convergence.journal.events().filter((event) => event.type === 'deployment.opened').length >= 2);
    const fates = second.convergence.projections.get('commandFates');
    assert.ok(Object.values(fates).includes('succeeded'));
    await second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('direct deployment methods and deployment clients share one durable runtime', async () => {
  const root = temporaryRoot();
  try {
    const log = [];
    const deployment = wrapProductionDeployment(fakeDeployment(log), {
      repoRoot: root,
      stateRoot: join(root, 'state'),
    });
    await deployment.run('direct objective');
    await deployment.client().command('run.start', {
      intent: { runId: 'run:client', objective: 'client objective' },
    });
    const admitted = deployment.convergence.journal.events({ type: 'command.admitted' })
      .filter((event) => event.data.command === 'run.start');
    assert.equal(admitted.length, 2);
    assert.equal(deployment.client().convergence, deployment.convergence);
    await deployment.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

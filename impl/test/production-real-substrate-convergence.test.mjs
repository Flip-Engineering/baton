import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { connectBaton, MockAdapter } from '../src/index.mjs';
import { openConvergedBaton } from '../src/index-converged.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function repository(t) {
  const root = mkdtempSync('/tmp/baton-real-convergence-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'convergence@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Baton Convergence'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true, scripts: { test: 'node --test' },
  }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "test('smoke', () => assert.equal(1, 1));",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'real convergence fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'launch', mechanisms: ['fixture'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'launch', mechanisms: ['fixture'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'production-real-substrate-convergence', refreshedAt: null,
    },
    permissions: {
      mode: 'unattended-full',
      boundary: 'Fixture models same-UID host access without claiming OS containment',
    },
  });
  return value;
}

function configuration(t, repo) {
  const deploymentRoot = mkdtempSync('/tmp/baton-real-convergence-deployment-');
  const configRoot = mkdtempSync('/tmp/baton-real-convergence-config-');
  const home = mkdtempSync('/tmp/baton-real-convergence-home-');
  t.after(() => rmSync(deploymentRoot, { recursive: true, force: true }));
  t.after(() => rmSync(configRoot, { recursive: true, force: true }));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
    connection: { repo, advanced: { env, home } },
  };
}

test('real openBaton deployment preserves doctor, direct Run and admitted resident Web command paths', async (t) => {
  const repo = repository(t);
  const configured = configuration(t, repo);
  const owner = await openConvergedBaton({ repo, advanced: configured.advanced });
  t.after(async () => { try { await owner.close(); } catch {} });
  await owner.ready;

  const doctor = await owner.doctor();
  assert.equal(doctor.routes.length, 1);
  assert.equal(doctor.routes[0].state, 'ready');
  assert.equal(doctor.routes[0].harness, ROUTE.harness);

  const hosted = await owner.host();
  assert.equal(hosted.state, 'published');
  const connected = await connectBaton(configured.connection);

  // The direct facade uses the convergence scheduler while the connected facade traverses the
  // resident Web command bus. Web effects return durable 202 admission internally and the
  // existing client reconciles the terminal command outcome before returning the BatonRun.
  const [direct, remote] = await Promise.all([
    owner.run('Direct real-substrate convergence admission', {
      ...ROUTE, scope: ['**'],
    }),
    connected.runs.start('Resident Web convergence admission', {
      exact: ROUTE, scope: ['**'],
    }),
  ]);

  const directView = await direct.inspect();
  const remoteView = await remote.inspect();
  assert.equal(directView.outline.phase, 'awaiting_plan_approval');
  assert.equal(remoteView.outline.phase, 'awaiting_plan_approval');
  assert.ok(owner.convergence.journal.events({ type: 'command.admitted' }).some((event) => (
    event.data.command === 'run.start'
  )));

  await remote.stop('Real resident convergence test complete.');
  await direct.stop('Real direct convergence test complete.');
});

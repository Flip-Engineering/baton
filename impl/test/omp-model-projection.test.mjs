// OMP model-projection behavioral tests.
//
// Scope: defaultCredentialProjection correctly includes .omp/agent/models.yml when present
// and silently omits it when absent. Tests run the actual factory (openBaton) in an isolated
// child process whose HOME is a controlled fake directory, then dispatch a run through to the
// adapter spawn so the projected worker HOME can be inspected.
//
// OUT OF SCOPE: YAML secret redaction from provider frames — collectRedactions covers only
// JSON and config.toml. YAML redaction for models.yml is handled separately in
// credential-projection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

const roots = [];
function temporary(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-omp-model-${label}-`));
  roots.push(dir);
  return dir;
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function makeOmpHome(label, { withModels = false } = {}) {
  const home = temporary(label);
  const agentDir = join(home, '.omp', 'agent');
  mkdirSync(agentDir, { recursive: true });
  chmodSync(join(home, '.omp'), 0o700);
  chmodSync(agentDir, 0o700);
  const agentDb = join(agentDir, 'agent.db');
  writeFileSync(agentDb, Buffer.from('fake-agent-db-content'));
  chmodSync(agentDb, 0o600);
  const configYml = join(agentDir, 'config.yml');
  writeFileSync(configYml, 'provider: deepseek\n');
  chmodSync(configYml, 0o600);
  if (withModels) {
    const modelsYml = join(agentDir, 'models.yml');
    writeFileSync(modelsYml, 'default_model: deepseek/custom-model\n');
    chmodSync(modelsYml, 0o600);
  }
  return home;
}

function makeRepo(label) {
  const dir = temporary(`repo-${label}`);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', `omp-probe-${label}@example.invalid`], { cwd: dir });
  execFileSync('git', ['config', 'user.name', `OMP Probe ${label}`], { cwd: dir });
  writeFileSync(join(dir, 'probe.txt'), 'probe\n');
  execFileSync('git', ['add', 'probe.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

// Run a probe in a child process where HOME=fakeHome. The probe calls openBaton, dispatches
// a minimal OMP run via deployment.run + run.approve, intercepts the adapter spawn to capture
// the projected worker HOME, then reports JSON {workerHome, modelsPresent, modelsMode}.
function runProjectionProbe(fakeHome, label) {
  const repo = makeRepo(label);
  const deploymentRoot = temporary(`deployment-${label}`);
  const scriptDir = temporary(`script-${label}`);
  const scriptPath = join(scriptDir, 'probe.mjs');

  writeFileSync(scriptPath, `
import { openBaton, MockAdapter } from ${JSON.stringify(join(SRC, 'index.mjs'))};
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

let resolveSpawn;
const spawnPromise = new Promise((r) => { resolveSpawn = r; });

const adapter = new MockAdapter({
  harness: 'omp',
  scenario: { outcome: 'completed', delayMs: 200, summary: 'probe', files: {} },
});
const rawSpawn = adapter.spawn.bind(adapter);
adapter.spawn = async (worker, brief, opts) => {
  // Capture snapshot while runtime dir still exists (before MockAdapter completes and cleanup runs)
  const workerHome = opts?.env?.HOME ?? null;
  const modelsPath = workerHome ? join(workerHome, '.omp', 'agent', 'models.yml') : null;
  const modelsPresent = modelsPath ? existsSync(modelsPath) : false;
  const modelsMode = (modelsPresent && modelsPath) ? (statSync(modelsPath).mode & 0o777) : null;
  resolveSpawn({ workerHome, modelsPresent, modelsMode });
  return rawSpawn(worker, brief, opts);
};
const rawCard = adapter.card.bind(adapter);
adapter.card = () => ({
  ...rawCard(),
  harness: 'omp',
  authPosture: 'subscription',
  modelSelection: {
    mode: 'exact', configuredDefault: 'deepseek/deepseek-v4-flash',
    available: ['deepseek/deepseek-v4-flash'], family: 'omp',
    acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'],
    serviceTier: null, provenance: 'probe', refreshedAt: null,
  },
  permissions: { mode: 'unattended-full', boundary: 'test' },
  workerPolicy: {
    schemaVersion: 1,
    autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['test'] },
    access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['test'] },
    containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
  },
  providerCompatibility: { credentialState: 'available' },
});

const deployment = await openBaton({
  repo: ${JSON.stringify(repo)},
  advanced: {
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { omp: adapter },
    routes: [{ harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' }],
    verification: { command: 'node', arguments: ['--version'] },
    capacity: {
      estimate: () => ({ bytes: 60, inodes: 5 }),
      observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    },
  },
});

let run;
let result;
try {
  run = await deployment.run('Probe OMP projection', {
    exact: { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
    scope: ['**'],
    runId: 'probe-run-1',
  });
  await run.approve();

  let timeoutHandle;
  result = await Promise.race([
    spawnPromise,
    new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('spawn timeout after 10s')), 10_000);
    }),
  ]).finally(() => clearTimeout(timeoutHandle));
} finally {
  try { if (run) await run.stop('probe complete'); } catch {}
  try { await deployment.close(); } catch {}
}

process.stdout.write(JSON.stringify(result) + '\\n');
process.exit(0);
`.trimStart());

  const raw = execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, HOME: fakeHome },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return JSON.parse(raw.trim());
}

test('OMP-MODEL-PRESENT: defaultCredentialProjection projects models.yml into worker HOME when present', () => {
  const fakeHome = makeOmpHome('present', { withModels: true });
  const result = runProjectionProbe(fakeHome, 'present');
  assert.ok(result.workerHome, 'adapter spawn must receive an isolated HOME');
  assert.equal(
    result.modelsPresent, true,
    'models.yml must appear in the projected worker HOME when present in the OMP agent dir',
  );
  assert.equal(result.modelsMode, 0o600, 'projected models.yml must have mode 0600');
});

test('OMP-MODEL-ABSENT: defaultCredentialProjection omits models.yml from projection when absent', () => {
  const fakeHome = makeOmpHome('absent', { withModels: false });
  const result = runProjectionProbe(fakeHome, 'absent');
  assert.ok(result.workerHome, 'adapter spawn must receive an isolated HOME');
  assert.equal(
    result.modelsPresent, false,
    'models.yml must be absent in the projected worker HOME when not present in the OMP agent dir',
  );
});

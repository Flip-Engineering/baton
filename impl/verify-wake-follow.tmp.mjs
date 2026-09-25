// Throwaway verification (not committed): drive the REAL CLI follow leg against a fixture resident
// under a pty, and observe both channels. Run from impl/.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton, MockAdapter } from './src/index.mjs';

const SCRIPT = fileURLToPath(new URL('./scripts/baton.mjs', import.meta.url));
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const cleanups = [];

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'wakefollow-repo-'));
  cleanups.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'verify@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Verify'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'wake follow fixture' } });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'verify', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function options() {
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'wakefollow-deployment-'));
  const configRoot = mkdtempSync(join(tmpdir(), 'wakefollow-config-'));
  const home = mkdtempSync(join(tmpdir(), 'wakefollow-home-'));
  cleanups.push(deploymentRoot, configRoot, home);
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  return {
    advanced: { deploymentRoot, adapters: { codex: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] }, resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 } },
    env, home,
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const repo = repository();
  const configured = options();
  const owner = await openBaton({ repo, advanced: configured.advanced });
  await owner.host();
  const swarm = await owner.swarms.create('Wake follow rendering (#585)');

  const mode = process.argv[2] ?? 'pty';
  const argv = mode === 'pty'
    ? ['-q', '/dev/null', process.execPath, SCRIPT, 'deployment', 'watch', '--follow', '--wake-class', 'context_updated']
    : [process.execPath, SCRIPT, 'deployment', 'watch', '--follow', '--wake-class', 'context_updated'];
  const child = spawn(mode === 'pty' ? 'script' : process.execPath, argv, {
    cwd: repo, env: { ...process.env, HOME: configured.env.HOME, XDG_CONFIG_HOME: configured.env.XDG_CONFIG_HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  await delay(2500);
  // One wake row of the narrowed class, then end the attachment by stopping the resident.
  await swarm.update({ event: 'swarm.context_updated', payload: { key: 'verify', body: 'wake follow verification' } });
  await delay(2500);
  await owner.close();
  const exit = await new Promise((resolve) => {
    const bound = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 30_000);
    child.once('close', (code) => { clearTimeout(bound); resolve(code); });
  });
  const seen = out.split('\n').filter((line) => line.trim().length > 0);
  console.log(`mode=${mode} exit=${exit} lines=${seen.length}`);
  for (const line of seen.slice(0, 12)) console.log('  |', JSON.stringify(line.slice(0, 200)));
  console.log('humanLines=', seen.filter((l) => l.includes('✦(◕‿◕)✦')).length,
    'jsonRows=', seen.filter((l) => l.trimStart().startsWith('{"')).length);
} finally {
  for (const path of cleanups) rmSync(path, { recursive: true, force: true });
}

// Refusals an orchestrator can act on (issue #264, narrow form): the projection names the entry
// and the rule, the resident names its holder, and protocol drift names both digests and the
// remedy. Codes are unchanged; only the actionable content is new.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MockAdapter, openBaton } from '../src/index.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import { inspectToolchainProjection } from '../src/toolchain-projection.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });

function scratch(t, label) {
  const root = mkdtempSync(join(tmpdir(), `baton-refusals-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a toolchain projection refusal names the entry and the rule — npm\'s package self-link is one rm away', (t) => {
  const sourceRoot = scratch(t, 'projection');
  mkdirSync(join(sourceRoot, 'deps', 'runtime'), { recursive: true });
  writeFileSync(join(sourceRoot, 'deps', 'runtime', 'index.mjs'), 'export const value = 1;\n');
  // What `npm ci` leaves in a worktree: node_modules/<package> -> the package root.
  symlinkSync('..', join(sourceRoot, 'deps', 'runtime', 'baton'));
  const config = {
    schemaVersion: 1, sourceRoot, sourceId: 'baton-test-toolchain',
    mappings: [{ sourcePath: 'deps/runtime', targetPath: 'tools/runtime' }],
    limits: { maxMappings: 8, maxFiles: 128, maxDirectories: 128, maxBytes: 1024 * 1024, maxFileBytes: 256 * 1024, maxPathBytes: 512, maxDepth: 32 },
  };
  assert.throws(() => inspectToolchainProjection(config), (error) => {
    assert.equal(error.code, 'toolchain_projection_invalid');
    assert.match(error.message, /unsupported entry: deps\/runtime\/baton \(symlink target leaves its dependency mapping\)/u);
    assert.equal(error.entry, 'deps/runtime/baton');
    return true;
  });
});

test('protocol drift refuses by naming the resident\'s registry digest, this CLI\'s, and the remedy', (t) => {
  const repo = scratch(t, 'drift');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(join(repo, '.git', 'baton'), { recursive: true });
  const selector = join(repo, '.git', 'baton', 'connection.json');
  writeFileSync(selector, JSON.stringify({
    schemaVersion: 2, profile: 'resident-drift', repoId: 'repo-drift', deploymentId: 'deployment-drift',
    incarnation: 'instance-drift', transport: 'local', registryDigest: 'f'.repeat(64), startedAt: new Date().toISOString(),
  }));
  chmodSync(selector, 0o600);
  const home = scratch(t, 'home');
  mkdirSync(join(home, 'config', 'baton', 'connections'), { recursive: true });
  assert.throws(() => discoverBatonConnection({ cwd: repo, env: { HOME: home, XDG_CONFIG_HOME: join(home, 'config') }, home }), (error) => {
    assert.equal(error.code, 'cli_config_invalid');
    // Issue #288 (U-F11/F12): the drift refusal names its typed cause and BOTH digests in full —
    // the operator's own evidence, copyable into a comparison — not truncated stand-ins.
    assert.match(error.message, /the resident publishes f{64} but this CLI carries/u);
    assert.equal(error.message.includes(APPLICATION_SEMANTIC_REGISTRY.digest), true);
    assert.match(error.message, /use the CLI of the commit the resident runs, or restart the resident from this checkout/u);
    assert.equal(error.detail.cliRegistryDigest, APPLICATION_SEMANTIC_REGISTRY.digest);
    assert.equal(error.detail.residentRegistryDigest, 'f'.repeat(64));
    return true;
  });
});

function residentFixture(t) {
  const repo = scratch(t, 'repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'refusals@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Refusals'], { cwd: repo });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'), "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const home = scratch(t, 'home');
  const configRoot = scratch(t, 'config');
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const adapter = () => {
    const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture' } });
    const card = value.card.bind(value);
    value.card = () => ({
      ...card(), authPosture: 'subscription', providerCompatibility: { credentialState: 'available' },
      workerPolicy: { schemaVersion: 1,
        autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture'] },
        access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture'] },
        containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
      modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness, acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null, provenance: 'fixture', refreshedAt: null },
      permissions: { mode: 'unattended-full', boundary: 'fixture' },
    });
    return value;
  };
  const advanced = (deploymentRoot) => ({ deploymentRoot, adapters: { codex: adapter() }, routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] }, resident: { env, home, webDrainMs: 2_000, sessionTtlMs: 60_000 } });
  return { repo, advanced };
}

test('a second host attempt names the resident that already serves this repository', async (t) => {
  const { repo, advanced } = residentFixture(t);
  const first = await openBaton({ repo, advanced: advanced(scratch(t, 'deployment-a')) });
  t.after(async () => { try { await first.close(); } catch {} });
  const published = await first.host();
  const second = await openBaton({ repo, advanced: advanced(scratch(t, 'deployment-b')) });
  t.after(async () => { try { await second.close(); } catch {} });
  await assert.rejects(second.host(), (error) => {
    assert.equal(error.code, 'application_host_busy');
    assert.match(error.message, /resident host is already active: deployment .* \(pid \d+, since .*\) publishes it; every worktree of this repository shares one resident/u);
    assert.equal(error.detail.holder.deploymentId, published.deploymentId);
    assert.equal(error.detail.holder.pid, process.pid);
    return true;
  });
  const closed = await first.close();
  assert.equal(closed.state, 'closed');
});

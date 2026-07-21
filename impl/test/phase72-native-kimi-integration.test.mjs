import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { KimiAcpCli } from '../src/kimi-acp.mjs';
import { Log } from '../src/log.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url));
const BASE = '1'.repeat(40);
const PROGRESS = '2'.repeat(40);
const SECRET = 'native-kimi-integration-secret';
const APPROVED_FILES = ['config.toml', 'device_id', 'credentials/kimi-code.json', 'oauth/kimi-code'];

const until = async (read, label) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
};

const brief = () => ({
  goal: 'hold native Kimi while Baton tests exact cleanup', constraints: [], pathScope: ['**'],
  definitionOfDone: 'operator stops the task', verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100000, usd: 5, wallMin: 30 },
});

function sourceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'baton-native-kimi-source-'));
  mkdirSync(join(root, 'credentials'), { mode: 0o700 });
  mkdirSync(join(root, 'oauth'), { mode: 0o700 });
  writeFileSync(join(root, 'config.toml'), 'default_model = "kimi-code/k3"\n', { mode: 0o600 });
  writeFileSync(join(root, 'device_id'), 'fixture-device', { mode: 0o600 });
  writeFileSync(join(root, 'credentials', 'kimi-code.json'), JSON.stringify({ access_token: SECRET }), { mode: 0o600 });
  writeFileSync(join(root, 'oauth', 'kimi-code'), '', { mode: 0o600 });
  return root;
}

function sourceSnapshot(root) {
  return APPROVED_FILES.map((relativeFile) => {
    const path = join(root, relativeFile);
    const stat = statSync(path);
    return { relativeFile, bytes: readFileSync(path), ino: stat.ino, mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs };
  });
}

test('KC1/KC4/KC5: public native route uses private subscription state, redacts output, and preserves before exact reap', async () => {
  const root = mkdtempSync(join(tmpdir(), 'baton-native-kimi-integrated-'));
  const worktree = join(root, 'worktree');
  mkdirSync(worktree);
  const sourceRoot = sourceFixture();
  const before = sourceSnapshot(sourceRoot);
  const calls = [];
  const worktrees = {
    async create(taskId) { calls.push('create'); return { path: worktree, branch: `baton/${taskId}`, baseSha: BASE }; },
    async capture() { calls.push('capture'); return { sha: PROGRESS, snapshotted: true, changedPaths: ['partial.txt'] }; },
    async retainCheckpoint() { calls.push('retain'); return `refs/baton/checkpoints/${PROGRESS}`; },
    async resolveCheckpoint() { calls.push('resolve'); return PROGRESS; },
    async remove() { calls.push('remove'); },
    async reconcile() {},
  };
  const isolation = new RuntimeIsolation({
    repoRoot: root,
    baseEnv: { PATH: process.env.PATH, KIMI_API_KEY: 'ambient-must-not-cross' },
    credentialTrees: { 'kimi-code': [{ sourceRoot, relativeFiles: APPROVED_FILES }] },
  });
  const adapter = new KimiAcpCli({
    cmd: process.execPath, args: [FAKE, '--serve'], requestTimeoutMs: 1000,
    versionProbe: () => '0.27.0',
    env: { FAKE_KIMI_MODE: 'secret-hang', FAKE_SECRET: SECRET },
    modelCatalog: { 'kimi-code/k3': ['low', 'high', 'max'] },
  });
  const log = new Log(join(root, 'log'));
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { 'native-kimi-private-id': adapter }, runtimeScopes: isolation, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => { throw new Error('explicit public harness must not use adaptive routing'); },
    approvalTimeoutMs: 100, stopDeadlineMs: 1000,
  });

  const handle = await coordinator.spawn('kimi-code', brief(), {
    taskId: 'native-kimi-integrated-stop', model: 'kimi-code/k3', effort: 'max',
  });
  await until(() => log.read(handle.id).find((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'native Kimi readiness');
  const content = await until(() => log.read(handle.id).find((event) => event.kind === 'content.message'), 'redacted Kimi content');
  assert.equal(handle.vendor, 'native-kimi-private-id');
  assert.equal(handle.harnessRequested, 'kimi-code');
  assert.equal(content.payload.text, '[REDACTED]');
  assert.equal(JSON.stringify(log.read(handle.id)).includes(SECRET), false);
  const runtime = coordinator._workers.get(handle.id).runtimeScope;
  assert.equal(runtime.family, 'kimi-code');
  assert.equal(runtime.authPosture, 'subscription');
  assert.deepEqual(runtime.credential, { mechanism: 'file', state: 'materialized', count: 4 });

  assert.deepEqual(await coordinator.kill(handle.id, 'operator:test'), { ok: true, result: 'confirmed', emulated: false });
  assert.deepEqual(calls, ['create', 'capture', 'retain', 'resolve', 'remove']);
  const kinds = log.read(handle.id).map((event) => event.kind);
  assert.ok(kinds.indexOf('lifecycle.process_started') < kinds.indexOf('lifecycle.process_closed'));
  assert.ok(kinds.indexOf('lifecycle.process_closed') < kinds.indexOf('kill.confirmed'));
  assert.ok(kinds.includes('worktree.progress_checkpointed'));
  assert.equal(existsSync(join(isolation.root, handle.id)), false);
  assert.deepEqual(sourceSnapshot(sourceRoot), before);
  assert.equal(coordinator.closeAuthority(), true);
});

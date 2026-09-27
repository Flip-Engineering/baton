import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';

// phase78-dependency-projection.test.mjs — the attested dependency projection private worktrees
// are materialized with. The open attests the repository's locked `node_modules` tree, copies it
// into the worker's private worktree, and `deployment.close()` removes that worktree with the
// projection inside it; the caller's repository stays clean.
//
// Rows:
//   an attested dependency projection is materialized into the private worktree, and the close
//   removes the private worktree and its projection while leaving the repository clean

const route = Object.freeze({ harness: 'mock-capacity', model: 'mock-capacity-1', effort: 'high' });

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-repo-'));
  git(['init', '-q'], root);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'phase78@example.invalid', GIT_COMMITTER_EMAIL: 'phase78@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Phase 78', GIT_COMMITTER_NAME: 'Phase 78' });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  git(['add', '.'], root);
  git(['commit', '-qm', 'base'], root);
  return root;
}

function exactBlockingAdapter() {
  const adapter = new MockAdapter({
    harness: route.harness,
    concurrencyCeiling: 4,
    scenario: {
      outcome: 'completed',
      edits: [{ path: 'held.txt', content: 'held\n', delayMs: 60_000 }],
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' }, // deterministic local adapter; no provider credential
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase78-capacity-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: ['test-unattended'],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: ['test-full-access'],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return adapter;
}

function worktreeCount(repo) {
  return git(['worktree', 'list', '--porcelain'], repo)
    .split('\n').filter((line) => line.startsWith('worktree ')).length;
}

async function until(read, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('an attested dependency projection is materialized into the private worktree and removed on close', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase78-capacity-projection-'));
  mkdirSync(join(repo, 'node_modules', 'phase78-dependency'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({
    name: 'phase78-capacity', lockfileVersion: 3, packages: {},
  }));
  writeFileSync(
    join(repo, 'node_modules', 'phase78-dependency', 'index.mjs'),
    "export const projected = 'attested';\n",
  );
  git(['add', '.gitignore', 'package-lock.json'], repo);
  git(['commit', '-qm', 'locked dependencies'], repo);
  const fixture = exactBlockingAdapter();
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      routes: [route],
      adapters: { [route.harness]: fixture },
      verification: { command: 'true', arguments: [] },
    },
  });
  const run = await deployment.run('Inspect the attested installed dependency projection.', route);
  await run.approve();
  await until(() => worktreeCount(repo) === 2, 'dependency projection worktree');
  const privateWorktree = git(['worktree', 'list', '--porcelain'], repo)
    .split('\n').filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length)).find((path) => path !== repo);
  assert.equal(
    readFileSync(join(privateWorktree, 'node_modules', 'phase78-dependency', 'index.mjs'), 'utf8'),
    "export const projected = 'attested';\n",
  );

  await deployment.close();
  assert.equal(worktreeCount(repo), 1);
  assert.equal(git(['status', '--porcelain'], repo), '');
});

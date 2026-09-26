// #269 item 3: a deployment names the paths its code verification covers and a docs verification
// for captures that change none of them; the selection is a pure function of the changed paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAdapter, openBaton } from '../src/index.mjs';
import { verificationSelector } from '../src/application-deployment.mjs';
import { SUITE_COMPARISON } from '../src/suite-comparison.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
function repository(root) {
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'selection@example.invalid', GIT_COMMITTER_EMAIL: 'selection@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'selection fixture', GIT_COMMITTER_NAME: 'selection fixture' });
  writeFileSync(join(repo, 'README.md'), '# selection fixture\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}
const capacity = { estimate: () => ({ bytes: 1, inodes: 1 }), observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }) };
function mockAdapter() {
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed' } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

test('the selector runs the docs verification only when no changed path is covered by the code verification', () => {
  const select = verificationSelector({ paths: ['impl/**', 'package.json'], docs: { command: 'node', arguments: ['impl/scripts/surface-gate.mjs'] } });
  const contract = { command: 'node', arguments: ['impl/scripts/run-suite.mjs'], cwd: '.', expectExit: 0 };
  assert.deepEqual(select(['docs/audits/x.md', 'README.md'], contract), {
    selection: 'docs', verification: { ...contract, command: 'node', arguments: ['impl/scripts/surface-gate.mjs'] },
  });
  assert.deepEqual(select(['docs/x.md', 'impl/src/a.mjs'], contract), { selection: 'code', verification: contract });
  assert.equal(select([], contract).selection, 'docs', 'a capture that changed nothing verified by the code contract is checked by the doc gate');
  assert.equal(select(['package.json'], contract).selection, 'code');
});

// #593: the declaration may also name the procedure that judges a code capture. The name rides the
// selection (the check reads it there); the docs gate is a command, judged by its own exit code,
// and never carries one.
test('a declared comparison procedure rides the code selection, and the docs gate carries none', () => {
  const select = verificationSelector({
    command: 'npm', arguments: ['test'], comparison: SUITE_COMPARISON,
    paths: ['impl/**', 'package.json'], docs: { command: 'node', arguments: ['impl/scripts/surface-gate.mjs'] },
  });
  const contract = { command: 'npm', arguments: ['test', '--prefix', 'impl'], cwd: '.', expectExit: 0 };
  assert.deepEqual(select(['impl/src/a.mjs'], contract), {
    selection: 'code', verification: contract, comparison: SUITE_COMPARISON,
  });
  assert.equal(select(['docs/x.md'], contract).comparison, undefined,
    'the docs contract is judged by its own exit code');
});

test('paths and docs are declared together or not at all, and both are validated', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-verification-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = repository(root);
  const base = { deploymentRoot: join(root, 'deployment'), adapters: { mock: mockAdapter() }, routes: [ROUTE], capacity };
  for (const verification of [
    { command: 'node', arguments: ['--version'], paths: ['impl/**'] },
    { command: 'node', arguments: ['--version'], docs: { command: 'node', arguments: ['--version'] } },
    { command: 'node', arguments: ['--version'], paths: [], docs: { command: 'node', arguments: ['--version'] } },
    { command: 'node', arguments: ['--version'], paths: ['impl/**'], docs: { command: '', arguments: [] } },
    { command: 'node', arguments: ['--version'], paths: ['impl/**'], docs: { command: 'node', arguments: [], extra: true } },
  ]) {
    await assert.rejects(openBaton({ repo, advanced: { ...base, verification } }), /advanced verification is invalid/u);
  }
  const deployment = await openBaton({ repo, advanced: { ...base, verification: {
    command: 'node', arguments: ['--version'], paths: ['impl/**'], docs: { command: 'node', arguments: ['--version'] },
  } } });
  try { assert.ok(deployment, 'a complete declaration opens'); } finally { await deployment.close(); }
});

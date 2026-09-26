import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtlasCodeIndex } from '../src/atlas-index.mjs';
import { AtlasStructuralDelta } from '../src/atlas-structural.mjs';

// Issue #500 — the atlas indexing modules silently dropped files over a private
// 2 MiB default ceiling with no diagnostic. The repaired contract: the default
// source ceiling is 16 MiB (the ledger event ceiling), and a file skipped over
// the ceiling emits an atlas.source.skipped record. The structural delta module
// names the ceiling value in its refusal message.

function repository(t, name, files) {
  const root = mkdtempSync(join(tmpdir(), `baton-500-atlas-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue500@example.invalid', GIT_COMMITTER_EMAIL: 'issue500@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 500', GIT_COMMITTER_NAME: 'Issue 500' });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'issue 500 atlas fixture'], { cwd: root });
  return root;
}

test('500-atlas-a: AtlasCodeIndex default maxSourceBytes is the 16 MiB ledger event ceiling', (t) => {
  const artifacts = mkdtempSync(join(tmpdir(), 'baton-500-atlas-a-'));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const atlas = new AtlasCodeIndex({ artifactRoot: artifacts });
  assert.equal(atlas.maxSourceBytes, 16 * 1024 * 1024,
    'default maxSourceBytes is 16 MiB (the ledger event ceiling)');
});

test('500-atlas-b: AtlasStructuralDelta default maxSourceBytes is the 16 MiB ledger event ceiling', (t) => {
  const artifacts = mkdtempSync(join(tmpdir(), 'baton-500-atlas-b-'));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const atlas = new AtlasStructuralDelta({ artifactRoot: artifacts });
  assert.equal(atlas.maxSourceBytes, 16 * 1024 * 1024,
    'default maxSourceBytes is 16 MiB (the ledger event ceiling)');
});

test('500-atlas-c: a file over the index source ceiling emits an atlas.source.skipped record', async (t) => {
  const artifacts = mkdtempSync(join(tmpdir(), 'baton-500-atlas-c-'));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const records = [];
  const atlas = new AtlasCodeIndex({
    artifactRoot: artifacts, maxSourceBytes: 32, record: (r) => records.push(r),
  });
  const root = repository(t, 'skipped', {
    'src/small.mjs': 'export const x = 1;\n',
    'src/big.mjs': `export const y = ${'a'.repeat(64)};\n`,
  });
  await atlas.invoke('index.build', {}, { baseRoot: root, budgetTokens: 10_000 });
  const skipped = records.filter((r) => r.kind === 'atlas.source.skipped');
  assert.equal(skipped.length, 1, 'one file was skipped over the source ceiling');
  assert.equal(skipped[0].path, 'src/big.mjs');
  assert.equal(skipped[0].reason, 'exceeds_source_ceiling');
  assert.equal(skipped[0].ceiling, 32);
});

test('500-atlas-d: structural delta names the ceiling in its oversized-source refusal', async (t) => {
  const artifacts = mkdtempSync(join(tmpdir(), 'baton-500-atlas-d-'));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const atlas = new AtlasStructuralDelta({ artifactRoot: artifacts, maxSourceBytes: 8 });
  const root = repository(t, 'structural-ceiling', {
    'before.mjs': 'export const x = 1;\n',
    'after.mjs': 'export const x = 2;\n',
  });
  await assert.rejects(
    atlas.invoke('diff.structural', { beforePath: 'before.mjs', afterPath: 'after.mjs' },
      { beforeRoot: root, afterRoot: root, budgetTokens: 10_000 }),
    (error) => {
      assert.equal(error.code, 'invalid_source');
      assert.match(error.message, /8-byte source ceiling/,
        'the refusal names the byte ceiling');
      assert.doesNotMatch(error.message, /binary/,
        'an oversized refusal does not mention binary');
      return true;
    },
  );
});

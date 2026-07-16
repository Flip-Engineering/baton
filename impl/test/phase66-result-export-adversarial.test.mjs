import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { materializeResultTree, validateResultExportRoot } from '../src/result-export.mjs';

const POLICY = Object.freeze({ format: 'directory-v1', maxFiles: 128, maxBytes: 1024 * 1024 });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function temporary(t, label) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), `baton-export-${label}-`)));
  t.after(() => {
    try { chmodSync(path, 0o700); } catch {}
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

function git(repo, args, { input } = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  }).trim();
}

function repository(t, label) {
  const repo = temporary(t, `${label}-repo`);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'phase66@example.invalid']);
  git(repo, ['config', 'user.name', 'Phase 66']);
  return repo;
}

function commitFiles(repo, message, files) {
  for (const [path, specification] of Object.entries(files)) {
    const { content, mode = 0o644 } = typeof specification === 'string'
      ? { content: specification }
      : specification;
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
    chmodSync(join(repo, path), mode);
  }
  git(repo, ['add', '--all']);
  git(repo, ['commit', '-qm', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function manifestCore(resultSha) {
  return {
    repoId: 'repo-phase66-adversarial',
    runId: 'run-phase66-adversarial',
    nodeKey: 'node-export',
    taskId: 'task-export',
    resultSha,
    evidenceDigest: 'a'.repeat(64),
    profileDigest: 'b'.repeat(64),
    exportPolicyDigest: 'c'.repeat(64),
    goal: { id: 'goal-export', version: 1, digest: 'd'.repeat(64) },
    plan: { id: 'plan-export', version: 1, digest: 'e'.repeat(64), approvalDigest: 'f'.repeat(64) },
    adoptionReceiptDigest: '1'.repeat(64),
    semanticReviewReceiptDigest: null,
    integrationAfterSha: null,
  };
}

function exportArguments({ repo, exportRoot, resultSha, label, core = manifestCore(resultSha) }) {
  return {
    repoRoot: repo,
    exportRoot,
    exportId: sha256(`phase66:${label}`),
    stagingNonce: '00000000-0000-4000-8000-000000000066',
    resultSha,
    manifestCore: core,
    policy: POLICY,
  };
}

function fixture(t, label, files = { 'artifact.txt': 'accepted artifact\n' }) {
  const repo = repository(t, label);
  const resultSha = commitFiles(repo, 'accepted result', files);
  const exportRoot = temporary(t, `${label}-exports`);
  chmodSync(exportRoot, 0o700);
  const args = exportArguments({ repo, exportRoot, resultSha, label });
  materializeResultTree(args);
  const directory = join(exportRoot, args.exportId);
  return { repo, resultSha, exportRoot, args, directory, tree: join(directory, 'tree') };
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code);
}

function writeTree(repo, entries) {
  const input = Buffer.concat(entries.map(({ mode, type, oid, name }) => Buffer.concat([
    Buffer.from(`${mode} ${type} ${oid}\t`, 'ascii'),
    Buffer.from(name, 'utf8'),
    Buffer.from([0]),
  ])));
  return git(repo, ['mktree', '-z'], { input });
}

function writeBlob(repo, content) {
  return git(repo, ['hash-object', '-w', '--stdin'], { input: Buffer.from(content) });
}

function commitTree(repo, tree, message) {
  return git(repo, ['commit-tree', tree, '-m', message]);
}

test('physical export ignores Git replace refs', (t) => {
  const repo = repository(t, 'replace-ref');
  const acceptedSha = commitFiles(repo, 'accepted', { 'value.txt': 'accepted bytes\n' });
  const substitutedSha = commitFiles(repo, 'substituted', { 'value.txt': 'substituted bytes\n' });
  git(repo, ['replace', acceptedSha, substitutedSha]);

  const replacedTree = git(repo, ['rev-parse', `${acceptedSha}^{tree}`]);
  const acceptedTree = git(repo, ['--no-replace-objects', 'rev-parse', `${acceptedSha}^{tree}`]);
  assert.notEqual(replacedTree, acceptedTree, 'the fixture must activate a replacement commit');

  const exportRoot = temporary(t, 'replace-ref-exports');
  chmodSync(exportRoot, 0o700);
  const args = exportArguments({ repo, exportRoot, resultSha: acceptedSha, label: 'replace-ref' });
  const result = materializeResultTree(args);

  assert.equal(result.treeOid, acceptedTree);
  assert.equal(readFileSync(join(exportRoot, args.exportId, 'tree', 'value.txt'), 'utf8'), 'accepted bytes\n');
  assert.equal(JSON.parse(readFileSync(join(exportRoot, args.exportId, 'manifest.json'))).treeOid, acceptedTree);
});

test('physical export ignores ambient GIT_DIR and object database authority', { concurrency: false }, (t) => {
  const acceptedRepo = repository(t, 'ambient-accepted');
  const acceptedSha = commitFiles(acceptedRepo, 'accepted', { 'value.txt': 'accepted repository\n' });
  const decoyRepo = repository(t, 'ambient-decoy');
  commitFiles(decoyRepo, 'decoy', { 'value.txt': 'decoy repository\n' });
  const exportRoot = temporary(t, 'ambient-exports');
  chmodSync(exportRoot, 0o700);
  const args = exportArguments({ repo: acceptedRepo, exportRoot, resultSha: acceptedSha, label: 'ambient' });

  const poisoned = {
    GIT_DIR: join(decoyRepo, '.git'),
    GIT_WORK_TREE: decoyRepo,
    GIT_OBJECT_DIRECTORY: join(decoyRepo, '.git', 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoyRepo, '.git', 'objects'),
  };
  const prior = Object.fromEntries(Object.keys(poisoned).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, poisoned);
    materializeResultTree(args);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(readFileSync(join(exportRoot, args.exportId, 'tree', 'value.txt'), 'utf8'), 'accepted repository\n');
});

test('replay rejects every mutated completed-export shape', async (t) => {
  const cases = [
    ['extra-file', (f) => writeFileSync(join(f.tree, 'unexpected.txt'), 'not in the manifest\n')],
    ['symlinked-manifest', (f) => {
      const outside = join(f.exportRoot, '.saved-manifest');
      renameSync(join(f.directory, 'manifest.json'), outside);
      symlinkSync(outside, join(f.directory, 'manifest.json'));
    }],
    ['symlinked-tree', (f) => {
      const outside = join(f.exportRoot, '.saved-tree');
      renameSync(f.tree, outside);
      symlinkSync(outside, f.tree);
    }],
    ['hardlinked-file', (f) => linkSync(join(f.tree, 'artifact.txt'), join(f.exportRoot, '.hardlink-alias'))],
    ['mode-escalation', (f) => chmodSync(join(f.tree, 'artifact.txt'), 0o777)],
  ];

  for (const [label, mutate] of cases) {
    await t.test(label, (inner) => {
      const f = fixture(inner, `replay-${label}`);
      mutate(f);
      assertCode(() => materializeResultTree(f.args), 'result_export_output_mismatch');
    });
  }
});

test('portable directory-component and file-prefix collisions fail before export', async (t) => {
  const collisionTrees = [
    ['directory-case', (repo, blob) => {
      const upper = writeTree(repo, [{ mode: '100644', type: 'blob', oid: blob, name: 'one.txt' }]);
      const lower = writeTree(repo, [{ mode: '100644', type: 'blob', oid: blob, name: 'two.txt' }]);
      return writeTree(repo, [
        { mode: '040000', type: 'tree', oid: upper, name: 'A' },
        { mode: '040000', type: 'tree', oid: lower, name: 'a' },
      ]);
    }],
    ['directory-normalization', (repo, blob) => {
      const composed = writeTree(repo, [{ mode: '100644', type: 'blob', oid: blob, name: 'one.txt' }]);
      const decomposed = writeTree(repo, [{ mode: '100644', type: 'blob', oid: blob, name: 'two.txt' }]);
      return writeTree(repo, [
        { mode: '040000', type: 'tree', oid: composed, name: '\u00e9' },
        { mode: '040000', type: 'tree', oid: decomposed, name: 'e\u0301' },
      ]);
    }],
    ['file-prefix-case', (repo, blob) => {
      const directory = writeTree(repo, [{ mode: '100644', type: 'blob', oid: blob, name: 'child.txt' }]);
      return writeTree(repo, [
        { mode: '100644', type: 'blob', oid: blob, name: 'A' },
        { mode: '040000', type: 'tree', oid: directory, name: 'a' },
      ]);
    }],
  ];

  for (const [label, makeTree] of collisionTrees) {
    await t.test(label, (inner) => {
      const repo = repository(inner, label);
      const blob = writeBlob(repo, 'collision fixture\n');
      const resultSha = commitTree(repo, makeTree(repo, blob), label);
      const exportRoot = temporary(inner, `${label}-exports`);
      chmodSync(exportRoot, 0o700);
      const args = exportArguments({ repo, exportRoot, resultSha, label });

      assertCode(() => materializeResultTree(args), 'result_export_tree_unsafe');
      assert.deepEqual(readdirSync(exportRoot), []);
    });
  }
});

test('manifest core is closed and cannot smuggle exporter-owned fixed fields', (t) => {
  const repo = repository(t, 'closed-manifest');
  const resultSha = commitFiles(repo, 'accepted', { 'artifact.txt': 'manifest fixture\n' });
  const exportRoot = temporary(t, 'closed-manifest-exports');
  chmodSync(exportRoot, 0o700);
  const core = manifestCore(resultSha);

  const missing = { ...core };
  delete missing.taskId;
  const invalidCores = [
    ['unknown', { ...core, callerOwned: true }],
    ['missing', missing],
    ...['schemaVersion', 'format', 'exportId', 'treeOid', 'fileCount', 'byteCount', 'files']
      .map((field) => [field, { ...core, [field]: 'caller-controlled' }]),
  ];
  for (const [label, invalidCore] of invalidCores) {
    const args = exportArguments({
      repo, exportRoot, resultSha, label: `closed-${label}`, core: invalidCore,
    });
    assertCode(() => materializeResultTree(args), 'result_export_invalid');
  }
  assert.deepEqual(readdirSync(exportRoot), []);

  const args = exportArguments({ repo, exportRoot, resultSha, label: 'closed-valid', core });
  materializeResultTree(args);
  const manifest = JSON.parse(readFileSync(join(exportRoot, args.exportId, 'manifest.json')));
  assert.deepEqual(Object.keys(manifest).sort(), [
    ...Object.keys(core),
    'schemaVersion', 'format', 'exportId', 'treeOid', 'fileCount', 'byteCount', 'files',
  ].sort());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.format, 'directory-v1');
  assert.equal(manifest.exportId, args.exportId);
});

test('deployment export root must be private and materialized authority remains private', (t) => {
  const repo = repository(t, 'private-root');
  const resultSha = commitFiles(repo, 'accepted', { 'artifact.txt': 'private root\n' });
  const exportRoot = temporary(t, 'private-root-exports');
  const args = exportArguments({ repo, exportRoot, resultSha, label: 'private-root' });

  for (const mode of [0o755, 0o710, 0o701]) {
    chmodSync(exportRoot, mode);
    assertCode(() => validateResultExportRoot(exportRoot), 'result_export_root_invalid');
    assertCode(() => materializeResultTree(args), 'result_export_root_invalid');
    assert.deepEqual(readdirSync(exportRoot), []);
  }

  chmodSync(exportRoot, 0o700);
  assert.equal(validateResultExportRoot(exportRoot), realpathSync(exportRoot));
  materializeResultTree(args);
  const directory = join(exportRoot, args.exportId);
  assert.equal(lstatSync(exportRoot).mode & 0o777, 0o700);
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(directory, 'tree')).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(directory, 'manifest.json')).mode & 0o777, 0o600);
});

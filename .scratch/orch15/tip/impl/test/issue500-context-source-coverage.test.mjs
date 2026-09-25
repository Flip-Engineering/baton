import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, normalizeContextProgramPolicy,
} from '../src/context-program.mjs';
import { produceRepositoryContextSource } from '../src/context-runtime.mjs';

// Issue #500 — the repository Context source dropped files while reporting the index
// as complete. A private 2 MiB literal capped retained file content 32x below the
// policy's declared maxArtifactBytes (64 MiB default), so an ordinary large text file
// — a generated bundle, a big package-lock — was counted as excludedOversizeFiles and
// skipped even though the deployment policy admitted it, while coverage.complete
// stayed true and the Context coverage surface reports no exclusion counters.
//
// The repaired contract: the per-file ceiling IS the policy's maxArtifactBytes (the
// aggregate byte and item ceilings bound the projection as a whole and refuse typed
// when exceeded), so a file the policy admits is always projected, and a file over
// the policy ceiling refuses typed as context_source_oversize — a named refusal, not
// a silent drop beside complete: true.

function repository(t, name, files) {
  const root = mkdtempSync(join(tmpdir(), `baton-500-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue500@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 500'], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'issue 500 fixture'], { cwd: root });
  const treeSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, treeSha };
}

const smallProgram = "export const marker = 'issue-500';\n";

test('500-a: a text file under the policy artifact ceiling is projected, not dropped', (t) => {
  const big = `${'x'.repeat(3 * 1024 * 1024)}\n`;
  const { root, treeSha } = repository(t, 'under-ceiling', {
    'src/big.txt': big,
    'src/small.mjs': smallProgram,
  });
  const produced = produceRepositoryContextSource(root, treeSha, ['**'], DEFAULT_CONTEXT_PROGRAM_POLICY);
  const paths = [...new Set(produced.items.map((item) => item.path))].sort();
  assert.deepEqual(paths, ['src/big.txt', 'src/small.mjs'],
    'a 3 MiB text file the 64 MiB policy admits is projected');
  assert.equal(produced.coverage.excludedOversizeFiles, 0, 'nothing was dropped over size');
  assert.equal(produced.coverage.complete, true, 'complete with zero exclusions');
  const projected = produced.items.filter((item) => item.path === 'src/big.txt')
    .sort((a, b) => a.chunk - b.chunk).map((item) => item.text).join('');
  assert.equal(projected, big, 'the projected text reassembles byte-exactly');
});

test('500-b: a file over the policy artifact ceiling refuses typed, naming the file', (t) => {
  const { policyDigest, ...defaults } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  void policyDigest;
  const policy = normalizeContextProgramPolicy({ ...defaults, maxArtifactBytes: 1024 * 1024 });
  const { root, treeSha } = repository(t, 'over-ceiling', {
    'src/big.txt': `${'y'.repeat(2 * 1024 * 1024)}\n`,
    'src/small.mjs': smallProgram,
  });
  assert.throws(() => produceRepositoryContextSource(root, treeSha, ['**'], policy), (error) => {
    assert.equal(error.code, 'context_source_oversize',
      'an over-ceiling file is a named refusal, never a silent drop beside complete: true');
    assert.match(error.message, /src\/big\.txt/u, 'the refusal names the dropped path');
    return true;
  });
});

test('500-c: a multi-byte character that cannot fit in a 1-byte chunk refuses typed', (t) => {
  const { policyDigest, ...defaults } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  void policyDigest;
  const policy = normalizeContextProgramPolicy({ ...defaults, maxTextBytes: 1 });
  const { root, treeSha } = repository(t, 'multibyte-chunk', {
    'src/emoji.txt': 'a\u{1F600}b\n',
  });
  assert.throws(() => produceRepositoryContextSource(root, treeSha, ['**'], policy), (error) => {
    assert.equal(error.code, 'context_source_oversize',
      'a chunk that cannot project a multi-byte character refuses typed');
    return true;
  });
});

test('500-d: a chunk boundary does not split a surrogate pair', (t) => {
  const { policyDigest, ...defaults } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  void policyDigest;
  const policy = normalizeContextProgramPolicy({ ...defaults, maxTextBytes: 4 });
  const { root, treeSha } = repository(t, 'surrogate-boundary', {
    'src/emoji.txt': 'a\u{1F600}b\n',
  });
  const produced = produceRepositoryContextSource(root, treeSha, ['**'], policy);
  const chunks = produced.items.filter((item) => item.path === 'src/emoji.txt')
    .sort((a, b) => a.chunk - b.chunk);
  const reassembled = chunks.map((c) => c.text).join('');
  assert.equal(reassembled, 'a\u{1F600}b\n',
    'the projected text reassembles with no surrogate-pair corruption');
  for (const chunk of chunks) {
    assert.ok(!/[\uD800-\uDBFF]$/u.test(chunk.text),
      `chunk ${chunk.chunk} must not end with a lone high surrogate`);
    assert.ok(!/^[\uDC00-\uDFFF]/u.test(chunk.text),
      `chunk ${chunk.chunk} must not start with a lone low surrogate`);
  }
});

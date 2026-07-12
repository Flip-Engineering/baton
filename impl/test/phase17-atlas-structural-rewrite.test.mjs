import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { AtlasStructuralRewrite } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function write(root, path, content) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
function fixture(source = `// console.log(fake)\nexport function run(name) {\n  console.log(name)\n  console.log('x')\n}\n`, opts = {}) {
  const root = dir('atlas-rewrite-root'); const artifacts = dir('atlas-rewrite-artifacts'); const events = [];
  write(root, 'src/a.js', source);
  const atlas = new AtlasStructuralRewrite({ artifactRoot: artifacts, maxSourceBytes: 64 * 1024, maxArtifactBytes: 256 * 1024, record: (event) => events.push(event), now: () => 100, ...opts });
  const ctx = { root, budgetTokens: 1000, actor: 'orchestrator' };
  return { root, artifacts, events, atlas, ctx, path: 'src/a.js' };
}

test('AR1: card and public export state proposal-only AST truth and honest missing rungs', () => {
  const { atlas } = fixture(); const card = atlas.card();
  assert.equal(card.ops['search.structural'].deterministic, true);
  assert.equal(card.ops['rewrite.structural'].side_effects, 'writes_proposal_artifacts_only');
  assert.match(card.underlying[0], /^@ast-grep\/napi@/);
  assert.ok(card.limitations.includes('no direct worktree apply authority'));
  assert.ok(card.limitations.includes('no CPG/IR/semantic equivalence'));
});

test('AR2/AR3: structural search matches code, not comment text, with ranges and captures', async () => {
  const f = fixture();
  const result = await f.atlas.invoke('search.structural', { path: f.path, pattern: 'console.log($A)' }, f.ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.payload.length, 2);
  assert.deepEqual(result.payload.map((item) => item.kind), ['call_expression', 'call_expression']);
  assert.deepEqual(result.payload.map((item) => item.captures.A.text), ['name', "'x'"]);
  assert.deepEqual(result.payload.map((item) => item.range.start.line), [3, 4]);
  assert.equal(result.payload.every((item) => /^[a-f0-9]{64}$/.test(item.textDigest)), true);
});

test('AR4/AR5: rewrite interpolates captures, emits proposal, and never mutates source', async () => {
  const f = fixture(); const before = readFileSync(join(f.root, f.path), 'utf8');
  const args = { path: f.path, pattern: 'console.log($A)', replacement: 'logger.info($A)' };
  const result = await f.atlas.invoke('rewrite.structural', args, f.ctx);
  const sourceRef = result.refs.find((ref) => ref.kind === 'proposed_source');
  const proposed = readFileSync(sourceRef.path, 'utf8');
  assert.match(proposed, /logger\.info\(name\)/); assert.match(proposed, /logger\.info\('x'\)/);
  assert.equal(proposed.includes('console.log(name)'), false);
  assert.equal(readFileSync(join(f.root, f.path), 'utf8'), before);
  assert.equal(result.payload.length, 2); assert.equal(result.provenance.outputDigest, sourceRef.digest);
  assert.deepEqual(f.events.map((event) => event.kind), ['capability.op.started', 'capability.op.completed']);
  assert.equal((await f.atlas.reverify(result, result.op, args, f.ctx)).ok, true);
});

test('AR4/AR6: missing captures fail typed and syntactically broken proposals are partial', async () => {
  const f = fixture();
  await assert.rejects(f.atlas.invoke('rewrite.structural', { path: f.path, pattern: 'console.log($A)', replacement: 'logger.info($MISSING)' }, f.ctx), (error) => error.code === 'missing_metavariable');
  const partial = await f.atlas.invoke('rewrite.structural', { path: f.path, pattern: 'console.log($A)', replacement: '}' }, f.ctx);
  assert.equal(partial.status, 'partial'); assert.ok(partial.provenance.parseErrors.output > 0);
});

test('AR4: variadic replacements preserve the captured source separators', async () => {
  const f = fixture(`export function run() { return sum(alpha, beta) }\n`);
  const result = await f.atlas.invoke('rewrite.structural', { path: f.path, pattern: 'sum($$$ARGS)', replacement: 'total($$$ARGS)' }, f.ctx);
  const proposed = readFileSync(result.refs.find((ref) => ref.kind === 'proposed_source').path, 'utf8');
  assert.match(proposed, /total\(alpha, beta\)/);
});

test('AR7: bounded payload resumes from an integrity-checked complete manifest', async () => {
  const f = fixture(); const args = { path: f.path, pattern: 'console.log($A)' };
  const result = await f.atlas.invoke('search.structural', args, { ...f.ctx, budgetTokens: 1 });
  assert.equal(result.status, 'needs_resume'); assert.match(result.cursor, /^atlas-structural:[a-f0-9]{64}:\d+$/);
  const resumed = await f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 });
  assert.ok(resumed.payload.length > 0);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `);
  await assert.rejects(f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
});

test('AR2/AR8: traversal, escaping symlink, invalid UTF-8, size, and cancellation fail typed', async () => {
  const f = fixture();
  await assert.rejects(f.atlas.invoke('search.structural', { path: '../a.js', pattern: '$A' }, f.ctx), (error) => error.code === 'path_escape');
  const outside = dir('atlas-outside'); write(outside, 'outside.js', 'run()'); symlinkSync(join(outside, 'outside.js'), join(f.root, 'escape.js'));
  await assert.rejects(f.atlas.invoke('search.structural', { path: 'escape.js', pattern: '$A' }, f.ctx), (error) => error.code === 'path_escape');
  writeFileSync(join(f.root, 'bad.js'), Buffer.from([0xff]));
  await assert.rejects(f.atlas.invoke('search.structural', { path: 'bad.js', pattern: '$A' }, f.ctx), (error) => error.code === 'invalid_source');
  const small = fixture('function enormous() { return 1 }', { maxSourceBytes: 4 });
  await assert.rejects(small.atlas.invoke('search.structural', { path: small.path, pattern: '$A' }, small.ctx), (error) => error.code === 'invalid_source');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.atlas.invoke('search.structural', { path: f.path, pattern: '$A' }, { ...f.ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
});

test('AR2/AR9: invalid operations/patterns and non-regular sources fail typed', async () => {
  const f = fixture(); mkdirSync(join(f.root, 'directory'));
  await assert.rejects(f.atlas.invoke('search.structural', { path: 'directory', pattern: '$A' }, f.ctx), (error) => error.code === 'invalid_source');
  await assert.rejects(f.atlas.invoke('search.structural', { path: f.path, pattern: '' }, f.ctx), (error) => error.code === 'invalid_pattern');
  await assert.rejects(f.atlas.invoke('unknown', { path: f.path, pattern: '$A' }, f.ctx), (error) => error.code === 'unsupported_op');
});

test('AR2/AR7: a deployment-derived manifest ceiling stops capture-amplification', async () => {
  const f = fixture(`export function run() { return deeply(nested(value)) }\n`, { maxArtifactBytes: 128 });
  await assert.rejects(f.atlas.invoke('search.structural', { path: f.path, pattern: '$A' }, f.ctx), (error) => error.code === 'result_too_large');
});

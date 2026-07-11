import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtlasStructuralDelta } from '../src/index.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'baton-atlas-'));
function fixture(before, after, ext = 'mjs', opts = {}) {
  const root = dir(); const left = join(root, 'left'); const right = join(root, 'right'); const artifacts = join(root, 'artifacts');
  mkdirSync(left); mkdirSync(right); writeFileSync(join(left, `subject.${ext}`), before); writeFileSync(join(right, `subject.${ext}`), after);
  const events = []; const atlas = new AtlasStructuralDelta({ artifactRoot: artifacts, record: (event) => events.push(event), now: () => 100, ...opts });
  const args = { beforePath: `subject.${ext}`, afterPath: `subject.${ext}` };
  const ctx = { beforeRoot: left, afterRoot: right, budgetTokens: 10000, actor: 'orchestrator' };
  return { atlas, args, ctx, events, root, left, right };
}

test('AT1: card truthfully reports pinned ast-grep and current representation limits', () => {
  const { atlas } = fixture('', ''); const card = atlas.card();
  assert.match(card.underlying[0], /^@ast-grep\/napi@0\.44\.1$/);
  assert.equal(card.ops['diff.structural'].deterministic, true);
  assert.ok(card.limitations.includes('no SCIP/CPG/IR'));
});

test('AT3/AT4: real syntax parsing classifies nested add/remove/modify with stable containers', async () => {
  const before = `function gone() { return 1 }\nfunction changed(x) { return x + 1 }\nclass Box { size() { return 1 } }\n`;
  const after = `function changed(x) { return x + 2 }\nfunction added() { return 3 }\nclass Box { size() { return 2 } }\n`;
  const { atlas, args, ctx } = fixture(before, after);
  const result = await atlas.invoke('diff.structural', args, ctx);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.payload.map((item) => [item.change, item.name, item.container]), [
    ['removed', 'gone', null], ['modified', 'Box', null], ['modified', 'changed', null], ['modified', 'size', 'Box'], ['added', 'added', null],
  ]);
  assert.deepEqual(result.provenance.parseErrors, { before: 0, after: 0 });
});

test('AT3: formatting trivia is invariant but string literal whitespace remains significant', async () => {
  const formatting = fixture(`function f(){return "a b"}`, `function f ( ) {\n  return "a b";\n}`);
  assert.equal((await formatting.atlas.invoke('diff.structural', formatting.args, formatting.ctx)).payload.length, 0);
  const literal = fixture(`function f(){return "a b"}`, `function f(){return "a  b"}`);
  assert.deepEqual((await literal.atlas.invoke('diff.structural', literal.args, literal.ctx)).payload.map((item) => item.change), ['modified']);
});

test('AT5: syntax errors produce partial evidence, never a complete claim', async () => {
  const { atlas, args, ctx } = fixture('function f() { return 1 }', 'function f( { return 2 }');
  const result = await atlas.invoke('diff.structural', args, ctx);
  assert.equal(result.status, 'partial');
  assert.ok(result.provenance.parseErrors.after > 0);
});

test('AT2: traversal, escaping symlink, binary, and oversized sources refuse before evidence', async () => {
  const f = fixture('x', 'x', 'mjs', { maxSourceBytes: 4 });
  await assert.rejects(f.atlas.invoke('diff.structural', { ...f.args, beforePath: '../outside.mjs' }, f.ctx), (error) => error.code === 'path_escape');
  writeFileSync(join(f.root, 'outside.mjs'), 'x'); symlinkSync(join(f.root, 'outside.mjs'), join(f.left, 'link.mjs'));
  await assert.rejects(f.atlas.invoke('diff.structural', { beforePath: 'link.mjs', afterPath: 'subject.mjs' }, f.ctx), (error) => error.code === 'path_escape');
  writeFileSync(join(f.left, 'subject.mjs'), Buffer.from([0, 1]));
  await assert.rejects(f.atlas.invoke('diff.structural', f.args, f.ctx), (error) => error.code === 'invalid_source');
  writeFileSync(join(f.left, 'subject.mjs'), '12345');
  await assert.rejects(f.atlas.invoke('diff.structural', f.args, f.ctx), (error) => error.code === 'invalid_source');
});

test('AT6/AT7: bounded payload keeps a complete content-addressed artifact and re-verifies', async () => {
  const before = Array.from({ length: 20 }, (_, i) => `function f${i}(){return ${i}}`).join('\n');
  const after = Array.from({ length: 20 }, (_, i) => `function f${i}(){return ${i + 1}}`).join('\n');
  const { atlas, args, ctx, events } = fixture(before, after); ctx.budgetTokens = 60;
  const result = await atlas.invoke('diff.structural', args, ctx);
  assert.equal(result.status, 'needs_resume'); assert.ok(result.payload.length < 20);
  const artifact = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.equal(artifact.changes.length, 20);
  assert.equal((await atlas.reverify(result, args, { ...ctx, budgetTokens: 10000 })).ok, true);
  assert.deepEqual(events.map((event) => event.kind), ['capability.op.started', 'capability.op.completed', 'capability.op.started', 'capability.op.completed']);
});

test('AT1/AT2: unsupported operations and languages fail typed', async () => {
  const { atlas, args, ctx } = fixture('x', 'x', 'txt');
  await assert.rejects(atlas.invoke('search.semantic', args, ctx), (error) => error.code === 'unsupported_op');
  await assert.rejects(atlas.invoke('diff.structural', args, ctx), (error) => error.code === 'unsupported_language');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AtlasCodeIndex } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function write(root, path, content) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
function fixture(opts = {}) {
  const base = dir('atlas-base'); const artifacts = dir('atlas-artifacts'); const events = [];
  write(base, 'src/a.js', `export function greet(name) { return helper(name) }\nfunction helper(value) { return 'hi ' + value }\n`);
  write(base, 'src/b.ts', `import { greet } from './a.js'\nexport const run = () => greet('world')\n`);
  write(base, 'web/view.html', `<button class="greet">Hello</button>\n`);
  const atlas = new AtlasCodeIndex({ artifactRoot: artifacts, record: (event) => events.push(event), now: () => 100, ...opts });
  const ctx = { baseRoot: base, budgetTokens: 10000, actor: 'orchestrator' };
  return { base, artifacts, events, atlas, ctx };
}
async function build(f) { return f.atlas.invoke('index.build', {}, f.ctx); }

test('AT9/AT15: card declares snapshot+overlay, exact parser, operations, and honest limits', () => {
  const { atlas } = fixture(); const card = atlas.card();
  assert.equal(card.shared_state.code_index, 'snapshot+overlay');
  assert.match(card.underlying[0], /^@ast-grep\/napi@/);
  assert.equal(card.ops['index.build'].interruptible, true);
  assert.equal(card.ops['symbol.references'].reverifiable, true);
  assert.equal(card.ops['scip.export'].deterministic, true);
  assert.ok(card.limitations.some((item) => item.includes('no live LSP')));
  assert.ok(card.limitations.includes('no CPG/IR/semantic merge'));
});

test('AT9: identical content reuses a deterministic immutable epoch and index artifact', async () => {
  const f = fixture(); const one = await build(f); const two = await build(f);
  assert.match(one.provenance.index_epoch, /^[a-f0-9]{64}$/);
  assert.equal(two.provenance.index_epoch, one.provenance.index_epoch);
  assert.equal(two.provenance.artifactDigest, one.provenance.artifactDigest);
  const indexRef = one.refs.find((ref) => ref.kind === 'atlas_index');
  assert.match(indexRef.digest, /^[a-f0-9]{64}$/);
  assert.equal(indexRef.path.includes('/indexes/'), true);
  assert.equal(one.payload.some((file) => file.path === 'src/a.js'), true);
  assert.equal(f.events.filter((event) => event.kind === 'capability.op.started').length, 2);
  assert.equal(f.events.filter((event) => event.kind === 'capability.op.completed').length, 2);
});

test('AT10/AT11: worktree overlay replaces, adds, and tombstones without mutating base results', async () => {
  const f = fixture(); const built = await build(f); const epoch = built.provenance.index_epoch;
  const baseSearch = await f.atlas.invoke('search.lexical', { indexEpoch: epoch, query: 'greet' }, { budgetTokens: 1000 });
  assert.equal(baseSearch.payload.some((hit) => hit.path === 'src/a.js'), true);
  const worktree = dir('atlas-overlay'); cpSync(f.base, worktree, { recursive: true });
  write(worktree, 'src/a.js', `export function salute(name) { return helper(name) }\nfunction helper(value) { return 'hi ' + value }\n`);
  rmSync(join(worktree, 'src/b.ts'));
  write(worktree, 'src/c.js', `import { salute } from './a.js'\nexport const invoke = () => salute('overlay')\n`);
  const over = await f.atlas.invoke('search.lexical', { indexEpoch: epoch, query: 'greet' }, { worktreeRoot: worktree, budgetTokens: 1000 });
  assert.equal(over.payload.length, 1, 'the untouched HTML hit remains while changed/deleted code hits disappear');
  assert.equal(over.payload[0].path, 'web/view.html');
  assert.deepEqual(over.provenance.overlay_changed, ['src/a.js']);
  assert.deepEqual(over.provenance.overlay_added, ['src/c.js']);
  assert.deepEqual(over.provenance.overlay_deleted, ['src/b.ts']);
  assert.equal(over.provenance.overlay_applied, true);
  assert.equal(over.provenance.staleness, 'base_plus_worktree_overlay');
  const unchangedBase = await f.atlas.invoke('search.lexical', { indexEpoch: epoch, query: 'greet' }, { budgetTokens: 1000 });
  assert.equal(unchangedBase.payload.some((hit) => hit.path === 'src/b.ts'), true);
  assert.equal(unchangedBase.provenance.staleness, 'base_snapshot_only');
});

test('AT11/AT12: lexical, symbol, references, calls, repo map, and code seed are typed and resolved', async () => {
  const f = fixture(); const epoch = (await build(f)).provenance.index_epoch;
  const symbols = await f.atlas.invoke('symbol.search', { indexEpoch: epoch, query: 'greet' }, { budgetTokens: 1000 });
  assert.equal(symbols.payload.length, 1);
  assert.equal(symbols.payload[0].name, 'greet');
  assert.match(symbols.payload[0].symbol, /^scip-baton /);
  const refs = await f.atlas.invoke('symbol.references', { indexEpoch: epoch, symbol: symbols.payload[0].symbol }, { budgetTokens: 1000 });
  assert.equal(refs.payload.some((item) => item.role === 'definition' && item.path === 'src/a.js'), true);
  assert.equal(refs.payload.some((item) => item.role === 'reference' && item.path === 'src/b.ts'), true);
  const calls = await f.atlas.invoke('graph.calls', { indexEpoch: epoch }, { budgetTokens: 1000 });
  assert.equal(calls.payload.some((call) => call.calleeName === 'helper' && call.resolved), true);
  assert.equal(calls.payload.some((call) => call.calleeName === 'greet' && call.resolved === symbols.payload[0].symbol), true);
  const map = await f.atlas.invoke('repo.map', { indexEpoch: epoch }, { budgetTokens: 1000 });
  assert.equal(map.payload.find((file) => file.path === 'src/b.ts').imports.includes('./a.js'), true);
  const seed = await f.atlas.invoke('code.seed', { indexEpoch: epoch, terms: ['greet'] }, { budgetTokens: 1000 });
  assert.equal(seed.payload[0].path, 'src/a.js');
  assert.equal(seed.payload[0].symbols[0].name, 'greet');
});

test('AT13: SCIP JSON interchange has documents, stable symbols, zero-based ranges, and definition roles', async () => {
  const f = fixture(); const epoch = (await build(f)).provenance.index_epoch;
  const result = await f.atlas.invoke('scip.export', { indexEpoch: epoch }, { budgetTokens: 10000 });
  const scipRef = result.refs.find((ref) => ref.kind === 'scip_json');
  const scip = JSON.parse(readFileSync(scipRef.path, 'utf8'));
  assert.equal(scip.metadata.version, 0);
  assert.equal(scip.metadata.toolInfo.name, 'baton-atlas');
  assert.equal(scip.documents.some((document) => document.relativePath === 'src/a.js'), true);
  const occurrence = scip.documents.find((document) => document.relativePath === 'src/a.js').occurrences.find((item) => item.symbolRoles === 1);
  assert.equal(occurrence.range.length, 4);
  assert.equal(occurrence.range.every((value) => Number.isInteger(value) && value >= 0), true);
  assert.match(occurrence.symbol, /^scip-baton /);
  assert.deepEqual(scip.externalSymbols, []);
  assert.equal(scipRef.mediaType, 'application/scip+json');
  assert.equal(result.payload.every((document) => document.relativePath), true);
});

test('AT14: bounded payload retains a complete artifact and deterministic reverify', async () => {
  const f = fixture(); const epoch = (await build(f)).provenance.index_epoch;
  const args = { indexEpoch: epoch, query: 'e' }; const ctx = { budgetTokens: 1 };
  const result = await f.atlas.invoke('search.lexical', args, ctx);
  assert.equal(result.status, 'needs_resume');
  assert.match(result.cursor, /^atlas:[a-f0-9]{64}:\d+$/);
  assert.equal(existsSync(result.refs[0].path), true);
  const full = JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
  assert.ok(full.items.length > result.payload.length);
  const resumed = await f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 });
  assert.ok(resumed.payload.length > 0);
  assert.equal(resumed.provenance.resumed_from, result.payload.length);
  assert.equal((await f.atlas.reverify(result, 'search.lexical', args, ctx)).ok, true);
});

test('AT14/AT15: cancellation, symlink skipping, and file ceilings fail safely', async () => {
  const f = fixture(); symlinkSync(join(f.base, 'src/a.js'), join(f.base, 'linked.js'));
  const built = await build(f);
  assert.equal(built.payload.some((file) => file.path === 'linked.js'), false);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.atlas.invoke('index.build', {}, { ...f.ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  const small = fixture({ maxFiles: 1 });
  await assert.rejects(build(small), (error) => error.code === 'index_too_large');
});

test('AT10/AT12: unknown epochs, ambiguous names, and missing symbols are typed refusals', async () => {
  const f = fixture(); write(f.base, 'src/duplicate.js', `export function greet() { return 'duplicate' }\n`); const epoch = (await build(f)).provenance.index_epoch;
  await assert.rejects(f.atlas.invoke('symbol.references', { indexEpoch: epoch, name: 'greet' }, { budgetTokens: 100 }), (error) => error.code === 'ambiguous_symbol');
  await assert.rejects(f.atlas.invoke('symbol.references', { indexEpoch: epoch, name: 'missing' }, { budgetTokens: 100 }), (error) => error.code === 'symbol_not_found');
  await assert.rejects(f.atlas.invoke('search.lexical', { indexEpoch: '0'.repeat(64), query: 'x' }, { budgetTokens: 100 }), (error) => error.code === 'unknown_epoch');
  await assert.rejects(f.atlas.invoke('unknown', {}, { budgetTokens: 100 }), (error) => error.code === 'unsupported_op');
});

test('AT9/AT14: tampered index/result artifacts and pathological result volume fail closed', async () => {
  const f = fixture(); const built = await build(f); const epoch = built.provenance.index_epoch;
  const indexPath = built.refs.find((ref) => ref.kind === 'atlas_index').path;
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.files[0].definitions.push({ symbol: 'forged', name: 'forged', kind: 'function', path: index.files[0].path });
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`);
  await assert.rejects(f.atlas.invoke('symbol.search', { indexEpoch: epoch, query: 'greet' }, { budgetTokens: 100 }), (error) => error.code === 'index_integrity');

  const clean = fixture(); const cleanEpoch = (await build(clean)).provenance.index_epoch;
  const bounded = new AtlasCodeIndex({ artifactRoot: dir('atlas-small-results'), maxResults: 1 });
  const boundedBuild = await bounded.invoke('index.build', {}, { baseRoot: clean.base, budgetTokens: 1000 });
  await assert.rejects(bounded.invoke('search.lexical', { indexEpoch: boundedBuild.provenance.index_epoch, query: 'greet' }, { budgetTokens: 100 }), (error) => error.code === 'result_too_large');

  const result = await clean.atlas.invoke('search.lexical', { indexEpoch: cleanEpoch, query: 'greet' }, { budgetTokens: 1 });
  const resultPath = result.refs[0].path; writeFileSync(resultPath, `${readFileSync(resultPath, 'utf8')} `);
  await assert.rejects(clean.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 100 }), (error) => error.code === 'result_integrity');
  assert.ok(readdirSync(join(clean.artifacts, 'indexes')).length > 0);
});

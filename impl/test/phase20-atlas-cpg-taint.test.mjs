import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AtlasCpgTaint } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function fixture(source, opts = {}) {
  const root = dir('taint-root'); const artifacts = dir('taint-artifacts'); mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/a.js'), source);
  const atlas = new AtlasCpgTaint({ artifactRoot: artifacts, maxSourceBytes: 64 * 1024, maxGraphBytes: 512 * 1024, maxResultBytes: 512 * 1024, maxDepth: 16, maxPaths: 32, ...opts });
  return { root, artifacts, atlas, args: { path: 'src/a.js', sourceNames: ['readInput'], sinkNames: ['send'], depth: 12 }, ctx: { root, budgetTokens: 10000 } };
}

test('CT1/CT2: assignment value flow reaches an explicit sink with typed edges', async () => {
  const f = fixture(`function readInput(){}\nfunction send(v){}\nfunction run(){ let value=readInput(); send(value) }\n`); const result = await f.atlas.invoke('cpg.taint', f.args, f.ctx);
  assert.equal(result.status, 'ok'); assert.equal(result.payload.length, 1); assert.deepEqual(result.payload[0].edgeTypes, ['ASSIGNED_FROM', 'REACHING_DEF', 'ARGUMENT_TO']); assert.equal(result.payload[0].sourceName, 'readInput'); assert.equal(result.payload[0].sinkName, 'send');
});

test('CT2: a nested source call flows directly into the sink argument', async () => {
  const f = fixture(`function readInput(){}\nfunction send(v){}\nfunction run(){ send(readInput()) }\n`); const result = await f.atlas.invoke('cpg.taint', f.args, f.ctx);
  assert.equal(result.payload.length, 1); assert.deepEqual(result.payload[0].edgeTypes, ['ARGUMENT_TO']);
});

test('CT3/CT5: configured sanitizer cuts flow while unrelated unresolved calls fabricate nothing', async () => {
  const source = `function readInput(){}\nfunction sanitize(v){return v}\nfunction send(v){}\nfunction run(){ let value=readInput(); let clean=sanitize(value); send(clean); unknown(value) }\n`;
  const f = fixture(source); const blocked = await f.atlas.invoke('cpg.taint', { ...f.args, sanitizerNames: ['sanitize'] }, f.ctx); assert.equal(blocked.payload.length, 0);
  const open = await f.atlas.invoke('cpg.taint', f.args, f.ctx); assert.equal(open.payload.length, 1);
  const absent = await f.atlas.invoke('cpg.taint', { ...f.args, sinkNames: ['missing'] }, f.ctx); assert.equal(absent.payload.length, 0);
});

test('CT4/CT6: deployment bounds, cancellation, and parse partials are enforced', async () => {
  const f = fixture(`function readInput(){}\nfunction send(v){}\nfunction run(){send(readInput())}\n`);
  await assert.rejects(f.atlas.invoke('cpg.taint', { ...f.args, depth: 17 }, f.ctx), (error) => error.code === 'taint_depth_exceeded');
  const abort = new AbortController(); abort.abort(); await assert.rejects(f.atlas.invoke('cpg.taint', f.args, { ...f.ctx, signal: abort.signal }), (error) => error.code === 'cancelled');
  const broken = fixture(`function readInput( { send(readInput()) }`); const partial = await broken.atlas.invoke('cpg.taint', broken.args, broken.ctx); assert.equal(partial.status, 'partial');
  const tiny = fixture(`function readInput(){} function send(v){} function run(){send(readInput())}`, { maxPaths: 1, maxResultBytes: 64 }); await assert.rejects(tiny.atlas.invoke('cpg.taint', tiny.args, tiny.ctx), (error) => error.code === 'taint_result_too_large');
  const paths = fixture(`function readInput(){} function send(v){} function run(){send(readInput());send(readInput())}`, { maxPaths: 1 }); await assert.rejects(paths.atlas.invoke('cpg.taint', paths.args, paths.ctx), (error) => error.code === 'taint_paths_exceeded');
});

test('CT7: bounded result resumes, detects tamper, and reverifies', async () => {
  const f = fixture(`function readInput(){}\nfunction send(v){}\nfunction run(){send(readInput());send(readInput())}\n`); const result = await f.atlas.invoke('cpg.taint', f.args, { ...f.ctx, budgetTokens: 1 }); assert.equal(result.status, 'needs_resume');
  const resumed = await f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }); assert.ok(resumed.payload.length > 0); assert.equal((await f.atlas.reverify(result, f.args, f.ctx)).ok, true);
  writeFileSync(result.refs[0].path, `${readFileSync(result.refs[0].path, 'utf8')} `); await assert.rejects(f.atlas.resume(result.refs[0], result.cursor, { budgetTokens: 1000 }), (error) => error.code === 'artifact_integrity');
});

test('CT1: invalid policy names fail before graph construction', async () => {
  const f = fixture(`function run(){}`); await assert.rejects(f.atlas.invoke('cpg.taint', { ...f.args, sourceNames: [] }, f.ctx), (error) => error.code === 'invalid_taint_policy');
});

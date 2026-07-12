import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AtlasCpgSlice, AtlasCpgTaint } from '../src/index.mjs';

const dir = (name) => mkdtempSync(join(tmpdir(), `baton-${name}-`));
function fixture(source, opts = {}) {
  const root = dir('path-cpg-root'); const artifacts = dir('path-cpg-artifacts');
  mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, 'src/a.js'), source);
  const common = { maxSourceBytes: 64 * 1024, maxReachDefPairs: 128, ...opts };
  const cpg = new AtlasCpgSlice({ artifactRoot: join(artifacts, 'cpg'), maxArtifactBytes: 512 * 1024, ...common });
  const taint = new AtlasCpgTaint({ artifactRoot: join(artifacts, 'taint'), maxGraphBytes: 512 * 1024, maxResultBytes: 512 * 1024, maxDepth: 24, maxPaths: 32, ...common });
  return { root, artifacts, cpg, taint, ctx: { root, budgetTokens: 10000 }, args: { path: 'src/a.js', sourceNames: ['readInput'], sinkNames: ['send'], depth: 20 } };
}

async function graph(f) {
  const result = await f.cpg.invoke('cpg.build', { path: 'src/a.js' }, f.ctx);
  return JSON.parse(readFileSync(result.refs[0].path, 'utf8'));
}

test('PS1: a braced if/else enters both branches and both non-terminal tails join the follower', async () => {
  const f = fixture(`function run(flag) {
  if (flag) {
    left()
  } else {
    right()
  }
  done()
}\n`);
  const g = await graph(f);
  const statement = (line) => g.nodes.find((node) => node.type === 'statement' && node.range.start.line === line);
  const branch = statement(2); const left = statement(3); const right = statement(5); const done = statement(7);
  assert.ok(branch && left && right && done);
  assert.ok(g.edges.some((edge) => edge.type === 'CFG_TRUE' && edge.from === branch.id && edge.to === left.id));
  assert.ok(g.edges.some((edge) => edge.type === 'CFG_FALSE' && edge.from === branch.id && edge.to === right.id));
  assert.ok(g.edges.some((edge) => edge.type === 'CFG_NEXT' && edge.from === left.id && edge.to === done.id));
  assert.ok(g.edges.some((edge) => edge.type === 'CFG_NEXT' && edge.from === right.id && edge.to === done.id));
  assert.equal(g.edges.some((edge) => edge.type === 'CFG_NEXT' && edge.from === branch.id && edge.to === done.id), false);
});

test('PS2/PS4: alternate branch definitions may reach a join but literal-dead sources and sinks do not', async () => {
  const may = fixture(`function readInput(){} function safe(){} function send(v){}
function run(flag){ let value=readInput(); if(flag){ value=safe() } send(value) }\n`);
  const possible = await may.taint.invoke('cpg.taint', may.args, may.ctx);
  assert.equal(possible.payload.length, 1, 'the pre-branch source definition reaches the sink on the false path');

  const deadDefinition = fixture(`function readInput(){} function send(v){}
function run(){ let value; if(false){ value=readInput() } send(value) }\n`);
  assert.equal((await deadDefinition.taint.invoke('cpg.taint', deadDefinition.args, deadDefinition.ctx)).payload.length, 0);

  const deadDirect = fixture(`function readInput(){} function send(v){}
function run(){ if(false){ send(readInput()) } }\n`);
  assert.equal((await deadDirect.taint.invoke('cpg.taint', deadDirect.args, deadDirect.ctx)).payload.length, 0);
});

test('PS3/PS4: direct identifier copies carry value while a nested sanitizer cannot be bypassed', async () => {
  const copied = fixture(`function readInput(){} function send(v){}
function run(){ let a=readInput(); let b=a; send(b) }\n`);
  const copyResult = await copied.taint.invoke('cpg.taint', copied.args, copied.ctx);
  assert.equal(copyResult.payload.length, 1);
  assert.deepEqual(copyResult.payload[0].edgeTypes, ['ASSIGNED_FROM', 'REACHING_DEF', 'ASSIGNED_FROM', 'REACHING_DEF', 'ARGUMENT_TO']);

  const sanitized = fixture(`function readInput(){} function sanitize(v){return v} function send(v){}
function run(){ let clean=sanitize(readInput()); send(clean) }\n`);
  const cut = await sanitized.taint.invoke('cpg.taint', { ...sanitized.args, sanitizerNames: ['sanitize'] }, sanitized.ctx);
  assert.equal(cut.payload.length, 0);
  assert.equal((await sanitized.taint.invoke('cpg.taint', sanitized.args, sanitized.ctx)).payload.length, 1);
});

test('PS2/PS6: reaching-definition expansion has a mandatory deployment ceiling', async () => {
  assert.throws(() => new AtlasCpgSlice({ artifactRoot: dir('missing-reach-bound'), maxSourceBytes: 1000, maxArtifactBytes: 1000 }), /maxReachDefPairs/);
  const tiny = fixture(`function send(v){} function run(a){ let b=a; send(b) }\n`, { maxReachDefPairs: 1 });
  await assert.rejects(tiny.cpg.invoke('cpg.build', { path: 'src/a.js' }, tiny.ctx), (error) => error.code === 'reachdef_too_large');
});

test('PS4/PS5: direct arguments remain, while heap and interprocedural return flow remain explicitly absent', async () => {
  const direct = fixture(`function readInput(){} function send(v){} function run(){ send(readInput()) }\n`);
  const result = await direct.taint.invoke('cpg.taint', direct.args, direct.ctx);
  assert.equal(result.payload.length, 1); assert.deepEqual(result.payload[0].edgeTypes, ['ARGUMENT_TO']);
  assert.equal(result.provenance.meaning, 'cfg_may_reach_value_graph_not_safety_proof');

  const heap = fixture(`function readInput(){} function send(v){} function run(o){ o.x=readInput(); send(o.x) }\n`);
  assert.equal((await heap.taint.invoke('cpg.taint', heap.args, heap.ctx)).payload.length, 0);
  const returned = fixture(`function readInput(){} function wrap(){ return readInput() } function send(v){} function run(){ send(wrap()) }\n`);
  assert.equal((await returned.taint.invoke('cpg.taint', returned.args, returned.ctx)).payload.length, 0);
});

test('PS1/PS4: unsupported control remains atomic instead of making its nested values unreachable', async () => {
  const f = fixture(`function readInput(){} function send(v){}\nfunction run(){ let value; try { value=readInput() } catch {} send(value) }\n`);
  const result = await f.taint.invoke('cpg.taint', f.args, f.ctx);
  assert.equal(result.payload.length, 1);
});

test('PS1/PS2/PS4: an else-if chain is entered from the outer false edge and preserves the middle-arm may-flow', async () => {
  const f = fixture(`function readInput(){} function safe(){} function send(v){}\nfunction run(flag){
  let value
  if(flag === 1){
    value=safe()
  } else if(flag === 2){
    value=readInput()
  } else {
    value=safe()
  }
  send(value)
}\n`);
  const g = await graph(f); const branches = g.nodes.filter((node) => node.type === 'statement' && node.kind === 'if_statement').sort((a, b) => a.range.start.line - b.range.start.line);
  assert.equal(branches.length, 2);
  assert.ok(g.edges.some((edge) => edge.type === 'CFG_FALSE' && edge.from === branches[0].id && edge.to === branches[1].id));
  assert.equal(branches[1].cfgReachable, true);
  const result = await f.taint.invoke('cpg.taint', f.args, f.ctx);
  assert.equal(result.payload.length, 1);
});

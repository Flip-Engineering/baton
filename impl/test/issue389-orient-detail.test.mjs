// Issue #389 — code.orient.detail answers ok with lines: [] for every admitted
// citation: serve the cited lines or refuse typed.
//
// Red-before suite covering acceptance (a), (b), (c):
//   (a) detail over an admitted citation answers lines[{line, text}] covering the
//       citation's range inclusively, plus the ladder's freshnessDigest;
//   (b) an absent file, or a range outside the file, REFUSES with the typed code
//       orientation_detail_unavailable — naming the file, the requested range, the
//       file's actual line count, and the next action — never ok:true;
//   (c) packDigest covers the served content (editing the cited text changes it).
//
// Harness mirrors impl/test/orientation-red.test.mjs (ScriptableAdapter +
// Coordinator + a real git repo + AtlasCodeIndex through the capabilities seam).
// Red-first: every row below is red at HEAD (detail serves lines: [] and answers
// ok:true through every path) and goes green only on the #389 implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { AtlasCodeIndex } from '../src/atlas-index.mjs';
import { CapabilityRegistry } from '../src/index.mjs';

const dirs = [];
function tmpDir(label = 'issue389') {
  const d = mkdtempSync(join(tmpdir(), `baton-issue389-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function makeBrief(overrides = {}) {
  return {
    goal: 'orient to the codebase, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir('lane');
  const log = new Log(join(dir, 'log'));
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

function emitCodeRead(adapter, handle, query, key) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query, expectedFence: 'current', idempotencyKey: key },
  });
}

function readResults(coordinator, handle) {
  return coordinator._log.read(handle.id).filter((event) => event.kind === 'context.read_result');
}

const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
};
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const repo = (name, files) => {
  const root = tmpDir(name);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'issue389@example.invalid']);
  git(root, ['config', 'user.name', 'Issue 389']);
  for (const [path, value] of Object.entries(files)) write(root, path, value);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return root;
};

function orientedLane(files, label) {
  const root = repo(label, files);
  const adapter = new ScriptableAdapter();
  const capabilities = new CapabilityRegistry({
    capabilities: {
      'atlas-index': new AtlasCodeIndex({
        artifactRoot: join(root, 'atlas-artifacts', 'index'), maxArtifactBytes: 256 * 1024,
        maxSourceBytes: 64 * 1024, maxFiles: 64, maxResults: 256,
      }),
    },
    contexts: { 'atlas-index': { baseRoot: root } },
    maxBudgetTokens: 20_000, maxEnvelopeBytes: 512 * 1024, root,
    record: () => null,
  });
  const { coordinator } = setup({ adapter, capture: noDiff, coordinatorOpts: { capabilities } });
  return { root, adapter, coordinator };
}

// Eight repository lines, no trailing newline: text.split(/\r?\n/) (the ladder's
// own split, atlas-index.mjs) has exactly 8 entries, so the file's actual line
// count is 8 and line N is ALPHA_LINES[N - 1].
const ALPHA_LINES = [
  "import { beta } from './beta.js';",
  '',
  'export const alpha = 1;',
  'export function run(input) {',
  '  return beta(input + alpha);',
  '}',
  '',
  'export default { alpha, run };',
];
const ALPHA_TEXT = ALPHA_LINES.join('\n');
const BETA_TEXT = "export function beta(input) {\n  return input * 2;\n}\n".replace(/\n$/, '');

const expectedLines = (start, end) => ALPHA_LINES.slice(start - 1, end).map((text, index) => ({ line: start + index, text }));

async function mapCitation(lane, keyPrefix) {
  const handle = await lane.coordinator.spawn('mock', makeBrief());
  emitCodeRead(lane.adapter, handle, { kind: 'code', op: 'code.orient.map' }, `${keyPrefix}-map`);
  await flush(40);
  const mapResult = readResults(lane.coordinator, handle).at(-1);
  assert.equal(mapResult?.payload?.ok ?? null, true, 'the live map answers (the citation source)');
  const citation = mapResult?.payload?.packDigest ?? null;
  assert.equal(typeof citation, 'string', 'the map answer exposes its pack citation for descent');
  return { handle, mapResult, citation };
}

function unitScope() {
  return { pathScope: ['.'], repoId: 'orientation-contract-repo', runId: null, scopeDigest: 'unit-scope' };
}

// ---------------------------------------------------------------------------
// (a) the admitted citation serves its source lines
// ---------------------------------------------------------------------------

test('issue389-a-map: code.orient.detail over an admitted map citation serves lines[{line, text}] for the requested range plus the ladder freshnessDigest', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT }, 'a-map');
  const { handle, mapResult, citation } = await mapCitation(lane, 'issue389-a');
  emitCodeRead(lane.adapter, handle,
    { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 2 }, end: { line: 4 } } },
    'issue389-a-detail');
  await flush(40);
  const detail = readResults(lane.coordinator, handle).at(-1);
  assert.equal(detail?.payload?.ok ?? null, true, 'a contained range over an admitted citation answers');
  assert.deepEqual(detail?.payload?.detail?.lines ?? null, expectedLines(2, 4),
    'detail serves the cited source lines [{line, text}] covering the range inclusively');
  assert.equal(detail?.payload?.freshnessDigest ?? null, mapResult?.payload?.freshnessDigest ?? null,
    'the answer carries the freshnessDigest the ladder computed');
  assert.equal(detail?.payload?.mergeAuthority ?? null, false, 'detail is evidence, never clearance');
  assert.equal(detail?.payload?.verificationAuthority ?? null, false, 'detail is evidence, never clearance');
  assert.match(String(detail?.payload?.packDigest ?? ''), /^[a-f0-9]{64}$/u, 'the answer carries a content packDigest');
});

test('issue389-a-region-path: code.orient.detail over a region citation with an explicit path serves that file lines', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT, 'src/beta.js': BETA_TEXT }, 'a-region');
  const handle = await lane.coordinator.spawn('mock', makeBrief());
  emitCodeRead(lane.adapter, handle,
    { kind: 'code', op: 'code.orient.region', moduleKey: { repoId: 'orientation-contract-repo', rootPath: 'src' } },
    'issue389-ar-region');
  await flush(40);
  const regionResult = readResults(lane.coordinator, handle).at(-1);
  assert.equal(regionResult?.payload?.ok ?? null, true, 'the region answers (the citation source)');
  const citation = regionResult?.payload?.packDigest ?? null;
  assert.equal(typeof citation, 'string', 'the region answer exposes its pack citation for descent');
  emitCodeRead(lane.adapter, handle,
    { kind: 'code', op: 'code.orient.detail', citation, path: 'src/alpha.js', range: { start: { line: 1 }, end: { line: 2 } } },
    'issue389-ar-detail');
  await flush(40);
  const detail = readResults(lane.coordinator, handle).at(-1);
  assert.equal(detail?.payload?.ok ?? null, true, 'a contained range with an admitted path answers');
  assert.deepEqual(detail?.payload?.detail?.lines ?? null, expectedLines(1, 2),
    'detail serves the named admitted file lines');
});

// ---------------------------------------------------------------------------
// (b) absent file / out-of-file range refuses typed — never ok:true
// ---------------------------------------------------------------------------

test('issue389-b-absent: code.orient.detail for a citation whose file is absent refuses typed, naming file, range, line count and next action', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT }, 'b-absent');
  const { handle, citation } = await mapCitation(lane, 'issue389-ba');
  unlinkSync(join(lane.root, 'src/alpha.js'));
  const query = { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 2 } } };
  emitCodeRead(lane.adapter, handle, query, 'issue389-ba-detail');
  await flush(40);
  const detail = readResults(lane.coordinator, handle).at(-1);
  assert.equal(detail?.payload?.ok ?? null, false, 'an absent file never answers ok:true with lines: []');
  assert.equal(detail?.payload?.result ?? detail?.payload?.code ?? null, 'orientation_detail_unavailable',
    'the refusal is the typed detail code');
  const error = (() => {
    try { lane.coordinator._codeOrientationDetail(query, unitScope()); return null; }
    catch (caught) { return caught; }
  })();
  assert.ok(error, 'the seam throws (it never serves)');
  assert.equal(error?.code ?? null, 'orientation_detail_unavailable', 'the thrown refusal carries the typed code');
  assert.match(String(error?.message ?? ''), /src\/alpha\.js/u, 'the refusal names the file');
  assert.match(String(error?.message ?? ''), /1\.\.2/u, 'the refusal names the requested range');
  assert.match(String(error?.message ?? ''), /0 lines/u, 'the refusal names the actual line count');
  assert.match(String(error?.message ?? ''), /next:/u, 'the refusal names the next action');
});

test('issue389-b-range: code.orient.detail for a range outside the file refuses typed with the actual line count', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT }, 'b-range');
  const { handle, citation } = await mapCitation(lane, 'issue389-br');
  const query = { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 50 } } };
  emitCodeRead(lane.adapter, handle, query, 'issue389-br-detail');
  await flush(40);
  const detail = readResults(lane.coordinator, handle).at(-1);
  assert.equal(detail?.payload?.ok ?? null, false, 'a range outside the file never answers ok:true with lines: []');
  assert.equal(detail?.payload?.result ?? detail?.payload?.code ?? null, 'orientation_detail_unavailable',
    'the refusal is the typed detail code');
  const error = (() => {
    try { lane.coordinator._codeOrientationDetail(query, unitScope()); return null; }
    catch (caught) { return caught; }
  })();
  assert.ok(error, 'the seam throws (it never serves past EOF)');
  assert.match(String(error?.message ?? ''), /src\/alpha\.js/u, 'the refusal names the file');
  assert.match(String(error?.message ?? ''), /1\.\.50/u, 'the refusal names the requested range');
  assert.match(String(error?.message ?? ''), /8 lines/u, 'the refusal names the actual line count');
  assert.match(String(error?.message ?? ''), /next:/u, 'the refusal names the next action');
  const pastStart = (() => {
    try {
      lane.coordinator._codeOrientationDetail(
        { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 9 }, end: { line: 9 } } }, unitScope());
      return null;
    } catch (caught) { return caught; }
  })();
  assert.equal(pastStart?.code ?? null, 'orientation_detail_unavailable', 'a start line past EOF refuses too');
});

test('issue389-b-select: a multi-file citation without a path refuses typed; with an admitted path it serves that file', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT, 'src/beta.js': BETA_TEXT }, 'b-select');
  const { handle, citation } = await mapCitation(lane, 'issue389-bs');
  const bare = { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 2 } } };
  emitCodeRead(lane.adapter, handle, bare, 'issue389-bs-bare');
  await flush(40);
  const refused = readResults(lane.coordinator, handle).at(-1);
  assert.equal(refused?.payload?.ok ?? null, false, 'an unselectable multi-file citation never answers a guessed file');
  assert.equal(refused?.payload?.result ?? refused?.payload?.code ?? null, 'orientation_detail_unavailable',
    'the ambiguity refusal is the typed detail code');
  const named = { ...bare, path: 'src/beta.js' };
  emitCodeRead(lane.adapter, handle, named, 'issue389-bs-named');
  await flush(40);
  const served = readResults(lane.coordinator, handle).at(-1);
  assert.equal(served?.payload?.ok ?? null, true, 'an admitted path selects its file');
  assert.deepEqual(served?.payload?.detail?.lines ?? null,
    BETA_TEXT.split('\n').slice(0, 2).map((text, index) => ({ line: index + 1, text })),
    'detail serves the named file lines');
  const foreign = (() => {
    try {
      lane.coordinator._codeOrientationDetail({ ...bare, path: 'src/nope.js' }, unitScope());
      return null;
    } catch (caught) { return caught; }
  })();
  assert.equal(foreign?.code ?? null, 'orientation_detail_unavailable', 'a never-admitted path refuses typed');
  assert.match(String(foreign?.message ?? ''), /src\/nope\.js/u, 'the refusal names the requested file');
});

// ---------------------------------------------------------------------------
// (c) packDigest covers the served content
// ---------------------------------------------------------------------------

test('issue389-c-digest: changing the cited text changes the detail packDigest', async () => {
  const lane = orientedLane({ 'src/alpha.js': ALPHA_TEXT }, 'c-digest');
  const { handle, citation } = await mapCitation(lane, 'issue389-c');
  const query = { kind: 'code', op: 'code.orient.detail', citation, range: { start: { line: 1 }, end: { line: 8 } } };
  emitCodeRead(lane.adapter, handle, query, 'issue389-c-before');
  await flush(40);
  const before = readResults(lane.coordinator, handle).at(-1);
  assert.equal(before?.payload?.ok ?? null, true, 'the first detail answers');
  const digestBefore = before?.payload?.packDigest ?? null;
  assert.match(String(digestBefore ?? ''), /^[a-f0-9]{64}$/u, 'the first answer carries a packDigest');
  write(join(lane.root, 'src/alpha.js'), ALPHA_TEXT.replace('export const alpha = 1;', 'export const alpha = 2;'));
  emitCodeRead(lane.adapter, handle, query, 'issue389-c-after');
  await flush(40);
  const after = readResults(lane.coordinator, handle).at(-1);
  assert.equal(after?.payload?.ok ?? null, true, 'the second detail answers against the same live citation');
  assert.deepEqual((after?.payload?.detail?.lines ?? []).find((row) => row.line === 3) ?? null,
    { line: 3, text: 'export const alpha = 2;' }, 'the served lines track the edited text');
  assert.notEqual(after?.payload?.packDigest ?? null, digestBefore,
    'packDigest covers the served content: edited text changes the digest');
});

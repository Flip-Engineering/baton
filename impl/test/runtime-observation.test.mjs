// runtime-observation.test.mjs — issue #259, slice 10. Verifies the coordinator's observation
// bucket (impl/src/runtime-observation.mjs) against the injected recorder port (slice 6) and the
// coordinator that delegates to it. Five claims:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith and contains
//      no `this` at all.
//   2. SAME NAME, SAME ARITY, SAME PORT — every delegate the seam map shows as `observation_port`
//      keeps the member's own parameter list and hands the class's recorder to the module
//      function; generator members delegate with `yield*`.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — the bucket records through the port, and a
//      real spawn proves the instance-patch contract across the module boundary.
//   4. THE HELPERS MOVED ONCE — the relocated declarations are exported by the module; exactly
//      the names a staying member still reads are imported back.
//   5. THE MAP SEES THE MOVE — the artifact carries the runtime-observation target, every class
//      delegate keeps `observation`, and the bodies whose evidence thins on the port spelling
//      are named.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { collectSeamInventory } from '../scripts/seam-inventory.mjs';

import * as runtimeObservation from '../src/runtime-observation.mjs';
import { Coordinator } from '../src/coordinator.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-observation.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const GENERATORS = Object.freeze(['_seedCoordinationTasksPasses', '_terminalizeUnattachedCoordinationTasks']);

const IMPORTED_BACK = Object.freeze(['closedVerificationVerdict', 'noop', 'pathInScope']);

const RECLASSIFIED = Object.freeze([
  ['drain', 'admission'], ['_semanticControlBinding', 'surface'], ['_isReviewAuthority', 'admission'],
  ['_attentionPage', 'admission'], ['_send', 'surface'], ['readProviderStatus', 'admission'],
  ['claimScratch', 'admission'], ['postScratchFact', 'admission'], ['writeScratchpad', 'admission'],
  ['_answerContextRead', 'admission'], ['_recordOrientationRating', 'admission'],
  ['boardFence', 'admission'], ['boardSnapshot', 'admission'], ['bindingFence', 'admission'],
  ['replBindingSnapshot', 'admission'], ['resolveReplCitation', 'admission'],
]);

test('RO1: the module imports neither monolith and contains no implicit receiver at all', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  const thisNodes = root.findAll({ rule: { kind: 'this' } });
  assert.equal(thisNodes.length, 0, 'no member body and no relocated helper reads an implicit receiver');
});

test('RO2: every observation_port delegate keeps the member name, parameter list, and hands over the recorder', () => {
  const map = collectSeamInventory();
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('observation:observation_port'))
    .map((member) => member.name);
  assert.ok(delegated.length > 0, 'the map carries at least one observation delegate');
  assert.ok(!delegated.includes('_providerBrief'),
    '_providerBrief stays slice 3\'s briefing-port delegate — not double-hopped through this module');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  const coordText = read(COORD_FILE);
  const coordRoot = parseOf(coordText);
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  for (const name of delegated) {
    const method = byName.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    assert.ok(memberParams.has(name), `${name}: the module must export it`);
    const moduleOwn = memberParams.get(name).replace(/^\(coordinator, recorder,?\s*/u, '(')
      .replaceAll('coordinator.', 'this.');
    assert.equal(method.field('parameters')?.text() ?? '()', moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (module takes coordinator, recorder first; receiver spellings normalized)`);
    const delegateText = method.text();
    assert.ok(delegateText.includes(`runtimeObservation.${name}(this, this._recorder`),
      `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    if (GENERATORS.includes(name)) {
      assert.ok(delegateText.includes(`yield* runtimeObservation.${name}(`),
        `${name}: a generator member delegates with yield* (slice-8 contract)`);
    } else {
      assert.ok(delegateText.includes(`return runtimeObservation.${name}(`), `${name}: a plain delegate returns the call`);
    }
    assert.ok(Object.getOwnPropertyDescriptor(Coordinator.prototype, name),
      `${name}: the class must still answer on ${name}`);
  }
});

test('RO3: the recorder is the only recording path — census pinned, and instance patches fire across the boundary', async () => {
  const text = read(MEMBER_FILE);
  // Count inside the function bodies only — the module header names the port spellings in prose.
  const codeOnly = parseOf(text).findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })
    .map((fn) => fn.text()).join('\n');
  assert.ok(codeOnly.includes('recorder.log.append('), 'the bucket uses recorder.log.append');
  assert.ok(codeOnly.includes('recorder.mapEvent('), 'the bucket uses recorder.mapEvent');
  assert.ok(codeOnly.includes('recorder.recordDriver('), 'the bucket uses recorder.recordDriver');
  assert.ok(codeOnly.includes('recorder.coordination'), 'the bucket uses recorder.coordination');
  assert.equal(text.includes('this._log.append('), false, 'no moved body reaches the log beside the port');
  assert.equal(text.includes('this._coordination'), false, 'no moved body reaches the store beside the port');

  // The instance-patch contract, behaviorally: a spawn drives the moved _dispatch, whose body
  // self-calls recordWorkerGeneration (observation bucket) THROUGH the class — an instance stub
  // must fire.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'baton-ro3-'));
  const adapter = {
    card: () => ({ harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native' } }),
    _onEvent: null,
    onEvent(cb) { this._onEvent = cb; },
    emit(event) { if (this._onEvent) this._onEvent(event); },
    spawn() { return Promise.resolve({ ok: true }); },
    async kill() {},
    async interrupt() {},
  };
  const worktrees = {
    async create(taskId) { return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
    async remove() {},
  };
  try {
    const log = new Log(join(dir, 'log'));
    const coordinator = new Coordinator({
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: { mock: adapter },
      worktrees,
      capabilities: null,
      referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
      route: () => 'mock',
      now: (() => { let t = 0; return () => t; })(),
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    });
    let patched = 0;
    const original = coordinator.recordWorkerGeneration;
    coordinator.recordWorkerGeneration = (handle) => { patched += 1; return original.call(coordinator, handle); };
    const handle = await coordinator.spawn('mock', {
      goal: 'ro3', constraints: [], pathScope: ['.'],
      definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 1000, usd: 1, wallMin: 5 },
    });
    assert.equal(patched, 1,
      'the instance stub on an observation member fired from inside the moved _dispatch — the self-call routed through the class');
    const stopping = coordinator.kill(handle.id, 'test_done');
    adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
    await stopping;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('RO4: the relocated helpers moved once; the import-back names are imported back', () => {
  const coordText = read(COORD_FILE);
  const memberRoot = parseOf(read(MEMBER_FILE));
  const relocated = [];
  for (const node of memberRoot.findAll({ rule: { kind: 'export_statement' } })) {
    const decl = node.field('declaration');
    if (!decl) continue;
    const kind = decl.kind();
    if (kind === 'lexical_declaration' || kind === 'class_declaration') {
      const name = kind === 'class_declaration'
        ? decl.field('name')?.text()
        : decl.children().filter((c) => c.kind() === 'variable_declarator').map((v) => v.field('name')?.text()).filter(Boolean)[0];
      if (name) relocated.push(name);
    }
  }
  assert.ok(relocated.length > 0, 'the module carries relocated declarations');
  for (const name of relocated) {
    assert.ok(Object.hasOwn(runtimeObservation, name), `${name}: the module exports it`);
  }
  const importBack = coordText.match(/import \{[^}]*\} from '\.\/runtime-observation\.mjs';/gsu) ?? [];
  const names = importBack.flatMap((statement) => [...statement.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/gu)]
    .map((m) => m[1])
    .filter((n) => !['import', 'from', 'runtime', 'observation', 'mjs'].includes(n)));
  for (const name of IMPORTED_BACK) {
    assert.ok(names.includes(name), `${name}: a staying member still reads it — it must be imported back`);
  }
});

test('RO5: the map sees the move', () => {
  const map = collectSeamInventory();
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-observation target');
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegates = coordinatorFile.members.filter((member) => member.evidence.includes('observation:observation_port'));
  for (const member of delegates) {
    assert.equal(member.seam, 'observation', `${member.name}: the delegate keeps the observation seam`);
  }
  const byName = new Map(target.members.map((member) => [member.name, member]));
  for (const [name, seam] of RECLASSIFIED) {
    assert.equal(byName.get(name)?.seam, seam,
      `${name}: the module body's seam on the port spelling is the named one`);
  }
});

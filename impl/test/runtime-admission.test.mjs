// runtime-admission.test.mjs — issue #259, slice 11. Verifies the coordinator's admission
// bucket (impl/src/runtime-admission.mjs) against the injected recorder port (slice 6) and the
// coordinator that delegates to it. Five claims:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither monolith, and every
//      `this` access in it belongs to the relocated classes; moved member bodies read the
//      coordinator through the explicit `coordinator` parameter and record through `recorder`.
//   2. SAME NAME, SAME ARITY, SAME PORT — every delegate the seam map shows as
//      `runtime_admission_port` keeps the member's own parameter list and hands the class's
//      recorder to the module function.
//   3. THE RECORDER IS THE ONLY RECORDING PATH — the bucket records through the port, and a
//      store constructed through the module function on a blank prototype behaves identically
//      to `new`.
//   4. THE PRIMITIVES MOVED ONCE — the relocated declarations are exported by the module; the
//      coordinator imports back exactly what staying code reads plus the re-exported names.
//   5. THE MAP SEES THE MOVE — the artifact carries the runtime-admission target, and every
//      class delegate keeps `admission`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as runtimeAdmission from '../src/runtime-admission.mjs';
import * as coordinatorModule from '../src/coordinator.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { collectSeamInventory } from '../scripts/seam-inventory.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/runtime-admission.mjs';
const COORD_FILE = 'impl/src/coordinator.mjs';
// E02 (#598): the map derives live from the collector — the committed artifact is gone.
const seamMap = () => collectSeamInventory();
const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const RELOCATED_CLASSES = Object.freeze(['DependencyCycleError', 'SupervisedProcesses']);

const IMPORTED_BACK = Object.freeze(['coachingError', 'resolveCardModel', 'SupervisedProcesses']);
const REEXPORTED = Object.freeze(['DependencyCycleError', 'SupervisedProcesses', 'guidanceSender']);

test('RA1: the module imports neither monolith and keeps no implicit receiver outside the relocated classes', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/coordinator\.mjs|application\.mjs/.test(source), `one-way import violated: ${source}`);
  }
  const thisSites = [];
  const walk = (node, owner) => {
    if (node.kind() === 'class_declaration' || node.kind() === 'function_declaration') {
      owner = node.field('name')?.text() ?? owner;
    }
    if (node.kind() === 'this') thisSites.push(owner);
    for (const child of node.children()) walk(child, owner);
  };
  walk(root, '(module scope)');
  const outside = thisSites.filter((owner) => !RELOCATED_CLASSES.includes(owner));
  assert.deepEqual(outside, [], 'moved bodies and helpers never read an implicit receiver');
});

test('RA2: every runtime_admission_port delegate keeps the member name, parameter list, arity, and hands over the recorder', () => {
  const map = seamMap();
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegated = coordinatorFile.members
    .filter((member) => member.evidence.includes('admission:runtime_admission_port'))
    .map((member) => member.name);
  assert.ok(delegated.length > 0, 'the map carries at least one admission delegate');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const memberParams = new Map();
  for (const fn of memberRoot.findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })) {
    const name = fn.field('name')?.text();
    if (name) memberParams.set(name, fn.field('parameters')?.text() ?? '()');
  }
  const coordRoot = parseOf(read(COORD_FILE));
  const cls = coordRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'Coordinator');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  const coordText = read(COORD_FILE);
  for (const name of delegated) {
    const method = byName.get(name);
    assert.ok(method, `${name}: the class must still declare it`);
    assert.ok(memberParams.has(name), `${name}: the module must export it`);
    const moduleOwn = memberParams.get(name)
      .replace(/^\(coordinator, recorder,?\s*/u, '(')
      .replace(/^\(coordinator,?\s*/u, '(')
      .replaceAll('coordinator.', 'this.');
    assert.equal(method.field('parameters')?.text() ?? '()', moduleOwn,
      `${name}: the delegate's parameter list must be the member's own (receiver spellings normalized)`);
    assert.ok(Object.getOwnPropertyDescriptor(Coordinator.prototype, name),
      `${name}: the class must still answer on ${name}`);
    if (name === 'constructor') {
      assert.ok(method.text().includes('runtimeAdmission.constructor(this, opts)'),
        'the constructor delegate hands (this, opts) — it composes the recorder, it does not receive it');
      assert.ok(!method.text().includes('return '), 'a constructor delegate returns nothing');
    } else {
      assert.ok(method.text().includes(`runtimeAdmission.${name}(this, this._recorder`),
        `${name}: the delegate must call the module function with (this, this._recorder, ...)`);
    }
  }
});

test('RA3: the recorder is the only recording path, and the constructor delegate is complete', async () => {
  const text = read(MEMBER_FILE);
  const codeOnly = parseOf(text)
    .findAll({ rule: { any: [{ kind: 'function_declaration' }, { kind: 'generator_function_declaration' }] } })
    .map((fn) => fn.text()).join('\n');
  assert.ok(codeOnly.includes('recorder.log.append('), 'the bucket uses recorder.log.append');
  assert.ok(codeOnly.includes('recorder.mapEvent('), 'the bucket uses recorder.mapEvent');
  assert.ok(codeOnly.includes('recorder.coordination'), 'the bucket uses recorder.coordination');
  assert.equal(codeOnly.includes('this._log.append('), false);
  assert.equal(codeOnly.includes('this._coordination?.'), false,
    'no moved body reads the store beside the port (assignments by the constructor excepted)');

  // The constructor delegate is complete: a blank prototype constructs identically to new.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Log } = await import('../src/log.mjs');
  const { FenceTable } = await import('../src/fence.mjs');
  const { coordinationForLog } = await import('../src/coordination-store.mjs');
  const optsOf = (dir) => {
    const log = new Log(join(dir, 'log'));
    return {
      log,
      coordination: coordinationForLog(log),
      fences: new FenceTable(),
      adapters: {},
      worktrees: null,
      capabilities: null,
      referee: async () => ({}),
      route: () => 'mock',
      now: () => 0,
      approvalTimeoutMs: 60000,
      stopDeadlineMs: 15000,
    };
  };
  const dirA = mkdtempSync(join(tmpdir(), 'baton-ra3-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'baton-ra3-b-'));
  try {
    const viaNew = new Coordinator(optsOf(dirA));
    const blank = Object.create(Coordinator.prototype);
    runtimeAdmission.constructor(blank, optsOf(dirB));
    assert.equal(typeof blank.spawn, 'function', 'the blank construct carries the prototype');
    assert.equal(blank._recorder !== null && typeof blank._recorder.log?.append, 'function',
      'the module-composed constructor builds the recorder port');
    assert.equal(blank._recorder.log, blank._log, 'the port fronts the log facade');
    assert.equal(blank._recorder.coordination, blank._coordination,
      'the port fronts the (proxied) coordination authority');
    assert.deepEqual(blank.list(), viaNew.list(), 'the constructed worker list is identical');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('RA4: the relocated declarations moved once; the export surface is unchanged', () => {
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
    assert.ok(Object.hasOwn(runtimeAdmission, name), `${name}: the module exports it`);
  }
  const importBack = coordText.match(/import \{[^}]*\} from '\.\/runtime-admission\.mjs';/gsu) ?? [];
  const names = importBack.flatMap((statement) => [...statement.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)/gu)]
    .map((m) => m[1])
    .filter((n) => !['import', 'from', 'runtime', 'admission', 'mjs'].includes(n)));
  for (const name of IMPORTED_BACK) {
    assert.ok(names.includes(name), `${name}: imported back (staying reads or the re-export)`);
  }
  assert.ok(coordText.includes("export { DependencyCycleError, SupervisedProcesses, guidanceSender } from './runtime-admission.mjs';"),
    'the coordinator re-exports the relocated export surface');
  for (const name of REEXPORTED) {
    assert.equal(coordinatorModule[name], runtimeAdmission[name],
      `${name}: coordinator.mjs resolves to the module's binding`);
  }
  // index.mjs never re-exported these three — the surface contract is coordinator.mjs's own.
});

test('RA5: the map sees the move', () => {
  const map = seamMap();
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact carries the runtime-admission target');
  const coordinatorFile = map.files.find((file) => file.file === COORD_FILE);
  const delegates = coordinatorFile.members.filter((member) => member.evidence.includes('admission:runtime_admission_port'));
  for (const member of delegates) {
    assert.equal(member.seam, 'admission', `${member.name}: the delegate keeps the admission seam`);
  }
});

test('RA6: slice 12 — the three tranche-2 admission prefixes are admission-seamed module members that never import effects', () => {
  const text = read(MEMBER_FILE);
  const root = parseOf(text);
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/runtime-effects\.mjs/u.test(source),
      `admission never imports effects — that direction is the cycle (slice-12 design §6): ${source}`);
  }
  const fns = new Map(root.findAll({ rule: { kind: 'function_declaration' } })
    .map((fn) => [fn.field('name')?.text(), fn]));
  const EXPECTED = {
    _admitRunStopTargets: '(coordinator, recorder, targetWorkerIds, actor, opts)',
    _admitIntegration: '(coordinator, handle, task, opts)',
    _admitDelivery: '(coordinator, recorder, handle, mode, opts)',
  };
  for (const [name, params] of Object.entries(EXPECTED)) {
    const fn = fns.get(name);
    assert.ok(fn, `${name}: the admission prefix lives in this module`);
    assert.equal(fn.field('parameters').text(), params, `${name}: the design's own signature`);
  }
  // All three prefixes are sync refusal chains. The run-stop startup-reconciliation WAIT stays
  // in the effect body at its verbatim position: an async admission prefix would adopt one
  // settlement hop (the slice-11 lesson), and phase91's P91-12 pins the exact hop count — a stop
  // must win against a preserved-successor delivery racing it.
  for (const name of Object.keys(EXPECTED)) {
    assert.ok(!fns.get(name).text().startsWith('async function'),
      `${name}: sync — no adopted-promise hop between admission and the act`);
  }
  // The prefixes classify admission on their own evidence.
  const map = seamMap();
  const byName = new Map(map.files.find((file) => file.file === MEMBER_FILE)
    .members.map((member) => [member.name, member]));
  for (const name of Object.keys(EXPECTED)) {
    assert.equal(byName.get(name)?.seam, 'admission', `${name}: the prefix keeps the admission seam`);
  }
  // The refusal throws keep their pre-move codes (the admission half of the no-behavior-change
  // law); the startup-reconciliation throw rides with the wait in the effect body.
  assert.ok(fns.get('_admitRunStopTargets').text().includes("'coordinator_run_stop_invalid'")
    && fns.get('_admitRunStopTargets').text().includes("'coordinator_closed'"),
  '_admitRunStopTargets throws the exact pre-move codes');
  for (const code of ['result_not_accepted', 'scratch_oracle_not_integrable', 'independent_oracle_required',
    'unsupported_strategy', 'integration_unavailable', 'worker_not_quiescent']) {
    assert.ok(fns.get('_admitIntegration').text().includes(`'${code}'`),
      `_admitIntegration throws ${code}`);
  }
});

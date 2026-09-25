// application-observation.test.mjs — issue #259, slice 15. Verifies the application's
// observation bucket (impl/src/application-observation.mjs) against the bare 'application'
// receiver and the BatonApplication class that delegates to it. Five claims:
//
//   1. ONE-WAY IMPORT, NO IMPLICIT RECEIVER — the module imports neither application.mjs nor
//      coordinator.mjs and contains no 'this' at all.
//   2. SAME NAME, SAME ARITY, SAME RECEIVER — every delegate the seam map shows as
//      observation:application_observation_port keeps the member's own parameter list on both
//      sides; the module function takes 'application' as a leading parameter.
//   3. THE READS ARE THE RECORDING — the bucket appends nothing and records through the driver
//      coordination face.
//   4. THE HELPERS MOVED ONCE — the relocated declarations are declared module-side; the host
//      imports back what its staying code reads and re-exports what external consumers need.
//   5. THE MAP SEES THE MOVE — the artifact carries the target and every moved delegate keeps
//      observation through the application_observation_port rule.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import * as applicationObservation from '../src/application-observation.mjs';
import { BatonApplication } from '../src/application.mjs';

const require = createRequire(import.meta.url);
const { Lang, parse } = require('@ast-grep/napi');

const MEMBER_FILE = 'impl/src/application-observation.mjs';
const HOST_FILE = 'impl/src/application.mjs';
const MAP_FILE = 'impl/scripts/seam-inventory.json';
const read = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');
const parseOf = (text) => parse(Lang.JavaScript, text).root();

const ASYNC = Object.freeze(["_goalPlanStatus","_historicalProfileView","_workflowRoundSummaries","_buildWorkflowView","_proposeContextMap","_proposeContextReduce","_proposeContextRetry","contextEval","contextPackageBranch","_activeWorkstream","_pagePreservedInspections"]);

const HOST_REEXPORTS = Object.freeze(["APPLICATION_RUN_TERMINAL_PHASES","MAX_SCRATCHPAD_VIEW_BYTES","MAX_SCRATCHPAD_VIEW_CACHE_KEYS","MAX_SCRATCHPAD_VIEW_ITEMS","PROVIDER_EXECUTION_SETTLED_PHASES","VERDICT_CORRECTIVE_TABLE","actionDoInputs","byteBoundedPage","goalPlanDispatchesPage","goalPlanReadAll","goalPlanRunPlansPage","projectContextPackageBranch","projectProgressClass","projectRouteAttestation","projectRunRouteEvidence","projectScratchpadView","projectVerdictSurface","semanticViewDigest"]);

test('AO1: the module imports neither monolith and contains no implicit receiver at all', () => {
  const root = parseOf(read(MEMBER_FILE));
  for (const node of root.findAll({ rule: { kind: 'import_statement' } })) {
    const source = node.field('source').text();
    assert.ok(!/application\.mjs|coordinator\.mjs/.test(source), 'one-way import violated: ' + source);
  }
  const thisNodes = root.findAll({ rule: { kind: 'this' } });
  assert.equal(thisNodes.length, 0, 'no moved body and no relocated helper reads an implicit receiver');
});

test('AO2: every observation_port delegate keeps the member name, parameter list, and arity', () => {
  const map = JSON.parse(read(MAP_FILE));
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  const delegated = hostFile.members
    .filter((member) => member.evidence.includes('observation:application_observation_port'))
    .map((member) => member.name);
  assert.ok(delegated.length > 0, 'the map carries at least one application observation delegate');

  const memberRoot = parseOf(read(MEMBER_FILE));
  const moduleFns = new Map();
  for (const fn of memberRoot.findAll({ rule: { kind: 'function_declaration' } })) {
    moduleFns.set(fn.field('name').text(), fn);
  }
  const hostText = read(HOST_FILE);
  const hostRoot = parseOf(hostText);
  const cls = hostRoot.findAll({ rule: { kind: 'class_declaration' } })
    .find((node) => node.field('name')?.text() === 'BatonApplication');
  const byName = new Map();
  for (const method of cls.field('body').children().filter((n) => n.kind() === 'method_definition')) {
    byName.set(method.field('name').text(), method);
  }
  for (const name of delegated) {
    const method = byName.get(name);
    const fn = moduleFns.get(name);
    assert.ok(fn, name + ': the module must declare it');
    const own = method.field('parameters')?.text() ?? '()';
    const inner = own.slice(1, -1).replace(/\bthis\b/gu, 'application');
    const expectedModuleParams = inner ? '(application, ' + inner + ')' : '(application)';
    assert.equal(fn.field('parameters')?.text() ?? '()', expectedModuleParams,
      name + ": the module function takes (application, ...) before the member's own parameters");
    const methodText = method.text();
    assert.ok(methodText.includes('applicationObservation.' + name + '(this'),
      name + ': the delegate must hand the application instance to the module function');
    assert.equal(methodText.startsWith('async '), ASYNC.includes(name),
      name + ': async shape must carry across the boundary exactly');
    const fnIsAsync = fn.children().some((c) => c.kind() === 'async');
    assert.equal(fnIsAsync, ASYNC.includes(name),
      name + ": the module function's async keyword matches the pre-move member");
  }
});

test('AO3: the bucket appends nothing and records through the driver coordination face', () => {
  const moduleText = read(MEMBER_FILE);
  assert.equal((moduleText.match(/\.append\(/gu) ?? []).length, 0,
    'the observation bucket appends nothing — no log, no ledger, anywhere in the module');
  assert.equal((moduleText.match(/mapEvent\(/gu) ?? []).length, 0,
    'no mapEvent spelling exists — the bucket never reached the coordinator recorder');
  assert.ok((moduleText.match(/recordDriver\(/gu) ?? []).length > 0,
    'the store recordDriver writes ride along through the same driver.coordination face');
  assert.ok((moduleText.match(/driver\??\.coordination/gu) ?? []).length > 0,
    'durable reads happen module-side through the driver coordination face');
});
test("AO4: the helpers moved once; the host imports back its staying readers and re-exports its consumers' names", () => {
  const moduleRoot = parseOf(read(MEMBER_FILE));
  const hostText = read(HOST_FILE);
  const relocated = [];
  for (const node of moduleRoot.findAll({ rule: { kind: 'export_statement' } })) {
    const decl = node.field('declaration');
    if (!decl) continue;
    const kind = decl.kind();
    if (kind === 'lexical_declaration') {
      for (const v of decl.children().filter((c) => c.kind() === 'variable_declarator')) {
        const n = v.field('name')?.text();
        if (n) relocated.push(n);
      }
    } else if (kind === 'class_declaration') {
      const n = decl.field('name')?.text();
      if (n) relocated.push(n);
    }
  }
  assert.ok(relocated.length > 0, 'the module carries relocated declarations');
  for (const name of relocated) {
    assert.ok(Object.hasOwn(applicationObservation, name), name + ': the module exports it');
  }
  const hostBackImport = hostText.match(/import \{([^}]*)\} from '\.\/application-observation\.mjs';/us);
  assert.ok(hostBackImport, 'the host must import the back-names from the module');
  const backNames = hostBackImport[1].split(',').map((s) => s.trim().replace(/,$/u, '')).filter(Boolean);
  for (const name of HOST_REEXPORTS) {
    assert.ok(backNames.includes(name), name + ': the re-exported name is imported back');
  }
  const hostReexport = hostText.match(/export \{([^}]*)\};/us);
  assert.ok(hostReexport, 'the host must re-export the consumer-facing names');
  const reexportNames = hostReexport[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(reexportNames.sort(), [...HOST_REEXPORTS].sort(), 'the re-export list is exactly the external surface');
});

test('AO5: the map sees the move — a new target, the host unchanged, every delegate on the port rule', () => {
  const map = JSON.parse(read(MAP_FILE));
  const target = map.files.find((file) => file.file === MEMBER_FILE);
  assert.ok(target, 'the committed artifact must carry the application-observation target');
  const hostFile = map.files.find((file) => file.file === HOST_FILE);
  const delegateNames = new Set(hostFile.members
    .filter((m) => m.evidence.includes('observation:application_observation_port'))
    .map((m) => m.name));
  assert.ok(delegateNames.size > 0, 'the map carries observation delegates');
  for (const name of delegateNames) {
    const member = hostFile.members.find((m) => m.name === name);
    assert.ok(member.evidence.includes('observation:application_observation_port'),
      name + ': the delegate reads on the port rule');
  }
});

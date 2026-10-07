// Native Bend2 provider declaration contract. Verifies the declaration and its
// schema assets are complete, identity-bound to their bytes, and truthful
// about implemented capabilities only: no proof or deploy projections, no
// worktree writes, refusal channels enumerated from the implemented taxonomy.
// The package inventory the declaration points at lives with the helper-owned
// native line; this suite checks the rule shape against fixtures, while the
// helper checks the production inventory bytes at staging and launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(HERE, 'native-provider.declaration.json');
const SCHEMA_DIR = join(HERE, 'native-schemas', 'sourceAnalysis');
const FIXTURE_DIR = join(HERE, 'native-fixtures');

const TOP_MEMBERS = ['schema', 'moduleId', 'revision', 'protocolVersion', 'entry',
  'artifactIdentities', 'schemaIdentities', 'runtime', 'readiness',
  'packageIdentity', 'dependencies', 'applicability', 'operations', 'refusalChannels'];
const OPERATION_MEMBERS = ['operation', 'implements', 'subjectSchema', 'optionsSchema',
  'projections', 'effects', 'execution', 'resultSchema', 'referenceSchema',
  'eventSchema', 'lifetimeProfile', 'dependencies'];
const EFFECT_VERBS = ['capture-read', 'package-read', 'temp-materialize', 'git-read'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The completeness rule for a selectable declaration: every contract member
// present, the single implemented operation fully described, no empty capability.
function checkDeclaration(doc) {
  const missing = [];
  for (const member of TOP_MEMBERS) {
    if (doc[member] === undefined || doc[member] === null) missing.push(member);
  }
  const operations = Array.isArray(doc.operations) ? doc.operations : [];
  const sourceAnalysis = operations.find((entry) => entry?.operation === 'sourceAnalysis');
  if (sourceAnalysis === undefined) {
    missing.push('operations[sourceAnalysis]');
  } else {
    for (const member of OPERATION_MEMBERS) {
      const value = sourceAnalysis[member];
      if (value === undefined || value === null
        || (Array.isArray(value) && value.length === 0)) missing.push(`operations.sourceAnalysis.${member}`);
    }
  }
  return missing;
}

function identityOf(doc, record) {
  const bytes = readFileSync(join(HERE, record.path));
  return bytes.length === record.bytes && sha256(bytes) === record.sha256
    && typeof record.name === 'string' && record.name.length > 0;
}

test('the declaration is complete and names only the implemented operation', () => {
  const doc = readJson(DECLARATION_PATH);
  assert.deepEqual(checkDeclaration(doc), []);
  assert.equal(doc.schema, 'baton2-native-module-declaration-v1');
  assert.equal(doc.moduleId, 'bend2');
  assert.equal(doc.protocolVersion, '2');
  assert.equal(doc.operations.length, 1);
});

test('every schema identity is bound to its asset bytes', () => {
  const doc = readJson(DECLARATION_PATH);
  const operation = doc.operations.find((entry) => entry?.operation === 'sourceAnalysis');
  for (const facet of ['subjectSchema', 'optionsSchema', 'resultSchema', 'referenceSchema', 'eventSchema']) {
    assert.equal(identityOf(doc, operation[facet]), true, facet);
  }
  assert.equal(operation.resultSchema.name, 'baton2.context.bend2.source-analysis.result.v1');
  assert.equal(operation.eventSchema.name, 'baton2.context.bend2.source-analysis.event.v1');
});

test('projections exclude proof and deploy claims and effects stay read-only', () => {
  const doc = readJson(DECLARATION_PATH);
  const operation = doc.operations.find((entry) => entry?.operation === 'sourceAnalysis');
  assert.equal(operation.projections.requestSelected, false);
  assert.ok(operation.projections.delivered.length > 0);
  assert.match(operation.projections.disclaimer, /no proved-law claim is made here/);
  assert.match(operation.projections.disclaimer, /remain unqualified/);
  assert.ok(operation.effects.length > 0);
  for (const effect of operation.effects) {
    assert.ok(EFFECT_VERBS.includes(effect.verb), effect.verb);
    assert.equal(typeof effect.writesScope, 'string');
  }
  const effectsText = JSON.stringify(operation.effects);
  assert.doesNotMatch(effectsText, /network/);
  assert.doesNotMatch(effectsText, /persist/);
});

test('refusal channels enumerate the implemented taxonomy', () => {
  const doc = readJson(DECLARATION_PATH);
  const channels = doc.refusalChannels;
  let total = 0;
  for (const layer of ['envelope', 'package', 'payload']) {
    assert.ok(Array.isArray(channels[layer]) && channels[layer].length > 0, layer);
    for (const reason of channels[layer]) assert.equal(typeof reason, 'string');
    total += channels[layer].length;
  }
  assert.equal(total, 37);
  assert.ok(channels.payload.includes('moduleBindingDoesNotNameSelectedPayload'));
  assert.ok(channels.payload.includes('sourceTargetUnavailable'));
});

test('an incomplete declaration fails the completeness rule', () => {
  const doc = readJson(join(FIXTURE_DIR, 'declaration', 'missing-operation.json'));
  assert.deepEqual(checkDeclaration(doc), ['revision', 'protocolVersion', 'entry',
    'artifactIdentities', 'schemaIdentities', 'runtime', 'readiness',
    'packageIdentity', 'dependencies', 'applicability', 'operations',
    'refusalChannels', 'operations[sourceAnalysis]']);
});

test('a tampered schema asset fails its identity', () => {
  const doc = readJson(DECLARATION_PATH);
  const operation = doc.operations.find((entry) => entry?.operation === 'sourceAnalysis');
  const dir = mkdtempSync(join(tmpdir(), 'baton2-declaration-tamper-'));
  try {
    const original = readFileSync(join(HERE, operation.subjectSchema.path), 'utf8');
    const absolute = join(dir, 'subject.request.json');
    writeFileSync(absolute, `${original} `);
    const bytes = readFileSync(absolute);
    assert.equal(bytes.length === operation.subjectSchema.bytes
      && sha256(bytes) === operation.subjectSchema.sha256, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the inventory rule accepts matching bytes and rejects a digest mismatch', () => {
  const dir = join(FIXTURE_DIR, 'inventory');
  const inventory = readJson(join(dir, 'selected-module.sample.json'));
  assert.equal(inventory.moduleId, 'bend2');
  for (const row of inventory.files) {
    const bytes = readFileSync(join(dir, row.path));
    assert.equal(bytes.length, row.bytes);
    assert.equal(sha256(bytes), row.sha256);
  }
  const staging = mkdtempSync(join(tmpdir(), 'baton2-inventory-tamper-'));
  try {
    writeFileSync(join(staging, 'payload-a.txt'), 'alpha tampered\n');
    const bytes = readFileSync(join(staging, 'payload-a.txt'));
    assert.notEqual(sha256(bytes), inventory.files[0].sha256);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});

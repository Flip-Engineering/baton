// Native provider declaration contract: the admission-bound document for the
// TypeScript provider behind the v1-to-v2 bridge, and its SchemaDef assets.
//
// Authorities (read-only; nothing below restates them as my own claim):
//   engines-decl.bend   Decl/Op/Art/Entry/Rule member shapes, refusal set,
//                       decl_version "1", protocol_version "2"
//   engines-wire.bend   artifact rows {packagePath, sha256, role}, binding echo
//   codec-schema.bend   SchemaDef/SchemaForm closed constructor vocabulary
//   provider-declaration.mjs (this lane, worker-authored, reviewed, merged)
//                       module id, revision, closure, operations, projections,
//                       effects, execution token, applicability, named holes
//   lib/protocol.mjs, lib/query.mjs, lib/refs.mjs
//                       the v1 request/result/refusal shapes the assets mirror,
//                       via the reviewed JSON-Schema docs in schemas/
//   catalogs/provider-declaration.mjs (authoritative tree precedent)
//                       artifact sha256 is computed at packaging and is not a
//                       value the authored declaration holds; schema names
//                       follow baton2.context.<thing>.v1
//
// What this suite checks: the declaration carries exactly the decoder's
// members with conforming values; every asset is vocabulary-exact SchemaDef;
// every SfRef resolves inside the declared identity set; the operation table
// matches the worker record; packaging-owned values stay explicitly unheld
// (null digests, null package identity, empty argv) so admission refuses
// them by name instead of admitting an invented value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_DECLARATION as WORKER_RECORD } from '../typescript/provider-declaration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(HERE, 'native-provider.declaration.json');
const SCHEMA_DIR = join(HERE, 'native-schemas');
const DOC_DIR = join(HERE, '..', 'typescript', 'schemas');

const TOP_MEMBERS = ['schema', 'moduleId', 'revision', 'protocolVersion',
  'packageIdentity', 'entry', 'artifactIdentities', 'dependencies',
  'schemaIdentities', 'applicability', 'operations'];
const OPERATION_MEMBERS = ['schema', 'operation', 'implements', 'subjectSchema',
  'optionsSchema', 'projections', 'effects', 'execution', 'resultSchema',
  'referenceSchema', 'eventSchema', 'lifetimeProfile', 'dependencies'];
const OPERATION_SCHEMA = 'baton2-native-operation-v1';
const EXECUTION_TOKENS = ['pure', 'direct', 'managed', 'runtime'];
const RULE_KINDS = ['path', 'manifest', 'subject', 'projection'];

const IDENTITY_FILES = {
  'baton2.context.typescript.subject.v1': 'subject.request.json',
  'baton2.context.typescript.options.sourceAnalysis.v1': 'options.sourceAnalysis.json',
  'baton2.context.typescript.options.sqlPlan.v1': 'options.sqlPlan.json',
  'baton2.context.typescript.result.v1': 'result.frame.json',
  'baton2.context.typescript.reference.v1': 'reference.record.json',
  'baton2.context.typescript.event.v1': 'event.refusal-frame.json',
};
// Reviewed doc each asset mirrors (manifest.mjs sharedAs: subject, result,
// reference and event are byte-identical across operations).
const IDENTITY_DOCS = {
  'baton2.context.typescript.subject.v1': 'sourceAnalysis/subject.request.json',
  'baton2.context.typescript.options.sourceAnalysis.v1': 'sourceAnalysis/options.request.json',
  'baton2.context.typescript.options.sqlPlan.v1': 'sqlPlan/options.request.json',
  'baton2.context.typescript.result.v1': 'sourceAnalysis/result.frame.json',
  'baton2.context.typescript.reference.v1': 'sourceAnalysis/reference.json',
  'baton2.context.typescript.event.v1': 'sourceAnalysis/event.refusal-frame.json',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// The NativeDeclaration.decode member contract: every required member
// present with a conforming value. Returns a refusal code or null.
function checkDeclarationShape(doc) {
  if (!isRecord(doc)) return 'declarationMissing';
  for (const member of TOP_MEMBERS) {
    if (!(member in doc)) return `missingTopMember:${member}`;
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_MEMBERS.includes(key)) return `unknownTopMember:${key}`;
  }
  if (doc.schema !== '1') return 'unsupportedDeclarationVersion';
  if (doc.protocolVersion !== '2') return 'unsupportedProtocolVersion';
  if (typeof doc.moduleId !== 'string' || doc.moduleId.length === 0) return 'emptyModuleId';
  if (typeof doc.revision !== 'string' || doc.revision.length === 0) return 'emptyRevision';
  // packageIdentity is packaging-owned: null stays an explicit refusal, a
  // name here would be a fabricated byte-bound identity.
  if (doc.packageIdentity !== null && typeof doc.packageIdentity !== 'string') {
    return 'packageIdentityMalformed';
  }
  const entry = doc.entry;
  if (!isRecord(entry)) return 'entryMissing';
  const entryRefusal = checkArtifactRow(entry.artifact);
  if (entryRefusal !== null) return `entryArtifact:${entryRefusal}`;
  // The launch vector belongs to the deployment owner (worker record hole
  // invocationVectorUnadmitted): an empty vector refuses as DrEmptyEntryVector.
  if (!Array.isArray(entry.argv) || !entry.argv.every((arg) => typeof arg === 'string')) {
    return 'entryArgvMalformed';
  }
  if (!Array.isArray(doc.artifactIdentities)) return 'artifactIdentitiesMalformed';
  for (const [index, row] of doc.artifactIdentities.entries()) {
    const refusal = checkArtifactRow(row);
    if (refusal !== null) return `artifactIdentities[${index}]:${refusal}`;
  }
  if (!Array.isArray(doc.dependencies)) return 'dependenciesMalformed';
  for (const [index, row] of doc.dependencies.entries()) {
    const refusal = checkArtifactRow(row);
    if (refusal !== null) return `dependencies[${index}]:${refusal}`;
  }
  if (!isStringArray(doc.schemaIdentities)) return 'schemaIdentitiesMalformed';
  if (!Array.isArray(doc.applicability)) return 'applicabilityMalformed';
  for (const [index, rule] of doc.applicability.entries()) {
    if (!isRecord(rule) || typeof rule.kind !== 'string' || typeof rule.value !== 'string') {
      return `applicability[${index}]Malformed`;
    }
    if (!RULE_KINDS.includes(rule.kind)) return `applicability[${index}]UnknownKind`;
  }
  if (!Array.isArray(doc.operations) || doc.operations.length === 0) return 'operationsMissing';
  for (const [index, op] of doc.operations.entries()) {
    const refusal = checkOperationShape(op);
    if (refusal !== null) return `operations[${index}]:${refusal}`;
  }
  return null;
}

function checkArtifactRow(row) {
  if (!isRecord(row)) return 'rowMissing';
  if (typeof row.packagePath !== 'string' || row.packagePath.length === 0) return 'rowPathEmpty';
  // Digests are computed at packaging (catalog precedent): null stays
  // explicitly unheld here; a non-null value must be a sha256 hex digest.
  if (row.sha256 !== null && !/^[0-9a-f]{64}$/.test(row.sha256)) return 'rowDigestMalformed';
  if (typeof row.role !== 'string' || row.role.length === 0) return 'rowRoleEmpty';
  return null;
}

function checkOperationShape(op) {
  if (!isRecord(op)) return 'operationMissing';
  for (const member of OPERATION_MEMBERS) {
    if (!(member in op)) return `missingOperationMember:${member}`;
  }
  for (const key of Object.keys(op)) {
    if (!OPERATION_MEMBERS.includes(key)) return `unknownOperationMember:${key}`;
  }
  if (op.schema !== OPERATION_SCHEMA) return 'unsupportedOperationSchema';
  if (typeof op.operation !== 'string' || op.operation.length === 0) return 'emptyOperationId';
  if (typeof op.implements !== 'string' || op.implements.length === 0) return 'emptyImplements';
  for (const member of ['subjectSchema', 'optionsSchema', 'resultSchema', 'referenceSchema', 'eventSchema']) {
    if (typeof op[member] !== 'string' || op[member].length === 0) return `emptySchema:${member}`;
  }
  if (!isStringArray(op.projections)) return 'projectionsMalformed';
  if (!isStringArray(op.effects)) return 'effectsMalformed';
  if (!EXECUTION_TOKENS.includes(op.execution)) return 'unknownExecutionToken';
  if (typeof op.lifetimeProfile !== 'string') return 'lifetimeProfileMalformed';
  if (!Array.isArray(op.dependencies)) return 'operationDependenciesMalformed';
  for (const [index, edge] of op.dependencies.entries()) {
    if (!isRecord(edge) || typeof edge.moduleId !== 'string' || typeof edge.declarationDigest !== 'string' ||
        typeof edge.operation !== 'string') {
      return `operationDependencies[${index}]Malformed`;
    }
  }
  return null;
}

// The codec-schema.bend closed vocabulary, as the constructor-keyed JSON
// encoding the assets use: one constructor per node with exactly the members
// the Bend type declares. Returns a refusal code or null.
function checkForm(form, path) {
  if (!isRecord(form)) return `${path}:formMissing`;
  const keys = Object.keys(form);
  if (keys.length !== 1) return `${path}:formNotSingleConstructor`;
  const [tag] = keys;
  const body = form[tag];
  switch (tag) {
    case 'SfRecord': {
      if (!isRecord(body) || !Array.isArray(body.fields)) return `${path}:recordMalformed`;
      for (const [index, field] of body.fields.entries()) {
        const refusal = checkField(field, `${path}.fields[${index}]`);
        if (refusal !== null) return refusal;
      }
      return null;
    }
    case 'SfUnion': {
      if (!isRecord(body) || !Array.isArray(body.cases)) return `${path}:unionMalformed`;
      for (const [index, kase] of body.cases.entries()) {
        if (!isRecord(kase) || typeof kase.tag !== 'string' || !isRecord(kase.form)) {
          return `${path}.cases[${index}]:caseMalformed`;
        }
        const refusal = checkForm(kase.form, `${path}.cases[${index}]`);
        if (refusal !== null) return refusal;
      }
      return null;
    }
    case 'SfArray': {
      if (!isRecord(body)) return `${path}:arrayMalformed`;
      return checkForm(body.item, `${path}.item`);
    }
    case 'SfEnum': {
      if (!isRecord(body) || !isStringArray(body.literals)) return `${path}:enumMalformed`;
      return null;
    }
    case 'SfOptional': {
      if (!isRecord(body)) return `${path}:optionalMalformed`;
      return checkForm(body.inner, `${path}.inner`);
    }
    case 'SfDict': {
      if (!isRecord(body)) return `${path}:dictMalformed`;
      const keysRefusal = checkKeys(body.keys, `${path}.keys`);
      if (keysRefusal !== null) return keysRefusal;
      return checkForm(body.value, `${path}.value`);
    }
    case 'SfRef': {
      if (!isRecord(body) || typeof body.name !== 'string') return `${path}:refMalformed`;
      return null;
    }
    case 'SfScalar': {
      if (!isRecord(body)) return `${path}:scalarMalformed`;
      if (!['SsText', 'SsU32Token', 'SsNumberToken', 'SsBool', 'SsNull'].includes(body.kind)) {
        return `${path}:unknownScalar`;
      }
      return null;
    }
    case 'SfJson':
      return isRecord(body) ? null : `${path}:jsonMalformed`;
    default:
      return `${path}:unknownConstructor:${tag}`;
  }
}

function checkKeys(keys, path) {
  if (!isRecord(keys)) return `${path}:keysMissing`;
  const entries = Object.keys(keys);
  if (entries.length !== 1) return `${path}:keysNotSingleConstructor`;
  if (entries[0] === 'SkDeclared') {
    return isStringArray(keys.SkDeclared.names) ? null : `${path}:declaredNamesMalformed`;
  }
  if (entries[0] === 'SkAnyScalarText') return isRecord(keys.SkAnyScalarText) ? null : `${path}:anyKeysMalformed`;
  return `${path}:unknownKeys:${entries[0]}`;
}

function checkField(field, path) {
  if (!isRecord(field)) return `${path}:fieldMissing`;
  const entries = Object.keys(field);
  if (entries.length !== 1) return `${path}:fieldNotSingleConstructor`;
  if (entries[0] === 'SfRequired' || entries[0] === 'SfOptionalField') {
    const body = field[entries[0]];
    if (!isRecord(body) || typeof body.name !== 'string' || body.name.length === 0) {
      return `${path}:fieldNameMalformed`;
    }
    return checkForm(body.form, `${path}.${body.name}`);
  }
  return `${path}:unknownField:${entries[0]}`;
}

function checkAsset(asset, path) {
  if (!isRecord(asset)) return `${path}:assetMissing`;
  if (Object.keys(asset).length !== 1 || !isRecord(asset.SchemaDef)) return `${path}:assetNotSingleDef`;
  const def = asset.SchemaDef;
  if (typeof def.name !== 'string' || def.name.length === 0) return `${path}:defNameEmpty`;
  return checkForm(def.form, path);
}

function collectRefs(form, into) {
  if (!isRecord(form)) return;
  const [tag] = Object.keys(form);
  const body = form[tag];
  if (tag === 'SfRef') {
    into.push(body.name);
    return;
  }
  if (tag === 'SfRecord') {
    for (const field of body.fields) {
      const entry = field.SfRequired ?? field.SfOptionalField;
      if (isRecord(entry)) collectRefs(entry.form, into);
    }
  } else if (tag === 'SfUnion') {
    for (const kase of body.cases) collectRefs(kase.form, into);
  } else if (tag === 'SfArray') {
    collectRefs(body.item, into);
  } else if (tag === 'SfOptional') {
    collectRefs(body.inner, into);
  } else if (tag === 'SfDict') {
    collectRefs(body.value, into);
  }
}

function requiredNames(form) {
  const [tag] = Object.keys(form);
  if (tag !== 'SfRecord') return null;
  return form.SfRecord.fields
    .filter((field) => isRecord(field.SfRequired))
    .map((field) => field.SfRequired.name);
}

function loadDeclaration() {
  return readJson(DECLARATION_PATH);
}

function loadAsset(identity) {
  return readJson(join(SCHEMA_DIR, IDENTITY_FILES[identity]));
}

test('declaration carries exactly the decoder member contract', () => {
  const doc = loadDeclaration();
  assert.equal(checkDeclarationShape(doc), null);
  assert.equal(doc.schema, '1');
  assert.equal(doc.protocolVersion, '2');
  assert.equal(doc.operations.length, 2);
  for (const op of doc.operations) {
    assert.equal(op.schema, OPERATION_SCHEMA);
  }
});

test('declaration checker refuses malformed candidates', () => {
  const base = loadDeclaration();
  const withoutSchema = structuredClone(base);
  delete withoutSchema.operations[0].schema;
  assert.match(checkDeclarationShape(withoutSchema), /missingOperationMember:schema/);
  const badToken = structuredClone(base);
  badToken.operations[1].execution = 'background';
  assert.match(checkDeclarationShape(badToken), /unknownExecutionToken/);
  const badKind = structuredClone(base);
  badKind.applicability.push({ kind: 'owner', value: 'x' });
  assert.match(checkDeclarationShape(badKind), /UnknownKind/);
  const badRow = structuredClone(base);
  delete badRow.dependencies[0].role;
  assert.match(checkDeclarationShape(badRow), /rowRoleEmpty/);
  const badDigest = structuredClone(base);
  badDigest.artifactIdentities[0].sha256 = 'not-a-digest';
  assert.match(checkDeclarationShape(badDigest), /rowDigestMalformed/);
  const extra = structuredClone(base);
  extra.readiness = 'ready';
  assert.match(checkDeclarationShape(extra), /unknownTopMember:readiness/);
});

test('packaging-owned values stay explicitly unheld', () => {
  const doc = loadDeclaration();
  // The staged package identity is byte-bound at packaging; a name here
  // would be a fabricated null-to-string replacement.
  assert.equal(doc.packageIdentity, null);
  for (const row of doc.artifactIdentities) {
    assert.equal(row.sha256, null);
  }
  for (const row of doc.dependencies) {
    assert.equal(row.sha256, null);
  }
  // The launch vector belongs to the deployment owner: an empty vector
  // refuses as DrEmptyEntryVector instead of admitting an invented argv.
  assert.deepEqual(doc.entry.argv, []);
});

test('operation table matches the worker-authored provider record', () => {
  const doc = loadDeclaration();
  assert.equal(doc.moduleId, WORKER_RECORD.id);
  assert.equal(doc.revision, WORKER_RECORD.revision);
  const workerPaths = new Map(
    WORKER_RECORD.artifacts.map((row) => [row.path, row.role]),
  );
  const declaredPaths = new Map([
    [doc.entry.artifact.packagePath, doc.entry.artifact.role],
    ...doc.dependencies.map((row) => [row.packagePath, row.role]),
  ]);
  assert.deepEqual([...declaredPaths.entries()], [...workerPaths.entries()]);
  assert.equal(doc.operations.length, WORKER_RECORD.operations.length);
  for (const [index, op] of doc.operations.entries()) {
    const workerOp = WORKER_RECORD.operations[index];
    assert.equal(op.operation, workerOp.id);
    assert.equal(op.implements, workerOp.id);
    assert.deepEqual(op.projections, workerOp.projections);
    assert.deepEqual(op.effects, workerOp.effects);
    assert.equal(op.execution, workerOp.execution);
    assert.equal(op.lifetimeProfile, workerOp.lifetimeProfile);
  }
  assert.deepEqual(
    doc.applicability,
    WORKER_RECORD.applicability.map((rule) => ({ kind: rule.kind, value: rule.value })),
  );
});

test('every asset is vocabulary-exact SchemaDef and every ref resolves', () => {
  const doc = loadDeclaration();
  const identities = new Set(Object.keys(IDENTITY_FILES));
  assert.deepEqual([...new Set(doc.schemaIdentities)].sort(), [...identities].sort());
  for (const identity of identities) {
    const asset = loadAsset(identity);
    assert.equal(checkAsset(asset, identity), null);
    assert.equal(asset.SchemaDef.name, identity);
  }
  const refs = [];
  for (const identity of identities) {
    collectRefs(loadAsset(identity).SchemaDef.form, refs);
  }
  for (const target of refs) {
    assert.ok(identities.has(target), `unresolved schema ref ${target}`);
  }
  const schemasOf = (op) => [op.subjectSchema, op.optionsSchema, op.resultSchema,
    op.referenceSchema, op.eventSchema];
  assert.deepEqual([...new Set(schemasOf(doc.operations[0]))].sort(), [
    'baton2.context.typescript.event.v1',
    'baton2.context.typescript.options.sourceAnalysis.v1',
    'baton2.context.typescript.reference.v1',
    'baton2.context.typescript.result.v1',
    'baton2.context.typescript.subject.v1',
  ]);
  assert.deepEqual([...new Set(schemasOf(doc.operations[1]))].sort(), [
    'baton2.context.typescript.event.v1',
    'baton2.context.typescript.options.sqlPlan.v1',
    'baton2.context.typescript.reference.v1',
    'baton2.context.typescript.result.v1',
    'baton2.context.typescript.subject.v1',
  ]);
  for (const op of doc.operations) {
    for (const identity of schemasOf(op)) {
      assert.ok(identities.has(identity), `operation names undeclared schema ${identity}`);
    }
  }
});

test('asset checker refuses non-vocabulary nodes', () => {
  const asset = loadAsset('baton2.context.typescript.event.v1');
  assert.equal(checkAsset(asset, 'event'), null);
  const bad = structuredClone(asset);
  bad.SchemaDef.form.SfRecord.fields[0].SfRequired.form = { SfText: {} };
  assert.match(checkAsset(bad, 'event'), /unknownConstructor:SfText/);
  const two = structuredClone(asset);
  two.SchemaDef.form = { SfRecord: { fields: [] }, SfJson: {} };
  assert.match(checkAsset(two, 'event'), /formNotSingleConstructor/);
});

test('assets cover the reviewed docs required members', () => {
  const docRequired = (relative) => {
    const doc = readJson(join(DOC_DIR, relative));
    if (doc.required === undefined) return { branches: [[]] };
    if (Array.isArray(doc.required)) return { branches: [doc.required] };
    if (Array.isArray(doc.oneOf)) {
      return {
        branches: doc.oneOf.map((branch) => branch.required ?? []),
        tags: doc.oneOf.map((branch) => branch.properties?.kind?.const),
      };
    }
    throw new Error(`unexpected doc shape ${relative}`);
  };
  for (const [identity, relative] of Object.entries(IDENTITY_DOCS)) {
    const asset = loadAsset(identity);
    const { branches, tags } = docRequired(relative);
    const form = asset.SchemaDef.form;
    if (tags !== undefined) {
      const [unionTag] = Object.keys(form);
      assert.equal(unionTag, 'SfUnion');
      const caseByTag = new Map(form.SfUnion.cases.map((kase) => [kase.tag, kase.form]));
      assert.deepEqual([...caseByTag.keys()].sort(), [...tags].sort());
      for (const [index, required] of branches.entries()) {
        const names = requiredNames(caseByTag.get(tags[index]));
        for (const member of required) {
          assert.ok(names.includes(member), `${identity} case ${tags[index]} drops ${member}`);
        }
      }
    } else {
      const names = requiredNames(form);
      assert.ok(names !== null, `${identity} is not a closed record`);
      for (const member of branches[0]) {
        assert.ok(names.includes(member), `${identity} drops required ${member}`);
      }
    }
  }
});



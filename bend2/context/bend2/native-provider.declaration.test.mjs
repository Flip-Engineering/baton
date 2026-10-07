// Bend2 native provider declaration contract: the admission-bound document
// for the packaged Bend2 sourceAnalysis provider behind the v1-to-v2 bridge,
// and its SchemaDef assets.
//
// Authorities (read-only; nothing below restates them as my own claim):
//   native-declaration.bend (helper pin 495ec1f5)  the decode contract: top
//                       schema literal, nonempty module/revision/identity,
//                       protocol 2, valid artifact rows, nonempty operations
//                       with the operation schema literal, string-array
//                       projections/effects, one execution token, five
//                       nonempty schema identities, array dependencies and
//                       applicability, nonempty entry artifact plus argv array
//   selected-module.json (helper pin 495ec1f5)     the twelve staged artifact
//                       rows with their actual byte digests, module bend2,
//                       protocol 2, upstream pin a495
//   native-provider.mjs (helper pin 495ec1f5)      invocation/result/event
//                       frame shapes, binding match, refusal vocabulary
//   codec-wire.bend / engines-wire.bend            v2 event envelope and
//                       binding echo member shapes
//   request.bend        v2 request subject/options shapes
//   codec-schema.bend   SchemaDef/SchemaForm closed constructor vocabulary
//
// What this suite checks: the declaration satisfies every decode validity
// rule; the package identity is the documented byte-bound derivation; every
// asset is vocabulary-exact SchemaDef with resolving refs; the operation
// carries the exact delivered projections and the empty admitted effects.
// Byte equality of the rows against staged bytes is the remote gate's check:
// this tree does not stage the package, so the suite pins shapes, formats
// and the documented identity instead of rehashing absent files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = join(HERE, 'native-provider.declaration.json');
const SCHEMA_DIR = join(HERE, 'native-schemas');

const DECLARATION_SCHEMA = 'baton2-native-module-declaration-v1';
const OPERATION_SCHEMA = 'baton2-native-operation-v1';
const EXECUTION_TOKENS = ['pure', 'direct', 'managed', 'runtime'];
const RULE_KINDS = ['path', 'manifest', 'subject', 'projection'];
const HEX64 = /^[0-9a-f]{64}$/;

// sha256 over the concatenation of the twelve staged artifact bytes in
// artifactIdentities order, verified against the selected-module.json rows
// at helper pin 495ec1f5. Recompute from staged bytes on any package change.
const PACKAGE_IDENTITY = 'sha256:069ea8280360ea62c9d6e9a95635765b4db50ae8195d93fbb61963a8d6835ceb';

const ARTIFACT_PATHS = ['native-provider.mjs', 'worktree-capture.mjs',
  'frontend-adapter.mjs', 'frontend-hook-events.mjs', 'frontend-hooks.mjs',
  'frontend-invocation.mjs', 'source-binding.mjs', 'upstream/base.bend',
  'upstream/bend.ts', 'upstream/comp.ts', 'upstream/main.ts', 'upstream/LICENSE'];

const IDENTITY_FILES = {
  'baton2.context.bend2.source-analysis.subject.v1': 'subject.request.json',
  'baton2.context.bend2.source-analysis.options.v1': 'options.request.json',
  'baton2.context.bend2.source-analysis.result.v1': 'result.frame.json',
  'baton2.context.bend2.source-analysis.reference.v1': 'reference.record.json',
  'baton2.context.bend2.source-analysis.event.v1': 'event.envelope.json',
};

const OPERATION_SCHEMAS = {
  subjectSchema: 'baton2.context.bend2.source-analysis.subject.v1',
  optionsSchema: 'baton2.context.bend2.source-analysis.options.v1',
  resultSchema: 'baton2.context.bend2.source-analysis.result.v1',
  referenceSchema: 'baton2.context.bend2.source-analysis.reference.v1',
  eventSchema: 'baton2.context.bend2.source-analysis.event.v1',
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

function nonemptyText(value) {
  return typeof value === 'string' && value.length > 0;
}

// Mirrors declaration_fields_valid plus the per-operation field rules: every
// decode validity condition, returning a refusal code or null.
function checkDeclarationShape(doc) {
  if (!isRecord(doc)) return 'declarationMissing';
  if (doc.schema !== DECLARATION_SCHEMA) return 'unsupportedDeclarationSchema';
  if (!nonemptyText(doc.moduleId)) return 'emptyModuleId';
  if (!nonemptyText(doc.revision)) return 'emptyRevision';
  if (!nonemptyText(doc.packageIdentity)) return 'emptyPackageIdentity';
  if (doc.protocolVersion !== '2') return 'unsupportedProtocolVersion';
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
  if (!Array.isArray(doc.schemaIdentities)) return 'schemaIdentitiesMalformed';
  if (!Array.isArray(doc.operations) || doc.operations.length === 0) return 'operationsMissing';
  for (const [index, op] of doc.operations.entries()) {
    const refusal = checkOperationShape(op);
    if (refusal !== null) return `operations[${index}]:${refusal}`;
  }
  if (!Array.isArray(doc.applicability)) return 'applicabilityMalformed';
  for (const [index, rule] of doc.applicability.entries()) {
    if (!isRecord(rule) || typeof rule.kind !== 'string' || typeof rule.value !== 'string') {
      return `applicability[${index}]Malformed`;
    }
    if (!RULE_KINDS.includes(rule.kind)) return `applicability[${index}]UnknownKind`;
  }
  if (!isRecord(doc.entry)) return 'entryMissing';
  if (!nonemptyText(doc.entry.artifact)) return 'entryArtifactEmpty';
  if (!Array.isArray(doc.entry.argv) || !doc.entry.argv.every((arg) => typeof arg === 'string')) {
    return 'entryArgvMalformed';
  }
  return null;
}

function checkArtifactRow(row) {
  if (!isRecord(row)) return 'rowMissing';
  if (!nonemptyText(row.packagePath)) return 'rowPathEmpty';
  if (!nonemptyText(row.sha256)) return 'rowDigestEmpty';
  if (!nonemptyText(row.role)) return 'rowRoleEmpty';
  return null;
}

function checkOperationShape(op) {
  if (!isRecord(op)) return 'operationMissing';
  if (op.schema !== OPERATION_SCHEMA) return 'unsupportedOperationSchema';
  if (!isStringArray(op.projections)) return 'projectionsMalformed';
  if (!isStringArray(op.effects)) return 'effectsMalformed';
  if (!EXECUTION_TOKENS.includes(op.execution)) return 'unknownExecutionToken';
  if (!Array.isArray(op.dependencies)) return 'operationDependenciesMalformed';
  for (const [index, edge] of op.dependencies.entries()) {
    if (!isRecord(edge) || typeof edge.moduleId !== 'string'
        || typeof edge.declarationDigest !== 'string' || typeof edge.operation !== 'string') {
      return `operationDependencies[${index}]Malformed`;
    }
  }
  for (const member of ['subjectSchema', 'optionsSchema', 'referenceSchema', 'resultSchema', 'eventSchema']) {
    if (!nonemptyText(op[member])) return `emptySchema:${member}`;
  }
  return null;
}

// The codec-schema.bend closed vocabulary as the constructor-keyed JSON
// encoding the assets use. Returns a refusal code or null.
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
      const entries = Object.keys(body.keys ?? {});
      if (entries.length !== 1) return `${path}:keysMalformed`;
      if (entries[0] === 'SkDeclared') {
        if (!isStringArray(body.keys.SkDeclared.names)) return `${path}:declaredNamesMalformed`;
      } else if (entries[0] === 'SkAnyScalarText') {
        if (!isRecord(body.keys.SkAnyScalarText)) return `${path}:anyKeysMalformed`;
      } else {
        return `${path}:unknownKeys:${entries[0]}`;
      }
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
  if (typeof asset.SchemaDef.name !== 'string' || asset.SchemaDef.name.length === 0) {
    return `${path}:defNameEmpty`;
  }
  return checkForm(asset.SchemaDef.form, path);
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

export { checkDeclarationShape, checkOperationShape, checkArtifactRow, checkAsset, checkForm };

function loadDeclaration() {
  return readJson(DECLARATION_PATH);
}

function loadAsset(identity) {
  return readJson(join(SCHEMA_DIR, IDENTITY_FILES[identity]));
}

test('declaration satisfies every decode validity rule', () => {
  const doc = loadDeclaration();
  assert.equal(checkDeclarationShape(doc), null);
  assert.equal(doc.schema, DECLARATION_SCHEMA);
  assert.equal(doc.moduleId, 'bend2');
  assert.equal(doc.revision, 'development');
  assert.equal(doc.protocolVersion, '2');
  assert.equal(doc.packageIdentity, PACKAGE_IDENTITY);
  assert.deepEqual(doc.entry, { artifact: 'native-provider.mjs', argv: ['--experimental-strip-types'] });
  assert.deepEqual(doc.artifactIdentities.map((row) => row.packagePath), ARTIFACT_PATHS);
  for (const row of [...doc.artifactIdentities, ...doc.dependencies]) {
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
  }
  // The entry digest resolves through the artifact rows, exactly as the
  // decoder derives it.
  const entryRow = doc.artifactIdentities.find((row) => row.packagePath === doc.entry.artifact);
  assert.ok(entryRow);
  assert.equal(doc.operations.length, 1);
  const [op] = doc.operations;
  assert.equal(op.schema, OPERATION_SCHEMA);
  assert.equal(op.operation, 'sourceAnalysis');
  assert.equal(op.implements, 'sourceAnalysis');
  assert.deepEqual(op, {
    schema: OPERATION_SCHEMA,
    operation: 'sourceAnalysis',
    implements: 'sourceAnalysis',
    ...OPERATION_SCHEMAS,
    projections: ['definition', 'type', 'references', 'diagnostics'],
    effects: [],
    execution: 'managed',
    lifetimeProfile: '',
    dependencies: [],
  });
  for (const identity of Object.values(OPERATION_SCHEMAS)) {
    assert.ok(doc.schemaIdentities.includes(identity));
  }
});

test('declaration checker refuses malformed candidates', () => {
  const base = loadDeclaration();
  const emptyIdentity = structuredClone(base);
  emptyIdentity.packageIdentity = '';
  assert.match(checkDeclarationShape(emptyIdentity), /emptyPackageIdentity/);
  const noSchema = structuredClone(base);
  delete noSchema.operations[0].schema;
  assert.match(checkDeclarationShape(noSchema), /unsupportedOperationSchema/);
  const noOps = structuredClone(base);
  noOps.operations = [];
  assert.match(checkDeclarationShape(noOps), /operationsMissing/);
  const badToken = structuredClone(base);
  badToken.operations[0].execution = 'background';
  assert.match(checkDeclarationShape(badToken), /unknownExecutionToken/);
  const emptySubject = structuredClone(base);
  emptySubject.operations[0].subjectSchema = '';
  assert.match(checkDeclarationShape(emptySubject), /emptySchema:subjectSchema/);
  const emptyEntry = structuredClone(base);
  emptyEntry.entry.artifact = '';
  assert.match(checkDeclarationShape(emptyEntry), /entryArtifactEmpty/);
  const badArgv = structuredClone(base);
  badArgv.entry.argv = 'x';
  assert.match(checkDeclarationShape(badArgv), /entryArgvMalformed/);
  const emptyDigest = structuredClone(base);
  emptyDigest.dependencies[0].sha256 = '';
  assert.match(checkDeclarationShape(emptyDigest), /rowDigestEmpty/);
  const badKind = structuredClone(base);
  badKind.applicability = [{ kind: 'owner', value: 'x' }];
  assert.match(checkDeclarationShape(badKind), /UnknownKind/);
});

test('every asset is vocabulary-exact SchemaDef and every ref resolves', () => {
  const doc = loadDeclaration();
  const identities = new Set(Object.keys(IDENTITY_FILES));
  assert.deepEqual([...doc.schemaIdentities].sort(), [...identities].sort());
  for (const identity of identities) {
    const asset = loadAsset(identity);
    assert.equal(checkAsset(asset, identity), null);
    assert.equal(asset.SchemaDef.name, identity);
  }
  const refs = [];
  for (const identity of identities) {
    collectRefs(loadAsset(identity).SchemaDef.form, refs);
  }
  // The only cross-asset reference is the event envelope carrying the
  // result payload: the result payload itself carries no subject or
  // reference members in the native producer shapes.
  assert.deepEqual([...new Set(refs)].sort(), [
    'baton2.context.bend2.source-analysis.result.v1',
  ]);
  for (const target of refs) {
    assert.ok(identities.has(target), `unresolved schema ref ${target}`);
  }
});

test('assets are flat records with the canonical required members', () => {
  // Payload variants share no tag wrapper: the flat record carries the
  // members every shape has, and producer validation owns the rest.
  const requiredTop = (identity) => {
    const form = loadAsset(identity).SchemaDef.form;
    assert.deepEqual(Object.keys(form), ['SfRecord']);
    return form.SfRecord.fields
      .filter((field) => isRecord(field.SfRequired))
      .map((field) => field.SfRequired.name);
  };
  assert.deepEqual(requiredTop('baton2.context.bend2.source-analysis.subject.v1'),
    ['kind', 'path']);
  assert.deepEqual(requiredTop('baton2.context.bend2.source-analysis.options.v1'), []);
  assert.deepEqual(requiredTop('baton2.context.bend2.source-analysis.result.v1'),
    ['schema', 'status']);
  assert.deepEqual(requiredTop('baton2.context.bend2.source-analysis.reference.v1'),
    ['kind', 'path', 'real']);
  assert.deepEqual(requiredTop('baton2.context.bend2.source-analysis.event.v1'),
    ['version', 'query', 'owner', 'moduleBinding', 'sequence', 'type', 'payload']);
  const subject = loadAsset('baton2.context.bend2.source-analysis.subject.v1');
  const kind = subject.SchemaDef.form.SfRecord.fields[0].SfRequired.form;
  assert.deepEqual(kind, { SfEnum: { literals: ['position', 'symbol', 'diagnostic'] } });
});

test('asset checker refuses non-vocabulary nodes', () => {
  const asset = loadAsset('baton2.context.bend2.source-analysis.event.v1');
  assert.equal(checkAsset(asset, 'event'), null);
  const bad = structuredClone(asset);
  bad.SchemaDef.form.SfRecord.fields[0].SfRequired.form = { SfText: {} };
  assert.match(checkAsset(bad, 'event'), /unknownConstructor:SfText/);
});


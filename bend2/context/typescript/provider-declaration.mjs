// The TypeScript context provider's package declaration.
//
// Every identity below is named by an accepted contract; the citation sits at the member.
//
//   module id          Core `Eng.e_typescript() = "typescript"` (bend2/src/context/engines.bend:63-64);
//                      the provider's request contract accepts that engine
//                      (bend2/context/typescript/lib/protocol.mjs:110-113) and its discovery line
//                      reports it (lib/resolve.mjs:119,131).
//   operation ids      Core's closed common-operation set holds `Eng.op_source_analysis() =
//                      "sourceAnalysis"` and `Eng.op_sql_plan() = "sqlPlan"`
//                      (engines.bend:174-181, validated by `Eng.operation_known` :241-260), and this
//                      lane's native half returns exactly those two for its masks
//                      (bend2/src/context/typescript.bend:307-315). The module-local operation id is
//                      the same literal, which is how the catalogs declaration states it too
//                      (bend2/context/catalogs/provider-declaration.mjs:105-109), so the
//                      `implements_operation` mapping is the identity and is exported beside it.
//   declaration version Core admits "1" (engines-decl.bend:198-201).
//   protocol version   Core admits only "2" (engines-decl.bend:203-209).
//   effects            Core's mandatory minimum per common operation (engines.bend:264-275):
//                      `sqlPlan` requires `planTargetSql`, `sourceAnalysis` requires none. The union
//                      over this module's operations equals Core's `Eng.effects_of("typescript")`
//                      (engines.bend:294-299), which is the set the provider's own frame vocabulary
//                      already names (lib/protocol.mjs EFFECTS).
//   subject kinds      Core `source_kind` admits "position", "symbol" and "diagnostic"
//                      (engines.bend:463-465), the three the provider's request contract accepts
//                      (lib/protocol.mjs SUBJECT_KEYS).
//   projections        the provider's own discovery line (lib/resolve.mjs:132-144).
//   execution          "managed", matching the catalogs declaration for a provider the caller
//                      launches as a child process (catalogs/provider-declaration.mjs:33). Core
//                      requires a lifetime profile only for runtime execution
//                      (engines-decl.bend:327-336), so `lifetimeProfile` is empty here.
//   package identity   the staged context package, `baton2-context`
//                      (bend2/scripts/package-native.py:27-28), the name whose manifest packaging
//                      validates (:262-274).
//   artifact digests   computed when the package is staged
//                      (bend2/scripts/package-native.py:380-394, staging bend2/context/** verbatim
//                      into libexec/baton2/context/**). A declaration cannot carry the hash of a
//                      file that contains it, so the rows carry `sha256: null` and packaging fills
//                      it.
//
// Member names are the specification's installed-module contract
// (`ModuleDeclaration = {version, id, revision, protocolVersion, packageIdentity, entry,
// dependencies, operations, applicability}`, `Operation = {id, subjectSchema, optionsSchema,
// projections, effects, execution, resultSchema, referenceSchema, eventSchema, lifetimeProfile,
// dependencies}`), with two supersets the packager needs: `implementsOperation` on an operation,
// which carries Core's `Op.implements_operation`, and `entry.kind`, which distinguishes Core's
// `Native{artifact, exportIdentity}` from `Process{artifact, argv}`.
//
// The artifact list is the provider package's runtime closure at branch
// `codex/baton2-semantic-impl-typescript-20261005`, HEAD `eb72fc17`. `verifyDeclaredClosure` checks
// it against the package on disk once the composition carries the provider files.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_DECLARATION_SCHEMA = 'baton2.context.provider-declaration.v1';
export const DECLARATION_VERSION = '1';
export const PROTOCOL_VERSION = '2';
export const MODULE_ID = 'typescript';
export const MODULE_REVISION = '1';
export const PACKAGE_IDENTITY = 'baton2-context';
export const PACKAGE_ROOT = 'libexec/baton2/context/typescript';
export const PROVIDER_ENTRY = 'libexec/baton2/context/typescript/provider.mjs';
export const PROVIDER_ARGV = Object.freeze(['node', 'provider.mjs']);

export const SOURCE_ANALYSIS = 'sourceAnalysis';
export const SQL_PLAN = 'sqlPlan';
export const IMPLEMENTS_OPERATION = Object.freeze({
  [SOURCE_ANALYSIS]: SOURCE_ANALYSIS,
  [SQL_PLAN]: SQL_PLAN,
});

export const EXECUTIONS = Object.freeze(['pure', 'direct', 'managed', 'runtime']);
export const EXECUTION = 'managed';

// The union Core admits for this engine, and the vocabulary Core admits for any effect.
export const ENGINE_EFFECTS = Object.freeze(['planTargetSql']);
export const ADMITTED_EFFECTS = Object.freeze([
  'executeTarget',
  'planTargetSql',
  'replayMigrations',
  'evaluateRuntime',
  'controlRuntime',
]);

export const SOURCE_SUBJECT_KINDS = Object.freeze(['position', 'symbol', 'diagnostic']);
export const SOURCE_SUFFIXES = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']);
export const DATABASE_PROJECTION = 'databaseAccesses';
export const SOURCE_PROJECTIONS = Object.freeze([
  'definition',
  'type',
  'references',
  'calls',
  'callers',
  'dependencies',
  'diagnostics',
  'flow',
  'exceptions',
]);

export const RESOLVER_RECORD_SCHEMA = 'baton2.context.resolver-record.v1';
export const SUBJECT_SCHEMA = 'baton2.context.typescript.subject.v1';
export const OPTIONS_SCHEMA = 'baton2.context.typescript.options.v1';

function schemaFor(operation, member) {
  return `baton2.context.typescript.${operation}.${member}.v1`;
}

const PROVIDER_CLOSURE = Object.freeze([
  'provider.mjs',
  'lib/bindings.mjs',
  'lib/capture.mjs',
  'lib/diagnostics.mjs',
  'lib/flow.mjs',
  'lib/protocol.mjs',
  'lib/query.mjs',
  'lib/records.mjs',
  'lib/refs.mjs',
  'lib/resolve.mjs',
  'lib/service.mjs',
  'lib/sql.mjs',
]);

function artifactFor(relative) {
  return Object.freeze({
    path: `${PACKAGE_ROOT}/${relative}`,
    sha256: null,
    role: relative === 'provider.mjs' ? 'entry' : 'library',
  });
}

function operation({ id, projections, effects }) {
  return Object.freeze({
    id,
    implementsOperation: IMPLEMENTS_OPERATION[id],
    subjectSchema: SUBJECT_SCHEMA,
    optionsSchema: OPTIONS_SCHEMA,
    projections: Object.freeze([...projections]),
    effects: Object.freeze([...effects]),
    execution: EXECUTION,
    resultSchema: schemaFor(id, 'result'),
    referenceSchema: schemaFor(id, 'reference'),
    eventSchema: schemaFor(id, 'event'),
    lifetimeProfile: '',
    dependencies: Object.freeze([]),
  });
}

export const OPERATIONS = Object.freeze([
  operation({ id: SOURCE_ANALYSIS, projections: SOURCE_PROJECTIONS, effects: [] }),
  operation({ id: SQL_PLAN, projections: [DATABASE_PROJECTION], effects: ENGINE_EFFECTS }),
]);

export const PROVIDER_DECLARATION = Object.freeze({
  schema: PROVIDER_DECLARATION_SCHEMA,
  version: DECLARATION_VERSION,
  id: MODULE_ID,
  revision: MODULE_REVISION,
  protocolVersion: PROTOCOL_VERSION,
  packageIdentity: PACKAGE_IDENTITY,
  entry: Object.freeze({
    kind: 'process',
    artifact: PROVIDER_ENTRY,
    argv: PROVIDER_ARGV,
    role: 'entry',
  }),
  dependencies: Object.freeze([]),
  artifacts: Object.freeze(PROVIDER_CLOSURE.map(artifactFor)),
  schemas: Object.freeze([
    RESOLVER_RECORD_SCHEMA,
    SUBJECT_SCHEMA,
    OPTIONS_SCHEMA,
    ...[SOURCE_ANALYSIS, SQL_PLAN].flatMap((id) => [
      schemaFor(id, 'result'),
      schemaFor(id, 'reference'),
      schemaFor(id, 'event'),
    ]),
  ]),
  applicability: Object.freeze([
    ...SOURCE_SUBJECT_KINDS.map((kind) => Object.freeze({ kind: 'subject', value: kind })),
    ...SOURCE_SUFFIXES.map((suffix) => Object.freeze({ kind: 'path', value: suffix })),
  ]),
  operations: OPERATIONS,
});

function reject(reason, detail) {
  return { reason, detail };
}

// The provider's own completeness check, made once at startup. The conditions are the provider's:
// every identity is a value the accepted contract names, every referenced schema is declared,
// every effect has an admitted meaning and stays inside the engine's admitted set, and the artifact
// rows live in this package.
export function checkProviderDeclaration(declaration) {
  if (declaration === null || typeof declaration !== 'object') {
    return { status: 'refused', reasons: [reject('declarationMissing', 'no declaration')] };
  }
  const reasons = [];
  if (declaration.schema !== PROVIDER_DECLARATION_SCHEMA) {
    reasons.push(reject('schemaUnsupported', String(declaration.schema)));
  }
  if (declaration.version !== DECLARATION_VERSION) {
    reasons.push(reject('declarationVersionUnsupported', String(declaration.version)));
  }
  if (declaration.protocolVersion !== PROTOCOL_VERSION) {
    reasons.push(reject('protocolVersionUnsupported', String(declaration.protocolVersion)));
  }
  if (typeof declaration.id !== 'string' || declaration.id.length === 0) {
    reasons.push(reject('moduleIdEmpty', 'the declaration names no module'));
  }
  if (declaration.packageIdentity !== PACKAGE_IDENTITY) {
    reasons.push(reject('packageIdentityUnsupported', String(declaration.packageIdentity)));
  }

  const declaredSchemas = new Set(Array.isArray(declaration.schemas) ? declaration.schemas : []);
  const artifacts = Array.isArray(declaration.artifacts) ? declaration.artifacts : [];
  if (artifacts.length === 0) reasons.push(reject('artifactsEmpty', 'the declaration names no artifact'));
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== 'string' || !artifact.path.startsWith(`${PACKAGE_ROOT}/`)) {
      reasons.push(reject('artifactPathOutsidePackage', String(artifact?.path)));
    }
    if (typeof artifact?.role !== 'string' || artifact.role.length === 0) {
      reasons.push(reject('artifactRoleMissing', String(artifact?.path)));
    }
  }
  const entry = declaration.entry;
  if (entry === null || typeof entry !== 'object' || typeof entry.artifact !== 'string') {
    reasons.push(reject('entryMissing', 'the declaration names no entry artifact'));
  } else {
    if (entry.kind !== 'process' && entry.kind !== 'native') {
      reasons.push(reject('entryKindUnsupported', String(entry.kind)));
    }
    if (!artifacts.some((artifact) => artifact?.path === entry.artifact)) {
      reasons.push(reject('entryArtifactNotDeclared', entry.artifact));
    }
    if (entry.kind === 'process' && (!Array.isArray(entry.argv) || entry.argv.length === 0)) {
      reasons.push(reject('entryVectorEmpty', 'a process entry carries a nonempty argv vector'));
    }
    if (entry.kind === 'native' && (typeof entry.exportIdentity !== 'string' || entry.exportIdentity.length === 0)) {
      reasons.push(reject('entryExportMissing', 'a native entry carries an export identity'));
    }
  }

  const operations = Array.isArray(declaration.operations) ? declaration.operations : [];
  if (operations.length === 0) reasons.push(reject('operationsEmpty', 'the declaration names no operation'));
  const seenOperations = new Set();
  const seenProjections = new Map();
  const effects = new Set();
  for (const declared of operations) {
    const id = declared?.id;
    if (typeof id !== 'string' || id.length === 0) {
      reasons.push(reject('operationIdEmpty', 'an operation carries no id'));
      continue;
    }
    if (seenOperations.has(id)) reasons.push(reject('duplicateOperation', id));
    seenOperations.add(id);
    if (declared.implementsOperation !== IMPLEMENTS_OPERATION[id]) {
      reasons.push(reject('implementsOperationUnsupported', `${id} implements ${String(declared.implementsOperation)}`));
    }
    for (const member of ['subjectSchema', 'optionsSchema', 'resultSchema', 'referenceSchema', 'eventSchema']) {
      const schema = declared[member];
      if (typeof schema !== 'string' || !declaredSchemas.has(schema)) {
        reasons.push(reject('schemaUnlisted', `${id}.${member} names ${String(schema)} outside the declared schema set`));
      }
    }
    if (!EXECUTIONS.includes(declared.execution)) {
      reasons.push(reject('executionUnsupported', `${id} declares ${String(declared.execution)}`));
    }
    for (const effect of Array.isArray(declared.effects) ? declared.effects : []) {
      if (!ADMITTED_EFFECTS.includes(effect)) {
        reasons.push(reject('effectUnknown', `${id} declares ${String(effect)}`));
      }
      effects.add(effect);
    }
    for (const projection of Array.isArray(declared.projections) ? declared.projections : []) {
      if (seenProjections.has(projection)) {
        reasons.push(reject('projectionDeclaredTwice', `${projection} is declared by ${seenProjections.get(projection)} and ${id}`));
      }
      seenProjections.set(projection, id);
    }
  }
  const declaredEffects = [...effects].sort();
  const engineEffects = [...ENGINE_EFFECTS].sort();
  if (declaredEffects.join(',') !== engineEffects.join(',')) {
    reasons.push(reject(
      'effectsOutsideEngineSet',
      `the operations require ${JSON.stringify(declaredEffects)} while the engine admits ${JSON.stringify(engineEffects)}`,
    ));
  }

  const applicability = Array.isArray(declaration.applicability) ? declaration.applicability : [];
  if (applicability.length === 0) reasons.push(reject('applicabilityEmpty', 'the declaration names no applicability rule'));
  for (const rule of applicability) {
    if (rule?.kind === 'subject' && !SOURCE_SUBJECT_KINDS.includes(rule.value)) {
      reasons.push(reject('subjectKindUnknown', String(rule.value)));
    }
    if (rule?.kind !== 'subject' && rule?.kind !== 'path' && rule?.kind !== 'manifest' && rule?.kind !== 'projection') {
      reasons.push(reject('applicabilityKindUnsupported', String(rule?.kind)));
    }
  }

  return reasons.length === 0 ? { status: 'admitted', declaration } : { status: 'refused', reasons };
}

// The declared artifact rows must match the provider package on disk. Called by the suite after a
// composition carries the provider files; a package that gains or loses a module fails here until
// the declaration is updated.
export function verifyDeclaredClosure(declaration, packageRoot) {
  const declared = new Set(
    (declaration.artifacts ?? []).map((artifact) => artifact.path.slice(`${PACKAGE_ROOT}/`.length)),
  );
  const present = new Set(['provider.mjs']);
  const library = join(packageRoot, 'lib');
  if (existsSync(library)) {
    for (const entry of readdirSync(library)) {
      if (entry.endsWith('.mjs')) present.add(`lib/${entry}`);
    }
  }
  const missing = [...declared].filter((path) => !present.has(path)).sort();
  const undeclared = [...present].filter((path) => !declared.has(path)).sort();
  return { missing, undeclared };
}

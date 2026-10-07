// The TypeScript context provider's package declaration.
//
// This record is authored and not admitted. Each member package admission owns is carried as an
// explicit hole beside the authority that must fill it, and the provider's own completeness check
// refuses the record until those holes are filled. Nothing below is a guess: every value is named
// by an accepted contract, cited at the member, and the two versions are kept apart.
//
//   module id             Core `Eng.e_typescript() = "typescript"` (bend2/src/context/engines.bend:63-64);
//                         the provider's request contract accepts that engine
//                         (bend2/context/typescript/lib/protocol.mjs:110-113) and its discovery line
//                         reports it (lib/resolve.mjs:119,131).
//   operation ids         Core's closed common-operation set holds `Eng.op_source_analysis() =
//                         "sourceAnalysis"` and `Eng.op_sql_plan() = "sqlPlan"` (engines.bend:174-181,
//                         validated by `Eng.operation_known` :241-260), and this lane's native half
//                         returns exactly those two for its masks (bend2/src/context/typescript.bend:307-315).
//   declaration version   the declaration schema Core admits, "1" (engines-decl.bend:195-201). A
//                         declaration schema version is not a transport version.
//   declared transport    "1", the version this provider's own frames carry: lib/protocol.mjs:4-6
//                         calls the wire provisional and unwraps a single-member
//                         {"requestCanonical": "..."} frame, and lib/protocol.mjs:251 and :294-296
//                         write `version: 1` on the result and the refusal frame; provider.mjs:1-15
//                         states the launch and frame contract. Core admits transport "2" only
//                         (engines-decl.bend:203-209), and the version-2 invocation frame is the one
//                         Core constructs for a selected plan (engines-select.bend:904-913). Declaring
//                         "2" while this module writes version-1 frames would relabel the wire, so the
//                         record declares "1" and names the bridge or migration admission requires.
//   effects               per-operation minima from Core (engines.bend:264-275): `sqlPlan` requires
//                         `planTargetSql`, `sourceAnalysis` requires none; their union equals
//                         `Eng.effects_of("typescript")` (engines.bend:294-299), the set the
//                         provider's own frame vocabulary names (lib/protocol.mjs EFFECTS).
//   subject kinds         Core `source_kind`: "position", "symbol", "diagnostic" (engines.bend:463-465).
//   projections           the provider's own discovery line (lib/resolve.mjs:132-144).
//   execution             "managed" as a provisional token: the observed lifecycle is one child process
//                         per query, launched and reaped by the caller (provider.mjs:1-15). Core admits
//                         "direct" and "managed" and requires a lifetime profile only for runtime
//                         (engines-decl.bend:327-336), and a process launch alone does not settle which
//                         token matches the lifecycle the caller implements, so the token stays
//                         provisional and its confirmation is a named hole owned by the invocation owner
//                         together with the code-lane conductor.
//   package identity      the staged context package `baton2-context` (bend2/scripts/package-native.py:27-28).
//   artifact rows         derived from the staging rule that copies `bend2/context/**` to
//                         `libexec/baton2/context/**` verbatim (package-native.py:380-394). The digests
//                         are computed at packaging, so the rows carry none.
//
// The holes and their authorities:
//   * the launch vector. Core owns the launch contract (provider.mjs:6-9 says so explicitly), so this
//     declaration cannot hold an argv it does not own.
//   * the five schema identities per operation. Package admission supplies
//     `Inv{artifacts, schemas, digests}` and `check_schemas` requires all five of subject, options,
//     result, reference and event to be admitted (engines-decl.bend:305-320). No authoritative
//     TypeScript inventory is recovered, so the identities stay holes.
//   * the artifact digests. `check_artifact` matches a declared artifact against the admitted
//     inventory (engines-decl.bend:290-301).
//
// Member names follow the specification's installed-module contract, with three supersets the
// packager needs: `implementsOperation` (Core's `Op.implements_operation`), `activation` (the shape
// of Core's `Process{artifact, argv}` entry plus the inventory status), and `schemas` as
// role-indexed rows per operation.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const PROVIDER_DECLARATION_SCHEMA = 'baton2.context.provider-declaration.v1';
export const DECLARATION_VERSION = '1';
export const DECLARED_TRANSPORT_VERSION = '1';
export const ADMITTED_TRANSPORT_VERSION = '2';
export const MODULE_ID = 'typescript';
export const MODULE_REVISION = '1';
export const PACKAGE_IDENTITY = 'baton2-context';
export const PACKAGE_ROOT = 'libexec/baton2/context/typescript';
export const PROVIDER_ENTRY = 'libexec/baton2/context/typescript/provider.mjs';

export const SOURCE_ANALYSIS = 'sourceAnalysis';
export const SQL_PLAN = 'sqlPlan';
export const IMPLEMENTS_OPERATION = Object.freeze({
  [SOURCE_ANALYSIS]: SOURCE_ANALYSIS,
  [SQL_PLAN]: SQL_PLAN,
});

export const EXECUTIONS = Object.freeze(['pure', 'direct', 'managed', 'runtime']);
export const EXECUTION = 'managed';
// Core admits both direct and managed for a non-runtime operation, so the token must describe the
// lifecycle the invocation owner actually implements. The provider's own contract shows one process
// per query; whether the caller's management of that process makes the operation managed or direct is
// the invocation owner's statement to make, so the token stays provisional until that owner confirms
// it and the completeness check refuses the record meanwhile.
export const EXECUTION_STATUS = 'provisional';

// The lifecycle the provider actually has: one child process per query, no retained keeper. Core
// requires a profile only for runtime execution, so an empty profile here is the truthful value.
export const LIFECYCLE = Object.freeze({
  profile: '',
  detail: 'one child process per query: the caller launches the provider, writes the admitted request, reads one frame, and the process exits; the exit status separates a result, a refusal and a failure, and no keeper is retained between queries',
});

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

export const SCHEMA_ROLES = Object.freeze(['subject', 'options', 'result', 'reference', 'event']);

// Every hole in this record, the code the completeness check reports for it, and the authority that
// fills it. A hole is not a claim: it is the place a value must arrive from.
export const ADMISSION_HOLES = Object.freeze([
  Object.freeze({
    code: 'transportVersionUnadmitted',
    authority: 'the lane that authors the bridge or the version migration',
    detail: 'this module writes version-1 provider frames and Core admits transport "2" (engines-decl.bend:203-209, engines-select.bend:904-913)',
  }),
  Object.freeze({
    code: 'executionTokenUnconfirmed',
    authority: 'the caller that owns the launch contract (native), decided with the code-lane conductor',
    detail: 'Core admits direct and managed for a non-runtime operation (engines-decl.bend:327-336); a process launch alone does not settle which token matches the lifecycle the caller implements',
  }),
  Object.freeze({
    code: 'invocationVectorUnadmitted',
    authority: 'the caller that owns the launch contract (native)',
    detail: 'Core owns the provider launch vector and its argv (provider.mjs:6-9)',
  }),
  Object.freeze({
    code: 'schemaIdentityUnadmitted',
    authority: 'package admission',
    detail: 'Inv.schemas carries the five admitted identities of subject, options, result, reference and event per operation (engines-decl.bend:305-320)',
  }),
  Object.freeze({
    code: 'artifactDigestUnadmitted',
    authority: 'package admission',
    detail: 'Inv.artifacts carries the digest of every admitted artifact (engines-decl.bend:290-301)',
  }),
]);

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
    projections: Object.freeze([...projections]),
    effects: Object.freeze([...effects]),
    execution: EXECUTION,
    lifetimeProfile: LIFECYCLE.profile,
    dependencies: Object.freeze([]),
    schemas: Object.freeze(SCHEMA_ROLES.map((role) => Object.freeze({
      operation: id,
      role,
      identity: null,
      status: 'unadmitted',
    }))),
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
  protocolVersion: DECLARED_TRANSPORT_VERSION,
  packageIdentity: PACKAGE_IDENTITY,
  activation: Object.freeze({
    kind: 'process',
    artifact: PROVIDER_ENTRY,
    sha256: null,
    argv: null,
    status: 'unadmitted',
    detail: 'the launch vector belongs to the caller that owns the launch contract; this record holds none',
  }),
  executionStatus: EXECUTION_STATUS,
  lifecycle: LIFECYCLE,
  artifacts: Object.freeze(PROVIDER_CLOSURE.map(artifactFor)),
  operations: OPERATIONS,
  applicability: Object.freeze([
    ...SOURCE_SUBJECT_KINDS.map((kind) => Object.freeze({ kind: 'subject', value: kind })),
    ...SOURCE_SUFFIXES.map((suffix) => Object.freeze({ kind: 'path', value: suffix })),
  ]),
  holes: ADMISSION_HOLES,
});

function reject(reason, detail) {
  return { reason, detail };
}

// The provider's own completeness check. It reports two kinds of reason: conformance, which a record
// that keeps every value the accepted contract names satisfies, and the unadmitted holes, which only
// their named authority can fill.
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
  if (typeof declaration.id !== 'string' || declaration.id.length === 0) {
    reasons.push(reject('moduleIdEmpty', 'the declaration names no module'));
  }
  if (declaration.packageIdentity !== PACKAGE_IDENTITY) {
    reasons.push(reject('packageIdentityUnsupported', String(declaration.packageIdentity)));
  }
  if (declaration.protocolVersion !== ADMITTED_TRANSPORT_VERSION) {
    reasons.push(reject(
      'transportVersionUnadmitted',
      `the record declares transport ${String(declaration.protocolVersion)} while Core admits ${ADMITTED_TRANSPORT_VERSION}`,
    ));
  }
  if (declaration.executionStatus !== 'confirmed') {
    reasons.push(reject(
      'executionTokenUnconfirmed',
      `the execution token ${String(EXECUTION)} awaits the invocation owner's statement that it matches the implemented lifecycle`,
    ));
  }

  const activation = declaration.activation;
  if (activation === null || typeof activation !== 'object' || typeof activation.artifact !== 'string') {
    reasons.push(reject('activationMissing', 'the declaration names no activation artifact'));
  } else {
    if (!Array.isArray(activation.argv) || activation.argv.length === 0
      || activation.argv.some((word) => typeof word !== 'string' || word.length === 0)) {
      reasons.push(reject('invocationVectorUnadmitted', `${activation.artifact} carries no admitted launch vector`));
    }
    if (typeof activation.sha256 !== 'string' || activation.sha256.length === 0) {
      reasons.push(reject('artifactDigestUnadmitted', `${activation.artifact} carries no admitted digest`));
    }
  }

  const artifacts = Array.isArray(declaration.artifacts) ? declaration.artifacts : [];
  if (artifacts.length === 0) reasons.push(reject('artifactsEmpty', 'the declaration names no artifact'));
  for (const artifact of artifacts) {
    if (typeof artifact?.path !== 'string' || !artifact.path.startsWith(`${PACKAGE_ROOT}/`)) {
      reasons.push(reject('artifactPathOutsidePackage', String(artifact?.path)));
    }
    if (typeof artifact?.role !== 'string' || artifact.role.length === 0) {
      reasons.push(reject('artifactRoleMissing', String(artifact?.path)));
    }
    if (typeof artifact?.sha256 !== 'string' || artifact.sha256.length === 0) {
      reasons.push(reject('artifactDigestUnadmitted', `${String(artifact?.path)} carries no admitted digest`));
    }
  }
  if (activation !== null && typeof activation === 'object' && typeof activation.artifact === 'string'
    && !artifacts.some((artifact) => artifact?.path === activation.artifact)) {
    reasons.push(reject('activationArtifactNotDeclared', activation.artifact));
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
    if (!EXECUTIONS.includes(declared.execution)) {
      reasons.push(reject('executionUnsupported', `${id} declares ${String(declared.execution)}`));
    }
    if (declared.execution !== 'runtime' && typeof declared.lifetimeProfile === 'string' && declared.lifetimeProfile.length > 0) {
      reasons.push(reject(
        'lifetimeProfileUnsupported',
        `${id} carries a lifetime profile while Core requires one only for runtime execution`,
      ));
    }
    const rows = Array.isArray(declared.schemas) ? declared.schemas : [];
    const roles = rows.filter((row) => row?.operation === id).map((row) => row.role);
    for (const role of SCHEMA_ROLES) {
      if (!roles.includes(role)) {
        reasons.push(reject('schemaRoleMissing', `${id} declares no ${role} schema role`));
      }
    }
    for (const row of rows) {
      if (row?.operation !== id) continue;
      if (typeof row.identity !== 'string' || row.identity.length === 0) {
        reasons.push(reject('schemaIdentityUnadmitted', `${id}.${String(row.role)} carries no admitted identity`));
      }
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

// Exactly what package admission must supply for this record, item by item. Every row names the
// authority and carries no value: the declaration asks for the inventory instead of inventing it.
export function admissionRequirements(declaration = PROVIDER_DECLARATION) {
  const artifacts = (declaration.artifacts ?? []).map((artifact) => ({
    path: artifact.path,
    role: artifact.role,
    digest: artifact.sha256 ?? null,
    status: typeof artifact.sha256 === 'string' && artifact.sha256.length > 0 ? 'admitted' : 'unadmitted',
  }));
  const schemas = (declaration.operations ?? []).flatMap((operation_) => (operation_.schemas ?? []).map((row) => ({
    operation: row.operation,
    role: row.role,
    identity: row.identity ?? null,
    status: typeof row.identity === 'string' && row.identity.length > 0 ? 'admitted' : 'unadmitted',
  })));
  const activation = declaration.activation ?? {};
  return {
    moduleId: declaration.id,
    declaredTransportVersion: declaration.protocolVersion,
    admittedTransportVersion: ADMITTED_TRANSPORT_VERSION,
    transportStatus: declaration.protocolVersion === ADMITTED_TRANSPORT_VERSION ? 'admitted' : 'unadmitted',
    execution: {
      token: EXECUTION,
      profile: declaration.lifecycle?.profile ?? '',
      status: declaration.executionStatus === 'confirmed' ? 'confirmed' : 'provisional',
    },
    invocation: {
      artifact: activation.artifact ?? null,
      argv: Array.isArray(activation.argv) && activation.argv.length > 0 ? [...activation.argv] : null,
      status: Array.isArray(activation.argv) && activation.argv.length > 0 ? 'admitted' : 'unadmitted',
    },
    artifacts,
    schemas,
  };
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

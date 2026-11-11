// The two internal records the models and catalogs provider consumes.
//
//   ConstantSqlRecord v1  - one database client call, its checker-resolved callee and receiver,
//                           and the literal SQL text when the call has one.
//   ResolverUseRecord v1  - one model export use: the resolved module, the resolved declaration
//                           of the export, and the import specifier that linked them.
//
// Both carry the snapshot identity they were computed under, so a join can never mix two
// snapshots, and both report resolution outcomes rather than spellings: a shadowed function, an
// unresolved import and a dynamic receiver each have their own status.

export const RESOLVER_RECORD_SCHEMA = 'baton2.context.resolver-record.v1';

export const RESOLUTION_RESOLVED = 'resolved';
export const RESOLUTION_UNRESOLVED = 'unresolved';
export const RESOLUTION_LOCAL = 'local';

export const SQL_CONSTANT = 'constant';
export const SQL_DYNAMIC = 'dynamic';

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`record field ${field} must be a nonempty string`);
  }
  return value;
}

function requireRange(range, field) {
  for (const end of ['start', 'end']) {
    const point = range?.[end];
    if (
      typeof point?.line !== 'number' ||
      typeof point?.column !== 'number' ||
      !Number.isSafeInteger(point.line) ||
      !Number.isSafeInteger(point.column) ||
      point.line < 0 ||
      point.column < 0
    ) {
      throw new TypeError(`record field ${field}.${end} must be a zero-based position`);
    }
  }
  return { start: { ...range.start }, end: { ...range.end } };
}

function requireLimits(limits) {
  if (!Array.isArray(limits) || limits.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('record field limits must be an array of strings');
  }
  return [...limits];
}

export function declaration(path, sha256, range) {
  return { path: requireString(path, 'declaration.path'), sha256: requireString(sha256, 'declaration.sha256'), range: requireRange(range, 'declaration.range') };
}

export function resolvedResolution(decl) {
  return { status: RESOLUTION_RESOLVED, declaration: decl };
}

export function unresolvedResolution(reason) {
  return { status: RESOLUTION_UNRESOLVED, reason: requireString(reason, 'resolution.reason') };
}

export function localResolution(reason) {
  return { status: RESOLUTION_LOCAL, reason: requireString(reason, 'resolution.reason') };
}

export function providerField(resolved) {
  return { engine: 'typescript', version: resolved.version, libraryPath: resolved.libraryPath, librarySha: resolved.librarySha };
}

// One constant-SQL call. The caller must pass the resolved outcomes it observed; this builder
// only fixes the closed shape and refuses a half-filled record.
export function constantSqlRecord({ resolved, snapshotId, callSite, callee, receiver, sql, statementKind, limits }) {
  requireString(snapshotId, 'snapshotId');
  const record = {
    schema: RESOLVER_RECORD_SCHEMA,
    kind: 'constantSql',
    provider: providerField(resolved),
    snapshotId,
    callSite: {
      path: requireString(callSite.path, 'callSite.path'),
      sha256: requireString(callSite.sha256, 'callSite.sha256'),
      range: requireRange(callSite.range, 'callSite.range'),
    },
    callee,
    receiver,
    sql,
    statementKind: statementKind ?? 'unknown',
    limits: requireLimits(limits ?? []),
  };
  if (!['read', 'write', 'unknown'].includes(record.statementKind)) {
    throw new TypeError('record field statementKind must be read, write or unknown');
  }
  if (record.sql.status === SQL_CONSTANT) {
    requireString(record.sql.text, 'sql.text');
    requireString(record.sql.literalKind, 'sql.literalKind');
  } else if (record.sql.status === SQL_DYNAMIC) {
    requireString(record.sql.reason, 'sql.reason');
  } else {
    throw new TypeError('record field sql.status must be constant or dynamic');
  }
  return record;
}

// One model export use, linked to the resolved declaration under one snapshot.
export function modelUseRecord({ resolved, snapshotId, useSite, module, exportName, resolution, limits }) {
  requireString(snapshotId, 'snapshotId');
  return {
    schema: RESOLVER_RECORD_SCHEMA,
    kind: 'modelUse',
    provider: providerField(resolved),
    snapshotId,
    useSite: {
      path: requireString(useSite.path, 'useSite.path'),
      sha256: requireString(useSite.sha256, 'useSite.sha256'),
      range: requireRange(useSite.range, 'useSite.range'),
      role: requireString(useSite.role, 'useSite.role'),
    },
    module: {
      path: requireString(module.path, 'module.path'),
      sha256: requireString(module.sha256, 'module.sha256'),
    },
    export: exportName === null ? null : requireString(exportName, 'export'),
    resolution,
    limits: requireLimits(limits ?? []),
  };
}

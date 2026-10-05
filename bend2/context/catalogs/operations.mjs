// Selected operation, required target-effect set and admitted subject mapping
// for each exported callable.
//
// Operation names and the canonical required-effect construction belong to the
// native core, the codec and the managed lifecycle. The names here are the
// core's closed set: catalogCapture, sqlPlan, codeAccessJoin. This table
// reports only what each callable does and which admitted subject and target
// input selects it, so admission can decide before launch.

export const CATALOG_OPERATIONS = Object.freeze([
  {
    callable: 'createSqliteSession',
    operation: 'catalogCapture',
    requiredEffects: [],
    subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: '<subject database path>' } },
    targetInputs: ['databasePath'],
    detail: 'one read-only connection, one read transaction, fixed catalog reads only',
  },
  {
    callable: 'captureSqliteSnapshot',
    operation: 'catalogCapture',
    requiredEffects: [],
    subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: '<subject database path>' } },
    targetInputs: ['databasePath'],
    conditional: { when: 'statements is nonempty', operation: 'sqlPlan', requiredEffects: ['planTargetSql'] },
    detail: 'catalog-only when no statement is selected; a selected statement adds engine EXPLAIN planning',
  },
  {
    callable: 'session.analyze',
    operation: 'sqlPlan',
    requiredEffects: ['planTargetSql'],
    subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: '<subject database path>' } },
    targetInputs: ['databasePath', 'statementText'],
    detail: 'EXPLAIN of a target-derived statement inside the captured catalog transaction; the original statement is never stepped',
  },
  {
    callable: 'session.join',
    operation: 'codeAccessJoin',
    requiredEffects: ['planTargetSql'],
    subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: '<subject database path>' } },
    targetInputs: ['databasePath', 'resolverSqlCallRecords'],
    detail: 'plans each admitted resolver statement on a cache miss inside the open transaction and joins it to the captured catalog',
  },
  {
    callable: 'openPostgresSession',
    operation: 'catalogCapture',
    requiredEffects: [],
    subject: { kind: 'entity', database: { engine: 'postgres-schema', connectionFile: '<libpq service file>' } },
    targetInputs: ['serviceFile'],
    detail: 'one read-only transaction reading pg_catalog rows',
  },
  {
    callable: 'capturePostgresSnapshot',
    operation: 'catalogCapture',
    requiredEffects: [],
    subject: { kind: 'entity', database: { engine: 'postgres-schema', connectionFile: '<libpq service file>' } },
    targetInputs: ['serviceFile'],
    detail: 'the same capture, closed after the rows are read',
  },
  {
    callable: 'session.analyze (postgres)',
    operation: 'sqlPlan',
    requiredEffects: ['planTargetSql'],
    subject: { kind: 'entity', database: { engine: 'postgres-schema', connectionFile: '<libpq service file>' } },
    targetInputs: ['serviceFile', 'statementText'],
    detail: 'PREPARE plus EXPLAIN (FORMAT JSON) EXECUTE in one read-only transaction; the target statement is never executed',
  },
  {
    callable: 'joinPostgresRelations',
    operation: 'codeAccessJoin',
    requiredEffects: ['planTargetSql'],
    subject: { kind: 'entity', database: { engine: 'postgres-schema', connectionFile: '<libpq service file>' } },
    targetInputs: ['serviceFile', 'plannedStatement'],
    detail: 'joins the plan relation identities to the captured catalog',
  },
  {
    callable: 'openReadOnlySqlite',
    operation: 'catalogCapture',
    requiredEffects: [],
    subject: { kind: 'entity', database: { engine: 'sqlite-schema', path: '<subject database path>' } },
    targetInputs: ['databasePath'],
    detail: 'read-only open of an existing regular file and the connection identity check; no engine statement runs',
  },
]);

// The migration projections of the combined C handler are implemented by the
// native linked-library replay operation, not by this Node provider. No entry
// here names migrationReplay.
export const CATALOG_UNSUPPORTED_OPERATIONS = Object.freeze(['migrationReplay', 'datasetRead', 'environmentRead', 'toolsProbe']);

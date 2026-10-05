// Selected operation and required target-effect set for each exported callable.
//
// The native core and codec own the operation discriminator, the canonical
// required-effect construction and managed admission. This table is the domain
// provider's report of what each callable actually does, so admission can know
// the selected operation before any launch: it constructs no effect and defines
// no public format.

export const CATALOG_OPERATIONS = Object.freeze([
  {
    callable: 'createSqliteSession',
    operation: 'catalogCapture',
    requiredEffects: [],
    targetInputs: ['databasePath'],
    detail: 'one read-only connection, one read transaction, fixed catalog reads only',
  },
  {
    callable: 'captureSqliteSnapshot',
    operation: 'catalogCapture',
    requiredEffects: [],
    targetInputs: ['databasePath'],
    conditional: { when: 'statements is nonempty', operation: 'targetPlan', requiredEffects: ['planTargetSql'] },
    detail: 'catalog-only when no statement is selected; a selected statement adds engine EXPLAIN planning',
  },
  {
    callable: 'captureSqliteSnapshot with statements',
    operation: 'targetPlan',
    requiredEffects: ['planTargetSql'],
    targetInputs: ['databasePath', 'statementText'],
    detail: 'EXPLAIN of a target-derived statement inside the captured catalog transaction',
  },
  {
    callable: 'captureSqliteSnapshot with a selected list',
    operation: 'migrationReplay',
    requiredEffects: ['replayMigrations'],
    targetInputs: ['databasePath', 'migrationChain'],
    detail: 'not implemented in the Node profile; the combined-migration projection belongs to the native replay operation',
  },
  {
    callable: 'session.analyze',
    operation: 'targetPlan',
    requiredEffects: ['planTargetSql'],
    targetInputs: ['databasePath', 'statementText'],
    detail: 'EXPLAIN of a target-derived statement; the original statement is never stepped',
  },
  {
    callable: 'session.join',
    operation: 'targetPlan',
    requiredEffects: ['planTargetSql'],
    targetInputs: ['databasePath', 'resolverRecords'],
    conditional: { when: 'no record contributes a statement', operation: 'catalogCapture', requiredEffects: [] },
    detail: 'plans each admitted record statement on a cache miss inside the open transaction',
  },
  {
    callable: 'openPostgresSession',
    operation: 'catalogCapture',
    requiredEffects: [],
    targetInputs: ['serviceFile'],
    detail: 'one read-only transaction reading pg_catalog rows',
  },
  {
    callable: 'session.analyze (postgres)',
    operation: 'targetPlan',
    requiredEffects: ['planTargetSql'],
    targetInputs: ['serviceFile', 'statementText'],
    detail: 'PREPARE plus EXPLAIN (FORMAT JSON) EXECUTE in one read-only transaction; the target statement is never executed',
  },
  {
    callable: 'openReadOnlySqlite',
    operation: 'localRead',
    requiredEffects: [],
    targetInputs: ['databasePath'],
    detail: 'read-only open of an existing regular file; no engine statement runs',
  },
]);

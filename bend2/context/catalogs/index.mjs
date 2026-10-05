// Catalog providers for the entity, TypeScript and schema subjects.
//
// sqlite-schema  read-only node:sqlite catalog plus engine EXPLAIN programs
// postgres-schema psql 14.18 catalog and plan facts in one read-only transaction
// join           constant-SQL call sites to catalog objects

export {
  SQLITE_SCHEMA,
  captureSqliteSnapshot,
  compareSqliteIdentities,
  createSqliteSession,
  fileIdentityOf,
  openReadOnlySqlite,
  readSqliteCatalog,
  sqliteCatalogDigest,
} from './sqlite-catalog.mjs';

export {
  analyzeSqliteStatement,
  joinRootpages,
  probeOriginCapability,
  statementFraming,
  statementOrigins,
} from './sqlite-statement.mjs';

export {
  SERVICE_NAME,
  PLAN_GRANT,
  POSTGRES_ENGINE,
  capturePostgresSnapshot,
  comparePostgresIdentities,
  extractPostgresPlanRelations,
  openPostgresSession,
  postgresCatalogDigest,
  postgresEnvironment,
} from './postgres-catalog.mjs';

export { admitSqlCallRecord, joinConstantSql, joinPostgresRelations } from './sql-join.mjs';

export { catalogAdapterMain } from './adapter.mjs';

export { canonicalJson, digestJson, sha256Hex } from './canonical.mjs';

export { DIALECTS, foldIdentifier, identifiersMatch } from './sql-identifiers.mjs';

export { SCAN_DIALECTS, scanSqlStatements, validateSqlText } from './sql-scan.mjs';

export { CATALOG_OPERATIONS } from './operations.mjs';

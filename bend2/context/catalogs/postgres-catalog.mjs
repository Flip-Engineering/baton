// PostgreSQL 14.18 catalog and plan provider through the external psql client.
//
// Every invocation runs the fixed package SQL in one
// `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction. Catalog reads
// name pg_catalog explicitly and record the connection's own search_path; a
// plan transaction pins that recorded value with SET LOCAL, so a statement's
// unqualified names resolve exactly as the connection resolves them and the
// value cannot drift inside the transaction. The client receives a constructed
// environment: a private
// HOME, an explicitly empty PGPASSFILE, the selected service file through
// PGSERVICEFILE, the fixed service name `baton_context` through PGSERVICE, and
// no other assignment. No ambient environment value is inherited, so a
// caller's PGOPTIONS, PGHOST or credential file cannot reach the child.
//
// The service name and the environment are production invariants of this
// module. Analysis is reachable only through an open session whose catalog and
// plan reads share one live transaction, so a detached snapshot record cannot
// authorize an unverified planning read.
//
// Credential-bearing fields stay out of returned facts: identity carries
// engine, server version, database, role and the pinned search_path, and the
// service file path is an input.

import { spawnSync as defaultSpawnSync } from 'node:child_process';

import { digestJson } from './canonical.mjs';
import { scanSqlStatements } from './sql-scan.mjs';

export const POSTGRES_ENGINE = 'postgres-schema';
export const SERVICE_NAME = 'baton_context';
export const PLAN_GRANT = 'planTargetSql';

const EXCLUDED_SCHEMAS = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'";

const CATALOG_PAYLOAD = `SELECT encode(convert_to(json_build_object(
  'identity', json_build_object(
    'serverVersion', current_setting('server_version'),
    'serverVersionNum', current_setting('server_version_num'),
    'database', current_database(),
    'role', current_user,
    'searchPath', current_setting('search_path'),
    'connectionSearchPath', current_setting('search_path'),
    'transactionReadOnly', current_setting('transaction_read_only'),
    'isolation', current_setting('transaction_isolation')
  ),
  'entities', COALESCE((SELECT json_agg(json_build_object(
      'schema', e.schema, 'name', e.name, 'kind', e.kind, 'oid', e.oid,
      'persistence', e.persistence, 'rowSecurity', e.rowsecurity, 'forceRowSecurity', e.forcerowsecurity) ORDER BY e.schema, e.name)
    FROM (
      SELECT n.nspname AS schema, c.relname AS name, c.oid::text AS oid,
             c.relpersistence AS persistence, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity,
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned-table' WHEN 'v' THEN 'view'
                            WHEN 'm' THEN 'materialized-view' WHEN 'f' THEN 'foreign-table' ELSE c.relkind::text END AS kind
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${EXCLUDED_SCHEMAS}
    ) e), '[]'::json),
  'columns', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'table', c.relname, 'ordinal', a.attnum, 'name', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
      'default', CASE WHEN d.adbin IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
      'identity', CASE a.attidentity WHEN '' THEN NULL ELSE a.attidentity END,
      'generated', CASE a.attgenerated WHEN '' THEN NULL ELSE a.attgenerated END,
      'collation', co.collname) ORDER BY n.nspname, c.relname, a.attnum)
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
    WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${EXCLUDED_SCHEMAS}
  ), '[]'::json),
  'constraints', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', con.conname,
      'kind', CASE con.contype WHEN 'p' THEN 'primaryKey' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreignKey'
                               WHEN 'c' THEN 'check' ELSE con.contype::text END,
      'deferrable', con.condeferrable, 'deferred', con.condeferred, 'validated', con.convalidated,
      'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
      'columns', (SELECT json_agg(a.attname ORDER BY k.ord)
                  FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
      'referenced', CASE WHEN con.confrelid = 0 THEN NULL ELSE json_build_object(
          'schema', (SELECT n2.nspname FROM pg_catalog.pg_class c2 JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace WHERE c2.oid = con.confrelid),
          'table', (SELECT c2.relname FROM pg_catalog.pg_class c2 WHERE c2.oid = con.confrelid),
          'columns', (SELECT json_agg(a.attname ORDER BY k.ord)
                      FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum)) END
    ) ORDER BY n.nspname, c.relname, con.conname)
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype IN ('p', 'u', 'f', 'c', 'x') AND ${EXCLUDED_SCHEMAS}
  ), '[]'::json),
  'indexes', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', ic.relname,
      'unique', i.indisunique, 'primary', i.indisprimary, 'keyCount', i.indnkeyatts,
      'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
      'predicate', CASE WHEN i.indpred IS NULL THEN NULL ELSE pg_catalog.pg_get_expr(i.indpred, i.indrelid) END,
      'hasExpressions', i.indexprs IS NOT NULL,
      'columns', (SELECT json_agg(a.attname ORDER BY k.ord)
                  FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
                  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                  WHERE k.ord <= i.indnkeyatts)
    ) ORDER BY n.nspname, c.relname, ic.relname)
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'm') AND ${EXCLUDED_SCHEMAS}
  ), '[]'::json),
  'views', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'name', c.relname, 'kind', c.relkind::text,
      'definition', pg_catalog.pg_get_viewdef(c.oid, true)) ORDER BY n.nspname, c.relname)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm') AND ${EXCLUDED_SCHEMAS}
  ), '[]'::json),
  'types', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'name', t.typname,
      'kind', CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' ELSE t.typtype::text END,
      'baseType', CASE WHEN t.typtype = 'd' THEN pg_catalog.format_type(t.typbasetype, t.typtypmod) END,
      'labels', CASE WHEN t.typtype = 'e' THEN (SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder)
                                                FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid) END
    ) ORDER BY n.nspname, t.typname)
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype IN ('e', 'd') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  ), '[]'::json),
  'policies', COALESCE((SELECT json_agg(json_build_object(
      'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname, 'permissive', p.permissive,
      'roles', p.roles::text, 'command', p.cmd, 'using', p.qual, 'check', p.with_check) ORDER BY p.schemaname, p.tablename, p.policyname)
    FROM pg_catalog.pg_policies p WHERE p.schemaname NOT IN ('pg_catalog', 'information_schema')
  ), '[]'::json)
)::text, 'UTF8'), 'base64') AS payload;`;

const CATALOG_LIMITS = Object.freeze([
  {
    projection: 'constraints',
    code: 'enforcementNotObserved',
    detail: 'pg_constraint rows establish declared constraints; whether a connection enforces them requires an executed witness with that connection role',
  },
  {
    projection: 'catalog',
    code: 'rowDataNotCaptured',
    detail: 'catalog capture reads no table rows and claims no row-data snapshot',
  },
  {
    projection: 'catalog',
    code: 'roleSearchPathAssumption',
    detail: 'catalog and plan facts hold for the recorded role and pinned search_path; row-level security and column privileges change what another role observes',
  },
]);

// The child environment carries the fixed base assignments only, so an ambient
// PG* variable, .psqlrc, password file or service file cannot be inherited.
export function postgresEnvironment({ serviceFile, home, tempDirectory, path = '/usr/bin:/bin' }) {
  if (typeof serviceFile !== 'string' || serviceFile.length === 0) throw new TypeError('serviceFile must name the selected libpq service file');
  if (typeof home !== 'string' || home.length === 0) throw new TypeError('home must name the private HOME directory');
  const env = {
    HOME: home,
    TMPDIR: tempDirectory ?? home,
    PGPASSFILE: '',
    PGSERVICEFILE: serviceFile,
    PGSERVICE: SERVICE_NAME,
    PATH: path,
    LC_ALL: 'C',
  };
  const allowed = new Set(['HOME', 'TMPDIR', 'PGPASSFILE', 'PGSERVICEFILE', 'PGSERVICE', 'PATH', 'LC_ALL']);
  for (const key of Object.keys(env)) {
    if (!allowed.has(key)) throw new RangeError(`child environment member ${key} is outside the fixed base`);
  }
  return env;
}

function runPsql({ psql, env, input, spawnSync }) {
  const result = spawnSync(psql, ['-X', '-w', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-d', `service=${SERVICE_NAME}`, '-f', '-'], {
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? null,
  };
}

function psqlFailure(run) {
  return {
    reason: run.error ? 'psqlSpawnFailed' : 'psqlFailed',
    detail: run.error ? String(run.error.message) : `psql exited with status ${run.status}${run.signal ? ` on signal ${run.signal}` : ''}`,
    engineError: { status: run.status, signal: run.signal, stderr: run.stderr.trim() },
  };
}

function decodeBase64Document(payload) {
  if (payload.length === 0) return { status: 'refused', reason: 'emptyCatalogOutput', detail: 'psql returned no payload row' };
  try {
    return { status: 'ok', document: JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) };
  } catch (error) {
    return { status: 'refused', reason: 'catalogDecodeFailed', detail: error.message };
  }
}

function pgLiteral(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

export function postgresCatalogDigest(catalog) {
  return digestJson({
    entities: catalog.entities,
    columns: catalog.columns,
    constraints: catalog.constraints,
    indexes: catalog.indexes,
    views: catalog.views,
    types: catalog.types,
    policies: catalog.policies,
  });
}

function snapshotFromDocument(document) {
  const catalog = {
    entities: document.entities,
    columns: document.columns,
    constraints: document.constraints,
    indexes: document.indexes,
    views: document.views,
    types: document.types,
    policies: document.policies,
    relationships: document.constraints.filter(entry => entry.kind === 'foreignKey' && entry.referenced !== null).map(entry => ({
      schema: entry.schema,
      table: entry.table,
      name: entry.name,
      from: entry.columns,
      to: entry.referenced.columns,
      references: { schema: entry.referenced.schema, table: entry.referenced.table },
      deferrable: entry.deferrable,
      deferred: entry.deferred,
      validated: entry.validated,
      classification: 'declared',
    })),
  };
  const limits = [...CATALOG_LIMITS];
  for (const entity of catalog.entities) {
    if (entity.kind === 'foreign-table') {
      limits.push({
        projection: 'entities',
        code: 'foreignTableUnsupported',
        detail: `relation ${entity.schema}.${entity.name} is a foreign table; remote relation identity and contents are outside the admitted profile`,
      });
    }
    if (entity.kind === 'materialized-view') {
      limits.push({
        projection: 'entities',
        code: 'materializedViewDefinition',
        detail: `relation ${entity.schema}.${entity.name} is a materialized view; its stored rows are not captured and its freshness is unobserved`,
      });
    }
  }
  for (const index of catalog.indexes) {
    if (index.hasExpressions) {
      limits.push({
        projection: 'indexes',
        code: 'expressionIndexTextOnly',
        detail: `index ${index.schema}.${index.name} has expression keys; the expression text stays in its stored definition`,
      });
    }
  }
  const core = {
    engine: POSTGRES_ENGINE,
    version: document.identity.serverVersion,
    versionNum: Number(document.identity.serverVersionNum),
    database: document.identity.database,
    role: document.identity.role,
    searchPath: document.identity.searchPath,
    connectionSearchPath: document.identity.connectionSearchPath ?? document.identity.searchPath,
    searchPathRule: 'catalog statements are pg_catalog-qualified; a plan transaction pins this recorded connection value for its own transaction',
    transactionReadOnly: document.identity.transactionReadOnly === 'on',
    isolation: document.identity.isolation,
    catalogReadsAreSchemaQualified: true,
    catalogDigest: postgresCatalogDigest(catalog),
  };
  return {
    catalog,
    limits,
    identity: {
      ...core,
      snapshotId: digestJson({
        provider: POSTGRES_ENGINE,
        version: core.version,
        versionNum: core.versionNum,
        database: core.database,
        role: core.role,
        searchPath: core.searchPath,
        catalogDigest: core.catalogDigest,
      }),
    },
  };
}

// Difference between two captures of one subject, for read-time applicability.
// Both sides name what they compared.
export function comparePostgresIdentities(before, after) {
  const changed = [];
  if (before.database !== after.database) changed.push('database');
  if (before.role !== after.role) changed.push('role');
  if (before.searchPath !== after.searchPath) changed.push('searchPath');
  if (before.versionNum !== after.versionNum) changed.push('serverVersion');
  if (before.catalogDigest !== after.catalogDigest) changed.push('catalogDigest');
  return { applicability: changed.length === 0 ? 'current' : 'stale', changedInputs: changed };
}

export function openPostgresSession({ psql, serviceFile, home, tempDirectory, path, spawnSync = defaultSpawnSync }) {
  const env = postgresEnvironment({ serviceFile, home, tempDirectory, path });
  const captureScript = ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', CATALOG_PAYLOAD, 'COMMIT;', ''].join('\n');
  const run = runPsql({ psql, env, input: captureScript, spawnSync });
  if (run.error || run.status !== 0) {
    return { kind: 'postgresSession', status: 'refused', refusal: psqlFailure(run), client: { psql, serviceFile } };
  }
  const decoded = decodeBase64Document(run.stdout.trim());
  if (decoded.status !== 'ok') return { kind: 'postgresSession', status: 'refused', refusal: decoded, client: { psql, serviceFile } };
  const snapshot = snapshotFromDocument(decoded.document);
  const session = {
    kind: 'postgresSession',
    status: 'captured',
    identity: snapshot.identity,
    catalog: snapshot.catalog,
    limits: snapshot.limits,
    client: { psql, serviceFile, serviceName: SERVICE_NAME },
    closed: false,
    // Catalog and plan come from one psql invocation, one connection and one
    // read-only transaction. The fresh identity is compared with the session
    // identity before its plan facts are returned.
    analyze({ sql, effects = [] }) {
      if (session.closed) throw new Error('the session is closed');
      if (!effects.includes(PLAN_GRANT)) {
        return {
          status: 'refused',
          spawned: false,
          refusal: {
            reason: 'missingEffectGrant',
            detail: `planning target SQL requires the ${PLAN_GRANT} grant; no client was started`,
          },
        };
      }
      const framing = scanSqlStatements(sql, { dialect: 'postgres' });
      if (framing.unterminated !== null || framing.statementCount !== 1 || framing.trailingHasContent) {
        return {
          status: 'refused',
          spawned: false,
          refusal: {
            reason: framing.unterminated ? 'unterminatedLiteral' : 'multipleStatements',
            detail: framing.unterminated
              ? `unterminated ${framing.unterminated.quote} at code-unit offset ${framing.unterminated.offset}`
              : `the text carries ${framing.statementCount} statements; admitted constant SQL is one statement`,
          },
        };
      }
      const script = [
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
        `SET LOCAL search_path = ${pgLiteral(session.identity.connectionSearchPath)};`,
        'SET LOCAL plan_cache_mode = force_generic_plan;',
        CATALOG_PAYLOAD,
        `PREPARE baton_ctx_plan AS ${sql};`,
        'EXPLAIN (FORMAT JSON) EXECUTE baton_ctx_plan;',
        'COMMIT;',
        '',
      ].join('\n');
      const planRun = runPsql({ psql, env, input: script, spawnSync });
      if (planRun.error || planRun.status !== 0) {
        return { status: 'refused', spawned: true, refusal: psqlFailure(planRun) };
      }
      const newlineIndex = planRun.stdout.indexOf('\n');
      if (newlineIndex === -1) {
        return { status: 'refused', spawned: true, refusal: { reason: 'emptyCatalogOutput', detail: 'the plan invocation returned one line and no plan document' } };
      }
      const decodedInPlan = decodeBase64Document(planRun.stdout.slice(0, newlineIndex).trim());
      if (decodedInPlan.status !== 'ok') return { status: 'refused', spawned: true, refusal: decodedInPlan };
      const fresh = snapshotFromDocument(decodedInPlan.document).identity;
      const comparison = comparePostgresIdentities(session.identity, fresh);
      if (comparison.applicability !== 'current') {
        return {
          status: 'refused',
          spawned: true,
          refusal: {
            reason: 'snapshotChanged',
            detail: `the subject identity changed during the plan transaction: ${comparison.changedInputs.join(', ')}`,
            observed: { database: fresh.database, role: fresh.role, searchPath: fresh.searchPath, versionNum: fresh.versionNum, catalogDigest: fresh.catalogDigest },
          },
        };
      }
      const planText = planRun.stdout.slice(newlineIndex + 1).trim();
      const firstBracket = planText.indexOf('[');
      const lastBracket = planText.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket <= firstBracket) {
        return { status: 'refused', spawned: true, refusal: { reason: 'planOutputUnparsable', detail: planText.slice(0, 400) } };
      }
      let planDocument;
      try {
        planDocument = JSON.parse(planText.slice(firstBracket, lastBracket + 1));
      } catch (error) {
        return { status: 'refused', spawned: true, refusal: { reason: 'planOutputUnparsable', detail: error.message } };
      }
      const extracted = extractPostgresPlanRelations(planDocument);
      return {
        status: 'analyzed',
        spawned: true,
        sql,
        kind: postgresStatementKind(planDocument),
        snapshotId: session.identity.snapshotId,
        searchPath: session.identity.searchPath,
        planMode: 'force_generic_plan',
        relations: extracted.relations,
        nodeTypes: extracted.nodeTypes,
        limits: [
          {
            projection: 'databaseAccesses',
            code: 'planModePinned',
            detail: 'plan facts come from PREPARE plus EXPLAIN (FORMAT JSON) EXECUTE under plan_cache_mode=force_generic_plan; the target statement is never executed',
          },
          {
            projection: 'databaseAccesses',
            code: 'valueDependenceUnobserved',
            detail: 'a generic plan is taken with no bound values; a custom plan for particular parameter values may differ',
          },
        ],
      };
    },
    revalidate() {
      const fresh = runPsql({ psql, env, input: ['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', CATALOG_PAYLOAD, 'COMMIT;', ''].join('\n'), spawnSync });
      if (fresh.error || fresh.status !== 0) return { applicability: 'unknown', changedInputs: ['captureUnavailable'], refusal: psqlFailure(fresh) };
      const decodedFresh = decodeBase64Document(fresh.stdout.trim());
      if (decodedFresh.status !== 'ok') return { applicability: 'unknown', changedInputs: ['captureUnavailable'], refusal: decodedFresh };
      return comparePostgresIdentities(session.identity, snapshotFromDocument(decodedFresh.document).identity);
    },
    close() {
      session.closed = true;
    },
  };
  return session;
}

// A convenience capture with no later analysis. Statement analysis requires the
// open session above.
export function capturePostgresSnapshot({ psql, serviceFile, home, tempDirectory, path, spawnSync = defaultSpawnSync }) {
  const session = openPostgresSession({ psql, serviceFile, home, tempDirectory, path, spawnSync });
  if (session.status !== 'captured') return session;
  const { identity, catalog, limits } = session;
  session.close();
  return { status: 'captured', identity, catalog, limits, client: session.client };
}

export function extractPostgresPlanRelations(planDocument) {
  const relations = [];
  const nodeTypes = [];
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (typeof node['Node Type'] === 'string') {
      nodeTypes.push(node['Node Type']);
      if (typeof node['Relation Name'] === 'string') {
        relations.push({
          name: node['Relation Name'],
          schema: typeof node.Schema === 'string' ? node.Schema : null,
          alias: typeof node.Alias === 'string' ? node.Alias : null,
          nodeType: node['Node Type'],
          status: 'pending-catalog-join',
        });
      }
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(planDocument);
  const unique = new Map();
  for (const relation of relations) {
    const key = `${relation.schema ?? ''}\u0000${relation.name}`;
    if (!unique.has(key)) unique.set(key, relation);
  }
  return { relations: [...unique.values()], nodeTypes: [...new Set(nodeTypes)] };
}

function postgresStatementKind(planDocument) {
  const first = Array.isArray(planDocument) ? planDocument[0] : planDocument;
  const nodeType = first?.Plan?.['Node Type'];
  if (typeof nodeType !== 'string') return 'unknown';
  if (/ModifyTable/.test(nodeType)) {
    const operation = first.Plan.Operation;
    return operation === 'Insert' ? 'write-insert' : operation === 'Update' ? 'write-update' : operation === 'Delete' ? 'write-delete' : 'write';
  }
  return 'read';
}

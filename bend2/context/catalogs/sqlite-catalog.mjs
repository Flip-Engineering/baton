// Read-only SQLite catalog capture for the entity and TypeScript profiles.
//
// One connection, explicit `BEGIN DEFERRED`, an initial catalog read that
// acquires the read snapshot, and every catalog and plan read inside that
// transaction. Analysis is reachable only through the open session, so a
// detached snapshot record cannot authorize a second, silently unverified
// planning read. The connection opens with the binding's read-only option and
// refuses a missing subject file.
//
// Identity uses the real path, the file identity, the SQLite version and
// source id, schema_version, journal mode, the normalized catalog digest and
// the connection flags. `data_version` is recorded as a separate observation:
// a data-only write moves it while the schema stays the same, so it takes no
// part in catalog applicability. WAL and shared-memory file hashes are absent
// for the same reason.

import { existsSync, realpathSync, statSync } from 'node:fs';

import { canonicalJson, digestJson } from './canonical.mjs';
import { analyzeSqliteStatement, joinRootpages, probeOriginCapability } from './sqlite-statement.mjs';
import { joinConstantSql } from './sql-join.mjs';

export const SQLITE_SCHEMA = 'main';

const CATALOG_LIMITS = Object.freeze([
  {
    projection: 'constraints',
    code: 'ddlTextOnly',
    detail: 'CHECK expressions, DEFERRABLE clauses, partial-index predicates, expression-index expressions and generated-column expressions are returned as stored DDL text; SQLite exposes no structural form',
  },
  {
    projection: 'constraints',
    code: 'enforcementNotObserved',
    detail: 'a catalog row establishes a declared constraint; whether a connection enforces it requires an executed witness and that connection configuration',
  },
  {
    projection: 'columns',
    code: 'collationUnavailable',
    detail: 'the collation of a column that no index names is not recoverable from the SQLite catalog',
  },
  {
    projection: 'catalog',
    code: 'rowDataNotCaptured',
    detail: 'catalog capture reads no table rows and claims no row-data snapshot',
  },
]);

function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function pragma(db, schema, name, argument) {
  const target = argument === undefined ? `${schema}.${name}` : `${schema}.${name}(${quoteIdentifier(argument)})`;
  return db.prepare(`PRAGMA ${target}`).all();
}

function pragmaValue(db, schema, name) {
  const rows = pragma(db, schema, name);
  if (rows.length === 0) return null;
  return rows[0][Object.keys(rows[0])[0]];
}

export function fileIdentityOf(path) {
  const realPath = realpathSync(path);
  const stat = statSync(realPath);
  return { realPath, device: String(stat.dev), inode: String(stat.ino), bytes: stat.size, mode: stat.mode };
}

// A read-only open refuses a missing subject file instead of creating it. The
// admitted operand is an existing regular file named by an ordinary path: a
// `file:` URI, a VFS selector or a non-regular file refuses before the open,
// and the opened connection must report that same real path as its main
// database.
export function openReadOnlySqlite({ path, DatabaseSync }) {
  if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must name the subject database');
  if (typeof DatabaseSync !== 'function') throw new TypeError('DatabaseSync constructor is required');
  if (path.startsWith('file:') || path.includes('?vfs=')) {
    throw new RangeError('the admitted database operand is an ordinary path; a URI or VFS selector is outside the read-only profile');
  }
  if (!existsSync(path)) {
    throw new RangeError(`the subject path ${path} does not name an existing file; a read-only open creates nothing`);
  }
  const fileIdentity = fileIdentityOf(path);
  const stat = statSync(fileIdentity.realPath);
  if (!stat.isFile()) throw new RangeError(`the subject path ${fileIdentity.realPath} is not a regular file`);
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  const list = db.prepare('PRAGMA main.database_list').all();
  const main = list.find(row => row.name === SQLITE_SCHEMA);
  if (main === undefined || main.file === '' || main.file === null) {
    db.close();
    throw new RangeError('the opened connection reports no main database file');
  }
  if (realpathSync(main.file) !== fileIdentity.realPath) {
    const reported = realpathSync(main.file);
    db.close();
    throw new RangeError(`the opened connection reports ${reported}, not the admitted path ${fileIdentity.realPath}`);
  }
  return { db, path, fileIdentity };
}

export function readSqliteCatalog(db, { schema = SQLITE_SCHEMA } = {}) {
  const schemaRows = db
    .prepare(`SELECT type, name, tbl_name, rootpage, sql FROM ${quoteIdentifier(schema)}.sqlite_schema ORDER BY type, name`)
    .all()
    .map(row => ({ type: row.type, name: row.name, table: row.tbl_name, rootpage: Number(row.rootpage), sql: row.sql ?? null }));

  const tableList = pragma(db, schema, 'table_list').map(row => ({
    schema: row.schema,
    name: row.name,
    type: row.type,
    ncol: Number(row.ncol),
    withoutRowid: Number(row.wr) === 1,
    strict: Number(row.strict) === 1,
  }));

  const entities = [];
  const columns = [];
  const keys = [];
  const indexes = [];
  const relationships = [];
  const constraints = [];
  const views = [];
  const triggers = [];
  const limits = [];
  const rootpages = {};

  for (const row of schemaRows) {
    if (row.rootpage > 0) {
      const key = String(row.rootpage);
      if (rootpages[key] === undefined) rootpages[key] = [];
      rootpages[key].push({ schema, name: row.name, type: row.type, table: row.table });
    }
    if (row.type === 'trigger') triggers.push({ schema, name: row.name, table: row.table, sql: row.sql });
  }

  for (const table of tableList) {
    if (table.schema !== schema || table.name === 'sqlite_schema') continue;
    const kind = table.type === 'virtual' ? 'virtual-table' : table.type;
    const tableIndexes = [];

    const xinfo = pragma(db, schema, 'table_xinfo', table.name);
    const declaredPrimaryKey = [];
    for (const column of xinfo) {
      const hidden = Number(column.hidden);
      columns.push({
        schema,
        table: table.name,
        ordinal: Number(column.cid),
        name: column.name,
        declaredType: column.type === '' ? null : column.type,
        notNull: Number(column.notnull) === 1,
        defaultValue: column.dflt_value ?? null,
        primaryKeyOrdinal: Number(column.pk) || null,
        hidden: hidden === 0 ? 'normal' : hidden === 1 ? 'virtual-table-hidden' : hidden === 2 ? 'generated-virtual' : 'generated-stored',
      });
      if (Number(column.pk) > 0) declaredPrimaryKey.push({ ordinal: Number(column.pk), name: column.name, declaredType: column.type });
      if (hidden !== 0) {
        limits.push({
          projection: 'columns',
          code: 'hiddenColumn',
          detail: `column ${table.name}.${column.name} is a ${hidden === 1 ? 'hidden virtual-table' : 'generated'} column; its expression stays in stored DDL text`,
        });
      }
    }
    declaredPrimaryKey.sort((left, right) => left.ordinal - right.ordinal);

    for (const index of pragma(db, schema, 'index_list', table.name)) {
      const indexColumns = pragma(db, schema, 'index_xinfo', index.name).map(entry => ({
        seqno: Number(entry.seqno),
        cid: Number(entry.cid),
        name: entry.name ?? null,
        desc: Number(entry.desc) === 1,
        collation: entry.coll ?? null,
        key: Number(entry.key) === 1,
      }));
      const ddl = schemaRows.find(entry => entry.type === 'index' && entry.name === index.name)?.sql ?? null;
      const record = {
        schema,
        table: table.name,
        name: index.name,
        unique: Number(index.unique) === 1,
        origin: index.origin,
        partial: Number(index.partial) === 1,
        columns: indexColumns,
        sql: ddl,
      };
      indexes.push(record);
      tableIndexes.push(record);
      const keyColumns = indexColumns.filter(entry => entry.key && entry.name !== null).map(entry => entry.name);
      if (keyColumns.length > 0 && (index.origin === 'pk' || index.origin === 'u')) {
        keys.push({
          schema,
          table: table.name,
          kind: index.origin === 'pk' ? 'primaryKey' : 'unique',
          columns: keyColumns,
          index: index.name,
          origin: index.origin,
        });
      }
      if (Number(index.partial) === 1 && ddl === null) {
        limits.push({
          projection: 'indexes',
          code: 'expressionTextOnly',
          detail: `index ${index.name} has no stored DDL text; its predicate and expressions are unavailable`,
        });
      }
    }

    // A rowid table whose declared single-column primary key has declared type
    // INTEGER uses that column as the rowid alias, and the engine reports reads
    // of it as rowid. SQLite emits no separate primary-key index for it.
    const hasSeparatePrimaryKeyIndex = tableIndexes.some(entry => entry.origin === 'pk');
    const rowidAlias = !table.withoutRowid
      && !hasSeparatePrimaryKeyIndex
      && declaredPrimaryKey.length === 1
      && /^INTEGER$/i.test(declaredPrimaryKey[0].declaredType ?? '')
      ? declaredPrimaryKey[0].name
      : null;
    if (rowidAlias !== null || (!hasSeparatePrimaryKeyIndex && declaredPrimaryKey.length > 0)) {
      keys.push({
        schema,
        table: table.name,
        kind: 'primaryKey',
        columns: declaredPrimaryKey.map(entry => entry.name),
        index: null,
        origin: rowidAlias !== null ? 'rowid-alias' : 'declared',
      });
    }

    const tableRelationships = pragma(db, schema, 'foreign_key_list', table.name).map(foreign => ({
      schema,
      table: table.name,
      id: Number(foreign.id),
      seq: Number(foreign.seq),
      references: { schema, table: foreign.table },
      from: foreign.from,
      to: foreign.to ?? null,
      onUpdate: foreign.on_update ?? null,
      onDelete: foreign.on_delete ?? null,
      match: foreign.match ?? null,
    }));
    relationships.push(...tableRelationships);

    entities.push({
      schema,
      name: table.name,
      kind,
      ncol: table.ncol,
      withoutRowid: table.withoutRowid,
      strict: table.strict,
      rowidAliasColumn: rowidAlias,
    });

    if (kind === 'virtual-table') {
      limits.push({
        projection: 'entities',
        code: 'virtualTableUnsupported',
        detail: `virtual table ${table.name} reports its declared shape only; rows, modules and hidden columns are outside the admitted profile`,
      });
    }

    if (kind === 'table') {
      constraints.push({
        schema,
        table: table.name,
        kind: 'tableDefinition',
        definition: 'ddl-text',
        classification: 'declared',
        ddlText: schemaRows.find(entry => entry.type === 'table' && entry.name === table.name)?.sql ?? null,
        detail: 'column types, CHECK expressions, DEFERRABLE clauses and generated expressions appear in this DDL text only',
      });
      for (const relationship of tableRelationships) {
        constraints.push({
          schema,
          table: table.name,
          kind: 'foreignKey',
          definition: 'pragma-rows',
          classification: 'declared',
          ddlText: null,
          detail: `declared foreign key to ${relationship.references.table} with on_update=${relationship.onUpdate} on_delete=${relationship.onDelete}`,
        });
      }
    }
    if (kind === 'view') {
      views.push({
        schema,
        name: table.name,
        columnCount: table.ncol,
        ddlText: schemaRows.find(entry => entry.type === 'view' && entry.name === table.name)?.sql ?? null,
      });
    }
  }

  return {
    schema,
    catalog: { schema, entities, columns, keys, indexes, relationships, constraints, views, triggers, rootpages, schemaRows },
    limits,
  };
}

export function sqliteCatalogDigest(catalog) {
  return digestJson({
    schemaRows: catalog.schemaRows,
    entities: catalog.entities,
    columns: catalog.columns,
    keys: catalog.keys,
    indexes: catalog.indexes,
    relationships: catalog.relationships,
    views: catalog.views,
    triggers: catalog.triggers,
  });
}

function connectionIdentity(db) {
  const library = db.prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS source_id').get();
  return {
    libraryVersion: library.version,
    librarySourceId: library.source_id,
    schemaVersion: Number(pragmaValue(db, SQLITE_SCHEMA, 'schema_version')),
    dataVersion: Number(pragmaValue(db, SQLITE_SCHEMA, 'data_version')),
    journalMode: pragmaValue(db, SQLITE_SCHEMA, 'journal_mode'),
    foreignKeys: Number(pragmaValue(db, SQLITE_SCHEMA, 'foreign_keys')),
  };
}

function snapshotIdentity({ opened, connection, catalogDigest }) {
  return {
    engine: 'sqlite-schema',
    version: connection.libraryVersion,
    sourceId: connection.librarySourceId,
    path: opened.path,
    realPath: opened.fileIdentity.realPath,
    fileIdentity: { device: opened.fileIdentity.device, inode: opened.fileIdentity.inode, bytes: opened.fileIdentity.bytes },
    schemaVersion: connection.schemaVersion,
    journalMode: connection.journalMode,
    catalogDigest,
    connection: { readOnly: true, foreignKeys: connection.foreignKeys === 1, doubleQuotedStringLiterals: false, database: SQLITE_SCHEMA },
    observations: { dataVersion: connection.dataVersion, dataVersionRole: 'concurrent-write counter; excluded from catalog applicability' },
  };
}

// Applicability compares the identities that describe the schema: the real
// path and file identity, the SQLite version and source id, and the normalized
// catalog digest. A data-only write moves data_version and leaves these equal,
// so the earlier catalog stays current.
export function compareSqliteIdentities(before, after) {
  const changed = [];
  if (before.realPath !== after.realPath) changed.push('realPath');
  if (before.fileIdentity.device !== after.fileIdentity.device || before.fileIdentity.inode !== after.fileIdentity.inode) changed.push('fileIdentity');
  if (before.version !== after.version) changed.push('engineVersion');
  if (before.sourceId !== after.sourceId) changed.push('engineSourceId');
  if (before.catalogDigest !== after.catalogDigest) changed.push('catalogDigest');
  return {
    applicability: changed.length === 0 ? 'current' : 'stale',
    changedInputs: changed,
    dataVersionBefore: before.observations?.dataVersion ?? null,
    dataVersionAfter: after.observations?.dataVersion ?? null,
  };
}

export function createSqliteSession({ path, DatabaseSync }) {
  const opened = openReadOnlySqlite({ path, DatabaseSync });
  const { db } = opened;
  db.exec('BEGIN DEFERRED');
  const connection = connectionIdentity(db);
  const { catalog, limits } = readSqliteCatalog(db, { schema: SQLITE_SCHEMA });
  const catalogDigest = sqliteCatalogDigest(catalog);
  const identity = snapshotIdentity({ opened, connection, catalogDigest });
  const originCapability = probeOriginCapability({ db, catalog });
  const annotated = { ...identity, snapshotId: digestJson({ provider: identity.engine, version: identity.version, sourceId: identity.sourceId, path: identity.realPath, fileIdentity: identity.fileIdentity, catalogDigest }) };
  const planCache = new Map();
  const session = {
    kind: 'sqliteSession',
    identity: annotated,
    catalog,
    originCapability,
    limits: [...CATALOG_LIMITS, ...limits, ...(originCapability.available ? [] : [{
      projection: 'columnOrigins',
      code: originCapability.reason ?? 'originCapabilityUnqualified',
      detail: originCapability.detail ?? 'result-name origins are unavailable for this subject',
    }])],
    closed: false,
    analyze({ id = null, sql }) {
      if (session.closed) throw new Error('the session is closed');
      return { id, ...joinRootpages({ plan: analyzeSqliteStatement({ db, sql, originCapability }), catalog }) };
    },
    join({ records, engineProbe = null }) {
      if (session.closed) throw new Error('the session is closed');
      return joinConstantSql({ session, catalog, plans: planCache, records, engineProbe });
    },
    // Re-read of the connection identity inside the open transaction. The
    // catalog digest cannot move inside one read transaction; the observation
    // reports that the connection values the capture used still hold.
    stability() {
      if (session.closed) throw new Error('the session is closed');
      const after = connectionIdentity(db);
      return { stableWithinTransaction: canonicalJson(connection) === canonicalJson(after), before: connection, after };
    },
    close() {
      if (session.closed) return;
      session.closed = true;
      try {
        db.exec('COMMIT');
      } catch {
        // A read-only transaction that already ended reports its own error
        // here; the close below still releases the connection.
      }
      db.close();
    },
  };
  return session;
}

// Convenience wrapper for callers that need a capture and no later analysis.
// The session is the only path to statement analysis inside the snapshot.
export function captureSqliteSnapshot({ path, DatabaseSync, statements = [] }) {
  const session = createSqliteSession({ path, DatabaseSync });
  try {
    const plans = statements.map(statement => session.analyze(statement));
    const { catalog, limits, identity } = session;
    return { identity, catalog, plans, limits, stableWithinTransaction: session.stability().stableWithinTransaction };
  } finally {
    session.close();
  }
}

// The transaction is open and the identity is fixed; a caller that holds only
// the returned record cannot analyze a statement in it.

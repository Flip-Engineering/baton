// SQLite statement analysis for the constant-SQL join.
//
// Relation identity comes from the engine: the statement is prepared and its
// EXPLAIN program is stepped. The original statement is never stepped, so a
// write statement stays unexecuted. The Node binding exposes neither
// `sqlite3_stmt_readonly` nor `sqlite3_stmt_isexplain`; both are reported as
// limits, and the provider compensates by stepping only the EXPLAIN form.
//
// A program access operand names a catalog object through three fields that
// together form its identity: the database number, the rootpage and the
// schema. Rootpage alone is not identity, and an operand outside the admitted
// main database or one that matches several objects stays unavailable.

import { scanSqlStatements, validateSqlText } from './sql-scan.mjs';

const OBJECT_OPCODES = Object.freeze(['OpenRead', 'OpenWrite']);
const WRITE_OPCODES = Object.freeze(['OpenWrite', 'Insert', 'Delete', 'Update', 'IdxInsert', 'IdxDelete', 'Clear']);
const MAIN_DATABASE = 0;

// The Node binding prepares the first statement of a text and silently drops
// the rest, so the provider frames the text before preparing it and refuses a
// text that carries more than one statement.
export function statementFraming(sql) {
  const text = validateSqlText(sql);
  if (text.status !== 'admitted') return text;
  const scan = scanSqlStatements(sql, { dialect: 'sqlite' });
  if (scan.unterminated) {
    return { status: 'refused', reason: 'unterminatedLiteral', detail: `unterminated ${scan.unterminated.quote} at byte offset ${scan.unterminated.offset}` };
  }
  if (scan.statementCount === 0) return { status: 'refused', reason: 'emptyStatement', detail: 'the text carries no statement' };
  if (scan.statementCount > 1 || scan.trailingHasContent) {
    return {
      status: 'refused',
      reason: 'multipleStatements',
      detail: `the text carries ${scan.statementCount} statements; admitted constant SQL is one statement`,
      separators: scan.separators,
    };
  }
  return { status: 'admitted', statement: scan.statements[0] };
}

// Result-name origins are a provider capability, qualified by a probe over the
// subject catalog rather than assumed from the binding version. The backing
// C API is compile-time optional, so a non-null observation on a real
// two-column projection is the qualification.
export function probeOriginCapability({ db, catalog }) {
  if (typeof db.prepare('SELECT 1').columns !== 'function') {
    return {
      available: false,
      reason: 'column_origin_metadata_unavailable',
      detail: 'the binding exposes no columns() metadata; this is the Node 22.15.0 floor',
      probe: null,
    };
  }
  const table = catalog.entities.find(entity => entity.kind === 'table' && catalog.columns.some(column => column.table === entity.name && column.hidden === 'normal'));
  if (table === undefined) {
    return { available: false, reason: 'noProbeShape', detail: 'the subject catalog holds no table with a declared column to probe', probe: null };
  }
  const probes = catalog.columns.filter(column => column.table === table.name && column.hidden === 'normal');
  const first = probes[0];
  const second = probes[1] ?? first;
  const probeSql = `SELECT ${table.name}.${first.name} AS p0, ${table.name}.${second.name} AS p1 FROM ${table.name}`;
  let observed;
  try {
    observed = db.prepare(probeSql).columns().map(column => ({ resultName: column.name, database: column.database ?? null, table: column.table ?? null, column: column.column ?? null }));
  } catch (error) {
    return { available: false, reason: 'probeRefused', detail: error.message, probe: { sql: probeSql, columns: [] } };
  }
  const qualified = observed.length > 0 && observed.every(column => column.table !== null && column.column !== null);
  return {
    available: qualified,
    reason: qualified ? null : 'probeReturnedNullOrigins',
    detail: qualified
      ? 'the probe returned a base table and column for every result column'
      : 'the probe returned a null origin, so the binding cannot supply result-name origins for this subject',
    probe: { sql: probeSql, columns: observed },
  };
}

export function analyzeSqliteStatement({ db, sql, originCapability = null }) {
  const framing = statementFraming(sql);
  if (framing.status !== 'admitted') {
    return { sql, status: 'refused', kind: null, relations: [], unknownAccess: [], parameters: { count: 0 }, origins: unavailableOrigins(), evidence: null, limits: [], refusal: framing };
  }
  let rows;
  try {
    rows = db.prepare(`EXPLAIN ${sql}`).all();
  } catch (error) {
    return {
      sql,
      status: 'refused',
      kind: null,
      relations: [],
      unknownAccess: [],
      parameters: { count: 0 },
      origins: unavailableOrigins(),
      evidence: null,
      limits: [],
      refusal: { status: 'refused', reason: 'engineParseRefused', detail: error.message, code: error.code ?? null },
    };
  }
  const opcodes = rows.map(row => row.opcode);
  const variables = rows.filter(row => row.opcode === 'Variable');
  if (variables.length > 0) {
    return {
      sql,
      status: 'refused',
      kind: null,
      relations: [],
      unknownAccess: [],
      parameters: { count: variables.length },
      origins: unavailableOrigins(),
      evidence: null,
      limits: [],
      refusal: {
        status: 'refused',
        reason: 'bindParametersUnsupported',
        detail: `the engine program carries ${variables.length} Variable opcode${variables.length === 1 ? '' : 's'}; admitted constant SQL binds no parameter`,
      },
    };
  }
  const kind = opcodes.some(opcode => WRITE_OPCODES.includes(opcode)) ? 'write' : 'read';
  const relations = rows.filter(row => OBJECT_OPCODES.includes(row.opcode)).map(row => ({
    opcode: row.opcode,
    cursor: row.p1,
    database: row.p3,
    rootpage: String(row.p2),
    // P4 carries engine transport text; it never supplies the join key.
    engineName: typeof row.p4 === 'string' && Number.isNaN(Number(row.p4)) ? row.p4 : null,
    name: null,
    object: null,
    status: 'pending-catalog-join',
  }));
  return {
    sql,
    status: 'analyzed',
    kind,
    relations,
    unknownAccess: [],
    origins: statementOrigins({ db, sql, originCapability }),
    parameters: { count: 0 },
    opcodes,
    limits: [
      {
        projection: 'databaseAccesses',
        code: 'statementFlagsUnavailable',
        detail: 'node:sqlite exposes no sqlite3_stmt_readonly or sqlite3_stmt_isexplain check; the provider steps only the EXPLAIN program and never the original statement',
      },
      {
        projection: 'databaseAccesses',
        code: 'statementBoundaryScan',
        detail: 'the Node binding discards a prepare tail; the single-statement boundary and trailing-text check are a byte scan, while relation identity comes from the engine program',
      },
    ],
  };
}

function unavailableOrigins(reason = 'statementNotAnalyzed') {
  return { availability: 'unavailable', reason, tier: null, columns: [] };
}

// Optional origin tier. The capability probe decides availability: the
// binding's columns() metadata is compile-time optional, and the Node 22.15.0
// floor has no columns() at all. Name equality between a result name and a
// stored column name establishes no origin, so no fallback mapping exists.
export function statementOrigins({ db, sql, originCapability }) {
  const capability = originCapability ?? probeOriginCapability({ db, catalog: { entities: [], columns: [] } });
  if (capability === null || capability.available !== true) {
    return {
      availability: 'unavailable',
      reason: capability?.reason ?? 'originCapabilityUnqualified',
      tier: null,
      detail: capability?.detail ?? 'no capability probe result was supplied',
      requiredEvidence: 'serializer or query alias mapping',
      columns: [],
    };
  }
  let observed;
  try {
    observed = db.prepare(sql).columns().map(column => ({
      resultName: column.name,
      database: column.database ?? null,
      table: column.table ?? null,
      column: column.column ?? null,
    }));
  } catch (error) {
    return { availability: 'unavailable', reason: 'prepareRefusedForOrigins', tier: null, detail: error.message, columns: [] };
  }
  const complete = observed.every(column => column.table !== null && column.column !== null);
  return {
    availability: complete ? 'available' : 'partial',
    reason: complete ? null : 'expression_origin_absent',
    tier: 'origin-metadata',
    detail: complete
      ? 'every result column reports its base table and column through the binding metadata'
      : 'the engine reports null origins for expression results; those mappings need the serializer or an alias mapping',
    requiredEvidence: complete ? null : 'serializer or query alias mapping',
    capabilityProbe: capability.probe,
    columns: observed,
  };
}

// Join the engine program's access operands against the captured catalog. The
// database number and the schema are part of the key: a temp or attached
// database, a page outside the catalog and a page matching several objects all
// stay available as independent plan facts with an explicit reason.
export function joinRootpages({ plan, catalog }) {
  if (plan.status !== 'analyzed') return plan;
  const relations = [];
  const unknownAccess = [];
  for (const access of plan.relations) {
    if (access.database !== MAIN_DATABASE) {
      unknownAccess.push({
        ...access,
        status: 'modeledAccessUnavailable',
        reason: 'nonMainDatabaseAccess',
        detail: `the program opens database number ${access.database}; temp and attached databases are outside the admitted catalog`,
      });
      continue;
    }
    const owners = catalog.rootpages[access.rootpage];
    if (owners === undefined || owners.length === 0) {
      unknownAccess.push({ ...access, status: 'modeledAccessUnavailable', reason: 'rootpageNotInCatalog' });
      continue;
    }
    if (owners.length > 1) {
      unknownAccess.push({ ...access, status: 'modeledAccessUnavailable', reason: 'ambiguousRootpage', detail: `rootpage ${access.rootpage} names ${owners.length} catalog objects` });
      continue;
    }
    const [owner] = owners;
    if (owner.schema !== catalog.schema) {
      unknownAccess.push({ ...access, status: 'modeledAccessUnavailable', reason: 'nonMainSchemaObject', detail: `rootpage ${access.rootpage} belongs to schema ${owner.schema}` });
      continue;
    }
    relations.push({
      opcode: access.opcode,
      cursor: access.cursor,
      database: access.database,
      rootpage: access.rootpage,
      name: owner.name,
      object: { schema: owner.schema, name: owner.name, type: owner.type, table: owner.table, database: MAIN_DATABASE },
      status: 'joined',
      engineName: access.engineName,
    });
  }
  return {
    ...plan,
    relations,
    unknownAccess,
    limits: [
      ...plan.limits,
      ...(unknownAccess.length === 0 ? [] : [{
        projection: 'databaseAccesses',
        code: 'modeledAccessUnavailable',
        detail: `${unknownAccess.length} program access operand${unknownAccess.length === 1 ? '' : 's'} name no single captured main-database catalog object; the independent plan facts are preserved`,
      }]),
    ],
  };
}

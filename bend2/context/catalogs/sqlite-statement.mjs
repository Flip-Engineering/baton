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
    return { status: 'refused', reason: 'unterminatedLiteral', detail: `unterminated ${scan.unterminated.quote} at code-unit offset ${scan.unterminated.offset}` };
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
// C API is compile-time optional, so the qualification needs the binding
// method plus a probe whose returned database, table and column associations
// equal the object and slots the probe selected.
//
// The probe answers one question: can this binding report result-column
// origins for this catalog shape? Success does not establish the captured
// connection identity, the catalog snapshot, or any source-to-object linkage;
// those stay with the session that captured the catalog.
//
// The probe statement, its expected slots and a raw engine error message are
// helper evidence kept for review. Turning them into public fixed-condition
// fields is the caller's normalization step, not this module's.
export const ORIGIN_PROBE_SCOPE = 'origin-metadata-shape';

// SQLite identifier encoding: a double-quoted identifier with an embedded
// double quote doubled. Values never substitute for this encoding.
export function quoteSqliteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// A schema member is read by property presence, not by value shape:
// - absent: the row has no own schema member, which is the documented
//   compatible form and inherits the catalog schema;
// - declared: a nonempty string, which must equal the admitted schema to be
//   selected;
// - malformed: the member is present but is not a nonempty string, including an
//   explicitly supplied undefined, null, empty string or non-string. A supplied
//   value is never rewritten into the default.
function schemaMember(row) {
  if (row === null || typeof row !== 'object') return { kind: 'absent' };
  if (!Object.prototype.hasOwnProperty.call(row, 'schema')) return { kind: 'absent' };
  const value = row.schema;
  if (typeof value === 'string' && value.length > 0) return { kind: 'declared', value };
  return { kind: 'malformed', value };
}

function describedValue(value) {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

// Builds the probe statement and the expectation it must satisfy.
//
// The selected object is qualified with the admitted catalog schema, and two
// projection slots are always selected; a single-column table uses that column
// in both slots.
//
// Association rules for the admitted catalog shape:
// - an entity or column with no schema member is admitted under the catalog
//   schema, which is the explicit compatible form;
// - an entity or column that declares a different schema is never selected and
//   its declared schema is never overwritten, so an attached-schema object
//   cannot be probed as if it were the admitted one;
// - a schema member that is present but not a nonempty string refuses the
//   shape, so a supplied invalid value is never read as a missing member;
// - several tables with one name inside the admitted schema make object
//   association ambiguous and refuse instead of selecting the first;
// - a catalog whose tables all lie outside the admitted schema refuses.
export function buildOriginProbe({ catalog }) {
  const catalogMember = schemaMember(catalog);
  if (catalogMember.kind === 'malformed') {
    return {
      status: 'unsupported',
      reason: 'catalogShapeUnsupported',
      detail: `the catalog declares a malformed schema member ${describedValue(catalogMember.value)}; a supplied schema is never rewritten`,
    };
  }
  const admittedSchema = catalogMember.kind === 'declared' ? catalogMember.value : 'main';
  const entities = Array.isArray(catalog?.entities) ? catalog.entities : [];
  const columns = Array.isArray(catalog?.columns) ? catalog.columns : [];
  const tables = entities.filter(entity => entity?.kind === 'table' && entity?.name !== 'sqlite_schema' && typeof entity?.name === 'string' && entity.name.length > 0);

  // Every supplied schema member is validated before selection, so a malformed
  // value refuses deterministically instead of being read as a missing member.
  for (const entity of tables) {
    const member = schemaMember(entity);
    if (member.kind === 'malformed') {
      return {
        status: 'unsupported',
        reason: 'catalogShapeUnsupported',
        detail: `table ${JSON.stringify(entity.name)} declares a malformed schema member ${describedValue(member.value)}`,
      };
    }
  }
  for (const column of columns) {
    const member = schemaMember(column);
    if (member.kind === 'malformed') {
      return {
        status: 'unsupported',
        reason: 'catalogShapeUnsupported',
        detail: `column ${JSON.stringify(column?.table)}.${JSON.stringify(column?.name)} declares a malformed schema member ${describedValue(member.value)}`,
      };
    }
  }

  const admittedTables = tables.filter(entity => {
    const member = schemaMember(entity);
    return member.kind === 'absent' || member.value === admittedSchema;
  });
  if (admittedTables.length === 0) {
    if (tables.length > 0) {
      return {
        status: 'unsupported',
        reason: 'catalogShapeUnsupported',
        detail: `every table in the subject catalog lies outside the admitted schema ${admittedSchema}; the probe selects only objects in that schema`,
      };
    }
    return {
      status: 'unsupported',
      reason: 'noProbeShape',
      detail: 'the subject catalog holds no table with a declared column to probe',
    };
  }

  const byName = new Map();
  for (const entity of admittedTables) {
    const list = byName.get(entity.name) ?? [];
    list.push(entity);
    byName.set(entity.name, list);
  }
  for (const [name, list] of byName) {
    if (list.length > 1) {
      return {
        status: 'unsupported',
        reason: 'catalogShapeAmbiguous',
        detail: `the admitted schema ${admittedSchema} names ${list.length} tables called ${JSON.stringify(name)}; object association is ambiguous`,
      };
    }
  }

  let droppedColumns = 0;
  for (const entity of admittedTables) {
    const own = columns.filter(column => {
      if (column?.table !== entity.name || column?.hidden !== 'normal' || typeof column?.name !== 'string' || column.name.length === 0) return false;
      const member = schemaMember(column);
      if (member.kind === 'declared' && member.value !== admittedSchema) {
        droppedColumns += 1;
        return false;
      }
      return true;
    });
    if (own.length === 0) continue;
    const slots = [own[0].name, (own[1] ?? own[0]).name];
    const qualifiedTable = `${quoteSqliteIdentifier(admittedSchema)}.${quoteSqliteIdentifier(entity.name)}`;
    const sql = `SELECT ${qualifiedTable}.${quoteSqliteIdentifier(slots[0])} AS "p0", ${qualifiedTable}.${quoteSqliteIdentifier(slots[1])} AS "p1" FROM ${qualifiedTable}`;
    return {
      status: 'built',
      schema: admittedSchema,
      entity: { schema: admittedSchema, name: entity.name, kind: entity.kind },
      slots,
      expected: slots.map((column, index) => ({ resultName: `p${index}`, database: admittedSchema, table: entity.name, column })),
      sql,
    };
  }
  return {
    status: 'unsupported',
    reason: 'catalogShapeUnsupported',
    detail: droppedColumns > 0
      ? `no admitted table in schema ${admittedSchema} carries a normal column declared in that schema; ${droppedColumns} column association${droppedColumns === 1 ? '' : 's'} named another schema`
      : `no admitted table in schema ${admittedSchema} carries a normal column with a readable name to probe`,
  };
}

// Compares the returned associations with the selected object and slots. Slot
// count must match exactly; the result name is transport, not identity.
export function describeOriginMismatch({ expected, observed }) {
  if (observed.length !== expected.length) {
    return `the probe returned ${observed.length} column metadata entries where ${expected.length} slots were selected`;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index];
    const got = observed[index];
    if (got.database !== want.database) return `slot ${index} reports database ${JSON.stringify(got.database)} where ${JSON.stringify(want.database)} was selected`;
    if (got.table !== want.table) return `slot ${index} reports table ${JSON.stringify(got.table)} where ${JSON.stringify(want.table)} was selected`;
    if (got.column !== want.column) return `slot ${index} reports column ${JSON.stringify(got.column)} where ${JSON.stringify(want.column)} was selected`;
  }
  return null;
}

export function probeOriginCapability({ db, catalog }) {
  if (typeof db.prepare('SELECT 1').columns !== 'function') {
    return {
      available: false,
      reason: 'column_origin_metadata_unavailable',
      detail: 'the binding exposes no columns() metadata; this is the Node 22.15.0 floor',
      probe: null,
      scope: ORIGIN_PROBE_SCOPE,
    };
  }
  const probe = buildOriginProbe({ catalog });
  if (probe.status !== 'built') {
    return { available: false, reason: probe.reason, detail: probe.detail, probe: null, scope: ORIGIN_PROBE_SCOPE };
  }
  let observed;
  try {
    observed = db.prepare(probe.sql).columns().map(column => ({
      resultName: column.name,
      database: column.database ?? null,
      table: column.table ?? null,
      column: column.column ?? null,
    }));
  } catch (error) {
    return {
      available: false,
      reason: 'probeRefused',
      detail: error.message,
      probe: { sql: probe.sql, expected: probe.expected, columns: [] },
      scope: ORIGIN_PROBE_SCOPE,
    };
  }
  const mismatch = describeOriginMismatch({ expected: probe.expected, observed });
  const available = mismatch === null;
  return {
    available,
    reason: available ? null : 'probeOriginMismatch',
    detail: available
      ? `both probe slots report the expected database, table and column for ${probe.entity.schema}.${probe.entity.name}`
      : mismatch,
    probe: { sql: probe.sql, expected: probe.expected, columns: observed },
    scope: ORIGIN_PROBE_SCOPE,
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
        detail: 'the Node binding discards a prepare tail; the single-statement boundary and trailing-text check are a UTF-16 code-unit scan, while relation identity comes from the engine program',
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

// Join the engine program's access operands against the captured catalog.
//
// Input stage: this function admits a plan whose relations are still raw
// operands. A plan that already carries a join is refused with a
// `rejoinRefused` member and returned otherwise unchanged, so the prior unknown
// operands and earlier limits are never silently dropped. Re-derivation is
// deliberately not offered: merging an earlier classification into a join
// against a different catalog would present evidence from the first catalog as
// current, so a caller that needs the join under another catalog analyzes the
// statement again to obtain a fresh raw plan.
//
// The refusal carries the refusing plan's own catalog association and
// overwrites any earlier refusal state, so a repeated attempt cannot
// accumulate stale fields.
//
// Object identity: the database number and the schema are part of the key. A
// temp or attached database, a page outside the catalog and a page matching
// several objects stay unavailable with an explicit reason, and a plan whose
// status is not `analyzed` is returned unchanged, so a refusal is never read as
// proven absence of accesses.
export const JOIN_STAGE = 'rootpage-catalog-join';

function unknownOperandKey(entry) {
  return [entry.opcode ?? '', entry.cursor ?? '', entry.database ?? '', entry.rootpage ?? '', entry.reason ?? ''].join('\u0000');
}

function joinOperands({ plan, operands, catalog, priorUnknown, catalogDigest }) {
  const relations = [];
  const discovered = [];
  for (const access of operands) {
    if (access.database !== MAIN_DATABASE) {
      discovered.push({
        ...access,
        status: 'modeledAccessUnavailable',
        reason: 'nonMainDatabaseAccess',
        detail: `the program opens database number ${access.database}; temp and attached databases are outside the admitted catalog`,
      });
      continue;
    }
    const owners = catalog.rootpages[access.rootpage];
    if (owners === undefined || owners.length === 0) {
      discovered.push({ ...access, status: 'modeledAccessUnavailable', reason: 'rootpageNotInCatalog' });
      continue;
    }
    if (owners.length > 1) {
      discovered.push({ ...access, status: 'modeledAccessUnavailable', reason: 'ambiguousRootpage', detail: `rootpage ${access.rootpage} names ${owners.length} catalog objects` });
      continue;
    }
    const [owner] = owners;
    if (owner.schema !== catalog.schema) {
      discovered.push({ ...access, status: 'modeledAccessUnavailable', reason: 'nonMainSchemaObject', detail: `rootpage ${access.rootpage} belongs to schema ${owner.schema}` });
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

  const merged = [];
  const seen = new Set();
  for (const entry of [...priorUnknown, ...discovered]) {
    const key = unknownOperandKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  // One limit describes the merged unknown set of this join: an earlier limit
  // of the same code is replaced rather than repeated, and any other limit is
  // preserved.
  const priorLimits = (Array.isArray(plan.limits) ? plan.limits : [])
    .filter(limit => !(limit?.projection === 'databaseAccesses' && limit?.code === 'modeledAccessUnavailable'));
  return {
    ...plan,
    relations,
    unknownAccess: merged,
    join: {
      stage: JOIN_STAGE,
      schema: catalog?.schema ?? null,
      catalogDigest: catalogDigest ?? catalog?.catalogDigest ?? null,
      operandCount: operands.length,
      joinedCount: relations.length,
      unknownCount: merged.length,
      priorUnknownPreserved: priorUnknown.length,
    },
    limits: [
      ...priorLimits,
      ...(merged.length === 0 ? [] : [{
        projection: 'databaseAccesses',
        code: 'modeledAccessUnavailable',
        detail: `${merged.length} program access operand${merged.length === 1 ? '' : 's'} name no single captured main-database catalog object; the independent plan facts are preserved`,
      }]),
    ],
  };
}

export function joinRootpages({ plan, catalog, catalogDigest = null }) {
  if (plan?.status !== 'analyzed') return plan;
  const priorUnknown = Array.isArray(plan.unknownAccess) ? plan.unknownAccess : [];
  const operands = Array.isArray(plan.relations) ? plan.relations : [];
  const alreadyJoined = plan.join !== undefined || operands.some(relation => relation.status !== 'pending-catalog-join');
  if (alreadyJoined) {
    return {
      ...plan,
      rejoinRefused: {
        reason: 'alreadyJoined',
        detail: 'this plan already carries a join; analyze the statement again to obtain a fresh raw plan for the catalog you hold',
        priorUnknownAccess: priorUnknown.length,
        priorCatalogDigest: plan.join?.catalogDigest ?? null,
      },
    };
  }
  return joinOperands({ plan, operands, catalog, priorUnknown, catalogDigest });
}

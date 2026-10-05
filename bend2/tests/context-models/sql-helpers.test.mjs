// Source discriminators for the two SQLite helpers.
//
// This file imports sql-scan.mjs and sqlite-statement.mjs directly, so its
// dependency closure is those two modules and nothing else: no index, no
// adapter, no node:sqlite.
//
// Coordinate expectations are written as literals with the corresponding UTF-8
// byte offset in a comment. They are spelled independently of the implementation
// so a change to the scanner cannot move the expectation with it.
//
// The origin-probe cases inject a metadata double. They exercise probe
// construction, identifier encoding and association comparison; they are not
// engine qualification. Actual columns() behaviour under a captured connection
// is a separate remote control.
//
// These cases are unexecuted: all compilation and test gates run on admitted
// remote runners.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCAN_COORDINATE_DOMAIN,
  SCAN_DIALECTS,
  scanSqlStatements,
  validateSqlText,
} from '../../context/catalogs/sql-scan.mjs';
import {
  JOIN_STAGE,
  ORIGIN_PROBE_SCOPE,
  buildOriginProbe,
  describeOriginMismatch,
  joinRootpages,
  probeOriginCapability,
  quoteSqliteIdentifier,
} from '../../context/catalogs/sqlite-statement.mjs';

function catalogOf({ schema = 'main', tables = [], columns = [] }) {
  return {
    schema,
    entities: tables.map(table => ({ schema, kind: 'table', ...table })),
    columns: columns.map(column => ({ schema, hidden: 'normal', ...column })),
    rootpages: {},
  };
}

function originDouble({ columns }) {
  const statements = [];
  return {
    statements,
    db: {
      prepare(sql) {
        statements.push(sql);
        return { columns: () => columns };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Coordinate domain

test('the scan reports its coordinate domain and code-unit positions', () => {
  const plain = scanSqlStatements('SELECT 1; SELECT 2', { dialect: 'sqlite' });
  assert.equal(plain.coordinateDomain, SCAN_COORDINATE_DOMAIN);
  assert.equal(SCAN_COORDINATE_DOMAIN, 'utf16-code-unit');
  assert.deepEqual(SCAN_DIALECTS, ['sqlite', 'postgres']);
  assert.deepEqual(plain.separators, [8]);
  // The second segment retains the space that follows the separator: it starts
  // at code unit 9, immediately after the semicolon at 8, and ends at the text
  // length 18.
  assert.deepEqual(plain.statements.map(statement => [statement.start, statement.end]), [[0, 8], [9, 18]]);
  assert.equal(plain.statementCount, 2);

  const terminated = scanSqlStatements('SELECT 1;', { dialect: 'sqlite' });
  assert.deepEqual(terminated.separators, [8]);
  assert.equal(terminated.statementCount, 1);
  assert.equal(terminated.trailingHasContent, false);
});

test('a BMP character before the separator keeps the reported position in code units', () => {
  // SELECT 'é'; SELECT 2 : separator code unit 10, UTF-8 byte 11.
  const scan = scanSqlStatements("SELECT 'é'; SELECT 2", { dialect: 'sqlite' });
  assert.deepEqual(scan.separators, [10]);
  assert.deepEqual(scan.statements.map(statement => [statement.start, statement.end]), [[0, 10], [11, 20]]);
});

test('an astral character moves code units and bytes apart', () => {
  // SELECT '😀'; SELECT 2 : separator code unit 11, UTF-8 byte 13.
  const scan = scanSqlStatements("SELECT '😀'; SELECT 2", { dialect: 'sqlite' });
  assert.deepEqual(scan.separators, [11]);
  assert.deepEqual(scan.statements.map(statement => [statement.start, statement.end]), [[0, 11], [12, 21]]);
});

test('a CRLF sequence is two code units and the segment retains both', () => {
  const scan = scanSqlStatements('SELECT 1;\r\nSELECT 2', { dialect: 'sqlite' });
  assert.deepEqual(scan.separators, [8]);
  // The separator is code unit 8; the second segment starts at 9, retains the
  // CR and the LF, and ends at the text length 19.
  assert.deepEqual(scan.statements.map(statement => [statement.start, statement.end]), [[0, 8], [9, 19]]);
  assert.equal(scan.statements[1].text, '\r\nSELECT 2');
});

test('a separator inside a quoted region and inside a comment is not a boundary', () => {
  const quoted = scanSqlStatements("SELECT 'a;b'; SELECT 2", { dialect: 'sqlite' });
  assert.deepEqual(quoted.separators, [12]);
  assert.equal(quoted.statementCount, 2);

  const commented = scanSqlStatements('SELECT 1 -- ;\n; SELECT 2', { dialect: 'sqlite' });
  assert.deepEqual(commented.separators, [14]);
  assert.equal(commented.statementCount, 2);

  const doubled = scanSqlStatements("SELECT 'it''s'; SELECT 2", { dialect: 'sqlite' });
  assert.deepEqual(doubled.separators, [14]);
});

test('an unterminated opening reports its code-unit position and its own quote kind', () => {
  // SELECT 'é', ' : the final opening quote is code unit 12, UTF-8 byte 13.
  const quote = scanSqlStatements("SELECT 'é', '", { dialect: 'sqlite' });
  assert.deepEqual(quote.unterminated, { offset: 12, quote: "'" });

  const block = scanSqlStatements('SELECT 1 /* x', { dialect: 'sqlite' });
  assert.deepEqual(block.unterminated, { offset: 9, quote: '/*' });

  const bracket = scanSqlStatements('SELECT 1 FROM [x', { dialect: 'sqlite' });
  assert.deepEqual(bracket.unterminated, { offset: 14, quote: '[' });
});

test('string-admission diagnostics name the code-unit domain and keep their reason codes', () => {
  // SELECT 'é' then NUL: the NUL is code unit 10 while its byte offset is 11,
  // because the preceding é occupies two bytes but one code unit.
  const nul = validateSqlText("SELECT 'é'\u0000");
  assert.equal(nul.reason, 'nulByte');
  assert.match(nul.detail, /code-unit offset 10/);
  assert.equal(/byte offset/.test(nul.detail), false);

  const high = validateSqlText("SELECT '\uD800'");
  assert.equal(high.reason, 'invalidUtf8');
  assert.match(high.detail, /unpaired high surrogate at code-unit offset 8/);

  const low = validateSqlText('x\uDC00y');
  assert.equal(low.reason, 'invalidUtf8');
  assert.match(low.detail, /unpaired low surrogate at code-unit offset 1/);

  assert.equal(validateSqlText('SELECT 1').status, 'admitted');
});

// ---------------------------------------------------------------------------
// Origin probe construction and association

test('the probe encodes identifiers, qualifies the object and selects exactly two slots', () => {
  const catalog = catalogOf({
    tables: [{ name: 'order details' }],
    columns: [{ table: 'order details', name: 'select' }, { table: 'order details', name: 'we"ird' }],
  });
  const built = buildOriginProbe({ catalog });
  assert.equal(built.status, 'built');
  assert.equal(
    built.sql,
    'SELECT "main"."order details"."select" AS "p0", "main"."order details"."we""ird" AS "p1" FROM "main"."order details"',
  );
  assert.deepEqual(built.slots, ['select', 'we"ird']);
  assert.deepEqual(built.expected, [
    { resultName: 'p0', database: 'main', table: 'order details', column: 'select' },
    { resultName: 'p1', database: 'main', table: 'order details', column: 'we"ird' },
  ]);
});

test('a one-column table intentionally yields both slots from that column', () => {
  const catalog = catalogOf({ tables: [{ name: 'only' }], columns: [{ table: 'only', name: 'one' }] });
  const built = buildOriginProbe({ catalog });
  assert.equal(built.status, 'built');
  assert.deepEqual(built.slots, ['one', 'one']);
  const double = originDouble({
    columns: [
      { name: 'p0', database: 'main', table: 'only', column: 'one' },
      { name: 'p1', database: 'main', table: 'only', column: 'one' },
    ],
  });
  const capability = probeOriginCapability({ db: double.db, catalog });
  assert.equal(capability.available, true);
  assert.equal(capability.reason, null);
  assert.equal(capability.scope, ORIGIN_PROBE_SCOPE);
  assert.equal(capability.probe.expected.length, 2);
});

test('a matching association qualifies, and the probe keeps its construction evidence', () => {
  const catalog = catalogOf({ tables: [{ name: 'users' }], columns: [{ table: 'users', name: 'email' }, { table: 'users', name: 'id' }] });
  const double = originDouble({
    columns: [
      { name: 'p0', database: 'main', table: 'users', column: 'email' },
      { name: 'p1', database: 'main', table: 'users', column: 'id' },
    ],
  });
  const capability = probeOriginCapability({ db: double.db, catalog });
  assert.equal(capability.available, true);
  assert.equal(capability.probe.sql, 'SELECT "main"."users"."email" AS "p0", "main"."users"."id" AS "p1" FROM "main"."users"');
  assert.equal(capability.probe.columns.length, 2);
  assert.equal(double.statements.length, 2, 'one prepare for the floor check and one for the probe');
});

test('a wrong database, table or column association refuses the capability', () => {
  const catalog = catalogOf({ tables: [{ name: 'users' }], columns: [{ table: 'users', name: 'email' }, { table: 'users', name: 'id' }] });

  const wrongDatabase = originDouble({
    columns: [
      { name: 'p0', database: 'temp', table: 'users', column: 'email' },
      { name: 'p1', database: 'temp', table: 'users', column: 'id' },
    ],
  });
  const databaseVerdict = probeOriginCapability({ db: wrongDatabase.db, catalog });
  assert.equal(databaseVerdict.available, false);
  assert.equal(databaseVerdict.reason, 'probeOriginMismatch');
  assert.match(databaseVerdict.detail, /slot 0 reports database "temp"/);

  const wrongTable = originDouble({
    columns: [
      { name: 'p0', database: 'main', table: 'other', column: 'email' },
      { name: 'p1', database: 'main', table: 'other', column: 'id' },
    ],
  });
  const tableVerdict = probeOriginCapability({ db: wrongTable.db, catalog });
  assert.equal(tableVerdict.available, false);
  assert.match(tableVerdict.detail, /slot 0 reports table "other"/);

  const wrongColumn = originDouble({
    columns: [
      { name: 'p0', database: 'main', table: 'users', column: 'email' },
      { name: 'p1', database: 'main', table: 'users', column: 'unexpected' },
    ],
  });
  const columnVerdict = probeOriginCapability({ db: wrongColumn.db, catalog });
  assert.equal(columnVerdict.available, false);
  assert.match(columnVerdict.detail, /slot 1 reports column "unexpected"/);
});

test('a missing or extra metadata slot refuses, and null origins are one mismatch case', () => {
  const catalog = catalogOf({ tables: [{ name: 'users' }], columns: [{ table: 'users', name: 'email' }, { table: 'users', name: 'id' }] });

  const missing = originDouble({ columns: [{ name: 'p0', database: 'main', table: 'users', column: 'email' }] });
  const missingVerdict = probeOriginCapability({ db: missing.db, catalog });
  assert.equal(missingVerdict.available, false);
  assert.equal(missingVerdict.reason, 'probeOriginMismatch');
  assert.match(missingVerdict.detail, /returned 1 column metadata entries where 2 slots were selected/);

  const extra = originDouble({
    columns: [
      { name: 'p0', database: 'main', table: 'users', column: 'email' },
      { name: 'p1', database: 'main', table: 'users', column: 'id' },
      { name: 'p2', database: 'main', table: 'users', column: 'extra' },
    ],
  });
  const extraVerdict = probeOriginCapability({ db: extra.db, catalog });
  assert.equal(extraVerdict.available, false);
  assert.match(extraVerdict.detail, /returned 3 column metadata entries where 2 slots were selected/);

  const nullOrigins = originDouble({
    columns: [
      { name: 'p0', database: null, table: null, column: null },
      { name: 'p1', database: null, table: null, column: null },
    ],
  });
  const nullVerdict = probeOriginCapability({ db: nullOrigins.db, catalog });
  assert.equal(nullVerdict.available, false);
  assert.equal(nullVerdict.reason, 'probeOriginMismatch');
  assert.match(nullVerdict.detail, /slot 0 reports database null where "main" was selected/);
});

test('an unsupported catalog shape and a refused prepare are reported explicitly', () => {
  const hiddenOnly = catalogOf({ tables: [{ name: 'vt' }], columns: [{ table: 'vt', name: 'hidden', hidden: 'virtual-table-hidden' }] });
  const shaped = buildOriginProbe({ catalog: hiddenOnly });
  assert.equal(shaped.status, 'unsupported');
  assert.equal(shaped.reason, 'catalogShapeUnsupported');

  const noTable = buildOriginProbe({ catalog: { schema: 'main', entities: [], columns: [] } });
  assert.equal(noTable.status, 'unsupported');
  assert.equal(noTable.reason, 'noProbeShape');

  const malformed = buildOriginProbe({ catalog: { schema: 'main', entities: [{ kind: 'table', name: 't' }] } });
  assert.equal(malformed.status, 'unsupported');
  assert.equal(malformed.reason, 'catalogShapeUnsupported');

  const absentSchema = buildOriginProbe({ catalog: { entities: [{ kind: 'table', name: 't' }], columns: [{ table: 't', name: 'c', hidden: 'normal' }] } });
  assert.equal(absentSchema.status, 'built');
  assert.equal(absentSchema.schema, 'main', 'a catalog without an explicit schema defaults to main');

  const refusing = {
    prepare(sql) {
      if (sql === 'SELECT 1') return { columns: () => [] };
      return { columns() { throw new Error('probe construction refused'); } };
    },
  };
  const refused = probeOriginCapability({
    db: refusing,
    catalog: catalogOf({ tables: [{ name: 'users' }], columns: [{ table: 'users', name: 'email' }] }),
  });
  assert.equal(refused.available, false);
  assert.equal(refused.reason, 'probeRefused');
  assert.match(refused.detail, /probe construction refused/);
});

test('the Node 22.15.0 floor keeps its capability-unavailable result', () => {
  const floor = {
    prepare() {
      return {};
    },
  };
  const capability = probeOriginCapability({ db: floor, catalog: catalogOf({ tables: [{ name: 'users' }], columns: [{ table: 'users', name: 'email' }] }) });
  assert.equal(capability.available, false);
  assert.equal(capability.reason, 'column_origin_metadata_unavailable');
  assert.equal(capability.probe, null);
  assert.equal(capability.scope, ORIGIN_PROBE_SCOPE);
});

test('identifier encoding doubles an embedded double quote', () => {
  assert.equal(quoteSqliteIdentifier('plain'), '"plain"');
  assert.equal(quoteSqliteIdentifier('we"ird'), '"we""ird"');
  assert.equal(quoteSqliteIdentifier('order details'), '"order details"');
});

test('a contradictory schema is never selected or overwritten', () => {
  const foreignOnly = buildOriginProbe({
    catalog: catalogOf({
      schema: 'main',
      tables: [{ schema: 'attached', name: 't' }],
      columns: [{ schema: 'attached', table: 't', name: 'c' }],
    }),
  });
  assert.equal(foreignOnly.status, 'unsupported');
  assert.equal(foreignOnly.reason, 'catalogShapeUnsupported');
  assert.match(foreignOnly.detail, /outside the admitted schema main/);
  assert.equal(foreignOnly.sql, undefined, 'no statement is built for an object outside the admitted schema');

  const mixedColumns = buildOriginProbe({
    catalog: catalogOf({
      schema: 'main',
      tables: [{ name: 't' }],
      columns: [{ schema: 'attached', table: 't', name: 'c' }],
    }),
  });
  assert.equal(mixedColumns.status, 'unsupported');
  assert.equal(mixedColumns.reason, 'catalogShapeUnsupported');
  assert.match(mixedColumns.detail, /named another schema/);
});

test('a same-name table in another schema does not supply the columns of the admitted one', () => {
  const build = buildOriginProbe({
    catalog: catalogOf({
      schema: 'main',
      tables: [{ name: 't' }, { schema: 'attached', name: 't' }],
      columns: [{ table: 't', name: 'admitted_column' }, { schema: 'attached', table: 't', name: 'foreign_column' }],
    }),
  });
  assert.equal(build.status, 'built');
  assert.equal(build.schema, 'main');
  assert.deepEqual(build.slots, ['admitted_column', 'admitted_column']);
  assert.equal(/foreign_column/.test(build.sql), false);
});

test('two admitted tables with one name refuse as an unambiguous shape', () => {
  const ambiguous = buildOriginProbe({
    catalog: catalogOf({
      schema: 'main',
      tables: [{ name: 't' }, { name: 't' }],
      columns: [{ table: 't', name: 'c' }],
    }),
  });
  assert.equal(ambiguous.status, 'unsupported');
  assert.equal(ambiguous.reason, 'catalogShapeAmbiguous');
  assert.match(ambiguous.detail, /names 2 tables called "t"/);
});

test('a missing schema member is the admitted compatible form and uses the catalog schema', () => {
  const build = buildOriginProbe({
    catalog: catalogOf({ schema: 'app', tables: [{ name: 't' }], columns: [{ table: 't', name: 'c' }] }),
  });
  assert.equal(build.status, 'built');
  assert.equal(build.schema, 'app');
  assert.equal(build.sql.startsWith('SELECT "app"."t"."c"'), true);
  assert.deepEqual(build.expected[0], { resultName: 'p0', database: 'app', table: 't', column: 'c' });
});

test('the mismatch description is empty exactly when every slot matches', () => {
  const expected = [{ resultName: 'p0', database: 'main', table: 't', column: 'c' }];
  assert.equal(describeOriginMismatch({ expected, observed: [{ resultName: 'p0', database: 'main', table: 't', column: 'c' }] }), null);
  assert.match(describeOriginMismatch({ expected, observed: [] }), /returned 0 column metadata entries/);
});

// ---------------------------------------------------------------------------
// joinRootpages input stage and unknown preservation

const CATALOG = {
  schema: 'main',
  entities: [
    { schema: 'main', name: 'users', kind: 'table' },
    { schema: 'main', name: 'dup', kind: 'table' },
    { schema: 'main', name: 'dup2', kind: 'table' },
  ],
  columns: [],
  rootpages: {
    2: [{ schema: 'main', name: 'users', type: 'table', table: 'users' }],
    9: [
      { schema: 'main', name: 'dup', type: 'table', table: 'dup' },
      { schema: 'main', name: 'dup2', type: 'table', table: 'dup2' },
    ],
  },
};

function rawOperand(overrides = {}) {
  return { opcode: 'OpenRead', cursor: 0, database: 0, rootpage: '2', name: null, object: null, status: 'pending-catalog-join', engineName: null, ...overrides };
}

function rawPlan(relations, overrides = {}) {
  return { status: 'analyzed', kind: 'read', relations, unknownAccess: [], parameters: { count: 0 }, opcodes: ['OpenRead'], limits: [], ...overrides };
}

test('a raw plan joins its main operand and keeps the unsupported operand as unknown', () => {
  const plan = rawPlan([rawOperand(), rawOperand({ cursor: 1, database: 1 })]);
  const joined = joinRootpages({ plan, catalog: CATALOG });
  assert.equal(joined.relations.length, 1);
  assert.equal(joined.relations[0].object.name, 'users');
  assert.equal(joined.relations[0].status, 'joined');
  assert.equal(joined.unknownAccess.length, 1);
  assert.equal(joined.unknownAccess[0].reason, 'nonMainDatabaseAccess');
  assert.equal(joined.limits.filter(limit => limit.code === 'modeledAccessUnavailable').length, 1);
  assert.equal(joined.join.stage, JOIN_STAGE);
  assert.equal(joined.join.operandCount, 2);
  assert.equal(joined.join.joinedCount, 1);
  assert.equal(joined.join.unknownCount, 1);
});

test('engine name transport never supplies identity', () => {
  const plan = rawPlan([rawOperand({ rootpage: '2', engineName: 'not-the-object' })]);
  const joined = joinRootpages({ plan, catalog: CATALOG });
  assert.equal(joined.relations[0].object.name, 'users');
  assert.equal(joined.relations[0].engineName, 'not-the-object');
});

test('ambiguous, absent and foreign-schema operands stay unavailable with their own reasons', () => {
  const ambiguous = joinRootpages({ plan: rawPlan([rawOperand({ rootpage: '9' })]), catalog: CATALOG });
  assert.equal(ambiguous.relations.length, 0);
  assert.equal(ambiguous.unknownAccess[0].reason, 'ambiguousRootpage');

  const absent = joinRootpages({ plan: rawPlan([rawOperand({ rootpage: '77' })]), catalog: CATALOG });
  assert.equal(absent.unknownAccess[0].reason, 'rootpageNotInCatalog');

  const foreignCatalog = { ...CATALOG, rootpages: { 5: [{ schema: 'attached', name: 'x', type: 'table', table: 'x' }] } };
  const foreign = joinRootpages({ plan: rawPlan([rawOperand({ rootpage: '5' })]), catalog: foreignCatalog });
  assert.equal(foreign.unknownAccess[0].reason, 'nonMainSchemaObject');
});

test('a non-analyzed plan is returned unchanged so a refusal is never read as absence', () => {
  const refused = { status: 'refused', reason: 'multipleStatements', relations: [], unknownAccess: [{ status: 'modeledAccessUnavailable', reason: 'nonMainDatabaseAccess', database: 1, rootpage: '2', opcode: 'OpenRead', cursor: 0 }], parameters: { count: 0 }, limits: [] };
  const result = joinRootpages({ plan: refused, catalog: CATALOG });
  assert.equal(result, refused, 'the refusal object is returned by reference and untouched');
  assert.equal(result.unknownAccess.length, 1);
});

test('a raw plan carrying prior unknown operands still joins and preserves them', () => {
  const prior = { status: 'modeledAccessUnavailable', reason: 'nonMainDatabaseAccess', database: 2, rootpage: '3', opcode: 'OpenRead', cursor: 7 };
  const plan = rawPlan([rawOperand()], { unknownAccess: [prior] });
  const joined = joinRootpages({ plan, catalog: CATALOG });
  assert.equal(joined.rejoinRefused, undefined, 'a raw plan is not treated as already joined');
  assert.equal(joined.relations.length, 1);
  assert.equal(joined.unknownAccess.length, 1);
  assert.deepEqual(joined.unknownAccess[0], prior);
  assert.equal(joined.join.priorUnknownPreserved, 1);
});

test('feeding a joined plan back refuses and loses nothing', () => {
  const first = joinRootpages({ plan: rawPlan([rawOperand(), rawOperand({ cursor: 1, database: 1 })]), catalog: CATALOG });
  const second = joinRootpages({ plan: first, catalog: CATALOG });
  assert.equal(second.rejoinRefused.reason, 'alreadyJoined');
  assert.deepEqual(second.unknownAccess, first.unknownAccess);
  assert.deepEqual(second.relations, first.relations);
  assert.equal(second.limits.filter(limit => limit.code === 'modeledAccessUnavailable').length, 1);
  assert.equal(second.rejoinRefused.priorUnknownAccess, 1);
  assert.equal(second.rejoinRefused.priorCatalogDigest, null, 'the refusal names the refusing plan catalog association');
});

test('a repeated refusal replaces the earlier refusal state instead of accumulating it', () => {
  const first = joinRootpages({ plan: rawPlan([rawOperand(), rawOperand({ cursor: 1, database: 1 })]), catalog: CATALOG, catalogDigest: 'digest-a' });
  const refused = joinRootpages({ plan: first, catalog: CATALOG });
  assert.equal(refused.rejoinRefused.reason, 'alreadyJoined');
  assert.equal(refused.rejoinRefused.priorCatalogDigest, 'digest-a');
  const refusedAgain = joinRootpages({ plan: refused, catalog: CATALOG, catalogDigest: 'digest-b' });
  assert.equal(refusedAgain.rejoinRefused.reason, 'alreadyJoined');
  assert.equal(refusedAgain.rejoinRefused.priorCatalogDigest, 'digest-a', 'the refusal describes the plan it received, not a later catalog');
  assert.deepEqual(refusedAgain.unknownAccess, refused.unknownAccess);
  assert.equal(refusedAgain.relations.length, 1);
});

test('a fresh raw plan joins under the catalog it is given and records that catalog digest', () => {
  const before = joinRootpages({ plan: rawPlan([rawOperand()]), catalog: CATALOG, catalogDigest: 'digest-before' });
  assert.equal(before.relations.length, 1);
  assert.equal(before.join.catalogDigest, 'digest-before');

  // The same operands under a catalog that no longer holds the page: the join
  // is computed from the corpus it was given, and no earlier classification is
  // carried into it.
  const changed = { schema: 'main', entities: [], columns: [], rootpages: {} };
  const after = joinRootpages({ plan: rawPlan([rawOperand()]), catalog: changed, catalogDigest: 'digest-after' });
  assert.equal(after.relations.length, 0);
  assert.equal(after.join.catalogDigest, 'digest-after');
  assert.equal(after.unknownAccess.length, 1);
  assert.equal(after.unknownAccess[0].reason, 'rootpageNotInCatalog');
  assert.equal(after.limits.filter(limit => limit.code === 'modeledAccessUnavailable').length, 1);
});

test('a joined plan offers no re-derivation path', () => {
  const first = joinRootpages({ plan: rawPlan([rawOperand()]), catalog: CATALOG, catalogDigest: 'digest-a' });
  // allowRejoin is deliberately passed as an unrecognized property: the helper
  // offers no re-derivation, so it must change nothing.
  const result = joinRootpages({ plan: first, catalog: CATALOG, catalogDigest: 'digest-b', allowRejoin: true });
  assert.equal(result.rejoinRefused.reason, 'alreadyJoined');
  assert.equal(result.join.catalogDigest, 'digest-a', 'the admitted join keeps the catalog it was computed against');
  assert.equal(result.relations.length, 1);
  assert.deepEqual(result.unknownAccess, first.unknownAccess);
});

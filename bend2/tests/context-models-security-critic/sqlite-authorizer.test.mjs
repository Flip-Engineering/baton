// Independent conformance checker for the native SQLite planner/replay observation records.
//
// This binds to the record shape implemented at producer pin d66c779c
// (bend2/context/sqlite/context_sqlite.c, tree 66430a06): the top level carries an
// `authorizer` array whose entries are
//   {phase, action, actionNameHex, arg1Hex, arg2Hex, arg3Hex, arg4Hex, decision, reasonHex}
// with every string value hex-encoded, and a status object carrying the fixed stage token.
//
// The checker never runs SQLite. It validates records the remote runner produced,
// so a contract violation is named against the artifact rather than re-derived:
//   * planner admits SQLITE_SELECT and SQLITE_READ of a captured ordinary main
//     object only. Per the producer's correction (message sqlite-authorizer-contract-correction-1)
//     SQLite passes NULL in arg3 for READ, so a READ denial must never cite a
//     database, and arg3 must not be required for admission.
//   * replay admits the closed pragma list case-insensitively, built-in
//     functions except load_extension, and DDL only with arg3 main or temp.
//   * ATTACH, DETACH, CREATE_VTABLE, DROP_VTABLE, COPY and unknown codes deny as
//     actionNotAdmitted; a non-captured table denies as objectNotCaptured; a DDL
//     action outside main/temp denies as databaseNotAdmitted.
//   * a refused input stage (NUL, bind parameters, tail, invalid UTF-8) carries
//     its fixed stage token and no target-derived prepare.
//
// Prerequisites (a missing one fails loudly; this checker exists to validate
// remote artifacts and must not silently skip):
//   CONTEXT_SQLITE_RECORDS  directory holding the records the remote runner produced
//
// File-name convention for the cases in that directory:
//   planner-*.json   records from the planner operation
//   replay-*.json    records from the chain replay operation
//   stage-*.json     records expected to carry an input-refusal stage
//
// Member paths bound from producer message sqlite-record-shape-answer-1 (pin
// c1fc1766 on top of d66c779c): status.stageHex carries the hex-encoded fixed
// stage name in the lowerCamelCase spelling of baton_ctx_sql_stage_name;
// scratch.tempStoreVerified is true only in a chain-replay record whose two
// private connections verified PRAGMA temp_store==2, and false in planner and
// applied-capture records; authorizer arrays appear at the top level of plan
// records and inside the replay record's two top-level sections, prefix and
// head, under phases prefix-replay and head-replay respectively
// (producer message sqlite-section-names-1).
//
// Remote only; this file has not been executed locally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMITTED_PRAGMAS = [
  'foreign_keys', 'legacy_alter_table', 'defer_foreign_keys', 'user_version',
  'table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info',
  'index_xinfo', 'foreign_key_list', 'database_list', 'schema_version',
  'application_id', 'encoding', 'page_size', 'secure_delete',
];

// SQLite authorizer action codes used by the contract.
const ACTION = {
  SELECT: 21,
  READ: 20,
  PRAGMA: 19,
  FUNCTION: 31,
  TRANSACTION: 22,
  SAVEPOINT: 32,
  RECURSIVE: 33,
  INSERT: 18,
  UPDATE: 23,
  DELETE: 9,
  ALTER_TABLE: 26,
  REINDEX: 27,
  ANALYZE: 28,
  ATTACH: 24,
  DETACH: 25,
  CREATE_VTABLE: 29,
  DROP_VTABLE: 30,
  COPY: 0,
};
const DDL_ACTIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]);
// The fixed stage names exactly as baton_ctx_sql_stage_name spells them.
const STAGES = new Set([
  'ok', 'inputInvalid', 'tempdirUnavailable', 'openFailed', 'identityFailed',
  'snapshotFailed', 'dropModulesFailed', 'authorizerFailed', 'sqlUtf8', 'sqlNul',
  'sqlEmpty', 'sqlBind', 'prepareFailed', 'notReadonly', 'isExplain', 'tailRemains',
  'explainPrepareFailed', 'explainStepFailed', 'cancelled', 'closeFailed',
  'allocationFailed', 'sqlLengthExceedsInt', 'tempstoreUnverified',
  'replayRevisionFailed', 'replayOpenTransaction',
]);
const REFUSED_STAGES = new Set(['sqlUtf8', 'sqlNul', 'sqlEmpty', 'sqlBind', 'tailRemains', 'notReadonly', 'isExplain', 'sqlLengthExceedsInt']);

// Authorizer event phases, exactly as the emitter names them (producer message
// sqlite-phase-vocab-1). Plan records use the first five; the replay sections
// use the last two.
const PLAN_PHASES = new Set(['capture', 'original-prepare', 'explain-prepare', 'explain-step', 'cleanup']);
const SECTION_PHASES = new Set(['prefix-replay', 'head-replay']);
const PHASES = new Set([...PLAN_PHASES, ...SECTION_PHASES]);

function stageOf(document, name) {
  const status = document.status;
  assert.ok(status !== null && typeof status === 'object', `${name} carries no status object`);
  const stage = hexDecode(status.stageHex, `${name}.status.stageHex`);
  assert.ok(stage !== null, `${name}.status.stageHex is absent; the emitter writes the fixed stage name there`);
  assert.ok(STAGES.has(stage), `${name} carries unknown stage ${JSON.stringify(stage)}`);
  return stage;
}

// Authorizer arrays appear at the top level of a plan record and inside the
// replay prefix and head sections, so collect every one with its path.
function collectAuthorizerArrays(document) {
  const arrays = [];
  const walk = (value, path) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value.authorizer)) arrays.push({ path: `${path}.authorizer`, entries: value.authorizer });
    for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
  };
  walk(document, '$');
  return arrays;
}
const TEMP_STORE_REFUSED_PRAGMAS = ['journal_mode', 'temp_store', 'synchronous', 'mmap_size'];

function recordsDirectory() {
  const directory = process.env.CONTEXT_SQLITE_RECORDS;
  if (!directory || !existsSync(directory)) {
    throw new Error('CONTEXT_SQLITE_RECORDS must name the directory holding the remote runner records; this checker validates real artifacts and never skips');
  }
  return directory;
}

function hexDecode(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a hex string, got ${typeof value}`);
  if (value.length % 2 !== 0 || /[^0-9a-fA-F]/.test(value)) throw new Error(`${label} is not hex: ${JSON.stringify(value)}`);
  return Buffer.from(value, 'hex').toString('utf8');
}

function loadRecords(prefix) {
  const directory = recordsDirectory();
  const names = readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
  if (names.length === 0) throw new Error(`no ${prefix}*.json records under ${directory}; the remote runner must produce them`);
  return names.map(name => {
    const path = join(directory, name);
    const document = JSON.parse(readFileSync(path, 'utf8'));
    const arrays = collectAuthorizerArrays(document);
    if (arrays.length === 0) throw new Error(`${name} carries no authorizer array at any level`);
    const events = [];
    for (const array of arrays) {
      array.entries.forEach((entry, index) => {
        const where = `${name} ${array.path}[${index}]`;
        events.push({
          index,
          section: array.path,
          phase: hexDecode(entry.phase, `${where}.phase`),
          action: entry.action,
          actionName: hexDecode(entry.actionNameHex, `${where}.actionNameHex`),
          arg1: hexDecode(entry.arg1Hex, `${where}.arg1Hex`),
          arg2: hexDecode(entry.arg2Hex, `${where}.arg2Hex`),
          arg3: hexDecode(entry.arg3Hex, `${where}.arg3Hex`),
          arg4: hexDecode(entry.arg4Hex, `${where}.arg4Hex`),
          decision: entry.decision,
          reason: hexDecode(entry.reasonHex, `${where}.reasonHex`),
        });
      });
    }
    return { name, path, document, arrays, events, stage: stageOf(document, name) };
  });
}

function decisions(records) {
  return records.flatMap(record => record.events.map(event => ({ ...event, file: record.name, stage: record.stage })));
}

test('planner records admit only SELECT and READ of captured main objects', () => {
  const records = loadRecords('planner-');
  const all = decisions(records);
  assert.ok(all.length > 0, 'the planner records carry no authorizer events');
  for (const event of all) {
    if (event.decision === 'allow') {
      assert.ok(event.action === ACTION.SELECT || event.action === ACTION.READ,
        `${event.file}#${event.index} allowed ${event.actionName ?? event.action}, which the planner does not admit`);
    } else {
      assert.equal(event.decision, 'deny', `${event.file}#${event.index} has decision ${event.decision}`);
    }
  }
  assert.ok(all.some(event => event.action === ACTION.READ), 'no READ event was recorded; the planner case did not exercise the corrected rule');
});

test('no planner READ denial cites a database, and arg3 is never required for READ', () => {
  const records = loadRecords('planner-');
  for (const event of decisions(records)) {
    if (event.action !== ACTION.READ) continue;
    assert.notEqual(event.reason, 'databaseNotAdmitted',
      `${event.file}#${event.index} denied a READ for a database: SQLite passes arg3 NULL for READ, so this denial contradicts the engine`);
    if (event.decision === 'deny') {
      assert.equal(event.reason, 'objectNotCaptured',
        `${event.file}#${event.index} denied READ with ${event.reason}, expected objectNotCaptured for a table outside the captured set`);
      assert.ok(event.arg1 !== null, `${event.file}#${event.index} denied READ without naming the table in arg1`);
    }
  }
});

test('planner denials use only the fixed reason tokens', () => {
  const records = loadRecords('planner-');
  for (const event of decisions(records)) {
    if (event.decision !== 'deny') continue;
    assert.ok(['objectNotCaptured', 'actionNotAdmitted'].includes(event.reason),
      `${event.file}#${event.index} used reason ${JSON.stringify(event.reason)} for action ${event.actionName ?? event.action}`);
  }
});

test('replay pragma admission follows the closed case-insensitive list', () => {
  const records = loadRecords('replay-');
  const pragmas = decisions(records).filter(event => event.action === ACTION.PRAGMA);
  assert.ok(pragmas.length > 0, 'no PRAGMA event was recorded; the replay case did not exercise the pragma list');
  for (const event of pragmas) {
    const name = (event.arg1 ?? '').toLowerCase();
    const admitted = ADMITTED_PRAGMAS.includes(name);
    if (admitted) {
      assert.equal(event.decision, 'allow', `${event.file}#${event.index} denied admitted pragma ${event.arg1}`);
    } else {
      assert.equal(event.decision, 'deny', `${event.file}#${event.index} allowed ${event.arg1}, which is outside the closed pragma list`);
      assert.equal(event.reason, 'pragmaNameNotAdmitted');
    }
    for (const refused of TEMP_STORE_REFUSED_PRAGMAS) {
      const spelling = new RegExp(`^${refused}$`, 'i');
      if (spelling.test(name)) {
        assert.equal(event.decision, 'deny', `${event.file}#${event.index} allowed ${event.arg1}; this pragma refuses in both read and write forms`);
      }
    }
  }
});

test('replay denies extension loading, attachment, virtual tables and unknown actions', () => {
  const records = loadRecords('replay-');
  for (const event of decisions(records)) {
    if (event.action === ACTION.FUNCTION && (event.arg2 ?? '').toLowerCase() === 'load_extension') {
      assert.equal(event.decision, 'deny', `${event.file}#${event.index} allowed load_extension`);
      assert.equal(event.reason, 'functionNameNotAdmitted');
    }
    if ([ACTION.ATTACH, ACTION.DETACH, ACTION.CREATE_VTABLE, ACTION.DROP_VTABLE, ACTION.COPY].includes(event.action)) {
      assert.equal(event.decision, 'deny', `${event.file}#${event.index} allowed ${event.actionName ?? event.action}`);
      assert.equal(event.reason, 'actionNotAdmitted');
    }
    if (DDL_ACTIONS.has(event.action)) {
      const qualified = event.arg3 === 'main' || event.arg3 === 'temp';
      if (qualified) {
        assert.equal(event.decision, 'allow', `${event.file}#${event.index} denied ${event.actionName ?? event.action} for ${event.arg3}`);
      } else {
        assert.equal(event.decision, 'deny', `${event.file}#${event.index} allowed ${event.actionName ?? event.action} outside main/temp (arg3=${JSON.stringify(event.arg3)})`);
        assert.equal(event.reason, 'databaseNotAdmitted');
      }
    }
  }
});

test('a refused input stage carries its token and an empty authorizer array', () => {
  const records = loadRecords('stage-');
  for (const record of records) {
    assert.ok(REFUSED_STAGES.has(record.stage), `${record.name} stage ${record.stage} is not an input-refusal stage`);
    for (const array of record.arrays) {
      assert.equal(array.entries.length, 0,
        `${record.name} recorded ${array.entries.length} authorizer events at ${array.path} for an input refused before the authorizer installed`);
    }
  }
});

test('the replay record carries its prefix and head sections under their own phases', () => {
  const records = loadRecords('replay-');
  for (const record of records) {
    for (const section of ['prefix', 'head']) {
      const value = record.document[section];
      assert.ok(value !== null && typeof value === 'object', `${record.name} carries no ${section} section`);
      assert.ok(Array.isArray(value.authorizer), `${record.name}.${section} carries no authorizer array`);
      const expectedPhase = section === 'prefix' ? 'prefix-replay' : 'head-replay';
      for (const entry of record.events.filter(event => event.section.startsWith(`$.${section}.`))) {
        assert.equal(entry.phase, expectedPhase,
          `${record.name}.${section}[${entry.index}] ran under phase ${JSON.stringify(entry.phase)}, expected ${expectedPhase}`);
      }
      assert.ok(record.events.some(event => event.section.startsWith(`$.${section}.`)) || value.authorizer.length === 0,
        `${record.name}.${section} carries neither events nor an empty array`);
    }
    const topLevel = record.document.authorizer;
    assert.ok(topLevel === undefined || (Array.isArray(topLevel) && topLevel.length === 0),
      `${record.name} carries a top-level authorizer array on a replay record; the sections own theirs`);
  }
});

test('each replay section reports its own terminal facts truthfully', () => {
  for (const record of loadRecords('replay-')) {
    const sections = ['prefix', 'head'].map(name => [name, record.document[name]]);
    for (const [name, section] of sections) {
      assert.equal(typeof section.aborted, 'boolean', `${record.name}.${name}.aborted must be a boolean`);
      assert.equal(typeof section.cancelled, 'boolean', `${record.name}.${name}.cancelled must be a boolean`);
      assert.ok(section.autocommitAtEnd === null || typeof section.autocommitAtEnd === 'boolean',
        `${record.name}.${name}.autocommitAtEnd must be a boolean or null`);
      assert.ok(section.schemaVersion === null || typeof section.schemaVersion === 'number',
        `${record.name}.${name}.schemaVersion must be a number or null`);
      if (section.cancelled) {
        assert.equal(record.stage, 'cancelled', `${record.name}.${name} reports cancellation but the record stage is ${record.stage}`);
      }
      if (section.aborted) {
        assert.notEqual(record.stage, 'ok', `${record.name}.${name} reports an aborted replay under stage ok`);
      }
      if (section.autocommitAtEnd === false) {
        // An open transaction promotes the stage only when no earlier terminal
        // failure exists; cancellation and a revision failure keep their stage.
        assert.ok(['replayOpenTransaction', 'cancelled', 'replayRevisionFailed'].includes(record.stage),
          `${record.name}.${name} reports an open transaction under stage ${record.stage}`);
      }
    }
    if (record.stage === 'cancelled') {
      assert.ok(sections.some(([, section]) => section.cancelled === true),
        `${record.name} reports stage cancelled while neither section reports cancellation`);
    }
    if (record.stage === 'replayOpenTransaction') {
      assert.ok(sections.some(([, section]) => section.autocommitAtEnd === false),
        `${record.name} reports stage replayOpenTransaction while no section reports an open transaction`);
    }
  }
});

test('every authorizer event names a known phase for its record kind', () => {
  for (const record of loadRecords('planner-')) {
    for (const event of record.events) {
      assert.ok(PLAN_PHASES.has(event.phase),
        `${record.name} ${event.section}[${event.index}] carries phase ${JSON.stringify(event.phase)}; a plan record admits only ${[...PLAN_PHASES].join(', ')}`);
    }
  }
  for (const prefix of ['replay-', 'stage-']) {
    for (const record of loadRecords(prefix)) {
      for (const event of record.events) {
        assert.ok(PHASES.has(event.phase), `${record.name} ${event.section}[${event.index}] carries phase ${JSON.stringify(event.phase)}`);
      }
    }
  }
});

test('the prefix revision sequence is the head sequence truncated', () => {
  for (const record of loadRecords('replay-')) {
    const prefix = record.document.prefix;
    const head = record.document.head;
    assert.ok(Array.isArray(prefix.revisionsHex), `${record.name}.prefix.revisionsHex must be an array`);
    assert.ok(Array.isArray(head.revisionsHex), `${record.name}.head.revisionsHex must be an array`);
    if (prefix.revisionsHex.length > 0) {
      assert.ok(head.revisionsHex.length >= prefix.revisionsHex.length,
        `${record.name}: prefix carries ${prefix.revisionsHex.length} revisions and head only ${head.revisionsHex.length}; the prefix is a chain truncation`);
    }
    const truncated = head.revisionsHex.slice(0, prefix.revisionsHex.length);
    assert.deepEqual(prefix.revisionsHex, truncated,
      `${record.name}: prefix revisions must be the head sequence truncated to the prefix length, in the same order`);
  }
});

test('the private scratch and temp-store verification facts follow the contract', () => {
  // Operation sections appear when their capture completed before a failure, so
  // an early refusal may omit scratch; a record that reached its operation may not.
  const scratchOf = (record) => {
    const scratch = record.document.scratch;
    if (scratch === null || typeof scratch !== 'object') {
      assert.notEqual(record.stage, 'ok', `${record.name} reports stage ok without the scratch facts`);
      return null;
    }
    return scratch;
  };
  for (const record of loadRecords('replay-')) {
    const scratch = scratchOf(record);
    if (scratch === null) continue;
    assert.equal(scratch.tempStoreVerified, true,
      `${record.name} is a chain-replay record without a verified private temp store; the authorizer installs only after both private connections verify PRAGMA temp_store==2`);
    assert.ok(typeof scratch.directoryHex === 'string' && hexDecode(scratch.directoryHex, `${record.name}.scratch.directoryHex`).startsWith('/'),
      `${record.name} does not name the private scratch directory`);
  }
  for (const record of loadRecords('planner-')) {
    const scratch = scratchOf(record);
    if (scratch === null) continue;
    assert.equal(scratch.tempStoreVerified, false,
      `${record.name} is a planner record claiming a verified temp store; the planner configures sqlite3_temp_directory and never verifies PRAGMA temp_store`);
    assert.ok(Object.hasOwn(scratch, 'configured'), `${record.name} does not record whether the temp directory was configured`);
  }
});

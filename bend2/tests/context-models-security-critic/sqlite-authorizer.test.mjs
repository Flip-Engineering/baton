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
const REFUSED_STAGES = new Set(['SQL_UTF8', 'SQL_NUL', 'SQL_EMPTY', 'SQL_BIND', 'TAIL_REMAINS', 'NOT_READONLY', 'IS_EXPLAIN', 'SQL_LENGTH_EXCEEDS_INT']);

// BatonCtxSqlStage from the published header, so a numeric stage is still checked.
const STAGE_NAMES = [
  'OK', 'INPUT_INVALID', 'TEMPDIR_UNAVAILABLE', 'OPEN_FAILED', 'IDENTITY_FAILED',
  'SNAPSHOT_FAILED', 'DROPMODULES_FAILED', 'AUTHORIZER_FAILED', 'SQL_UTF8', 'SQL_NUL',
  'SQL_EMPTY', 'SQL_BIND', 'PREPARE_FAILED', 'NOT_READONLY', 'IS_EXPLAIN',
  'TAIL_REMAINS', 'EXPLAIN_PREPARE_FAILED', 'EXPLAIN_STEP_FAILED', 'CANCELLED',
  'CLOSE_FAILED', 'ALLOCATION_FAILED', 'SQL_LENGTH_EXCEEDS_INT', 'TEMPSTORE_UNVERIFIED',
  'REPLAY_REVISION_FAILED', 'REPLAY_OPEN_TRANSACTION',
];

function stageOf(document) {
  const seen = [];
  const walk = (value) => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (/^stage$/i.test(key) && typeof entry === 'number') seen.push(STAGE_NAMES[entry] ?? `STAGE_${entry}`);
      if (/^stageNameHex$/i.test(key)) seen.push(hexDecode(entry, 'stageNameHex'));
      if (/^stageHex$/i.test(key)) seen.push(hexDecode(entry, 'stageHex'));
      walk(entry);
    }
  };
  walk(document);
  return seen;
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
    const authorizer = document.authorizer;
    if (!Array.isArray(authorizer)) throw new Error(`${name} carries no authorizer array`);
    const events = authorizer.map((entry, index) => ({
      index,
      phase: hexDecode(entry.phase, `${name}#${index}.phase`),
      action: entry.action,
      actionName: hexDecode(entry.actionNameHex, `${name}#${index}.actionNameHex`),
      arg1: hexDecode(entry.arg1Hex, `${name}#${index}.arg1Hex`),
      arg2: hexDecode(entry.arg2Hex, `${name}#${index}.arg2Hex`),
      arg3: hexDecode(entry.arg3Hex, `${name}#${index}.arg3Hex`),
      arg4: hexDecode(entry.arg4Hex, `${name}#${index}.arg4Hex`),
      decision: entry.decision,
      reason: hexDecode(entry.reasonHex, `${name}#${index}.reasonHex`),
    }));
    return { name, path, document, events };
  });
}

function decisions(records) {
  return records.flatMap(record => record.events.map(event => ({ ...event, file: record.name })));
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

test('a refused input stage carries its token and no target-derived prepare', () => {
  const records = loadRecords('stage-');
  for (const record of records) {
    const stages = stageOf(record.document);
    assert.ok(stages.length > 0, `${record.name} carries no stage token`);
    const stage = stages[0];
    assert.ok(REFUSED_STAGES.has(stage), `${record.name} stage ${stage} is not an input-refusal stage`);
    const targetDerived = record.events.filter(event => event.phase === 'planner' || event.phase === 'replay');
    assert.equal(targetDerived.length, 0, `${record.name} recorded target-derived authorizer events for a refused input stage`);
  }
});

test('the replay record states the verified private temp store before its events', () => {
  const records = loadRecords('replay-');
  for (const record of records) {
    const text = JSON.stringify(record.document);
    assert.match(text, /"(tempStoreVerified|temp_store_verified)"\s*:\s*true/,
      `${record.name} carries no verified private temp store flag; the contract installs the authorizer only after verifying PRAGMA temp_store=MEMORY`);
    assert.ok(!/"(tempStoreVerified|temp_store_verified)"\s*:\s*false/.test(text), `${record.name} reports an unverified temp store`);
  }
});

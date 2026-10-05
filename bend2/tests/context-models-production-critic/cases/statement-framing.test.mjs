// Statement framing discriminators (conductor corrections 1 and 2) plus the
// read-only EXPLAIN observation contract.

import { DatabaseSync } from 'node:sqlite';

import { check } from '../lib/harness.mjs';

const CORRECTION_1 = 'conductor correction 1: statementFraming("SELECT 1") must admit one statement (observed d0cc717c: refused multipleStatements with statementCount=1)';
const CORRECTION_2 = "conductor correction 2: statementFraming(\"SELECT 'ok'\") must admit (observed d0cc717c: unterminatedLiteral at offset 7)";
const READ_ONLY = 'Node profile read-only EXPLAIN observation: analyzing write SQL must not execute it; the public output distinguishes modeled write from execution (conductor scope correction: no universal OpenWrite ban on Node; execution claims prohibited)';

function framingResult(module, sql) {
  const framing = module.statementFraming(sql);
  if (framing.status !== 'admitted') throw new Error(JSON.stringify(framing));
  return framing;
}

check({
  id: 'framing/single-statement-admitted',
  requirement: CORRECTION_1,
  async run({ producer }) {
    const framing = framingResult(producer.modules.catalogs.statement, 'SELECT 1');
    return { statement: framing.statement };
  },
});

check({
  id: 'framing/closing-quote-at-end-admitted',
  requirement: CORRECTION_2,
  async run({ producer }) {
    const framing = framingResult(producer.modules.catalogs.statement, "SELECT 'ok'");
    return { statement: framing.statement };
  },
});

check({
  id: 'framing/escaped-quote-admitted',
  requirement: 'doubled-quote escapes frame as one statement: SELECT \'it\'\'s\'',
  async run({ producer }) {
    const framing = framingResult(producer.modules.catalogs.statement, "SELECT 'it''s'");
    return { statement: framing.statement };
  },
});

check({
  id: 'framing/two-statements-refused',
  requirement: 'a second statement refuses with multipleStatements regardless of separator whitespace',
  async run({ producer }) {
    const module = producer.modules.catalogs.statement;
    let refused = null;
    try {
      module.statementFraming('SELECT 1; SELECT 2');
    } catch (error) {
      refused = error;
    }
    const framing = module.statementFraming('SELECT 1; SELECT 2');
    const rejected = refused !== null || framing.status === 'refused';
    if (!rejected) throw new Error('two-statement text admitted');
    return { verdict: framing };
  },
});

check({
  id: 'framing/trailing-content-refused',
  requirement: 'content after the final separator refuses as multipleStatements',
  async run({ producer }) {
    const module = producer.modules.catalogs.statement;
    const framing = module.statementFraming('SELECT 1; DROP TABLE users');
    if (framing.status === 'admitted') throw new Error('trailing content admitted');
    return { verdict: framing };
  },
});

check({
  id: 'framing/trailing-semicolon-admitted',
  requirement: 'one statement plus trailing semicolon/comment tail admits (spec: empty/comment/semicolon tail allowed)',
  async run({ producer }) {
    for (const sql of ['SELECT 1;', 'SELECT 1; -- tail', 'SELECT 1 /* tail */']) {
      framingResult(producer.modules.catalogs.statement, sql);
    }
    return { admitted: ['SELECT 1;', 'SELECT 1; -- tail', 'SELECT 1 /* tail */'] };
  },
});

check({
  id: 'framing/unterminated-refused',
  requirement: 'unterminated quotes, brackets and block comments refuse with byte offsets',
  async run({ producer }) {
    const module = producer.modules.catalogs.statement;
    const observations = {};
    for (const [label, sql] of Object.entries({ string: "SELECT 'x", bracket: 'SELECT [name', comment: 'SELECT 1 /* x' })) {
      const framing = module.statementFraming(sql);
      if (framing.status === 'admitted') throw new Error(`${label} unterminated text admitted`);
      observations[label] = framing.reason ?? framing;
    }
    return observations;
  },
});

check({
  id: 'framing/nul-and-surrogate-refused',
  requirement: 'NUL bytes and unpaired surrogates refuse before the engine reads the text',
  async run({ producer }) {
    const module = producer.modules.catalogs.statement;
    const observations = {};
    for (const [label, sql] of Object.entries({ nul: 'SELECT 1\u0000', surrogate: 'SELECT \uD800' })) {
      const framing = module.statementFraming(sql);
      if (framing.status === 'admitted') throw new Error(`${label} text admitted`);
      observations[label] = framing.reason;
    }
    return observations;
  },
});

check({
  id: 'analysis/write-sql-not-executed',
  requirement: READ_ONLY,
  async run({ producer, writeSubject }) {
    const before = writeSubject.rows();
    const session = producer.modules.catalogs.catalog.createSqliteSession({ path: writeSubject.path, DatabaseSync });
    const analysis = session.analyze({ id: 'w1', sql: "UPDATE counter SET n = n + 1 WHERE id = 1" });
    session.close();
    const after = writeSubject.rows();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`EXPLAIN observation executed the write: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    if (analysis.status !== 'analyzed') throw new Error(`write EXPLAIN not analyzed: ${JSON.stringify(analysis)}`);
    if (analysis.kind !== 'write') throw new Error(`modeled kind observed ${analysis.kind}; write/read distinction required in public output`);
    return { before, after, kind: analysis.kind, openWriteOperands: analysis.relations.filter(entry => entry.opcode === 'OpenWrite').length };
  },
});

check({
  id: 'analysis/parameters-refused',
  requirement: 'constant SQL admits no bind parameters; a Variable opcode in the program refuses',
  async run({ producer, ordersDbPath }) {
    const session = producer.modules.catalogs.catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const analysis = session.analyze({ id: 'p1', sql: 'SELECT id FROM users WHERE name = ?' });
    session.close();
    if (analysis.status !== 'refused' || analysis.refusal?.reason !== 'bindParametersUnsupported') throw new Error(JSON.stringify(analysis.refusal ?? analysis.status));
    return { refusal: analysis.refusal.reason };
  },
});

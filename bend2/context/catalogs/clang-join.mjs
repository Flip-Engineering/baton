import { resolve } from 'node:path';
import { analyzeSqliteStatement, joinRootpages } from './sqlite-statement.mjs';

export function statementsFromOutput(output) {
  const calls = new Map((output.calls ?? []).map((call) => [call.id, call]));
  return (output.helperCandidates ?? []).flatMap((candidate) => {
    const literals = candidate.sqlLiterals?.length ? candidate.sqlLiterals : [null];
    return literals.map((literal) => ({
      callId: candidate.callId,
      callSource: calls.get(candidate.callId)?.spelling ?? null,
      helperName: candidate.helperName,
      helperUsr: candidate.helperUsr,
      boundLocalUsr: candidate.boundLocalUsr,
      boundLocalName: candidate.boundLocalName,
      lineageStatus: candidate.lineageStatus,
      argumentIndex: literal?.argumentIndex ?? null,
      valueText: literal?.valueText ?? null,
      rawSource: literal?.rawSource ?? null,
    }));
  });
}

function catalogFromDatabase(db) {
  const rootpages = {};
  for (const row of db.prepare(
    'SELECT name,type,tbl_name,rootpage FROM main.sqlite_schema WHERE rootpage > 0',
  ).all()) {
    const key = String(row.rootpage);
    (rootpages[key] ??= []).push({
      schema: 'main', name: row.name, type: row.type, table: row.tbl_name,
    });
  }
  return { schema: 'main', rootpages };
}

export function joinClangStatements({ statements, db, database, catalog }) {
  const relations = [];
  const refs = new Map();
  const unresolved = [];

  for (const record of statements) {
    const { valueText, ...statement } = record;
    if (typeof valueText !== 'string') {
      unresolved.push({ code: 'dynamicStatement', statement });
      continue;
    }
    const plan = joinRootpages({ catalog, plan: analyzeSqliteStatement({
      db, sql: valueText, originCapability: { available: false, reason: 'notRequested' },
    }) });
    if (plan.status !== 'analyzed') {
      unresolved.push({
        code: plan.refusal?.reason ?? 'statementUnavailable',
        detail: plan.refusal?.detail ?? null, statement, statementText: valueText,
      });
      continue;
    }
    const span = record.rawSource ?? {};
    const source = {
      id: JSON.stringify(['source', 'clang', span.file, span.byteStart, span.byteEnd]),
      engine: 'clang',
      subject: { kind: 'position', path: span.file, byteStart: span.byteStart,
        byteEnd: span.byteEnd, expanded: span.expanded === true },
      projections: ['databaseAccesses'],
    };
    refs.set(source.id, source);
    for (const access of plan.unknownAccess) {
      unresolved.push({ code: 'modeledAccessUnavailable', ...access, statement });
    }
    for (const access of plan.relations) {
      const object = access.object;
      const entity = {
        id: JSON.stringify(['entity', database.path, object.schema, object.name]),
        engine: database.engine,
        subject: { kind: 'entity', database, schema: object.schema, name: object.name },
        projections: ['codeAccesses'],
      };
      refs.set(entity.id, entity);
      relations.push({
        id: JSON.stringify(['databaseAccess', record.callId, record.argumentIndex,
          access.cursor, access.opcode, object.schema, object.name]),
        kind: 'databaseAccess', classification: 'static-possible',
        from: source.id, to: entity.id,
        value: { statementText: valueText, statementKind: plan.kind, statement,
          object, rootpage: access.rootpage, opcode: access.opcode },
        limits: plan.limits,
      });
    }
  }
  return { status: 'complete', database, relations, refs: [...refs.values()], unresolved };
}

export async function databaseAccesses(output, { cwd, database: path }) {
  const statements = statementsFromOutput(output);
  if (!path) {
    return { status: 'unavailable', reason: 'databaseNotSelected',
      relations: [], refs: [], unresolved: statements.map(({ valueText, ...statement }) =>
        ({ code: 'databaseNotSelected', statement })) };
  }
  const database = { engine: 'sqlite-schema', path: resolve(cwd, path) };
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(database.path, { readOnly: true });
    db.exec('BEGIN');
    return joinClangStatements({ statements, db, database, catalog: catalogFromDatabase(db) });
  } catch (error) {
    return { status: 'unavailable', database,
      reason: error.code ?? error.name, detail: error.message,
      relations: [], refs: [], unresolved: statements.map(({ valueText, ...statement }) =>
        ({ code: 'catalogUnavailable', detail: error.message, statement })) };
  } finally {
    if (db) db.close();
  }
}

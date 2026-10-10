// Constant database call to catalog object joint for the TypeScript provider.
//
// The databaseAccesses producer already emits one `sqlCall` fact per resolved call site, carrying
// the ConstantSqlRecord the resolver owns: the call site, the resolved callee and receiver, the
// constant statement text, and the provenance the record was computed under. This joint is the
// database half of that fact: it frames the constant text, parses it against the catalog the
// request selected, and links the call to the catalog object the engine program actually names.
//
// The fact is never rewritten. The original sqlCall id, the call-site reference the fact already
// carries and the record itself stay as produced; the joint adds a relation whose `from` is that
// existing call-site reference and whose `to` is the catalog object's entity reference, plus the
// entity refs it cites and the findings it could not resolve.
//
// A call whose statement is not constant, whose callee did not resolve, or whose resolved
// declaration is not the admitted client declaration keeps its plain fact and becomes a finding:
// no access is invented from a name, and a missing catalog relation is never inferred from the
// callee's spelling.
//
// like the sqlite statement path, the accepted text is one statement, and the statement kind comes
// from the engine program rather than from the call site.

import { resolve } from 'node:path';
import { analyzeSqliteStatement, joinRootpages } from './sqlite-statement.mjs';

// The catalog the selected database holds: one entry per rootpage, with the schema it belongs to.
// A rootpage naming several objects, or an object outside main, stays unresolved in the join.
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

function statementIdentity(fact) {
  return {
    sqlCallId: fact.id,
    callSiteRef: fact.value?.callSiteRef ?? null,
    sourceBinding: fact.value?.sourceBinding ?? null,
    clientMatch: fact.value?.clientMatch ?? null,
    snapshotId: fact.value?.snapshotId ?? null,
  };
}

export function joinDatabaseAccesses({ facts, db, database, catalog }) {
  const relations = [];
  const refs = new Map();
  const unresolved = [];

  for (const fact of facts) {
    if (fact?.kind !== 'sqlCall') continue;
    const statement = statementIdentity(fact);
    const record = fact.value?.record ?? null;
    if (record === null) {
      unresolved.push({ code: 'recordAbsent', statement });
      continue;
    }
    if (record.sql?.status !== 'constant') {
      unresolved.push({ code: 'dynamicSql', detail: record.sql?.reason ?? null, statement });
      continue;
    }
    if (record.callee?.status !== 'resolved') {
      unresolved.push({ code: record.callee?.reason ?? 'calleeUnresolved', statement });
      continue;
    }
    if (statement.clientMatch === 'shadowed') {
      unresolved.push({ code: 'clientDeclarationMismatch', statement });
      continue;
    }

    const plan = joinRootpages({ catalog, plan: analyzeSqliteStatement({
      db, sql: record.sql.text, originCapability: { available: false, reason: 'notRequested' },
    }) });
    if (plan.status !== 'analyzed') {
      unresolved.push({
        code: plan.refusal?.reason ?? 'statementUnavailable',
        detail: plan.refusal?.detail ?? null, statement, statementText: record.sql.text,
      });
      continue;
    }

    for (const access of plan.unknownAccess) {
      unresolved.push({ code: 'modeledAccessUnavailable', ...access, statement });
    }
    let ordinal = 0;
    for (const access of plan.relations) {
      ordinal += 1;
      const object = access.object;
      const entity = {
        id: JSON.stringify(['entity', database.path, object.schema, object.name]),
        engine: database.engine,
        subject: { kind: 'entity', database, schema: object.schema, name: object.name },
        projections: ['codeAccesses'],
      };
      refs.set(entity.id, entity);
      relations.push({
        id: JSON.stringify(['databaseAccess', fact.id, String(ordinal), access.cursor,
          access.opcode, object.schema, object.name]),
        kind: 'databaseAccess', classification: 'static-possible',
        from: statement.callSiteRef ?? fact.id,
        to: entity.id,
        value: {
          statementText: record.sql.text,
          statementKind: plan.kind,
          literalKind: record.sql.literalKind ?? null,
          catalogSnapshotId: statement.snapshotId,
          statement,
          callee: record.callee,
          receiver: record.receiver ?? null,
          object, rootpage: access.rootpage, opcode: access.opcode,
        },
        limits: plan.limits,
      });
    }
  }
  return { status: 'complete', database, relations, refs: [...refs.values()], unresolved };
}

// The joint opens the selected database read-only for the length of one transaction and closes
// it, so the analysis never depends on a handle the caller kept. A request that selected no
// database, or a database this process cannot open, is reported with the calls it could not join
// rather than refused as a whole.
export async function databaseAccesses(result, { cwd, database: path }) {
  const facts = (result?.facts ?? []).filter((fact) => fact?.kind === 'sqlCall');
  if (!path) {
    return {
      status: 'unavailable', reason: 'databaseNotSelected',
      relations: [], refs: [],
      unresolved: facts.map((fact) => ({ code: 'databaseNotSelected', statement: statementIdentity(fact) })),
    };
  }
  const database = { engine: 'sqlite-schema', path: resolve(cwd, path) };
  let db;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(database.path, { readOnly: true });
    db.exec('BEGIN');
    return joinDatabaseAccesses({ facts, db, database, catalog: catalogFromDatabase(db) });
  } catch (error) {
    return {
      status: 'unavailable', database, reason: error.code ?? error.name, detail: error.message,
      relations: [], refs: [],
      unresolved: facts.map((fact) => ({ code: 'catalogUnavailable', detail: error.message, statement: statementIdentity(fact) })),
    };
  } finally {
    if (db) db.close();
  }
}

/**
 * Constant-SQL join fixture: resolved receiver declaration + literal/template SQL.
 * Positives: literal, template literal without substitutions, quoted method access.
 * Identity/profile negatives: parameterized SQL, dynamic concatenation,
 * unknown receiver binding, variable-keyed access, shadowed same-name function.
 * Oracle subjects are located by regex (see ../oracles/sql-join.oracle.json).
 */

import { openStore, DatabaseSync } from "fixture:sql-client";

function literalSql(store: DatabaseSync): unknown[] {
  return store.prepare("SELECT id, email FROM users").all();
}

function templateSql(store: DatabaseSync): unknown[] {
  return store.prepare(`SELECT count(*) AS n FROM users`).all();
}

function quotedAccessSql(store: DatabaseSync): unknown[] {
  return store["prepare"]("SELECT id, name FROM sessions").all();
}

function parameterizedSql(store: DatabaseSync, id: string): unknown[] {
  const sql = "SELECT id FROM users WHERE id = ?";
  return store.prepare(sql).all(id);
}

function dynamicSql(store: DatabaseSync, table: string): unknown[] {
  return store.prepare("SELECT id FROM " + table).all();
}

function unknownReceiver(store: DatabaseSync): unknown[] {
  const maybe: { prepare?: DatabaseSync["prepare"] } = {};
  return maybe.prepare!("SELECT id FROM logs").all();
}

function variableKeyedAccess(store: DatabaseSync, k: "prepare"): unknown[] {
  return store[k]("SELECT id FROM tokens").all();
}

function shadowedPrepare(rows: string[]): string {
  const prepare = (input: string): string => input.trim();
  return prepare(rows.join(","));
}

export function buildStores(): DatabaseSync {
  return new DatabaseSync();
}

export { openStore };

import { SqlClient } from "./sql-client";

export function selectUsers(client: SqlClient): unknown[] {
  return client.prepare("SELECT id, name FROM users WHERE note = ' FROM accounts'").all();
}

export function countUsers(client: SqlClient): unknown[] {
  return client.prepare(`SELECT count(*) FROM users`).all();
}

export function selectByKind(client: SqlClient, kind: string): unknown[] {
  return client.prepare(`SELECT id FROM users WHERE kind = '${kind}'`).all();
}

function prepare(sql: string): string {
  return sql;
}

export function shadowedPrepare(sql: string): string {
  return prepare(sql);
}

export function dynamicReceiver(client: any, sql: string): unknown {
  return client.prepare(sql);
}

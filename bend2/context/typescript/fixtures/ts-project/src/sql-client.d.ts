export declare class SqlClient {
  prepare(sql: string): Statement;
}

export interface Statement {
  all(...params: unknown[]): unknown[];
}

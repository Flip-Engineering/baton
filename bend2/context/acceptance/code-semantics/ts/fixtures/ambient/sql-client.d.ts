/**
 * Ambient client surface for the constant-SQL join fixture. This mirrors the
 * documented Node sqlite DatabaseSync/StatementSync shape as a fixture-authored
 * ambient declaration; it is a named input to the join, not a package claim.
 */

declare module "fixture:sql-client" {
  export interface StatementSync {
    all(...anonymousParameters: unknown[]): unknown[];
  }
  export class DatabaseSync {
    prepare(sql: string): StatementSync;
  }
  export function openStore(path: string): DatabaseSync;
}

/**
 * JS-edge fixture: importing an untyped JavaScript module with allowJs off
 * produces TS7016 and no symbol identity across the boundary.
 */

import { helper } from "./loose";

export function useJsHelper(n: number): number {
  return helper(n);
}

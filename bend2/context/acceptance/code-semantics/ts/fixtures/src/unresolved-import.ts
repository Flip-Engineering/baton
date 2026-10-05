/**
 * Unresolved-import fixture: the import specifier names a module that does not
 * exist in snapshot A. Resolution must record the failed lookup; when the module
 * appears in a later snapshot, resolution and the result identity change.
 */

import { missingValue } from "./late-module";

export function useMissing(): string {
  return missingValue;
}

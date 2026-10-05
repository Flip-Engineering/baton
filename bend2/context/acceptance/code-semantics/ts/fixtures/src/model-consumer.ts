/**
 * Model-consumer fixture: the importing handler whose module-use edges bind it to
 * the selected model export (parseUserProfile). Includes an alias import and a
 * use site; negatives live in unresolved-import.ts.
 */

import { parseUserProfile as parseProfile } from "./model-schema";

export function handleProfile(raw: unknown): string {
  const profile = parseProfile(raw);
  return `${profile.id}:${profile.email}`;
}

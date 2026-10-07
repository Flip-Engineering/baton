/**
 * Model-schema fixture: the selected module export bound by the model/codeAccesses
 * source join. Plain data + parse function; the runtime Zod engine is a separate
 * owner's surface and is not exercised here.
 */

export interface UserProfile {
  id: number;
  email: string;
}

export function parseUserProfile(input: unknown): UserProfile {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("profile must be an object");
  }
  const record = input as Record<string, unknown>;
  const id = record["id"];
  const email = record["email"];
  if (typeof id !== "number" || typeof email !== "string") {
    throw new TypeError("invalid profile fields");
  }
  return { id, email };
}

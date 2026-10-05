/**
 * Consumer fixture: use-site alias resolution and reference groups.
 * Oracle subjects are located by regex over these bytes (see ../oracles/*.json).
 */

import { makeMessage as mm, DEFAULT_NAME } from "./barrel";
import { FormalGreeter } from "./alias-chain";

export function run(): string[] {
  const impl = new FormalGreeter();
  const first = mm(impl);
  const second = mm(new FormalGreeter());
  return [first, second, DEFAULT_NAME];
}

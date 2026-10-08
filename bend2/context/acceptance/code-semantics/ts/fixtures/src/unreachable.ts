/**
 * Unreachable-code fixture: TS7027 family depends on allowUnreachableCode.
 * Under defaults: 7027 appears after the declared-never call, in the
 * suggestion family. With allowUnreachableCode: false: semantic errors after
 * the plain return and after the declared-never call. The const-arrow never
 * call leaves its follower reachable under pinned 5.9.3. The runner probes
 * both option sets.
 */

const arrowNever = (): never => {
  throw new Error("stop");
};

export function afterNeverCall(): number {
  arrowNever();
  return 1;
}

export function deadAfterReturn(): number {
  return 1;
  return 2;
}

export function deadAfterNever(): number {
  annotatedNeverThrow();
  return 3;
}

function annotatedNeverThrow(): never {
  throw new Error("stop");
}

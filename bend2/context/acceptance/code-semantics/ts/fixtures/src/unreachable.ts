/**
 * Unreachable-code fixture: TS7027 family depends on allowUnreachableCode.
 * Under defaults: 7027 appears only after the never-returning calls, in the
 * suggestion family. With allowUnreachableCode: false: semantic errors at all
 * three marked statements. The runner probes both option sets.
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

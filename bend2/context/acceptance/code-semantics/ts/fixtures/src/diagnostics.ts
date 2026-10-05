/**
 * Diagnostics fixture: 2454 definite assignment (semantic family).
 * Must be probed under strict: true; the diagnostic is expected.
 */

export function maybeInitialized(init: boolean): number {
  let x: number;
  if (init) {
    x = 1;
  }
  return x;
}

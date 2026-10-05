/**
 * Exceptions fixture: throw sites, lexical try/catch/finally structure, async and
 * callback boundaries. Static facts stop at these boundaries by specification.
 */

export class Boom extends Error {}

export function directThrow(n: number): number {
  if (n < 0) {
    throw new Boom("negative");
  }
  return n;
}

export function caughtDirect(n: number): string {
  try {
    directThrow(n);
    return "ok";
  } catch (err) {
    return `caught:${(err as Error).message}`;
  } finally {
    void 0;
  }
}

export function callbackThrowBoundary(rows: number[]): void {
  rows.map((row) => {
    if (row === 0) {
      throw new Boom("zero-row");
    }
    return row;
  });
}

export async function asyncThrow(): Promise<number> {
  throw new Boom("async-immediate");
}

export async function callerOfAsync(): Promise<number> {
  try {
    return await asyncThrow();
  } catch (err) {
    void err;
    return -1;
  }
}

export function returnRejectingPromise(): Promise<number> {
  try {
    return Promise.reject(new Boom("returned-rejection"));
  } catch (err) {
    void err;
    return Promise.resolve(-2);
  }
}

export function finallySuppresses(): number {
  try {
    throw new Boom("suppressed");
  } finally {
    return 7;
  }
}

/**
 * @throws {Boom} when n is exactly 13
 */
export function documentedThrow(n: number): number {
  if (n === 13) {
    throw new Boom("documented");
  }
  return n;
}

export function undocumentedThrow(n: number): number {
  if (n === 14) {
    throw new Boom("undocumented");
  }
  return n;
}

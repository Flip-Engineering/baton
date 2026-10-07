class Boom extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Boom";
  }
}

export function tryThrow(n: number): number {
  try {
    if (n < 0) {
      throw new Boom("negative");
    }
    return n;
  } catch (error) {
    return -1;
  } finally {
    console.log("cleanup");
  }
}

export function throwInCallback(values: number[]): void {
  values.forEach((value) => {
    if (value < 0) {
      throw new Boom(`bad value: ${value}`);
    }
  });
}

export const throwAsync = async (n: number): Promise<number> => {
  if (n < 0) {
    throw new Boom("negative async");
  }
  return n;
};

/**
 * @throws {Boom} when n is negative
 */
export declare function checked(n: number): number;

export function unchecked(n: number): number {
  if (n < 0) {
    throw new Boom("unchecked negative");
  }
  return n;
}

export function neverReturns(message: string): never {
  throw new Boom(message);
}

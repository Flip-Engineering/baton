/**
 * Declaration-merging fixture: one merged symbol carries multiple declarations.
 */

export interface Config {
  greeting: string;
}

export namespace Config {
  export const version = 1;
}

export function useConfig(c: Config): string {
  return c.greeting;
}

export function configVersion(): number {
  return Config.version;
}

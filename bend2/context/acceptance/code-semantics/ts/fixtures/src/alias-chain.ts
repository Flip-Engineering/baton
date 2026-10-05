/**
 * Alias-chain fixture: canonical name resolution through import alias and re-export.
 * Subjects are located by the runner via the marker comments; do not reflow lines
 * inside the marker comments' statements.
 */

export interface Greeter {
  greet(name: string): string;
}

export class FormalGreeter implements Greeter {
  greet(name: string): string {
    return `Hello, ${name}`;
  }
}

export function makeMessage(g: Greeter): string {
  return g.greet("world");
}

export const DEFAULT_NAME = "default";

// Interface, implementation and barrel re-export chain for the package probe.
export interface Greeter {
  greet(name: string): string;
}

export const DEFAULT_NAME = "world";

export class FormalGreeter implements Greeter {
  greet(name: string): string {
    return "Hello, " + name + ".";
  }
}

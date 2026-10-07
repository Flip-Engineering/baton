export interface Greeter {
  greet(name: string): string;
}

export class FormalGreeter implements Greeter {
  greet(name: string): string {
    return `Hello, ${name}`;
  }
}

export type Kind = "circle" | "square";

export const DEFAULT_NAME = "world";

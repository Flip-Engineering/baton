import { Greeter } from "./models";

export function makeMessage(g: Greeter, name: string): string {
  return g.greet(name);
}

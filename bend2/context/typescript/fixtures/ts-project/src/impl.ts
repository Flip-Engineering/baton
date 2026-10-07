import { DEFAULT_NAME, Greeter } from "./models";

export class GreeterImpl implements Greeter {
  greet(name: string): string {
    return `${DEFAULT_NAME}: ${name}`;
  }
}

// Mutation-control variant: definite-assignment violation must produce TS2454.
import { FormalGreeter } from "./index";

export function broken(flag: boolean): number {
  let value: number;
  if (flag) {
    value = 1;
  }
  return value;
}

export function healthy(): string {
  const greeter = new FormalGreeter();
  return greeter.greet("control");
}

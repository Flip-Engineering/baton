// Interface-dispatch caller: goes through a Greeter-typed receiver.
import { DEFAULT_NAME, Greeter } from "./models";

export function makeMessage(greeter: Greeter, name: string): string {
  return greeter.greet(name.length > 0 ? name : DEFAULT_NAME);
}

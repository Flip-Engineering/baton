import { FormalGreeter, makeMessage, GreeterImpl as Impl } from "./index";

export function run(): string {
  const greeter = new FormalGreeter();
  const impl = new Impl();
  const first = makeMessage(greeter, "first");
  const second = makeMessage(impl, "second");
  const third = makeMessage(new FormalGreeter(), "third");
  return [first, second, third].join(", ");
}

const config: any = { retries: 3 };
const dynamicKey = "retries";

export const retries: unknown = config[dynamicKey];

export const handlers = {
  greet: (name: string): string => makeMessage(new FormalGreeter(), name),
};

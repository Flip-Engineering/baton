// Consumer: import alias, quoted literal access, and the measured any-receiver
// blind spots. The any-typed receiver comes from JSON.parse's declared `any`
// return in the standard library, so the fixture source contains no `any`
// annotation while still reproducing the researched rule: an any-typed
// receiver produces no reference edges (package gate A1/A2 semantics).
import { FormalGreeter as G, makeMessage } from "./index";

export interface Disk {
  load(query: string): string;
  save(query: string): void;
}

export function getDisk(): Disk {
  return {
    load(query: string) {
      return "rows:" + query;
    },
    save(query: string) {
      if (query.length < 0) {
        throw new Error("unreachable");
      }
    },
  };
}

const greeter = new G();
const message = makeMessage(greeter, "wah");
const direct = greeter.greet(message);

const disk = getDisk();
const quoted = disk["load"]("quoted");

const untypedDisk = JSON.parse('{"load":"fixture","save":"fixture"}');
const computedKey = "load";
const computed = untypedDisk[computedKey]("keyed");
untypedDisk.save("jsonAny");

export { message, direct, quoted, computed };

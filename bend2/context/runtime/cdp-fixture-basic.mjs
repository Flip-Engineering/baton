// CDP lane fixture: a paused Node target with a closure, a class instance whose
// getter is counted, and a deterministic breakpoint line.
//
// The target is launched by the target keeper through bootstrap.mjs under
// /usr/bin/env -i with --inspect-brk=127.0.0.1:0. It waits at the initial break
// until the adapter sends Runtime.runIfWaitingForDebugger.
//
// The final stdout line reports how many times the getter ran, so a test can
// prove that reading property descriptors did not execute it: at the recorded
// stop the fixture has not yet read the getter, and its real read runs once.

const calls = { getter: 0 };

class Counter {
  constructor(label) {
    this.label = label;
    this._total = 0;
  }

  get total() {
    calls.getter += 1;
    return this._total;
  }

  add(amount) {
    this._total += amount;
    return this._total;
  }
}

const prefix = 'p';

function step(items) {
  const counter = new Counter('fixture');
  const seen = [];
  for (const item of items) counter.add(item);
  const value = counter.total;
  seen.push(`${prefix}${value}`);
  return { counter, seen, value };
}

const result = step([1, 2, 3]);
process.stdout.write(`${JSON.stringify({
  pid: process.pid,
  label: result.counter.label,
  total: result.value,
  seen: result.seen,
  getterCalls: calls.getter,
})}\n`);

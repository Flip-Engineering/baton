// Scheduling rules of the compiler's unit admission, run against stand-in
// workers. No compiler is started; memory readings come from this process and
// the host.
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const { Admission } = await import(pathToFileURL(path.join(source, "admission.ts")).href);
type Profile = { peak: number; metadata: number };
type Workers = { next(): { pid: number | undefined } | null; baseline(): number | null; retire(): Promise<boolean> };

const cpus = os.availableParallelism();
const small: Profile = { peak: 1 << 20, metadata: 0 };
// More memory than any host has, so a unit forecast at this size cannot be placed beside another.
const huge: Profile = { peak: 2 ** 60, metadata: 0 };
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60));

function workers(options: { reuse?: boolean; baseline?: number | null; idle?: number } = {}): Workers & { retired: number } {
  let idle = options.idle ?? 0;
  const stand_in = { retired: 0,
    next: () => options.reuse ? { pid: process.pid } : null,
    baseline: () => options.baseline === undefined ? 1 << 20 : options.baseline,
    retire: async () => { stand_in.retired++; if (idle === 0) return false; idle--; return true; } };
  return stand_in;
}

// Runs jobs whose results the test releases one at a time.
function batch(admission: any, supply: Workers, keys: string[]) {
  const started: number[] = [], release = new Map<number, (profile: Profile) => void>(), fail = new Map<number, (error: unknown) => void>();
  let running = 0, most = 0;
  const done = admission.run(keys.map((_: string, index: number) => index), (job: number) => keys[job], (job: number) => {
    started.push(job); running++; most = Math.max(most, running);
    const complete = new Promise((resolve, reject) => {
      release.set(job, profile => { running--; resolve({ value: job, profile }); });
      fail.set(job, error => { running--; reject(error); });
    });
    return { pid: () => process.pid, metadata: () => null, complete };
  }, supply);
  return { started, release, fail, done, most: () => most };
}

// 1. The first unit of a compilation runs alone. Once one unit is measured,
// units without a profile run together, up to the available processors.
{
  const run = batch(new Admission(() => {}), workers(), ["a", "b", "c", "d", "e", "f"]);
  await settle();
  assert.deepEqual(run.started, [0], "a compilation with no measurement starts one unit");
  run.release.get(0)!(small); await settle();
  assert.equal(run.started.length, 1 + Math.min(5, Math.max(1, cpus)), "unmeasured units start together once one is measured");
  for (let at = 0; at < 8; at++) { await settle(); for (const job of run.started) run.release.get(job)?.(small); }
  assert.deepEqual(await run.done, [0, 1, 2, 3, 4, 5], "results keep job order");
}

// 2. A unit forecast beyond the available memory runs only when nothing else runs.
{
  const run = batch(new Admission(() => {}), workers(), ["a", "b", "c", "d"]);
  await settle(); run.release.get(0)!(huge); await settle();
  assert.deepEqual(run.started, [0, 1], "one unit starts once the forecast exceeds the available memory");
  run.release.get(1)!(small); await settle();
  assert.deepEqual(run.started, [0, 1, 2]);
  run.release.get(2)!(small); await settle(); run.release.get(3)?.(small);
  await run.done;
  assert.equal(run.most(), 1, "no unit overlaps another once the forecast exceeds the available memory");
}

// 3. A unit with its own measurement is forecast from it, not from the largest.
{
  const admission = new Admission(() => {});
  const first = batch(admission, workers(), ["big", "small"]);
  await settle(); first.release.get(0)!(huge); await settle(); first.release.get(1)!(small); await first.done;
  const second = batch(admission, workers(), ["small", "small", "small"]);
  await settle();
  assert.equal(second.started.length, Math.min(3, cpus), "measured units start together despite a huge unit elsewhere");
  for (let at = 0; at < 4; at++) { for (const job of second.started) second.release.get(job)?.(small); await settle(); }
  await second.done;
}

// 4. A new process adds the startup size to a unit's need; a reused worker does not.
{
  const fresh = batch(new Admission(() => {}), workers({ baseline: 2 ** 60 }), ["a", "b", "c"]);
  await settle(); fresh.release.get(0)!(small); await settle();
  assert.deepEqual(fresh.started, [0, 1], "a new process the host cannot hold does not start beside a running unit");
  fresh.release.get(1)!(small); await settle(); fresh.release.get(2)?.(small); await fresh.done;
  const reused = batch(new Admission(() => {}), workers({ baseline: 2 ** 60, reuse: true }), ["a", "b", "c"]);
  await settle(); reused.release.get(0)!(small); await settle();
  assert.equal(reused.started.length, Math.min(3, cpus), "units on idle workers start together");
  for (let at = 0; at < 4; at++) { for (const job of reused.started) reused.release.get(job)?.(small); await settle(); }
  await reused.done;
  const unknown = batch(new Admission(() => {}), workers({ baseline: null }), ["a", "b", "c"]);
  await settle(); unknown.release.get(0)!(small); await settle();
  assert.deepEqual(unknown.started, [0, 1], "a new process of unknown size waits for the running unit");
  unknown.release.get(1)!(small); await settle(); unknown.release.get(2)?.(small); await unknown.done;
}

// 5. Idle workers are stopped before a unit waits for memory.
{
  const admission = new Admission(() => {});
  const warm = batch(admission, workers(), ["warm"]);
  await settle(); warm.release.get(0)!(huge); await warm.done;
  const supply = workers({ idle: 2 });
  const run = batch(admission, supply, ["x", "y"]);
  await settle();
  assert.deepEqual(run.started, [0], "the second unit waits");
  assert.equal(supply.retired, 3, "two idle workers stop, then the unit waits for the running one");
  run.release.get(0)!(small); await settle(); run.release.get(1)?.(small); await run.done;
}

// 6. A failed unit stops admission and is reported after running units finish.
{
  const run = batch(new Admission(() => {}), workers(), ["a", "b", "c"]);
  const outcome = assert.rejects(run.done, /unit failed/);
  await settle(); run.fail.get(0)!(new Error("unit failed")); await settle();
  assert.deepEqual(run.started, [0], "no unit starts after a failure");
  await outcome;
}

console.log(JSON.stringify({ test: "admission_scheduling", status: "passed", available_cpus: cpus }));

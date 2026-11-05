// term_compare compares two calls of one definition by their arguments before
// unfolding either. A law that reached an @unsafe loop recursing under a lambda
// otherwise unfolded the loop without end: no error, and about 1 GB of memory per
// minute until the host ran out (#1447). Each fixture runs in a child process
// stopped at RESIDENT_CAP_KB or CHECK_MILLISECONDS, so a regression fails this test
// and leaves the host alone. Every fixture checks in seconds and well under the cap.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const RESIDENT_CAP_KB = 2 * 1024 * 1024;
const CHECK_MILLISECONDS = 300_000;
const main = path.join(import.meta.dir, "../../compiler/upstream/main.ts");

function resident_kb(pid: number): number {
  try {
    const status = fs.readFileSync("/proc/" + pid + "/status", "utf8");
    return Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

async function check(name: string): Promise<{ code: number; capped: boolean; output: string }> {
  const fixture = path.join(import.meta.dir, "fixtures", name + ".bend");
  const child = Bun.spawn([process.execPath, "--smol", main, fixture, "--check-only"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  let capped = false;
  const started = Date.now();
  const watch = setInterval(() => {
    if (resident_kb(child.pid) > RESIDENT_CAP_KB || Date.now() - started > CHECK_MILLISECONDS) {
      capped = true;
      child.kill();
    }
  }, 250);
  const [stdout, stderr, code] = await Promise.all(
    [new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearInterval(watch);
  return { code, capped, output: stdout + stderr };
}

const reached = await check("term_compare_unsafe_loop");
assert.equal(reached.capped, false, "a law reaching an @unsafe loop finishes");
assert.equal(reached.code, 0, "a law reaching an @unsafe loop checks:\n" + reached.output);

const refused = await check("term_compare_unsafe_loop_refused");
assert.equal(refused.capped, false, "a loop called with different arguments finishes");
assert.notEqual(refused.code, 0, "a loop called with different arguments is refused");
assert.match(refused.output, /different_names_are_not_one_loop/, "the refusal names the law");

const ignored = await check("term_compare_same_call_unfolds");
assert.equal(ignored.capped, false, "calls differing in an ignored argument finish");
assert.equal(ignored.code, 0, "calls differing in an ignored argument check:\n" + ignored.output);

const nested = await check("term_compare_nested_mismatch");
assert.equal(nested.capped, false, "a mismatch inside nested calls finishes");
assert.notEqual(nested.code, 0, "a mismatch inside nested calls is refused");
assert.match(nested.output, /nested_calls_keep_their_difference/, "the refusal names the law");

console.log(JSON.stringify({ test: "term_compare_unsafe_loop", fixtures: 4 }));

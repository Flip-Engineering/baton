// resident() of the compiler's unit admission, read from a stand-in proc directory.
// statm counters are used while they show an address space. A statm that shows none,
// cannot be read or cannot be parsed leaves the decision to the status file, which
// gives a size, 0 or null as the status reading always did.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const { resident, forget_resident } = await import(pathToFileURL(path.join(source, "admission.ts")).href);

const page = Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim());
assert.ok(Number.isSafeInteger(page) && page > 0, "getconf reports a page size");
const proc = fs.mkdtempSync(path.join(os.tmpdir(), "bend-resident-"));
const write = (pid: number, name: string, text: string): void => {
  fs.mkdirSync(path.join(proc, String(pid)), { recursive: true });
  fs.writeFileSync(path.join(proc, String(pid), name), text);
};
// Open descriptors of this process on the stand-in statm file of pid.
const kept = (pid: number): number => fs.readdirSync("/proc/self/fd").filter(fd => {
  try { return fs.readlinkSync("/proc/self/fd/" + fd) === path.join(proc, String(pid), "statm"); }
  catch { return false; }
}).length;

// 1. A statm without an address space leaves the decision to status: VmRSS 0 kB gives 0.
write(101, "statm", "0 0 0 0 0 0 0\n");
write(101, "status", "Name:\tzero\nVmRSS:\t       0 kB\n");
assert.equal(resident(101, proc), 0, "status VmRSS 0 kB gives 0");
assert.equal(kept(101), 0, "a statm without an address space keeps no descriptor");

// 2. The same statm with a status that has no VmRSS gives null.
write(102, "statm", "0 0 0 0 0 0 0\n");
write(102, "status", "Name:\texited\nState:\tZ (zombie)\n");
assert.equal(resident(102, proc), null, "status without VmRSS gives null");
assert.equal(kept(102), 0, "a statm without an address space keeps no descriptor");

// 3. A statm with an address space gives its resident pages times the page size. The
//    descriptor stays open, reads the current counters, and forget_resident closes it.
write(103, "statm", "1000 25 3 1 0 50 0\n");
write(103, "status", "VmRSS:\t999 kB\n");
assert.equal(resident(103, proc), 25 * page, "statm resident pages are used");
assert.equal(kept(103), 1, "the statm descriptor stays open");
fs.writeFileSync(path.join(proc, "103", "statm"), "1000 30 3 1 0 50 0\n");
assert.equal(resident(103, proc), 30 * page, "a kept descriptor reads the current counters");
forget_resident(103, proc);
assert.equal(kept(103), 0, "forget_resident closes the descriptor");

// 4. Counters that do not parse leave the decision to status.
write(104, "statm", "x y\n");
write(104, "status", "VmRSS:\t12 kB\n");
assert.equal(resident(104, proc), 12 * 1024, "statm that does not parse falls back to status");
assert.equal(kept(104), 0, "statm that does not parse keeps no descriptor");

// 5. A pid with neither file gives null.
assert.equal(resident(105, proc), null, "a pid with no files gives null");

fs.rmSync(proc, { recursive: true, force: true });
console.log(JSON.stringify({ test: "resident_statm", status: "passed", page_size: page }));

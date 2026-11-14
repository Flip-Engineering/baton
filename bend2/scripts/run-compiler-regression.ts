// Supported runner for the compiler regression tests of issues #1390-1393.
// Usage: bun --smol bend2/scripts/run-compiler-regression.ts [REPOSITORY_ROOT]
//   [--artifact-dir DIR] [--private-fs DIR] [--timeout-ms N]
//
// Frozen source snapshots qualify with this runner: it supplies every
// required argument, establishes the private-filesystem precondition the
// cache-pressure test needs, and reports product assertion failures
// separately from setup errors.
//
// The five arm_eq tests take the compiler source directory. The cache
// pressure test takes the repository root, an artifact directory the runner
// keeps, and a separately mounted private filesystem: --private-fs, then
// $PRIVATE_FILESYSTEM, then a 512M tmpfs the runner mounts itself. When no
// private filesystem is available the pressure test reports a setup error
// and the remaining tests still run.
//
// Exit status: 0 when every test passes, 1 when a product assertion fails,
// 2 when only setup errors remain.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SELF = "run-compiler-regression";

function usage(): string {
  return `usage: bun --smol bend2/scripts/${SELF}.ts [REPOSITORY_ROOT] `
    + `[--artifact-dir DIR] [--private-fs DIR] [--timeout-ms N]`;
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(usage());
  process.exit(0);
}

const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const key = argv[i];
    const value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")
      ? argv[++i] : "";
    flags.set(key, value);
  } else {
    positional.push(argv[i]);
  }
}

const root = path.resolve(positional[0]
  ?? path.join(import.meta.dir, "..", ".."));
// No default per-test timeout: the calling job's timeout bounds the run.
// --timeout-ms sets a per-test timeout only when the caller supplies one.
const timeoutMs = flags.has("--timeout-ms")
  ? Number(flags.get("--timeout-ms")) : undefined;
if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
  console.error(`${SELF}: --timeout-ms needs a positive millisecond count`);
  process.exit(2);
}

function fail(message: string): never {
  console.error(`${SELF}: ${message}\n${usage()}`);
  process.exit(2);
}

const testDir = path.join(root, "bend2", "test", "compiler");
const compilerCandidates = [
  path.join(root, "bend2", "compiler", "upstream", "comp.ts"),
  path.join(root, "bend2", "comp.ts"),
];
if (!fs.existsSync(testDir)) fail(`no compiler tests under ${testDir}`);
const compilerDir = compilerCandidates.some((p) => fs.existsSync(p))
  ? root : null;

const scratchDir = path.join(root, ".scratch");
fs.mkdirSync(scratchDir, { recursive: true });
const artifactDir = flags.get("--artifact-dir") !== undefined
  && flags.get("--artifact-dir") !== ""
  ? path.resolve(flags.get("--artifact-dir") as string)
  : fs.mkdtempSync(path.join(scratchDir, "compiler-regression-"));
fs.mkdirSync(artifactDir, { recursive: true });

type Verdict = "PASS" | "FAIL" | "SETUP-ERROR" | "TIMEOUT";
interface Outcome {
  name: string;
  verdict: Verdict;
  detail: string;
  status: number | null;
}
const outcomes: Outcome[] = [];

function record(name: string, verdict: Verdict, detail: string,
  status: number | null = null): void {
  outcomes.push({ name, verdict, detail, status });
  console.log(`${verdict} ${name} ${detail}`.trimEnd());
}

function runTest(name: string, file: string, args: string[]): void {
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-cache-`));
  const child = spawnSync(process.execPath, ["--smol",
    path.join(testDir, file), ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1 << 30,
    env: {
      ...process.env,
      XDG_CACHE_HOME: cacheHome,
      BEND_NO_TELEMETRY: "1",
      BUN_JSC_maxPerThreadStackUsage: "67108864",
    },
  });
  fs.rmSync(cacheHome, { recursive: true, force: true });
  const tail = (child.stderr || child.stdout || "").trim().split("\n")
    .slice(-3).join(" | ").slice(0, 300);
  if (child.error !== undefined
    && (child.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    record(name, "TIMEOUT", `no result after ${timeoutMs} ms`);
  } else if (child.status === 0) {
    record(name, "PASS", tail, 0);
  } else if (child.status === 2) {
    record(name, "SETUP-ERROR", tail || "exit 2", 2);
  } else {
    record(name, "FAIL", tail || `exit ${child.status}`, child.status);
  }
}

// The cache-pressure test needs a filesystem mounted separately from its
// parent: pressure fills it to ENOSPC and checks reclamation there.
let mountedOurs = "";
function privateFilesystem(): string | null {
  const given = flags.get("--private-fs") || process.env.PRIVATE_FILESYSTEM;
  if (given !== undefined && given !== "") {
    const dir = path.resolve(given);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return null;
    }
    return fs.statSync(dir).dev !== fs.statSync(path.dirname(dir)).dev
      ? dir : null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compiler-pressure-fs-"));
  const mount = spawnSync("mount",
    ["-t", "tmpfs", "-o", "size=512M,nr_inodes=1M", "tmpfs", dir],
    { encoding: "utf8" });
  if (mount.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  mountedOurs = dir;
  return dir;
}

const armTests: [string, string][] = [
  ["arm_eq_adt_r", "arm_eq_adt_r.ts"],
  ["arm_eq_ann_share", "arm_eq_ann_share.ts"],
  ["arm_eq_binder_key", "arm_eq_binder_key.ts"],
  ["arm_eq_ref_bang", "arm_eq_ref_bang.ts"],
  ["arm_eq_ref_bang_share", "arm_eq_ref_bang_share.ts"],
];
if (compilerDir === null) {
  for (const [name] of armTests) {
    record(name, "SETUP-ERROR", `no comp.ts under ${root}`);
  }
} else {
  for (const [name, file] of armTests) {
    runTest(name, file, [compilerDir]);
  }
}

const pressureFs = privateFilesystem();
if (pressureFs === null) {
  const hint = (flags.get("--private-fs") || process.env.PRIVATE_FILESYSTEM)
    ? "the given private filesystem is missing or shares its parent's device"
    : "cannot mount a tmpfs here and no --private-fs was given";
  record("unit_cache_pressure", "SETUP-ERROR", hint);
} else {
  runTest("unit_cache_pressure", "unit_cache_pressure.ts",
    [root, artifactDir, pressureFs]);
}

if (mountedOurs !== "") {
  const unmount = spawnSync("umount", [mountedOurs], { encoding: "utf8" });
  if (unmount.status !== 0) {
    console.log(`SETUP-ERROR unit_cache_pressure `
      + `private filesystem left mounted at ${mountedOurs}`);
  } else {
    fs.rmSync(mountedOurs, { recursive: true, force: true });
  }
}

const summary = {
  tests: outcomes,
  artifact_dir: artifactDir,
  passed: outcomes.filter((o) => o.verdict === "PASS").length,
  product_failures: outcomes.filter((o) => o.verdict === "FAIL"
    || o.verdict === "TIMEOUT").map((o) => o.name),
  setup_errors: outcomes.filter((o) => o.verdict === "SETUP-ERROR")
    .map((o) => o.name),
};
console.log(`SUMMARY ${JSON.stringify(summary)}`);
if (summary.product_failures.length > 0) process.exit(1);
if (summary.setup_errors.length > 0) process.exit(2);

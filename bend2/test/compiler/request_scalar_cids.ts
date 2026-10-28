import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-request-cids-"));
fs.mkdirSync(directory, { recursive: true });
const retained = process.argv[3] !== undefined;
async function run(name: string, command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const started = new Date().toISOString(), before = performance.now();
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on("data", chunk => out.push(chunk)); child.stderr.on("data", chunk => err.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
  fs.writeFileSync(path.join(directory, name + ".stdout"), stdout);
  fs.writeFileSync(path.join(directory, name + ".stderr"), stderr);
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify({ command, args,
    pid: child.pid, started, ended: new Date().toISOString(), code, duration_ms: performance.now() - before }));
  return { code, stdout, stderr };
}
try {
  const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(source, "comp.ts")).href);
  const book = Bend.book_nil(), seen = new Map<string, string | null>();
  await Bend.book_load(book, path.join(root, "bend2/test/compiler/fixtures/request_scalar_spin_cid.bend"), "", seen);
  Bend.book_valid(book);
  const c = Comp.compile_book(book), file = path.join(directory, "output.c");
  fs.writeFileSync(file, c);
  const defined = new Set([...c.matchAll(/^#define (CID_[A-Z0-9_]+)\s+\d+$/gm)].map(match => match[1]));
  const used = new Set([...c.matchAll(/\bCID_[A-Z0-9_]+\b/g)].map(match => match[0]));
  const missing = [...used].filter(name => name !== "CID_ARITY_T" && name !== "CID_HOT_T" && !defined.has(name)).sort();
  fs.writeFileSync(path.join(directory, "cid-check.json"), JSON.stringify({ missing,
    c_sha256: createHash("sha256").update(c).digest("hex"), c_bytes: Buffer.byteLength(c),
    inputs: [...seen].map(([file, namespace]) => ({ file, namespace,
      sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") })) }, null, 2));
  const binary = path.join(directory, "request-scalar");
  const cc = await run("clang", process.env.CC ?? "clang-19", ["-std=c11", "-O1", "-pthread", file, "-lm", "-o", binary]);
  assert.deepEqual(missing, [], "every constructor referenced by scalar decoding has its CID declaration");
  assert.equal(cc.code, 0, cc.stderr);
  const cases: [string, string][] = [["", ""], ["61", "a"], ["c3a9", "é"], ["e4b8ad", "中"],
    ["f09fa689", "🦉"], ["c080", "invalidUtf8"], ["80", "invalidUtf8"], ["e4b8", "invalidUtf8"],
    ["eda080", "surrogate"], ["f4908080", "invalidUtf8"], ["00", "nulInString"]];
  for (let index = 0; index < cases.length; index++) {
    const [hex, expected] = cases[index], result = await run("case-" + index, binary, [hex]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trimEnd(), expected, hex);
  }
  console.log("PASS scalar decoder CIDs and UTF-8 behavior");
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }

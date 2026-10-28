import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as Fact from "./facts.ts";
import { Fragments } from "./fragments.ts";
import type { Fragment } from "./fragments.ts";
import { file_digest } from "./store.ts";
import type { BodyInput, StoreIndex } from "./store.ts";

export type UnitData = {
  unit: string; facts_only: boolean; trace: Fact.Event[]; lend: string[];
  masks: Fact.BorrowMask[]; refs: string[]; edges: [string, string][];
  inputs: BodyInput[]; fragment: string;
};
type Variant = { scope: string; data: Omit<UnitData, "fragment">;
  fragment: Record<string, any>; code_sha256: string };

function digest(data: string): string { return createHash("sha256").update(data).digest("hex"); }
const named = (name: string): boolean => /^[a-f0-9]{64}$/.test(name);

function* directories(directory: string): Generator<string> {
  const handle = fs.opendirSync(directory);
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      if (entry.isDirectory() && named(entry.name)) yield path.join(directory, entry.name);
    }
  } finally { handle.closeSync(); }
}

function ranges(fragment: Record<string, any>): any[] {
  return [...fragment.segs, ...fragment.spins, ...fragment.statics, ...fragment.tabs].map(value => value.body);
}

function relocate(fragment: Record<string, any>, directory: string): Record<string, any> {
  const value = structuredClone(fragment);
  value.directory = directory;
  for (const range of ranges(value)) range.file = path.join(directory, "code");
  return value;
}

function copy(source: string, destination: string): void {
  try { fs.linkSync(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

export function emission(data: UnitData): Fact.Emission<Fragment> {
  return { key: data.unit, trace: Fact.from_events(data.trace), result: {
    lend: new Set(data.lend), masks: data.masks, refs: new Set(data.refs),
    edges: data.edges, code: Fragments.read(data.fragment) } };
}

export class UnitCache {
  readonly root: string;
  private scope: string;
  private index: StoreIndex;
  private bodies: Map<string, StoreIndex["bodies"][number][1]>;
  private verified = new Set<string>();
  constructor(private program: string, private evidence: string) {
    this.index = JSON.parse(fs.readFileSync(path.join(program, "index.json"), "utf8"));
    this.bodies = new Map(this.index.bodies);
    this.scope = digest(JSON.stringify([this.index.compiler, this.index.header.sha256,
      this.index.tables.sha256, this.index.bodies.map(([name, section]) => [name, section.mode])]));
    this.root = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "bend2", "cgen-units-v1");
    fs.mkdirSync(this.root, { recursive: true });
  }

  private observe(event: string, details: Record<string, unknown>): void {
    const value = { compiler_diagnostic: "cache." + event, at: new Date().toISOString(),
      pid: process.pid, memory: process.memoryUsage(), ...details };
    fs.appendFileSync(path.join(this.evidence, "unit-cache.jsonl"), JSON.stringify(value) + "\n");
    if (process.env.BEND_COMPILER_DIAGNOSTICS === "1") process.stderr.write(JSON.stringify(value) + "\n");
  }

  private directory(job: Fact.Job): string {
    return path.join(this.root, this.scope, digest(JSON.stringify([job.key, job.facts_only])));
  }

  private applicable(value: Variant, job: Fact.Job): string | null {
    if (value.scope !== this.scope || value.data.unit !== job.key || value.data.facts_only !== job.facts_only) {
      throw new Error("Cached compiler unit identity differs: " + job.key);
    }
    for (const input of value.data.inputs) {
      const section = this.bodies.get(input.name);
      if (section === undefined || section.sha256 !== input.sha256 || section.mode !== input.mode) return "body:" + input.name;
      if (!this.verified.has(input.name)) {
        if (file_digest(path.join(this.program, section.file)) !== section.sha256) {
          throw new Error("Checked store section changed: " + section.file);
        }
        this.verified.add(input.name);
      }
    }
    const trace = Fact.from_events(value.data.trace);
    for (const [name, answer] of trace.reads) {
      const colon = name.indexOf(":"), kind = name.slice(0, colon) as Fact.Kind;
      if (job.initial[kind].has(name.slice(colon + 1)) !== answer) return "fact:" + name;
    }
    Fact.replay_trace(value.data.trace, job.initial, job.key);
    return null;
  }

  get(job: Fact.Job): Fact.Emission<Fragment> | undefined {
    const before = performance.now(), directory = this.directory(job);
    let chosen: string | null = null, selected: Variant | null = null;
    if (fs.existsSync(directory)) for (const candidate of directories(directory)) {
      if (chosen !== null && candidate >= chosen) continue;
      let bytes: string;
      try { bytes = fs.readFileSync(path.join(candidate, "metadata.json"), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (digest(bytes) !== path.basename(candidate)) throw new Error("Cached compiler unit record changed: " + candidate);
      const value: Variant = JSON.parse(bytes), invalid = this.applicable(value, job);
      if (invalid === null) { chosen = candidate; selected = value; }
      else this.observe("invalidate", { unit: job.key, facts_only: job.facts_only, variant: candidate, reason: invalid });
    }
    if (chosen === null) {
      this.observe("miss", { unit: job.key, facts_only: job.facts_only, scope: this.scope, duration_ms: performance.now() - before });
      return undefined;
    }
    const value = selected!;
    const fragment = fs.mkdtempSync(path.join(this.program, "fragments", "cached-"));
    try { copy(path.join(chosen, "code"), path.join(fragment, "code")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fs.rmdirSync(fragment);
      this.observe("miss", { unit: job.key, facts_only: job.facts_only, scope: this.scope,
        reason: "evicted", duration_ms: performance.now() - before });
      return undefined;
    }
    if (file_digest(path.join(fragment, "code")) !== value.code_sha256) throw new Error("Cached compiler unit code changed: " + chosen);
    fs.writeFileSync(path.join(fragment, "metadata.json"), JSON.stringify(relocate(value.fragment, fragment)));
    const now = new Date();
    try { fs.utimesSync(chosen, now, now); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const result = emission({ ...value.data, fragment });
    this.observe("hit", { unit: job.key, facts_only: job.facts_only, variant: chosen,
      inputs: value.data.inputs, bytes: result.result.code.bytes, duration_ms: performance.now() - before });
    return result;
  }

  private reclaim(need: bigint): void {
    for (;;) {
      const state = fs.statfsSync(this.root, { bigint: true });
      if (state.bavail * state.bsize >= need) return;
      let victim: { directory: string; modified: number; bytes: number } | null = null;
      for (const scope of directories(this.root)) for (const unit of directories(scope)) for (const entry of directories(unit)) {
        try {
          const code = fs.statSync(path.join(entry, "code")), meta = fs.statSync(path.join(entry, "metadata.json"));
          const modified = fs.statSync(entry).mtimeMs;
          if (code.nlink === 1 && (victim === null || modified < victim.modified)) {
            victim = { directory: entry, modified, bytes: code.size + meta.size };
          }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (victim === null) return;
      fs.rmSync(victim.directory, { recursive: true, force: true });
      this.observe("evict", { ...victim, available_bytes: String(state.bavail * state.bsize), required_bytes: String(need) });
    }
  }

  put(job: Fact.Job, data: UnitData): void {
    const before = performance.now(), directory = this.directory(job);
    fs.mkdirSync(directory, { recursive: true });
    const code = path.join(data.fragment, "code");
    const metadata = JSON.parse(fs.readFileSync(path.join(data.fragment, "metadata.json"), "utf8"));
    const { unit, facts_only, trace, lend, masks, refs, edges, inputs } = data;
    const value: Variant = { scope: this.scope, data: { unit, facts_only, trace, lend, masks, refs, edges, inputs },
      fragment: relocate(metadata, ""), code_sha256: file_digest(code) };
    const bytes = JSON.stringify(value), name = digest(bytes), destination = path.join(directory, name);
    if (fs.existsSync(destination)) {
      if (fs.readFileSync(path.join(destination, "metadata.json"), "utf8") !== bytes
        || file_digest(path.join(destination, "code")) !== value.code_sha256) {
        throw new Error("Different compiler unit cache content: " + destination);
      }
      return;
    }
    const state = fs.statfsSync(directory, { bigint: true });
    const data_bytes = fs.statSync(code).dev === fs.statSync(directory).dev ? 0n : BigInt(fs.statSync(code).size);
    const metadata_blocks = (BigInt(Buffer.byteLength(bytes)) + state.bsize - 1n) / state.bsize;
    this.reclaim(data_bytes + (metadata_blocks + 1n) * state.bsize);
    const temporary = fs.mkdtempSync(path.join(directory, ".write-"));
    copy(code, path.join(temporary, "code"));
    fs.writeFileSync(path.join(temporary, "metadata.json"), bytes);
    try { fs.renameSync(temporary, destination); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      if (fs.readFileSync(path.join(destination, "metadata.json"), "utf8") !== bytes
        || file_digest(path.join(destination, "code")) !== value.code_sha256) {
        throw new Error("Different compiler unit cache content: " + destination);
      }
      fs.rmSync(temporary, { recursive: true });
    }
    this.observe("write", { unit: job.key, facts_only: job.facts_only, variant: destination,
      bytes: metadata.bytes, record_bytes: Buffer.byteLength(bytes), inputs: data.inputs,
      duration_ms: performance.now() - before });
  }
}

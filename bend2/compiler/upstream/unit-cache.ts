import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as Fact from "./facts.ts";
import { Fragments } from "./fragments.ts";
import type { Fragment } from "./fragments.ts";
import { file_digest } from "./store.ts";
import type { BodyInput, Entries, StoreIndex } from "./store.ts";

type HeaderKind = "tld" | "ctr" | "src" | "sites" | "masks" | "local" | "bang" | "field";
export type UnitData = {
  unit: string; facts_only: boolean; trace: Fact.Event[]; lend: string[];
  masks: Fact.BorrowMask[]; refs: string[]; edges: [string, string][];
  inputs: BodyInput[]; reads: { names: [HeaderKind, string][]; listed: HeaderKind[] }; fragment: string;
};
// The header entries a unit read and the identity each had, and the complete
// collections it listed.
type Variant = { scope: string; data: Omit<UnitData, "fragment" | "reads"> & {
  header: [HeaderKind, string, string][]; listed: [HeaderKind, string][] };
  fragment: Record<string, any>; code_sha256: string };

function digest(data: string): string { return createHash("sha256").update(data).digest("hex"); }
const named = (name: string): boolean => /^[a-f0-9]{64}$/.test(name);

function filesystem_error(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string"
    && typeof (error as NodeJS.ErrnoException).syscall === "string";
}

function* directories(directory: string, staging = false): Generator<string> {
  let handle: fs.Dir;
  try { handle = fs.opendirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      if (entry.isDirectory() && (named(entry.name) || (staging && /^\.write-\d+-/.test(entry.name)))) {
        yield path.join(directory, entry.name);
      }
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

export function emission(data: Pick<UnitData, "unit" | "trace" | "lend" | "masks" | "refs" | "edges" | "fragment">):
  Fact.Emission<Fragment> {
  return { key: data.unit, trace: Fact.from_events(data.trace), result: {
    lend: new Set(data.lend), masks: data.masks, refs: new Set(data.refs),
    edges: data.edges, code: Fragments.read(data.fragment) } };
}

export class UnitCache {
  readonly root: string;
  private scope: string;
  private index: StoreIndex;
  private bodies: Map<string, StoreIndex["bodies"][number][1]>;
  private entries: Entries;
  private names: Record<HeaderKind, Map<string, string>>;
  private bangs: Set<string>;
  private verified = new Set<string>();
  constructor(private program: string, private evidence: string) {
    this.index = JSON.parse(fs.readFileSync(path.join(program, "index.json"), "utf8"));
    this.bodies = new Map(this.index.bodies);
    const section = this.index.entries;
    if (section === undefined) throw new Error("Checked store has no header entries");
    const text = fs.readFileSync(path.join(program, section.file), "utf8");
    if (digest(text) !== section.sha256) throw new Error("Checked store section changed: " + section.file);
    this.entries = JSON.parse(text);
    const rows = (values: Record<string, unknown>, text = (value: unknown) => JSON.stringify(value)) =>
      new Map(Object.entries(values).map(([name, value]) => [name, text(value)]));
    this.bangs = new Set(this.entries.bangs);
    this.names = { tld: rows(this.entries.tld, String), ctr: rows(this.entries.ctr, String),
      src: rows(this.entries.src, String), sites: rows(this.entries.sites), masks: rows(this.entries.masks),
      local: rows(this.entries.local, String), bang: new Map([...this.bangs].map(name => [name, "1"])),
      field: rows(this.entries.field, String) };
    // Only what applies to every unit: the compiler, the program's printed form
    // and whether it needs the device closure table.
    this.scope = digest(JSON.stringify([this.index.compiler, this.entries.show, this.entries.wide]));
    this.root = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "bend2", "cgen-units-v1");
  }

  private observe(event: string, details: Record<string, unknown>): void {
    const value = { compiler_diagnostic: "cache." + event, at: new Date().toISOString(),
      pid: process.pid, memory: process.memoryUsage(), ...details };
    try { fs.appendFileSync(path.join(this.evidence, "unit-cache.jsonl"), JSON.stringify(value) + "\n"); }
    catch (error) {
      if (!filesystem_error(error)) throw error;
      process.stderr.write(JSON.stringify({ compiler_diagnostic: "cache.observation.error",
        event: value, error: { code: error.code, syscall: error.syscall, message: error.message } }) + "\n");
    }
    if (process.env.BEND_COMPILER_DIAGNOSTICS === "1") process.stderr.write(JSON.stringify(value) + "\n");
  }

  private directory(job: Fact.Job): string {
    return path.join(this.root, this.scope, digest(JSON.stringify([job.key, job.facts_only])));
  }

  // The identity of one header entry in this program. A name the header lacks is
  // "-", so a read of a name that was absent is invalidated by its appearance.
  private entry(kind: HeaderKind, name: string): string {
    return this.names[kind].get(name) ?? "-";
  }

  // The identity of a whole collection, for a unit that listed its names.
  private listing(kind: HeaderKind): string {
    return digest(JSON.stringify([...this.names[kind]].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  }

  private applicable(value: Variant, job: Fact.Job): string | null {
    if (value.scope !== this.scope || value.data.unit !== job.key || value.data.facts_only !== job.facts_only) {
      throw new Error("Cached compiler unit identity differs: " + job.key);
    }
    for (const input of value.data.inputs) {
      const section = this.bodies.get(input.name);
      if (section === undefined || section.content !== input.content || section.mode !== input.mode) return "body:" + input.name;
    }
    for (const [kind, name, seen] of value.data.header) if (this.entry(kind, name) !== seen) return kind + ":" + name;
    for (const [kind, seen] of value.data.listed) if (this.listing(kind) !== seen) return "listed:" + kind;
    const trace = Fact.from_events(value.data.trace);
    for (const [name, answer] of trace.reads) {
      const colon = name.indexOf(":"), kind = name.slice(0, colon) as Fact.Kind;
      if (job.initial[kind].has(name.slice(colon + 1)) !== answer) return "fact:" + name;
    }
    Fact.replay_trace(value.data.trace, job.initial, job.key);
    return null;
  }

  private failure(operation: string, error: unknown, job?: Fact.Job): void {
    if (!filesystem_error(error)) throw error;
    this.observe("error", { operation, unit: job?.key,
      error: { code: error.code, syscall: error.syscall, message: error.message } });
  }

  private remove(directory: string): void {
    try { fs.rmSync(directory, { recursive: true, force: true }); }
    catch (error) { this.failure("cleanup", error); }
  }

  get(job: Fact.Job): Fact.Emission<Fragment> | undefined {
    const before = performance.now(), directory = this.directory(job);
    let chosen: string | null = null, selected: Variant | null = null;
    try {
      for (const candidate of directories(directory)) {
        if (chosen !== null && candidate >= chosen) continue;
        let bytes: string;
        try { bytes = fs.readFileSync(path.join(candidate, "metadata.json"), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (digest(bytes) !== path.basename(candidate)) throw new Error("Cached compiler unit record changed: " + candidate);
        const value: Variant = JSON.parse(bytes), invalid = this.applicable(value, job);
        if (invalid === null) { chosen = candidate; selected = value; }
        else this.observe("invalidate", { unit: job.key, facts_only: job.facts_only, variant: candidate, reason: invalid });
      }
    } catch (error) { this.failure("read", error, job); }
    if (chosen === null) {
      this.observe("miss", { unit: job.key, facts_only: job.facts_only, scope: this.scope, duration_ms: performance.now() - before });
      return undefined;
    }
    const value = selected!;
    for (const input of value.data.inputs) {
      if (this.verified.has(input.name)) continue;
      const section = this.bodies.get(input.name)!;
      if (file_digest(path.join(this.program, section.file)) !== section.sha256) {
        throw new Error("Checked store section changed: " + section.file);
      }
      this.verified.add(input.name);
    }
    let fragment: string | undefined;
    try {
      fragment = fs.mkdtempSync(path.join(this.program, "fragments", "cached-"));
      copy(path.join(chosen, "code"), path.join(fragment, "code"));
      if (file_digest(path.join(fragment, "code")) !== value.code_sha256) throw new Error("Cached compiler unit code changed: " + chosen);
      fs.writeFileSync(path.join(fragment, "metadata.json"), JSON.stringify(relocate(value.fragment, fragment)));
      const now = new Date();
      try { fs.utimesSync(chosen, now, now); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const result = emission({ ...value.data, fragment });
      fragment = undefined;
      this.observe("hit", { unit: job.key, facts_only: job.facts_only, variant: chosen,
        inputs: value.data.inputs, bytes: result.result.code.bytes, duration_ms: performance.now() - before });
      return result;
    } catch (error) { this.failure("restore", error, job); }
    finally { if (fragment !== undefined) this.remove(fragment); }
    this.observe("miss", { unit: job.key, facts_only: job.facts_only, scope: this.scope,
      reason: "storage", duration_ms: performance.now() - before });
    return undefined;
  }

  private prune(directory: string): void {
    try { fs.rmdirSync(directory); }
    catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        this.failure("cleanup", error);
      }
    }
  }

  private reclaim(need: bigint): void {
    for (;;) {
      const state = fs.statfsSync(this.root, { bigint: true });
      if (state.bavail * state.bsize >= need) return;
      let victim: { directory: string; modified: number } | null = null;
      for (const scope of directories(this.root)) for (const unit of directories(scope)) for (const entry of directories(unit, true)) {
        try {
          if (path.basename(entry).startsWith(".write-")) {
            const pid = Number(path.basename(entry).split("-")[1]);
            try { process.kill(pid, 0); continue; }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EPERM") continue;
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
          } else if (fs.statSync(path.join(entry, "code")).nlink !== 1) continue;
          const modified = fs.statSync(entry).mtimeMs;
          if (victim === null || modified < victim.modified) victim = { directory: entry, modified };
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      if (victim === null) return;
      fs.rmSync(victim.directory, { recursive: true, force: true });
      const unit = path.dirname(victim.directory), scope = path.dirname(unit);
      this.prune(unit); this.prune(scope);
      this.observe("evict", { ...victim, available_bytes: String(state.bavail * state.bsize), required_bytes: String(need) });
    }
  }

  put(job: Fact.Job, data: UnitData): void {
    const before = performance.now(), directory = this.directory(job);
    const code = path.join(data.fragment, "code");
    const metadata = JSON.parse(fs.readFileSync(path.join(data.fragment, "metadata.json"), "utf8"));
    const { unit, facts_only, trace, lend, masks, refs, edges, inputs, reads } = data;
    const header = reads.names.map(([kind, name]): [HeaderKind, string, string] => [kind, name, this.entry(kind, name)]);
    const listed = reads.listed.map((kind): [HeaderKind, string] => [kind, this.listing(kind)]);
    const value: Variant = { scope: this.scope, data: { unit, facts_only, trace, lend, masks, refs, edges, inputs, header, listed },
      fragment: relocate(metadata, ""), code_sha256: file_digest(code) };
    const bytes = JSON.stringify(value), name = digest(bytes), destination = path.join(directory, name);
    let temporary: string | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(destination)) {
        if (fs.readFileSync(path.join(destination, "metadata.json"), "utf8") !== bytes
          || file_digest(path.join(destination, "code")) !== value.code_sha256) {
          throw new Error("Different compiler unit cache content: " + destination);
        }
        return;
      }
      const state = fs.statfsSync(directory, { bigint: true });
      const code_state = fs.statSync(code);
      const data_bytes = code_state.dev === fs.statSync(directory).dev ? 0n
        : ((BigInt(code_state.size) + state.bsize - 1n) / state.bsize) * state.bsize;
      const metadata_blocks = (BigInt(Buffer.byteLength(bytes)) + state.bsize - 1n) / state.bsize;
      this.reclaim(data_bytes + (metadata_blocks + 1n) * state.bsize);
      fs.mkdirSync(directory, { recursive: true });
      temporary = fs.mkdtempSync(path.join(directory, ".write-" + process.pid + "-"));
      copy(code, path.join(temporary, "code"));
      fs.writeFileSync(path.join(temporary, "metadata.json"), bytes);
      try { fs.renameSync(temporary, destination); }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        if (fs.readFileSync(path.join(destination, "metadata.json"), "utf8") !== bytes
          || file_digest(path.join(destination, "code")) !== value.code_sha256) {
          throw new Error("Different compiler unit cache content: " + destination);
        }
      }
      this.observe("write", { unit: job.key, facts_only: job.facts_only, variant: destination,
        bytes: metadata.bytes, record_bytes: Buffer.byteLength(bytes), inputs: data.inputs,
        duration_ms: performance.now() - before });
    } catch (error) { this.failure("write", error, job); }
    finally {
      if (temporary !== undefined) this.remove(temporary);
      this.prune(directory); this.prune(path.dirname(directory));
    }
  }
}

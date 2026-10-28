import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as child from "node:child_process";
import * as Bend from "./bend.ts";
import * as Comp from "./comp.ts";

// Module messages preserve shared term and layout nodes. Flat records keep
// serialization independent of syntax depth and store each source string once.
type Node = null | boolean | number | string
  | { array: number[] } | { object: [string, number][] }
  | { set: number[] } | { map: [number, number][] };
export type Graph = { root: number; nodes: Node[] };

export function encode(value: unknown): Graph {
  return encode_fields(value, () => true);
}

function encode_fields(value: unknown, field: (key: string) => boolean): Graph {
  const ids = new Map<unknown, number>();
  const nodes: Node[] = [];
  const pending: unknown[] = [];
  const ref = (v: unknown): number => {
    const found = ids.get(v);
    if (found !== undefined) return found;
    const id = nodes.length;
    ids.set(v, id);
    nodes.push(null);
    pending.push(v);
    return id;
  };
  const root = ref(value);
  for (let i = 0; i < pending.length; i++) {
    const v = pending[i];
    if (v === null || typeof v === "boolean" || typeof v === "number"
      || typeof v === "string") nodes[i] = v;
    else if (Array.isArray(v)) nodes[i] = { array: v.map(ref) };
    else if (v instanceof Set) nodes[i] = { set: [...v].map(ref) };
    else if (v instanceof Map) nodes[i] = { map: [...v].map(([k, x]) => [ref(k), ref(x)]) };
    else if (typeof v === "object") nodes[i] = { object: Object.entries(v)
      .filter(([k, x]) => field(k) && x !== undefined).map(([k, x]) => [k, ref(x)]) };
    else throw new Error("A module message contains " + typeof v);
  }
  return { root, nodes };
}

export function decode<T>(graph: Graph): T {
  const values: unknown[] = graph.nodes.map((v) =>
    v === null || typeof v !== "object" ? v : "array" in v ? []
      : "set" in v ? new Set() : "map" in v ? new Map() : Object.create(null));
  graph.nodes.forEach((v, i) => {
    if (v === null || typeof v !== "object") return;
    if ("array" in v) for (const id of v.array) (values[i] as unknown[]).push(values[id]);
    else if ("set" in v) for (const id of v.set) (values[i] as Set<unknown>).add(values[id]);
    else if ("map" in v) for (const [k, x] of v.map)
      (values[i] as Map<unknown, unknown>).set(values[k], values[x]);
    else for (const [k, x] of v.object) (values[i] as Record<string, unknown>)[k] = values[x];
  });
  return values[graph.root] as T;
}

type Facts = { own: Set<string>; hot: Set<string>; stat: Set<string> };
type Values = { own: string[]; hot: string[]; stat: string[] };
type Range = { start: number; bytes: number };
type Segment = Comp.EmissionUnit["segs"][number];
type StoredUnit = {
  unit: string;
  segs: (Omit<Segment, "lines"> & { code: Range })[];
  spins: { fid: string; code: Range; declaration: Range;
    refs: Set<string>; cids: Map<string, number> }[];
  image: Range; image_words: number; tables: Range;
  clos: Set<string>; lend: Set<string>;
  facts: Values; reads: [string, boolean][]; borrows: [string, boolean[]][];
};
type Request = { snapshot: Comp.ModuleSnapshot; roots: string[]; facts: Values;
  previous?: Artifact };
type Result = {
  units: [string, StoredUnit][];
  requests: [string, Comp.ForeignRequest][];
  facts: Values;
  reads: [string, boolean][];
  compiled: number;
};
type Artifact = { result: Result; code: string; cached: boolean };
type Module = { file: string; namespace: string; declared: Set<string>;
  input: string; key: string };

function hash(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function file_hash(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

function save(file: string, text: string): void {
  const temporary = file + "." + process.pid + "." + crypto.randomUUID();
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

function fact_value(facts: Facts, key: string): boolean {
  const at = key.indexOf(":");
  return Set.prototype.has.call(facts[key.slice(0, at) as keyof Facts], key.slice(at + 1));
}

async function artifact(module: Module, roots: string[], facts: Facts,
  cache: string, previous?: Artifact): Promise<Artifact> {
  const directory = path.join(cache, "objects", module.key, hash(JSON.stringify(roots)));
  fs.mkdirSync(directory, { recursive: true });
  for (const name of fs.readdirSync(directory).filter((f) => f.endsWith(".json")).sort()) {
    const cached = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    const result = decode<Result>(cached.result);
    if (result.reads.every(([key, value]) => fact_value(facts, key) === value)) {
      Comp.diagnostic("module.cache.hit", { module: module.file, roots,
        source: module.key, code: cached.code });
      return { result, code: cached.code, cached: true };
    }
  }
  const run = fs.mkdtempSync(path.join(cache, "runs", "module-"));
  const input = decode<Comp.ModuleSnapshot>(JSON.parse(fs.readFileSync(module.input, "utf8")));
  const request: Request = { snapshot: input, roots,
    facts: { own: [...facts.own], hot: [...facts.hot], stat: [...facts.stat] }, previous };
  const request_path = path.join(run, "request.json");
  fs.writeFileSync(request_path, JSON.stringify(encode(request)));
  const output = path.join(run, "output");
  const argv = [process.execPath, "--smol", import.meta.path, request_path, output];
  const record: Record<string, unknown> = { argv, module: module.file,
    source: module.key, roots, started: new Date().toISOString() };
  const stdout = fs.openSync(path.join(run, "stdout"), "wx");
  const stderr = fs.openSync(path.join(run, "stderr"), "wx");
  let status: { code: number | null; signal: string | null };
  try {
    const process = child.spawn(argv[0], argv.slice(1), { stdio: ["ignore", stdout, stderr] });
    record.pid = process.pid;
    save(path.join(run, "execution.json"), JSON.stringify(record));
    Comp.diagnostic("module.begin", { module: module.file, pid: process.pid, run });
    status = await new Promise((resolve, reject) => {
      process.once("error", reject);
      process.once("close", (code, signal) => resolve({ code, signal }));
    });
    Object.assign(record, status, { ended: new Date().toISOString() });
    save(path.join(run, "execution.json"), JSON.stringify(record));
  } catch (error) {
    Object.assign(record, { error: String(error), ended: new Date().toISOString() });
    save(path.join(run, "execution.json"), JSON.stringify(record));
    throw error;
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  let pending = "";
  const report = (line: string): void => {
    try {
      const frame = JSON.parse(line);
      fs.writeSync(2, JSON.stringify({ ...frame, module: module.file, worker_pid: record.pid }) + "\n");
    } catch { fs.writeSync(2, line + "\n"); }
  };
  for await (const bytes of fs.createReadStream(path.join(run, "stderr"), { encoding: "utf8" })) {
    pending += bytes;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      report(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  }
  if (pending !== "") report(pending);
  if (status.code !== 0 || status.signal !== null)
    throw new Error(`Module ${module.file} failed (${JSON.stringify(status)}); ${run}`);
  const result = decode<Result>(JSON.parse(fs.readFileSync(output + ".json", "utf8")));
  const code = path.join(directory, await file_hash(output + ".c") + ".c");
  fs.renameSync(output + ".c", code);
  const conditions = [...result.reads].sort(([a], [b]) => a.localeCompare(b));
  save(path.join(directory, hash(JSON.stringify(conditions)) + ".json"),
    JSON.stringify({ code, result: encode(result) }));
  Comp.diagnostic("module.end", { module: module.file, pid: record.pid, run, code });
  return { result, code, cached: false };
}

async function parallel<T, U>(values: T[], run: (value: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(values.length);
  const failures: unknown[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(os.availableParallelism(), values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      try { results[index] = await run(values[index]); }
      catch (error) { failures.push(error); }
    }
  }));
  if (failures.length > 0) throw failures[0];
  return results;
}

function reachable(artifacts: Map<string, Artifact>, roots: string[]): Set<string> {
  const refs = new Map<string, Set<string>>();
  for (const { result } of artifacts.values()) for (const [, unit] of result.units) {
    for (const seg of unit.segs) refs.set(seg.fid, seg.refs);
    for (const spin of unit.spins) refs.set(spin.fid, spin.refs);
  }
  const live = new Set<string>(), queue = roots.slice();
  while (queue.length > 0) {
    const fid = queue.pop()!;
    if (live.has(fid)) continue;
    live.add(fid);
    for (const ref of refs.get(fid) ?? []) queue.push(ref);
  }
  return live;
}

async function* range(file: string, section: Range): AsyncGenerator<string> {
  if (section.bytes === 0) return;
  for await (const bytes of fs.createReadStream(file, {
    start: section.start, end: section.start + section.bytes - 1, encoding: "utf8",
  })) yield bytes;
}

async function link(output: string, runtime: Comp.ModuleRuntime,
  artifacts: Map<string, Artifact>, facts: Facts, needed: Set<string>): Promise<void> {
  const units = [...artifacts.values()].flatMap(({ result, code }) => result.units
    .filter(([fid]) => needed.has(fid)).map(([fid, unit]) => ({ fid, unit, code })));
  const data = Comp.emission_link_data(runtime, units.map(({ unit }) => unit), facts);
  async function* fill(mark: string): AsyncGenerator<string> {
    if (mark === "Tables") {
      yield data.tables + "\n";
      for (const { unit, code } of units) yield* range(code, unit.tables);
      yield data.descriptors + "\n";
    } else if (mark === "Spins") {
      yield "CONSTV u64 STAT_IMG[] = { ";
      let first = true;
      for (const { unit, code } of units) if (unit.image_words > 0) {
        if (!first) yield ", ";
        yield* range(code, unit.image);
        first = false;
      }
      if (first) yield "0";
      yield " };\n";
      for (const { unit, code } of units) for (const spin of unit.spins)
        if (data.live.has(spin.fid)) yield* range(code, spin.declaration);
      for (const { unit, code } of units) for (const spin of unit.spins)
        if (data.live.has(spin.fid)) yield* range(code, spin.code);
    } else if (mark === "Segments") {
      for (const { unit, code } of units) for (const seg of unit.segs) if (data.live.has(seg.fid)) {
        if (!data.device.has(seg.fid)) yield "#if !DEVICE\n";
        yield* range(code, seg.code);
        if (!data.device.has(seg.fid)) yield "#endif\n";
      }
    } else if (mark === "Requests") {
      const seen = new Set<string>();
      for (const { result } of artifacts.values()) for (const [fid, request] of result.requests)
        if (needed.has(fid)) yield Comp.request_text(request, seen);
    }
  }
  const file = fs.openSync(output, "w");
  try {
    for await (const text of Comp.emission_template(fill)) fs.writeFileSync(file, text);
  } finally { fs.closeSync(file); }
}

function prepare(book: Bend.Book, seen: Map<string, string | null>, cache: string,
  compiler: string): { modules: Map<string, Module>; owners: Map<string, string>;
    names: Map<string, string>; runtime: Comp.ModuleRuntime; facts: Facts } {
  const plan = Comp.emission_prepare(book);
  const runtime = Comp.emission_runtime(plan);
  const modules = new Map<string, Module>();
  for (const [file, namespace] of seen) if (namespace !== null)
    modules.set(file, { file, namespace, declared: new Set(), input: "", key: "" });
  const base = fs.realpathSync(Bend.BASE_BEND);
  const entry = [...modules.values()].find((m) => m.namespace === "" && m.file !== base)!.file;
  const imported = [...modules.values()].filter((m) => m.namespace !== "")
    .sort((a, b) => b.namespace.length - a.namespace.length);
  const ownership = new Map<string, string>();
  for (const [k, tld] of Object.entries(plan.cb.book.tlds)) {
    const file = tld.file ?? (tld.b ? base
      : imported.find((m) => k.startsWith(m.namespace + "."))?.file ?? entry);
    ownership.set(k, file);
    modules.get(file)!.declared.add(k);
  }
  const names = new Map([...plan.defs, ...plan.foreign].map(([fid, [k]]) => [fid, k]));
  const owners = new Map([...names].map(([fid, k]) => [fid, ownership.get(k)!]));
  const live_modules = new Set(owners.values());
  for (const [file, module] of modules) {
    if (!live_modules.has(file)) { modules.delete(file); continue; }
    const snapshot = Comp.emission_snapshot(plan, module.declared);
    const signature = JSON.stringify(encode_fields(snapshot, (key) => key !== "s"));
    const source = crypto.createHash("sha256").update(compiler)
      .update(fs.readFileSync(file)).update(signature);
    for (const row of snapshot.declarations) if (module.declared.has(row.k))
      for (const foreign of row.i ?? []) if (foreign.endsWith(".c")) source.update(fs.readFileSync(foreign));
    module.key = source.digest("hex");
    module.input = path.join(cache, "inputs", module.key + ".json");
    save(module.input, JSON.stringify(encode(snapshot)));
    Comp.diagnostic("module.input", { module: module.file, source: module.key,
      declarations: snapshot.declarations.length, definitions: snapshot.sources.length });
  }
  const facts = { own: new Set(plan.cb.own), hot: new Set(plan.cb.hot), stat: new Set(plan.cb.stat) };
  Comp.emission_release(plan);
  return { modules, names, owners, runtime, facts };
}

export async function compile_book(book: Bend.Book, seen: Map<string, string | null>,
  output: string, cache = path.join(os.homedir(), ".cache", "bend", "modules")): Promise<void> {
  for (const name of ["inputs", "runs", "objects"]) fs.mkdirSync(path.join(cache, name), { recursive: true });
  const identity = crypto.createHash("sha256");
  for (const file of ["bend.ts", "comp.ts", "modules.ts", "base.bend"])
    identity.update(fs.readFileSync(path.join(import.meta.dir, file)));
  identity.update(await file_hash(process.execPath));
  const compiler = identity.digest("hex");
  const { modules, names, owners, runtime, facts } = prepare(book, seen, cache, compiler);
  Comp.emission_discard_temps();
  Comp.diagnostic("modules.begin", { modules: modules.size, compiler });
  const artifacts = new Map<string, Artifact>();
  let needed = new Set(runtime.roots);
  let pass = 0;
  for (;;) {
    const requests = new Map<string, Map<string, string>>();
    for (const fid of needed) {
      const owner = owners.get(fid);
      if (owner === undefined) continue;
      if (!requests.has(owner)) requests.set(owner, new Map());
      requests.get(owner)!.set(fid, names.get(fid)!);
    }
    const jobs = [...requests].filter(([file, roots]) => {
      const old = artifacts.get(file);
      return old === undefined || [...roots.keys()].some((fid) =>
        !old.result.units.some(([entry]) => fid === entry))
        || old.result.reads.some(([k, v]) => fact_value(facts, k) !== v);
    });
    if (jobs.length === 0) break;
    const started = performance.now();
    Comp.diagnostic("pass.begin", { pass: ++pass, modules: artifacts.size,
      own: facts.own.size, hot: facts.hot.size, stat: facts.stat.size });
    const results = await parallel(jobs, async ([file, roots]) =>
      [file, await artifact(modules.get(file)!, [...roots.values()].sort(), facts, cache,
        artifacts.get(file))] as const);
    for (const [file, result] of results) artifacts.set(file, result);
    for (const { result } of artifacts.values()) for (const kind of ["own", "hot", "stat"] as const)
      for (const key of result.facts[kind]) facts[kind].add(key);
    needed = reachable(artifacts, runtime.roots);
    for (const file of artifacts.keys()) if (![...needed].some((fid) => owners.get(fid) === file))
      artifacts.delete(file);
    const missing = [...needed].some((fid) => owners.has(fid)
      && !artifacts.get(owners.get(fid)!)?.result.units.some(([entry]) => entry === fid));
    const lends = new Set<string>();
    for (const { result } of artifacts.values()) for (const [fid, unit] of result.units)
      if (needed.has(fid)) for (const key of unit.lend) lends.add(key);
    for (let before = -1; before !== lends.size;) {
      before = lends.size;
      for (const lend of lends) {
        const [a, r] = lend.split("<");
        if (r !== undefined && lends.has(r)) lends.add(a);
      }
    }
    if (!missing) for (const { result } of artifacts.values()) for (const [fid, unit] of result.units)
      if (needed.has(fid)) for (const [k, borrows] of unit.borrows) borrows.forEach((borrowed, i) => {
          if (borrowed && !lends.has(k + "~" + i)) facts.own.add(k + "~" + i);
        });
    let segments = 0, spins = 0;
    for (const { result } of artifacts.values()) for (const [fid, unit] of result.units) if (needed.has(fid)) {
      segments += unit.segs.filter((s) => needed.has(s.fid)).length;
      spins += unit.spins.filter((s) => needed.has(s.fid)).length;
    }
    Comp.diagnostic("pass.end", { pass, modules: artifacts.size,
      definitions: [...artifacts.values()].reduce((n, a) => n + a.result.units.length, 0),
      reemitted: results.reduce((n, [, a]) => n + (a.cached ? 0 : a.result.compiled), 0),
      cached: results.filter(([, artifact]) => artifact.cached).length,
      segments, spins, own: facts.own.size, hot: facts.hot.size, stat: facts.stat.size,
      duration_ms: performance.now() - started });
  }
  await link(output, runtime, artifacts, facts, needed);
  Comp.diagnostic("modules.end", { modules: artifacts.size, passes: pass, output });
}

function emit(request: Request, output: string): Result {
  const produced: Facts = { own: new Set(), hot: new Set(), stat: new Set() };
  const reads = new Map<string, boolean>();
  let tracking: { reads: Map<string, boolean>; facts: Facts } | null = null;
  class Observed extends Set<string> {
    constructor(readonly kind: keyof Facts, values: string[]) {
      super();
      for (const key of values) super.add(key);
    }
    has(key: string): boolean {
      const found = super.has(key);
      if (!produced[this.kind].has(key)) reads.set(this.kind + ":" + key, found);
      if (tracking !== null && !tracking.facts[this.kind].has(key))
        tracking.reads.set(this.kind + ":" + key, found);
      return found;
    }
    add(key: string): this {
      produced[this.kind].add(key);
      tracking?.facts[this.kind].add(key);
      return super.add(key);
    }
  }
  const facts: Facts = { own: new Observed("own", request.facts.own),
    hot: new Observed("hot", request.facts.hot), stat: new Observed("stat", request.facts.stat) };
  const cb = Comp.emission_restore(request.snapshot, facts);
  const definitions = new Map(request.snapshot.sources.map(([k]) => [Comp.seg_fid(k), k]));
  const units = new Map<string, StoredUnit>();
  const requests: [string, Comp.ForeignRequest][] = [];
  const queue = request.roots.map(Comp.seg_fid);
  const seen = new Set(queue);
  const file = fs.openSync(output, "wx");
  const previous = request.previous === undefined ? null : fs.openSync(request.previous.code, "r");
  const old_units = new Map(request.previous?.result.units ?? []);
  let compiled = 0;
  let offset = 0;
  const copy_buffer = Buffer.alloc(64 * 1024);
  const write = (text: string): Range => {
    const bytes = Buffer.from(text + "\n");
    const range = { start: offset, bytes: bytes.length };
    fs.writeFileSync(file, bytes);
    offset += bytes.length;
    return range;
  };
  const copy = (section: Range): Range => {
    const start = offset, buffer = copy_buffer;
    let taken = 0;
    while (taken < section.bytes) {
      const bytes = fs.readSync(previous!, buffer, 0,
        Math.min(buffer.length, section.bytes - taken), section.start + taken);
      if (bytes === 0) throw new Error("The cached module C range ended before its recorded length");
      fs.writeFileSync(file, buffer.subarray(0, bytes));
      taken += bytes;
      offset += bytes;
    }
    return { start, bytes: taken };
  };
  const copy_unit = (unit: StoredUnit): StoredUnit => {
    write(`CONSTV u64 ${unit.unit}IMAGE[] = {`);
    const image = copy(unit.image);
    write("};");
    const tables = copy(unit.tables);
    const declarations = unit.spins.map((spin) => copy(spin.declaration));
    const spins = unit.spins.map((spin, i) =>
      ({ ...spin, declaration: declarations[i], code: copy(spin.code) }));
    const segs = unit.segs.map((seg) => ({ ...seg, code: copy(seg.code) }));
    return { ...unit, image, tables, segs, spins };
  };
  try {
    for (let i = 0; i < queue.length; i++) {
      const fid = queue[i], k = definitions.get(fid);
      if (k === undefined) continue;
      const def = cb.book.tlds[k];
      if (def.$ !== "Def") continue;
      const cached = old_units.get(fid);
      if (cached !== undefined && cached.reads.every(([key, value]) => fact_value(facts, key) === value)) {
        for (const [key, value] of cached.reads) {
          const at = key.indexOf(":"), kind = key.slice(0, at) as keyof Facts;
          if (!produced[kind].has(key.slice(at + 1))) reads.set(key, value);
        }
        for (const kind of ["own", "hot", "stat"] as const)
          for (const key of cached.facts[kind]) facts[kind].add(key);
        const stored = copy_unit(cached);
        units.set(fid, stored);
        const foreign = request.previous?.result.requests.find(([entry]) => entry === fid);
        if (foreign !== undefined) requests.push(foreign);
        for (const entry of [...stored.segs, ...stored.spins]) for (const ref of entry.refs)
          if (definitions.has(ref) && !seen.has(ref)) { seen.add(ref); queue.push(ref); }
        Comp.diagnostic("definition.reuse", { name: k });
        continue;
      }
      const observed = { reads: new Map<string, boolean>(),
        facts: { own: new Set<string>(), hot: new Set<string>(), stat: new Set<string>() } };
      tracking = observed;
      let unit: Comp.EmissionUnit;
      if (def.i !== undefined) {
        const result = Comp.emission_foreign(cb, k, def);
        unit = result.unit;
        requests.push([fid, result.request]);
      } else {
        unit = Comp.emission_definition(cb, k, def);
      }
      tracking = null;
      compiled++;
      write(`CONSTV u64 ${unit.unit}IMAGE[] = {`);
      const image = write(unit.img.join(", ") || "0");
      write("};");
      const declarations = unit.spins.map(([, source]) => {
        const signature = source.slice(0, source.indexOf("\n"))
          .replace(/^(INLINE|FAR)\s+/, "").replace(/\s*\{\s*$/, "");
        return write(`static ${signature};`);
      });
      const stored: StoredUnit = {
        unit: unit.unit,
        image, image_words: unit.img.length,
        tables: write([...unit.tabs].map(([row, id]) =>
          `CONSTV u64 ${unit.unit}TAB_${id}[] = { ${row} };`).join("\n")),
        segs: unit.segs.map((seg) => {
          const { lines, ...metadata } = seg;
          return { ...metadata, code: write(Comp.compile_segs({ segs: [seg] })) };
        }),
        spins: unit.spins.map(([fid, source, refs, cids], i) => {
          return { fid, declaration: declarations[i],
            code: write(source), refs, cids };
        }),
        clos: unit.clos, lend: unit.lend,
        reads: [...observed.reads], borrows: Comp.emission_take_borrows(),
        facts: { own: [...observed.facts.own], hot: [...observed.facts.hot], stat: [...observed.facts.stat] },
      };
      units.set(fid, stored);
      const referenced = new Set<string>();
      for (const seg of unit.segs) for (const ref of seg.refs) referenced.add(ref);
      for (const spin of unit.spins) for (const ref of spin[2]) referenced.add(ref);
      for (const ref of referenced) if (definitions.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        queue.push(ref);
      }
      unit.segs = [];
      unit.spins = [];
      unit.img = [];
      unit.tabs.clear();
      Comp.emission_discard_temps();
    }
  } finally {
    fs.closeSync(file);
    if (previous !== null) fs.closeSync(previous);
  }
  return { units: [...units], requests, reads: [...reads], compiled,
    facts: { own: [...produced.own], hot: [...produced.hot], stat: [...produced.stat] } };
}

if (import.meta.main) {
  try {
    const [input, output] = process.argv.slice(2);
    const request = decode<Request>(JSON.parse(fs.readFileSync(input, "utf8")));
    const result = emit(request, output + ".c");
    fs.writeFileSync(output + ".json", JSON.stringify(encode(result)));
    Comp.diagnostic("module.worker.end", { pid: process.pid, usage: process.resourceUsage() });
  } catch (error) {
    Comp.diagnostic_error(error);
    fs.writeSync(2, error !== null && typeof error === "object" && "$" in error && error.$ === "Err"
      ? Bend.err_show(error as Bend.Err) : String(error));
    process.exitCode = 1;
  }
}

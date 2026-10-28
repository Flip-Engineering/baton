import * as Bend from "./bend.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

type Value = null | boolean | number | { string: number } | { node: number }
  | { span: number } | { undefined: true };
type Row = { owner: number } & (
  { object: [number, Value][]; null_prototype?: true } | { array: Value[] }
  | { function: { scope: number; array: boolean; body: Value } }
  | { bound: { scope: number; slot: number; span?: number } });
export type TermGraph = { root: Value; rows: Row[]; scopes: number[] };
export type Tables = { strings: string[]; spans: [number, number, number][] };

const BOUND = Symbol("checked-store-binding");
type Binding = { scope: number; slot: number };
type Marked = Bend.HTerm & { [BOUND]?: Binding };
type Parameters = { names: string[]; array: boolean };

// Source texts and span identities are shared by all body sections.
export class EncoderTables {
  readonly data: Tables = { strings: [], spans: [] };
  private strings = new Map<string, number>();
  private spans = new WeakMap<object, number>();

  string(text: string): number {
    const got = this.strings.get(text);
    if (got !== undefined) return got;
    const id = this.data.strings.length;
    this.strings.set(text, id);
    this.data.strings.push(text);
    return id;
  }

  span(value: Bend.Span): number {
    const got = this.spans.get(value);
    if (got !== undefined) return got;
    const id = this.data.spans.length;
    this.spans.set(value, id);
    this.data.spans.push([this.string(value.src), value.beg, value.end]);
    return id;
  }
}

export class DecoderTables {
  readonly spans: Bend.Span[];
  constructor(readonly data: Tables) {
    this.spans = data.spans.map(([src, beg, end]) => ({ src: data.strings[src], beg, end }));
  }
}

function is_span(value: object): value is Bend.Span {
  const v = value as Bend.Span;
  return typeof v.src === "string" && typeof v.beg === "number" && typeof v.end === "number";
}

// Visit the eagerly available graph. Function bodies belong to their own
// binding scope and are opened separately.
function eager_objects(value: unknown): Set<object> {
  const found = new Set<object>();
  const stack = [value];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || (typeof value !== "object" && typeof value !== "function")
      || found.has(value)) continue;
    found.add(value);
    if (typeof value === "function" || is_span(value)) continue;
    for (const child of Object.values(value)) stack.push(child);
  }
  return found;
}

// The raw checked body stays raw. Cell contents and callback bodies are copied
// as higher terms, so free checker Vars retain their names and indices.
export function encode_term(term: Bend.LTerm | Bend.HTerm, tables: EncoderTables): TermGraph {
  const rows: Row[] = [];
  const scopes = [-1];
  const ids = new WeakMap<object, number>();
  const anchors = new WeakMap<object, number>();
  const stable = new WeakSet<object>();
  const pending: { value: object | Function; id: number; params?: Parameters }[] = [];
  let marker = 0;
  const ancestor = (a: number, b: number): number => {
    const seen = new Set<number>();
    for (let s = a; s >= 0; s = scopes[s]) seen.add(s);
    for (let s = b; s >= 0; s = scopes[s]) if (seen.has(s)) return s;
    throw new Error("Checked term scopes have no common root");
  };
  const anchor = (value: object, scope: number): void => {
    const old = anchors.get(value);
    anchors.set(value, old === undefined ? scope : ancestor(old, scope));
    const id = ids.get(value);
    if (id !== undefined) rows[id].owner = ancestor(rows[id].owner, scope);
  };
  const ref = (value: unknown, scope: number, params?: Parameters): Value => {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return { string: tables.string(value) };
    if (value === undefined) return { undefined: true };
    if (typeof value !== "object" && typeof value !== "function") {
      throw new Error("Checked term contains " + typeof value);
    }
    if (typeof value === "object" && is_span(value)) return { span: tables.span(value) };
    const got = ids.get(value);
    if (got !== undefined) {
      anchor(value, scope);
      return { node: got };
    }
    const id = rows.length;
    ids.set(value, id);
    rows.push({ owner: anchors.get(value) ?? scope, object: [] });
    pending.push({ value, id, params });
    return { node: id };
  };
  const root = ref(term, 0);
  for (let at = 0; at < pending.length; at++) {
    const { value, id, params } = pending[at];
    const scope = rows[id].owner;
    const binding = (value as Marked)[BOUND];
    if (binding !== undefined) {
      const span = (value as Bend.HTerm).s;
      rows[id] = { owner: scope, bound: { ...binding,
        ...(span === undefined ? {} : { span: tables.span(span) }) } };
    } else if (typeof value === "function") {
      if (params === undefined) throw new Error("Checked term callback has no binder");
      const child = scopes.length;
      scopes.push(scope);
      const args = (): Marked[] => params.names.map((k, slot) =>
        Object.assign(Bend.Var(k, marker++), { [BOUND]: { scope: child, slot } }));
      const a = args(), b = args();
      const first = value(params.array ? a : a[0]);
      const second = value(params.array ? b : b[0]);
      const objects = eager_objects(first);
      for (const object of eager_objects(second)) {
        if (objects.has(object)) { stable.add(object); anchor(object, scope); }
      }
      rows[id] = { owner: scope, function: { scope: child, array: params.array,
        body: ref(first, child) } };
    } else if (Array.isArray(value)) {
      rows[id] = { owner: scope, array: value.map(v => ref(v, scope)) };
    } else {
      const term = value as Record<string, unknown>;
      const fields: [number, Value][] = [];
      for (const [key, child] of Object.entries(term)) {
        const params = typeof child !== "function" ? undefined
          : term.$ === "Let" && key === "f" ? { names: term.k as string[], array: true }
          : (term.$ === "Lam" && key === "f") || (term.$ === "All" && key === "B")
            ? { names: [term.k as string], array: false } : undefined;
        fields.push([tables.string(key), ref(child, scope, params)]);
      }
      rows[id] = { owner: scope, object: fields,
        ...(Object.getPrototypeOf(value) === null ? { null_prototype: true as const } : {}) };
    }
  }
  // Stable immutable values remain shared across callback instances. Cells
  // and values that depend on a binder keep their binding scope.
  const dynamic = new Set<number>();
  const parents = rows.map(() => [] as number[]);
  for (let id = 0; id < rows.length; id++) {
    const row = rows[id], value = pending[id].value as Marked;
    if ("function" in row || "bound" in row
      || (value.$ === "Var" && value.v !== undefined)) dynamic.add(id);
    const children = "object" in row ? row.object.map(([, v]) => v)
      : "array" in row ? row.array : "function" in row ? [row.function.body] : [];
    for (const child of children) if (child !== null && typeof child === "object" && "node" in child) {
      parents[child.node].push(id);
    }
  }
  const affected = [...dynamic];
  for (let at = 0; at < affected.length; at++) for (const id of parents[affected[at]]) {
    if (!dynamic.has(id)) { dynamic.add(id); affected.push(id); }
  }
  for (let id = 0; id < rows.length; id++) {
    if (stable.has(pending[id].value) && !dynamic.has(id)) rows[id].owner = 0;
  }
  // A shared parent also shares its eagerly available children. Callback
  // bodies keep the separate scope that supplies their bound arguments.
  const queue = rows.map((_, i) => i);
  for (let at = 0; at < queue.length; at++) {
    const row = rows[queue[at]];
    if ("function" in row) scopes[row.function.scope] = row.owner;
    const owner = "function" in row ? row.function.scope : row.owner;
    const children = "object" in row ? row.object.map(([, v]) => v)
      : "array" in row ? row.array : "function" in row ? [row.function.body] : [];
    for (const child of children) if (child !== null && typeof child === "object" && "node" in child) {
      const target = rows[child.node];
      const shared = ancestor(target.owner, owner);
      if (shared !== target.owner) { target.owner = shared; queue.push(child.node); }
    }
  }
  return { root, rows, scopes };
}

type Context = { scope: number; parent: Context | null; args: Bend.HTerm[];
  values: Map<number, unknown> };

export function decode_term<T extends Bend.LTerm | Bend.HTerm>(graph: TermGraph,
  tables: DecoderTables): T {
  const root: Context = { scope: 0, parent: null, args: [], values: new Map() };
  const context = (ctx: Context, scope: number): Context => {
    for (let e: Context | null = ctx; e !== null; e = e.parent) if (e.scope === scope) return e;
    throw new Error("Checked term binding scope is unavailable: " + scope);
  };
  const read = (value: Value, ctx: Context,
    pending: [Row, Context, Record<string, unknown> | unknown[]][]): unknown => {
    if (value === null || typeof value !== "object") return value;
    if ("undefined" in value) return undefined;
    if ("string" in value) return tables.data.strings[value.string];
    if ("span" in value) return tables.spans[value.span];
    const row = graph.rows[value.node];
    if ("bound" in row) {
      const binding = row.bound;
      const argument = context(ctx, binding.scope).args[binding.slot];
      const span = binding.span === undefined ? undefined : tables.spans[binding.span];
      return argument.s !== undefined || span === undefined || (argument.$ === "Var" && argument.i < 0)
        ? argument : { ...argument, s: span };
    }
    const owner = context(ctx, row.owner);
    if (owner.values.has(value.node)) return owner.values.get(value.node);
    if ("function" in row) {
      const fn = row.function;
      const result = (argument: Bend.HTerm | Bend.HTerm[]) => fill(fn.body,
        { scope: fn.scope, parent: owner, args: fn.array ? argument as Bend.HTerm[]
          : [argument as Bend.HTerm], values: new Map() });
      owner.values.set(value.node, result);
      return result;
    }
    const result = "array" in row ? []
      : Object.create("null_prototype" in row ? null : Object.prototype);
    owner.values.set(value.node, result);
    pending.push([row, owner, result]);
    return result;
  };
  const fill = (value: Value, ctx: Context): unknown => {
    const pending: [Row, Context, Record<string, unknown> | unknown[]][] = [];
    const result = read(value, ctx, pending);
    for (let at = 0; at < pending.length; at++) {
      const [row, owner, value] = pending[at];
      if ("array" in row) {
        for (const child of row.array) (value as unknown[]).push(read(child, owner, pending));
      } else if ("object" in row) {
        for (const [key, child] of row.object) {
          Object.defineProperty(value, tables.data.strings[key], {
            value: read(child, owner, pending), enumerable: true, writable: true, configurable: true });
        }
      }
    }
    return result;
  };
  return fill(graph.root, root) as T;
}

type Section = { file: string; sha256: string; bytes: number; nodes: number };
type BodySection = Section & { mode: "checked" | "higher" };
export type SourceInput = { path: string; namespace: string | null; sha256: string };
export type StoreIndex = { compiler: string; tables: Section; header: Section;
  bodies: [string, BodySection][]; inputs: SourceInput[];
  input_manifest_sha256: string; program_sha256: string };

function digest(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function compiler_identity(files: URL[]): string {
  const hash = crypto.createHash("sha256");
  for (const file of [...files, process.execPath]) hash.update(file_digest(file));
  return hash.digest("hex");
}

export function file_digest(file: string | URL): string {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    for (let n = fs.readSync(fd, buffer); n > 0; n = fs.readSync(fd, buffer)) {
      hash.update(buffer.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

// The writer keeps paths and hashes after each section has been written.
export class CheckedWriter {
  readonly directory: string;
  private tables = new EncoderTables();
  private bodies = new Map<string, BodySection>();
  private pending = new Map<string, { value: Bend.LTerm | Bend.HTerm; mode: BodySection["mode"] }>();
  constructor(readonly compiler: string, workspace = os.tmpdir(),
    readonly inputs: SourceInput[] = []) {
    this.directory = fs.mkdtempSync(path.join(workspace, "bend-checked-"));
  }

  private write(text: string, nodes: number): Section {
    const sha256 = digest(text), file = sha256 + ".json";
    fs.writeFileSync(path.join(this.directory, file), text);
    const bytes = Buffer.byteLength(text);
    return { file, sha256, bytes, nodes };
  }

  private graph(value: unknown): Section {
    const graph = encode_term(value as Bend.LTerm, this.tables);
    return this.write(JSON.stringify(graph), graph.rows.length);
  }

  has(name: string): boolean { return this.bodies.has(name) || this.pending.has(name); }

  capture(name: string, def: Bend.Def & { h?: Bend.HTerm }): void {
    if (this.has(name)) return;
    if (def.e !== undefined) {
      this.pending.set(name, { value: def.e, mode: "checked" });
    } else if (def.h !== undefined) {
      this.pending.set(name, { value: def.h, mode: "higher" });
    }
  }

  seal(header: unknown): { index: StoreIndex; reader: CheckedReader; bytes: number } {
    // Front-end walks normalize checker cells. Encode their completed state
    // before releasing the front-end graph.
    for (const [name, { value, mode }] of this.pending) {
      this.bodies.set(name, { ...this.graph(value), mode });
    }
    this.pending.clear();
    const section = this.graph(header);
    const tables = this.write(JSON.stringify(this.tables.data), this.tables.data.spans.length);
    const bodies = [...this.bodies];
    const input_manifest_sha256 = digest(JSON.stringify(this.inputs));
    const program_sha256 = digest(JSON.stringify({ compiler: this.compiler,
      header: section.sha256, tables: tables.sha256,
      bodies: bodies.map(([name, body]) => [name, body.sha256, body.mode]), input_manifest_sha256 }));
    const index: StoreIndex = { compiler: this.compiler, header: section, tables,
      bodies, inputs: this.inputs, input_manifest_sha256, program_sha256 };
    fs.writeFileSync(path.join(this.directory, "index.json"), JSON.stringify(index));
    const bytes = fs.readdirSync(this.directory).reduce((n, file) =>
      n + fs.statSync(path.join(this.directory, file)).size, 0);
    return { index, reader: new CheckedReader(this.directory, this.compiler), bytes };
  }

  remove(): void { fs.rmSync(this.directory, { recursive: true }); }
}

// Header values remain available for the process. The unit owns its decoded
// bodies and releases them together with the emitter's term caches.
export class CheckedReader {
  readonly index: StoreIndex;
  private tables: DecoderTables;
  private bodies: Map<string, BodySection>;
  private decoded = new Map<string, Bend.HTerm>();
  decode_ms = 0;

  constructor(readonly directory: string, compiler: string) {
    this.index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
    if (this.index.compiler !== compiler) throw new Error("Checked store compiler identity differs");
    this.tables = new DecoderTables(this.read<Tables>(this.index.tables));
    this.bodies = new Map(this.index.bodies);
  }

  private read<T>(section: Section): T {
    const text = fs.readFileSync(path.join(this.directory, section.file), "utf8");
    if (digest(text) !== section.sha256) throw new Error("Checked store section changed: " + section.file);
    return JSON.parse(text) as T;
  }

  header<T>(): T {
    return decode_term(this.read<TermGraph>(this.index.header), this.tables) as T;
  }

  body(name: string): Bend.HTerm | undefined {
    const found = this.decoded.get(name);
    if (found !== undefined) return found;
    const section = this.bodies.get(name);
    if (section === undefined) return undefined;
    const begin = performance.now();
    const graph = this.read<TermGraph>(section);
    const value = decode_term(graph, this.tables);
    const h = section.mode === "checked" ? Bend.term_higher(value as Bend.LTerm) : value as Bend.HTerm;
    this.decoded.set(name, h);
    this.decode_ms += performance.now() - begin;
    return h;
  }

  release(): void { this.decoded.clear(); this.decode_ms = 0; }
}

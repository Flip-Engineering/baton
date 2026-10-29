import * as Bend from "./bend.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

type Value = null | boolean | number | { string: number } | { node: number }
  | { span: number } | { undefined: true };
// Rows begin with owner and kind. Object fields use key/tag/value triples;
// arrays use tag/value pairs. Callback and binding rows have fixed fields.
type Row = number[];
const OBJECT = 0, DICTIONARY = 1, ARRAY = 2, CALLBACK = 3, BINDING = 4;
const NIL = 0, BOOL = 1, NUMBER = 2, STRING = 3, NODE = 4, SPAN = 5, UNDEFINED = 6;

function append_value(row: Row, value: Value): void {
  if (value === null) row.push(NIL, 0);
  else if (typeof value === "boolean") row.push(BOOL, Number(value));
  else if (typeof value === "number") row.push(NUMBER, value);
  else if ("string" in value) row.push(STRING, value.string);
  else if ("node" in value) row.push(NODE, value.node);
  else if ("span" in value) row.push(SPAN, value.span);
  else row.push(UNDEFINED, 0);
}

function* row_children(row: Row): Generator<number> {
  if (row[1] === CALLBACK) {
    if (row[4] === NODE) yield row[5];
  } else if (row[1] === OBJECT || row[1] === DICTIONARY) {
    for (let at = 3; at < row.length; at += 3) if (row[at] === NODE) yield row[at + 1];
  } else if (row[1] === ARRAY) {
    for (let at = 2; at < row.length; at += 2) if (row[at] === NODE) yield row[at + 1];
  }
}
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

  find(text: string): number | undefined { return this.strings.get(text); }

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
function eager_objects(value: unknown, stable: WeakSet<object>): Set<object> {
  const found = new Set<object>();
  const stack = [value];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || (typeof value !== "object" && typeof value !== "function")
      || found.has(value)) continue;
    found.add(value);
    if (typeof value === "function" || is_span(value) || stable.has(value)) continue;
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
  const pending: (object | Function)[] = [];
  const parameters = new Map<number, Parameters>();
  let marker = 0;
  const ancestor = (a: number, b: number): number => {
    if (a === b) return a;
    if (a === 0 || b === 0) return 0;
    const seen = new Set<number>();
    for (let s = a; s >= 0; s = scopes[s]) seen.add(s);
    for (let s = b; s >= 0; s = scopes[s]) if (seen.has(s)) return s;
    throw new Error("Checked term scopes have no common root");
  };
  const anchor = (value: object, scope: number): void => {
    const id = ids.get(value);
    if (id !== undefined) {
      rows[id][0] = ancestor(rows[id][0], scope);
    } else {
      const old = anchors.get(value);
      anchors.set(value, old === undefined ? scope : ancestor(old, scope));
    }
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
    rows.push([anchors.get(value) ?? scope, OBJECT]);
    pending.push(value);
    if (params !== undefined) parameters.set(id, params);
    return { node: id };
  };
  const root = ref(term, 0);
  for (let at = 0; at < pending.length; at++) {
    const value = pending[at], id = at, params = parameters.get(id);
    const scope = rows[id][0];
    const binding = (value as Marked)[BOUND];
    if (binding !== undefined) {
      const span = (value as Bend.HTerm).s;
      rows[id] = [scope, BINDING, binding.scope, binding.slot,
        span === undefined ? -1 : tables.span(span)];
    } else if (typeof value === "function") {
      if (params === undefined) throw new Error("Checked term callback has no binder");
      const child = scopes.length;
      scopes.push(scope);
      const args = (): Marked[] => params.names.map((k, slot) =>
        Object.assign(Bend.Var(k, marker++), { [BOUND]: { scope: child, slot } }));
      const a = args(), b = args();
      const first = value(params.array ? a : a[0]);
      const second = value(params.array ? b : b[0]);
      const objects = eager_objects(first, stable);
      for (const object of eager_objects(second, stable)) {
        if (objects.has(object)) { stable.add(object); anchor(object, scope); }
      }
      rows[id] = [scope, CALLBACK, child, Number(params.array)];
      append_value(rows[id], ref(first, child));
    } else if (Array.isArray(value)) {
      rows[id] = [scope, ARRAY];
      for (const child of value) append_value(rows[id], ref(child, scope));
    } else {
      const term = value as Record<string, unknown>;
      const fields: Row = [scope, Object.getPrototypeOf(value) === null ? DICTIONARY : OBJECT];
      for (const [key, child] of Object.entries(term)) {
        const params = typeof child !== "function" ? undefined
          : term.$ === "Let" && key === "f" ? { names: term.k as string[], array: true }
          : (term.$ === "Lam" && key === "f") || (term.$ === "All" && key === "B")
            ? { names: [term.k as string], array: false } : undefined;
        fields.push(tables.string(key));
        append_value(fields, ref(child, scope, params));
      }
      rows[id] = fields;
    }
  }
  // Stable immutable values remain shared across callback instances. Cells
  // and values that depend on a binder keep their binding scope.
  const dynamic = new Uint8Array(rows.length);
  const affected: number[] = [];
  const offsets = new Uint32Array(rows.length + 1);
  for (let id = 0; id < rows.length; id++) {
    const row = rows[id], value = pending[id] as Marked;
    if (row[1] === CALLBACK || row[1] === BINDING
      || (value.$ === "Var" && value.v !== undefined)) {
      dynamic[id] = 1;
      affected.push(id);
    }
    for (const child of row_children(row)) offsets[child + 1]++;
  }
  for (let i = 1; i < offsets.length; i++) offsets[i] += offsets[i - 1];
  const parents = new Uint32Array(offsets[rows.length]);
  const next = offsets.slice(0, rows.length);
  for (let id = 0; id < rows.length; id++) {
    for (const child of row_children(rows[id])) parents[next[child]++] = id;
  }
  for (let at = 0; at < affected.length; at++) {
    const child = affected[at];
    for (let i = offsets[child]; i < offsets[child + 1]; i++) {
      const id = parents[i];
      if (!dynamic[id]) { dynamic[id] = 1; affected.push(id); }
    }
  }
  for (let id = 0; id < rows.length; id++) {
    if (stable.has(pending[id]) && !dynamic[id]) rows[id][0] = 0;
  }
  // A shared parent also shares its eagerly available children. Callback
  // bodies keep the separate scope that supplies their bound arguments.
  const queue = rows.map((_, i) => i);
  for (let at = 0; at < queue.length; at++) {
    const row = rows[queue[at]];
    if (row[1] === CALLBACK) scopes[row[2]] = row[0];
    const owner = row[1] === CALLBACK ? row[2] : row[0];
    for (const child of row_children(row)) {
      const target = rows[child];
      const shared = ancestor(target[0], owner);
      if (shared !== target[0]) { target[0] = shared; queue.push(child); }
    }
  }
  return { root, rows, scopes };
}

// A canonical digest of a graph that does not depend on table numbering or on
// source positions. Strings are written as text. Spans are written as classes
// numbered by first use: two nodes have the same class exactly when their spans are
// equal. The emitter compares spans for equality only, so a definition moved by an
// edit elsewhere in its file keeps its digest. The source texts are not digested.
function graph_digest(graph: TermGraph, tables: Tables): string {
  const classes = new Map<string, number>();
  const span = (index: number): number => {
    const key = tables.spans[index].join(",");
    let id = classes.get(key);
    if (id === undefined) { id = classes.size; classes.set(key, id); }
    return id;
  };
  const text = (tag: number, value: number): string | number =>
    tag === STRING ? JSON.stringify(tables.strings[value]) : tag === SPAN ? "@" + span(value) : value;
  const hash = crypto.createHash("sha256");
  const root = graph.root;
  hash.update(root === null ? "null" : typeof root !== "object" ? String(root)
    : "string" in root ? JSON.stringify(tables.strings[root.string]) : "span" in root ? "@" + span(root.span)
    : "node" in root ? "#" + root.node : "undefined");
  hash.update("|" + graph.scopes.join(",") + "\n");
  // Rows are hashed in short pieces so that no large string is built.
  const write = (parts: (string | number)[]): void => {
    for (let at = 0; at < parts.length; at += 256) hash.update(parts.slice(at, at + 256).join(" ") + " ");
    hash.update("\n");
  };
  for (const row of graph.rows) {
    const parts: (string | number)[] = [row[0], row[1]];
    if (row[1] === BINDING) parts.push(row[2], row[3], row[4] < 0 ? -1 : "@" + span(row[4]));
    else if (row[1] === CALLBACK) parts.push(row[2], row[3], row[4], text(row[4], row[5]));
    else if (row[1] === ARRAY) for (let at = 2; at < row.length; at += 2) parts.push(row[at], text(row[at], row[at + 1]));
    else for (let at = 2; at < row.length; at += 3) {
      parts.push(JSON.stringify(tables.strings[row[at]]), row[at + 1], text(row[at + 1], row[at + 2]));
    }
    write(parts);
  }
  return hash.digest("hex");
}

// The content identity of one value, encoded with tables of its own.
export function content_digest(value: unknown): string {
  const tables = new EncoderTables();
  return graph_digest(encode_term(value as Bend.LTerm, tables), tables.data);
}

// Rows with the same owner scope, fields and children are one row. Copies of a
// default arm that the match compiler places under several branches are equal in
// every field, spans included, and share a row after this pass. A checker cell (a
// Var that carries a value) keeps its own row unless it is filled (i is -2): emission
// updates a cell in place only while i is -1 (term_wnf), so two unevaluated cells are
// two thunks and two filled cells with equal contents are one value. A graph
// with a cycle is returned as it is. The pass is applied to bodies only: a header
// row can carry per-definition state on its decoded object.
export function share_rows(graph: TermGraph, tables: EncoderTables): TermGraph {
  const rows = graph.rows, n = rows.length;
  const dollar = tables.find("$"), variable = tables.find("Var"), cell_value = tables.find("v"), cell_state = tables.find("i");
  const child_slots = (row: Row): number[] => {
    const slots: number[] = [];
    if (row[1] === CALLBACK) { if (row[4] === NODE) slots.push(5); }
    else if (row[1] === OBJECT || row[1] === DICTIONARY) {
      for (let at = 3; at < row.length; at += 3) if (row[at] === NODE) slots.push(at + 1);
    } else if (row[1] === ARRAY) {
      for (let at = 2; at < row.length; at += 2) if (row[at] === NODE) slots.push(at + 1);
    }
    return slots;
  };
  const is_cell = (row: Row): boolean => {
    if (row[1] !== OBJECT || dollar === undefined || variable === undefined || cell_value === undefined) return false;
    let named = false, valued = false, filled = false;
    for (let at = 2; at < row.length; at += 3) {
      if (row[at] === dollar && row[at + 1] === STRING && row[at + 2] === variable) named = true;
      if (row[at] === cell_value) valued = true;
      if (row[at] === cell_state && row[at + 1] === NUMBER && row[at + 2] === -2) filled = true;
    }
    return named && valued && !filled;
  };
  const state = new Uint8Array(n), canonical = new Int32Array(n).fill(-1);
  const out: Row[] = [], buckets = new Map<number, number[]>();
  const root = graph.root;
  if (root === null || typeof root !== "object" || !("node" in root)) return graph;
  const stack = [root.node];
  while (stack.length > 0) {
    const id = stack[stack.length - 1], row = rows[id];
    if (state[id] === 2) { stack.pop(); continue; }
    const slots = child_slots(row);
    if (state[id] === 0) {
      state[id] = 1;
      let pushed = false;
      for (const slot of slots) {
        const child = row[slot];
        if (state[child] === 1) return graph;
        if (state[child] === 0) { stack.push(child); pushed = true; }
      }
      if (pushed) continue;
    }
    const mapped = slots.length === 0 ? row : row.slice();
    for (const slot of slots) mapped[slot] = canonical[row[slot]];
    let found = -1;
    if (!is_cell(mapped)) {
      let hash = 0x811c9dc5 | 0;
      for (let at = 0; at < mapped.length; at++) hash = Math.imul(hash ^ mapped[at], 0x01000193) ^ (hash >>> 15);
      const bucket = buckets.get(hash);
      if (bucket !== undefined) {
        for (const candidate of bucket) {
          const other = out[candidate];
          if (other.length !== mapped.length) continue;
          let same = true;
          for (let at = 0; at < mapped.length; at++) if (other[at] !== mapped[at]) { same = false; break; }
          if (same) { found = candidate; break; }
        }
      }
      if (found < 0) {
        if (bucket === undefined) buckets.set(hash, [out.length]); else bucket.push(out.length);
      }
    }
    if (found < 0) { found = out.length; out.push(mapped); }
    canonical[id] = found; state[id] = 2; stack.pop();
  }
  return { root: { node: canonical[root.node] }, rows: out, scopes: graph.scopes };
}

type Context = { scope: number; parent: Context | null; args: Bend.HTerm[];
  values: Map<number, unknown> };

export function decode_term<T extends Bend.LTerm | Bend.HTerm>(graph: TermGraph,
  tables: DecoderTables): T {
  const rows: (Row | null)[] = graph.rows.slice();
  const owners = Uint32Array.from(graph.rows, row => row[0]);
  const captured = new Uint8Array(rows.length);
  const captured_roots: number[] = [];
  const capture = (id: number): void => {
    if (owners[id] === 0 && !captured[id]) {
      captured[id] = 1;
      captured_roots.push(id);
    }
  };
  for (const row of graph.rows) {
    if (row[0] !== 0 || row[1] === CALLBACK) {
      for (const child of row_children(row)) capture(child);
    }
  }
  for (let at = 0; at < captured_roots.length; at++) {
    for (const child of row_children(graph.rows[captured_roots[at]])) capture(child);
  }
  const root_value: Row = [];
  append_value(root_value, graph.root);
  const root: Context = { scope: 0, parent: null, args: [], values: new Map() };
  const context = (ctx: Context, scope: number): Context => {
    for (let e: Context | null = ctx; e !== null; e = e.parent) if (e.scope === scope) return e;
    throw new Error("Checked term binding scope is unavailable: " + scope);
  };
  type Pending = [number, Row, Context, Record<string, unknown> | unknown[]][];
  const read = (tag: number, value: number, ctx: Context, pending: Pending,
    created: number[]): unknown => {
    switch (tag) {
      case NIL: return null;
      case BOOL: return Boolean(value);
      case NUMBER: return value;
      case STRING: return tables.data.strings[value];
      case SPAN: return tables.spans[value];
      case UNDEFINED: return undefined;
    }
    const owner = context(ctx, owners[value]);
    if (owner.values.has(value)) return owner.values.get(value);
    const row = rows[value]!;
    if (row[1] === BINDING) {
      const argument = context(ctx, row[2]).args[row[3]];
      const span = row[4] < 0 ? undefined : tables.spans[row[4]];
      return argument.s !== undefined || span === undefined || (argument.$ === "Var" && argument.i < 0)
        ? argument : { ...argument, s: span };
    }
    if (row[1] === CALLBACK) {
      const scope = row[2], array = row[3], tag = row[4], body = row[5];
      const result = (argument: Bend.HTerm | Bend.HTerm[]) => fill(tag, body,
        { scope, parent: owner, args: array ? argument as Bend.HTerm[]
          : [argument as Bend.HTerm], values: new Map() });
      owner.values.set(value, result);
      if (owner === root) { rows[value] = null; created.push(value); }
      return result;
    }
    const result = row[1] === ARRAY ? []
      : Object.create(row[1] === DICTIONARY ? null : Object.prototype);
    owner.values.set(value, result);
    if (owner === root) created.push(value);
    pending.push([value, row, owner, result]);
    return result;
  };
  const fill = (tag: number, value: number, ctx: Context): unknown => {
    const pending: Pending = [];
    const created: number[] = [];
    const result = read(tag, value, ctx, pending, created);
    for (let at = 0; at < pending.length; at++) {
      const [id, row, owner, value] = pending[at];
      if (row[1] === ARRAY) {
        for (let i = 2; i < row.length; i += 2) {
          (value as unknown[]).push(read(row[i], row[i + 1], owner, pending, created));
        }
      } else {
        for (let i = 2; i < row.length; i += 3) {
          Object.defineProperty(value, tables.data.strings[row[i]], {
            value: read(row[i + 1], row[i + 2], owner, pending, created),
            enumerable: true, writable: true, configurable: true });
        }
      }
      // Root-owned values are decoded once. Callback instances retain only
      // the templates whose values depend on their binding scope.
      if (owner === root) rows[id] = null;
    }
    // Callbacks retain captured roots. Ordinary decoded fields retain their
    // children directly and need no whole-body identity map after filling.
    for (const id of created) if (!captured[id]) root.values.delete(id);
    return result;
  };
  return fill(root_value[0], root_value[1], root) as T;
}

type Section = { file: string; sha256: string; bytes: number; nodes: number };
type BodySection = Section & { mode: "checked" | "higher"; content: string };
export type BodyInput = { name: string; content: string; mode: BodySection["mode"] };
type Observe = (event: string, details: Record<string, unknown>) => void;
export type SourceInput = { path: string; namespace: string | null; sha256: string };
// Content identities of the header entries a unit may read. A tld, constructor or
// field is a digest of its value. Small per-name values are kept as written. A
// name that is absent has no row.
export type Entries = {
  tld: Record<string, string>; ctr: Record<string, string>; src: Record<string, string>;
  sites: Record<string, number>; masks: Record<string, boolean[]>; local: Record<string, string>;
  bangs: string[]; field: Record<string, string>; show: string; wide: boolean;
};
export type StoreIndex = { compiler: string; tables: Section; header: Section;
  bodies: [string, BodySection][]; inputs: SourceInput[];
  input_manifest_sha256: string; program_sha256: string; entries?: Section };

function digest(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
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
    readonly inputs: SourceInput[] = [], private observe?: Observe) {
    this.directory = fs.mkdtempSync(path.join(workspace, "bend-checked-"));
  }

  private write(data: string, nodes: number): Section {
    const sha256 = digest(data), file = sha256 + ".json";
    fs.writeFileSync(path.join(this.directory, file), data);
    const bytes = Buffer.byteLength(data);
    return { file, sha256, bytes, nodes };
  }

  private graph(value: unknown, kind: string, name?: string): Section & { content?: string } {
    const begin = performance.now();
    const encoded_graph = encode_term(value as Bend.LTerm, this.tables);
    const encoded_at = performance.now();
    const graph = kind === "body" ? share_rows(encoded_graph, this.tables) : encoded_graph;
    const shared_ms = performance.now() - encoded_at;
    const data = JSON.stringify(graph);
    const encoded = performance.now();
    const section = this.write(data, graph.rows.length);
    const written = performance.now();
    const content = kind === "body" ? graph_digest(graph, this.tables.data) : undefined;
    this.observe?.("store.section", { kind, name, ...section, content,
      encode_ms: encoded - begin, write_ms: written - encoded, digest_ms: performance.now() - written,
      share_ms: shared_ms, rows_before: encoded_graph.rows.length });
    return content === undefined ? section : { ...section, content };
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

  // Add the content identities of the header entries. The index is rewritten and
  // the reader returned by seal() reads the same directory.
  attach(index: StoreIndex, entries: Entries): StoreIndex {
    const data = JSON.stringify(entries), section = this.write(data, Object.keys(entries.tld).length);
    this.observe?.("store.section", { kind: "entries", ...section });
    const next = { ...index, entries: section };
    fs.writeFileSync(path.join(this.directory, "index.json"), JSON.stringify(next));
    return next;
  }

  seal(header: unknown): { index: StoreIndex; reader: CheckedReader; bytes: number } {
    // Front-end walks normalize checker cells. Encode their completed state
    // before releasing the front-end graph.
    for (const [name, { value, mode }] of this.pending) {
      this.bodies.set(name, { ...this.graph(value, "body", name), mode } as BodySection);
    }
    this.pending.clear();
    const section = this.graph(header, "header");
    const begin = performance.now();
    const tables = this.write(JSON.stringify(this.tables.data), this.tables.data.spans.length);
    this.observe?.("store.section", { kind: "tables", ...tables,
      duration_ms: performance.now() - begin });
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
    return { index, reader: new CheckedReader(this.directory, this.compiler, this.observe), bytes };
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

  constructor(readonly directory: string, compiler: string, private observe?: Observe) {
    const begin = performance.now();
    this.index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
    if (this.index.compiler !== compiler) throw new Error("Checked store compiler identity differs");
    this.tables = new DecoderTables(this.read<Tables>(this.index.tables));
    this.bodies = new Map(this.index.bodies);
    this.observe?.("store.tables", { duration_ms: performance.now() - begin,
      bytes: this.index.tables.bytes, spans: this.tables.spans.length });
  }

  private read<T>(section: Section): T {
    const data = fs.readFileSync(path.join(this.directory, section.file), "utf8");
    if (digest(data) !== section.sha256) throw new Error("Checked store section changed: " + section.file);
    return JSON.parse(data) as T;
  }

  header<T>(): T {
    const begin = performance.now();
    const value = decode_term(this.read<TermGraph>(this.index.header), this.tables) as T;
    this.observe?.("store.header", { duration_ms: performance.now() - begin,
      bytes: this.index.header.bytes, nodes: this.index.header.nodes });
    return value;
  }

  // Dependency discovery reads encoded roots, including callback templates and
  // checker-cell values. It leaves decoded terms and constructor interns untouched.
  dependencies(): Map<string, Set<string>> {
    const begin = performance.now(), strings = this.tables.data.strings;
    const header = this.read<TermGraph>(this.index.header);
    const field = (value: Value, key: string): Value => {
      if (value === null || typeof value !== "object" || !("node" in value)) {
        throw new Error("Checked header dependency path is unavailable: " + key);
      }
      const row = header.rows[value.node];
      for (let at = 2; at < row.length; at += 3) if (strings[row[at]] === key) {
        if (row[at + 1] === NODE) return { node: row[at + 2] };
        throw new Error("Checked header dependency path is not a node: " + key);
      }
      throw new Error("Checked header dependency field is unavailable: " + key);
    };
    const tlds = field(field(header.root, "book"), "tlds") as { node: number };
    const graph = new Map<string, Set<string>>();
    const references = (graph: TermGraph, root: Value): Set<string> => {
      const refs = new Set<string>(), seen = new Uint8Array(graph.rows.length);
      const stack = root !== null && typeof root === "object" && "node" in root ? [root.node] : [];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen[id]) continue;
        seen[id] = 1;
        const row = graph.rows[id];
        if (row[1] === OBJECT || row[1] === DICTIONARY) {
          let kind: string | undefined, name: string | undefined;
          for (let at = 2; at < row.length; at += 3) if (row[at + 1] === STRING) {
            const key = strings[row[at]];
            if (key === "$") kind = strings[row[at + 2]];
            else if (key === "k") name = strings[row[at + 2]];
          }
          if ((kind === "Ref" || kind === "ADT") && name !== undefined) refs.add(name);
        }
        for (const child of row_children(row)) stack.push(child);
      }
      return refs;
    };
    const row = header.rows[tlds.node];
    for (let at = 2; at < row.length; at += 3) {
      if (row[at + 1] !== NODE) throw new Error("Checked top-level dependency root is not a node");
      graph.set(strings[row[at]], references(header, { node: row[at + 2] }));
    }
    for (const [name, section] of this.bodies) {
      const body = this.read<TermGraph>(section), refs = graph.get(name)!;
      for (const ref of references(body, body.root)) refs.add(ref);
    }
    for (const [name, refs] of graph) {
      refs.delete(name);
      for (const ref of refs) if (!graph.has(ref)) refs.delete(ref);
    }
    this.observe?.("store.dependencies", { duration_ms: performance.now() - begin,
      definitions: graph.size, edges: [...graph.values()].reduce((n, refs) => n + refs.size, 0) });
    return graph;
  }

  has(name: string): boolean { return this.bodies.has(name); }

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
    const duration_ms = performance.now() - begin;
    this.decode_ms += duration_ms;
    this.observe?.("store.decode", { name, duration_ms, bytes: section.bytes,
      nodes: section.nodes, mode: section.mode });
    return h;
  }

  body_inputs(): BodyInput[] {
    return [...this.decoded.keys()].sort().map(name => {
      const section = this.bodies.get(name)!;
      return { name, content: section.content, mode: section.mode };
    });
  }

  release(): void { this.decoded.clear(); this.decode_ms = 0; }
}

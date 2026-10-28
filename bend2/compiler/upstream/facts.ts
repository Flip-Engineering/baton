export const KINDS = ["own", "hot", "stat"] as const;
export type Kind = typeof KINDS[number];
export type Snapshot = Record<Kind, ReadonlySet<string>>;
export type MutableFacts = Record<Kind, Set<string>>;
export type Event = ["read", Kind, string, boolean] | ["write", Kind, string];
export type Trace = { events: Event[]; reads: Map<string, boolean>; wrote: Map<string, number> };

export function empty(): MutableFacts {
  return { own: new Set(), hot: new Set(), stat: new Set() };
}

export function snapshot(facts: Snapshot): MutableFacts {
  return { own: new Set(facts.own), hot: new Set(facts.hot), stat: new Set(facts.stat) };
}

export function trace(): Trace {
  return { events: [], reads: new Map(), wrote: new Map() };
}

export function qualified(kind: Kind, key: string): string {
  return kind + ":" + key;
}

export class FactView extends Set<string> {
  constructor(readonly kind: Kind, private initial: ReadonlySet<string>, readonly trace: Trace) {
    super();
  }

  override get size(): number {
    let size = this.initial.size;
    for (const key of super.values()) if (!this.initial.has(key)) size++;
    return size;
  }

  override *values(): SetIterator<string> {
    yield* this.initial;
    for (const key of super.values()) if (!this.initial.has(key)) yield key;
  }
  override forEach(callback: (value: string, key: string, set: Set<string>) => void, receiver?: any): void {
    for (const key of this.values()) callback.call(receiver, key, key, this);
  }
  override keys(): SetIterator<string> { return this.values(); }
  override [Symbol.iterator](): SetIterator<string> { return this.values(); }
  override *entries(): SetIterator<[string, string]> {
    for (const key of this.values()) yield [key, key];
  }

  override has(key: string): boolean {
    const name = qualified(this.kind, key);
    if (this.trace.wrote.has(name)) return true;
    const answer = this.initial.has(key);
    if (!this.trace.reads.has(name)) {
      this.trace.reads.set(name, answer);
      this.trace.events.push(["read", this.kind, key, answer]);
    }
    return answer;
  }

  override add(key: string): this {
    const name = qualified(this.kind, key);
    if (!this.trace.wrote.has(name)) {
      this.trace.wrote.set(name, this.trace.events.length);
      this.trace.events.push(["write", this.kind, key]);
    }
    super.add(key);
    return this;
  }
}

export function views(initial: Snapshot, record: Trace): Record<Kind, FactView> {
  return { own: new FactView("own", initial.own, record),
    hot: new FactView("hot", initial.hot, record),
    stat: new FactView("stat", initial.stat, record) };
}

export function read_valid(reads: ReadonlyMap<string, boolean>, facts: Snapshot): boolean {
  for (const [name, answer] of reads) {
    const colon = name.indexOf(":"), kind = name.slice(0, colon) as Kind;
    if (facts[kind].has(name.slice(colon + 1)) !== answer) return false;
  }
  return true;
}

// Reads answered from a fixed snapshot are recorded once. Repeated answers
// stay equal; reads after a local write use that write and record no dependency.
export function replay_trace(events: Event[], initial: Snapshot, unit: string): MutableFacts {
  const local = empty();
  for (let i = 0; i < events.length; i++) {
    const event = events[i], [operation, kind, key] = event;
    if (operation === "write") local[kind].add(key);
    else if (local[kind].has(key) || initial[kind].has(key) !== event[3]) {
      throw new Error("Fact replay read differs: " + unit + " event " + i + " " + qualified(kind, key));
    }
  }
  return local;
}

export type BorrowMask = [string, boolean[]];
export function lend_own(initial: Snapshot, asks: Iterable<string>, masks: BorrowMask[]): Set<string> {
  const lend = new Set(asks), edges: [string, string][] = [];
  for (const ask of lend) {
    const at = ask.indexOf("<");
    if (at >= 0) edges.push([ask.slice(0, at), ask.slice(at + 1)]);
  }
  for (let size = -1; size !== lend.size;) {
    size = lend.size;
    for (const [left, right] of edges) if (lend.has(right)) lend.add(left);
  }
  const added = new Set<string>();
  for (const [name, mask] of masks) mask.forEach((borrow, i) => {
    const key = name + "~" + i;
    if (borrow && !initial.own.has(key) && !lend.has(key)) added.add(key);
  });
  return added;
}

export type UnitHistory = { kind: "units"; units: { key: string; events: Event[] }[] };
export type LendHistory = { kind: "lend"; asks: string[]; masks: BorrowMask[]; added: string[] };
export type History = UnitHistory | LendHistory;

export function replay(history: Iterable<History>, expected: Snapshot): void {
  const facts = empty();
  for (const barrier of history) {
    if (barrier.kind === "units") {
      const additions = barrier.units.map(unit => replay_trace(unit.events, facts, unit.key));
      for (const delta of additions) for (const kind of KINDS) {
        for (const key of delta[kind]) facts[kind].add(key);
      }
    } else {
      const added = lend_own(facts, barrier.asks, barrier.masks);
      if (added.size !== barrier.added.length || barrier.added.some(key => !added.has(key))) {
        throw new Error("Fact replay lend output differs");
      }
      for (const key of added) facts.own.add(key);
    }
  }
  for (const kind of KINDS) {
    for (const key of facts[kind]) if (!expected[kind].has(key)) {
      throw new Error("Fact replay produced an unexpected key: " + qualified(kind, key));
    }
    for (const key of expected[kind]) if (!facts[kind].has(key)) {
      throw new Error("Fact replay has no producer: " + qualified(kind, key));
    }
  }
}
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";


export function digest(facts: Snapshot): string {
  const hash = createHash("sha256");
  for (const kind of KINDS) {
    hash.update(JSON.stringify([kind, [...facts[kind]].sort()]));
  }
  return hash.digest("hex");
}

// Edges point to callees. Components are numbered after their callees so a
// level barrier can publish facts before the callers at the next level run.
export function levels(graph: ReadonlyMap<string, ReadonlySet<string>>): Map<string, number> {
  const reverse = new Map<string, string[]>();
  for (const key of graph.keys()) reverse.set(key, []);
  for (const [key, refs] of graph) for (const ref of refs) {
    if (!graph.has(ref)) throw new Error("Unknown source dependency: " + key + " -> " + ref);
    reverse.get(ref)!.push(key);
  }
  const seen = new Set<string>(), order: string[] = [];
  for (const root of graph.keys()) {
    if (seen.has(root)) continue;
    seen.add(root);
    const stack: [string, Iterator<string>][] = [[root, graph.get(root)!.values()]];
    while (stack.length) {
      const top = stack[stack.length - 1], next = top[1].next();
      if (next.done) { order.push(top[0]); stack.pop(); }
      else if (!seen.has(next.value)) {
        seen.add(next.value);
        stack.push([next.value, graph.get(next.value)!.values()]);
      }
    }
  }
  const components: string[][] = [], owner = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const root = order[i];
    if (owner.has(root)) continue;
    const component: string[] = [], stack = [root], id = components.length;
    owner.set(root, id);
    while (stack.length) {
      const key = stack.pop()!;
      component.push(key);
      for (const from of reverse.get(key)!) if (!owner.has(from)) {
        owner.set(from, id); stack.push(from);
      }
    }
    components.push(component);
  }
  const result = new Map<string, number>();
  for (let i = components.length - 1; i >= 0; i--) {
    let level = 0;
    for (const key of components[i]) for (const ref of graph.get(key)!) {
      if (owner.get(ref) !== i) level = Math.max(level, result.get(ref)! + 1);
    }
    for (const key of components[i]) result.set(key, level);
  }
  return result;
}

export function covers(graph: ReadonlyMap<string, ReadonlySet<string>>, from: string, to: string): boolean {
  const seen = new Set<string>(), stack = [from];
  while (stack.length) {
    const key = stack.pop()!;
    if (key === to) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ref of graph.get(key) ?? []) stack.push(ref);
  }
  return false;
}

type JournalRow =
  | { kind: "begin"; round: number; level: number; snapshot: string }
  | { kind: "unit"; key: string; revision: number; events: Event[]; lend: string[]; masks: BorrowMask[] }
  | { kind: "merge"; result: string; changed: string[]; invalidated: string[];
      producers: [string, string, number, number][] }
  | { kind: "lend"; snapshot: string; revisions: [string, number][];
      asks: string[]; masks: BorrowMask[]; added: string[]; result: string };

function* lines(file: string): Generator<string> {
  const fd = fs.openSync(file, "r"), decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(65536);
  let pending = "";
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      pending += decoder.write(buffer.subarray(0, count));
      let begin = 0, end: number;
      while ((end = pending.indexOf("\n", begin)) >= 0) {
        yield pending.slice(begin, end); begin = end + 1;
      }
      pending = pending.slice(begin);
    }
    pending += decoder.end();
    if (pending !== "") throw new Error("Incomplete fact history: " + file);
  } finally { fs.closeSync(fd); }
}

function file_digest(file: string): string {
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(65536), fd = fs.openSync(file, "r");
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) return hash.digest("hex");
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
}

export class Journal {
  private fd: number;
  constructor(readonly file: string) { this.fd = fs.openSync(file, "wx"); }
  append(row: JournalRow): void {
    fs.writeFileSync(this.fd, JSON.stringify(row) + "\n");
  }
  close(): void { if (this.fd >= 0) { fs.closeSync(this.fd); this.fd = -1; } }
  replay(expected: Snapshot): void {
    this.close();
    Journal.verify(this.file, expected);
  }
  static verify(file: string, expected: Snapshot): void {
    const facts = empty();
    let pending: MutableFacts | null = null;
    const revisions = new Map<string, { revision: number; lend: string[]; masks: BorrowMask[]; reads: Map<string, boolean> }>();
    let producers = new Map<string, [string, string, number, number]>();
    for (const line of lines(file)) {
      const row = JSON.parse(line) as JournalRow;
      if (row.kind === "begin") {
        if (pending !== null || digest(facts) !== row.snapshot) throw new Error("Fact replay snapshot differs");
        pending = empty(); producers = new Map();
      } else if (row.kind === "unit") {
        if (pending === null) throw new Error("Fact replay unit outside a barrier: " + row.key);
        const local = replay_trace(row.events, facts, row.key + " revision " + row.revision);
        for (const kind of KINDS) for (const key of local[kind]) pending[kind].add(key);
        const reads = new Map<string, boolean>();
        for (let index = 0; index < row.events.length; index++) {
          const event = row.events[index], name = qualified(event[1], event[2]);
          if (event[0] === "read") reads.set(name, event[3]);
          else if (!facts[event[1]].has(event[2])) {
            const old = producers.get(name);
            if (old === undefined || row.key < old[1] || (row.key === old[1] && row.revision < old[2])) {
              producers.set(name, [name, row.key, row.revision, index]);
            }
          }
        }
        revisions.set(row.key, { revision: row.revision, lend: row.lend, masks: row.masks, reads });
      } else if (row.kind === "merge") {
        if (pending === null) throw new Error("Fact replay merge outside a barrier");
        const changed: string[] = [];
        for (const kind of KINDS) for (const key of pending[kind]) {
          if (!facts[kind].has(key)) { facts[kind].add(key); changed.push(qualified(kind, key)); }
        }
        const names = new Set(changed), invalidated: string[] = [];
        for (const [key, record] of revisions) {
          if ([...record.reads].some(([name, answer]) => !answer && names.has(name))) invalidated.push(key);
        }
        const witnesses = [...producers.values()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        if (JSON.stringify(changed.sort()) !== JSON.stringify(row.changed)
          || JSON.stringify(invalidated.sort()) !== JSON.stringify(row.invalidated)
          || JSON.stringify(witnesses) !== JSON.stringify(row.producers)) throw new Error("Fact replay merge dependencies differ");
        pending = null;
        if (digest(facts) !== row.result) throw new Error("Fact replay merge differs");
      } else {
        if (pending !== null || digest(facts) !== row.snapshot) throw new Error("Fact replay lend snapshot differs");
        if (revisions.size !== row.revisions.length || row.revisions.some(([key, rev]) => revisions.get(key)?.revision !== rev)) {
          throw new Error("Fact replay lend revisions differ");
        }
        const asks = new Set<string>(), masks = new Map<string, boolean[]>();
        for (const record of revisions.values()) {
          for (const ask of record.lend) asks.add(ask);
          for (const [key, mask] of record.masks) masks.set(key, mask);
        }
        const rows = [...masks].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        if (JSON.stringify([...asks].sort()) !== JSON.stringify(row.asks)
          || JSON.stringify(rows) !== JSON.stringify(row.masks)) throw new Error("Fact replay lend inputs differ");
        const added = lend_own(facts, row.asks, row.masks);
        if (added.size !== row.added.length || row.added.some(key => !added.has(key))) {
          throw new Error("Fact replay lend output differs");
        }
        for (const key of added) facts.own.add(key);
        if (digest(facts) !== row.result) throw new Error("Fact replay lend result differs");
      }
    }
    if (pending !== null) throw new Error("Fact replay ended inside a barrier");
    for (const kind of KINDS) {
      for (const key of expected[kind]) if (!facts[kind].has(key)) {
        throw new Error("Fact replay has no producer: " + qualified(kind, key));
      }
      for (const key of facts[kind]) if (!expected[kind].has(key)) {
        throw new Error("Fact replay produced an unexpected key: " + qualified(kind, key));
      }
    }
  }
}

export type UnitRecord<T> = {
  key: string; facts_only: boolean; revision: number; trace: Trace;
  lend: Set<string>; masks: BorrowMask[]; refs: Set<string>;
  edges: [string, string][]; code: T;
};
type Observe = (event: string, details: { [key: string]: unknown }) => void;
export type Emit<T> = (key: string, facts_only: boolean, initial: Snapshot, record: Trace) =>
  Omit<UnitRecord<T>, "key" | "facts_only" | "revision" | "trace">;

export function solve<T>(options: {
  graph: Map<string, Set<string>>; entries: Set<string>; generic: Set<string>; roots: string[];
  directory: string; emit: Emit<T>; observe: Observe; release?: (code: T) => void;
  barrier?: (round: number, records: ReadonlyMap<string, UnitRecord<T>>, facts: MutableFacts,
    emitted: number, facts_emitted: number, pending: number) => void;
}): { facts: MutableFacts; records: Map<string, UnitRecord<T>>; history: string } {
  const { graph, entries, generic, roots, emit, observe } = options;
  for (let attempt = 0; ; attempt++) {
    const plan = levels(graph), facts = empty(), records = new Map<string, UnitRecord<T>>();
    const graph_file = options.directory + "/graph-" + attempt + ".json";
    fs.writeFileSync(graph_file, JSON.stringify({ edges: [...graph].map(([key, refs]) => [key, [...refs].sort()]),
      levels: [...plan], roots, generic: [...generic].sort() }));
    observe("facts.plan", { attempt, nodes: graph.size, levels: new Set(plan.values()).size,
      sha256: file_digest(graph_file) });
    const readers = new Map<string, Set<string>>();
    const required = new Map<string, boolean>();
    for (const key of generic) required.set(key, true);
    for (const key of roots) if (entries.has(key)) required.set(key, false);
    let dirty = new Set(required.keys()), restart = false, round = 0;
    const history = new Journal(options.directory + "/facts-" + attempt + ".jsonl");
    const invalidate = (name: string, output: Set<string>): void => {
      for (const key of readers.get(name) ?? []) output.add(key);
    };
    const replace = (record: UnitRecord<T>): void => {
      const old = records.get(record.key);
      if (old) {
        for (const name of old.trace.reads.keys()) readers.get(name)?.delete(record.key);
        options.release?.(old.code);
      }
      records.set(record.key, record);
      for (const [name, present] of record.trace.reads) if (!present) {
        let list = readers.get(name);
        if (!list) readers.set(name, list = new Set());
        list.add(record.key);
      }
    };
    try {
      while (!restart) {
        while (dirty.size && !restart) {
          round++;
          observe("pass.begin", { pass: round, definitions: required.size,
            own: facts.own.size, hot: facts.hot.size, stat: facts.stat.size });
          const queues = new Map<number, Set<string>>();
          const enqueue = (key: string): void => {
            const level = plan.get(key);
            if (level === undefined) throw new Error("Unplanned definition: " + key);
            let queue = queues.get(level);
            if (!queue) queues.set(level, queue = new Set());
            queue.add(key);
          };
          for (const key of dirty) enqueue(key);
          dirty = new Set();
          let emitted = 0, facts_emitted = 0;
          while (queues.size && !restart) {
            let level = Infinity;
            for (const candidate of queues.keys()) level = Math.min(level, candidate);
            const cohort = queues.get(level)!;
            queues.delete(level);
            const outputs = new Map<string, UnitRecord<T>>(), emissions: UnitRecord<T>[] = [];
            history.append({ kind: "begin", round, level, snapshot: digest(facts) });
            const queue = [...cohort].sort();
            for (let cursor = 0; cursor < queue.length; cursor++) {
              const key = queue[cursor];
              cohort.delete(key);
              const facts_only = required.get(key)!;
              const record = trace(), result = emit(key, facts_only, facts, record);
              const revision = (outputs.get(key)?.revision ?? records.get(key)?.revision ?? 0) + 1;
              const output = { ...result, key, facts_only, revision, trace: record };
              const previous = outputs.get(key);
              if (previous) options.release?.(previous.code);
              outputs.set(key, output); emissions.push(output);
              facts_only ? facts_emitted++ : emitted++;
              history.append({ kind: "unit", key, revision, events: record.events, lend: [...result.lend], masks: result.masks });
              for (const [from, to] of result.edges) {
                if (!graph.has(from) || !graph.has(to)) throw new Error("Unresolved source edge: " + from + " -> " + to);
                if (!graph.get(from)!.has(to) && !covers(graph, from, to)) {
                  graph.get(from)!.add(to);
                  observe("facts.graph.invalidate", { attempt, from, to, round, level });
                  restart = true;
                }
              }
              if (restart) break;
              if (!facts_only) for (const ref of result.refs) if (entries.has(ref)) {
                if (!required.has(ref) || required.get(ref) === true) {
                  required.set(ref, false);
                  // A promotion needs an entry emission even if its facts-only
                  // revision was already emitted against this same snapshot.
                  if ((plan.get(ref) ?? 0) <= level) {
                    if (!cohort.has(ref)) { cohort.add(ref); queue.push(ref); }
                  }
                  else enqueue(ref);
                }
              }
            }
            if (restart) {
              for (const output of outputs.values()) options.release?.(output.code);
              break;
            }
            const changed = new Set<string>(), producers: [string, string, number, number][] = [];
            for (const output of outputs.values()) replace(output);
            for (const output of emissions.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.revision - b.revision)) {
              for (const [name, index] of output.trace.wrote) {
                const event = output.trace.events[index], kind = event[1], key = event[2];
                if (!facts[kind].has(key)) {
                  facts[kind].add(key); changed.add(name);
                  producers.push([name, output.key, output.revision, index]);
                  observe("fact.write", { kind, key, unit: output.key, writer: output.key,
                    revision: output.revision, event_index: index, round, level, attempt });
                }
              }
            }
            const invalidated = new Set<string>();
            for (const name of changed) invalidate(name, invalidated);
            for (const key of invalidated) {
              if (plan.get(key)! > level) enqueue(key);
              else dirty.add(key);
            }
            history.append({ kind: "merge", result: digest(facts), changed: [...changed].sort(),
              invalidated: [...invalidated].sort(), producers: producers.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) });
            observe("facts.level", { attempt, round, level, units: outputs.size,
              changed: changed.size, snapshot: digest(facts) });
          }
          if (restart) break;
          options.barrier?.(round, records, facts, emitted, facts_emitted, dirty.size);
        }
        if (restart) break;
        const asks = new Set<string>(), masks = new Map<string, boolean[]>();
        for (const record of records.values()) {
          for (const ask of record.lend) asks.add(ask);
          for (const [key, mask] of record.masks) masks.set(key, mask);
        }
        const before = digest(facts), mask_rows = [...masks].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        const added = [...lend_own(facts, asks, mask_rows)].sort();
        for (const key of added) {
          facts.own.add(key); invalidate(qualified("own", key), dirty);
          observe("fact.write", { kind: "own", key, unit: null, writer: "facts.lend", round, attempt });
        }
        history.append({ kind: "lend", snapshot: before,
          revisions: [...records].map(([key, record]) => [key, record.revision]),
          asks: [...asks].sort(), masks: mask_rows, added, result: digest(facts) });
        observe("facts.round", { round, own: facts.own.size, hot: facts.hot.size,
          stat: facts.stat.size, added: added.length, keys: added });
        if (!dirty.size) {
          for (const record of records.values()) {
            if (!read_valid(record.trace.reads, facts)) throw new Error("Invalid final fact reads: " + record.key);
          }
          history.replay(facts);
          observe("facts.replay", { attempt, rounds: round, records: records.size,
            sha256: file_digest(history.file),
            bytes: fs.statSync(history.file).size, result: digest(facts) });
          return { facts, records, history: history.file };
        }
      }
    } finally { history.close(); }
    for (const record of records.values()) options.release?.(record.code);
  }
}

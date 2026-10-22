// Protected test: a duplicated shared arm body whose Ref.b bang marker
// changes in one copy. A compiler that ignores Ref.b shares the copy and
// emits the same C; a compiler that compares it emits a separate spin.
//
// Usage: bin/bun --smol bend2/test/compiler/arm_eq_ref_bang_share.ts COMPILER_DIR
//
// COMPILER_DIR holds bend2/comp.ts, bend2/bend.ts, bend2/base.bend and
// bend2/effs. The script imports the repository bend.ts (the pinned file)
// for terms and types and loads only comp.ts from COMPILER_DIR.
//
// The bang marker also joins the file's bang set, so the whole C changes even
// when the arm is shared. The sharing decision is the arm-spin count: the
// corrected head emits additional arm spins for the mutated copy, the
// pre-correction compiler does not. Exit 0 when the spin count grows, 1 when
// it stays the same.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

const [dirArg] = process.argv.slice(2);
if (dirArg === undefined) {
  console.error("usage: arm_eq_ref_bang_share.ts COMPILER_DIR");
  process.exit(2);
}
const dir = path.resolve(dirArg);
const fixture = path.resolve(import.meta.dir, "fixtures/arm_eq_ann_share.bend");

type Compiler = {
  compile_book(book: Bend.Book): string;
  book_owned(book: Bend.Book, ks?: string[]): void;
  SYNTH: string[];
};
const Comp = (await import(pathToFileURL(path.join(dir, "bend2/comp.ts")).href)) as unknown as Compiler;

function seed(base: Bend.Book): Bend.Book {
  const book = Bend.book_nil();
  for (const k of Object.keys(base.tlds)) book.tlds[k] = { ...base.tlds[k] };
  Object.assign(book.ctrs, base.ctrs);
  for (const k of Object.keys(base.tmps)) book.tmps[k] = { ...base.tmps[k] };
  book.order.push(...base.order);
  return book;
}

const base = Bend.book_nil();
await Bend.book_load(base, Bend.BASE_BEND, "", new Map());
Bend.book_valid(base, 0);
Comp.book_owned(base, Comp.SYNTH);

async function book(): Promise<Bend.Book> {
  const b = seed(base);
  const seen = new Map<string, string | null>([[Bend.BASE_BEND, ""]]);
  await Bend.book_load(b, fixture, "", seen);
  Bend.book_valid(b, base.order.length);
  Comp.book_owned(b, Comp.SYNTH);
  return b;
}

type Site = { ann: Extract<Bend.LTerm, { $: "Ann" }> };
const DEF = "dispatch";
const SITE = 1;

function sites(b: Bend.Book): Site[] {
  const tld = b.tlds[DEF];
  if (tld?.$ !== "Def" || tld.e === undefined) {
    throw new Error("fixture def " + DEF + " has no checked body");
  }
  const out: Site[] = [];
  const seen = new Set<Bend.LTerm>();
  const note = (t: Bend.LTerm): void => {
    if (seen.has(t)) return;
    seen.add(t);
    if (t.$ === "Ann") out.push({ ann: t });
  };
  const walk = (t: Bend.LTerm): void => {
    switch (t.$) {
      case "Mat": {
        const arms: Bend.LTerm[] = [];
        let cur: Bend.LTerm = t;
        for (let m = cur; m.$ === "Mat"; m = cur) {
          arms.push(m.h);
          cur = m.m;
        }
        for (const h of arms) note(h);
        note(cur);
        for (const h of arms) walk(h);
        walk(cur);
        return;
      }
      case "Ann": walk(t.x); return;
      case "Lam": walk(t.f); return;
      case "Let": t.v.forEach(walk); walk(t.f); return;
      case "App": walk(t.f); walk(t.x); return;
      case "Ctr":
      case "ADT": t.x.forEach(walk); return;
      case "Sub": if (t.v.$ !== "PVar" && t.v.$ !== "PCtr") walk(t.v); walk(t.f); return;
      case "All": walk(t.A); walk(t.B); return;
      case "Min": walk(t.a); walk(t.b); return;
      case "Typ": walk(t.g); return;
      case "Eql": walk(t.a); walk(t.b); walk(t.T); return;
      case "Rwt": walk(t.e); walk(t.p); walk(t.f); return;
      default: return;
    }
  };
  walk(tld.e);
  return out;
}

type Group = { key: string; sites: Site[] };

function groups(list: Site[]): Group[] {
  const map = new Map<string, Site[]>();
  for (const s of list) {
    const inner = s.ann.x;
    const sp = inner.s;
    const key = (sp === undefined ? "?" : sp.beg + ":" + sp.end) + ":" + inner.$;
    const g = map.get(key) ?? [];
    g.push(s);
    map.set(key, g);
  }
  const out: Group[] = [];
  for (const [key, g] of map) if (g.length >= 2) out.push({ key, sites: g });
  return out;
}

// bangTerm returns a copy of t with one call-head Ref's bang marker set.
// Nodes along the path to that Ref are copied; sibling subtrees are reused.
// The copies made by the flattener share inner bodies, so mutating a Ref in
// place would change every copy; only the copied path isolates one arm.
function bangHead(node: Bend.LTerm): [Bend.LTerm, boolean] | null {
  if (node.$ === "Ref") return [{ ...node, b: true }, true];
  if (node.$ === "App") {
    const r = bangHead(node.f);
    return r === null ? null : [{ ...node, f: r[0] }, true];
  }
  if (node.$ === "Ann") {
    const r = bangHead(node.x);
    return r === null ? null : [{ ...node, x: r[0] }, true];
  }
  return null;
}

function bangTerm(t: Bend.LTerm): Bend.LTerm | null {
  switch (t.$) {
    case "App": {
      const h = bangHead(t);
      if (h !== null) return h[0];
      const f = bangTerm(t.f);
      if (f !== null) return { ...t, f };
      const x = bangTerm(t.x);
      return x === null ? null : { ...t, x };
    }
    case "Ann": {
      const x = bangTerm(t.x);
      return x === null ? null : { ...t, x };
    }
    case "Lam": {
      const f = bangTerm(t.f);
      return f === null ? null : { ...t, f };
    }
    case "Let": {
      for (let i = 0; i < t.v.length; i++) {
        const v = bangTerm(t.v[i]);
        if (v !== null) {
          const vs = t.v.slice();
          vs[i] = v;
          return { ...t, v: vs };
        }
      }
      const f = bangTerm(t.f);
      return f === null ? null : { ...t, f };
    }
    case "Mat": {
      const h = bangTerm(t.h);
      if (h !== null) return { ...t, h };
      const m = bangTerm(t.m);
      return m === null ? null : { ...t, m };
    }
    case "Ctr": {
      for (let i = 0; i < t.x.length; i++) {
        const x = bangTerm(t.x[i]);
        if (x !== null) {
          const xs = t.x.slice();
          xs[i] = x;
          return { ...t, x: xs };
        }
      }
      return null;
    }
    case "Sub": {
      if (t.v.$ !== "PVar" && t.v.$ !== "PCtr") {
        const v = bangTerm(t.v);
        if (v !== null) return { ...t, v };
      }
      const f = bangTerm(t.f);
      return f === null ? null : { ...t, f };
    }
    default: return null;
  }
}

const spin_count = (c: string): number => (c.match(/Term arm_/g) ?? []).length;
const plain = Comp.compile_book(await book());
const plain_spins = spin_count(plain);
const list = sites(await book());
const all = groups(list);
// arm_eq_ann_share.ts establishes that this group's second site shares the
// representative on the base compiler and separates on the corrected head.
// The Ref.b mutation below targets that same copy.
const shared = all.find((g) => g.key === "431:448:Lam");
if (shared === undefined) {
  throw new Error("fixture group 431:448:Lam is absent");
}

let tried = 0;
for (const g of [shared]) {
  const b = await book();
  const same = groups(sites(b)).find((h) => h.key === g.key);
  if (same === undefined) continue;
  const site = same.sites[SITE];
  const next = bangTerm(site.ann.x);
  if (next === null) continue;
  site.ann.x = next;
  tried += 1;
  const changed = Comp.compile_book(b);
  const changed_spins = spin_count(changed);
  if (process.env.ARM_EQ_C !== undefined) fs.writeFileSync(process.env.ARM_EQ_C, changed);
  if (changed_spins > plain_spins) {
    console.log("PASS: Ref.b mutation added arm spins: plain " + plain.length
      + " B/" + plain_spins + " spins, mutated " + changed.length + " B/"
      + changed_spins + " spins, group " + g.key + ", site " + SITE
      + ", compiles tried " + tried);
    process.exit(0);
  }
}
console.log("FAIL: Ref.b mutation kept the arm spin count (" + plain_spins
  + ", " + plain.length + " B); this compiler shares across Ref.b, compiles tried "
  + tried);
process.exit(1);

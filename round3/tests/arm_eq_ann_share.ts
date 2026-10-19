// Protected test: base arm_eq shares a duplicated arm body after one copy's
// annotation quantity changes; the total equality emits a separate spin.
//
// Usage: bin/bun --smol round3/tests/arm_eq_ann_share.ts COMPILER_DIR
//
// COMPILER_DIR holds bend2/comp.ts, bend2/bend.ts, bend2/base.bend and
// bend2/effs. The candidate bend.ts is the pinned file (sha256 93c2a43d...),
// so this script imports the repository copy for terms and types and loads
// only comp.ts from COMPILER_DIR.
//
// The test loads round3/fixtures/arm_eq_ann_share.bend twice: once plain and
// once with one duplicated Mat arm's Ann.T quantity changed from Lone to
// Many. The change is layout-neutral. A compiler that ignores Ann.T emits
// byte-identical C; a compiler that compares it emits a separate spin.
// Exit 0 when the C differs, 1 when it does not.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../bend2/compiler/upstream/bend.ts";

const [dirArg] = process.argv.slice(2);
if (dirArg === undefined) {
  console.error("usage: arm_eq_ann_share.ts COMPILER_DIR");
  process.exit(2);
}
const dir = path.resolve(dirArg);
const fixture = path.resolve(import.meta.dir, "../fixtures/arm_eq_ann_share.bend");

type Compiler = {
  compile_book(book: Bend.Book): string;
  book_owned(book: Bend.Book, ks?: string[]): void;
  SYNTH: string[];
};
// The compiler under test is selected at run time, so its module shape is
// declared here rather than imported from a fixed path.
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

function sites(book: Bend.Book): Site[] {
  const tld = book.tlds[DEF];
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

function annotation(s: Site): Bend.HTerm | null {
  const cell = s.ann.T;
  if (cell.$ !== "Var" || cell.v === undefined) return null;
  // The checker stores a higher-order type behind this cell; the emitter
  // forces it before reading any field.
  return Bend.term_force(cell as unknown as Bend.HTerm);
}

function mutate(s: Site): boolean {
  const ty = annotation(s);
  if (ty === null || ty.$ !== "All" || ty.q.$ !== "Lone") return false;
  const next = Bend.All(Bend.Many(), ty.k, ty.i, ty.A, ty.B, ty.s);
  // The replacement keeps the checker's cell form (a Var carrying the type).
  s.ann.T = Bend.Var("_", -1, undefined, next) as unknown as Bend.LTerm;
  return true;
}

const plain = Comp.compile_book(await book());
const list = sites(await book());
const candidates = groups(list).filter((g) => g.sites.slice(0, 2).every((s) => {
  const ty = annotation(s);
  return ty !== null && ty.$ === "All" && ty.q.$ === "Lone";
}));

let tried = 0;
for (const g of candidates) {
  const b = await book();
  const sites_b = sites(b);
  const same = groups(sites_b).find((h) => h.key === g.key);
  if (same === undefined || !mutate(same.sites[1])) continue;
  tried += 1;
  const changed = Comp.compile_book(b);
  if (changed !== plain) {
    if (process.env.ARM_EQ_C !== undefined) {
      fs.writeFileSync(process.env.ARM_EQ_C, changed);
    }
    console.log("PASS: mutation emitted different C: plain " + plain.length
      + " B, mutated " + changed.length + " B, group " + g.key
      + ", candidates tried " + tried);
    process.exit(0);
  }
}
console.log("FAIL: every annotation mutation emitted the same C (" + plain.length
  + " B); this compiler shares across Ann.T, candidates tried " + tried);
process.exit(1);

// arm_eq Ref.bang totality for match arms.
// The checked arms come from the fixtures/arm_eq_ann_share.bend fixture;
// arm_eq must keep two identical arms together and split the copy whose
// call-head Ref carries the bang marker. A bang-blind equality shares it.
// Usage: bun arm_eq_ref_bang_share.ts COMPILER_DIR
import * as fs from "node:fs";
import * as os from "node:os";
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
  arm_eq(a: Bend.LTerm, b: Bend.LTerm): boolean;
  SYNTH: string[];
};
// arm_eq is appended as an export the way arm_eq_adt_r.ts exposes it: the
// emission oracle in the retired revision could no longer observe sharing
// once the list-column lowering deferred the literal column to String.eq
// guards, so this test asserts the equality itself on the checked arms the
// fixture still yields.
const compSource = [
  path.join(dir, "bend2/compiler/upstream/comp.ts"),
  path.join(dir, "bend2/comp.ts"),
].find((p) => fs.existsSync(p));
if (compSource === undefined) {
  console.error("no comp.ts under " + dir);
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-eq-bang-"));
fs.cpSync(path.dirname(compSource), tmp, { recursive: true });
const testModule = path.join(tmp, "comp.arm_eq_ref_bang_share_test.ts");
fs.writeFileSync(testModule,
  fs.readFileSync(compSource, "utf8") + "\nexport { arm_eq };\n");
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const Comp = (await import(pathToFileURL(testModule).href)) as unknown as Compiler;

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

const plain = Comp.compile_book(await book());
if (process.env.ARM_EQ_C !== undefined) {
  fs.writeFileSync(process.env.ARM_EQ_C, plain);
}
const list = sites(await book());
const all = groups(list);
// arm_eq decides on higher-order terms, so higher both sides the way the
// emitter's def_body does before emission.
let tried = 0;
for (const g of all) {
  const next = bangTerm(g.sites[0].ann.x);
  if (next === null) continue;
  tried += 1;
  const one = Bend.term_higher(g.sites[0].ann);
  const two = Bend.term_higher({ ...g.sites[0].ann });
  if (!Comp.arm_eq(one, two)) {
    console.log("FAIL: arm_eq rejects two identical checked arms");
    process.exit(1);
  }
  const other = Bend.term_higher({ ...g.sites[0].ann, x: next });
  if (Comp.arm_eq(one, other)) {
    console.log("FAIL: arm_eq shares arms across the Ref.b marker");
    process.exit(1);
  }
}
if (tried === 0) {
  console.log("FAIL: the fixture yields no arm with a call-head Ref to flip ("
    + list.length + " sites, " + all.length + " groups)");
  process.exit(1);
}
console.log("PASS: arm_eq keeps identical arms together and splits the arm "
  + "whose call-head Ref carries the bang (" + list.length + " sites, "
  + tried + " flipped)");

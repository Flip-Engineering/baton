// arm_eq annotation-quantity totality for match arms.
// The checked arms come from the fixtures/arm_eq_ann_share.bend fixture;
// arm_eq must keep two identical arms together and split the copy whose
// annotation quantity changed. A quantity-blind equality shares the copy.
// Usage: bun arm_eq_ann_share.ts COMPILER_DIR
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

const [dirArg] = process.argv.slice(2);
if (dirArg === undefined) {
  console.error("usage: arm_eq_ann_share.ts COMPILER_DIR");
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
// The compiler under test is selected at run time, so its module shape is
// declared here rather than imported from a fixed path. arm_eq is appended
// as an export the way arm_eq_adt_r.ts exposes it: the emission oracle in
// the retired revision could no longer observe sharing once the list-column
// lowering deferred the literal column to String.eq guards, so this test
// asserts the equality itself on the checked arms the fixture still yields.
const compSource = [
  path.join(dir, "bend2/compiler/upstream/comp.ts"),
  path.join(dir, "bend2/comp.ts"),
].find((p) => fs.existsSync(p));
if (compSource === undefined) {
  console.error("no comp.ts under " + dir);
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-eq-ann-"));
fs.cpSync(path.dirname(compSource), tmp, { recursive: true });
const testModule = path.join(tmp, "comp.arm_eq_ann_share_test.ts");
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

function annotation(s: Site): Bend.HTerm | null {
  const cell = s.ann.T;
  if (cell.$ !== "Var" || cell.v === undefined) return null;
  // The checker stores a higher-order type behind this cell; the emitter
  // forces it before reading any field.
  return Bend.term_force(cell as unknown as Bend.HTerm);
}

// A copy of the arm whose annotation quantity is flipped the other way: a
// total arm equality keeps the two apart, a quantity-blind one shares them.
function flipped(s: Site): Site["ann"] | null {
  const ty = annotation(s);
  if (ty === null || ty.$ !== "All") return null;
  const next = ty.q.$ === "Lone" ? Bend.Many() : Bend.Lone();
  const flippedTy = Bend.All(next, ty.k, ty.i, ty.A, ty.B, ty.s);
  // The replacement keeps the checker's cell form (a Var carrying the type).
  return { ...s.ann, T: Bend.Var("_", -1, undefined, flippedTy) as unknown as Bend.LTerm };
}

const plain = Comp.compile_book(await book());
if (process.env.ARM_EQ_C !== undefined) {
  fs.writeFileSync(process.env.ARM_EQ_C, plain);
}
const list = sites(await book());
const cand = list.find((s) => flipped(s) !== null);
if (cand === undefined) {
  console.log("FAIL: the fixture yields no annotated arm to compare ("
    + list.length + " sites, no All-typed annotation)");
  process.exit(1);
}
// arm_eq decides on higher-order terms, so higher both sides the way the
// emitter's def_body does before emission.
const one = Bend.term_higher(cand.ann);
const two = Bend.term_higher({ ...cand.ann });
if (!Comp.arm_eq(one, two)) {
  console.log("FAIL: arm_eq rejects two identical checked arms");
  process.exit(1);
}
const other = Bend.term_higher(flipped(cand)!);
if (Comp.arm_eq(one, other)) {
  console.log("FAIL: arm_eq shares arms across the annotation quantity");
  process.exit(1);
}
console.log("PASS: arm_eq keeps identical arms together and splits the arm "
  + "whose annotation quantity changed (" + list.length + " sites)");

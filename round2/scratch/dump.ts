import * as Bend from "../compiler-src/bend2/bend.ts";
const file = process.argv[2];
const book = Bend.book_nil();
const seen = new Map<string, string | null>();
await Bend.book_load(book, file, "", seen);
Bend.book_valid(book, 0);
const tld = book.tlds["dispatch"] as any;
function ser(t: any, d = 0): string {
  if (d > 10) return "…";
  if (t === null || typeof t !== "object") return String(t);
  if (Array.isArray(t)) return "[" + t.map((x) => ser(x, d + 1)).join(",") + "]";
  switch (t.$) {
    case "Ann": return ser(t.x, d + 1);
    case "Var": return "v" + t.i;
    case "Ref": return "R:" + t.k;
    case "Ctr": return t.k + "{" + t.x.map((x: any) => ser(x, d + 1)).join(",") + "}";
    case "Lit": return "L:" + JSON.stringify(t.v);
    case "App": return "(" + ser(t.f, d + 1) + " " + ser(t.x, d + 1) + ")";
    case "Lam": return "\\" + t.i + "->" + ser(typeof t.f === "function" ? t.f(Bend.Var(t.k, t.i)) : t.f, d + 1);
    case "Mat": return "M:" + t.k + "{" + ser(t.h, d + 1) + "|" + ser(t.m, d + 1) + "}";
    case "Efq": return "EFQ";
    default: return "$" + t.$;
  }
}
let n = 0; const vis = new WeakSet<object>();
function walk(t: any): void {
  if (t === null || typeof t !== "object") return;
  if (vis.has(t)) return; vis.add(t);
  if (t.$ === "Ann") return walk(t.x);
  if (t.$ === "Mat") {
    if (t.k === "SCon") { n++; if (n <= 8) console.log("SCon#" + n + " default: " + ser(t.m)); }
    walk(t.h); walk(t.m);
  }
}
walk(tld.e);
console.log("scon", n);

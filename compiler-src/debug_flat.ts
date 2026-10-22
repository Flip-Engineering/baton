import * as Bend from "./bend2/bend.ts";
const file = process.argv[2];
const book = Bend.book_nil();
const seen = new Map<string, string | null>();
await Bend.book_load(book, file, "", seen);
Bend.book_valid(book, 0);
const tld = book.tlds["dispatch"] as any;
const vis = new WeakSet<object>();
let apps = 0, shared = 0, ann = 0;
function walk(t: any, d = 0): void {
  if (t === null || typeof t !== "object" || d > 20000) return;
  if (vis.has(t)) return; vis.add(t);
  if (Array.isArray(t)) { t.forEach((x) => walk(x, d + 1)); return; }
  if (t.$ === "App") {
    apps++;
    const raw = t.f;
    let h = raw;
    while (h && h.$ === "Ann") h = h.x;
    if (h && h.$ === "Lam" && h.s !== undefined && (Bend as any).SHARES.has(h.s)) {
      shared++;
      if (raw.$ === "Ann") ann++;
      else if (shared < 8) console.log("RAW HEAD", h.k, "AppS", t.s && (Bend as any).SHARES.has(t.s));
    }
  }
  for (const k of ["x", "h", "m", "e", "v", "f", "T", "A", "B"]) {
    const v = t[k];
    if (typeof v === "function") continue;
    if (Array.isArray(v)) v.forEach((y) => walk(y, d + 1));
    else if (v && typeof v === "object") walk(v, d + 1);
  }
}
walk(tld.e);
console.log("apps", apps, "shared", shared, "ann", ann);

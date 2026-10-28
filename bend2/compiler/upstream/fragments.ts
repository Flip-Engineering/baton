import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { CodeUnit, Seg } from "./comp.ts";

export type Range = { file: string; offset: number; bytes: number; code_units: number; sha256: string };
export type Fragment = {
  directory: string; unit: string;
  segs: (Omit<Seg, "lines"> & { body: Range; lines: number })[];
  spins: { name: string; body: Range; signature: string; refs: Set<string>; cids: Map<string, number> }[];
  statics: { name: string; words: number; body: Range }[];
  tabs: { name: string; body: Range }[];
  clos: Set<string>; lend: Set<string>; bytes: number;
};

function* separated(parts: Iterable<string>, separator: string): Generator<string> {
  let first = true;
  for (const part of parts) {
    if (!first) yield separator;
    first = false;
    yield part;
  }
}

// Each accepted revision owns a directory. The solver releases the preceding
// revision after its readers finish; failed writes retain their partial files.
export class Fragments {
  constructor(readonly directory: string) { fs.mkdirSync(directory); }

  write(unit: CodeUnit): Fragment {
    const directory = fs.mkdtempSync(path.join(this.directory, "unit-"));
    const file = path.join(directory, "code"), fd = fs.openSync(file, "wx");
    let offset = 0;
    const write = (parts: Iterable<string>): Range => {
      const start = offset, hash = createHash("sha256");
      let code_units = 0;
      for (const part of parts) {
        fs.writeFileSync(fd, part);
        offset += Buffer.byteLength(part); code_units += part.length;
        hash.update(part);
      }
      return { file, offset: start, bytes: offset - start, code_units, sha256: hash.digest("hex") };
    };
    let fragment: Fragment;
    try {
      fragment = { directory, unit: unit.unit,
        segs: unit.segs.map(({ lines, ...seg }) => ({ ...seg, ret: { ks: seg.ret.ks, arms: null },
          body: write(separated(lines, "\n")), lines: lines.length })),
        spins: unit.spins.map(([name, source, refs, cids]) => ({ name, body: write([source]),
          signature: source.slice(0, source.indexOf("\n")).replace(/^(INLINE|FAR)\s+/, "")
            .replace(/\s*\{\s*$/, ""), refs, cids })),
        statics: [...unit.statics].map(([name, words]) => ({ name, words: words.length,
          body: write(separated(words, ", ")) })),
        tabs: [...unit.tabs].map(([row]) => ({ name: "TAB_" + createHash("sha256").update(row).digest("hex"),
          body: write([row]) })),
        clos: unit.clos, lend: unit.lend, bytes: offset };
    } finally { fs.closeSync(fd); }
    const metadata = { ...fragment,
      segs: fragment.segs.map(seg => ({ ...seg, refs: [...seg.refs], cids: [...seg.cids] })),
      spins: fragment.spins.map(spin => ({ ...spin, refs: [...spin.refs], cids: [...spin.cids] })),
      clos: [...fragment.clos], lend: [...fragment.lend] };
    fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify(metadata));
    return fragment;
  }

  static read(directory: string): Fragment {
    const data = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));
    return { ...data,
      segs: data.segs.map((seg: any) => ({ ...seg, refs: new Set<string>(seg.refs), cids: new Map<string, number>(seg.cids) })),
      spins: data.spins.map((spin: any) => ({ ...spin, refs: new Set<string>(spin.refs), cids: new Map<string, number>(spin.cids) })),
      clos: new Set(data.clos), lend: new Set(data.lend) };
  }

  static remove(fragment: Fragment): void { fs.rmSync(fragment.directory, { recursive: true }); }
}

export function* chunks(range: Range): Generator<string> {
  const fd = fs.openSync(range.file, "r"), buffer = Buffer.allocUnsafe(65536), decoder = new StringDecoder("utf8");
  const hash = createHash("sha256");
  let read = 0;
  try {
    while (read < range.bytes) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, range.bytes - read), range.offset + read);
      if (count === 0) throw new Error("Incomplete unit fragment: " + range.file);
      const data = buffer.subarray(0, count);
      hash.update(data); read += count;
      yield decoder.write(data);
    }
    const last = decoder.end();
    if (last) yield last;
    if (hash.digest("hex") !== range.sha256) throw new Error("Unit fragment changed: " + range.file);
  } finally { fs.closeSync(fd); }
}

export function equal(left: Range, right: Range): boolean {
  if (left.bytes !== right.bytes) return false;
  const a = fs.openSync(left.file, "r"), b = fs.openSync(right.file, "r");
  const x = Buffer.allocUnsafe(65536), y = Buffer.allocUnsafe(65536);
  let at = 0;
  try {
    while (at < left.bytes) {
      const count = Math.min(x.length, left.bytes - at);
      const nx = fs.readSync(a, x, 0, count, left.offset + at), ny = fs.readSync(b, y, 0, count, right.offset + at);
      if (nx !== count || ny !== count) throw new Error("Incomplete unit fragment comparison");
      if (!x.subarray(0, count).equals(y.subarray(0, count))) return false;
      at += count;
    }
    return true;
  } finally { fs.closeSync(a); fs.closeSync(b); }
}

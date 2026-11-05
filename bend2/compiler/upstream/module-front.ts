import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as Bend from "./bend.ts";
import { ModuleReader, ModuleWriter } from "./module-store.ts";

export type SourceModule = Bend.LoadedModule & { sha256: string; declarations: string[] };
type SyntaxRoot = { section: string; fields: string[]; semantic_sha256: string };
type RawDef = Omit<Bend.Def, "T" | "v"> & { T: SyntaxRoot; v: null };
type RawADT = Omit<Bend.ADT, "T" | "c"> & { T: SyntaxRoot;
  c: (Omit<Bend.Ctr, "T"> & { T: SyntaxRoot })[] };
type ParseHeader = { tlds: [string, RawDef | RawADT][]; order: string[];
  bodies: [string, SyntaxRoot][] };
type ParseManifest = { entry: string; first: number; modules: SourceModule[] };
export type SemanticRead = { kind: "type" | "body" | "constructor";
  name: string; module: string; semantic_sha256: string };

const digest = (source: string): string => createHash("sha256").update(source).digest("hex");

// Parse records keep the complete declaration order, including later law fills.
export async function parse_file(file: string, workspace: string, compiler: string): Promise<string> {
  const book = Bend.book_nil(), seen = new Map<string, string | null>();
  const modules: SourceModule[] = [];
  const first = await Bend.book_load(book, file, "", seen, undefined, (module, text) => {
    modules.push({ ...module, sha256: digest(text),
      declarations: book.order.slice(module.first, module.last) });
  });
  const writer = new ModuleWriter(compiler, workspace);
  try {
    const bodies: ParseHeader["bodies"] = [];
    // Raw parser callbacks perform substitution and beta reduction on each
    // invocation. Store one syntax root at a time before checking creates cells.
    const syntax = (section: string, value: Bend.HTerm): SyntaxRoot => {
      const term = Bend.term_lower(value);
      writer.write(section, term);
      return { section, fields: Object.keys(value), semantic_sha256: digest(Bend.term_key(term)) };
    };
    const tlds: ParseHeader["tlds"] = Object.entries(book.tlds).map(([name, tld]) => {
      if (tld.$ !== "Def") return [name, { ...tld, T: syntax("type:" + name, tld.T),
        c: tld.c.map((ctr, i) => ({ ...ctr, T: syntax("constructor:" + name + ":" + i, ctr.T) })) }];
      const { v, ...signature } = tld;
      if (v !== null) bodies.push([name, syntax("body:" + name, v)]);
      return [name, { ...signature, T: syntax("type:" + name, tld.T), v: null }];
    });
    const header: ParseHeader = { tlds, order: book.order, bodies };
    writer.write("header", header);
    const metadata: ParseManifest = { entry: fs.realpathSync(path.resolve(file)), first, modules };
    writer.seal(metadata);
    return writer.directory;
  } catch (error) { writer.remove(); throw error; }
}

// A checker owns these decoded values. Imported bodies are read when used by
// type computation; copying a declaration's fields leaves its body deferred.
export class ParsedProgram {
  readonly reader: ModuleReader;
  readonly manifest: ParseManifest;
  readonly book: Bend.Book;
  readonly reads: SemanticRead[] = [];
  private type_owners = new Map<string, string>();
  private body_owners = new Map<string, string>();
  private interfaces = new Map<string, string>();

  constructor(directory: string, compiler: string, observe?: (read: SemanticRead) => void) {
    this.reader = new ModuleReader(directory, compiler);
    this.manifest = this.reader.index.metadata as ParseManifest;
    const header = this.reader.read<ParseHeader>("header");
    this.book = Bend.book_nil();
    this.book.order = header.order;
    for (const module of this.manifest.modules) {
      for (const name of module.declarations) {
        if (!this.type_owners.has(name)) this.type_owners.set(name, module.file);
        this.body_owners.set(name, module.file);
      }
    }
    const deferred = (syntax: SyntaxRoot, kind: SemanticRead["kind"], name: string): Bend.HTerm => {
      const value = {} as Bend.HTerm;
      const materialize = (): void => {
        const owner = kind === "body" ? this.body_owners : this.type_owners;
        const read = { kind, name, module: owner.get(name)!, semantic_sha256: syntax.semantic_sha256 };
        this.reads.push(read); observe?.(read);
        const term = this.reader.read<Bend.LTerm>(syntax.section), body = Bend.term_higher(term);
        for (const field of syntax.fields) delete (value as any)[field];
        Object.defineProperties(value, Object.getOwnPropertyDescriptors(body));
      };
      for (const field of syntax.fields) Object.defineProperty(value, field, {
        configurable: true, enumerable: true,
        get: () => { materialize(); return (value as any)[field]; },
        set: assigned => { materialize(); (value as any)[field] = assigned; },
      });
      return value;
    };
    for (const [name, raw] of header.tlds) {
      this.interfaces.set(name, digest(JSON.stringify({ ...raw, T: raw.T.semantic_sha256,
        ...(raw.$ === "ADT" ? { c: raw.c.map(ctr => ({ ...ctr, T: ctr.T.semantic_sha256 })) } : {}) })));
      const tld: Bend.TLD = raw.$ === "Def" ? { ...raw, T: deferred(raw.T, "type", name) }
        : { ...raw, T: deferred(raw.T, "type", name),
          c: raw.c.map(ctr => ({ ...ctr, T: deferred(ctr.T, "constructor", name) })) };
      if (tld.$ === "ADT") for (const ctr of tld.c) this.book.ctrs[ctr.k] = ctr;
      this.book.tlds[name] = tld;
    }
    for (const [name, syntax] of header.bodies) {
      (this.book.tlds[name] as Bend.Def).v = deferred(syntax, "body", name);
    }
  }

  check(module: SourceModule): { book: Bend.Book; reads: SemanticRead[];
    prefix_interfaces: [string, string][]; module: SourceModule } {
    const prefix_interfaces = [...new Set(this.book.order.slice(0, module.first))]
      .map(name => [name, this.interfaces.get(name)!] as [string, string]);
    Bend.book_valid(this.book, module.first, module.last);
    return { book: this.book, reads: this.reads, prefix_interfaces, module };
  }
}

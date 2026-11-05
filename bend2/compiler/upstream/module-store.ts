import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as Store from "./store.ts";
import type { ExternalReference, TermGraph } from "./store.ts";

type Section = { file: string; sha256: string; bytes: number; nodes: number };
export type ModuleIndex = { format: "bend-module-sections-v1"; compiler: string;
  tables: Section; sections: [string, Section][]; metadata: unknown };

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

// Earlier immutable sections supply shared roots to later sections.
export class ModuleWriter {
  readonly directory: string;
  private tables = new Store.EncoderTables();
  private shared = new WeakMap<object, ExternalReference>();
  private sections = new Map<string, Section>();

  constructor(readonly compiler: string, workspace = os.tmpdir()) {
    this.directory = fs.mkdtempSync(path.join(workspace, "bend-module-"));
  }

  private file(bytes: string, nodes: number): Section {
    const sha256 = digest(bytes), file = sha256 + ".json", target = path.join(this.directory, file);
    if (fs.existsSync(target)) {
      if (fs.readFileSync(target, "utf8") !== bytes) throw new Error("Module section content differs: " + file);
    } else fs.writeFileSync(target, bytes, { flag: "wx" });
    return { file, sha256, bytes: Buffer.byteLength(bytes), nodes };
  }

  write(name: string, value: unknown): Section {
    if (this.sections.has(name)) throw new Error("Module section is already written: " + name);
    const graph = Store.encode_term(value as any, this.tables, {
      find: value => this.shared.get(value),
      define: (node, value) => this.shared.set(value, { section: name, node }),
    });
    const section = this.file(JSON.stringify(graph), graph.rows.length);
    this.sections.set(name, section);
    return section;
  }

  seal(metadata: unknown): ModuleIndex {
    const tables = this.file(JSON.stringify(this.tables.data), this.tables.data.spans.length);
    const index: ModuleIndex = { format: "bend-module-sections-v1", compiler: this.compiler,
      tables, sections: [...this.sections], metadata };
    fs.writeFileSync(path.join(this.directory, "index.json"), JSON.stringify(index), { flag: "wx" });
    return index;
  }

  remove(): void { fs.rmSync(this.directory, { recursive: true }); }
}

export class ModuleReader {
  readonly index: ModuleIndex;
  private tables: Store.DecoderTables;
  private sections: Map<string, Section>;
  private shared = new Map<string, Map<number, WeakRef<object>>>();

  constructor(readonly directory: string, compiler: string) {
    this.index = JSON.parse(fs.readFileSync(path.join(directory, "index.json"), "utf8"));
    if (this.index.format !== "bend-module-sections-v1" || this.index.compiler !== compiler) {
      throw new Error("Module store compiler or format differs");
    }
    this.sections = new Map(this.index.sections);
    this.tables = new Store.DecoderTables(this.file<Store.Tables>(this.index.tables));
  }

  private file<T>(section: Section): T {
    const bytes = fs.readFileSync(path.join(this.directory, section.file), "utf8");
    if (digest(bytes) !== section.sha256) throw new Error("Module store section changed: " + section.file);
    return JSON.parse(bytes) as T;
  }

  private node(reference: ExternalReference): unknown {
    const value = this.shared.get(reference.section)?.get(reference.node)?.deref();
    return value ?? this.decode(reference.section, reference.node);
  }

  private decode(name: string, node?: number): unknown {
    const section = this.sections.get(name);
    if (section === undefined) throw new Error("Module section is unavailable: " + name);
    const graph = this.file<TermGraph>(section);
    let shared = this.shared.get(name);
    if (shared === undefined) { shared = new Map(); this.shared.set(name, shared); }
    return Store.decode_term(graph, this.tables, {
      resolve: reference => this.node(reference),
      find: node => shared.get(node)?.deref(),
      define: (node, value) => shared.set(node, new WeakRef(value)),
    }, node === undefined ? graph.root : { node });
  }

  read<T>(name: string): T { return this.decode(name) as T; }
}

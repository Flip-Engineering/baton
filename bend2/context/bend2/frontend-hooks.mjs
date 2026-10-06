// Derived-frontend hook patch specification for the Bend2 frontend bridge.
//
// This module is the retained patch. It carries no frontend source and imports no frontend: it
// applies an ordered, anchored transformation to a caller-supplied copy of an upstream file and
// returns the derived text plus its digest. Each operation names an exact anchor that must occur
// exactly once; a missing or ambiguous anchor refuses that derivation instead of guessing.
//
// Upstream files stay intact. The derived copy is an owned artifact under this task, carrying the
// upstream identity below; nothing here writes to or modifies the upstream originals.
//
// Compatible upstream source set, retrieved read-only from the repository's documented pin
// a49524265bdfa5753a4bf38e25f0574a705dd868 (bendlang/bend), license Apache-2.0,
// HigherOrderCO 2026:
//   bend2/bend.ts   SHA256 93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85
//   bend2/main.ts   SHA256 92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e
//   bend2/comp.ts   SHA256 ad8b82137e5decf588d507d008cb8ccf24bd0b94043de8bd6e048d0faedcf959
//   bend2/base.bend SHA256 e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798
//   LICENSE         SHA256 0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35
//
// Anchors are the real statements in the pinned sources: the loader read (bend.ts 1057), the hub
// fetch guard (1030), the import-line blanking (1089) and the parse call (1097); the parse entry
// signature (2594) and its Parse record (2595); parse_def's name parse (2534) and qualified name
// (2538); the type (2618) and law (2655) branches of parse_book; parse_var's lookup/fallback body
// (1736-1744); parse_fail (1595-1596); the Err constructor (485-486); def_check (3769, 3786);
// book_valid (3860, 3944-3947); and main.ts book_read's PROOF/LAWS refusal (588), the gate
// composition (590-592) and the hole refusal (593-595).

import { createHash } from 'node:crypto';

export const UPSTREAM_PIN = 'a49524265bdfa5753a4bf38e25f0574a705dd868';
export const UPSTREAM_LICENSE = Object.freeze({ name: 'Apache-2.0', holder: 'HigherOrderCO 2026', sha256: '0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35' });

export const UPSTREAM_INPUTS = Object.freeze({
  bend: Object.freeze({ path: 'bend2/bend.ts', sha256: '93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85' }),
  main: Object.freeze({ path: 'bend2/main.ts', sha256: '92dcdb49e82fd59443e3aea10784f7dcf03a93f5a21920666543098b657b6b1e' }),
  comp: Object.freeze({ path: 'bend2/comp.ts', sha256: 'ad8b82137e5decf588d507d008cb8ccf24bd0b94043de8bd6e048d0faedcf959' }),
  base: Object.freeze({ path: 'bend2/base.bend', sha256: 'e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798' }),
});

// The registry, the emit helper and the hook-aware source read. Inserted before the Err
// constructor so that no hook name is in scope before its declaration is evaluated.
const REGISTRY = `// Bend2 frontend hook registry. Installed by an external bridge before the frontend is used.
// With no sink installed, or with a sink that declines, every path below is unchanged.
export type BendHookEvent = unknown;
export interface BendHookSink {
  emit(event: BendHookEvent): void;
  readSource?(file: string): string | undefined;
  resolveSource?(file: string): { exists: boolean; identity?: string } | undefined;
  sourceFailure?(file: string, reason: string): void;
  captureOnly?: boolean;
  baseBendPath?(): string | undefined;
}
let bendHookSink: BendHookSink | null = null;
export const bendHookState = { failures: 0, refusals: 0 };
export function bendHooks(sink: BendHookSink | null): void {
  bendHookSink = sink;
}
export function bendHookFailures(): number {
  return bendHookState.failures;
}
export function bendEmit(event: BendHookEvent): void {
  const sink = bendHookSink;
  if (sink === null) return;
  try {
    sink.emit(event);
  } catch {
    bendHookState.failures += 1;
  }
}
function bendHookResolve(file: string): { exists: boolean; identity: string; captured: boolean } {
  const sink = bendHookSink;
  if (sink !== null && typeof sink.resolveSource === "function") {
    const resolved = sink.resolveSource(file);
    if (resolved !== undefined && resolved !== null) {
      return { exists: resolved.exists === true, identity: resolved.identity === undefined ? file : resolved.identity, captured: true };
    }
  }
  return { exists: fs.existsSync(file), identity: file, captured: false };
}
function bendHookAcquisitionFailure(file: string, reason: string): void {
  const sink = bendHookSink;
  if (sink !== null && typeof sink.sourceFailure === "function") {
    try {
      sink.sourceFailure(file, reason);
    } catch {
      bendHookState.failures += 1;
    }
  }
}
function bendHookSource(book: Book, file: string, spn?: Span): string {
  const sink = bendHookSink;
  const resolved = bendHookResolve(file);
  if (sink !== null && typeof sink.readSource === "function" && (resolved.captured || sink.captureOnly !== true)) {
    const provided = sink.readSource(resolved.identity);
    if (typeof provided === "string") return provided;
    if (resolved.captured) {
      bendHookAcquisitionFailure(file, "readUnavailable");
      bendHookState.refusals += 1;
      throw Err(book, ctx_nil(), "no such file: " + file, undefined, spn);
    }
  }
  if (sink !== null && sink.captureOnly === true) {
    bendHookAcquisitionFailure(file, "notInClosure");
    bendHookState.refusals += 1;
    throw Err(book, ctx_nil(), "no such file: " + file, undefined, spn);
  }
  return fs.readFileSync(resolved.identity, "utf8");
}
`;

export const HOOK_OPERATIONS = Object.freeze({
  bend: Object.freeze([
    Object.freeze({
      id: 'bend.registry',
      summary: 'hook registry, emit helper and hook-aware source read',
      anchor: 'export function Err(bok: Book, ctx: Ctx, exp: Expr, obs?: Expr, spn?: Span, def?: Name, nte?: string): Err {',
      replacement: `${REGISTRY}export function Err(bok: Book, ctx: Ctx, exp: Expr, obs?: Expr, spn?: Span, def?: Name, nte?: string): Err {`,
    }),
    Object.freeze({
      id: 'bend.loaderHostInput',
      summary: 'captured closure supplies existence, identity and bytes; failures are reported distinctly',
      anchor: '  if (!fs.existsSync(file)) {\n    throw Err(book, ctx_nil(), "no such file: " + file, undefined, spn);\n  }\n  const real = fs.realpathSync(file);',
      replacement: '  const bendResolved = bendHookResolve(file);\n  bendEmit({ kind: "importAttempt", phase: "load", file, identity: bendResolved.identity, exists: bendResolved.exists, captured: bendResolved.captured });\n  if (!bendResolved.exists) {\n    if (bendResolved.captured) bendHookAcquisitionFailure(file, "missingInClosure");\n    throw Err(book, ctx_nil(), "no such file: " + file, undefined, spn);\n  }\n  const real = bendResolved.captured ? bendResolved.identity : fs.realpathSync(file);',
    }),
    Object.freeze({
      id: 'bend.hubGuard',
      summary: 'refuse the hub fetch path in capture-only mode',
      anchor: '  if (file.startsWith(BEND_LIB + "/") && !fs.existsSync(file)) {',
      replacement: '  if (file.startsWith(BEND_LIB + "/") && !fs.existsSync(file)) {\n    if (bendHookSink !== null && bendHookSink.captureOnly === true) {\n      bendHookState.refusals += 1;\n      throw Err(book, ctx_nil(), "no such file: " + file, undefined, spn);\n    }',
    }),
    Object.freeze({
      id: 'bend.importSyntaxDiagnostics',
      summary: 'emit the import-form and suffix diagnostics at their own throw sites',
      anchor: '      if (h === null || (h[2] === undefined && h[1] !== "Base")) {\n        throw Err(book, ctx_nil(), "an import (\'import Base\', or \'import <path> as <Name>\')", "\'" + line + "\'", sp);\n      }',
      replacement: '      if (h === null || (h[2] === undefined && h[1] !== "Base")) {\n        bendEmit({ kind: "diagnostic", phase: "load", form: "err", file, condition: "an import (\'import Base\', or \'import <path> as <Name>\')", observed: "\'" + line + "\'", definition: null, note: null, span: sp });\n        throw Err(book, ctx_nil(), "an import (\'import Base\', or \'import <path> as <Name>\')", "\'" + line + "\'", sp);\n      }',
    }),
    Object.freeze({
      id: 'bend.suffixDiagnostic',
      summary: 'emit the non-.bend import diagnostic',
      anchor: '          throw Err(book, ctx_nil(), "an import of a .bend file", "\'" + h[1] + "\'", sp);',
      replacement: '          bendEmit({ kind: "diagnostic", phase: "load", form: "err", file, condition: "an import of a .bend file", observed: "\'" + h[1] + "\'", definition: null, note: null, span: sp });\n          throw Err(book, ctx_nil(), "an import of a .bend file", "\'" + h[1] + "\'", sp);',
    }),
    Object.freeze({
      id: 'bend.cycleAndNamespaceDiagnostics',
      summary: 'emit the cycle and namespace diagnostics',
      anchor: '  const done = seen.get(real);\n  if (done === null) {\n    throw Err(book, ctx_nil(), "an import cycle through " + file, undefined, spn);\n  }\n  if (done !== undefined) {\n    if (done !== ns) {\n      throw Err(book, ctx_nil(), "one namespace per file (" + file + " is both \'" + done + "\' and \'" + ns + "\')", undefined, spn);\n    }\n    return book.order.length;\n  }',
      replacement: '  const done = seen.get(real);\n  if (done === null) {\n    bendEmit({ kind: "diagnostic", phase: "load", form: "err", file, condition: "an import cycle through " + file, observed: null, definition: null, note: null, span: spn === undefined ? null : spn });\n    throw Err(book, ctx_nil(), "an import cycle through " + file, undefined, spn);\n  }\n  if (done !== undefined) {\n    if (done !== ns) {\n      bendEmit({ kind: "diagnostic", phase: "load", form: "err", file, condition: "one namespace per file", observed: ns, definition: null, note: "already bound as " + done, span: spn === undefined ? null : spn });\n      throw Err(book, ctx_nil(), "one namespace per file (" + file + " is both \'" + done + "\' and \'" + ns + "\')", undefined, spn);\n    }\n    return book.order.length;\n  }',
    }),
    Object.freeze({
      id: 'bend.lazyBase',
      summary: 'resolve base.bend lazily through the sink instead of at module load',
      anchor: 'export const BASE_BEND = fs.realpathSync(path.join(BEND_DIR, "base.bend"));',
      replacement: 'export let BASE_BEND = "";\nexport function base_bend(): string {\n  if (BASE_BEND === "") {\n    const sink = bendHookSink;\n    if (sink !== null && typeof sink.baseBendPath === "function") {\n      const provided = sink.baseBendPath();\n      if (typeof provided === "string" && provided.length > 0) {\n        BASE_BEND = provided;\n        return BASE_BEND;\n      }\n    }\n    BASE_BEND = fs.realpathSync(path.join(BEND_DIR, "base.bend"));\n  }\n  return BASE_BEND;\n}',
    }),
    Object.freeze({
      id: 'bend.baseImportUse',
      summary: 'load Base through the lazy accessor',
      anchor: '        await book_load(book, BASE_BEND, "", seen, sp);',
      replacement: '        await book_load(book, base_bend(), "", seen, sp);',
    }),
    Object.freeze({
      id: 'bend.baseMarkUse',
      summary: 'compare against the lazily resolved base path',
      anchor: '  if (real === BASE_BEND) {',
      replacement: '  if (real === base_bend()) {',
    }),
    Object.freeze({
      id: 'bend.sourceRead',
      summary: 'source capture where the loader consumes input',
      anchor: '  const text  = fs.readFileSync(file, "utf8");',
      replacement: '  bendEmit({ kind: "loadStart", phase: "load", file, namespace: ns });\n  const text  = bendHookSource(book, file, spn);',
    }),
    Object.freeze({
      id: 'bend.importLine',
      summary: 'emit the exact removed-import transformation before blanking',
      anchor: '      lines[i] = "";',
      replacement: '      bendEmit({ kind: "importLine", phase: "load", file, namespace: ns, alias: h === null ? null : h[2] === undefined ? null : h[2], specifier: h === null ? null : h[1], removedFrom: bendLineStart, removedTo: bendLineStart + lines[i].length, removedText: lines[i], specifierSpan: sp });\n      lines[i] = "";',
    }),
    Object.freeze({
      id: 'bend.importLineStart',
      summary: 'the line-content start the removed range is measured from',
      anchor: '      const beg = text.split("\\n", i).join("\\n").length + (i && 1) + lines[i].indexOf(h === null ? line : h[1]);',
      replacement: '      const bendLineStart = text.split("\\n", i).join("\\n").length + (i && 1);\n      const beg = bendLineStart + lines[i].indexOf(h === null ? line : h[1]);',
    }),
    Object.freeze({
      id: 'bend.parseCall',
      summary: 'emit the alias table and the load completion, and tag the parse with its file',
      anchor: '  parse_book(book, dir, lines.join("\\n"), ns, al);',
      replacement: '  bendEmit({ kind: "importAliases", phase: "load", file, namespace: ns, aliases: { ...al } });\n  parse_book(book, dir, lines.join("\\n"), ns, al, file);\n  bendEmit({ kind: "loadComplete", phase: "load", file, namespace: ns, orderLength: book.order.length });',
    }),
    Object.freeze({
      id: 'bend.parseType',
      summary: 'carry the file identity on the Parse record',
      anchor: 'export type Parse = { book: Book; dir: string; str: string; pos: Loc; sc: Scope; ns: string; al: Record<Name, Name>; };',
      replacement: 'export type Parse = { book: Book; dir: string; str: string; pos: Loc; sc: Scope; ns: string; al: Record<Name, Name>; bf?: string; };',
    }),
    Object.freeze({
      id: 'bend.parseBookSignature',
      summary: 'accept the file identity in parse_book',
      anchor: 'export function parse_book(book: Book, dir: string, src: string, ns: string = "", al: Record<Name, Name> = Object.create(null)): Book {',
      replacement: 'export function parse_book(book: Book, dir: string, src: string, ns: string = "", al: Record<Name, Name> = Object.create(null), bf?: string): Book {',
    }),
    Object.freeze({
      id: 'bend.parseRecord',
      summary: 'set the file identity on the Parse record',
      anchor: '  const p: Parse = { book, dir, str: src, pos: 0, sc: { stk: [], frs: 0 }, ns, al };',
      replacement: '  const p: Parse = { book, dir, str: src, pos: 0, sc: { stk: [], frs: 0 }, ns, al, bf };',
    }),
    Object.freeze({
      id: 'bend.declarationBeg',
      summary: 'record the declaration start position in parse_def',
      anchor: '  parse_word(p, "def");\n  const nm  = parse_name(p);',
      replacement: '  parse_word(p, "def");\n  const bendDeclBeg = p.pos;\n  const nm  = parse_name(p);',
    }),
    Object.freeze({
      id: 'bend.declarationDef',
      summary: 'emit the def or law-fill declaration event',
      anchor: '  const k   = law ? q : parse_qual(p, nm);',
      replacement: '  const k   = law ? q : parse_qual(p, nm);\n  bendEmit({ kind: "declaration", phase: "parse", form: law ? "fill" : "def", file: p.bf === undefined ? null : p.bf, name: nm, qualified: k, namespace: p.ns, unsafe: u === true, span: parse_span(p, bendDeclBeg) });',
    }),
    Object.freeze({
      id: 'bend.declarationType',
      summary: 'emit the type declaration event',
      anchor: '    if (parse_at_word(p, "type")) {\n      parse_word(p, "type");\n      const k = parse_qual(p, parse_name(p));',
      replacement: '    if (parse_at_word(p, "type")) {\n      const bendDeclBeg = p.pos;\n      parse_word(p, "type");\n      const k = parse_qual(p, parse_name(p));\n      bendEmit({ kind: "declaration", phase: "parse", form: "type", file: p.bf === undefined ? null : p.bf, name: k, qualified: k, namespace: p.ns, unsafe: false, span: parse_span(p, bendDeclBeg) });',
    }),
    Object.freeze({
      id: 'bend.declarationLaw',
      summary: 'emit the law declaration event',
      anchor: '    if (parse_at_word(p, "law")) {\n      parse_word(p, "law");\n      const k = parse_qual(p, parse_name(p));',
      replacement: '    if (parse_at_word(p, "law")) {\n      const bendDeclBeg = p.pos;\n      parse_word(p, "law");\n      const k = parse_qual(p, parse_name(p));\n      bendEmit({ kind: "declaration", phase: "parse", form: "law", file: p.bf === undefined ? null : p.bf, name: k, qualified: k, namespace: p.ns, unsafe: false, span: parse_span(p, bendDeclBeg) });',
    }),
    Object.freeze({
      id: 'bend.reference',
      summary: 'emit each parsed reference with its actual lookup or fallback branch',
      anchor: '  const e = parse_lookup(p, k);\n  if (e !== null) {\n    return Var(k, e[1], s);\n  }\n  const q = parse_reso(p, k);\n  if (k.includes(".")) {\n    return Ref(q, s);\n  }\n  return Var(k, p.sc.frs++, s, Ref(q, s));',
      replacement: '  const e = parse_lookup(p, k);\n  const bendFile = p.bf === undefined ? null : p.bf;\n  if (e !== null) {\n    bendEmit({ kind: "reference", phase: "parse", file: bendFile, name: k, branch: "bound", binderIndex: e[1], qualified: null, declared: null, namespace: p.ns, span: s === undefined ? null : s });\n    return Var(k, e[1], s);\n  }\n  const q = parse_reso(p, k);\n  if (k.includes(".")) {\n    bendEmit({ kind: "reference", phase: "parse", file: bendFile, name: k, branch: "dotted", qualified: q, declared: q in p.book.tlds || q in p.book.ctrs, namespace: p.ns, span: s === undefined ? null : s });\n    return Ref(q, s);\n  }\n  bendEmit({ kind: "reference", phase: "parse", file: bendFile, name: k, branch: "unboundFallback", frameIndex: p.sc.frs, qualified: q, declared: q in p.book.tlds || q in p.book.ctrs, namespace: p.ns, span: s === undefined ? null : s });\n  return Var(k, p.sc.frs++, s, Ref(q, s));',
    }),
    Object.freeze({
      id: 'bend.parseFail',
      summary: 'emit the parse diagnostic before the original throw',
      anchor: '  const obs = p.pos < p.str.length ? "\'" + p.str[p.pos] + "\'" : "end of input";\n  throw Err(p.book, ctx_nil(), exp, obs, { src: p.str, beg: p.pos, end: p.pos });',
      replacement: '  const obs = p.pos < p.str.length ? "\'" + p.str[p.pos] + "\'" : "end of input";\n  bendEmit({ kind: "diagnostic", phase: "parse", form: "err", file: p.bf === undefined ? null : p.bf, condition: exp, observed: obs, definition: null, note: null, span: { src: p.str, beg: p.pos, end: p.pos } });\n  throw Err(p.book, ctx_nil(), exp, obs, { src: p.str, beg: p.pos, end: p.pos });',
    }),
    Object.freeze({
      id: 'bend.checkEntry',
      summary: 'emit the checker entry for one definition',
      anchor: 'export function def_check(book: Book, k: Name, def: Def, z?: number): LTerm {',
      replacement: 'export function def_check(book: Book, k: Name, def: Def, z?: number): LTerm {\n  bendEmit({ kind: "checkEntry", phase: "check", definition: k });',
    }),
    Object.freeze({
      id: 'bend.checkPreRegion',
      summary: 'observe failures before the final term_check as well',
      anchor: '  const qs = tele_unbind(book, def.T).doms.map((dom) => dom[0]);\n  const gen = def.x === 0 ? book : { ...book, tlds: Object.create(book.tlds) };\n  let [t, v, T]: HTerm[] = [Ref(k), def.v as HTerm, def.T];\n  for (let j = 0; j < def.x; j++) {\n    const h = tele_head(gen, T, ctx_nil(), k);\n    const o = k + "~" + h.k;\n    if (o in gen.tlds) {\n      throw Err(book, ctx_nil(), "a fresh ~ binder name", h.k, h.s);\n    }\n    gen.tlds[o] = { $: "Def", n: 0, x: 0, T: h.A, v: null, b: true };\n    t = App(t, Ref(o));\n    v = term_apply(v, Ref(o));\n    T = h.B(Ref(o));\n  }',
      replacement: '  let qs: Quant[] = [];\n  let gen: Book = book;\n  let t: HTerm = Ref(k);\n  let v: HTerm = def.v as HTerm;\n  let T: HTerm = def.T;\n  try {\n    qs = tele_unbind(book, def.T).doms.map((dom) => dom[0]);\n    gen = def.x === 0 ? book : { ...book, tlds: Object.create(book.tlds) };\n    [t, v, T] = [Ref(k), def.v as HTerm, def.T];\n    for (let j = 0; j < def.x; j++) {\n      const h = tele_head(gen, T, ctx_nil(), k);\n      const o = k + "~" + h.k;\n      if (o in gen.tlds) {\n        throw Err(book, ctx_nil(), "a fresh ~ binder name", h.k, h.s);\n      }\n      gen.tlds[o] = { $: "Def", n: 0, x: 0, T: h.A, v: null, b: true };\n      t = App(t, Ref(o));\n      v = term_apply(v, Ref(o));\n      T = h.B(Ref(o));\n    }\n  } catch (bendTemplate) {\n    bendEmit({ kind: "checkFailure", phase: "check", definition: k, thrownDiagnostic: bendTemplate !== null && typeof bendTemplate === "object" && (bendTemplate as { $?: string }).$ === "Err" });\n    bendEmit({ kind: "diagnostic", phase: "check", form: "thrown", file: null, definition: k, span: null, thrownKind: bendTemplate !== null && typeof bendTemplate === "object" && (bendTemplate as { $?: string }).$ === "Err" ? "Err" : "Error", raw: bendTemplate !== null && typeof bendTemplate === "object" && (bendTemplate as { $?: string }).$ === "Err" ? err_show(bendTemplate as Err) : String(bendTemplate), text: null });\n    throw bendTemplate;\n  }',
    }),
    Object.freeze({
      id: 'bend.checkOutcome',
      summary: 'emit checker success or failure around the original check, preserving the throw',
      anchor: '  return term_check(gen, { t, n: def.n - def.x, def: k, qs, u: def.u, z }, v, Lone(), T, ctx_nil(), 0).tm;',
      replacement: '  try {\n    const bendChecked = term_check(gen, { t, n: def.n - def.x, def: k, qs, u: def.u, z }, v, Lone(), T, ctx_nil(), 0).tm;\n    bendEmit({ kind: "checkSuccess", phase: "check", definition: k });\n    return bendChecked;\n  } catch (bendError) {\n    bendEmit({ kind: "checkFailure", phase: "check", definition: k, thrownDiagnostic: bendError !== null && typeof bendError === "object" && (bendError as { $?: string }).$ === "Err" });\n    throw bendError;\n  }',
    }),
    Object.freeze({
      id: 'bend.validStart',
      summary: 'emit the whole-book validation start without touching its mutation',
      anchor: 'export function book_valid(book: Book, done: number = 0): void {\n  const tlds = book.tlds;',
      replacement: 'export function book_valid(book: Book, done: number = 0): void {\n  bendEmit({ kind: "validationStart", phase: "validate", done });\n  const tlds = book.tlds;',
    }),
    Object.freeze({
      id: 'bend.validResult',
      summary: 'emit a successful validation result at the function exit',
      anchor: '    if (def.v !== null) {\n      def.e = def_check(book, k, def);\n    }\n    book.tlds[k] = def;\n  }\n}',
      replacement: '    if (def.v !== null) {\n      def.e = def_check(book, k, def);\n    }\n    book.tlds[k] = def;\n  }\n  bendEmit({ kind: "validationResult", phase: "validate", success: true });\n}',
    }),
  ]),
  main: Object.freeze([
    Object.freeze({
      id: 'main.emitHelper',
      summary: 'forward main-side events through the kernel sink',
      anchor: 'async function book_read(file: string, base?: Bend.Book,',
      replacement: 'function bendEmitMain(event: Bend.BendHookEvent): void {\n  Bend.bendEmit(event);\n}\n\nasync function book_read(file: string, base?: Bend.Book,',
    }),
    Object.freeze({
      id: 'main.proofLawsRule',
      summary: 'emit the conditional PROOF/LAWS refusal before the original failure',
      anchor: '    cli_fail("PROOF.bend must import ./LAWS.bend");',
      replacement: '    bendEmitMain({ kind: "completionGate", phase: "completion", gate: "proofLawsRule", started: true, completed: false });\n    cli_fail("PROOF.bend must import ./LAWS.bend");',
    }),
    Object.freeze({
      id: 'main.baseAccessor',
      summary: 'resolve the base path through the lazy accessor instead of at import time',
      anchor: 'const BASE = Bend.BASE_BEND;',
      replacement: 'const BASE = Bend.base_bend();',
    }),
    Object.freeze({
      id: 'main.completionBoundary',
      summary: 'gates, the original hole refusal and a boundary catch that keeps the real thrown value',
      anchor: '  Bend.book_valid(book, base?.order.length ?? 0);\n  Comp.book_owned(book, Comp.SYNTH);\n  const hols = book.hols + book.open;\n  if (hols > 0) {\n    throw "Error: " + String(hols) + " TODO" + (hols === 1 ? "" : "s")\n      + " found.\\nThe code is incomplete, and not a valid proof yet.";\n  }',
      replacement: '  try {\n    Bend.book_valid(book, base?.order.length ?? 0);\n    bendEmitMain({ kind: "completionGate", phase: "completion", gate: "ownership", checkSet: "SYNTH", started: true });\n    Comp.book_owned(book, Comp.SYNTH);\n    bendEmitMain({ kind: "completionGate", phase: "completion", gate: "ownership", checkSet: "SYNTH", completed: true });\n    const hols = book.hols + book.open;\n    if (hols > 0) {\n      const bendText = "Error: " + String(hols) + " TODO" + (hols === 1 ? "" : "s")\n        + " found.\\nThe code is incomplete, and not a valid proof yet.";\n      bendEmitMain({ kind: "diagnostic", phase: "completion", form: "thrown", file: null, text: bendText, raw: bendText, thrownKind: "string", definition: null, span: null, holes: book.hols, open: book.open });\n      throw bendText;\n    }\n    bendEmitMain({ kind: "completionGate", phase: "completion", gate: "holes", started: true, completed: true });\n  } catch (bendThrown) {\n    const bendKind = typeof bendThrown === "string" ? "string" : bendThrown !== null && typeof bendThrown === "object" && (bendThrown as { $?: string }).$ === "Err" ? "Err" : "Error";\n    bendEmitMain({ kind: "diagnostic", phase: "completion", form: "thrown", file: null, raw: bendKind === "Err" ? Bend.err_show(bendThrown as Bend.Err) : String(bendThrown), text: null, thrownKind: bendKind, definition: typeof bendThrown === "string" ? null : null, span: null });\n    throw bendThrown;\n  }',
    }),
  ]),
});

function counts(text, needle) {
  let found = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    found += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return found;
}

// Preflight: report how many times each anchor of a target occurs in the supplied text.
export function verifyHookAnchors({ target, text } = {}) {
  const operations = HOOK_OPERATIONS[target];
  if (operations === undefined) return Object.freeze({ status: 'unavailable', reason: 'targetUnsupported', detail: String(target) });
  if (typeof text !== 'string') return Object.freeze({ status: 'unavailable', reason: 'textMissing' });
  return Object.freeze({
    status: 'checked',
    target,
    counts: Object.freeze(operations.map((operation) => Object.freeze({ id: operation.id, count: counts(text, operation.anchor) }))),
  });
}

// Anchor mechanics only: apply the ordered operations to arbitrary text. Exported so a test can
// exercise missing and ambiguous anchors without a pinned input; deriveHookedSource is the entry
// that enforces the input identity first.
export function applyHookOperations({ target, text } = {}) {
  const operations = HOOK_OPERATIONS[target];
  if (operations === undefined) return Object.freeze({ status: 'unavailable', reason: 'targetUnsupported', detail: String(target) });
  if (typeof text !== 'string') return Object.freeze({ status: 'unavailable', reason: 'textMissing' });
  let derived = text;
  const applied = [];
  for (const operation of operations) {
    const found = counts(derived, operation.anchor);
    if (found !== 1) {
      return Object.freeze({
        status: 'unavailable',
        reason: found === 0 ? 'anchorMissing' : 'anchorAmbiguous',
        detail: Object.freeze({ id: operation.id, count: found }),
      });
    }
    derived = derived.replace(operation.anchor, operation.replacement);
    applied.push(operation.id);
  }
  return Object.freeze({
    status: 'applied',
    target,
    operations: Object.freeze(applied),
    inputLength: text.length,
    outputLength: derived.length,
    outputDigest: createHash('sha256').update(Buffer.from(derived, 'utf8')).digest('hex'),
    text: derived,
  });
}

// Apply the anchored transformation to an input that must hash to the pinned upstream digest for
// its target: an alteration outside the anchors would otherwise be accepted under the original pin.
export function deriveHookedSource({ target, text } = {}) {
  const operations = HOOK_OPERATIONS[target];
  if (operations === undefined) return Object.freeze({ status: 'unavailable', reason: 'targetUnsupported', detail: String(target) });
  if (typeof text !== 'string') return Object.freeze({ status: 'unavailable', reason: 'textMissing' });
  const inputDigest = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  const expected = UPSTREAM_INPUTS[target].sha256;
  if (inputDigest !== expected) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'inputIdentityMismatch',
      detail: Object.freeze({ target, expected, observed: inputDigest, expectedPath: UPSTREAM_INPUTS[target].path }),
    });
  }
  const applied = applyHookOperations({ target, text });
  if (applied.status !== 'applied') return applied;
  return Object.freeze({
    status: 'derived',
    target,
    upstream: UPSTREAM_INPUTS[target],
    upstreamPin: UPSTREAM_PIN,
    inputDigest,
    inputLength: applied.inputLength,
    operations: applied.operations,
    outputLength: applied.outputLength,
    outputDigest: applied.outputDigest,
    text: applied.text,
  });
}

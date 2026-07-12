import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Lang, parse } from '@ast-grep/napi';

const require = createRequire(import.meta.url);
const AST_GREP_VERSION = require('@ast-grep/napi/package.json').version;
const EXTRACTOR_VERSION = `atlas-index-v1+ast-grep-${AST_GREP_VERSION}`;
const LANGUAGE = Object.freeze({
  '.js': ['javascript', Lang.JavaScript], '.mjs': ['javascript', Lang.JavaScript],
  '.cjs': ['javascript', Lang.JavaScript], '.jsx': ['javascript', Lang.JavaScript],
  '.ts': ['typescript', Lang.TypeScript], '.mts': ['typescript', Lang.TypeScript],
  '.cts': ['typescript', Lang.TypeScript], '.tsx': ['tsx', Lang.Tsx],
  '.html': ['html', Lang.Html], '.htm': ['html', Lang.Html], '.css': ['css', Lang.Css],
});
const IGNORE_DIRS = new Set(['.git', '.baton', 'node_modules']);
function readSourceBounded(path, ceiling) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > ceiling) return null;
    const bytes = Buffer.alloc(stat.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) break; offset += count; }
    if (offset !== bytes.length || readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw typed('Atlas source changed during bounded read', 'source_changed');
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}
const DEF_KINDS = new Map([
  ['function_declaration', 'function'], ['generator_function_declaration', 'function'],
  ['class_declaration', 'class'], ['method_definition', 'method'],
  ['interface_declaration', 'interface'], ['type_alias_declaration', 'type'],
  ['enum_declaration', 'enum'], ['namespace_declaration', 'namespace'],
  ['lexical_declaration', 'variable'], ['variable_declaration', 'variable'],
]);

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function slash(path) { return path.split(sep).join('/'); }
function typed(message, code) { return Object.assign(new Error(message), { code }); }
function ensureRoot(root) {
  if (typeof root !== 'string' || root.length === 0) throw typed('Atlas root required', 'invalid_root');
  const real = realpathSync(root);
  if (!lstatSync(real).isDirectory()) throw typed('Atlas root must be a directory', 'invalid_root');
  return real;
}
function checkAbort(ctx) { if (ctx?.signal?.aborted) throw typed('Atlas operation cancelled', 'cancelled'); }
function range(node) {
  const r = node.range();
  return { start: { line: r.start.line + 1, column: r.start.column + 1 }, end: { line: r.end.line + 1, column: r.end.column + 1 } };
}
function scipRange(r) { return [r.start.line - 1, r.start.column - 1, r.end.line - 1, r.end.column - 1]; }
function firstNameNode(node) {
  try { const named = node.field('name'); if (named) return named; } catch { /* grammar has no name field */ }
  const wanted = new Set(['identifier', 'property_identifier', 'type_identifier']);
  const queue = [...node.children()];
  while (queue.length) {
    const candidate = queue.shift();
    if (wanted.has(candidate.kind())) return candidate;
    queue.push(...candidate.children());
  }
  return null;
}
function symbolString(path, containers, name, kind) {
  const descriptor = [...containers, `${name}${['function', 'method'].includes(kind) ? '()' : kind === 'class' ? '#' : '.'}`]
    .map((part) => encodeURIComponent(part)).join('/');
  return `scip-baton npm workspace 0 ${encodeURIComponent(path)}/${descriptor}`;
}
function lastIdentifier(text) { return text.match(/[A-Za-z_$][\w$]*\s*$/)?.[0]?.trim() ?? text; }

function extractFile(path, bytes, langName, lang) {
  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  const definitions = []; const occurrences = []; const calls = []; const imports = []; const errors = [];
  const root = parse(lang, text).root();
  function visit(node, containers = [], caller = null, definitionName = false) {
    if (node.kind() === 'ERROR') errors.push(range(node));
    const defKind = DEF_KINDS.get(node.kind());
    const nameNode = defKind ? firstNameNode(node) : null;
    const name = nameNode?.text() ?? null;
    let nextCaller = caller; let nextContainers = containers;
    if (defKind && name) {
      const symbol = symbolString(path, containers, name, defKind);
      const definition = { symbol, name, kind: defKind, container: containers.join('::') || null, path, range: range(nameNode), extent: range(node) };
      definitions.push(definition);
      occurrences.push({ symbol, name, role: 'definition', path, range: definition.range });
      if (['function', 'method'].includes(defKind)) nextCaller = symbol;
      if (['class', 'interface', 'namespace'].includes(defKind)) nextContainers = [...containers, name];
    }
    if (node.kind() === 'import_statement') {
      const source = node.text().match(/\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/)?.slice(1).find(Boolean);
      if (source) imports.push({ path, source, range: range(node) });
    }
    if (node.kind() === 'call_expression') {
      let fn = null;
      try { fn = node.field('function') ?? node.field('callee'); } catch { /* grammar variance */ }
      fn ??= node.children().find((child) => child.isNamed());
      if (fn) calls.push({ path, caller, calleeName: lastIdentifier(fn.text()), calleeText: fn.text(), range: range(fn), resolved: null, candidates: [] });
    }
    const identifier = ['identifier', 'type_identifier'].includes(node.kind());
    if (identifier && !definitionName) occurrences.push({ symbol: null, name: node.text(), role: 'reference', path, range: range(node) });
    for (const child of node.children()) if (child.isNamed()) {
      const isName = nameNode && child.range().start.index === nameNode.range().start.index && child.range().end.index === nameNode.range().end.index;
      visit(child, nextContainers, nextCaller, isName);
    }
  }
  visit(root);
  definitions.sort((a, b) => a.symbol.localeCompare(b.symbol));
  occurrences.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column || a.name.localeCompare(b.name));
  calls.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column);
  imports.sort((a, b) => a.source.localeCompare(b.source));
  return { path, digest: sha(bytes), bytes: bytes.length, language: langName, lineCount: lines.length, lines, definitions, occurrences, calls, imports, parseErrors: errors };
}

function scan(root, opts, ctx) {
  const files = [];
  function walk(dir, prefix = '') {
    checkAbort(ctx);
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      checkAbort(ctx);
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (!IGNORE_DIRS.has(entry.name)) walk(full, rel); continue; }
      if (!entry.isFile()) continue;
      const language = LANGUAGE[extname(entry.name).toLowerCase()];
      if (!language) continue;
      const bytes = readSourceBounded(full, opts.maxSourceBytes);
      if (bytes === null || bytes.includes(0)) continue;
      files.push(extractFile(slash(rel), bytes, ...language));
      if (files.length > opts.maxFiles) throw typed(`Atlas file ceiling ${opts.maxFiles} exceeded`, 'index_too_large');
    }
  }
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveGraph(files) {
  const byName = new Map();
  for (const file of files) for (const definition of file.definitions) {
    const list = byName.get(definition.name) ?? []; list.push(definition); byName.set(definition.name, list);
  }
  for (const list of byName.values()) list.sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const file of files) {
    for (const occurrence of file.occurrences) if (occurrence.role === 'reference') {
      const candidates = byName.get(occurrence.name) ?? [];
      occurrence.symbol = candidates.length === 1 ? candidates[0].symbol : null;
      occurrence.candidates = candidates.map((item) => item.symbol);
    }
    for (const call of file.calls) {
      const candidates = byName.get(call.calleeName) ?? [];
      call.resolved = candidates.length === 1 ? candidates[0].symbol : null;
      call.candidates = candidates.map((item) => item.symbol);
    }
  }
  return files;
}

function baseRecord(files) {
  const resolved = resolveGraph(files);
  const inputs = resolved.map((file) => ({ path: file.path, digest: file.digest }));
  // The epoch commits to derived symbols/occurrences/calls as well as source inputs. A valid JSON
  // file cannot preserve an epoch while silently changing the index projection.
  const epoch = sha(stable({ extractor: EXTRACTOR_VERSION, files: resolved }));
  return { schemaVersion: 1, extractor: EXTRACTOR_VERSION, epoch, files: resolved, inputs };
}
function overlay(base, worktreeRoot, opts, ctx) {
  if (!worktreeRoot) return { files: structuredClone(base.files), applied: false, digest: null, changed: [], added: [], deleted: [] };
  const scanned = scan(ensureRoot(worktreeRoot), opts, ctx);
  const baseMap = new Map(base.files.map((file) => [file.path, file]));
  const workMap = new Map(scanned.map((file) => [file.path, file]));
  const changed = []; const added = []; const deleted = [];
  for (const [path, file] of workMap) {
    if (!baseMap.has(path)) added.push(path);
    else if (baseMap.get(path).digest !== file.digest) changed.push(path);
  }
  for (const path of baseMap.keys()) if (!workMap.has(path)) deleted.push(path);
  const files = resolveGraph(scanned);
  const digest = sha(stable({ base: base.epoch, files: files.map((file) => ({ path: file.path, digest: file.digest })) }));
  return { files, applied: true, digest, changed: changed.sort(), added: added.sort(), deleted: deleted.sort() };
}
function budgetPayload(items, budgetTokens) {
  const limit = budgetTokens * 4; const payload = [];
  for (const item of items) { if (Buffer.byteLength(JSON.stringify([...payload, item])) > limit) break; payload.push(item); }
  return payload;
}

export class AtlasCodeIndex {
  constructor(opts = {}) {
    if (typeof opts.artifactRoot !== 'string' || !opts.artifactRoot) throw new TypeError('Atlas artifactRoot required');
    this.artifactRoot = opts.artifactRoot;
    this.indexRoot = join(opts.artifactRoot, 'indexes'); this.resultRoot = join(opts.artifactRoot, 'results');
    this.maxSourceBytes = opts.maxSourceBytes ?? 2 * 1024 * 1024; this.maxFiles = opts.maxFiles ?? 20000;
    this.maxResults = opts.maxResults ?? 100000; this.maxArtifactBytes = opts.maxArtifactBytes ?? 64 * 1024 * 1024;
    for (const key of ['maxSourceBytes', 'maxFiles', 'maxResults', 'maxArtifactBytes']) if (!Number.isSafeInteger(this[key]) || this[key] <= 0) throw new TypeError(`Atlas ${key} must be a positive safe integer`);
    this.now = opts.now ?? Date.now; this.record = opts.record ?? null;
    mkdirSync(this.indexRoot, { recursive: true, mode: 0o700 }); mkdirSync(this.resultRoot, { recursive: true, mode: 0o700 });
  }
  card() {
    return Object.freeze({
      name: 'atlas-index', version: '0.1.0', underlying: [`@ast-grep/napi@${AST_GREP_VERSION}`, 'SCIP JSON interchange'],
      ops: {
        'index.build': { latency_class: 'task', deterministic: true, side_effects: 'writes_shared_index', interruptible: true, reverifiable: true },
        'search.lexical': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'symbol.search': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'symbol.references': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'graph.calls': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'repo.map': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'code.seed': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
        'scip.export': { latency_class: 'interactive', deterministic: true, side_effects: 'writes_content_addressed_artifact', reverifiable: true },
      },
      languages: [...new Set(Object.values(LANGUAGE).map(([name]) => name))], shared_state: { code_index: 'snapshot+overlay' },
      ceilings: { maxSourceBytes: this.maxSourceBytes, maxFiles: this.maxFiles, maxResults: this.maxResults, maxArtifactBytes: this.maxArtifactBytes },
      sandbox_required: 'read_only_worktree', cost_model: 'cpu_bound_local',
      limitations: [`overlay recomputed per query`, `hard result ceiling ${this.maxResults}`, 'SCIP JSON interchange only; no live LSP/protobuf', 'no semantic retrieval', 'no CPG/IR/semantic merge'],
    });
  }
  _write(root, value) {
    const serialized = `${stable(value)}\n`; const digest = sha(serialized); const path = join(root, `${digest}.json`);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('Atlas artifact exceeded deployment ceiling', 'artifact_too_large');
    if (!existsSync(path)) { try { writeFileSync(path, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); } catch (error) { if (error?.code !== 'EEXIST') throw error; } }
    return { digest, path, bytes: Buffer.byteLength(serialized) };
  }
  _load(epoch) {
    if (typeof epoch !== 'string' || !/^[a-f0-9]{64}$/.test(epoch)) throw typed('valid Atlas indexEpoch required', 'invalid_epoch');
    const matches = readdirSync(this.indexRoot).filter((name) => name.endsWith('.json')).sort();
    let found = null;
    for (const name of matches) {
      const bytes = readSourceBounded(join(this.indexRoot, name), this.maxArtifactBytes); if (bytes === null) throw typed('Atlas index artifact exceeded deployment ceiling', 'index_too_large'); const raw = bytes.toString('utf8');
      let value;
      try { value = JSON.parse(raw); } catch { continue; }
      if (value.epoch !== epoch) continue;
      if (found) throw typed(`multiple Atlas artifacts claim epoch ${epoch}`, 'index_integrity');
      if (sha(raw) !== name.slice(0, -'.json'.length)) throw typed('Atlas index artifact digest mismatch', 'index_integrity');
      if (value.schemaVersion !== 1 || value.extractor !== EXTRACTOR_VERSION || !Array.isArray(value.files)) throw typed('Atlas index schema/extractor mismatch', 'index_integrity');
      const observedEpoch = sha(stable({ extractor: value.extractor, files: value.files }));
      if (observedEpoch !== epoch) throw typed('Atlas index epoch projection mismatch', 'index_integrity');
      found = value;
    }
    if (!found) throw typed(`unknown Atlas epoch ${epoch}`, 'unknown_epoch');
    return found;
  }
  _result(op, full, ctx, started, provenance, kind = 'atlas_results', extraRefs = []) {
    const complete = { ...full, op, provenance };
    const artifact = this._write(this.resultRoot, complete); const items = Array.isArray(full.items) ? full.items : [full];
    const payload = budgetPayload(items, ctx.budgetTokens); const truncated = payload.length < items.length;
    const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({
      op, status: truncated ? 'needs_resume' : 'ok', summary: full.summary, payload,
      refs: [{ handle: `art:sha256:${artifact.digest}`, kind, digest: artifact.digest, bytes: artifact.bytes, mediaType: 'application/vnd.baton.atlas-index+json', path: artifact.path }, ...extraRefs],
      ...(truncated ? { cursor: `atlas:${artifact.digest}:${payload.length}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: EXTRACTOR_VERSION },
      provenance: { tool: EXTRACTOR_VERSION, deterministic: true, artifactDigest: artifact.digest, ...provenance },
    });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, status: result.status, artifactDigest: artifact.digest, wallMs, indexEpoch: provenance.index_epoch, overlayDigest: provenance.overlay_digest });
    return result;
  }
  async invoke(op, args = {}, ctx = {}) {
    if (!this.card().ops[op]) throw typed(`unsupported Atlas op ${op}`, 'unsupported_op');
    if (!Number.isInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    const started = this.now(); checkAbort(ctx);
    this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, indexEpoch: args.indexEpoch ?? null });
    if (op === 'index.build') {
      const root = ensureRoot(ctx.baseRoot);
      const base = baseRecord(scan(root, this, ctx)); const artifact = this._write(this.indexRoot, base);
      const items = base.files.map((file) => ({ path: file.path, digest: file.digest, language: file.language, symbols: file.definitions.length, references: file.occurrences.filter((item) => item.role === 'reference').length }));
      return this._result(op, { schemaVersion: 1, summary: `indexed ${base.files.length} files at ${base.epoch.slice(0, 12)}`, items, index: { epoch: base.epoch, digest: artifact.digest, path: artifact.path } }, ctx, started,
        { index_epoch: base.epoch, base_inputs_digest: sha(stable(base.inputs)), overlay_applied: false }, 'atlas_build_results',
        [{ handle: `art:sha256:${artifact.digest}`, kind: 'atlas_index', digest: artifact.digest, bytes: artifact.bytes, mediaType: 'application/vnd.baton.atlas-index+json', path: artifact.path }]);
    }
    const base = this._load(args.indexEpoch); const view = overlay(base, ctx.worktreeRoot, this, ctx);
    const provenance = { index_epoch: base.epoch, overlay_applied: view.applied, overlay_digest: view.digest, overlay_changed: view.changed, overlay_added: view.added, overlay_deleted: view.deleted, staleness: view.applied ? 'base_plus_worktree_overlay' : 'base_snapshot_only', effective_files: view.files.length };
    let items = []; let summary = ''; let extraRefs = []; let resultKind = 'atlas_results';
    if (op === 'search.lexical') {
      if (typeof args.query !== 'string' || !args.query) throw typed('lexical query required', 'invalid_query');
      const needle = args.caseSensitive ? args.query : args.query.toLowerCase();
      for (const file of view.files) file.lines.forEach((line, index) => {
        const hay = args.caseSensitive ? line : line.toLowerCase(); let from = 0;
        while ((from = hay.indexOf(needle, from)) !== -1) { items.push({ path: file.path, range: { start: { line: index + 1, column: from + 1 }, end: { line: index + 1, column: from + needle.length + 1 } }, preview: line }); from += Math.max(1, needle.length); }
      });
      items.sort((a, b) => a.path.localeCompare(b.path) || a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column); summary = `${items.length} lexical hits for ${JSON.stringify(args.query)}`;
    } else if (op === 'symbol.search') {
      const query = String(args.query ?? '').toLowerCase(); if (!query) throw typed('symbol query required', 'invalid_query');
      items = view.files.flatMap((file) => file.definitions).map((item) => {
        const name = item.name.toLowerCase(); const container = String(item.container ?? '').toLowerCase();
        const rank = name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : container.includes(query) ? 3 : item.symbol.toLowerCase().includes(query) ? 4 : null;
        return rank == null ? null : { ...item, rank };
      }).filter(Boolean).sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol)).map(({ rank, ...item }) => item); summary = `${items.length} symbol definitions matching ${JSON.stringify(args.query)}`;
    } else if (op === 'symbol.references') {
      const definitions = view.files.flatMap((file) => file.definitions); let target = null;
      if (args.symbol) target = definitions.find((item) => item.symbol === args.symbol) ?? null;
      else { const matches = definitions.filter((item) => item.name === args.name); if (matches.length === 1) target = matches[0]; else if (matches.length > 1) throw typed('symbol name is ambiguous; pass stable symbol', 'ambiguous_symbol'); }
      if (!target) throw typed('symbol not found', 'symbol_not_found');
      items = view.files.flatMap((file) => file.occurrences).filter((item) => item.symbol === target.symbol || item.candidates?.includes(target.symbol)).map((item) => ({ ...item, target: target.symbol, ambiguous: item.symbol == null })).sort((a, b) => a.path.localeCompare(b.path) || a.range.start.line - b.range.start.line || a.range.start.column - b.range.start.column); summary = `${items.length} occurrences of ${target.name}`;
    } else if (op === 'graph.calls') {
      items = view.files.flatMap((file) => file.calls).filter((item) => !args.symbol || item.caller === args.symbol || item.resolved === args.symbol || item.candidates.includes(args.symbol)).sort((a, b) => a.path.localeCompare(b.path) || a.range.start.line - b.range.start.line); summary = `${items.length} call edges${args.symbol ? ' touching requested symbol' : ''}`;
    } else if (op === 'repo.map') {
      items = view.files.map((file) => ({ path: file.path, language: file.language, lines: file.lineCount, symbols: file.definitions.length, references: file.occurrences.filter((item) => item.role === 'reference').length, imports: file.imports.map((item) => item.source), calls: file.calls.length, parseErrors: file.parseErrors.length })); summary = `${items.length} files; ${items.reduce((sum, item) => sum + item.symbols, 0)} symbols; ${items.reduce((sum, item) => sum + item.calls, 0)} calls`;
    } else if (op === 'code.seed') {
      const terms = (args.terms ?? []).map((term) => String(term).toLowerCase()).filter(Boolean); if (!terms.length) throw typed('code.seed terms required', 'invalid_query');
      items = view.files.map((file) => {
        const symbols = file.definitions.filter((definition) => terms.some((term) => definition.name.toLowerCase().includes(term)));
        const lexical = file.lines.reduce((count, line) => count + (terms.some((term) => line.toLowerCase().includes(term)) ? 1 : 0), 0);
        return { path: file.path, score: symbols.length * 5 + lexical + file.imports.length * 0.1, symbols, imports: file.imports.map((item) => item.source), calls: file.calls.filter((call) => terms.includes(call.calleeName.toLowerCase())) };
      }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)); summary = `${items.length} orientation files for ${terms.join(', ')}`;
    } else if (op === 'scip.export') {
      const documents = view.files.map((file) => ({
        relativePath: file.path, language: file.language,
        occurrences: file.occurrences.filter((item) => item.symbol).map((item) => ({ range: scipRange(item.range), symbol: item.symbol, symbolRoles: item.role === 'definition' ? 1 : 0 })),
        symbols: file.definitions.map((item) => ({ symbol: item.symbol, documentation: [], relationships: [] })),
      }));
      const scip = { metadata: { version: 0, toolInfo: { name: 'baton-atlas', version: '0.1.0', arguments: [] }, projectRoot: '', textDocumentEncoding: 'UTF8' }, documents, externalSymbols: [] };
      const scipArtifact = this._write(this.resultRoot, scip);
      extraRefs = [{ handle: `art:sha256:${scipArtifact.digest}`, kind: 'scip_json', digest: scipArtifact.digest, bytes: scipArtifact.bytes, mediaType: 'application/scip+json', path: scipArtifact.path }];
      items = documents.map((document) => ({ relativePath: document.relativePath, language: document.language, occurrences: document.occurrences.length, symbols: document.symbols.length }));
      summary = `SCIP JSON interchange for ${documents.length} documents`; resultKind = 'scip_export_results';
    }
    checkAbort(ctx);
    if (items.length > this.maxResults) throw typed(`Atlas result ceiling ${this.maxResults} exceeded`, 'result_too_large');
    return this._result(op, { schemaVersion: 1, summary, items }, ctx, started, provenance, resultKind, extraRefs);
  }
  async reverify(claim, op, args, ctx) {
    const rerun = await this.invoke(op, args, ctx);
    return Object.freeze({ ok: rerun.provenance.artifactDigest === claim?.provenance?.artifactDigest, observedDigest: rerun.provenance.artifactDigest });
  }
  async resume(handle, cursor, ctx = {}) {
    if (!Number.isInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    const match = /^atlas:([a-f0-9]{64}):(\d+)$/.exec(String(cursor ?? ''));
    const requested = typeof handle === 'string' ? handle : handle?.handle;
    if (!match || requested !== `art:sha256:${match[1]}`) throw typed('cursor and artifact handle do not match', 'invalid_cursor');
    const path = join(this.resultRoot, `${match[1]}.json`);
    if (!existsSync(path)) throw typed('Atlas result artifact is unavailable', 'unknown_cursor');
    const bytesBuffer = readSourceBounded(path, this.maxArtifactBytes); if (bytesBuffer === null) throw typed('Atlas result artifact exceeded deployment ceiling', 'result_too_large'); const raw = bytesBuffer.toString('utf8');
    if (sha(raw) !== match[1]) throw typed('Atlas result artifact digest mismatch', 'result_integrity');
    const full = JSON.parse(raw); const offset = Number(match[2]);
    if (!Array.isArray(full.items) || offset < 0 || offset > full.items.length) throw typed('Atlas cursor offset is invalid', 'invalid_cursor');
    const payload = budgetPayload(full.items.slice(offset), ctx.budgetTokens); const next = offset + payload.length;
    const truncated = next < full.items.length; const bytes = Buffer.byteLength(raw);
    return Object.freeze({
      op: full.op, status: truncated ? 'needs_resume' : 'ok', summary: full.summary, payload,
      refs: [{ handle: requested, kind: 'atlas_results', digest: match[1], bytes, mediaType: 'application/vnd.baton.atlas-index+json', path }],
      ...(truncated ? { cursor: `atlas:${match[1]}:${next}` } : {}),
      cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: EXTRACTOR_VERSION },
      provenance: { ...(full.provenance ?? {}), resumed_from: offset, artifactDigest: match[1], deterministic: true },
    });
  }
}

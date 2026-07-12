import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Lang, parse } from '@ast-grep/napi';

const require = createRequire(import.meta.url);
const VERSION = require('@ast-grep/napi/package.json').version;
const LANG = { '.js': Lang.JavaScript, '.mjs': Lang.JavaScript, '.cjs': Lang.JavaScript, '.jsx': Lang.JavaScript, '.ts': Lang.TypeScript, '.mts': Lang.TypeScript, '.cts': Lang.TypeScript, '.tsx': Lang.Tsx };
const FUNCTION_KINDS = new Set(['function_declaration', 'generator_function_declaration', 'method_definition', 'function_expression', 'arrow_function']);
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function typed(message, code) { return Object.assign(new Error(message), { code }); }
function abort(ctx) { if (ctx?.signal?.aborted) throw typed('CPG build cancelled', 'cancelled'); }
function range(node) { const r = node.range(); return { start: { line: r.start.line + 1, column: r.start.column + 1 }, end: { line: r.end.line + 1, column: r.end.column + 1 } }; }
function id(type, node) { const r = node.range(); return `${type}:${r.start.index}:${r.end.index}`; }
function firstName(node) {
  try { const value = node.field('name'); if (value) return value.text(); } catch { /* grammar variance */ }
  return node.children().find((child) => ['identifier', 'property_identifier'].includes(child.kind()))?.text() ?? null;
}
function safe(root, path) {
  if (!path || isAbsolute(path)) throw typed('relative CPG source path required', 'path_escape');
  const rr = realpathSync(root); const candidate = resolve(rr, path); const rel = relative(rr, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw typed('CPG source escapes root', 'path_escape');
  let real; try { real = realpathSync(candidate); } catch { throw typed('CPG source unavailable', 'invalid_source'); }
  if (real !== rr && !real.startsWith(`${rr}${sep}`)) throw typed('CPG symlink escapes root', 'path_escape');
  if (!lstatSync(real).isFile()) throw typed('CPG source is not a file', 'invalid_source');
  return real;
}
function bounded(items, tokens) { const out = []; for (const item of items) { if (Buffer.byteLength(JSON.stringify([...out, item])) > tokens * 4) break; out.push(item); } return out; }

export class AtlasCpgSlice {
  constructor(opts = {}) {
    if (!opts.artifactRoot) throw new TypeError('CPG artifactRoot required');
    for (const key of ['maxSourceBytes', 'maxArtifactBytes']) if (!Number.isSafeInteger(opts[key]) || opts[key] <= 0) throw new TypeError(`${key} must be deployment-derived`);
    this.artifactRoot = opts.artifactRoot; this.maxSourceBytes = opts.maxSourceBytes; this.maxArtifactBytes = opts.maxArtifactBytes; this.now = opts.now ?? Date.now; this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }
  card() { return Object.freeze({ name: 'atlas-cpg-slice', version: '0.1.0', underlying: [`@ast-grep/napi@${VERSION}`], ops: { 'cpg.build': { deterministic: true, latency_class: 'interactive', side_effects: 'writes_content_addressed_artifact', reverifiable: true } }, languages: ['javascript', 'typescript', 'tsx'], limitations: ['single-file JS/TS-family slice', 'no SSA/path-sensitive PDG/taint', 'no alias analysis/interprocedural dataflow/dynamic dispatch', 'unsupported control constructs are atomic'] }); }

  async invoke(op, args, ctx) {
    if (op !== 'cpg.build') throw typed('unsupported CPG operation', 'unsupported_op');
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    abort(ctx); const language = LANG[extname(args?.path ?? '').toLowerCase()]; if (!language) throw typed('unsupported CPG language', 'unsupported_language');
    const file = safe(ctx.root, args.path); const bytes = readFileSync(file); if (bytes.includes(0) || bytes.length > this.maxSourceBytes) throw typed('CPG source exceeds budget or is binary', 'invalid_source');
    let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw typed('CPG source is invalid UTF-8', 'invalid_source'); }
    const sourceDigest = sha(bytes); const started = this.now(); this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, sourceDigest });
    const root = parse(language, source).root(); const nodes = []; const edges = []; const errors = []; const functions = []; const occurrences = []; const calls = []; const blockStatements = new Map();
    const nodeId = (type, node) => `${sourceDigest}:${id(type, node)}`;
    const edge = (type, from, to) => { if (!from || !to) return; edges.push({ id: sha(`${type}\0${from}\0${to}`), type, from, to }); };
    function visit(node, state = { fn: null, block: null, parent: null }) {
      abort(ctx); const kind = node.kind(); if (kind === 'ERROR') errors.push(range(node));
      let fn = state.fn; let block = state.block;
      if (FUNCTION_KINDS.has(kind)) {
        const name = firstName(node) ?? (state.parent?.kind() === 'variable_declarator' ? firstName(state.parent) : null) ?? '<anonymous>';
        fn = nodeId('function', node); const entry = `${fn}:entry`; const exit = `${fn}:exit`;
        nodes.push({ id: fn, type: 'function', kind, name, path: args.path, range: range(node) }, { id: entry, type: 'entry', function: fn }, { id: exit, type: 'exit', function: fn });
        functions.push({ id: fn, name, node, entry, exit, bodyBlock: null });
      }
      if (kind === 'statement_block') { block = nodeId('block', node); const owner = functions.find((item) => item.id === fn); if (owner && !owner.bodyBlock) owner.bodyBlock = block; }
      const isStatement = kind.endsWith('_statement') || ['lexical_declaration', 'variable_declaration'].includes(kind);
      if (isStatement && fn) {
        const sid = nodeId('statement', node); nodes.push({ id: sid, type: 'statement', kind, function: fn, path: args.path, range: range(node), textDigest: sha(node.text()) }); edge('CONTAINS', fn, sid);
        const list = blockStatements.get(block) ?? []; list.push({ id: sid, node, kind, fn, block }); blockStatements.set(block, list);
      }
      if (kind === 'identifier' && fn) {
        const oid = nodeId('identifier', node); const parent = state.parent; const siblings = parent?.children().filter((child) => child.isNamed()) ?? [];
        const definition = ['formal_parameters', 'required_parameter', 'optional_parameter'].includes(parent?.kind()) || (parent?.kind() === 'variable_declarator' && siblings[0]?.id() === node.id()) || (parent?.kind() === 'assignment_expression' && siblings[0]?.id() === node.id());
        nodes.push({ id: oid, type: 'identifier', name: node.text(), role: definition ? 'definition' : 'reference', function: fn, path: args.path, range: range(node) }); edge('CONTAINS', fn, oid);
        occurrences.push({ id: oid, name: node.text(), role: definition ? 'definition' : 'reference', fn, start: node.range().start.index });
      }
      if (kind === 'call_expression' && fn) {
        const callee = node.children().find((child) => child.isNamed()); const name = callee ? callee.text().match(/[A-Za-z_$][\w$]*$/)?.[0] ?? null : null; const cid = nodeId('call', node);
        nodes.push({ id: cid, type: 'call', caller: fn, calleeName: name, calleeText: callee?.text() ?? null, resolved: null, candidates: [], path: args.path, range: range(node) }); edge('CONTAINS', fn, cid); calls.push({ id: cid, name, fn });
      }
      for (const child of node.children()) if (child.isNamed()) visit(child, { fn, block, parent: node });
    }
    visit(root);
    for (const list of blockStatements.values()) {
      list.sort((a, b) => a.node.range().start.index - b.node.range().start.index);
      for (let i = 1; i < list.length; i += 1) if (!['return_statement', 'throw_statement'].includes(list[i - 1].kind)) edge('CFG_NEXT', list[i - 1].id, list[i].id);
    }
    for (const fn of functions) {
      const top = blockStatements.get(fn.bodyBlock) ?? []; edge('CFG_ENTRY', fn.entry, top[0]?.id ?? fn.exit);
      if (!['return_statement', 'throw_statement'].includes(top.at(-1)?.kind)) edge('CFG_EXIT', top.at(-1)?.id ?? fn.entry, fn.exit);
      for (const list of blockStatements.values()) for (const stmt of list.filter((item) => item.fn === fn.id && ['return_statement', 'throw_statement'].includes(item.kind))) edge('CFG_EXIT', stmt.id, fn.exit);
      for (const list of blockStatements.values()) for (const stmt of list.filter((item) => item.fn === fn.id && item.kind === 'if_statement')) {
        const nested = [...blockStatements.values()].flat().filter((item) => item.fn === fn.id && item.node.range().start.index > stmt.node.range().start.index && item.node.range().end.index <= stmt.node.range().end.index).sort((a, b) => a.node.range().start.index - b.node.range().start.index);
        edge('CFG_TRUE', stmt.id, nested[0]?.id ?? fn.exit);
        const after = (blockStatements.get(stmt.block) ?? []).find((item) => item.node.range().start.index > stmt.node.range().end.index);
        edge('CFG_FALSE', stmt.id, after?.id ?? fn.exit);
      }
    }
    occurrences.sort((a, b) => a.fn.localeCompare(b.fn) || a.start - b.start); const latest = new Map();
    for (const item of occurrences) { const key = `${item.fn}\0${item.name}`; if (item.role === 'definition') latest.set(key, item.id); else edge('REACHING_DEF', latest.get(key), item.id); }
    const byName = new Map(); for (const fn of functions) { const list = byName.get(fn.name) ?? []; list.push(fn.id); byName.set(fn.name, list); }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const call of calls) { const candidates = byName.get(call.name) ?? []; const target = nodeById.get(call.id); target.candidates = [...candidates]; target.resolved = candidates.length === 1 ? candidates[0] : null; if (target.resolved) edge('CALLS', call.fn, target.resolved); }
    nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => a.type.localeCompare(b.type) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const graph = { schemaVersion: 1, op, path: args.path, sourceDigest, parseErrors: errors, nodes, edges }; const serialized = `${JSON.stringify(graph)}\n`; const graphDigest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('CPG graph exceeds artifact budget', 'graph_too_large');
    const artifactPath = join(this.artifactRoot, `${graphDigest}.json`); if (existsSync(artifactPath) && sha(readFileSync(artifactPath)) !== graphDigest) throw typed('CPG artifact integrity failure', 'artifact_integrity'); if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { mode: 0o600, flag: 'wx' });
    const items = [...nodes.map((node) => ({ recordType: 'node', ...node })), ...edges.map((item) => ({ recordType: 'edge', ...item }))]; const payload = bounded(items, ctx.budgetTokens); const truncated = payload.length < items.length; const status = errors.length ? 'partial' : truncated ? 'needs_resume' : 'ok'; const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({ op, status, summary: `${nodes.length} nodes, ${edges.length} edges${errors.length ? `; ${errors.length} parse errors` : ''}`, payload, refs: [{ handle: `art:sha256:${graphDigest}`, kind: 'cpg_slice', digest: graphDigest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-cpg+json', path: artifactPath }], ...(truncated ? { cursor: `atlas-cpg:${graphDigest}:${payload.length}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: `@ast-grep/napi@${VERSION}` }, provenance: { sourceDigest, graphDigest, parseErrors: errors.length, deterministic: true, scope: 'single_file_intraprocedural_seed' } });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, sourceDigest, graphDigest, status, wallMs }); return result;
  }
  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); const match = /^atlas-cpg:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? ''); if (!match || match[1] !== ref?.digest) throw typed('invalid CPG cursor', 'invalid_cursor');
    let path; try { path = realpathSync(ref.path); } catch { throw typed('CPG artifact unavailable', 'artifact_integrity'); } const root = realpathSync(this.artifactRoot); if (!path.startsWith(`${root}${sep}`)) throw typed('CPG artifact path escape', 'artifact_integrity'); const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('CPG artifact digest mismatch', 'artifact_integrity'); const graph = JSON.parse(bytes); const items = [...graph.nodes.map((node) => ({ recordType: 'node', ...node })), ...graph.edges.map((edge) => ({ recordType: 'edge', ...edge }))]; const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw typed('invalid CPG cursor offset', 'invalid_cursor'); const payload = bounded(items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < items.length; return Object.freeze({ op: 'cpg.build', status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} CPG records`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-cpg:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `@ast-grep/napi@${VERSION}` }, provenance: { graphDigest: ref.digest, resumed_from: offset, deterministic: true } });
  }
  async reverify(claim, args, ctx) { const rerun = await this.invoke('cpg.build', args, ctx); return Object.freeze({ ok: rerun.provenance.graphDigest === claim?.provenance?.graphDigest, observedGraphDigest: rerun.provenance.graphDigest }); }
}

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
function fingerprint(node) {
  if (node.kind() === 'comment' || node.kind() === ';') return '';
  const children = node.children().filter((child) => child.kind() !== 'comment');
  if (children.length === 0) return `${node.kind()}:${JSON.stringify(node.text())}`;
  return `${node.kind()}(${children.map(fingerprint).filter(Boolean).join(',')})`;
}
function firstName(node) {
  try { const value = node.field('name'); if (value) return value.text(); } catch { /* grammar variance */ }
  return node.children().find((child) => ['identifier', 'property_identifier'].includes(child.kind()))?.text() ?? null;
}
function booleanLiteral(node) {
  if (!node) return null;
  if (node.kind() === 'true' || node.kind() === 'false') return node.kind();
  if (node.kind() !== 'parenthesized_expression') return null;
  const children = node.children().filter((child) => child.isNamed() && child.kind() !== 'comment');
  return children.length === 1 ? booleanLiteral(children[0]) : null;
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
    for (const key of ['maxSourceBytes', 'maxArtifactBytes', 'maxReachDefPairs']) if (!Number.isSafeInteger(opts[key]) || opts[key] <= 0) throw new TypeError(`${key} must be deployment-derived`);
    this.artifactRoot = opts.artifactRoot; this.maxSourceBytes = opts.maxSourceBytes; this.maxArtifactBytes = opts.maxArtifactBytes; this.maxReachDefPairs = opts.maxReachDefPairs; this.now = opts.now ?? Date.now; this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 });
  }
  card() { return Object.freeze({ name: 'atlas-cpg-slice', version: '0.3.0', underlying: [`@ast-grep/napi@${VERSION}`], ops: { 'cpg.build': { deterministic: true, latency_class: 'interactive', side_effects: 'writes_content_addressed_artifact', reverifiable: true } }, languages: ['javascript', 'typescript', 'tsx'], limitations: ['single-file JS/TS-family slice', 'bounded CFG may-reaching definitions, not SSA/must-def/full PDG', 'value flow covers direct identifier/call assignment and direct call arguments', 'literal-only dead-branch pruning; no general path-condition solving', 'no shadowing-aware bindings/aliases/heap/implicit flow/interprocedural dataflow/dynamic dispatch', 'only braced if control is expanded; unsupported control constructs are atomic', 'standalone bare blocks are not CFG spine nodes'] }); }

  async invoke(op, args, ctx) {
    if (op !== 'cpg.build') throw typed('unsupported CPG operation', 'unsupported_op');
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    abort(ctx); const language = LANG[extname(args?.path ?? '').toLowerCase()]; if (!language) throw typed('unsupported CPG language', 'unsupported_language');
    const file = safe(ctx.root, args.path); const bytes = readFileSync(file); if (bytes.includes(0) || bytes.length > this.maxSourceBytes) throw typed('CPG source exceeds budget or is binary', 'invalid_source');
    let source; try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw typed('CPG source is invalid UTF-8', 'invalid_source'); }
    const sourceDigest = sha(bytes); const started = this.now(); this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, sourceDigest });
    const root = parse(language, source).root(); const nodes = []; const edges = []; const errors = []; const functions = []; const occurrences = []; const calls = []; const statements = []; const blockStatements = new Map(); const pendingAssignments = []; const pendingArguments = [];
    const nodeId = (type, node) => `${sourceDigest}:${id(type, node)}`;
    const edgeIds = new Set(); const edge = (type, from, to) => { if (!from || !to) return; const edgeId = sha(`${type}\0${from}\0${to}`); if (edgeIds.has(edgeId)) return; edgeIds.add(edgeId); edges.push({ id: edgeId, type, from, to }); };
    function visit(node, state = { fn: null, block: null, parent: null, statement: null }) {
      abort(ctx); const kind = node.kind(); if (kind === 'ERROR') errors.push(range(node));
      let fn = state.fn; let block = state.block; let statement = state.statement;
      if (FUNCTION_KINDS.has(kind)) {
        const name = (state.parent?.kind() === 'variable_declarator' ? firstName(state.parent) : null) ?? firstName(node) ?? '<anonymous>';
        fn = nodeId('function', node); const entry = `${fn}:entry`; const exit = `${fn}:exit`;
        nodes.push({ id: fn, type: 'function', kind, name, path: args.path, range: range(node) }, { id: entry, type: 'entry', function: fn }, { id: exit, type: 'exit', function: fn });
        functions.push({ id: fn, name, node, entry, exit, bodyBlock: null }); statement = null;
      }
      if (kind === 'statement_block') { block = nodeId('block', node); const owner = functions.find((item) => item.id === fn); if (owner && !owner.bodyBlock) owner.bodyBlock = block; }
      const isStatement = kind.endsWith('_statement') || ['lexical_declaration', 'variable_declaration'].includes(kind);
      if (isStatement && fn) {
        const parentStatement = statement; const sid = nodeId('statement', node); const record = { id: sid, node, kind, fn, block, parentStatement };
        nodes.push({ id: sid, type: 'statement', kind, function: fn, parentStatement, path: args.path, range: range(node), textDigest: sha(node.text()), syntaxDigest: sha(fingerprint(node)) }); edge('CONTAINS', fn, sid);
        statements.push(record); const list = blockStatements.get(block) ?? []; list.push(record); blockStatements.set(block, list); statement = sid;
      }
      if (kind === 'identifier' && fn) {
        const oid = nodeId('identifier', node); const parent = state.parent; const siblings = parent?.children().filter((child) => child.isNamed()) ?? [];
        const definition = ['formal_parameters', 'required_parameter', 'optional_parameter'].includes(parent?.kind()) || (parent?.kind() === 'variable_declarator' && siblings[0]?.id() === node.id()) || (parent?.kind() === 'assignment_expression' && siblings[0]?.id() === node.id());
        nodes.push({ id: oid, type: 'identifier', name: node.text(), role: definition ? 'definition' : 'reference', function: fn, statement, path: args.path, range: range(node) }); edge('CONTAINS', fn, oid);
        occurrences.push({ id: oid, name: node.text(), role: definition ? 'definition' : 'reference', fn, statement, start: node.range().start.index });
      }
      if (kind === 'call_expression' && fn) {
        const callee = node.children().find((child) => child.isNamed()); const name = callee ? callee.text().match(/[A-Za-z_$][\w$]*$/)?.[0] ?? null : null; const cid = nodeId('call', node);
        nodes.push({ id: cid, type: 'call', caller: fn, statement, calleeName: name, calleeText: callee?.text() ?? null, resolved: null, candidates: [], path: args.path, range: range(node) }); edge('CONTAINS', fn, cid); calls.push({ id: cid, name, fn });
        let argumentsNode = null; try { argumentsNode = node.field('arguments'); } catch { /* grammar variance */ }
        if (argumentsNode) {
          for (const value of argumentsNode.children().filter((child) => child.isNamed())) if (['identifier', 'call_expression'].includes(value.kind())) pendingArguments.push({ value, call: node });
        }
      }
      if (['variable_declarator', 'assignment_expression'].includes(kind)) {
        const named = node.children().filter((child) => child.isNamed()); const target = named[0]; const value = named[1];
        if (target?.kind() === 'identifier' && value) {
          if (['call_expression', 'identifier'].includes(value.kind())) pendingAssignments.push({ value, target });
        }
      }
      for (const child of node.children()) if (child.isNamed()) visit(child, { fn, block, parent: node, statement });
    }
    visit(root);
    const terminal = (item) => ['return_statement', 'throw_statement'].includes(item?.kind);
    const statementById = new Map(statements.map((item) => [item.id, item]));
    const directStatements = (list = []) => list.filter((item) => {
      if (!item.parentStatement) return true;
      return statementById.get(item.parentStatement)?.block !== item.block;
    }).sort((a, b) => a.node.range().start.index - b.node.range().start.index);
    const sequenceFor = (stmt) => directStatements(blockStatements.get(stmt.block));
    const functionById = new Map(functions.map((item) => [item.id, item]));
    const joinFor = (stmt, seen = new Set()) => {
      if (!stmt || seen.has(stmt.id)) return functionById.get(stmt?.fn)?.exit ?? null;
      seen.add(stmt.id); const list = sequenceFor(stmt); const index = list.findIndex((item) => item.id === stmt.id);
      if (index >= 0 && list[index + 1]) return list[index + 1].id;
      return stmt.parentStatement ? joinFor(statementById.get(stmt.parentStatement), seen) : functionById.get(stmt.fn)?.exit ?? null;
    };
    const structuredIfs = new Map();
    for (const stmt of statements.filter((item) => item.kind === 'if_statement')) {
      let consequence = null; let alternative = null; let condition = null;
      try { consequence = stmt.node.field('consequence'); alternative = stmt.node.field('alternative'); condition = stmt.node.field('condition'); } catch { /* grammar variance */ }
      if (consequence?.kind() !== 'statement_block') continue;
      let alternativeBlock = null; let alternativeIf = null;
      if (alternative) {
        const alternativeBody = alternative.kind() === 'else_clause' ? alternative.children().find((child) => child.isNamed()) ?? null : alternative;
        if (alternativeBody?.kind() === 'statement_block') alternativeBlock = alternativeBody;
        else if (alternativeBody?.kind() === 'if_statement') alternativeIf = alternativeBody;
      }
      if (alternative && !alternativeBlock && !alternativeIf) continue;
      const consequenceList = directStatements(blockStatements.get(nodeId('block', consequence)));
      const alternativeList = alternativeBlock ? directStatements(blockStatements.get(nodeId('block', alternativeBlock))) : alternativeIf ? [statementById.get(nodeId('statement', alternativeIf))].filter(Boolean) : [];
      const literal = booleanLiteral(condition);
      structuredIfs.set(stmt.id, { stmt, consequenceList, alternativeList, hasAlternative: !!alternative, literal, join: joinFor(stmt) });
    }
    for (const raw of blockStatements.values()) {
      const list = directStatements(raw);
      for (let i = 1; i < list.length; i += 1) if (!terminal(list[i - 1]) && !structuredIfs.has(list[i - 1].id)) edge('CFG_NEXT', list[i - 1].id, list[i].id);
    }
    for (const fn of functions) {
      const top = directStatements(blockStatements.get(fn.bodyBlock)); edge('CFG_ENTRY', fn.entry, top[0]?.id ?? fn.exit);
      const tail = top.at(-1); if (!terminal(tail) && !structuredIfs.has(tail?.id)) edge('CFG_EXIT', tail?.id ?? fn.entry, fn.exit);
      for (const stmt of statements.filter((item) => item.fn === fn.id && terminal(item))) edge('CFG_EXIT', stmt.id, fn.exit);
    }
    const connectTail = (tail, join) => { if (!tail || terminal(tail) || structuredIfs.has(tail.id)) return; edge(join?.endsWith(':exit') ? 'CFG_EXIT' : 'CFG_NEXT', tail.id, join); };
    for (const spec of structuredIfs.values()) {
      const thenEntry = spec.consequenceList[0]?.id ?? spec.join; const elseEntry = spec.alternativeList[0]?.id ?? spec.join;
      if (spec.literal !== 'false') edge('CFG_TRUE', spec.stmt.id, thenEntry);
      if (spec.literal !== 'true') edge('CFG_FALSE', spec.stmt.id, spec.hasAlternative ? elseEntry : spec.join);
      if (spec.literal !== 'false') connectTail(spec.consequenceList.at(-1), spec.join);
      if (spec.literal !== 'true') connectTail(spec.alternativeList.at(-1), spec.join);
    }
    const cfgTypes = new Set(['CFG_ENTRY', 'CFG_NEXT', 'CFG_TRUE', 'CFG_FALSE', 'CFG_EXIT']); const cfgOut = new Map(); const cfgIn = new Map();
    for (const item of edges.filter((candidate) => cfgTypes.has(candidate.type))) { const out = cfgOut.get(item.from) ?? []; out.push(item.to); cfgOut.set(item.from, out); const incoming = cfgIn.get(item.to) ?? []; incoming.push(item.from); cfgIn.set(item.to, incoming); }
    const reachableByFunction = new Map();
    for (const fn of functions) { const reachable = new Set(); const queue = [fn.entry]; while (queue.length) { abort(ctx); const current = queue.shift(); if (reachable.has(current)) continue; reachable.add(current); for (const next of cfgOut.get(current) ?? []) queue.push(next); } reachableByFunction.set(fn.id, reachable); }
    const graphNodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) if (node.type === 'statement') node.cfgReachable = reachableByFunction.get(node.function)?.has(node.id) ?? false;
    const effectiveStatement = (statementId) => {
      let current = statementById.get(statementId); let descendant = current; const seen = new Set();
      while (current && !seen.has(current.id)) {
        seen.add(current.id); if (reachableByFunction.get(current.fn)?.has(current.id)) return current.id;
        const parent = statementById.get(current.parentStatement); const parentSpec = parent ? structuredIfs.get(parent.id) : null;
        if (parentSpec) {
          if (parentSpec.literal === 'false' && parentSpec.consequenceList.some((item) => item.id === descendant.id)) return null;
          if (parentSpec.literal === 'true' && parentSpec.alternativeList.some((item) => item.id === descendant.id)) return null;
          if (reachableByFunction.get(parent.fn)?.has(parent.id)) return null;
        }
        descendant = parent; current = parent;
      }
      return null;
    };
    for (const node of nodes) if (node.type === 'identifier' || node.type === 'call') {
      node.cfgAnchor = node.statement ? effectiveStatement(node.statement) : null;
      node.cfgReachable = node.statement ? node.cfgAnchor !== null : true;
    }

    const cloneState = (state) => new Map([...state].map(([name, defs]) => [name, new Set(defs)]));
    const stateKey = (state) => [...state].sort(([a], [b]) => a.localeCompare(b)).map(([name, defs]) => `${name}:${[...defs].sort().join(',')}`).join('|');
    let reachDefPairs = 0; occurrences.sort((a, b) => a.fn.localeCompare(b.fn) || a.start - b.start);
    for (const fn of functions) {
      const reachable = reachableByFunction.get(fn.id); const fnOccurrences = occurrences.filter((item) => item.fn === fn.id); const gen = new Map();
      for (const item of fnOccurrences.filter((candidate) => candidate.role === 'definition')) {
        const anchor = item.statement ? effectiveStatement(item.statement) : fn.entry; if (!anchor || !reachable.has(anchor)) continue; const defs = gen.get(anchor) ?? new Map(); const named = defs.get(item.name) ?? new Set(); named.add(item.id); defs.set(item.name, named); gen.set(anchor, defs);
      }
      const anchors = [fn.entry, ...statements.filter((item) => item.fn === fn.id && reachable.has(item.id)).sort((a, b) => a.node.range().start.index - b.node.range().start.index).map((item) => item.id), fn.exit];
      const incoming = new Map(anchors.map((anchor) => [anchor, new Map()])); const outgoing = new Map(anchors.map((anchor) => [anchor, new Map()])); let changed = true;
      while (changed) {
        changed = false; abort(ctx);
        for (const anchor of anchors) {
          const merged = new Map();
          for (const predecessor of cfgIn.get(anchor) ?? []) for (const [name, defs] of outgoing.get(predecessor) ?? []) { const set = merged.get(name) ?? new Set(); for (const def of defs) set.add(def); merged.set(name, set); }
          const next = cloneState(merged); for (const [name, defs] of gen.get(anchor) ?? []) next.set(name, new Set(defs));
          if (stateKey(incoming.get(anchor)) !== stateKey(merged)) { incoming.set(anchor, merged); changed = true; }
          if (stateKey(outgoing.get(anchor)) !== stateKey(next)) { outgoing.set(anchor, next); changed = true; }
        }
      }
      for (const item of fnOccurrences.filter((candidate) => candidate.role === 'reference')) {
        const anchor = item.statement ? effectiveStatement(item.statement) : fn.entry; if (!anchor || !reachable.has(anchor)) continue;
        for (const definition of incoming.get(anchor)?.get(item.name) ?? []) { reachDefPairs += 1; if (reachDefPairs > this.maxReachDefPairs) throw typed('CPG reaching-definition relation exceeds deployment ceiling', 'reachdef_too_large'); edge('REACHING_DEF', definition, item.id); }
      }
    }
    const byName = new Map(); for (const fn of functions) { const list = byName.get(fn.name) ?? []; list.push(fn.id); byName.set(fn.name, list); }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const pending of pendingAssignments) edge('ASSIGNED_FROM', nodeId(pending.value.kind() === 'call_expression' ? 'call' : 'identifier', pending.value), nodeId('identifier', pending.target));
    for (const pending of pendingArguments) { const type = pending.value.kind() === 'call_expression' ? 'call' : 'identifier'; const valueId = nodeId(type, pending.value); if (nodeById.has(valueId)) edge('ARGUMENT_TO', valueId, nodeId('call', pending.call)); }
    for (const call of calls) { const candidates = byName.get(call.name) ?? []; const target = nodeById.get(call.id); target.candidates = [...candidates]; target.resolved = candidates.length === 1 ? candidates[0] : null; if (target.resolved) edge('CALLS', call.fn, target.resolved); }
    nodes.sort((a, b) => a.id.localeCompare(b.id)); edges.sort((a, b) => a.type.localeCompare(b.type) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    const graph = { schemaVersion: 2, op, path: args.path, sourceDigest, parseErrors: errors, nodes, edges }; const serialized = `${JSON.stringify(graph)}\n`; const graphDigest = sha(serialized);
    if (Buffer.byteLength(serialized) > this.maxArtifactBytes) throw typed('CPG graph exceeds artifact budget', 'graph_too_large');
    const artifactPath = join(this.artifactRoot, `${graphDigest}.json`); if (existsSync(artifactPath) && sha(readFileSync(artifactPath)) !== graphDigest) throw typed('CPG artifact integrity failure', 'artifact_integrity'); if (!existsSync(artifactPath)) writeFileSync(artifactPath, serialized, { mode: 0o600, flag: 'wx' });
    const items = [...nodes.map((node) => ({ recordType: 'node', ...node })), ...edges.map((item) => ({ recordType: 'edge', ...item }))]; const payload = bounded(items, ctx.budgetTokens); const truncated = payload.length < items.length; const status = errors.length ? 'partial' : truncated ? 'needs_resume' : 'ok'; const wallMs = Math.max(0, this.now() - started);
    const result = Object.freeze({ op, status, summary: `${nodes.length} nodes, ${edges.length} edges${errors.length ? `; ${errors.length} parse errors` : ''}`, payload, refs: [{ handle: `art:sha256:${graphDigest}`, kind: 'cpg_slice', digest: graphDigest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-cpg+json', path: artifactPath }], ...(truncated ? { cursor: `atlas-cpg:${graphDigest}:${payload.length}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: `@ast-grep/napi@${VERSION}` }, provenance: { sourceDigest, graphDigest, parseErrors: errors.length, reachDefPairs, deterministic: true, scope: 'single_file_intraprocedural_cfg_may_reach_seed' } });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, sourceDigest, graphDigest, status, wallMs }); return result;
  }
  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); const match = /^atlas-cpg:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? ''); if (!match || match[1] !== ref?.digest) throw typed('invalid CPG cursor', 'invalid_cursor');
    let path; try { path = realpathSync(ref.path); } catch { throw typed('CPG artifact unavailable', 'artifact_integrity'); } const root = realpathSync(this.artifactRoot); if (path !== join(root, `${ref.digest}.json`)) throw typed('CPG artifact path escape', 'artifact_integrity'); const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('CPG artifact digest mismatch', 'artifact_integrity'); let graph; try { graph = JSON.parse(bytes); } catch { throw typed('CPG artifact JSON invalid', 'artifact_integrity'); } if (graph.schemaVersion !== 2 || graph.op !== 'cpg.build' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw typed('CPG artifact schema mismatch', 'artifact_integrity'); const items = [...graph.nodes.map((node) => ({ recordType: 'node', ...node })), ...graph.edges.map((edge) => ({ recordType: 'edge', ...edge }))]; const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw typed('invalid CPG cursor offset', 'invalid_cursor'); const payload = bounded(items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < items.length; return Object.freeze({ op: 'cpg.build', status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} CPG records`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-cpg:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: `@ast-grep/napi@${VERSION}` }, provenance: { graphDigest: ref.digest, resumed_from: offset, deterministic: true } });
  }
  async reverify(claim, op, args, ctx) { const rerun = await this.invoke(op, args, ctx); return Object.freeze({ ok: rerun.provenance.graphDigest === claim?.provenance?.graphDigest, observedGraphDigest: rerun.provenance.graphDigest }); }
}

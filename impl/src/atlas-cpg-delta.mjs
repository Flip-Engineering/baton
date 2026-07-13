import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasCpgSlice } from './atlas-cpg.mjs';

const BINDING_MODEL = 'atlas-js-lexical-bindings-v1';
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function typed(message, code) { return Object.assign(new Error(message), { code }); }
function abort(ctx) { if (ctx?.signal?.aborted) throw typed('CPG delta cancelled', 'cancelled'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function bounded(items, tokens) { const out = []; for (const item of items) { if (Buffer.byteLength(JSON.stringify([...out, item])) > tokens * 4) break; out.push(item); } return out; }
function start(node) { return node.range?.start?.line * 1_000_000 + node.range?.start?.column || 0; }

function semanticGraph(graph) {
  const keyById = new Map(); const records = new Map(); const ordinals = new Map();
  const functions = graph.nodes.filter((node) => node.type === 'function').sort((a, b) => start(a) - start(b) || a.id.localeCompare(b.id));
  for (const node of functions) {
    const base = `function:${node.name}:${node.kind}`; const ordinal = (ordinals.get(base) ?? 0) + 1; ordinals.set(base, ordinal);
    const key = `${base}#${ordinal}`; keyById.set(node.id, key); records.set(key, { key, id: node.id, range: node.range ?? null, projection: { type: node.type, kind: node.kind, name: node.name } });
  }
  const rest = graph.nodes.filter((node) => node.type !== 'function').sort((a, b) => start(a) - start(b) || a.id.localeCompare(b.id));
  for (const node of rest) {
    const fn = keyById.get(node.function ?? node.caller) ?? 'file';
    let base;
    if (node.type === 'entry' || node.type === 'exit') base = `${fn}/${node.type}`;
    else if (node.type === 'scope') base = `${fn}/scope:${node.scopeKind}`;
    else if (node.type === 'binding') base = `${fn}/binding:${node.bindingKind}:${node.name}`;
    else if (node.type === 'statement') base = `${fn}/statement:${node.kind}`;
    else if (node.type === 'identifier') base = `${fn}/identifier:${node.role}:${node.name}`;
    else if (node.type === 'call') base = `${fn}/call:${node.calleeName ?? node.calleeText ?? '<dynamic>'}`;
    else base = `${fn}/${node.type}`;
    const ordinal = (ordinals.get(base) ?? 0) + 1; ordinals.set(base, ordinal); const key = `${base}#${ordinal}`; keyById.set(node.id, key);
    const projection = node.type === 'scope' ? { type: node.type, scopeKind: node.scopeKind, scopeKey: node.scopeKey }
      : node.type === 'binding' ? { type: node.type, bindingKind: node.bindingKind, name: node.name, bindingKey: node.bindingKey }
      : node.type === 'statement' ? { type: node.type, kind: node.kind, syntaxDigest: node.syntaxDigest }
      : node.type === 'identifier' ? { type: node.type, name: node.name, role: node.role, bindingKey: node.bindingKey, bindingResolution: node.bindingResolution }
        : node.type === 'call' ? { type: node.type, calleeName: node.calleeName, resolved: null, candidates: [] }
          : { type: node.type };
    records.set(key, { key, id: node.id, range: node.range ?? null, projection, raw: node });
  }
  for (const record of records.values()) if (record.raw?.type === 'call') {
    record.projection.resolved = keyById.get(record.raw.resolved) ?? null;
    record.projection.candidates = record.raw.candidates.map((id) => keyById.get(id)).filter(Boolean).sort();
    delete record.raw;
  }
  const edges = new Map();
  for (const edge of graph.edges) {
    const from = keyById.get(edge.from); const to = keyById.get(edge.to); if (!from || !to) continue;
    const key = `${edge.type}:${from}->${to}`; edges.set(key, { key, type: edge.type, from, to, id: edge.id });
  }
  return { records, edges };
}
function loadGraph(result) {
  const ref = result.refs.find((item) => item.kind === 'cpg_slice'); const bytes = readFileSync(ref.path);
  if (sha(bytes) !== ref.digest) throw typed('nested CPG artifact integrity failure', 'artifact_integrity');
  return { graph: JSON.parse(bytes), ref };
}
function compare(before, after) {
  const nodeChanges = []; const edgeChanges = [];
  for (const [key, old] of before.records) {
    const current = after.records.get(key);
    if (!current) nodeChanges.push({ recordType: 'node_change', change: 'removed', key, before: { id: old.id, range: old.range, ...old.projection }, after: null });
    else if (stable(old.projection) !== stable(current.projection)) nodeChanges.push({ recordType: 'node_change', change: 'modified', key, before: { id: old.id, range: old.range, ...old.projection }, after: { id: current.id, range: current.range, ...current.projection } });
  }
  for (const [key, current] of after.records) if (!before.records.has(key)) nodeChanges.push({ recordType: 'node_change', change: 'added', key, before: null, after: { id: current.id, range: current.range, ...current.projection } });
  for (const [key, edge] of before.edges) if (!after.edges.has(key)) edgeChanges.push({ recordType: 'edge_change', change: 'removed', key, type: edge.type, from: edge.from, to: edge.to, beforeId: edge.id, afterId: null });
  for (const [key, edge] of after.edges) if (!before.edges.has(key)) edgeChanges.push({ recordType: 'edge_change', change: 'added', key, type: edge.type, from: edge.from, to: edge.to, beforeId: null, afterId: edge.id });
  const order = { removed: 0, modified: 1, added: 2 }; nodeChanges.sort((a, b) => order[a.change] - order[b.change] || a.key.localeCompare(b.key)); edgeChanges.sort((a, b) => order[a.change] - order[b.change] || a.key.localeCompare(b.key));
  return { nodeChanges, edgeChanges };
}
function impact(before, after, changes, depth) {
  const adjacency = new Map();
  const add = (from, to, reason) => { const list = adjacency.get(from) ?? []; if (!list.some((item) => item.to === to && item.reason === reason)) list.push({ to, reason }); adjacency.set(from, list); };
  for (const graph of [before, after]) for (const edge of graph.edges.values()) {
    if (edge.type === 'CONTAINS') add(edge.to, edge.from, 'container');
    else if (edge.type === 'CALLS') add(edge.to, edge.from, 'caller');
    else if (edge.type === 'REACHING_DEF') add(edge.from, edge.to, 'def_use');
  }
  const seeds = new Set(changes.nodeChanges.map((item) => item.key));
  for (const edge of changes.edgeChanges) { seeds.add(edge.from); seeds.add(edge.to); }
  const seen = new Map(); const queue = [...seeds].sort().map((nodeKey) => ({ nodeKey, distance: 0, reason: 'changed' }));
  while (queue.length) {
    const current = queue.shift(); const prior = seen.get(current.nodeKey); if (prior !== undefined && prior <= current.distance) continue;
    seen.set(current.nodeKey, current.distance); if (current.distance >= depth) continue;
    for (const next of (adjacency.get(current.nodeKey) ?? []).sort((a, b) => a.to.localeCompare(b.to) || a.reason.localeCompare(b.reason))) queue.push({ nodeKey: next.to, distance: current.distance + 1, reason: next.reason });
  }
  return [...seen].map(([nodeKey, distance]) => {
    if (seeds.has(nodeKey)) return { recordType: 'impact', nodeKey, distance, reason: 'changed' };
    let reason = 'reachable'; for (const [from, links] of adjacency) if ((seen.get(from) ?? Infinity) + 1 === distance) { const link = links.find((item) => item.to === nodeKey); if (link) { reason = link.reason; break; } }
    return { recordType: 'impact', nodeKey, distance, reason };
  }).sort((a, b) => a.distance - b.distance || a.nodeKey.localeCompare(b.nodeKey));
}

export class AtlasCpgDelta {
  constructor(opts = {}) {
    if (!opts.artifactRoot) throw new TypeError('CPG delta artifactRoot required');
    for (const key of ['maxSourceBytes', 'maxGraphBytes', 'maxDeltaBytes', 'maxImpactDepth', 'maxReachDefPairs']) if (!Number.isSafeInteger(opts[key]) || opts[key] <= 0) throw new TypeError(`${key} must be deployment-derived`);
    const maxScopes = opts.maxScopes ?? 1024;
    const maxScopeDepth = opts.maxScopeDepth ?? 64;
    const maxBindings = opts.maxBindings ?? 4096;
    const maxBindingOccurrences = opts.maxBindingOccurrences ?? 32768;
    if (!Number.isSafeInteger(maxScopes) || maxScopes <= 0) throw new TypeError('maxScopes must be a positive safe integer');
    if (!Number.isSafeInteger(maxScopeDepth) || maxScopeDepth <= 0) throw new TypeError('maxScopeDepth must be a positive safe integer');
    if (!Number.isSafeInteger(maxBindings) || maxBindings <= 0) throw new TypeError('maxBindings must be a positive safe integer');
    if (!Number.isSafeInteger(maxBindingOccurrences) || maxBindingOccurrences <= 0) throw new TypeError('maxBindingOccurrences must be a positive safe integer');
    this.artifactRoot = opts.artifactRoot; this.maxDeltaBytes = opts.maxDeltaBytes; this.maxImpactDepth = opts.maxImpactDepth; this.now = opts.now ?? Date.now; this.record = opts.record ?? null;
    mkdirSync(this.artifactRoot, { recursive: true, mode: 0o700 }); this.cpg = new AtlasCpgSlice({ artifactRoot: join(this.artifactRoot, 'graphs'), maxSourceBytes: opts.maxSourceBytes, maxArtifactBytes: opts.maxGraphBytes, maxReachDefPairs: opts.maxReachDefPairs, maxScopes, maxScopeDepth, maxBindings, maxBindingOccurrences, now: this.now, record: this.record });
  }
  card() { return Object.freeze({ name: 'atlas-cpg-delta', version: '0.1.0', underlying: this.cpg.card().underlying, bindingModel: BINDING_MODEL, graphSchemaVersion: 3, deltaSchemaVersion: 2, ops: { 'cpg.delta': { deterministic: true, latency_class: 'interactive', side_effects: 'writes_content_addressed_artifacts', reverifiable: true } }, limitations: ['semantic keys use named occurrence ordinals', 'impact is graph reachability, not behavioral proof', ...this.cpg.card().limitations] }); }
  async invoke(op, args, ctx) {
    if (op !== 'cpg.delta') throw typed('unsupported CPG delta operation', 'unsupported_op'); if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required');
    const depth = args?.impactDepth ?? this.maxImpactDepth; if (!Number.isSafeInteger(depth) || depth < 0 || depth > this.maxImpactDepth) throw typed('impact depth exceeds deployment ceiling', 'impact_depth_exceeded'); abort(ctx); const started = this.now();
    this.record?.({ kind: 'capability.op.started', actor: ctx.actor ?? 'orchestrator', op, beforePath: args.beforePath, afterPath: args.afterPath, impactDepth: depth });
    const beforeResult = await this.cpg.invoke('cpg.build', { path: args.beforePath }, { root: ctx.beforeRoot, budgetTokens: 1, signal: ctx.signal, actor: ctx.actor }); abort(ctx);
    const afterResult = await this.cpg.invoke('cpg.build', { path: args.afterPath }, { root: ctx.afterRoot, budgetTokens: 1, signal: ctx.signal, actor: ctx.actor }); abort(ctx);
    const beforeLoaded = loadGraph(beforeResult); const afterLoaded = loadGraph(afterResult); const before = semanticGraph(beforeLoaded.graph); const after = semanticGraph(afterLoaded.graph); const changes = compare(before, after); const affected = impact(before, after, changes, depth);
    const artifact = { schemaVersion: 2, bindingModel: BINDING_MODEL, op, impactDepth: depth, before: { path: args.beforePath, sourceDigest: beforeLoaded.graph.sourceDigest, graphDigest: beforeLoaded.ref.digest }, after: { path: args.afterPath, sourceDigest: afterLoaded.graph.sourceDigest, graphDigest: afterLoaded.ref.digest }, parseErrors: { before: beforeLoaded.graph.parseErrors, after: afterLoaded.graph.parseErrors }, nodeChanges: changes.nodeChanges, edgeChanges: changes.edgeChanges, impact: affected };
    const serialized = `${JSON.stringify(artifact)}\n`; const deltaDigest = sha(serialized); if (Buffer.byteLength(serialized) > this.maxDeltaBytes) throw typed('CPG delta exceeds artifact budget', 'delta_too_large'); const path = join(this.artifactRoot, `${deltaDigest}.json`); if (existsSync(path) && sha(readFileSync(path)) !== deltaDigest) throw typed('CPG delta artifact integrity failure', 'artifact_integrity'); if (!existsSync(path)) writeFileSync(path, serialized, { mode: 0o600, flag: 'wx' });
    const items = [...changes.nodeChanges, ...changes.edgeChanges, ...affected]; const payload = bounded(items, ctx.budgetTokens); const truncated = payload.length < items.length; const partial = artifact.parseErrors.before.length + artifact.parseErrors.after.length > 0; const status = truncated ? 'needs_resume' : partial ? 'partial' : 'ok'; const counts = { nodesAdded: changes.nodeChanges.filter((item) => item.change === 'added').length, nodesRemoved: changes.nodeChanges.filter((item) => item.change === 'removed').length, nodesModified: changes.nodeChanges.filter((item) => item.change === 'modified').length, edgesAdded: changes.edgeChanges.filter((item) => item.change === 'added').length, edgesRemoved: changes.edgeChanges.filter((item) => item.change === 'removed').length, impacted: affected.length };
    const wallMs = Math.max(0, this.now() - started); const result = Object.freeze({ op, status, summary: `${counts.nodesAdded} nodes added, ${counts.nodesRemoved} removed, ${counts.nodesModified} modified; ${counts.impacted} impacted`, payload, refs: [{ handle: `art:sha256:${deltaDigest}`, kind: 'cpg_delta', digest: deltaDigest, bytes: Buffer.byteLength(serialized), mediaType: 'application/vnd.baton.atlas-cpg-delta+json', path }, beforeLoaded.ref, afterLoaded.ref], ...(truncated ? { cursor: `atlas-cpg-delta:${deltaDigest}:${payload.length}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: wallMs, usd: 0, underlying: this.cpg.card().underlying[0] }, provenance: { beforeSourceDigest: artifact.before.sourceDigest, afterSourceDigest: artifact.after.sourceDigest, beforeGraphDigest: artifact.before.graphDigest, afterGraphDigest: artifact.after.graphDigest, deltaDigest, impactDepth: depth, counts, parseErrors: { before: artifact.parseErrors.before.length, after: artifact.parseErrors.after.length }, deterministic: true, impactMeaning: 'binding_aware_seed_graph_reachability_not_behavioral_proof', bindingModel: BINDING_MODEL } });
    this.record?.({ kind: 'capability.op.completed', actor: ctx.actor ?? 'orchestrator', op, deltaDigest, status, counts, wallMs }); return result;
  }
  async resume(ref, cursor, ctx) {
    if (!ctx || !Number.isSafeInteger(ctx.budgetTokens) || ctx.budgetTokens <= 0) throw new TypeError('positive budgetTokens required'); const match = /^atlas-cpg-delta:([a-f0-9]{64}):(\d+)$/.exec(cursor ?? ''); if (!match || match[1] !== ref?.digest) throw typed('invalid CPG delta cursor', 'invalid_cursor'); let path; try { path = realpathSync(ref.path); } catch { throw typed('CPG delta artifact unavailable', 'artifact_integrity'); } const root = realpathSync(this.artifactRoot); if (path !== join(root, `${ref.digest}.json`)) throw typed('CPG delta artifact escape', 'artifact_integrity'); const bytes = readFileSync(path); if (sha(bytes) !== ref.digest) throw typed('CPG delta artifact digest mismatch', 'artifact_integrity'); let artifact; try { artifact = JSON.parse(bytes); } catch { throw typed('CPG delta artifact JSON invalid', 'artifact_integrity'); } if (artifact.schemaVersion !== 2 || artifact.bindingModel !== BINDING_MODEL || artifact.op !== 'cpg.delta' || !Array.isArray(artifact.nodeChanges) || !Array.isArray(artifact.edgeChanges) || !Array.isArray(artifact.impact)) throw typed('CPG delta artifact schema mismatch', 'artifact_integrity'); const items = [...artifact.nodeChanges, ...artifact.edgeChanges, ...artifact.impact]; const offset = Number(match[2]); if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) throw typed('invalid CPG delta cursor offset', 'invalid_cursor'); const payload = bounded(items.slice(offset), ctx.budgetTokens); const next = offset + payload.length; const truncated = next < items.length; return Object.freeze({ op: 'cpg.delta', status: truncated ? 'needs_resume' : 'ok', summary: `resumed ${payload.length} CPG delta records`, payload, refs: [ref], ...(truncated ? { cursor: `atlas-cpg-delta:${ref.digest}:${next}` } : {}), cost: { tokens_out: Math.ceil(Buffer.byteLength(JSON.stringify(payload)) / 4), wall_ms: 0, usd: 0, underlying: this.cpg.card().underlying[0] }, provenance: { deltaDigest: ref.digest, resumed_from: offset, deterministic: true, bindingModel: BINDING_MODEL } });
  }
  async reverify(claim, op, args, ctx) { const rerun = await this.invoke(op, args, ctx); return Object.freeze({ ok: rerun.provenance.deltaDigest === claim?.provenance?.deltaDigest && rerun.provenance.bindingModel === claim?.provenance?.bindingModel, observedDeltaDigest: rerun.provenance.deltaDigest, observedBindingModel: rerun.provenance.bindingModel }); }
}

// Manifest-bound declared dependency graph.
//
// This module performs NO source parsing. The dependency edges are admitted,
// reviewed input bound to per-module digests: the graph file names, for each
// module of the frozen producer, the modules it imports. Admission resolves the
// closure from that declaration and validates every module's digest against the
// admitted manifest.
//
// Scope, stated plainly: this suite makes no claim about arbitrary source. It
// establishes that the modules it executed are exactly the admitted ones and
// that each has the admitted digest. A source change invalidates the graph
// because the digest changes; a graph that omits a real edge is not detected by
// digest alone, which is why the graph is reviewed and admitted rather than
// inferred. An earlier revision tried to infer edges from source text and
// refused valid source such as `import.meta.url`; that approach is removed.
//
// Graph file shape:
//   {"version":1,"modules":{"bootstrap.mjs":["bootstrap-admission.mjs"], ...}}

import { existsSync, readFileSync } from 'node:fs';

export class GraphRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'GraphRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

export function parseGraph(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new GraphRefusal('graphMalformed', error.message);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GraphRefusal('graphMalformed', 'root is not an object');
  }
  if (parsed.version !== 1) throw new GraphRefusal('graphVersion', String(parsed.version));
  const modules = parsed.modules;
  if (typeof modules !== 'object' || modules === null || Array.isArray(modules)) {
    throw new GraphRefusal('graphMalformed', 'modules is not an object');
  }
  const declared = new Map();
  for (const [name, edges] of Object.entries(modules)) {
    if (typeof name !== 'string' || name.length === 0) throw new GraphRefusal('graphMalformed', 'empty module name');
    if (!Array.isArray(edges)) throw new GraphRefusal('graphMalformed', `${name} edges are not an array`);
    const seen = new Set();
    for (const edge of edges) {
      if (typeof edge !== 'string' || edge.length === 0) {
        throw new GraphRefusal('graphMalformed', `${name} has a non-string edge`);
      }
      if (edge === name) throw new GraphRefusal('graphSelfEdge', name);
      if (seen.has(edge)) throw new GraphRefusal('graphDuplicateEdge', `${name} -> ${edge}`);
      seen.add(edge);
    }
    declared.set(name, [...edges]);
  }
  if (declared.size === 0) throw new GraphRefusal('graphEmpty', null);
  return declared;
}

export function loadGraph(path) {
  if (!existsSync(path)) throw new GraphRefusal('graphMissing', path);
  return parseGraph(readFileSync(path, 'utf8'));
}

// Breadth-first closure over the DECLARED edges. Reports an entry that is not
// declared and an edge that names an undeclared module, so an incomplete graph
// refuses instead of silently under-covering.
export function resolveDeclaredClosure(declared, entryNames) {
  const visited = new Set();
  const undeclaredEntries = [];
  const undeclaredEdges = [];
  const queue = [...entryNames];
  for (const entry of entryNames) if (!declared.has(entry)) undeclaredEntries.push(entry);
  while (queue.length > 0) {
    const name = queue.shift();
    if (visited.has(name) || !declared.has(name)) continue;
    visited.add(name);
    for (const edge of declared.get(name)) {
      if (!declared.has(edge)) undeclaredEdges.push(`${name} -> ${edge}`);
      else if (!visited.has(edge)) queue.push(edge);
    }
  }
  return {
    files: [...visited].sort(),
    undeclaredEntries,
    undeclaredEdges,
    source: 'declared reviewed graph; no source parsing',
  };
}

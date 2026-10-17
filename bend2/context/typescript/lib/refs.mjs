// Source refs and evidence for TypeScript results.
//
// Every ref names one supported subject selector and the projections admitted for it. The id is
// the canonical JSON array of that selector's fields and is opaque to consumers; a ref never
// introduces a subject kind of its own. Evidence is always source-bound: the captured file, its
// sha256 and the zero-based UTF-16 range of the exact token the producer read.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sourceRefId(real, sha256, line, column, projection) {
  return JSON.stringify(['source', real, sha256, line, column, projection]);
}

export function sourceRef({ real, sha256, line, column, projection, snapshotId }) {
  return {
    id: sourceRefId(real, sha256, line, column, projection),
    engine: 'typescript',
    subject: { kind: 'position', path: real, line, column },
    snapshotId,
    projections: [projection],
  };
}

export function sourceEvidence({ real, sha256, start, end, role }) {
  return {
    kind: 'source',
    path: real,
    sha256,
    range: {
      start: { line: start.line, column: start.column },
      end: { line: end.line, column: end.column },
    },
    role,
  };
}

let nodeDigest = null;

// The executable provenance of an in-process provider operation: the absolute node binary that
// ran, its digest, its version, and the operation the language service performed. The library
// identity the operation used is carried by the provider record of each checked fact.
export function probeEvidence({ operation, node }) {
  if (nodeDigest === null) {
    nodeDigest = createHash('sha256').update(readFileSync(node)).digest('hex');
  }
  return {
    kind: 'probe',
    executable: node,
    sha256: nodeDigest,
    version: process.version,
    operation,
  };
}

export function providerRecord(resolved) {
  return {
    name: 'typescript',
    version: resolved.version,
    libraryPath: resolved.libraryPath,
    librarySha: resolved.librarySha,
    node: resolved.node,
    runtime: resolved.runtime,
  };
}

// A fact or relation with its required nonempty evidence. The builders keep every producer from
// publishing an unsupported claim: classification and evidence are mandatory arguments.
export function fact({ id, kind, classification, value, evidence, limits = [] }) {
  return { id, kind, classification, value, evidence, limits };
}

export function relation({ id, kind, classification, from, to, value, evidence, limits = [] }) {
  return { id, kind, classification, from, to, value, evidence, limits };
}

export function limit(projection, code, detail) {
  return { projection, code, detail };
}

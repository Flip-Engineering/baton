// Run TypeScript analysis over captured files and return facts, references and input identities.
// A changed captured input returns changedDuringCapture with the query failure.

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createCapture } from './capture.mjs';
import { createService } from './service.mjs';
import { produceCallers, produceCalls, produceDefinition, produceDependencies, produceReferences, produceType } from './bindings.mjs';
import { produceDiagnostics } from './diagnostics.mjs';
import { produceExceptions, produceFlow } from './flow.mjs';
import { produceDatabaseAccesses, produceModuleUses } from './sql.mjs';
import { providerRecord } from './refs.mjs';

const SNAPSHOT_PENDING = 'pending';

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Every published object carries the identity of the complete input closure. Producers run before
// the closure is final, so they stamp the pending marker and this pass replaces it once, after
// the last read, with the identity computed over every captured input.
function bindSnapshotId(node, snapshotId) {
  if (Array.isArray(node)) {
    for (const item of node) bindSnapshotId(item, snapshotId);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'snapshotId' && (value === SNAPSHOT_PENDING || value === null || value === undefined)) {
      node[key] = snapshotId;
    } else {
      bindSnapshotId(value, snapshotId);
    }
  }
}

export function runQuery({ resolved, request, queryId = null, supplied = null, capture: injectedCapture = null }) {
  const capture = injectedCapture ?? createCapture({
    cwd: request.cwd,
    readRoots: request.options.readRoots,
    providerRoots: [resolved.contextRoot],
    supplied,
  });
  const service = createService({ resolved, capture, request });

  const context = {
    ts: service.ts,
    service,
    capture,
    resolved,
    request,
    snapshotId: SNAPSHOT_PENDING,
    queryId,
  };

  const facts = [];
  const relations = [];
  const refs = [];
  const limits = [...service.limits];
  const projections = new Set(request.select);

  const collect = (produced) => {
    if (produced === undefined) return;
    facts.push(...(produced.facts ?? []));
    relations.push(...(produced.relations ?? []));
    refs.push(...(produced.refs ?? []));
    limits.push(...(produced.limits ?? []));
  };

  if (projections.has('definition') || projections.has('type')) {
    if (projections.has('definition')) collect(produceDefinition(context));
    if (projections.has('type')) collect(produceType(context));
  }
  if (projections.has('references')) collect(produceReferences(context));
  if (projections.has('calls')) collect(produceCalls(context));
  if (projections.has('callers')) collect(produceCallers(context));
  if (projections.has('dependencies')) {
    collect(produceDependencies(context));
    collect(produceModuleUses(context));
  }
  if (projections.has('diagnostics')) collect(produceDiagnostics(context));
  if (projections.has('flow')) collect(produceFlow(context));
  if (projections.has('exceptions')) collect(produceExceptions(context));
  if (projections.has('databaseAccesses')) collect(produceDatabaseAccesses(context));

  // The captured bytes and answers are the query inputs: no post-capture probe runs, because a later
  // host write does not change what this result describes.
  const uniqueRefs = [];
  const seenRefs = new Set();
  for (const ref of refs) {
    if (seenRefs.has(ref.id)) continue;
    seenRefs.add(ref.id);
    uniqueRefs.push(ref);
  }

  // Identity over the closure the producers actually consumed, computed only now.
  const descriptors = capture.descriptors();
  const identityDocument = {
    version: 1,
    engine: 'typescript',
    provider: { name: 'typescript', version: resolved.version, librarySha: resolved.librarySha },
    effectiveOptions: service.effective,
    inputs: descriptors,
  };
  const snapshotId = sha256Text(JSON.stringify(identityDocument));

  const envelope = {
    version: 1,
    engine: 'typescript',
    query: queryId,
    provider: providerRecord(resolved),
    subject: request.subject,
    snapshot: {
      snapshotId,
      // Worktree metadata is composed by core over the recorded workspace; the provider reports
      // the captured input identities it actually consumed.
      worktree: null,
      effectiveOptions: service.effective,
      provider: providerRecord(resolved),
      inputs: descriptors,
    },
    facts,
    relations,
    refs: uniqueRefs,
    limits,
    coverage: {
      examined: descriptors.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path),
      excluded: descriptors.filter((entry) => entry.kind === 'absent').map((entry) => entry.path),
      providerCompletion: true,
      unsupported: [],
    },
    applicability: 'current',
    changedInputs: [],
  };
  bindSnapshotId(envelope, snapshotId);
  return envelope;
}

export function subjectPathFor(request) {
  return resolve(request.cwd, request.subject.path);
}

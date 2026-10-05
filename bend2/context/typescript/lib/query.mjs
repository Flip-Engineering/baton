// One TypeScript query: capture, analyze, verify, and build the result envelope.
//
// The capture is taken before the language service runs and revalidated after it, so a result is
// published only when the bytes the compiler consumed are the bytes still on disk. A change
// between the two observations refuses with changedDuringCapture instead of publishing a
// single-snapshot claim.

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createCapture } from './capture.mjs';
import { createService, optionIdentity } from './service.mjs';
import { produceCallers, produceCalls, produceDefinition, produceDependencies, produceReferences, produceType } from './bindings.mjs';
import { produceDiagnostics } from './diagnostics.mjs';
import { produceExceptions, produceFlow } from './flow.mjs';
import { produceDatabaseAccesses, produceModuleUses } from './sql.mjs';
import { providerRecord } from './refs.mjs';
import { Refusal } from './protocol.mjs';

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function runQuery({ resolved, request, queryId = null }) {
  const capture = createCapture({
    cwd: request.cwd,
    readRoots: request.options.readRoots,
    providerRoots: [resolved.libraryDir],
  });
  const service = createService({ resolved, capture, request });

  const identityDocument = {
    version: 1,
    engine: 'typescript',
    provider: { name: 'typescript', version: resolved.version, librarySha: resolved.librarySha },
    effectiveOptions: service.effective,
    inputs: capture.descriptors(),
  };
  const snapshotId = sha256Text(JSON.stringify(identityDocument));

  const context = {
    ts: service.ts,
    service,
    capture,
    resolved,
    request,
    snapshotId,
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

  // Pre/post verification: the published result is a claim about one immutable input closure.
  const revalidation = capture.revalidate();
  if (revalidation.failed.length > 0) {
    throw new Refusal('context-capture-probe-failed');
  }
  if (revalidation.changed.length > 0) {
    throw new Refusal('changedDuringCapture');
  }

  const uniqueRefs = [];
  const seenRefs = new Set();
  for (const ref of refs) {
    if (seenRefs.has(ref.id)) continue;
    seenRefs.add(ref.id);
    uniqueRefs.push(ref);
  }

  const descriptors = capture.descriptors();
  return {
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
}

export function subjectPathFor(request) {
  return resolve(request.cwd, request.subject.path);
}

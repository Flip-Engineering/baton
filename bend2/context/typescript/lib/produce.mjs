// Record the files, configuration, missing paths and directory listings consulted by TypeScript.

import { createHash } from 'node:crypto';
import { loadEncoder } from './encoder.mjs';
import { createCapture } from './capture.mjs';
import { runQuery, subjectPathFor } from './query.mjs';
import { resolveTypeScript } from './resolve.mjs';

// The declared capture roles for this lane.
const SOURCE_ROLE = 'frontend-source';
const CONFIG_ROLE = 'frontend-config';

function refused(reason, detail) {
  return detail === undefined
    ? Object.freeze({ status: 'refused', reason })
    : Object.freeze({ status: 'refused', reason, detail });
}

function roleOf(path) {
  return path.endsWith('.json') ? CONFIG_ROLE : SOURCE_ROLE;
}

// The digest of a recorded listing, computed the way the capture host computes it, so a directory record
// and a directory the compiler listed describe the same membership.
function listingDigest(names) {
  return createHash('sha256').update(Buffer.from([...names].sort().join('\n'), 'utf8')).digest('hex');
}

// The producer export a context caller invokes before the plan freezes: every input this step's analysis
// consults, encoded once, with the producing triple attached from the frozen step the caller supplies.
export async function captureInputs(invocation, options = {}) {
  try {
    const encoder = await loadEncoder();
    if (encoder === null) return refused('encoderUnavailable');
    if (invocation === null || typeof invocation !== 'object') return refused('invocationMissing');
    const request = invocation.request;
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return refused('requestMissing');
    const binding = invocation.moduleBinding;
    if (binding === null || typeof binding !== 'object') return refused('moduleBindingMissing');
    for (const member of ['id', 'declarationDigest', 'operation']) {
      if (typeof binding[member] !== 'string' || binding[member].length === 0) return refused('moduleBindingIncomplete', member);
    }
    const resolved = resolveTypeScript({ compilerPath: options.compilerPath ?? null });
    if (!resolved.ok) return refused('typescriptUnavailable', resolved.reason);

    const cwd = typeof options.cwd === 'string' && options.cwd.length > 0 ? options.cwd : request.cwd;
    // The subject is checked for shape here and read by the query path below, through the capture host, so
    // a missing subject is a live acquisition failure of the run rather than a second host probe.
    const entry = subjectPathFor({ ...request, cwd });
    if (typeof entry !== 'string' || entry.length === 0) return refused('subjectPathMissing');

    // An ordinary capture host: it reads the filesystem and records every answer it gives, so the
    // service below consults the host and the host keeps the closure the analysis really used.
    const options0 = request.options ?? {};
    const capture = createCapture({
      cwd,
      readRoots: options0.readRoots ?? [],
      providerRoots: [resolved.contextRoot],
    });

    // The service the query builds, with the request's own configuration, and then the projections the
    // request asks for, through the existing query path with this capture injected: constructing the
    // service and running the producers both read through the host, so the recorded closure is the one
    // the analysis really consults, including the reads only the projection producers perform. A refusal
    // the query raises — a changed input during capture, a failed capture probe, an acquisition failure —
    // travels to the caller below and becomes this producer's refusal, because a partial or changed
    // acquisition is not an answer to encode.
    runQuery({
      resolved,
      request: {
        ...request,
        cwd,
        options: {
          ...options0,
          project: options0.project ?? '',
          readRoots: options0.readRoots ?? [],
          database: options0.database ?? null,
          client: options0.client ?? null,
        },
      },
      queryId: invocation.query,
      supplied: null,
      capture,
    });

    const producer = { module: binding.id, digest: binding.declarationDigest, operation: binding.operation };
    const captures = [];
    const encode = (path, bytes, kind) => {
      const record = encoder.captureRecord({ identity: path, bytes, role: roleOf(path), kind, producer });
      if (record.status !== undefined) return record;
      captures.push(record);
      return null;
    };

    for (const answer of capture.answers()) {
      if (answer.kind === 'file' || answer.kind === 'config') {
        const failed = encode(answer.path, answer.bytes, answer.kind === 'config' ? 'config' : 'file');
        if (failed !== null) return failed;
        continue;
      }
      if (answer.kind === 'absent') {
        const record = encoder.captureRecord({ identity: answer.path, kind: 'absent', producer });
        if (record.status !== undefined) return record;
        captures.push(record);
        continue;
      }
      if (answer.kind === 'directory') {
        const record = encoder.captureRecord({
          identity: answer.path,
          kind: 'dir',
          marker: listingDigest(answer.names),
          names: answer.names,
          role: CONFIG_ROLE,
          producer,
        });
        if (record.status !== undefined) return record;
        captures.push(record);
        continue;
      }
      // A probe that raised is not an answer the analysis can replay: the plan would be incomplete.
      return refused('captureInputUnreadable', `${answer.path}: ${answer.detail ?? 'unreadable'}`);
    }

    return Object.freeze({
      status: 'captured',
      query: invocation.query,
      owner: invocation.owner,
      moduleBinding: binding,
      captures: Object.freeze(captures),
      limits: Object.freeze({ encoder: 'bend2/context/bend2/capture-records.mjs' }),
    });
  } catch (error) {
    return refused(error.condition ?? error.code ?? error.name, error.message);
  }
}

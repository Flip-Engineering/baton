import { createHash } from 'node:crypto';

const SAFE_COORDINATION_KINDS = new Set([
  'artifact.registered', 'artifact.superseded',
  'context.call_admitted', 'context.call_settled', 'context.cell_admitted',
  'context.cell_settled', 'context.session_admitted',
  'evidence.mapped', 'goal.version_defined', 'plan.approval_decided',
  'plan.node_budget_settled', 'plan.node_dispatched', 'plan.version_proposed',
  'run.control_admitted', 'run.control_effect_started', 'run.control_provider_acked',
  'run.control_settled', 'run.lineage_admitted', 'run.orchestrator_lease_issued',
  'run.orchestrator_lease_revoked', 'run.result_adoption_admitted',
  'run.result_adoption_completed', 'run.result_export_admitted',
  'run.result_export_completed', 'run.sealed', 'run.stop_admitted', 'run.stop_completed',
  'run.verification_retry_admitted', 'run.verification_retry_completed',
  'task.acceptance_revoked', 'task.claimed', 'task.created', 'task.resources_released',
  'task.transitioned',
]);

const SAFE_OPERATIONAL_KINDS = new Set([
  'content.file_edit', 'content.message', 'content.tool_call',
  'control.delivery_amended', 'control.delivery_refused', 'control.delivery_requested',
  'control.follow_up_requested', 'control.interrupt_confirmed',
  'control.interaction_superseded', 'control.interrupt_requested',
  'control.session_preservation_reattached',
  'control.stale_rejected',
  'kill.confirmed', 'kill.requested',
  'lifecycle.crashed', 'lifecycle.process_closed', 'lifecycle.process_ready',
  'lifecycle.process_reap_unconfirmed', 'lifecycle.process_started', 'lifecycle.spawned',
  'lifecycle.turn_completed', 'lifecycle.turn_started',
  'resource.provider_call', 'resource.tokens', 'verify.reverified', 'work.resumed',
]);

const SAFE_FACT_FIELDS = new Set([
  'accept', 'accepted', 'alreadyTerminal', 'attempt', 'byteCount', 'decision',
  'dispatchClosed', 'fileCount', 'from',
  'interactionsResolved', 'killConfirmed', 'outcome', 'pendingCancelled', 'phase',
  'processesClosed', 'processesObserved', 'remainingCount', 'result',
  'runAuthorityReleased', 'state', 'status', 'targetCount', 'terminal', 'to',
]);

const SUMMARIES = Object.freeze({
  'content.file_edit': 'Provider work changed repository content.',
  'content.message': 'Provider work emitted output.',
  'content.tool_call': 'Provider work completed a tool activity.',
  'lifecycle.crashed': 'Provider work crashed.',
  'lifecycle.process_closed': 'A provider process closed.',
  'lifecycle.process_ready': 'A provider process became ready.',
  'lifecycle.process_started': 'A provider process started.',
  'lifecycle.spawned': 'Provider work was spawned.',
  'lifecycle.turn_completed': 'A provider turn completed.',
  'lifecycle.turn_started': 'A provider turn started.',
  'run.control_admitted': 'Run control was durably admitted.',
  'run.control_effect_started': 'Run control crossed its provider-effect boundary.',
  'run.control_provider_acked': 'The provider acknowledged Run control.',
  'run.control_settled': 'Run control settled.',
  'control.interrupt_requested': 'One exact provider turn interruption was requested.',
  'control.interaction_superseded': 'A blocked interaction was durably superseded for semantic interrupt.',
  'control.interrupt_confirmed': 'One exact provider turn interruption was confirmed.',
  'control.session_preservation_reattached': 'The exact preserved provider session was reattached.',
  'run.result_adoption_admitted': 'Run result adoption was durably admitted.',
  'run.result_adoption_completed': 'Run result adoption completed.',
  'run.result_export_admitted': 'Run result export was durably admitted.',
  'run.result_export_completed': 'Run result export completed.',
  'run.stop_admitted': 'Run stop was durably admitted.',
  'run.stop_completed': 'Run stop completed with cleanup evidence.',
  'run.verification_retry_admitted': 'Run result verification retry was durably admitted.',
  'run.verification_retry_completed': 'Run result verification retry completed.',
  'task.claimed': 'Run work was claimed.',
  'task.created': 'Run work was created.',
  'task.transitioned': 'Run work changed lifecycle state.',
  'verify.reverified': 'Repository verification was observed.',
});

export class RunTimelineError extends Error {
  constructor(message, code = 'run_timeline_invalid') {
    super(message);
    this.name = 'RunTimelineError';
    this.code = code;
  }
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}

function safeScalar(value) {
  return typeof value === 'boolean' || (Number.isSafeInteger(value) && Math.abs(value) <= 1e12)
    || (typeof value === 'string' && value.length <= 64 && /^[A-Za-z0-9._:-]+$/u.test(value));
}

function safeFacts(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const receipt = payload.receipt && typeof payload.receipt === 'object' ? payload.receipt : {};
  const source = {
    ...payload, ...receipt,
    ...(receipt.counts && typeof receipt.counts === 'object' ? receipt.counts : {}),
    ...(receipt.checks && typeof receipt.checks === 'object' ? receipt.checks : {}),
  };
  const facts = {};
  for (const key of [...SAFE_FACT_FIELDS].sort()) {
    if (safeScalar(source[key])) facts[key] = source[key];
  }
  const context = receipt.context && typeof receipt.context === 'object'
    && !Array.isArray(receipt.context) ? receipt.context : {};
  for (const key of [
    'targetSessionCount', 'targetCellCount', 'targetCallCount',
    'remainingSessionCount', 'remainingCellCount', 'remainingCallCount',
  ]) {
    if (safeScalar(context[key])) facts[key] = context[key];
  }
  if (source.result && typeof source.result === 'object' && !Array.isArray(source.result)) {
    for (const key of ['state', 'status', 'outcome']) {
      if (safeScalar(source.result[key])) facts[`result${key[0].toUpperCase()}${key.slice(1)}`] = source.result[key];
    }
  }
  const outcome = source.outcome && typeof source.outcome === 'object'
    && !Array.isArray(source.outcome) ? source.outcome : {};
  const preservation = source.preservation && typeof source.preservation === 'object'
    && !Array.isArray(source.preservation) ? source.preservation
    : outcome.preservation && typeof outcome.preservation === 'object'
      && !Array.isArray(outcome.preservation) ? outcome.preservation : null;
  if (preservation) {
    if (safeScalar(preservation.state)) facts.preservationState = preservation.state;
    if (safeScalar(preservation.transport)) facts.preservationTransport = preservation.transport;
    if (safeScalar(preservation.reattachment)) facts.reattachment = preservation.reattachment;
  }
  const totalTokens = source.totalTokens ?? source.payload?.totalTokens;
  if (Number.isSafeInteger(totalTokens) && totalTokens >= 0) {
    facts.tokenCount = totalTokens;
  }
  return facts;
}

function category(kind) {
  if (kind.startsWith('run.stop_') || kind.startsWith('kill.')
    || kind.startsWith('lifecycle.process_')) return 'cleanup';
  if (kind.startsWith('run.control_') || kind.startsWith('control.')) return 'control';
  if (kind.startsWith('plan.') || kind.startsWith('goal.')) return 'plan';
  if (kind.startsWith('verify.')) return 'verification';
  if (kind.startsWith('resource.')) return 'resource';
  if (kind.startsWith('content.')) return 'work';
  if (kind.startsWith('context.')) return 'context';
  if (kind.startsWith('run.result_') || kind === 'run.sealed') return 'result';
  if (kind.startsWith('run.verification_')) return 'verification';
  if (kind.startsWith('run.lineage_') || kind.startsWith('run.orchestrator_')) return 'orchestration';
  return 'lifecycle';
}

function summary(kind) {
  return SUMMARIES[kind] ?? `${kind.replaceAll('.', ' ')} occurred for this Run.`;
}

function taskMaps(snapshot) {
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const byId = new Map();
  const byWorker = new Map();
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || !validId(task.id)) continue;
    byId.set(task.id, task);
    for (const worker of [task.assignee, task.reservedWorkerId]) {
      if (validId(worker)) byWorker.set(worker, task);
    }
  }
  return { byId, byWorker };
}

function taskRun(task) {
  return task?.runId ?? task?.brief?.runId ?? task?.brief?.goalPlan?.runId ?? null;
}

function taskRecipient(task) {
  for (const candidate of [task?.role, task?.workflowRole, task?.brief?.role]) {
    if (validId(candidate)) return candidate;
  }
  return 'work';
}

function explicitRunIds(payload) {
  const values = [
    payload?.runId, payload?.goal?.runId, payload?.plan?.runId, payload?.authority?.runId,
    payload?.binding?.runId, payload?.parentRunId, payload?.childRunId, payload?.rootRunId,
    payload?.parent?.runId, payload?.receipt?.runId, payload?.session?.runId,
    payload?.task?.runId,
  ];
  if (Array.isArray(payload?.targetRunIds)) values.push(...payload.targetRunIds);
  if (Array.isArray(payload?.ancestors)) values.push(...payload.ancestors);
  return new Set(values.filter(validId));
}

function eventTask(payload, maps) {
  const id = payload?.taskId ?? payload?.id ?? payload?.target?.taskId
    ?? payload?.task?.id ?? payload?.binding?.taskId;
  return validId(id) ? maps.byId.get(id) ?? null : null;
}

function verifyOperational(mapped, operational) {
  if (!operational || typeof operational !== 'object'
    || operational.worker !== mapped.worker || operational.seq !== mapped.workerSeq
    || operational.kind !== mapped.kind || operational.ts !== mapped.ts
    || digest(operational) !== mapped.digest) {
    throw new RunTimelineError('mapped operational evidence failed integrity verification',
      'run_timeline_evidence_mismatch');
  }
}

function splitUtf8(text, maxBytes) {
  const fragments = [];
  let fragment = '';
  let bytes = 0;
  for (const point of text) {
    const pointBytes = Buffer.byteLength(point);
    if (bytes > 0 && bytes + pointBytes > maxBytes) {
      fragments.push(fragment);
      fragment = '';
      bytes = 0;
    }
    fragment += point;
    bytes += pointBytes;
  }
  if (fragment.length > 0 || text.length === 0) fragments.push(fragment);
  return fragments;
}

function cursorDigest(frames, position) {
  return digest(frames.slice(0, position).map((frame) => frame.occurrenceDigest));
}

function encodeCursor(runId, mode, position, prefixDigest) {
  return Buffer.from(JSON.stringify({ v: 1, r: runId, m: mode, p: position, d: prefixDigest }))
    .toString('base64url');
}

function decodeCursor(value, runId, mode, frames) {
  if (value === null || value === undefined) return 0;
  let decoded;
  try { decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new RunTimelineError('Run timeline cursor is invalid', 'run_timeline_cursor_invalid'); }
  if (!decoded || decoded.v !== 1 || decoded.r !== runId || decoded.m !== mode
    || !Number.isSafeInteger(decoded.p) || decoded.p < 0 || decoded.p > frames.length
    || !/^[a-f0-9]{64}$/u.test(decoded.d ?? '')
    || decoded.d !== cursorDigest(frames, decoded.p)) {
    throw new RunTimelineError('Run timeline cursor does not match durable history',
      'run_timeline_cursor_mismatch');
  }
  return decoded.p;
}

function safeFrame(runId, coordination, kind, at, payload, recipient = null) {
  const occurrenceDigest = digest({ runId, coordinationDigest: digest(coordination), kind });
  return {
    runId, category: category(kind), kind, at,
    summary: summary(kind), occurrenceTrust: 'authoritative', occurrenceDigest,
    ...(recipient ? { recipient } : {}),
    facts: safeFacts(payload),
  };
}

function timelineFrames({
  runId, events, snapshot, includeOutput, maxFragmentBytes, resolveOperational,
  recipient: recipientFilter, taskIds: taskFilter,
}) {
  const maps = taskMaps(snapshot);
  const frames = [];
  for (const coordination of events) {
    if (!coordination || typeof coordination !== 'object' || !Number.isSafeInteger(coordination.seq)) {
      throw new RunTimelineError('coordination timeline input is invalid');
    }
    if (coordination.kind === 'evidence.mapped') {
      if (typeof resolveOperational !== 'function') {
        throw new RunTimelineError('mapped operational evidence requires its authoritative resolver',
          'run_timeline_resolver_required');
      }
      const operational = resolveOperational({
        worker: coordination.payload?.worker, workerSeq: coordination.payload?.workerSeq,
      });
      verifyOperational(coordination.payload ?? {}, operational);
      if (!SAFE_OPERATIONAL_KINDS.has(operational.kind)) continue;
      const task = eventTask(operational, maps) ?? maps.byWorker.get(operational.worker) ?? null;
      const belongs = operational.runId !== null && operational.runId !== undefined
        ? operational.runId === runId : taskRun(task) === runId;
      if (!belongs) continue;
      if (taskFilter !== null && (!task?.id || !taskFilter.has(task.id))) continue;
      const recipient = taskRecipient(task);
      if (includeOutput) {
        if (operational.kind !== 'content.message' || typeof operational.payload?.text !== 'string') continue;
        if (recipientFilter !== null && recipient !== recipientFilter) continue;
        const fullDigest = digest(operational.payload.text);
        const fragments = splitUtf8(operational.payload.text, maxFragmentBytes);
        fragments.forEach((text, fragment) => {
          frames.push({
            runId, category: 'output', kind: 'untrusted_output', at: operational.ts,
            recipient, occurrenceTrust: 'authoritative', contentTrust: 'untrusted_provider',
            occurrenceDigest: digest({ coordination: digest(coordination), fragment }),
            output: { text, fragment, fragmentCount: fragments.length, digest: fullDigest },
          });
        });
      } else {
        frames.push(safeFrame(runId, coordination, operational.kind, operational.ts,
          operational.payload, recipient));
      }
      continue;
    }
    if (includeOutput || !SAFE_COORDINATION_KINDS.has(coordination.kind)) continue;
    const payload = coordination.payload ?? {};
    const task = eventTask(payload, maps);
    const ids = explicitRunIds(payload);
    const boundTaskRun = taskRun(task);
    const belongs = ids.size > 0 && validId(boundTaskRun) && !ids.has(boundTaskRun)
      ? false : ids.has(runId) || (ids.size === 0 && boundTaskRun === runId);
    if (!belongs) continue;
    frames.push(safeFrame(runId, coordination, coordination.kind, coordination.ts,
      payload, task ? taskRecipient(task) : null));
  }
  return frames.map((frame, index) => freeze({ ...frame, position: index + 1 }));
}

export function projectRunTimelinePage({
  runId, events, snapshot, cursor = null, limit = 100, maxBytes = 64 * 1024,
  includeOutput = false, recipient = null, maxFragmentBytes = 4_096,
  resolveOperational = null, taskIds = null,
}) {
  if (!validId(runId) || !Array.isArray(events) || !snapshot || typeof snapshot !== 'object'
    || !Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 4 * 1024 * 1024
    || !Number.isSafeInteger(maxFragmentBytes) || maxFragmentBytes <= 0
    || maxFragmentBytes > Math.max(256, maxBytes - 1_024)
    || typeof includeOutput !== 'boolean'
    || (recipient !== null && !validId(recipient)) || (!includeOutput && recipient !== null)
    || (taskIds !== null && (!Array.isArray(taskIds) || taskIds.length === 0
      || taskIds.some((taskId) => !validId(taskId)) || new Set(taskIds).size !== taskIds.length))
    || (resolveOperational !== null && typeof resolveOperational !== 'function')) {
    throw new RunTimelineError('Run timeline projection options are invalid');
  }
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.seq !== index + 1) {
      throw new RunTimelineError('coordination timeline must be a contiguous durable prefix',
        'run_timeline_ledger_gap');
    }
  }
  const taskFilter = taskIds === null ? null : new Set([...taskIds].sort());
  const mode = includeOutput
    ? `output:${recipient ?? '*'}:${taskIds === null ? '*' : digest([...taskFilter])}` : 'events';
  const frames = timelineFrames({
    runId, events, snapshot, includeOutput, maxFragmentBytes, resolveOperational, recipient,
    taskIds: taskFilter,
  });
  const start = decodeCursor(cursor, runId, mode, frames);
  const items = [];
  for (let index = start; index < frames.length && items.length < limit; index += 1) {
    const candidate = [...items, frames[index]];
    const estimated = Buffer.byteLength(JSON.stringify({
      schemaVersion: 1, kind: 'baton.run_timeline.page', runId, items: candidate,
    }));
    if (estimated > maxBytes) {
      if (items.length === 0) {
        throw new RunTimelineError('one Run timeline item exceeds the response policy',
          'run_timeline_item_oversize');
      }
      break;
    }
    items.push(frames[index]);
  }
  const position = start + items.length;
  return freeze({
    schemaVersion: 1, kind: 'baton.run_timeline.page', runId,
    channel: includeOutput ? 'output' : 'events',
    ...(recipient === null ? {} : { recipient }),
    cursor: encodeCursor(runId, mode, position, cursorDigest(frames, position)),
    hasMore: position < frames.length, itemCount: items.length, items,
  });
}

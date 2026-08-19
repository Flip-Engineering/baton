import { BatonControlError } from './holistic-runtime.mjs';

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const WATCH_EVENT_PREFIXES = Object.freeze([
  'attention.',
  'decision.',
  'message.',
  'member.recovery.',
]);

function boundedCursor(value, field) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BatonControlError('surface_watch_invalid', `${field} must be a non-negative safe integer`, { field });
  }
  return value;
}

function boundedRunId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch requires a valid runId', { field: 'runId' });
  }
  return value;
}

function eventMatchesRun(event, runId) {
  const data = event.data ?? {};
  return data.runId === runId
    || data.detail?.runId === runId
    || data.recovery?.runId === runId;
}

function eventMatchesKind(event, kind) {
  if (kind == null) return true;
  const data = event.data ?? {};
  return event.type === kind
    || data.kind === kind
    || data.requiredAction === kind
    || data.result === kind;
}

export function convergenceNotificationPage(runtime, {
  runId,
  cursor = 0,
  kind = null,
  limit = 128,
} = {}) {
  boundedRunId(runId);
  const afterCursor = boundedCursor(cursor, 'convergenceCursor');
  if (kind !== null && (typeof kind !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(kind))) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch kind is invalid', { field: 'kind' });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch limit must be between 1 and 512', { field: 'limit' });
  }
  if (!runtime?.journal || typeof runtime.journal.events !== 'function') {
    return freeze({
      schemaVersion: 1,
      source: 'convergence_unavailable',
      runId,
      afterCursor,
      throughCursor: afterCursor,
      events: [],
    });
  }
  const events = runtime.journal.events({ after: afterCursor })
    .filter((event) => WATCH_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix)))
    .filter((event) => eventMatchesRun(event, runId))
    .filter((event) => eventMatchesKind(event, kind))
    .slice(0, limit)
    .map((event) => freeze({
      seq: event.seq,
      eventId: event.eventId,
      type: event.type,
      data: clone(event.data),
    }));
  const throughCursor = events.at(-1)?.seq ?? afterCursor;
  return freeze({
    schemaVersion: 1,
    source: 'durable_convergence_journal',
    runId,
    afterCursor,
    throughCursor,
    events,
  });
}

export function mergeConvergenceWatchPage(response, runtime, args = {}) {
  const runId = boundedRunId(args.runId);
  const convergence = convergenceNotificationPage(runtime, {
    runId,
    cursor: args.convergenceCursor ?? 0,
    kind: args.kind ?? null,
  });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch returned an invalid response');
  }
  return freeze({
    ...clone(response),
    convergence,
    nextConvergenceCursor: convergence.throughCursor,
  });
}

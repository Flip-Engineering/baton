import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createNativeOwnerSubscriber } from './native-owner-subscription.mjs';

const CONTRACT_VERSION = 1;
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

// A read against a database another connection is writing returns busy. That is
// recoverable: the page retries the snapshot and resumes the event connection,
// so the server answers with a state the client already handles and stays up.
const SQLITE_BUSY_CODES = new Set([5, 6, 261]);

function isBusy(error) {
  if (!error) return false;
  if (SQLITE_BUSY_CODES.has(error.errcode)) return true;
  return /database is locked|database table is locked/i.test(String(error.message || ''));
}

function respondToFailure(response, error) {
  if (response.headersSent) {
    try { response.end(); } catch {}
    return;
  }
  json(response, isBusy(error) ? 503 : 500, { error: isBusy(error) ? 'database-busy' : 'server-error' });
}

function parseCursor(value) {
  if (value === null || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

function addressHost(address) {
  return address.family === 'IPv6' ? `[${address.address}]` : address.address;
}

function rows(db, sql, ...args) {
  return db.prepare(sql).all(...args);
}

function one(db, sql, ...args) {
  return db.prepare(sql).get(...args);
}

function inTransaction(db, action) {
  db.exec('BEGIN');
  try {
    const value = action();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function visibleScope(db, reader, subject) {
  const allowed = one(db, `
    SELECT EXISTS(
      SELECT 1 FROM sessions selected
      WHERE selected.id = ?
        AND (? = selected.id OR selected.parent = ?)
        AND EXISTS(SELECT 1 FROM sessions actor WHERE actor.id = ?)
    ) AS allowed`, subject, reader, reader, reader);
  if (!allowed?.allowed) return null;
  return rows(db, `
    WITH RECURSIVE scope(id) AS (
      SELECT id FROM sessions WHERE id = ?
      UNION
      SELECT child.id FROM sessions child JOIN scope parent ON child.parent = parent.id
    )
    SELECT id FROM scope ORDER BY id`, subject).map((row) => row.id);
}

// The per-session values the player projection reports, read with one pass per
// recorded relation over the sessions asked for. A snapshot of N sessions costs
// a fixed number of scans; a stream frame for one session scans the same
// relations once.
function playerSupport(db, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))];
  const support = {
    execution: new Map(),
    lastTurn: new Map(),
    latestReport: new Map(),
    unacknowledged: new Map(),
    pending: new Map(),
    pendingSample: new Map(),
    messageAt: new Map(),
    ownedEnsembles: new Map(),
    memberEnsembles: new Map(),
    stop: new Map(),
    openRequest: new Map(),
    changeAt: new Map(),
  };
  if (!ids.length) return support;
  const placeholders = ids.map(() => '?').join(',');
  const changeKey = (entity, id) => entity + '\u0000' + id;

  // The recorded execution of a session: the first row in rowid order.
  for (const row of rows(db, `SELECT session, id, mode, phase, status FROM executions
                               WHERE session IN (${placeholders}) ORDER BY session, rowid`, ...ids)) {
    if (!support.execution.has(row.session)) {
      support.execution.set(row.session, {
        attempt: row.id, mode: row.mode, phase: row.phase, status: row.status,
      });
    }
  }
  // The newest turn per worker: the last row in rowid order.
  for (const row of rows(db, `SELECT worker, id FROM turns
                               WHERE worker IN (${placeholders}) ORDER BY rowid`, ...ids)) {
    support.lastTurn.set(row.worker, row.id);
  }
  // The newest report per sender: the last row in message sequence order.
  for (const row of rows(db, `SELECT sender, id FROM messages
                               WHERE sender IN (${placeholders}) AND kind = 'report'
                               ORDER BY seq`, ...ids)) {
    support.latestReport.set(row.sender, row.id);
  }
  for (const row of rows(db, `SELECT recipient, count(*) AS n FROM messages
                               WHERE recipient IN (${placeholders}) AND receipt IS NULL
                               GROUP BY recipient`, ...ids)) {
    support.unacknowledged.set(row.recipient, row.n);
  }
  // A recorded stop suppresses the pending set for that session.
  for (const row of rows(db, `SELECT session, id, outcome AS status, attempt,
                                     report_id AS reportId
                                FROM session_stops
                               WHERE session IN (${placeholders}) ORDER BY rowid`, ...ids)) {
    if (!support.stop.has(row.session)) {
      support.stop.set(row.session, {
        id: row.id, status: row.status, attempt: row.attempt, reportId: row.reportId,
      });
    }
  }
  // The set the pending badge counts: stored task, guidance and recovery
  // messages awaiting acknowledgement on a session with no recorded stop. One
  // definition for the count and the list; recorded stops and other kinds stay
  // visible through their own fields, never through this set.
  for (const row of rows(db, `SELECT recipient, count(*) AS n FROM messages
                               WHERE recipient IN (${placeholders}) AND receipt IS NULL
                                 AND kind IN ('task', 'guidance', 'recovery')
                               GROUP BY recipient`, ...ids)) {
    if (!support.stop.has(row.recipient)) support.pending.set(row.recipient, row.n);
  }
  // The stored rows behind those counts, newest first per recipient.
  for (const row of rows(db, `SELECT recipient, id, kind FROM messages
                               WHERE recipient IN (${placeholders}) AND receipt IS NULL
                                 AND kind IN ('task', 'guidance', 'recovery')
                               ORDER BY seq DESC`, ...ids)) {
    if (support.stop.has(row.recipient)) continue;
    const list = support.pendingSample.get(row.recipient) || [];
    list.push(row);
    support.pendingSample.set(row.recipient, list);
  }
  if (support.pendingSample.size) {
    const wanted = new Set();
    for (const list of support.pendingSample.values()) {
      for (const row of list) wanted.add(row.id);
    }
    // The recorded time of a message's first insert, as the sample reports it.
    for (const row of rows(db, `SELECT entity_id AS id, recorded_at AS at FROM native_changes
                                 WHERE entity = 'message' AND operation = 'insert'
                                 ORDER BY change_id`)) {
      if (wanted.has(row.id) && !support.messageAt.has(row.id)) support.messageAt.set(row.id, row.at);
    }
  }
  for (const row of rows(db, `SELECT owner AS session, id FROM ensembles
                               WHERE owner IN (${placeholders}) ORDER BY rowid`, ...ids)) {
    const list = support.ownedEnsembles.get(row.session) || [];
    list.push(row.id);
    support.ownedEnsembles.set(row.session, list);
  }
  for (const row of rows(db, `SELECT session, ensemble FROM ensemble_members
                               WHERE session IN (${placeholders}) ORDER BY rowid`, ...ids)) {
    const list = support.memberEnsembles.get(row.session) || [];
    list.push(row.ensemble);
    support.memberEnsembles.set(row.session, list);
  }
  // The open native request a session waits on, newest rowid per worker.
  const hasRequests = Boolean(one(db,
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'native_requests'"));
  if (hasRequests) {
    for (const row of rows(db, `SELECT worker, id, method, reply, written FROM native_requests
                                 WHERE worker IN (${placeholders}) AND closed IS NULL
                                 ORDER BY rowid`, ...ids)) {
      support.openRequest.set(row.worker, row);
    }
  }
  // The recorded time of the newest change behind each reported activity.
  const changeKeys = new Set();
  for (const open of support.openRequest.values()) changeKeys.add(changeKey('native-request', open.id));
  for (const [session, execution] of support.execution) {
    if (execution.phase === 'running' || execution.phase === 'starting') {
      changeKeys.add(changeKey('execution', session));
    }
  }
  if (changeKeys.size) {
    for (const row of rows(db, `SELECT entity, entity_id AS entityId, recorded_at AS at
                                  FROM native_changes
                                 WHERE entity IN ('native-request', 'execution')
                                 ORDER BY change_id`)) {
      const key = changeKey(row.entity, row.entityId);
      if (changeKeys.has(key)) support.changeAt.set(key, row.at);
    }
  }
  return support;
}

// What the actor is doing now, from recorded state only: an open native request
// it waits on, then its recorded execution phase. Null when nothing is recorded,
// and then the page falls back to the actor's latest transition.
function currentAction(support, session, execution) {
  const open = support.openRequest.get(session);
  if (open) {
    const stage = open.reply === null || open.reply === ''
      ? 'awaiting response'
      : (Number(open.written) === 1 ? 'response written' : 'response stored');
    return {
      kind: 'native-request',
      label: `${open.method || 'native'} request ${stage}`,
      at: support.changeAt.get('native-request\u0000' + open.id) || '',
    };
  }
  const phase = execution?.phase || '';
  if (phase === 'running' || phase === 'starting') {
    return {
      kind: 'execution',
      label: phase,
      at: support.changeAt.get('execution\u0000' + session) || '',
    };
  }
  return null;
}

// A message moves between two recorded actors; the projection names the far side
// so the page can light both rows without reading a message body.
function messageCounterparts(db, ids) {
  const found = new Map();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return found;
  const placeholders = wanted.map(() => '?').join(',');
  for (const row of rows(db, `SELECT id, sender, kind, receipt FROM messages WHERE id IN (${placeholders})`, ...wanted)) {
    found.set(row.id, row);
  }
  return found;
}

function playerSnapshot(db, session, support) {
  const player = one(db, `
    SELECT s.id, s.parent, s.harness, s.model, s.effort, s.observed_harness AS observedHarness,
           s.observed_model AS observedModel, s.observed_effort AS observedEffort,
           s.workspace, s.branch, s.base,
           CASE WHEN coalesce(r.role, 'player') = 'operator' THEN 'operator' ELSE 'player' END AS kind,
           CASE coalesce(r.role, 'player')
             WHEN 'conductor' THEN CASE WHEN s.parent IS NULL THEN 'principal-conductor' ELSE 'associate-conductor' END
             ELSE coalesce(r.role, 'player') END AS role,
           (s.endpoint <> '') AS endpointRegistered
      FROM sessions s LEFT JOIN session_roles r ON r.session = s.id WHERE s.id = ?`, session);
  if (!player) return null;

  const execution = support.execution.get(session) || null;
  const sample = support.pendingSample.get(session) || [];
  return {
    id: player.id,
    parent: player.parent ?? '',
    kind: player.kind,
    role: player.role,
    harness: player.harness,
    model: player.model,
    effort: player.effort,
    observedHarness: player.observedHarness,
    observedModel: player.observedModel,
    observedEffort: player.observedEffort,
    workspace: player.workspace,
    branch: player.branch,
    base: player.base,
    execution,
    actualProcess: 'unknown',
    lastTurnId: support.lastTurn.get(session) || '',
    latestReportId: support.latestReport.get(session) || '',
    pendingCount: support.pending.get(session) || 0,
    unacknowledgedCount: support.unacknowledged.get(session) || 0,
    ownedEnsembles: support.ownedEnsembles.get(session) || [],
    memberEnsembles: support.memberEnsembles.get(session) || [],
    liveReceiver: null,
    endpointRegistered: Boolean(player.endpointRegistered),
    reference: null,
    inputRead: ['unknown'],
    stop: support.stop.get(session) || null,
    currentAction: currentAction(support, session, execution),
    pendingSample: sample.map((row) => ({
      id: row.id, kind: row.kind, at: support.messageAt.get(row.id) || '',
    })),
  };
}

function ensembleSnapshot(db, id, scope) {
  const scopeJson = JSON.stringify(scope);
  return one(db, `
    SELECT json_object(
      'id', e.id, 'owner', CASE WHEN e.owner IN (SELECT value FROM json_each(?)) THEN e.owner ELSE NULL END,
      'coupling', e.coupling,
      'members', json((SELECT json_group_array(session) FROM
        (SELECT em.session AS session FROM ensemble_members em WHERE em.ensemble = e.id
          AND em.session IN (SELECT value FROM json_each(?))
          AND EXISTS(SELECT 1 FROM sessions WHERE sessions.id = em.session) ORDER BY em.session))),
      'sections', json((SELECT json_group_array(json(item)) FROM (
        SELECT json_object('ensemble', s.ensemble, 'id', s.id, 'capability', s.capability,
          'members', json((SELECT json_group_array(session) FROM
            (SELECT sm.session AS session FROM section_members sm WHERE sm.ensemble = s.ensemble AND sm.section = s.id
              AND sm.session IN (SELECT value FROM json_each(?))
              AND EXISTS(SELECT 1 FROM sessions WHERE sessions.id = sm.session) ORDER BY sm.session)))) AS item
        FROM sections s WHERE s.ensemble = e.id ORDER BY s.id)))) AS value
      FROM ensembles e WHERE e.id = ?`, scopeJson, scopeJson, scopeJson, id)?.value;
}

function snapshot(db, reader, subject, since) {
  return inTransaction(db, () => {
    const scope = visibleScope(db, reader, subject);
    if (!scope) return { refused: true };
    const high = Number(one(db, 'SELECT coalesce(max(change_id), 0) AS cursor FROM native_changes').cursor);
    const bounds = one(db, 'SELECT min(change_id) AS first, max(change_id) AS last FROM native_changes');
    const first = bounds.first === null ? high + 1 : Number(bounds.first);
    const gap = since > high || (since > 0 && since < first - 1);
    const support = playerSupport(db, scope);
    const players = scope.map((id) => playerSnapshot(db, id, support)).filter(Boolean);
    const scopeSet = new Set(scope);
    const ensembleIds = new Set();
    for (const player of players) {
      for (const id of player.ownedEnsembles) ensembleIds.add(id);
      for (const id of player.memberEnsembles) ensembleIds.add(id);
    }
    const ensembles = [...ensembleIds].sort().map((id) => JSON.parse(ensembleSnapshot(db, id, scope)));
    const placeholders = scope.map(() => '?').join(',') || "''";
    const transitionRows = rows(db, `
      SELECT change_id AS seq, recorded_at AS at, session_id AS session,
             entity, entity_id AS entityId, operation, kind, summary
        FROM native_changes WHERE session_id IN (${placeholders})
       ORDER BY change_id DESC`, ...scope);
    const counterparts = messageCounterparts(db,
      transitionRows.filter((row) => row.entity === 'message').map((row) => row.entityId));
    const transitions = transitionRows.map((row) => ({
      seq: row.seq,
      at: row.at,
      session: row.session,
      kind: row.kind,
      summary: row.summary,
      entity: row.entity,
      entityId: row.entityId,
      operation: row.operation,
      counterpart: counterparts.get(row.entityId)?.sender || '',
    }));
    const selection = {
      mode: subject === reader ? 'all' : 'subtree',
      rule: 'parent-owner-member-routes-v1',
      reader,
      scope: [...scopeSet],
      gap,
    };
    return {
      contractVersion: CONTRACT_VERSION,
      cursor: String(high),
      capturedAt: new Date().toISOString(),
      subject,
      selection,
      players,
      ensembles,
      transitions,
      tasks: {},
      providers: {},
    };
  });
}

function writeEvent(response, event, id, data) {
  response.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function nextEventRow(db, cursor) {
  return one(db, `
    SELECT change_id AS id, recorded_at AS at, session_id AS session,
           entity, entity_id AS entityId, operation, kind, summary
      FROM native_changes WHERE change_id > ? ORDER BY change_id LIMIT 1`, cursor);
}

function ensembleHasVisibleMember(db, id, scope) {
  return Boolean(one(db, `
    SELECT EXISTS(SELECT 1 FROM ensemble_members
      WHERE ensemble = ? AND session IN (SELECT value FROM json_each(?))) AS visible`,
  id, JSON.stringify(scope))?.visible);
}

// Check the client cursor against the retained change bounds.
function durableGap(db, cursor) {
  return inTransaction(db, () => {
    const bounds = one(db, 'SELECT min(change_id) AS first, max(change_id) AS last FROM native_changes');
    if (bounds.last === null) return false;
    const high = Number(bounds.last);
    const first = Number(bounds.first);
    return cursor > high || (cursor > 0 && cursor < first - 1);
  });
}

async function streamEvents(response, db, databasePath, reader, subject, initialCursor,
    expectedGeneration, subscribeCommittedChanges) {
  let subscription = null;
  const earlyNotices = [];
  let onNotice = () => {};
  try {
    subscription = await subscribeCommittedChanges({
      databasePath,
      afterCursor: String(initialCursor),
      expectedGeneration,
      onNotice: (notice) => subscription ? onNotice(notice) : earlyNotices.push(notice),
    });
  } catch {
    return json(response, 503, { error: 'native-owner-subscription-unavailable' });
  }
  if (!subscription || subscription.ready !== true
      || typeof subscription.generation !== 'string' || !subscription.generation
      || typeof subscription.cursor !== 'string'
      || parseCursor(subscription.cursor) === null
      || typeof subscription.close !== 'function') {
    try { subscription?.close?.(); } catch {}
    return json(response, 503, { error: 'native-owner-subscription-unavailable' });
  }
  let cursor = initialCursor;
  let closed = false;
  let subscriptionClosed = false;
  let scheduled = null;
  let waitingForDrain = false;
  let admittedScope = null;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  });
  response.flushHeaders?.();
  const closeSubscription = () => {
    if (scheduled !== null) clearImmediate(scheduled);
    scheduled = null;
    response.removeListener('drain', onDrain);
    if (subscriptionClosed) return;
    subscriptionClosed = true;
    subscription.close();
  };
  const endWithGap = (reason) => {
    if (closed) return;
    writeEvent(response, 'gap', String(cursor), { reason, generation: subscription.generation });
    closed = true;
    response.end();
    closeSubscription();
  };
  const onDrain = () => {
    waitingForDrain = false;
    pump();
  };
  const pump = () => {
    if (closed || scheduled !== null || waitingForDrain) return;
    if (response.writableNeedDrain) {
      waitingForDrain = true;
      response.once('drain', onDrain);
      return;
    }
    scheduled = setImmediate(pumpNext);
  };
  const pumpNext = () => {
    scheduled = null;
    if (closed) return;
    try {
      const batch = inTransaction(db, () => {
        const scope = visibleScope(db, reader, subject);
        if (!scope) return { refused: true, gap: false, rows: [] };
        const bounds = one(db, `SELECT
          (SELECT min(change_id) FROM native_changes) AS first,
          (SELECT max(change_id) FROM native_changes) AS last`);
        const high = Number(bounds.last ?? 0);
        const first = Number(bounds.first ?? (high + 1));
        const gap = cursor > high || (cursor > 0 && cursor < first - 1);
        // Each scheduling step reads one change and releases its transaction.
        const change = gap ? null : nextEventRow(db, cursor);
        const changes = change ? [change] : [];
        const visible = new Set(scope);
        const support = playerSupport(db, changes.map((item) => item.session));
        const frames = changes.map((change) => {
          const id = Number(change.id);
          const ensembleId = change.entity === 'ensemble'
            ? change.entityId
            : ['section', 'section-membership'].includes(change.entity)
              ? change.entityId.split('/')[0] : '';
          const ensembleVisible = ensembleId
            && ensembleHasVisibleMember(db, ensembleId, scope);
          if (!visible.has(change.session) && !ensembleVisible) {
            // The shared knowledge overview also includes actors outside this subtree.
            if (change.entity === 'knowledge' || change.entity === 'promotion') {
              return { id, type: 'shared', transition: change };
            }
            return { id, type: 'cursor', data: {} };
          }
          if (['ensemble', 'membership', 'section', 'section-membership'].includes(change.entity)) {
            const value = ensembleSnapshot(db, change.entityId.split('/')[0], scope);
            const player = change.entity === 'membership' && visible.has(change.session)
              ? playerSnapshot(db, change.session, support) : null;
            return { id, type: 'ensemble', data: value ? JSON.parse(value) : null,
              player, transition: change, sessionVisible: visible.has(change.session) };
          }
          const player = playerSnapshot(db, change.session, support);
          return { id, type: 'player', data: player, transition: change,
            sessionVisible: visible.has(change.session),
            pending: player && (change.kind.startsWith('message:')
              || ['receipt', 'report', 'stop', 'execution', 'role'].includes(change.kind))
              ? { session: player.id, pendingCount: player.pendingCount,
                unacknowledgedCount: player.unacknowledgedCount,
                lastTurnId: player.lastTurnId, latestReportId: player.latestReportId } : null };
        });
        return { refused: false, gap, scope, rows: frames, high };
      });
      if (batch.refused) return endWithGap('reader-scope-changed');
      if (batch.gap) return endWithGap('cursor-gap');
      const scope = new Set(batch.scope);
      if (admittedScope && (admittedScope.size !== scope.size
          || [...admittedScope].some((session) => !scope.has(session)))) {
        return endWithGap('reader-scope-changed');
      }
      admittedScope = scope;
      for (const frame of batch.rows) {
        cursor = frame.id;
        if (frame.type === 'cursor') {
          writeEvent(response, 'cursor', String(cursor), {});
          continue;
        }
        if (frame.type === 'shared') {
          // Notify the client to refresh the shared knowledge reads.
          writeEvent(response, 'transition', String(cursor), {
            seq: cursor,
            at: frame.transition.at,
            session: '',
            kind: frame.transition.kind,
            summary: '',
            entity: frame.transition.entity,
            entityId: '',
            operation: frame.transition.operation,
            counterpart: '',
          });
          continue;
        }
        if (!frame.data) return endWithGap(frame.type === 'ensemble' ? 'ensemble-removed' : 'entity-removed');
        writeEvent(response, frame.type, String(cursor), frame.data);
        if (frame.player) writeEvent(response, 'player', String(cursor), frame.player);
        if (frame.pending) writeEvent(response, 'pending', String(cursor), frame.pending);
        const change = frame.transition;
        const counterpart = change.entity === 'message'
          ? (messageCounterparts(db, [change.entityId]).get(change.entityId)?.sender || '')
          : '';
        writeEvent(response, 'transition', String(cursor), {
          seq: cursor,
          at: change.at,
          session: frame.sessionVisible === false ? '' : change.session,
          kind: change.kind,
          summary: change.summary,
          entity: change.entity,
          entityId: change.entityId,
          operation: change.operation,
          counterpart,
        });
      }
      if (cursor < batch.high) pump();
    } catch (error) {
      endWithGap('event-read-failed');
    }
  };
  onNotice = (notice) => {
    if (closed || !notice) return;
    if (notice.kind === 'generation' && notice.generation !== subscription.generation) {
      return endWithGap('owner-generation-changed');
    }
    if (notice.kind === 'commit') pump();
    if (notice.kind === 'gap') {
      // Check retained bounds before closing for an owner gap notice.
      if (durableGap(db, cursor)) return endWithGap(notice.reason || 'cursor-gap');
      return pump();
    }
    if (notice.kind === 'lost' || notice.kind === 'unavailable') endWithGap('owner-notification-lost');
  };
  response.on('close', () => {
    closed = true;
    closeSubscription();
  });
  if (expectedGeneration && expectedGeneration !== subscription.generation) {
    endWithGap('owner-generation-changed');
    return;
  }
  writeEvent(response, 'hello', String(cursor), {
    contractVersion: CONTRACT_VERSION,
    cursor: String(cursor),
    generation: subscription.generation,
  });
  if (subscription.gap && durableGap(db, cursor)) {
    endWithGap('cursor-gap');
    return;
  }
  for (const notice of earlyNotices) onNotice(notice);
  pump();
}

function serveAsset(response, assetRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const candidate = resolve(assetRoot, `.${decoded}`);
  if (candidate !== assetRoot && !candidate.startsWith(assetRoot + sep)) {
    response.writeHead(404).end();
    return;
  }
  const file = pathname === '/' ? resolve(assetRoot, 'index.html') : candidate;
  if (!existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES.get(extname(file)) || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  createReadStream(file).pipe(response);
}

export function createOrchestraServer({ databasePath, reader, subject = reader,
  subscribeCommittedChanges, baton2Executable,
  assetRoot = fileURLToPath(new URL('.', import.meta.url)),
  host = '127.0.0.1', port = 0 }) {
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('The read-only Orchestra UI binds to loopback only.');
  }
  const committedChanges = typeof subscribeCommittedChanges === 'function'
    ? subscribeCommittedChanges
    : baton2Executable ? createNativeOwnerSubscriber(baton2Executable) : undefined;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  // Allow an in-flight SQLite writer to release its lock before reading.
  db.exec('PRAGMA busy_timeout = 250');

// Read shared findings on demand. Actor details follow the bound reader's scope.
// Absent knowledge tables produce the empty response shape.
function knowledgeTablesReady(db) {
  const found = one(db,
    "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('knowledge', 'knowledge_promotions')");
  return found && found.n === 2;
}

function knowledgeOverview(db) {
  if (!knowledgeTablesReady(db)) {
    return { contractVersion: 1, findings: [], promotions: [], actors: {}, empty: true };
  }
  const findings = rows(db, 'SELECT id, author, claim FROM knowledge ORDER BY id');
  const promotions = rows(db,
    'SELECT id, finding, author, source, destination, promoted_by AS promotedBy FROM knowledge_promotions ORDER BY id');
  const actors = {};
  for (const f of findings) {
    if (!actors[f.author]) actors[f.author] = { authored: 0, received: 0 };
    actors[f.author].authored += 1;
  }
  for (const p of promotions) {
    if (!actors[p.destination]) actors[p.destination] = { authored: 0, received: 0 };
    actors[p.destination].received += 1;
  }
  return { contractVersion: 1, findings, promotions, actors, empty: findings.length === 0 && promotions.length === 0 };
}

function knowledgeForActor(db, session) {
  if (!knowledgeTablesReady(db)) {
    return { contractVersion: 1, actor: session, authored: [], received: [], counts: { authored: 0, received: 0, unshared: 0 }, empty: true };
  }
  const authored = rows(db,
    'SELECT id, author, claim, evidence, limits FROM knowledge WHERE author = ? ORDER BY id', session);
  const received = rows(db,
    `SELECT p.id AS id, p.finding AS finding, p.author AS author, p.source AS source,
            p.destination AS destination, p.promoted_by AS promotedBy,
            k.claim AS claim, k.evidence AS evidence, k.limits AS limits
       FROM knowledge_promotions p LEFT JOIN knowledge k ON k.id = p.finding
      WHERE p.destination = ? ORDER BY p.id`, session);
  const promoted = new Set(rows(db, 'SELECT DISTINCT finding AS f FROM knowledge_promotions').map((r) => r.f));
  const unshared = authored.filter((f) => !promoted.has(f.id)).length;
  return { contractVersion: 1, actor: session, authored, received,
    counts: { authored: authored.length, received: received.length, unshared }, empty: authored.length === 0 && received.length === 0 };
}
  const handleRequest = (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET') return json(response, 405, { error: 'method-not-allowed' });
    if (url.pathname === '/orchestra/snapshot') {
      const selected = url.searchParams.get('subject') || subject;
      const since = parseCursor(url.searchParams.get('since'));
      if (since === null) return json(response, 400, { error: 'invalid-cursor' });
      try {
        const value = snapshot(db, reader, selected, since);
        if (value.refused) return json(response, 403, { error: 'reader-scope-denied' });
        return json(response, 200, value);
      } catch (error) {
        return json(response, 503, { error: 'snapshot-unavailable' });
      }
    }
    if (url.pathname === '/orchestra/events') {
      const since = parseCursor(url.searchParams.get('since'));
      const selected = url.searchParams.get('subject') || subject;
      if (since === null) return json(response, 400, { error: 'invalid-cursor' });
      if (!visibleScope(db, reader, selected)) return json(response, 403, { error: 'reader-scope-denied' });
      if (typeof committedChanges !== 'function') {
        return json(response, 503, { error: 'native-owner-subscription-unavailable' });
      }
      void streamEvents(response, db, databasePath, reader, selected, since,
        url.searchParams.get('generation') || '', committedChanges)
        .catch((error) => {
          if (response.headersSent) {
            try { response.end(); } catch {}
            return;
          }
          json(response, 503, { error: 'native-owner-subscription-unavailable' });
        });
      return;
    }
    if (url.pathname === '/orchestra/knowledge/overview') {
      try {
        return json(response, 200, knowledgeOverview(db));
      } catch (error) {
        return json(response, 503, { error: 'knowledge-unavailable' });
      }
    }
    if (url.pathname === '/orchestra/knowledge') {
      const actor = url.searchParams.get('actor') || '';
      if (!actor) return json(response, 400, { error: 'actor-required' });
      try {
        const scope = visibleScope(db, reader, subject);
        if (!scope || !scope.includes(actor)) return json(response, 403, { error: 'reader-scope-denied' });
        return json(response, 200, knowledgeForActor(db, actor));
      } catch (error) {
        return json(response, 503, { error: 'knowledge-unavailable' });
      }
    }
    if (url.pathname.startsWith('/orchestra/')) return json(response, 404, { error: 'not-found' });
    if (url.pathname === '/' && !url.searchParams.has('api') && !url.searchParams.has('fixture')) {
      const address = server.address();
      const apiBase = `http://${addressHost(address)}:${address.port}`;
      response.writeHead(302, { location: `/?api=${encodeURIComponent(apiBase)}&subject=${encodeURIComponent(subject)}`, 'cache-control': 'no-store' });
      response.end();
      return;
    }
    return serveAsset(response, resolve(assetRoot), url.pathname);
  };
  const server = createServer((request, response) => {
    try {
      handleRequest(request, response);
    } catch (error) {
      respondToFailure(response, error);
    }
  });
  server.on('close', () => db.close());
  server.listen(port, host);
  return server;
}

function cli(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) values.set(args[i], args[i + 1]);
  if (!values.get('--database') || !values.get('--reader')) {
    throw new Error('usage: server.mjs --database PATH --reader SESSION [--subject SESSION] [--baton2 EXECUTABLE] [--host 127.0.0.1] [--port 0]');
  }
  if (!/^[0-9]+$/.test(values.get('--port') || '0')) {
    throw new Error('usage: --port must be a decimal port number (0 selects an ephemeral port)');
  }
  return {
    databasePath: values.get('--database'),
    reader: values.get('--reader'),
    subject: values.get('--subject') || values.get('--reader'),
    baton2Executable: values.get('--baton2') || undefined,
    host: values.get('--host') || '127.0.0.1',
    port: Number(values.get('--port') || 0),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const server = createOrchestraServer(cli(process.argv.slice(2)));
    server.on('listening', () => {
      const address = server.address();
      process.stdout.write(JSON.stringify({ host: address.address, port: address.port, readOnly: true }) + '\n');
      process.stdout.write(`http://${addressHost(address)}:${address.port}/\n`);
    });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      server.close(() => { process.exitCode = 0; });
      server.closeAllConnections?.();
    };
    // The launching `view` command holds this process's stdin; when that command
    // exits the pipe closes and the server stops with it.
    process.stdin.on('end', close);
    process.stdin.on('close', close);
    process.stdin.resume();
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

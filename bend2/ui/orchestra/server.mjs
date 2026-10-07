import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const CONTRACT_VERSION = 1;
const TRANSITION_LIMIT = 50;
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

function parseCursor(value) {
  if (value === null || value === '') return 0;
  if (!/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
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

function stoppedSession(db, session) {
  return one(db, 'SELECT id, outcome AS status, attempt, report_id AS reportId FROM session_stops WHERE session = ?', session) ?? null;
}

function playerSnapshot(db, session) {
  const player = one(db, `
    SELECT s.id, s.parent, s.harness, s.model, s.effort, s.observed_harness AS observedHarness,
           s.observed_model AS observedModel, s.observed_effort AS observedEffort,
           s.workspace, s.branch, s.base, s.native,
           CASE WHEN coalesce(r.role, 'player') = 'operator' THEN 'operator' ELSE 'player' END AS kind,
           CASE coalesce(r.role, 'player')
             WHEN 'conductor' THEN CASE WHEN s.parent IS NULL THEN 'principal-conductor' ELSE 'associate-conductor' END
             ELSE coalesce(r.role, 'player') END AS role,
           (SELECT json_object('attempt', e.id, 'mode', e.mode, 'phase', e.phase, 'status', e.status)
              FROM executions e WHERE e.session = s.id) AS executionJson,
           (SELECT t.id FROM turns t WHERE t.worker = s.id ORDER BY t.rowid DESC LIMIT 1) AS lastTurnId,
           (SELECT m.id FROM messages m WHERE m.sender = s.id AND m.kind = 'report' ORDER BY m.seq DESC LIMIT 1) AS latestReportId,
           (SELECT count(*) FROM messages m WHERE m.recipient = s.id AND m.receipt IS NULL) AS unacknowledgedCount,
           (SELECT count(*) FROM messages m WHERE m.recipient = s.id AND m.receipt IS NULL
             AND NOT (EXISTS(SELECT 1 FROM session_stops stop WHERE stop.session = s.id)
               AND m.kind IN ('task', 'guidance', 'recovery'))) AS pendingCount,
           (SELECT json_group_array(e.id) FROM ensembles e WHERE e.owner = s.id) AS ownedEnsemblesJson,
           (SELECT json_group_array(em.ensemble) FROM ensemble_members em WHERE em.session = s.id) AS memberEnsemblesJson,
           (s.endpoint <> '') AS endpointRegistered
      FROM sessions s LEFT JOIN session_roles r ON r.session = s.id WHERE s.id = ?`, session);
  if (!player) return null;

  const execution = player.executionJson ? JSON.parse(player.executionJson) : null;
  const ownedEnsembles = JSON.parse(player.ownedEnsemblesJson || '[]');
  const memberEnsembles = JSON.parse(player.memberEnsemblesJson || '[]');
  const stop = stoppedSession(db, session);
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
    lastTurnId: player.lastTurnId || '',
    latestReportId: player.latestReportId || '',
    pendingCount: player.pendingCount,
    unacknowledgedCount: player.unacknowledgedCount,
    ownedEnsembles,
    memberEnsembles,
    liveReceiver: null,
    endpointRegistered: Boolean(player.endpointRegistered),
    reference: null,
    inputRead: ['unknown'],
    stop,
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
    const players = scope.map((id) => playerSnapshot(db, id)).filter(Boolean);
    const scopeSet = new Set(scope);
    const ensembleIds = new Set();
    for (const player of players) {
      for (const id of player.ownedEnsembles) ensembleIds.add(id);
      for (const id of player.memberEnsembles) ensembleIds.add(id);
    }
    const ensembles = [...ensembleIds].sort().map((id) => JSON.parse(ensembleSnapshot(db, id, scope)));
    const placeholders = scope.map(() => '?').join(',') || "''";
    const transitions = rows(db, `
      SELECT change_id AS seq, recorded_at AS at, session_id AS session,
             kind, summary
        FROM native_changes WHERE session_id IN (${placeholders})
       ORDER BY change_id DESC LIMIT ?`, ...scope, TRANSITION_LIMIT)
      .map((row) => ({ seq: row.seq, at: row.at, session: row.session, kind: row.kind, summary: row.summary }));
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

function eventRows(db, cursor, limit = 100) {
  return rows(db, `
    SELECT change_id AS id, recorded_at AS at, session_id AS session,
           entity, entity_id AS entityId, operation, kind, summary
      FROM native_changes WHERE change_id > ? ORDER BY change_id LIMIT ?`, cursor, limit);
}

function ensembleHasVisibleMember(db, id, scope) {
  return Boolean(one(db, `
    SELECT EXISTS(SELECT 1 FROM ensemble_members
      WHERE ensemble = ? AND session IN (SELECT value FROM json_each(?))) AS visible`,
  id, JSON.stringify(scope))?.visible);
}

async function streamEvents(response, db, databasePath, reader, subject, initialCursor,
    expectedGeneration, subscribeCommittedChanges) {
  let subscription = null;
  const earlyNotices = [];
  let onNotice = () => {};
  try {
    subscription = await subscribeCommittedChanges({
      databasePath,
      reader,
      subject,
      onNotice: (notice) => subscription ? onNotice(notice) : earlyNotices.push(notice),
    });
  } catch {
    return json(response, 503, { error: 'native-owner-subscription-unavailable' });
  }
  if (!subscription || typeof subscription.generation !== 'string'
      || typeof subscription.close !== 'function') {
    return json(response, 503, { error: 'native-owner-subscription-unavailable' });
  }
  let cursor = initialCursor;
  let closed = false;
  let subscriptionClosed = false;
  let pumping = false;
  let pumpAgain = false;
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
  const pump = () => {
    if (closed) return;
    if (pumping) {
      pumpAgain = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        const batch = inTransaction(db, () => {
          const scope = visibleScope(db, reader, subject);
          if (!scope) return { refused: true, gap: false, rows: [] };
          const bounds = one(db, 'SELECT min(change_id) AS first, max(change_id) AS last FROM native_changes');
          const high = Number(bounds.last ?? 0);
          const first = Number(bounds.first ?? (high + 1));
          const gap = cursor > high || (cursor > 0 && cursor < first - 1);
          const changes = gap ? [] : eventRows(db, cursor);
          const visible = new Set(scope);
          const frames = changes.map((change) => {
            const id = Number(change.id);
            const ensembleId = change.entity === 'ensemble'
              ? change.entityId
              : ['section', 'section-membership'].includes(change.entity)
                ? change.entityId.split('/')[0] : '';
            const ensembleVisible = ensembleId
              && ensembleHasVisibleMember(db, ensembleId, scope);
            if (!visible.has(change.session) && !ensembleVisible) {
              return { id, type: 'cursor', data: {} };
            }
            if (['ensemble', 'membership', 'section', 'section-membership'].includes(change.entity)) {
              const value = ensembleSnapshot(db, change.entityId.split('/')[0], scope);
              const player = change.entity === 'membership' && visible.has(change.session)
                ? playerSnapshot(db, change.session) : null;
              return { id, type: 'ensemble', data: value ? JSON.parse(value) : null,
                player, transition: change };
            }
            const player = playerSnapshot(db, change.session);
            return { id, type: 'player', data: player, transition: change,
              pending: player && (change.kind.startsWith('message:')
                || ['receipt', 'report', 'stop', 'execution', 'role'].includes(change.kind))
                ? { session: player.id, pendingCount: player.pendingCount,
                  unacknowledgedCount: player.unacknowledgedCount } : null };
          });
          return { refused: false, gap, scope, rows: frames };
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
          if (!frame.data) return endWithGap('reader-scope-changed');
          writeEvent(response, frame.type, String(cursor), frame.data);
          if (frame.player) writeEvent(response, 'player', String(cursor), frame.player);
          if (frame.pending) writeEvent(response, 'pending', String(cursor), frame.pending);
          const change = frame.transition;
          writeEvent(response, 'transition', String(cursor), {
            seq: cursor,
            at: change.at,
            session: change.session,
            kind: change.kind,
            summary: change.summary,
          });
        }
        if (batch.rows.length === 100) pumpAgain = true;
      } while (pumpAgain && !closed);
    } catch (error) {
      endWithGap('event-read-failed');
    } finally {
      pumping = false;
    }
  };
  onNotice = (notice) => {
    if (closed || !notice) return;
    if (notice.kind === 'generation' && notice.generation !== subscription.generation) {
      return endWithGap('owner-generation-changed');
    }
    if (notice.kind === 'commit') pump();
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
  for (const notice of earlyNotices) onNotice(notice);
  pump();
}

function serveAsset(response, assetRoot, pathname) {
  const candidate = resolve(assetRoot, `.${decodeURIComponent(pathname)}`);
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
  subscribeCommittedChanges, assetRoot = fileURLToPath(new URL('.', import.meta.url)),
  host = '127.0.0.1', port = 0 }) {
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('The read-only Orchestra UI binds to loopback only.');
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const server = createServer((request, response) => {
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
      if (typeof subscribeCommittedChanges !== 'function') {
        return json(response, 503, { error: 'native-owner-subscription-unavailable' });
      }
      void streamEvents(response, db, databasePath, reader, selected, since,
        url.searchParams.get('generation') || '', subscribeCommittedChanges)
        .catch(() => json(response, 503, { error: 'native-owner-subscription-unavailable' }));
      return;
    }
    if (url.pathname.startsWith('/orchestra/')) return json(response, 404, { error: 'not-found' });
    if (url.pathname === '/' && !url.searchParams.has('api') && !url.searchParams.has('fixture')) {
      const address = server.address();
      const apiBase = `http://127.0.0.1:${address.port}`;
      response.writeHead(302, { location: `/?api=${encodeURIComponent(apiBase)}&subject=${encodeURIComponent(subject)}`, 'cache-control': 'no-store' });
      response.end();
      return;
    }
    return serveAsset(response, resolve(assetRoot), url.pathname);
  });
  server.on('close', () => db.close());
  server.listen(port, host);
  return server;
}

function cli(args) {
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) values.set(args[i], args[i + 1]);
  if (!values.get('--database') || !values.get('--reader')) {
    throw new Error('usage: server.mjs --database PATH --reader SESSION [--subject SESSION] [--host 127.0.0.1] [--port 0]');
  }
  return {
    databasePath: values.get('--database'),
    reader: values.get('--reader'),
    subject: values.get('--subject') || values.get('--reader'),
    host: values.get('--host') || '127.0.0.1',
    port: Number(values.get('--port') || 0),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const server = createOrchestraServer(cli(process.argv.slice(2)));
    server.on('listening', () => {
      const address = server.address();
      const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      process.stdout.write(JSON.stringify({ host: address.address, port: address.port, readOnly: true }) + '\n');
      process.stdout.write(`http://${host}:${address.port}/\n`);
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

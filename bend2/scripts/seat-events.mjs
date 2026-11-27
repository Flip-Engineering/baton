#!/usr/bin/env node
// Seat events for the operator across several seat databases.
//
// The watcher reads each database read-only and the coordinator's own status
// rows. It returns, or with --follow writes one JSON line, for each event
// (with --notify, that line names the delivered event only):
//   message                a message for the watched recipient (any kind or length)
//   blocked                a seat whose blocked cause became nonempty or changed
//   native-ended           a seat whose native attempt stopped running
//   operator-input-untaken operator input unread by a seat for --untaken-seconds
//   completion-unconfirmed a completion request nobody confirmed for --unconfirmed-seconds
//   silent                 a working seat whose native wrote no output for --silent-seconds
// The three periods default to 900 seconds, the silence period of Baton's own
// silent-native report (silence.bend), so a stalled seat is reported once by
// both at the same age.
//
// The cursor file keeps, per database, the last message sequence reported, the
// seat facts last seen, the time-based events already reported and the events
// not yet delivered. --notify ARGV_JSON runs that argv once per event with the
// event as JSON on stdin; the event leaves the cursor only when the command
// exits 0, so every event is delivered at least once and a failed delivery is
// retried at the next evaluation. --follow keeps running, so nothing needs to be
// started again after an event.
//
// With --root, each interval evaluation reads the seat home again. A database
// found after the start is subscribed and read from its first message, so a
// seat made after the watcher started is reported like the others. Its first
// evaluation reports a blocked cause the seat already has and a native attempt
// that already ended.
//
// An interval evaluation skips a database whose file and WAL file have the same
// inode, size and modification time as at its last evaluation, while no timed
// event of it is due. Every event but silent derives from the database alone; a
// running attempt with no output yet or an already reported silence is due at
// every interval, because its stdout file is outside the database.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { seatDatabases } from './seats.mjs';

export const DEFAULT_PERIOD_SECONDS = 900;

function readCursor(path) {
  if (!path || !existsSync(path)) return { version: 1, databases: {} };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || value.version !== 1 || typeof value.databases !== 'object') {
    throw new Error(`The cursor file ${path} is not a version 1 seat-events cursor.`);
  }
  return value;
}

function writeCursor(path, cursor) {
  if (!path) return;
  const temporary = path + '.tmp-' + process.pid;
  writeFileSync(temporary, JSON.stringify(cursor) + '\n');
  renameSync(temporary, path);
}

function statusRows(coordinator, database) {
  const env = { ...process.env };
  for (const name of ['BATON_SESSION', 'BATON_DATABASE', 'BATON_ATTEMPT_DIRECTORY']) delete env[name];
  const run = spawnSync(coordinator, [database, 'status'], { encoding: 'utf8', env, maxBuffer: Infinity });
  if (run.status !== 0) throw new Error(`status of ${database} exited ${run.status}: ${(run.stderr || '').trim()}`);
  return JSON.parse(run.stdout);
}

function outputSeconds(directory) {
  if (!directory) return null;
  try { return Math.floor(statSync(join(directory, 'stdout')).mtimeMs / 1000); } catch { return null; }
}

// The inode, size and modification time of a database file and its WAL file. A
// commit writes the WAL file and a checkpoint writes the database file.
export function fileSignature(database) {
  return ['', '-wal'].map((suffix) => {
    try {
      const file = statSync(database + suffix, { bigint: true });
      return `${file.ino}:${file.size}:${file.mtimeNs}`;
    } catch { return '-'; }
  }).join('/');
}

// True when an interval evaluation of the database can be skipped: its files are
// unchanged since its last complete evaluation and no timed event is due.
export function unchanged(database, entry, now) {
  return typeof entry.file === 'string' && !entry.found && (entry.due === null || now < entry.due)
    && entry.file === fileSignature(database);
}

function seconds(instant) {
  const value = Date.parse(instant);
  return Number.isNaN(value) ? null : Math.floor(value / 1000);
}

// The events one database has now, given its cursor entry. The entry is updated
// with the facts seen; events go to entry.pending.
export function evaluate({ database, coordinator, session, entry, now, periods }) {
  // The signature is read before the database, so a commit made during this
  // evaluation changes it for the next one. A failed evaluation keeps none.
  const file = fileSignature(database);
  delete entry.file;
  const db = new DatabaseSync(database, { readOnly: true });
  const events = [];
  let due = null;
  const dueAt = (at) => { due = due === null ? at : Math.min(due, at); };
  try {
    const start = entry.through ?? db.prepare('SELECT coalesce(max(seq),0) AS seq FROM messages').get().seq;
    const committed = (id) => db.prepare("SELECT recorded_at FROM native_changes WHERE entity='message' AND entity_id=? AND operation='insert' ORDER BY change_id LIMIT 1").get(id)?.recorded_at ?? null;
    const messages = db.prepare('SELECT seq,id,sender,recipient,kind,body FROM messages WHERE recipient=? AND seq>? ORDER BY seq').all(session, start);
    for (const row of messages) {
      events.push({ event: 'message', key: 'message:' + row.id, seat: row.sender, seq: row.seq, id: row.id,
        kind: row.kind, body: row.body, committedAt: committed(row.id) });
    }
    entry.through = messages.length ? messages[messages.length - 1].seq : start;
    const executions = new Map(db.prepare('SELECT session,id,phase,status,directory FROM executions').all()
      .map((row) => [row.session, row]));
    const seats = entry.seats ?? (entry.seats = {});
    const reported = entry.reported ?? (entry.reported = {});
    for (const row of statusRows(coordinator, database)) {
      if (row.role === 'operator') continue;
      const execution = executions.get(row.id) ?? null;
      // In the first evaluation of a database found after the start, a seat
      // counts as unblocked and, when it has an attempt, as running before, so
      // a cause or an ended native from before the database was found is reported.
      const before = seats[row.id] ?? (entry.found ? { cause: '', phase: execution ? 'running' : '' } : undefined);
      const cause = ['', 'assignment-ended'].includes(row.blockedCause ?? '') ? '' : row.blockedCause;
      const phase = execution?.phase ?? '';
      if (before && cause && cause !== before.cause) {
        events.push({ event: 'blocked', key: `blocked:${row.id}:${cause}:${now}`, seat: row.id, cause,
          refusal: row.refusal ?? null });
      }
      if (before && before.phase === 'running' && phase !== 'running') {
        events.push({ event: 'native-ended', key: `native-ended:${row.id}:${execution?.id ?? ''}`, seat: row.id,
          attempt: execution?.id ?? null, phase, status: execution?.status ?? null });
      }
      seats[row.id] = { cause, phase };
      const waiting = seconds(row.operatorWaitingSince);
      if (waiting !== null && now - waiting >= periods.untaken) {
        const key = `operator-input-untaken:${row.id}:${row.operatorWaitingSince}`;
        if (!reported[key]) events.push({ event: 'operator-input-untaken', key, seat: row.id,
          since: row.operatorWaitingSince, seconds: now - waiting });
      } else if (waiting !== null) dueAt(waiting + periods.untaken);
      const request = row.taskCompletion?.requestId;
      if (request && row.state === 'asks-to-end') {
        const at = committed(request);
        const age = at === null ? null : now - seconds(at);
        const key = `completion-unconfirmed:${row.id}:${request}`;
        if (age !== null && age >= periods.unconfirmed && !reported[key]) {
          events.push({ event: 'completion-unconfirmed', key, seat: row.id, request, committedAt: at, seconds: age });
        } else if (age !== null && age < periods.unconfirmed) dueAt(now - age + periods.unconfirmed);
      }
      const output = phase === 'running' ? outputSeconds(execution?.directory) : null;
      if (output !== null && now - output >= periods.silent) {
        const key = `silent:${row.id}:${execution.id}:${output}`;
        if (!reported[key]) events.push({ event: 'silent', key, seat: row.id, attempt: execution.id,
          lastOutputAt: new Date(output * 1000).toISOString(), seconds: now - output });
        dueAt(now);
      } else if (output !== null) dueAt(output + periods.silent);
      else if (phase === 'running') dueAt(now);
    }
    delete entry.found;
    entry.file = file;
    entry.due = due;
  } finally { db.close(); }
  for (const item of events) {
    if (!item.event.startsWith('message') && !['blocked', 'native-ended'].includes(item.event)) entry.reported[item.key] = true;
    entry.pending = [...(entry.pending ?? []).filter((pending) => pending.key !== item.key),
      { type: 'baton-seat-event', database, at: new Date(now * 1000).toISOString(), ...item }];
  }
  return entry.pending ?? [];
}

function runNotify(argv, event) {
  const run = spawnSync(argv[0], argv.slice(1), { input: JSON.stringify(event) + '\n', encoding: 'utf8' });
  return run.status === 0;
}

// One output line for an event that the notify command took: the command keeps
// the complete event, so the follower's log names the event only.
function deliveredLine(event) {
  return { type: 'baton-seat-event-delivered', at: event.at, database: event.database, event: event.event,
    key: event.key };
}

// Delivers the pending events of every database: runs the notify argv and writes
// each delivered event to output, the complete event without --notify and one
// short line with it. An event leaves the cursor only after its delivery succeeds.
function deliver(cursor, options, output) {
  let delivered = 0;
  for (const entry of Object.values(cursor.databases)) {
    const kept = [];
    for (const event of entry.pending ?? []) {
      const sent = options.notify ? runNotify(options.notify, event) : true;
      if (sent) {
        if (options.follow) output.write(JSON.stringify(options.notify ? deliveredLine(event) : event) + '\n');
        delivered += 1;
      } else kept.push(event);
    }
    if (!options.follow && !options.notify) kept.length = 0;
    entry.pending = kept;
  }
  return delivered;
}

export async function seatEvents(options, output = process.stdout) {
  const periods = { silent: options.silentSeconds ?? DEFAULT_PERIOD_SECONDS,
    untaken: options.untakenSeconds ?? DEFAULT_PERIOD_SECONDS,
    unconfirmed: options.unconfirmedSeconds ?? DEFAULT_PERIOD_SECONDS };
  const cursor = readCursor(options.cursor);
  const databases = [...options.databases];
  const children = [];
  let finished = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const env = { ...process.env };
  for (const name of ['BATON_SESSION', 'BATON_DATABASE', 'BATON_ATTEMPT_DIRECTORY', 'BATON_MCP_INPUT']) delete env[name];
  // Databases under the roots that the watcher does not follow yet. Each starts
  // at its first message: it had no seat database when the watcher started.
  const discover = () => {
    if (!options.roots?.length) return;
    let found;
    try { found = seatDatabases(options.roots); }
    catch (error) { process.stderr.write(`seat-events: the seat home was not read: ${error.message}\n`); return; }
    for (const database of found) {
      if (databases.includes(database)) continue;
      databases.push(database);
      cursor.databases[database] ??= { through: 0, found: true };
      subscribe(database);
    }
  };
  const check = (selected = databases, scan = false) => {
    if (finished) return;
    if (scan) discover();
    const now = Math.floor(Date.now() / 1000);
    const found = [];
    for (const database of scan ? databases : selected) {
      const entry = cursor.databases[database] ?? (cursor.databases[database] = {});
      if (scan && unchanged(database, entry, now)) continue;
      try {
        found.push(...evaluate({ database, coordinator: options.coordinator, session: options.session, entry, now, periods }));
      } catch (error) {
        process.stderr.write(`seat-events: ${database} was not read: ${error.message}\n`);
      }
    }
    if (!options.follow) {
      if (!found.length) { writeCursor(options.cursor, cursor); return; }
      const events = found.slice();
      deliver(cursor, options, output);
      writeCursor(options.cursor, cursor);
      output.write(JSON.stringify({ type: 'baton-seat-events', events }) + '\n');
      finished = true;
      resolveDone();
      return;
    }
    deliver(cursor, options, output);
    writeCursor(options.cursor, cursor);
  };
  // A commit notice from one database evaluates that database; the interval
  // evaluates every database for the timed events.
  function subscribe(database) {
    if (finished) return;
    const child = spawn(options.coordinator, [database, 'ui-subscribe', '0', '0'], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    children.push(child);
    createInterface({ input: child.stdout }).on('line', () => check([database]));
  }
  // The first evaluation fixes each database's starting position and seat facts
  // before any subscription opens, so every commit after a subscription is
  // ready is compared with that baseline.
  check();
  for (const database of databases) subscribe(database);
  const interval = setInterval(() => check(databases, true), Math.max(1, Math.min(60, Math.floor(Math.min(periods.silent, periods.untaken, periods.unconfirmed) / 4))) * 1000);
  // A stopped watcher ends its subscriptions too; a signal would otherwise
  // leave each ui-subscribe child running without a reader.
  const stop = () => { finished = true; resolveDone(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try { await done; }
  finally {
    clearInterval(interval);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
}

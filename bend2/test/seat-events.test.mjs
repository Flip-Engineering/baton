import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const script = resolve('bend2/scripts/root-notice.mjs');

// A seat database with the tables the watcher reads.
function seatDatabase(t, name, path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,native TEXT,endpoint TEXT);
    CREATE TABLE session_stops(session TEXT PRIMARY KEY);
    CREATE TABLE messages(seq INTEGER PRIMARY KEY,id TEXT,sender TEXT,recipient TEXT,kind TEXT,body TEXT);
    CREATE TABLE message_reads(message TEXT,recipient TEXT,native TEXT);
    CREATE TABLE executions(session TEXT PRIMARY KEY,id TEXT,mode TEXT,directory TEXT,phase TEXT,status TEXT);
    CREATE TABLE native_changes(change_id INTEGER PRIMARY KEY,recorded_at TEXT,entity TEXT,entity_id TEXT,operation TEXT);
    CREATE TRIGGER stamp AFTER INSERT ON messages BEGIN INSERT INTO native_changes(recorded_at,entity,entity_id,operation)
      VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'message',NEW.id,'insert'); END;
    CREATE TABLE fake_status(id INTEGER PRIMARY KEY,value TEXT);
    INSERT INTO sessions VALUES('operator',NULL,'operator','','');`);
  t.after(() => db.close());
  return { name, path, db };
}

// Two seat databases, a fake coordinator whose status answer each test writes,
// and a commit notice the test sends to every subscription.
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'seat-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databases = ['alpha', 'beta'].map((name) => seatDatabase(t, name, join(dir, name + '.db')));
  const clients = [];
  const server = createServer((socket) => {
    socket.on('error', () => {});
    clients.push(socket);
    socket.write('{"kind":"ready"}\n');
  });
  server.listen(join(dir, 'events.sock'));
  await once(server, 'listening');
  t.after(() => { for (const client of clients) client.destroy(); server.close(); });
  const coordinator = join(dir, 'baton');
  writeFileSync(coordinator, `#!${process.execPath}
const [database, verb] = process.argv.slice(2);
if (verb === 'status') {
  const db = new (require('node:sqlite').DatabaseSync)(database, { readOnly: true });
  process.stdout.write(db.prepare('SELECT coalesce((SELECT value FROM fake_status WHERE id=1),?) AS value').get('[]').value);
  db.close();
} else {
  const socket = require('net').createConnection(${JSON.stringify(join(dir, 'events.sock'))});
  socket.pipe(process.stdout);
  socket.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
}
`, { mode: 0o755 });
  const status = (database, rows) => database.db.prepare('INSERT OR REPLACE INTO fake_status(id,value) VALUES(1,?)')
    .run(JSON.stringify(rows));
  const start = (extra) => {
    const child = spawn(process.execPath, [script, '--coordinator', coordinator, '--session', 'operator',
      ...databases.flatMap((database) => ['--database', database.path]), ...extra]);
    let out = '', error = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; if (process.env.SEAT_EVENTS_DEBUG) process.stderr.write(chunk); });
    const ended = once(child, 'close').then(([code, signal]) => ({ code, signal, out, error }));
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await ended; });
    return { child, ended, output: () => out };
  };
  const ready = async (count) => { while (clients.length < count) await once(server, 'connection'); };
  const commit = () => { for (const client of clients) client.write('{"kind":"commit"}\n'); };
  return { dir, databases, status, start, ready, commit };
}

function seat(id, fields = {}) {
  return { id, role: 'principal-conductor', state: 'working', blockedCause: '', operatorWaitingSince: null,
    taskCompletion: { requestId: null }, ...fields };
}

const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

test('one wait over two databases returns the first message for the operator from either', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const run = f.start([]);
  await f.ready(2);
  const [, beta] = f.databases;
  beta.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('short-question', 'seat-b', 'operator', 'report', 'Which remote?');
  f.commit();
  const ended = await run.ended;
  assert.equal(ended.code, 0, ended.error);
  const { events } = JSON.parse(ended.out);
  assert.deepEqual(events.map((event) => [event.event, event.database, event.id, event.kind, event.body]),
    [['message', beta.path, 'short-question', 'report', 'Which remote?']]);
  assert.match(events[0].committedAt, /^\d{4}-\d\d-\d\dT/);
});

test('a seat that becomes blocked and a native that ends are events', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const [alpha] = f.databases;
  f.status(alpha, [seat('seat-a')]);
  alpha.db.exec("INSERT INTO executions VALUES('seat-a','attempt-1','retained','','running','')");
  // Execution and status rows are separate reads, so the two events can come
  // from one evaluation or from two; the follower delivers each of them.
  const run = f.start(['--follow']);
  await f.ready(2);
  alpha.db.exec('BEGIN');
  alpha.db.exec("UPDATE executions SET phase='exited',status='exit 1'");
  f.status(alpha, [seat('seat-a', { state: 'blocked', blockedCause: 'provider-failure',
    refusal: { attempt: 'attempt-1', cause: 'flagged' } })]);
  alpha.db.exec('COMMIT');
  const events = () => run.output().split('\n').filter(Boolean).map(JSON.parse);
  while (!['blocked', 'native-ended'].every((name) => events().some((event) => event.event === name))) {
    f.commit();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  run.child.kill();
  await run.ended;
  const blocked = events().find((event) => event.event === 'blocked');
  assert.deepEqual([blocked.seat, blocked.cause, blocked.refusal.cause], ['seat-a', 'provider-failure', 'flagged']);
  assert.equal(events().find((event) => event.event === 'native-ended').status, 'exit 1');
  assert.equal(events().filter((event) => event.event === 'blocked').length, 1);
});

test('untaken operator input, an unconfirmed completion request and a silent native are timed events', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const [alpha] = f.databases;
  alpha.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('request-1', 'seat-c', 'operator', 'completion-request', 'Done.');
  alpha.db.prepare("UPDATE native_changes SET recorded_at=? WHERE entity_id='request-1'").run(ago(1200));
  const attempt = join(f.dir, 'attempt-s');
  mkdirSync(attempt);
  writeFileSync(join(attempt, 'stdout'), '{"type":"thread.started"}\n');
  const old = (Date.now() - 1200 * 1000) / 1000;
  utimesSync(join(attempt, 'stdout'), old, old);
  alpha.db.prepare("INSERT INTO executions VALUES('seat-s','attempt-s','retained',?,'running','')").run(attempt);
  f.status(alpha, [
    seat('seat-u', { state: 'waiting', operatorWaitingSince: ago(1200) }),
    seat('seat-c', { state: 'asks-to-end', taskCompletion: { requestId: 'request-1' } }),
    seat('seat-s'),
    seat('seat-fresh', { state: 'waiting', operatorWaitingSince: ago(10) })]);
  const run = f.start(['--untaken-seconds', '600', '--unconfirmed-seconds', '600', '--silent-seconds', '600']);
  const ended = await run.ended;
  assert.equal(ended.code, 0, ended.error);
  const events = JSON.parse(ended.out).events;
  assert.deepEqual(events.map((event) => [event.event, event.seat]).sort(),
    [['completion-unconfirmed', 'seat-c'], ['operator-input-untaken', 'seat-u'], ['silent', 'seat-s']]);
});

test('follow runs the notify command per event, retries a failed delivery and keeps its cursor', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const [alpha] = f.databases;
  const received = join(f.dir, 'received.jsonl');
  const notify = join(f.dir, 'notify');
  // The first delivery fails; later deliveries append the event.
  writeFileSync(notify, `#!/bin/sh\nif [ ! -e "${f.dir}/failed-once" ]; then touch "${f.dir}/failed-once"; exit 1; fi\ncat >> "${received}"\n`,
    { mode: 0o755 });
  const cursor = join(f.dir, 'cursor.json');
  const run = f.start(['--follow', '--cursor', cursor, '--notify', JSON.stringify([notify]), '--untaken-seconds', '1']);
  await f.ready(2);
  alpha.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('blocked-question', 'seat-a', 'operator', 'question', 'Blocked: the remote has no such commit.');
  f.commit();
  await new Promise((resolve) => setTimeout(resolve, 300));
  f.commit();
  while (!existsSync(received)) await new Promise((resolve) => setTimeout(resolve, 100));
  const delivered = readFileSync(received, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(delivered.map((event) => event.id), ['blocked-question']);
  run.child.kill();
  await run.ended;
  // The notify command keeps the complete event; the follower writes one short
  // line that names it.
  assert.deepEqual(run.output().split('\n').filter(Boolean).map(JSON.parse),
    [{ type: 'baton-seat-event-delivered', at: delivered[0].at, database: alpha.path, event: 'message',
      key: 'message:blocked-question' }]);
  const saved = JSON.parse(readFileSync(cursor, 'utf8'));
  assert.equal(saved.databases[alpha.path].through, 1);
  assert.deepEqual(saved.databases[alpha.path].pending, []);
  // A new watcher on the same cursor delivers no message twice.
  const again = f.start(['--follow', '--cursor', cursor, '--notify', JSON.stringify([notify])]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  again.child.kill();
  await again.ended;
  assert.equal(readFileSync(received, 'utf8').trim().split('\n').length, 1);
});

test('a follower with --root reports a seat database made after it started', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const root = join(f.dir, 'worktrees');
  mkdirSync(root);
  // A one-second interval: the interval reads the seat home again.
  const run = f.start(['--follow', '--root', root, '--untaken-seconds', '4']);
  await f.ready(2);
  const checkout = join(root, 'gamma');
  assert.equal(spawnSync('git', ['init', '-q', checkout]).status, 0);
  mkdirSync(join(checkout, '.git/baton2'));
  const gamma = seatDatabase(t, 'gamma', join(checkout, '.git/baton2/orchestra.db'));
  // This message is committed before the follower finds the database.
  gamma.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('first-report', 'seat-g', 'operator', 'report', 'Made after the follower started.');
  await f.ready(3);
  const events = () => run.output().split('\n').filter(Boolean).map(JSON.parse);
  while (!events().some((event) => event.id === 'first-report')) await new Promise((resolve) => setTimeout(resolve, 100));
  run.child.kill();
  await run.ended;
  const found = events().filter((event) => event.event === 'message');
  assert.deepEqual(found.map((event) => [event.database, event.id, event.body]),
    [[realpathSync(gamma.path), 'first-report', 'Made after the follower started.']]);
});

test('a follower with --root reports a native that ended before it found the seat database', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const root = join(f.dir, 'worktrees');
  mkdirSync(root);
  const run = f.start(['--follow', '--root', root, '--untaken-seconds', '4']);
  await f.ready(2);
  const checkout = join(root, 'delta');
  assert.equal(spawnSync('git', ['init', '-q', checkout]).status, 0);
  mkdirSync(join(checkout, '.git/baton2'));
  const delta = seatDatabase(t, 'delta', join(checkout, '.git/baton2/orchestra.db'));
  // The seat's first native ran and ended before the follower read the seat home.
  delta.db.exec("INSERT INTO executions VALUES('seat-d','attempt-d','retained','','exited','exit 0')");
  f.status(delta, [seat('seat-d', { state: 'waiting' }), seat('seat-idle', { state: 'waiting' })]);
  await f.ready(3);
  const events = () => run.output().split('\n').filter(Boolean).map(JSON.parse);
  const deadline = Date.now() + 10000;
  while (!events().some((event) => event.event === 'native-ended') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // A later evaluation of the same database reports the ended native no more.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  run.child.kill();
  await run.ended;
  const ended = events().filter((event) => event.event === 'native-ended');
  assert.deepEqual(ended.map((event) => [event.database, event.seat, event.attempt, event.phase, event.status]),
    [[realpathSync(delta.path), 'seat-d', 'attempt-d', 'exited', 'exit 0']]);
});

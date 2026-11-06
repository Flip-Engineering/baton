import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const script = resolve('bend2/scripts/root-notice.mjs');
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'root-notice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const database = join(dir, 'orchestra.db');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE sessions(id TEXT PRIMARY KEY,parent TEXT,harness TEXT,native TEXT,endpoint TEXT);
    CREATE TABLE session_stops(session TEXT PRIMARY KEY);
    CREATE TABLE messages(seq INTEGER PRIMARY KEY,id TEXT,sender TEXT,recipient TEXT,kind TEXT,body TEXT);
    CREATE TABLE message_reads(message TEXT,recipient TEXT,native TEXT);
    INSERT INTO sessions VALUES('operator',NULL,'codex','retained-codex-thread','retained-codex-endpoint');`);
  t.after(() => db.close());
  const clients = [];
  const server = createServer(socket => {
    socket.on('error', () => {});
    clients.push(socket);
    socket.write('{"kind":"ready"}\n');
  });
  server.listen(join(dir, 'events.sock'));
  await once(server, 'listening');
  t.after(() => { for (const client of clients) client.destroy(); server.close(); });
  const coordinator = join(dir, 'baton');
  writeFileSync(coordinator, `#!${process.execPath}
require('fs').appendFileSync(${JSON.stringify(join(dir, 'calls'))},JSON.stringify(process.argv.slice(2))+'\\n');
const socket=require('net').createConnection(${JSON.stringify(join(dir, 'events.sock'))});
socket.pipe(process.stdout);
socket.on('error',error=>{console.error(error.message);process.exitCode=1;});
`, { mode: 0o755 });
  const start = (native, fresh = true, ssh = false, index = false) => {
    if (ssh) {
      writeFileSync(join(dir, 'ssh'), '#!/bin/sh\nshift 2\nexec /bin/sh -c "$1"\n', { mode: 0o755 });
      writeFileSync(join(dir, 'sudo'), '#!/bin/sh\n[ "$1 $2 $3 $4" = "-n -u batonci --" ] || exit 2\nshift 4\nexec "$@"\n', { mode: 0o755 });
    }
    const child = spawn(process.execPath, [ssh ? resolve('bend2/scripts/root-notice-ssh.mjs') : script,
      ...(ssh ? ['--ssh', 'fixture-host', '--as-user', 'batonci', '--node', process.execPath, '--script', script] : []),
      '--database', database, '--coordinator', coordinator,
      '--session', 'operator', '--native', native, ...(fresh ? ['--new'] : []), ...(index ? ['--index'] : [])],
    { env: { ...process.env, PATH: dir + ':' + process.env.PATH } });
    let out = '', error = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    const ended = once(child, 'close').then(([code, signal]) => ({ code, signal, out, error }));
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await ended; });
    return { child, ended };
  };
  const ready = async count => {
    while (clients.length < count) await once(server, 'connection');
  };
  return { database, db, clients, coordinator, dir, start, ready,
    commit() { for (const client of clients) client.write('{"kind":"commit"}\n'); } };
}

test('independent native roots receive complete committed questions and keep the recorded root identity', async t => {
  const f = await fixture(t);
  const first = f.start('claude-on-mac');
  const second = f.start('codex-on-mac');
  await f.ready(2);
  const body = 'Blocking question with complete unicode input: café.\n' + 'detail '.repeat(3000);
  f.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('question', 'worker', 'operator', 'question', body);
  f.commit();
  for (const [run, native] of [[first, 'claude-on-mac'], [second, 'codex-on-mac']]) {
    const ended = await run.ended;
    assert.equal(ended.code, 0, ended.error);
    const notice = JSON.parse(ended.out);
    assert.equal(notice.native, native);
    assert.equal(notice.messages[0].body, body);
    assert.ok(notice.content.includes(body));
  }
  assert.deepEqual({ ...f.db.prepare('SELECT harness,native,endpoint FROM sessions').get() },
    { harness: 'codex', native: 'retained-codex-thread', endpoint: 'retained-codex-endpoint' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  const records = readFileSync(f.database + '.root.log', 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(new Set(records.map(row => row.native)), new Set(['claude-on-mac', 'codex-on-mac']));
  assert.ok(records.every(row => row.read === 'unrecorded'));
  const calls = readFileSync(join(f.dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls, Array(2).fill([f.database, 'ui-subscribe', '0', '0']));
});

test('the SSH adapter forwards retained complete input and leaves it unread', async t => {
  const f = await fixture(t);
  f.db.exec("INSERT INTO messages VALUES(1,'retained','worker','operator','report','Retained failure report')");
  const run = f.start('claude-on-mac', false, true);
  const ended = await run.ended;
  assert.equal(ended.code, 0, ended.error);
  assert.equal(JSON.parse(ended.out).messages[0].id, 'retained');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
});

test('a stopped root keeps the message pending and emits no delivery record', async t => {
  const f = await fixture(t);
  const run = f.start('claude-on-mac');
  await f.ready(1);
  f.db.exec("INSERT INTO session_stops VALUES('operator'); INSERT INTO messages VALUES(1,'retained','worker','operator','question','Pending question')");
  f.commit();
  const ended = await run.ended;
  assert.equal(ended.code, 1);
  assert.match(ended.error, /explicitly stopped/);
  assert.equal(ended.out, '');
  assert.equal(existsSync(f.database + '.root.log'), false);
});

test('an index notice batches pending input and preserves the complete bodies for reads and re-arming', async t => {
  const f = await fixture(t);
  const body = 'Complete retained question: café.\n' + 'details '.repeat(3000);
  const insert = f.db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)');
  insert.run('first', 'worker-a', 'operator', 'question', body);
  insert.run('second', 'worker-b', 'operator', 'report', 'Blocking report.');
  const run = f.start('claude-on-mac', false, false, true);
  const ended = await run.ended;
  assert.equal(ended.code, 0, ended.error);
  const notice = JSON.parse(ended.out);
  assert.deepEqual(notice.messages.map(row => row.id), ['first', 'second']);
  assert.equal(notice.messages[0].bodyBytes, Buffer.byteLength(body));
  assert.equal(Object.hasOwn(notice.messages[0], 'body'), false);
  assert.equal(f.db.prepare('SELECT body FROM messages WHERE id=?').get('first').body, body);
  assert.match(notice.rearm, /--new omitted/);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
});

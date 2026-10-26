// Root channel attachment (#1054): the configuration printed by
// root-channel-config.mjs, and the operator role kept by mcp-conductor.mjs.
// Run with: node --test bend2/test/root-channel-attach.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts');
const CONFIG = join(SCRIPTS, 'root-channel-config.mjs');
const CONDUCTOR = join(SCRIPTS, 'mcp-conductor.mjs');

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'root-channel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return realpathSync(dir);
}

function executable(path, text) {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
  return path;
}

function orchestra(dir) {
  const path = join(dir, 'orchestra.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY, parent TEXT, harness TEXT, native TEXT, endpoint TEXT);
    CREATE TABLE session_roles(session TEXT PRIMARY KEY, role TEXT);
    CREATE TABLE session_stops(session TEXT PRIMARY KEY);
    CREATE TABLE message_reads(attempt TEXT, message TEXT, recipient TEXT, native TEXT, identity TEXT, handled TEXT);
    CREATE TABLE messages(seq INTEGER PRIMARY KEY, id TEXT, sender TEXT, recipient TEXT, kind TEXT, body TEXT, receipt TEXT);
    INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'operator'),('lead',NULL,'claude-code');
    INSERT INTO session_roles(session,role) VALUES('operator','operator'),('lead','conductor');`);
  db.close();
  return path;
}

function config(...args) {
  return spawnSync(process.execPath, [CONFIG, ...args], { encoding: 'utf8' });
}

test('local configuration runs the conductor with absolute paths', (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const baton = executable(join(dir, 'baton'), '#!/bin/sh\n');
  const result = config(database, baton, '--session', 'operator', '--name', 'baton-home');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mcpServers: { 'baton-home': {
    command: process.execPath, args: [CONDUCTOR, database, baton, '--session', 'operator'] } } });
  assert.match(result.stderr, /claude --mcp-config FILE --dangerously-load-development-channels server:baton-home/);
});

test('ssh configuration runs the conductor on the database host', (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const baton = executable(join(dir, "ba'ton"), '#!/bin/sh\n');
  const printer = executable(join(dir, 'print-args'), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  const result = config(database, baton, '--session', 'operator', '--ssh', 'homelab', '--node', printer);
  assert.equal(result.status, 0, result.stderr);
  const servers = JSON.parse(result.stdout).mcpServers;
  const [name] = Object.keys(servers);
  assert.match(name, /^baton-root-channel-/);
  const entry = servers[name];
  assert.equal(entry.command, 'ssh');
  assert.deepEqual(entry.args.slice(0, 2), ['-T', 'homelab']);
  // The remote shell receives the third argument as one command line.
  const remote = spawnSync('sh', ['-c', entry.args[2]], { encoding: 'utf8' });
  assert.equal(remote.status, 0, remote.stderr);
  assert.deepEqual(remote.stdout.trimEnd().split('\n'), [CONDUCTOR, database, baton, '--session', 'operator']);
  assert.match(result.stderr, new RegExp(`server:${name}`));
});

test('a database that does not exist on this host is refused', (t) => {
  const dir = scratch(t);
  const baton = executable(join(dir, 'baton'), '#!/bin/sh\n');
  const result = config(join(dir, 'missing.db'), baton, '--session', 'operator');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing\.db does not exist on this host/);
  assert.equal(result.stdout, '');
});

// The fake coordinator records each argv as one JSON line.
async function attach(t, session, setup = () => {}) {
  const dir = scratch(t);
  const database = orchestra(dir);
  const connection = new DatabaseSync(database);
  setup(connection);
  connection.close();
  const log = join(dir, 'coordinator.log');
  const fake = executable(join(dir, 'baton'),
    `#!${process.execPath}
const args = process.argv.slice(2);
require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const { DatabaseSync } = require('node:sqlite');
if (args[0] === '--help' || args[0] === 'help') process.exit(0);
const db = new DatabaseSync(args[0]);
if (args[1] === 'attach') {
  db.prepare('UPDATE sessions SET harness=?,native=?,endpoint=? WHERE id=?').run(args[3],args[4],args[5],args[2]);
} else if (args[1] === 'session') {
  console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id=?').get(args[2])));
} else if (args[1] === 'delivery') {
  const message = db.prepare('SELECT * FROM messages WHERE id=?').get(args[2]);
  if (message?.recipient === process.env.BATON_SESSION) {
    const context = JSON.parse(process.env.BATON_MCP_INPUT);
    if (!context.ready) throw new Error('The channel is not ready.');
    db.prepare('INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES(?,?,?,?,?)')
      .run('fixture-read',message.id,message.recipient,context.native,'fixture-coordinator');
  }
  console.log(JSON.stringify(message ?? null));
} else if (args[1] === 'status') console.log('{}');
db.close();
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', session], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      responses.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
  });
  const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const until = async (done, what) => {
    for (let n = 0; n < 200 && !done(); n++) await new Promise((wake) => setTimeout(wake, 50));
    assert.ok(done(), `${what}; stderr: ${stderr}`);
  };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await until(() => responses.some((r) => r.id === 1), 'initialize answered');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  // The server sends this request after its delivery endpoint is registered.
  await until(() => responses.some((r) => r.id === 'conductor-channel-ready'), 'delivery registered');
  const recorded = calls().filter((argv) => argv[0] === database).map((argv) => argv.slice(1));
  recorded.database = database;
  recorded.channel = { child, send, responses, until, fake, log,
    activate: () => send({ id: 'conductor-channel-ready', result: {} }),
    notes: () => responses.filter((r) => r.method === 'notifications/claude/channel'),
    async call(id, name, args = {}) {
      send({ id, method: 'tools/call', params: { name, arguments: args } });
      await until(() => responses.some((r) => r.id === id), `${name} answered`);
      return responses.find((r) => r.id === id).result;
    },
    async barrier(id) {
      send({ id, method: 'ping' });
      await until(() => responses.some((r) => r.id === id), 'ping answered');
    },
    async deliver(id) {
      const endpoint = JSON.parse(recorded.find((args) => args[0] === 'attach')[4]);
      const delivery = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', session, '--deliver', endpoint[7], id],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      let error = '';
      delivery.stderr.on('data', (chunk) => { error += chunk; });
      const [code, signal] = await once(delivery, 'exit');
      assert.equal(code, 0, `${signal ?? ''} ${error}`);
    },
    async native(event, prompt) {
      const native = new DatabaseSync(database, { readOnly: true });
      const sessionId = native.prepare('SELECT native FROM sessions WHERE id=?').get(session).native;
      native.close();
      const hook = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', session, '--native-event'],
        { stdio: ['pipe', 'pipe', 'pipe'] });
      let error = '';
      hook.stderr.on('data', (chunk) => { error += chunk; });
      hook.stdin.end(JSON.stringify({ hook_event_name: event, session_id: sessionId, prompt_id: prompt }));
      const [code, signal] = await once(hook, 'exit');
      assert.equal(code, 0, `${signal ?? ''} ${error}`);
    },
  };
  return recorded;
}

test('an operator attachment keeps the operator role', async (t) => {
  const calls = await attach(t, 'operator');
  const attached = calls.find((argv) => argv[0] === 'attach');
  assert.deepEqual(attached.slice(0, 3), ['attach', 'operator', 'claude-code']);
  assert.deepEqual(JSON.parse(attached[4]).slice(4, 7), ['--session', 'operator', '--deliver']);
  assert.equal(calls.filter((argv) => argv[0] === 'role').length, 0, JSON.stringify(calls));
});

test('a parentless conductor attachment records the principal role', async (t) => {
  const calls = await attach(t, 'lead');
  assert.deepEqual(calls.filter((argv) => argv[0] === 'role'), [['role', 'lead', 'principal-conductor']]);
});

// Baton's root channel check connects to the delivery socket and sends
// nothing. The server closes that connection with no answer. The probe runs in
// the database directory, where the socket name in the endpoint is relative.
const PROBE = `const c = require('net').createConnection({ path: process.argv[1] });
let text = '';
c.on('connect', () => c.end());
c.on('data', (chunk) => { text += chunk; });
c.on('error', (error) => { console.error(error.code); process.exit(2); });
c.on('close', () => { process.stdout.write(JSON.stringify(text)); });`;

test('a connect probe that sends nothing gets no answer', async (t) => {
  const calls = await attach(t, 'operator');
  const endpoint = JSON.parse(calls.find((argv) => argv[0] === 'attach')[4]);
  const probe = spawnSync(process.execPath, ['-e', PROBE, endpoint[7]],
    { cwd: dirname(calls.database), encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout), '');
});

test('retained root backlog produces a stored-input pointer and preserves every unread body', async (t) => {
  const retained = 7136;
  const body = 'Retained report body. λ🙂\n'.repeat(40) + 'Complete tail.';
  const calls = await attach(t, 'operator', (db) => {
    const insert = db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)');
    db.exec('BEGIN');
    for (let n = 0; n < retained; n++) insert.run(`retained-${n}`, 'worker', 'operator', 'report', body);
    db.exec('COMMIT');
  });
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'retained input notice');
  const notice = channel.notes()[0];
  assert.deepEqual(JSON.parse(notice.params.meta.messageIds), ['retained-0']);
  assert.match(notice.params.content, /baton2_delivery/);
  assert.ok(!notice.params.content.includes(body));
  assert.ok(!notice.params.content.includes(`retained-${retained - 1}`));
  const db = new DatabaseSync(calls.database, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages WHERE body=? AND receipt IS NULL').get(body).n, retained);
  db.close();
});

test('a complete recipient read advances the root backlog without a clearing action', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET native=? WHERE id=?').run('retained-native', 'operator');
    const insert = db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)');
    insert.run('first', 'worker', 'operator', 'report', 'First complete body.\nλ🙂\nTail.');
    insert.run('second', 'worker', 'operator', 'report', 'Second complete body.');
  });
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'first input notice');
  assert.deepEqual(JSON.parse(channel.notes()[0].params.meta.messageIds), ['first']);
  const first = await channel.call('read-first', 'baton2_delivery', { id: 'first' });
  assert.equal(JSON.parse(first.content[0].text).body, 'First complete body.\nλ🙂\nTail.');
  await channel.until(() => channel.notes().some((note) => note.params.meta.messageIds === '["second"]'), 'next unread input notice');
  const second = await channel.call('read-second', 'baton2_delivery', { id: 'second' });
  assert.equal(JSON.parse(second.content[0].text).body, 'Second complete body.');
  const notes = channel.notes().slice();
  await channel.barrier('drained');
  assert.deepEqual(channel.notes(), notes);
  const db = new DatabaseSync(calls.database, { readOnly: true });
  assert.deepEqual(db.prepare('SELECT message,native,handled FROM message_reads ORDER BY message').all().map((r) => ({ ...r })),
    [{ message: 'first', native: 'retained-native', handled: null }, { message: 'second', native: 'retained-native', handled: null }]);
  assert.deepEqual(db.prepare('SELECT id,receipt FROM messages ORDER BY seq').all().map((r) => ({ ...r })),
    [{ id: 'first', receipt: null }, { id: 'second', receipt: null }]);
  db.close();
  const actions = readFileSync(channel.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(actions.every((args) => !['ack', 'acknowledge'].includes(args[1])));
});

test('an unread notice returns on native prompt changes and respects an explicit stop', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET native=? WHERE id=?').run('retained-native', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('unread', 'worker', 'operator', 'report', 'Retain this body until a complete read.');
  });
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'initial unread notice');
  const initial = channel.notes().slice();
  await channel.call('status', 'baton2_status');
  await channel.barrier('unchanged');
  assert.deepEqual(channel.notes(), initial);
  await channel.native('PreToolUse', 'prompt-1');
  await channel.barrier('first-prompt');
  assert.deepEqual(channel.notes().slice(initial.length).map((r) => JSON.parse(r.params.meta.messageIds)), [['unread']]);
  const firstPrompt = channel.notes().slice();
  await channel.native('PreToolUse', 'prompt-1');
  await channel.barrier('same-prompt');
  assert.deepEqual(channel.notes(), firstPrompt);
  await channel.native('Stop', 'prompt-1');
  await channel.barrier('unread-turn-ended');
  assert.deepEqual(channel.notes().slice(firstPrompt.length).map((r) => JSON.parse(r.params.meta.messageIds)), [['unread']]);
  const db = new DatabaseSync(calls.database);
  assert.equal(db.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  db.prepare('INSERT INTO session_stops VALUES(?)').run('operator');
  const stopped = channel.notes().slice();
  await channel.native('PreToolUse', 'prompt-2');
  await channel.barrier('explicit-stop');
  assert.deepEqual(channel.notes(), stopped);
  db.close();
});

test('new committed input has a pointer while older unread history stays recoverable', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('old-report', 'worker', 'operator', 'report', 'Older unread history.');
  });
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'old input notice');
  const db = new DatabaseSync(calls.database);
  db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('new-guidance', 'parent', 'operator', 'guidance', 'New committed guidance.');
  await channel.deliver('new-guidance');
  await channel.barrier('new-input');
  const latest = channel.notes().at(-1);
  assert.deepEqual(JSON.parse(latest.params.meta.messageIds), ['new-guidance']);
  assert.ok(!latest.params.content.includes('New committed guidance.'));
  await channel.call('read-new', 'baton2_delivery', { id: 'new-guidance' });
  await channel.barrier('old-input-remains');
  assert.deepEqual(JSON.parse(channel.notes().at(-1).params.meta.messageIds), ['old-report']);
  assert.deepEqual(db.prepare('SELECT message FROM message_reads').all().map((r) => r.message), ['new-guidance']);
  assert.equal(db.prepare('SELECT body,receipt FROM messages WHERE id=?').get('old-report').body, 'Older unread history.');
  assert.equal(db.prepare('SELECT body,receipt FROM messages WHERE id=?').get('old-report').receipt, null);
  db.close();
});

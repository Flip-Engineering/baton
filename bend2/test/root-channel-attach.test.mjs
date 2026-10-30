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
  const result = config(database, baton, '--session', 'operator', '--resume', 'claude-root-thread',
    '--ssh', 'homelab', '--node', printer);
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
  assert.match(result.stderr, new RegExp(`claude --resume claude-root-thread --mcp-config FILE --dangerously-load-development-channels server:${name}`));
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
async function attach(t, session, setup = () => {}, extraArgs = [], nativeAttachment = false) {
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
if (args[0] === '--help' || args[0] === 'help') {
  if (${nativeAttachment}) console.log('native-attachment-input');
  process.exit(0);
}
const db = new DatabaseSync(args[0]);
if (args[1] === 'native-attachment-input') {
  const selected = db.prepare('SELECT harness FROM sessions WHERE id=?').get(args[2]);
  if (selected?.harness !== 'claude-code') {
    console.error('Native attachment initialization requires a Claude conversation.');
    process.exit(2);
  }
  process.stdin.pipe(process.stdout);
} else if (args[1] === 'attach') {
  db.prepare('UPDATE sessions SET harness=?,native=?,endpoint=? WHERE id=?').run(args[3],args[4],args[5],args[2]);
} else if (args[1] === 'connect') {
  db.prepare('UPDATE sessions SET endpoint=? WHERE id=?').run(args[4],args[2]);
} else if (args[1] === 'session') {
  console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id=?').get(args[2])));
} else if (args[1] === 'delivery') {
  const message = db.prepare('SELECT * FROM messages WHERE id=?').get(args[2]);
  if (message?.recipient === process.env.BATON_SESSION) {
    const context = JSON.parse(process.env.BATON_MCP_INPUT);
    if (!context.ready) throw new Error('The channel is not ready.');
    require('fs').appendFileSync(${JSON.stringify(log + '.context')}, JSON.stringify(context) + '\\n');
    db.prepare('INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES(?,?,?,?,?)')
      .run('fixture-read',message.id,message.recipient,context.native,'fixture-coordinator');
  }
  console.log(JSON.stringify(message ?? null));
} else if (args[1] === 'status') console.log('{}');
db.close();
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', session, ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  assert.equal(responses.find((r) => r.id === 1).error, undefined, 'initialize succeeded');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  // The server sends this request after its delivery endpoint is registered.
  await until(() => responses.some((r) => r.id === 'conductor-channel-ready'), 'delivery registered');
  const recorded = calls().filter((argv) => argv[0] === database).map((argv) => argv.slice(1));
  recorded.database = database;
  recorded.channel = { child, send, responses, until, fake, log, contextLog: log + '.context',
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
      const registration = recorded.find((args) => ['attach', 'connect'].includes(args[0]));
      const endpoint = JSON.parse(registration[registration[0] === 'attach' ? 4 : 3]);
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

test('a Codex root relay preserves its harness, thread and operator role', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
  }, ['--root-harness', 'codex', '--thread', 'thread-1'], true);
  const connected = calls.find((argv) => argv[0] === 'connect');
  assert.deepEqual(connected.slice(0, 3), ['connect', 'operator', 'thread-1']);
  const endpoint = JSON.parse(connected[3]);
  assert.deepEqual(endpoint.slice(4, 7), ['--session', 'operator', '--deliver']);
  const db = new DatabaseSync(calls.database, { readOnly: true });
  const selected = db.prepare('SELECT harness,native FROM sessions WHERE id=?').get('operator');
  assert.deepEqual({ ...selected }, { harness: 'codex', native: 'thread-1' });
  assert.equal(db.prepare('SELECT role FROM session_roles WHERE session=?').get('operator').role, 'operator');
  db.close();
});

// A relay that accepts the route stays alive. Observe its readiness before
// closing stdin so a rejected-thread regression completes against that relay.
async function relayStartup(child) {
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.on('error', (error) => { stderr += `${error.message}\n`; });
  let ready;
  const registered = new Promise((resolve) => { ready = resolve; });
  const responses = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const response = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      responses.push(response);
      if (response.id === 'conductor-channel-ready') ready();
    }
  });
  child.stdin.write([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'thread-mismatch', version: '1' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map(JSON.stringify).join('\n') + '\n');
  let outcome;
  try {
    outcome = await Promise.race([
      closed.then(() => 'closed'), registered.then(() => 'registered'),
    ]);
  } finally {
    child.stdin.end();
    await closed;
  }
  const [code, signal] = await closed;
  assert.ok(responses.some((response) => response.id === 1 && response.result), stderr);
  return { outcome, code, signal, stderr };
}

test('a Codex relay with a different thread exits before registering its route', async (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const db = new DatabaseSync(database);
  db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'recorded-thread', 'operator');
  db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('owed-before-thread-check', 'lead', 'operator', 'report', 'Keep this input owed.');
  db.close();
  const log = join(dir, 'coordinator.log');
  const fake = executable(join(dir, 'baton'),
    `#!${process.execPath}
const args = process.argv.slice(2);
require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const { DatabaseSync } = require('node:sqlite');
if (args[0] === '--help' || args[0] === 'help') process.exit(0);
const db = new DatabaseSync(args[0]);
if (args[1] === 'connect') db.prepare('UPDATE sessions SET endpoint=? WHERE id=?').run(args[4],args[2]);
db.close();
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', 'operator',
    '--root-harness', 'codex', '--thread', 'different-thread'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const { outcome, code, signal, stderr } = await relayStartup(child);
  assert.equal(outcome, 'closed', 'A different thread registered a delivery route.');
  assert.equal(code, 1, `${signal ?? ''} ${stderr}`);
  assert.match(stderr, /Codex relay thread must match the recorded root conversation/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter((args) => args[1] === 'connect'), []);
  const after = new DatabaseSync(database, { readOnly: true });
  assert.equal(after.prepare('SELECT endpoint FROM sessions WHERE id=?').get('operator').endpoint, null);
  assert.equal(after.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  assert.equal(after.prepare('SELECT receipt FROM messages WHERE id=?').get('owed-before-thread-check').receipt, null);
  after.close();
});

test('a parented Codex relay with a different thread exits before connecting or notifying', async (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const db = new DatabaseSync(database);
  db.prepare('INSERT INTO sessions(id,parent,harness,native) VALUES(?,?,?,?)')
    .run('child', 'lead', 'codex', 'recorded-child-thread');
  db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('owed-child-input', 'lead', 'child', 'report', 'Keep this child input owed.');
  db.close();
  const log = join(dir, 'coordinator.log');
  const fake = executable(join(dir, 'baton'),
    `#!${process.execPath}
const args = process.argv.slice(2);
require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const { DatabaseSync } = require('node:sqlite');
if (args[0] === '--help' || args[0] === 'help') process.exit(0);
const db = new DatabaseSync(args[0]);
if (args[1] === 'connect') db.prepare('UPDATE sessions SET endpoint=? WHERE id=?').run(args[4],args[2]);
db.close();
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', 'child',
    '--root-harness', 'codex', '--thread', 'different-thread'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const { outcome, code, signal, stderr } = await relayStartup(child);
  assert.equal(outcome, 'closed', 'A different thread registered a delivery route.');
  assert.equal(code, 1, `${signal ?? ''} ${stderr}`);
  assert.match(stderr, /Codex relay thread must match the recorded root conversation/);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter((args) => args[1] === 'connect'), []);
  const after = new DatabaseSync(database, { readOnly: true });
  assert.equal(after.prepare('SELECT endpoint FROM sessions WHERE id=?').get('child').endpoint, null);
  assert.equal(after.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  assert.equal(after.prepare('SELECT receipt FROM messages WHERE id=?').get('owed-child-input').receipt, null);
  after.close();
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

test('retained root backlog sends the oldest complete body and preserves every unread body', async (t) => {
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
  assert.ok(notice.params.content.includes(body));
  assert.match(notice.params.content, /baton2_delivery/);
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
  const firstContext = JSON.parse(readFileSync(channel.contextLog, 'utf8').trim().split('\n')[0]);
  assert.equal(firstContext.readMessage, 'first');
  assert.equal(firstContext.harness, 'claude-code');
  await channel.until(() => channel.notes().some((note) => note.params.meta.messageIds === '["second"]'), 'next unread input notice');
  const second = await channel.call('read-second', 'baton2_delivery', { id: 'second' });
  assert.equal(JSON.parse(second.content[0].text).body, 'Second complete body.');
  const contexts = readFileSync(channel.contextLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(contexts[1].readMessage, 'second');
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

// Calls baton2_root_delivery and answers the conductor's thread item request.
async function rootDelivery(channel, id, args, answer, beforeAnswer = () => {}) {
  const before = channel.responses.filter((r) => r.method === 'baton/rootThreadItem').length;
  const call = channel.call(id, 'baton2_root_delivery', args);
  await channel.until(() => channel.responses.filter((r) => r.method === 'baton/rootThreadItem').length > before,
    'thread item request');
  const request = channel.responses.filter((r) => r.method === 'baton/rootThreadItem')[before];
  assert.deepEqual(request.params, { thread: args.thread, turn: args.turn, item: args.item });
  beforeAnswer();
  channel.send({ id: request.id, result: answer });
  return call;
}

test('a Codex root read carries its recorded thread and accepted message on the channel connection', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('codex-root-input', 'lead', 'operator', 'report', 'Complete Codex root body.');
  }, ['--root-harness', 'codex', '--thread', 'thread-1']);
  const { channel } = calls;
  const premature = await channel.call('read-before-notice', 'baton2_root_delivery', {
    id: 'codex-root-input', thread: 'thread-1', content: 'A body that this connection has not emitted.',
    turn: 'turn-1', item: 'item-1',
  });
  assert.equal(premature.isError, true);
  const unread = new DatabaseSync(calls.database, { readOnly: true });
  assert.equal(unread.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  unread.close();
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'Codex root input notice');
  const notice = channel.notes()[0];
  assert.ok(notice.params.content.includes('Baton records the read after the Codex root thread returns this complete input.'));
  assert.ok(!notice.params.content.includes('call baton2_delivery'));
  const wrongThread = await channel.call('read-wrong-thread', 'baton2_root_delivery', {
    id: 'codex-root-input', thread: 'another-thread', content: notice.params.content,
    turn: 'turn-1', item: 'item-1',
  });
  assert.equal(wrongThread.isError, true);
  const wrongBody = await channel.call('read-wrong-body', 'baton2_root_delivery', {
    id: 'codex-root-input', thread: 'thread-1', content: 'Only a partial notice body.',
    turn: 'turn-1', item: 'item-1',
  });
  assert.equal(wrongBody.isError, true);
  const queuedOnly = await channel.call('read-queued-only', 'baton2_root_delivery', {
    id: 'codex-root-input', thread: 'thread-1', content: notice.params.content,
  });
  assert.equal(queuedOnly.isError, true);
  const unboundRead = await channel.call('read-unbound', 'baton2_delivery', { id: 'codex-root-input' });
  assert.equal(unboundRead.isError, true);
  const beforeRead = new DatabaseSync(calls.database, { readOnly: true });
  assert.equal(beforeRead.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  beforeRead.close();
  assert.equal(notice.params.meta.thread, 'thread-1');
  const claim = { id: 'codex-root-input', thread: 'thread-1', content: notice.params.content,
    turn: 'turn-1', item: 'item-1' };
  const wrongType = await rootDelivery(channel, 'read-agent-item', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'agentMessage' });
  assert.equal(wrongType.isError, true);
  const otherText = await rootDelivery(channel, 'read-other-text', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: 'A different message.' });
  assert.equal(otherText.isError, true);
  const otherItem = await rootDelivery(channel, 'read-other-item', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-9', type: 'userMessage', text: notice.params.content });
  assert.equal(otherItem.isError, true);
  const unreadForged = new DatabaseSync(calls.database, { readOnly: true });
  assert.equal(unreadForged.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  unreadForged.close();
  const delivered = await rootDelivery(channel, 'read-codex-root', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: `queued: ${notice.params.content}` });
  assert.equal(JSON.parse(delivered.content[0].text).body, 'Complete Codex root body.');
  const context = JSON.parse(readFileSync(channel.contextLog, 'utf8').trim());
  assert.equal(context.harness, 'codex');
  assert.equal(context.native, 'thread-1');
  assert.equal(context.readMessage, 'codex-root-input');
  assert.ok(context.connection);
  assert.ok(context.endpoint);
});

test('a later Codex endpoint delivery preserves the notice awaiting its thread read', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    const insert = db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)');
    insert.run('first', 'lead', 'operator', 'report', 'First complete body.');
    insert.run('second', 'lead', 'operator', 'report', 'Second complete body.');
  }, ['--root-harness', 'codex', '--thread', 'thread-1']);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'first notice');
  const first = channel.notes()[0];
  await channel.deliver('second');
  await channel.barrier('later-delivery');
  assert.equal(channel.notes().length, 1, 'the first notice remains selected');
  const claim = { id: 'first', thread: 'thread-1', content: first.params.content,
    turn: 'turn-1', item: 'item-1' };
  const result = await rootDelivery(channel, 'read-first', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: first.params.content });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).id, 'first');
  await channel.until(() => channel.notes().length === 2, 'second notice after first read');
  assert.deepEqual(JSON.parse(channel.notes()[1].params.meta.messageIds), ['second']);
  const db = new DatabaseSync(calls.database, { readOnly: true });
  assert.deepEqual(db.prepare('SELECT message,native FROM message_reads').all().map(row => ({ ...row })),
    [{ message: 'first', native: 'thread-1' }]);
  db.close();
});

for (const changedDuringRead of [false, true]) {
  test(`a complete Codex read survives a same-thread endpoint change ${changedDuringRead ? 'during' : 'before'} item lookup`, async (t) => {
    const calls = await attach(t, 'operator', (db) => {
      db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
      db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
        .run('reconnected-input', 'lead', 'operator', 'report', 'Complete body across a context reconnect.');
    }, ['--root-harness', 'codex', '--thread', 'thread-1']);
    const { channel } = calls;
    channel.activate();
    await channel.until(() => channel.notes().length > 0, 'Codex root notice');
    const notice = channel.notes()[0];
    const endpoint = JSON.stringify(['another-live-context-for-thread-1']);
    const reconnect = () => {
      const writer = new DatabaseSync(calls.database);
      writer.prepare('UPDATE sessions SET endpoint=? WHERE id=?').run(endpoint, 'operator');
      writer.close();
    };
    if (!changedDuringRead) reconnect();
    const claim = { id: 'reconnected-input', thread: 'thread-1', content: notice.params.content,
      turn: 'turn-1', item: 'item-1' };
    const result = await rootDelivery(channel, 'read-after-reconnect', claim,
      { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: notice.params.content },
      changedDuringRead ? reconnect : () => {});
    assert.equal(result.isError, undefined);
    const context = JSON.parse(readFileSync(channel.contextLog, 'utf8').trim());
    assert.equal(context.native, 'thread-1');
    assert.equal(context.endpoint, endpoint);
    const db = new DatabaseSync(calls.database, { readOnly: true });
    assert.deepEqual(db.prepare('SELECT message,native FROM message_reads').all().map(row => ({ ...row })),
      [{ message: 'reconnected-input', native: 'thread-1' }]);
    db.close();
  });
}

test('a completed Codex root read accepts a delayed receipt after the next notice is selected', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    const insert = db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)');
    insert.run('first', 'lead', 'operator', 'report', 'First complete body.');
    insert.run('second', 'lead', 'operator', 'report', 'Second complete body.');
  }, ['--root-harness', 'codex', '--thread', 'thread-1']);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'first notice');
  const first = channel.notes()[0];
  const claim = { id: 'first', thread: 'thread-1', content: first.params.content,
    turn: 'turn-1', item: 'item-1' };
  const db = new DatabaseSync(calls.database);
  db.prepare('INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES(?,?,?,?,?)')
    .run('root-channel:prior', 'first', 'operator', 'thread-1', 'root-channel:prior:first');
  db.close();
  await channel.deliver('second');
  await channel.until(() => channel.notes().length === 2, 'second notice after first read');

  const rejectedItem = await rootDelivery(channel, 'late-read-wrong-item', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: 'Unrelated user message.' });
  assert.equal(rejectedItem.isError, true);
  const accepted = await rootDelivery(channel, 'late-read-retry', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: first.params.content });
  assert.equal(accepted.isError, undefined);
  assert.deepEqual(JSON.parse(accepted.content[0].text), { id: 'first', read: 'already-recorded' });

  const verify = new DatabaseSync(calls.database, { readOnly: true });
  assert.deepEqual(verify.prepare('SELECT attempt,native FROM message_reads WHERE message=?').all('first')
    .map((row) => ({ ...row })), [{ attempt: 'root-channel:prior', native: 'thread-1' }]);
  verify.close();
});

test('a read recorded while the root item lookup is pending completes idempotently', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('concurrent', 'lead', 'operator', 'report', 'Complete concurrent body.');
  }, ['--root-harness', 'codex', '--thread', 'thread-1']);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'Codex root notice');
  const notice = channel.notes()[0];
  const claim = { id: 'concurrent', thread: 'thread-1', content: notice.params.content,
    turn: 'turn-1', item: 'item-1' };
  const completed = await rootDelivery(channel, 'late-read-concurrent', claim,
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage', text: notice.params.content },
    () => {
      const db = new DatabaseSync(calls.database);
      db.prepare('INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES(?,?,?,?,?)')
        .run('root-channel:concurrent', 'concurrent', 'operator', 'thread-1', 'root-channel:concurrent:concurrent');
      db.close();
    });
  assert.equal(completed.isError, undefined);
  assert.deepEqual(JSON.parse(completed.content[0].text), { id: 'concurrent', read: 'already-recorded' });
  const verify = new DatabaseSync(calls.database, { readOnly: true });
  assert.deepEqual(verify.prepare('SELECT attempt,native FROM message_reads WHERE message=?').all('concurrent')
    .map((row) => ({ ...row })), [{ attempt: 'root-channel:concurrent', native: 'thread-1' }]);
  verify.close();
});

test('a Codex root relay without --thread follows the recorded root conversation', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'recorded-thread', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('follow-input', 'lead', 'operator', 'report', 'Body for the recorded thread.');
  }, ['--root-harness', 'codex']);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'Codex root input notice');
  assert.equal(channel.notes()[0].params.meta.thread, 'recorded-thread');
});

test('a Codex root relay started with --register records its unrecorded conversation as the root', async (t) => {
  const calls = await attach(t, 'operator', () => {}, ['--root-harness', 'codex', '--thread', 'thread-9', '--register'], true);
  const attached = calls.find((argv) => argv[0] === 'attach');
  assert.deepEqual(attached, ['attach', 'operator', 'codex', 'thread-9', '']);
  const connected = calls.find((argv) => argv[0] === 'connect');
  assert.deepEqual(connected.slice(0, 3), ['connect', 'operator', 'thread-9']);
  assert.ok(calls.indexOf(attached) < calls.indexOf(connected));
});

test('a Codex root relay without a recorded conversation is refused unless it registers one', async (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const fake = executable(join(dir, 'baton'), `#!${process.execPath}
const { DatabaseSync } = require('node:sqlite');
if (process.argv[2] === '--help' || process.argv[2] === 'help') process.exit(0);
const db = new DatabaseSync(process.argv[2]);
if (process.argv[3] === 'session') console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id=?').get(process.argv[4])));
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', 'operator',
    '--root-harness', 'codex', '--thread', 'thread-9'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'unrecorded', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ].map(JSON.stringify).join('\n') + '\n');
  const [code] = await once(child, 'exit');
  assert.equal(code, 1, stderr);
  assert.match(stderr, /requires a recorded Codex conversation before attachment/);
});

test('--register does not replace a recorded conversation of another harness', async (t) => {
  const dir = scratch(t);
  const database = orchestra(dir);
  const writer = new DatabaseSync(database);
  writer.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('claude-code', 'existing-claude-thread', 'operator');
  writer.close();
  const log = join(dir, 'coordinator.log');
  const fake = executable(join(dir, 'baton'), `#!${process.execPath}
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === '--help' || process.argv[2] === 'help') process.exit(0);
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2]);
if (process.argv[3] === 'session') console.log(JSON.stringify(db.prepare('SELECT * FROM sessions WHERE id=?').get(process.argv[4])));
`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', 'operator',
    '--root-harness', 'codex', '--thread', 'new-codex-thread', '--register'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'recorded-claude', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ].map(JSON.stringify).join('\n') + '\n');
  const [code] = await once(child, 'exit');
  assert.equal(code, 1, stderr);
  assert.match(stderr, /records a claude-code conversation/);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.filter((argv) => argv[1] === 'attach' || argv[1] === 'connect'), []);
  const after = new DatabaseSync(database, { readOnly: true });
  assert.deepEqual({ ...after.prepare('SELECT harness,native FROM sessions WHERE id=?').get('operator') },
    { harness: 'claude-code', native: 'existing-claude-thread' });
  after.close();
});

test('a Codex root relay that did not name its conversation follows a changed record', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('rebind-input', 'lead', 'operator', 'report', 'Body that outlives a rebinding.');
  }, ['--root-harness', 'codex'], true);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'first Codex root notice');
  assert.equal(channel.notes()[0].params.meta.thread, 'thread-1');
  // An attach to another conversation records it and clears the endpoint.
  const writer = new DatabaseSync(calls.database);
  writer.prepare('UPDATE sessions SET native=?,endpoint=? WHERE id=?').run('thread-2', '', 'operator');
  writer.close();
  await channel.until(() => channel.notes().some((note) => note.params.meta.thread === 'thread-2'), 'notice for the new conversation');
  const connects = readFileSync(channel.log, 'utf8').trim().split('\n').map(JSON.parse)
    .filter((argv) => argv[1] === 'connect');
  assert.deepEqual(connects.map((argv) => argv[3]), ['thread-1', 'thread-2']);
  assert.deepEqual(connects[1][4], connects[0][4]);
});

test('a record change while a thread read is pending discards that read and notifies the new conversation', async (t) => {
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET harness=?,native=? WHERE id=?').run('codex', 'thread-1', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('pending-read', 'lead', 'operator', 'report', 'Body whose read straddles a rebinding.');
  }, ['--root-harness', 'codex'], true);
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'first Codex root notice');
  const first = channel.notes()[0];
  const claim = { id: 'pending-read', thread: 'thread-1', content: first.params.content, turn: 'turn-1', item: 'item-1' };
  // The conductor asks for the thread item and waits for the reply.
  const call = channel.call('read-straddling-rebinding', 'baton2_root_delivery', claim);
  await channel.until(() => channel.responses.some((r) => r.method === 'baton/rootThreadItem'), 'thread item request');
  const request = channel.responses.find((r) => r.method === 'baton/rootThreadItem');
  // While the first notice is selected and its read is pending, later wakes keep it.
  const writer = new DatabaseSync(calls.database);
  writer.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
    .run('later-input', 'lead', 'operator', 'report', 'Later body.');
  writer.close();
  await channel.deliver('later-input');
  assert.equal(channel.notes().length, 1, 'A later wake replaced the notice that awaits its thread read.');
  // The record changes to another conversation before the reply arrives.
  const rebinding = new DatabaseSync(calls.database);
  rebinding.prepare('UPDATE sessions SET native=?,endpoint=? WHERE id=?').run('thread-2', '', 'operator');
  rebinding.close();
  await channel.until(() => channel.notes().some((note) => note.params.meta.thread === 'thread-2'), 'notice for the new conversation');
  assert.deepEqual(JSON.parse(channel.notes().at(-1).params.meta.messageIds), ['pending-read']);
  channel.send({ id: request.id, result: { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage',
    text: first.params.content } });
  const result = await call;
  assert.equal(result.isError, true, 'A read for the previous conversation was recorded.');
  const reads = new DatabaseSync(calls.database, { readOnly: true });
  assert.equal(reads.prepare('SELECT count(*) AS n FROM message_reads').get().n, 0);
  reads.close();
});

test('a root completion request notice contains its full review prompt', async (t) => {
  const body = 'Completed the assigned change. Evidence: commit abc123 and the selected fixture result.';
  const calls = await attach(t, 'operator', (db) => {
    db.prepare('UPDATE sessions SET native=? WHERE id=?').run('retained-native', 'operator');
    db.prepare('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)')
      .run('completion-1', 'lead', 'operator', 'completion-request', body);
  });
  const { channel } = calls;
  channel.activate();
  await channel.until(() => channel.notes().length > 0, 'completion request notice');
  const notice = channel.notes()[0];
  assert.deepEqual(JSON.parse(notice.params.meta.messageIds), ['completion-1']);
  assert.match(notice.params.content, /Message \(completion-request\) from lead \[id: completion-1\]:/);
  assert.ok(notice.params.content.includes(body));
  assert.ok(notice.params.content.includes('Review the work against lead\'s assignment and the supplied evidence.'));
  assert.ok(notice.params.content.includes('When the assignment is satisfied, use completion-confirmed --to lead to end the Player, or add --next TEXT to confirm and dispatch its next assignment together.'));
  assert.ok(notice.params.content.includes('When work remains, use guide --to lead --text TEXT to state what is missing and direct the remaining work.'));
  const result = await channel.call('read-completion', 'baton2_delivery', { id: 'completion-1' });
  assert.equal(JSON.parse(result.content[0].text).body, body);
  const db = new DatabaseSync(calls.database, { readOnly: true });
  assert.deepEqual(db.prepare('SELECT message,native FROM message_reads').all().map((row) => ({ ...row })),
    [{ message: 'completion-1', native: 'retained-native' }]);
  db.close();
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

test('new committed input sends its full body while older unread history stays recoverable', async (t) => {
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
  assert.ok(latest.params.content.includes('New committed guidance.'));
  await channel.call('read-new', 'baton2_delivery', { id: 'new-guidance' });
  await channel.barrier('old-input-remains');
  assert.deepEqual(JSON.parse(channel.notes().at(-1).params.meta.messageIds), ['old-report']);
  assert.deepEqual(db.prepare('SELECT message FROM message_reads').all().map((r) => r.message), ['new-guidance']);
  assert.equal(db.prepare('SELECT body,receipt FROM messages WHERE id=?').get('old-report').body, 'Older unread history.');
  assert.equal(db.prepare('SELECT body,receipt FROM messages WHERE id=?').get('old-report').receipt, null);
  db.close();
});

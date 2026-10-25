// Root channel attachment (#1054): the configuration printed by
// root-channel-config.mjs, and the operator role kept by mcp-conductor.mjs.
// Run with: node --test bend2/test/root-channel-attach.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
async function attach(t, session) {
  const dir = scratch(t);
  const database = orchestra(dir);
  const log = join(dir, 'coordinator.log');
  const fake = executable(join(dir, 'baton'),
    `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  const child = spawn(process.execPath, [CONDUCTOR, database, fake, '--session', session], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
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

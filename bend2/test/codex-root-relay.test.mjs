import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const RELAY = resolve(new URL('../scripts/codex-root-relay.mjs', import.meta.url).pathname);

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'codex-root-relay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function fakeSsh(path) {
  return executable(path, `#!${process.execPath}
const readline = require('node:readline');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.ROOT_RELAY_SSH_LOG, JSON.stringify(args));
const line = readline.createInterface({ input: process.stdin });
line.on('line', value => {
  const request = JSON.parse(value);
  if (request.id === 'conductor-channel-ready') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/claude/channel', params:{
      content: "Message (completion-request) from lead [id: request-1]:\\nFull body\\nReview the work against lead's assignment.",
      meta: { recipient:'operator', messageIds:'[\\"request-1\\"]' }
    } }) + '\\n');
  } else if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'fake-conductor', version:'1' } } }) + '\\n');
  } else if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ tools:[] } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:'conductor-channel-ready', method:'ping', params:{} }) + '\\n');
  } else if (request.method === 'tools/call') {
    fs.appendFileSync(process.env.ROOT_RELAY_READ_LOG, JSON.stringify({ name:request.params.name, ...request.params.arguments }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ content:[{ type:'text', text:'read request-1' }] } }) + '\\n');
  }
});
`);
}

const NOTICE = "Message (completion-request) from lead [id: request-1]:\nFull body\nReview the work against lead's assignment.";

// A fake Codex CLI. 'queue' records the message. 'app-server proxy' answers the
// app-server protocol from a state directory. ROOT_RELAY_APP_MODE selects when
// the queued message appears as a user message: 'consume' after two history
// reads, 'never' not at all, 'unloaded' lists no loaded thread. History starts
// with an earlier turn that already holds the same notice text.
function fakeCodex(path) {
  return executable(path, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
const dir = process.env.ROOT_RELAY_APP_DIR;
const mode = process.env.ROOT_RELAY_APP_MODE || 'consume';
const notice = ${JSON.stringify(NOTICE)};
if (args[0] === 'queue') {
  fs.writeFileSync(process.env.ROOT_RELAY_CODEX_LOG, JSON.stringify(args));
  fs.writeFileSync(dir + '/queued', args[args.indexOf('--message') + 1]);
  process.exit(0);
}
if (args[0] !== 'app-server' || args[1] !== 'proxy') process.exit(64);
fs.appendFileSync(dir + '/proxy-launches', 'x');
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\\n');
const user = (id, text) => ({ type: 'userMessage', id, content: [{ type: 'text', text }] });
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.jsonrpc !== undefined) process.exit(65);
  if (request.method === 'initialize') send(request.id, { userAgent: 'fake' });
  else if (request.method === 'thread/loaded/list') send(request.id, { data: mode === 'unloaded' ? [] : ['thread-1'] });
  else if (request.method === 'thread/turns/list') {
    const queued = fs.existsSync(dir + '/queued') ? fs.readFileSync(dir + '/queued', 'utf8') : null;
    const turns = [];
    if (request.params.itemsView === 'full' && queued !== null) {
      const reads = fs.existsSync(dir + '/history-reads') ? fs.readFileSync(dir + '/history-reads', 'utf8').length : 0;
      fs.appendFileSync(dir + '/history-reads', 'x');
      if (mode === 'consume' && reads >= 2) turns.push({ id: 'turn-1', status: 'completed', items: [
        { type: 'agentMessage', id: 'item-2', text: 'working' }, user('item-1', 'queued: ' + queued)] });
    }
    const earlier = { id: 'turn-0', status: 'completed', items: [user('item-0', notice)] };
    send(request.id, { data: [...turns, earlier].slice(0, request.params.limit || 100), nextCursor: null });
  } else send(request.id, {});
});
`);
}

test('the Codex root relay records the read after the root thread returns the notice', async (t) => {
  const directory = scratch(t);
  const ssh = fakeSsh(join(directory, 'ssh'));
  const codex = fakeCodex(join(directory, 'codex'));
  const sshLog = join(directory, 'ssh.json');
  const queueLog = join(directory, 'queue.json');
  const readLog = join(directory, 'read.jsonl');
  const child = spawn(process.execPath, [RELAY, '--ssh', 'database-host', '--database', '/scratch/orchestra.db',
    '--coordinator', '/scratch/bin/baton', '--conductor', '/scratch/lib/mcp-conductor.mjs',
    '--session', 'operator', '--thread', 'thread-1', '--codex', codex], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ROOT_RELAY_SSH_LOG: sshLog,
      ROOT_RELAY_CODEX_LOG: queueLog, ROOT_RELAY_READ_LOG: readLog,
      ROOT_RELAY_APP_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  let output = '';
  let diagnostic = '';
  const responses = new Map();
  child.stdout.on('data', chunk => {
    output += chunk;
    let newline;
    while ((newline = output.indexOf('\n')) !== -1) {
      const row = output.slice(0, newline);
      output = output.slice(newline + 1);
      const message = JSON.parse(row);
      if (message.id !== undefined) responses.set(message.id, message);
    }
  });
  child.stderr.on('data', chunk => { diagnostic += chunk; });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc:'2.0', ...message }) + '\n');
  const response = async (id) => {
    while (!responses.has(id)) await once(child.stdout, 'data');
    return responses.get(id);
  };

  send({ id:1, method:'initialize', params:{ protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:'fixture', version:'1' } } });
  const initialized = await response(1);
  assert.equal(initialized.result.serverInfo.name, 'baton-codex-root-relay');
  send({ method:'notifications/initialized' });
  send({ id:2, method:'tools/list', params:{} });
  assert.deepEqual((await response(2)).result.tools, []);

  const accepted = new Promise(resolveAccepted => {
    const check = () => {
      if (diagnostic.includes('codexRootMessageReceived')) resolveAccepted();
    };
    child.stderr.on('data', check);
    check();
  });
  await accepted;
  child.stdin.end();
  const [code, signal] = await once(child, 'exit');
  assert.equal(code, 0, `${signal || ''} ${diagnostic}`);
  const queued = JSON.parse(readFileSync(queueLog, 'utf8'));
  assert.deepEqual(queued.slice(0, 3), ['queue', '--thread', 'thread-1']);
  assert.ok(queued.at(-1).includes('Full body'));
  assert.ok(queued.at(-1).includes("Review the work against lead's assignment."));
  const reads = readFileSync(readLog, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].name, 'baton2_root_delivery');
  assert.equal(reads[0].id, 'request-1');
  assert.equal(reads[0].thread, 'thread-1');
  assert.equal(reads[0].turn, 'turn-1');
  assert.equal(reads[0].item, 'item-1');
  assert.ok(reads[0].content.includes('Full body'));
  assert.ok(reads[0].content.includes('Review the work against lead\'s assignment.'));
  const remoteArgs = JSON.parse(readFileSync(sshLog, 'utf8'));
  assert.deepEqual(remoteArgs.slice(0, 2), ['-T', 'database-host']);
  assert.ok(remoteArgs[2].includes("'--root-harness' 'codex' '--thread' 'thread-1'"));
});

async function runRelay(t, mode) {
  const directory = scratch(t);
  fakeSsh(join(directory, 'ssh'));
  const codex = fakeCodex(join(directory, 'codex'));
  const readLog = join(directory, 'read.jsonl');
  const child = spawn(process.execPath, [RELAY, '--ssh', 'database-host', '--database', '/scratch/orchestra.db',
    '--coordinator', '/scratch/bin/baton', '--conductor', '/scratch/lib/mcp-conductor.mjs',
    '--session', 'operator', '--thread', 'thread-1', '--codex', codex], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, ROOT_RELAY_SSH_LOG: join(directory, 'ssh.json'),
      ROOT_RELAY_CODEX_LOG: join(directory, 'queue.json'), ROOT_RELAY_READ_LOG: readLog,
      ROOT_RELAY_APP_DIR: directory, ROOT_RELAY_APP_MODE: mode },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  const run = { directory, child, readLog, diagnostic: '', closed: once(child, 'close') };
  child.stdout.resume();
  child.stderr.on('data', chunk => { run.diagnostic += chunk; });
  child.stdin.write([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'fixture', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ].map(JSON.stringify).join('\n') + '\n');
  return run;
}

async function until(run, text) {
  while (!run.diagnostic.includes(text)) {
    const state = await Promise.race([once(run.child.stderr, 'data').then(() => 'data'), run.closed.then(() => 'closed')]);
    if (state === 'closed' && !run.diagnostic.includes(text)) assert.fail(`closed before ${text}: ${run.diagnostic}`);
  }
}

test('a queued notice that the root thread has not returned stays unread', async (t) => {
  const run = await runRelay(t, 'never');
  await until(run, 'codexRootMessageQueued');
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.ok(existsSync(join(run.directory, 'queue.json')), 'The notice was not queued.');
  assert.ok(readFileSync(join(run.directory, 'history-reads'), 'utf8').length >= 3, 'The thread history was not read repeatedly.');
  assert.equal(existsSync(run.readLog), false, 'A read was recorded from queue acceptance alone.');
  run.child.stdin.end();
  const [code] = await run.closed;
  assert.equal(code, 0, run.diagnostic);
  assert.equal(existsSync(run.readLog), false);
  assert.match(run.diagnostic, /codexRootMessageUnread/);
});

test('a root thread that the app-server has not loaded receives no queued notice', async (t) => {
  const run = await runRelay(t, 'unloaded');
  const [code] = await run.closed;
  assert.equal(code, 1, run.diagnostic);
  assert.match(run.diagnostic, /does not have the recorded root thread loaded: thread-1/);
  assert.equal(existsSync(join(run.directory, 'queue.json')), false);
  assert.equal(existsSync(run.readLog), false);
});

test('a missing remote conductor preserves its SSH failure when the client closes', async (t) => {
  const directory = scratch(t);
  const missing = 'fixture remote conductor is missing';
  executable(join(directory, 'ssh'), `#!${process.execPath}
process.stderr.write(${JSON.stringify(missing + '\n')});
process.exit(127);
`);
  const child = spawn(process.execPath, [RELAY, '--ssh', 'database-host',
    '--database', '/scratch/orchestra.db', '--coordinator', '/scratch/bin/baton',
    '--conductor', '/scratch/missing/mcp-conductor.mjs', '--session', 'operator',
    '--thread', 'thread-1'], {
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let diagnostic = '';
  let observed;
  const failed = new Promise(resolve => { observed = resolve; });
  child.stderr.on('data', chunk => {
    diagnostic += chunk;
    if (diagnostic.includes(missing)) observed();
  });
  child.stdout.resume();
  child.stdin.write([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'missing-conductor', version: '1' },
    } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ].map(JSON.stringify).join('\n') + '\n');
  await Promise.race([failed, closed]);
  child.stdin.end();
  const [code, signal] = await closed;
  assert.equal(code, 1, `${signal || ''} ${diagnostic}`);
  assert.match(diagnostic, /fixture remote conductor is missing/);
  assert.match(diagnostic, /127/);
});

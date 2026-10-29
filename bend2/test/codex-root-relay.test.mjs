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
if (process.env.ROOT_RELAY_REFUSE_READ) process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300));
let call;
const line = readline.createInterface({ input: process.stdin });
line.on('line', value => {
  const request = JSON.parse(value);
  if (request.id === 'conductor-channel-ready') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/claude/channel', params:{
      content: "Message (completion-request) from lead [id: request-1]:\\nFull body\\nReview the work against lead's assignment.",
      meta: { recipient:'operator', messageIds:'[\\"request-1\\"]' }
    } }) + '\\n');
    if (process.env.ROOT_RELAY_REFUSE_READ) process.stdout.write(JSON.stringify({
      jsonrpc:'2.0', method:'notifications/claude/channel', params:{
        content:'Second notice', meta:{ recipient:'operator', messageIds:'[\\"request-2\\"]' }
      }
    }) + '\\n');
  } else if (request.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ protocolVersion:'2024-11-05', capabilities:{ tools:{} }, serverInfo:{ name:'fake-conductor', version:'1' } } }) + '\\n');
  } else if (request.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id, result:{ tools:[] } }) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:'conductor-channel-ready', method:'ping', params:{} }) + '\\n');
  } else if (request.method === 'tools/call') {
    fs.appendFileSync(process.env.ROOT_RELAY_READ_LOG, JSON.stringify({ name:request.params.name, ...request.params.arguments }) + '\\n');
    if (process.env.ROOT_RELAY_REFUSE_READ) {
      process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:request.id,
        result:{ isError:true, content:[{type:'text',text:'Refused fixture read'}] } }) + '\\n');
      return;
    }
    call = request.id;
    const { thread, turn, item } = request.params.arguments;
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:'client:1', method:'baton/rootThreadItem', params:{ thread, turn, item } }) + '\\n');
  } else if (request.id === 'client:1') {
    fs.appendFileSync(process.env.ROOT_RELAY_ITEM_LOG, JSON.stringify(request) + '\\n');
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:call, result:{ content:[{ type:'text', text:'read request-1' }] } }) + '\\n');
  }
});
`);
}

const NOTICE = "Message (completion-request) from lead [id: request-1]:\nFull body\nReview the work against lead's assignment.";

// A fake Codex CLI. 'queue' records the message. 'app-server proxy' answers the
// app-server protocol from a state directory. ROOT_RELAY_APP_MODE selects when
// the queued message appears as a user message: 'consume' after two history
// reads, 'never' not at all, 'loads-late' lists the thread as loaded from the
// fourth request on, 'no-upgrade' closes without answering the Upgrade request
// (what the proxy does for a non-WebSocket byte stream), 'drop-once' ends the first proxy that is asked for history
// after the queue without replying. History starts
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
const crypto = require('node:crypto');
const user = (id, text) => ({ type: 'userMessage', id, content: [{ type: 'text', text }] });
// The proxy copies bytes between its streams and the app-server socket, which
// answers an HTTP Upgrade request with status 101 and then speaks WebSocket
// frames. Frames from the client must be masked; frames to it are not.
function frame(opcode, payload, fin = true) {
  const first = (fin ? 0x80 : 0) | opcode;
  const head = payload.length < 126 ? Buffer.from([first, payload.length])
    : Buffer.from([first, 126, payload.length >> 8, payload.length & 255]);
  process.stdout.write(Buffer.concat([head, payload]));
}
// Replies longer than 40 bytes are split into a text frame and a continuation.
function send(id, result) {
  const body = Buffer.from(JSON.stringify({ id, result }));
  if (body.length > 40) { frame(1, body.subarray(0, 20), false); frame(0, body.subarray(20)); }
  else frame(1, body);
}
let buffer = Buffer.alloc(0);
let upgraded = false;
let afterPong = null;
function handle(request) {
  if (request.jsonrpc !== undefined) process.exit(65);
  if (request.id === undefined) return;
  if (request.method === 'initialize') {
    // The client must answer a ping before this reply is sent.
    afterPong = () => send(request.id, { userAgent: 'fake' });
    frame(9, Buffer.from('ping'));
  } else if (request.method === 'thread/loaded/list') {
    fs.appendFileSync(dir + '/loaded-calls', 'x');
    const calls = fs.readFileSync(dir + '/loaded-calls', 'utf8').length;
    send(request.id, { data: mode === 'loads-late' && calls < 4 ? [] : ['thread-1'] });
  } else if (request.method === 'thread/turns/list') {
    const queued = fs.existsSync(dir + '/queued') ? fs.readFileSync(dir + '/queued', 'utf8') : null;
    if (mode === 'drop-once' && queued !== null && request.params.itemsView === 'full' && !fs.existsSync(dir + '/dropped')) {
      fs.writeFileSync(dir + '/dropped', 'x');
      process.exit(1);
    }
    const turns = [];
    if (request.params.itemsView === 'full' && queued !== null) {
      const reads = fs.existsSync(dir + '/history-reads') ? fs.readFileSync(dir + '/history-reads', 'utf8').length : 0;
      fs.appendFileSync(dir + '/history-reads', 'x');
      if (mode !== 'never' && reads >= 2) turns.push({ id: 'turn-1', status: 'completed', items: [
        { type: 'agentMessage', id: 'item-2', text: 'working' }, user('item-1', 'queued: ' + queued)] });
    }
    const earlier = { id: 'turn-0', status: 'completed', items: [user('item-0', notice)] };
    send(request.id, { data: [...turns, earlier].slice(0, request.params.limit || 100), nextCursor: null });
  } else send(request.id, {});
}
function clientFrames() {
  for (;;) {
    if (buffer.length < 2) return;
    if ((buffer[1] & 0x80) === 0) process.exit(66);
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
    else if (length === 127) process.exit(67);
    if (buffer.length < offset + 4 + length) return;
    const mask = buffer.subarray(offset, offset + 4);
    const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    const opcode = buffer[0] & 0x0f;
    if ((buffer[0] & 0x80) === 0 || opcode === 0) process.exit(68);
    buffer = buffer.subarray(offset + 4 + length);
    if (opcode === 1) handle(JSON.parse(payload.toString('utf8')));
    else if (opcode === 10 && afterPong) { const reply = afterPong; afterPong = null; reply(); }
    else if (opcode === 8) process.exit(0);
  }
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!upgraded) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end === -1) return;
    const head = buffer.subarray(0, end).toString('latin1');
    buffer = buffer.subarray(end + 4);
    const key = /^Sec-WebSocket-Key: (.+)$/mi.exec(head);
    // A byte stream that is not an Upgrade request gets no reply, as from the real app-server.
    if (!/^GET [^ ]+ HTTP[/]1[.]1/.test(head) || !/^Upgrade: websocket$/mi.test(head) || !key || mode === 'no-upgrade') process.exit(0);
    const accept = crypto.createHash('sha1').update(key[1] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    process.stdout.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
    upgraded = true;
  }
  clientFrames();
});
process.stdin.on('end', () => process.exit(0));
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
      ROOT_RELAY_APP_DIR: directory, ROOT_RELAY_ITEM_LOG: join(directory, 'item.jsonl') },
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
  const item = JSON.parse(readFileSync(join(directory, 'item.jsonl'), 'utf8').trim());
  assert.deepEqual({ thread: item.result.thread, turn: item.result.turn, item: item.result.item, type: item.result.type },
    { thread: 'thread-1', turn: 'turn-1', item: 'item-1', type: 'userMessage' });
  assert.ok(item.result.text.includes('Full body'));
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
      ROOT_RELAY_APP_DIR: directory, ROOT_RELAY_APP_MODE: mode,
      ...(mode === 'read-refused' ? { ROOT_RELAY_REFUSE_READ: '1' } : {}),
      ROOT_RELAY_ITEM_LOG: join(directory, 'item.jsonl') },
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

test('a refused thread read stops later queued notices before closing SSH', async (t) => {
  const run = await runRelay(t, 'read-refused');
  const [code] = await run.closed;
  assert.equal(code, 1, run.diagnostic);
  assert.match(run.diagnostic, /read was not recorded/);
  assert.equal((run.diagnostic.match(/codexRootMessageQueued/g) || []).length, 1, run.diagnostic);
  assert.ok(JSON.parse(readFileSync(join(run.directory, 'queue.json'), 'utf8')).at(-1).includes('request-1'));
  assert.equal(readFileSync(run.readLog, 'utf8').trim().split('\n').length, 1);
});

test('a root thread that the app-server has not loaded yet receives its notice once loaded', async (t) => {
  const run = await runRelay(t, 'loads-late');
  await until(run, 'codexRootThreadNotLoaded');
  assert.equal(existsSync(join(run.directory, 'queue.json')), false, 'The notice was queued before the thread loaded.');
  await until(run, 'codexRootMessageReceived');
  assert.ok(existsSync(join(run.directory, 'queue.json')));
  assert.equal(readFileSync(run.readLog, 'utf8').trim().split('\n').length, 1);
  run.child.stdin.end();
  const [code] = await run.closed;
  assert.equal(code, 0, run.diagnostic);
});

test('a lost app-server connection is reopened and the queued notice is still matched', async (t) => {
  const run = await runRelay(t, 'drop-once');
  await until(run, 'codexRootMessageReceived');
  assert.ok(readFileSync(join(run.directory, 'proxy-launches'), 'utf8').length >= 2, 'The proxy was not reopened.');
  assert.equal(readFileSync(join(run.directory, 'queue.json'), 'utf8').includes('request-1'), true);
  assert.equal(readFileSync(run.readLog, 'utf8').trim().split('\n').length, 1);
  run.child.stdin.end();
  const [code] = await run.closed;
  assert.equal(code, 0, run.diagnostic);
});

test('a proxy that closes without upgrading is reported and nothing is queued', async (t) => {
  const run = await runRelay(t, 'no-upgrade');
  await until(run, 'codexAppServerUnavailable');
  assert.match(run.diagnostic, /closed before the WebSocket upgrade/);
  assert.equal(existsSync(join(run.directory, 'queue.json')), false);
  assert.equal(existsSync(run.readLog), false);
  run.child.stdin.end();
  const [code] = await run.closed;
  assert.equal(code, 0, run.diagnostic);
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

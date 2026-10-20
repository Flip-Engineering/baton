#!/usr/bin/env node
// Bend2 Codex Conductor adapter.
//
// Bridges the Bend2 coordinator to a Principal or Associate Conductor. Codex
// uses the shared native receiver for one-shot and attached turns.
// --attach and stored message callbacks also register its receive endpoint.
//
// Usage: node bend2/scripts/codex-conductor.mjs <database-path> [coordinator-executable] [codex-executable] [--session ID]
//
// Environment:
//   CODEX_CONDUCTOR_MODEL  Model (default: stored model or o4-mini)
//   CODEX_ROOT_MODEL       Compatibility alias
//   HOME              Must point to the user home for Codex credential discovery
//
// No npm dependencies; node stdlib only.

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function hasParent(session) {
  return session?.parent !== null && session?.parent !== undefined;
}

const positional = [];
let attach = false;
let messageId = null;
let sessionId = 'root';
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--attach') attach = true;
  else if (arg === '--once') continue;
  else if (arg === '--session') {
    sessionId = process.argv[++i];
    if (sessionId === undefined) throw new Error('--session requires a registered session ID');
  }
  else if (arg === '--message') {
    messageId = process.argv[++i];
    if (!messageId) throw new Error('--message requires a committed message ID');
  } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else positional.push(arg);
}
const dbPath = positional[0];
const installed = resolve(ROOT, 'bin/baton2');
const coordinatorExe = positional[1] || (existsSync(installed) ? installed : resolve(ROOT, '.scratch/bend2/baton2'));
const codexExe = positional[2] || 'codex';
let codexModel = process.env.CODEX_CONDUCTOR_MODEL || process.env.CODEX_ROOT_MODEL;

if (!dbPath) {
  process.stderr.write(
    'usage: codex-conductor.mjs <database-path> [coordinator-executable] [codex-executable] [--session ID] [--attach | --once]\n' +
    '\nEnvironment:\n' +
    '  CODEX_CONDUCTOR_MODEL  Model for the Conductor (default: stored model or o4-mini)\n' +
    '  CODEX_ROOT_MODEL       Compatibility alias\n' +
    '  HOME              Must point to the user home for Codex credential discovery\n',
  );
  process.exit(1);
}

const COORD = resolve(coordinatorExe);
const DB = resolve(dbPath);

// Database access (node:sqlite, Node 22+).
let db = null;

async function openDb() {
  if (db) return db;
  if (!existsSync(DB)) return null;
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(DB, { open: true, readOnly: true });
  return db;
}

function closeDb() {
  if (db) { try { db.close(); } catch {} db = null; }
}

function selectedSession() {
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM sessions WHERE id=? AND harness=?').get(sessionId, 'codex') || null;
  } catch {
    return null;
  }
}

function pendingConductorMessages() {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = ? AND m.receipt IS NULL
         AND NOT EXISTS(SELECT 1 FROM message_reads mr WHERE mr.message=m.id AND mr.recipient=m.recipient)
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`,
    ).all(sessionId, messageId, messageId);
  } catch {
    return [];
  }
}

function resultText(value) {
  if (value?.sender === sessionId && value?.kind === 'report') return value.body;
  if (value?.session !== sessionId || !value.event) return null;
  if (typeof value.event.result === 'string') return value.event.result;
  const message = Array.isArray(value.event.messages)
    ? value.event.messages.findLast(item => item?.role === 'assistant') : value.event.message;
  const content = message?.content;
  return Array.isArray(content)
    ? content.filter(item => item.type === 'text').map(item => item.text).join('\n') : null;
}

// One invocation uses the shared receiver without changing the registered endpoint.
async function runOnce() {
  await openDb();
  const messages = pendingConductorMessages();
  if (messages.length === 0) {
    process.stderr.write('codex-conductor: no pending messages\n');
    closeDb();
    return;
  }
  const session = selectedSession();
  codexModel ||= session?.model || 'o4-mini';
  const log = DB + '.conductor-' + Buffer.from(sessionId).toString('hex') + '.jsonl';
  const args = [DB, 'receive', sessionId, codexExe, codexModel,
    session?.effort || 'medium', session?.workspace || ROOT, log, ''];
  closeDb();
  process.stderr.write(`codex-conductor: ${messages.length} pending message(s), starting Codex turn\n`);
  const result = spawnSync(COORD, args, { encoding: 'utf8', maxBuffer: Infinity });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`codex-conductor: ${result.error.message}\n`);
  if (result.signal) process.stderr.write(`codex-conductor: receiver ended by ${result.signal}\n`);
  let text = null;
  for (const line of (result.stdout || '').split('\n')) {
    let value;
    try { value = JSON.parse(line); } catch { continue; }
    const body = resultText(value);
    if (typeof body === 'string') text = body;
  }
  if (text !== null) process.stdout.write(text + '\n');
  process.exitCode = result.status ?? 1;
  process.stderr.write(`codex-conductor: turn completed (exit ${process.exitCode})\n`);
}

async function runAttached() {
  await openDb();
  const session = selectedSession();
  codexModel ||= session?.model || 'o4-mini';
  const native = session?.native || '';
  const effort = session?.effort || 'medium';
  const cwd = session?.workspace || ROOT;
  const log = DB + '.conductor-' + Buffer.from(sessionId).toString('hex') + '.jsonl';
  const receiver = [DB, 'receive', sessionId, codexExe, codexModel, effort, cwd, log];
  const endpoint = JSON.stringify([COORD, ...receiver]);
  const command = hasParent(session)
    ? [DB, 'connect', sessionId, native, endpoint]
    : [DB, 'attach', sessionId, 'codex', native, endpoint];
  execFileSync(COORD, command, { stdio: 'inherit' });
  execFileSync(COORD, [DB, 'role', sessionId, hasParent(session) ? 'associate-conductor' : 'principal-conductor'], { stdio: 'inherit' });
  closeDb();
  execFileSync(COORD, [...receiver, messageId || ''], { stdio: 'inherit' });
}

if (attach || messageId !== null) await runAttached();
else await runOnce();

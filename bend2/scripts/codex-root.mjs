#!/usr/bin/env node
// Bend2 Codex root adapter.
//
// Bridges the Bend2 coordinator to Codex running as the root session. Codex
// runs in `exec --json` mode (non-interactive, JSONL on stdout) and calls the
// coordinator CLI through its built-in shell tool. A report writer invokes the adapter for its committed message.
// --attach records the invocation in the root session and delivers pending messages.
//
// Usage: node bend2/scripts/codex-root.mjs <database-path> [coordinator-executable] [codex-executable]
//
// Environment:
//   CODEX_ROOT_MODEL  Model (default: o4-mini)
//   HOME              Must point to the user home for Codex credential discovery
//
// No npm dependencies; node stdlib only.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const positional = [];
let attach = false;
let messageId = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--attach') attach = true;
  else if (arg === '--once') continue;
  else if (arg === '--message') {
    messageId = process.argv[++i];
    if (!messageId) throw new Error('--message requires a committed message ID');
  } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else positional.push(arg);
}
const dbPath = positional[0];
const coordinatorExe = positional[1] || resolve(ROOT, '.scratch/bend2/baton2');
const codexExe = positional[2] || 'codex';
const codexModel = process.env.CODEX_ROOT_MODEL || 'o4-mini';

if (!dbPath) {
  process.stderr.write(
    'usage: codex-root.mjs <database-path> [coordinator-executable] [codex-executable] [--attach | --once]\n' +
    '\nEnvironment:\n' +
    '  CODEX_ROOT_MODEL  Model for the Codex root (default: o4-mini)\n' +
    '  HOME              Must point to the user home for Codex credential discovery\n',
  );
  process.exit(1);
}

const COORD = resolve(coordinatorExe);
const DB = resolve(dbPath);

function systemInstructions() {
  return [
    'You are the root operator of a Bend2 coordinator. Workers report to you and you direct their work.',
    '',
    'Coordinator CLI — run these commands in your shell:',
    `  ${COORD} ${DB} status          — show all sessions`,
    `  ${COORD} ${DB} workers         — list workers with latest report`,
    `  ${COORD} ${DB} turns WORKER    — show a worker's turn history`,
    `  ${COORD} ${DB} inbox root      — show pending messages for the root`,
    `  ${COORD} ${DB} pending         — list all undelivered messages`,
    `  ${COORD} ${DB} ack ID root RECEIPT — acknowledge a message`,
    `  ${COORD} ${DB} message ID root WORKER guidance BODY — send guidance to a worker`,
    `  ${COORD} ${DB} land WORKER REPO TARGET — fast-forward land a worker's branch`,
    `  ${COORD} ${DB} land-checked WORKER REPO TARGET CHECK FILES — gated landing`,
    `  ${COORD} ${DB} push REPO BRANCH REMOTE — push a branch to a remote after landing`,
    `  ${COORD} ${DB} worktree WORKER — show a worker's Git state`,
    `  ${COORD} ${DB} record FINDING_ID root CLAIM message:MESSAGE_ID LIMITS — record your finding`,
    `  ${COORD} ${DB} knowledge root — list all findings visible to you with evidence and promotion history`,
    `  ${COORD} ${DB} promote PROMOTION_ID root SOURCE root FINDING_ID — promote from SOURCE into the root scope`,
    '',
    'Author findings from reviewed evidence. Cite an existing retained message you sent or received and state the claim\'s limits.',
    'Review a finding before explicitly promoting it from its recorded source scope. Its original author remains recorded.',
    'A promotion notice names a finding shared into your scope. Retrieve it with knowledge, review its evidence and decide which workers should receive a message about it.',
    'When you receive a worker report, review it and acknowledge it.',
    'If the worker made changes, inspect its worktree state and land them when ready.',
  ].join('\n');
}

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

function rootSession() {
  if (!db) return '';
  try {
    return db.prepare("SELECT native FROM sessions WHERE id='root' AND harness=?").get('codex')?.native || '';
  } catch {
    return '';
  }
}

function pendingRootMessages() {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = 'root' AND s.parent IS NULL AND m.receipt IS NULL
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`,
    ).all(messageId, messageId);
  } catch {
    return [];
  }
}

function formatMessages(messages) {
  return messages.map((m) => {
    const prefix = m.kind === 'report' ? 'Worker report' : `Message (${m.kind})`;
    return `${prefix} from ${m.sender} [id: ${m.id}]:\n${m.body}`;
  }).join('\n\n---\n\n');
}

// Run one Codex turn in exec --json mode. Returns a promise that resolves
// with the JSON events array when the process exits.
function runCodexTurn(prompt, threadId) {
  return new Promise((resolve, reject) => {
    const subcommand = ['exec'];

    if (threadId) {
      subcommand.push('resume', threadId);
    }

    const args = [
      ...subcommand,
      '--json',
      '--model', codexModel,
      '--dangerously-bypass-approvals-and-sandbox',
    ];

    const stdinContent = systemInstructions() + '\n\n' + prompt;

    const child = spawn(codexExe, args, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    child.stdin.write(stdinContent);
    child.stdin.end();

    const events = [];
    const rl = createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        process.stderr.write(`codex-root: unparsed: ${line}\n`);
        return;
      }
      events.push(event);
      process.stderr.write(`codex-root: ${event.type}\n`);
      const native = event.type === 'thread.started' ? event.thread_id : null;
      if (native) {
        execFileSync(COORD, [DB, 'bind', 'root', native, 'codex', '', '']);
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && events.length === 0) {
        reject(new Error(`Codex exited ${code}: ${stderr}`));
      } else {
        resolve({ events, code, threadId: extractThreadId(events) });
      }
    });

    child.on('error', reject);
  });
}

function extractThreadId(events) {
  for (const e of events) {
    if (e.type === 'thread.started' && e.thread_id) return e.thread_id;
  }
  return null;
}

function extractResult(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') {
      return e.item.text;
    }
  }
  return null;
}

// Single-shot: process all pending messages in one Codex turn, then exit.
async function runOnce() {
  await openDb();

  const messages = pendingRootMessages();
  if (messages.length === 0) {
    process.stderr.write('codex-root: no pending messages\n');
    closeDb();
    process.exit(0);
  }

  const prompt = formatMessages(messages);
  process.stderr.write(`codex-root: ${messages.length} pending message(s), starting Codex turn\n`);

  try {
    const result = await runCodexTurn(prompt, rootSession());
    const text = extractResult(result.events);
    if (text) {
      process.stdout.write(text + '\n');
    }
    process.stderr.write(`codex-root: turn completed (exit ${result.code})\n`);
    process.exitCode = result.code;
  } catch (e) {
    process.stderr.write(`codex-root: turn failed: ${e.message}\n`);
    process.exitCode = 1;
  }

  closeDb();
}

if (attach) {
  await openDb();
  const native = rootSession();
  const endpoint = JSON.stringify([
    '/usr/bin/env', `CODEX_ROOT_MODEL=${codexModel}`,
    process.execPath, fileURLToPath(import.meta.url), DB, COORD, codexExe, '--message',
  ]);
  execFileSync(COORD, [DB, 'attach', 'root', 'codex', native, endpoint], { stdio: 'inherit' });
}
await runOnce();

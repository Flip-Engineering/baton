#!/usr/bin/env node
// Bend2 OMP root adapter.
//
// Bridges the Bend2 coordinator to OMP running as the root session. OMP runs
// in --print --mode json (the same integration the worker adapter uses) and
// calls the coordinator CLI through its built-in bash tool. The adapter polls
// the coordinator database for pending root messages and starts an OMP turn
// for each batch.
//
// Usage: node bend2/scripts/omp-root.mjs <database-path> [coordinator-executable] [omp-executable]
//
// Environment:
//   OMP_ROOT_MODEL    Model (default: zai/glm-5.3-flash)
//   OMP_ROOT_THINKING Thinking level (default: high)
//   HOME              Must point to the user home for OMP credential discovery
//
// No npm dependencies; node stdlib only.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const dbPath = process.argv[2];
const coordinatorExe = process.argv[3] || resolve(ROOT, '.scratch/bend2/baton2');
const ompExe = process.argv[4] || '/opt/homebrew/bin/omp';
const ompModel = process.env.OMP_ROOT_MODEL || 'zai/glm-5.3-flash';
const ompThinking = process.env.OMP_ROOT_THINKING || 'high';

if (!dbPath) {
  process.stderr.write(
    'usage: omp-root.mjs <database-path> [coordinator-executable] [omp-executable]\n' +
    '\nEnvironment:\n' +
    '  OMP_ROOT_MODEL    Model for the OMP root (default: zai/glm-5.3-flash)\n' +
    '  OMP_ROOT_THINKING Thinking level (default: high)\n' +
    '  HOME              Must point to the user home for OMP credential discovery\n',
  );
  process.exit(1);
}

const COORD = resolve(coordinatorExe);
const DB = resolve(dbPath);

function systemPrompt() {
  return [
    'You are the root operator of a Bend2 coordinator. Workers report to you and you direct their work.',
    '',
    'Coordinator CLI — run these with bash:',
    `  ${COORD} ${DB} status          — show all sessions`,
    `  ${COORD} ${DB} workers         — list workers with latest report`,
    `  ${COORD} ${DB} turns WORKER    — show a worker's turn history`,
    `  ${COORD} ${DB} inbox root      — show pending messages for the root`,
    `  ${COORD} ${DB} pending         — list all undelivered messages`,
    `  ${COORD} ${DB} ack ID root RECEIPT — acknowledge a message`,
    `  ${COORD} ${DB} message ID root WORKER guidance BODY — send guidance to a worker`,
    `  ${COORD} ${DB} land WORKER REPO TARGET — fast-forward land a worker's branch`,
    `  ${COORD} ${DB} land-checked WORKER REPO TARGET CHECK FILES — gated landing`,
    `  ${COORD} ${DB} worktree WORKER — show a worker's Git state`,
    '',
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

function pendingRootMessages() {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.parent IS NULL AND m.receipt IS NULL
       ORDER BY m.seq`,
    ).all();
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

// Coordinator CLI helper.
function coord(...args) {
  return execFileSync(COORD, [DB, ...args], {
    encoding: 'utf8', timeout: 10000,
  }).trim();
}

// Run one OMP turn in --print --mode json. Returns a promise that resolves
// with the JSON events array when the process exits.
function runOmpTurn(prompt, sessionDir, sessionId) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--mode', 'json',
      '--model', ompModel,
      '--thinking', ompThinking,
      '--approval-mode', 'yolo',
      '--system-prompt', systemPrompt(),
    ];

    if (sessionDir) {
      args.push('--session-dir', sessionDir);
      if (sessionId) {
        args.push('--resume', sessionId);
      }
    } else {
      args.push('--no-session');
    }

    args.push(prompt);

    const child = spawn(ompExe, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const events = [];
    const rl = createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);
        process.stderr.write(`omp-root: ${event.type}\n`);
      } catch {
        process.stderr.write(`omp-root: unparsed: ${line}\n`);
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && events.length === 0) {
        reject(new Error(`OMP exited ${code}: ${stderr}`));
      } else {
        resolve({ events, code, sessionId: extractSessionId(events) });
      }
    });

    child.on('error', reject);
  });
}

function extractSessionId(events) {
  for (const e of events) {
    if (e.type === 'session' && e.id) return e.id;
  }
  return null;
}

function extractResult(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'turn_end' && e.message?.content) {
      const textParts = e.message.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text);
      if (textParts.length > 0) return textParts.join('\n');
    }
    if (e.type === 'message_end' && e.message?.role === 'assistant') {
      const textParts = (e.message.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text);
      if (textParts.length > 0) return textParts.join('\n');
    }
  }
  return null;
}

// Single-shot: process all pending messages in one OMP turn, then exit.
async function runOnce() {
  await openDb();

  const messages = pendingRootMessages();
  if (messages.length === 0) {
    process.stderr.write('omp-root: no pending messages\n');
    closeDb();
    process.exit(0);
  }

  const prompt = formatMessages(messages);
  process.stderr.write(`omp-root: ${messages.length} pending message(s), starting OMP turn\n`);

  try {
    const result = await runOmpTurn(prompt);
    const text = extractResult(result.events);
    if (text) {
      process.stdout.write(text + '\n');
    }
    process.stderr.write(`omp-root: turn completed (exit ${result.code})\n`);
  } catch (e) {
    process.stderr.write(`omp-root: turn failed: ${e.message}\n`);
    process.exitCode = 1;
  }

  closeDb();
}

// Poll mode: check for pending messages every interval, start an OMP turn
// for each batch. Exits when interrupted.
async function runPoll(intervalMs) {
  await openDb();

  const notifiedSeqs = new Set();
  let running = false;

  async function check() {
    if (running) return;
    running = true;

    try {
      // Re-open the database to see new writes.
      closeDb();
      await openDb();

      const messages = pendingRootMessages();
      const newMessages = messages.filter((m) => !notifiedSeqs.has(m.seq));
      if (newMessages.length === 0) { running = false; return; }

      for (const m of newMessages) notifiedSeqs.add(m.seq);

      const prompt = formatMessages(newMessages);
      process.stderr.write(`omp-root: ${newMessages.length} new message(s)\n`);

      const result = await runOmpTurn(prompt);
      const text = extractResult(result.events);
      if (text) process.stdout.write(text + '\n');
    } catch (e) {
      process.stderr.write(`omp-root: error: ${e.message}\n`);
    }

    running = false;
  }

  const timer = setInterval(check, intervalMs);
  check();

  function shutdown() {
    clearInterval(timer);
    closeDb();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// CLI: --once (default) processes pending messages and exits.
//      --poll [interval-ms] polls continuously.
const once = process.argv.includes('--once') || !process.argv.includes('--poll');
if (once) {
  runOnce();
} else {
  const pollIdx = process.argv.indexOf('--poll');
  const intervalMs = parseInt(process.argv[pollIdx + 1], 10) || 3000;
  runPoll(intervalMs);
}

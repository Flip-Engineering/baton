#!/usr/bin/env node
// Bend2 OMP session adapter.
//
// Bridges the Bend2 coordinator to OMP running as a root or recruited lead. OMP runs
// in --print --mode json and
// calls the coordinator CLI through its built-in bash tool. A report writer invokes the adapter for its committed message.
// --attach records the invocation in the selected session and delivers pending messages.
//
// Usage: node bend2/scripts/omp-root.mjs <database-path> [coordinator-executable] [omp-executable]
//
// Environment:
//   OMP_ROOT_MODEL    Model (default: zai/glm-5.3-flash)
//   OMP_ROOT_THINKING Thinking level (default: stored effort or high)
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
    if (!sessionId) throw new Error('--session requires a registered session ID');
  }
  else if (arg === '--message') {
    messageId = process.argv[++i];
    if (!messageId) throw new Error('--message requires a committed message ID');
  } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else positional.push(arg);
}
const dbPath = positional[0];
const coordinatorExe = positional[1] || resolve(ROOT, '.scratch/bend2/baton2');
const ompExe = positional[2] || '/opt/homebrew/bin/omp';
let ompModel = process.env.OMP_ROOT_MODEL;
let ompThinking = process.env.OMP_ROOT_THINKING;

if (!dbPath) {
  process.stderr.write(
    'usage: omp-root.mjs <database-path> [coordinator-executable] [omp-executable] [--session ID] [--attach | --once]\n' +
    '\nEnvironment:\n' +
    '  OMP_ROOT_MODEL    Model for the OMP session (default: zai/glm-5.3-flash)\n' +
    '  OMP_ROOT_THINKING Thinking level (default: stored effort or high)\n' +
    '  HOME              Must point to the user home for OMP credential discovery\n',
  );
  process.exit(1);
}

const COORD = resolve(coordinatorExe);
const DB = resolve(dbPath);

function systemPrompt() {
  return [
    `You are session ${sessionId} coordinating players in a Baton orchestra. Follow the conductor role assigned by your task.`,
    'The Principal Conductor is the main orchestrator. An Associate Conductor is a sub-orchestrator. An Ensemble is a coordinated team of agents. A Section is a capability-specific subgroup. A Player is an individual agent. The Orchestra is the whole coordinated system.',
    'The workers command lists player sessions. WORKER denotes a player session ID in the CLI examples.',
    'Public messages follow assigned roles, parent links and explicit tight Ensemble membership. Conductors can message descendants. Players send questions and reports to their immediate parent. Peer messages require a shared tight Ensemble; Conductor peers must have equal hierarchy depth.',
    'Start player turns in the background so you can finish your turn and receive their reports.',
    'Keep one foreground native turn per session. Finish review before starting the next player turn.',
    '',
    'Coordinator CLI — run these with bash:',
    `  ${COORD} ${DB} status          — show all sessions`,
    `  ${COORD} ${DB} workers         — list players with latest report`,
    `  ${COORD} ${DB} recruit WORKER ${sessionId} HARNESS MODEL EFFORT REPO BRANCH PATH BASE — recruit a child`,
    `  ${COORD} ${DB} turns WORKER    — show a player's turn history`,
    `  ${COORD} ${DB} inbox ${sessionId}      — show your pending messages`,
    `  ${COORD} ${DB} pending         — list all undelivered messages`,
    `  ${COORD} ${DB} ack ID ${sessionId} RECEIPT — acknowledge a message`,
    `  ${COORD} ${DB} message ID ${sessionId} WORKER guidance BODY — send guidance to a player`,
    `  ${COORD} ${DB} role SESSION [player|conductor|operator] — read or assign responsibility`,
    `  ${COORD} ${DB} ensemble ENSEMBLE [OWNER [loose|tight]] — inspect or configure coupling`,
    `  ${COORD} ${DB} ensemble-member ENSEMBLE OWNER SESSION add|remove — configure explicit members`,
    `  ${COORD} ${DB} land WORKER REPO TARGET — fast-forward land a player's branch`,
    `  ${COORD} ${DB} land-checked WORKER REPO TARGET CHECK FILES — gated landing`,
    `  ${COORD} ${DB} push REPO BRANCH REMOTE — push a branch to a remote after landing`,
    `  ${COORD} ${DB} worktree WORKER — show a player's Git state`,
    `  ${COORD} ${DB} record FINDING_ID ${sessionId} CLAIM message:MESSAGE_ID LIMITS — record your finding`,
    `  ${COORD} ${DB} knowledge ${sessionId} — list all findings visible to you with evidence and promotion history`,
    `  ${COORD} ${DB} promote PROMOTION_ID ${sessionId} SOURCE ${sessionId} FINDING_ID — promote from SOURCE into your scope`,
    '',
    'Author findings from reviewed evidence. Cite an existing retained message you sent or received and state the claim\'s limits.',
    'Review a finding before explicitly promoting it from its recorded source scope. Its original author remains recorded.',
    'A promotion notice names a finding shared into your scope. Retrieve it with knowledge, review its evidence and decide which players should receive a message about it.',
    'When you receive a player report, review it and acknowledge it.',
    'If the player made changes, inspect its worktree state and land them when ready.',
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

function selectedSession() {
  if (!db) return null;
  try {
    return db.prepare("SELECT * FROM sessions WHERE id=? AND harness=?").get(sessionId, 'omp') || null;
  } catch {
    return null;
  }
}

function selectRoute(session) {
  ompModel ||= session?.model || 'zai/glm-5.3-flash';
  ompThinking ||= session?.effort || 'high';
}

function pendingRootMessages() {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = ? AND m.receipt IS NULL
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`,
    ).all(sessionId, messageId, messageId);
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

// Run one OMP turn in --print --mode json. Returns a promise that resolves
// with the JSON events array when the process exits.
function runOmpTurn(prompt, sessionDir, nativeSession, workspace) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--mode', 'json',
      '--model', ompModel,
      '--thinking', ompThinking,
      '--approval-mode', 'yolo',
      '--system-prompt', systemPrompt(),
    ];

    args.push('--session-dir', sessionDir);
    if (nativeSession) args.push('--resume', nativeSession);

    args.push(prompt);

    const child = spawn(ompExe, args, {
      cwd: workspace || ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const events = [];
    const rl = createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        process.stderr.write(`omp-root: unparsed: ${line}\n`);
        return;
      }
      events.push(event);
      process.stderr.write(`omp-root: ${event.type}\n`);
      const native = event.type === 'session' ? event.id : null;
      if (native) {
        execFileSync(COORD, [DB, 'bind', sessionId, native, 'omp', '', '']);
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && events.length === 0) {
        reject(Object.assign(new Error(`OMP exited ${code}: ${stderr}`), { exitCode: code ?? 1 }));
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

  const session = selectedSession();
  selectRoute(session);
  let text;
  let model;
  let code;
  try {
    const storage = sessionId === 'root' ? DB + '.root-sessions'
      : DB + '.session-' + Buffer.from(sessionId).toString('hex');
    const result = await runOmpTurn(prompt, storage, session?.native, session?.workspace);
    text = extractResult(result.events);
    const observed = result.events.findLast(e => e.message?.provider && e.message?.model)?.message;
    model = observed ? `${observed.provider}/${observed.model}` : undefined;
    code = result.code ?? 1;
    if (text) process.stdout.write(text + '\n');
    process.stderr.write(`omp-root: turn completed (exit ${code})\n`);
  } catch (e) {
    text = `OMP turn failed: ${e.message}`;
    code = e.exitCode ?? 1;
    process.stderr.write(`omp-root: ${text}\n`);
  }

  // A recruited parent has its own parent. Submit the native outcome through
  // the coordinator's existing observation and delivery path after OMP exits.
  if (session?.parent) {
    const event = { type: 'result', is_error: code !== 0, exitCode: code, model,
      result: text || `OMP process ended without assistant text (exit ${code})` };
    execFileSync(COORD, [DB, 'observe-file',
      `omp:${sessionId}:${messages.at(-1).seq}`, sessionId, '-'],
      { input: JSON.stringify(event), stdio: ['pipe', 'inherit', 'inherit'] });
  }
  process.exitCode = code;

  closeDb();
}

if (attach) {
  await openDb();
  const session = selectedSession();
  selectRoute(session);
  const native = session?.native || '';
  if (sessionId !== 'root' && !session) throw new Error(`OMP session ${sessionId} is not registered`);
  const endpoint = JSON.stringify([
    '/usr/bin/env', `OMP_ROOT_MODEL=${ompModel}`, `OMP_ROOT_THINKING=${ompThinking}`,
    process.execPath, fileURLToPath(import.meta.url), DB, COORD, ompExe, '--session', sessionId, '--message',
  ]);
  const command = session?.parent
    ? [DB, 'connect', sessionId, native, endpoint]
    : [DB, 'attach', sessionId, 'omp', native, endpoint];
  execFileSync(COORD, command, { stdio: 'inherit' });
  if (!session?.parent) execFileSync(COORD, [DB, 'role', sessionId, 'conductor'], { stdio: 'inherit' });
}
await runOnce();

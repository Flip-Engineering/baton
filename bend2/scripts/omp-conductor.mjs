#!/usr/bin/env node
// Bend2 OMP Conductor adapter.
//
// Bridges the Bend2 coordinator to a Principal or Associate Conductor. OMP runs
// in --print --mode json and
// calls the coordinator CLI through its built-in bash tool. A report writer invokes the adapter for its committed message.
// --attach records the invocation in the selected session and delivers pending messages.
//
// Usage: node bend2/scripts/omp-conductor.mjs <database-path> [coordinator-executable] [omp-executable]
//
// Environment:
//   OMP_CONDUCTOR_MODEL    Model (default: stored model or zai/glm-5.3-flash)
//   OMP_CONDUCTOR_THINKING Thinking level (default: stored effort or high)
//   OMP_ROOT_MODEL and OMP_ROOT_THINKING are compatibility aliases.
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

function hasParent(session) {
  return session?.parent !== null && session?.parent !== undefined;
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
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
const ompExe = positional[2] || '/opt/homebrew/bin/omp';
let ompModel = process.env.OMP_CONDUCTOR_MODEL || process.env.OMP_ROOT_MODEL;
let ompThinking = process.env.OMP_CONDUCTOR_THINKING || process.env.OMP_ROOT_THINKING;

if (!dbPath) {
  process.stderr.write(
    'usage: omp-conductor.mjs <database-path> [coordinator-executable] [omp-executable] [--session ID] [--attach | --once]\n' +
    '\nEnvironment:\n' +
    '  OMP_CONDUCTOR_MODEL    Model (default: stored model or zai/glm-5.3-flash)\n' +
    '  OMP_CONDUCTOR_THINKING Thinking level (default: stored effort or high)\n' +
    '  OMP_ROOT_MODEL and OMP_ROOT_THINKING are compatibility aliases.\n' +
    '  HOME              Must point to the user home for OMP credential discovery\n',
  );
  process.exit(1);
}

const COORD = resolve(coordinatorExe);
const DB = resolve(dbPath);

function systemPrompt(session) {
  const command = shellQuote(COORD) + ' ' + shellQuote(DB);
  const recipient = shellQuote(sessionId);
  return [
    `You are session ${sessionId}, the ${hasParent(session) ? 'Associate' : 'Principal'} Conductor of a Baton Orchestra.`,
    'The Principal Conductor is the main orchestrator. An Associate Conductor is a sub-orchestrator. An Ensemble is a coordinated team of agents. A Section is a capability-specific subgroup. A Player is an individual agent. The Orchestra is the whole coordinated system.',
    'The players command lists Players and both Conductor tiers. PLAYER denotes a player session ID in the CLI examples.',
    'Public messages follow assigned roles, parent links and explicit tight Ensemble membership. Conductors can message descendants. Players send questions and reports to their immediate parent. Peer messages require a shared tight Ensemble; Conductor peers must have equal hierarchy depth.',
    'Start player turns in the background so you can finish your turn and receive their reports.',
    'Keep one foreground native turn per session. Finish review before starting the next player turn.',
    '',
    'Coordinator CLI — run these with bash:',
    `  ${command} inbox ${recipient} --index — inspect your pending message metadata`,
    `  ${command} inbox ${recipient} --index --sender PLAYER --kind report --state all — select reports, including acknowledged reports`,
    `  ${command} delivery ID — read the complete retained message`,
    `  ${command} orchestra --index --for ${recipient} --pretty — inspect your connected structure`,
    `  ${command} pending --index — inspect metadata across recipients; --recipient SESSION narrows the scope`,
    `  ${command} player PLAYER — inspect a Player or Conductor`,
    `  ${command} recruit PLAYER ${recipient} HARNESS MODEL EFFORT REPO BRANCH PATH BASE — recruit a child`,
    `  ${command} ack ID ${recipient} RECEIPT — acknowledge a message`,
    `  ${command} message ID ${recipient} PLAYER guidance BODY — send guidance to a player`,
    `  ${command} role SESSION [player|principal-conductor|associate-conductor|operator] — read or assign responsibility`,
    `  ${command} ensemble ENSEMBLE [OWNER [loose|tight]] — inspect or configure coupling`,
    `  ${command} ensemble-member ENSEMBLE OWNER SESSION add|remove — configure explicit members`,
    `  ${command} section ENSEMBLE SECTION [OWNER CAPABILITY] — inspect or declare a capability subgroup`,
    `  ${command} section-member ENSEMBLE SECTION OWNER PLAYER add|remove — configure Section members`,
    `  ${command} land PLAYER REPO TARGET [--commit COMMIT] — fast-forward land a player's branch`,
    `  ${command} land-checked PLAYER REPO TARGET CHECK FILES [--commit COMMIT] — gated landing`,
    `  ${command} push REPO BRANCH REMOTE — push a branch to a remote after landing`,
    `  ${command} worktree PLAYER — show a player's Git state`,
    `  ${command} record FINDING_ID ${recipient} CLAIM message:MESSAGE_ID LIMITS — record your finding`,
    `  ${command} knowledge ${recipient} — list all findings visible to you with evidence and promotion history`,
    `  ${command} promote PROMOTION_ID ${recipient} SOURCE ${recipient} FINDING_ID — promote from SOURCE into your scope`,
    '',
    "orchestra --index returns structural records and per-actor pendingCount, unacknowledgedCount and inputRead argv. Reference limitations.next is a literal argv array; pass its elements after the executable and database to inspect that exact subject. pendingCount excludes stopped execution inputs; unacknowledgedCount includes every NULL receipt. These counts describe retained input. Run inputRead after the executable and database to list that actor's pending metadata; append --state all for receipt history. pending --index --recipient ID accepts conjunctive sender/kind selectors; delivery ID retrieves each full body.",
    'Inspect metadata first, then retrieve the chosen full body with delivery. Index filters combine by exact equality; state defaults to pending. Index reads do not acknowledge input. Receipt state records acknowledgment, not review or completed work.',
    'Legacy inbox, pending, players, turns and orchestra remain available for deliberate full-body or history inspection.',
    'land and land-checked default to the recorded branch tip. Add --commit COMMIT to select a reviewed commit from that branch while later work remains on the branch. Native selection verifies the registered workspace repository and selected commit ancestry before landing effects. Use a full reviewed object ID to name the intended source. The checked form runs the existing target/candidate checks on the selected source. Inspect the result status; selection does not grant review or landing authority.',
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

function pendingConductorMessages() {
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
    const prefix = m.kind === 'report' ? 'Player report' : `Message (${m.kind})`;
    return `${prefix} from ${m.sender} [id: ${m.id}]:\n${m.body}`;
  }).join('\n\n---\n\n');
}

// Run one OMP turn in --print --mode json. Returns a promise that resolves
// with the JSON events array when the process exits.
function runOmpTurn(prompt, sessionDir, session) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--mode', 'json',
      '--model', ompModel,
      '--thinking', ompThinking,
      '--approval-mode', 'yolo',
      '--system-prompt', systemPrompt(session),
    ];

    args.push('--session-dir', sessionDir);
    if (session?.native) args.push('--resume', session.native);

    args.push(prompt);

    const child = spawn(ompExe, args, {
      cwd: session?.workspace || ROOT,
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
        process.stderr.write(`omp-conductor: unparsed: ${line}\n`);
        return;
      }
      events.push(event);
      process.stderr.write(`omp-conductor: ${event.type}\n`);
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

  const messages = pendingConductorMessages();
  if (messages.length === 0) {
    process.stderr.write('omp-conductor: no pending messages\n');
    closeDb();
    process.exit(0);
  }

  const prompt = formatMessages(messages);
  process.stderr.write(`omp-conductor: ${messages.length} pending message(s), starting OMP turn\n`);

  const session = selectedSession();
  selectRoute(session);
  let text;
  let model;
  let code;
  try {
    const storage = sessionId === 'root' ? DB + '.root-sessions'
      : DB + '.session-' + Buffer.from(sessionId).toString('hex');
    const result = await runOmpTurn(prompt, storage, session);
    text = extractResult(result.events);
    const observed = result.events.findLast(e => e.message?.provider && e.message?.model)?.message;
    model = observed ? `${observed.provider}/${observed.model}` : undefined;
    code = result.code ?? 1;
    if (text) process.stdout.write(text + '\n');
    process.stderr.write(`omp-conductor: turn completed (exit ${code})\n`);
  } catch (e) {
    text = `OMP turn failed: ${e.message}`;
    code = e.exitCode ?? 1;
    process.stderr.write(`omp-conductor: ${text}\n`);
  }

  // A recruited parent has its own parent. Submit the native outcome through
  // the coordinator's existing observation and delivery path after OMP exits.
  if (hasParent(session)) {
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
  const endpoint = JSON.stringify([
    '/usr/bin/env', `OMP_CONDUCTOR_MODEL=${ompModel}`, `OMP_CONDUCTOR_THINKING=${ompThinking}`,
    process.execPath, fileURLToPath(import.meta.url), DB, COORD, ompExe, '--session', sessionId, '--message',
  ]);
  const command = hasParent(session)
    ? [DB, 'connect', sessionId, native, endpoint]
    : [DB, 'attach', sessionId, 'omp', native, endpoint];
  execFileSync(COORD, command, { stdio: 'inherit' });
  execFileSync(COORD, [DB, 'role', sessionId, hasParent(session) ? 'associate-conductor' : 'principal-conductor'], { stdio: 'inherit' });
}
await runOnce();

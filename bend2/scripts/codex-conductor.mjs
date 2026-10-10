#!/usr/bin/env node
// Bend2 Codex Conductor adapter.
//
// Bridges the Bend2 coordinator to a Principal or Associate Conductor. Codex
// runs in `exec --json` mode (non-interactive, JSONL on stdout) and calls the
// coordinator CLI through its built-in shell tool. --once runs one turn.
// --attach and stored message callbacks use the shared native receiver.
//
// Usage: node bend2/scripts/codex-conductor.mjs <database-path> [coordinator-executable] [codex-executable] [--session ID]
//
// Environment:
//   CODEX_CONDUCTOR_MODEL  Model (default: stored model or o4-mini)
//   CODEX_ROOT_MODEL       Compatibility alias
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

function systemInstructions(session) {
  const command = shellQuote(COORD) + ' ' + shellQuote(DB);
  const recipient = shellQuote(sessionId);
  return [
    `You are session ${sessionId}, the ${hasParent(session) ? 'Associate' : 'Principal'} Conductor of a Baton Orchestra. Players report to you and you direct their work.`,
    'The Principal Conductor is the main orchestrator. An Associate Conductor is a sub-orchestrator. An Ensemble is a coordinated team of agents. A Section is a capability-specific subgroup. A Player is an individual agent. The Orchestra is the whole coordinated system.',
    'The players command lists Players and both Conductor tiers. PLAYER denotes a player session ID in the CLI examples.',
    'Public messages follow assigned roles, parent links and explicit tight Ensemble membership. Conductors can message descendants. Report, ask and ask-file reach the recorded parent; a parentless Principal Conductor reaches the registered operator. Peer messages require a shared tight Ensemble.',
    '',
    'Coordinator CLI — run these commands in your shell:',
    `  ${command} status          — show all sessions`,
    `  ${command} players         — list players with latest report`,
    `  ${command} turns PLAYER    — show a player's turn history`,
    `  ${command} player PLAYER — inspect a Player or Conductor`,
    `  ${command} join PLAYER ${recipient} HARNESS MODEL EFFORT WORKSPACE — register a Player in the shared checkout`,
    `  ${command} recruit PLAYER ${recipient} HARNESS MODEL EFFORT REPO BRANCH PATH BASE — create a separate task worktree`,
    `  ${command} receiver PLAYER HARNESS_CMD OUTPUT_LOG [CWD] — register or relocate a Player's receive endpoint`,
    `  ${command} inbox ${recipient} — show your pending messages`,
    `  ${command} pending         — list all undelivered messages`,
    `  ${command} ack ID ${recipient} RECEIPT — acknowledge a message`,
    `  ${command} message ID ${recipient} PLAYER guidance BODY — send guidance to a player`,
    `  ${command} ask ID ${recipient} BODY — send a question to your recorded parent or, for a parentless Principal, the registered operator`,
    `  ${command} ask-file ID ${recipient} PATH — send a complete question from a file or stdin with PATH -`,
    `  ${command} role SESSION [player|principal-conductor|associate-conductor|operator] — read or assign responsibility`,
    `  ${command} ensemble ENSEMBLE [OWNER [loose|tight]] — inspect or configure coupling`,
    `  ${command} ensemble-member ENSEMBLE OWNER SESSION add|remove — configure explicit members`,
    `  ${command} section ENSEMBLE SECTION [OWNER CAPABILITY] — inspect or declare a capability subgroup`,
    `  ${command} section-member ENSEMBLE SECTION OWNER PLAYER add|remove — configure Section members`,
    `  ${command} orchestra — inspect the coordinated system`,
    `  ${command} land PLAYER REPO TARGET [--commit COMMIT] — fast-forward land a player's branch`,
    `  ${command} land-checked PLAYER REPO TARGET CHECK FILES [--commit COMMIT] — gated landing`,
    `  ${command} push REPO BRANCH REMOTE — push a branch to a remote after landing`,
    `  ${command} worktree PLAYER — show a player's Git state`,
    `  ${command} record FINDING_ID ${recipient} CLAIM EVIDENCE LIMITS — record your finding`,
    `  ${command} record-typed FINDING_ID ${recipient} KIND CLAIM EVIDENCE LIMITS — record typed knowledge`,
    `  ${command} relate RELATION_ID ${recipient} SOURCE RELATION TARGET — connect finding:ID or message:ID references`,
    `  ${command} knowledge-scope ${recipient} universal|worker|group|all SUBJECT [--index | --id FINDING_ID] [--pretty] — read selected holdings`,
    `  ${command} knowledge ${recipient} [--index | --id FINDING_ID] [--pretty] — discover metadata or read complete findings visible to you`,
    `  ${command} promote PROMOTION_ID ${recipient} SOURCE ${recipient} FINDING_ID — promote from SOURCE into your scope`,
    '',
    'Landing defaults to the recorded branch tip; --commit selects a reviewed ancestor while later work remains on the branch.',
    'Use join for shared-checkout work and recruit when a separate worktree is needed. Name the target branch, remote and integration Conductor in the assignment.',
    'Author findings from reviewed evidence. Cite the source of the finding and state the claim\'s limits. A message:MESSAGE_ID reference includes the retained message body.',
    'Review a finding before explicitly promoting it from its recorded source scope. Its original author remains recorded.',
    'A promotion notice names a finding shared into your scope. Use knowledge --index to discover metadata, follow its literal detailRead argv for the complete finding, and follow evidenceMessage.deliveryRead for the retained message.',
    'When you receive a player report, review it and acknowledge it.',
    'Commit completed changes. The integration Conductor lands or reconciles contributions and pushes the integrated target.',
    'After publication and turn completion, relocate the same Player with receiver to the shared checkout and retire clean unused merged task worktrees and branches through ordinary Git. Preserve active or unfinished work and receiver/toolchain dependencies.',
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

// Run one Codex turn in exec --json mode. Returns a promise that resolves
// with the JSON events array when the process exits.
function runCodexTurn(prompt, session) {
  return new Promise((resolve, reject) => {
    const subcommand = ['exec'];

    if (session?.native) {
      subcommand.push('resume', session.native);
    }

    const args = [
      ...subcommand,
      '--json',
      '--model', codexModel,
      '-c', 'forced_login_method="chatgpt"',
      ...(session?.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(session.effort)}`] : []),
      '--dangerously-bypass-approvals-and-sandbox',
    ];

    const stdinContent = systemInstructions(session) + '\n\n' + prompt;

    const child = spawn(codexExe, args, {
      cwd: session?.workspace || ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(Object.entries(process.env)
        .filter(([name]) => name !== 'OPENAI_API_KEY' && name !== 'CODEX_API_KEY')),
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
        process.stderr.write(`codex-conductor: unparsed: ${line}\n`);
        return;
      }
      events.push(event);
      process.stderr.write(`codex-conductor: ${event.type}\n`);
      const native = event.type === 'thread.started' ? event.thread_id : null;
      if (native) {
        execFileSync(COORD, [DB, 'bind', sessionId, native, 'codex', '', ''], { maxBuffer: Infinity });
      }
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0 && events.length === 0) {
        reject(Object.assign(new Error(`Codex exited ${code}: ${stderr}`), { exitCode: code ?? 1 }));
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

  const messages = pendingConductorMessages();
  if (messages.length === 0) {
    process.stderr.write('codex-conductor: no pending messages\n');
    closeDb();
    process.exit(0);
  }

  const prompt = formatMessages(messages);
  process.stderr.write(`codex-conductor: ${messages.length} pending message(s), starting Codex turn\n`);

  const session = selectedSession();
  codexModel ||= session?.model || 'o4-mini';
  let text;
  let code;
  try {
    const result = await runCodexTurn(prompt, session);
    text = extractResult(result.events);
    if (text) {
      process.stdout.write(text + '\n');
    }
    process.stderr.write(`codex-conductor: turn completed (exit ${result.code})\n`);
    code = result.code ?? 1;
  } catch (e) {
    text = `Codex turn failed: ${e.message}`;
    process.stderr.write(`codex-conductor: ${text}\n`);
    code = e.exitCode ?? 1;
  }
  if (hasParent(session)) {
    const event = { type: 'result', is_error: code !== 0, exitCode: code,
      result: text || `Codex process ended without assistant text (exit ${code})` };
    execFileSync(COORD, [DB, 'observe-file', `codex:${sessionId}:${messages.at(-1).seq}`, sessionId, '-'],
      { input: JSON.stringify(event), stdio: ['pipe', 'inherit', 'inherit'] });
  }
  process.exitCode = code;

  closeDb();
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

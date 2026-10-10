#!/usr/bin/env node
// Bend2 Channels MCP Conductor adapter.
//
// A minimal MCP server bridging the Bend2 coordinator's SQLite database to
// Claude Code's Channels protocol. A Conductor loads it with:
//   --mcp-config <config.json>
//   --dangerously-load-development-channels server:baton-conductor
//
// Usage: node bend2/scripts/mcp-conductor.mjs <database-path> [coordinator-executable]
//
// The server reads pending Conductor messages from the coordinator's database and
// delivers them as notifications/claude/channel. Tool calls delegate to the
// coordinator executable for mutations. No npm dependencies; node stdlib only.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

function hasParent(session) {
  return session?.parent !== null && session?.parent !== undefined;
}

const positional = [];
let sessionId = 'root';
let delivery = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--session') {
    sessionId = process.argv[++i];
    if (sessionId === undefined) throw new Error('--session requires a session ID');
  } else if (arg === '--deliver') {
    delivery = { socket: process.argv[++i], message: process.argv[++i] };
    if (!delivery.socket || !delivery.message) throw new Error('--deliver requires a socket and committed message ID');
  } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
  else positional.push(arg);
}
const dbPath = positional[0] ? resolve(positional[0]) : null;
const installed = resolve(ROOT, 'bin/baton2');
const coordinatorExe = resolve(positional[1] || (existsSync(installed) ? installed : resolve(ROOT, '.scratch/bend2/baton2')));

if (!dbPath) {
  process.stderr.write('usage: mcp-conductor.mjs <database-path> [coordinator-executable] [--session ID]\n');
  process.exit(1);
}

// The report writer calls this one-shot client for the attached channel endpoint.
if (delivery) {
  const socketName = delivery.socket;
  const messageId = delivery.message;
  process.chdir(dirname(resolve(dbPath)));
  await new Promise((done, fail) => {
    const client = createConnection(socketName);
    let answer = '';
    client.on('connect', () => client.end(JSON.stringify(messageId) + '\n'));
    client.on('data', (chunk) => { answer += chunk; });
    client.on('error', fail);
    client.on('end', () => answer === 'ok\n' ? done() : fail(new Error(answer)));
  });
  process.exit(0);
}

// node:sqlite (Node 22+)
const { DatabaseSync } = await import('node:sqlite');

// MCP stdio carries one JSON-RPC message per line.
function writeMessage(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write(body + '\n');
}

function sendResponse(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendNotification(method, params) {
  writeMessage({ jsonrpc: '2.0', method, params });
}

// Claude Code sends newline-delimited initialization and tool requests.
let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let newline;
  while ((newline = inputBuffer.indexOf('\n')) !== -1) {
    const body = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!body.trim()) continue;
    try {
      handleMessage(JSON.parse(body));
    } catch (error) {
      process.stderr.write(`mcp-conductor: parse error: ${error.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  deliveryServer?.close();
  if (db) { try { db.close(); } catch {} db = null; }
});

// Coordinator CLI helper.
function coord(...args) {
  try {
    return execFileSync(coordinatorExe, [dbPath, ...args], {
      encoding: 'utf8', maxBuffer: Infinity,
    }).trim();
  } catch (error) {
    const status = Number.isInteger(error.status) ? `\nexit code: ${error.status}` : '';
    error.message += `${status}\nstdout:\n${error.stdout ?? ''}\nstderr:\n${error.stderr ?? ''}`;
    throw error;
  }
}

// Tool definitions exposed to the attached Conductor.
const TOOLS = [
  {
    name: 'baton2_project',
    description: 'Describe a project and register this coordinator database under its shared Git directory.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } },
      required: ['path'], additionalProperties: false },
  },
  {
    name: 'baton2_project_sessions',
    description: 'List the project\'s recorded sessions, native identities and pending input counts.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } },
      required: ['path'], additionalProperties: false },
  },
  {
    name: 'baton2_resume',
    description: 'Continue a recorded session through its registered receiver using its oldest pending input. An empty inbox after a failed native turn receives recovery guidance to continue the interrupted task in the same conversation.',
    inputSchema: { type: 'object', properties: { session: { type: 'string' },
      liftStop: { type: 'boolean', description: 'Explicitly lift the current stop before resuming the same conversation.' } },
      required: ['session'], additionalProperties: false },
  },
  {
    name: 'baton2_context_engines',
    description: 'List installed context modules and their capabilities. Optional session scope includes the attached session\'s project settings and each module\'s enabled and preferred state.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', enum: ['session'], description: 'Use the attached session\'s recorded workspace' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_context_install',
    description: 'Acquire a context module from a locally supplied, already-built module directory or extracted Baton2 distribution. Copy its dependency closure into this coordinator installation; an existing module remains present. Inspect capabilities with baton2_context_engines.',
    inputSchema: { type: 'object', properties: {
      module: { type: 'string', description: 'Module ID from its native provider declaration' },
      path: { type: 'string', description: 'Complete module directory or extracted distribution prefix' },
    }, required: ['module', 'path'], additionalProperties: false },
  },
  {
    name: 'baton2_context_query_file',
    description: 'Evaluate a native context query from a JSON request file as the attached session and retain its result in this database. Use a unique query ID and a file accessible to the coordinator.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string' }, path: { type: 'string', description: 'Path to the query request JSON file' },
    }, required: ['query', 'path'], additionalProperties: false },
  },
  {
    name: 'baton2_context_result',
    description: 'Read the retained context result envelope for a query ID in this shared database.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } },
      required: ['query'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge',
    description: 'Discover finding metadata or read an exact finding and its complete evidence as the attached session. Index rows carry literal detailRead argv, and retained-message metadata carries literal deliveryRead argv.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', description: 'universal, worker, group, or all (the default discovery view)' },
      subject: { type: 'string', description: 'Worker or Ensemble ID; universal can name its Principal Conductor' },
      index: { type: 'boolean', description: 'Return compact metadata for visible findings' },
      id: { type: 'string', description: 'Return the complete visible finding with this exact stored ID' },
      pretty: { type: 'boolean', description: 'Pretty-print the JSON result' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_relations',
    description: 'Read directed knowledge relationships, including message and external-reference links. Defaults to the attached session\'s authored relationships and links touching its held findings; optional scopes use the existing knowledge holdings.',
    inputSchema: { type: 'object', properties: {
      scope: { type: 'string', description: 'worker (default), group, universal, or all' },
      subject: { type: 'string', description: 'Worker or Ensemble ID; universal can name its Principal Conductor' },
      pretty: { type: 'boolean', description: 'Pretty-print the JSON result' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_record',
    description: 'Record knowledge as the attached session, with cited evidence and limits. An optional kind names the item, such as observation, decision or hypothesis.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' },
      kind: { type: 'string', description: 'Authored item type; omitted means finding. Types are free-form.' },
      evidence: { type: 'string', description: 'Evidence reference, such as message:MESSAGE_ID' },
      limits: { type: 'string' },
    }, required: ['id', 'claim', 'evidence', 'limits'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_relate',
    description: 'Connect two knowledge or evidence references with an authored relationship. The direction is source relation target, such as a correction Supersedes an earlier finding.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' },
      source: { type: 'string', description: 'Reference such as finding:ID, message:ID or an external source' },
      relation: { type: 'string', description: 'Free-form relationship name, such as Supports, DerivedFrom or Supersedes' },
      target: { type: 'string', description: 'The related reference' },
    }, required: ['id', 'source', 'relation', 'target'], additionalProperties: false },
  },
  {
    name: 'baton2_knowledge_promote',
    description: 'Promote a reviewed finding from its recorded source into a destination scope as the attached session.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Promotion ID' }, source: { type: 'string' },
      destination: { type: 'string' }, finding: { type: 'string', description: 'Finding ID' },
    }, required: ['id', 'source', 'destination', 'finding'], additionalProperties: false },
  },
  {
    name: 'baton2_player',
    description: 'Inspect a Player or Conductor by session ID, including its responsibility and native identity.',
    inputSchema: { type: 'object', properties: { player: { type: 'string' } },
      required: ['player'], additionalProperties: false },
  },
  {
    name: 'baton2_join',
    description: 'Register a Player in an existing checkout shared with other Players.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'New Player session ID' },
      parent: { type: 'string', description: 'Parent session ID (default: attached Conductor)' },
      harness: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      workspace: { type: 'string', description: 'Existing checkout path' },
    }, required: ['player', 'harness', 'model', 'effort', 'workspace'], additionalProperties: false },
  },
  {
    name: 'baton2_recruit',
    description: 'Recruit a Player for a task that needs a separate Git worktree. Name the target branch, requested remote and integration Conductor in its task assignment.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'New Player session ID' },
      parent: { type: 'string', description: 'Parent session ID (default: attached Conductor)' },
      harness: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      repo: { type: 'string', description: 'Repository path' },
      branch: { type: 'string' }, workspace: { type: 'string', description: 'New worktree path' },
      base: { type: 'string', description: 'Base Git revision' },
    }, required: ['player', 'harness', 'model', 'effort', 'repo', 'branch', 'workspace', 'base'],
    additionalProperties: false },
  },
  {
    name: 'baton2_receiver',
    description: 'Register a native receive endpoint for an explicit Codex, OMP, Muse or Claude Code Player session.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      cwd: { type: 'string', description: 'Working directory the session turns run in; recorded when supplied' },
    }, required: ['player', 'command', 'log'], additionalProperties: false },
  },
  {
    name: 'baton2_configure',
    description: 'Configure a Player\'s provider and reasoning effort for future turns, keeping its assignment, work, native conversation and pending input. Saving effort on the same harness and model works during active or stopped sessions and keeps the receiver, current turn and stop. Changing harness or model requires the current attempt to end and any stop to be lifted.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      harness: { type: 'string', description: 'Selected provider harness' },
      model: { type: 'string', description: 'Selected model key' },
      effort: { type: 'string', description: 'Selected thinking effort' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      expectedHarness: { type: 'string', description: 'Recorded harness the caller expects' },
      expectedModel: { type: 'string', description: 'Recorded model the caller expects' },
      expectedEffort: { type: 'string', description: 'Recorded effort the caller expects' },
    }, required: ['player', 'harness', 'model', 'effort', 'command', 'log',
      'expectedHarness', 'expectedModel', 'expectedEffort'], additionalProperties: false },
  },
  {
    name: 'baton2_dispatch_file',
    description: 'Commit a file as authorized message input and launch delivery to its registered recipient.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Message ID' },
      sender: { type: 'string', description: 'Sender session ID (default: attached Conductor)' },
      recipient: { type: 'string', description: 'Recipient session ID' },
      kind: { type: 'string', description: 'Message kind' },
      path: { type: 'string', description: 'Message body file path' },
    }, required: ['id', 'recipient', 'kind', 'path'], additionalProperties: false },
  },
  {
    name: 'baton2_dispatch_turn',
    description: 'Launch a registered Player turn from a task file using its recorded model, effort and workspace.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      id: { type: 'string', description: 'Turn ID' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
      task: { type: 'string', description: 'Task file path' },
    }, required: ['player', 'id', 'command', 'log', 'task'], additionalProperties: false },
  },
  {
    name: 'baton2_role',
    description: 'Read or assign a session responsibility.',
    inputSchema: { type: 'object', properties: {
      session: { type: 'string' },
      role: { type: 'string', enum: ['player', 'principal-conductor', 'associate-conductor', 'operator'] },
    }, required: ['session'], additionalProperties: false },
  },
  {
    name: 'baton2_ensemble',
    description: 'Inspect an Ensemble or configure its owner and coupling.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, owner: { type: 'string' },
      coupling: { type: 'string', enum: ['loose', 'tight'], description: 'Omitting coupling preserves an existing Ensemble; new Ensembles default to loose.' },
    }, required: ['ensemble'], additionalProperties: false },
  },
  {
    name: 'baton2_ensemble_member',
    description: 'Add or remove a Player or Conductor from an explicitly designated Ensemble.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, owner: { type: 'string' }, player: { type: 'string' },
      action: { type: 'string', enum: ['add', 'remove'] },
    }, required: ['ensemble', 'player', 'action'], additionalProperties: false },
  },
  {
    name: 'baton2_section',
    description: 'Inspect a Section or declare its capability within an Ensemble.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, section: { type: 'string' },
      owner: { type: 'string' }, capability: { type: 'string' },
    }, required: ['ensemble', 'section'], additionalProperties: false },
  },
  {
    name: 'baton2_section_member',
    description: 'Add or remove an Ensemble member from one of its Sections.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, section: { type: 'string' }, owner: { type: 'string' },
      player: { type: 'string' }, action: { type: 'string', enum: ['add', 'remove'] },
    }, required: ['ensemble', 'section', 'player', 'action'], additionalProperties: false },
  },
  {
    name: 'baton2_orchestra',
    description: 'Inspect Players, both Conductor tiers, operators, Ensembles and their Sections.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_status',
    description: 'Show all coordinator sessions and their pending message counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_owner',
    description: 'Read the elected database owner readiness: generation, committed cursor and gap flag.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_inbox',
    description: 'Show unacknowledged messages for a session. Set index to true for message metadata; baton2_delivery reads a complete stored message.',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Session ID (default: attached Conductor)' },
        index: { type: 'boolean', description: 'Return sequence, identity, route, kind and receipt without bodies' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_delivery',
    description: 'Read one complete stored message and its receipt by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } },
      required: ['id'], additionalProperties: false },
  },
  {
    name: 'baton2_ack',
    description: 'Acknowledge the attached Conductor’s fully read and handled input. Record unfinished work in reports and project state.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message ID to acknowledge' },
        receipt: { type: 'string', description: 'Input disposition' },
      },
      required: ['id', 'receipt'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_guide',
    description: 'Send guidance to a player through the coordinator.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message ID (unique)' },
        player: { type: 'string', description: 'Player session ID' },
        body: { type: 'string', description: 'Guidance text' },
      },
      required: ['id', 'player', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_player_status',
    description: 'Show a player\'s Git worktree state (branch, commit, dirty).',
    inputSchema: {
      type: 'object',
      properties: { player: { type: 'string', description: 'Player session ID' } },
      required: ['player'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land',
    description: 'Land a player\'s committed changes onto a target branch (fast-forward only).',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
        commit: { type: 'string', description: 'Optional reviewed commit from the recorded branch.' },
      },
      required: ['player', 'repo', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land_checked',
    description: 'Land a player\'s changes onto a target branch with a check script gate.',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
        commit: { type: 'string', description: 'Optional reviewed commit from the recorded branch.' },
        check: { type: 'string', description: 'Check script path' },
        files: { type: 'string', description: 'Space-separated list of files to check' },
      },
      required: ['player', 'repo', 'target', 'check', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_players',
    description: 'List all players with their harness, route, workspace, latest report and pending message count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_turns',
    description: 'List all turns for a player with event type, report body and receipt status.',
    inputSchema: {
      type: 'object',
      properties: { player: { type: 'string', description: 'Player session ID' } },
      required: ['player'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_pending',
    description: 'List all unacknowledged messages. Set index to true for message metadata; baton2_delivery reads a complete stored message.',
    inputSchema: { type: 'object', properties: { index: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'baton2_push',
    description: 'Push a branch to a remote after landing.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Repository path' },
        branch: { type: 'string', description: 'Branch name to push' },
        remote: { type: 'string', description: 'Remote name (e.g. origin)' },
      },
      required: ['repo', 'branch', 'remote'],
      additionalProperties: false,
    },
  },
];

// State.
let deliveryReady = null;
let channelReady = false;
let notifiedSeqs = new Set();
let deliveryServer = null;
let db = null;

function openDb() {
  if (db) return db;
  if (!existsSync(dbPath)) return null;
  db = new DatabaseSync(dbPath, { open: true, readOnly: true });
  return db;
}

function pendingConductorMessages(messageId = null) {
  const conn = openDb();
  if (!conn) return [];
  try {
    const rows = conn.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = ? AND m.receipt IS NULL
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`
    ).all(sessionId, messageId, messageId);
    return rows;
  } catch (e) {
    return [];
  }
}

function notifyPending(messageId = null) {
  if (!channelReady) return;
  const messages = pendingConductorMessages(messageId);
  const newMessages = messages.filter((m) => !notifiedSeqs.has(m.seq));
  if (newMessages.length === 0) return;

  for (const m of newMessages) {
    notifiedSeqs.add(m.seq);
  }

  const content = newMessages.map((m) => {
    const prefix = m.kind === 'report' ? 'Player report' : `Message (${m.kind})`;
    return `${prefix} from ${m.sender} [id: ${m.id}]:\n${m.body}`;
  }).join('\n\n---\n\n');

  sendNotification('notifications/claude/channel', {
    content,
    meta: { recipient: sessionId, messageIds: JSON.stringify(newMessages.map((m) => m.id)) },
  });
}

async function startDelivery() {
  const database = resolve(dbPath);
  const coordinator = resolve(coordinatorExe);
  const socketName = `conductor-${process.pid}.sock`;
  // A relative socket name also works in deeply nested repository worktrees.
  process.chdir(dirname(database));
  deliveryServer = createServer({ allowHalfOpen: true }, (client) => {
    let input = '';
    client.on('data', (chunk) => { input += chunk; });
    client.on('end', () => {
      try {
        notifyPending(JSON.parse(input));
        client.end('ok\n');
      } catch (error) {
        client.end(error.message + '\n');
      }
    });
    client.on('error', (error) => process.stderr.write(`mcp-conductor: ${error.message}\n`));
  });
  await new Promise((ready, fail) => {
    deliveryServer.once('error', fail);
    deliveryServer.listen(socketName, ready);
  });
  const endpoint = JSON.stringify([
    process.execPath, fileURLToPath(import.meta.url), database, coordinator,
    '--session', sessionId, '--deliver', socketName,
  ]);
  let existing;
  try { existing = selectedSession(); } catch {}
  if (hasParent(existing)) coord('connect', sessionId, existing.native || '', endpoint);
  else coord('attach', sessionId, 'claude-code', existing?.native || '', endpoint);
  coord('role', sessionId, hasParent(existing) ? 'associate-conductor' : 'principal-conductor');
}

function selectedSession() {
  return openDb()?.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
}

// MCP message handler.
function handleMessage(msg) {
  if (msg.id === 'conductor-channel-ready' && msg.result !== undefined) {
    channelReady = true;
    notifyPending();
    return;
  }
  if (msg.method === 'initialize') {
    sendResponse(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      serverInfo: { name: 'baton-conductor', version: '0.1.0' },
      instructions: `Baton2 ${hasParent(selectedSession()) ? 'Associate' : 'Principal'} Conductor attachment for session ${sessionId}. Use baton2_join for shared-checkout work and baton2_recruit when a separate worktree is needed. Name the target branch, remote and integration Conductor in the assignment. Commit completed changes. The integration Conductor lands or reconciles contributions and pushes the integrated target with baton2_push. After publication and turn completion, relocate the same Player with baton2_receiver to the shared checkout and retire clean unused merged task worktrees and branches through ordinary Git. Preserve active or unfinished work, explicit stops and receiver/toolchain dependencies. Use baton2_receiver to register a Player's Codex, OMP, Muse or Claude Code receive endpoint, then baton2_dispatch_file to send task or guidance files. Use baton2_dispatch_turn to launch a registered Player's task file with its recorded route. Use baton2_configure to save future effort on the same harness and model during active or stopped sessions, keeping the receiver, current turn and stop. Change harness or model after the current attempt ends and any stop is lifted. Configuration keeps the Player's identity, work, native conversation and pending input. Use baton2_context_engines to discover installed context modules; scope:"session" includes the attached project settings. Use baton2_context_install to acquire a module from a supplied built module directory or extracted distribution. Use baton2_context_query_file for request files and baton2_context_result for retained query results. Use baton2_knowledge for findings and baton2_knowledge_relations for directed links, including links between retained messages or external references. Use baton2_inbox or baton2_pending to see pending messages. Their optional index:true argument returns metadata; baton2_delivery reads a selected complete message. Use baton2_ack to acknowledge your own fully read and handled input; retain unfinished work in your reports and project state. Use baton2_guide to direct Players. The coordinator CLI ask and ask-file send questions as your recorded session to its parent; a parentless Principal Conductor reaches the registered operator. Use baton2_player and baton2_players to inspect Players and both Conductor tiers. Use baton2_role, baton2_ensemble, baton2_ensemble_member, baton2_section and baton2_section_member to configure responsibilities and membership. Use baton2_orchestra to inspect the system. Use baton2_turns for turn history and baton2_land or baton2_land_checked to land a Player's changes. Supply commit to select a reviewed ancestor while later work remains on the recorded branch.`,
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    deliveryReady = startDelivery();
    deliveryReady.catch((error) => {
      process.stderr.write(`mcp-conductor: ${error.message}\n`);
      process.exit(1);
    });
    return;
  }

  if (msg.method === 'tools/list') {
    sendResponse(msg.id, { tools: TOOLS });
    // In the native recovery run, replay before the client installed its channel
    // handler was lost. Complete a round trip after discovery before replaying.
    if (!channelReady) deliveryReady?.then(() => {
      writeMessage({ jsonrpc: '2.0', id: 'conductor-channel-ready', method: 'ping' });
    });
    return;
  }

  if (msg.method === 'tools/call') {
    handleToolCall(msg);
    return;
  }

  if (msg.method === 'ping') {
    sendResponse(msg.id, {});
    return;
  }

  // Notifications we don't handle.
  if (!msg.id) return;

  sendError(msg.id, -32601, `Method not found: ${msg.method}`);
}

function landCommit(args) {
  if (args.commit === undefined) return [];
  if (typeof args.commit !== 'string') throw new Error('commit must be a string');
  return ['--commit', args.commit];
}

function handleToolCall(msg) {
  const { name, arguments: args } = msg.params;
  const player = args?.player ?? args?.worker;
  try {
    let result;
    switch (name) {
      case 'baton2_project':
        result = coord('project', args.path);
        break;
      case 'baton2_project_sessions':
        result = coord('project-sessions', args.path);
        break;
      case 'baton2_resume':
        result = coord('resume', args.session, ...(args.liftStop === true ? ['--lift-stop'] : []));
        break;
      case 'baton2_context_engines':
        result = coord('context-engines', ...(args?.scope === 'session' ? [sessionId] : []));
        break;
      case 'baton2_context_install':
        result = coord('context-install', args.module, args.path);
        break;
      case 'baton2_context_query_file':
        result = coord('context-query-file', sessionId, args.query, args.path);
        break;
      case 'baton2_context_result':
        result = coord('context-result', args.query);
        break;
      case 'baton2_knowledge': {
        const options = args;
        const selection = options.index === true ? ['--index']
          : options.id === undefined ? [] : ['--id', options.id];
        const presentation = options.pretty === true ? ['--pretty'] : [];
        result = options.scope === undefined
          ? coord('knowledge', sessionId, ...selection, ...presentation)
          : coord('knowledge-scope', sessionId, options.scope,
              options.subject ?? (options.scope === 'worker' ? sessionId : ''),
              ...selection, ...presentation);
        break;
      }
      case 'baton2_knowledge_relations': {
        const scope = args.scope ?? 'worker';
        const subject = args.subject ?? (scope === 'worker' ? sessionId : '');
        result = coord('knowledge-relations', sessionId, scope, subject,
          ...(args.pretty === true ? ['--pretty'] : []));
        break;
      }
      case 'baton2_knowledge_record':
        result = args.kind === undefined
          ? coord('record', args.id, sessionId, args.claim, args.evidence, args.limits)
          : coord('record-typed', args.id, sessionId, args.kind, args.claim, args.evidence, args.limits);
        break;
      case 'baton2_knowledge_relate':
        result = coord('relate', args.id, sessionId, args.source, args.relation, args.target);
        break;
      case 'baton2_knowledge_promote':
        result = coord('promote', args.id, sessionId, args.source, args.destination, args.finding);
        break;
      case 'baton2_player':
        result = coord('player', player);
        break;
      case 'baton2_join':
        result = coord('join', player, args.parent ?? sessionId, args.harness, args.model,
          args.effort, args.workspace);
        break;
      case 'baton2_recruit':
        result = coord('recruit', player, args.parent ?? sessionId, args.harness, args.model,
          args.effort, args.repo, args.branch, args.workspace, args.base);
        break;
      case 'baton2_receiver':
        result = coord('receiver', player, args.command, args.log,
                       ...(args.cwd === undefined ? [] : [args.cwd]));
        break;
      case 'baton2_configure':
        result = coord('configure', player, args.harness, args.model, args.effort,
          args.command, args.log, args.expectedHarness, args.expectedModel, args.expectedEffort);
        break;
      case 'baton2_dispatch_file':
        result = coord('dispatch-file', args.id, args.sender ?? sessionId,
          args.recipient, args.kind, args.path);
        break;
      case 'baton2_dispatch_turn':
        result = coord('dispatch-turn', player, args.id, args.command, args.log, args.task);
        break;
      case 'baton2_role':
        result = coord('role', args.session, ...(args.role === undefined ? [] : [args.role]));
        break;
      case 'baton2_ensemble':
        result = coord('ensemble', args.ensemble,
          ...(args.owner === undefined && args.coupling === undefined ? []
            : [args.owner ?? sessionId, ...(args.coupling === undefined ? [] : [args.coupling])]));
        break;
      case 'baton2_ensemble_member':
        result = coord('ensemble-member', args.ensemble, args.owner ?? sessionId, player, args.action);
        break;
      case 'baton2_section':
        if (args.owner !== undefined && args.capability === undefined) throw new Error('Declaring a Section requires its capability');
        result = coord('section', args.ensemble, args.section,
          ...(args.capability === undefined ? [] : [args.owner ?? sessionId, args.capability]));
        break;
      case 'baton2_section_member':
        result = coord('section-member', args.ensemble, args.section, args.owner ?? sessionId, player, args.action);
        break;
      case 'baton2_orchestra':
        result = coord('orchestra');
        break;
      case 'baton2_status':
        result = coord('status');
        break;
      case 'baton2_owner':
        result = coord('owner-status');
        break;
      case 'baton2_inbox':
        result = coord('inbox', args?.recipient ?? sessionId, ...(args?.index === true ? ['--index'] : []));
        break;
      case 'baton2_delivery':
        result = coord('delivery', args.id);
        break;
      case 'baton2_ack':
        result = coord('ack', args.id, sessionId, args.receipt);
        break;
      case 'baton2_guide':
        result = coord('message', args.id, sessionId, player, 'guidance', args.body);
        break;
      case 'baton2_player_status':
      case 'baton2_worker_status':
        result = coord('worktree', player);
        break;
      case 'baton2_land':
        result = coord('land', player, args.repo, args.target, ...landCommit(args));
        break;
      case 'baton2_land_checked':
        result = coord('land-checked', player, args.repo, args.target, args.check, args.files, ...landCommit(args));
        break;
      case 'baton2_players':
        result = coord('players');
        break;
      case 'baton2_workers':
        result = coord('workers');
        break;
      case 'baton2_turns':
        result = coord('turns', player);
        break;
      case 'baton2_pending':
        result = coord('pending', ...(args?.index === true ? ['--index'] : []));
        break;
      case 'baton2_push':
        result = coord('push', args.repo, args.branch, args.remote);
        break;
      default:
        sendError(msg.id, -32602, `Unknown tool: ${name}`);
        return;
    }
    sendResponse(msg.id, {
      content: [{ type: 'text', text: result }],
    });
  } catch (e) {
    sendResponse(msg.id, {
      content: [{ type: 'text', text: `Error: ${e.message}` }],
      isError: true,
    });
  }
}

process.on('SIGINT', () => {
  deliveryServer?.close();
  db?.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  deliveryServer?.close();
  db?.close();
  process.exit(0);
});

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
    name: 'baton2_player',
    description: 'Inspect a Player or Conductor by session ID, including its responsibility and native identity.',
    inputSchema: { type: 'object', properties: { player: { type: 'string' } },
      required: ['player'], additionalProperties: false },
  },
  {
    name: 'baton2_recruit',
    description: 'Recruit a Player or Associate Conductor with a registered assignment and Git worktree. Extended role/ensembles/sections require explicit parent and role. Each Section membership also adds Ensemble membership; owners may differ from parent. Repeat calls with the same parent for siblings, or an Associate parent for nested work. Configuration returns one complete native result with workspace and registration phases; startup is not requested.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'New Player session ID' },
      parent: { type: 'string', description: 'Parent session ID (default: attached Conductor)' },
      harness: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' },
      repo: { type: 'string', description: 'Repository path' },
      branch: { type: 'string' }, workspace: { type: 'string', description: 'New worktree path' },
      base: { type: 'string', description: 'Base Git revision' },
      role: { type: 'string', enum: ['player', 'associate-conductor'] },
      ensembles: { type: 'array', items: { type: 'object', properties: {
        ensemble: { type: 'string' }, owner: { type: 'string' },
      }, required: ['ensemble', 'owner'], additionalProperties: false } },
      sections: { type: 'array', items: { type: 'object', properties: {
        ensemble: { type: 'string' }, owner: { type: 'string' }, section: { type: 'string' },
      }, required: ['ensemble', 'owner', 'section'], additionalProperties: false } },
    }, required: ['player', 'harness', 'model', 'effort', 'repo', 'branch', 'workspace', 'base'],
    additionalProperties: false },
  },
  {
    name: 'baton2_receiver',
    description: 'Register a native receive endpoint for an explicit Codex or OMP Player session.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string', description: 'Registered Player session ID' },
      command: { type: 'string', description: 'Native harness executable path or command name' },
      log: { type: 'string', description: 'Native output log path' },
    }, required: ['player', 'command', 'log'], additionalProperties: false },
  },
  {
    name: 'baton2_receiver_route_inspect',
    description: 'Inspect a requested OMP child route change. The native operation reports why configuration is unavailable, returns exit 2 and preserves assignment, observations and pending work.',
    inputSchema: { type: 'object', properties: {
      player: { type: 'string' }, expectedModel: { type: 'string' },
      expectedEndpoint: { type: 'string', description: 'Exact endpoint text from the recorded session' },
      model: { type: 'string', description: 'Requested model; this call does not configure it' },
    }, required: ['player', 'expectedModel', 'expectedEndpoint', 'model'], additionalProperties: false },
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
    description: 'Launch a recruited Player turn from a task file using its recorded model, effort and workspace.',
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
    description: 'Inspect an Ensemble or configure its owner and coupling. sections declares capability groups in one native operation and requires explicit owner and coupling. The owner must be a registered Conductor, including a Principal. Sections may be empty; recruit multiple Players into a Section to form a critic group. Ownership and membership are independent.',
    inputSchema: { type: 'object', properties: {
      ensemble: { type: 'string' }, owner: { type: 'string' },
      coupling: { type: 'string', enum: ['loose', 'tight'] },
      sections: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        section: { type: 'string' }, capability: { type: 'string' },
      }, required: ['section', 'capability'], additionalProperties: false } },
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
    description: 'Use index:true for concise Players, Conductor tiers, operators, Ensembles and Sections. session focuses a registered session and requires index. Returns complete structural records with per-actor pendingCount, unacknowledgedCount and inputRead argv. Reference limitations.next is a literal native argv array. To follow it through MCP, call baton2_orchestra with index:true and session set to the reference id. pendingCount excludes stopped execution inputs; unacknowledgedCount includes every NULL receipt. Use baton2_inbox with index:true and recipient for pending metadata; state:all includes receipt history. baton2_pending accepts recipient/sender/kind selectors; baton2_delivery retrieves each full body. References retain their recorded parents without expanding outside branches. Unfocused routes is null (not requested); focused routes is the admitted outgoing array. Compact reads require a UTF-8 database. Legacy no-index includes report bodies.',
    inputSchema: { type: 'object', properties: { index: { type: 'boolean' }, session: { type: 'string' }, pretty: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'baton2_status',
    description: 'Show all coordinator sessions and their pending message counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_inbox',
    description: 'Read messages for recipient (default attached session). Use index:true for concise metadata without acknowledgment; state defaults to pending and accepts acknowledged/all. sender and kind are conjunctive exact text filters, valid only with index. Use baton2_delivery for full bodies. afterSeq is exclusive and throughSeq inclusive on the stored coordination sequence; both require index:true and canonical decimal strings from 0 through 9223372036854775807. Omitted bounds are unbounded; equal bounds select nothing; reversed bounds refuse. Rows retain ascending sequence order. Compact reads require a UTF-8 database. Legacy no-index returns pending bodies.',
    inputSchema: { type: 'object', properties: {
      recipient: { type: 'string' }, index: { type: 'boolean' }, sender: { type: 'string' },
      kind: { type: 'string' }, state: { type: 'string', enum: ['pending', 'acknowledged', 'all'] },
      afterSeq: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
      throughSeq: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
      pretty: { type: 'boolean' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_delivery',
    description: 'Read the full retained message body and receipt by ID, including acknowledged messages. This read does not acknowledge or retry delivery.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, pretty: { type: 'boolean' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'baton2_ack',
    description: 'Acknowledge delivery of a message to the attached Conductor.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message ID to acknowledge' },
        receipt: { type: 'string', description: 'Native receipt evidence' },
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
        commit: { type: 'string', description: 'Optional reviewed source commit; native verifies ancestry of the recorded branch. Omission selects its tip.' },
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
        commit: { type: 'string', description: 'Optional reviewed source commit; native verifies ancestry of the recorded branch. Omission selects its tip.' },
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
    description: 'Read across all recipients by default. Use index:true for concise metadata; optional recipient, sender and kind filters combine by exact equality. state defaults to pending and accepts acknowledged/all. Filters require index. afterSeq is exclusive and throughSeq inclusive on the stored coordination sequence. Bounds are canonical decimal strings from 0 through 9223372036854775807; omitted bounds are unbounded, equal bounds select nothing, and reversed bounds refuse. Rows retain ascending sequence order. Compact reads require a UTF-8 database. Legacy no-index includes bodies and endpoints. This read never acknowledges.',
    inputSchema: { type: 'object', properties: {
      index: { type: 'boolean' }, recipient: { type: 'string' }, sender: { type: 'string' },
      kind: { type: 'string' }, state: { type: 'string', enum: ['pending', 'acknowledged', 'all'] },
      afterSeq: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
      throughSeq: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
      pretty: { type: 'boolean' },
    }, additionalProperties: false },
  },
  {
    name: 'baton2_knowledge',
    description: 'Read findings visible to reader (default attached session). index:true returns complete metadata with UTF-8 byte lengths, evidence-message identity/receipt state, visible destinations and literal detailRead argv. id selects zero or one full finding with complete claim, limits, cited evidence and reader-visible promotion history, including acknowledged evidence. index and id are mutually exclusive. These modes use read-only connections and never create knowledge tables or acknowledge evidence; both absent tables return [], partial schemas refuse. Invisible and absent IDs both return []. Omit index/id for the existing full view.',
    inputSchema: { type: 'object', properties: {
      reader: { type: 'string' }, index: { type: 'boolean' },
      id: { type: 'string', description: 'Exact literal finding ID; use the id from detailRead.' },
      pretty: { type: 'boolean' },
    }, additionalProperties: false },
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
      instructions: `Baton2 ${hasParent(selectedSession()) ? 'Associate' : 'Principal'} Conductor attachment for session ${sessionId}. Use baton2_recruit to assign a Player and its worktree. For structural configuration provide explicit parent and role with typed ensembles/sections arrays. Repeated explicit parents form sibling or nested Associates. baton2_ensemble accepts sections with explicit owner and coupling; a Principal may own an Ensemble directly. Sections may be empty or contain multiple Players, and memberships may cross parent boundaries. Parent responsibility, ownership and membership are separate facts. One native result reports configuration and workspace phases; startupRequested:false leaves task dispatch to existing commands. Use baton2_receiver to register a Player's Codex or OMP receive endpoint, then baton2_dispatch_file to send task or guidance files. Use baton2_dispatch_turn to launch a recruited Player's task file with its recorded route. Use baton2_inbox with index:true for concise pending metadata scoped to this attachment; baton2_pending with index:true reads across recipients. Exact sender/kind filters combine; state:all includes acknowledged history. Use baton2_delivery to read each selected complete body. Index reads do not acknowledge, review or complete work. Use baton2_knowledge with index:true to list visible finding metadata; use id with the selected literal finding ID to read its complete claim, limits, evidence and visible promotion history. Reader defaults to this session. Acknowledged evidence remains readable. Use baton2_ack to acknowledge delivery. Use baton2_guide to direct Players. Use baton2_player and baton2_players to inspect Players and both Conductor tiers. Use baton2_role, baton2_ensemble, baton2_ensemble_member, baton2_section and baton2_section_member to configure responsibilities and membership. Use baton2_orchestra with index:true and session to inspect the focused system; omitted session selects the full structure. Structural output provides per-actor counts and inputRead argv. Reference limitations.next is a literal native argv array. To follow it through MCP, call baton2_orchestra with index:true and session set to the reference id. pendingCount excludes stopped execution inputs; unacknowledgedCount includes every NULL receipt. Use baton2_inbox with index:true and recipient for each actor; state:all includes receipt history. Counts describe retained input; per-message disposition is available from inbox/pending indexes. Legacy no-index readers include bodies and histories. Use baton2_turns for turn history and baton2_land or baton2_land_checked to land a Player's changes. Landing defaults to the recorded branch tip; supply commit with a reviewed object ID to select an ancestor while later work remains on the branch. Native selection verifies the registered workspace repository and source ancestry. The checked form runs target/candidate checks on that source. Inspect the result status; selection does not grant review or landing authority.`,
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

function readOptions(options, allowed) {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('Read options must be an object');
  for (const [key, value] of Object.entries(options)) {
    if (!allowed.includes(key) || typeof value !== (['index', 'pretty'].includes(key) ? 'boolean' : 'string')) throw new Error('Invalid read option: ' + key);
  }
}

function messageReadOptions(options, inbox) {
  readOptions(options, ['index', 'recipient', 'sender', 'kind', 'state', 'afterSeq', 'throughSeq', 'pretty']);
  const filters = inbox ? ['sender', 'kind', 'state', 'afterSeq', 'throughSeq'] : ['recipient', 'sender', 'kind', 'state', 'afterSeq', 'throughSeq'];
  if (!options.index && filters.some(key => options[key] !== undefined)) throw new Error('Message filters require index: true');
  for (const key of ['afterSeq', 'throughSeq']) {
    const value = options[key];
    if (value !== undefined && (/^(0|[1-9][0-9]{0,18})$/.exec(value)?.[0] !== value ||
        (value.length === 19 && value > '9223372036854775807'))) throw new Error('Invalid sequence bound: ' + key);
  }
  const lower = options.afterSeq, upper = options.throughSeq;
  if (lower !== undefined && upper !== undefined &&
      (lower.length > upper.length || (lower.length === upper.length && lower > upper))) throw new Error('Reversed sequence bounds');
  const argv = options.index ? ['--index'] : [];
  for (const key of filters) if (options[key] !== undefined) {
    const flag = key === 'afterSeq' ? 'after-seq' : key === 'throughSeq' ? 'through-seq' : key;
    argv.push('--' + flag, options[key]);
  }
  if (options.pretty) argv.push('--pretty');
  return argv;
}

function landCommit(args) {
  if (args.commit === undefined) return [];
  if (typeof args.commit !== 'string') throw new Error('commit must be a string');
  return ['--commit', args.commit];
}

function structuralFields(value, strings, arrays, required) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Structural arguments must be an object');
  for (const [key, item] of Object.entries(value)) {
    if (strings.includes(key)) {
      if (typeof item !== 'string') throw new Error('Structural argument must be a string: ' + key);
    } else if (arrays.includes(key)) {
      if (!Array.isArray(item)) throw new Error('Structural group must be an array: ' + key);
    } else throw new Error('Unknown structural argument: ' + key);
  }
  for (const key of required) if (value[key] === undefined) throw new Error('Required structural argument: ' + key);
}

function structuralGroups(groups, flag, keys) {
  const argv = [];
  for (const group of groups ?? []) {
    structuralFields(group, keys, [], keys);
    argv.push(flag, ...keys.map(key => group[key]));
  }
  return argv;
}

function recruitOptions(args) {
  if (!['role', 'ensembles', 'sections'].some(key => args?.[key] !== undefined)) return [];
  structuralFields(args, ['player', 'parent', 'harness', 'model', 'effort', 'repo', 'branch', 'workspace', 'base', 'role'],
    ['ensembles', 'sections'], ['player', 'parent', 'harness', 'model', 'effort', 'repo', 'branch', 'workspace', 'base', 'role']);
  if (!['player', 'associate-conductor'].includes(args.role)) throw new Error('Extended recruit role must be player or associate-conductor');
  return ['--role', args.role, ...structuralGroups(args.ensembles, '--ensemble', ['ensemble', 'owner']),
    ...structuralGroups(args.sections, '--section', ['ensemble', 'owner', 'section'])];
}

function ensembleOptions(args) {
  if (args?.sections === undefined) return [];
  structuralFields(args, ['ensemble', 'owner', 'coupling'], ['sections'], ['ensemble', 'owner', 'coupling', 'sections']);
  if (!['loose', 'tight'].includes(args.coupling)) throw new Error('Ensemble coupling must be loose or tight');
  if (!args.sections.length) throw new Error('Section declarations must contain at least one group');
  return structuralGroups(args.sections, '--section', ['section', 'capability']);
}

function handleToolCall(msg) {
  const { name, arguments: args } = msg.params;
  const player = args?.player ?? args?.worker;
  try {
    let result;
    switch (name) {
      case 'baton2_receiver_route_inspect': {
        const keys = ['player', 'expectedModel', 'expectedEndpoint', 'model'];
        if (!args || Array.isArray(args) || typeof args !== 'object'
            || Object.keys(args).some(key => !keys.includes(key))
            || keys.some(key => typeof args[key] !== 'string' || args[key].includes('\0'))) {
          throw new Error('Route inspection requires only player, expectedModel, expectedEndpoint and model as literal strings without NUL');
        }
        result = coord('receiver-route', args.player, args.expectedModel, args.expectedEndpoint, args.model, '--inspect');
        break;
      }
      case 'baton2_player':
        result = coord('player', player);
        break;
      case 'baton2_recruit':
        result = coord('recruit', player, args.parent ?? sessionId, args.harness, args.model,
          args.effort, args.repo, args.branch, args.workspace, args.base, ...recruitOptions(args));
        break;
      case 'baton2_receiver':
        result = coord('receiver', player, args.command, args.log);
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
          ...(args.owner === undefined && args.coupling === undefined && args.sections === undefined ? [] : [args.owner ?? sessionId, args.coupling ?? 'loose']), ...ensembleOptions(args));
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
      case 'baton2_orchestra': {
        const options = args ?? {};
        readOptions(options, ['index', 'session', 'pretty']);
        if (options.session !== undefined && options.index !== true) throw new Error('session requires index: true');
        result = coord('orchestra', ...(options.index ? ['--index'] : []),
          ...(options.session === undefined ? [] : ['--for', options.session]), ...(options.pretty ? ['--pretty'] : []));
        break;
      }
      case 'baton2_status':
        result = coord('status');
        break;
      case 'baton2_inbox':
        result = coord('inbox', args?.recipient ?? sessionId, ...messageReadOptions(args ?? {}, true));
        break;
      case 'baton2_delivery':
        readOptions(args ?? {}, ['id', 'pretty']);
        if (typeof args?.id !== 'string') throw new Error('delivery requires id');
        result = coord('delivery', args.id, ...(args.pretty ? ['--pretty'] : []));
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
        result = coord('pending', ...messageReadOptions(args ?? {}, false));
        break;
      case 'baton2_knowledge': {
        const options = args ?? {};
        readOptions(options, ['reader', 'index', 'id', 'pretty']);
        if (options.index === true && options.id !== undefined) throw new Error('knowledge index and id are mutually exclusive');
        result = coord('knowledge', options.reader ?? sessionId,
          ...(options.index ? ['--index'] : []),
          ...(options.id === undefined ? [] : ['--id', options.id]),
          ...(options.pretty ? ['--pretty'] : []));
        break;
      }
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

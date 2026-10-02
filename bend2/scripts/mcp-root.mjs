#!/usr/bin/env node
// Bend2 Channels MCP root adapter.
//
// A minimal MCP server bridging the Bend2 coordinator's SQLite database to
// Claude Code's Channels protocol. The root loads it with:
//   --mcp-config <config.json>
//   --dangerously-load-development-channels server:baton-root
//
// Usage: node bend2/scripts/mcp-root.mjs <database-path> [coordinator-executable]
//
// The server reads pending root messages from the coordinator's database and
// delivers them as notifications/claude/channel. Tool calls delegate to the
// coordinator executable for mutations. No npm dependencies; node stdlib only.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const dbPath = process.argv[2] ? resolve(process.argv[2]) : null;
const coordinatorExe = resolve(process.argv[3] || resolve(ROOT, '.scratch/bend2/baton2'));

if (!dbPath) {
  process.stderr.write('usage: mcp-root.mjs <database-path> [coordinator-executable]\n');
  process.exit(1);
}

// The report writer calls this one-shot client for the attached channel endpoint.
if (process.argv[4] === '--deliver') {
  const socketName = process.argv[5];
  const messageId = process.argv[6];
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
      process.stderr.write(`mcp-root: parse error: ${error.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  deliveryServer?.close();
  if (db) { try { db.close(); } catch {} db = null; }
});

// Coordinator CLI helper.
function coord(...args) {
  return execFileSync(coordinatorExe, [dbPath, ...args], {
    encoding: 'utf8', timeout: 10000,
  }).trim();
}

// Tool definitions exposed to the root session.
const TOOLS = [
  {
    name: 'baton2_status',
    description: 'Show all coordinator sessions and their pending message counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_inbox',
    description: 'Show pending unacknowledged messages for the root.',
    inputSchema: {
      type: 'object',
      properties: { recipient: { type: 'string', description: 'Session ID (default: root)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_ack',
    description: 'Acknowledge delivery of a message to the root.',
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
        worker: { type: 'string', description: 'Player session ID' },
        body: { type: 'string', description: 'Guidance text' },
      },
      required: ['id', 'worker', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_worker_status',
    description: 'Show a player\'s Git worktree state (branch, commit, dirty).',
    inputSchema: {
      type: 'object',
      properties: { worker: { type: 'string', description: 'Player session ID' } },
      required: ['worker'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land',
    description: 'Land a player\'s committed changes onto a target branch (fast-forward only).',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
      },
      required: ['worker', 'repo', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land_checked',
    description: 'Land a player\'s changes onto a target branch with a check script gate.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Player session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
        check: { type: 'string', description: 'Check script path' },
        files: { type: 'string', description: 'Space-separated list of files to check' },
      },
      required: ['worker', 'repo', 'target', 'check', 'files'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_workers',
    description: 'List all players with their harness, route, workspace, latest report and pending message count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_turns',
    description: 'List all turns for a player with event type, report body and receipt status.',
    inputSchema: {
      type: 'object',
      properties: { worker: { type: 'string', description: 'Player session ID' } },
      required: ['worker'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_pending',
    description: 'List all undelivered messages with their recipients\' current native endpoints.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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

function pendingRootMessages(messageId = null) {
  const conn = openDb();
  if (!conn) return [];
  try {
    const rows = conn.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.id = 'root' AND s.parent IS NULL AND m.receipt IS NULL
         AND (? IS NULL OR m.id = ?)
       ORDER BY m.seq`
    ).all(messageId, messageId);
    return rows;
  } catch (e) {
    return [];
  }
}

function notifyPending(messageId = null) {
  if (!channelReady) return;
  const messages = pendingRootMessages(messageId);
  const newMessages = messages.filter((m) => !notifiedSeqs.has(m.seq));
  if (newMessages.length === 0) return;

  for (const m of newMessages) {
    notifiedSeqs.add(m.seq);
  }

  const content = newMessages.map((m) => {
    const prefix = m.kind === 'report' ? 'Worker report' : `Message (${m.kind})`;
    return `${prefix} from ${m.sender} [id: ${m.id}]:\n${m.body}`;
  }).join('\n\n---\n\n');

  sendNotification('notifications/claude/channel', {
    content,
    meta: { recipient: 'root', messageIds: JSON.stringify(newMessages.map((m) => m.id)) },
  });
}

async function startDelivery() {
  const database = resolve(dbPath);
  const coordinator = resolve(coordinatorExe);
  const socketName = `root-${process.pid}.sock`;
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
    client.on('error', (error) => process.stderr.write(`mcp-root: ${error.message}\n`));
  });
  await new Promise((ready, fail) => {
    deliveryServer.once('error', fail);
    deliveryServer.listen(socketName, ready);
  });
  const endpoint = JSON.stringify([
    process.execPath, fileURLToPath(import.meta.url), database, coordinator,
    '--deliver', socketName,
  ]);
  let existing;
  try { existing = pendingRootSession(); } catch {}
  coord('attach', 'root', 'claude-code', existing?.native || '', endpoint);
}

function pendingRootSession() {
  return openDb()?.prepare("SELECT native FROM sessions WHERE id='root'").get();
}

// MCP message handler.
function handleMessage(msg) {
  if (msg.id === 'root-channel-ready' && msg.result !== undefined) {
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
      serverInfo: { name: 'baton-root', version: '0.1.0' },
      instructions: 'Baton Principal Conductor attachment. Use baton2_inbox or baton2_pending to see pending messages. Use baton2_ack to acknowledge delivery. Use baton2_guide to direct players. Use baton2_workers to list players and baton2_turns to see a player\'s turn history. Use baton2_land or baton2_land_checked to land a player\'s changes.',
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    deliveryReady = startDelivery();
    deliveryReady.catch((error) => {
      process.stderr.write(`mcp-root: ${error.message}\n`);
      process.exit(1);
    });
    return;
  }

  if (msg.method === 'tools/list') {
    sendResponse(msg.id, { tools: TOOLS });
    // In the native recovery run, replay before the client installed its channel
    // handler was lost. Complete a round trip after discovery before replaying.
    if (!channelReady) deliveryReady?.then(() => {
      writeMessage({ jsonrpc: '2.0', id: 'root-channel-ready', method: 'ping' });
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

function handleToolCall(msg) {
  const { name, arguments: args } = msg.params;
  try {
    let result;
    switch (name) {
      case 'baton2_status':
        result = coord('status');
        break;
      case 'baton2_inbox':
        result = coord('inbox', args?.recipient || 'root');
        break;
      case 'baton2_ack':
        result = coord('ack', args.id, 'root', args.receipt);
        break;
      case 'baton2_guide':
        result = coord('message', args.id, 'root', args.worker, 'guidance', args.body);
        break;
      case 'baton2_worker_status':
        result = coord('worktree', args.worker);
        break;
      case 'baton2_land':
        result = coord('land', args.worker, args.repo, args.target);
        break;
      case 'baton2_land_checked':
        result = coord('land-checked', args.worker, args.repo, args.target, args.check, args.files);
        break;
      case 'baton2_workers':
        result = coord('workers');
        break;
      case 'baton2_turns':
        result = coord('turns', args.worker);
        break;
      case 'baton2_pending':
        result = coord('pending');
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
      content: [{ type: 'text', text: `Error: ${e.stderr || e.message}` }],
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

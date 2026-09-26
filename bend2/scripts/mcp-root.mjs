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

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const dbPath = process.argv[2];
const coordinatorExe = process.argv[3] || resolve(ROOT, '.scratch/bend2/baton2');

if (!dbPath) {
  process.stderr.write('usage: mcp-root.mjs <database-path> [coordinator-executable]\n');
  process.exit(1);
}

// node:sqlite (Node 22+)
const { DatabaseSync } = await import('node:sqlite');

// JSON-RPC framing over stdio (Content-Length delimited, per MCP spec).
function writeMessage(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
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

// Read Content-Length delimited messages from stdin.
let inputBuffer = Buffer.alloc(0);
let contentLength = -1;

function processInput() {
  while (true) {
    if (contentLength === -1) {
      const headerEnd = inputBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = inputBuffer.subarray(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        continue;
      }
      contentLength = parseInt(match[1], 10);
      inputBuffer = inputBuffer.subarray(headerEnd + 4);
    }
    if (inputBuffer.length < contentLength) return;
    const body = inputBuffer.subarray(0, contentLength).toString();
    inputBuffer = inputBuffer.subarray(contentLength);
    contentLength = -1;
    try {
      handleMessage(JSON.parse(body));
    } catch (e) {
      process.stderr.write(`mcp-root: parse error: ${e.message}\n`);
    }
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processInput();
});

process.stdin.on('end', () => {
  clearInterval(pollTimer);
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
    description: 'Send guidance to a worker through the coordinator.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message ID (unique)' },
        worker: { type: 'string', description: 'Worker session ID' },
        body: { type: 'string', description: 'Guidance text' },
      },
      required: ['id', 'worker', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_worker_status',
    description: 'Show a worker\'s Git worktree state (branch, commit, dirty).',
    inputSchema: {
      type: 'object',
      properties: { worker: { type: 'string', description: 'Worker session ID' } },
      required: ['worker'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land',
    description: 'Land a worker\'s committed changes onto a target branch (fast-forward only).',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker session ID' },
        repo: { type: 'string', description: 'Repository path' },
        target: { type: 'string', description: 'Target branch name' },
      },
      required: ['worker', 'repo', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'baton2_land_checked',
    description: 'Land a worker\'s changes onto a target branch with a check script gate.',
    inputSchema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Worker session ID' },
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
    description: 'List all workers with their harness, route, workspace, latest report and pending message count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'baton2_turns',
    description: 'List all turns for a worker with event type, report body and receipt status.',
    inputSchema: {
      type: 'object',
      properties: { worker: { type: 'string', description: 'Worker session ID' } },
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
let rootSessionId = null;
let initialized = false;
let notifiedSeqs = new Set();
let pollTimer = null;
let db = null;

function openDb() {
  if (db) return db;
  if (!existsSync(dbPath)) return null;
  db = new DatabaseSync(dbPath, { open: true, readOnly: true });
  return db;
}

function pendingRootMessages() {
  const conn = openDb();
  if (!conn) return [];
  try {
    const rows = conn.prepare(
      `SELECT m.seq, m.id, m.sender, m.kind, m.body
       FROM messages m
       JOIN sessions s ON s.id = m.recipient
       WHERE s.parent IS NULL AND m.receipt IS NULL
       ORDER BY m.seq`
    ).all();
    return rows;
  } catch (e) {
    return [];
  }
}

function pollAndNotify() {
  const messages = pendingRootMessages();
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
    meta: { recipient: 'root', messageIds: newMessages.map((m) => m.id) },
  });
}

function startPolling() {
  pollAndNotify();
  pollTimer = setInterval(pollAndNotify, 2000);
}

// MCP message handler.
function handleMessage(msg) {
  if (msg.method === 'initialize') {
    sendResponse(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        experimental: { 'claude/channel': {} },
      },
      serverInfo: { name: 'baton-root', version: '0.1.0' },
      instructions: 'Bend2 coordinator root attachment. Use baton2_inbox or baton2_pending to see pending messages. Use baton2_ack to acknowledge delivery. Use baton2_guide to direct workers. Use baton2_workers to list workers and baton2_turns to see a worker\'s turn history. Use baton2_land or baton2_land_checked to land a worker\'s changes.',
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    initialized = true;
    startPolling();
    return;
  }

  if (msg.method === 'tools/list') {
    sendResponse(msg.id, { tools: TOOLS });
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
  clearInterval(pollTimer);
  db?.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(pollTimer);
  db?.close();
  process.exit(0);
});

#!/usr/bin/env node
// MCP channel server for the Bend2 coordinator.
//
// Watches the coordinator's SQLite database for pending messages addressed to
// the root session and delivers them as notifications/claude/channel, the
// documented Claude Code development-channel mechanism (#592).
//
// Usage:
//   node mcp-coordinator-channel.mjs DB_PATH ROOT_SESSION_ID [BATON2_PATH]
//
// Register in --mcp-config and enable with
//   --dangerously-load-development-channels server:<name>
//
// The coordinator binary (baton2) must be built first:
//   bash bend2/scripts/build-native.sh

import { execFileSync } from 'node:child_process';

const [dbPath, rootSessionId, baton2Path = '.scratch/bend2/baton2'] = process.argv.slice(2);
if (!dbPath || !rootSessionId) {
  process.stderr.write(
    'usage: mcp-coordinator-channel.mjs DB_PATH ROOT_SESSION_ID [BATON2_PATH]\n',
  );
  process.exit(1);
}

const POLL_INTERVAL_MS = 2000;

let pollTimer = null;
const deliveredIds = new Set();

function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function sendResponse(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendNotification(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function queryInbox() {
  try {
    const output = execFileSync(baton2Path, [dbPath, 'inbox', rootSessionId], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return JSON.parse(output.trim());
  } catch {
    return [];
  }
}

function ackMessage(messageId) {
  try {
    execFileSync(baton2Path, [dbPath, 'ack', messageId, rootSessionId, 'channel-delivered'], {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    process.stderr.write(`ack failed for ${messageId}: ${err.message}\n`);
  }
}

function pollForReports() {
  const items = queryInbox();
  if (items.length === 0) return;

  const newItems = items.filter((item) => !deliveredIds.has(item.id));
  if (newItems.length === 0) return;

  const content = newItems
    .map((item) => {
      const lines = [`${item.kind} from ${item.sender}`];
      if (item.body) lines.push(item.body);
      lines.push(`message-id: ${item.id}`);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');

  sendNotification('notifications/claude/channel', {
    content,
    meta: { recipient: 'root' },
  });

  for (const item of newItems) {
    deliveredIds.add(item.id);
    ackMessage(item.id);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollForReports();
  pollTimer = setInterval(pollForReports, POLL_INTERVAL_MS);
}

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    sendResponse(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        experimental: { 'claude/channel': {} },
      },
      serverInfo: { name: 'baton2-coordinator-channel', version: '0.1.0' },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') {
    startPolling();
    return;
  }

  if (msg.method === 'ping') {
    sendResponse(msg.id, {});
    return;
  }

  if (msg.id !== undefined) {
    if (msg.method === 'tools/list') {
      sendResponse(msg.id, { tools: [] });
    } else if (msg.method === 'resources/list') {
      sendResponse(msg.id, { resources: [] });
    } else if (msg.method === 'prompts/list') {
      sendResponse(msg.id, { prompts: [] });
    } else {
      sendError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }
}

let buffer = '';
let contentLength = -1;

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    if (contentLength === -1) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      contentLength = parseInt(match[1], 10);
      buffer = buffer.slice(headerEnd + 4);
    }
    if (buffer.length < contentLength) break;
    const body = buffer.slice(0, contentLength);
    buffer = buffer.slice(contentLength);
    contentLength = -1;
    try {
      handleMessage(JSON.parse(body));
    } catch (err) {
      process.stderr.write(`parse error: ${err.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  if (pollTimer) clearInterval(pollTimer);
  process.exit(0);
});

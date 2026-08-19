#!/usr/bin/env node
// fake-claude-429.mjs — death-certs red-suite fixture (#225): a fake `claude` binary that
// surfaces a provider rate-limit observation on the wire — a stream-json `rate_limit_event`
// frame carrying HTTP status 429 (the adapter-surfaced provider 429 kill) — writes one stderr
// line, then exits 1. Zero quota, no vendor CLI.
//
// Protocol: same framing contract as fake-claude.mjs (JSONL on stdout, real INPUT shapes on
// stdin). Reacts to the FIRST user frame only: emit system/init (the wire session identity),
// emit the provider 429 observation, write a forensic stderr line, and die.
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let frame;
  try { frame = JSON.parse(trimmed); } catch { return; }
  if (frame.type !== 'user') return;
  // The wire identity the adapter's lifecycle.spawned promotes (sessionId present => ready).
  write({ type: 'system', subtype: 'init', session_id: 'sess-429-fixture', model: 'claude-fake-429' });
  // The provider failure observation: HTTP status class 4xx on the last failed request.
  write({ type: 'rate_limit_event', rate_limit: { status: 429, limit_type: 'requests' } });
  process.stderr.write('fake-claude-429: provider rate limit observed (HTTP 429), aborting\n');
  process.exit(1);
});

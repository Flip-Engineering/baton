#!/usr/bin/env node
// Deterministic Issue #11 refresh fixture. Node's test discovery executes fixture .mjs files;
// stay inert unless invoked through the refresh runtime's Claude-shaped argv.
if (!process.argv.includes('--output-format') || !process.env.CLAUDE_CONFIG_DIR) process.exit(0);

const { readFileSync, writeFileSync } = await import('node:fs');
const { dirname, join } = await import('node:path');

const path = join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json');
const value = JSON.parse(readFileSync(path, 'utf8'));
const oauth = value.claudeAiOauth;
const countPath = join(dirname(process.env.CLAUDE_CONFIG_DIR), 'fixture-spawns');
let count = 0;
try { count = Number.parseInt(readFileSync(countPath, 'utf8'), 10) || 0; } catch {}
writeFileSync(countPath, String(count + 1));
value.claudeAiOauth = {
  ...oauth,
  accessToken: 'access-9000',
  refreshToken: 'refresh-9000',
  expiresAt: 9_000,
  refreshTokenExpiresAt: 1_009_000,
};
writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ type: 'result', is_error: false, result: 'ok' })}\n`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ACTIVE_LINE, ANCHOR, PINNED_SHA256, REPORT_FILE, bunOptions, check, fileContains, preloadOption, sha256File,
} from '../scripts/agent-summary-check.mjs';

const SCRIPTS = resolve(new URL('../scripts/', import.meta.url).pathname);
const PRELOAD = join(SCRIPTS, 'no-agent-summary.js');
const CHECK = join(SCRIPTS, 'agent-summary-check.mjs');

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-summary-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

// A stand-in for the Claude Code binary: with `loads`, it behaves as a Bun process that
// loads the preload named by BUN_OPTIONS and logs the way the preload does.
function fakeClaude(directory, { anchor = true, loads = true } = {}) {
  return executable(join(directory, anchor ? 'claude' : 'claude-without-anchor'), `#!/bin/sh
# ${anchor ? ANCHOR : 'no timer text here'}
${loads ? `case "$BUN_OPTIONS" in
  *--preload=*) [ -n "$CC_AGENT_SUMMARY_LOG" ] && printf '%s\\n' '2026-10-29T00:00:00.000Z pid=1 ${ACTIVE_LINE} bun=fixture hooked=global.setTimeout' >> "$CC_AGENT_SUMMARY_LOG" ;;
esac` : ''}
echo 2.1.312
`);
}

test('the shipped preload is the reviewed revision', () => {
  assert.equal(sha256File(PRELOAD), PINNED_SHA256);
  assert.equal(PINNED_SHA256, 'f95df896a998653ee86e7320ae9a29a547add4addd50cf631491dffaa6040b40');
});

test('BUN_OPTIONS names the preload in the = form after any inherited options', () => {
  assert.equal(preloadOption('/p/no-agent-summary.js'), '--preload=/p/no-agent-summary.js');
  assert.equal(bunOptions(undefined, '/p/x.js'), '--preload=/p/x.js');
  assert.equal(bunOptions('', '/p/x.js'), '--preload=/p/x.js');
  assert.equal(bunOptions('--smol', '/p/x.js'), '--smol --preload=/p/x.js');
});

test('a Claude Code binary that carries the anchor and loads the preload passes', (t) => {
  const claude = fakeClaude(scratch(t));
  const report = check({ claude, preload: PRELOAD });
  assert.deepEqual(report.findings, []);
  assert.equal(report.ok, true);
  assert.equal(report.claude.anchor, true);
  assert.equal(report.preload.loaded, true);
  assert.equal(report.preload.sha256, PINNED_SHA256);
});

test('the check reports a missing anchor', (t) => {
  const claude = fakeClaude(scratch(t), { anchor: false });
  const report = check({ claude, preload: PRELOAD });
  assert.equal(report.ok, false);
  assert.deepEqual(report.findings.map((finding) => finding.code), ['anchor-missing']);
  assert.match(report.findings[0].detail, /\[AgentSummary\] Timer fired/);
  assert.equal(report.preload.loaded, true);
});

test('the check reports a preload that Claude Code did not load', (t) => {
  const directory = scratch(t);
  const claude = fakeClaude(directory, { loads: false });
  const report = check({ claude, preload: PRELOAD });
  assert.deepEqual(report.findings.map((finding) => finding.code), ['preload-not-loaded']);
  assert.match(report.findings[0].detail, /the log was empty/);
});

test('the check reports a changed preload and an unreadable preload', (t) => {
  const directory = scratch(t);
  const claude = fakeClaude(directory);
  const changed = join(directory, 'changed.js');
  writeFileSync(changed, `${readFileSync(PRELOAD, 'utf8')}\n// edited\n`);
  assert.deepEqual(check({ claude, preload: changed }).findings.map((finding) => finding.code), ['preload-digest']);
  const missing = check({ claude, preload: join(directory, 'absent.js') });
  assert.deepEqual(missing.findings.map((finding) => finding.code), ['preload-unreadable']);
  assert.equal(missing.preload.loaded, null);
});

test('the check reports a Claude Code command that does not resolve', (t) => {
  const report = check({ claude: join(scratch(t), 'absent'), preload: PRELOAD });
  assert.deepEqual(report.findings.map((finding) => finding.code), ['claude-unreadable']);
});

test('a command name resolves through PATH', (t) => {
  const directory = scratch(t);
  fakeClaude(directory);
  const report = check({ claude: 'claude', preload: PRELOAD, env: { ...process.env, PATH: directory } });
  assert.equal(report.ok, true);
});

test('the anchor is found across a block boundary and at the end of a file', (t) => {
  const directory = scratch(t);
  const block = 1024 * 1024;
  for (const offset of [block - 5, block, block - ANCHOR.length, 7]) {
    const path = join(directory, `file-${offset}`);
    writeFileSync(path, Buffer.concat([Buffer.alloc(offset, 0x61), Buffer.from(ANCHOR), Buffer.alloc(3 * block, 0x62)]));
    assert.equal(fileContains(path, ANCHOR), true, `offset ${offset}`);
  }
  const tail = join(directory, 'tail');
  writeFileSync(tail, Buffer.concat([Buffer.alloc(2 * block + 11, 0x61), Buffer.from(ANCHOR)]));
  assert.equal(fileContains(tail, ANCHOR), true);
  const absent = join(directory, 'absent');
  writeFileSync(absent, Buffer.concat([Buffer.alloc(2 * block, 0x61), Buffer.from(ANCHOR.slice(0, -1))]));
  assert.equal(fileContains(absent, ANCHOR), false);
});

test('doctor prints the report and exits 0 on a pass, 1 on a finding, 2 on a usage error', (t) => {
  const directory = scratch(t);
  const good = spawnSync(process.execPath, [CHECK, 'doctor', '--claude', fakeClaude(directory), '--preload', PRELOAD], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).ok, true);
  const bad = spawnSync(process.execPath, [CHECK, 'doctor', '--claude', fakeClaude(directory, { anchor: false }), '--preload', PRELOAD], { encoding: 'utf8' });
  assert.equal(bad.status, 1, bad.stderr);
  assert.equal(JSON.parse(bad.stdout).findings[0].code, 'anchor-missing');
  const usage = spawnSync(process.execPath, [CHECK, 'unknown'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('doctor without --claude checks the claude found on PATH', (t) => {
  const directory = scratch(t);
  fakeClaude(directory);
  const run = spawnSync(process.execPath, [CHECK, 'doctor', '--preload', PRELOAD], { encoding: 'utf8', env: { ...process.env, PATH: directory } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).claude.path, join(directory, 'claude'));
  const absent = spawnSync(process.execPath, [CHECK, 'doctor', '--preload', PRELOAD], { encoding: 'utf8', env: { ...process.env, PATH: scratch(t) } });
  assert.equal(absent.status, 1);
  assert.equal(JSON.parse(absent.stdout).findings[0].code, 'claude-unreadable');
});

test('doctor --help prints the usage and exits 0', () => {
  const help = spawnSync(process.execPath, [CHECK, 'doctor', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: baton doctor/);
});

async function waitUntil(description, condition) {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.ok(condition(), `${description} did not happen`);
}

// A stand-in for the Baton CLI. `knowledge record` stores the claim; `knowledge read` returns
// the stored claims in the wrapper format of the real command. Every call is logged.
function fakeCoordinator(directory) {
  const calls = join(directory, 'calls.jsonl');
  const store = join(directory, 'claims.json');
  const path = executable(join(directory, 'baton'), `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
const claims = () => (fs.existsSync(${JSON.stringify(store)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(store)}, 'utf8')) : []);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ argv, database: process.env.BATON_DATABASE, session: process.env.BATON_SESSION }) + '\\n');
if (argv[1] === 'read') {
  process.stdout.write(JSON.stringify([{ index: 0, action: 'knowledge-read', stdout: JSON.stringify(claims().map((claim) => ({ claim }))) }]));
} else if (argv[1] === 'record') {
  fs.writeFileSync(${JSON.stringify(store)}, JSON.stringify([...claims(), argv[argv.indexOf('--claim') + 1]]));
}
`);
  const logged = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { path, logged, records: () => logged().filter((call) => call.argv[1] === 'record'), reads: () => logged().filter((call) => call.argv[1] === 'read') };
}

function seatStart(directory, attempt, claude, coordinator) {
  const started = spawnSync(process.execPath, [CHECK, 'seat-start', '--claude', claude, '--directory', attempt,
    '--preload', PRELOAD, '--database', '/state/orchestra.db', '--session', 'seat-1', '--coordinator', coordinator.path], { encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
}

test('seat-start returns at once, writes the report and records each finding on the seat', async (t) => {
  const directory = scratch(t);
  const attempt = join(directory, 'attempt');
  mkdirSync(attempt);
  const coordinator = fakeCoordinator(directory);
  seatStart(directory, attempt, fakeClaude(directory, { anchor: false }), coordinator);
  const reported = join(attempt, REPORT_FILE);
  await waitUntil('the report', () => existsSync(reported));
  await waitUntil('the finding', () => coordinator.records().length === 1);
  const report = JSON.parse(readFileSync(reported, 'utf8'));
  assert.deepEqual(report.findings.map((finding) => finding.code), ['anchor-missing']);
  const [recorded] = coordinator.records();
  assert.deepEqual(recorded.argv.slice(0, 5), ['knowledge', 'record', '--kind', 'finding', '--claim']);
  assert.match(recorded.argv[5], /anchor-missing/);
  assert.equal(recorded.database, '/state/orchestra.db');
  assert.equal(recorded.session, 'seat-1');
});

test('a failure that persists across launches is recorded once', async (t) => {
  const directory = scratch(t);
  const attempt = join(directory, 'attempt');
  mkdirSync(attempt);
  const coordinator = fakeCoordinator(directory);
  const claude = fakeClaude(directory, { anchor: false });
  seatStart(directory, attempt, claude, coordinator);
  await waitUntil('the first finding', () => coordinator.records().length === 1);
  seatStart(directory, attempt, claude, coordinator);
  await waitUntil('the second check to read the seat findings', () => coordinator.reads().length === 2);
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(coordinator.records().length, 1);
});

test('seat-start records a finding when the attempt directory does not exist', async (t) => {
  const directory = scratch(t);
  const coordinator = fakeCoordinator(directory);
  seatStart(directory, join(directory, 'absent'), fakeClaude(directory, { anchor: false }), coordinator);
  await waitUntil('the finding', () => coordinator.records().length === 1);
});

test('seat-start without an attempt directory records the finding and writes no report', async (t) => {
  const directory = scratch(t);
  const coordinator = fakeCoordinator(directory);
  const started = spawnSync(process.execPath, [CHECK, 'seat-start', '--claude', fakeClaude(directory, { anchor: false }),
    '--preload', PRELOAD, '--database', '/state/orchestra.db', '--session', 'seat-1', '--coordinator', coordinator.path], { encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  await waitUntil('the finding', () => coordinator.records().length === 1);
});

test('seat-start on a passing Claude Code records no finding', async (t) => {
  const directory = scratch(t);
  const attempt = join(directory, 'attempt');
  mkdirSync(attempt);
  const coordinator = fakeCoordinator(directory);
  seatStart(directory, attempt, fakeClaude(directory), coordinator);
  await waitUntil('the report', () => existsSync(join(attempt, REPORT_FILE)));
  assert.equal(JSON.parse(readFileSync(join(attempt, REPORT_FILE), 'utf8')).ok, true);
  assert.deepEqual(coordinator.logged(), []);
});

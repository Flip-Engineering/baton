#!/usr/bin/env node
// Verifies the Claude Code agent_summary preload that Baton adds to every Claude Code
// process it launches (#1338). The preload is no-agent-summary.js, revision 4f1ad563 of
// https://gist.github.com/flamerix-ai/c3905705cc4205e5de3011fa2e74efce (MIT), pinned by
// SHA-256 below. Baton never fetches it at launch.
//
//   agent-summary-check.mjs doctor --claude PATH [--preload PATH]
//     Prints one JSON report and exits 0 when every check passes, 1 when a check reports
//     a finding, 2 on a usage error.
//   agent-summary-check.mjs seat-start --claude PATH --directory DIR
//         [--preload PATH] [--database DB --session SESSION --coordinator EXECUTABLE]
//     Starts the same checks in a detached process (the internal seat-run mode) and returns
//     at once, so a seat launch never waits for them. The detached process writes
//     DIR/agent-summary-check.json and, for each finding, records one finding on the seat
//     with `knowledge record`.
//
// Checks:
//   1. The preload file is readable and its SHA-256 equals the pinned digest.
//   2. The Claude Code binary contains the anchor the preload matches on.
//   3. Claude Code, started with the launch environment Baton uses, loads the preload:
//      CC_AGENT_SUMMARY_LOG receives "preload active mode=off".
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync,
  statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRELOAD_FILE = 'no-agent-summary.js';
export const PINNED_SHA256 = 'f95df896a998653ee86e7320ae9a29a547add4addd50cf631491dffaa6040b40';
export const ANCHOR = '[AgentSummary] Timer fired';
export const ACTIVE_LINE = 'preload active mode=off';
export const REPORT_FILE = 'agent-summary-check.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCAN_BLOCK = 1024 * 1024;

export function preloadOption(preload) {
  return `--preload=${preload}`;
}

// The launch environment value: the options already present, then the preload.
export function bunOptions(inherited, preload) {
  const option = preloadOption(preload);
  return typeof inherited === 'string' && inherited.length > 0 ? `${inherited} ${option}` : option;
}

export function sha256File(path) {
  const digest = createHash('sha256');
  const descriptor = openSync(path, 'r');
  try {
    const block = Buffer.allocUnsafe(SCAN_BLOCK);
    for (let count = readSync(descriptor, block, 0, block.length, null); count > 0;
      count = readSync(descriptor, block, 0, block.length, null)) {
      digest.update(block.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}

// Reads the whole file. The tail of each block is kept so an occurrence that spans two
// blocks is found.
export function fileContains(path, needle) {
  const wanted = Buffer.from(needle);
  const descriptor = openSync(path, 'r');
  try {
    const block = Buffer.allocUnsafe(SCAN_BLOCK + wanted.length);
    let kept = 0;
    for (;;) {
      const count = readSync(descriptor, block, kept, SCAN_BLOCK, null);
      if (count === 0) return false;
      if (block.subarray(0, kept + count).includes(wanted)) return true;
      const tail = Math.min(wanted.length - 1, kept + count);
      block.copy(block, 0, kept + count - tail, kept + count);
      kept = tail;
    }
  } finally {
    closeSync(descriptor);
  }
}

export function resolveCommand(command, env = process.env) {
  const candidates = command.includes('/')
    ? [resolve(command)]
    : (env.PATH ?? '/usr/bin:/bin').split(delimiter).map((directory) => resolve(directory || '.', command));
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch { /* try the next candidate */ }
  }
  return null;
}

// Runs the Claude Code binary with the launch environment and reads the preload's log.
// `claude --version` reaches the Bun runtime, and so the preload, without a model request.
function probe(claude, preload, env, timeoutMs) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-summary-probe-'));
  const log = join(directory, 'preload.log');
  const run = spawnSync(claude, ['--version'], {
    env: { ...env, BUN_OPTIONS: bunOptions(env.BUN_OPTIONS, preload), CC_AGENT_SUMMARY_LOG: log },
    stdio: 'ignore',
    timeout: timeoutMs,
  });
  let text = '';
  try { text = readFileSync(log, 'utf8'); } catch { /* the preload did not write a log */ }
  rmSync(directory, { recursive: true, force: true });
  const lines = text.split('\n').filter((line) => line.length > 0);
  return {
    loaded: lines.some((line) => line.includes(ACTIVE_LINE)),
    lines,
    status: run.status,
    signal: run.signal,
    error: run.error ? run.error.message : null,
  };
}

function describeProbe(result) {
  const how = result.error ? `could not run: ${result.error}`
    : result.signal ? `ended on ${result.signal}`
      : `exited ${result.status}`;
  const seen = result.lines.length > 0 ? `; log: ${result.lines.join(' | ')}` : '; the log was empty';
  return `claude --version ${how}${seen}`;
}

export function check({ claude, preload = join(HERE, PRELOAD_FILE), env = process.env, timeoutMs = 60000 }) {
  const findings = [];
  const report = { claude: { requested: claude, path: null, anchor: null }, preload: { path: preload, sha256: null, loaded: null } };
  let preloadReadable = false;
  try {
    report.preload.sha256 = sha256File(preload);
    preloadReadable = true;
  } catch (error) {
    findings.push({ code: 'preload-unreadable', detail: `${preload}: ${error.message}` });
  }
  if (preloadReadable && report.preload.sha256 !== PINNED_SHA256) {
    findings.push({ code: 'preload-digest', detail: `${preload} has sha256 ${report.preload.sha256}; the pinned digest is ${PINNED_SHA256}` });
  }
  report.claude.path = resolveCommand(claude, env);
  if (report.claude.path === null) {
    findings.push({ code: 'claude-unreadable', detail: `${claude} is not an executable file on PATH` });
  } else {
    try {
      report.claude.anchor = fileContains(report.claude.path, ANCHOR);
      if (!report.claude.anchor) {
        findings.push({ code: 'anchor-missing', detail: `${report.claude.path} does not contain "${ANCHOR}"; this Claude Code release no longer matches the preload` });
      }
    } catch (error) {
      findings.push({ code: 'claude-unreadable', detail: `${report.claude.path}: ${error.message}` });
    }
  }
  if (preloadReadable && report.claude.path !== null) {
    const result = probe(report.claude.path, preload, env, timeoutMs);
    report.preload.loaded = result.loaded;
    if (!result.loaded) {
      findings.push({ code: 'preload-not-loaded', detail: `"${ACTIVE_LINE}" was not logged; ${describeProbe(result)}` });
    }
  }
  return { ok: findings.length === 0, findings, ...report };
}

function recordFinding({ coordinator, database, session, report, finding }) {
  const claim = `Claude Code agent_summary preload check failed at seat start (${finding.code}): ${finding.detail}`;
  const run = spawnSync(coordinator, ['knowledge', 'record', '--kind', 'finding', '--claim', claim,
    '--evidence', JSON.stringify(report)], {
    env: { ...process.env, BATON_DATABASE: database, BATON_SESSION: session },
    encoding: 'utf8',
  });
  return run.status === 0;
}

// Runs in the detached process. The attempt directory can be created after the check
// starts, so a report that cannot be written does not stop the findings from being
// recorded. Findings are recorded when the coordinator, database and session are known.
export function seatCheck({ claude, preload, directory, database, session, coordinator, env = process.env }) {
  const report = check({ claude, ...(preload ? { preload } : {}), env });
  try { writeFileSync(join(directory, REPORT_FILE), `${JSON.stringify(report)}\n`); } catch { /* directory absent */ }
  if (coordinator && database && session) {
    for (const finding of report.findings) recordFinding({ coordinator, database, session, report, finding });
  }
  return report;
}

function parse(argv) {
  const [mode, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    if (!name?.startsWith('--') || index + 1 >= rest.length) throw new Error(`Option ${name} needs a value.`);
    options[name.slice(2)] = rest[index + 1];
  }
  return { mode, options };
}

const USAGE = 'usage: agent-summary-check.mjs doctor --claude PATH [--preload PATH]\n'
  + '       agent-summary-check.mjs seat-start --claude PATH --directory DIR [--preload PATH] [--database DB --session SESSION --coordinator EXECUTABLE]\n';

export function main(argv, env = process.env) {
  let parsed;
  try { parsed = parse(argv); } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 2;
  }
  const { mode, options } = parsed;
  if (mode === 'doctor' && options.claude) {
    const report = check({ claude: options.claude, ...(options.preload ? { preload: options.preload } : {}), env });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report.ok ? 0 : 1;
  }
  if (mode === 'seat-start' && options.claude && options.directory) {
    if (!isAbsolute(options.directory)) {
      process.stderr.write(`--directory must be absolute.\n${USAGE}`);
      return 2;
    }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'seat-run',
      ...Object.entries(options).flatMap(([name, value]) => [`--${name}`, value])],
    { detached: true, stdio: 'ignore', env });
    child.unref();
    return 0;
  }
  if (mode === 'seat-run' && options.claude && options.directory) {
    seatCheck({ ...options, env });
    return 0;
  }
  process.stderr.write(USAGE);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

#!/usr/bin/env node
// The negative control for the tree's law gate. The entry module imports
// bend2/src/coordinator/laws.bend, so a compile of the entry verifies every law
// the module states. This script proves that each law is really verified: for
// every `law` in bend2/src it creates an isolated source workspace, removes
// that law's proof, and requires the entry compile to fail. A removable proof
// that leaves the entry compiling is not part of the gate, and the script reports it.
// the entry still compiles is not part of the gate, and the script reports it.
//
// Usage: node bend2/scripts/laws-check.mjs [compiler]

import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync, createReadStream, existsSync, fsyncSync, linkSync, mkdirSync,
  openSync, readFileSync, readSync, readdirSync, readlinkSync, renameSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { availableParallelism, freemem, hostname, totalmem } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'bend2', 'src');
const ENTRY = join('bend2', 'src', 'coordinator', 'main.bend');
const SCRATCH = join(ROOT, '.scratch', 'bend2-laws-check');
const ENV = { ...process.env, BEND_NO_TELEMETRY: '1' };
const EXCERPT_BYTES = 512;

function resolveBend() {
  const candidates = [
    process.argv[2],
    process.env.BEND,
    join(ROOT, 'node_modules', '.bend', 'bin', 'bend'),
    join(ROOT, '.bend', 'bin', 'bend'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error('Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.');
  process.exit(1);
}

let BEND;

function discover(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...discover(full));
    else if (entry.name.endsWith('.bend')) found.push(full);
  }
  return found.sort();
}

// One row per `law <name>:` in the tree, with the module that states it.
function laws() {
  const rows = [];
  for (const file of discover(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      const match = /^law ([A-Za-z0-9_]+):/.exec(line);
      if (match) rows.push({ law: match[1], file });
    }
  }
  return rows;
}

// Remove the `def <name>(...)` block that proves <name>: the def line and every
// following blank or indented line. Returns false when no such def exists.
function removeProof(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`def ${name}(`));
  if (start === -1) return false;
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  lines.splice(start, end - start);
  writeFileSync(modulePath, lines.join('\n'));
  return true;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(digest.digest('hex')));
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cloneLinkedTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) cloneLinkedTree(from, to);
    else if (entry.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else linkSync(from, to);
  }
}

function detachFile(path) {
  const temporary = `${path}.detached-${randomUUID()}`;
  writeFileSync(temporary, readFileSync(path));
  renameSync(temporary, path);
}

function controlWorkspace(runRoot, id) {
  const cwd = join(runRoot, 'workspaces', hash(id));
  mkdirSync(dirname(cwd), { recursive: true });
  cloneLinkedTree(join(ROOT, 'bend2'), join(cwd, 'bend2'));
  return cwd;
}

function availableMemory() {
  let available = freemem();
  try {
    const mem = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (mem) available = Math.min(available, Number(mem[1]) * 1024);
  } catch {}
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const limit = readFileSync(path, 'utf8').trim();
      if (limit === 'max' || Number(limit) >= Number.MAX_SAFE_INTEGER) continue;
      const currentPath = path.replace(/memory\.max$/, 'memory.current').replace(/memory.limit_in_bytes$/, 'memory.usage_in_bytes');
      const current = Number(readFileSync(currentPath, 'utf8').trim());
      available = Math.min(available, Math.max(0, Number(limit) - current));
      break;
    } catch {}
  }
  return available;
}

function runnerCpuCapacity() {
  let capacity = availableParallelism();
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') capacity = Math.min(capacity, Math.max(1, Math.floor(Number(quota) / Number(period))));
  } catch {}
  return capacity;
}

function peakRss(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+)\s+kB/m);
    if (status) return Number(status[1]) * 1024;
    const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\s+/);
    return Number(statm[1]) * 4096;
  } catch {
    return 0;
  }
}

function excerpt(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const head = Buffer.alloc(Math.min(EXCERPT_BYTES, size));
    const headRead = head.length ? (awaitRead(fd, head, 0)) : 0;
    const tailSize = Math.min(EXCERPT_BYTES, Math.max(0, size - headRead));
    const tail = Buffer.alloc(tailSize);
    const tailRead = tailSize ? awaitRead(fd, tail, size - tailSize) : 0;
    return {
      bytes: size,
      head: head.subarray(0, headRead).toString('utf8'),
      tail: tail.subarray(0, tailRead).toString('utf8'),
      artifact: path,
    };
  } finally {
    closeSync(fd);
  }
}

function awaitRead(fd, buffer, position) {
  // readSync is kept behind this helper so excerpts never enter the scheduler's
  // control flow as complete compiler output.
  return readSync(fd, buffer, 0, buffer.length, position);
}

function runCompiler(args, cwd, stdoutPath, stderrPath) {
  return new Promise((resolveResult) => {
    const stdoutFd = openSync(stdoutPath, 'w');
    const stderrFd = openSync(stderrPath, 'w');
    const child = spawn(BEND, args, { cwd, env: ENV, stdio: ['ignore', stdoutFd, stderrFd] });
    let maxRssBytes = 0;
    let startupError = null;
    const sample = setInterval(() => { maxRssBytes = Math.max(maxRssBytes, peakRss(child.pid)); }, 100);
    child.on('error', (error) => { startupError = `${error.name}: ${error.message}`; });
    child.on('close', (code, signal) => {
      clearInterval(sample);
      maxRssBytes = Math.max(maxRssBytes, peakRss(child.pid));
      fsyncSync(stdoutFd);
      fsyncSync(stderrFd);
      closeSync(stdoutFd);
      closeSync(stderrFd);
      resolveResult({ exitCode: code, signal, startupError, maxRssBytes });
    });
  });
}

async function fileContains(path, needle) {
  const stream = createReadStream(path);
  let carry = '';
  for await (const buffer of stream) {
    const text = carry + buffer.toString('utf8');
    if (text.includes(needle)) return true;
    carry = text.slice(-Math.max(needle.length - 1, 0));
  }
  return false;
}

async function outputMatches(paths, pattern) {
  // Existing controls classify these compiler diagnostics by their complete
  // raw output; streaming keeps large logs outside the scheduler process.
  const needles = pattern === 'proof' ? ['TODO found', 'expected :', 'Error'] : [pattern];
  for (const path of paths) for (const needle of needles) if (await fileContains(path, needle)) return true;
  return false;
}

function sourceIdentity(rows) {
  const paths = new Set(discover(SRC));
  for (const { file } of rows) paths.add(file);
  paths.add(import.meta.filename);
  paths.add(join(ROOT, 'bend2', 'scripts', 'laws-check-scheduler.test.mjs'));
  const records = [...paths].sort().map((path) => ({
    path: relative(ROOT, path),
    sha256: hash(readFileSync(path)),
  }));
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4096 });
  if (revision.status !== 0 || revision.error) throw new Error(`cannot identify source revision: ${revision.error?.message ?? revision.stderr}`);
  return {
    gitRevision: revision.stdout.trim(),
    files: records,
    sha256: hash(stableJson({ gitRevision: revision.stdout.trim(), files: records })),
  };
}

function producer(kind, payload) {
  const id = kind === 'proof'
    ? `proof:${payload.module}:${payload.law}`
    : `mutation:${payload.name}`;
  const descriptor = { id, kind, payload };
  return { ...descriptor, descriptorSha256: hash(stableJson(descriptor)) };
}

export function producerSet(rows, mutations) {
  const controls = [
    ...rows.map(({ law, file }) => producer('proof', { law, module: relative(ROOT, file) })),
    ...mutations.map((mutation) => producer('mutation', mutation)),
  ];
  const ids = controls.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('control producer IDs are not unique');
  return controls;
}

export async function verifyResults(expected, results) {
  const byId = new Map(expected.map((item) => [item.id, item]));
  const seen = new Set();
  const failures = [];
  for (const result of results) {
    const descriptor = byId.get(result.id);
    if (!descriptor) {
      failures.push({ id: result.id, reason: 'unknown producer' });
      continue;
    }
    if (seen.has(result.id)) {
      failures.push({ id: result.id, reason: 'duplicate producer result' });
      continue;
    }
    seen.add(result.id);
    if (result.descriptorSha256 !== descriptor.descriptorSha256) failures.push({ id: result.id, reason: 'altered producer descriptor' });
    if (!descriptor.workToken || result.workToken !== descriptor.workToken) failures.push({ id: result.id, reason: 'execution token mismatch' });
    if (result.completed !== true) failures.push({ id: result.id, reason: 'producer did not complete' });
    if (result.applied !== true) failures.push({ id: result.id, reason: 'producer change was not applied' });
    if (!Number.isInteger(result.exitCode) || result.signal !== null || result.startupError !== null) {
      failures.push({ id: result.id, reason: 'compiler process did not report an ordinary completed exit' });
    } else if (result.exitCode === 0) {
      failures.push({ id: result.id, reason: 'compiler accepted the control' });
    }
    const outputPaths = [];
    for (const stream of ['stdout', 'stderr']) {
      const output = result.outputs?.[stream];
      if (!output?.artifact || !Number.isInteger(output.bytes) || !/^[a-f0-9]{64}$/.test(output.sha256 ?? '')) {
        failures.push({ id: result.id, reason: `missing ${stream} artifact receipt` });
        continue;
      }
      try {
        if (statSync(output.artifact).size !== output.bytes || await hashFile(output.artifact) !== output.sha256) {
          failures.push({ id: result.id, reason: `${stream} artifact changed after completion` });
          continue;
        }
        outputPaths.push(output.artifact);
      } catch {
        failures.push({ id: result.id, reason: `${stream} artifact is unavailable` });
      }
    }
    const expectedDiagnostic = descriptor.kind === 'proof' ? 'proof' : descriptor.payload.law;
    if (outputPaths.length === 2 && !(await outputMatches(outputPaths, expectedDiagnostic))) {
      failures.push({ id: result.id, reason: 'compiler output does not contain the producer diagnostic' });
    }
    if (result.passed !== true) failures.push({ id: result.id, reason: 'control failed' });
  }
  for (const descriptor of expected) if (!seen.has(descriptor.id)) failures.push({ id: descriptor.id, reason: 'producer result omitted' });
  return failures;
}

export function concurrencyFor({ cpuCapacity, memoryAvailableBytes, memoryEstimateBytes, runnerCapacity }) {
  const configuredCapacity = Number.isInteger(runnerCapacity) && runnerCapacity > 0 ? runnerCapacity : Infinity;
  const memoryCapacity = Math.floor(memoryAvailableBytes / Math.max(memoryEstimateBytes, 1));
  return {
    admitted: Math.max(1, Math.min(cpuCapacity, configuredCapacity, memoryCapacity)),
    cpuCapacity,
    memoryAvailableBytes,
    memoryEstimateBytes,
    memoryCapacity,
    totalMemoryBytes: totalmem(),
    runnerCapacity: Number.isFinite(configuredCapacity) ? configuredCapacity : null,
  };
}

function admittedConcurrency(memoryEstimateBytes) {
  return concurrencyFor({
    cpuCapacity: runnerCpuCapacity(),
    memoryAvailableBytes: availableMemory(),
    memoryEstimateBytes,
    runnerCapacity: Number(process.env.BATON_LAW_CHECK_RUNNER_CAPACITY),
  });
}

async function runControl(control, runRoot) {
  const cwd = controlWorkspace(runRoot, control.id);
  const artifactRoot = join(runRoot, 'artifacts', hash(control.id));
  mkdirSync(artifactRoot, { recursive: true });
  const stdoutPath = join(artifactRoot, 'stdout.log');
  const stderrPath = join(artifactRoot, 'stderr.log');
  const copied = join(cwd, control.kind === 'proof' ? control.payload.module : control.payload.file);
  detachFile(copied);
  let applied;
  if (control.kind === 'proof') applied = removeProof(copied, control.payload.law);
  else {
    const text = readFileSync(copied, 'utf8');
    applied = text.includes(control.payload.find);
    if (applied) writeFileSync(copied, text.replace(control.payload.find, control.payload.replace));
  }
  const startedAt = new Date().toISOString();
  const started = process.hrtime.bigint();
  const outcome = applied
    ? await runCompiler([ENTRY, '--check-only'], cwd, stdoutPath, stderrPath)
    : { exitCode: null, signal: null, startupError: null, maxRssBytes: 0 };
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  let rejectedForExpectedReason = false;
  if (applied && outcome.exitCode !== null && outcome.signal === null && outcome.startupError === null) {
    rejectedForExpectedReason = control.kind === 'proof'
      ? await outputMatches([stdoutPath, stderrPath], 'proof')
      : await outputMatches([stdoutPath, stderrPath], control.payload.law);
  }
  const completed = applied && outcome.exitCode !== null && outcome.signal === null && outcome.startupError === null;
  const passed = completed && outcome.exitCode !== 0 && rejectedForExpectedReason;
  const outputs = applied ? {
    stdout: { ...(await excerpt(stdoutPath)), sha256: await hashFile(stdoutPath) },
    stderr: { ...(await excerpt(stderrPath)), sha256: await hashFile(stderrPath) },
  } : null;
  return {
    id: control.id,
    kind: control.kind,
    descriptorSha256: control.descriptorSha256,
    workToken: control.workToken,
    completed,
    passed,
    applied,
    startedAt,
    elapsedMs,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    startupError: outcome.startupError,
    peakRssBytes: outcome.maxRssBytes,
    outputs,
  };
}

async function runPool(controls, concurrency, runRoot) {
  const results = new Array(controls.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= controls.length) return;
      try {
        results[index] = await runControl(controls[index], runRoot);
      } catch (error) {
        results[index] = {
          id: controls[index].id,
          descriptorSha256: controls[index].descriptorSha256,
          completed: false,
          passed: false,
          workerError: `${error.name}: ${error.message}`,
        };
      }
      const row = results[index];
      console.log(JSON.stringify({
        requestId: process.env.BATON2_GATE_REQUEST ?? null,
        job: process.env.BATON2_GATE_JOB ?? null,
        producerId: row.id,
        producerSha256: row.descriptorSha256,
        workToken: row.workToken,
        id: row.id,
        kind: row.kind,
        name: controls[index].kind === 'proof' ? controls[index].payload.law : controls[index].payload.name,
        law: controls[index].payload.law,
        module: controls[index].kind === 'proof' ? controls[index].payload.module : controls[index].payload.file,
        mutation: controls[index].kind === 'mutation' ? controls[index].payload.name : undefined,
        proof: controls[index].kind === 'proof' ? (row.applied ? 'removed' : 'missing') : undefined,
        gate: row.passed ? 'refuses' : 'accepts',
        passed: row.passed,
        completed: row.completed,
        applied: row.applied,
        exitCode: row.exitCode,
        signal: row.signal,
        startupError: row.startupError,
        elapsedMs: row.elapsedMs,
        peakRssBytes: row.peakRssBytes,
        stdout: row.outputs?.stdout && { bytes: row.outputs.stdout.bytes, sha256: row.outputs.stdout.sha256, artifact: row.outputs.stdout.artifact },
        stderr: row.outputs?.stderr && { bytes: row.outputs.stderr.bytes, sha256: row.outputs.stderr.sha256, artifact: row.outputs.stderr.artifact },
        excerpts: row.passed ? undefined : {
          stdout: row.outputs?.stdout && { head: row.outputs.stdout.head, tail: row.outputs.stdout.tail },
          stderr: row.outputs?.stderr && { head: row.outputs.stderr.head, tail: row.outputs.stderr.tail },
        },
        workerError: row.workerError,
      }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, controls.length) }, () => worker()));
  return results;
}

// A mutation is a deliberate change to an implementation, made in the scratch
// copy, that a law must refuse. The proof-removal loop above shows every law's
// proof is required; these controls show that a law's right-hand side is not
// the function under test, so that changing the function breaks the proof. A
// mutation that still compiles means the law it names does not bind the code
// it claims to bind, and it is reported as a failure.
const MUTATIONS = [
  {"name": "adopted-dead-attempt-keeps-old-cutoff", "find": "        Bool.pick(String,Bool.and(String.eq(status,\"unknown after keeper loss\"),Bool.and(String.is_empty(event),String.is_empty(error))),\"0\",cursor)", "replace": "        cursor", "law": "adopted_unknown_attempt_replays_the_retained_inbox", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "fresh-attempt-replays-old-input", "find": "    case False{}: cursor", "replace": "    case False{}: \"0\"", "law": "fresh_attempt_preserves_its_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "adopted-known-failure-replays-old-input", "find": "      case Turn.Ended{status,event,error}:\n        Bool.pick(String,Bool.and(String.eq(status,\"unknown after keeper loss\"),Bool.and(String.is_empty(event),String.is_empty(error))),\"0\",cursor)", "replace": "      case Turn.Ended{+status,event,error}:\n        Bool.pick(String,Bool.and(Bool.or(String.eq(status,\"unknown after keeper loss\"),String.eq(status,\"exit 1\")),Bool.and(String.is_empty(event),String.is_empty(error))),\"0\",cursor)", "law": "adopted_known_native_failure_preserves_its_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "adopted-terminal-attempt-replays-old-input", "find": "Bool.and(String.is_empty(event),String.is_empty(error))", "replace": "String.is_empty(error)", "law": "adopted_terminal_result_preserves_its_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "adopted-read-error-replays-old-input", "find": "Bool.and(String.is_empty(event),String.is_empty(error))", "replace": "String.is_empty(event)", "law": "adopted_observation_error_preserves_its_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "retained-observation-skips-reconciled-cutoff", "find": "observed(db,session,id,log,reconciled_cursor(cursor,adopted,current),native,cwd,attempt,handle,lock,current,deliveries,again)", "replace": "observed(db,session,id,log,cursor,native,cwd,attempt,handle,lock,current,deliveries,again)", "law": "retained_observation_uses_the_reconciled_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "new-process-marks-observation-adopted", "find": "observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,False{})", "replace": "observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,True{})", "law": "newly_started_process_uses_fresh_observation", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "recorded-owner-marks-observation-fresh", "find": "observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},again,True{})", "replace": "observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},again,False{})", "law": "recorded_owner_uses_adopted_observation", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "guarded-observation-discards-adopted-origin", "find": "observed_output(db,session,id,log,cursor,native,cwd,directory,handle,lock,observation,again,adopted)", "replace": "observed_output(db,session,id,log,cursor,native,cwd,directory,handle,lock,observation,again,False{})", "law": "guarded_observation_preserves_its_adopted_origin", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "keeper-recovery-marks-observation-adopted", "find": "observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,False{})", "replace": "observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,True{})", "law": "keeper_recovery_preserves_the_original_input_cursor", "file": "bend2/src/coordinator/receive.bend"},
  {"name": "help-word-is-refused", "file": "bend2/src/coordinator/commands.bend", "find": "Bool.or(String.eq(verb,\"help\"),String.eq(verb,\"--help\"))", "replace": "Bool.or(String.eq(verb,\"help-denied\"),String.eq(verb,\"--help\"))", "law": "help_word_selects_the_help_command"},
  {"name": "help-flag-is-refused", "file": "bend2/src/coordinator/commands.bend", "find": "Bool.or(String.eq(verb,\"help\"),String.eq(verb,\"--help\"))", "replace": "Bool.or(String.eq(verb,\"help\"),String.eq(verb,\"--help-denied\"))", "law": "help_flag_selects_the_help_command"},
  {"name": "help-enters-the-store", "file": "bend2/src/coordinator/main.bend", "find": "case C.Help{}: IO.write(usage())", "replace": "case C.Help{}: run(db,C.Help{})", "law": "help_prints_product_usage_without_database_effects"},
  {"name": "bare-help-is-refused", "file": "bend2/src/coordinator/main.bend", "find": "Bool.pick(IO(Unit),C.help_verb(verb),execute(\"\",C.Help{}),execute(verb,C.Invalid{}))", "replace": "Bool.pick(IO(Unit),False{},execute(\"\",C.Help{}),execute(verb,C.Invalid{}))", "law": "bare_help_word_selects_help_without_a_database"},
  {"name": "invalid-command-succeeds", "file": "bend2/src/coordinator/main.bend", "find": "case C.Invalid{}: IO.die(Unit,2,usage())", "replace": "case C.Invalid{}: IO.die(Unit,0,usage())", "law": "invalid_command_refuses_with_the_same_usage"},
  {"name": "message-parser-discards-body", "file": "bend2/src/coordinator/commands.bend", "find": "String.eq(verb,\"message\"),Message{id,one,two,three,four}", "replace": "String.eq(verb,\"message\"),Message{id,one,two,three,\"\"}", "law": "message_parser_preserves_the_complete_body"},
  {"name": "database-command-loses-database", "file": "bend2/src/coordinator/main.bend", "find": "case db <> rest: execute(db,C.parse(rest))", "replace": "case db <> rest: execute(\"\",C.parse(rest))", "law": "database_cli_passes_the_complete_command_arguments"},
  {"name": "native-main-discards-runtime-arguments", "file": "bend2/src/coordinator/main.bend", "find": "args : List<String> <- IO.args()\n    cli(args)", "replace": "args : List<String> <- IO.args()\n    cli(Nil{})", "law": "native_main_passes_the_complete_runtime_arguments"},

  {"name": "knowledge-pretty-parser-refuses-existing-read", "file": "bend2/src/coordinator/commands.bend", "find": "Bool.or(String.eq(verb,\"knowledge\"),String.eq(verb,\"worktree\"))", "replace": "Bool.or(String.eq(verb,\"knowledge-denied\"),String.eq(verb,\"worktree\"))", "law": "readable_knowledge_command_selects_the_existing_reader"},
  {"name": "worktree-pretty-parser-refuses-existing-read", "file": "bend2/src/coordinator/commands.bend", "find": "Bool.or(String.eq(verb,\"knowledge\"),String.eq(verb,\"worktree\"))", "replace": "Bool.or(String.eq(verb,\"knowledge\"),String.eq(verb,\"worktree-denied\"))", "law": "readable_worktree_command_selects_the_existing_reader"},
  {"name": "knowledge-pretty-uses-another-reader", "file": "bend2/src/coordinator/control.bend", "find": "case C.KnowledgeRead{reader}: IO.try(String,DB.Sql.query(db,Knowledge.commit_sql(Knowledge.read_sql(reader))))", "replace": "case C.KnowledgeRead{reader}: IO.try(String,DB.Sql.query(db,Knowledge.commit_sql(Knowledge.read_sql(\"operator\"))))", "law": "readable_knowledge_uses_the_existing_visibility_query"},
  {"name": "worktree-pretty-skips-fresh-inspection", "file": "bend2/src/coordinator/control.bend", "find": "case C.Worktree{id}: Recruit.inspect_result(db,id)", "replace": "case C.Worktree{id}: IO.try(String,Store.apply(db,C.Worktree{id}))", "law": "readable_worktree_inspects_the_recorded_workspace"},
  {"name": "worktree-inspection-uses-current-directory", "file": "bend2/src/coordinator/recruit.bend", "find": "status : Result<&1,&1,G.GitFail,G.WtStatus> <- WS.worktreeStatus(path)", "replace": "status : Result<&1,&1,G.GitFail,G.WtStatus> <- WS.worktreeStatus(\".\")", "law": "worktree_result_reads_fresh_git_status"},
  {"name": "worktree-inspection-hides-dirty-status", "file": "bend2/src/coordinator/recruit.bend", "find": "Bool.pick(String,dirty,\"true\",\"false\")", "replace": "Bool.pick(String,False{},\"true\",\"false\")", "law": "worktree_result_preserves_all_inspection_fields"},
  {"name": "worktree-missing-session-reports-success", "file": "bend2/src/coordinator/recruit.bend", "find": "case True{}: IO.die(String,2,\"The player has no recorded workspace.\")", "replace": "case True{}: IO.pure(String,\"{}\")", "law": "worktree_result_refuses_a_missing_session"},
  {"name": "ordinary-worktree-skips-output", "file": "bend2/src/coordinator/recruit.bend", "find": "saved : String <- inspect_result(db,id)\n    IO.print(saved)", "replace": "saved : String <- inspect_result(db,id)\n    IO.pure(Unit,Unit{})", "law": "ordinary_worktree_output_prints_the_same_inspection_result"},

  {"name": "stopped-principal-input-uses-parent-only", "file": "bend2/src/coordinator/delivery.bend", "find": "SELECT 'stopped-input:' || lower(hex(m.id)),s.id,\" ++ C.report_recipient(\"s.id\") ++ \",'report',", "replace": "SELECT 'stopped-input:' || lower(hex(m.id)),s.id,s.parent,'report',", "law": "stopped_input_reports_use_the_recorded_upstream_recipient"},
  {"name": "principal-report-ignores-immediate-parent", "file": "bend2/src/coordinator/commands.bend", "find": "WHEN report_sender.parent IS NOT NULL THEN report_sender.parent", "replace": "WHEN report_sender.parent IS NOT NULL THEN 'operator'", "law": "principal_reports_use_the_recorded_upstream_recipient"},
  {"name": "principal-report-skips-conductor-role", "file": "bend2/src/coordinator/commands.bend", "find": "WHEN \" ++ assigned_role(\"report_sender.id\") ++ \"='conductor' THEN", "replace": "WHEN 1 THEN", "law": "principal_reports_use_the_recorded_upstream_recipient"},
  {"name": "principal-report-skips-operator-role", "file": "bend2/src/coordinator/commands.bend", "find": " AND \" ++ assigned_role(\"report_operator.id\") ++ \"='operator'", "replace": " AND 1", "law": "principal_reports_use_the_recorded_upstream_recipient"},
  {"name": "terminal-report-replaces-full-body", "file": "bend2/src/coordinator/commands.bend", "find": "def terminal_body(+event: String) -> String:\n  \"CASE WHEN", "replace": "def terminal_body(+event: String) -> String:\n  \"'truncated' || CASE WHEN", "law": "terminal_reports_preserve_the_native_result"},
  {"name": "terminal-turn-uses-parent-only", "file": "bend2/src/coordinator/commands.bend", "find": "++ q(event) ++ \" WHERE \" ++ report_recipient(q(player)) ++ \" IS NOT NULL AND \" ++ terminal(event)", "replace": "++ q(event) ++ \" WHERE EXISTS(SELECT 1 FROM sessions WHERE id=\" ++ q(player) ++ \" AND parent IS NOT NULL) AND \" ++ terminal(event)", "law": "terminal_observation_records_the_report_and_turn"},
  {"name": "terminal-report-skips-completion-recording", "file": "bend2/src/coordinator/commands.bend", "find": "  observe_identity_sql(player,event) ++ observe_completion_sql(id,player,event,sealed)", "replace": "  observe_identity_sql(player,event)", "law": "observations_update_identity_before_recording_completion"},
  {"name": "sealed-managed-completion-records-a-second-report", "file": "bend2/src/coordinator/commands.bend", "find": "  Bool.pick(String,sealed,\"\",completion_sql(id,player,event))", "replace": "  Bool.pick(String,False{},\"\",completion_sql(id,player,event))", "law": "the_sealed_managed_completion_records_nothing"},
  {"name": "later-terminal-replaces-the-managed-completion", "file": "bend2/src/coordinator/turn.bend", "find": "\" THEN CASE WHEN \" ++ C.q(previous) ++ \"='' THEN \" ++ C.q(event) ++ \" ELSE \" ++ C.q(previous) ++ \" END ELSE \"", "replace": "\" THEN \" ++ C.q(event) ++ \" ELSE \"", "law": "the_first_native_terminal_keeps_the_managed_completion"},
  {"name": "post-terminal-response-records-guidance-acceptance", "file": "bend2/src/coordinator/guidance.bend", "find": "    case True{}: IO.try(String,DB.Sql.query(db,terminal_sql(event)))", "replace": "    case True{}: IO.try(String,DB.Sql.query(db,accepted_sql(player,event) ++ terminal_sql(event)))", "law": "a_response_after_the_first_terminal_leaves_guidance_pending"},
  {"name": "deferred-note-drops-the-pending-guidance", "file": "bend2/src/coordinator/turn.bend", "find": "\" and the deferred guidance \" ++ pending ++ \" stays pending for the next receive\"", "replace": "\" and the deferred guidance \" ++ pending", "law": "the_deferred_note_names_the_pending_guidance"},
  {"name": "deferred-guidance-hint-falls-back-to-a-cursor", "file": "bend2/src/coordinator/guidance.bend", "find": "ORDER BY seq)),'')", "replace": "ORDER BY seq)),CAST(0 AS INTEGER))", "law": "the_outstanding_guidance_reader_names_stored_guidance"},
  {"name": "deferred-state-ignores-the-stored-note", "file": "bend2/src/coordinator/turn.bend", "find": "messages WHERE id=\" ++ C.q(id ++ \":deferred\") ++ \") THEN 1 ELSE 0 END;", "replace": "messages WHERE id=\" ++ C.q(id ++ \":deferred\") ++ \") THEN 0 ELSE 0 END;", "law": "the_deferred_note_presence_reads_the_note_identity"},
  {"name": "deferred-note-is-written-again-when-recorded", "file": "bend2/src/coordinator/turn.bend", "find": "  match recorded:\n    case True{}: IO.pure(Unit,Unit{})", "replace": "  match recorded:\n    case True{}: do IO<Unit>:\n      +kept : String <- IO.try(String,DB.Sql.query(db,deferred_pending_sql(player)))\n      noted : Unit <- report(db,player,kept ++ \":deferred\",deferred_text(kept,Tx.trim_nl(kept)))\n      IO.pure(Unit,Unit{})", "law": "a_recorded_deferred_note_is_not_written_again"},
  {"name": "principal-completion-preparation-uses-parent-only", "file": "bend2/src/coordinator/turn.bend", "find": "def prepare(+db: String, +player: String, id: String, log: String, stderr: String, outcome: Outcome) -> IO(Unit):\n  do IO<Unit>:\n    recipient : String <- IO.try(String,DB.Sql.query(db,\"SELECT \" ++ C.report_recipient(C.q(player)) ++ \" IS NOT NULL;\"))", "replace": "def prepare(+db: String, +player: String, id: String, log: String, stderr: String, outcome: Outcome) -> IO(Unit):\n  do IO<Unit>:\n    recipient : String <- IO.try(String,DB.Sql.query(db,\"SELECT parent IS NOT NULL FROM sessions WHERE id=\" ++ C.q(player) ++ \";\"))", "law": "completion_preparation_checks_the_upstream_recipient"},
  {"name": "principal-completion-delivery-uses-parent-only", "file": "bend2/src/coordinator/turn.bend", "find": "def finish(+db: String, +player: String, id: String, log: String, outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):\n  do IO<Result<&1,&1,U32 & String,Unit>>:\n    recipient : String <- IO.try(String,DB.Sql.query(db,\"SELECT \" ++ C.report_recipient(C.q(player)) ++ \" IS NOT NULL;\"))", "replace": "def finish(+db: String, +player: String, id: String, log: String, outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):\n  do IO<Result<&1,&1,U32 & String,Unit>>:\n    recipient : String <- IO.try(String,DB.Sql.query(db,\"SELECT parent IS NOT NULL FROM sessions WHERE id=\" ++ C.q(player) ++ \";\"))", "law": "completion_delivery_checks_the_upstream_recipient"},
  {"name": "stopped-principal-completion-uses-parent-only", "file": "bend2/src/coordinator/stop.bend", "find": "SELECT st.report_id,s.id,\" ++ C.report_recipient(\"s.id\") ++ \",'report',", "replace": "SELECT st.report_id,s.id,s.parent,'report',", "law": "stopped_completion_reports_to_the_recorded_upstream_recipient"},
  { name: "native-detached-launch-skipped", file: join("bend2","src","coordinator","control.bend"), find: "Host.Control.launch(Tx.enc_argv([executable,\"--dispatch-message\",database,id]),database,id)", replace: "IO.pure(Result<&1,&1,U32 & String,String>,Done{\"{}\"})", law: "authorized_detached_delivery_launches_the_native_self_entry" },
  { name: "native-detached-child-skips-delivery", file: join("bend2","src","coordinator","control.bend"), find: "Delivery.deliver(db,id,\"1\",\"\")", replace: "IO.pure(Result<&1,&1,U32 & String,String>,Done{\"{}\"})", law: "detached_self_entry_delivers_the_committed_message" },
  { name: "native-start-conflict-refusal-skipped", file: join("bend2","src","coordinator","control.bend"), find: "case other: IO.die(Unit,2,other)", replace: "case other: IO.pure(Unit,Unit{})", law: "conflicting_principal_startup_refuses_before_task_dispatch" },
  {
    name: "native-start-admits-a-subordinate",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: " AND parent IS NULL AND harness=",
    replace: " AND harness=",
    law: "principal_startup_preserves_parentage_and_recorded_assignment",
  },
  {
    name: "native-start-clears-recorded-conversation",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: "\"UPDATE sessions SET model=\"",
    replace: "\"UPDATE sessions SET native='',model=\"",
    law: "principal_assignment_mutates_only_configuration_under_admission",
  },
  {
    name: "native-receiver-admits-unsupported-harness",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: " AND harness IN ('codex','omp')",
    replace: "",
    law: "native_receiver_checks_harness_stop_and_endpoint_admission",
  },
  {
    name: "native-receiver-accepts-unchecked-endpoint",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: " ++ \" AND \" ++ C.endpoint_admitted(endpoint) ++ \")\"",
    replace: " ++ \")\"",
    law: "native_receiver_checks_harness_stop_and_endpoint_admission",
  },
  {
    name: "native-detached-input-skips-message-commit",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: "Store.commit(db,C.Message{id,sender,recipient,kind,body})",
    replace: "IO.pure(Result<&1,&1,U32 & String,String>,Done{\"{}\"})",
    law: "detached_delivery_commits_before_launch_and_checks_refusals",
  },
  {
    name: "native-detached-denial-reports-success",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: "def dispatch_admitted(+db: String, +id: String, +saved: String, denied: Bool) -> IO(String):\n  match denied:\n    case True{}: IO.die(String,2,saved)",
    replace: "def dispatch_admitted(+db: String, +id: String, +saved: String, denied: Bool) -> IO(String):\n  match denied:\n    case True{}: IO.pure(String,saved)",
    law: "denied_detached_input_cannot_launch_a_process",
  },
  {
    name: "native-receiver-duplicates-wake-argument",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: "[executable,db,\"receive\",session,cmd,\"\",\"\",\"\",log]",
    replace: "[executable,db,\"receive\",session,cmd,\"\",\"\",\"\",log,\"\"]",
    law: "native_receiver_leaves_the_wake_argument_to_delivery",
  },
  {
    name: "native-turn-clears-recorded-resume",
    file: join("bend2", "src", "coordinator", "control.bend"),
    find: "[executable,database,\"turn\",player,id,harness_cmd,model,effort,cwd,path,output,native]",
    replace: "[executable,database,\"turn\",player,id,harness_cmd,model,effort,cwd,path,output,\"\"]",
    law: "detached_turn_uses_the_recorded_assignment_and_native_identity",
  },
  {
    name: "native-start-entry-skips-setup",
    file: join("bend2", "src", "coordinator", "main.bend"),
    find: "Control.start(db,session,harness,cmd,model,effort,cwd,log,id,task)",
    replace: "IO.pure(String,\"{}\")",
    law: "start_entry_executes_the_native_control",
  },
  {
    name: 'direct-turn-skips-retained-receive-guard',
    file: join('bend2','src','coordinator','turn.bend'),
    find: '      retained : Unit <- retained_receive_guard(db,player)\n',
    replace: '',
    law: 'direct_turn_checks_receive_before_admission',
  },
  {
    name: 'direct-turn-checks-receive-after-starting-task',
    file: join('bend2','src','coordinator','turn.bend'),
    find: '      retained : Unit <- retained_receive_guard(db,player)\n      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))\n      result : Result<&1,&1,U32 & String,Maybe<Outcome>> <- player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,missing)',
    replace: '      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))\n      result : Result<&1,&1,U32 & String,Maybe<Outcome>> <- player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,missing)\n      retained : Unit <- retained_receive_guard(db,player)',
    law: 'direct_turn_checks_receive_before_admission',
  },
  {
    name: 'direct-turn-guard-reads-another-attempt-mode',
    file: join('bend2','src','coordinator','turn.bend'),
    find: ' AND mode=\'retained\'),\'\');',
    replace: ' AND mode=\'direct\'),\'\');',
    law: 'direct_turn_guard_reads_current_retained_attempt',
  },
  {
    name: 'direct-turn-admits-unreleased-receive',
    file: join('bend2','src','coordinator','turn.bend'),
    find: '    case Some{args}: IO.die(Unit,2,"Session retains an interrupted native receive; run receive to observe its output and completion before starting a direct turn.")',
    replace: '    case Some{args}: IO.pure(Unit,Unit{})',
    law: 'direct_turn_refuses_unreleased_receive',
  },
  {
    name: 'native-owner-skips-recorded-attempt',
    file: join('bend2','src','coordinator','receive.bend'),
    find: '    case Some{lock}: acquired_recorded(db,session,cmd,model,effort,cwd,log,lock,again)',
    replace: '    case Some{lock}: acquired_pending(db,session,cmd,model,effort,cwd,log,lock,again)',
    law: 'acquired_native_owner_resolves_recorded_attempt',
  },
  {
    name: 'native-admission-reads-another-attempt-mode',
    file: join('bend2','src','coordinator','receive.bend'),
    find: ' AND mode=\'retained\'),\'\');',
    replace: ' AND mode=\'direct\'),\'\');',
    law: 'native_admission_reads_current_attempt_before_pending_input',
  },
  {
    name: 'surviving-attempt-starts-new-native',
    file: join('bend2','src','coordinator','receive.bend'),
    find: '    case Some{args}: recover_owned(db,session,directory,lock,String.split(args,Char.from_u32(0)),again)',
    replace: '    case Some{args}: acquired_pending(db,session,cmd,model,effort,cwd,log,lock,again)',
    law: 'surviving_attempt_recovery_preserves_its_guard',
  },
  {
    name: 'native-completion-releases-before-preparation',
    file: join('bend2','src','coordinator','receive.bend'),
    find: '    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)\n    observer_released : Unit <- release_observer(lock)',
    replace: '    observer_released : Unit <- release_observer(lock)\n    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)',
    law: 'native_completion_is_committed_before_owner_release',
  },
  {
    name: "naming-entry-skips-the-store",
    file: join('bend2', 'src', 'coordinator', "main.bend"),
    find: "    result : String <- IO.try(String, Store.apply(db,command))",
    replace: "    result : String <- IO.pure(String,\"[]\")",
    law: "stored_command_entry_uses_the_actual_store",
  },
  {
    name: "naming-role-parent-query-shadows-the-session",
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: "FROM sessions hierarchy WHERE hierarchy.id=",
    replace: "FROM sessions WHERE id=",
    law: "conductor_tier_follows_recorded_parentage",
  },
  {
    name: "naming-conductor-tier-reverses-parentage",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: ") IS NULL THEN 'principal-conductor' ELSE 'associate-conductor'",
    replace: ") IS NOT NULL THEN 'principal-conductor' ELSE 'associate-conductor'",
    law: "conductor_tier_follows_recorded_parentage",
  },
  {
    name: "naming-principal-admits-a-parent",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: " IN ('principal-conductor','operator') AND parent IS NULL)",
    replace: " IN ('principal-conductor','operator'))",
    law: "role_admission_checks_registration_and_parentage",
  },
  {
    name: "naming-role-answer-bypasses-admission",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: " ++ \" AND \" ++ role_admitted(session,role) ++ \";\"",
    replace: " ++ \";\"",
    law: "role_declarations_validate_registered_sessions_and_closed_roles",
  },
  {
    name: "naming-players-admit-operators",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: "case Players{}: \"SELECT \" ++ players_json(assigned_role(\"s.id\") ++ \"<>'operator'\") ++ \";\"",
    replace: "case Players{}: \"SELECT \" ++ players_json(\"1\") ++ \";\"",
    law: "players_include_every_nonoperator",
  },
  {
    name: "naming-players-omit-parentless-agents",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: "case Players{}: \"SELECT \" ++ players_json(assigned_role(\"s.id\") ++ \"<>'operator'\") ++ \";\"",
    replace: "case Players{}: \"SELECT \" ++ players_json(assigned_role(\"s.id\") ++ \"<>'operator' AND s.parent IS NOT NULL\") ++ \";\"",
    law: "players_include_every_nonoperator",
  },
  {
    name: "naming-section-owner-is-ignored",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: "\"(EXISTS(SELECT 1 FROM ensembles WHERE id=\" ++ q(ensemble) ++ \" AND owner=\" ++ q(owner) ++ \") AND \"",
    replace: "\"(EXISTS(SELECT 1 FROM ensembles WHERE id=\" ++ q(ensemble) ++ \") AND \"",
    law: "sections_use_the_existing_ensemble_conductor_owner",
  },
  {
    name: "naming-section-admits-another-ensembles-player",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: "\"<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members WHERE ensemble=\" ++ q(ensemble) ++ \" AND session=\" ++ q(player) ++ \"))))\"",
    replace: "\"<>'operator' AND EXISTS(SELECT 1 FROM ensemble_members WHERE session=\" ++ q(player) ++ \"))))\"",
    law: "section_membership_requires_the_named_ensemble_player",
  },
  {
    name: "naming-section-members-survive-ensemble-removal",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: "REFERENCES ensemble_members(ensemble,session) ON DELETE CASCADE",
    replace: "REFERENCES ensemble_members(ensemble,session)",
    law: "sections_reference_their_ensemble_and_its_members",
  },
  {
    name: "naming-orchestra-omits-operators",
    file: join('bend2', 'src', 'coordinator', "commands.bend"),
    find: " ++ \",'operators',\" ++ players_json(assigned_role(\"s.id\") ++ \"='operator'\")",
    replace: "",
    law: "orchestra_reads_players_operators_and_all_ensembles",
  },
  {
    name: "naming-invalid-role-loses-refusal-status",
    file: join('bend2', 'src', 'coordinator', "store.bend"),
    find: "Tx.starts_with(saved,\"{\\\"error\\\":\\\"invalid-role\\\"\")",
    replace: "False{}",
    law: "invalid_role_returns_structured_exit_two",
  },
  {
    name: "naming-section-loses-refusal-status",
    file: join('bend2', 'src', 'coordinator', "store.bend"),
    find: "Tx.starts_with(saved,\"{\\\"error\\\":\\\"section-refused\\\"\")",
    replace: "False{}",
    law: "refused_section_returns_structured_exit_two",
  },
  {
    name: 'player-retry-ignores-harness',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: '++ " AND harness=" ++ q(harness)',
    replace: '++ " AND harness=harness"',
    law: 'm8_player_retry_compares_the_complete_assignment',
  },
  {
    name: 'player-retry-ignores-model',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: '++ " AND model=" ++ q(model)',
    replace: '++ " AND model=model"',
    law: 'm8_player_retry_compares_the_complete_assignment',
  },
  {
    name: 'player-retry-overwrites-assigned-harness',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: ') ON CONFLICT(id) DO NOTHING;',
    replace: ') ON CONFLICT(id) DO UPDATE SET harness=excluded.harness;',
    law: 'm8_player_registration_is_bound_to_the_stored_row',
  },
  {
    name: 'player-conflict-also-returns-a-session',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: 'session_result_where("id=" ++ q(id) ++ " AND " ++ player_matches(parent,harness,model,effort,workspace,branch,base))',
    replace: 'session_result(id)',
    law: 'm8_player_registration_is_bound_to_the_stored_row',
  },
  {
    name: 'player-conflict-loses-exit-classification',
    file: join('bend2', 'src', 'coordinator', 'store.bend'),
    find: 'Tx.starts_with(saved,"{\\"error\\":\\"player-assignment-conflict\\"")',
    replace: 'False{}',
    law: 'committed_message_routes_refuse_before_endpoint_delivery',
  },
  {
    name: 'connect-removes-endpoint-update-admission',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: '" WHERE id=" ++ q(id) ++ " AND " ++ endpoint_admitted(endpoint) ++ ";"',
    replace: '" WHERE id=" ++ q(id) ++ ";"',
    law: 'connect_updates_and_answers_only_after_admission',
  },
  {
    name: 'connect-admits-non-text-argv',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: " WHERE type<>'text' OR instr(value,char(0))>0)",
    replace: ' WHERE instr(value,char(0))>0)',
    law: 'connect_admission_requires_native_argv_or_explicit_disconnection',
  },
  {
    name: 'connect-refusal-loses-exit-classification',
    file: join('bend2', 'src', 'coordinator', 'store.bend'),
    find: 'Bool.or(Tx.starts_with(saved,"{\\"error\\":\\"message-route-denied\\""),Tx.starts_with(saved,"{\\"error\\":\\"invalid-endpoint\\""))',
    replace: 'Tx.starts_with(saved,"{\\"error\\":\\"message-route-denied\\"")',
    law: 'committed_message_routes_refuse_before_endpoint_delivery',
  },
  {
    name: 'message-admission-removes-route-guard',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: ' WHERE (" ++ message_route(q(sender),q(recipient)) ++ " AND NOT (',
    replace: ' WHERE (1 AND NOT (',
    law: 'message_admission_checks_routes_or_an_exact_accepted_retry',
  },
  {
    name: 'message-refusal-reaches-endpoint-delivery',
    file: join('bend2', 'src', 'coordinator', 'store.bend'),
    find: 'case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)})',
    replace: 'case True{}: Delivery.after(db,command,saved)',
    law: 'denied_message_routes_cannot_deliver',
  },
  {
    name: 'idle-stop-claims-a-requested-signal',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: "'requestedSignal',CASE WHEN attempt='' THEN NULL ELSE signal END,",
    replace: "'requestedSignal',signal,",
    law: 'stop_result_reads_recorded_execution_status',
  },
  {
    name: 'stop-reconcile-forces-every-request',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'SELECT s.signal FROM session_stops',
    replace: 'SELECT 9 FROM session_stops',
    law: 'stop_reconcile_selects_the_recorded_signal_and_attempt',
  },
  {
    name: 'stop-reconcile-compares-signal-numbers',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 's.applied_signal<>s.signal',
    replace: 's.applied_signal<s.signal',
    law: 'stop_reconcile_selects_the_recorded_signal_and_attempt',
  },
  {
    name: 'native-reply-admits-stopped-worker',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=r.worker)',
    replace: '',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-resends-to-stopped-worker',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker)',
    replace: '',
    law: 'native_reply_send_reads_recorded_request',
  },
  {
    name: 'stop-admission-ignores-terminal-state',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: "'starting','' WHERE NOT EXISTS(SELECT 1 FROM session_stops WHERE session=",
    replace: "'starting','' WHERE EXISTS(SELECT 1 FROM session_stops WHERE session=",
    law: 'stop_admission_transaction_preserves_terminal_state',
  },
  {
    name: 'ordinary-stop-submits-force',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'P.ProcessChild.control_signal(directory,other)',
    replace: 'P.ProcessChild.control_signal(directory,9)',
    law: 'ordinary_stop_submits_term_to_its_attempt',
  },
  {
    name: 'force-stop-selects-another-attempt',
    file: join('bend2', 'src', 'coordinator', 'stop.bend'),
    find: 'e.id=session_stops.attempt',
    replace: 'e.id<>session_stops.attempt',
    law: 'force_stop_keeps_the_recorded_live_attempt',
  },
  {
    name: 'stopped-receive-reports-success',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})',
    replace: 'case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})',
    law: 'stopped_receive_cannot_acquire_an_owner',
  },
  {
    name: 'native-reply-parent-predicate-removed',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: ' AND r.parent=" ++ C.q(parent) ++ " AND r.closed IS NULL',
    replace: ' AND r.closed IS NULL',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-confirm-method-bypassed',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: "r.method='confirm' AND json_type(supplied.value,'$.confirmed')",
    replace: "1=1 AND json_type(supplied.value,'$.confirmed')",
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-conflict-accepted',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'id=CASE WHEN reply IS NULL OR reply=(SELECT frame FROM valid) THEN id ELSE NULL END',
    replace: 'id=id',
    law: 'native_reply_sql_checks_parent_method_and_immutable_answer',
  },
  {
    name: 'native-reply-send-bypasses-open-request',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'dispatch(Tx.trim_nl(attempt),frame,String.eq(allowed,"1\\n"))',
    replace: 'dispatch(Tx.trim_nl(attempt),frame,True{})',
    law: 'native_reply_send_reads_recorded_request',
  },
  {
    name: 'native-reply-write-failure-marked-success',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})',
    replace: 'case Fail{error}: DB.Sql.query(db,"UPDATE native_requests SET written=1 WHERE id=" ++ C.q(id) ++ ";")',
    law: 'native_reply_failed_write_has_no_success_marker',
  },
  {
    name: 'native-reply-bypasses-response-admission',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'reply_result(db,id,String.eq(accepted,"1\\n"),String.eq(written,"1\\n"))',
    replace: 'reply_result(db,id,True{},String.eq(written,"1\\n"))',
    law: 'native_reply_dispatch_follows_response_admission',
  },
  {
    name: 'native-reply-refusal-writes',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native request is closed, unavailable, or belongs to another parent.")})',
    replace: 'case False{}: P.ProcessChild.control_write(attempt,frame)',
    law: 'native_reply_refusal_cannot_write',
  },
  {
    name: 'native-reply-attempt-substituted',
    file: join('bend2', 'src', 'coordinator', 'native-requests.bend'),
    find: 'case True{}: P.ProcessChild.control_write(attempt,frame)',
    replace: 'case True{}: P.ProcessChild.control_write("another-attempt",frame)',
    law: 'native_reply_uses_recorded_attempt_and_frame',
  },
  {
    name: 'm18-push-destination-substituted',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'Con{"push", Con{remote, Con{branch, Nil{}}}}',
    replace: 'Con{"push", Con{"origin", Con{branch, Nil{}}}}',
    law: 'm18_push_destination_is_the_declared_remote',
  },
  {
    name: 'm3a-passing-candidate-contributes',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'match cv:\n    case VPass{}: acc',
    replace: 'match cv:\n    case VPass{}: Con{"uncovered", acc}',
    law: 'm3a_passing_candidate_contributes_nothing',
  },
  {
    name: 'm10-first-check-reads-the-target-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'cfv : FV <- run_check(ct2, s2, f2)',
    replace: 'cfv : FV <- run_check(tt2, s2, f2)',
    law: 'm10_run_pairs_checks_each_file_on_its_own_tree',
  },
  {
    name: 'm10-target-tree-is-the-candidate-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '+tw = Tx.str_cat(sc, "-target")',
    replace: '+tw = sc',
    law: 'm10_stage_six_checks_the_prepared_target_sibling',
  },
  {
    name: 'm10-judged-call-checks-the-other-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'pvs : List<PV> <- run_pairs(script, files, s2, tw)',
    replace: 'pvs : List<PV> <- run_pairs(script, files, tw, s2)',
    law: 'm10_the_candidate_tree_and_the_target_sibling_are_judged',
  },
  {
    name: 'm10-verdict-ignores-the-pairs',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'ld_judged_news(pairs_news(pvs), repo, target, scratch, tip, cand)',
    replace: 'ld_judged_news(Nil{}, repo, target, scratch, tip, cand)',
    law: 'm10_the_verdict_judges_the_pairs_the_checks_produced',
  },
  {
    name: 'm10-check-runs-in-the-script-directory',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'r : T.RunRes <- Git.runFull(check_argv(s2, f2), d2)',
    replace: 'r : T.RunRes <- Git.runFull(check_argv(s2, f2), s2)',
    law: 'm10_run_check_runs_its_argv_in_its_own_directory',
  },
  {
    name: 'm10-pair-verdict-is-always-a-pass',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case FV{file, v}: v',
    replace: 'case FV{file, v}: VPass{}',
    law: 'm10_the_verdict_of_a_pair_is_the_verdict_it_carries',
  },
  {
    name: 'm10-normal-exit-forced-to-pass',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case T.RRun{T.SExit{code}, out}: exit_verdict(U32.is_eq(code, 0), out, file)',
    replace: 'case T.RRun{T.SExit{code}, out}: exit_verdict(True{}, out, file)',
    law: 'm10_a_normal_exit_reads_its_own_status',
  },
  {
    name: 'm17-refused-conversation-completes-instead',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'case True{}: restart_pending(db,session,id,native,cwd,handle,lock,deliveries,again)',
    replace: 'case True{}: completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again)',
    law: 'm17_refused_conversation_restarts_the_attempt',
  },
  {
    name: 'm17-restart-drops-the-recovery-record',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: 'saved : Unit <- record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\\n"))',
    replace: 'saved : Unit <- IO.pure(Unit,Unit{})',
    law: 'm17_restart_records_before_releasing_and_waking',
  },
  {
    name: 'm10-checks-run-on-an-unprepared-tree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case T.GRun{code, out}: ld_tree_runs(U32.is_eq(code, 0), repo, target, script, files, scratch, tip, cand, tw)',
    replace: 'case T.GRun{code, out}: ld_tree_runs(True{}, repo, target, script, files, scratch, tip, cand, tw)',
    law: 'm10_the_prepared_tree_status_decides_whether_the_checks_run',
  },
  {
    name: 'm10-selection-walk-skips-the-reversal',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case Nil{}: IO.pure(List<PV>, List.reverse(&1, PV, acc))',
    replace: 'case Nil{}: IO.pure(List<PV>, acc)',
    law: 'm10_the_selection_walk_ends_with_the_reversed_pairs',
  },
  {
    name: 'm17-recovery-native-guard-dropped',
    file: join('bend2', 'src', 'coordinator', 'receive.bend'),
    find: '" AND native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"',
    replace: '";"',
    law: 'm17_recovery_input_is_one_guarded_transaction',
  },
  {
    name: 'm3a-composition-skips-stage-four',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    e : Ld <- ld_go4(d, r2, s2)',
    replace: '    e : Ld <- IO.pure(Ld, d)',
    law: 'm3a_the_checked_landing_runs_every_stage_in_order',
  },
  {
    name: 'm3a-fast-forward-composition-skips-the-advance-stage',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    r5 : FFLD <- ff_go5(r4, rp, tg)',
    replace: '    r5 : FFLD <- IO.pure(FFLD, r4)',
    law: 'm3a_the_fast_forward_landing_runs_every_stage_in_order',
  },
  {
    name: 'm3a-held-advance-drops-the-fast-forward-requirement',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    g : T.GitOut <- Git.runGit(p2, ["merge", "--ff-only", c2])',
    replace: '    g : T.GitOut <- Git.runGit(p2, ["merge", c2])',
    law: 'm3a_held_advance_is_the_worktree_fast_forward',
  },
  {
    name: 'm3a-a-held-target-advances-without-its-worktree',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case HoldPath{path}: ld_adv_wt(path, repo, target, cand, basis)',
    replace: '    case HoldPath{path}: ld_adv_cas_run(repo, target, cand, basis)',
    law: 'm3a_holder_advances_through_its_own_worktree',
  },
  {
    name: 'm11-holder-path-drops-the-label-space',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '  wt_path_go(line, "worktree ")',
    replace: '  wt_path_go(line, "worktree")',
    law: 'm11_the_holder_comes_from_the_worktree_listing',
  },
  {
    name: 'm3a-refused-fastforward-of-the-basis-reads-as-the-movement',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'def ld_adv_refused_same(same: Bool, path: String) -> LAdv:\n  match same:\n    case True{}: AdvHeld{path}',
    replace: 'def ld_adv_refused_same(same: Bool, path: String) -> LAdv:\n  match same:\n    case True{}: AdvMoved{}',
    law: 'm3a_refused_fastforward_of_the_basis_names_the_worktree',
  },
  {
    name: 'm3a-moved-block-drops-the-next-operation',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case AdvMoved{}: LdDone{T.LBlocked{"target moved during checked landing; rerun land-checked to prepare and check against the current target"}}',
    replace: '    case AdvMoved{}: LdDone{T.LBlocked{"target moved"}}',
    law: 'm3a_moved_block_names_the_next_check',
  },
  {
    name: 'm3a-composition-skips-the-settle',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    settled : Ld <- ld_settle(f, r2, s2)',
    replace: '    settled : Ld <- IO.pure(Ld, f)',
    law: 'm3a_the_checked_landing_runs_every_stage_in_order',
  },
  {
    name: 'm3c-landed-state-answers-a-failure',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{made})',
    replace: '    case LdDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "landed"}})',
    law: 'm3c_a_landed_state_answers_its_own_outcome',
  },
  {
    name: 'm3c-failed-state-answers-a-landing',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{fail})',
    replace: '    case LdFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{T.LAlready{""}})',
    law: 'm3c_a_failed_state_answers_its_own_failure',
  },
  {
    name: 'm3c-unfinished-stage-answers-an-outcome',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})',
    replace: '    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{T.LAlready{"none"}})',
    law: 'm3c_a_prepared_candidate_alone_is_not_an_outcome',
  },
  {
    name: 'm14-unregistered-parent-admits-the-recruit',
    file: join('bend2', 'src', 'coordinator', 'recruit.bend'),
    find: 'case False{}: IO.die(Unit,2,"The parent session is not registered.")',
    replace: 'case False{}: IO.pure(Unit,Unit{})',
    law: 'm14_unregistered_parent_refuses_with_its_rule',
  },
  {
    name: 'm10-ld-go5-skips-the-checks-stage',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'case LdCand{tip, cand}: ld_stage6(repo, target, script, files, scratch, tip, cand)',
    replace: 'case LdCand{tip, cand}: ld_unreach()',
    law: 'm10_ld_go5_runs_the_checks_stage',
  },
  {
    name: 'm10-ld-go1-drops-a-settled-landing',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):\n  match r:\n    case LdDone{made}: IO.pure(Ld, LdDone{made})',
    replace: 'def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):\n  match r:\n    case LdDone{made}: ld_unreach()',
    law: 'm10_ld_go1_keeps_a_settled_landing',
  },
  {
    name: 'knowledge-reader-loses-its-childrens-findings',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "k.author=" ++ C.q(reader) ++ " OR EXISTS(SELECT 1 FROM sessions a WHERE a.id=k.author AND a.parent=" ++ C.q(reader) ++ ")"',
    replace: '  "k.author=" ++ C.q(reader)',
    law: 'm8_a_reader_reads_its_own_findings_and_its_childrens',
  },
  {
    name: 'knowledge-reader-loses-its-promoted-findings',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "EXISTS(SELECT 1 FROM knowledge_promotions p WHERE p.finding=k.id AND " ++ scope_membership(reader) ++ ")"',
    replace: '  "0"',
    law: 'm8_a_reader_reads_findings_promoted_into_its_scopes',
  },
  {
    name: 'knowledge-promotion-admits-any-destination',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  C.q(promoter) ++ "=" ++ C.q(destination)',
    replace: '  "1"',
    law: 'm8_only_the_destination_owner_admits_a_promotion',
  },
  {
    name: 'knowledge-promotion-skips-the-source-check',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "((" ++ C.q(source) ++ "=k.author AND (" ++ authored_visible(promoter) ++ ")) OR EXISTS(SELECT 1 FROM knowledge_promotions prev WHERE prev.finding=k.id AND prev.destination=" ++ C.q(source) ++ " AND " ++ membership("prev.destination",promoter) ++ "))"',
    replace: '  "1"',
    law: 'm8_a_promotion_source_carries_the_exact_finding',
  },
  {
    name: 'knowledge-notice-goes-to-the-author',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(SELECT parent FROM sessions WHERE id=" ++ C.q(author) ++ ")"',
    replace: '  "(SELECT id FROM sessions WHERE id=" ++ C.q(author) ++ ")"',
    law: 'm8_a_notice_is_addressed_to_the_authors_parent',
  },
  {
    name: 'knowledge-refusal-answers-nothing',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    case True{}: IO.die(Unit,1,"No knowledge row was written: name a registered author, evidence naming an existing message the author is a party to, and an unused or identical row id.")',
    replace: '    case True{}: IO.write("")',
    law: 'm14_an_empty_knowledge_answer_names_its_rule',
  },
  {
    name: 'knowledge-read-parses-as-another-verb',
    file: join('bend2', 'src', 'coordinator', 'commands.bend'),
    find: 'String.eq(verb,"knowledge"),KnowledgeRead{id},',
    replace: 'String.eq(verb,"knowledge"),Worktree{id},',
    law: 'm14_the_knowledge_verb_reads_for_the_named_reader',
  },
  {
    name: 'knowledge-membership-loses-the-scope-owners-parent',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(EXISTS(SELECT 1 FROM chain c WHERE c.id=" ++ scope ++ ") OR EXISTS(SELECT 1 FROM sessions d WHERE d.id=" ++ scope ++ " AND d.parent=" ++ C.q(reader) ++ "))"',
    replace: '  "(EXISTS(SELECT 1 FROM chain c WHERE c.id=" ++ scope ++ "))"',
    law: 'm8_membership_counts_owner_parent_of_owner_and_subtree',
  },
  {
    name: 'knowledge-item-drops-the-evidence-message',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "json_object(\'id\',k.id,\'author\',k.author,\'claim\',k.claim,\'evidence\',k.evidence,\'evidenceMessage\'," ++ evidence_message("k.evidence") ++ ",\'limits\',k.limits,\'destinations\'," ++ knowledge_destinations(reader) ++ ",\'promotions\'," ++ knowledge_promotions(reader) ++ ")"',
    replace: '  "json_object(\'id\',k.id,\'author\',k.author,\'claim\',k.claim,\'evidence\',k.evidence,\'limits\',k.limits,\'destinations\'," ++ knowledge_destinations(reader) ++ ",\'promotions\'," ++ knowledge_promotions(reader) ++ ")"',
    law: 'm8_the_finding_item_carries_its_evidence_and_its_promotions',
  },
  {
    name: 'knowledge-notice-drops-the-author',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "json_object(\'finding\'," ++ C.q(id) ++ ",\'author\'," ++ C.q(author) ++ ")"',
    replace: '  "json_object(\'finding\'," ++ C.q(id) ++ ")"',
    law: 'm14_the_notice_body_names_the_finding_and_its_author',
  },
  {
    name: 'knowledge-evidence-accepts-anything',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  "(substr(" ++ C.q(evidence) ++ ",1,8)=\'message:\' AND EXISTS(SELECT 1 FROM messages WHERE id=substr(" ++ C.q(evidence) ++ ",9) AND (sender=" ++ C.q(author) ++ " OR recipient=" ++ C.q(author) ++ ")))"',
    replace: '  "1"',
    law: 'm8_the_evidence_is_a_reference_to_an_existing_message',
  },
  {
    name: 'knowledge-promotion-answer-ignores-its-source',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND source=" ++ C.q(source) ++ " AND destination="',
    replace: '" AND destination="',
    law: 'm1_the_promotion_answer_is_this_calls_promotion',
  },
  {
    name: 'knowledge-read-query-drops-the-visible-filter',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: 'FROM knowledge k WHERE " ++ knowledge_visible(reader) ++ " ORDER BY k.rowid);"',
    replace: 'FROM knowledge k ORDER BY k.rowid);"',
    law: 'm8_the_read_query_carries_the_chain_and_the_visible_filter',
  },
  {
    name: 'knowledge-promotion-statement-drops-the-source-condition',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND " ++ promotion_admitted(promoter,destination) ++ " AND " ++ source_carries(promoter,source)',
    replace: '" AND " ++ promotion_admitted(promoter,destination)',
    law: 'm8_the_promotion_statement_carries_the_admission_and_the_source',
  },
  {
    name: 'knowledge-record-statement-drops-the-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  finding_statement(id,author,claim,evidence,limits) ++ notice_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)',
    replace: '  finding_statement(id,author,claim,evidence,limits) ++ knowledge_answer(id,author,claim,evidence,limits)',
    law: 'm1_the_record_statement_carries_the_finding_the_notice_and_the_answer',
  },
  {
    name: 'knowledge-record-io-skips-the-notice-delivery',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    delivery : Result<&1,&1,U32 & String,String> <- deliver_record(db,id,saved)',
    replace: '    delivery : Result<&1,&1,U32 & String,String> <- IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})',
    law: 'm1_the_record_io_queries_delivers_and_answers',
  },
  {
    name: 'knowledge-answer-ignores-its-finding-coordinates',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '" AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ";"',
    replace: '";"',
    law: 'm1_the_finding_answer_is_the_row_it_wrote',
  },
  {
    name: 'knowledge-notice-ignores-the-finding-coordinates',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: 'WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ " AND author=" ++ C.q(author) ++ " AND claim=" ++ C.q(claim) ++ " AND evidence=" ++ C.q(evidence) ++ " AND limits=" ++ C.q(limits) ++ ")',
    replace: 'WHERE EXISTS(SELECT 1 FROM knowledge WHERE id=" ++ C.q(id) ++ ")',
    law: 'm14_the_notice_carries_the_question_kind_and_the_reference',
  },
  {
    name: 'knowledge-read-io-ignores-the-query',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    visible : String <- IO.try(String,DB.Sql.query(db,commit_sql(read_sql(reader))))',
    replace: '    visible : String <- IO.pure(String,"[]")',
    law: 'm8_the_read_io_queries_the_visible_findings_and_answers',
  },
  {
    name: 'knowledge-notice-is-not-the-question-kind',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '++ ",\'question\'," ++ notice_body(id,author) ++',
    replace: '++ ",\'knowledge\'," ++ notice_body(id,author) ++',
    law: 'm14_the_notice_carries_the_question_kind_and_the_reference',
  },
];

MUTATIONS.push(
  {
    name: 'knowledge-empty-record-result-delivers-the-old-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    case SNil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}})',
    replace: '    case SNil{}: Delivery.deliver(db,notice_id(id),"1",SNil{})',
    law: 'm1_an_empty_record_result_is_a_pure_answer',
  },
  {
    name: 'knowledge-stored-record-result-skips-its-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    case SCon{h,t}: Delivery.deliver(db,notice_id(id),"1",SCon{h,t})',
    replace: '    case SCon{h,t}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SCon{h,t}})',
    law: 'm1_a_stored_record_result_delivers_its_notice',
  },
  {
    "name": "knowledge-insertion-skips-the-evidence-check",
    "file": "bend2/src/coordinator/knowledge.bend",
    "find": "++ \") AND \" ++ evidence_ok(author,evidence)",
    "replace": "++ \") AND 1\"",
    "law": "m8_finding_insertion_checks_the_author_evidence_and_retry"
  },
  {
    "name": "knowledge-insertion-skips-the-author-check",
    "file": "bend2/src/coordinator/knowledge.bend",
    "find": "++ \" WHERE EXISTS(SELECT 1 FROM sessions WHERE id=\" ++ C.q(author) ++ \") AND \" ++ evidence_ok(author,evidence)",
    "replace": "++ \" WHERE \" ++ evidence_ok(author,evidence)",
    "law": "m8_finding_insertion_checks_the_author_evidence_and_retry"
  },
  {
    "name": "knowledge-insertion-accepts-a-conflicting-retry",
    "file": "bend2/src/coordinator/knowledge.bend",
    "find": "++ \" ON CONFLICT(id) DO UPDATE SET id=CASE WHEN knowledge.author=excluded.author AND knowledge.claim=excluded.claim AND knowledge.evidence=excluded.evidence AND knowledge.limits=excluded.limits THEN knowledge.id ELSE NULL END;\"",
    "replace": "++ \" ON CONFLICT(id) DO UPDATE SET id=knowledge.id;\"",
    "law": "m8_finding_insertion_checks_the_author_evidence_and_retry"
  },
  {
    "name": "knowledge-transaction-skips-the-existing-schema",
    "file": "bend2/src/coordinator/knowledge.bend",
    "find": "\"BEGIN IMMEDIATE;\" ++ C.schema() ++ knowledge_schema() ++ statements ++ \"COMMIT;\"",
    "replace": "\"BEGIN IMMEDIATE;\" ++ knowledge_schema() ++ statements ++ \"COMMIT;\"",
    "law": "m1_knowledge_statements_share_one_schema_ready_transaction"
  },
  {
    "name": "knowledge-schema-drops-the-limits-column",
    "file": "bend2/src/coordinator/knowledge.bend",
    "find": "claim TEXT NOT NULL, evidence TEXT NOT NULL, limits TEXT NOT NULL);",
    "replace": "claim TEXT NOT NULL, evidence TEXT NOT NULL);",
    "law": "m1_the_knowledge_schema_retains_findings_and_promotions"
  },
  {
    "name": "knowledge-record-dispatch-skips-the-effect",
    "file": "bend2/src/coordinator/main.bend",
    "find": "      Knowledge.record(db,id,author,claim,evidence,limits)",
    "replace": "      IO.pure(Unit,Unit{})",
    "law": "m14_the_record_command_runs_the_knowledge_record"
  },
  {
    "name": "knowledge-read-dispatch-skips-the-query",
    "file": "bend2/src/coordinator/main.bend",
    "find": "      Knowledge.read(db,reader)",
    "replace": "      IO.pure(Unit,Unit{})",
    "law": "m14_the_knowledge_command_runs_the_scoped_read"
  },
  {
    "name": "knowledge-promote-dispatch-skips-the-effect",
    "file": "bend2/src/coordinator/main.bend",
    "find": "      Knowledge.promote(db,id,promoter,source,destination,finding)",
    "replace": "      IO.pure(Unit,Unit{})",
    "law": "m14_the_promote_command_runs_the_explicit_promotion"
  },
  {
    name: 'knowledge-promotion-notice-loses-its-identity',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  id ++ ":promotion-notice"',
    replace: '  id',
    law: 'm14_the_promotion_notice_names_the_promotion',
  },
  {
    name: 'knowledge-promotion-notice-drops-the-destination',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: "  \"json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'destination',p.destination,'promotedBy',p.promoted_by)\"",
    replace: "  \"json_object('promotion',p.id,'finding',p.finding,'author',p.author,'source',p.source,'promotedBy',p.promoted_by)\"",
    law: 'm14_the_promotion_notice_body_names_its_provenance',
  },
  {
    name: 'knowledge-promotion-notice-addresses-the-source',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: ",p.promoted_by,p.destination,'question',",
    replace: ",p.promoted_by,p.source,'question',",
    law: 'm8_the_promotion_notice_addresses_its_exact_destination_owner',
  },
  {
    name: 'knowledge-promotion-notice-ignores-the-source-coordinate',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '++ " AND p.source=" ++ C.q(source) ++ " AND p.destination="',
    replace: '++ " AND p.destination="',
    law: 'm8_the_promotion_notice_addresses_its_exact_destination_owner',
  },
  {
    name: 'knowledge-promotion-composition-skips-the-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '  promotion_statement(id,promoter,source,destination,finding) ++ promotion_notice_statement(id,promoter,source,destination,finding) ++ promotion_answer(id,promoter,source,destination,finding)',
    replace: '  promotion_statement(id,promoter,source,destination,finding) ++ promotion_answer(id,promoter,source,destination,finding)',
    law: 'm1_the_promote_statement_carries_the_promotion_notice_and_answer',
  },
  {
    name: 'knowledge-empty-promotion-result-delivers-the-old-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: 'def deliver_promotion(db: String, id: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):\n  match saved:\n    case SNil{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SNil{}})',
    replace: 'def deliver_promotion(db: String, id: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):\n  match saved:\n    case SNil{}: Delivery.deliver(db,promotion_notice_id(id),"1",SNil{})',
    law: 'm1_an_empty_promotion_result_is_a_pure_answer',
  },
  {
    name: 'knowledge-stored-promotion-result-skips-its-notice',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    case SCon{h,t}: Delivery.deliver(db,promotion_notice_id(id),"1",SCon{h,t})',
    replace: '    case SCon{h,t}: IO.pure(Result<&1,&1,U32 & String,String>,Done{SCon{h,t}})',
    law: 'm1_a_stored_promotion_result_delivers_its_notice',
  },
  {
    name: 'knowledge-promotion-io-skips-the-notice-delivery',
    file: join('bend2', 'src', 'coordinator', 'knowledge.bend'),
    find: '    delivery : Result<&1,&1,U32 & String,String> <- deliver_promotion(db,id,saved)',
    replace: '    delivery : Result<&1,&1,U32 & String,String> <- IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})',
    law: 'm1_the_promote_io_queries_delivers_and_answers',
  },
);

MUTATIONS.push(
  {"name": "completion-output-skips-the-write", "file": "bend2/src/coordinator/turn.bend", "find": "    written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)\n    IO.pure(Result<&1,&1,U32 & String,Unit>,combine", "replace": "    written : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})\n    IO.pure(Result<&1,&1,U32 & String,Unit>,combine", "law": "completion_output_preserves_delivery_errors_and_returns_write_failure"},
  {"name": "completion-output-hides-earlier-stop-failure", "file": "bend2/src/coordinator/turn.bend", "find": "combine(stopped,written)", "replace": "combine(written,stopped)", "law": "completion_output_preserves_delivery_errors_and_returns_write_failure"},
  {"name": "parentless-completion-uses-global-output", "file": "bend2/src/coordinator/turn.bend", "find": "          T.Text.control_output(output)", "replace": "          written : Unit <- IO.write(output)\n          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})", "law": "completion_without_parent_returns_output_failure"},
  {"name": "receive-status-uses-global-output", "file": "bend2/src/coordinator/receive.bend", "find": "    Text.Text.control_output(result)", "replace": "    written : Unit <- IO.write(result)\n    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})", "law": "receive_status_returns_output_failure"}
);

MUTATIONS.push(
  {"name": "report-returns-to-global-buffered-output", "file": "bend2/src/coordinator/turn.bend", "find": "    written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)\n    IO.pure(Unit,Unit{})", "replace": "    IO.write(saved)", "law": "report_persists_before_best_effort_control_output"},
  {"name": "direct-replay-returns-to-buffered-output", "file": "bend2/src/coordinator/turn.bend", "find": "        written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)", "replace": "        written : Result<&1,&1,U32 & String,Unit> <- IO.bind(Unit,Result<&1,&1,U32 & String,Unit>,IO.write(saved),u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))", "law": "direct_replay_keeps_output_failure_for_completion"},
  {"name": "parentless-request-loses-original-error", "file": "bend2/src/coordinator/native-requests.bend", "find": "(tasks,\"Native OMP UI request has no registered parent; interaction requires a registered parent.\")", "replace": "(tasks,\"\")", "law": "parentless_request_preserves_its_error_after_control_output"}
);

MUTATIONS.push(
  {"name": "failed-replay-skips-the-wake", "file": "bend2/src/coordinator/turn.bend", "find": "    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,\"0\")\n    IO.pass(Unit,combine(output,wake))", "replace": "    wake : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})\n    IO.pass(Unit,combine(output,wake))", "law": "failed_replay_releases_and_wakes_before_reporting_output_error"},
  {"name": "failed-replay-halts-before-release", "file": "bend2/src/coordinator/turn.bend", "find": "    case Fail{error}: replay_finished(db,player,lock,Fail{error})", "replace": "    case Fail{error}: IO.pass(Unit,Fail{error})", "law": "failed_replay_output_reaches_the_completion_boundary"}
);

MUTATIONS.push(
  {"name": "member-presence-matches-parentage-not-registration", "file": "bend2/src/coordinator/commands.bend", "find": "\"EXISTS(SELECT 1 FROM sessions WHERE sessions.id=\" ++ session ++ \")\"", "replace": "\"EXISTS(SELECT 1 FROM sessions WHERE sessions.parent=\" ++ session ++ \")\"", "law": "member_presence_requires_a_stored_player_record"}
);

MUTATIONS.push(
  {
    name: 'held-success-arm-skips-publication-observation',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: 'ld_adv_wt_observe(p2, r2, t2, c2),\n        ld_adv_wt_refused(p2, r2, t2, b2)',
    replace: 'IO.pure(LAdv, AdvLanded{}),\n        ld_adv_wt_refused(p2, r2, t2, b2)',
    law: 'm3a_held_success_arm_uses_publication_observation',
  },
  {
    name: 'held-success-arm-ignores-holder-branch',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '+same = Bool.pick(Bool, status_ok,\n        Tx.str_eq(Tx.trim_nl(out), ld_hold_ref(target)), False{})\n      IO.pure(LAdv, ld_adv_wt_observed(True{}, same, path))',
    replace: 'IO.pure(LAdv, ld_adv_wt_observed(True{}, True{}, path))',
    law: 'm3a_held_holder_different_branch_refuses',
  },
  {
    name: 'held-success-arm-accepts-a-different-target-tip',
    file: join('bend2', 'src', 'git', 'land.bend'),
    find: '+same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), cand), False{})\n      ld_adv_wt_observed_target_same(same, path, target)',
    replace: '+same = Bool.pick(Bool, True{}, True{}, True{})\n      ld_adv_wt_observed_target_same(same, path, target)',
    law: 'm3a_held_target_tip_mismatch_refuses',
  },
);

function writeJson(path, value) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

async function runGate() {
  BEND = resolveBend();
  const rows = laws();
  const identity = sourceIdentity(rows);
  const controls = producerSet(rows, MUTATIONS);
  const compilerSha256 = await hashFile(BEND);
  const wrapperRequest = ENV.BATON2_GATE_REQUEST ?? null;
  const requestId = wrapperRequest ?? hash(stableJson({
    sourceSha256: identity.sha256,
    compilerSha256,
    node: process.version,
    entry: ENTRY,
    command: [ENTRY, '--check-only'],
    producers: controls.map(({ descriptorSha256 }) => descriptorSha256),
    output: '.scratch/bend2-laws-check',
  }));
  const requestParts = requestId.split('/');
  if (requestParts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error(`invalid BATON2_GATE_REQUEST path: ${requestId}`);
  }
  const runId = wrapperRequest ? requestId : `${hash(requestId)}-${randomUUID()}`;
  const runRoot = join(SCRATCH, ...runId.split('/'));
  const artifactRoot = join(runRoot, 'artifacts');
  mkdirSync(artifactRoot, { recursive: true });
  const controlsPath = join(runRoot, 'controls.json');
  writeJson(controlsPath, controls);
  const controlsArtifactSha256 = await hashFile(controlsPath);
  const dispatchedControls = controls.map((control) => ({ ...control, workToken: randomUUID() }));
  const dispatchesPath = join(runRoot, 'dispatches.json');
  writeJson(dispatchesPath, dispatchedControls);
  const dispatchesArtifactSha256 = await hashFile(dispatchesPath);
  const startedAt = new Date().toISOString();
  const versionOut = join(artifactRoot, 'compiler-version.stdout.log');
  const versionErr = join(artifactRoot, 'compiler-version.stderr.log');
  const versionRun = spawnSync(BEND, ['version'], { cwd: ROOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 });
  writeFileSync(versionOut, versionRun.stdout ?? '');
  writeFileSync(versionErr, versionRun.stderr ?? '');
  const version = (versionRun.stdout ?? '').trim();
  const toolchain = {
    bend: BEND,
    bendSha256: compilerSha256,
    version,
    versionExitCode: versionRun.status,
    versionSignal: versionRun.signal,
    versionError: versionRun.error ? `${versionRun.error.name}: ${versionRun.error.message}` : null,
    versionStdout: await hashFile(versionOut),
    versionStderr: await hashFile(versionErr),
  };
  toolchain.toolchainSha256 = hash(stableJson({
    bendSha256: toolchain.bendSha256,
    version: toolchain.version,
    node: process.version,
    cc: ENV.CC ?? null,
    ldLibraryPath: ENV.LD_LIBRARY_PATH ?? null,
  }));
  const metadata = {
    schema: 'bend2-laws-check-run-v1',
    runId,
    requestId,
    job: ENV.BATON2_GATE_JOB ?? null,
    startedAt,
    finishedAt: null,
    status: 'running',
    source: identity,
    entry: ENTRY,
    node: process.version,
    executionHost: { hostname: hostname(), platform: process.platform, arch: process.arch },
    toolchain,
    producerCount: null,
    producerSetSha256: hash(stableJson(controls)),
    controlsArtifactSha256,
    dispatchesIndex: dispatchesPath,
    dispatchesArtifactSha256,
    completedCount: 0,
    elapsedMs: null,
    baseline: null,
    capacity: null,
    controlsIndex: join(runRoot, 'controls.json'),
  };
  writeJson(join(runRoot, 'run.json'), metadata);
  console.log(JSON.stringify({
    event: 'run',
    requestId,
    job: metadata.job,
    runRoot,
    sourceSha256: identity.sha256,
    toolchainSha256: toolchain.toolchainSha256,
    producerCount: controls.length,
    producerSetSha256: metadata.producerSetSha256,
    producerSetArtifact: metadata.controlsIndex,
    dispatchesArtifact: metadata.dispatchesIndex,
  }));
  console.log(JSON.stringify({ check: 'compiler identity', version: toolchain.version, compilerSha256, passed: version === 'bend 2.0.25' && versionRun.status === 0 }));
  if (process.version !== 'v22.23.3' || version !== 'bend 2.0.25' || versionRun.status !== 0 || versionRun.error) {
    metadata.status = 'red';
    metadata.finishedAt = new Date().toISOString();
    writeJson(join(runRoot, 'run.json'), metadata);
    console.error(`expected Node v22.23.3 and bend 2.0.25, got Node ${process.version}, Bend ${version || toolchain.versionError || `exit ${versionRun.status}`}`);
    return 1;
  }

  const baselineCwd = join(runRoot, 'workspaces', 'entry-baseline');
  mkdirSync(dirname(baselineCwd), { recursive: true });
  cloneLinkedTree(join(ROOT, 'bend2'), join(baselineCwd, 'bend2'));
  const baselineStarted = process.hrtime.bigint();
  const baselineResult = await runCompiler(
    [ENTRY, '--check-only'],
    baselineCwd,
    join(artifactRoot, 'entry-baseline.stdout.log'),
    join(artifactRoot, 'entry-baseline.stderr.log'),
  );
  const baselineElapsedMs = Number(process.hrtime.bigint() - baselineStarted) / 1e6;
  const baselinePassed = baselineResult.exitCode === 0 && baselineResult.signal === null && baselineResult.startupError === null;
  const baseline = {
    ...baselineResult,
    passed: baselinePassed,
    elapsedMs: baselineElapsedMs,
    stdout: await excerpt(join(artifactRoot, 'entry-baseline.stdout.log')),
    stderr: await excerpt(join(artifactRoot, 'entry-baseline.stderr.log')),
  };
  baseline.stdout.sha256 = await hashFile(baseline.stdout.artifact);
  baseline.stderr.sha256 = await hashFile(baseline.stderr.artifact);
  console.log(JSON.stringify({
    check: 'entry compiles with every law proven',
    requestId,
    job: metadata.job,
    passed: baselinePassed,
    exitCode: baseline.exitCode,
    signal: baseline.signal,
    startupError: baseline.startupError,
    elapsedMs: baselineElapsedMs,
    peakRssBytes: baseline.maxRssBytes,
    stdout: { bytes: baseline.stdout.bytes, sha256: baseline.stdout.sha256, artifact: baseline.stdout.artifact },
    stderr: { bytes: baseline.stderr.bytes, sha256: baseline.stderr.sha256, artifact: baseline.stderr.artifact },
  }));
  metadata.baseline = baseline;
  if (!baselinePassed) {
    metadata.status = 'red';
    metadata.finishedAt = new Date().toISOString();
    metadata.elapsedMs = baselineElapsedMs;
    writeJson(join(runRoot, 'run.json'), metadata);
    return 1;
  }
  if (baseline.maxRssBytes === 0) {
    metadata.status = 'red';
    metadata.finishedAt = new Date().toISOString();
    metadata.failure = 'baseline compiler peak memory could not be measured';
    writeJson(join(runRoot, 'run.json'), metadata);
    console.error(metadata.failure);
    return 1;
  }

  const capacity = admittedConcurrency(Math.max(baseline.maxRssBytes, 1));
  metadata.capacity = capacity;
  metadata.producerCount = controls.length;
  console.log(JSON.stringify({ scheduler: 'admitted', ...capacity, producerCount: controls.length }));
  const controlsStarted = process.hrtime.bigint();
  const results = await runPool(dispatchedControls, capacity.admitted, runRoot);
  const controlsElapsedMs = Number(process.hrtime.bigint() - controlsStarted) / 1e6;
  const integrityFailures = await verifyResults(dispatchedControls, results);
  if (await hashFile(controlsPath) !== controlsArtifactSha256) {
    integrityFailures.push({ id: 'producer-set', reason: 'producer set artifact changed during execution' });
  }
  if (await hashFile(dispatchesPath) !== dispatchesArtifactSha256) {
    integrityFailures.push({ id: 'producer-dispatch', reason: 'producer dispatch artifact changed during execution' });
  }
  const completedCount = results.filter(({ completed }) => completed === true).length;
  const elapsedMs = baselineElapsedMs + controlsElapsedMs;
  const passed = integrityFailures.length === 0 && results.length === controls.length;
  metadata.status = passed ? 'green' : 'red';
  metadata.finishedAt = new Date().toISOString();
  metadata.completedCount = completedCount;
  metadata.elapsedMs = elapsedMs;
  metadata.controlsElapsedMs = controlsElapsedMs;
  metadata.integrityFailures = integrityFailures;
  metadata.resultsIndex = join(runRoot, 'results.json');
  writeJson(join(runRoot, 'results.json'), results);
  metadata.resultsArtifactSha256 = await hashFile(metadata.resultsIndex);
  writeJson(join(runRoot, 'run.json'), metadata);
  console.log(`laws-check: ${passed ? 'green' : 'red'} - ${rows.length} laws, ${MUTATIONS.length} mutations, ${rows.length + MUTATIONS.length + 1} compiles, ${integrityFailures.length} failures`);
  if (!passed) console.error(JSON.stringify({ integrityFailures }));
  return passed ? 0 : 1;
}

export { runGate };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runGate().then((status) => { process.exitCode = status; }).catch((error) => {
    console.error(`laws-check: red - ${error.stack ?? error}`);
    process.exitCode = 1;
  });
}

// Serial execution of one module group: the baseline once, then every control
// of the module against a run-private scratch copy, one compiler process at a
// time. Every child runs behind the time tool; the manifest retains complete
// streams, the applied source delta bytes, the actual termination shape
// including the child process id and wrapper-translated signals, resource
// samples with explicit units, and the producing input identities. The runner
// records what happened; acceptance is a separate verification step.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ENV, ENTRY, proofBlockRange, resolveBend, ROOT } from '../laws-check.mjs';
import { MUTATIONS } from '../laws-mutations.mjs';
import { classifyControl, parseResourceAccounting, splitTimeAccounting } from './classify.mjs';
import { bindingOf, discoveryRecords, sha256Hex } from './work-set.mjs';

export class UsageError extends Error {}

const GROUP_OPTIONS = {
  '--group': 'module',
  '--evidence-dir': 'evidenceDir',
  '--time-tool': 'timeTool',
  '--time-flag': 'timeFlag',
  '--bend': 'bend',
  '--compiler-archive': 'compilerArchive',
  '--expectations': 'expectations',
};

export function parseGroupArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const field = GROUP_OPTIONS[argv[i]];
    if (!field) throw new UsageError(`group: unknown option ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`group: option ${argv[i]} needs a value`);
    }
    if (parsed[field] !== undefined) throw new UsageError(`group: option ${argv[i]} given twice`);
    parsed[field] = value;
    i++;
  }
  for (const flag of ['--group', '--evidence-dir', '--time-tool', '--time-flag']) {
    if (parsed[GROUP_OPTIONS[flag]] === undefined) throw new UsageError(`group: option ${flag} is required`);
  }
  return parsed;
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: Infinity }).trim();
}

function origin() {
  return {
    workflow: process.env.GITHUB_WORKFLOW ?? null,
    run_id: process.env.GITHUB_RUN_ID ?? null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    jobs: process.env.GITHUB_JOB ? [process.env.GITHUB_JOB] : [],
    image_os: process.env.ImageOS ?? null,
    image_version: process.env.ImageVersion ?? null,
  };
}

function streamReceipt(dir, name, buffer) {
  writeFileSync(join(dir, name), buffer);
  return { path: name, bytes: buffer.byteLength, sha256: sha256Hex(buffer) };
}

function fileName(record, kind) {
  const safe = record.id.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${safe}.${kind}`;
}

// A wrapper-translated termination: darwin /usr/bin/time reports a child
// killed by a signal in its own stderr and exits normally. The wrapper's
// report, not a bare exit code, is the signal evidence.
const WRAPPER_SIGNAL = /Command terminated by signal (\d+)/;

// Spawn the time tool around one child and observe its actual termination.
// The wrapper shares the child's stderr, so its accounting arrives after the
// child's diagnostics in the same stream; the complete stream is retained.
function runChild({ argv, cwd, env, dir, stdoutName, stderrName }) {
  const started = Date.now() / 1000;
  return new Promise((settle) => {
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      const ended = Date.now() / 1000;
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      const stderrText = stderrBytes.toString('utf8');
      let { state, exitCode, signal } = outcome;
      if (state === 'exited' && exitCode !== 0 && exitCode !== null) {
        const translated = WRAPPER_SIGNAL.exec(stderrText);
        if (translated) {
          state = 'signalled';
          signal = Number(translated[1]);
        }
      }
      settle({
        state,
        exitCode,
        signal: signal ?? null,
        spawnError: outcome.spawnError ?? null,
        pid: outcome.pid ?? null,
        started,
        ended,
        stdout: streamReceipt(dir, stdoutName, stdoutBytes),
        stderr: streamReceipt(dir, stderrName, stderrBytes),
      });
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish({ state: 'spawn-error', exitCode: null, signal: null, spawnError: String(error?.code ?? error), pid: null });
      return;
    }
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      finish({ state: 'spawn-error', exitCode: null, signal: null, spawnError: String(error?.code ?? error), pid: child.pid ?? null });
    });
    child.on('close', (code, signal) => {
      finish({ state: 'exited', exitCode: code, signal: signal ?? null, spawnError: null, pid: child.pid ?? null });
    });
  });
}

function processRecord(run, attempt) {
  return {
    state: run.state,
    exit_code: run.exitCode,
    signal: run.signal,
    spawn_error: run.spawnError,
    started: run.started,
    ended: run.ended,
    attempt,
    pid: run.pid,
  };
}

function inventory(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push({ path: relative(root, full).split('/').join('/'), sha256: sha256Hex(readFileSync(full)) });
    }
  };
  walk(root);
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    directory: root,
    files: rows.length,
    sha256: sha256Hex(rows.map((row) => `${row.path} ${row.sha256}`).join('\n')),
  };
}

function definitionsByName(custom) {
  const map = new Map();
  for (const definition of custom ?? MUTATIONS) map.set(definition.name, definition);
  return map;
}

export async function runGroup({
  module,
  evidenceDir,
  timeTool,
  timeFlag,
  bend,
  records,
  mutationDefinitions,
  expectations,
  compilerArchive,
  copyDir,
  entry,
  sourceRoot,
  scratchPrefix,
}) {
  const groupRecords = records.filter((record) => record.module === module);
  if (groupRecords.length === 0) throw new Error(`runGroup: no controls target module ${module}`);
  if (!existsSync(timeTool)) throw new Error(`runGroup: time tool is unavailable: ${timeTool}`);
  const bendPath = resolve(bend);
  const version = execFileSync(bendPath, ['version'], { env: ENV, encoding: 'utf8', maxBuffer: Infinity }).trim();
  if (version !== 'bend 2.0.25') throw new Error(`runGroup: expected bend 2.0.25, got: ${version}`);

  mkdirSync(evidenceDir, { recursive: true });
  const scratch = mkdtempSync(join(ROOT, '.scratch', scratchPrefix ?? 'bend2-laws-group-'));
  cpSync(copyDir ?? join(ROOT, 'bend2'), join(scratch, 'bend2'), { recursive: true });

  const compiler = { path: bendPath, version, sha256: sha256Hex(readFileSync(bendPath)) };
  const checkerPath = join(ROOT, 'bend2', 'scripts', 'laws-check.mjs');
  const checkerSha256 = sha256Hex(readFileSync(checkerPath));
  const archive = compilerArchive
    ? { path: resolve(compilerArchive), bytes: statSync(resolve(compilerArchive)).size, sha256: sha256Hex(readFileSync(resolve(compilerArchive))) }
    : null;
  const runtimeDirectory = join(dirname(bendPath), '..', '..', 'bend2');
  const runtime = existsSync(runtimeDirectory) ? inventory(runtimeDirectory) : null;
  const sourceRootDir = sourceRoot ?? ROOT;
  const hasGit = existsSync(join(sourceRootDir, '.git'));
  const source = hasGit
    ? {
        head: git(sourceRootDir, 'rev-parse', 'HEAD'),
        tree: git(sourceRootDir, 'rev-parse', 'HEAD^{tree}'),
        bend2_tree: git(sourceRootDir, 'rev-parse', 'HEAD:bend2'),
      }
    : { head: null, tree: null, bend2_tree: null };
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const producingOrigin = {
    ...origin(),
    job: [process.env.GITHUB_JOB ?? 'local', process.env.GITHUB_RUN_ATTEMPT ?? '0', module, nonce].join(':'),
  };
  const producing = { source, compiler, archive, runtime, origin: producingOrigin };
  const instrument = { tool: timeTool, flag: timeFlag };
  const expectationById = expectations ?? {};

  const childArgv = [timeTool, timeFlag, bendPath, entry ?? ENTRY, '--check-only'];

  const baselineRun = await runChild({
    argv: childArgv,
    cwd: scratch,
    env: ENV,
    dir: evidenceDir,
    stdoutName: 'baseline.stdout',
    stderrName: 'baseline.stderr',
  });
  const baseline = {
    argv: [bendPath, entry ?? ENTRY, '--check-only'],
    process: processRecord(baselineRun, `${module}-baseline-${nonce}`),
    stdout: baselineRun.stdout,
    stderr: baselineRun.stderr,
    inputs: {
      compiler_sha256: compiler.sha256,
      archive_sha256: archive?.sha256 ?? null,
      runtime_sha256: runtime?.sha256 ?? null,
    },
  };
  if (baseline.process.state !== 'exited' || baseline.process.exit_code !== 0) {
    const manifest = {
      module, binding: bindingOf(records), checker_sha256: checkerSha256, source, origin: origin(),
      producing, instrument, baseline, results: [], compiler,
    };
    const manifestPath = join(evidenceDir, 'group-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return { manifest, manifestPath, scratch };
  }

  // Pristine text per control module, read from the scratch copy right after
  // it was made. Restores never re-read the live tree, and each control's
  // changed bytes are retained as its exact applied delta.
  const pristine = new Map();
  for (const record of groupRecords) {
    const scratchModule = join(scratch, record.module);
    if (!pristine.has(record.module)) pristine.set(record.module, readFileSync(scratchModule, 'utf8'));
  }
  const definitions = definitionsByName(mutationDefinitions);

  const results = [];
  for (const record of groupRecords) {
    const scratchModule = join(scratch, record.module);
    const originalText = pristine.get(record.module);
    let setup = 'applied';
    let changedText = null;
    if (record.kind === 'proof-removal') {
      if (!removeProofText(scratchModule, record.law)) setup = 'missing';
      else changedText = readFileSync(scratchModule, 'utf8');
    } else {
      const definition = definitions.get(record.id.slice('mutation:'.length));
      if (!definition) throw new Error(`runGroup: no definition for ${record.id}`);
      if (!originalText.includes(definition.find)) {
        setup = 'missing';
      } else {
        // Defined first-occurrence replacement semantics, unchanged; the law
        // suffix stays byte-identical for accepted controls.
        changedText = originalText.replace(definition.find, definition.replace);
        writeFileSync(scratchModule, changedText);
      }
    }
    if (setup === 'applied') {
      const run = await runChild({
        argv: childArgv,
        cwd: scratch,
        env: ENV,
        dir: evidenceDir,
        stdoutName: fileName(record, 'stdout'),
        stderrName: fileName(record, 'stderr'),
      });
      writeFileSync(scratchModule, originalText);
      const changedPath = fileName(record, 'changed');
      writeFileSync(join(evidenceDir, changedPath), changedText);
      const { diagnostics, accounting, profile } = splitTimeAccounting(
        readFileSync(join(evidenceDir, fileName(record, 'stderr')), 'utf8'),
      );
      const verdict = classifyControl({
        state: run.state, exitCode: run.exitCode, signal: run.signal, spawnError: run.spawnError,
        stderrText: diagnostics, control: record, expectation: expectationById[record.id],
      });
      results.push({
        case: record,
        setup,
        expectation: expectationById[record.id] ?? null,
        delta: {
          original_sha256: sha256Hex(Buffer.from(originalText, 'utf8')),
          changed_sha256: sha256Hex(Buffer.from(changedText, 'utf8')),
          changed_path: changedPath,
        },
        process: processRecord(run, `${record.id}-${nonce}-${results.length}`),
        diagnostic: {
          class: verdict.class,
          attributed_law: verdict.attributedLaw,
          sha256: sha256Hex(diagnostics),
        },
        stdout: run.stdout,
        stderr: run.stderr,
        resource: parseResourceAccounting(accounting, profile),
      });
    } else {
      results.push({
        case: record,
        setup,
        expectation: expectationById[record.id] ?? null,
        delta: null,
        process: { state: 'not-run', exit_code: null, signal: null, spawn_error: null, started: null, ended: null, attempt: null, pid: null },
        diagnostic: { class: 'not-run', attributed_law: null, sha256: null },
        stdout: { path: null, bytes: null, sha256: null },
        stderr: { path: null, bytes: null, sha256: null },
        resource: null,
      });
    }
  }

  const manifest = {
    module,
    binding: bindingOf(records),
    checker_sha256: checkerSha256,
    source,
    origin: origin(),
    producing,
    instrument,
    baseline,
    results,
    compiler,
  };
  const manifestPath = join(evidenceDir, 'group-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, manifestPath, scratch };
}

// removeProof against a scratch module, kept here so the delta capture and the
// checker share the block-boundary definition.
function removeProofText(modulePath, name) {
  const text = readFileSync(modulePath, 'utf8');
  const block = proofBlockRange(text, name);
  if (!block) return false;
  block.lines.splice(block.start, block.end - block.start);
  writeFileSync(modulePath, block.lines.join('\n'));
  return true;
}

export async function groupCli(argv) {
  let args;
  try {
    args = parseGroupArgs(argv);
  } catch (error) {
    console.error(error instanceof UsageError ? error.message : error);
    process.exit(2);
  }
  const bend = resolveBend(args.bend);
  let expectations;
  if (args.expectations !== undefined) {
    try {
      expectations = JSON.parse(readFileSync(args.expectations, 'utf8'));
    } catch (error) {
      console.error(`group: expectations file is unreadable: ${error}`);
      process.exit(2);
    }
  }
  const { manifestPath } = await runGroup({
    module: args.module,
    evidenceDir: args.evidenceDir,
    timeTool: args.timeTool,
    timeFlag: args.timeFlag,
    bend,
    records: discoveryRecords(),
    expectations,
    compilerArchive: args.compilerArchive,
  });
  console.log(JSON.stringify({ manifest: manifestPath }));
}

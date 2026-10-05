// Serial execution of one module group: the baseline once, then every control
// of the module against a run-private scratch copy, one compiler process at a
// time. Every child runs behind the time tool; the manifest retains complete
// streams, the applied source delta bytes, the actual termination shape
// including the child process id and wrapper-translated signals, resource
// samples with explicit units, and the producing input identities. The runner
// records what happened; acceptance is a separate verification step.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ENV, ENTRY, proofBlockRange, resolveBend, ROOT } from '../laws-common.mjs';
import { MUTATIONS } from '../laws-mutations.mjs';
import { classifyCase, parseResourceAccounting, splitTimeAccounting } from './classify.mjs';
import { bindingOf, definitionExpectation, definitionLocation, discoveryRecords, sha256Hex } from './work-set.mjs';

export class UsageError extends Error {}

const GROUP_OPTIONS = {
  '--group': 'module',
  '--evidence-dir': 'evidenceDir',
  '--time-tool': 'timeTool',
  '--time-flag': 'timeFlag',
  '--bend': 'bend',
  '--compiler-archive': 'compilerArchive',
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
      let wrapperExitCode = state === 'exited' ? exitCode : null;
      if (state === 'exited' && exitCode !== 0 && exitCode !== null) {
        const translated = WRAPPER_SIGNAL.exec(stderrText);
        if (translated) {
          // The wrapper's own nonzero exit is retained as wrapper evidence;
          // the inferred compiler signal is the recorded child signal. No
          // normal exit is invented for the compiler.
          state = 'signalled';
          wrapperExitCode = exitCode;
          exitCode = null;
          // Receipt contract: signals are non-empty strings, never numbers.
          signal = translated[1];
        }
      }
      settle({
        state,
        exitCode,
        signal: signal ?? null,
        spawnError: outcome.spawnError ?? null,
        wrapperExitCode,
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
      // The wrapper's actual termination is preserved verbatim; only the
      // wrapper-translated compiler inference above may relabel the child,
      // and it binds the wrapper evidence separately.
      finish({
        state: signal !== null ? 'signalled' : 'exited',
        exitCode: signal !== null ? null : code,
        signal: signal ?? null,
        spawnError: null,
        pid: child.pid ?? null,
        wrapperExitCode: signal !== null ? null : code,
        wrapperSignal: signal ?? null,
      });
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
    // The observed process id, exit status and signal belong to the spawned
    // time wrapper; the compiler's pid is not observable through it, and a
    // translated signal carries no compiler exit code.
    wrapper_pid: run.pid,
    wrapper_exit_code: run.wrapperExitCode ?? null,
    wrapper_signal: run.wrapperSignal ?? null,
  };
}

function inventory(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(`inventory: the runtime set must hold regular files only; symlink at ${join(dir, entry.name)}`);
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) rows.push({ path: relative(root, full).split(sep).join('/'), sha256: sha256Hex(readFileSync(full)) });
    }
  };
  walk(root);
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    directory: root,
    files: rows.length,
    sha256: sha256Hex(rows.map((row) => `${row.path}\t${row.sha256}`).join('\n')),
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
  compilerArchive,
  copyDir,
  entry,
  sourceRoot,
  scratchPrefix,
}) {
  if (!existsSync(timeTool)) throw new Error(`runGroup: time tool is unavailable: ${timeTool}`);
  const bendPath = resolve(bend);
  const version = execFileSync(bendPath, ['version'], { env: ENV, encoding: 'utf8', maxBuffer: Infinity }).trim();
  if (version !== 'bend 2.0.25') throw new Error(`runGroup: expected bend 2.0.25, got: ${version}`);
  const selectedEntry = entry ?? ENTRY;

  // The source snapshot is read before the tree is copied, so the recorded
  // git identity belongs to the same bytes the copy carries.
  const sourceRootDir = sourceRoot ?? ROOT;
  const hasGit = existsSync(join(sourceRootDir, '.git'));
  const source = hasGit
    ? {
        head: git(sourceRootDir, 'rev-parse', 'HEAD'),
        tree: git(sourceRootDir, 'rev-parse', 'HEAD^{tree}'),
        bend2_tree: git(sourceRootDir, 'rev-parse', 'HEAD:bend2'),
      }
    : { head: null, tree: null, bend2_tree: null };

  mkdirSync(join(ROOT, '.scratch'), { recursive: true });
  const scratch = mkdtempSync(join(ROOT, '.scratch', scratchPrefix ?? 'bend2-laws-group-'));
  cpSync(copyDir ?? join(ROOT, 'bend2'), join(scratch, 'bend2'), { recursive: true });
  // Records default to the copied snapshot, so discovery, compiles and deltas
  // bind one source tree. The executed selection filters the module's cases;
  // the binding covers the complete discovered set.
  const groupRecords = records ?? discoveryRecords({ bend2Dir: join(scratch, 'bend2') });
  const binding = bindingOf(groupRecords);
  const selected = groupRecords.filter((record) => record.module === module);
  if (selected.length === 0) {
    throw new Error(`runGroup: no controls target module ${module}`);
  }

  const compiler = { path: bendPath, version, sha256: sha256Hex(readFileSync(bendPath)) };
  const checkerPath = join(ROOT, 'bend2', 'scripts', 'laws-check.mjs');
  const checkerSha256 = sha256Hex(readFileSync(checkerPath));
  const archive = compilerArchive
    ? { path: resolve(compilerArchive), bytes: statSync(resolve(compilerArchive)).size, sha256: sha256Hex(readFileSync(resolve(compilerArchive))) }
    : null;
  // The installed library sits one parent above the compiler's bin directory.
  const runtimeDirectory = join(dirname(bendPath), '..', 'bend2');
  const runtime = existsSync(runtimeDirectory) ? inventory(runtimeDirectory) : null;
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const producingOrigin = {
    ...origin(),
    job: [process.env.GITHUB_JOB ?? 'local', process.env.GITHUB_RUN_ATTEMPT ?? '0', module, nonce].join(':'),
  };
  const instrument = { tool: timeTool, flag: timeFlag };
  const producing = {
    source,
    compiler,
    checker_sha256: checkerSha256,
    archive,
    runtime,
    runtime_set_sha256: runtime?.sha256 ?? null,
    origin: producingOrigin,
  };
  mkdirSync(evidenceDir, { recursive: true });

  // Pristine original bytes per executed control module, read from the
  // scratch copy before any child runs, so the snapshot is stable across the
  // whole group. Text transforms decode explicitly; restoration writes and
  // verifies the exact original bytes. Restores never re-read the live tree,
  // and each control's changed bytes are retained as its exact applied delta.
  const pristine = new Map();
  for (const record of selected) {
    const scratchModule = join(scratch, record.module);
    if (!pristine.has(record.module)) pristine.set(record.module, readFileSync(scratchModule));
  }
  const definitions = definitionsByName(mutationDefinitions);

  const childArgv = [timeTool, timeFlag, bendPath, selectedEntry, '--check-only'];

  const baselineRun = await runChild({
    argv: childArgv,
    cwd: scratch,
    env: ENV,
    dir: evidenceDir,
    stdoutName: 'baseline.stdout',
    stderrName: 'baseline.stderr',
  });
  const baseline = {
    argv: [bendPath, selectedEntry, '--check-only'],
    process: processRecord(baselineRun, `${module}-baseline-${nonce}`),
    stdout: baselineRun.stdout,
    stderr: baselineRun.stderr,
    inputs: {
      compiler_sha256: compiler.sha256,
      checker_sha256: checkerSha256,
      archive_sha256: archive?.sha256 ?? null,
      runtime_set_sha256: runtime?.sha256 ?? null,
    },
  };
  if (baseline.process.state !== 'exited' || baseline.process.exit_code !== 0) {
    // The baseline ran no transforms, but the invariant still holds and is
    // proven before the failed-baseline manifest is written.
    verifyRestored();
    const manifest = {
      module, binding, entry: selectedEntry, checker_sha256: checkerSha256, source, origin: origin(),
      producing, instrument, baseline, results: [], compiler,
    };
    const manifestPath = join(evidenceDir, 'group-manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    return { manifest, manifestPath, scratch };
  }

  // Every executed control runs against the stable pristine snapshot, and the
  // whole selected module set must match it again, byte for byte, after each
  // terminal path.
  const verifyRestored = () => {
    for (const [recordModule, bytes] of pristine) {
      if (!readFileSync(join(scratch, recordModule)).equals(bytes)) {
        throw new Error(`runGroup: restoration verification failed for ${recordModule}`);
      }
    }
  };

  const results = [];
  let manifestStatus = 'incomplete';
  let persisted = null;
  const persistManifest = () => {
    const manifest = {
      module,
      binding,
      entry: selectedEntry,
      status: manifestStatus,
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
    return { manifest, manifestPath };
  };
  try {
    for (const record of selected) {
    const scratchModule = join(scratch, record.module);
    const originalBytes = pristine.get(record.module);
    const originalText = originalBytes.toString("utf8");
    let setup = 'applied';
    let changedText = null;
    let expectedChangedText = null;
    try {
      if (record.kind === 'proof-removal') {
        const block = proofBlockRange(originalText, record.law);
        if (!block) {
          setup = 'missing';
        } else {
          const lines = originalText.split('\n');
          lines.splice(block.start, block.end - block.start);
          expectedChangedText = lines.join('\n');
          removeProofText(scratchModule, record.law);
          changedText = readFileSync(scratchModule, 'utf8');
          if (changedText !== expectedChangedText) {
            throw new Error(`runGroup: proof application mismatch for ${record.id}`);
          }
        }
      } else {
        const definition = definitions.get(record.id.slice('mutation:'.length));
        if (!definition) throw new Error(`runGroup: no definition for ${record.id}`);
        if (!originalText.includes(definition.find)) {
          setup = 'missing';
        } else {
          // Defined first-occurrence replacement semantics, unchanged; the law
          // suffix stays byte-identical for accepted controls.
          expectedChangedText = originalText.replace(definition.find, definition.replace);
          writeFileSync(scratchModule, expectedChangedText);
          changedText = readFileSync(scratchModule, 'utf8');
          if (changedText !== expectedChangedText) {
            throw new Error(`runGroup: mutation application mismatch for ${record.id}`);
          }
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
        const changedPath = fileName(record, 'changed');
        writeFileSync(join(evidenceDir, changedPath), changedText);
        const stderrText = readFileSync(join(evidenceDir, fileName(record, 'stderr')), 'utf8');
        // One shared qualification boundary: the complete stream, the matched
        // baseline, the definition-bound metadata and the exact applied delta.
        const definition = definitions.get(record.id.slice('mutation:'.length));
        const verdict = classifyCase({
          control: record,
          expectation: definitionExpectation(definition),
          location: definitionLocation(definition),
          state: run.state, exitCode: run.exitCode, signal: run.signal, spawnError: run.spawnError,
          stderrText,
          baselineOk: baseline.process.state === 'exited' && baseline.process.exit_code === 0,
          delta: { changedText, expectedChangedText },
          supplied: null,
        });
        const { accounting, profile } = splitTimeAccounting(stderrText);
        results.push({
          case: record,
          setup,
          expectation: definitionExpectation(definition) ?? null,
          delta: {
            original_sha256: sha256Hex(originalBytes),
            changed_sha256: sha256Hex(readFileSync(join(evidenceDir, changedPath))),
            changed_path: changedPath,
          },
          process: processRecord(run, `${record.id}-${nonce}-${results.length}`),
          diagnostic: {
            class: verdict.class,
            attributed_law: verdict.attributedLaw,
            sha256: sha256Hex(splitTimeAccounting(stderrText).diagnostics),
          },
          stdout: run.stdout,
          stderr: run.stderr,
          resource: parseResourceAccounting(accounting, profile),
        });
      } else {
        results.push({
          case: record,
          setup,
          expectation: definitionExpectation(definitions.get(record.id.slice('mutation:'.length))) ?? null,
          delta: null,
          process: { state: 'not-run', exit_code: null, signal: null, spawn_error: null, started: null, ended: null, attempt: null, wrapper_pid: null },
          diagnostic: { class: 'not-run', attributed_law: null, sha256: null },
          stdout: { path: null, bytes: null, sha256: null },
          stderr: { path: null, bytes: null, sha256: null },
          resource: null,
        });
      }
    } finally {
      for (const [restoredModule, bytes] of pristine) {
        writeFileSync(join(scratch, restoredModule), bytes);
      }
      verifyRestored();
    }
  }
  manifestStatus = 'complete';
  } finally {
    // Every terminal path leaves a manifest: complete after the loop, or
    // incomplete with the results and case artifacts collected so far.
    persisted = persistManifest();
  }
  return { manifest: persisted.manifest, manifestPath: persisted.manifestPath, scratch };
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
  const { manifestPath } = await runGroup({
    module: args.module,
    evidenceDir: args.evidenceDir,
    timeTool: args.timeTool,
    timeFlag: args.timeFlag,
    bend,
    compilerArchive: args.compilerArchive,
  });
  console.log(JSON.stringify({ manifest: manifestPath }));
}

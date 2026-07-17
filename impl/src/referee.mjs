// referee.mjs — THE TRUST GATE. Re-runs the task's *pinned* verification command in a
// fresh sandbox the worker never controlled, and derives a Verdict the coordinator can
// actually trust. The worker's self-reported exit code is used only to detect
// divergence, never as evidence of anything (R2).
//
// D6 (spec/RECONCILIATION.md, authoritative — resolves red workers-trust#1/#4): the
// freshness guard is MANDATORY, not opt-in. `task.workerWorktreeDir` is REQUIRED —
// `verify()` rejects if it's missing (distinct from rejecting because it EQUALS
// sandbox.dir, which is `SameWorktreeError`).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;

export function prepareVerificationRuntime(policy) {
  const fields = ['constants', 'pathEntries', 'schemaVersion'];
  if (!policy || Object.keys(policy).sort().join(',') !== fields.join(',')
    || policy.schemaVersion !== 1 || !Array.isArray(policy.pathEntries) || policy.pathEntries.length === 0
    || policy.pathEntries.some((entry) => typeof entry !== 'string' || !isAbsolute(entry) || entry.includes('\0'))
    || new Set(policy.pathEntries).size !== policy.pathEntries.length
    || !policy.constants || typeof policy.constants !== 'object' || Array.isArray(policy.constants)
    || Object.entries(policy.constants).some(([name, value]) => (
      !/^[A-Z][A-Z0-9_]*$/u.test(name) || /(?:HOME|TOKEN|KEY|SECRET|CREDENTIAL|AUTH)/u.test(name)
      || name === 'PATH' || typeof value !== 'string' || value.includes('\0')
    ))) {
    throw new TypeError('verification runtime must be a closed deployment policy');
  }
  const pathEntries = Object.freeze([...policy.pathEntries]);
  const constants = Object.freeze({ ...policy.constants });
  const authority = { schemaVersion: 1, pathEntries, constants };
  const environment = Object.freeze({ ...constants, PATH: pathEntries.join(':') });
  return Object.freeze({ authority: Object.freeze(authority), environment, digest: createHash('sha256').update(JSON.stringify(canonical(authority))).digest('hex') });
}

export function defaultVerificationRuntime() {
  const candidates = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return prepareVerificationRuntime({ schemaVersion: 1, pathEntries: candidates.filter((entry) => existsSync(entry)), constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } });
}

export class SameWorktreeError extends Error {
  constructor(message) { super(message); this.name = 'SameWorktreeError'; }
}

// Commands containing real shell control operators (chaining, pipes, redirects,
// substitution) need genuine `sh -c` semantics. Everything else is tokenized and
// exec'd directly, without a shell, which sidesteps a real POSIX-shell quirk: a
// command whose LAST argument is a `"..."`-wrapped payload that itself contains
// escaped double quotes (e.g. a `node -e "console.log(\"...json...\")"` coverage
// reporter) gets that payload's own string-literal quoting stripped/mangled by a
// second layer of shell parsing under `sh -c` — no POSIX-compliant shell avoids
// this, since it is standard (if surprising) double-quote nesting behavior.
function looksLikeSimpleCommand(command) {
  return !/[|&;<>`]|\$\(/.test(command);
}

/** Whitespace-splits `command` into argv, treating a `"`/`'`-delimited span (matched
 * greedily against the LAST occurrence of that quote character in the string) as one
 * literal token — no escape-processing inside it, so an embedded `\"` survives intact
 * for the invoked program's OWN parser (e.g. Node's `-e` argument) to interpret. */
function tokenize(command) {
  const tokens = [];
  let i = 0;
  const n = command.length;
  while (i < n) {
    while (i < n && /\s/.test(command[i])) i += 1;
    if (i >= n) break;
    const ch = command[i];
    if (ch === '"' || ch === "'") {
      const lastQuote = command.lastIndexOf(ch);
      if (lastQuote > i) {
        tokens.push(command.slice(i + 1, lastQuote));
        i = lastQuote + 1;
        continue;
      }
    }
    let j = i;
    while (j < n && !/\s/.test(command[j])) j += 1;
    tokens.push(command.slice(i, j));
    i = j;
  }
  return tokens;
}

function runCommand(command, cwd, timeoutMs, environment, signal = null) {
  return new Promise((resolve) => {
    const preferDirect = looksLikeSimpleCommand(command);
    const directArgv = preferDirect ? tokenize(command) : [];
    let usingDirect = preferDirect && directArgv.length > 0;

    const spawnDirect = () => spawn(directArgv[0], directArgv.slice(1), { cwd, detached: true, env: environment });
    const spawnShell = () => spawn('sh', ['-c', command], { cwd, detached: true, env: environment });

    let child = usingDirect ? spawnDirect() : spawnShell();
    const chunks = [];
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timer;

    const onAbort = () => {
      aborted = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode: timedOut || aborted ? null : exitCode, output: Buffer.concat(chunks).toString('utf8'), timedOut, outputExceeded: false, aborted });
    };

    const armTimer = () => {
      timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
      }, timeoutMs);
    };

    const wire = () => {
      child.stdout?.on('data', (d) => chunks.push(d));
      child.stderr?.on('data', (d) => chunks.push(d));
      child.on('error', (err) => {
        // The direct-exec path assumed the first token names a real executable on PATH;
        // if that assumption was wrong (ENOENT), fall back to a real shell once.
        if (usingDirect && err && err.code === 'ENOENT') {
          usingDirect = false;
          clearTimeout(timer);
          child = spawnShell();
          armTimer();
          wire();
          return;
        }
        finish(null);
      });
      child.on('close', (code) => finish(code));
    };

    armTimer();
    wire();
  });
}

function runClosedCommand(verification, sandboxDir, timeoutMs, runtime, signal = null) {
  return new Promise((settle) => {
    const root = resolve(sandboxDir);
    const cwd = resolve(root, verification.cwd);
    if (cwd !== root && !cwd.startsWith(`${root}${sep}`)) {
      settle({ exitCode: null, output: '', timedOut: false, outputExceeded: false, invalid: 'cwd_outside_sandbox' });
      return;
    }
    const env = Object.fromEntries(verification.envAllowlist
      .filter((name) => Object.hasOwn(runtime.environment, name))
      .map((name) => [name, runtime.environment[name]]));
    const child = spawn(verification.command, verification.arguments, { cwd, detached: true, env, shell: false });
    const chunks = []; let bytes = 0; let settled = false; let timedOut = false; let outputExceeded = false; let aborted = false; let timer;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } } };
    const onAbort = () => { aborted = true; stop(); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const finish = (exitCode) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle({ exitCode: timedOut || outputExceeded || aborted ? null : exitCode, output: Buffer.concat(chunks).toString('utf8'), timedOut, outputExceeded, aborted });
    };
    const capture = (chunk) => {
      if (outputExceeded) return;
      const remaining = verification.maxOutputBytes - bytes;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        bytes = verification.maxOutputBytes; outputExceeded = true; stop(); return;
      }
      chunks.push(chunk); bytes += chunk.length;
    };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    child.on('error', () => finish(null)); child.on('close', (code) => finish(code));
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  });
}

function runtimeEnvironmentFor(verification, runtime) {
  // Structured Plan contracts name their complete allowlist. Legacy string contracts predate that
  // field; retain only the deployment-owned PATH needed to resolve their command, never ambient
  // process values.
  const names = Array.isArray(verification.envAllowlist) ? verification.envAllowlist : ['PATH'];
  return Object.fromEntries(names
    .filter((name) => Object.hasOwn(runtime.environment, name))
    .map((name) => [name, runtime.environment[name]]));
}

function runPinnedVerification(verification, sandboxDir, timeoutMs, runtime, signal = null) {
  if (Array.isArray(verification.arguments)) return runClosedCommand(verification, sandboxDir, timeoutMs, runtime, signal);
  return runCommand(verification.command, sandboxDir, timeoutMs, runtimeEnvironmentFor(verification, runtime), signal);
}

const executionOf = (run) => run.outputExceeded
  ? { state: 'output_exceeded', code: 'verification_output_exceeded' }
  : run.timedOut ? { state: 'timed_out', code: 'verification_timed_out' }
    : run.exitCode == null ? { state: 'unavailable', code: 'verification_spawn_unavailable' }
      : { state: 'completed', code: 'verification_completed' };

/**
 * Re-derive the truth of a worker's result.
 * @param {object} task
 * @param {object} result
 * @param {{dir:string, sha:string, cleanup:() => Promise<void>}} sandbox
 * @param {{baseSandbox?: object, requireRedGreen?: boolean, requireCoverage?: boolean, requireMutation?: boolean, log?: object, worker?: string}} [opts]
 * @returns {Promise<object>} Verdict
 * @throws {SameWorktreeError}
 */
export async function verify(task, result, sandbox, opts = {}) {
  if (!('workerWorktreeDir' in task) || task.workerWorktreeDir == null) {
    throw new Error(
      'verify: task.workerWorktreeDir is required (D6 — the freshness guard is mandatory, not opt-in; '
      + 'omitting it silently disarms Invariant R1)',
    );
  }
  if (task.workerWorktreeDir === sandbox.dir) {
    throw new SameWorktreeError(
      `verify: sandbox.dir (${sandbox.dir}) equals task.workerWorktreeDir — refusing to trust-gate a worker's own worktree (R1)`,
    );
  }

  const timeoutMs = task.verification.timeoutMs ?? 120000;
  const runtime = opts.runtime ?? defaultVerificationRuntime();
  const abortError = () => Object.assign(new Error('verification was cancelled by its caller before completing'), { code: 'verification_aborted' });
  if (opts.signal?.aborted) throw abortError();

  const start = Date.now();
  const resultRun = await runPinnedVerification(task.verification, sandbox.dir, timeoutMs, runtime, opts.signal ?? null);
  const durationMs = Date.now() - start;
  // Caller cancellation is not a verifier truth state: no verdict may be derived from a
  // run whose process group was killed by external authority rather than its own contract.
  if (opts.signal?.aborted || resultRun.aborted) throw abortError();

  const observedExit = resultRun.timedOut ? null : resultRun.exitCode;
  const claimedExit = result?.verification?.claimedExit ?? null;
  // A worker that makes no exit claim (a subprocess adapter that doesn't run its own
  // verification passes claimedExit=null) hasn't "diverged" — there is nothing to
  // diverge from. Only a claim that contradicts the hub's observation is a divergence.
  const hadClaim = claimedExit !== null;
  const matchesClaim = !hadClaim || observedExit === claimedExit;
  const execution = executionOf(resultRun);
  const passed = execution.state === 'completed' && observedExit === task.verification.expectExit;

  let redGreen = null;
  let baseExit = null;
  let baseExecution = null;
  if (opts.baseSandbox && (passed || opts.classifyFailureOwnership)) {
    const baseRun = await runPinnedVerification(task.verification, opts.baseSandbox.dir, timeoutMs, runtime, opts.signal ?? null);
    if (opts.signal?.aborted || baseRun.aborted) throw abortError();
    baseExecution = executionOf(baseRun);
    baseExit = baseRun.timedOut ? null : baseRun.exitCode;
    redGreen = passed && baseExit !== task.verification.expectExit;
  }

  let coverageOfChange = null;
  let uncoveredChangedLines = [];
  let coverageNote = '';
  const hasChangedLines = task.changedLines && Object.keys(task.changedLines).length > 0;
  if (task.verification.coverageCommand && passed && hasChangedLines) {
    const auxiliaryEnvironment = runtimeEnvironmentFor(task.verification, runtime);
    const covRun = await runCommand(task.verification.coverageCommand, sandbox.dir, timeoutMs, auxiliaryEnvironment);
    try {
      const parsed = JSON.parse(covRun.output);
      const files = parsed.files ?? {};
      const uncovered = [];
      for (const [filePath, lineNumbers] of Object.entries(task.changedLines)) {
        const executed = new Set(files[filePath]?.executedLines ?? []);
        for (const ln of lineNumbers) {
          if (!executed.has(ln)) uncovered.push(`${filePath}:${ln}`);
        }
      }
      uncoveredChangedLines = uncovered;
      coverageOfChange = uncovered.length === 0;
    } catch {
      coverageOfChange = null;
      coverageNote = ' Coverage report parse failure (non-JSON or malformed stdout) — coverage signal dropped, primary verdict unaffected.';
    }
  }

  let mutationStrength = null;
  let mutationPassed = null;
  let survivedMutants = [];
  let mutationNote = '';
  if (task.verification.mutationCommand && passed) {
    const auxiliaryEnvironment = runtimeEnvironmentFor(task.verification, runtime);
    const mutationRun = await runCommand(task.verification.mutationCommand, sandbox.dir, timeoutMs, auxiliaryEnvironment);
    try {
      const parsed = JSON.parse(mutationRun.output);
      const killed = Number(parsed.killed);
      const total = Number(parsed.total);
      survivedMutants = Array.isArray(parsed.survived) ? parsed.survived : [];
      if (Number.isFinite(killed) && Number.isFinite(total) && total > 0 && killed >= 0 && killed <= total) {
        mutationStrength = killed / total;
        mutationPassed = survivedMutants.length === 0 && killed === total;
      }
    } catch {
      mutationNote = ' Mutation report parse failure — mutation signal unknown.';
    }
  }

  let note;
  if (resultRun.outputExceeded) {
    note = `FAIL: verification output exceeded ${task.verification.maxOutputBytes} bytes.`;
  } else if (!matchesClaim) {
    note = `Diverged from claim: worker claimed exit ${claimedExit}, hub observed ${observedExit}`
      + `${resultRun.timedOut ? ' (timeout: verification command exceeded the deadline)' : ''}.`;
  } else if (resultRun.timedOut) {
    note = `Timeout: verification command exceeded ${timeoutMs}ms.`;
  } else if (passed && redGreen === false) {
    note = `PASS but not red->green: the check already passed before the change (base exit ${baseExit}).`;
  } else if (passed && coverageOfChange === false) {
    note = `PASS but undercovered: ${uncoveredChangedLines.length} changed line(s) never executed.`;
  } else if (passed && mutationPassed === false) {
    note = `PASS but mutation-weak: ${survivedMutants.length} mutant(s) survived.`;
  } else if (passed) {
    note = `PASS: observed exit ${observedExit} matches expected ${task.verification.expectExit}.`;
  } else {
    note = `FAIL: observed exit ${observedExit}, expected ${task.verification.expectExit}.`;
  }
  note += coverageNote;
  note += mutationNote;

  const verdict = {
    reverified: true,
    observedExit,
    outputExceeded: resultRun.outputExceeded,
    hadClaim,
    matchesClaim,
    passed,
    locus: 'fresh_sandbox',
    redGreen,
    baseExit,
    coverageOfChange,
    uncoveredChangedLines,
    mutationStrength,
    mutationPassed,
    survivedMutants,
    observedOutputTail: resultRun.output.slice(-4000),
    note,
    durationMs,
    execution,
    baseExecution,
    runtimeDigest: runtime.digest,
  };

  if (execution.state !== 'completed') Object.assign(verdict, { reverified: false, passed: false, outcome: 'inconclusive', failureOwnership: 'verifier' });
  else if (!passed && opts.classifyFailureOwnership && baseExecution?.state === 'completed' && baseExit === task.verification.expectExit) Object.assign(verdict, { outcome: 'candidate_failed', failureOwnership: 'candidate' });
  else if (!passed && opts.classifyFailureOwnership) Object.assign(verdict, { outcome: 'inconclusive', failureOwnership: 'baseline_or_environment' });
  else Object.assign(verdict, { outcome: passed ? 'passed' : 'candidate_failed', failureOwnership: passed ? null : 'candidate' });

  if (opts.log) {
    opts.log.append({
      worker: opts.worker ?? task.id,
      harness: 'n/a',
      turnEpoch: 0,
      kind: 'verify.reverified',
      actor: 'policy',
      payload: verdict,
    });
  }

  return verdict;
}

/**
 * A verdict is trustworthy — and a result is safe to mark "done"/merge — iff the hub
 * itself observed a pass, AND (if required) the hardening checks that were requested
 * came back true, not merely non-false.
 * @param {object} verdict
 * @param {{requireRedGreen?: boolean, requireCoverage?: boolean}} [opts]
 * @returns {boolean}
 */
export function accept(verdict, opts = {}) {
  const { requireRedGreen = false, requireCoverage = false, requireMutation = false } = opts;
  if (!verdict.reverified || !verdict.passed) return false;
  if (requireRedGreen && verdict.redGreen !== true) return false;
  if (requireCoverage && verdict.coverageOfChange !== true) return false;
  if (requireMutation && verdict.mutationPassed !== true) return false;
  return true;
}

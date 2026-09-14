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
import { availableParallelism } from 'node:os';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { verifierFailureCapsule } from './verifier-diagnostics.mjs';

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

/** How many verifications a deployment runs at once. Derived from the machine, not chosen: the
 * hub keeps one core for its own event loop (every stop, drain and watchdog deadline is a timer
 * on that loop, and a starved loop expires them against healthy children), the default
 * verification (the suite) uses every core but one, so the lane count is the cores left after
 * the hub's divided by the cores one verification takes — one, on any machine, until
 * `advanced.verification.concurrency` says a verification is known to be lighter. The 2026-09-14
 * audit (G-29) caught the previous formula giving a two-core machine two concurrent suites.
 * Issue #269: without this, every swarm.check and every run verification spawned its own full
 * suite and three of them drove a load average past 140. */
export function defaultVerificationConcurrency({ cores = availableParallelism(), verificationCores = Math.max(1, cores - 1) } = {}) {
  return Math.max(1, Math.floor(Math.max(1, cores - 1) / Math.max(1, verificationCores)));
}

/** Wrap a referee so at most `concurrency` verifications run at once; the rest wait in order.
 * The wrapper exposes `lane` ({concurrency, running, queued}) so a caller can record that a
 * check is waiting instead of letting a slow machine look like a slow verifier. */
export function withVerificationLane(referee, { concurrency } = {}) {
  if (typeof referee !== 'function') throw new TypeError('withVerificationLane requires a referee function');
  const lanes = concurrency === undefined ? defaultVerificationConcurrency() : concurrency;
  if (!Number.isSafeInteger(lanes) || lanes <= 0) throw new TypeError('verification concurrency must be a positive safe integer');
  let running = 0;
  const waiting = [];
  const admit = () => new Promise((resolve) => {
    if (running < lanes) { running += 1; resolve(); return; }
    waiting.push(resolve);
  });
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else running -= 1;
  };
  const laned = async (...args) => {
    await admit();
    try { return await referee(...args); } finally { release(); }
  };
  laned.lane = Object.freeze({
    get concurrency() { return lanes; },
    get running() { return running; },
    get queued() { return waiting.length; },
  });
  return laned;
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

/** Whitespace-splits `command` into argv, treating a `"`/`'`-delimited span as one literal
 * token — no escape-processing inside it, so an embedded `\"` survives intact for the invoked
 * program's OWN parser (e.g. Node's `-e` argument) to interpret. The closing quote is the first
 * matching quote that ENDS a token (followed by whitespace or the end of the command) and is not
 * itself escaped; a quote glued to more text, as in `\"hi\")`, or preceded by a backslash, is
 * content. That is what makes `--grep "foo" --reporter "bar"` two tokens and
 * `node -e "console.log(\"hi\")"` one. A bare inner quote of the same character followed by a
 * space (`"a === "b" ? c"`) is ambiguous and closes the span there: use the other quote character
 * or escape it. The previous rule matched the LAST quote in the whole command, which collapsed
 * two quoted arguments into one mangled token and ran something other than the receipt said
 * (2026-09-14 audit, G-19). */
function tokenize(command) {
  const tokens = [];
  let i = 0;
  const n = command.length;
  const closingQuote = (ch, from) => {
    for (let j = from; j < n; j += 1) {
      if (command[j] === ch && command[j - 1] !== '\\' && (j + 1 >= n || /\s/.test(command[j + 1]))) return j;
    }
    return -1;
  };
  while (i < n) {
    while (i < n && /\s/.test(command[i])) i += 1;
    if (i >= n) break;
    const ch = command[i];
    if (ch === '"' || ch === "'") {
      const close = closingQuote(ch, i + 1);
      if (close > i) {
        tokens.push(command.slice(i + 1, close));
        i = close + 1;
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
      const captured = Buffer.concat(chunks);
      resolve({
        exitCode: timedOut || aborted ? null : exitCode,
        output: captured.toString('utf8'),
        capturedOutputBytes: captured.length,
        capturedOutputDigest: createHash('sha256').update(captured).digest('hex'),
        timedOut,
        outputExceeded: false,
        aborted,
      });
    };

    const armTimer = () => {
      timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
      }, timeoutMs);
    };

    const wire = () => {
      // Every listener belongs to the child generation it was wired on. A direct-exec child
      // that failed with ENOENT still emits `close` (with -2) AFTER its `error`; before the
      // 2026-09-14 audit (G-18) that stale close settled the promise as a candidate failure
      // (`verification_exit_mismatch`) before the shell fallback ran a single byte.
      const current = child;
      current.stdout?.on('data', (d) => { if (current === child) chunks.push(d); });
      current.stderr?.on('data', (d) => { if (current === child) chunks.push(d); });
      current.on('error', (err) => {
        if (current !== child) return;
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
      current.on('close', (code) => { if (current === child) finish(code); });
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
      settle({
        exitCode: null,
        output: '',
        capturedOutputBytes: 0,
        capturedOutputDigest: createHash('sha256').update('').digest('hex'),
        timedOut: false,
        outputExceeded: false,
        invalid: 'cwd_outside_sandbox',
      });
      return;
    }
    const env = Object.fromEntries(verification.envAllowlist
      .filter((name) => Object.hasOwn(runtime.environment, name))
      .map((name) => [name, runtime.environment[name]]));
    const child = spawn(verification.command, verification.arguments, { cwd, detached: true, env, shell: false });
    // Output is bounded EVIDENCE; the exit code is the verdict (issue #266). A verifier that prints
    // more than maxOutputBytes is never killed for it: the first half of the bound is kept as the
    // head, the last half as a rolling tail, and the bytes between are counted, so the failure
    // capsule still shows how the run ended and a suite that prints its whole transcript still
    // reports its real exit.
    const headLimit = Math.ceil(verification.maxOutputBytes / 2);
    const tailLimit = verification.maxOutputBytes - headLimit;
    const head = []; const tail = []; let headBytes = 0; let tailBytes = 0; let omittedBytes = 0;
    let settled = false; let timedOut = false; let outputExceeded = false; let aborted = false; let timer;
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
      const captured = Buffer.concat([...head, ...tail]);
      const text = captured.toString('utf8');
      settle({
        exitCode: timedOut || aborted ? null : exitCode,
        output: omittedBytes > 0
          ? `${Buffer.concat(head).toString('utf8')}\n[verifier output truncated: ${omittedBytes} bytes omitted between head and tail]\n${Buffer.concat(tail).toString('utf8')}`
          : text,
        capturedOutputBytes: captured.length,
        capturedOutputDigest: createHash('sha256').update(captured).digest('hex'),
        timedOut,
        outputExceeded,
        aborted,
      });
    };
    const capture = (chunk) => {
      let rest = chunk;
      if (!outputExceeded) {
        const remaining = headLimit - headBytes;
        if (chunk.length <= remaining) { head.push(chunk); headBytes += chunk.length; return; }
        if (remaining > 0) { head.push(chunk.subarray(0, remaining)); headBytes = headLimit; }
        outputExceeded = true;
        rest = chunk.subarray(Math.max(0, remaining));
      }
      tail.push(rest); tailBytes += rest.length;
      while (tailBytes > tailLimit && tail.length > 0) {
        const excess = tailBytes - tailLimit;
        const first = tail[0];
        if (first.length <= excess) { tail.shift(); tailBytes -= first.length; omittedBytes += first.length; }
        else { tail[0] = first.subarray(excess); tailBytes -= excess; omittedBytes += excess; }
      }
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

// `output_exceeded` remains in the closed execution vocabulary for durable verdicts recorded
// before #266; a live verifier is never terminated for its output, so it is no longer produced.
const executionOf = (run) => run.timedOut ? { state: 'timed_out', code: 'verification_timed_out' }
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

  let diagnosticCode;
  if (resultRun.timedOut) {
    diagnosticCode = 'verification_timed_out';
  } else if (execution.state !== 'completed') {
    diagnosticCode = execution.code;
  } else if (!matchesClaim) {
    diagnosticCode = 'verification_claim_diverged';
  } else if (passed && redGreen === false) {
    diagnosticCode = 'verification_red_green_failed';
  } else if (passed && coverageOfChange === false) {
    diagnosticCode = 'verification_coverage_failed';
  } else if (passed && mutationPassed === false) {
    diagnosticCode = 'verification_mutation_failed';
  } else if (passed && coverageNote) {
    diagnosticCode = 'verification_coverage_unavailable';
  } else if (passed && mutationNote) {
    diagnosticCode = 'verification_mutation_unavailable';
  } else if (passed) {
    diagnosticCode = 'verification_passed';
  } else {
    diagnosticCode = 'verification_exit_mismatch';
  }

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
    capturedOutputBytes: resultRun.capturedOutputBytes,
    capturedOutputDigest: resultRun.capturedOutputDigest,
    diagnosticCode,
    durationMs,
    execution,
    baseExecution,
    runtimeDigest: runtime.digest,
  };

  verdict.failureCapsule = passed ? null : verifierFailureCapsule(resultRun.output, {
    capturedOutputBytes: resultRun.capturedOutputBytes,
    capturedOutputDigest: resultRun.capturedOutputDigest,
    sandboxRoots: [sandbox.dir, opts.baseSandbox?.dir].filter(Boolean),
  });

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

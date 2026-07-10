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

function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const preferDirect = looksLikeSimpleCommand(command);
    const directArgv = preferDirect ? tokenize(command) : [];
    let usingDirect = preferDirect && directArgv.length > 0;

    const spawnDirect = () => spawn(directArgv[0], directArgv.slice(1), { cwd, detached: true });
    const spawnShell = () => spawn('sh', ['-c', command], { cwd, detached: true });

    let child = usingDirect ? spawnDirect() : spawnShell();
    const chunks = [];
    let settled = false;
    let timedOut = false;
    let timer;

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : exitCode, output: Buffer.concat(chunks).toString('utf8'), timedOut });
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

/**
 * Re-derive the truth of a worker's result.
 * @param {object} task
 * @param {object} result
 * @param {{dir:string, sha:string, cleanup:() => Promise<void>}} sandbox
 * @param {{baseSandbox?: object, requireRedGreen?: boolean, requireCoverage?: boolean, log?: object, worker?: string}} [opts]
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

  const start = Date.now();
  const resultRun = await runCommand(task.verification.command, sandbox.dir, timeoutMs);
  const durationMs = Date.now() - start;

  const observedExit = resultRun.timedOut ? null : resultRun.exitCode;
  const claimedExit = result?.verification?.claimedExit ?? null;
  const matchesClaim = observedExit === claimedExit;
  const passed = observedExit === task.verification.expectExit;

  let redGreen = null;
  let baseExit = null;
  if (opts.baseSandbox) {
    const baseRun = await runCommand(task.verification.command, opts.baseSandbox.dir, timeoutMs);
    baseExit = baseRun.timedOut ? null : baseRun.exitCode;
    redGreen = passed && baseExit !== task.verification.expectExit;
  }

  let coverageOfChange = null;
  let uncoveredChangedLines = [];
  let coverageNote = '';
  const hasChangedLines = task.changedLines && Object.keys(task.changedLines).length > 0;
  if (task.verification.coverageCommand && passed && hasChangedLines) {
    const covRun = await runCommand(task.verification.coverageCommand, sandbox.dir, timeoutMs);
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

  let note;
  if (!matchesClaim) {
    note = `Diverged from claim: worker claimed exit ${claimedExit}, hub observed ${observedExit}`
      + `${resultRun.timedOut ? ' (timeout: verification command exceeded the deadline)' : ''}.`;
  } else if (resultRun.timedOut) {
    note = `Timeout: verification command exceeded ${timeoutMs}ms.`;
  } else if (passed && redGreen === false) {
    note = `PASS but not red->green: the check already passed before the change (base exit ${baseExit}).`;
  } else if (passed && coverageOfChange === false) {
    note = `PASS but undercovered: ${uncoveredChangedLines.length} changed line(s) never executed.`;
  } else if (passed) {
    note = `PASS: observed exit ${observedExit} matches expected ${task.verification.expectExit}.`;
  } else {
    note = `FAIL: observed exit ${observedExit}, expected ${task.verification.expectExit}.`;
  }
  note += coverageNote;

  const verdict = {
    reverified: true,
    observedExit,
    matchesClaim,
    passed,
    locus: 'fresh_sandbox',
    redGreen,
    baseExit,
    coverageOfChange,
    uncoveredChangedLines,
    observedOutputTail: resultRun.output.slice(-4000),
    note,
    durationMs,
  };

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
  const { requireRedGreen = false, requireCoverage = false } = opts;
  if (!verdict.reverified || !verdict.passed) return false;
  if (requireRedGreen && verdict.redGreen !== true) return false;
  if (requireCoverage && verdict.coverageOfChange !== true) return false;
  return true;
}

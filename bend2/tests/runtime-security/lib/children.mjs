// Owned-child custody for fixtures.
//
// A requested signal and an observed child outcome are separate facts. This
// module records both and never treats a requested SIGKILL as a reap.
//
// `cleanupOwned` is the awaited path: it requests SIGKILL for every child that
// was not observed reaped, then waits a bounded time for each child's own
// `close` (or `error`) event, and reports any child still unresolved. The
// process `exit` hook can only REQUEST a signal; it observes nothing, and the
// fixture result records no outcome from it.
//
// Coordinator-level custody of a killed fixture's descendants is outside this
// fixture's authority and is not claimed here.

const owned = new Map();
let installed = false;

function requestOnlyKill() {
  for (const entry of owned.values()) {
    if (entry.observed !== null) continue;
    entry.requested.push('SIGKILL(exit-hook, unobserved)');
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // best effort on a shutdown path; result remains unobserved
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', requestOnlyKill);
}

export function own(child) {
  install();
  const entry = { child, pid: child.pid, requested: [], observed: null };
  owned.set(child, entry);
  const settle = (outcome) => {
    if (entry.observed === null) entry.observed = outcome;
  };
  child.on('close', (code, signal) => settle({ closed: true, code, signal }));
  child.on('error', (error) => settle({ closed: false, error: error.code ?? String(error) }));
  return {
    entry,
    markReaped(outcome) {
      if (outcome !== undefined) settle(outcome);
    },
    // Record the request and send it. The outcome arrives through the child's
    // own close/error event, or not at all.
    kill(signal = 'SIGKILL') {
      entry.requested.push(signal);
      try {
        child.kill(signal);
      } catch {
        // already gone; observed outcome still governs
      }
    },
  };
}

export async function cleanupOwned({ timeoutMs = 5000 } = {}) {
  const entries = [...owned.values()];
  const pending = [];
  for (const entry of entries) {
    if (entry.observed !== null) continue;
    entry.requested.push('SIGKILL(cleanup)');
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // fall through to the wait below
    }
    pending.push(entry);
  }
  const waited = pending.map((entry) => new Promise((resolve) => {
    if (entry.observed !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve('settled');
    };
    entry.child.once('close', done);
    entry.child.once('error', done);
    // Re-check after subscribing: the event may already have arrived.
    if (entry.observed !== null) done();
  }));
  await Promise.all(waited);

  const report = entries.map((entry) => ({
    pid: entry.pid,
    requested: entry.requested.slice(),
    observed: entry.observed,
  }));
  return {
    children: report,
    reaped: report.filter((item) => item.observed !== null && item.observed.closed === true).map((item) => item.pid),
    errored: report.filter((item) => item.observed !== null && item.observed.closed === false).map((item) => item.pid),
    unresolved: report.filter((item) => item.observed === null).map((item) => item.pid),
    signalObservation: 'requested signals are recorded separately from observed close/error outcomes; a requested SIGKILL is never a reap',
  };
}

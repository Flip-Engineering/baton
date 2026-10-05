// Owned-child custody for fixtures.
//
// A requested signal, an error event and a close outcome are three separate
// facts. An `error` event never settles the child and never counts as a reap;
// only an observed `close` does. `cleanupOwned` requests SIGKILL for every child
// whose close was not observed and still has a pid, then awaits each child's own
// close with a bounded wait. A spawn failure that produced no pid is recorded
// distinctly.
//
// The process `exit` hook can only REQUEST a signal and observes nothing, so no
// outcome is attributed to it. Custody of a killed fixture's descendants is
// coordinator-level and is outside this fixture's authority.

const owned = new Map();
let installed = false;

function requestOnlyKill() {
  for (const entry of owned.values()) {
    if (entry.close !== null || entry.pid === undefined) continue;
    entry.requested.push('SIGKILL(exit-hook, unobserved)');
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // best effort on a shutdown path
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
  const entry = {
    child,
    pid: child.pid,
    spawnFailed: child.pid === undefined,
    requested: [],
    errors: [],
    close: null,
  };
  owned.set(child, entry);
  child.on('close', (code, signal) => {
    if (entry.close === null) entry.close = { code, signal };
  });
  child.on('error', (error) => {
    entry.errors.push(error.code ?? String(error));
  });
  return {
    entry,
    markReaped(close) {
      if (close !== undefined && entry.close === null) entry.close = close;
    },
    // Records the request and sends it; the outcome arrives only through the
    // child's own close event.
    kill(signal = 'SIGKILL') {
      entry.requested.push(signal);
      try {
        child.kill(signal);
      } catch {
        // already gone; the close outcome still governs
      }
    },
  };
}

export async function cleanupOwned({ timeoutMs = 5000 } = {}) {
  const entries = [...owned.values()];
  const awaiting = entries.filter((entry) => entry.close === null && !entry.spawnFailed);
  for (const entry of awaiting) {
    entry.requested.push('SIGKILL(cleanup)');
    try {
      entry.child.kill('SIGKILL');
    } catch {
      // fall through to the bounded wait
    }
  }
  // Wait for the child's own close only, up to the bound. An error event is
  // recorded independently and never ends this wait, so "unresolved" means the
  // process was still alive at the bound rather than merely erroring.
  await Promise.all(awaiting.map((entry) => new Promise((resolve) => {
    if (entry.close !== null) {
      resolve();
      return;
    }
    let timer = null;
    const onClose = () => {
      clearTimeout(timer);
      entry.child.removeListener('close', onClose);
      resolve();
    };
    timer = setTimeout(() => {
      entry.child.removeListener('close', onClose);
      entry.cleanupTimedOut = true;
      resolve();
    }, timeoutMs);
    entry.child.once('close', onClose);
  })));

  const report = {
    children: entries.map((entry) => ({
      pid: entry.pid ?? null,
      spawnFailed: entry.spawnFailed,
      requested: entry.requested.slice(),
      errors: entry.errors.slice(),
      close: entry.close,
    })),
    reaped: entries.filter((entry) => entry.close !== null).map((entry) => entry.pid ?? null),
    errored: entries.filter((entry) => entry.errors.length > 0).map((entry) => entry.pid ?? null),
    spawnFailed: entries.filter((entry) => entry.spawnFailed).map(() => null),
    // Unresolved means: a pid existed and no close was observed within the
    // bound, whether or not an error event arrived.
    unresolved: entries.filter((entry) => entry.close === null && !entry.spawnFailed).map((entry) => entry.pid),
    cleanupTimedOut: entries.filter((entry) => entry.cleanupTimedOut === true).map((entry) => entry.pid),
    errorRecorded: entries.filter((entry) => entry.errors.length > 0)
      .map((entry) => ({ pid: entry.pid ?? null, errors: entry.errors.slice() })),
    resolved: entries.filter((entry) => entry.close !== null || entry.spawnFailed).map((entry) => entry.pid ?? null),
    semantics: 'requested signals, error events and close outcomes are separate; only an observed close is a reap; an errored child with a pid and no close within the bound is unresolved; an abrupt SIGKILL loss cannot run an installed exit handler, while a catchable termination may',
  };
  return report;
}

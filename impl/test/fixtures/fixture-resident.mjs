// Issue #471: the ONE fixture-resident spawn and cleanup path.
//
// A `baton serve` a test spawns must die with the test process, however that process ends. The
// fixtures used to end their residents only in a `t.after` hook (SIGKILL when the child was still
// alive); a runner ended by `timeout`, by a seat's suite lease, by a crash or by Ctrl-C never
// reaches that hook, so the residents stayed — ten of them were found aged 26-42 minutes, each
// holding a listener, a writer lease and a share of the host capacity.
//
// This module is the fixture half of the repair. It spawns the child in its OWN process group,
// with `BATON_SERVE_PARENT_PID` naming the test process, and ends the whole GROUP:
//   - on `t.after` — SIGTERM by group, SIGKILL after a short bound;
//   - on the process `exit` event — no event-loop turn is left for a grace, so the group gets
//     SIGTERM and SIGKILL back to back;
//   - on SIGTERM/SIGINT/SIGHUP — the groups are signalled and the signal is re-raised, so the
//     runner still ends with the disposition it was sent.
// The resident half lives in `baton serve` (`impl/scripts/baton.mjs`): a declared parent's exit is
// a stop trigger of its own (`host.stop_requested {trigger: 'parent_exited', parentPid}`), so a
// resident whose runner was SIGKILLed — no handler can run — stops by itself within its stop
// bound, and so does a reincarnation successor, which inherits the declaration and stays in the
// predecessor's group.
import { spawn } from 'node:child_process';

/** The variable the resident reads (`impl/scripts/baton.mjs`, `declaredServeParentPid`). */
export const FIXTURE_RESIDENT_PARENT_ENV = 'BATON_SERVE_PARENT_PID';

/** How long a group gets to end on SIGTERM before it is SIGKILLed. */
export const FIXTURE_RESIDENT_GRACE_MS = 2_000;

const TERMINATING_SIGNALS = Object.freeze(['SIGTERM', 'SIGINT', 'SIGHUP']);
const POLL_MS = 20;

// One entry per spawned group, for the process's whole life: a resident that exited by itself can
// still leave a straggler in its group (a reincarnation successor), so the group stays registered
// until `endFixtureResident` runs. The signal/exit handlers are installed on the FIRST spawn; a
// fixture file that never spawns a resident never installs them.
const groups = new Map();
const handlers = new Map();
let installed = false;

/** True while the process GROUP still exists — the same question the kill asks, so a group that
 * already ended costs one failed syscall and no wait. */
function groupExists(child) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return false;
  try { process.kill(-child.pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

/** Signal the whole group; a group that is already gone (ESRCH) is the fact this returns, never a
 * throw. A child whose group could not be signalled is signalled directly instead. */
function signalGroup(child, signal) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return;
  try { process.kill(-child.pid, signal); return; }
  catch { /* ESRCH: the group is gone — and EPERM is not ours to fix */ }
  try { child.kill(signal); } catch { /* already gone */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** End one fixture resident: SIGTERM by process group, then SIGKILL the group when the bound
 * passes. Waiting on the GROUP (not only the direct child) is what also ends a successor the
 * resident spawned before it exited. Safe to call more than once. */
export async function endFixtureResident(child, { graceMs = FIXTURE_RESIDENT_GRACE_MS } = {}) {
  if (!groupExists(child)) {
    groups.delete(child);
    return;
  }
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && groupExists(child)) await sleep(POLL_MS);
  if (groupExists(child)) signalGroup(child, 'SIGKILL');
  groups.delete(child);
}

function endAllGroups() {
  for (const child of groups.keys()) {
    if (!groupExists(child)) continue;
    signalGroup(child, 'SIGTERM');
    signalGroup(child, 'SIGKILL');
  }
}

function installProcessHandlers() {
  if (installed) return;
  installed = true;
  // The exit handler is synchronous — no event-loop turn is left for a grace — so the group gets
  // SIGTERM and SIGKILL in the same act: what must not survive this process is the resident.
  process.on('exit', endAllGroups);
  for (const signal of TERMINATING_SIGNALS) {
    const onSignal = () => {
      endAllGroups();
      // Re-raise: with our own handler gone, the process ends exactly as it would have without
      // this module (and any other listener — the test runner's — still gets its turn).
      for (const name of TERMINATING_SIGNALS) process.off(name, handlers.get(name));
      process.kill(process.pid, signal);
    };
    handlers.set(signal, onSignal);
    process.on(signal, onSignal);
  }
}

/**
 * Spawn a fixture resident. `script`/`args`/`cwd`/`stdio` are the caller's (the shape every
 * fixture already passed to `spawn`); `env` is extended with `BATON_SERVE_PARENT_PID` naming
 * `parentPid` — this process by default, so the resident stops when the runner does. The two
 * non-default values exist for the #471 rows that measure the declaration itself: an explicit pid
 * (a child runner the row kills) and `null` (a resident started with no declaration at all).
 * The child is detached into its own process group so the whole group can be ended. `t` is the
 * per-test context whose `after` hook ends it; a caller with no test context of its own — a runner
 * script, or a file that already owns a module-level hook — passes `null`, and the process-level
 * handlers hold either way. The module-level `test` object is NOT interchangeable with `t`:
 * node:test attaches a hook registered on it while a test runs to THAT test, so a file that shares
 * one resident across its rows registers its own file-level hook and passes `null` here
 * (issue306w and issue468 do).
 */
export function spawnFixtureResident(t, {
  script = process.execPath,
  args = [],
  env = process.env,
  cwd,
  stdio = ['ignore', 'ignore', 'pipe'],
  graceMs = FIXTURE_RESIDENT_GRACE_MS,
  parentPid = process.pid,
} = {}) {
  const environment = { ...env };
  // `null` means NO declaration — and the ambient environment must not smuggle one in (the rows
  // that measure the switch itself run with whatever the suite was started with).
  if (parentPid === null) delete environment[FIXTURE_RESIDENT_PARENT_ENV];
  else environment[FIXTURE_RESIDENT_PARENT_ENV] = String(parentPid);
  const child = spawn(script, args, {
    cwd,
    env: environment,
    stdio,
    detached: true,
  });
  groups.set(child, true);
  installProcessHandlers();
  if (typeof t?.after === 'function') t.after(async () => { await endFixtureResident(child, { graceMs }); });
  return child;
}

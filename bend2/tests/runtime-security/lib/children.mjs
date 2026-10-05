// Owned-child custody for fixtures.
//
// Every debuggee a fixture spawns is registered here. On normal exit, on a
// terminal signal, or on an uncaught failure, the registry sends SIGKILL to any
// child that was not observed reaped, so a killed fixture does not leave an
// owned debuggee behind. Reaping is still reported by the fixture itself: an
// `error` event is not an observed close.

const owned = new Map();
let installed = false;

function killAll() {
  for (const [child, state] of owned) {
    if (state.reaped) continue;
    try {
      child.kill('SIGKILL');
    } catch {
      // best effort on a shutdown path
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', killAll);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      killAll();
      process.exit(128 + (signal === 'SIGTERM' ? 15 : 2));
    });
  }
}

export function own(child) {
  install();
  owned.set(child, { reaped: false });
  return {
    markReaped() {
      const state = owned.get(child);
      if (state !== undefined) state.reaped = true;
    },
    kill(signal = 'SIGKILL') {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    },
  };
}

export function ownedCount() {
  return [...owned.values()].filter((state) => !state.reaped).length;
}

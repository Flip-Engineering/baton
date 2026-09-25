import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

// Wedged-run collector (dry-run): enumerate non-terminal runs so the orphaned
// REPL/KG contract-drafter runs (driver killed 2026-07-22T02:45Z, pid 62684)
// can be identified and stopped honestly. Prints JSON lines; stops nothing.

const repo = resolve(process.cwd());
const baton = await openBaton({ repo });
try {
  const listed = await baton.runs.list();
  const runs = Array.isArray(listed) ? listed : (listed?.runs ?? []);
  for (const run of runs) {
    const phase = run?.phase ?? run?.outline?.phase ?? 'unknown';
    const terminal = ['completed', 'failed', 'cancelled', 'work_completed', 'selection_required'].includes(phase);
    const objective = String(run?.objective ?? run?.goal ?? '').slice(0, 90);
    console.log(JSON.stringify({
      runId: run?.runId ?? run?.id ?? null,
      phase,
      terminal,
      role: run?.role ?? null,
      objective,
    }));
  }
} finally {
  try { if (typeof baton.close === 'function') await baton.close(); } catch { /* best effort */ }
}

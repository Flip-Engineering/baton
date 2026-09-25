# ROW — #201 wiring: the successor's orphan re-dispatch projection

Landed (3d9b5550): store.orphans({liveWorkers}) surfaces claimed-by-dead-generation
tasks + retry_pending parks; death certs carry sessionId/sessionFile; omp resume argv
(--resume id, --session-dir). Missing: the WIRING — turning orphan rows into resume
intents for the successor incarnation.

Deliverable (red-first, SEAM-LEVEL — no spawn execution):
1. RED pin impl/test/orphan-resume-red.test.mjs: coordinator.resumeOrphans({liveWorkers})
   does not exist at HEAD — verify the method's absence is the RED reason.
2. Implement Coordinator.prototype.resumeOrphans({liveWorkers}) — a PURE PROJECTION over
   store.orphans() rows + each row's last death-cert evidence (evidence.mapped
   lifecycle.crashed payload sessionId; retry_pending transition evidence deathCert):
   returns [{taskId, workerId, sessionId|null, sessionDir|null, retry:{attempt,of}|null}].
   sessionId null = fresh retry (no resume handle) — never invent one. NO spawn side
   effect.
3. GREEN + coordinator battery + durable-retry-red 6/6 still green.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-b/notes-row-resume-wiring.md

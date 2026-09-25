# ROW BRIEF — row-resume-wiring: the successor's orphan re-dispatch (#201 roadmap)

Issue #201 comment 'Remaining'. The seams landed (3d9b5550): orphans() scan,
retry_pending parks, sessionRef binding, --resume/--session-dir argv. Missing:
the WIRING — the successor incarnation turning orphan rows into resume spawns.

Deliverable: implementation + red-first pin (seam-level; full spawn execution
is OUT OF SCOPE this wave).
1. RED first: impl/test/orphan-resume-red.test.mjs — a coordinator method
   (name it resumeOrphans({ liveWorkers }) — returns durable resume INTENTS:
   [{ taskId, workerId, sessionId, sessionDir?, model?, effort? }]) derived
   from store.orphans() + the death-cert evidence's resume handle + the task's
   route coordinates. Verify RED (method does not exist).
2. Implement: coordinator.resumeOrphans — a pure projection over the orphan
   rows and their last death-cert evidence (evidence.mapped lifecycle.crashed
   payloads carry sessionId); tasks without a resume handle surface
   sessionId:null (a fresh retry, not a resume). NO spawn is executed.
3. GREEN + coordinator battery green.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.

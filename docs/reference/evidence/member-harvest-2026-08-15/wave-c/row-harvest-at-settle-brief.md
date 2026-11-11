# ROW BRIEF — row-harvest-at-settle: the forensic record outlives the member

Deliverable: implementation + red-first pin suite. C2 durability leg; issue #225 is the
sibling (terminal-event enrichment — different seam, coordinate via git log).

## Anchors (re-verify at YOUR head)

- impl/src/runtime-isolation.mjs:175 remove(workerId) — rmSync recursive+force, then asserts
  exact-absent. Called from worker reap (impl/src/coordinator.mjs — find the call site).
- impl/src/wave-driver.mjs settle path — where the wave receipt folds member outcomes.

## Contract (closed)

1. At member terminal (settle/reap), a BOUNDED forensic record is retained before removal:
   the runtime dir's file manifest (paths + byte sizes, no contents) + the terminal events'
   payload (incl. #225's cert fields if landed) + the member's route tuple. Written under
   the wave's evidence partition or the coordination store — NEVER a new top-level surface.
2. Bounds: manifest only, no file contents (NUL-bearing caches stay out); total record
   <= 64KiB; redaction per SECRET_SHAPED_TEXT.
3. Retention is per-wave-settle (the wave receipt or its evidence dir carries it) — an
   operator can answer 'what did this dead member leave' from the receipt, no archaeology.
4. Red-first pin impl/test/member-harvest-red.test.mjs: a member spawned, worked, terminalized
   -> the record EXISTS at assert time while the runtime dir is gone (RED at pre-change head).

## Hard bounds

Additive hunks; no new event kinds; no clocks; batteries green.

# Attempt 3 — accepted review finding

The third exact `gpt-5.6-sol`/low report turn again passed worker verification, detached fresh
verification, integration, and complete kill/reap. It found one medium WN6 check-to-use seam:
authorization was checked once per poll but not before each event in a synchronous replay suffix,
so credential expiry could occur after the first emitted event while later events in the same
batch continued.

The correction adds a validated `maxEventsPerPump` ceiling, bounded coordination-store suffix
reads, and a liveness check before every event. A regression advances the clock while writing the
first of two queued events and proves the second is withheld, the stream ends, capacity is released,
and authorization loss is audited. The prior accepted report remains in Git history at `1a4ae2f`.

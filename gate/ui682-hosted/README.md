# UI682 hosted events-recovery fixture gate

Focused GitHub-hosted gate for candidate
`b2f6fcd80915e74df186287ed9ff557af81f8c08`
(tree `48eeaf57737da6e9d710416df74c804546f1fe05`).
Runs on `ubuntu-latest`. Serves the exact `bend2/ui/orchestra/`
bytes with a scripted harness and loads the page in headless
Chrome through the `drive.cjs` Playwright script.

## Files

- `harness.cjs`: dependency-free Node server. Serves the static
  directory, counts snapshot requests, and scripts
  `/orchestra/events` from `fixture-events-recovery.json`:
  attempt 1 returns the transient non-exact 503, attempts 2+
  return the held-open 200 SSE with the hello, pending, and
  transition frames. Accepts `probe` versus `eventsource` labels
  from the request Accept header. `POST /harness/mode` switches
  to the terminal exact-503 behavior.
- `drive.cjs`: headless-Chrome driver. Checks the hello
  contractVersion, cursor, generation, and frame order in the
  DOM; the transient 503 followed by probe cancel-and-resume;
  the held-open 200; the exact terminal 503 notice with no
  polling loop; the subject/cursor/generation binding; zero
  snapshot requests during recovery; the served-bytes identity;
  and the 5-second probe bindings in the served source.
- `.github/workflows/ui682-events-recovery.yml`: hosted job.
  Retains runner image, dependency versions, source hashes,
  driver output, and results as one artifact.

## Scope

This gate covers the scripted fixture recovery path in the
browser. It does not qualify the backend subscription, the
shared store, the native685 CLI/server, the complete UI
composition, or live SSE delivery.

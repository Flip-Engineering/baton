# UI682 hosted events-recovery fixture gate

Focused GitHub-hosted gate for candidate
`b2f6fcd80915e74df186287ed9ff557af81f8c08`
(tree `48eeaf57737da6e9d710416df74c804546f1fe05`).
Runs on `ubuntu-latest`. Serves the exact `bend2/ui/orchestra/`
bytes with a scripted harness and loads the page in headless
Chrome through the driver scripts.

## Files

- `package.json`: exact `playwright-core` pin (`1.64.0`). The
  workflow installs from this file and fails unless the
  installed version matches exactly.
- `harness.cjs`: dependency-free Node server. Serves the static
  directory, counts snapshot requests, and scripts
  `/orchestra/events` from `fixture-events-recovery.json`:
  attempt 1 returns the transient non-exact 503, attempts 2+
  return the held-open 200 SSE with the hello, pending, and
  transition frames. Accepts `probe` versus `eventsource` labels
  from the request Accept header. `POST /harness/mode` switches
  to the terminal exact-503 behavior. With `--initial-mode
  hangonce`, the second attempt is held with no headers until
  the client aborts, and the server records monotonic elapsed
  time and header state at close.
- `drive.cjs`: headless-Chrome driver for the recovery and
  terminal cases. Checks the hello contractVersion, cursor,
  generation, and frame order in the DOM; the transient 503
  followed by probe cancel-and-resume; the held-open 200; the
  exact terminal 503 notice with no polling loop; the
  subject/cursor/generation binding; zero snapshot requests
  during recovery; the served-bytes identity; the installed
  Playwright version; and the 5-second probe bindings in the
  served source. Takes `--viewport` and `--tag`, records one
  live-state and one terminal-state screenshot per run, and
  requires each recorded PNG to exist with non-zero bytes
  matching its recorded SHA-256.
- `drive-abort.cjs`: headless-Chrome driver for the abort-expiry
  case. Checks the transient 503, the hung probe aborted by the
  client near the 5-second budget with no headers sent, the
  subsequent healthy EventSource hello, attempt order, zero
  snapshots during recovery, and no terminal notice.
- `.github/workflows/ui682-events-recovery.yml`: hosted job.
  Retains runner image, exact dependency resolution and
  registry integrity, source hashes, driver output, results,
  and screenshots as one artifact.

## Scope

This gate covers the scripted fixture recovery path in the
browser. It does not qualify the backend subscription, the
shared store, the native685 CLI/server, the complete UI
composition, or live SSE delivery.

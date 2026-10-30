# Claude Code agent_summary preload (#1338)

Since Claude Code 2.1.232, an interactive session with background agents sends each background
agent's whole transcript to its model about every 30 seconds to refresh a short status line in the
agents panel (the `agent_summary` side query). No Claude Code setting turns it off. Measurements
and the original script are at
https://gist.github.com/flamerix-ai/c3905705cc4205e5de3011fa2e74efce (MIT).

Every Claude Code process Baton starts runs with a Bun preload that cancels that one timer.

## The pinned script

| Item | Value |
| --- | --- |
| Source | gist `c3905705cc4205e5de3011fa2e74efce`, file `no-agent-summary.js` |
| Revision | `4f1ad563fbe4fb830af5dd67fbde4c1860f9caa6` |
| SHA-256 | `f95df896a998653ee86e7320ae9a29a547add4addd50cf631491dffaa6040b40` |
| License | MIT, `Copyright (c) 2026 Flamerix AI`, as stated in the file header and the gist README |
| Repository path | `bend2/scripts/no-agent-summary.js` |
| Installed path | `libexec/baton2/no-agent-summary.js` |

The repository copy is the gist file byte for byte. The script wraps `setTimeout`, makes no network
calls, and installs only when `Bun.main` is the compiled Claude Code entry. It reads
`CC_AGENT_SUMMARY_MODE` (`off` by default, `pass` for a control run), `CC_AGENT_SUMMARY_LOG` and
`CC_AGENT_SUMMARY_MARKER`. Baton never fetches the script at launch.

To move to a new revision: review the new script, replace the file, then update `PINNED_SHA256` in
`bend2/scripts/agent-summary-check.mjs` and the digest in `bend2/test/package-licenses.py`.
`bend2/test/agent-summary-check.test.mjs` fails until both match the file.

## Launch environment

The launch environment of a Claude Code process contains `BUN_OPTIONS` with
`--preload=<absolute path>` in the `=` form. Options already present in `BUN_OPTIONS` stay in front
of the preload option. The path is the file beside the other agent helpers: the helper directory
that `HostControl.Control.agent_helper` returns for the running coordinator (`libexec/baton2` in an
installed package, `bend2/scripts` in a source checkout).

| Launch path | Code |
| --- | --- |
| Retained launch, including the profile-bound route | `Turn.retained_prepare_checked` adds the entry to the `/usr/bin/env` prefix |
| Direct turn launch | `Turn.claude_launch_configured` passes the entry to `Claude.start_player` and `Claude.resume_player` |

`Claude.bun_options`, `Claude.environment` and `Claude.with_environment` in
`bend2/src/harness/claude-player.bend` build the entry. `bend2/test/claude-preload-laws.bend` states
their results as laws.

Bun refuses to start when a named preload file is missing. A launch therefore names the preload
only when the file is a regular file, and the seat-start check reports a missing file as a finding.
`bend2/harness/task-start.mjs` resolves the `claude` command for a recorded route and does not start
Claude Code.

## Checks

`bend2/scripts/agent-summary-check.mjs` runs three checks:

1. The preload file is readable and its SHA-256 equals the pinned digest.
2. The Claude Code binary contains the anchor `[AgentSummary] Timer fired`.
3. `claude --version`, started with the launch environment and `CC_AGENT_SUMMARY_LOG` set, logs
   `preload active mode=off`.

Findings carry these codes: `preload-unreadable`, `preload-digest`, `claude-unreadable`,
`anchor-missing` and `preload-not-loaded`.

`node agent-summary-check.mjs doctor --claude PATH [--preload PATH]` prints one JSON report and exits
0 when no check reports a finding, 1 when a check does, and 2 on a usage error.

No `baton doctor` command exists in the Bend tree. This entry is the doctor surface for #1338. A
`baton doctor` command that calls it is a follow-up.

At seat start, a fresh Claude Code launch (no recorded conversation) runs
`agent-summary-check.mjs seat-start`. That call starts the checks in a detached process and returns
at once, so the launch does not wait for them and does not depend on their result. The detached
process writes `agent-summary-check.json` into the attempt directory when the directory exists and
records each finding on the seat with `baton knowledge record --kind finding`. A Claude Code update
that removes the anchor shows up at the next seat start or the next `doctor` run; the preload then
cancels nothing and the session behaves as it did before.

## Qualification

Node tests in `bend2/test/agent-summary-check.test.mjs` run the checks against fixture binaries:
a pass, a missing anchor, a preload that is not loaded, a changed and an unreadable preload, an
unresolved command, an anchor across a read-block boundary, the exit statuses, and the seat-start
call with and without findings. No `claude` or `bun` binary exists on the validation host used for
the first revision, so the real `preload active mode=off` line is verified only on the operator's
Mac (Claude Code 2.1.312, Bun 1.4.4).

`bend2/test/launch-store-retained.py` carries the launch-environment and seat-start report cases. It
runs against a native build of `bend2/test/launch-store-retained.bend`.

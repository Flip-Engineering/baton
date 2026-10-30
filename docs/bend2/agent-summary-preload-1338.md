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
| License | MIT, `Copyright (c) 2026 Flamerix AI`, as stated in the file header and the gist README. The package carries the license text as `notices/no-agent-summary-LICENSE`. |
| Repository path | `bend2/scripts/no-agent-summary.js` |
| Installed path | `libexec/baton2/no-agent-summary.js` |

The repository copy is the gist file byte for byte. The script wraps `setTimeout`, makes no network
calls, and installs only when `Bun.main` is the compiled Claude Code entry. It reads
`CC_AGENT_SUMMARY_MODE` (`off` by default, `pass` for a control run), `CC_AGENT_SUMMARY_LOG` and
`CC_AGENT_SUMMARY_MARKER`. Baton never fetches the script at launch.

Revision 4f1ad563 names the MIT license in the script header and in the gist README and does not
contain the license text (the gist has two files, `README.md` and `no-agent-summary.js`, and its
comments carry no license text). `docs/bend2/reference/third-party/no-agent-summary-LICENSE` is the
standard MIT text with the copyright line from the script header. `package-native.py` copies it to
`notices/no-agent-summary-LICENSE`, records its source, revision and the script digest in the
manifest term `agent_summary_preload_license`, and names them in `notices/distribution.md`. The
script bytes are unchanged.

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
| Direct turn launch | `Turn.claude_launch_configured` passes the entry to `Claude.start_player` and `Claude.resume_player`; `claude_launch_entries` also starts the seat-start check |

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

`baton doctor [--claude PATH] [--preload PATH]` runs the checks and prints one JSON report. The exit
status is 0 when no check reports a finding, 1 when a check does, and 2 on a usage error. `--claude`
defaults to the `claude` found on `PATH`. `baton doctor --help` prints the usage.

`baton doctor` is routed in `bend2/src/host/native-entry.c` (`doctor_entry`), the same way as
`baton dispatch`: the native entry runs `agent-summary-check.mjs doctor` under the Node runtime that
`dispatch_runtime` selects (`BATON2_NODE`, a sibling `node`, the bundled Bun, then `node` on `PATH`),
with the helper found at `../libexec/baton2/` in an installed package and at `../../bend2/scripts/`
in a source checkout. Every native binary that includes `native-entry.c` accepts the verb. The
`baton help` lists `doctor` in its action list, and `baton help doctor` prints the same usage text as
`baton doctor --help` (`help` in `bend2/src/coordinator/agent-actions.bend`;
`bend2/test/native-doctor-runtime.py` compares the two texts). The global `baton --help` listing in
`main.bend` does not name `doctor`.

`check-install.py` (`verify_agent_summary_preload`) refuses an installation whose
`libexec/baton2/agent-summary-check.mjs` is absent or whose `libexec/baton2/no-agent-summary.js`
differs from the pinned SHA-256.

At every Claude Code launch, fresh or resumed, `Turn.retained_prepare_checked` runs
`agent-summary-check.mjs seat-start`. That call starts the checks in a detached process and returns
at once, so the launch does not wait for them and does not depend on their result. The detached
process writes `agent-summary-check.json` into the attempt directory when the directory exists and
records each finding on the seat with `baton knowledge record --kind finding`. Before recording, it
reads the seat's findings with `baton knowledge read` and skips a finding whose claim is already
there, so a failure that lasts across launches is recorded once. The checks run to completion and
have no time limit; a slow start of Claude Code on a loaded host is not a finding. A Claude Code
update that removes the anchor shows up at the next launch or the next `doctor` run; the preload
then cancels nothing and the session behaves as it did before.

The direct `Turn.launch` path has no attempt directory. It runs the same seat-start check without
`--directory`, so it records findings and writes no report file.

## Qualification

The evidence comes from two different places.

**Launch path (what Baton gives a Claude Code process).**

- `Claude.bun_options`, `Claude.environment` and `Claude.with_environment` are checked as laws in
  `bend2/test/claude-preload-laws.bend` (queue check-only).
- `Turn.retained_prepare_checked` adds the entry to the retained `/usr/bin/env` prefix, and
  `Turn.claude_launch_configured` passes it to the direct spawn. The cases in
  `bend2/test/launch-store-retained.py` run the real retained composition through a native build of
  `bend2/test/launch-store-retained.bend`: a fresh and a resumed Claude Code start carry
  `BUN_OPTIONS=--preload=...`, an inherited `BUN_OPTIONS` stays in front of the preload option, other
  harnesses carry none, and the seat-start report is written.
- The Node tests compose the same string in JavaScript (`bunOptions`). That proves the helper's probe
  environment, not the Bend launch.

**Doctor probe (what the binary does with the option).** `baton doctor` starts the Claude Code
binary itself with `BUN_OPTIONS` set the way a launch sets it and reads the preload's log. It proves
that the binary loads the preload. It does not show that a Baton launch composed the option.

Node tests in `bend2/test/agent-summary-check.test.mjs` run the checks against fixture binaries:
a pass, a missing anchor, a preload that is not loaded, a changed and an unreadable preload, an
unresolved command, an anchor across a read-block boundary, the exit statuses, `doctor` with the
default command and with `--help`, and the seat-start call with and without findings, with and
without an attempt directory, and with a repeated launch.

`bend2/test/native-doctor-runtime.py` compiles the production `native-entry.c` (plain, focused and
router builds) with a stub runtime and runs `doctor` in an installed layout and in a source layout.
`bend2/test/package-licenses.py` checks the packaged preload digest and the license notice.

Run against the Claude Code binaries on the validation host (`baton doctor --claude PATH`):

| Binary | Exit | Result |
| --- | --- | --- |
| `claude/versions/2.1.310` | 0 | anchor present, preload loaded |
| `claude/versions/2.1.308` | 0 | anchor present, preload loaded |
| `claude/versions/2.1.47` | 1 | anchor present, `preload-not-loaded`: `claude --version` exited 0 and logged nothing. This release is older than the 2.1.257 to 2.1.312 range that the script's author lists as tested, and the cause was not investigated. |

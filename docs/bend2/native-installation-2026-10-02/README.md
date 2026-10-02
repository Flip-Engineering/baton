# Native installation qualification

The clean source build and staged executable passed the selected checks on
macOS 27.0 arm64. Source `dd1de109a55230704c58165b0a909c8ee5289e4e`, tree
`24fdeff8b8aef41a0cb2228171664221fcc88290`, produced binary SHA256
`e9374848831ccdb233839215c84ab6d1f1ee84a39a8fd2a601d2758f55987da8`.
It matches the executable qualified by that source's full acceptance gates.

## Build and staging

A fresh clean local clone used Bend 2.0.25, compiler SHA256
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`.
The build compiled the entry with its imported laws and retained command streams,
child exits, generated C and toolchain and library pins. This lane performed one
source build; the full negative controls and native suite ran separately on the
published source.

The staged prefix contained only `bin/baton2`. The source clone was moved to a
retained path before runtime checks, making its original build path unavailable.
The executable ran from an unrelated directory with fresh state and repository,
BEND absent, and PATH containing the staged prefix and system directories.

## Runtime checks

The public CLI exercised stored messaging, recruitment and a retained receive
through an explicitly supplied controlled OMP fixture. The keeper reexecuted the
staged coordinator. The task was acknowledged; its full report reached the parent
and was acknowledged; both inboxes emptied. The worker's committed change landed
through checked Git landing.

The first scratch consumer expected the wrong successful receive response shape
and failed after native delivery had completed. That attempt's source and output
remain retained. A fresh second state and repository passed after correcting only
the assertion. The runtime source and binary were unchanged.

All 55 recorded build, CLI, native, keeper and endpoint process identities were
absent at closure. Every directly owned subprocess was reaped. The source stayed
clean. No missing runtime asset was observed in these checks.

## Dependencies and scope

The executable dynamically links system SQLite and libSystem on this host. Git
is required for repository commands; native harnesses and landing checks require
their own dependencies. The controlled Python fixture is an external test
dependency. The Mach-O minimum-OS field is 15.5; execution was qualified on the
recorded macOS 27.0 arm64 host.

The local clone shares Git objects with the canonical repository. This check
qualified a local staged source-build artifact. Other hosts, architectures,
native provider authentication, global installation, packaged distribution and
release publication remain separate acceptance boundaries. Current npm and CI
package smoke checks cover the JS implementation.

## Retained evidence

[Summary](summary.json) records outcomes and limits.
[Artifact manifest](artifact-manifest.json) records retained paths, sizes and
hashes. Complete logs, source, workspaces and the local candidate remain under
`.scratch/native-installation-qualification-20261002` in the operator checkout.
The [installation procedure](../installation.md) describes the source-build and
staging commands.

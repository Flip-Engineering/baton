# CLAIM: the toolchain is the single `bend` command, whose surface is check, run, native build,
# JavaScript build, page bundle and publish; it has no test, debug, repl or format subcommand.
# The project's own tests under `tests/` are run by `gates/test.ts`, which compares each program's
# standard output against the `#|` lines in its own source, and this program is written to that
# convention. The one tool beside the binary is `tools/bend-fmt-lsp`, a formatting-only language
# server.
#
# Evidence: lang-host-tooling.evidence.md (exact commands and observed output).

import Base

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("lang-host-tooling: these two lines are also this file's #| lines")
    IO.print(U32.show(U32.mul(6, 7)))

#|lang-host-tooling: these two lines are also this file's #| lines
#|42

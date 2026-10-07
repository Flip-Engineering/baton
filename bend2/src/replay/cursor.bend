# bend2/src/replay/cursor.bend — the cursor-and-restart replay module of the Bend2 source tree.
#
# CLAIM: the pure decision model below answers the required logical behaviour of every cursor and
# restart case the corpus names: it names where the projection came from, the verdict the open
# reached on a projection checkpoint written under another authority, and the cursor and owed
# delivery a consumer resumes from.
# Serves: M-5 (a restart preserves the projection a consumer resumes from and the rows that
# consumer is still owed; a checkpoint written under one authority is rebuilt rather than trusted
# when the next open supplies a different one) with M-13 and M-17, as arch-replay-cursor.expect
# derives them. No ARCH-CLOSE row names this corpus.
# Fixture: the frozen case file docs/bend2/examples/arch-replay-cursor.cases, read from the repo
# root by default; the first command-line argument overrides the path.
# Pin: bend 2.0.25, bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868.
# Promoted from docs/bend2/examples/arch-replay-cursor.bend at 4e904cbd (the origin/bend2-rewrite
# tip this lane cut from); the corpus and its measured verdict are recorded in
# docs/bend2/examples/arch-replay-cursor.evidence.md.

import Base

# CASE|name|restart|basis|rows|readerCursor
type CaseRow is Data:
  CaseRow{name: String, restart: String, basis: String, rows: U32, readerCursor: U32}

def field_of(m: Maybe<&2, String>) -> String:
  match m:
    case None{}:
      ""
    case Some{v}:
      v

def field(fs: List<&2, String>, n: Nat) -> String:
  field_of(List.head(&2, String, List.drop(&2, String, fs, n)))

def parse_digits(xs: List<&2, Char>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      parse_digits(t, U32.add(U32.mul(acc, 10), U32.sub(Char.to_u32(h), Char.to_u32('0'))))

def parse_u32(s: String) -> U32:
  parse_digits(String.to_list(s), 0)

def case_fields(+fs: List<&2, String>) -> CaseRow:
  CaseRow{
    field(fs, 1n),
    field(fs, 2n),
    field(fs, 3n),
    parse_u32(field(fs, 4n)),
    parse_u32(field(fs, 5n)),
  }

def case_of(+line: String) -> CaseRow:
  case_fields(String.split(line, '|'))

# A checkpoint written under one authority is trusted only when the next open supplies the same one.
# Under any other basis the projection is rebuilt from the ledger: no row is refused, no history is
# lost, and the cursor the consumer resumes from is unchanged.
def source_of(same: Bool) -> String:
  match same:
    case True{}:
      "checkpoint"
    case False{}:
      "ledger_fallback"

def checkpoint_of(same: Bool) -> String:
  match same:
    case True{}:
      "valid"
    case False{}:
      "stale_authority"

def render_restart(+same: Bool, +name: String, +rows: U32, readerCursor: U32) -> String:
  String.concat(["RESULT|", name, "|source=", source_of(same), "|checkpoint=", checkpoint_of(same),
    "|cursor=", U32.show(rows), "|owed=", U32.show(U32.sub(rows, readerCursor))])

def render_live(+name: String, +rows: U32, readerCursor: U32) -> String:
  String.concat(["RESULT|", name, "|source=live|checkpoint=none|cursor=", U32.show(rows),
    "|owed=", U32.show(U32.sub(rows, readerCursor))])

def render_restarted(is_restart: Bool, name: String, basis: String, rows: U32, readerCursor: U32) -> String:
  match is_restart:
    case True{}:
      render_restart(String.eq(basis, "same"), name, rows, readerCursor)
    case False{}:
      render_live(name, rows, readerCursor)

def render(row: CaseRow) -> String:
  match row:
    case CaseRow{name, restart, basis, rows, readerCursor}:
      render_restarted(String.eq(restart, "checkpoint"), name, basis, rows, readerCursor)

def emit_if_case(is_case: Bool, line: String) -> IO(Unit):
  match is_case:
    case True{}:
      IO.print(render(case_of(line)))
    case False{}:
      IO.pure(Unit, Unit{})

def emit_line(+line: String) -> IO(Unit):
  emit_if_case(String.starts_with(line, "CASE|"), line)

def emit_lines(lines: List<&2, String>) -> IO(Unit):
  match lines:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- emit_line(h)
        emit_lines(t)

def read_go(m: File & Result<&1, &1, (U32 & String), String>) -> IO(Unit):
  (f, r) = m
  do IO<Unit>:
    text : String <- IO.pass(String, r)
    u : Unit <- emit_lines(String.lines(text))
    File.close(f)

# The corpus path: the first command-line argument when one is given, else the repo-root-relative
# default the header records.
def corpus_path(args: List<&1, String>) -> String:
  match args:
    case Nil{}:
      "docs/bend2/examples/arch-replay-cursor.cases"
    case h <> t:
      h

def main() -> IO(Unit):
  do IO<Unit>:
    as : List<&1, String> <- IO.args()
    f : File <- IO.try(File, File.open(corpus_path(as), "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8192)
    read_go(m)

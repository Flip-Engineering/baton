# CLAIM: at pin bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868 with bend 2.0.25, a pure
# Bend2 decision model reads the same case file the reference half reads and answers the required
# logical behaviour of every authorization-basis case: it admits the recorded lease when the basis
# that issued it is supplied, admits it when the same row is self-consistent and reconstructs from its
# own bytes, refuses it when that basis changed out from under it, classifies that cause apart from a
# payload that never bound, and reports the diagnostic verdict that basis implies. It models the
# decision; it folds no real ledger and writes no file.
#
# Evidence: arch-replay-basis.evidence.md (exact commands and observed output).

import Base

# One parsed case row, from one CASE line of arch-replay-basis.cases.
type CaseRow is Data:
  CaseRow{name: String, basis: String, integrity: String, rowSeq: U32, readerCursor: U32}

# The decision. `Admitted` carries the cursor the projection reaches; `Refused` carries the cause
# classification, the disposition, and the cursor the projection keeps.
type Verdict is Data:
  Admitted{cursor: U32}
  Refused{classification: String, quarantine: Bool, cursor: U32}

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

# A payload that never bound is refused whatever basis is supplied, and its cause is its own. A basis
# that changed is a different cause with the same disposition: no fold, no quarantine, the cursor and
# the owed delivery of the last row that did fold. A self-consistent row reconstructs from its own
# bytes and folds, whether or not the issuing basis is still supplied.
def judge_basis(changed: Bool, rowSeq: U32) -> Verdict:
  match changed:
    case True{}:
      Refused{"authorization_basis_changed", False{}, U32.sub(rowSeq, 1)}
    case False{}:
      Admitted{rowSeq}

def judge_integrity(invalid: Bool, basis: String, rowSeq: U32) -> Verdict:
  match invalid:
    case True{}:
      Refused{"invalid_payload", False{}, U32.sub(rowSeq, 1)}
    case False{}:
      judge_basis(String.eq(basis, "changed"), rowSeq)

def decide(basis: String, integrity: String, rowSeq: U32) -> Verdict:
  judge_integrity(String.eq(integrity, "invalid"), basis, rowSeq)

def show_bool(b: Bool) -> String:
  match b:
    case True{}:
      "true"
    case False{}:
      "false"

def show_remedy(quarantine: Bool) -> String:
  match quarantine:
    case True{}:
      "quarantine"
    case False{}:
      "none"

# The diagnostic path validates against the same basis, so its verdict follows the fold's: a ledger
# the deployment's basis refuses is never reported clean, and one it admits is never reported refused.
def render_verdict(name: String, readerCursor: U32, v: Verdict) -> String:
  match v:
    case Admitted{+cursor}:
      String.concat(["RESULT|", name, "|admitted=true|refusal=none|classification=none|quarantine=false|cursor=",
        U32.show(cursor), "|owed=", U32.show(U32.sub(cursor, readerCursor)),
        "|doctor=clean|remedy=none"])
    case Refused{classification, +quarantine, +cursor}:
      String.concat(["RESULT|", name, "|admitted=false|refusal=unspecified|classification=", classification,
        "|quarantine=", show_bool(quarantine), "|cursor=", U32.show(cursor),
        "|owed=", U32.show(U32.sub(cursor, readerCursor)),
        "|doctor=refused|remedy=", show_remedy(quarantine)])

def render(row: CaseRow) -> String:
  match row:
    case CaseRow{name, basis, integrity, rowSeq, readerCursor}:
      render_verdict(name, readerCursor, decide(basis, integrity, rowSeq))

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

def main() -> IO(Unit):
  do IO<Unit>:
    f : File <- IO.try(File, File.open("docs/bend2/examples/arch-replay-basis.cases", "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8192)
    read_go(m)

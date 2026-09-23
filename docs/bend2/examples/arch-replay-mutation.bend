# CLAIM: at pin bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868 with bend 2.0.25, a pure
# Bend2 decision model reads the same case file the reference half reads and answers the required
# logical behaviour of every rejected-mutation case: it admits the request admission accepts and writes
# one row, refuses a request whose shape is not admitted and names that cause, refuses a request whose
# authority expired and names that cause instead, and reports that a refused mutation wrote no row and
# left the cursor and the owed delivery where they were. It models the decision; it opens no ledger and
# writes no file.
#
# Evidence: arch-replay-mutation.evidence.md (exact commands and observed output).

import Base

# CASE|name|request|rowsBefore|readerCursor
type CaseRow is Data:
  CaseRow{name: String, request: String, rowsBefore: U32, readerCursor: U32}

# The decision. `Admitted` carries the rows the attempt wrote and the cursor that follows;
# `Refused` carries the cause the refusal must name and the state it left behind.
type Verdict is Data:
  Admitted{rows: U32, cursor: U32}
  Refused{classification: String, rows: U32, cursor: U32}

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
    parse_u32(field(fs, 3n)),
    parse_u32(field(fs, 4n)),
  }

def case_of(+line: String) -> CaseRow:
  case_fields(String.split(line, '|'))

# Two refused requests are two causes: a shape the request does not admit, and an authority that
# expired before the event the request is judged against. A refused mutation writes no row, so the
# cursor stays where the last accepted row left it and the owed delivery is unchanged.
def judge_shape(is_unknown_field: Bool, rowsBefore: U32) -> Verdict:
  match is_unknown_field:
    case True{}:
      Refused{"invalid_request", 0, rowsBefore}
    case False{}:
      Refused{"expired_authority", 0, rowsBefore}

def judge_request(is_valid: Bool, request: String, rowsBefore: U32) -> Verdict:
  match is_valid:
    case True{}:
      Admitted{1, U32.add(rowsBefore, 1)}
    case False{}:
      judge_shape(String.eq(request, "unknown_field"), rowsBefore)

def decide(+request: String, rowsBefore: U32) -> Verdict:
  judge_request(String.eq(request, "valid"), request, rowsBefore)

def render_verdict(name: String, readerCursor: U32, v: Verdict) -> String:
  match v:
    case Admitted{+rows, +cursor}:
      String.concat(["RESULT|", name, "|admitted=true|refusal_class=none|rows_written=", U32.show(rows),
        "|cursor=", U32.show(cursor), "|owed=", U32.show(U32.sub(cursor, readerCursor))])
    case Refused{classification, +rows, +cursor}:
      String.concat(["RESULT|", name, "|admitted=false|refusal_class=", classification,
        "|rows_written=", U32.show(rows), "|cursor=", U32.show(cursor),
        "|owed=", U32.show(U32.sub(cursor, readerCursor))])

def render(row: CaseRow) -> String:
  match row:
    case CaseRow{name, request, rowsBefore, readerCursor}:
      render_verdict(name, readerCursor, decide(request, rowsBefore))

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
    f : File <- IO.try(File, File.open("docs/bend2/examples/arch-replay-mutation.cases", "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8192)
    read_go(m)

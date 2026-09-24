# CLAIM: the production stop-replay decision model reads a frozen case file and decides the required
# logical behaviour of every stop-replay case — admitting the recorded stop when the policy basis
# that authorized it is supplied, classifying a missing basis as its own cause, separating that
# cause from corrupt source bytes with quarantine, and reporting the projection cursor and owed
# delivery each outcome leaves.
#
# Law entries and corrections: ARCH-CLOSE-11, M-5, M-14, M-17.
# Corpus (read-only): docs/bend2/examples/arch-replay-stop.cases
# Reference pin: bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868, bend 2.0.25 (reference/README.md).
# Promoted from: docs/bend2/examples/arch-replay-stop.bend

import Base

type CaseRow is Data:
  CaseRow{name: String, basis: String, integrity: String, rowSeq: U32, rowTargets: U32, readerCursor: U32}

type Verdict is Data:
  Admitted{targets: U32, cursor: U32}
  Refused{classification: String, quarantine: Bool, cursor: U32}

def show_bool(b: Bool) -> String:
  match b:
    case True{}:
      "true"
    case False{}:
      "false"

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
    parse_u32(field(fs, 6n)),
  }

def case_of(+line: String) -> CaseRow:
  case_fields(String.split(line, '|'))

def judge_basis(present: Bool, rowSeq: U32, rowTargets: U32) -> Verdict:
  match present:
    case True{}:
      Admitted{rowTargets, rowSeq}
    case False{}:
      Refused{"missing_policy_basis", False{}, U32.sub(rowSeq, 1)}

def judge_integrity(corrupt: Bool, basis: String, rowSeq: U32, rowTargets: U32) -> Verdict:
  match corrupt:
    case True{}:
      Refused{"corrupt_source_bytes", True{}, U32.sub(rowSeq, 1)}
    case False{}:
      judge_basis(String.eq(basis, "present"), rowSeq, rowTargets)

def decide(basis: String, integrity: String, rowSeq: U32, rowTargets: U32) -> Verdict:
  judge_integrity(String.eq(integrity, "corrupt"), basis, rowSeq, rowTargets)

def show_remedy(quarantine: Bool) -> String:
  match quarantine:
    case True{}:
      "quarantine"
    case False{}:
      "none"

def render_verdict(name: String, readerCursor: U32, v: Verdict) -> String:
  match v:
    case Admitted{targets, +cursor}:
      String.concat(["RESULT|", name, "|admitted=true|refusal=none|classification=none|quarantine=false|targets=",
        U32.show(targets), "|cursor=", U32.show(cursor),
        "|owed=", U32.show(U32.sub(cursor, readerCursor)), "|remedy=none"])
    case Refused{classification, +quarantine, +cursor}:
      String.concat(["RESULT|", name, "|admitted=false|refusal=unspecified|classification=", classification,
        "|quarantine=", show_bool(quarantine), "|targets=0|cursor=", U32.show(cursor),
        "|owed=", U32.show(U32.sub(cursor, readerCursor)), "|remedy=", show_remedy(quarantine)])

def render(row: CaseRow) -> String:
  match row:
    case CaseRow{name, basis, integrity, rowSeq, rowTargets, readerCursor}:
      render_verdict(name, readerCursor, decide(basis, integrity, rowSeq, rowTargets))

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

def corpus_path_or_default(arg: Maybe<&1, String>) -> String:
  match arg:
    case None{}:
      "docs/bend2/examples/arch-replay-stop.cases"
    case Some{v}:
      v

def corpus_path(argv: List<&1, String>) -> String:
  corpus_path_or_default(List.head(&1, String, List.drop(&1, String, argv, 1n)))

def main() -> IO(Unit):
  do IO<Unit>:
    argv : List<String> <- IO.args()
    f : File <- IO.try(File, File.open(corpus_path(argv), "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8192)
    read_go(m)

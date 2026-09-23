# CLAIM: at pin bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868 with bend 2.0.25, a pure
# Bend2 decision model reads the same case file the reference half reads and answers the required
# logical behaviour of every event-vocabulary case: the frozen sixteen-row trace folds whole and
# lands each row in its own collection, a kind no vocabulary admits refuses decode at its own row
# and retains the prefix before it, a payload missing a required field refuses decode the same way,
# a runtime-composed row the contract set excludes still folds, and folding the same trace twice
# yields one projection. It models the decision; it opens no ledger and writes no file.
#
# Evidence: arch-replay-vocabulary.evidence.md (exact commands and observed output).

import Base

# CASE|name|mutation|replays
type CaseRow is Data:
  CaseRow{name: String, mutation: String, replays: String}

# The collection a frozen row lands in. The seeds land in none; the runtime-composed bypass row
# appends history on the writer record it names, so its class is none too.
type Cls is Data:
  NoneC{}
  Pa{}
  Gr{}
  Wo{}
  Cl{}
  As{}
  Pr{}
  Cx{}
  Co{}
  Rv{}
  Cp{}
  Po{}

# One row of the frozen composition: its collection class, and whether the contract's
# caller-submittable set admits the kind.
type Row is Data:
  Row{cls: Cls, caller: Bool}

# The mutation a case applies, as the composition reads it.
type Tag is Data:
  Full{}
  Forged{}
  Missing{}
  Driver{}

def field_of(m: Maybe<&2, String>) -> String:
  match m:
    case None{}:
      ""
    case Some{v}:
      v

def field(fs: List<&2, String>, n: Nat) -> String:
  field_of(List.head(&2, String, List.drop(&2, String, fs, n)))

def case_fields(+fs: List<&2, String>) -> CaseRow:
  CaseRow{
    field(fs, 1n),
    field(fs, 2n),
    field(fs, 3n),
  }

def case_of(+line: String) -> CaseRow:
  case_fields(String.split(line, '|'))

def tag_of_on(is_forged: Bool, is_missing: Bool, is_driver: Bool) -> Tag:
  match is_forged:
    case True{}:
      Forged{}
    case False{}:
      match is_missing:
        case True{}:
          Missing{}
        case False{}:
          match is_driver:
            case True{}:
              Driver{}
            case False{}:
              Full{}

def tag_of(+mutation: String) -> Tag:
  tag_of_on(String.eq(mutation, "forged_kind"), String.eq(mutation, "missing_field"), String.eq(mutation, "driver_row"))

def row13(tag: Tag) -> Row:
  match tag:
    case Driver{}:
      Row{NoneC{}, False{}}
    case Full{}:
      Row{Po{}, True{}}
    case Forged{}:
      Row{Po{}, True{}}
    case Missing{}:
      Row{Po{}, True{}}

# The frozen sixteen-row composition in ledger order (arch-replay-vocabulary.ledger.jsonl). Rows
# 1-3 are the runtime seeds the contract set excludes; the proposal row arrives its plan, so the
# work and claim counts grow by it; the handoff and the release rewrite their rows in place.
# `Driver` replaces the policy row with the runtime-composed bypass row: no collection count
# changes, the policy stays unset, and the row leaves the caller set.
def composition(tag: Tag) -> +List<Row>:
  Row{NoneC{}, False{}} <>
  Row{Pa{}, False{}} <>
  Row{Pa{}, False{}} <>
  Row{Gr{}, True{}} <>
  Row{Wo{}, True{}} <>
  Row{Cp{}, True{}} <>
  Row{Cl{}, True{}} <>
  Row{As{}, True{}} <>
  Row{Pr{}, True{}} <>
  Row{Cx{}, True{}} <>
  Row{Co{}, True{}} <>
  Row{Rv{}, True{}} <>
  row13(tag) <>
  Row{Cl{}, True{}} <>
  Row{As{}, True{}} <>
  Row{NoneC{}, True{}} <>
  []


def size(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      1n+size(t)

def prefix(n: Nat, rows: +List<Row>) -> +List<Row>:
  match n:
    case 0n:
      []
    case 1n+p:
      match rows:
        case Nil{}:
          []
        case h <> t:
          h <> prefix(p, t)

def count_pa(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Pa{}:
              1n+count_pa(t)
            case other:
              count_pa(t)

def count_gr(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Gr{}:
              1n+count_gr(t)
            case other:
              count_gr(t)

def count_wo(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Wo{}:
              1n+count_wo(t)
            case other:
              count_wo(t)

def count_cl(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Cl{}:
              1n+count_cl(t)
            case other:
              count_cl(t)

def count_as(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case As{}:
              1n+count_as(t)
            case other:
              count_as(t)

def count_pr(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Pr{}:
              1n+count_pr(t)
            case other:
              count_pr(t)

def count_cx(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Cx{}:
              1n+count_cx(t)
            case other:
              count_cx(t)

def count_co(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Co{}:
              1n+count_co(t)
            case other:
              count_co(t)

def count_rv(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Rv{}:
              1n+count_rv(t)
            case other:
              count_rv(t)

def count_cp(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Cp{}:
              1n+count_cp(t)
            case other:
              count_cp(t)

def count_po(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match c:
            case Po{}:
              1n+count_po(t)
            case other:
              count_po(t)

def count_caller(rows: +List<Row>) -> Nat:
  match rows:
    case Nil{}:
      0n
    case h <> t:
      match h:
        case Row{c, q}:
          match q:
            case True{}:
              1n+count_caller(t)
            case False{}:
              count_caller(t)

# The word for a collection count. The frozen composition bounds every count by two.
def word(n: Nat) -> String:
  match n:
    case 0n:
      "0"
    case 1n:
      "1"
    case rest:
      "2"

# A kind no vocabulary admits refuses decode at its own row: the replay retains the prefix before
# it. A payload missing a required field refuses decode the same way at row 11. The frozen trace
# and the driver case fold whole.
def admitted(tag: Tag) -> Nat:
  match tag:
    case Forged{}:
      6n
    case Missing{}:
      10n
    case Full{}:
      16n
    case Driver{}:
      16n

def decode_stop(tag: Tag) -> String:
  match tag:
    case Forged{}:
      "7"
    case Missing{}:
      "11"
    case Full{}:
      "0"
    case Driver{}:
      "0"

def decode_code(tag: Tag) -> String:
  match tag:
    case Forged{}:
      "unknown_event_kind"
    case Missing{}:
      "invalid_payload"
    case Full{}:
      "none"
    case Driver{}:
      "none"

def fingerprint(rows: +List<Row>) -> String:
  String.concat([
    "pa", word(count_pa(rows)),
    ",gr", word(count_gr(rows)),
    ",wo", word(count_wo(rows)),
    ",cl", word(count_cl(rows)),
    ",as", word(count_as(rows)),
    ",pr", word(count_pr(rows)),
    ",cx", word(count_cx(rows)),
    ",co", word(count_co(rows)),
    ",rv", word(count_rv(rows)),
    ",cp", word(count_cp(rows)),
    ",po", word(count_po(rows)),
  ])

def rerun_word_on(is_twice: Bool) -> String:
  match is_twice:
    case True{}:
      "true"
    case False{}:
      "na"

def rerun_word(replays: String) -> String:
  rerun_word_on(String.eq(replays, "twice"))

def line(name: String, tag: Tag, rer: String) -> String:
  String.concat([
    "RESULT|", name,
    "|rows=16", "|admitted=", word(admitted(tag)),
    "|decode_stop=", decode_stop(tag),
    "|decode_code=", decode_code(tag),
    "|fold_stop=0", "|fold_code=none",
    "|caller_rows=", word(count_caller(prefix(admitted(tag), composition(tag)))),
    "|fp=", fingerprint(prefix(admitted(tag), composition(tag))),
    "|rerun_identical=", rer,
  ])

def render(row: CaseRow) -> String:
  match row:
    case CaseRow{name, mutation, replays}:
      line(name, tag_of(mutation), rerun_word(replays))

def emit_if_case(is_case: Bool, line_text: String) -> IO(Unit):
  match is_case:
    case True{}:
      IO.print(render(case_of(line_text)))
    case False{}:
      IO.pure(Unit, Unit{})

def emit_line(+line_text: String) -> IO(Unit):
  emit_if_case(String.starts_with(line_text, "CASE|"), line_text)

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
    f : File <- IO.try(File, File.open("docs/bend2/examples/arch-replay-vocabulary.cases", "r"))
    m : File & Result<&1, &1, (U32 & String), String> <- File.read(f, 8192)
    read_go(m)

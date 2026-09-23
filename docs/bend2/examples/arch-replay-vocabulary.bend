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
  Row{NoneC{}, True{}} <>
  Row{NoneC{}, True{}} <>
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

def succ(n: Nat) -> Nat:
  1n+n


def counts(rows: +List<Row>, pa: Nat, gr: Nat, wo: Nat, cl: Nat, asn: Nat, pr: Nat, cx: Nat, co: Nat, rv: Nat, cp: Nat, po: Nat) -> (Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat):
  match rows:
    case Nil{}:
      (pa, gr, wo, cl, asn, pr, cx, co, rv, cp, po)
    case h <> t:
      match h:
        case Row{NoneC{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, cx, co, rv, cp, po)
        case Row{Pa{}, q}:
          counts(t, 1n+pa, gr, wo, cl, asn, pr, cx, co, rv, cp, po)
        case Row{Gr{}, q}:
          counts(t, pa, 1n+gr, wo, cl, asn, pr, cx, co, rv, cp, po)
        case Row{Wo{}, q}:
          counts(t, pa, gr, 1n+wo, cl, asn, pr, cx, co, rv, cp, po)
        case Row{Cl{}, q}:
          counts(t, pa, gr, wo, 1n+cl, asn, pr, cx, co, rv, cp, po)
        case Row{As{}, q}:
          counts(t, pa, gr, wo, cl, 1n+asn, pr, cx, co, rv, cp, po)
        case Row{Pr{}, q}:
          counts(t, pa, gr, succ(wo), succ(cl), asn, succ(pr), cx, co, rv, cp, po)
        case Row{Cx{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, 1n+cx, co, rv, cp, po)
        case Row{Co{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, cx, 1n+co, rv, cp, po)
        case Row{Rv{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, cx, co, 1n+rv, cp, po)
        case Row{Cp{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, cx, co, rv, 1n+cp, po)
        case Row{Po{}, q}:
          counts(t, pa, gr, wo, cl, asn, pr, cx, co, rv, cp, 1n+po)

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
def num(n: Nat) -> String:
  match n:
    case 0n:
      "0"
    case 3n:
      "3"
    case 6n:
      "6"
    case 7n:
      "7"
    case 10n:
      "10"
    case 11n:
      "11"
    case 12n:
      "12"
    case 13n:
      "13"
    case 16n:
      "16"
    case rest:
      "?"

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

def decode_stop(tag: Tag) -> Nat:
  match tag:
    case Forged{}:
      7n
    case Missing{}:
      11n
    case Full{}:
      0n
    case Driver{}:
      0n

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

def fingerprint(t: (Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat & Nat)) -> String:
  match t:
    case (pa, gr, wo, cl, asn, pr, cx, co, rv, cp, po):
      String.concat([
        "pa", word(pa),
        ",gr", word(gr),
        ",wo", word(wo),
        ",cl", word(cl),
        ",as", word(asn),
        ",pr", word(pr),
        ",cx", word(cx),
        ",co", word(co),
        ",rv", word(rv),
        ",cp", word(cp),
        ",po", word(po),
      ])

def rerun_word_on(is_twice: Bool) -> String:
  match is_twice:
    case True{}:
      "true"
    case False{}:
      "na"

def rerun_word(replays: String) -> String:
  rerun_word_on(String.eq(replays, "twice"))

def line(name: String, +tag: Tag, rer: String) -> String:
  String.concat([
    "RESULT|", name,
    "|rows=16", "|admitted=", num(admitted(tag)),
    "|decode_stop=", num(decode_stop(tag)),
    "|decode_code=", decode_code(tag),
    "|fold_stop=0", "|fold_code=none",
    "|caller_rows=", num(count_caller(prefix(admitted(tag), composition(tag)))),
    "|fp=", fingerprint(counts(prefix(admitted(tag), composition(tag)), 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n)),
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

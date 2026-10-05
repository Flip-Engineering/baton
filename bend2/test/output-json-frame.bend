# Executable corpus for bend2/src/receive/output-json-frame.bend.
# CLAIM: every named case asserts a complete typed structural tree through explicit equality,
# so value constructor, array order, member order and multiplicity, decoded key units, key and
# value lexical originals, numeric spelling and the whole original input are each checked
# independently, and a second group asserts the result comparator by requiring inequality when
# exactly one field differs.
# Object trees are written as the flat alternating member list the implementation uses: every
# even position is a string key and every odd position is its value, written out literally
# rather than sorted, filtered, deduplicated or extracted. This is how the even-length and
# string-key construction invariant is demonstrated, case by case, against expected lists
# written independently of the implementation.
# Expectations are written independently and name every expected byte. Refusal reasons are the
# literals the frame and lexer steps produce, read from those sources.
# The construction invariant is demonstrated only by cases whose inputs the implementation
# accepts, because a refused input yields no tree to inspect.
# Language forms: definitions before their callers, nested matches over the pinned result
# constructors with positional binders, Bool.pick with a first type argument, and a computed
# value bound to a parameter before it is matched. UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-frame.bend as F

# One comparison task: a value pair, a list pair, or a task that has already been determined
# different. The worklist keeps the value comparison single-recursive, because a task is
# pushed for a child pair instead of being compared by a second recursive function.
type Work is Data:
  WVal{left: F.FrameVal, right: F.FrameVal}
  WList{left: List<F.FrameVal>, right: List<F.FrameVal>}
  WDiff{}

def same_units(left: List<U32>, right: List<U32>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, U32.is_eq(lh, rh), same_units(lt, rt), False{})

def agree() -> List<Work>:
  Nil{}

def diff() -> List<Work>:
  [WDiff{}]

def choose(+held: Bool) -> List<Work>:
  Bool.pick(List<Work>, held, Nil{}, [WDiff{}])

def step_list(+left: List<F.FrameVal>, +right: List<F.FrameVal>) -> List<Work>:
  match left:
    case Nil{}:
      match right:
        case Nil{}: Nil{}
        case _r <> _rt: [WDiff{}]
    case lh <> lt:
      match right:
        case Nil{}: [WDiff{}]
        case +rh <> +rt: [WVal{lh, rh}, WList{lt, rt}]

def step_val(+left: F.FrameVal, +right: F.FrameVal) -> List<Work>:
  match left:
    case F.FNull{}:
      match right:
        case F.FNull{}: agree()
        case F.FBool{_b}: diff()
        case F.FNum{_o}: diff()
        case F.FStr{_u, _o}: diff()
        case F.FArr{_i}: diff()
        case F.FObj{_m}: diff()
    case F.FBool{a_value}:
      match right:
        case F.FNull{}: diff()
        case F.FBool{+b_value}:
          choose(Bool.pick(Bool, a_value, b_value, Bool.pick(Bool, b_value, False{}, True{})))
        case F.FNum{_o}: diff()
        case F.FStr{_u, _o}: diff()
        case F.FArr{_i}: diff()
        case F.FObj{_m}: diff()
    case F.FNum{a_orig}:
      match right:
        case F.FNull{}: diff()
        case F.FBool{_b}: diff()
        case F.FNum{b_orig}: choose(same_units(a_orig, b_orig))
        case F.FStr{_u, _o}: diff()
        case F.FArr{_i}: diff()
        case F.FObj{_m}: diff()
    case F.FStr{a_units, a_orig}:
      match right:
        case F.FNull{}: diff()
        case F.FBool{_b}: diff()
        case F.FNum{_o}: diff()
        case F.FStr{b_units, b_orig}:
          choose(Bool.and(same_units(a_units, b_units), same_units(a_orig, b_orig)))
        case F.FArr{_i}: diff()
        case F.FObj{_m}: diff()
    case F.FArr{a_items}:
      match right:
        case F.FNull{}: diff()
        case F.FBool{_b}: diff()
        case F.FNum{_o}: diff()
        case F.FStr{_u, _o}: diff()
        case F.FArr{b_items}: [WList{a_items, b_items}]
        case F.FObj{_m}: diff()
    case F.FObj{a_members}:
      match right:
        case F.FNull{}: diff()
        case F.FBool{_b}: diff()
        case F.FNum{_o}: diff()
        case F.FStr{_u, _o}: diff()
        case F.FArr{_i}: diff()
        case F.FObj{b_members}: [WList{a_members, b_members}]

# One self-recursive comparison over the worklist. It matches its own list parameter, pushes
# child tasks instead of calling a second recursive function, and stops at the first
# difference, so no two helpers call each other.
def all_same(work: List<Work>) -> Bool:
  match work:
    case Nil{}: True{}
    case h <> t:
      match h:
        case WDiff{}: False{}
        case WVal{left, right}: all_same(step_val(left, right) <> t)
        case WList{left, right}: all_same(step_list(left, right) <> t)

def same_val(left: F.FrameVal, right: F.FrameVal) -> Bool:
  all_same([WVal{left, right}])

def same_result(left: F.FrameResult, right: F.FrameResult) -> Bool:
  match left:
    case F.FrameOk{a_value, a_orig}:
      match right:
        case F.FrameOk{b_value, b_orig}:
          Bool.and(same_val(a_value, b_value), same_units(a_orig, b_orig))
        case F.FrameRefused{_r, _o}: False{}
        case F.FrameUnsupported{_r, _o}: False{}
        case F.FrameHostFault{_v, _o}: False{}
    case F.FrameRefused{a_reason, a_orig}:
      match right:
        case F.FrameOk{_v, _o}: False{}
        case F.FrameRefused{b_reason, b_orig}:
          Bool.and(String.eq(a_reason, b_reason), same_units(a_orig, b_orig))
        case F.FrameUnsupported{_r, _o}: False{}
        case F.FrameHostFault{_v, _o}: False{}
    case F.FrameUnsupported{a_reason, a_orig}:
      match right:
        case F.FrameOk{_v, _o}: False{}
        case F.FrameRefused{_r, _o}: False{}
        case F.FrameUnsupported{b_reason, b_orig}:
          Bool.and(String.eq(a_reason, b_reason), same_units(a_orig, b_orig))
        case F.FrameHostFault{_v, _o}: False{}
    case F.FrameHostFault{a_value, a_orig}:
      match right:
        case F.FrameOk{_v, _o}: False{}
        case F.FrameRefused{_r, _o}: False{}
        case F.FrameUnsupported{_r, _o}: False{}
        case F.FrameHostFault{b_value, b_orig}:
          Bool.and(U32.is_eq(a_value, b_value), same_units(a_orig, b_orig))

def vnull() -> F.FrameVal:
  F.FNull{}

def vbool(value: Bool) -> F.FrameVal:
  F.FBool{value}

def vnum(original: List<U32>) -> F.FrameVal:
  F.FNum{original}

def vstr(units: List<U32>, original: List<U32>) -> F.FrameVal:
  F.FStr{units, original}

def varr(items: List<F.FrameVal>) -> F.FrameVal:
  F.FArr{items}

def vobj(members: List<F.FrameVal>) -> F.FrameVal:
  F.FObj{members}

def ok(value: F.FrameVal, original: List<U32>) -> F.FrameResult:
  F.FrameOk{value, original}

def refused(reason: String, original: List<U32>) -> F.FrameResult:
  F.FrameRefused{reason, original}

def unsupported(reason: String, original: List<U32>) -> F.FrameResult:
  F.FrameUnsupported{reason, original}

def fault(value: U32, original: List<U32>) -> F.FrameResult:
  F.FrameHostFault{value, original}

def cases() -> List<List<U32> & F.FrameResult & String>:
  [
    ([110, 117, 108, 108], ok(vnull(), [110, 117, 108, 108]), "scalar-null"),
    ([116, 114, 117, 101], ok(vbool(True{}), [116, 114, 117, 101]), "scalar-true"),
    ([102, 97, 108, 115, 101], ok(vbool(False{}), [102, 97, 108, 115, 101]), "scalar-false"),
    ([48], ok(vnum([48]), [48]), "scalar-zero"),
    ([45, 48], ok(vnum([45, 48]), [45, 48]), "scalar-negative-zero-spelling"),
    ([49, 46, 53, 101, 43, 55], ok(vnum([49, 46, 53, 101, 43, 55]), [49, 46, 53, 101, 43, 55]),
      "scalar-exponent-spelling"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      ok(vnum([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51]),
        [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51]),
      "scalar-number-beyond-two-to-fifty-three"),
    ([34, 97, 34], ok(vstr([97], [34, 97, 34]), [34, 97, 34]), "string-one-unit"),
    ([34, 34], ok(vstr([], [34, 34]), [34, 34]), "string-empty"),
    ([34, 123, 125, 91, 93, 44, 58, 34],
      ok(vstr([123, 125, 91, 93, 44, 58], [34, 123, 125, 91, 93, 44, 58, 34]),
        [34, 123, 125, 91, 93, 44, 58, 34]),
      "quoted-punctuation-is-string-data"),
    ([34, 92, 34, 34], ok(vstr([34], [34, 92, 34, 34]), [34, 92, 34, 34]),
      "string-escaped-quote-unit-and-original"),
    ([34, 92, 117, 48, 48, 54, 49, 34],
      ok(vstr([97], [34, 92, 117, 48, 48, 54, 49, 34]), [34, 92, 117, 48, 48, 54, 49, 34]),
      "string-unicode-escape-unit-and-original"),
    ([91, 93], ok(varr([]), [91, 93]), "array-empty"),
    ([91, 32, 93], ok(varr([]), [91, 32, 93]), "array-empty-with-space"),
    ([123, 125], ok(vobj([]), [123, 125]), "object-empty"),
    ([91, 49, 44, 50, 93], ok(varr([vnum([49]), vnum([50])]), [91, 49, 44, 50, 93]),
      "array-two-numbers-in-order"),
    ([91, 49, 44, 91, 50, 93, 44, 123, 34, 97, 34, 58, 51, 125, 93],
      ok(varr([vnum([49]), varr([vnum([50])]), vobj([vstr([97], [34, 97, 34]), vnum([51])])]),
        [91, 49, 44, 91, 50, 93, 44, 123, 34, 97, 34, 58, 51, 125, 93]),
      "mixed-array-of-number-array-object"),
    ([123, 34, 97, 34, 58, 49, 125],
      ok(vobj([vstr([97], [34, 97, 34]), vnum([49])]), [123, 34, 97, 34, 58, 49, 125]),
      "object-one-member"),
    ([123, 34, 97, 34, 58, 49, 44, 34, 98, 34, 58, 91, 50, 44, 123, 34, 99, 34, 58, 110, 117, 108,
      108, 125, 93, 125],
      ok(vobj([vstr([97], [34, 97, 34]), vnum([49]), vstr([98], [34, 98, 34]),
        varr([vnum([50]), vobj([vstr([99], [34, 99, 34]), vnull()])])]),
        [123, 34, 97, 34, 58, 49, 44, 34, 98, 34, 58, 91, 50, 44, 123, 34, 99, 34, 58, 110, 117, 108,
          108, 125, 93, 125]),
      "object-member-with-nested-array-and-object"),
    ([123, 34, 97, 34, 58, 49, 44, 34, 97, 34, 58, 50, 125],
      ok(vobj([vstr([97], [34, 97, 34]), vnum([49]), vstr([97], [34, 97, 34]), vnum([50])]),
        [123, 34, 97, 34, 58, 49, 44, 34, 97, 34, 58, 50, 125]),
      "repeated-equal-key-preserved-in-order"),
    ([123, 34, 97, 34, 58, 49, 44, 34, 92, 117, 48, 48, 54, 49, 34, 58, 50, 125],
      ok(vobj([vstr([97], [34, 97, 34]), vnum([49]), vstr([97], [34, 92, 117, 48, 48, 54, 49, 34]),
        vnum([50])]),
        [123, 34, 97, 34, 58, 49, 44, 34, 92, 117, 48, 48, 54, 49, 34, 58, 50, 125]),
      "differently-escaped-equal-keys-preserved"),
    ([123, 34, 97, 58, 98, 34, 58, 49, 125],
      ok(vobj([vstr([97, 58, 98], [34, 97, 58, 98, 34]), vnum([49])]),
        [123, 34, 97, 58, 98, 34, 58, 49, 125]),
      "quoted-colon-inside-key"),
    ([32, 9, 91, 10, 49, 13, 93, 32], ok(varr([vnum([49])]), [32, 9, 91, 10, 49, 13, 93, 32]),
      "surrounding-whitespace-accepted"),
    ([91, 110, 117, 108, 108, 44, 116, 114, 117, 101, 44, 102, 97, 108, 115, 101, 44, 49, 44, 34,
      115, 34, 93],
      ok(varr([vnull(), vbool(True{}), vbool(False{}), vnum([49]), vstr([115], [34, 115, 34])]),
        [91, 110, 117, 108, 108, 44, 116, 114, 117, 101, 44, 102, 97, 108, 115, 101, 44, 49, 44, 34,
          115, 34, 93]),
      "array-of-all-scalar-kinds"),
    ([91, 91, 91, 91, 49, 93, 93, 93, 93],
      ok(varr([varr([varr([varr([vnum([49])])])])]), [91, 91, 91, 91, 49, 93, 93, 93, 93]),
      "nested-arrays-four-deep"),
    ([91, 49, 93], ok(varr([vnum([49])]), [91, 49, 93]), "array-one-number-closes"),
    ([91, 91, 93, 93], ok(varr([varr([])]), [91, 91, 93, 93]),
      "array-containing-empty-array-closes"),
    ([123, 34, 97, 34, 58, 123, 125, 125],
      ok(vobj([vstr([97], [34, 97, 34]), vobj([])]), [123, 34, 97, 34, 58, 123, 125, 125]),
      "object-member-empty-object-closes"),
    ([91, 91, 49, 44, 93, 93], refused("expected_value", [91, 91, 49, 44, 93, 93]),
      "nested-trailing-comma-refused"),
    ([49, 32, 50], refused("trailing_data", [49, 32, 50]), "trailing-top-level-token-refused"),
    ([], refused("unexpected_end", []), "empty-input-frame-refusal"),
    ([32, 9], refused("unexpected_end", [32, 9]), "whitespace-only-frame-refusal"),
    ([91, 49, 44, 93], refused("expected_value", [91, 49, 44, 93]), "trailing-comma-array-refused"),
    ([123, 34, 97, 34, 58, 49, 44, 125], refused("expected_key", [123, 34, 97, 34, 58, 49, 44, 125]),
      "trailing-comma-object-refused"),
    ([91, 49], refused("unexpected_end", [91, 49]), "unclosed-array-refused"),
    ([123], refused("unexpected_end", [123]), "unclosed-object-refused"),
    ([93], refused("expected_value", [93]), "stray-closing-bracket-refused"),
    ([125], refused("expected_value", [125]), "stray-closing-brace-refused"),
    ([123, 34, 97, 34, 32, 49, 125], refused("expected_colon", [123, 34, 97, 34, 32, 49, 125]),
      "missing-colon-refused"),
    ([123, 49, 58, 50, 125], refused("expected_key", [123, 49, 58, 50, 125]),
      "non-string-key-refused"),
    ([123, 34, 97, 34, 58, 125], refused("expected_value", [123, 34, 97, 34, 58, 125]),
      "missing-value-refused"),
    ([91, 49, 32, 50, 93], refused("expected_separator_or_close", [91, 49, 32, 50, 93]),
      "missing-comma-refused"),
    ([123, 34, 97, 34, 58, 49, 93], refused("expected_separator_or_close",
      [123, 34, 97, 34, 58, 49, 93]),
      "mismatched-closer-object-refused"),
    ([91, 49, 125], refused("expected_separator_or_close", [91, 49, 125]),
      "mismatched-closer-array-refused"),
    ([34, 92, 120, 256], fault(256, [34, 92, 120, 256]), "host-fault-after-malformed-prefix"),
    ([49, 256], fault(256, [49, 256]), "host-fault-after-complete-value"),
    ([300, 256], fault(300, [300, 256]), "first-host-fault-wins"),
    ([116, 114, 117], refused("unrecognized_atom", [116, 114, 117]), "lexical-refusal-propagated"),
    ([48, 49], refused("leading_zero", [48, 49]), "number-refusal-propagated"),
    ([34, 0, 34], refused("raw_control", [34, 0, 34]), "string-refusal-propagated"),
  ]

# The controls isolate one comparator field at a time by changing it and nothing else, so each
# pair fails on exactly that field. Several pairs are synthetic results that the lexer and the
# frame step cannot produce, including reordered and duplicated member lists and reordered
# array items; that is their purpose and they are not claims about reachable output. Object
# lists in this group keep string keys in even positions, so the pair differs in the field
# named and not merely in validity.
def unequal_pairs() -> List<F.FrameResult & F.FrameResult & String>:
  [
    (ok(vnull(), [110, 117, 108, 108]), ok(vbool(True{}), [110, 117, 108, 108]),
      "comparator-value-constructor"),
    (ok(varr([vnum([49]), vnum([50])]), [91, 49, 44, 50, 93]),
      ok(varr([vnum([50]), vnum([49])]), [91, 49, 44, 50, 93]), "comparator-array-order"),
    (ok(varr([vnum([49])]), [91, 49, 93]), ok(varr([vnum([49]), vnum([49])]), [91, 49, 93]),
      "comparator-array-multiplicity"),
    (ok(vobj([vstr([97], [34, 97, 34]), vnum([49]), vstr([98], [34, 98, 34]), vnum([50])]),
       [123, 125]),
      ok(vobj([vstr([98], [34, 98, 34]), vnum([50]), vstr([97], [34, 97, 34]), vnum([49])]),
       [123, 125]),
      "comparator-member-order"),
    (ok(vobj([vstr([97], [34, 97, 34]), vnum([49])]), [123, 125]),
      ok(vobj([vstr([97], [34, 97, 34]), vnum([49]), vstr([97], [34, 97, 34]), vnum([49])]),
        [123, 125]),
      "comparator-member-multiplicity"),
    (ok(vobj([vstr([97], [34, 97, 34]), vnum([49])]), [123, 125]),
      ok(vobj([vstr([98], [34, 97, 34]), vnum([49])]), [123, 125]), "comparator-decoded-key"),
    (ok(vobj([vstr([97], [34, 97, 34]), vnum([49])]), [123, 125]),
      ok(vobj([vstr([97], [34, 92, 117, 48, 48, 54, 49, 34]), vnum([49])]), [123, 125]),
      "comparator-key-lexical-original"),
    (ok(vstr([97], [34, 97, 34]), [34, 97, 34]),
      ok(vstr([97], [34, 92, 117, 48, 48, 54, 49, 34]), [34, 97, 34]),
      "comparator-string-lexical-original"),
    (ok(vnum([49]), [49]), ok(vnum([49, 48]), [49]), "comparator-number-spelling"),
    (ok(vbool(True{}), [116, 114, 117, 101]), ok(vbool(False{}), [116, 114, 117, 101]),
      "comparator-boolean-payload"),
    (ok(vnull(), [110, 117, 108, 108]), refused("unexpected_end", [110, 117, 108, 108]),
      "comparator-disposition"),
    (refused("unexpected_end", [93]), refused("expected_value", [93]), "comparator-refusal-reason"),
    (refused("unexpected_end", [93]), refused("unexpected_end", [93, 32]),
      "comparator-refusal-original"),
    (fault(256, [256]), fault(300, [256]), "comparator-fault-value"),
    (fault(256, [256]), fault(256, [256, 32]), "comparator-fault-original"),
    (fault(256, [256]), unsupported("reason", [256]), "comparator-fault-disposition"),
    (unsupported("first_reason", [1]), unsupported("second_reason", [1]),
      "comparator-unsupported-reason"),
    (unsupported("same_reason", [1]), unsupported("same_reason", [1, 2]),
      "comparator-unsupported-original"),
    (ok(vnull(), [110, 117, 108, 108]), ok(vnull(), [110, 117, 108, 108, 32]),
      "comparator-full-original"),
  ]

def judge(actual: F.FrameResult, expected: F.FrameResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_unequal(left: F.FrameResult, right: F.FrameResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check(case: List<U32> & F.FrameResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(F.decode_frame(octets), expected, name)

def check_pair(pair: F.FrameResult & F.FrameResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run(rows: List<List<U32> & F.FrameResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_pairs(rows: List<F.FrameResult & F.FrameResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})

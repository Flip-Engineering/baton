# CLAIM: the canonical native semantic-context contract vocabulary and its closed
# builders are expressible in pure Bend2 over the shared canonical encoder. One
# constructor stands for each classification, availability, query state, effect,
# subject kind, codec tool and refusal class; the refusal document carries a
# literal next-argv array; the codec success document names its tool, validated
# frame id, query and canonical request text; the raw-token domains decide U32,
# safe-integer and strict JSON-number tokens from their digits alone, before any
# numeric conversion; and effect admission answers the first required grant a
# request is missing.
# Serves: docs/bend2/semantic-context-spec.md, request/result/ref contracts.
# Fixture: bend2/src/context/contracts.bend with contracts.expected.txt.
import Base
import ../json/canonical.bend as J

# ---------------------------------------------------------------------------
# String helpers. One match per definition; field access goes through a helper
# because a nested match may only take a field the enclosing pattern bound.

def ch(+code: U32) -> Char:
  Char.from_u32(code)

def cp(+c: Char) -> U32:
  Char.to_u32(c)

def one(+c: Char) -> String:
  SCon{c, SNil{}}

def head_ch(s: String) -> Char:
  match s:
    case SNil{}: ch(0)
    case SCon{+head, +tail}: head

def tail_of(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: tail

def length_go(s: String, acc: U32) -> U32:
  match s:
    case SNil{}: acc
    case SCon{+head, +tail}: length_go(tail, U32.add(acc, 1))

def length(s: String) -> U32:
  length_go(s, 0)

# ---------------------------------------------------------------------------
# Vocabulary. Every member is one constructor, so a caller cannot spell a value
# outside the closed set and a name round-trips through its constructor.

type Classification is Data:
  ClObserved{}
  ClStaticPossible{}
  ClChecked{}
  ClDeclared{}

def classification_name(c: Classification) -> String:
  match c:
    case ClObserved{}: "observed"
    case ClStaticPossible{}: "static-possible"
    case ClChecked{}: "checked"
    case ClDeclared{}: "declared"

def classification_of(name: String) -> Maybe<&2, Classification>:
  match name:
    case "observed": Some{ClObserved{}}
    case "static-possible": Some{ClStaticPossible{}}
    case "checked": Some{ClChecked{}}
    case "declared": Some{ClDeclared{}}
    case other: None{}

type Availability is Data:
  AvAvailable{}
  AvUnavailable{}
  AvExcluded{}

def availability_name(a: Availability) -> String:
  match a:
    case AvAvailable{}: "available"
    case AvUnavailable{}: "unavailable"
    case AvExcluded{}: "excluded"

def availability_of(name: String) -> Maybe<&2, Availability>:
  match name:
    case "available": Some{AvAvailable{}}
    case "unavailable": Some{AvUnavailable{}}
    case "excluded": Some{AvExcluded{}}
    case other: None{}

type QueryState is Data:
  QsAccepted{}
  QsRunning{}
  QsComplete{}
  QsFailed{}
  QsInterrupted{}
  QsRefused{}

def query_state_name(s: QueryState) -> String:
  match s:
    case QsAccepted{}: "accepted"
    case QsRunning{}: "running"
    case QsComplete{}: "complete"
    case QsFailed{}: "failed"
    case QsInterrupted{}: "interrupted"
    case QsRefused{}: "refused"

def query_state_of(name: String) -> Maybe<&2, QueryState>:
  match name:
    case "accepted": Some{QsAccepted{}}
    case "running": Some{QsRunning{}}
    case "complete": Some{QsComplete{}}
    case "failed": Some{QsFailed{}}
    case "interrupted": Some{QsInterrupted{}}
    case "refused": Some{QsRefused{}}
    case other: None{}

type Effect is Data:
  EfExecuteTarget{}
  EfPlanTargetSql{}
  EfReplayMigrations{}
  EfEvaluateRuntime{}
  EfControlRuntime{}

def effect_name(e: Effect) -> String:
  match e:
    case EfExecuteTarget{}: "executeTarget"
    case EfPlanTargetSql{}: "planTargetSql"
    case EfReplayMigrations{}: "replayMigrations"
    case EfEvaluateRuntime{}: "evaluateRuntime"
    case EfControlRuntime{}: "controlRuntime"

def effect_of(name: String) -> Maybe<&2, Effect>:
  match name:
    case "executeTarget": Some{EfExecuteTarget{}}
    case "planTargetSql": Some{EfPlanTargetSql{}}
    case "replayMigrations": Some{EfReplayMigrations{}}
    case "evaluateRuntime": Some{EfEvaluateRuntime{}}
    case "controlRuntime": Some{EfControlRuntime{}}
    case other: None{}

type SubjectKind is Data:
  SkPosition{}
  SkSymbol{}
  SkDiagnostic{}
  SkEntity{}
  SkModel{}
  SkSchema{}
  SkSecurity{}
  SkMigration{}
  SkProgram{}
  SkDataset{}
  SkRuntime{}
  SkQueryControl{}
  SkRef{}

def subject_kind_name(k: SubjectKind) -> String:
  match k:
    case SkPosition{}: "position"
    case SkSymbol{}: "symbol"
    case SkDiagnostic{}: "diagnostic"
    case SkEntity{}: "entity"
    case SkModel{}: "model"
    case SkSchema{}: "schema"
    case SkSecurity{}: "security"
    case SkMigration{}: "migration"
    case SkProgram{}: "program"
    case SkDataset{}: "dataset"
    case SkRuntime{}: "runtime"
    case SkQueryControl{}: "query-control"
    case SkRef{}: "ref"

def subject_kind_of(name: String) -> Maybe<&2, SubjectKind>:
  match name:
    case "position": Some{SkPosition{}}
    case "symbol": Some{SkSymbol{}}
    case "diagnostic": Some{SkDiagnostic{}}
    case "entity": Some{SkEntity{}}
    case "model": Some{SkModel{}}
    case "schema": Some{SkSchema{}}
    case "security": Some{SkSecurity{}}
    case "migration": Some{SkMigration{}}
    case "program": Some{SkProgram{}}
    case "dataset": Some{SkDataset{}}
    case "runtime": Some{SkRuntime{}}
    case "query-control": Some{SkQueryControl{}}
    case "ref": Some{SkRef{}}
    case other: None{}

type CodecTool is Data:
  CtQuery{}
  CtEngines{}
  CtResult{}

def codec_tool_name(t: CodecTool) -> String:
  match t:
    case CtQuery{}: "context-query"
    case CtEngines{}: "context-engines"
    case CtResult{}: "context-result"

def codec_tool_of(name: String) -> Maybe<&2, CodecTool>:
  match name:
    case "context-query": Some{CtQuery{}}
    case "context-engines": Some{CtEngines{}}
    case "context-result": Some{CtResult{}}
    case other: None{}

# ---------------------------------------------------------------------------
# The ordinary command identity. It is selected from parsed trusted native argv, it has
# these four constructors and no others, and it renders exactly the four ordinary command
# names. The frame's public tool must match the selected command before any accepted
# decision or effect, so both query commands admit only the query frame tool. A refusal
# that happens before tool selection still names the argv-selected command, so no frame
# text and no arbitrary string ever becomes the command authority.

type CodecCommand is Data:
  CcQuery{}
  CcQueryFile{}
  CcResult{}
  CcEngines{}

def command_name(+c: CodecCommand) -> String:
  match c:
    case CcQuery{}: "context-query"
    case CcQueryFile{}: "context-query-file"
    case CcResult{}: "context-result"
    case CcEngines{}: "context-engines"

def command_of_name(+name: String) -> Maybe<&2, CodecCommand>:
  match name:
    case "context-query": Some{CcQuery{}}
    case "context-query-file": Some{CcQueryFile{}}
    case "context-result": Some{CcResult{}}
    case "context-engines": Some{CcEngines{}}
    case other: None{}

# The public frame tool the selected command admits, and the only one it admits.
def command_frame_name(+c: CodecCommand) -> String:
  match c:
    case CcQuery{}: "baton2_context_query"
    case CcQueryFile{}: "baton2_context_query"
    case CcResult{}: "baton2_context_result"
    case CcEngines{}: "baton2_context_engines"

def command_admits_frame_name(+c: CodecCommand, +name: String) -> Bool:
  String.eq(command_frame_name(c), name)

# The typed tool the selected command admits, for a decision that already carries its
# validated tool. This is the match an accepted decision is checked against, so the gate
# never reads unchecked frame text.
def command_tool(+c: CodecCommand) -> CodecTool:
  match c:
    case CcQuery{}: CtQuery{}
    case CcQueryFile{}: CtQuery{}
    case CcResult{}: CtResult{}
    case CcEngines{}: CtEngines{}

def tool_names_equal(+a: CodecTool, +b: CodecTool) -> Bool:
  String.eq(codec_tool_name(a), codec_tool_name(b))

def command_admits_tool(+c: CodecCommand, +t: CodecTool) -> Bool:
  tool_names_equal(command_tool(c), t)

law contracts_law_the_file_query_command_admits_the_query_tool:
  {command_admits_tool(CcQueryFile{}, CtQuery{}) == True{} : Bool}

def contracts_law_the_file_query_command_admits_the_query_tool():
  {==}

law contracts_law_the_engines_command_refuses_the_result_tool:
  {command_admits_tool(CcEngines{}, CtResult{}) == False{} : Bool}

def contracts_law_the_engines_command_refuses_the_result_tool():
  {==}

# One fixed condition for a frame whose public tool does not match the selected command.
# It echoes no input.
def command_mismatch_condition() -> String:
  "commandToolMismatch"

law contracts_law_the_command_names_are_the_four_ordinary_ones:
  {[command_name(CcQuery{}), command_name(CcQueryFile{}), command_name(CcResult{}), command_name(CcEngines{})] == ["context-query", "context-query-file", "context-result", "context-engines"] : List<String>}

def contracts_law_the_command_names_are_the_four_ordinary_ones():
  {==}

law contracts_law_argv_selects_the_query_command:
  {command_of_name("context-query") == Some{CcQuery{}} : Maybe<&2, CodecCommand>}

def contracts_law_argv_selects_the_query_command():
  {==}

law contracts_law_argv_refuses_an_unknown_command:
  {command_of_name("context-request-codec") == None{} : Maybe<&2, CodecCommand>}

def contracts_law_argv_refuses_an_unknown_command():
  {==}

law contracts_law_both_query_commands_admit_only_the_query_frame_tool:
  {[command_frame_name(CcQuery{}), command_frame_name(CcQueryFile{})] == ["baton2_context_query", "baton2_context_query"] : List<String>}

def contracts_law_both_query_commands_admit_only_the_query_frame_tool():
  {==}

law contracts_law_a_query_command_refuses_the_result_frame_tool:
  {command_admits_frame_name(CcQuery{}, "baton2_context_result") == False{} : Bool}

def contracts_law_a_query_command_refuses_the_result_frame_tool():
  {==}

law contracts_law_the_file_query_command_admits_the_query_frame_tool:
  {command_admits_frame_name(CcQueryFile{}, "baton2_context_query") == True{} : Bool}

def contracts_law_the_file_query_command_admits_the_query_frame_tool():
  {==}

law contracts_law_the_engines_command_admits_only_the_engines_frame_tool:
  {command_admits_frame_name(CcEngines{}, "baton2_context_engines") == True{} : Bool}

def contracts_law_the_engines_command_admits_only_the_engines_frame_tool():
  {==}

law contracts_law_the_mismatch_condition_is_fixed:
  {command_mismatch_condition() == "commandToolMismatch" : String}

def contracts_law_the_mismatch_condition_is_fixed():
  {==}

type RefusalClass is Data:
  RfValidation{}
  RfAdmissionRejected{}
  RfHostPreparation{}
  RfAdmissionUncertain{}

def refusal_class_name(c: RefusalClass) -> String:
  match c:
    case RfValidation{}: "validationRefusal"
    case RfAdmissionRejected{}: "admissionRejected"
    case RfHostPreparation{}: "hostPreparationFailed"
    case RfAdmissionUncertain{}: "admissionUncertain"

# ---------------------------------------------------------------------------
# The refusal and success documents. The refusal's next value is the literal
# navigation argv the caller runs next; the success document is the only thing
# the MCP bridge dispatches from.

type Next is Data:
  NextStop{}
  NextArg{head: String, tail: Next}

def next_json(n: Next) -> J.Json:
  match n:
    case NextStop{}: J.Jnil{}
    case NextArg{+head, +tail}: J.Jarr{J.Jstr{head}, next_json(tail)}

# `Jnil` is the terminator inside an array and emits nothing; an empty array as a
# complete value is `Jarr{Jnil{},Jnil{}}`, which emits `[]`. Returning `Jnil` for
# an empty argv would emit empty text where the refusal contract requires `[]`.
def next_value(n: Next) -> J.Json:
  match n:
    case NextStop{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case NextArg{+head, +tail}: J.Jarr{J.Jstr{head}, next_json(tail)}

def next_text(n: Next) -> String:
  J.json_text(next_value(n))

type Refusal is Data:
  Refuse{cls: RefusalClass, command: String, condition: J.Json, next: Next}

def refusal_json(r: Refusal) -> J.Json:
  match r:
    case Refuse{cls, command, condition, next}:
      J.Jobj{J.Jpair{"error", J.Jstr{refusal_class_name(cls)},
             J.Jpair{"command", J.Jstr{command},
             J.Jpair{"condition", condition,
             J.Jpair{"next", next_value(next), J.Jnil{}}}}}}

def refusal_text(r: Refusal) -> String:
  J.json_text(refusal_json(r))

def text_condition(text: String) -> J.Json:
  J.Jstr{text}

type OptText is Data:
  Absent{}
  Present{value: String}

def opt_text_text(o: OptText) -> String:
  match o:
    case Absent{}: "null"
    case Present{value}: J.json_text(J.Jstr{value})

# A validated frame id is either a string or the exact checked JSON number token.
# The two stay distinct: a numeric id is emitted from its own token, never quoted
# and never routed through Jint, whose U32 field cannot carry a signed or
# above-U32 safe integer. The document is assembled here rather than through a new
# Json constructor, so the shared canonical encoder and the request identity it
# produces stay untouched.
type FrameId is Data:
  IdText{value: String}
  IdNumber{token: String}

def frame_id_text(f: FrameId) -> String:
  match f:
    case IdText{value}: J.json_text(J.Jstr{value})
    case IdNumber{token}: token

# The signed-safe pieces come first because the frame-id profile below reads them.
def unsigned_rest(s: String) -> String:
  match s:
    case SNil{}: s
    case SCon{+head, +tail}: Bool.pick(String, U32.is_eq(cp(head), 45), tail, s)

def signed_safe_token_ok(+s: String) -> Bool:
  Bool.pick(Bool, String.is_empty(s), False{},
    Bool.pick(Bool, U32.is_eq(cp(head_ch(s)), 45), safe_integer_token_ok(unsigned_rest(s)), safe_integer_token_ok(s)))

def frame_id_ok(+f: FrameId) -> Bool:
  match f:
    case IdText{value}: True{}
    case IdNumber{token}: signed_safe_token_ok(token)

def codec_success_text(tool: CodecTool, ident: FrameId, query: OptText, request: OptText, scope: OptText) -> String:
  "{\"id\":" ++ frame_id_text(ident)
  ++ ",\"query\":" ++ opt_text_text(query)
  ++ ",\"requestCanonical\":" ++ opt_text_text(request)
  ++ ",\"scope\":" ++ opt_text_text(scope)
  ++ ",\"tool\":" ++ J.json_text(J.Jstr{codec_tool_name(tool)})
  ++ ",\"version\":1}"

# ---------------------------------------------------------------------------
# Effect admission. A request carries a set of granted effects; every operation
# has a fixed required subset, and a missing grant refuses before its effect.
# The set is carried by self-referential constructors because a Data field must
# be Data: an unrestricted `List` parameter would not be matchable here.

type Effects is Data:
  EpsNone{}
  EpsCons{head: Effect, tail: Effects}

def no_effects() -> Effects:
  EpsNone{}

def one_effect(e: Effect) -> Effects:
  EpsCons{e, EpsNone{}}

def two_effects(a: Effect, b: Effect) -> Effects:
  EpsCons{a, EpsCons{b, EpsNone{}}}

def effect_member(xs: Effects, +e: Effect) -> Bool:
  match xs:
    case EpsNone{}: False{}
    case EpsCons{+head, +tail}:
      Bool.pick(Bool, String.eq(effect_name(head), effect_name(e)), True{}, effect_member(tail, e))

# The union builder for required-effect sets. A caller composes the subset of
# every selected operation with it, so an override adds its effect without
# dropping another operation's requirement.
def cat_effects(xs: Effects, ys: Effects) -> Effects:
  match xs:
    case EpsNone{}: ys
    case EpsCons{+head, +tail}: EpsCons{head, cat_effects(tail, ys)}

def missing_grant(required: Effects, +grants: Effects) -> Maybe<&2, Effect>:
  match required:
    case EpsNone{}: None{}
    case EpsCons{+head, +tail}:
      Bool.pick(Maybe<&2, Effect>, effect_member(grants, head), missing_grant(tail, grants), Some{head})

# ---------------------------------------------------------------------------
# Raw-token domains. A token is decided from its own digits and length, before
# any conversion; nothing here reads a converted value.

def is_digit(+c: Char) -> Bool:
  Bool.pick(Bool, U32.is_lt(cp(c), 48), False{}, U32.is_lt(cp(c), 58))

def all_digits(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+head, +tail}: Bool.pick(Bool, is_digit(head), all_digits(tail), False{})

def is_zero(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+head, +tail}: Bool.pick(Bool, String.is_empty(tail), U32.is_eq(cp(head), 48), False{})

def digits_le(a: String, +b: String) -> Bool:
  match a:
    case SNil{}: True{}
    case SCon{+ha, +ta}:
      Bool.pick(Bool, U32.is_lt(cp(ha), cp(head_ch(b))), True{},
        Bool.pick(Bool, U32.is_lt(cp(head_ch(b)), cp(ha)), False{},
          digits_le(ta, tail_of(b))))

# An unsigned decimal U32 token: at least one digit, no leading zero, at most ten
# digits, and a ten-digit token at most the upper-bound token.
def digits_bound_ok(+s: String) -> Bool:
  Bool.pick(Bool, U32.is_lt(10, length(s)), False{},
    Bool.pick(Bool, U32.is_lt(length(s), 10), True{}, digits_le(s, "4294967295")))

def digits_shape_ok(+s: String) -> Bool:
  Bool.pick(Bool, is_zero(s), True{},
    Bool.pick(Bool, U32.is_eq(cp(head_ch(s)), 48), False{}, digits_bound_ok(s)))

# An unsigned decimal U32 token. The empty input is refused explicitly: an empty
# token has no digits, and a length bound alone would admit it.
def u32_token_ok(+s: String) -> Bool:
  Bool.pick(Bool, String.is_empty(s), False{},
    Bool.pick(Bool, all_digits(s), digits_shape_ok(s), False{}))

# An unsigned decimal safe-integer token: the same shape through 2^53-1. This is
# the declaration-offset profile; it is not the frame-id profile.
def safe_bound_ok(+s: String) -> Bool:
  Bool.pick(Bool, U32.is_lt(16, length(s)), False{},
    Bool.pick(Bool, U32.is_lt(length(s), 16), True{}, digits_le(s, "9007199254740991")))

def safe_shape_ok(+s: String) -> Bool:
  Bool.pick(Bool, is_zero(s), True{},
    Bool.pick(Bool, U32.is_eq(cp(head_ch(s)), 48), False{}, safe_bound_ok(s)))

def safe_integer_token_ok(+s: String) -> Bool:
  Bool.pick(Bool, String.is_empty(s), False{},
    Bool.pick(Bool, all_digits(s), safe_shape_ok(s), False{}))

# A monotone lifetime counter token: unsigned decimal, "0" or [1-9][0-9]*, with no
# magnitude bound, admitted as exact text and never normalized. Malformed aliases
# (a sign, leading zero, fraction, exponent or whitespace) refuse.
def counter_token_ok(+s: String) -> Bool:
  Bool.pick(Bool, String.is_empty(s), False{},
    Bool.pick(Bool, all_digits(s),
      Bool.pick(Bool, is_zero(s), True{}, Bool.pick(Bool, U32.is_eq(cp(head_ch(s)), 48), False{}, True{})), False{}))

# The strict JSON number token grammar, without a magnitude limit and without a
# numeric conversion: an optional minus, an integer part with no leading zero, an
# optional fraction of at least one digit and an optional exponent of at least
# one digit with an optional sign. Raw NaN and Infinity are not this grammar.
type NumState is Data:
  NumStart{}
  NumMinus{}
  NumZero{}
  NumInt{}
  NumDot{}
  NumFrac{}
  NumExp{}
  NumExpSign{}
  NumExpDigit{}
  NumBad{}

def is_exp_mark(+c: Char) -> Bool:
  Bool.pick(Bool, U32.is_eq(cp(c), 101), True{}, U32.is_eq(cp(c), 69))

def is_exp_sign(+c: Char) -> Bool:
  Bool.pick(Bool, U32.is_eq(cp(c), 43), True{}, U32.is_eq(cp(c), 45))

def num_from_first_int(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumInt{}, NumBad{})

def num_from_start(+c: Char) -> NumState:
  Bool.pick(NumState, U32.is_eq(cp(c), 45), NumMinus{},
    Bool.pick(NumState, U32.is_eq(cp(c), 48), NumZero{}, num_from_first_int(c)))

def num_from_minus(+c: Char) -> NumState:
  Bool.pick(NumState, U32.is_eq(cp(c), 48), NumZero{}, num_from_first_int(c))

def num_from_zero(+c: Char) -> NumState:
  Bool.pick(NumState, U32.is_eq(cp(c), 46), NumDot{},
    Bool.pick(NumState, is_exp_mark(c), NumExp{}, NumBad{}))

def num_from_int(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumInt{},
    Bool.pick(NumState, U32.is_eq(cp(c), 46), NumDot{},
      Bool.pick(NumState, is_exp_mark(c), NumExp{}, NumBad{})))

def num_from_dot(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumFrac{}, NumBad{})

def num_from_frac(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumFrac{},
    Bool.pick(NumState, is_exp_mark(c), NumExp{}, NumBad{}))

def num_from_exp(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumExpDigit{},
    Bool.pick(NumState, is_exp_sign(c), NumExpSign{}, NumBad{}))

def num_from_expsign(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumExpDigit{}, NumBad{})

def num_from_expdigit(+c: Char) -> NumState:
  Bool.pick(NumState, is_digit(c), NumExpDigit{}, NumBad{})

def num_step(state: NumState, +c: Char) -> NumState:
  match state:
    case NumStart{}: num_from_start(c)
    case NumMinus{}: num_from_minus(c)
    case NumZero{}: num_from_zero(c)
    case NumInt{}: num_from_int(c)
    case NumDot{}: num_from_dot(c)
    case NumFrac{}: num_from_frac(c)
    case NumExp{}: num_from_exp(c)
    case NumExpSign{}: num_from_expsign(c)
    case NumExpDigit{}: num_from_expdigit(c)
    case NumBad{}: NumBad{}

def num_feed(s: String, state: NumState) -> NumState:
  match s:
    case SNil{}: state
    case SCon{+head, +tail}: num_feed(tail, num_step(state, head))

def num_accept(state: NumState) -> Bool:
  match state:
    case NumZero{}: True{}
    case NumInt{}: True{}
    case NumFrac{}: True{}
    case NumExpDigit{}: True{}
    case NumStart{}: False{}
    case NumMinus{}: False{}
    case NumDot{}: False{}
    case NumExp{}: False{}
    case NumExpSign{}: False{}
    case NumBad{}: False{}

def strict_number_token_ok(s: String) -> Bool:
  num_accept(num_feed(s, NumStart{}))

# A metadata progress token is a string or a strict JSON number token; null,
# booleans, arrays and objects are not progress tokens.
def progress_scalar_ok(kind: String, raw: String) -> Bool:
  match kind:
    case "text": True{}
    case "integer": strict_number_token_ok(raw)
    case "real": strict_number_token_ok(raw)
    case other: False{}

# ---------------------------------------------------------------------------
# The contract corpus. Each value is one row of the fixture this module prints.

def classification_samples() -> List<Classification>:
  [ClObserved{}, ClStaticPossible{}, ClChecked{}, ClDeclared{}]

def availability_samples() -> List<Availability>:
  [AvAvailable{}, AvUnavailable{}, AvExcluded{}]

def query_state_samples() -> List<QueryState>:
  [QsAccepted{}, QsRunning{}, QsComplete{}, QsFailed{}, QsInterrupted{}, QsRefused{}]

def effect_samples() -> List<Effect>:
  [EfExecuteTarget{}, EfPlanTargetSql{}, EfReplayMigrations{}, EfEvaluateRuntime{}, EfControlRuntime{}]

def subject_samples() -> List<SubjectKind>:
  [SkPosition{}, SkSymbol{}, SkDiagnostic{}, SkEntity{}, SkModel{}, SkSchema{}, SkSecurity{}, SkMigration{}, SkProgram{}, SkDataset{}, SkRuntime{}, SkQueryControl{}, SkRef{}]

def tool_samples() -> List<CodecTool>:
  [CtQuery{}, CtEngines{}, CtResult{}]

def refusal_class_samples() -> List<RefusalClass>:
  [RfValidation{}, RfAdmissionRejected{}, RfHostPreparation{}, RfAdmissionUncertain{}]

def bool_text(b: Bool) -> String:
  match b:
    case True{}: "true"
    case False{}: "false"

def token_verdict(+s: String) -> String:
  bool_text(u32_token_ok(s)) ++ "/" ++ bool_text(safe_integer_token_ok(s)) ++ "/" ++ bool_text(strict_number_token_ok(s))

def print_kinds(xs: List<SubjectKind>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(subject_kind_name(h))
        print_kinds(t)

def print_effects(xs: List<Effect>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(effect_name(h))
        print_effects(t)

def print_tools(xs: List<CodecTool>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(codec_tool_name(h))
        print_tools(t)

def print_classes(xs: List<RefusalClass>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(refusal_class_name(h))
        print_classes(t)

def print_classifications(xs: List<Classification>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(classification_name(h))
        print_classifications(t)

def print_availabilities(xs: List<Availability>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(availability_name(h))
        print_availabilities(t)

def print_states(xs: List<QueryState>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(query_state_name(h))
        print_states(t)

def print_tokens(xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(token_verdict(h))
        print_tokens(t)

def token_corpus() -> List<String>:
  ["0", "1", "4294967295", "4294967296", "9007199254740991", "9007199254740993",
   "-1", "0.5", "1e3", "1E3", "1e400", "1e+3", "-0.5", "01", "007", "+1", ".5",
   "1.", "1e", "1e+", "--1", "NaN", "Infinity", "42949672950", "90071992547409910"]

law contracts_law_empty_request_needs_no_grant:
  {missing_grant(no_effects(), no_effects()) == None{} : Maybe<&2, Effect>}

def contracts_law_empty_request_needs_no_grant():
  {==}

law contracts_law_cat_effects_keeps_both_sets:
  {missing_grant(cat_effects(one_effect(EfPlanTargetSql{}), one_effect(EfExecuteTarget{})), one_effect(EfPlanTargetSql{})) == Some{EfExecuteTarget{}} : Maybe<&2, Effect>}

def contracts_law_cat_effects_keeps_both_sets():
  {==}

law contracts_law_missing_grant_names_the_first_absent:
  {missing_grant(two_effects(EfControlRuntime{}, EfEvaluateRuntime{}), one_effect(EfEvaluateRuntime{})) == Some{EfControlRuntime{}} : Maybe<&2, Effect>}

def contracts_law_missing_grant_names_the_first_absent():
  {==}

law contracts_law_a_granted_set_leaves_nothing_missing:
  {missing_grant(two_effects(EfControlRuntime{}, EfEvaluateRuntime{}), two_effects(EfControlRuntime{}, EfEvaluateRuntime{})) == None{} : Maybe<&2, Effect>}

def contracts_law_a_granted_set_leaves_nothing_missing():
  {==}

law contracts_law_u32_token_accepts_the_upper_bound:
  {u32_token_ok("4294967295") == True{} : Bool}

def contracts_law_u32_token_accepts_the_upper_bound():
  {==}

law contracts_law_u32_token_refuses_the_next_number:
  {u32_token_ok("4294967296") == False{} : Bool}

def contracts_law_u32_token_refuses_the_next_number():
  {==}

law contracts_law_u32_token_refuses_a_leading_zero:
  {u32_token_ok("007") == False{} : Bool}

def contracts_law_u32_token_refuses_a_leading_zero():
  {==}

law contracts_law_u32_token_refuses_the_empty_token:
  {u32_token_ok("") == False{} : Bool}

def contracts_law_u32_token_refuses_the_empty_token():
  {==}

law contracts_law_u32_token_refuses_a_ten_digit_number_above_the_bound:
  {u32_token_ok("9999999999") == False{} : Bool}

def contracts_law_u32_token_refuses_a_ten_digit_number_above_the_bound():
  {==}

law contracts_law_safe_integer_token_accepts_the_bound:
  {safe_integer_token_ok("9007199254740991") == True{} : Bool}

def contracts_law_safe_integer_token_accepts_the_bound():
  {==}

law contracts_law_safe_integer_token_refuses_the_empty_token:
  {safe_integer_token_ok("") == False{} : Bool}

def contracts_law_safe_integer_token_refuses_the_empty_token():
  {==}

law contracts_law_signed_safe_token_accepts_a_negative_id:
  {signed_safe_token_ok("-9007199254740991") == True{} : Bool}

def contracts_law_signed_safe_token_accepts_a_negative_id():
  {==}

law contracts_law_signed_safe_token_refuses_above_the_bound:
  {signed_safe_token_ok("9007199254740992") == False{} : Bool}

def contracts_law_signed_safe_token_refuses_above_the_bound():
  {==}

law contracts_law_signed_safe_token_refuses_a_signed_leading_zero:
  {signed_safe_token_ok("-01") == False{} : Bool}

def contracts_law_signed_safe_token_refuses_a_signed_leading_zero():
  {==}

law contracts_law_counter_token_accepts_an_unbounded_value:
  {counter_token_ok("4294967296") == True{} : Bool}

def contracts_law_counter_token_accepts_an_unbounded_value():
  {==}

law contracts_law_counter_token_refuses_a_leading_zero:
  {counter_token_ok("01") == False{} : Bool}

def contracts_law_counter_token_refuses_a_leading_zero():
  {==}

law contracts_law_counter_token_refuses_the_empty_token:
  {counter_token_ok("") == False{} : Bool}

def contracts_law_counter_token_refuses_the_empty_token():
  {==}

law contracts_law_strict_number_accepts_a_fraction:
  {strict_number_token_ok("0.5") == True{} : Bool}

def contracts_law_strict_number_accepts_a_fraction():
  {==}

law contracts_law_strict_number_accepts_a_signed_exponent:
  {strict_number_token_ok("-1e+3") == True{} : Bool}

def contracts_law_strict_number_accepts_a_signed_exponent():
  {==}

law contracts_law_strict_number_accepts_an_overflowing_exponent:
  {strict_number_token_ok("1e400") == True{} : Bool}

def contracts_law_strict_number_accepts_an_overflowing_exponent():
  {==}

law contracts_law_strict_number_refuses_a_bare_exponent:
  {strict_number_token_ok("1e") == False{} : Bool}

def contracts_law_strict_number_refuses_a_bare_exponent():
  {==}

law contracts_law_empty_next_is_the_empty_array:
  {next_text(NextStop{}) == "[]" : String}

def contracts_law_empty_next_is_the_empty_array():
  {==}

law contracts_law_refusal_carries_its_literal_next_argv:
  {next_text(NextArg{"context-result", NextArg{"q7", NextStop{}}}) == "[\"context-result\",\"q7\"]" : String}

def contracts_law_refusal_carries_its_literal_next_argv():
  {==}

law contracts_law_frame_id_keeps_a_string_quoted:
  {frame_id_text(IdText{"7"}) == "\"7\"" : String}

def contracts_law_frame_id_keeps_a_string_quoted():
  {==}

law contracts_law_frame_id_keeps_a_number_unquoted:
  {frame_id_text(IdNumber{"7"}) == "7" : String}

def contracts_law_frame_id_keeps_a_number_unquoted():
  {==}

law contracts_law_frame_id_keeps_a_negative_safe_integer_unquoted:
  {frame_id_text(IdNumber{"-9007199254740991"}) == "-9007199254740991" : String}

def contracts_law_frame_id_keeps_a_negative_safe_integer_unquoted():
  {==}

law contracts_law_frame_id_validates_a_numeric_token:
  {frame_id_ok(IdNumber{"9007199254740991"}) == True{} : Bool}

def contracts_law_frame_id_validates_a_numeric_token():
  {==}

law contracts_law_frame_id_refuses_an_above_bound_numeric_token:
  {frame_id_ok(IdNumber{"9007199254740992"}) == False{} : Bool}

def contracts_law_frame_id_refuses_an_above_bound_numeric_token():
  {==}

law contracts_law_codec_success_names_the_query_tool:
  {codec_success_text(CtQuery{}, IdText{"7"}, Present{"q7"}, Present{"{\"version\":1}"}, Absent{}) == "{\"id\":\"7\",\"query\":\"q7\",\"requestCanonical\":\"{\\\"version\\\":1}\",\"scope\":null,\"tool\":\"context-query\",\"version\":1}" : String}

def contracts_law_codec_success_names_the_query_tool():
  {==}

law contracts_law_codec_success_emits_a_numeric_id_unquoted:
  {codec_success_text(CtEngines{}, IdNumber{"7"}, Absent{}, Absent{}, Absent{}) == "{\"id\":7,\"query\":null,\"requestCanonical\":null,\"scope\":null,\"tool\":\"context-engines\",\"version\":1}" : String}

def contracts_law_codec_success_emits_a_numeric_id_unquoted():
  {==}

law contracts_law_codec_success_emits_a_negative_numeric_id:
  {codec_success_text(CtResult{}, IdNumber{"-9007199254740991"}, Present{"q1"}, Absent{}, Absent{}) == "{\"id\":-9007199254740991,\"query\":\"q1\",\"requestCanonical\":null,\"scope\":null,\"tool\":\"context-result\",\"version\":1}" : String}

def contracts_law_codec_success_emits_a_negative_numeric_id():
  {==}

law contracts_law_a_validation_refusal_names_its_class:
  {refusal_text(Refuse{RfValidation{}, "context-query", text_condition("request is not an object"), NextArg{"context-result", NextStop{}}}) == "{\"command\":\"context-query\",\"condition\":\"request is not an object\",\"error\":\"validationRefusal\",\"next\":[\"context-result\"]}" : String}

def contracts_law_a_validation_refusal_names_its_class():
  {==}

def signed_verdict() -> String:
  bool_text(signed_safe_token_ok("-1")) ++ "," ++ bool_text(signed_safe_token_ok("9007199254740991")) ++ "," ++ bool_text(signed_safe_token_ok("-9007199254740991")) ++ "," ++ bool_text(signed_safe_token_ok("-0")) ++ "," ++ bool_text(signed_safe_token_ok("9007199254740992"))

def counter_verdict() -> String:
  bool_text(counter_token_ok("0")) ++ "," ++ bool_text(counter_token_ok("1")) ++ "," ++ bool_text(counter_token_ok("")) ++ "," ++ bool_text(counter_token_ok("01")) ++ "," ++ bool_text(counter_token_ok("4294967296"))

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("classes")
    b : Unit <- print_classes(refusal_class_samples())
    c : Unit <- IO.print("classification")
    d : Unit <- print_classifications(classification_samples())
    e : Unit <- IO.print("availability")
    f : Unit <- print_availabilities(availability_samples())
    g : Unit <- IO.print("state")
    h : Unit <- print_states(query_state_samples())
    i : Unit <- IO.print("effect")
    j : Unit <- print_effects(effect_samples())
    k : Unit <- IO.print("subject")
    l : Unit <- print_kinds(subject_samples())
    m : Unit <- IO.print("tool")
    n : Unit <- print_tools(tool_samples())
    o : Unit <- IO.print("tokens")
    p : Unit <- print_tokens(token_corpus())
    q : Unit <- IO.print(next_text(NextArg{"context-result", NextArg{"q7", NextStop{}}}))
    q2 : Unit <- IO.print("empty-next " ++ next_text(NextStop{}))
    r : Unit <- IO.print("id-number " ++ codec_success_text(CtEngines{}, IdNumber{"7"}, Absent{}, Absent{}, Absent{}))
    r2 : Unit <- IO.print("id-string " ++ codec_success_text(CtQuery{}, IdText{"7"}, Present{"q7"}, Present{"{\"version\":1}"}, Absent{}))
    r3 : Unit <- IO.print("id-negative " ++ codec_success_text(CtResult{}, IdNumber{"-9007199254740991"}, Present{"q1"}, Absent{}, Absent{}))
    s : Unit <- IO.print(refusal_text(Refuse{RfAdmissionRejected{}, "context-query", text_condition("admission rejected"), NextArg{"context-result", NextArg{"q7", NextStop{}}}}))
    t : Unit <- IO.print("signed " ++ signed_verdict())
    u : Unit <- IO.print("counter " ++ counter_verdict())
    IO.print("end")

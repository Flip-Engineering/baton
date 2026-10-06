# CLAIM: the common module transport envelope is one closed shape per direction, and
# this module renders it and reads it back.
#
# The reader requires the full member set of a direction and the kind of every member
# before it extracts anything, so a frame with only a version is not an invocation, a
# null is distinct from a missing member and from a member of the wrong kind, and an
# incomplete frame refuses instead of arriving with defaulted fields. The direction is
# reached from the member set and the member kinds together, so no partial frame is
# ambiguous.
#
# The sequence composes Core's own canonical unsigned decimal, so there is one policy for
# it and a leading zero refuses, and the sequence keeps its exact text with no upper
# bound.
#
# The composite members are canonical JSON values supplied by their owners, so the module
# binding, the plan, the input identities and a producer keep one source and this module
# does not spell them a second time. The scalar members are mapped here: the version is
# the number 2, and an empty query, owner, runtime, role or incarnation is null.
#
# Known limitation, reported rather than hidden: the canonical encoder has no numeric
# form wider than U32, so a payload supplied as a canonical JSON value cannot carry a
# number token such as 1e400 or a negative decimal. Such a value needs the lane's raw
# value encoder or Core ownership, and it is not silently narrowed or turned into text
# here.
#
# Every definition is declared before its use, and the small helper layer comes first.
#
# Ownership: the members belong to their producers; this module owns the envelope member
# set and order. The declaration and schema identity are package-supplied.
# Serves: docs/bend2/semantic-context-spec.md, the closed version-2 transport.
import Base
import ../json/canonical.bend as J
import ./codec.bend as Codec
import ./contracts.bend as Context
import ./request.bend as Req
# The sequence policy is Core's, so this import resolves when the codec and Core closure
# is merged; it is the one cross-worktree dependency of this module.
import ./snapshot-validate.bend as SV

# --- the closed shapes -----------------------------------------------------

type WireRead is Data:
  WrInvocation{version: String, query: Context.OptText, owner: Context.OptText, binding: Codec.RawValue, request: Codec.RawValue, inputs: Codec.RawValue, plan: Codec.RawValue, role: Context.OptText, incarnation: Context.OptText}
  WrEvent{version: String, query: Context.OptText, owner: Context.OptText, producer: Codec.RawValue, runtime: Context.OptText, role: Context.OptText, incarnation: Context.OptText, sequence: String, frame_type: String, payload: Codec.RawValue}
  WrRefused{condition: String}

# --- member helpers --------------------------------------------------------

def wire_nullable(+text: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(text), J.Jnull{}, J.Jstr{text})

def wire_value_or(found: Maybe<&2, Codec.RawValue>) -> Codec.RawValue:
  match found:
    case None{}: Codec.Rnil{}
    case Some{value}: value

def wire_value_member(+name: String, +members: Codec.RawValue) -> Codec.RawValue:
  wire_value_or(Codec.raw_member(name, members))

def wire_text_value(value: Codec.RawValue) -> Context.OptText:
  match value:
    case Codec.Rnull{}: Context.Absent{}
    case Codec.Rstr{+text}:
      Bool.pick(Context.OptText, String.is_empty(text), Context.Absent{}, Context.Present{text})
    case other: Context.Absent{}

def wire_text_of(found: Maybe<&2, Codec.RawValue>) -> Context.OptText:
  match found:
    case None{}: Context.Absent{}
    case Some{value}: wire_text_value(value)

def wire_text_member(+name: String, +members: Codec.RawValue) -> Context.OptText:
  wire_text_of(Codec.raw_member(name, members))

def wire_sequence_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: text
    case other: SNil{}

def wire_sequence_of(found: Maybe<&2, Codec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{value}: wire_sequence_value(value)

def wire_sequence_member(+members: Codec.RawValue) -> String:
  wire_sequence_of(Codec.raw_member("sequence", members))

def wire_type_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: text
    case other: SNil{}

# --- member kinds ----------------------------------------------------------

def wire_name_present(+name: String, +members: Codec.RawValue) -> Bool:
  Codec.raw_member_present(name, members)

def wire_text_or_null(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnull{}: True{}
    case Codec.Rstr{+text}: True{}
    case other: False{}

def wire_text_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rstr{+text}: True{}
    case other: False{}

def wire_any_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnil{}: False{}
    case Codec.Rpair{+key, +value, +rest}: False{}
    case other: True{}

def wire_version_is_two(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnum{+token}: String.eq(token, "2")
    case other: False{}

def wire_kind_of_value(+kind: String, value: Codec.RawValue) -> Bool:
  match kind:
    case "textOrNull": wire_text_or_null(value)
    case "text": wire_text_kind(value)
    case "any": wire_any_kind(value)
    case other: False{}

def wire_kind_is(+kind: String, +name: String, +members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_name_present(name, members), wire_kind_of_value(kind, wire_value_member(name, members)), False{})

def wire_sequence_ok(+text: String) -> Bool:
  SV.canonical_unsigned_decimal(text)

def wire_frame_type_ok(+members: Codec.RawValue) -> Bool:
  wire_kind_is("text", "type", members)

# --- member plans ----------------------------------------------------------

def wire_invocation_names() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "request", "inputIdentities", "operationPlan", "role", "incarnation"])

def wire_event_names() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "runtime", "role", "incarnation", "sequence", "type", "payload"])

def wire_all_present(words: Req.Words, members: Codec.RawValue) -> Bool:
  match words:
    case Req.Wnone{}: True{}
    case Req.Wcons{+head, +tail}: Bool.pick(Bool, wire_name_present(head, members), wire_all_present(tail, members), False{})

def wire_invocation_names_present(+members: Codec.RawValue) -> Bool:
  wire_all_present(wire_invocation_names(), members)

def wire_event_names_present(+members: Codec.RawValue) -> Bool:
  wire_all_present(wire_event_names(), members)

# Each direction requires its exact member set: the allowed-and-unique admission rejects
# an undeclared or repeated member, and the kind walk requires every declared member and
# the kind of each.
def wire_invocation_kinds_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wire_invocation_names(), members), wire_invocation_kinds_go(members), False{})

def wire_invocation_kinds_go(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_kind_is("textOrNull", "query", members),
    Bool.pick(Bool, wire_kind_is("textOrNull", "owner", members),
      Bool.pick(Bool, wire_kind_is("textOrNull", "role", members),
        Bool.pick(Bool, wire_kind_is("textOrNull", "incarnation", members),
          Bool.pick(Bool, wire_version_is_two(wire_value_member("version", members)),
            Bool.pick(Bool, wire_kind_is("any", "moduleBinding", members),
              Bool.pick(Bool, wire_kind_is("any", "request", members),
                Bool.pick(Bool, wire_kind_is("any", "inputIdentities", members),
                  wire_kind_is("any", "operationPlan", members), False{}), False{}), False{}), False{}), False{}), False{}), False{})

def wire_event_kinds_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wire_event_names(), members), wire_event_kinds_go(members), False{})

def wire_event_kinds_go(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_kind_is("textOrNull", "query", members),
    Bool.pick(Bool, wire_kind_is("textOrNull", "owner", members),
      Bool.pick(Bool, wire_kind_is("textOrNull", "runtime", members),
        Bool.pick(Bool, wire_kind_is("textOrNull", "role", members),
          Bool.pick(Bool, wire_kind_is("textOrNull", "incarnation", members),
            Bool.pick(Bool, wire_version_is_two(wire_value_member("version", members)),
              Bool.pick(Bool, wire_kind_is("any", "moduleBinding", members),
                Bool.pick(Bool, wire_sequence_ok(wire_sequence_member(members)),
                  Bool.pick(Bool, wire_frame_type_ok(members),
                    wire_kind_is("any", "payload", members), False{}), False{}), False{}), False{}), False{}), False{}), False{}))

# --- the reader ------------------------------------------------------------

def wire_read_invocation(+members: Codec.RawValue) -> WireRead:
  WrInvocation{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_value_member("request", members),
    wire_value_member("inputIdentities", members), wire_value_member("operationPlan", members),
    wire_text_member("role", members), wire_text_member("incarnation", members)}

def wire_read_event(+members: Codec.RawValue) -> WireRead:
  WrEvent{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_text_member("runtime", members),
    wire_text_member("role", members), wire_text_member("incarnation", members),
    wire_sequence_value(wire_value_member("sequence", members)), wire_type_value(wire_value_member("type", members)),
    wire_value_member("payload", members)}

# Neither direction admitted the frame: answer with the finer condition of the direction
# whose member names are all present, so a missing member and a member of the wrong kind
# stay distinct.
def wire_event_incomplete(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, wire_event_names_present(members), WrRefused{"invalidMember"}, WrRefused{"missingMember"})

def wire_incomplete(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, wire_invocation_names_present(members), WrRefused{"invalidMember"}, wire_event_incomplete(members))

def wire_event_direction(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, wire_event_kinds_ok(members), wire_read_event(members), wire_incomplete(members))

def wire_with_version(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, wire_invocation_kinds_ok(members), wire_read_invocation(members), wire_event_direction(members))

def wire_direction(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, wire_version_is_two(wire_value_member("version", members)), wire_with_version(members), WrRefused{"wrongVersion"})

def wire_of_root(+root: Codec.RawValue) -> WireRead:
  match root:
    case Codec.Robj{+members}: wire_direction(members)
    case other: WrRefused{"wrongKind"}

def wire_of_frame(+r: Codec.FrameRead) -> WireRead:
  match r:
    case Codec.FrValue{+value}: wire_of_root(value)
    case Codec.FrRefused{condition}: WrRefused{condition}

def wire_read(rows: Req.Rows) -> WireRead:
  wire_of_frame(Codec.frame_read(rows))

# --- the serializer --------------------------------------------------------

def wire_invocation_value(+query: String, +owner: String, +binding: J.Json, +request: J.Json, +inputs: J.Json, +plan: J.Json, +role: String, +incarnation: String) -> J.Json:
  J.Jobj{
    J.Jpair{"version", J.Jint{2},
      J.Jpair{"query", wire_nullable(query),
        J.Jpair{"owner", wire_nullable(owner),
          J.Jpair{"moduleBinding", binding,
            J.Jpair{"request", request,
              J.Jpair{"inputIdentities", inputs,
                J.Jpair{"operationPlan", plan,
                  J.Jpair{"role", wire_nullable(role),
                    J.Jpair{"incarnation", wire_nullable(incarnation), J.Jnil{}}}}}}}}}}}

def invocation_frame(+query: String, +owner: String, +binding: J.Json, +request: J.Json, +inputs: J.Json, +plan: J.Json, +role: String, +incarnation: String) -> String:
  J.json_text(wire_invocation_value(query, owner, binding, request, inputs, plan, role, incarnation))

def wire_event_value(+query: String, +owner: String, +producer: J.Json, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: J.Json) -> J.Json:
  J.Jobj{
    J.Jpair{"version", J.Jint{2},
      J.Jpair{"query", wire_nullable(query),
        J.Jpair{"owner", wire_nullable(owner),
          J.Jpair{"moduleBinding", producer,
            J.Jpair{"runtime", wire_nullable(runtime),
              J.Jpair{"role", wire_nullable(role),
                J.Jpair{"incarnation", wire_nullable(incarnation),
                  J.Jpair{"sequence", J.Jstr{sequence},
                    J.Jpair{"type", J.Jstr{frame_type},
                      J.Jpair{"payload", payload, J.Jnil{}}}}}}}}}}}}

def event_frame(+query: String, +owner: String, +producer: J.Json, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: J.Json) -> String:
  J.json_text(wire_event_value(query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload))

# --- rows for the laws -----------------------------------------------------

def wire_rows_full() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.text_row("2", "0", "query", "q1"),
    Codec.text_row("3", "0", "owner", "o1"),
    Codec.object_row("4", "0", "moduleBinding"),
    Codec.text_row("5", "4", "id", "m"),
    Codec.object_row("6", "0", "request"),
    Codec.object_row("7", "0", "inputIdentities"),
    Codec.object_row("8", "0", "operationPlan"),
    Codec.text_row("9", "0", "role", "r1"),
    Codec.text_row("10", "0", "incarnation", "i1")])

def wire_rows_version_only() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2")])

def wire_rows_undeclared() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.text_row("2", "0", "query", "q1"),
    Codec.text_row("3", "0", "owner", "o1"),
    Codec.object_row("4", "0", "moduleBinding"),
    Codec.object_row("5", "0", "request"),
    Codec.object_row("6", "0", "inputIdentities"),
    Codec.object_row("7", "0", "operationPlan"),
    Codec.text_row("8", "0", "role", "r1"),
    Codec.text_row("9", "0", "incarnation", "i1"),
    Codec.text_row("10", "0", "extra", "x")])

def wire_rows_null_scalar() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.null_row("2", "0", "query"),
    Codec.text_row("3", "0", "owner", "o1"),
    Codec.object_row("4", "0", "moduleBinding"),
    Codec.object_row("5", "0", "request"),
    Codec.object_row("6", "0", "inputIdentities"),
    Codec.object_row("7", "0", "operationPlan"),
    Codec.text_row("8", "0", "role", "r1"),
    Codec.text_row("9", "0", "incarnation", "i1")])

def wire_rows_event_leading_zero() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.text_row("2", "0", "query", "q1"),
    Codec.text_row("3", "0", "owner", "o1"),
    Codec.object_row("4", "0", "moduleBinding"),
    Codec.text_row("5", "0", "runtime", "managed"),
    Codec.text_row("6", "0", "role", "w"),
    Codec.text_row("7", "0", "incarnation", "i"),
    Codec.text_row("8", "0", "sequence", "07"),
    Codec.text_row("9", "0", "type", "event"),
    Codec.object_row("10", "0", "payload")])

def wire_rows_event_good() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.text_row("2", "0", "query", "q1"),
    Codec.text_row("3", "0", "owner", "o1"),
    Codec.object_row("4", "0", "moduleBinding"),
    Codec.text_row("5", "0", "runtime", "managed"),
    Codec.text_row("6", "0", "role", "w"),
    Codec.text_row("7", "0", "incarnation", "i"),
    Codec.text_row("8", "0", "sequence", "10"),
    Codec.text_row("9", "0", "type", "event"),
    Codec.object_row("10", "0", "payload")])

# --- laws ------------------------------------------------------------------

law wire_law_the_invocation_frame_has_the_closed_shape:
  {invocation_frame("q1", "o1", J.Jobj{J.Jpair{"id", J.Jstr{"m"}, J.Jnil{}}}, J.Jobj{J.Jnil{}}, J.Jarr{J.Jnil{}, J.Jnil{}}, J.Jarr{J.Jnil{}, J.Jnil{}}, "r1", "i1") == "{\"version\":2,\"query\":\"q1\",\"owner\":\"o1\",\"moduleBinding\":{\"id\":\"m\"},\"request\":{},\"inputIdentities\":[],\"operationPlan\":[],\"role\":\"r1\",\"incarnation\":\"i1\"}" : String}

def wire_law_the_invocation_frame_has_the_closed_shape():
  {==}

law wire_law_the_invocation_version_is_the_number_two:
  {invocation_frame("q", "", J.Jnull{}, J.Jnull{}, J.Jnull{}, J.Jnull{}, "", "") == "{\"version\":2,\"query\":\"q\",\"owner\":null,\"moduleBinding\":null,\"request\":null,\"inputIdentities\":null,\"operationPlan\":null,\"role\":null,\"incarnation\":null}" : String}

def wire_law_the_invocation_version_is_the_number_two():
  {==}

law wire_law_an_empty_role_and_incarnation_are_null:
  {wire_nullable("") == J.Jnull{} : J.Json}

def wire_law_an_empty_role_and_incarnation_are_null():
  {==}

law wire_law_a_present_role_is_a_string:
  {wire_nullable("r1") == J.Jstr{"r1"} : J.Json}

def wire_law_a_present_role_is_a_string():
  {==}

law wire_law_the_event_frame_has_the_closed_shape:
  {event_frame("q1", "o1", J.Jobj{J.Jpair{"id", J.Jstr{"m"}, J.Jnil{}}}, "", "", "", "7", "result", J.Jstr{"p"}) == "{\"version\":2,\"query\":\"q1\",\"owner\":\"o1\",\"moduleBinding\":{\"id\":\"m\"},\"runtime\":null,\"role\":null,\"incarnation\":null,\"sequence\":\"7\",\"type\":\"result\",\"payload\":\"p\"}" : String}

def wire_law_the_event_frame_has_the_closed_shape():
  {==}

law wire_law_a_sequence_longer_than_u32_keeps_its_exact_text:
  {event_frame("q", "o", J.Jnull{}, "", "", "", "12345678901234567890", "event", J.Jnull{}) == "{\"version\":2,\"query\":\"q\",\"owner\":\"o\",\"moduleBinding\":null,\"runtime\":null,\"role\":null,\"incarnation\":null,\"sequence\":\"12345678901234567890\",\"type\":\"event\",\"payload\":null}" : String}

def wire_law_a_sequence_longer_than_u32_keeps_its_exact_text():
  {==}

law wire_law_a_retained_role_and_incarnation_travel_as_strings:
  {event_frame("q", "o", J.Jnull{}, "managed", "worker", "inc7", "1", "event", J.Jnull{}) == "{\"version\":2,\"query\":\"q\",\"owner\":\"o\",\"moduleBinding\":null,\"runtime\":\"managed\",\"role\":\"worker\",\"incarnation\":\"inc7\",\"sequence\":\"1\",\"type\":\"event\",\"payload\":null}" : String}

def wire_law_a_retained_role_and_incarnation_travel_as_strings():
  {==}

law wire_law_a_transported_invocation_reads_its_members:
  {wire_read(wire_rows_full()) == WrInvocation{"2", Context.Present{"q1"}, Context.Present{"o1"}, Codec.Robj{Codec.Rpair{"id", Codec.Rstr{"m"}, Codec.Rnil{}}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Context.Present{"r1"}, Context.Present{"i1"}} : WireRead}

def wire_law_a_transported_invocation_reads_its_members():
  {==}

law wire_law_a_frame_with_only_a_version_is_not_an_invocation:
  {wire_read(wire_rows_version_only()) == WrRefused{"missingMember"} : WireRead}

def wire_law_a_frame_with_only_a_version_is_not_an_invocation():
  {==}

law wire_law_an_undeclared_member_refuses:
  {wire_read(wire_rows_undeclared()) == WrRefused{"invalidMember"} : WireRead}

def wire_law_an_undeclared_member_refuses():
  {==}

law wire_law_a_null_scalar_member_reads_as_absent:
  {wire_read(wire_rows_null_scalar()) == WrInvocation{"2", Context.Absent{}, Context.Present{"o1"}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Context.Present{"r1"}, Context.Present{"i1"}} : WireRead}

def wire_law_a_null_scalar_member_reads_as_absent():
  {==}

law wire_law_a_wrong_scalar_kind_refuses:
  {wire_kind_is("textOrNull", "query", Codec.Rpair{"query", Codec.Rtrue{}, Codec.Rnil{}}) == False{} : Bool}

def wire_law_a_wrong_scalar_kind_refuses():
  {==}

law wire_law_a_missing_member_is_not_present:
  {wire_name_present("query", Codec.Rpair{"owner", Codec.Rstr{"o"}, Codec.Rnil{}}) == False{} : Bool}

def wire_law_a_missing_member_is_not_present():
  {==}

law wire_law_an_event_sequence_with_a_leading_zero_refuses:
  {wire_read(wire_rows_event_leading_zero()) == WrRefused{"invalidMember"} : WireRead}

def wire_law_an_event_sequence_with_a_leading_zero_refuses():
  {==}

law wire_law_an_event_frame_with_a_canonical_sequence_reads:
  {wire_read(wire_rows_event_good()) == WrEvent{"2", Context.Present{"q1"}, Context.Present{"o1"}, Codec.Robj{Codec.Rnil{}}, Context.Present{"managed"}, Context.Present{"w"}, Context.Present{"i"}, "10", "event", Codec.Robj{Codec.Rnil{}}} : WireRead}

def wire_law_an_event_frame_with_a_canonical_sequence_reads():
  {==}

law wire_law_the_sequence_policy_is_canonical_unsigned_decimal:
  {wire_sequence_ok("10") == True{} : Bool}

def wire_law_the_sequence_policy_is_canonical_unsigned_decimal():
  {==}

law wire_law_a_leading_zero_is_not_a_canonical_sequence:
  {wire_sequence_ok("07") == False{} : Bool}

def wire_law_a_leading_zero_is_not_a_canonical_sequence():
  {==}

law wire_law_a_sequence_wider_than_u32_is_still_canonical:
  {wire_sequence_ok("4294967296") == True{} : Bool}

def wire_law_a_sequence_wider_than_u32_is_still_canonical():
  {==}

law wire_law_a_text_version_refuses:
  {wire_version_is_two(Codec.Rstr{"2"}) == False{} : Bool}

def wire_law_a_text_version_refuses():
  {==}

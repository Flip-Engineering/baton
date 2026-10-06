# CLAIM: the common module transport envelope is one closed shape per direction, and
# this module renders and reads it. The invocation carries version, query, owner, the
# module binding, the canonical request value, the admitted input identities, the
# granted operation plan, and the role and incarnation; the event and result carry
# version, query, owner, the binding, the runtime, role, incarnation, sequence, type and
# payload.
#
# The composite members are canonical JSON values supplied by their owners, so the
# module binding, the operation plan, the input identities and a payload keep one source
# each and this module does not spell them a second time. The scalar members are mapped
# here: the version is the number 2, an empty query, owner, runtime, role or incarnation
# is null, and the sequence keeps its exact decimal text as text, because the canonical
# encoder has no numeric form wider than U32 and the profile requires the exact text.
#
# The reader checks the member set of each direction through the same key admission the
# frame path uses, so a duplicate or unknown member refuses, and it requires the version
# to be the number two. A decoded composite member is carried as the raw value it
# decoded to.
#
# Ownership: the members belong to their producers; this module owns the envelope member
# set and order. The declaration and schema identity are package-supplied.
# Serves: docs/bend2/semantic-context-spec.md, the closed version-2 transport.
import Base
import ../json/canonical.bend as J
import ./codec.bend as Codec
import ./contracts.bend as Context
import ./request.bend as Req

# --- the closed shapes -----------------------------------------------------

type WireRead is Data:
  WrInvocation{version: String, query: Context.OptText, owner: Context.OptText, binding: Codec.RawValue, request: Codec.RawValue, inputs: Codec.RawValue, plan: Codec.RawValue, role: Context.OptText, incarnation: Context.OptText}
  WrEvent{version: String, query: Context.OptText, owner: Context.OptText, producer: Codec.RawValue, runtime: Context.OptText, role: Context.OptText, incarnation: Context.OptText, sequence: String, frame_type: String, payload: Codec.RawValue}
  WrRefused{condition: String}

# --- the serializer --------------------------------------------------------

# A member that is absent when its text is empty. A direct invocation carries no role
# and no incarnation, and an unsolicited query-null event carries no query.
def wire_nullable(+text: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(text), J.Jnull{}, J.Jstr{text})

def invocation_frame(+query: String, +owner: String, +binding: J.Json, +request: J.Json, +inputs: J.Json, +plan: J.Json, +role: String, +incarnation: String) -> String:
  J.json_text(wire_invocation_value(query, owner, binding, request, inputs, plan, role, incarnation))

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

def event_frame(+query: String, +owner: String, +producer: J.Json, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: J.Json) -> String:
  J.json_text(wire_event_value(query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload))

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

# --- the reader ------------------------------------------------------------

def wire_digits_ok(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+head, +tail}: wire_digits_rest(tail, wire_digit_ok(head))

def wire_digit_ok(c: Char) -> Bool:
  Bool.pick(Bool, U32.is_lt(Char.to_u32(c), 48), False{}, U32.is_lt(Char.to_u32(c), 58))

def wire_digits_rest(rest: String, so_far: Bool) -> Bool:
  Bool.pick(Bool, so_far, wire_digits_tail(rest), False{})

def wire_digits_tail(rest: String) -> Bool:
  match rest:
    case SNil{}: True{}
    case SCon{+head, +tail}: wire_digits_rest(tail, wire_digit_ok(head))

def wire_invocation_words() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "request", "inputIdentities", "operationPlan", "role", "incarnation"])

def wire_event_words() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "runtime", "role", "incarnation", "sequence", "type", "payload"])

def wire_read(rows: Req.Rows) -> WireRead:
  wire_of_frame(Codec.frame_read(rows))

def wire_of_frame(+r: Codec.FrameRead) -> WireRead:
  match r:
    case Codec.FrValue{+value}: wire_of_root(value)
    case Codec.FrRefused{condition}: WrRefused{condition}

def wire_of_root(+root: Codec.RawValue) -> WireRead:
  match root:
    case Codec.Robj{+members}: wire_version_step(members, Codec.raw_member("version", members))
    case other: WrRefused{"wrongKind"}

def wire_version_step(+members: Codec.RawValue, version: Maybe<&2, Codec.RawValue>) -> WireRead:
  match version:
    case None{}: WrRefused{"missingVersion"}
    case Some{value}: wire_version_ok_step(members, wire_version_is_two(value))

def wire_version_ok_step(+members: Codec.RawValue, ok: Bool) -> WireRead:
  Bool.pick(WireRead, ok, wire_direction(members), WrRefused{"wrongVersion"})

def wire_version_is_two(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnum{+token}: String.eq(token, "2")
    case other: False{}

def wire_direction(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, Codec.raw_keys_ok(wire_invocation_words(), members), wire_read_invocation(members), wire_event_direction(members))

def wire_event_direction(+members: Codec.RawValue) -> WireRead:
  Bool.pick(WireRead, Codec.raw_keys_ok(wire_event_words(), members), wire_read_event(members), WrRefused{"unknownMember"})

def wire_read_invocation(+members: Codec.RawValue) -> WireRead:
  WrInvocation{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_value_member("request", members),
    wire_value_member("inputIdentities", members), wire_value_member("operationPlan", members),
    wire_text_member("role", members), wire_text_member("incarnation", members)}

def wire_read_event(+members: Codec.RawValue) -> WireRead:
  WrEvent{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_text_member("runtime", members),
    wire_text_member("role", members), wire_text_member("incarnation", members),
    wire_sequence_member(members), wire_type_member(members), wire_value_member("payload", members)}

def wire_value_member(+name: String, +members: Codec.RawValue) -> Codec.RawValue:
  wire_value_or(Codec.raw_member(name, members))

def wire_value_or(found: Maybe<&2, Codec.RawValue>) -> Codec.RawValue:
  match found:
    case None{}: Codec.Rnil{}
    case Some{value}: value

def wire_text_member(+name: String, +members: Codec.RawValue) -> Context.OptText:
  wire_text_of(Codec.raw_member(name, members))

def wire_text_of(found: Maybe<&2, Codec.RawValue>) -> Context.OptText:
  match found:
    case None{}: Context.Absent{}
    case Some{value}: wire_text_value(value)

def wire_text_value(value: Codec.RawValue) -> Context.OptText:
  match value:
    case Codec.Rnull{}: Context.Absent{}
    case Codec.Rstr{+text}:
      Bool.pick(Context.OptText, String.is_empty(text), Context.Absent{}, Context.Present{text})
    case other: Context.Absent{}

def wire_sequence_member(+members: Codec.RawValue) -> String:
  wire_sequence_of(Codec.raw_member("sequence", members))

def wire_sequence_of(found: Maybe<&2, Codec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{value}: wire_sequence_value(value)

def wire_sequence_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: Bool.pick(String, wire_digits_ok(text), text, SNil{})
    case other: SNil{}

def wire_type_member(+members: Codec.RawValue) -> String:
  wire_type_of(Codec.raw_member("type", members))

def wire_type_of(found: Maybe<&2, Codec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{value}: wire_type_value(value)

def wire_type_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: text
    case other: SNil{}

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

def wire_invocation_rows() -> Req.Rows:
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

def wire_unknown_member_rows() -> Req.Rows:
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

def wire_duplicate_member_rows() -> Req.Rows:
  Codec.rows_of([
    Codec.object_row("0", SNil{}, SNil{}),
    Codec.number_row("1", "0", "version", "2"),
    Codec.text_row("2", "0", "query", "q1"),
    Codec.text_row("3", "0", "query", "q2"),
    Codec.text_row("4", "0", "owner", "o1"),
    Codec.object_row("5", "0", "moduleBinding"),
    Codec.object_row("6", "0", "request"),
    Codec.object_row("7", "0", "inputIdentities"),
    Codec.object_row("8", "0", "operationPlan"),
    Codec.text_row("9", "0", "role", "r1"),
    Codec.text_row("10", "0", "incarnation", "i1")])

law wire_law_a_transported_invocation_reads_its_members:
  {wire_read(wire_invocation_rows()) == WrInvocation{"2", Context.Present{"q1"}, Context.Present{"o1"}, Codec.Robj{Codec.Rpair{"id", Codec.Rstr{"m"}, Codec.Rnil{}}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Codec.Robj{Codec.Rnil{}}, Context.Present{"r1"}, Context.Present{"i1"}} : WireRead}

def wire_law_a_transported_invocation_reads_its_members():
  {==}

law wire_law_an_unknown_member_refuses:
  {wire_read(wire_unknown_member_rows()) == WrRefused{"unknownMember"} : WireRead}

def wire_law_an_unknown_member_refuses():
  {==}

law wire_law_a_duplicate_member_refuses:
  {wire_read(wire_duplicate_member_rows()) == WrRefused{"unknownMember"} : WireRead}

def wire_law_a_duplicate_member_refuses():
  {==}

law wire_law_a_text_version_refuses:
  {wire_version_is_two(Codec.Rstr{"2"}) == False{} : Bool}

def wire_law_a_text_version_refuses():
  {==}

law wire_law_a_sequence_of_digits_is_a_sequence:
  {wire_sequence_value(Codec.Rstr{"12345678901234567890"}) == "12345678901234567890" : String}

def wire_law_a_sequence_of_digits_is_a_sequence():
  {==}

law wire_law_a_sequence_that_is_not_digits_is_not_a_sequence:
  {wire_sequence_value(Codec.Rstr{"1x"}) == SNil{} : String}

def wire_law_a_sequence_that_is_not_digits_is_not_a_sequence():
  {==}

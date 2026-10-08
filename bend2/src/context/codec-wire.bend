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

# --- the closed shapes -----------------------------------------------------

type WireRead is Data:
  WrInvocation{version: String, query: Context.OptText, owner: Context.OptText, binding: Codec.RawValue, request: Codec.RawValue, inputs: Codec.RawValue, plan: Codec.RawValue, role: Context.OptText, incarnation: Context.OptText}
  WrEvent{version: String, query: Context.OptText, owner: Context.OptText, producer: Codec.RawValue, runtime: Context.OptText, role: Context.OptText, incarnation: Context.OptText, sequence: String, frame_type: String, payload: Codec.RawValue}
  WrRefused{condition: String}

# --- the owned value encoder ----------------------------------------------
# One self-recursive walk with a mode, so it needs no forward reference, and it keeps an
# exact number token verbatim: 1e400 and a negative decimal stay numbers, and text stays
# text. The mode names whether the value opens a container or continues one. The value is
# the first parameter and the mode follows it, because the walk matches the value first
# and its recursive calls hand back a part of it.

# The closing text of the two continuation modes. A value mode closes nothing.
def wire_mode_close(+mode: String) -> String:
  match mode:
    case "items": "]"
    case "members": "}"
    case other: ""

# An atom renders as itself in value mode and as the container close in the
# continuation modes.
def wire_atom_text(+mode: String, +atom: String) -> String:
  match mode:
    case "value": atom
    case other: wire_mode_close(mode)

# The empty-list sentinel is a value in value mode: the null it encodes.
def wire_nil_text(+mode: String) -> String:
  match mode:
    case "value": "null"
    case "items": "]"
    case "members": "}"
    case other: ""

# The empty array renders as its own pair of brackets in value mode; as a continued
# item it is read as the null sentinel plus the closing bracket.
def wire_empty_arr_text(+mode: String) -> String:
  match mode:
    case "value": "[]"
    case "items": "," ++ wire_nil_text("value") ++ wire_nil_text("items")
    case other: wire_mode_close(mode)

def wire_value_text(+v: Codec.RawValue, +mode: String) -> String:
  match v:
    case Codec.Rnull{}: wire_atom_text(mode, "null")
    case Codec.Rtrue{}: wire_atom_text(mode, "true")
    case Codec.Rfalse{}: wire_atom_text(mode, "false")
    case Codec.Rstr{+text}:
      match mode:
        case "value": J.json_text(J.Jstr{text})
        case other: wire_mode_close(mode)
    case Codec.Rnum{+token}:
      match mode:
        case "value": token
        case other: wire_mode_close(mode)
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: wire_empty_arr_text(mode)
    case Codec.Rarr{+head, +tail}:
      match mode:
        case "value": "[" ++ wire_value_text(head, "value") ++ wire_value_text(tail, "items")
        case "items": "," ++ wire_value_text(head, "value") ++ wire_value_text(tail, "items")
        case other: wire_mode_close(mode)
    case Codec.Robj{Codec.Rnil{}}: wire_atom_text(mode, "{}")
    case Codec.Robj{Codec.Rpair{+key, +value, +rest}}:
      match mode:
        case "value": "{" ++ J.json_text(J.Jstr{key}) ++ ":" ++ wire_value_text(value, "value") ++ wire_value_text(rest, "members")
        case other: wire_mode_close(mode)
    case Codec.Robj{+members}: wire_atom_text(mode, "{}")
    case Codec.Rnil{}: wire_nil_text(mode)
    case Codec.Rpair{+key, +value, +rest}:
      match mode:
        case "value": "null"
        case "members": "," ++ J.json_text(J.Jstr{key}) ++ ":" ++ wire_value_text(value, "value") ++ wire_value_text(rest, "members")
        case other: wire_mode_close(mode)
    case other: wire_atom_text(mode, "null")

def wire_value(+v: Codec.RawValue) -> String:
  wire_value_text(v, "value")

# A scalar member: null when it is absent, otherwise the canonical text of the string.
def wire_scalar_text(+text: String) -> String:
  Bool.pick(String, String.is_empty(text), "null", J.json_text(J.Jstr{text}))

# --- member helpers --------------------------------------------------------
def wire_value_or(found: Maybe<&2, Codec.RawValue>) -> Codec.RawValue:
  match found:
    case None{}: Codec.Rnil{}
    case Some{value}: value

def wire_value_member(+name: String, +members: Codec.RawValue) -> Codec.RawValue:
  wire_value_or(Codec.raw_member(name, members))

# A present null is absent, and a present empty text is a present empty text: an empty
# role cannot normalize into the null of a direct invocation. A value of another kind is
# unreachable here because the kind walk refused it first.
def wire_text_value(value: Codec.RawValue) -> Context.OptText:
  match value:
    case Codec.Rnull{}: Context.Absent{}
    case Codec.Rstr{+text}: Context.Present{text}
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

def wire_any_kind(+value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnil{}: False{}
    case Codec.Rpair{+key, +value, +rest}: False{}
    case other: True{}

def wire_object_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Robj{+members}: True{}
    case other: False{}

def wire_array_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rarr{+head, +tail}: True{}
    case other: False{}

def wire_version_is_two(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnum{+token}: String.eq(token, "2")
    case other: False{}

def wire_kind_of_value(+kind: String, +value: Codec.RawValue) -> Bool:
  match kind:
    case "textOrNull": wire_text_or_null(value)
    case "text": wire_text_kind(value)
    case "any": wire_any_kind(value)
    case "object": wire_object_kind(value)
    case "array": wire_array_kind(value)
    case other: False{}

def wire_kind_is(+kind: String, +name: String, +members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_name_present(name, members), wire_kind_of_value(kind, wire_value_member(name, members)), False{})

def wire_sequence_digits(+digits: List<&2, Char>) -> Bool:
  match digits:
    case Nil{}: True{}
    case head <> tail: Bool.and(Char.is_digit(head), wire_sequence_digits(tail))

def wire_sequence_ok(+text: String) -> Bool:
  Bool.and(Bool.not(String.is_empty(text)),
    Bool.and(wire_sequence_digits(String.to_list(text)),
      Bool.not(Bool.and(String.starts_with(text, "0"),
        Bool.not(String.eq(text, "0"))))))

def wire_frame_type_ok(+members: Codec.RawValue) -> Bool:
  wire_kind_is("text", "type", members)

# --- member plans ----------------------------------------------------------

def wire_invocation_names() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "request", "inputIdentities", "operationPlan", "role", "incarnation"])

def wire_event_names() -> Req.Words:
  Req.words_from(["version", "query", "owner", "moduleBinding", "runtime", "role", "incarnation", "sequence", "type", "payload"])

def wire_all_present(words: Req.Words, +members: Codec.RawValue) -> Bool:
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
def wire_invocation_kinds_go(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_kind_is("textOrNull", "query", members),
    Bool.pick(Bool, wire_kind_is("textOrNull", "owner", members),
      Bool.pick(Bool, wire_kind_is("textOrNull", "role", members),
        Bool.pick(Bool, wire_kind_is("textOrNull", "incarnation", members),
          Bool.pick(Bool, wire_version_is_two(wire_value_member("version", members)),
            Bool.pick(Bool, wire_kind_is("object", "moduleBinding", members),
              Bool.pick(Bool, wire_kind_is("object", "request", members),
                Bool.pick(Bool, wire_kind_is("array", "inputIdentities", members),
                  wire_kind_is("array", "operationPlan", members),
                  False{}),
                False{}),
              False{}),
            False{}),
          False{}),
        False{}),
      False{}),
    False{})

def wire_invocation_kinds_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wire_invocation_names(), members), wire_invocation_kinds_go(members), False{})

def wire_event_kinds_go(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wire_kind_is("textOrNull", "query", members),
    Bool.pick(Bool, wire_kind_is("textOrNull", "owner", members),
      Bool.pick(Bool, wire_kind_is("textOrNull", "runtime", members),
        Bool.pick(Bool, wire_kind_is("textOrNull", "role", members),
          Bool.pick(Bool, wire_kind_is("textOrNull", "incarnation", members),
            Bool.pick(Bool, wire_version_is_two(wire_value_member("version", members)),
              Bool.pick(Bool, wire_kind_is("object", "moduleBinding", members),
                Bool.pick(Bool, wire_sequence_ok(wire_sequence_member(members)),
                  Bool.pick(Bool, wire_frame_type_ok(members),
                    wire_kind_is("any", "payload", members),
                    False{}),
                  False{}),
                False{}),
              False{}),
            False{}),
          False{}),
        False{}),
      False{}),
    False{})

def wire_event_kinds_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wire_event_names(), members), wire_event_kinds_go(members), False{})

# --- the reader ------------------------------------------------------------

# The checked value rule. One self-recursive structural walk with a mode, so it needs no
# forward reference. A number token must be a valid token, so a constructed one refuses;
# a decoded key that appears twice in one object refuses at every depth; and the empty
# array sentinel is a value rather than a missing element. Number tokens stay numbers:
# the rule admits -0.25, 0.5 and 1e400 exactly as written. The value is the first
# parameter and the mode follows it, because the walk matches the value first and its
# recursive calls hand back a part of it.

# An atom is checked only where it stands as a value.
def wire_atom_ok(+mode: String, +ok: Bool) -> Bool:
  match mode:
    case "value": ok
    case other: False{}

# The empty-list sentinel terminates the two continuation modes and is no value.
def wire_ok_nil(+mode: String) -> Bool:
  match mode:
    case "items": True{}
    case "members": True{}
    case other: False{}

def wire_value_ok(+v: Codec.RawValue, +mode: String) -> Bool:
  match v:
    case Codec.Rnull{}: wire_atom_ok(mode, True{})
    case Codec.Rtrue{}: wire_atom_ok(mode, True{})
    case Codec.Rfalse{}: wire_atom_ok(mode, True{})
    case Codec.Rstr{+text}: wire_atom_ok(mode, True{})
    case Codec.Rnum{+token}:
      match mode:
        case "value": Context.strict_number_token_ok(token)
        case other: False{}
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}:
      match mode:
        case "value": True{}
        case "items": Bool.pick(Bool, wire_ok_nil("value"), wire_ok_nil("items"), False{})
        case other: False{}
    case Codec.Rarr{+head, +tail}:
      match mode:
        case "value": Bool.pick(Bool, wire_value_ok(head, "value"), wire_value_ok(tail, "items"), False{})
        case "items": Bool.pick(Bool, wire_value_ok(head, "value"), wire_value_ok(tail, "items"), False{})
        case other: False{}
    case Codec.Robj{Codec.Rnil{}}: wire_atom_ok(mode, True{})
    case Codec.Robj{Codec.Rpair{+key, +value, +rest}}:
      match mode:
        case "value": Bool.pick(Bool, Codec.raw_member_present(key, rest), False{}, Bool.pick(Bool, wire_value_ok(value, "value"), wire_value_ok(rest, "members"), False{}))
        case other: False{}
    case Codec.Robj{+members}: False{}
    case Codec.Rnil{}: wire_ok_nil(mode)
    case Codec.Rpair{+key, +value, +rest}:
      match mode:
        case "members": Bool.pick(Bool, Codec.raw_member_present(key, rest), False{}, Bool.pick(Bool, wire_value_ok(value, "value"), wire_value_ok(rest, "members"), False{}))
        case other: False{}
    case other: False{}

def wire_payload_ok(+v: Codec.RawValue) -> Bool:
  wire_value_ok(v, "value")

def wire_read_invocation(+members: Codec.RawValue) -> WireRead:
  WrInvocation{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_value_member("request", members),
    wire_value_member("inputIdentities", members), wire_value_member("operationPlan", members),
    wire_text_member("role", members), wire_text_member("incarnation", members)}

def wire_read_event_ok(+members: Codec.RawValue) -> WireRead:
  WrEvent{"2", wire_text_member("query", members), wire_text_member("owner", members),
    wire_value_member("moduleBinding", members), wire_text_member("runtime", members),
    wire_text_member("role", members), wire_text_member("incarnation", members),
    wire_sequence_value(wire_value_member("sequence", members)), wire_type_value(wire_value_member("type", members)),
    wire_value_member("payload", members)}

# The payload is the admitted json-value profile, so it is checked here: a constructed
# number token that is not a valid number and a decoded key that appears twice in one
# object both refuse before the frame is answered.
def wire_read_event_payload(+members: Codec.RawValue, payload_ok: Bool) -> WireRead:
  Bool.pick(WireRead, payload_ok, wire_read_event_ok(members), WrRefused{"invalidPayload"})

def wire_read_event(+members: Codec.RawValue) -> WireRead:
  wire_read_event_payload(members, wire_payload_ok(wire_value_member("payload", members)))

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
# The composite members arrive as the canonical text their owners rendered, so this
# module splices them verbatim and does not re-spell them. The scalars are rendered here
# and the payload is rendered by the owned value encoder, so an exact number token in an
# admitted json-value survives.

def invocation_frame(+query: String, +owner: String, +binding_text: String, +request_value_text: String, +inputs_text: String, +plan_text: String, +role: String, +incarnation: String) -> String:
  "{\"version\":2,\"query\":" ++ wire_scalar_text(query)
  ++ ",\"owner\":" ++ wire_scalar_text(owner)
  ++ ",\"moduleBinding\":" ++ binding_text
  ++ ",\"request\":" ++ request_value_text
  ++ ",\"inputIdentities\":" ++ inputs_text
  ++ ",\"operationPlan\":" ++ plan_text
  ++ ",\"role\":" ++ wire_scalar_text(role)
  ++ ",\"incarnation\":" ++ wire_scalar_text(incarnation) ++ "}"

def event_frame(+query: String, +owner: String, +producer_text: String, +runtime: String, +role: String, +incarnation: String, +sequence: String, +frame_type: String, +payload: Codec.RawValue) -> String:
  "{\"version\":2,\"query\":" ++ wire_scalar_text(query)
  ++ ",\"owner\":" ++ wire_scalar_text(owner)
  ++ ",\"moduleBinding\":" ++ producer_text
  ++ ",\"runtime\":" ++ wire_scalar_text(runtime)
  ++ ",\"role\":" ++ wire_scalar_text(role)
  ++ ",\"incarnation\":" ++ wire_scalar_text(incarnation)
  ++ ",\"sequence\":" ++ J.json_text(J.Jstr{sequence})
  ++ ",\"type\":" ++ J.json_text(J.Jstr{frame_type})
  ++ ",\"payload\":" ++ wire_value(payload) ++ "}"

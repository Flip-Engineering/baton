# CLAIM: the typed conversions between the closed transport envelope and the values Core
# compares. A decoded binding becomes `Sel.MBind`, and a decoded event becomes
# `SV.Frame`; the binding belongs to `Sel`, not to `SV`, and Core compares the typed
# binding rather than a spelling of it.
#
# Each conversion checks the member set of the structure it reads, the kind of every
# member, and the shape of the nested artifact and schema identities before it builds
# anything, so a wrong kind or a missing member refuses with its own condition and no
# defaulted value reaches Core. The payload crosses as its canonical text from the wire
# value encoder, so an exact number token survives the crossing.
#
# Ownership: Core owns `MBind`, `Arts`, `SS` and `Frame`; this module only reads the wire
# spelling into them and invents no second carrier.
# Serves: docs/bend2/semantic-context-spec.md, the closed version-2 transport.
import Base
import ./codec.bend as Codec
import ./codec-wire.bend as Wire
import ./contracts.bend as Context
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel
import ./request.bend as Req
import ./snapshot-validate.bend as SV

type WireBinding is Data:
  WbOk{binding: Sel.MBind}
  WbRefused{condition: String}

type WireFrame is Data:
  WfOk{frame: SV.Frame}
  WfRefused{condition: String}

# --- member helpers --------------------------------------------------------

def wc_name_present(+name: String, +members: Codec.RawValue) -> Bool:
  Codec.raw_member_present(name, members)

def wc_value_or(found: Maybe<&2, Codec.RawValue>) -> Codec.RawValue:
  match found:
    case None{}: Codec.Rnil{}
    case Some{value}: value

def wc_value_member(+name: String, +members: Codec.RawValue) -> Codec.RawValue:
  wc_value_or(Codec.raw_member(name, members))

def wc_text_of_value(value: Codec.RawValue) -> String:
  match value:
    case Codec.Rstr{+text}: text
    case other: SNil{}

def wc_text_or_empty(found: Maybe<&2, Codec.RawValue>) -> String:
  match found:
    case None{}: SNil{}
    case Some{value}: wc_text_of_value(value)

def wc_text_member(+name: String, +members: Codec.RawValue) -> String:
  wc_text_or_empty(Codec.raw_member(name, members))

def wc_text_kind(value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rstr{+text}: True{}
    case other: False{}

def wc_text_member_ok(+name: String, +members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, wc_name_present(name, members), wc_text_kind(wc_value_member(name, members)), False{})

def wc_object_members(value: Codec.RawValue) -> Codec.RawValue:
  match value:
    case Codec.Robj{+members}: members
    case other: Codec.Rnil{}

def wc_present_text(+found: Maybe<&2, Codec.RawValue>) -> Bool:
  match found:
    case None{}: False{}
    case Some{value}: wc_text_kind(value)

def wc_value_member_for(+elem: Codec.RawValue, +name: String) -> Maybe<&2, Codec.RawValue>:
  Codec.raw_member(name, wc_object_members(elem))

def wc_text_member_for(+elem: Codec.RawValue, +name: String) -> String:
  wc_text_or_empty(Codec.raw_member(name, wc_object_members(elem)))

# --- the binding -----------------------------------------------------------

def wc_binding_names() -> Req.Words:
  Req.words_from(["id", "revision", "declarationDigest", "protocolVersion", "operation", "artifactIdentities", "schemaIdentities"])

def wc_artifact_names() -> Req.Words:
  Req.words_from(["packagePath", "sha256", "role"])

def wc_artifact_body(+elem: Codec.RawValue, +path: Maybe<&2, Codec.RawValue>, +sha: Maybe<&2, Codec.RawValue>, +role: Maybe<&2, Codec.RawValue>) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wc_artifact_names(), wc_object_members(elem)),
    Bool.pick(Bool, wc_present_text(path), Bool.pick(Bool, wc_present_text(sha), wc_present_text(role), False{}), False{}), False{})

def wc_artifact_ok(+elem: Codec.RawValue) -> Bool:
  wc_artifact_body(elem, wc_value_member_for(elem, "packagePath"), wc_value_member_for(elem, "sha256"), wc_value_member_for(elem, "role"))

def wc_artifacts_ok(+value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnil{}: True{}
    case Codec.Rarr{+head, +tail}: Bool.pick(Bool, wc_artifact_ok(head), wc_artifacts_ok(tail), False{})
    case other: False{}

def wc_art_build(+elem: Codec.RawValue) -> Decl.Art:
  Decl.Art{wc_text_member_for(elem, "packagePath"), wc_text_member_for(elem, "sha256"), wc_text_member_for(elem, "role")}

def wc_artifacts_build(+value: Codec.RawValue) -> Decl.Arts:
  match value:
    case Codec.Rnil{}: Decl.ArtsNil{}
    case Codec.Rarr{+head, +tail}: Decl.ArtsCons{wc_art_build(head), wc_artifacts_build(tail)}
    case other: Decl.ArtsNil{}

def wc_schemas_ok(+value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rnil{}: True{}
    case Codec.Rarr{+head, +tail}: Bool.pick(Bool, wc_text_kind(head), wc_schemas_ok(tail), False{})
    case other: False{}

def wc_schemas_build(+value: Codec.RawValue) -> Eng.SS:
  match value:
    case Codec.Rnil{}: Eng.SSNil{}
    case Codec.Rarr{+head, +tail}: Eng.SSCons{wc_text_of_value(head), wc_schemas_build(tail)}
    case other: Eng.SSNil{}

def wc_binding_body_ok(+members: Codec.RawValue) -> Bool:
  Bool.pick(Bool, Codec.raw_keys_ok(wc_binding_names(), members),
    Bool.pick(Bool, wc_text_member_ok("id", members),
      Bool.pick(Bool, wc_text_member_ok("revision", members),
        Bool.pick(Bool, wc_text_member_ok("declarationDigest", members),
          Bool.pick(Bool, wc_text_member_ok("protocolVersion", members),
            Bool.pick(Bool, wc_text_member_ok("operation", members),
              Bool.pick(Bool, wc_artifacts_ok(wc_value_member("artifactIdentities", members)),
                wc_schemas_ok(wc_value_member("schemaIdentities", members)), False{}), False{}), False{}), False{}), False{}), False{})

def wc_binding_build(+members: Codec.RawValue) -> Sel.MBind:
  Sel.MBind{wc_text_member("id", members), wc_text_member("revision", members),
    wc_text_member("declarationDigest", members), wc_text_member("protocolVersion", members),
    wc_text_member("operation", members), wc_artifacts_build(wc_value_member("artifactIdentities", members)),
    wc_schemas_build(wc_value_member("schemaIdentities", members))}

def wc_binding_step(+members: Codec.RawValue, ok: Bool) -> WireBinding:
  Bool.pick(WireBinding, ok, WbOk{wc_binding_build(members)}, WbRefused{"invalidBinding"})

def wire_binding_read(+value: Codec.RawValue) -> WireBinding:
  match value:
    case Codec.Robj{+members}: wc_binding_step(members, wc_binding_body_ok(members))
    case other: WbRefused{"invalidBinding"}

# --- the event frame -------------------------------------------------------

def wc_scalar_text(+o: Context.OptText) -> String:
  match o:
    case Context.Absent{}: SNil{}
    case Context.Present{t}: t

def wc_frame_ok(+e: Wire.WireRead) -> Bool:
  match e:
    case Wire.WrEvent{version, query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload}: True{}
    case other: False{}

def wc_frame_build(+e: Wire.WireRead, +b: Sel.MBind) -> SV.Frame:
  match e:
    case Wire.WrEvent{version, query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload}:
      SV.Frame{"2", wc_scalar_text(query), wc_scalar_text(owner), b, wc_scalar_text(runtime),
               wc_scalar_text(role), wc_scalar_text(incarnation), sequence, frame_type,
               Wire.wire_value(payload)}
    case other:
      SV.Frame{"2", SNil{}, SNil{}, b, SNil{}, SNil{}, SNil{}, SNil{}, SNil{}, SNil{}}

def wc_frame_step(+e: Wire.WireRead, +binding: WireBinding, ok: Bool) -> WireFrame:
  match binding:
    case WbRefused{condition}: WfRefused{condition}
    case WbOk{b}: Bool.pick(WireFrame, ok, WfOk{wc_frame_build(e, b)}, WfRefused{"notAnEvent"})

def wc_producer_binding(+e: Wire.WireRead) -> WireBinding:
  match e:
    case Wire.WrEvent{version, query, owner, producer, runtime, role, incarnation, sequence, frame_type, payload}: wire_binding_read(producer)
    case other: WbRefused{"notAnEvent"}

def wire_frame_read(+e: Wire.WireRead) -> WireFrame:
  wc_frame_step(e, wc_producer_binding(e), wc_frame_ok(e))

# --- laws ------------------------------------------------------------------

def wc_binding_value() -> Codec.RawValue:
  Codec.Robj{
    Codec.Rpair{"id", Codec.Rstr{"m"}, Codec.Rpair{"revision", Codec.Rstr{"r1"},
      Codec.Rpair{"declarationDigest", Codec.Rstr{"d"}, Codec.Rpair{"protocolVersion", Codec.Rstr{"1"},
        Codec.Rpair{"operation", Codec.Rstr{"op"}, Codec.Rpair{"artifactIdentities",
          Codec.Rarr{Codec.Robj{Codec.Rpair{"packagePath", Codec.Rstr{"/p"}, Codec.Rpair{"sha256", Codec.Rstr{"aa"}, Codec.Rpair{"role", Codec.Rstr{"native"}, Codec.Rnil{}}}}, Codec.Rnil{}},
            Codec.Rpair{"schemaIdentities", Codec.Rarr{Codec.Rstr{"s1"}, Codec.Rnil{}}, Codec.Rnil{}}}}}}}}}

law wc_law_a_binding_reads_into_the_typed_binding:
  {wire_binding_read(wc_binding_value()) == WbOk{Sel.MBind{"m", "r1", "d", "1", "op", Decl.ArtsCons{Decl.Art{"/p", "aa", "native"}, Decl.ArtsNil{}}, Eng.SSCons{"s1", Eng.SSNil{}}}} : WireBinding}

def wc_law_a_binding_reads_into_the_typed_binding():
  {==}

law wc_law_a_binding_missing_a_member_refuses:
  {wire_binding_read(Codec.Robj{Codec.Rpair{"id", Codec.Rstr{"m"}, Codec.Rnil{}}) == WbRefused{"invalidBinding"} : WireBinding}

def wc_law_a_binding_missing_a_member_refuses():
  {==}

law wc_law_a_binding_with_a_number_id_refuses:
  {wire_binding_read(Codec.Robj{Codec.Rpair{"id", Codec.Rnum{"7"}, Codec.Rnil{}}) == WbRefused{"invalidBinding"} : WireBinding}

def wc_law_a_binding_with_a_number_id_refuses():
  {==}

law wc_law_an_artifact_without_all_three_members_refuses:
  {wc_artifact_ok(Codec.Robj{Codec.Rpair{"packagePath", Codec.Rstr{"/p"}, Codec.Rnil{}}) == False{} : Bool}

def wc_law_an_artifact_without_all_three_members_refuses():
  {==}

law wc_law_a_schema_list_of_text_reads:
  {wc_schemas_build(Codec.Rarr{Codec.Rstr{"a"}, Codec.Rarr{Codec.Rstr{"b"}, Codec.Rnil{}}}) == Eng.SSCons{"a", Eng.SSCons{"b", Eng.SSNil{}}} : Eng.SS}

def wc_law_a_schema_list_of_text_reads():
  {==}

law wc_law_an_invocation_read_is_not_an_event_frame:
  {wire_frame_read(Wire.WrInvocation{"2", Context.Absent{}, Context.Absent{}, Codec.Rnil{}, Codec.Rnil{}, Codec.Rnil{}, Codec.Rnil{}, Context.Absent{}, Context.Absent{}}) == WfRefused{"notAnEvent"} : WireFrame}

def wc_law_an_invocation_read_is_not_an_event_frame():
  {==}

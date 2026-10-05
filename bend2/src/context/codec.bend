# CLAIM: the context codec's own decisions are pure Bend2. The module validates the
# MCP metadata profile over raw JSON tokens and answers with a field-free verdict,
# so the metadata is discarded rather than carried; it decides the frame envelope,
# tool and arguments in one fixed order that refuses before any dispatch; it refuses
# a closed-request or grant failure before any effect, including an empty composed
# operation; and it decodes a retained reference into the fields context-core's
# `Refs.Ref` carries.
#
# Ownership: the operation vocabulary, `operation_known` and every required-effect
# subset belong to context-core (`Eng.required_effects`). This module takes the
# composed operation and its required effects as inputs, so a request-local tool
# override adds `executeTarget` without replacing the subject's obligation.
#
# Serves: docs/bend2/semantic-context-spec.md, MCP framing and effect admission.
# Fixture: the codec entry prints one line per decision; its expected output is an
# independently reviewed oracle and is not checked in yet.
import Base
import ../json/canonical.bend as J
import ./contracts.bend as Context
import ./request.bend as Req
import ./operations.bend as Ops

# ---------------------------------------------------------------------------
# The raw-token value model. This is what the hex row traversal produces for a
# frame: a scalar keeps its exact JSON token, a string keeps its decoded value, and
# containers keep their member or item chain. A numeric token is therefore never
# converted through Bend U32 or a host number before it is judged.

type RawItems is Data:
  RInone{}
  RIcons{head: RawValue, tail: RawItems}

type RawMembers is Data:
  RMnone{}
  RMcons{key: String, value: RawValue, tail: RawMembers}

type RawValue is Data:
  Rnull{}
  Rtrue{}
  Rfalse{}
  Rnum{token: String}
  Rstr{value: String}
  Rarr{items: RawItems}
  Robj{members: RawMembers}

def raw_member(key: String, members: RawMembers) -> Maybe<&2, RawValue>:
  match members:
    case RMnone{}: None{}
    case RMcons{+name, +value, +tail}:
      Bool.pick(Maybe<&2, RawValue>, String.eq(name, key), Some{value}, raw_member(key, tail))

# ---------------------------------------------------------------------------
# The metadata profile. `params._meta` is an object; its optional `progressToken`
# accepts a string or a strict JSON number token, including negative, fractional,
# exponent and above-U32 forms; null, booleans, arrays and objects refuse. Other
# members are opaque transport data. The verdict carries no member, so the caller
# cannot retain metadata even by accident.

type MetaVerdict is Data:
  MetaOk{}
  MetaNotObject{}
  MetaBadProgressToken{}

def meta_text(v: MetaVerdict) -> String:
  match v:
    case MetaOk{}: SNil{}
    case MetaNotObject{}: "metadataNotObject"
    case MetaBadProgressToken{}: "invalidProgressToken"

def progress_token_ok(v: RawValue) -> Bool:
  match v:
    case Rstr{+value}: True{}
    case Rnum{+token}: Context.strict_number_token_ok(token)
    case Rnull{}: False{}
    case Rtrue{}: False{}
    case Rfalse{}: False{}
    case Rarr{+items}: False{}
    case Robj{+members}: False{}

def meta_members_ok(members: RawMembers) -> Bool:
  match members:
    case RMnone{}: True{}
    case RMcons{+name, +value, +tail}:
      Bool.pick(Bool, String.eq(name, "progressToken"), meta_progress(value, tail), meta_members_ok(tail))

def meta_progress(v: RawValue, +tail: RawMembers) -> Bool:
  Bool.pick(Bool, progress_token_ok(v), meta_members_ok(tail), False{})

def meta_of_ok(ok: Bool) -> MetaVerdict:
  match ok:
    case True{}: MetaOk{}
    case False{}: MetaBadProgressToken{}

def metadata_validate(v: RawValue) -> MetaVerdict:
  match v:
    case Robj{members}: meta_of_ok(meta_members_ok(members))
    case Rnull{}: MetaNotObject{}
    case Rtrue{}: MetaNotObject{}
    case Rfalse{}: MetaNotObject{}
    case Rnum{+token}: MetaNotObject{}
    case Rstr{+value}: MetaNotObject{}
    case Rarr{+items}: MetaNotObject{}

def meta_one(key: String, v: RawValue) -> RawValue:
  Robj{RMcons{key, v, RMnone{}}}

# ---------------------------------------------------------------------------
# The frame envelope. The native entry extracts these values from the raw frame
# bytes; the decision order below is the ordering contract, and every step refuses
# before the next one is consulted.

type Envelope is Data:
  EnvFrame{jsonrpc: String, method: String, tool: String, frame_id: Context.FrameId,
           query: Context.OptText, request: Context.OptText}

type EnvelopeVerdict is Data:
  EnvAccepted{tool: Context.CodecTool, id: Context.FrameId, query: Context.OptText, request: Context.OptText}
  EnvRefused{condition: String}

def envelope_text(v: EnvelopeVerdict) -> String:
  match v:
    case EnvAccepted{tool, id, query, request}:
      Context.codec_success_text(tool, id, query, request)
    case EnvRefused{condition}: condition

def env_query_of(+env: Envelope) -> Context.OptText:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: query

def env_request(+env: Envelope) -> Context.OptText:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: request

def env_id(+env: Envelope) -> Context.FrameId:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: frame_id

def env_tool_text(+env: Envelope) -> String:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: tool

def env_jsonrpc_ok(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: String.eq(jsonrpc, "2.0")

def env_method_ok(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request}: String.eq(method, "tools/call")

def env_tool_known(+env: Envelope) -> Bool:
  tool_present(Context.codec_tool_of(env_tool_text(env)))

def tool_present(m: Maybe<&2, Context.CodecTool>) -> Bool:
  match m:
    case Some{+value}: True{}
    case None{}: False{}

# The acceptance path is guarded by `env_tool_known`, so the fallback here is
# unreachable for an accepted envelope.
def env_tool(+env: Envelope) -> Context.CodecTool:
  tool_value(Context.codec_tool_of(env_tool_text(env)))

def tool_value(m: Maybe<&2, Context.CodecTool>) -> Context.CodecTool:
  match m:
    case Some{value}: value
    case None{}: Context.CtEngines{}

def opt_absent(q: Context.OptText) -> Bool:
  match q:
    case Context.Absent{}: True{}
    case Context.Present{value}: False{}

def opt_nonempty(q: Context.OptText) -> Bool:
  match q:
    case Context.Absent{}: False{}
    case Context.Present{value}: Bool.pick(Bool, String.is_empty(value), False{}, True{})

def env_query_ok(+env: Envelope) -> Bool:
  query_shape(env_tool_text(env), env_query_of(env))

def query_shape(+tool: String, q: Context.OptText) -> Bool:
  match tool:
    case "context-engines": opt_absent(q)
    case other: opt_nonempty(q)

def env_request_ok(+env: Envelope) -> Bool:
  request_shape(env_tool_text(env), env_request(env))

def request_shape(+tool: String, r: Context.OptText) -> Bool:
  match tool:
    case "context-query": opt_nonempty(r)
    case other: opt_absent(r)

def env_arguments_ok(+env: Envelope) -> Bool:
  Bool.pick(Bool, env_query_ok(env), env_request_ok(env), False{})

def envelope_decide(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_jsonrpc_ok(env), envelope_after_jsonrpc(env), EnvRefused{"invalidJsonrpc"})

def envelope_after_jsonrpc(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_method_ok(env), envelope_after_method(env), EnvRefused{"invalidMethod"})

def envelope_after_method(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, Context.frame_id_ok(env_id(env)), envelope_after_id(env), EnvRefused{"invalidFrameId"})

def envelope_after_id(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_tool_known(env), envelope_after_tool(env), EnvRefused{"unknownTool"})

def envelope_after_tool(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_arguments_ok(env), envelope_accept(env), EnvRefused{"invalidArguments"})

def envelope_accept(+env: Envelope) -> EnvelopeVerdict:
  EnvAccepted{env_tool(env), env_id(env), env_query_of(env), env_request(env)}

# ---------------------------------------------------------------------------
# The dispatch decision. Closed-request validation, the composed operation and the
# grant set are checked in that order, and a refusal answers a fixed condition
# before any effect.

type Admission is Data:
  ADispatch{operation: String}
  ARefused{class: Context.RefusalClass, condition: String}

def admission_text(a: Admission) -> String:
  match a:
    case ADispatch{operation}: "dispatch:" ++ operation
    case ARefused{cls, condition}: "refused:" ++ Context.refusal_class_name(cls) ++ ":" ++ condition

def dispatch_admission(+req: J.Json, +operation: String, required: Context.Effects, +grants: Context.Effects) -> Admission:
  dispatch_profile(Context.request_validate(req), operation, required, grants)

def dispatch_profile(v: Req.Verdict, +operation: String, required: Context.Effects, +grants: Context.Effects) -> Admission:
  match v:
    case Req.VAccepted{}: dispatch_operation(operation, required, grants)
    case Req.VRefused{condition}: ARefused{Context.RfValidation{}, condition}

def dispatch_operation(+operation: String, required: Context.Effects, +grants: Context.Effects) -> Admission:
  Bool.pick(Admission, String.is_empty(operation),
    ARefused{Context.RfValidation{}, "unknownOperation"}, dispatch_grant(operation, required, grants))

def dispatch_grant(+operation: String, required: Context.Effects, +grants: Context.Effects) -> Admission:
  grant_admission(Context.missing_grant(required, grants), operation)

def grant_admission(m: Maybe<&2, Context.Effect>, +operation: String) -> Admission:
  match m:
    case None{}: ADispatch{operation}
    case Some{+effect}: ARefused{Context.RfValidation{}, "effectNotGranted"}

# The required set a caller passes is the union of every selected operation's
# subset. `Context.cat_effects` is the union builder, and this law pins that an
# override adds its effect without dropping the subject's.
# A minimal accepted closed request, so these laws exercise the real profile.
def Request_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}, J.Jnil{}}}}}

def RawRefused_sample() -> J.Json:
  J.Jstr{"not an object"}

law codec_law_an_override_adds_execute_target_without_dropping_a_plan:
  {Context.missing_grant(Context.cat_effects(Context.one_effect(Context.EfPlanTargetSql{}), Context.one_effect(Context.EfExecuteTarget{})), Context.one_effect(Context.EfPlanTargetSql{})) == Some{Context.EfExecuteTarget{}} : Maybe<&2, Context.Effect>}

def codec_law_an_override_adds_execute_target_without_dropping_a_plan():
  {==}

law codec_law_an_empty_operation_refuses:
  {dispatch_admission(Request_sample(), "", Context.no_effects(), Context.no_effects()) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_empty_operation_refuses():
  {==}

law codec_law_a_missing_grant_refuses_before_dispatch:
  {dispatch_admission(Request_sample(), "sqlPlan", Context.one_effect(Context.EfPlanTargetSql{}), Context.no_effects()) == ARefused{Context.RfValidation{}, "effectNotGranted"} : Admission}

def codec_law_a_missing_grant_refuses_before_dispatch():
  {==}

law codec_law_a_granted_operation_dispatches_with_its_operation:
  {dispatch_admission(Request_sample(), "sqlPlan", Context.one_effect(Context.EfPlanTargetSql{}), Context.one_effect(Context.EfPlanTargetSql{})) == ADispatch{"sqlPlan"} : Admission}

def codec_law_a_granted_operation_dispatches_with_its_operation():
  {==}

law codec_law_a_refused_profile_refuses_before_the_operation_is_consulted:
  {dispatch_admission(RawRefused_sample(), "sqlPlan", Context.no_effects(), Context.no_effects()) == ARefused{Context.RfValidation{}, "requestNotObject"} : Admission}

def codec_law_a_refused_profile_refuses_before_the_operation_is_consulted():
  {==}

# ---------------------------------------------------------------------------
# The metadata laws. The verdict carries no member, so two different metadata
# objects with the same outcome are the same value: that is the discard.

law codec_law_metadata_discards_its_members:
  {metadata_validate(meta_one("a", Rnum{"1"})) == metadata_validate(meta_one("b", Rstr{"x"})) : MetaVerdict}

def codec_law_metadata_discards_its_members():
  {==}

law codec_law_metadata_accepts_a_string_progress_token:
  {metadata_validate(meta_one("progressToken", Rstr{"p"})) == MetaOk{} : MetaVerdict}

def codec_law_metadata_accepts_a_string_progress_token():
  {==}

law codec_law_metadata_accepts_a_fractional_progress_token:
  {metadata_validate(meta_one("progressToken", Rnum{"0.5"})) == MetaOk{} : MetaVerdict}

def codec_law_metadata_accepts_a_fractional_progress_token():
  {==}

law codec_law_metadata_accepts_an_above_u32_progress_token:
  {metadata_validate(meta_one("progressToken", Rnum{"9007199254740993"})) == MetaOk{} : MetaVerdict}

def codec_law_metadata_accepts_an_above_u32_progress_token():
  {==}

law codec_law_metadata_accepts_an_overflowing_exponent_token:
  {metadata_validate(meta_one("progressToken", Rnum{"1e400"})) == MetaOk{} : MetaVerdict}

def codec_law_metadata_accepts_an_overflowing_exponent_token():
  {==}

law codec_law_metadata_refuses_a_null_progress_token:
  {metadata_validate(meta_one("progressToken", Rnull{})) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_metadata_refuses_a_null_progress_token():
  {==}

law codec_law_metadata_refuses_an_object_progress_token:
  {metadata_validate(meta_one("progressToken", Robj{RMnone{}})) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_metadata_refuses_an_object_progress_token():
  {==}

law codec_law_metadata_refuses_a_malformed_number_token:
  {metadata_validate(meta_one("progressToken", Rnum{"1e"})) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_metadata_refuses_a_malformed_number_token():
  {==}

law codec_law_metadata_refuses_a_non_object:
  {metadata_validate(Rarr{RInone{}}) == MetaNotObject{} : MetaVerdict}

def codec_law_metadata_refuses_a_non_object():
  {==}

# ---------------------------------------------------------------------------
# The envelope ordering laws. Each pins that the earlier refusal wins.

law codec_law_a_bad_jsonrpc_refuses_before_the_tool:
  {envelope_decide(EnvFrame{"1.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, Context.Absent{}}) == EnvRefused{"invalidJsonrpc"} : EnvelopeVerdict}

def codec_law_a_bad_jsonrpc_refuses_before_the_tool():
  {==}

law codec_law_a_bad_method_refuses_before_the_frame_id:
  {envelope_decide(EnvFrame{"2.0", "tools/list", "context-engines", Context.IdNumber{"9007199254740992"}, Context.Absent{}, Context.Absent{}}) == EnvRefused{"invalidMethod"} : EnvelopeVerdict}

def codec_law_a_bad_method_refuses_before_the_frame_id():
  {==}

law codec_law_an_above_bound_frame_id_refuses_before_the_tool:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdNumber{"9007199254740992"}, Context.Absent{}, Context.Absent{}}) == EnvRefused{"invalidFrameId"} : EnvelopeVerdict}

def codec_law_an_above_bound_frame_id_refuses_before_the_tool():
  {==}

law codec_law_an_unknown_tool_refuses:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, Context.Absent{}}) == EnvRefused{"unknownTool"} : EnvelopeVerdict}

def codec_law_an_unknown_tool_refuses():
  {==}

law codec_law_the_engines_tool_carries_no_query:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "context-engines", Context.IdNumber{"7"}, Context.Present{"q1"}, Context.Absent{}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_engines_tool_carries_no_query():
  {==}

law codec_law_the_query_tool_needs_a_nonempty_query_id:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "context-query", Context.IdNumber{"7"}, Context.Present{""}, Context.Present{"{\"version\":1}"}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_query_tool_needs_a_nonempty_query_id():
  {==}

law codec_law_the_query_tool_needs_a_request:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "context-query", Context.IdNumber{"7"}, Context.Present{"q1"}, Context.Absent{}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_query_tool_needs_a_request():
  {==}

law codec_law_an_accepted_query_frame_emits_its_success_document:
  {envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "context-query", Context.IdNumber{"7"}, Context.Present{"q1"}, Context.Present{"{\"version\":1}"}})) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{\\\"version\\\":1}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_an_accepted_query_frame_emits_its_success_document():
  {==}

# ---------------------------------------------------------------------------
# Retained reference decoding. The fields are the ones context-core's `Refs.Ref`
# carries; the projections text is joined separately so no array crosses this
# boundary.

type RefDecode is Data:
  RdNone{}
  RdRef{id: String, engine: String, subject: String, snapshot_id: String}
  RdBad{condition: String}

def ref_words() -> Req.Words:
  Req.words_from(["id", "engine", "subject", "snapshotId", "projections"])

def present_str(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: Req.is_jstr(value)

def present_array(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: strings_only(value)

def strings_only(+j: J.Json) -> Bool:
  match j:
    case J.Jarr{+head, +tail}: Bool.pick(Bool, Req.is_jstr(head), strings_only(tail), False{})
    case J.Jnil{}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jobj{+members}: False{}

def field_nonempty(+members: J.Json, +key: String) -> Bool:
  Bool.pick(Bool, field_str(members, key), String.is_empty(field_text(members, key)), False{})

def field_str(+members: J.Json, +key: String) -> Bool:
  present_str(Req.member_lookup(key, members))

def field_text(+members: J.Json, key: String) -> String:
  Ops.member_text(members, key)

def field_array(+members: J.Json, +key: String) -> Bool:
  present_array(Req.member_lookup(key, members))

def ref_closed(+members: J.Json) -> Bool:
  Req.keys_allowed(ref_words(), members)

def ref_required(+members: J.Json) -> Bool:
  Req.all_present(ref_words(), members)

def ref_values_ok(+members: J.Json) -> Bool:
  Bool.pick(Bool, field_nonempty(members, "id"),
    Bool.pick(Bool, field_nonempty(members, "engine"),
      Bool.pick(Bool, field_nonempty(members, "subject"),
        Bool.pick(Bool, field_nonempty(members, "snapshotId"), field_array(members, "projections"), False{}),
        False{}), False{}), False{})

def ref_members(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_values_ok(members),
    RdRef{field_text(members, "id"), field_text(members, "engine"), field_text(members, "subject"), field_text(members, "snapshotId")},
    RdBad{"invalidRefField"})

def ref_object(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_required(members), ref_members(members), RdBad{"missingRefField"})

def ref_fields(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_closed(members), ref_object(members), RdBad{"unknownRefField"})

def ref_decode(+j: J.Json) -> RefDecode:
  ref_kind(Req.is_jobj(j), j)

def ref_kind(ok: Bool, +j: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ok, ref_fields(Ops.obj_members(j)), RdBad{"refNotObject"})

def ref_id_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{id, +engine, +subject, +snapshot_id}: id
    case RdBad{condition}: SNil{}

def ref_condition(d: RefDecode) -> String:
  match d:
    case RdNone{}: "noReference"
    case RdRef{+id, +engine, +subject, +snapshot_id}: SNil{}
    case RdBad{condition}: condition

def ref_object_of(members: J.Json) -> J.Json:
  J.Jobj{members}

def ref_members_base(id: String, projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"subject", J.Jstr{"symbol"},
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jnil{}}}}}}

def ref_members_extra(id: String, projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"subject", J.Jstr{"symbol"},
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jpair{"extra", J.Jstr{"x"}, J.Jnil{}}}}}}}

law codec_law_a_retained_reference_decodes_its_fields:
  {ref_id_of(ref_decode(ref_object_of(ref_members_base("[\"source\",\"/a.ts\"]", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "[\"source\",\"/a.ts\"]" : String}

def codec_law_a_retained_reference_decodes_its_fields():
  {==}

law codec_law_a_reference_with_an_unknown_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_extra("r", J.Jarr{J.Jnil{}, J.Jnil{}})))) == "unknownRefField" : String}

def codec_law_a_reference_with_an_unknown_field_refuses():
  {==}

law codec_law_a_reference_with_an_empty_id_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_base("", J.Jarr{J.Jnil{}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_reference_with_an_empty_id_refuses():
  {==}

law codec_law_a_reference_requires_a_string_projection_list:
  {ref_condition(ref_decode(ref_object_of(ref_members_base("r", J.Jarr{J.Jint{1}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_reference_requires_a_string_projection_list():
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("metadata")
    b : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnum{"0.5"}))))
    c : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnum{"1e400"}))))
    d : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnull{}))))
    e : Unit <- IO.print("envelope")
    f : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "context-engines", Context.IdNumber{"7"}, Context.Absent{}, Context.Absent{}})))
    g : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "context-query", Context.IdText{"7"}, Context.Present{"q1"}, Context.Present{"{\"version\":1}"}})))
    h : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"1.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, Context.Absent{}})))
    i : Unit <- IO.print("dispatch")
    j : Unit <- IO.print(admission_text(dispatch_admission(Request_sample(), "sqlPlan", Context.one_effect(Context.EfPlanTargetSql{}), Context.no_effects())))
    k : Unit <- IO.print(admission_text(dispatch_admission(Request_sample(), "", Context.no_effects(), Context.no_effects())))
    IO.print("end")

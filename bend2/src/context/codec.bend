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
import ../git/text.bend as Tx

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

type MetaInput is Data:
  MetaAbsent{}
  MetaPresent{value: RawValue}

# An absent `_meta` is admitted: there is nothing to validate and nothing to retain.
# A present `_meta` is validated under the profile above, and only a successful
# validation discards it.
def metadata_admit(m: MetaInput) -> MetaVerdict:
  match m:
    case MetaAbsent{}: MetaOk{}
    case MetaPresent{value}: metadata_validate(value)

law codec_law_absent_metadata_is_admitted:
  {metadata_admit(MetaAbsent{}) == MetaOk{} : MetaVerdict}

def codec_law_absent_metadata_is_admitted():
  {==}

law codec_law_a_present_non_object_metadata_refuses:
  {metadata_admit(MetaPresent{Rarr{RInone{}}}) == MetaNotObject{} : MetaVerdict}

def codec_law_a_present_non_object_metadata_refuses():
  {==}

law codec_law_a_present_metadata_still_validates_its_token:
  {metadata_admit(MetaPresent{meta_one("progressToken", Rnum{"1e"})}) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_a_present_metadata_still_validates_its_token():
  {==}

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

# The request-derived operation chain. The primary dispatch operation is always
# read out of this chain, so a caller cannot set a primary that escaped Core's
# admission; `chain_with` only appends.
type OpChain is Data:
  Opnone{}
  Opcons{head: String, tail: OpChain}

type OperationAdmission is Data:
  OaAdmitted{}
  OaEmpty{}
  OaUnknown{operation: String}

def chain_named(+op: String) -> OpChain:
  Bool.pick(OpChain, String.is_empty(op), Opnone{}, Opcons{op, Opnone{}})

def chain_with(chain: OpChain, +op: String) -> OpChain:
  chain_append(chain, op)

def chain_append(chain: OpChain, +op: String) -> OpChain:
  match chain:
    case Opnone{}: Bool.pick(OpChain, String.is_empty(op), Opnone{}, Opcons{op, Opnone{}})
    case Opcons{+head, +tail}: Opcons{head, chain_append(tail, op)}

def primary_operation(chain: OpChain) -> String:
  match chain:
    case Opnone{}: SNil{}
    case Opcons{head, +tail}: head

def second_of(+chain: OpChain) -> String:
  match chain:
    case Opnone{}: SNil{}
    case Opcons{head, +tail}: head

def chain_second(+chain: OpChain) -> String:
  match chain:
    case Opnone{}: SNil{}
    case Opcons{+head, tail}: second_of(tail)

def chain_count(chain: OpChain) -> U32:
  match chain:
    case Opnone{}: 0
    case Opcons{+head, +tail}: U32.add(1, chain_count(tail))

def request_operation_chain(+req: J.Json) -> OpChain:
  chain_append(chain_named(Ops.request_operation(req)), Ops.request_override_operation(req))

def admission_accepted(a: OperationAdmission) -> Bool:
  match a:
    case OaAdmitted{}: True{}
    case OaEmpty{}: False{}
    case OaUnknown{+operation}: False{}

def admission_condition(a: OperationAdmission) -> String:
  match a:
    case OaAdmitted{}: SNil{}
    case OaEmpty{}: "unknownOperation"
    case OaUnknown{+operation}: "unknownOperation"

# `Req.Context.request_validate` is the callable form: request.bend declares the
# spec-named functions with their `Context.` prefix, so a caller reaches them
# through the module alias as well. Core supplies the admission answer for exactly
# this chain through `Eng.admit_operations`; the codec consumes it and reads the
# primary out of the chain.
def dispatch_admission(+req: J.Json, +chain: OpChain, admission: OperationAdmission, required: Context.Effects, +grants: Context.Effects) -> Admission:
  dispatch_profile(Req.Context.request_validate(req), chain, admission, required, grants)

def dispatch_profile(v: Req.Verdict, +chain: OpChain, admission: OperationAdmission, required: Context.Effects, +grants: Context.Effects) -> Admission:
  match v:
    case Req.VAccepted{}: dispatch_operation(chain, admission, required, grants)
    case Req.VRefused{condition}: ARefused{Context.RfValidation{}, condition}

def dispatch_operation(+chain: OpChain, +admission: OperationAdmission, required: Context.Effects, +grants: Context.Effects) -> Admission:
  Bool.pick(Admission, admission_accepted(admission),
    dispatch_grant(chain, required, grants), ARefused{Context.RfValidation{}, admission_condition(admission)})

def dispatch_grant(+chain: OpChain, required: Context.Effects, +grants: Context.Effects) -> Admission:
  grant_admission(Context.missing_grant(required, grants), primary_operation(chain))

def dispatch_grant(+operation: String, required: Context.Effects, +grants: Context.Effects) -> Admission:
  grant_admission(Context.missing_grant(required, grants), operation)

def grant_admission(m: Maybe<&2, Context.Effect>, +operation: String) -> Admission:
  match m:
    case None{}: ADispatch{operation}
    case Some{+effect}: ARefused{Context.RfValidation{}, "effectNotGranted"}

# The required set a caller passes is the union of every selected operation's
# subset. `Context.cat_effects` is the union builder, and this law pins that an
# override adds its effect without dropping the subject's.
law codec_law_the_primary_operation_comes_from_the_chain:
  {primary_operation(request_operation_chain(Request_sample())) == "sourceAnalysis" : String}

def codec_law_the_primary_operation_comes_from_the_chain():
  {==}

law codec_law_the_chain_carries_the_override_after_the_subject:
  {primary_operation(request_operation_chain(Join_override_sample())) == "codeAccessJoin" : String}

def codec_law_the_chain_carries_the_override_after_the_subject():
  {==}

law codec_law_the_chain_second_entry_is_the_override:
  {chain_second(request_operation_chain(Join_override_sample())) == "toolsProbe" : String}

def codec_law_the_chain_second_entry_is_the_override():
  {==}

law codec_law_an_absent_override_leaves_a_single_entry_chain:
  {chain_count(request_operation_chain(Request_sample())) == 1 : U32}

def codec_law_an_absent_override_leaves_a_single_entry_chain():
  {==}

# A minimal accepted closed request, so these laws exercise the real profile.
def Request_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}, J.Jnil{}}}}}

def RawRefused_sample() -> J.Json:
  J.Jstr{"not an object"}

# A source request that selects the SQL join and carries a request-local tool
# override, so both obligations are in one chain.
def Join_override_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"databaseAccesses"}, J.Jnil{}},
    J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}}}}

law codec_law_an_override_adds_execute_target_without_dropping_a_plan:
  {Context.missing_grant(Context.cat_effects(Context.one_effect(Context.EfPlanTargetSql{}), Context.one_effect(Context.EfExecuteTarget{})), Context.one_effect(Context.EfPlanTargetSql{})) == Some{Context.EfExecuteTarget{}} : Maybe<&2, Context.Effect>}

def codec_law_an_override_adds_execute_target_without_dropping_a_plan():
  {==}

law codec_law_an_empty_operation_refuses:
  {dispatch_admission(Request_sample(), Opnone{}, OaEmpty{}, Context.no_effects(), Context.no_effects()) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_empty_operation_refuses():
  {==}

law codec_law_a_missing_grant_refuses_before_dispatch:
  {dispatch_admission(Request_sample(), request_operation_chain(Request_sample()), OaAdmitted{}, Context.one_effect(Context.EfPlanTargetSql{}), Context.no_effects()) == ARefused{Context.RfValidation{}, "effectNotGranted"} : Admission}

def codec_law_a_missing_grant_refuses_before_dispatch():
  {==}

law codec_law_a_granted_operation_dispatches_with_its_operation:
  {dispatch_admission(Request_sample(), Opcons{"sqlPlan", Opnone{}}, OaAdmitted{}, Context.one_effect(Context.EfPlanTargetSql{}), Context.one_effect(Context.EfPlanTargetSql{})) == ADispatch{"sqlPlan"} : Admission}

def codec_law_a_granted_operation_dispatches_with_its_operation():
  {==}

law codec_law_an_unknown_operation_refuses_even_with_every_grant:
  {dispatch_admission(Request_sample(), request_operation_chain(Request_sample()), OaUnknown{"notAnOperation"}, Context.two_effects(Context.EfExecuteTarget{}, Context.EfControlRuntime{}), Context.two_effects(Context.EfExecuteTarget{}, Context.EfControlRuntime{})) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_unknown_operation_refuses_even_with_every_grant():
  {==}

law codec_law_an_admitted_grant_free_operation_dispatches:
  {dispatch_admission(Request_sample(), request_operation_chain(Request_sample()), OaAdmitted{}, Context.no_effects(), Context.no_effects()) == ADispatch{"sourceAnalysis"} : Admission}

def codec_law_an_admitted_grant_free_operation_dispatches():
  {==}

law codec_law_tools_and_subject_obligations_both_apply:
  {dispatch_admission(Join_override_sample(), request_operation_chain(Join_override_sample()), OaAdmitted{}, Context.cat_effects(Context.one_effect(Context.EfPlanTargetSql{}), Context.one_effect(Context.EfExecuteTarget{})), Context.one_effect(Context.EfPlanTargetSql{})) == ARefused{Context.RfValidation{}, "effectNotGranted"} : Admission}

def codec_law_tools_and_subject_obligations_both_apply():
  {==}

law codec_law_a_refused_profile_refuses_before_the_operation_is_consulted:
  {dispatch_admission(RawRefused_sample(), request_operation_chain(Request_sample()), OaAdmitted{}, Context.no_effects(), Context.no_effects()) == ARefused{Context.RfValidation{}, "requestNotObject"} : Admission}

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

type Proj is Data:
  Pnone{}
  Pcons{head: String, tail: Proj}

type RefDecode is Data:
  RdNone{}
  RdRef{id: String, engine: String, subject: String, snapshot_id: String, projections: Proj}
  RdBad{condition: String}

def proj_of(+j: J.Json) -> Proj:
  match j:
    case J.Jarr{+head, +tail}: Pcons{Req.text_of(head), proj_of(tail)}
    case J.Jnil{}: Pnone{}
    case J.Jnull{}: Pnone{}
    case J.Jtrue{}: Pnone{}
    case J.Jfalse{}: Pnone{}
    case J.Jint{+value}: Pnone{}
    case J.Jstr{+value}: Pnone{}
    case J.Jobj{+members}: Pnone{}

def or_json_nil(m: Maybe<&2, J.Json>) -> J.Json:
  match m:
    case None{}: J.Jnil{}
    case Some{value}: value

def proj_names(+p: Proj, +acc: String) -> String:
  match p:
    case Pnone{}: acc
    case Pcons{+head, +tail}: proj_names(tail, acc ++ Bool.pick(String, String.is_empty(acc), SNil{}, ",") ++ head)

def proj_count(p: Proj) -> U32:
  match p:
    case Pnone{}: 0
    case Pcons{+head, +tail}: U32.add(1, proj_count(tail))

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
    RdRef{field_text(members, "id"), field_text(members, "engine"), field_text(members, "subject"), field_text(members, "snapshotId"), proj_of(or_json_nil(Req.member_lookup("projections", members)))},
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
    case RdRef{id, +engine, +subject, +snapshot_id, +projections}: id
    case RdBad{condition}: SNil{}

def ref_condition(d: RefDecode) -> String:
  match d:
    case RdNone{}: "noReference"
    case RdRef{+id, +engine, +subject, +snapshot_id, +projections}: SNil{}
    case RdBad{condition}: condition

# The retained projection chain leaves the decode so core can compose it into
# `Refs.Ref`. It comes from the stored record, never from the request.
def ref_projections_of(d: RefDecode) -> Proj:
  match d:
    case RdNone{}: Pnone{}
    case RdRef{+id, +engine, +subject, +snapshot_id, projections}: projections
    case RdBad{condition}: Pnone{}

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

law codec_law_a_retained_reference_keeps_its_projection_chain:
  {ref_projections_of(ref_decode(ref_object_of(ref_members_base("r", J.Jarr{J.Jstr{"definition"}, J.Jarr{J.Jstr{"calls"}, J.Jnil{}}})))) == Pcons{"definition", Pcons{"calls", Pnone{}}} : Proj}

def codec_law_a_retained_reference_keeps_its_projection_chain():
  {==}

law codec_law_a_retained_reference_counts_its_projections:
  {proj_count(ref_projections_of(ref_decode(ref_object_of(ref_members_base("r", J.Jarr{J.Jstr{"definition"}, J.Jarr{J.Jstr{"calls"}, J.Jnil{}}}))))) == 2 : U32}

def codec_law_a_retained_reference_counts_its_projections():
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

# ---------------------------------------------------------------------------
# The byte-to-envelope conversion. The native entry hands the hex row transport
# `Context.parse_rows` produced; this module rebuilds the frame's raw-token tree
# from the explicit parent identities, then extracts the envelope fields and the
# `_meta` value. A number keeps its document token, so the metadata profile and
# the frame id are decided on the token rather than on a converted value.

type RawOpt is Data:
  ROnone{}
  ROsome{value: RawValue}

type RawFrame is Data:
  RFRoot{root: RawOpt}
  RFObj{id: String, key: String, members: RawMembers, up: RawFrame}
  RFArr{id: String, key: String, items: RawItems, up: RawFrame}
  RFBad{condition: String}

type FrameRead is Data:
  FrValue{value: RawValue}
  FrRefused{condition: String}

type EnvelopeRead is Data:
  ErEnvelope{envelope: Envelope, meta: MetaInput}
  ErRefused{condition: String}

type FrameDecision is Data:
  FdOk{tool: Context.CodecTool, id: Context.FrameId, query: Context.OptText, request: Context.OptText}
  FdRefused{class: Context.RefusalClass, condition: String}

def row_id(r: Req.Row) -> String:
  match r:
    case Req.Row{id, +parent, +kind, +key, +value}: id

def row_parent(r: Req.Row) -> String:
  match r:
    case Req.Row{+id, parent, +kind, +key, +value}: parent

def row_kind(r: Req.Row) -> String:
  match r:
    case Req.Row{+id, +parent, kind, +key, +value}: kind

def row_key(r: Req.Row) -> String:
  match r:
    case Req.Row{+id, +parent, +kind, key, +value}: key

def row_value(r: Req.Row) -> String:
  match r:
    case Req.Row{+id, +parent, +kind, +key, value}: value

def decoded_text(+hex: String) -> String:
  Req.scalar_value(Req.Context.decode_scalar_utf8(Tx.hex_decode(hex)))

def rf_id(+f: RawFrame) -> String:
  match f:
    case RFRoot{+root}: SNil{}
    case RFObj{id, +key, +members, +up}: id
    case RFArr{id, +key, +items, +up}: id
    case RFBad{+condition}: "\u{1}"

def raw_or_null(m: Maybe<&2, RawValue>) -> RawValue:
  match m:
    case None{}: Rnull{}
    case Some{value}: value

def raw_attach(+up: RawFrame, key: String, value: RawValue) -> RawFrame:
  match up:
    case RFRoot{+root}: RFRoot{ROsome{value}}
    case RFObj{id, pkey, members, up2}: RFObj{id, pkey, RMcons{key, value, members}, up2}
    case RFArr{id, pkey, items, up2}: RFArr{id, pkey, RIcons{value, items}, up2}
    case RFBad{condition}: RFBad{condition}

def rev_items(a: RawItems, acc: RawItems) -> RawItems:
  match a:
    case RInone{}: acc
    case RIcons{+head, +tail}: rev_items(tail, RIcons{head, acc})

def close_items(items: RawItems) -> RawItems:
  match items:
    case RInone{}: RInone{}
    case RIcons{+head, +tail}: rev_items(items, RInone{})

def raw_unwind(+f: RawFrame, pid: String) -> RawFrame:
  match f:
    case RFRoot{+root}: RFRoot{root}
    case RFObj{+id, key, members, +up}:
      Bool.pick(RawFrame, String.eq(id, pid), RFObj{id, key, members, up}, raw_unwind(up, pid))
    case RFArr{+id, key, items, +up}:
      Bool.pick(RawFrame, String.eq(id, pid), RFArr{id, key, items, up}, raw_unwind(up, pid))
    case RFBad{condition}: RFBad{condition}

def raw_finish(+f: RawFrame) -> RawFrame:
  match f:
    case RFRoot{+root}: RFRoot{root}
    case RFObj{+id, key, members, up}: raw_finish(raw_attach(up, key, Robj{members}))
    case RFArr{+id, key, items, up}: raw_finish(raw_attach(up, key, Rarr{close_items(items)}))
    case RFBad{condition}: RFBad{condition}

def raw_hex_number(+stack: RawFrame, +row: Req.Row) -> RawFrame:
  Bool.pick(RawFrame, Req.hex_ok(row_value(row)),
    raw_attach(stack, row_key(row), Rnum{decoded_text(row_value(row))}), RFBad{"malformedRowTransport"})

def raw_hex_text(+stack: RawFrame, +row: Req.Row) -> RawFrame:
  Bool.pick(RawFrame, Req.hex_ok(row_value(row)),
    raw_attach(stack, row_key(row), Rstr{decoded_text(row_value(row))}), RFBad{"malformedRowTransport"})

def raw_kind(+kind: String, +stack: RawFrame, +row: Req.Row) -> RawFrame:
  match kind:
    case "object": RFObj{row_id(row), row_key(row), RMnone{}, stack}
    case "array": RFArr{row_id(row), row_key(row), RInone{}, stack}
    case "null": raw_attach(stack, row_key(row), Rnull{})
    case "true": raw_attach(stack, row_key(row), Rtrue{})
    case "false": raw_attach(stack, row_key(row), Rfalse{})
    case "integer": raw_hex_number(stack, row)
    case "real": raw_hex_number(stack, row)
    case "text": raw_hex_text(stack, row)
    case other: RFBad{"malformedRowTransport"}

def raw_unwound(+stack: RawFrame, +row: Req.Row) -> RawFrame:
  Bool.pick(RawFrame, String.eq(rf_id(stack), row_parent(row)),
    raw_kind(row_kind(row), stack, row), RFBad{"missingParentRow"})

def raw_step_live(+frame: RawFrame, +row: Req.Row) -> RawFrame:
  raw_unwound(raw_unwind(frame, row_parent(row)), row)

def raw_step(+frame: RawFrame, +row: Req.Row) -> RawFrame:
  match frame:
    case RFBad{+condition}: RFBad{condition}
    case other_frame: raw_step_live(other_frame, row)

# One self-recursive walk over the rows; a failure is carried by the `RFBad` frame.
def raw_fold(rows: Req.Rows, frame: RawFrame) -> RawFrame:
  match rows:
    case Req.Rnone{}: raw_finish(frame)
    case Req.Rcons{+head, +tail}: raw_fold(tail, raw_step(frame, head))

def frame_root(root: RawOpt) -> FrameRead:
  match root:
    case ROnone{}: FrRefused{"emptyFrame"}
    case ROsome{value}: FrValue{value}

def frame_of(+f: RawFrame) -> FrameRead:
  match f:
    case RFRoot{root}: frame_root(root)
    case RFBad{condition}: FrRefused{condition}
    case RFObj{+id, +key, +members, +up}: FrRefused{"missingParentRow"}
    case RFArr{+id, +key, +items, +up}: FrRefused{"missingParentRow"}

def frame_read(rows: Req.Rows) -> FrameRead:
  frame_of(raw_fold(rows, RFRoot{ROnone{}}))

# --- extraction ------------------------------------------------------------

def raw_members_of(+v: RawValue) -> RawMembers:
  match v:
    case Robj{members}: members
    case Rnull{}: RMnone{}
    case Rtrue{}: RMnone{}
    case Rfalse{}: RMnone{}
    case Rnum{+token}: RMnone{}
    case Rstr{+value}: RMnone{}
    case Rarr{+items}: RMnone{}

def raw_text_of(+v: RawValue) -> String:
  match v:
    case Rstr{value}: value
    case Rnull{}: SNil{}
    case Rtrue{}: SNil{}
    case Rfalse{}: SNil{}
    case Rnum{+token}: SNil{}
    case Rarr{+items}: SNil{}
    case Robj{+members}: SNil{}

def raw_field(+v: RawValue, key: String) -> Maybe<&2, RawValue>:
  raw_member(key, raw_members_of(v))

def raw_field_text(+v: RawValue, key: String) -> String:
  raw_text_of(raw_or_null(raw_field(v, key)))

def opt_text_of(m: Maybe<&2, RawValue>) -> Context.OptText:
  match m:
    case None{}: Context.Absent{}
    case Some{value}: Context.Present{raw_text_of(value)}

def frame_id_of(+v: RawValue) -> Context.FrameId:
  match v:
    case Rstr{value}: Context.IdText{value}
    case Rnum{token}: Context.IdNumber{token}
    case Rnull{}: Context.IdNumber{SNil{}}
    case Rtrue{}: Context.IdNumber{SNil{}}
    case Rfalse{}: Context.IdNumber{SNil{}}
    case Rarr{+items}: Context.IdNumber{SNil{}}
    case Robj{+members}: Context.IdNumber{SNil{}}

def params_of(+frame: RawValue) -> RawValue:
  raw_or_null(raw_field(frame, "params"))

def arguments_of(+frame: RawValue) -> RawValue:
  raw_or_null(raw_field(params_of(frame), "arguments"))

def meta_input(m: Maybe<&2, RawValue>) -> MetaInput:
  match m:
    case None{}: MetaAbsent{}
    case Some{value}: MetaPresent{value}

def meta_of(+frame: RawValue) -> MetaInput:
  meta_input(raw_field(params_of(frame), "_meta"))

def envelope_fields(+frame: RawValue) -> Envelope:
  EnvFrame{raw_field_text(frame, "jsonrpc"), raw_field_text(frame, "method"),
           raw_field_text(params_of(frame), "name"), frame_id_of(raw_or_null(raw_field(frame, "id"))),
           opt_text_of(raw_field(arguments_of(frame), "query")),
           opt_text_of(raw_field(arguments_of(frame), "request"))}

def envelope_read(+r: FrameRead) -> EnvelopeRead:
  match r:
    case FrValue{+value}: ErEnvelope{envelope_fields(value), meta_of(value)}
    case FrRefused{condition}: ErRefused{condition}

def frame_envelope(rows: Req.Rows) -> EnvelopeRead:
  envelope_read(frame_read(rows))

# --- the frame decision ----------------------------------------------------

def meta_accepted(v: MetaVerdict) -> Bool:
  match v:
    case MetaOk{}: True{}
    case MetaNotObject{}: False{}
    case MetaBadProgressToken{}: False{}

def frame_envelope_ok(v: EnvelopeVerdict) -> FrameDecision:
  match v:
    case EnvAccepted{tool, id, query, request}: FdOk{tool, id, query, request}
    case EnvRefused{condition}: FdRefused{Context.RfValidation{}, condition}

def frame_meta(v: EnvelopeVerdict, +m: MetaVerdict) -> FrameDecision:
  Bool.pick(FrameDecision, meta_accepted(m), frame_envelope_ok(v), FdRefused{Context.RfValidation{}, meta_text(m)})

# The envelope is decided first, then the metadata profile. Only an accepted frame
# with accepted metadata reaches `FdOk`, so metadata is discarded after successful
# validation and never carried into the decision.
def frame_envelope_decision(+env: Envelope, +m: MetaVerdict) -> FrameDecision:
  frame_meta(envelope_decide(env), m)

def frame_decision(+r: EnvelopeRead) -> FrameDecision:
  match r:
    case ErEnvelope{envelope, meta}: frame_envelope_decision(envelope, metadata_admit(meta))
    case ErRefused{condition}: FdRefused{Context.RfValidation{}, condition}

# --- laws ------------------------------------------------------------------

law codec_law_a_text_frame_id_stays_a_string:
  {frame_id_of(Rstr{"7"}) == Context.IdText{"7"} : Context.FrameId}

def codec_law_a_text_frame_id_stays_a_string():
  {==}

law codec_law_a_number_frame_id_keeps_its_token:
  {frame_id_of(Rnum{"-1"}) == Context.IdNumber{"-1"} : Context.FrameId}

def codec_law_a_number_frame_id_keeps_its_token():
  {==}

law codec_law_an_absent_frame_id_is_not_a_valid_number:
  {Context.frame_id_ok(frame_id_of(Rnull{})) == False{} : Bool}

def codec_law_an_absent_frame_id_is_not_a_valid_number():
  {==}

law codec_law_only_an_accepted_metadata_verdict_is_admitted:
  {meta_accepted(MetaBadProgressToken{}) == False{} : Bool}

def codec_law_only_an_accepted_metadata_verdict_is_admitted():
  {==}

law codec_law_a_malformed_kind_is_refused:
  {raw_kind("float", RFRoot{ROnone{}}, row_sample()) == RFBad{"malformedRowTransport"} : RawFrame}

def codec_law_a_malformed_kind_is_refused():
  {==}

def row_sample() -> Req.Row:
  Req.Row{"1", "0", "text", "6a736f6e727063", "322e30"}

def row_hex(text: String) -> String:
  J.utf8_hex(J.utf8(text))

def text_row(id: String, parent: String, key: String, value: String) -> Req.Row:
  Req.Row{id, parent, "text", row_hex(key), row_hex(value)}

def object_row(id: String, parent: String, key: String) -> Req.Row:
  Req.Row{id, parent, "object", row_hex(key), SNil{}}

def number_row(id: String, parent: String, key: String, token: String) -> Req.Row:
  Req.Row{id, parent, "integer", row_hex(key), row_hex(token)}

def engine_frame_rows() -> Req.Rows:
  Req.Rcons{object_row("0", SNil{}, SNil{}),
  Req.Rcons{text_row("1", "0", "jsonrpc", "2.0"),
  Req.Rcons{text_row("2", "0", "method", "tools/call"),
  Req.Rcons{number_row("3", "0", "id", "7"),
  Req.Rcons{object_row("4", "0", "params"),
  Req.Rcons{text_row("5", "4", "name", "context-engines"),
  Req.Rcons{object_row("6", "4", "arguments"),
  Req.Rnone{}}}}}}}}

def query_frame_rows() -> Req.Rows:
  Req.Rcons{object_row("0", SNil{}, SNil{}),
  Req.Rcons{text_row("1", "0", "jsonrpc", "2.0"),
  Req.Rcons{text_row("2", "0", "method", "tools/call"),
  Req.Rcons{number_row("3", "0", "id", "-1"),
  Req.Rcons{object_row("4", "0", "params"),
  Req.Rcons{text_row("5", "4", "name", "context-query"),
  Req.Rcons{object_row("6", "4", "arguments"),
  Req.Rcons{text_row("7", "6", "query", "q1"),
  Req.Rcons{text_row("8", "6", "request", "{\"version\":1}"),
  Req.Rnone{}}}}}}}}}}

def frame_text(d: FrameDecision) -> String:
  match d:
    case FdOk{tool, id, query, request}: Context.codec_success_text(tool, id, query, request)
    case FdRefused{cls, condition}: Context.refusal_class_name(cls) ++ ":" ++ condition

def main() -> IO(Unit):
  do IO<Unit>:
    z1 : Unit <- IO.print("frame-engines " ++ frame_text(frame_decision(frame_envelope(engine_frame_rows()))))
    z2 : Unit <- IO.print("frame-query " ++ frame_text(frame_decision(frame_envelope(query_frame_rows()))))
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

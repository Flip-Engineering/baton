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
import ../json/uint-decoder.bend as Uint
import ./engines.bend as Eng
import ./refs.bend as Refs
import ./snapshot.bend as Snap

# ---------------------------------------------------------------------------
# The raw-token value model. This is what the hex row traversal produces for a
# frame: a scalar keeps its exact JSON token, a string keeps its decoded value, and
# containers keep their member or item chain. A numeric token is therefore never
# converted through Bend U32 or a host number before it is judged.

# One self-referential tree, as `json/canonical.bend` uses: a Data constructor's
# fields must be Data, so array and member chains are carried by the same type
# rather than by three declarations that refer to each other. `Rarr{head, tail}` is
# an array cell, `Rpair{key, value, rest}` a member cell, and `Rnil` terminates both.
type RawValue is Data:
  Rnull{}
  Rtrue{}
  Rfalse{}
  Rnum{token: String}
  Rstr{value: String}
  Rarr{head: RawValue, tail: RawValue}
  Robj{members: RawValue}
  Rpair{key: String, value: RawValue, rest: RawValue}
  Rnil{}

def raw_member(key: String, members: RawValue) -> Maybe<&2, RawValue>:
  match members:
    case Rpair{+name, +value, +tail}:
      Bool.pick(Maybe<&2, RawValue>, String.eq(name, key), Some{value}, raw_member(key, tail))
    case other: None{}

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
    case Rarr{+head, +tail}: False{}
    case Robj{+members}: False{}
    case Rpair{+key, +value, +rest}: False{}
    case Rnil{}: False{}

def meta_members_ok(members: RawValue) -> Bool:
  match members:
    case Rpair{+name, +value, +tail}:
      Bool.pick(Bool, String.eq(name, "progressToken"),
        Bool.pick(Bool, progress_token_ok(value), meta_members_ok(tail), False{}),
        meta_members_ok(tail))
    case Rnil{}: True{}
    case other: False{}

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
    case Rarr{+head, +tail}: MetaNotObject{}
    case Rpair{+key, +value, +rest}: MetaNotObject{}
    case Rnil{}: MetaNotObject{}

def meta_one(key: String, v: RawValue) -> RawValue:
  Robj{Rpair{key, v, Rnil{}}}

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

type RequestText is Data:
  RtAbsent{}
  RtText{value: String}
  RtBad{condition: String}

def request_condition(r: RequestText) -> String:
  match r:
    case RtAbsent{+value}: SNil{}
    case RtText{+value}: SNil{}
    case RtBad{condition}: condition

def request_opt(r: RequestText) -> Context.OptText:
  match r:
    case RtAbsent{}: Context.Absent{}
    case RtText{value}: Context.Present{value}
    case RtBad{+condition}: Context.Absent{}

def request_absent(r: RequestText) -> Bool:
  match r:
    case RtAbsent{}: True{}
    case RtText{+value}: False{}
    case RtBad{+condition}: False{}

def request_text_present(r: RequestText) -> Bool:
  match r:
    case RtText{+value}: True{}
    case RtAbsent{}: False{}
    case RtBad{+condition}: False{}

def request_bad(r: RequestText) -> Bool:
  match r:
    case RtBad{+condition}: True{}
    case RtAbsent{}: False{}
    case RtText{+value}: False{}

# ---------------------------------------------------------------------------
# The frame envelope. The native entry extracts these values from the raw frame
# bytes; the decision order below is the ordering contract, and every step refuses
# before the next one is consulted.

type Envelope is Data:
  EnvFrame{jsonrpc: String, method: String, tool: String, frame_id: Context.FrameId,
           query: Context.OptText, request: RequestText,
           root_closed: Bool, params_closed: Bool, arguments_closed: Bool}

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
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: query

def env_request(+env: Envelope) -> RequestText:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: request

def env_root_closed(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, root_closed, +params_closed, +arguments_closed}: root_closed

def env_params_closed(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, params_closed, +arguments_closed}: params_closed

def env_arguments_closed(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, arguments_closed}: arguments_closed

def env_id(+env: Envelope) -> Context.FrameId:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: frame_id

def env_tool_text(+env: Envelope) -> String:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: tool

def env_jsonrpc_ok(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: String.eq(jsonrpc, "2.0")

def env_method_ok(+env: Envelope) -> Bool:
  match env:
    case EnvFrame{+jsonrpc, +method, +tool, +frame_id, +query, +request, +root_closed, +params_closed, +arguments_closed}: String.eq(method, "tools/call")

def tool_present(m: Maybe<&2, Context.CodecTool>) -> Bool:
  match m:
    case Some{+value}: True{}
    case None{}: False{}

# The public MCP names and the native tool names address the same three tools. This
# mapping is explicit and closed: the public names are accepted at this boundary, the
# native names are retained for the existing internal call sites and fixtures, and any
# other name falls through unchanged so `codec_tool_of` refuses it as unknownTool.
# Neither the internal tool vocabulary nor the emitted tool names change, and the
# original params.name bytes remain in the frame.
def tool_input_name(+name: String) -> String:
  match name:
    case "baton2_context_query": "context-query"
    case "baton2_context_result": "context-result"
    case "baton2_context_engines": "context-engines"
    case other: name

def env_tool_name(+env: Envelope) -> String:
  tool_input_name(env_tool_text(env))

# The raw MCP-envelope input boundary admits only the three public names, so an internal
# tool name is refused here even though `codec_tool_of` keeps the native vocabulary for
# internal consumers and for the emitted document.
def public_tool_name_ok(+name: String) -> Bool:
  match name:
    case "baton2_context_query": True{}
    case "baton2_context_result": True{}
    case "baton2_context_engines": True{}
    case other: False{}

def env_tool_known(+env: Envelope) -> Bool:
  Bool.and(public_tool_name_ok(env_tool_text(env)), tool_present(Context.codec_tool_of(env_tool_name(env))))

# The acceptance path is guarded by `env_tool_known`, so the fallback here is
# unreachable for an accepted envelope.

def tool_value(m: Maybe<&2, Context.CodecTool>) -> Context.CodecTool:
  match m:
    case Some{value}: value
    case None{}: Context.CtEngines{}

def env_tool(+env: Envelope) -> Context.CodecTool:
  tool_value(Context.codec_tool_of(env_tool_name(env)))

def opt_absent(q: Context.OptText) -> Bool:
  match q:
    case Context.Absent{}: True{}
    case Context.Present{value}: False{}

def opt_nonempty(q: Context.OptText) -> Bool:
  match q:
    case Context.Absent{}: False{}
    case Context.Present{value}: Bool.pick(Bool, String.is_empty(value), False{}, True{})

def query_shape(+tool: String, q: Context.OptText) -> Bool:
  match tool:
    case "context-engines": opt_absent(q)
    case other: opt_nonempty(q)

def env_query_ok(+env: Envelope) -> Bool:
  query_shape(env_tool_name(env), env_query_of(env))

def request_shape(+tool: String, r: RequestText, closed: Bool) -> Bool:
  match tool:
    case "context-query": Bool.pick(Bool, closed, request_text_present(r), False{})
    case other: Bool.pick(Bool, closed, request_absent(r), False{})

def env_request_ok(+env: Envelope) -> Bool:
  request_shape(env_tool_name(env), env_request(env), env_arguments_closed(env))

def env_arguments_ok(+env: Envelope) -> Bool:
  Bool.pick(Bool, env_query_ok(env), env_request_ok(env), False{})

def arguments_condition(+env: Envelope) -> String:
  Bool.pick(String, request_bad(env_request(env)), request_condition(env_request(env)), "invalidArguments")

def envelope_accept(+env: Envelope) -> EnvelopeVerdict:
  EnvAccepted{env_tool(env), env_id(env), env_query_of(env), request_opt(env_request(env))}

# ---------------------------------------------------------------------------
# The dispatch decision. Closed-request validation, the composed operation and the
# grant set are checked in that order, and a refusal answers a fixed condition
# before any effect.

def envelope_after_params(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_arguments_ok(env), envelope_accept(env), EnvRefused{arguments_condition(env)})

def envelope_after_tool(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_params_closed(env), envelope_after_params(env), EnvRefused{"unknownParamsField"})

def envelope_after_id(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_tool_known(env), envelope_after_tool(env), EnvRefused{"unknownTool"})

def envelope_after_root(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, Context.frame_id_ok(env_id(env)), envelope_after_id(env), EnvRefused{"invalidFrameId"})

def envelope_after_method(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_root_closed(env), envelope_after_root(env), EnvRefused{"unknownFrameField"})

def envelope_after_jsonrpc(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_method_ok(env), envelope_after_method(env), EnvRefused{"invalidMethod"})

def envelope_decide(+env: Envelope) -> EnvelopeVerdict:
  Bool.pick(EnvelopeVerdict, env_jsonrpc_ok(env), envelope_after_jsonrpc(env), EnvRefused{"invalidJsonrpc"})

type Admission is Data:
  ADispatch{operations: OpChain, effects: Eng.SS}
  ARefused{class: Context.RefusalClass, condition: String}

# The admitted value carries the whole operation chain and Core's authorized effect
# union, so the caller's executor does not have to reconstruct them.
def admitted_effects(a: Admission) -> Eng.SS:
  match a:
    case ADispatch{+operations, effects}: effects
    case ARefused{+cls, +condition}: Eng.ss_empty()

type OpChain is Data:
  Opnone{}
  Opcons{head: String, tail: OpChain}

def admitted_operations(a: Admission) -> OpChain:
  match a:
    case ADispatch{operations, +effects}: operations
    case ARefused{+cls, +condition}: Opnone{}

def chain_named(+op: String) -> OpChain:
  Bool.pick(OpChain, String.is_empty(op), Opnone{}, Opcons{op, Opnone{}})

def chain_append(chain: OpChain, +op: String) -> OpChain:
  match chain:
    case Opnone{}: Bool.pick(OpChain, String.is_empty(op), Opnone{}, Opcons{op, Opnone{}})
    case Opcons{+head, +tail}: Opcons{head, chain_append(tail, op)}

def chain_with(chain: OpChain, +op: String) -> OpChain:
  chain_append(chain, op)

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

def admission_text(a: Admission) -> String:
  match a:
    case ADispatch{operations, +effects}: "dispatch:" ++ primary_operation(operations) ++ ":" ++ U32.show(chain_count(operations))
    case ARefused{cls, condition}: "refused:" ++ Context.refusal_class_name(cls) ++ ":" ++ condition

# The request-derived operation chain. The primary dispatch operation is always
# read out of this chain, and the chain's subject slot is filled from Core's closed
# intent mapping, so a runtime, query-control or ref subject can never collapse into
# an override-only chain. `chain_with` only appends.
def chain_is_empty(chain: OpChain) -> Bool:
  match chain:
    case Opnone{}: True{}
    case Opcons{+head, +tail}: False{}

# The single conversion of the derived chain to Core's string chain. Admission
# consumes this, so no caller-supplied required set is involved.
def chain_ss(chain: OpChain) -> Eng.SS:
  match chain:
    case Opnone{}: Eng.ss_empty()
    case Opcons{+head, +tail}: Eng.SSCons{head, chain_ss(tail)}

# The one grants conversion between the codec's effect constructors and Core's
# string chain. Nothing else in this module converts effects.
def grants_ss(xs: Context.Effects) -> Eng.SS:
  match xs:
    case Context.EpsNone{}: Eng.ss_empty()
    case Context.EpsCons{+head, +tail}: Eng.union_append(grants_ss(tail), Eng.ss_one(Context.effect_name(head)))

def ss_chain(xs: Eng.SS) -> OpChain:
  match xs:
    case Eng.SSNil{}: Opnone{}
    case Eng.SSCons{+head, +tail}: Opcons{head, ss_chain(tail)}

# A subject this lane does not map is resolved through Core's closed intent mapping;
# only a `ref` subject may use the retained selector's operations, and it uses the
# whole authenticated chain so a model ref cannot lose one of its obligations. Any
# other unmapped subject leaves the subject chain empty, so its work cannot be
# replaced by an override.
def intent_or_retained(+kind: String, +intent: String, +retained_operations: Eng.SS) -> OpChain:
  Bool.pick(OpChain, String.eq(kind, "runtime"), chain_named(Eng.runtime_operation(intent)),
    Bool.pick(OpChain, String.eq(kind, "query-control"), chain_named(Eng.query_control_operation(intent)),
      Bool.pick(OpChain, String.eq(kind, "ref"), ss_chain(retained_operations), Opnone{})))

def chain_subject(+mapped: String, +kind: String, +intent: String, +retained_operations: Eng.SS) -> OpChain:
  Bool.pick(OpChain, String.is_empty(mapped), intent_or_retained(kind, intent, retained_operations), chain_named(mapped))

def subject_chain(+req: J.Json, retained_operations: Eng.SS) -> OpChain:
  chain_subject(Ops.request_operation(req), Ops.request_subject_kind(req), Ops.request_intent(req), retained_operations)

def subject_chain_present(+req: J.Json, retained_operations: Eng.SS) -> Bool:
  Bool.pick(Bool, chain_is_empty(subject_chain(req, retained_operations)), False{}, True{})

def request_operation_chain(+req: J.Json, retained_operations: Eng.SS) -> OpChain:
  chain_append(chain_append(subject_chain(req, retained_operations), Ops.subject_secondary(req)), Ops.request_override_operation(req))

# Core's actual verdict names the refusal: no operation, an operation outside the
# closed set, or the first required effect the caller did not grant. An admit
# carries the whole admitted chain and Core's authorized effect union; the caller
# acts on that chain and only within those effects.
def admission_decision(a: Eng.Admission, +chain: OpChain) -> Admission:
  match a:
    case Eng.AdAdmit{effects}: ADispatch{chain, effects}
    case Eng.AdNoOperation{}: ARefused{Context.RfValidation{}, "unknownOperation"}
    case Eng.AdUnknownOperation{+operation}: ARefused{Context.RfValidation{}, "unknownOperation"}
    case Eng.AdMissingEffect{+effect}: ARefused{Context.RfValidation{}, "effectNotGranted"}

def dispatch_operation(+chain: OpChain, +grants: Context.Effects) -> Admission:
  admission_decision(Eng.admit_operations(chain_ss(chain), grants_ss(grants)), chain)

def dispatch_profile(v: Req.Verdict, +chain: OpChain, +grants: Context.Effects) -> Admission:
  match v:
    case Req.VAccepted{}: dispatch_operation(chain, grants)
    case Req.VRefused{condition}: ARefused{Context.RfValidation{}, condition}

# `Req.Context.request_validate` is the callable form: request.bend declares the
# spec-named functions with their `Context.` prefix, so a caller reaches them
# through the module alias as well.
def dispatch_admission(+req: J.Json, +chain: OpChain, +grants: Context.Effects) -> Admission:
  dispatch_profile(Req.Context.request_validate(req), chain, grants)

def dispatch_guarded(present: Bool, +req: J.Json, retained_operations: Eng.SS, +grants: Context.Effects) -> Admission:
  Bool.pick(Admission, present,
    dispatch_admission(req, request_operation_chain(req, retained_operations), grants),
    ARefused{Context.RfValidation{}, "unknownOperation"})

# The callable entry. It takes the request, the retained selector's operation for a
# ref subject, and the caller's grants; the chain, the required subset and the
# admission answer are all derived here, so an arbitrary chain, verdict or required
# set cannot be substituted.
def codec_dispatch(+req: J.Json, retained_operations: Eng.SS, +grants: Context.Effects) -> Admission:
  dispatch_guarded(subject_chain_present(req, retained_operations), req, retained_operations, grants)

# A minimal accepted closed request, so these laws exercise the real profile.
def Request_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}, J.Jnil{}}}}}

def RawRefused_sample() -> J.Json:
  J.Jstr{"not an object"}

def Runtime_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"runtime"}, J.Jpair{"intent", J.Jstr{"observe"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"state"}, J.Jnil{}}, J.Jnil{}}}}}

def Unmapped_runtime_override_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"runtime"}, J.Jpair{"intent", J.Jstr{"breakpoint"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"state"}, J.Jnil{}},
    J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}}}}

# Object builders keep the canonical field arities in one place.
def cobj1(k1: String, v1: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jnil{}}}

def cobj2(k1: String, v1: J.Json, k2: String, v2: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jpair{k2, v2, J.Jnil{}}}}

def cobj3(k1: String, v1: J.Json, k2: String, v2: J.Json, k3: String, v3: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jpair{k2, v2, J.Jpair{k3, v3, J.Jnil{}}}}}

def carr1(a: J.Json) -> J.Json:
  J.Jarr{a, J.Jnil{}}

def Model_join_sample() -> J.Json:
  cobj3("version", J.Jint{1},
        "subject", cobj1("kind", J.Jstr{"model"}),
        "select", carr1(J.Jstr{"codeAccesses"}))

def Unknown_subject_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"mystery"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}, J.Jnil{}}}}

def Ref_override_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"ref"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}},
    J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}}}

# A source request that selects the SQL join and carries a request-local tool
# override, so both obligations are in one chain.
def Join_override_sample() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"a.ts"}, J.Jnil{}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"databaseAccesses"}, J.Jnil{}},
    J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}}}}

type Proj is Data:
  Pnone{}
  Pcons{head: String, tail: Proj}

type RefDecode is Data:
  RdNone{}
  RdRef{id: String, engine: String, subject_kind: String, subject_text: String, snapshot_id: String, projections: Proj}
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

def present_array(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: strings_only(value)

def nonempty_text(+text: String) -> Bool:
  Bool.pick(Bool, String.is_empty(text), False{}, True{})

def field_str(+members: J.Json, +key: String) -> Bool:
  present_str(Req.member_lookup(key, members))

def field_text(+members: J.Json, key: String) -> String:
  Ops.member_text(members, key)

def field_nonempty(+members: J.Json, +key: String) -> Bool:
  Bool.pick(Bool, field_str(members, key), nonempty_text(field_text(members, key)), False{})

def field_array(+members: J.Json, +key: String) -> Bool:
  present_array(Req.member_lookup(key, members))

def ref_closed(+members: J.Json) -> Bool:
  Req.keys_allowed(ref_words(), members)

def ref_required(+members: J.Json) -> Bool:
  Req.all_present(ref_words(), members)

# The retained selector is what the producer actually writes: either a kind string,
# or a full subject object such as {kind:entity,database,schema,name}. The object is
# validated for a known kind and kept whole as evidence; only the kind is derived
# for Core's admission, and no public field changes.
def key_absent(key: String, rest: J.Json) -> Bool:
  match rest:
    case J.Jpair{+other, +value, +tail}: Bool.pick(Bool, String.eq(key, other), False{}, key_absent(key, tail))
    case J.Jnil{}: True{}
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jarr{+head, +tail}: True{}
    case J.Jobj{+members}: True{}

def distinct_keys(members: J.Json) -> Bool:
  match members:
    case J.Jpair{+key, +value, +rest}: Bool.pick(Bool, key_absent(key, rest), distinct_keys(rest), False{})
    case J.Jnil{}: True{}
    case J.Jnull{}: True{}
    case J.Jtrue{}: True{}
    case J.Jfalse{}: True{}
    case J.Jint{+value}: True{}
    case J.Jstr{+value}: True{}
    case J.Jarr{+head, +tail}: True{}
    case J.Jobj{+members}: True{}

def kind_present(m: Maybe<&2, Context.SubjectKind>) -> Bool:
  match m:
    case Some{+kind}: True{}
    case None{}: False{}

def kind_value_ok(+v: J.Json) -> Bool:
  match v:
    case J.Jstr{value}: Bool.pick(Bool, String.is_empty(value), False{}, kind_present(Context.subject_kind_of(value)))
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jobj{+members}: False{}
    case J.Jnil{}: False{}

def known_kind(m: Maybe<&2, J.Json>) -> Bool:
  match m:
    case None{}: False{}
    case Some{value}: kind_value_ok(value)

def subject_object_ok(+members: J.Json) -> Bool:
  Bool.pick(Bool, distinct_keys(members), known_kind(Req.member_lookup("kind", members)), False{})


def subject_value_ok(+v: J.Json) -> Bool:
  match v:
    case J.Jobj{members}: subject_object_ok(members)
    case J.Jstr{+value}: False{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jarr{+head, +tail}: False{}
    case J.Jnil{}: False{}

# The retained selector is the producer's object, so this path requires it. Its
# member names must be distinct: a duplicate key would make the derived kind
# ambiguous, and the retained decode path has no SQL duplicate check behind it.
def subject_selector_ok(+members: J.Json) -> Bool:
  subject_value_ok(or_json_nil(Req.member_lookup("subject", members)))

def obj_kind_of(m: Maybe<&2, J.Json>) -> String:
  match m:
    case None{}: SNil{}
    case Some{value}: Req.text_of(value)

def subject_kind_value(+v: J.Json) -> String:
  match v:
    case J.Jstr{value}: value
    case J.Jobj{members}: obj_kind_of(Req.member_lookup("kind", members))
    case J.Jnull{}: SNil{}
    case J.Jtrue{}: SNil{}
    case J.Jfalse{}: SNil{}
    case J.Jint{+value}: SNil{}
    case J.Jarr{+head, +tail}: SNil{}
    case J.Jnil{}: SNil{}

def subject_kind_of_members(+members: J.Json) -> String:
  subject_kind_value(or_json_nil(Req.member_lookup("subject", members)))

def subject_text_of_members(+members: J.Json) -> String:
  J.json_text(or_json_nil(Req.member_lookup("subject", members)))

def ref_values_ok(+members: J.Json) -> Bool:
  Bool.pick(Bool, field_nonempty(members, "id"),
    Bool.pick(Bool, field_nonempty(members, "engine"),
      Bool.pick(Bool, subject_selector_ok(members),
        Bool.pick(Bool, field_nonempty(members, "snapshotId"), field_array(members, "projections"), False{}),
        False{}), False{}), False{})

def ref_members(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_values_ok(members),
    RdRef{field_text(members, "id"), field_text(members, "engine"), subject_kind_of_members(members), subject_text_of_members(members), field_text(members, "snapshotId"), proj_of(or_json_nil(Req.member_lookup("projections", members)))},
    RdBad{"invalidRefField"})

def ref_object(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_required(members), ref_members(members), RdBad{"missingRefField"})

# A duplicated top-level field is a member-set defect like an unknown field, so it is
# refused after the unknown-field test and before the required-field test: a record
# that both repeats a field and omits a required one reports the duplicate. Unknown
# field still precedes missing field, and the presence and value stages are unchanged.
# `distinct_keys` is the existing J.Json helper the nested selector check already uses.
def ref_distinct(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, distinct_keys(members), ref_object(members), RdBad{"duplicateRefField"})

def ref_fields(+members: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ref_closed(members), ref_distinct(members), RdBad{"unknownRefField"})

def ref_kind(ok: Bool, +j: J.Json) -> RefDecode:
  Bool.pick(RefDecode, ok, ref_fields(Ops.obj_members(j)), RdBad{"refNotObject"})

def ref_decode(+j: J.Json) -> RefDecode:
  ref_kind(Req.is_jobj(j), j)

def ref_id_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{id, +engine, +subject_kind, +subject_text, +snapshot_id, +projections}: id
    case RdBad{condition}: SNil{}

def ref_condition(d: RefDecode) -> String:
  match d:
    case RdNone{}: "noReference"
    case RdRef{+id, +engine, +subject_kind, +subject_text, +snapshot_id, +projections}: SNil{}
    case RdBad{condition}: condition

# The retained projection chain leaves the decode so core can compose it into
# `Refs.Ref`. It comes from the stored record, never from the request.
def ref_projections_of(d: RefDecode) -> Proj:
  match d:
    case RdNone{}: Pnone{}
    case RdRef{+id, +engine, +subject_kind, +subject_text, +snapshot_id, projections}: projections
    case RdBad{condition}: Pnone{}

def ref_object_of(members: J.Json) -> J.Json:
  J.Jobj{members}

def ref_members_base(id: String, subject: J.Json, projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"subject", subject,
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jnil{}}}}}}

def ref_members_extra(id: String, projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"subject", cobj1("kind", J.Jstr{"symbol"}),
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jpair{"extra", J.Jstr{"x"}, J.Jnil{}}}}}}}

type RawOpt is Data:
  ROnone{}
  ROsome{value: RawValue}

type RawFrame is Data:
  RFRoot{root: RawOpt}
  RFObj{id: String, key: String, members: RawValue, up: RawFrame}
  RFArr{id: String, key: String, items: RawValue, up: RawFrame}
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

# `Context.json_tree_sql` emits all five columns as hex and `Context.parse_rows`
# keeps them verbatim, so every transport field is decoded here exactly once. A
# scalar decoder failure keeps its own reason; the empty string is never used to
# turn an invalid field into a valid one.

type FieldText is Data:
  FtText{value: String}
  FtBad{condition: String}

type DecodedRow is Data:
  DRow{id: String, parent: String, kind: String, key: String, value: String, bad: String}

def ft_text(f: FieldText) -> String:
  match f:
    case FtText{value}: value
    case FtBad{+condition}: SNil{}

def ft_bad(f: FieldText) -> String:
  match f:
    case FtText{+value}: SNil{}
    case FtBad{condition}: condition

def text_field_scalar(+scalar: Req.Scalar) -> FieldText:
  match scalar:
    case Req.ScalarText{value}: FtText{value}
    case Req.ScalarBadUtf8{}: FtBad{"invalidUtf8Field"}
    case Req.ScalarSurrogate{}: FtBad{"surrogateField"}
    case Req.ScalarNul{}: FtBad{"nulInField"}

def text_field_checked(ok: Bool, +hex: String) -> FieldText:
  Bool.pick(FieldText, ok, text_field_scalar(Req.Context.decode_scalar_utf8(Tx.hex_decode(hex))), FtBad{"malformedHexField"})

def text_field(+hex: String) -> FieldText:
  text_field_checked(Req.hex_ok(hex), hex)

def merge_bad(a: String, +b: String) -> String:
  Bool.pick(String, String.is_empty(a), b, a)

def build_row(i: FieldText, p: FieldText, k: FieldText, key: FieldText, v: FieldText) -> DecodedRow:
  DRow{ft_text(i), ft_text(p), ft_text(k), ft_text(key), ft_text(v),
       merge_bad(merge_bad(merge_bad(merge_bad(ft_bad(i), ft_bad(p)), ft_bad(k)), ft_bad(key)), ft_bad(v))}

# `row_id`, `row_parent`, `row_kind`, `row_key` and `row_value` read the transport
# field verbatim, which is hex; only `decode_row` interprets them.
def decode_row(+row: Req.Row) -> DecodedRow:
  build_row(text_field(row_id(row)), text_field(row_parent(row)), text_field(row_kind(row)),
            text_field(row_key(row)), text_field(row_value(row)))

def dr_id(r: DecodedRow) -> String:
  match r:
    case DRow{id, +parent, +kind, +key, +value, +bad}: id

def dr_parent(r: DecodedRow) -> String:
  match r:
    case DRow{+id, parent, +kind, +key, +value, +bad}: parent

def dr_kind(r: DecodedRow) -> String:
  match r:
    case DRow{+id, +parent, kind, +key, +value, +bad}: kind

def dr_key(r: DecodedRow) -> String:
  match r:
    case DRow{+id, +parent, +kind, key, +value, +bad}: key

def dr_value(r: DecodedRow) -> String:
  match r:
    case DRow{+id, +parent, +kind, +key, value, +bad}: value

def dr_bad(r: DecodedRow) -> String:
  match r:
    case DRow{+id, +parent, +kind, +key, +value, bad}: bad

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
    case RFObj{id, pkey, members, up2}: RFObj{id, pkey, Rpair{key, value, members}, up2}
    case RFArr{id, pkey, items, up2}: RFArr{id, pkey, Rarr{value, items}, up2}
    case RFBad{condition}: RFBad{condition}

def rev_items(a: RawValue, acc: RawValue) -> RawValue:
  match a:
    case Rarr{+head, +tail}: rev_items(tail, Rarr{head, acc})
    case other: acc

# The accumulated cell chain closes into a completed array value: a nonempty
# accumulation reverses to its own cell chain, and an empty accumulation becomes the
# canonical empty-array cell `Rarr{Rnil, Rnil}`. The completed value is attached to its
# parent exactly once; no extra array wrapper is added around it.
def array_value(items: RawValue) -> RawValue:
  match items:
    case Rarr{+head, +tail}: rev_items(items, Rnil{})
    case other: Rarr{Rnil{}, Rnil{}}

# Each completed container is attached into its parent while unwinding, so a nested
# object followed by a sibling field keeps its contents. Elements attach in arrival
# order and the close reverses the accumulator, so array order is restored; the
# object member chain is not re-sorted, and the consumers here (member lookup and
# the scalar progress token) do not read member order. Canonical text is produced
# by the shared encoder, which normalizes member order itself.
def raw_unwind(+f: RawFrame, pid: String) -> RawFrame:
  match f:
    case RFRoot{+root}: RFRoot{root}
    case RFObj{+id, +key, +members, up}:
      Bool.pick(RawFrame, String.eq(id, pid), RFObj{id, key, members, up},
        raw_attach(raw_unwind(up, pid), key, Robj{members}))
    case RFArr{+id, +key, +items, up}:
      Bool.pick(RawFrame, String.eq(id, pid), RFArr{id, key, items, up},
        raw_attach(raw_unwind(up, pid), key, array_value(items)))
    case RFBad{+condition}: RFBad{condition}

def raw_finish(+f: RawFrame) -> RawFrame:
  match f:
    case RFRoot{+root}: RFRoot{root}
    case RFObj{+id, key, members, up}: raw_finish(raw_attach(up, key, Robj{members}))
    case RFArr{+id, key, items, up}: raw_finish(raw_attach(up, key, array_value(items)))
    case RFBad{+condition}: RFBad{condition}

def raw_hex_number(+stack: RawFrame, +d: DecodedRow) -> RawFrame:
  raw_attach(stack, dr_key(d), Rnum{dr_value(d)})

def raw_hex_text(+stack: RawFrame, +d: DecodedRow) -> RawFrame:
  raw_attach(stack, dr_key(d), Rstr{dr_value(d)})

def raw_kind(+kind: String, +stack: RawFrame, +d: DecodedRow) -> RawFrame:
  match kind:
    case "object": RFObj{dr_id(d), dr_key(d), Rnil{}, stack}
    case "array": RFArr{dr_id(d), dr_key(d), Rnil{}, stack}
    case "null": raw_attach(stack, dr_key(d), Rnull{})
    case "true": raw_attach(stack, dr_key(d), Rtrue{})
    case "false": raw_attach(stack, dr_key(d), Rfalse{})
    case "integer": raw_hex_number(stack, d)
    case "real": raw_hex_number(stack, d)
    case "text": raw_hex_text(stack, d)
    case other: RFBad{"malformedRowKind"}

def raw_place_decoded(+stack: RawFrame, +d: DecodedRow) -> RawFrame:
  Bool.pick(RawFrame, String.eq(rf_id(stack), dr_parent(d)), raw_kind(dr_kind(d), stack, d), RFBad{"missingParentRow"})

def raw_place(+frame: RawFrame, +d: DecodedRow) -> RawFrame:
  Bool.pick(RawFrame, String.is_empty(dr_bad(d)), raw_place_decoded(raw_unwind(frame, dr_parent(d)), d), RFBad{dr_bad(d)})

def raw_step(+frame: RawFrame, +row: Req.Row) -> RawFrame:
  match frame:
    case RFBad{+condition}: RFBad{condition}
    case other_frame: raw_place(other_frame, decode_row(row))

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

def raw_members_of(+v: RawValue) -> RawValue:
  match v:
    case Robj{members}: members
    case Rnull{}: Rnil{}
    case Rtrue{}: Rnil{}
    case Rfalse{}: Rnil{}
    case Rnum{+token}: Rnil{}
    case Rstr{+value}: Rnil{}
    case Rarr{+head, +tail}: Rnil{}
    case Rpair{+key, +value, +rest}: Rnil{}
    case Rnil{}: Rnil{}

def raw_text_of(+v: RawValue) -> String:
  match v:
    case Rstr{value}: value
    case Rnull{}: SNil{}
    case Rtrue{}: SNil{}
    case Rfalse{}: SNil{}
    case Rnum{+token}: SNil{}
    case Rarr{+head, +tail}: SNil{}
    case Robj{+members}: SNil{}
    case Rpair{+key, +value, +rest}: SNil{}
    case Rnil{}: SNil{}

def raw_field(+v: RawValue, key: String) -> Maybe<&2, RawValue>:
  raw_member(key, raw_members_of(v))

def raw_field_text(+v: RawValue, key: String) -> String:
  raw_text_of(raw_or_null(raw_field(v, key)))

def raw_keys_ok(allowed: Req.Words, members: RawValue) -> Bool:
  match members:
    case Rpair{+key, +value, +tail}: Bool.pick(Bool, Req.word_member(allowed, key), raw_keys_ok(allowed, tail), False{})
    case Rnil{}: True{}
    case other: False{}

def present_raw(m: Maybe<&2, RawValue>) -> Bool:
  match m:
    case None{}: False{}
    case Some{+value}: True{}

def raw_member_present(key: String, members: RawValue) -> Bool:
  present_raw(raw_member(key, members))

def root_words() -> Req.Words:
  Req.words_from(["jsonrpc", "id", "method", "params"])

def params_words() -> Req.Words:
  Req.words_from(["name", "arguments", "_meta"])

def arguments_words(+tool: String) -> Req.Words:
  match tool:
    case "context-query": Req.words_from(["query", "request"])
    case "context-result": Req.words_from(["query"])
    case other: Req.words_from(Nil{})

def arguments_required(+tool: String, members: RawValue) -> Bool:
  match tool:
    case "context-query": Bool.pick(Bool, raw_member_present("query", members), raw_member_present("request", members), False{})
    case "context-result": raw_member_present("query", members)
    case other: True{}

def arguments_closed_for(+tool: String, members: RawValue) -> Bool:
  Bool.pick(Bool, raw_keys_ok(arguments_words(tool), members), arguments_required(tool, members), False{})

# --- the request container conversion --------------------------------------

type JsonConv is Data:
  JcJson{value: J.Json}
  JcRefused{condition: String}

# The conversion is one structurally self-recursive walk over the private tree, like
# `json/canonical.bend`'s emitter: every recursive call passes a strict subterm as its
# first argument and the mode selects a member cell, an array cell or a complete value.
# The result-combining steps are declared before it and do not recurse, so no two
# definitions refer to each other. A number is converted by the qualified U32 decoder
# over its exact token, so a token that is not an exact U32 refuses before any
# canonical emission.
#
# Order: an array's cell chain is in document order, because the close reverses the
# arrival accumulator, and a refusal in a cell is reported before its tail. A member
# chain is held in reverse arrival order, so a refusal found while walking it is not in
# document order; every refusing member-value conversion currently reports the same
# condition text, so the condition that is reported does not depend on that order.

type ConvMode is Data:
  CmValue{}
  CmArray{}
  CmObject{}

def cv_ok(c: JsonConv) -> Bool:
  match c:
    case JcJson{+value}: True{}
    case JcRefused{+condition}: False{}

def cv_json(c: JsonConv) -> J.Json:
  match c:
    case JcJson{value}: value
    case JcRefused{+condition}: J.Jnull{}

def cv_bad(c: JsonConv) -> String:
  match c:
    case JcJson{+value}: SNil{}
    case JcRefused{condition}: condition

def uint_conv(r: Uint.UintResult) -> JsonConv:
  match r:
    case Uint.UintAccepted{value}: JcJson{J.Jint{value}}
    case Uint.UintRefused{+reason}: JcRefused{"nonU32NumberInRequest"}

def number_conv(+token: String) -> JsonConv:
  uint_conv(Uint.finish(Uint.feed(token, Uint.UintStart{})))

# The internal domain of the conversion. `Rnil` terminates both chains and is the only
# admitted terminator; a member cell is admitted only while reading a member chain, an
# array cell only in a value or array position, and an object only in a value position.
def mode_is_value(mode: ConvMode) -> Bool:
  match mode:
    case CmValue{}: True{}
    case CmArray{}: False{}
    case CmObject{}: False{}

def mode_is_member(mode: ConvMode) -> Bool:
  match mode:
    case CmObject{}: True{}
    case CmValue{}: False{}
    case CmArray{}: False{}

def arr_rest(rest: JsonConv, +head: J.Json) -> JsonConv:
  Bool.pick(JsonConv, cv_ok(rest), JcJson{J.Jarr{head, cv_json(rest)}}, JcRefused{cv_bad(rest)})

def arr_mode(rest: JsonConv, +head: J.Json, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, mode_is_member(mode), JcRefused{"arrayCellInMemberChain"}, arr_rest(rest, head))

def arr_step(c: JsonConv, rest: JsonConv, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, cv_ok(c), arr_mode(rest, cv_json(c), mode), JcRefused{cv_bad(c)})

def obj_wrap(c: JsonConv) -> JsonConv:
  match c:
    case JcJson{value}: JcJson{J.Jobj{value}}
    case JcRefused{condition}: JcRefused{condition}

def obj_step(c: JsonConv, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, mode_is_value(mode), obj_wrap(c), JcRefused{"objectOutsideValuePosition"})

def pair_rest(rest: JsonConv, +key: String, +value: J.Json) -> JsonConv:
  Bool.pick(JsonConv, cv_ok(rest), JcJson{J.Jpair{key, value, cv_json(rest)}}, JcRefused{cv_bad(rest)})

def pair_mode(rest: JsonConv, +key: String, +value: J.Json, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, mode_is_member(mode), pair_rest(rest, key, value), JcRefused{"memberCellOutsideObject"})

def pair_step(c: JsonConv, rest: JsonConv, key: String, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, cv_ok(c), pair_mode(rest, key, cv_json(c), mode), JcRefused{cv_bad(c)})

def scalar_in_mode(+value: J.Json, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, mode_is_member(mode), JcRefused{"scalarInMemberChain"}, JcJson{value})

def number_in_mode(+token: String, mode: ConvMode) -> JsonConv:
  Bool.pick(JsonConv, mode_is_member(mode), JcRefused{"scalarInMemberChain"}, number_conv(token))

def conv(+v: RawValue, +mode: ConvMode) -> JsonConv:
  match v:
    case Rnull{}: scalar_in_mode(J.Jnull{}, mode)
    case Rtrue{}: scalar_in_mode(J.Jtrue{}, mode)
    case Rfalse{}: scalar_in_mode(J.Jfalse{}, mode)
    case Rnum{token}: number_in_mode(token, mode)
    case Rstr{value}: scalar_in_mode(J.Jstr{value}, mode)
    case Rarr{+head, +tail}: arr_step(conv(head, CmValue{}), conv(tail, CmArray{}), mode)
    case Robj{members}: obj_step(conv(members, CmObject{}), mode)
    case Rpair{+key, +value, +rest}: pair_step(conv(value, CmValue{}), conv(rest, CmObject{}), key, mode)
    case Rnil{}: JcJson{J.Jnil{}}

def raw_to_json(+v: RawValue) -> JsonConv:
  conv(v, CmValue{})

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
    case Rarr{+head, +tail}: Context.IdNumber{SNil{}}
    case Robj{+members}: Context.IdNumber{SNil{}}
    case Rpair{+key, +value, +rest}: Context.IdNumber{SNil{}}
    case Rnil{}: Context.IdNumber{SNil{}}

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

# The canonical text of a request object, or the condition that refused it. A
# non-object refuses, and a number that is not an exact U32 token refuses through the
# converter rather than being coerced. The request is always a JSON object here.
def request_conv_ok(c: JsonConv) -> RequestText:
  match c:
    case JcJson{value}: RtText{J.json_text(value)}
    case JcRefused{condition}: RtBad{condition}

def request_read(+v: RawValue) -> RequestText:
  match v:
    case Robj{members}: request_conv_ok(raw_to_json(v))
    case Rnull{}: RtBad{"requestNotObject"}
    case Rtrue{}: RtBad{"requestNotObject"}
    case Rfalse{}: RtBad{"requestNotObject"}
    case Rnum{+token}: RtBad{"requestNotObject"}
    case Rstr{+value}: RtBad{"requestNotObject"}
    case Rarr{+head, +tail}: RtBad{"requestNotObject"}
    case Rpair{+key, +value, +rest}: RtBad{"requestNotObject"}
    case Rnil{}: RtBad{"requestNotObject"}

def request_field(m: Maybe<&2, RawValue>) -> RequestText:
  match m:
    case None{}: RtAbsent{}
    case Some{value}: request_read(value)

def envelope_fields(+frame: RawValue) -> Envelope:
  EnvFrame{raw_field_text(frame, "jsonrpc"), raw_field_text(frame, "method"),
           raw_field_text(params_of(frame), "name"), frame_id_of(raw_or_null(raw_field(frame, "id"))),
           opt_text_of(raw_field(arguments_of(frame), "query")),
           request_field(raw_field(arguments_of(frame), "request")),
           raw_keys_ok(root_words(), raw_members_of(frame)),
           raw_keys_ok(params_words(), raw_members_of(params_of(frame))),
           arguments_closed_for(tool_input_name(raw_field_text(params_of(frame), "name")), raw_members_of(arguments_of(frame)))}

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

def frame_meta_verdict(tool: Context.CodecTool, id: Context.FrameId, query: Context.OptText, request: Context.OptText, +m: MetaVerdict) -> FrameDecision:
  Bool.pick(FrameDecision, meta_accepted(m), FdOk{tool, id, query, request}, FdRefused{Context.RfValidation{}, meta_text(m)})

def frame_envelope_then_meta(v: EnvelopeVerdict, +m: MetaVerdict) -> FrameDecision:
  match v:
    case EnvAccepted{tool, id, query, request}: frame_meta_verdict(tool, id, query, request, m)
    case EnvRefused{condition}: FdRefused{Context.RfValidation{}, condition}

# The envelope is decided first, then the metadata profile. Only an accepted frame
# with accepted metadata reaches `FdOk`, so metadata is discarded after successful
# validation and never carried into the decision.
def frame_envelope_decision(+env: Envelope, +m: MetaVerdict) -> FrameDecision:
  frame_envelope_then_meta(envelope_decide(env), m)

def frame_decision(+r: EnvelopeRead) -> FrameDecision:
  match r:
    case ErEnvelope{envelope, meta}: frame_envelope_decision(envelope, metadata_admit(meta))
    case ErRefused{condition}: FdRefused{Context.RfValidation{}, condition}

# --- laws ------------------------------------------------------------------

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

# One row per transport line, so a frame's shape is readable and its close count is
# not hand-written.
def rows_of(rows: List<Req.Row>) -> Req.Rows:
  match rows:
    case Nil{}: Req.Rnone{}
    case head <> tail: Req.Rcons{head, rows_of(tail)}


def engine_frame_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_engines"),
    object_row("6", "4", "arguments")])

def query_frame_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "-1"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request"),
    number_row("9", "8", "version", "1")])

# ---------------------------------------------------------------------------
# The retained reference composes into Core's own record and query types. The
# `required` set of a query is the stored selector's projection chain, never the
# request's, so a caller cannot widen its own permissions.

def ss_of_proj(+p: Proj) -> Eng.SS:
  match p:
    case Pnone{}: Eng.ss_empty()
    case Pcons{+head, +tail}: Eng.SSCons{head, ss_of_proj(tail)}

def ref_engine_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{+id, engine, +subject_kind, +subject_text, +snapshot_id, +projections}: engine
    case RdBad{+condition}: SNil{}

def ref_subject_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{+id, +engine, subject_kind, +subject_text, +snapshot_id, +projections}: subject_kind
    case RdBad{+condition}: SNil{}

# The whole selector as retained evidence, so a full object selector is not lost
# when only its kind is admitted on.
def ref_subject_text_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{+id, +engine, +subject_kind, subject_text, +snapshot_id, +projections}: subject_text
    case RdBad{+condition}: SNil{}

def ref_snapshot_of(d: RefDecode) -> String:
  match d:
    case RdNone{}: SNil{}
    case RdRef{+id, +engine, +subject_kind, +subject_text, snapshot_id, +projections}: snapshot_id
    case RdBad{+condition}: SNil{}

def ref_record_of(d: RefDecode, policy: String) -> Refs.RefRecord:
  Refs.Ref{ref_id_of(d), ref_engine_of(d), ref_subject_of(d), ref_subject_text_of(d), ref_snapshot_of(d), policy, ss_of_proj(ref_projections_of(d))}

# The retained selector's operations are authenticated evidence carried beside the
# record, because `RefRecord` does not hold them. Its effects come from Core, not
# from a projection name, and a missing or unknown authority refuses rather than
# being fabricated from the request.
def ref_query_of(+record: Refs.RefRecord, current_policy: String, +operations: Eng.SS, requested: Eng.SS, applicability: Snap.Applies, granted: Eng.SS, fresh: String, known: Bool) -> Refs.RefQuery:
  Refs.RQ{known, Refs.ref_subject_kind(record), Refs.ref_policy(record), current_policy,
          Refs.ref_projections(record), requested, applicability, Eng.effects_union(operations), granted, fresh}

# The stored policy must exist before it can equal the caller's authenticated one,
# so an absent policy refuses as unestablished and is never filled with an invented
# identity. Core owns both the comparison and that refusal.
def ref_known(k: Eng.OpsKnown, +record: Refs.RefRecord, current_policy: String, +operations: Eng.SS, requested: Eng.SS, applicability: Snap.Applies, granted: Eng.SS, fresh: String, known: Bool) -> Refs.RefDecision:
  match k:
    case Eng.OkAllKnown{}: Refs.admit(ref_query_of(record, current_policy, operations, requested, applicability, granted, fresh, known))
    case Eng.OkUnknown{+operation}: Refs.RUnverified{"retainedSelectorOperationUnknown"}

def ref_gate(present: Bool, k: Eng.OpsKnown, +record: Refs.RefRecord, current_policy: String, +operations: Eng.SS, requested: Eng.SS, applicability: Snap.Applies, granted: Eng.SS, fresh: String, known: Bool) -> Refs.RefDecision:
  Bool.pick(Refs.RefDecision, present,
    ref_known(k, record, current_policy, operations, requested, applicability, granted, fresh, known),
    Refs.RUnverified{"retainedSelectorOperationsUnavailable"})

def ref_admit(+record: Refs.RefRecord, current_policy: String, +operations: Eng.SS, requested: Eng.SS, applicability: Snap.Applies, granted: Eng.SS, fresh: String, known: Bool) -> Refs.RefDecision:
  ref_gate(Eng.ss_nonempty(operations), Eng.operations_known(operations), record, current_policy, operations, requested, applicability, granted, fresh, known)

def frame_text(d: FrameDecision) -> String:
  match d:
    case FdOk{tool, id, query, request}: Context.codec_success_text(tool, id, query, request)
    case FdRefused{cls, condition}: Context.refusal_class_name(cls) ++ ":" ++ condition

def frame_refusal(r: FrameRead) -> String:
  match r:
    case FrValue{+value}: SNil{}
    case FrRefused{condition}: condition

def record_probe(subject: String, policy: String, +projections: Eng.SS) -> Refs.RefRecord:
  Refs.Ref{"r1", "typescript", subject, subject, "s1", policy, projections}

def real_row(id: String, parent: String, key: String, token: String) -> Req.Row:
  Req.Row{id, parent, "real", row_hex(key), row_hex(token)}

def null_row(id: String, parent: String, key: String) -> Req.Row:
  Req.Row{id, parent, "null", row_hex(key), SNil{}}

def meta_token_row(id: String, parent: String, kind: String, token: String) -> Req.Row:
  Bool.pick(Req.Row, String.eq(kind, "null"), null_row(id, parent, "progressToken"), real_row(id, parent, "progressToken", token))

# A frame with two defects at once: a refused envelope and a refused metadata
# value. The envelope refusal must win.
def meta_frame_rows(kind: String, token: String) -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_result"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "4", "_meta"),
    meta_token_row("9", "8", kind, token)])

def bad_jsonrpc_meta_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "1.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_result"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "4", "_meta"),
    null_row("9", "8", "progressToken")])

def broken_frame_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "9", "method", "tools/call")])

def bad_field_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    Req.Row{"1", "0", row_hex("text"), "7z", row_hex("v")}])

def bad_utf8_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    Req.Row{"1", "0", row_hex("text"), row_hex("k"), "ff"}])

# A reference that came through the actual decoder composes into Core, and the
# composed admission is exercised on that decoded record rather than on a
# hand-built one.
def decoded_record(id: String, subject: J.Json, policy: String, +projections: J.Json) -> Refs.RefRecord:
  ref_record_of(ref_decode(ref_object_of(ref_members_base(id, subject, projections))), policy)

def ref_members_subject(id: String, subject: J.Json, +projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"subject", subject,
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jnil{}}}}}}

def ref_members_object_subject(id: String, +projections: J.Json) -> J.Json:
  ref_members_subject(id, cobj2("kind", J.Jstr{"entity"}, "name", J.Jstr{"t"}), projections)

def ref_members_string_subject(id: String, +projections: J.Json) -> J.Json:
  ref_members_subject(id, J.Jstr{"symbol"}, projections)

def ref_members_duplicate_subject(id: String, +projections: J.Json) -> J.Json:
  ref_members_subject(id, cobj2("kind", J.Jstr{"entity"}, "kind", J.Jstr{"symbol"}), projections)

# Two otherwise valid five-member records whose only defect is a repeated top-level
# field, once with conflicting values and once with equal values. The check is on the
# key, so both refuse, and `ref_members_subject` without the extra pair is the control.
def ref_members_conflicting_duplicate_id(id: String, +projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{"r0"}, ref_members_subject(id, cobj1("kind", J.Jstr{"symbol"}), projections)}

def ref_members_equal_duplicate_id(id: String, +projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{id}, ref_members_subject(id, cobj1("kind", J.Jstr{"symbol"}), projections)}

def ref_members_kindless_subject(id: String, +projections: J.Json) -> J.Json:
  ref_members_subject(id, cobj1("name", J.Jstr{"t"}), projections)

def ref_members_mystery_subject(id: String, +projections: J.Json) -> J.Json:
  ref_members_subject(id, cobj1("kind", J.Jstr{"mystery"}), projections)

def ref_members_nosubject(+projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{"r9"},
  J.Jpair{"engine", J.Jstr{"typescript"},
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jnil{}}}}}

def ref_members_wrong_engine(+projections: J.Json) -> J.Json:
  J.Jpair{"id", J.Jstr{"r9"},
  J.Jpair{"engine", J.Jint{1},
  J.Jpair{"subject", J.Jstr{"symbol"},
  J.Jpair{"snapshotId", J.Jstr{"s1"},
  J.Jpair{"projections", projections, J.Jnil{}}}}}}

def root_value(r: FrameRead) -> RawValue:
  match r:
    case FrValue{value}: value
    case FrRefused{+condition}: Rnull{}

def sole_member(+m: RawValue) -> String:
  match m:
    case Rpair{+key, +value, +tail}: raw_text_of(value)
    case other: SNil{}

# Values whose bytes are written literally: an astral code point, a decoded NUL and
# a raw surrogate sequence. The demo encoder has no four-byte branch, so these do
# not go through it.
def sole_value(+v: RawValue) -> String:
  match v:
    case Robj{members}: sole_member(members)
    case Rnull{}: SNil{}
    case Rtrue{}: SNil{}
    case Rfalse{}: SNil{}
    case Rnum{+token}: SNil{}
    case Rstr{+value}: SNil{}
    case Rarr{+head, +tail}: SNil{}
    case Rpair{+key, +value, +rest}: SNil{}
    case Rnil{}: SNil{}

def value_row(hex: String) -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    Req.Row{"1", "0", row_hex("text"), row_hex("k"), hex}])

def astral_rows() -> Req.Rows:
  value_row("f09f9880")

def nul_value_rows() -> Req.Rows:
  value_row("610062")

def surrogate_value_rows() -> Req.Rows:
  value_row("eda080")

def extra_root_row() -> Req.Row:
  text_row("9", "0", "extra", "x")

def unknown_root_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    extra_root_row()])

def unknown_params_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_engines"),
    object_row("6", "4", "arguments"),
    text_row("7", "4", "extra", "x")])

def array_row(id: String, parent: String, key: String) -> Req.Row:
  Req.Row{id, parent, "array", row_hex(key), SNil{}}

def nested_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request"),
    text_row("9", "8", "s", "x"),
    array_row("10", "8", "a"),
    number_row("11", "10", "0", "1"),
    number_row("12", "10", "1", "2"),
    object_row("13", "8", "b"),
    null_row("14", "13", "c")])

def empty_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request")])

def text_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    text_row("8", "6", "request", "{}")])

def big_number_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request"),
    real_row("9", "8", "version", "4294967296")])

def empty_array_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request"),
    array_row("9", "8", "a")])

def nested_array_request_rows() -> Req.Rows:
  rows_of([
    object_row("0", SNil{}, SNil{}),
    text_row("1", "0", "jsonrpc", "2.0"),
    text_row("2", "0", "method", "tools/call"),
    number_row("3", "0", "id", "7"),
    object_row("4", "0", "params"),
    text_row("5", "4", "name", "baton2_context_query"),
    object_row("6", "4", "arguments"),
    text_row("7", "6", "query", "q1"),
    object_row("8", "6", "request"),
    array_row("9", "8", "a"),
    array_row("10", "9", "0"),
    number_row("11", "10", "0", "1"),
    array_row("12", "9", "1")])

def main() -> IO(Unit):
  do IO<Unit>:
    z1 : Unit <- IO.print("frame-engines " ++ frame_text(frame_decision(frame_envelope(engine_frame_rows()))))
    z2 : Unit <- IO.print("frame-query " ++ frame_text(frame_decision(frame_envelope(query_frame_rows()))))
    a : Unit <- IO.print("metadata")
    b : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnum{"0.5"}))))
    c : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnum{"1e400"}))))
    d : Unit <- IO.print(meta_text(metadata_validate(meta_one("progressToken", Rnull{}))))
    e : Unit <- IO.print("envelope")
    f : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_engines", Context.IdNumber{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}})))
    g : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_query", Context.IdText{"7"}, Context.Present{"q1"}, RtText{"{\"version\":1}"}, True{}, True{}, True{}})))
    h : Unit <- IO.print(envelope_text(envelope_decide(EnvFrame{"1.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}})))
    i : Unit <- IO.print("dispatch")
    j : Unit <- IO.print(admission_text(dispatch_admission(Request_sample(), "sqlPlan", Context.one_effect(Context.EfPlanTargetSql{}), Context.no_effects())))
    k : Unit <- IO.print(admission_text(dispatch_admission(Request_sample(), "", Context.no_effects(), Context.no_effects())))
    IO.print("end")

law codec_law_absent_metadata_is_admitted:
  {metadata_admit(MetaAbsent{}) == MetaOk{} : MetaVerdict}

def codec_law_absent_metadata_is_admitted():
  {==}

law codec_law_a_present_non_object_metadata_refuses:
  {metadata_admit(MetaPresent{Rarr{Rnil{}, Rnil{}}}) == MetaNotObject{} : MetaVerdict}

def codec_law_a_present_non_object_metadata_refuses():
  {==}

law codec_law_a_present_metadata_still_validates_its_token:
  {metadata_admit(MetaPresent{meta_one("progressToken", Rnum{"1e"})}) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_a_present_metadata_still_validates_its_token():
  {==}

# The request container is a JSON object under the public schema. It is converted
# through the raw-token tree so a number keeps its document token, and its
# canonical text comes from the shared canonical encoder rather than a second
# serializer. A conversion failure carries its own condition.
law codec_law_an_admitted_caller_keeps_its_whole_operation_chain:
  {chain_count(admitted_operations(dispatch_admission(Request_sample(), request_operation_chain(Join_override_sample(), Eng.ss_empty()), Context.two_effects(Context.EfPlanTargetSql{}, Context.EfExecuteTarget{})))) == 2 : U32}

def codec_law_an_admitted_caller_keeps_its_whole_operation_chain():
  {==}

law codec_law_an_admitted_caller_keeps_core_authorized_effects:
  {Eng.ss_member(admitted_effects(dispatch_admission(Request_sample(), request_operation_chain(Join_override_sample(), Eng.ss_empty()), Context.two_effects(Context.EfPlanTargetSql{}, Context.EfExecuteTarget{}))), "executeTarget") == True{} : Bool}

def codec_law_an_admitted_caller_keeps_core_authorized_effects():
  {==}

law codec_law_the_primary_operation_comes_from_the_chain:
  {primary_operation(request_operation_chain(Request_sample(), Eng.ss_empty())) == "sourceAnalysis" : String}

def codec_law_the_primary_operation_comes_from_the_chain():
  {==}

law codec_law_a_model_code_access_chain_carries_both_obligations:
  {chain_second(request_operation_chain(Model_join_sample(), "")) == "codeAccessJoin" : String}

def codec_law_a_model_code_access_chain_carries_both_obligations():
  {==}

law codec_law_a_model_code_access_chain_starts_with_the_load:
  {primary_operation(request_operation_chain(Model_join_sample(), "")) == "modelLoad" : String}

def codec_law_a_model_code_access_chain_starts_with_the_load():
  {==}

law codec_law_the_chain_carries_the_override_after_the_subject:
  {primary_operation(request_operation_chain(Join_override_sample(), Eng.ss_empty())) == "codeAccessJoin" : String}

def codec_law_the_chain_carries_the_override_after_the_subject():
  {==}

law codec_law_the_chain_second_entry_is_the_override:
  {chain_second(request_operation_chain(Join_override_sample(), Eng.ss_empty())) == "toolsProbe" : String}

def codec_law_the_chain_second_entry_is_the_override():
  {==}

law codec_law_an_absent_override_leaves_a_single_entry_chain:
  {chain_count(request_operation_chain(Request_sample(), Eng.ss_empty())) == 1 : U32}

def codec_law_an_absent_override_leaves_a_single_entry_chain():
  {==}

law codec_law_a_runtime_intent_resolves_through_core:
  {primary_operation(request_operation_chain(Runtime_sample(), Eng.ss_empty())) == "runtimeObserve" : String}

def codec_law_a_runtime_intent_resolves_through_core():
  {==}

law codec_law_an_unmapped_runtime_intent_cannot_hide_behind_an_override:
  {codec_dispatch(Unmapped_runtime_override_sample(), Eng.ss_empty(), Context.two_effects(Context.EfExecuteTarget{}, Context.EfControlRuntime{})) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_unmapped_runtime_intent_cannot_hide_behind_an_override():
  {==}

law codec_law_a_ref_without_a_retained_selector_cannot_hide_behind_an_override:
  {codec_dispatch(Ref_override_sample(), Eng.ss_empty(), Context.one_effect(Context.EfExecuteTarget{})) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_a_ref_without_a_retained_selector_cannot_hide_behind_an_override():
  {==}

law codec_law_a_ref_chain_uses_the_retained_selector_operation:
  {primary_operation(request_operation_chain(Ref_override_sample(), Eng.ss_one("sourceAnalysis"))) == "sourceAnalysis" : String}

def codec_law_a_ref_chain_uses_the_retained_selector_operation():
  {==}

law codec_law_an_override_adds_execute_target_without_dropping_a_plan:
  {Eng.admit_operations(chain_ss(request_operation_chain(Join_override_sample(), Eng.ss_empty())), grants_ss(Context.one_effect(Context.EfPlanTargetSql{}))) == Eng.AdMissingEffect{"executeTarget"} : Eng.Admission}

def codec_law_an_override_adds_execute_target_without_dropping_a_plan():
  {==}

law codec_law_a_refused_admission_authorizes_nothing:
  {chain_count(admitted_operations(dispatch_admission(Request_sample(), Opcons{"sqlPlan", Opnone{}}, Context.no_effects()))) == 0 : U32}

def codec_law_a_refused_admission_authorizes_nothing():
  {==}

law codec_law_a_refused_admission_carries_no_effect_union:
  {Eng.ss_member(admitted_effects(dispatch_admission(Request_sample(), Opcons{"sqlPlan", Opnone{}}, Context.no_effects())), "planTargetSql") == False{} : Bool}

def codec_law_a_refused_admission_carries_no_effect_union():
  {==}

law codec_law_an_empty_chain_refuses:
  {dispatch_admission(Request_sample(), Opnone{}, Context.no_effects()) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_empty_chain_refuses():
  {==}

law codec_law_an_unknown_chain_entry_refuses_even_with_every_grant:
  {dispatch_admission(Request_sample(), Opcons{"notAnOperation", Opnone{}}, Context.two_effects(Context.EfExecuteTarget{}, Context.EfControlRuntime{})) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_unknown_chain_entry_refuses_even_with_every_grant():
  {==}

law codec_law_a_missing_grant_refuses_before_dispatch:
  {admission_text(dispatch_admission(Request_sample(), Opcons{"sqlPlan", Opnone{}}, Context.one_effect(Context.EfPlanTargetSql{}))) == "dispatch:sqlPlan:1" : String}

def codec_law_a_missing_grant_refuses_before_dispatch():
  {==}

law codec_law_an_ungranted_plan_refuses:
  {dispatch_admission(Request_sample(), Opcons{"sqlPlan", Opnone{}}, Context.no_effects()) == ARefused{Context.RfValidation{}, "effectNotGranted"} : Admission}

def codec_law_an_ungranted_plan_refuses():
  {==}

law codec_law_a_refused_profile_refuses_before_the_operation_is_consulted:
  {dispatch_admission(RawRefused_sample(), request_operation_chain(Request_sample(), Eng.ss_empty()), Context.no_effects()) == ARefused{Context.RfValidation{}, "requestNotObject"} : Admission}

def codec_law_a_refused_profile_refuses_before_the_operation_is_consulted():
  {==}

law codec_law_an_admitted_grant_free_operation_dispatches:
  {primary_operation(admitted_operations(dispatch_admission(Request_sample(), request_operation_chain(Request_sample(), Eng.ss_empty()), Context.no_effects()))) == "sourceAnalysis" : String}

def codec_law_an_admitted_grant_free_operation_dispatches():
  {==}

law codec_law_tools_and_subject_obligations_both_apply:
  {codec_dispatch(Join_override_sample(), Eng.ss_empty(), Context.one_effect(Context.EfPlanTargetSql{})) == ARefused{Context.RfValidation{}, "effectNotGranted"} : Admission}

def codec_law_tools_and_subject_obligations_both_apply():
  {==}

law codec_law_a_runtime_observe_needs_no_control_grant:
  {primary_operation(admitted_operations(codec_dispatch(Runtime_sample(), Eng.ss_empty(), Context.no_effects()))) == "runtimeObserve" : String}

def codec_law_a_runtime_observe_needs_no_control_grant():
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
  {metadata_validate(meta_one("progressToken", Robj{Rnil{}})) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_metadata_refuses_an_object_progress_token():
  {==}

law codec_law_metadata_refuses_a_malformed_number_token:
  {metadata_validate(meta_one("progressToken", Rnum{"1e"})) == MetaBadProgressToken{} : MetaVerdict}

def codec_law_metadata_refuses_a_malformed_number_token():
  {==}

law codec_law_metadata_refuses_a_non_object:
  {metadata_validate(Rarr{Rnil{}, Rnil{}}) == MetaNotObject{} : MetaVerdict}

def codec_law_metadata_refuses_a_non_object():
  {==}

# ---------------------------------------------------------------------------
# The envelope ordering laws. Each pins that the earlier refusal wins.

law codec_law_a_bad_jsonrpc_refuses_before_the_tool:
  {envelope_decide(EnvFrame{"1.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"invalidJsonrpc"} : EnvelopeVerdict}

def codec_law_a_bad_jsonrpc_refuses_before_the_tool():
  {==}

law codec_law_a_bad_method_refuses_before_the_frame_id:
  {envelope_decide(EnvFrame{"2.0", "tools/list", "context-engines", Context.IdNumber{"9007199254740992"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"invalidMethod"} : EnvelopeVerdict}

def codec_law_a_bad_method_refuses_before_the_frame_id():
  {==}

law codec_law_an_above_bound_frame_id_refuses_before_the_tool:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdNumber{"9007199254740992"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"invalidFrameId"} : EnvelopeVerdict}

def codec_law_an_above_bound_frame_id_refuses_before_the_tool():
  {==}

law codec_law_an_unknown_tool_refuses:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdNumber{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"unknownTool"} : EnvelopeVerdict}

def codec_law_an_unknown_tool_refuses():
  {==}

law codec_law_the_engines_tool_carries_no_query:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_engines", Context.IdNumber{"7"}, Context.Present{"q1"}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_engines_tool_carries_no_query():
  {==}

law codec_law_the_query_tool_needs_a_nonempty_query_id:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_query", Context.IdNumber{"7"}, Context.Present{""}, RtText{"{\"version\":1}"}, True{}, True{}, True{}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_query_tool_needs_a_nonempty_query_id():
  {==}

law codec_law_the_query_tool_needs_a_request:
  {envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_query", Context.IdNumber{"7"}, Context.Present{"q1"}, RtAbsent{}, True{}, True{}, True{}}) == EnvRefused{"invalidArguments"} : EnvelopeVerdict}

def codec_law_the_query_tool_needs_a_request():
  {==}

law codec_law_an_accepted_query_frame_emits_its_success_document:
  {envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_query", Context.IdNumber{"7"}, Context.Present{"q1"}, RtText{"{\"version\":1}"}, True{}, True{}, True{}})) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{\\\"version\\\":1}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_an_accepted_query_frame_emits_its_success_document():
  {==}

# ---------------------------------------------------------------------------
# Retained reference decoding. The fields are the ones context-core's `Refs.Ref`
# carries; the projections text is joined separately so no array crosses this
# boundary.

law codec_law_a_retained_reference_decodes_its_fields:
  {ref_id_of(ref_decode(ref_object_of(ref_members_base("[\"source\",\"/a.ts\"]", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "[\"source\",\"/a.ts\"]" : String}

def codec_law_a_retained_reference_decodes_its_fields():
  {==}

law codec_law_a_retained_reference_keeps_its_projection_chain:
  {ref_projections_of(ref_decode(ref_object_of(ref_members_base("r", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jstr{"definition"}, J.Jarr{J.Jstr{"calls"}, J.Jnil{}}})))) == Pcons{"definition", Pcons{"calls", Pnone{}}} : Proj}

def codec_law_a_retained_reference_keeps_its_projection_chain():
  {==}

law codec_law_a_retained_reference_counts_its_projections:
  {proj_count(ref_projections_of(ref_decode(ref_object_of(ref_members_base("r", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jstr{"definition"}, J.Jarr{J.Jstr{"calls"}, J.Jnil{}}}))))) == 2 : U32}

def codec_law_a_retained_reference_counts_its_projections():
  {==}

law codec_law_a_reference_with_an_unknown_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_extra("r", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "unknownRefField" : String}

def codec_law_a_reference_with_an_unknown_field_refuses():
  {==}

law codec_law_a_reference_with_an_empty_id_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_base("", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_reference_with_an_empty_id_refuses():
  {==}

law codec_law_a_reference_requires_a_string_projection_list:
  {ref_condition(ref_decode(ref_object_of(ref_members_base("r", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jint{1}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_reference_requires_a_string_projection_list():
  {==}

# ---------------------------------------------------------------------------
# The byte-to-envelope conversion. The native entry hands the hex row transport
# `Context.parse_rows` produced; this module rebuilds the frame's raw-token tree
# from the explicit parent identities, then extracts the envelope fields and the
# `_meta` value. A number keeps its document token, so the metadata profile and
# the frame id are decided on the token rather than on a converted value.

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

law codec_law_a_retained_record_composes_into_core:
  {Refs.ref_id(record_probe("symbol", "p1", Eng.ss_one("definition"))) == "r1" : String}

def codec_law_a_retained_record_composes_into_core():
  {==}

law codec_law_a_stored_policy_mismatch_is_refused:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p2", Eng.ss_one("sourceAnalysis"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "refPolicyMismatch" : String}

def codec_law_a_stored_policy_mismatch_is_refused():
  {==}

law codec_law_an_unestablished_policy_is_refused:
  {Refs.condition(ref_admit(record_probe("symbol", "", Eng.ss_one("definition")), "p2", Eng.ss_one("sourceAnalysis"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "refPolicyUnestablished" : String}

def codec_law_an_unestablished_policy_is_refused():
  {==}

law codec_law_a_grant_free_source_expansion_is_allowed:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_one("sourceAnalysis"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "ok" : String}

def codec_law_a_grant_free_source_expansion_is_allowed():
  {==}

law codec_law_a_planning_expansion_without_its_grant_is_refused:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_one("codeAccessJoin"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "effectNotGranted" : String}

def codec_law_a_planning_expansion_without_its_grant_is_refused():
  {==}

law codec_law_a_planning_expansion_with_its_grant_is_allowed:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_one("codeAccessJoin"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_one("planTargetSql"), "fresh", True{})) == "ok" : String}

def codec_law_a_planning_expansion_with_its_grant_is_allowed():
  {==}

law codec_law_a_projection_widening_is_refused:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_one("sourceAnalysis"), Eng.ss_one("calls"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "projectionRefused" : String}

def codec_law_a_projection_widening_is_refused():
  {==}

law codec_law_a_missing_retained_operation_authority_refuses:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_empty(), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "unverifiedReference" : String}

def codec_law_a_missing_retained_operation_authority_refuses():
  {==}

law codec_law_an_unknown_retained_operation_refuses:
  {Refs.condition(ref_admit(record_probe("symbol", "p1", Eng.ss_one("definition")), "p1", Eng.ss_one("notAnOperation"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "unverifiedReference" : String}

def codec_law_an_unknown_retained_operation_refuses():
  {==}

law codec_law_an_unknown_subject_cannot_acquire_ref_authority:
  {codec_dispatch(Unknown_subject_sample(), Eng.ss_one("sourceAnalysis"), Context.no_effects()) == ARefused{Context.RfValidation{}, "unknownOperation"} : Admission}

def codec_law_an_unknown_subject_cannot_acquire_ref_authority():
  {==}

# ---------------------------------------------------------------------------
# Transported-frame laws. These exercise the actual hex row transport through the
# reconstruction, the sibling return and the metadata extraction.

law codec_law_a_transported_engines_frame_is_accepted:
  {frame_text(frame_decision(frame_envelope(engine_frame_rows()))) == "{\"id\":7,\"query\":null,\"requestCanonical\":null,\"tool\":\"context-engines\",\"version\":1}" : String}

def codec_law_a_transported_engines_frame_is_accepted():
  {==}

law codec_law_a_transported_query_frame_keeps_its_numeric_id:
  {frame_text(frame_decision(frame_envelope(query_frame_rows()))) == "{\"id\":-1,\"query\":\"q1\",\"requestCanonical\":\"{\\\"version\\\":1}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_a_transported_query_frame_keeps_its_numeric_id():
  {==}

law codec_law_a_sibling_object_after_a_nested_object_survives:
  {frame_text(frame_decision(frame_envelope(meta_frame_rows("real", "0.5")))) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":null,\"tool\":\"context-result\",\"version\":1}" : String}

def codec_law_a_sibling_object_after_a_nested_object_survives():
  {==}

law codec_law_a_bad_progress_token_after_a_nested_object_refuses:
  {frame_text(frame_decision(frame_envelope(meta_frame_rows("null", "")))) == "validationRefusal:invalidProgressToken" : String}

def codec_law_a_bad_progress_token_after_a_nested_object_refuses():
  {==}

law codec_law_an_envelope_refusal_wins_over_a_metadata_defect:
  {frame_text(frame_decision(frame_envelope(bad_jsonrpc_meta_rows()))) == "validationRefusal:invalidJsonrpc" : String}

def codec_law_an_envelope_refusal_wins_over_a_metadata_defect():
  {==}

law codec_law_a_transported_missing_parent_refuses:
  {frame_refusal(frame_read(broken_frame_rows())) == "missingParentRow" : String}

def codec_law_a_transported_missing_parent_refuses():
  {==}

law codec_law_a_transported_malformed_field_refuses:
  {frame_refusal(frame_read(bad_field_rows())) == "malformedHexField" : String}

def codec_law_a_transported_malformed_field_refuses():
  {==}

law codec_law_a_transported_invalid_utf8_field_refuses:
  {frame_refusal(frame_read(bad_utf8_rows())) == "invalidUtf8Field" : String}

def codec_law_a_transported_invalid_utf8_field_refuses():
  {==}

law codec_law_an_object_subject_selector_decodes_its_kind:
  {ref_subject_of(ref_decode(ref_object_of(ref_members_object_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "entity" : String}

def codec_law_an_object_subject_selector_decodes_its_kind():
  {==}

law codec_law_an_object_subject_selector_keeps_its_evidence:
  {ref_subject_text_of(ref_decode(ref_object_of(ref_members_object_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "{\"kind\":\"entity\",\"name\":\"t\"}" : String}

def codec_law_an_object_subject_selector_keeps_its_evidence():
  {==}

law codec_law_an_object_subject_selector_composes_into_core:
  {Refs.ref_subject_kind(ref_record_of(ref_decode(ref_object_of(ref_members_object_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}))))) == "entity" : String}

def codec_law_an_object_subject_selector_composes_into_core():
  {==}

law codec_law_a_string_selector_is_not_the_supported_retained_form:
  {ref_condition(ref_decode(ref_object_of(ref_members_string_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_string_selector_is_not_the_supported_retained_form():
  {==}

law codec_law_a_duplicate_selector_key_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_duplicate_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_duplicate_selector_key_refuses():
  {==}

law codec_law_a_conflicting_duplicate_ref_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_conflicting_duplicate_id("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "duplicateRefField" : String}

def codec_law_a_conflicting_duplicate_ref_field_refuses():
  {==}

law codec_law_an_equal_duplicate_ref_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_equal_duplicate_id("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "duplicateRefField" : String}

def codec_law_an_equal_duplicate_ref_field_refuses():
  {==}

# The valid control for both refusals above: the duplicate builders' own underlying
# five-member record, with the extra id pair absent, decodes with no condition. The only
# difference from either duplicate case is the repeated key, so the refusals are
# attributable to the duplicate alone rather than to the record shape or its subject kind.
law codec_law_a_wire_reference_with_distinct_fields_decodes:
  {ref_condition(ref_decode(ref_object_of(ref_members_subject("r9", cobj1("kind", J.Jstr{"symbol"}), J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "" : String}

def codec_law_a_wire_reference_with_distinct_fields_decodes():
  {==}

law codec_law_a_public_mcp_name_maps_to_its_native_tool_name:
  {tool_input_name("baton2_context_result") == "context-result" : String}

def codec_law_a_public_mcp_name_maps_to_its_native_tool_name():
  {==}

# A public name is admitted and an internal tool name is not: the internal name decides
# exactly as an unknown name does, so the input vocabulary is the three public names
# while `codec_tool_of` keeps the native vocabulary for internal consumers.
law codec_law_a_public_mcp_query_name_is_an_admitted_input:
  {public_tool_name_ok("baton2_context_query") == True{} : Bool}

def codec_law_a_public_mcp_query_name_is_an_admitted_input():
  {==}

law codec_law_an_internal_tool_name_is_not_an_admitted_input:
  {public_tool_name_ok("context-query") == False{} : Bool}

def codec_law_an_internal_tool_name_is_not_an_admitted_input():
  {==}

law codec_law_an_internal_tool_name_refuses_as_an_unknown_tool:
  {envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "context-query", Context.IdText{"7"}, Context.Present{"q1"}, RtText{"{\"version\":1}"}, True{}, True{}, True{}})) == envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdText{"7"}, Context.Present{"q1"}, RtText{"{\"version\":1}"}, True{}, True{}, True{}})) : String}

def codec_law_an_internal_tool_name_refuses_as_an_unknown_tool():
  {==}

# A name outside both accepted sets falls through the mapping unchanged and is refused
# exactly as an unknown native name is, so the input vocabulary does not widen.
law codec_law_an_unlisted_public_name_refuses_as_an_unknown_tool:
  {envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "baton2_context_other", Context.IdText{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}})) == envelope_text(envelope_decide(EnvFrame{"2.0", "tools/call", "not-a-tool", Context.IdText{"7"}, Context.Absent{}, RtAbsent{}, True{}, True{}, True{}})) : String}

def codec_law_an_unlisted_public_name_refuses_as_an_unknown_tool():
  {==}

law codec_law_a_subject_object_without_a_kind_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_kindless_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_subject_object_without_a_kind_refuses():
  {==}

law codec_law_an_unknown_subject_kind_in_an_object_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_mystery_subject("r9", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_an_unknown_subject_kind_in_an_object_refuses():
  {==}

law codec_law_a_decoded_reference_composes_into_core:
  {Refs.ref_id(decoded_record("r9", cobj1("kind", J.Jstr{"symbol"}), "p1", J.Jarr{J.Jstr{"definition"}, J.Jnil{}})) == "r9" : String}

def codec_law_a_decoded_reference_composes_into_core():
  {==}

law codec_law_a_decoded_reference_is_admitted_for_a_grant_free_expansion:
  {Refs.condition(ref_admit(decoded_record("r9", cobj1("kind", J.Jstr{"symbol"}), "p1", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}), "p1", Eng.ss_one("sourceAnalysis"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "ok" : String}

def codec_law_a_decoded_reference_is_admitted_for_a_grant_free_expansion():
  {==}

law codec_law_a_kind_outside_core_support_is_refused_by_admission:
  {Refs.condition(ref_admit(decoded_record("r9", cobj1("kind", J.Jstr{"ref"}), "p1", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}), "p1", Eng.ss_one("sourceAnalysis"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.ss_empty(), "fresh", True{})) == "subjectRefused" : String}

def codec_law_a_kind_outside_core_support_is_refused_by_admission():
  {==}





law codec_law_a_decoded_reference_with_an_absent_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_nosubject(J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "missingRefField" : String}

def codec_law_a_decoded_reference_with_an_absent_field_refuses():
  {==}

law codec_law_a_decoded_reference_with_a_wrong_type_field_refuses:
  {ref_condition(ref_decode(ref_object_of(ref_members_wrong_engine(J.Jarr{J.Jstr{"definition"}, J.Jnil{}})))) == "invalidRefField" : String}

def codec_law_a_decoded_reference_with_a_wrong_type_field_refuses():
  {==}

# --- closed frame shapes through the actual conversion ----------------------

law codec_law_a_model_ref_keeps_both_retained_operations:
  {chain_second(request_operation_chain(Ref_override_sample(), Eng.ss_two("modelLoad", "codeAccessJoin"))) == "codeAccessJoin" : String}

def codec_law_a_model_ref_keeps_both_retained_operations():
  {==}

law codec_law_a_model_ref_chain_starts_with_its_retained_load:
  {primary_operation(request_operation_chain(Ref_override_sample(), Eng.ss_two("modelLoad", "codeAccessJoin"))) == "modelLoad" : String}

def codec_law_a_model_ref_chain_starts_with_its_retained_load():
  {==}

law codec_law_a_valid_object_request_frame_is_accepted:
  {frame_text(frame_decision(frame_envelope(query_frame_rows()))) == "{\"id\":-1,\"query\":\"q1\",\"requestCanonical\":\"{\\\"version\\\":1}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_a_valid_object_request_frame_is_accepted():
  {==}

law codec_law_an_astral_transported_value_decodes_its_code_point:
  {sole_value(root_value(frame_read(astral_rows()))) == SCon{Char.from_u32(128512), SNil{}} : String}

def codec_law_an_astral_transported_value_decodes_its_code_point():
  {==}

law codec_law_a_transported_nul_value_refuses:
  {frame_refusal(frame_read(nul_value_rows())) == "nulInField" : String}

def codec_law_a_transported_nul_value_refuses():
  {==}

law codec_law_a_transported_surrogate_value_refuses:
  {frame_refusal(frame_read(surrogate_value_rows())) == "surrogateField" : String}

def codec_law_a_transported_surrogate_value_refuses():
  {==}

law codec_law_an_unknown_root_field_refuses:
  {frame_text(frame_decision(frame_envelope(unknown_root_rows()))) == "validationRefusal:unknownFrameField" : String}

def codec_law_an_unknown_root_field_refuses():
  {==}

law codec_law_an_unknown_params_field_refuses:
  {frame_text(frame_decision(frame_envelope(unknown_params_rows()))) == "validationRefusal:unknownParamsField" : String}

def codec_law_an_unknown_params_field_refuses():
  {==}

law codec_law_a_nested_object_request_round_trips_through_the_converter:
  {frame_text(frame_decision(frame_envelope(nested_request_rows()))) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{\\\"a\\\":[1,2],\\\"b\\\":{\\\"c\\\":null},\\\"s\\\":\\\"x\\\"}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_a_nested_object_request_round_trips_through_the_converter():
  {==}

# An array with no elements closes to the canonical empty-array cell. The expected
# canonical text is this module's own oracle and still needs independent review.
law codec_law_an_empty_array_value_round_trips_through_the_frame:
  {frame_text(frame_decision(frame_envelope(empty_array_request_rows()))) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{\\\"a\\\":[]}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_an_empty_array_value_round_trips_through_the_frame():
  {==}

# An array holding an array and an empty array closes to its elements in document
# order, so the accumulated chain is reversed exactly once.
law codec_law_nested_arrays_close_in_document_order:
  {frame_text(frame_decision(frame_envelope(nested_array_request_rows()))) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{\\\"a\\\":[[1],[]]}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_nested_arrays_close_in_document_order():
  {==}

law codec_law_an_empty_object_request_round_trips_through_the_converter:
  {frame_text(frame_decision(frame_envelope(empty_request_rows()))) == "{\"id\":7,\"query\":\"q1\",\"requestCanonical\":\"{}\",\"tool\":\"context-query\",\"version\":1}" : String}

def codec_law_an_empty_object_request_round_trips_through_the_converter():
  {==}

law codec_law_a_non_object_request_refuses:
  {frame_text(frame_decision(frame_envelope(text_request_rows()))) == "validationRefusal:requestNotObject" : String}

def codec_law_a_non_object_request_refuses():
  {==}

law codec_law_a_non_u32_request_number_refuses:
  {frame_text(frame_decision(frame_envelope(big_number_request_rows()))) == "validationRefusal:nonU32NumberInRequest" : String}

def codec_law_a_non_u32_request_number_refuses():
  {==}

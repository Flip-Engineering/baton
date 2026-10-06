# CLAIM: the canonical rendering of the Core composites the common wire carries
# (docs/bend2/semantic-context-spec.md, the version-2 transport paragraph of
# "Installed module contract").
#
# Codec's codec-wire.bend splices the composite members it is handed and does not
# spell this binding, these steps or these captures, so the rendering lives here
# and there is one source for it. Each function below returns a canonical JSON
# value of the existing encoder, so a binding, a plan and a set of captured
# records travel as the same value the identity text already builds from, and the
# readers see one rendering rather than two.
#
# The binding uses the specification's ModuleBinding spelling: id, revision,
# declarationDigest, protocolVersion, operation, artifactIdentities and
# schemaIdentities. The step and capture records have no specification spelling,
# so they use the field names of their declarations in the wire's own style. This
# module reads no payload, compares nothing and asserts no identity: it renders
# values a caller already holds.

import Base
import ../json/canonical.bend as J
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./engines-select.bend as Sel

# --- identity sets and artifact identities -----------------------------------
# An identity set renders as an array of strings, and an artifact identity as an
# object of path, digest and role, with the same array shape the identity text
# already uses.
def ss_json_tail(+xs: SS) -> J.Json:
  match xs:
    case Eng.SSNil{}: J.Jnil{}
    case Eng.SSCons{head, rest}: J.Jarr{J.Jstr{head}, ss_json_tail(rest)}

def ss_json(+xs: SS) -> J.Json:
  match xs:
    case Eng.SSNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Eng.SSCons{head, rest}: J.Jarr{J.Jstr{head}, ss_json_tail(rest)}

def wire_obj(+k: String, +v: J.Json, +rest: J.Json) -> J.Json:
  J.Jpair{k, v, rest}

def art_json(+a: Decl.Art) -> J.Json:
  match a:
    case Decl.Art{path, sha256, role}:
      J.Jobj{wire_obj("path", J.Jstr{path},
             wire_obj("sha256", J.Jstr{sha256},
             wire_obj("role", J.Jstr{role}, J.Jnil{})))}

def arts_json_tail(+a: Decl.Arts) -> J.Json:
  match a:
    case Decl.ArtsNil{}: J.Jnil{}
    case Decl.ArtsCons{head, rest}:
      J.Jarr{art_json(head), arts_json_tail(rest)}

# --- the frozen selected binding ---------------------------------------------
def arts_json(+a: Decl.Arts) -> J.Json:
  match a:
    case Decl.ArtsNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Decl.ArtsCons{head, rest}: J.Jarr{art_json(head), arts_json_tail(rest)}

def exec_token(+e: Decl.Exec) -> String:
  match e:
    case Decl.ExPure{}: "pure"
    case Decl.ExDirect{}: "direct"
    case Decl.ExManaged{}: "managed"
    case Decl.ExRuntime{}: "runtime"

def bind_json(+b: Sel.MBind) -> J.Json:
  match b:
    case Sel.MBind{module_id, revision, declaration_digest, protocol_version,
                   operation, artifacts, schemas}:
      J.Jobj{wire_obj("id", J.Jstr{module_id},
             wire_obj("revision", J.Jstr{revision},
             wire_obj("declarationDigest", J.Jstr{declaration_digest},
             wire_obj("protocolVersion", J.Jstr{protocol_version},
             wire_obj("operation", J.Jstr{operation},
             wire_obj("artifactIdentities", arts_json(artifacts),
             wire_obj("schemaIdentities", ss_json(schemas), J.Jnil{})))))))}

def bind_text(+b: Sel.MBind) -> String:
  J.json_text(bind_json(b))

# --- dependency edges and the plan's steps -----------------------------------
def step_ref_json(+r: Sel.StepRef) -> J.Json:
  match r:
    case Sel.StepRef{module_id, declaration_digest, operation}:
      J.Jobj{wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("declarationDigest", J.Jstr{declaration_digest},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}

def step_refs_json_tail(+rs: Sel.StepRefs) -> J.Json:
  match rs:
    case Sel.StepRefsNil{}: J.Jnil{}
    case Sel.StepRefsCons{head, rest}:
      J.Jarr{step_ref_json(head), step_refs_json_tail(rest)}

def step_refs_json(+rs: Sel.StepRefs) -> J.Json:
  match rs:
    case Sel.StepRefsNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Sel.StepRefsCons{head, rest}:
      J.Jarr{step_ref_json(head), step_refs_json_tail(rest)}

def step_json(+s: Sel.Step) -> J.Json:
  match s:
    case Sel.Step{binding, common, declared_effects, execution, dependencies,
                  result_schema}:
      J.Jobj{wire_obj("binding", bind_json(binding),
             wire_obj("common", J.Jstr{common},
             wire_obj("declaredEffects", ss_json(declared_effects),
             wire_obj("execution", J.Jstr{exec_token(execution)},
             wire_obj("dependencies", step_refs_json(dependencies),
             wire_obj("resultSchema", J.Jstr{result_schema},
                      J.Jnil{}))))))}

def steps_json_tail(+xs: Sel.Steps) -> J.Json:
  match xs:
    case Sel.StepsNil{}: J.Jnil{}
    case Sel.StepsCons{head, rest}:
      J.Jarr{step_json(head), steps_json_tail(rest)}

def steps_json(+xs: Sel.Steps) -> J.Json:
  match xs:
    case Sel.StepsNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Sel.StepsCons{head, rest}: J.Jarr{step_json(head), steps_json_tail(rest)}

def plan_text(+xs: Sel.Steps) -> String:
  J.json_text(steps_json(xs))

# --- admitted captured records -----------------------------------------------
def capture_json(+c: Sel.Capture) -> J.Json:
  match c:
    case Sel.Capture{capture_kind, role, path, marker, payload, payload_encoding,
                     producer_module, producer_digest, producer_operation}:
      J.Jobj{wire_obj("captureKind", J.Jstr{capture_kind},
             wire_obj("role", J.Jstr{role},
             wire_obj("path", J.Jstr{path},
             wire_obj("marker", J.Jstr{marker},
             wire_obj("payload", J.Jstr{payload},
             wire_obj("payloadEncoding", J.Jstr{payload_encoding},
             wire_obj("producerModule", J.Jstr{producer_module},
             wire_obj("producerDigest", J.Jstr{producer_digest},
             wire_obj("producerOperation", J.Jstr{producer_operation},
                      J.Jnil{})))))))))}

def captures_json_tail(+xs: Sel.Captures) -> J.Json:
  match xs:
    case Sel.CapNil{}: J.Jnil{}
    case Sel.CapCons{head, rest}:
      J.Jarr{capture_json(head), captures_json_tail(rest)}

def captures_json(+xs: Sel.Captures) -> J.Json:
  match xs:
    case Sel.CapNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Sel.CapCons{head, rest}:
      J.Jarr{capture_json(head), captures_json_tail(rest)}

def captures_text(+xs: Sel.Captures) -> String:
  J.json_text(captures_json(xs))

# --- the invocation frame's composite members --------------------------------
# The members Codec's invocation_frame takes: the canonical request value, the
# binding, the captured records and the operation plan, each already rendered.
def invocation_members_json(+binding: Sel.MBind, +inputs: Sel.Captures,
                            +plan: Sel.Steps) -> J.Json:
  J.Jobj{wire_obj("moduleBinding", bind_json(binding),
         wire_obj("inputIdentities", captures_json(inputs),
         wire_obj("operationPlan", steps_json(plan), J.Jnil{})))}

def event_members_json(+producer: Sel.MBind) -> J.Json:
  J.Jobj{wire_obj("moduleBinding", bind_json(producer), J.Jnil{})}

# --- the plan identity a caller carries ---------------------------------------
# The frozen members of one plan rendered as one canonical value: the primary
# binding, the common operation, the ordered steps and the effective requirement.
# Availability is observed state rather than plan identity, and the captured
# records travel with the invocation, so neither is part of this value. A caller
# that cannot hold the plan value carries this rendering instead, and a replay
# compares it against the rendering of the plan it retained; because it renders
# the members rather than summarizing them, a changed binding, step, dependency,
# effect or operation changes the identity, and a caller cannot invent one that
# matches.
def plan_identity_json(+p: Sel.Plan) -> J.Json:
  match p:
    case Sel.Plan{primary, common, steps, effective_effects, inputs, available}:
      J.Jobj{wire_obj("primary", bind_json(primary),
             wire_obj("common", J.Jstr{common},
             wire_obj("steps", steps_json(steps),
             wire_obj("effectiveEffects", ss_json(effective_effects),
                      J.Jnil{}))))}

def plan_identity(+p: Sel.Plan) -> String:
  J.json_text(plan_identity_json(p))

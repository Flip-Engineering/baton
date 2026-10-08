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
# schemaIdentities, with each artifact identity carrying packagePath, sha256 and
# role. Its first member is `id`, not `moduleId`: a binding is one module's full
# identity. A dependency edge is a different record and uses `moduleId`, because an
# edge names the module it points at rather than restating a whole binding. The
# step and capture records have no specification spelling, so they use the field
# names of their declarations in the wire's own style. This
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
def ss_json_tail(+xs: Eng.SS) -> J.Json:
  match xs:
    case Eng.SSNil{}: J.Jnil{}
    case Eng.SSCons{head, rest}: J.Jarr{J.Jstr{head}, ss_json_tail(rest)}

def ss_json(+xs: Eng.SS) -> J.Json:
  match xs:
    case Eng.SSNil{}: J.Jarr{J.Jnil{}, J.Jnil{}}
    case Eng.SSCons{head, rest}: J.Jarr{J.Jstr{head}, ss_json_tail(rest)}

def wire_obj(+k: String, +v: J.Json, +rest: J.Json) -> J.Json:
  J.Jpair{k, v, rest}

# The member names are the specification's Artifact spelling for the installed
# module contract, packagePath, sha256 and role, which is what a reader of the
# binding expects.
def art_json(+a: Decl.Art) -> J.Json:
  match a:
    case Decl.Art{path, +sha256, +role}:
      J.Jobj{wire_obj("packagePath", J.Jstr{path},
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
    case Sel.StepRef{module_id, declaration_digest, +operation}:
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

def project_policy_json(+identity: Sel.ProjectPolicyIdentity) -> J.Json:
  match identity:
    case Sel.ProjectPolicyRead{owner, worktree, path, sha256}:
      J.Jobj{wire_obj("kind", J.Jstr{"present"},
        wire_obj("owner", J.Jstr{owner},
        wire_obj("worktree", J.Jstr{worktree},
        wire_obj("path", J.Jstr{path},
        wire_obj("sha256", J.Jstr{sha256}, J.Jnil{})))))}
    case Sel.ProjectPolicyMissing{owner, worktree, path}:
      J.Jobj{wire_obj("kind", J.Jstr{"absent"},
        wire_obj("owner", J.Jstr{owner},
        wire_obj("worktree", J.Jstr{worktree},
        wire_obj("path", J.Jstr{path}, J.Jnil{}))))}

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
# binding, the common operation, the ordered steps, the effective requirement and
# the exact project-policy observation.
# Availability is observed state rather than plan identity, and the captured
# records travel with the invocation, so neither is part of this value.
#
# The rendering is reproducible, and that is all it is: it establishes equality
# between two renderings, not provenance. A caller holding the same public member
# values can reproduce or copy the same text, so equality detects a difference in
# the rendered members and provides no authentication, no custody and no proof of
# prior admission. Retention of that plan, the caller's association with it, replay
# selection and any authority over which plan applies belong to the owner of that
# state and are not established here.
#
# The identity covers the primary binding, the common operation, the steps and the
# effective requirement only. Because it excludes the frozen captured input
# provider-captured input identities and the observed availability, an owner that carries this identity
# alone must retain those input identities separately, through plan_value or its
# own record: equality over this rendering does not carry them.
def plan_identity_json(+p: Sel.Plan) -> J.Json:
  match p:
    case Sel.Plan{+primary, +common, +steps, effective_effects, inputs, available, +policy_identity}:
      J.Jobj{wire_obj("primary", bind_json(primary),
             wire_obj("common", J.Jstr{common},
             wire_obj("steps", steps_json(steps),
             wire_obj("effectiveEffects", ss_json(effective_effects),
             wire_obj("projectPolicy", project_policy_json(policy_identity),
                      J.Jnil{}))))) }

def plan_identity(+p: Sel.Plan) -> String:
  J.json_text(plan_identity_json(p))

# --- the complete value rendering --------------------------------------------
# plan_identity renders the members that decide what will run. This renders every
# member of the plan value instead, including the admitted captured records and the
# observed availability, for a caller that must carry the plan itself rather than
# an identity over its deciding members.
#
# The round-trip rule, stated exactly: the existing encoder is canonical, so the
# rendering is injective over the member values. Equal members render to equal
# text, and any difference in a member renders to different text, which is what
# makes the text usable to compare against a retained value. Core provides no
# parser: reconstruction is the parsing owner's work, and this module neither
# parses its own rendering nor authenticates it.
def bool_json(+b: Bool) -> J.Json:
  Bool.pick(J.Json, b, J.Jtrue{}, J.Jfalse{})

def plan_value_json(+p: Sel.Plan) -> J.Json:
  match p:
    case Sel.Plan{+primary, +common, +steps, effective_effects, +inputs, +available, +policy_identity}:
      J.Jobj{wire_obj("primary", bind_json(primary),
             wire_obj("common", J.Jstr{common},
             wire_obj("steps", steps_json(steps),
             wire_obj("effectiveEffects", ss_json(effective_effects),
             wire_obj("projectPolicy", project_policy_json(policy_identity),
             wire_obj("inputs", captures_json(inputs),
             wire_obj("available", bool_json(available),
                      J.Jnil{})))))))}

def plan_value(+p: Sel.Plan) -> String:
  J.json_text(plan_value_json(p))

# --- the admission decision as a carrier a caller outside this closure holds ---
# Every operand of a refusal is rendered, not summarized into a code: a missing
# artifact keeps its path, a mismatched identity keeps both digests, an ambiguous
# selection keeps its candidate set, an unresolved edge keeps its dependency. The
# kind member names the typed reason itself, so a caller can branch on the same
# names the source declares without Core inventing a numeric code.
#
# Authority is not part of this rendering: it reports the decision Core reached
# from supplied admitted operands, and nothing here authenticates a package, a
# capture or a grant.
def dr_reason_json(+r: Decl.DeclReject) -> J.Json:
  match r:
    case Decl.DrUnsupportedDeclarationVersion{+saw}:
      J.Jobj{wire_obj("kind", J.Jstr{"unsupportedDeclarationVersion"},
             wire_obj("saw", J.Jstr{saw}, J.Jnil{}))}
    case Decl.DrUnsupportedProtocolVersion{+saw}:
      J.Jobj{wire_obj("kind", J.Jstr{"unsupportedProtocolVersion"},
             wire_obj("saw", J.Jstr{saw}, J.Jnil{}))}
    case Decl.DrEmptyId{+what}:
      J.Jobj{wire_obj("kind", J.Jstr{"emptyId"},
             wire_obj("what", J.Jstr{what}, J.Jnil{}))}
    case Decl.DrConflictingId{module_id, package_identity}:
      J.Jobj{wire_obj("kind", J.Jstr{"conflictingId"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("packageIdentity", J.Jstr{package_identity}, J.Jnil{})))}
    case Decl.DrMissingDeclarationDigest{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"missingDeclarationDigest"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}
    case Decl.DrMissingArtifact{module_id, +path}:
      J.Jobj{wire_obj("kind", J.Jstr{"missingArtifact"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("path", J.Jstr{path}, J.Jnil{})))}
    case Decl.DrArtifactMismatch{module_id, +path, +want, +saw}:
      J.Jobj{wire_obj("kind", J.Jstr{"artifactMismatch"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("path", J.Jstr{path},
             wire_obj("want", J.Jstr{want},
             wire_obj("saw", J.Jstr{saw}, J.Jnil{})))))}
    case Decl.DrEmptyEntryVector{}:
      J.Jobj{wire_obj("kind", J.Jstr{"emptyEntryVector"}, J.Jnil{})}
    case Decl.DrMissingSchema{module_id, +operation, +schema}:
      J.Jobj{wire_obj("kind", J.Jstr{"missingSchema"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation},
             wire_obj("schema", J.Jstr{schema}, J.Jnil{}))))}
    case Decl.DrDuplicateOperation{module_id, +operation}:
      J.Jobj{wire_obj("kind", J.Jstr{"duplicateOperation"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}
    case Decl.DrUnknownCommonOperation{module_id, +operation, +common}:
      J.Jobj{wire_obj("kind", J.Jstr{"unknownCommonOperation"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation},
             wire_obj("common", J.Jstr{common}, J.Jnil{}))))}
    case Decl.DrEffectRequiresReview{module_id, +operation, +effect}:
      J.Jobj{wire_obj("kind", J.Jstr{"effectRequiresReview"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation},
             wire_obj("effect", J.Jstr{effect}, J.Jnil{}))))}
    case Decl.DrMissingLifetimeProfile{module_id, +operation}:
      J.Jobj{wire_obj("kind", J.Jstr{"missingLifetimeProfile"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}
    case Decl.DrDependencyUnresolved{module_id, +operation, +dependency}:
      J.Jobj{wire_obj("kind", J.Jstr{"dependencyUnresolved"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation},
             wire_obj("dependency", J.Jstr{dependency}, J.Jnil{}))))}
    case Decl.DrDependencyDigestMismatch{module_id, +dependency, +want, +saw}:
      J.Jobj{wire_obj("kind", J.Jstr{"dependencyDigestMismatch"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("dependency", J.Jstr{dependency},
             wire_obj("want", J.Jstr{want},
             wire_obj("saw", J.Jstr{saw}, J.Jnil{})))))}

def sel_reason_json(+r: Sel.SelReason) -> J.Json:
  match r:
    case Sel.SelUnknownCommonOperation{+common}:
      J.Jobj{wire_obj("kind", J.Jstr{"unknownCommonOperation"},
             wire_obj("common", J.Jstr{common}, J.Jnil{}))}
    case Sel.SelExplicitUnknown{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"explicitUnknown"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}
    case Sel.SelExplicitDisabled{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"explicitDisabled"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}
    case Sel.SelExplicitIncompatible{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"explicitIncompatible"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}
    case Sel.SelExplicitWrongOperation{module_id, +operation}:
      J.Jobj{wire_obj("kind", J.Jstr{"explicitWrongOperation"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}
    case Sel.SelAmbiguous{+candidates}:
      J.Jobj{wire_obj("kind", J.Jstr{"ambiguousSelection"},
             wire_obj("candidates", ss_json(candidates), J.Jnil{}))}
    case Sel.SelNoCandidate{+subject}:
      J.Jobj{wire_obj("kind", J.Jstr{"noCandidate"},
             wire_obj("subject", J.Jstr{subject}, J.Jnil{}))}

def plan_reason_json(+r: Sel.PlanReason) -> J.Json:
  match r:
    case Sel.PlanStaleSelection{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"staleSelection"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}
    case Sel.PlanMissingOperation{module_id, +operation}:
      J.Jobj{wire_obj("kind", J.Jstr{"missingOperation"},
             wire_obj("moduleId", J.Jstr{module_id},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}
    case Sel.PlanDependencyUnresolved{+dependency, +operation}:
      J.Jobj{wire_obj("kind", J.Jstr{"dependencyUnresolved"},
             wire_obj("dependency", J.Jstr{dependency},
             wire_obj("operation", J.Jstr{operation}, J.Jnil{})))}
    case Sel.PlanDependencyDigestMismatch{+dependency, +want, +saw}:
      J.Jobj{wire_obj("kind", J.Jstr{"dependencyDigestMismatch"},
             wire_obj("dependency", J.Jstr{dependency},
             wire_obj("want", J.Jstr{want},
             wire_obj("saw", J.Jstr{saw}, J.Jnil{}))))}
    case Sel.PlanCycle{module_id}:
      J.Jobj{wire_obj("kind", J.Jstr{"cycle"},
             wire_obj("moduleId", J.Jstr{module_id}, J.Jnil{}))}

def rq_reason_json(+r: Sel.RqReason) -> J.Json:
  match r:
    case Sel.RqCatalogRefused{module_id, +reason}:
      J.Jobj{wire_obj("family", J.Jstr{"catalog"},
             wire_obj("reason", dr_reason_json(reason), J.Jnil{}))}
    case Sel.RqSelectionRefused{+reason}:
      J.Jobj{wire_obj("family", J.Jstr{"selection"},
             wire_obj("reason", sel_reason_json(reason), J.Jnil{}))}
    case Sel.RqPlanRefused{+reason}:
      J.Jobj{wire_obj("family", J.Jstr{"plan"},
             wire_obj("reason", plan_reason_json(reason), J.Jnil{}))}

# The full conversion of a decision. An admission carries the complete plan
# rendering, which includes the frozen captured input identities, so a replay can
# compare the same members it admitted with; a refusal carries the stage, the
# derived code and detail, and every operand of its typed reason.
def decision_outcome_json(+d: Sel.AdmissionDecision) -> J.Json:
  match d:
    case Sel.AdmissionAdmits{+plan, result_schema}:
      J.Jobj{wire_obj("kind", J.Jstr{"admit"},
             wire_obj("plan", plan_value_json(plan),
             wire_obj("resultSchema", J.Jstr{result_schema}, J.Jnil{})))}
    case Sel.AdmissionRefuses{+stage, +code, +detail, +reason}:
      J.Jobj{wire_obj("kind", J.Jstr{"refuse"},
             wire_obj("stage", J.Jstr{stage},
             wire_obj("code", J.Jstr{code},
             wire_obj("detail", J.Jstr{detail},
             wire_obj("reason", rq_reason_json(reason), J.Jnil{})))))}

def decision_outcome(+d: Sel.AdmissionDecision) -> String:
  J.json_text(decision_outcome_json(d))

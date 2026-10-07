# CLAIM: deterministic selection over admitted typed descriptions, the frozen
# selected binding and the effective requirement of one dependency plan
# (docs/bend2/semantic-context-spec.md, "Installed module contract": the
# applicability, automatic-selection, effect-minimum and activation-binding
# paragraphs).
#
# Selection reads admitted descriptions, a supplied project fact set and the
# configured enabled/preference state. It loads no project code, executes no
# provider and starts no debuggee. An explicit selector chooses one declared
# module and refuses an unknown, disabled, inapplicable or wrong-operation
# module. Auto selects only a unique compatible candidate after the configured
# preference is applied, and a tie returns its candidates through the ordinary
# refusal instead of picking a winner.
#
# Availability never participates in the choice: a candidate whose selected
# bytes are absent is still the chosen binding, and the plan records it as
# unavailable rather than silently selecting a different implementation.
#
# Freezing compares the recorded declaration digest with the one the inventory
# admits now, so a replay or an expansion that meets a changed same-name module
# refuses rather than substituting it. Both digests are supplied admitted
# inventory data: this module authenticates no bytes, establishes no custody and
# reads no artifact, capture, connection or lifetime fact. Those are supplied by
# their owners, and a plan is never a publication. The plan then resolves dependency edges
# by module and digest, refuses a cycle, and computes the common operation's
# mandatory effect minimum union the declared additions across every step, which
# is why an operation declaring an empty effect set cannot erase that minimum.
#
# Mutual recursion is refused by this dialect, so each walk below is one
# self-recursive definition and every helper it calls is acyclic.

import Base
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./snapshot.bend as Snap

# --- candidates --------------------------------------------------------------
# One declared operation of one admitted module, with the configured state
# already resolved against it. `available` records whether the selected bytes
# and their verified closure are present; it is not a filter.
type Cand is Data:
  Cand{module_id: String, declaration_digest: String, operation: String,
       common: String, declared_effects: Eng.SS, execution: Decl.Exec,
       available: Bool, preferred: Bool}

type Cands is Data:
  CandsNil{}
  CandsCons{head: Cand, rest: Cands}

def cand_module(+cand: Cand) -> String:
  match cand:
    case Cand{module_id, declaration_digest, operation, common,
              declared_effects, execution, available, preferred}:
      module_id

def cand_digest(+cand: Cand) -> String:
  match cand:
    case Cand{module_id, declaration_digest, operation, common,
              declared_effects, execution, available, preferred}:
      declaration_digest

def cand_operation(+cand: Cand) -> String:
  match cand:
    case Cand{module_id, declaration_digest, operation, common,
              declared_effects, execution, available, preferred}:
      operation

def cand_common(+cand: Cand) -> String:
  match cand:
    case Cand{module_id, declaration_digest, operation, common,
              declared_effects, execution, available, preferred}:
      common

def cand_available(+cand: Cand) -> Bool:
  match cand:
    case Cand{module_id, declaration_digest, operation, common,
              declared_effects, execution, available, preferred}:
      available

def cands_append(+xs: Cands, +add: Cands) -> Cands:
  match xs:
    case CandsNil{}: add
    case CandsCons{h, r}: CandsCons{h, cands_append(r, add)}

def cands_nonempty(xs: Cands) -> Bool:
  match xs:
    case CandsNil{}: False{}
    case CandsCons{h, r}: True{}

def cands_empty(xs: Cands) -> Bool:
  match xs:
    case CandsNil{}: True{}
    case CandsCons{h, r}: False{}

# Exactly one element. A tie is read through this predicate, so the choice never
# depends on chain order.
def cands_singular(xs: Cands) -> Bool:
  match xs:
    case CandsNil{}: False{}
    case CandsCons{h, r}: cands_empty(r)

# The module identifiers of a candidate chain, in chain order. The accumulator
# appends each identifier after the ones already recorded, so a refusal reports
# the candidates in the order the admitted catalog supplies them.
def cand_ids_go(+xs: Cands, +acc: Eng.SS) -> Eng.SS:
  match xs:
    case CandsNil{}: acc
    case CandsCons{h, r}:
      cand_ids_go(r, Eng.union_add(Eng.ss_one(cand_module(h)), acc))

def cand_ids(xs: Cands) -> Eng.SS:
  cand_ids_go(xs, Eng.ss_empty())

# --- selection inputs --------------------------------------------------------
# The recorded selection inputs: the admitted project facts, the installed and
# configured module state, the explicit selector when a request carries one, and
# the common operation the request asks for.

# --- the separated inputs a selection assembles ------------------------------
# Request-derived operands come from the decoded canonical request. `subject` is
# the request subject's kind string, which is what a declarative applicability rule
# compares against; a coordinate such as a path or a line stays in the canonical
# request and reaches a rule through the project facts instead, since paths and
# manifests are matched by their own rule kinds. `projections` is the request's
# select array of strings, `explicit` is the request's engine member with the empty
# string standing for auto, and `common` is not a request member: it is the common
# operation the subject kind and intent imply through the existing Eng mappings,
# which a declaration ties to its own operation ids through Op.implements_operation.
#
# The
# project state comes from owner-supplied configuration, inventory and
# observation: the examined paths and manifests, and the installed, disabled and
# preferred module sets. They stay separate, so a configured or observed fact
# never enters as request authority and a request cannot present installed or
# disabled state as its own, and `sel_inputs` is the one place that assembles
# them.
type RequestOperands is Data:
  RequestOperands{subject: String, projections: Eng.SS, explicit: String,
                  common: String}

type ProjectState is Data:
  ProjectState{paths: Eng.SS, manifests: Eng.SS, installed: Eng.SS, disabled: Eng.SS,
               preferred: Eng.SS}

def req_subject(+r: RequestOperands) -> String:
  match r:
    case RequestOperands{subject, projections, explicit, common}: subject

def req_projections(+r: RequestOperands) -> Eng.SS:
  match r:
    case RequestOperands{subject, projections, explicit, common}: projections

def req_explicit(+r: RequestOperands) -> String:
  match r:
    case RequestOperands{subject, projections, explicit, common}: explicit

def req_common(+r: RequestOperands) -> String:
  match r:
    case RequestOperands{subject, projections, explicit, common}: common

def proj_paths(+p: ProjectState) -> Eng.SS:
  match p:
    case ProjectState{paths, manifests, installed, disabled, preferred}: paths

def proj_manifests(+p: ProjectState) -> Eng.SS:
  match p:
    case ProjectState{paths, manifests, installed, disabled, preferred}:
      manifests

def proj_installed(+p: ProjectState) -> Eng.SS:
  match p:
    case ProjectState{paths, manifests, installed, disabled, preferred}:
      installed

def proj_disabled(+p: ProjectState) -> Eng.SS:
  match p:
    case ProjectState{paths, manifests, installed, disabled, preferred}:
      disabled

def proj_preferred(+p: ProjectState) -> Eng.SS:
  match p:
    case ProjectState{paths, manifests, installed, disabled, preferred}:
      preferred

# The assembled selection inputs. A caller reaches this only through sel_inputs,
# which takes the two separated operands.
type SelInputs is Data:
  SelInputs{request: RequestOperands, project: ProjectState}

def sel_inputs(+r: RequestOperands, +p: ProjectState) -> SelInputs:
  SelInputs{r, p}

def inputs_request(+inputs: SelInputs) -> RequestOperands:
  match inputs:
    case SelInputs{request, project}: request

def inputs_project(+inputs: SelInputs) -> ProjectState:
  match inputs:
    case SelInputs{request, project}: project

def decl_enabled(+decl: Decl.Decl, +inputs: SelInputs) -> Bool:
  Bool.not(Eng.ss_member(proj_disabled(inputs_project(inputs)),
                         Decl.decl_module_id(decl)))

def decl_preferred(+decl: Decl.Decl, +inputs: SelInputs) -> Bool:
  Eng.ss_member(proj_preferred(inputs_project(inputs)),
                Decl.decl_module_id(decl))

def decl_installed(+decl: Decl.Decl, +inputs: SelInputs) -> Bool:
  Eng.ss_member(proj_installed(inputs_project(inputs)),
                Decl.decl_module_id(decl))

def decl_applicable(+decl: Decl.Decl, +inputs: SelInputs) -> Bool:
  Decl.rules_hold(Decl.decl_applicability(decl),
                  proj_paths(inputs_project(inputs)),
                  proj_manifests(inputs_project(inputs)),
                  req_subject(inputs_request(inputs)),
                  req_projections(inputs_request(inputs)))

def subject_of(+inputs: SelInputs) -> String:
  req_subject(inputs_request(inputs))

def explicit_of(+inputs: SelInputs) -> String:
  req_explicit(inputs_request(inputs))

def common_of(+inputs: SelInputs) -> String:
  req_common(inputs_request(inputs))

def digests_of(+inv: Decl.Inv) -> Decl.Digs:
  match inv:
    case Decl.Inv{artifacts, schemas, digests}:
      digests

def digest_at(+inv: Decl.Inv, +module_id: String) -> String:
  Decl.digest_of(digests_of(inv), module_id)

# --- candidate derivation ----------------------------------------------------
def cand_of(+decl: Decl.Decl, +op: Decl.Op, +digest: String, +available: Bool,
            +preferred: Bool) -> Cand:
  Cand{Decl.decl_module_id(decl), digest, Decl.op_operation(op),
       Decl.op_common(op), Decl.op_effects(op), Decl.op_execution(op),
       available, preferred}

def cand_of_op(+decl: Decl.Decl, +op: Decl.Op, +digest: String,
               +available: Bool, +preferred: Bool, +common: String) -> Cands:
  Bool.pick(Cands, String.eq(Decl.op_common(op), common),
            CandsCons{cand_of(decl, op, digest, available, preferred),
                      CandsNil{}},
            CandsNil{})

def cands_of_ops(+decl: Decl.Decl, +ops: Decl.Ops, +digest: String,
                 +available: Bool, +preferred: Bool, +common: String) -> Cands:
  match ops:
    case Decl.OpsNil{}: CandsNil{}
    case Decl.OpsCons{head, rest}:
      cands_append(
        cand_of_op(decl, head, digest, available, preferred, common),
        cands_of_ops(decl, rest, digest, available, preferred, common))

# A declaration contributes candidates only when it is enabled and applicable.
def cands_of_decl(+decl: Decl.Decl, +inputs: SelInputs, +inv: Decl.Inv,
                  +preferred: Bool, +common: String) -> Cands:
  Bool.pick(Cands, decl_enabled(decl, inputs),
    Bool.pick(Cands, decl_applicable(decl, inputs),
      cands_of_ops(decl, Decl.decl_operations(decl),
                   digest_at(inv, Decl.decl_module_id(decl)),
                   decl_installed(decl, inputs), preferred, common),
      CandsNil{}),
    CandsNil{})

def cands_of_catalog(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                     +preferred: Bool, +common: String) -> Cands:
  match cat:
    case Decl.CatNil{}: CandsNil{}
    case Decl.CatCons{head, rest}:
      cands_append(cands_of_decl(head, inputs, inv, preferred, common),
                   cands_of_catalog(rest, inputs, inv, preferred, common))

def preferred_cands(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                    +common: String) -> Cands:
  cands_of_catalog(cat, inputs, inv, True{}, common)

def ordinary_cands(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                   +common: String) -> Cands:
  cands_of_catalog(cat, inputs, inv, False{}, common)

# --- the explicit selector's state -------------------------------------------
# The explicit selector's answer before it becomes an outcome: a module with the
# selected id is absent, disabled, inapplicable, without a matching operation,
# or present with one.
type ExState is Data:
  ExAbsent{}
  ExDisabled{}
  ExIncompatible{}
  ExWrongOperation{}
  ExPresent{cand: Cand}

def ex_present_of(+decl: Decl.Decl, +ops: Decl.Ops, +inputs: SelInputs,
                  +inv: Decl.Inv, +common: String) -> ExState:
  match ops:
    case Decl.OpsNil{}: ExWrongOperation{}
    case Decl.OpsCons{+head, rest}:
      Bool.pick(ExState, String.eq(Decl.op_common(head), common),
                ExPresent{cand_of(decl, head,
                                  digest_at(inv, Decl.decl_module_id(decl)),
                                  decl_installed(decl, inputs),
                                  decl_preferred(decl, inputs))},
                ex_present_of(decl, rest, inputs, inv, common))

def ex_found(+decl: Decl.Decl, +inputs: SelInputs, +inv: Decl.Inv,
             +common: String) -> ExState:
  Bool.pick(ExState, decl_applicable(decl, inputs),
            ex_present_of(decl, Decl.decl_operations(decl), inputs, inv, common),
            ExIncompatible{})

def ex_state(+decl: Decl.Decl, +inputs: SelInputs, +inv: Decl.Inv,
             +common: String) -> ExState:
  Bool.pick(ExState, decl_enabled(decl, inputs),
            ex_found(decl, inputs, inv, common),
            ExDisabled{})

def explicit_state(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                   +explicit: String, +common: String) -> ExState:
  match cat:
    case Decl.CatNil{}: ExAbsent{}
    case Decl.CatCons{+head, rest}:
      Bool.pick(ExState, String.eq(Decl.decl_module_id(head), explicit),
                ex_state(head, inputs, inv, common),
                explicit_state(rest, inputs, inv, explicit, common))

# --- selection outcomes ------------------------------------------------------
type SelReason is Data:
  SelUnknownCommonOperation{common: String}
  SelExplicitUnknown{module_id: String}
  SelExplicitDisabled{module_id: String}
  SelExplicitIncompatible{module_id: String}
  SelExplicitWrongOperation{module_id: String, operation: String}
  SelAmbiguous{candidates: Eng.SS}
  SelNoCandidate{subject: String}

type SelOutcome is Data:
  SelChosen{candidates: Eng.SS, chosen: Cand}
  SelRefused{reason: SelReason}

def sel_explicit_state(+s: ExState, +explicit: String,
                       +common: String) -> SelOutcome:
  match s:
    case ExAbsent{}: SelRefused{SelExplicitUnknown{explicit}}
    case ExDisabled{}: SelRefused{SelExplicitDisabled{explicit}}
    case ExIncompatible{}: SelRefused{SelExplicitIncompatible{explicit}}
    case ExWrongOperation{}:
      SelRefused{SelExplicitWrongOperation{explicit, common}}
    case ExPresent{cand}:
      SelChosen{Eng.ss_one(explicit), cand}

# A singular chain selects its only member; an empty chain refuses; anything
# longer is the explicit ambiguity the specification requires.
def sel_only(+cs: Cands, +subject: String) -> SelOutcome:
  match cs:
    case CandsNil{}: SelRefused{SelNoCandidate{subject}}
    case CandsCons{h, r}: SelChosen{cand_ids(cs), h}

# A singular candidate chain selects its only member, an empty one refuses, and
# anything longer is the explicit ambiguity the specification requires. The chain
# is bound once with the duplication annotation, so the derivation runs once per
# call and the refusal names the candidates it considered.
def sel_ordinary(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                 +subject: String, +common: String) -> SelOutcome:
  +ord = ordinary_cands(cat, inputs, inv, common)
  Bool.pick(SelOutcome, cands_singular(ord), sel_only(ord, subject),
    Bool.pick(SelOutcome, cands_nonempty(ord),
              SelRefused{SelAmbiguous{cand_ids(ord)}},
              SelRefused{SelNoCandidate{subject}}))

# The configured preference is applied first: a unique preferred candidate wins,
# several preferred candidates are the ambiguity, and with none preferred the
# ordinary candidates decide.
def sel_preferred(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                  +subject: String, +common: String) -> SelOutcome:
  +pref = preferred_cands(cat, inputs, inv, common)
  Bool.pick(SelOutcome, cands_singular(pref), sel_only(pref, subject),
    Bool.pick(SelOutcome, cands_nonempty(pref),
              SelRefused{SelAmbiguous{cand_ids(pref)}},
              sel_ordinary(cat, inputs, inv, subject, common)))

def select_known(+known: Bool, +cat: Decl.Cat, +inputs: SelInputs,
                 +inv: Decl.Inv, +subject: String, +explicit: String,
                 +common: String) -> SelOutcome:
  Bool.pick(SelOutcome, known,
    Bool.pick(SelOutcome, String.is_empty(explicit),
              sel_preferred(cat, inputs, inv, subject, common),
              sel_explicit_state(
                explicit_state(cat, inputs, inv, explicit, common), explicit,
                common)),
    SelRefused{SelUnknownCommonOperation{common}})

# One entry point. A request names its common operation and, when a caller
# selected one explicitly, the module; auto records the inputs and the
# applicable candidates beside the chosen binding.
def select(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv) -> SelOutcome:
  select_known(Eng.operation_known(common_of(inputs)), cat, inputs, inv,
               subject_of(inputs), explicit_of(inputs), common_of(inputs))

# --- frozen carriers ---------------------------------------------------------
# The immutable binding one selected step is served under: the module, the
# declaration digest it was admitted at, the protocol version, the operation and
# the artifact and schema identities frozen with it.
type MBind is Data:
  MBind{module_id: String, revision: String, declaration_digest: String,
        protocol_version: String, operation: String, artifacts: Decl.Arts,
        schemas: Eng.SS}

# A dependency edge of a frozen step, carrying its producer identity.
type StepRef is Data:
  StepRef{module_id: String, declaration_digest: String, operation: String}

type StepRefs is Data:
  StepRefsNil{}
  StepRefsCons{head: StepRef, rest: StepRefs}

type Step is Data:
  Step{binding: MBind, common: String, declared_effects: Eng.SS,
       execution: Decl.Exec, dependencies: StepRefs, result_schema: String}

type Steps is Data:
  StepsNil{}
  StepsCons{head: Step, rest: Steps}

# --- admitted captured records ----------------------------------------------
# One admitted captured record: the identity of a captured input, the exact
# captured text, and the step that produced it. A label alone is not a captured
# record, and a record without its producing step cannot be attributed. The
# payload is opaque here: it is the captured bytes or value as its owner recorded
# them, carried through without parsing.
# The records are supplied admitted values. This module does not authenticate
# their provenance, does not read the payload beyond carrying it and establishes no
# custody: the producer of an admitted capture is the provider step that recorded
# it, and the typed payload schema of a captured record belongs to that producer
# and to Codec. A caller holding no admitted capture passes CapNil{}, and the plan
# then records no captured input rather than a fabricated one.
# `capture_kind` names the input kind in snapshot's vocabulary: file, absent,
# dir, link or config. `payload` carries the exact accepted bytes in the named
# `payload_encoding`, so a byte order mark, a carriage return or a byte sequence
# that is not valid UTF-8 travels without re-encoding. This module neither decodes
# nor verifies the encoding: it carries the field, and the producer that owns those
# bytes owes the round trip and refuses on its own side when no encoding reproduces
# them. `marker` is the
# digest-bearing component exactly as snapshot's fp_marker defines it: the content
# digest for a file, directory or configuration input, the resolved target for a
# link, and the literal "absent" for an absent input. It is not the expected
# declaration digest. `path` is the canonical admitted path the capture recorded;
# a producer that resolves an alias or a relative specifier records that
# resolution and Core compares the recorded path verbatim.
type Capture is Data:
  Capture{capture_kind: String, role: String, path: String, marker: String,
          payload: String, payload_encoding: String, producer_module: String,
          producer_digest: String, producer_operation: String}

type Captures is Data:
  CapNil{}
  CapCons{head: Capture, rest: Captures}

def cap_kind(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      capture_kind

def cap_encoding(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      payload_encoding

def cap_role(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      role

def cap_path(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      path

# The digest-bearing component of one captured input, in snapshot's own sense:
# the content digest for a file, directory or configuration input, the resolved
# target for a link, and the literal "absent" for an absent input.
def cap_marker(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      marker

def cap_payload(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      payload

def cap_producer_module(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      producer_module

def cap_producer_digest(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      producer_digest

def cap_producer_operation(+c: Capture) -> String:
  match c:
    case Capture{capture_kind, role, path, marker, payload, payload_encoding,
                 producer_module, producer_digest, producer_operation}:
      producer_operation

# The admitted identity of one captured record, in snapshot's own vocabulary, so
# a producer closure and the identity text key on the same value. An unknown kind
# is named rather than coerced to another kind.
type FcState is Data:
  FcMapped{fp: Snap.Fp}
  FcUnknownKind{kind: String}

def capture_fp_kind(+kind: String, +c: Capture) -> FcState:
  Bool.pick(FcState, String.eq(kind, "file"),
    FcMapped{Snap.FpFile{cap_role(c), cap_path(c), cap_marker(c)}},
  Bool.pick(FcState, String.eq(kind, "absent"),
    FcMapped{Snap.FpAbsent{cap_role(c), cap_path(c)}},
  Bool.pick(FcState, String.eq(kind, "dir"),
    FcMapped{Snap.FpDir{cap_role(c), cap_path(c), cap_marker(c)}},
  Bool.pick(FcState, String.eq(kind, "link"),
    FcMapped{Snap.FpLink{cap_role(c), cap_path(c), cap_marker(c)}},
  Bool.pick(FcState, String.eq(kind, "config"),
    FcMapped{Snap.FpConfig{cap_role(c), cap_path(c), cap_marker(c)}},
    FcUnknownKind{kind})))))

def capture_fp(+c: Capture) -> FcState:
  capture_fp_kind(cap_kind(c), c)

def captures_nonempty(xs: Captures) -> Bool:
  match xs:
    case CapNil{}: False{}
    case CapCons{head, rest}: True{}

type Plan is Data:
  Plan{primary: MBind, common: String, steps: Steps, effective_effects: Eng.SS,
       inputs: Captures, available: Bool}

type PlanReason is Data:
  PlanStaleSelection{module_id: String}
  PlanMissingOperation{module_id: String, operation: String}
  PlanDependencyUnresolved{dependency: String, operation: String}
  PlanDependencyDigestMismatch{dependency: String, want: String, saw: String}
  PlanCycle{module_id: String}

type PlanOutcome is Data:
  PlanFrozen{plan: Plan}
  PlanRefused{reason: PlanReason}

# The first refusal in a plan walk is retained, so a later edge's condition
# cannot replace the reported reason.
type PlanFail is Data:
  PfNone{}
  PfAt{reason: PlanReason}

def plan_fail_first(+fail: PlanFail, +candidate: PlanFail) -> PlanFail:
  match fail:
    case PfAt{r}: fail
    case PfNone{}: candidate

def steps_append(+xs: Steps, +add: Steps) -> Steps:
  match xs:
    case StepsNil{}: add
    case StepsCons{h, r}: StepsCons{h, steps_append(r, add)}

def step_refs(+edges: Decl.ModRefs) -> StepRefs:
  match edges:
    case Decl.ModRefsNil{}: StepRefsNil{}
    case Decl.ModRefsCons{h, r}:
      match h:
        case Decl.ModRef{module_id, declaration_digest, operation}:
          StepRefsCons{StepRef{module_id, declaration_digest, operation},
                       step_refs(r)}

def binding_of(+decl: Decl.Decl, +op: Decl.Op, +digest: String) -> MBind:
  MBind{Decl.decl_module_id(decl), Decl.decl_revision(decl), digest,
        Decl.decl_protocol_version(decl), Decl.op_operation(op),
        Decl.decl_binding_artifacts(decl), Decl.op_schema_set(op)}

def step_of(+decl: Decl.Decl, +op: Decl.Op, +digest: String) -> Step:
  Step{binding_of(decl, op, digest), Decl.op_common(op), Decl.op_effects(op),
       Decl.op_execution(op), step_refs(Decl.op_dependencies(op)),
       Decl.op_result_schema(op)}

def step_result_schema(+step: Step) -> String:
  match step:
    case Step{binding, common, declared_effects, execution, dependencies,
              result_schema}:
      result_schema

# --- catalog and operation lookup --------------------------------------------
# A lookup answers with the declaration the record names, or with the fact that
# the candidate set does not hold that module, or that it holds the module at a
# different declaration digest. The last case is the changed same-name module
# that must refuse rather than substitute.
type MatchState is Data:
  MsNone{}
  MsStale{}
  MsFound{decl: Decl.Decl}

def match_catalog(+cat: Decl.Cat, +inv: Decl.Inv, +module_id: String,
                  +want_digest: String) -> MatchState:
  match cat:
    case Decl.CatNil{}: MsNone{}
    case Decl.CatCons{+head, rest}:
      Bool.pick(MatchState, String.eq(Decl.decl_module_id(head), module_id),
        Bool.pick(MatchState, String.eq(digest_at(inv, module_id), want_digest),
                  MsFound{head}, MsStale{}),
        match_catalog(rest, inv, module_id, want_digest))

type OpState is Data:
  OpNone{}
  OpFound{op: Decl.Op}

def ops_lookup(+ops: Decl.Ops, +want: String) -> OpState:
  match ops:
    case Decl.OpsNil{}: OpNone{}
    case Decl.OpsCons{+head, rest}:
      Bool.pick(OpState, String.eq(Decl.op_operation(head), want),
                OpFound{head}, ops_lookup(rest, want))

# --- the dependency walk -----------------------------------------------------
# One pending step carries the operation it expands and the ancestor path of the
# branch that reached it, so a repeated step is a cycle while a diamond is
# ordinary reuse.
type Pending is Data:
  Pending{decl: Decl.Decl, op: Decl.Op, digest: String, path: Eng.SS}

type Pendings is Data:
  PendsNil{}
  PendsCons{head: Pending, rest: Pendings}

def pending_decl(+p: Pending) -> Decl.Decl:
  match p:
    case Pending{decl, op, digest, path}: decl

def pending_op(+p: Pending) -> Decl.Op:
  match p:
    case Pending{decl, op, digest, path}: op

def pending_digest(+p: Pending) -> String:
  match p:
    case Pending{decl, op, digest, path}: digest

def pending_path(+p: Pending) -> Eng.SS:
  match p:
    case Pending{decl, op, digest, path}: path

def pending_module(+p: Pending) -> String:
  match p:
    case Pending{decl, op, digest, path}: Decl.decl_module_id(decl)

# The composite key an ancestor path records: the module and the operation
# joined by a separator, so one module serving two operations is not a cycle.
def pending_step_key(+p: Pending) -> String:
  match p:
    case Pending{decl, op, digest, path}:
      String.append(String.append(Decl.decl_module_id(decl), "/"),
                    Decl.op_operation(op))

def pendings_append(+xs: Pendings, +add: Pendings) -> Pendings:
  match xs:
    case PendsNil{}: add
    case PendsCons{h, r}: PendsCons{h, pendings_append(r, add)}

# The edges one pending step resolves to, with the first resolution failure.
type Resolved is Data:
  Resolved{pending: Pendings, failure: PlanFail}

def resolved_pending_of(+r: Resolved) -> Pendings:
  match r:
    case Resolved{pending, failure}: pending

def resolved_failure_of(+r: Resolved) -> PlanFail:
  match r:
    case Resolved{pending, failure}: failure

# The step one edge resolves to, or none. A computed lookup answer cannot be a
# match scrutinee, so the two scans below answer the value and the reason
# separately; both read the same admitted inputs and cannot disagree.
def ops_pending(+decl: Decl.Decl, +ops: Decl.Ops, +want: String,
                +digest: String, +path: Eng.SS) -> Pendings:
  match ops:
    case Decl.OpsNil{}: PendsNil{}
    case Decl.OpsCons{+head, rest}:
      Bool.pick(Pendings, String.eq(Decl.op_operation(head), want),
                PendsCons{Pending{decl, head, digest, path}, PendsNil{}},
                ops_pending(decl, rest, want, digest, path))

def decl_pending(+cat: Decl.Cat, +inv: Decl.Inv, +module_id: String,
                 +want_digest: String, +want: String, +path: Eng.SS) -> Pendings:
  match cat:
    case Decl.CatNil{}: PendsNil{}
    case Decl.CatCons{+head, rest}:
      Bool.pick(Pendings, String.eq(Decl.decl_module_id(head), module_id),
        Bool.pick(Pendings, String.eq(digest_at(inv, module_id), want_digest),
                  ops_pending(head, Decl.decl_operations(head), want,
                              want_digest, path),
                  PendsNil{}),
        decl_pending(rest, inv, module_id, want_digest, want, path))

def decl_known(+cat: Decl.Cat, +module_id: String) -> Bool:
  match cat:
    case Decl.CatNil{}: False{}
    case Decl.CatCons{head, rest}:
      Bool.pick(Bool, String.eq(Decl.decl_module_id(head), module_id), True{},
                decl_known(rest, module_id))

def ops_known(+ops: Decl.Ops, +want: String) -> Bool:
  match ops:
    case Decl.OpsNil{}: False{}
    case Decl.OpsCons{head, rest}:
      Bool.pick(Bool, String.eq(Decl.op_operation(head), want), True{},
                ops_known(rest, want))

def decl_ops_known(+cat: Decl.Cat, +module_id: String, +want: String) -> Bool:
  match cat:
    case Decl.CatNil{}: False{}
    case Decl.CatCons{+head, rest}:
      Bool.pick(Bool, String.eq(Decl.decl_module_id(head), module_id),
                ops_known(Decl.decl_operations(head), want),
                decl_ops_known(rest, module_id, want))

def edge_failure(+cat: Decl.Cat, +inv: Decl.Inv, +module_id: String,
                 +want_digest: String, +want: String) -> PlanFail:
  Bool.pick(PlanFail, decl_known(cat, module_id),
    Bool.pick(PlanFail, String.eq(digest_at(inv, module_id), want_digest),
      Bool.pick(PlanFail, decl_ops_known(cat, module_id, want), PfNone{},
                PfAt{PlanDependencyUnresolved{module_id, want}}),
      PfAt{PlanDependencyDigestMismatch{module_id, want_digest,
                                        digest_at(inv, module_id)}}),
    PfAt{PlanDependencyUnresolved{module_id, want}})

def resolve_edges(+edges: Decl.ModRefs, +path: Eng.SS, +cat: Decl.Cat,
                  +inv: Decl.Inv, +acc: Pendings, +fail: PlanFail) -> Resolved:
  match edges:
    case Decl.ModRefsNil{}: Resolved{acc, fail}
    case Decl.ModRefsCons{h, r}:
      match h:
        case Decl.ModRef{+module_id, +declaration_digest, +operation}:
          resolve_edges(r, path, cat, inv,
                        pendings_append(
                          decl_pending(cat, inv, module_id, declaration_digest,
                                       operation, path),
                          acc),
                        plan_fail_first(fail,
                                        edge_failure(cat, inv, module_id,
                                                     declaration_digest,
                                                     operation)))

# The walk state: the steps gathered so far, the common operations and declared
# effect additions of every step, and the first failure.
type Walk is Data:
  Walk{steps: Steps, commons: Eng.SS, declared: Eng.SS, failure: PlanFail}

def walk_none() -> Walk:
  Walk{StepsNil{}, Eng.ss_empty(), Eng.ss_empty(), PfNone{}}

def walk_add(+w: Walk, +pending: Pending) -> Walk:
  match w:
    case Walk{steps, commons, declared, failure}:
      Walk{steps_append(steps,
                        StepsCons{step_of(pending_decl(pending),
                                          pending_op(pending),
                                          pending_digest(pending)),
                                  StepsNil{}}),
           Eng.union_add(Eng.ss_one(Decl.op_common(pending_op(pending))),
                         commons),
           Eng.union_add(Decl.op_effects(pending_op(pending)), declared),
           failure}

def walk_fail(+w: Walk, +f: PlanFail) -> Walk:
  match w:
    case Walk{steps, commons, declared, failure}:
      match failure:
        case PfAt{r}: w
        case PfNone{}: Walk{steps, commons, declared, f}

# The pending list of the next iteration. Both readers below ask the same
# resolution question of the same pure inputs, so one traversal is repeated and
# neither answer can contradict the other.
def plan_pending_next(+in_path: Bool, +head: Pending, +rest: Pendings,
                      +cat: Decl.Cat, +inv: Decl.Inv) -> Pendings:
  Bool.pick(Pendings, in_path, rest,
    pendings_append(
      resolved_pending_of(
        resolve_edges(Decl.op_dependencies(pending_op(head)),
                      Eng.union_add(Eng.ss_one(pending_step_key(head)),
                                    pending_path(head)),
                      cat, inv, PendsNil{}, PfNone{})),
      rest))

def plan_walk_next(+in_path: Bool, +head: Pending, +cat: Decl.Cat,
                   +inv: Decl.Inv, +w: Walk) -> Walk:
  Bool.pick(Walk, in_path,
    walk_fail(w, PfAt{PlanCycle{pending_module(head)}}),
    walk_fail(walk_add(w, head),
              resolved_failure_of(
                resolve_edges(Decl.op_dependencies(pending_op(head)),
                              Eng.union_add(Eng.ss_one(pending_step_key(head)),
                                            pending_path(head)),
                              cat, inv, PendsNil{}, PfNone{}))))

# One self-recursive walk: a step already on its own ancestor path is a cycle,
# and every other step contributes its binding, its common operation and its
# declared effect additions before its dependencies are drained.
def plan_drain(+pending: Pendings, +cat: Decl.Cat, +inv: Decl.Inv,
               +w: Walk) -> Walk:
  match pending:
    case PendsNil{}: w
    case PendsCons{+head, rest}:
      plan_drain(plan_pending_next(Eng.ss_member(pending_path(head),
                                                 pending_step_key(head)),
                                   head, rest, cat, inv),
                 cat, inv,
                 plan_walk_next(Eng.ss_member(pending_path(head),
                                              pending_step_key(head)),
                                head, cat, inv, w))

# --- freezing one selected binding ------------------------------------------
def plan_finish(+w: Walk, +primary: MBind, +common: String, +available: Bool,
                +captures: Captures) -> PlanOutcome:
  match w:
    case Walk{steps, commons, declared, failure}:
      match failure:
        case PfAt{reason}: PlanRefused{reason}
        case PfNone{}:
          PlanFrozen{Plan{primary, common, steps,
                                Eng.union_add(declared,
                                              Eng.effects_union(commons)),
                                captures, available}}

def freeze_primary(+decl: Decl.Decl, +op: Decl.Op, +cand: Cand, +cat: Decl.Cat,
                   +inv: Decl.Inv, +captures: Captures) -> PlanOutcome:
  plan_finish(
    plan_drain(PendsCons{Pending{decl, op, cand_digest(cand), Eng.ss_empty()},
                         PendsNil{}},
               cat, inv, walk_none()),
    binding_of(decl, op, cand_digest(cand)), Decl.op_common(op),
    cand_available(cand), captures)

def freeze_op(+decl: Decl.Decl, +ost: OpState, +cand: Cand, +cat: Decl.Cat,
              +inv: Decl.Inv, +captures: Captures) -> PlanOutcome:
  match ost:
    case OpNone{}:
      PlanRefused{PlanMissingOperation{cand_module(cand),
                                       cand_operation(cand)}}
    case OpFound{op}:
      freeze_primary(decl, op, cand, cat, inv, captures)

def freeze_state(+m: MatchState, +cand: Cand, +cat: Decl.Cat, +inv: Decl.Inv,
                 +captures: Captures) -> PlanOutcome:
  match m:
    case MsNone{}: PlanRefused{PlanStaleSelection{cand_module(cand)}}
    case MsStale{}: PlanRefused{PlanStaleSelection{cand_module(cand)}}
    case MsFound{+decl}:
      freeze_op(decl,
                ops_lookup(Decl.decl_operations(decl), cand_operation(cand)),
                cand, cat, inv, captures)

# Freeze one selected candidate into a plan. The candidate contributes its
# module, its recorded declaration digest and its operation; the declaration is
# found by that identity, never by module name alone.
def freeze(+cat: Decl.Cat, +cand: Cand, +inv: Decl.Inv,
           +captures: Captures) -> PlanOutcome:
  freeze_state(match_catalog(cat, inv, cand_module(cand), cand_digest(cand)),
               cand, cat, inv, captures)

# --- canonical invocation data ----------------------------------------------
# The trusted members of the version-2 invocation frame one selected plan is
# served under: the protocol version, the query and owner, the frozen binding,
# the validated canonical request (Codec's value, carried as text), the admitted
# input identities, the effective requirement of the operation plan, and the
# retained role and incarnation, both empty for a direct invocation. A provider
# reads this; it chooses none of it.
type Invocation is Data:
  Invocation{version: String, query: String, owner: String, binding: MBind,
             request: String, operation_plan: Steps, inputs: Captures,
             role: String, incarnation: String}

def invocation_of(+p: Plan, +query: String, +owner: String, +request: String,
                  +role: String, +incarnation: String) -> Invocation:
  match p:
    case Plan{primary, common, steps, effective_effects, inputs, available}:
      Invocation{"2", query, owner, primary, request, steps, inputs, role,
                 incarnation}

# The reference expectation the observer builds from the step that produced a
# stored reference: the format name, the module, the declaration digest and the
# operation of that step, and whether the retained association is present. It is
# compared by snapshot-validate's ref_admit, which reads none of these facts
# from the claim itself.

# --- step-scoped invocation --------------------------------------------------
# A plan holds one step per selected operation, and each step carries its own
# binding. An invocation must therefore be built from the step that produces it:
# a dependency operation invoked under the primary step's binding would report a
# producer that did not run. The lookup answers with the step the caller's
# identity names, or with that identity when the plan holds no such step, so an
# absent or foreign step is named instead of inheriting the primary binding.
type StepState is Data:
  StepMissing{module_id: String, declaration_digest: String, operation: String}
  StepFound{step: Step}

def bind_module(+b: MBind) -> String:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      module_id

def bind_digest(+b: MBind) -> String:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      declaration_digest

def bind_operation(+b: MBind) -> String:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      operation

def step_binding(+step: Step) -> MBind:
  match step:
    case Step{binding, common, declared_effects, execution, dependencies,
              result_schema}:
      binding

def capture_of_step(+c: Capture, +step: Step) -> Bool:
  Bool.and(String.eq(cap_producer_module(c), bind_module(step_binding(step))),
  Bool.and(String.eq(cap_producer_digest(c), bind_digest(step_binding(step))),
           String.eq(cap_producer_operation(c), bind_operation(step_binding(step)))))

# The captures one step produced, in recorded order.
def captures_of_step(+xs: Captures, +step: Step) -> Captures:
  match xs:
    case CapNil{}: CapNil{}
    case CapCons{+head, +rest}:
      Bool.pick(Captures,
                capture_of_step(head, step),
                CapCons{head, captures_of_step(rest, step)},
                captures_of_step(rest, step))

def step_common(+step: Step) -> String:
  match step:
    case Step{binding, common, declared_effects, execution, dependencies,
              result_schema}:
      common

def step_dependencies(+step: Step) -> StepRefs:
  match step:
    case Step{binding, common, declared_effects, execution, dependencies,
              result_schema}:
      dependencies

def step_matches(+step: Step, +module_id: String, +digest: String,
                 +want: String) -> Bool:
  Bool.and(String.eq(bind_module(step_binding(step)), module_id),
  Bool.and(String.eq(bind_digest(step_binding(step)), digest),
           String.eq(bind_operation(step_binding(step)), want)))

# One self-recursive walk, because this dialect refuses mutual recursion: the
# comparison is a Bool.pick inside the match rather than a helper that would call
# back into the walk.
def steps_lookup(+steps: Steps, +module_id: String, +digest: String,
                 +want: String) -> StepState:
  match steps:
    case StepsNil{}: StepMissing{module_id, digest, want}
    case StepsCons{+head, rest}:
      Bool.pick(StepState, step_matches(head, module_id, digest, want),
                StepFound{head},
                steps_lookup(rest, module_id, digest, want))

def step_lookup(+p: Plan, +module_id: String, +digest: String,
                +want: String) -> StepState:
  match p:
    case Plan{primary, common, steps, effective_effects, inputs, available}:
      steps_lookup(steps, module_id, digest, want)

# The invocation of one selected step: the step's own binding beside the plan's
# admitted input identities and effective requirement, which belong to the
# invocation rather than to any one step.
def invocation_from_step(+step: Step, +p: Plan, +query: String, +owner: String,
                         +request: String, +role: String,
                         +incarnation: String) -> Invocation:
  match p:
    case Plan{primary, common, steps, effective_effects, inputs, available}:
      Invocation{"2", query, owner, step_binding(step), request, steps, inputs,
                 role, incarnation}

type InvocationOutcome is Data:
  InvocationBound{invocation: Invocation}
  InvocationMissing{module_id: String, declaration_digest: String,
                    operation: String}

def invocation_finish(+st: StepState, +p: Plan, +query: String, +owner: String,
                      +request: String, +role: String,
                      +incarnation: String) -> InvocationOutcome:
  match st:
    case StepMissing{module_id, declaration_digest, operation}:
      InvocationMissing{module_id, declaration_digest, operation}
    case StepFound{step}:
      InvocationBound{invocation_from_step(step, p, query, owner, request, role,
                                           incarnation)}

# The invocation of the step the caller names. The primary step uses its own
# identity here too, so primary and dependency invocations take one path.
def invocation_for_step(+p: Plan, +module_id: String, +digest: String,
                        +want: String, +query: String, +owner: String,
                        +request: String, +role: String,
                        +incarnation: String) -> InvocationOutcome:
  invocation_finish(step_lookup(p, module_id, digest, want), p, query, owner,
                    request, role, incarnation)

# The remaining binding readers. The full selected binding is the value every
# frame, result and reference echo must carry, so its members are read one at a
# time rather than reconstructed from a module name.
def bind_revision(+b: MBind) -> String:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      revision

def bind_protocol(+b: MBind) -> String:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      protocol_version

def bind_artifacts(+b: MBind) -> Decl.Arts:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      artifacts

def bind_schemas(+b: MBind) -> Eng.SS:
  match b:
    case MBind{module_id, revision, declaration_digest, protocol_version,
               operation, artifacts, schemas}:
      schemas

# --- passive discovery over the declared inventory ---------------------------
# Discovery answers what the declared inventory holds and what state each module
# is in, and loads nothing: no provider entry is imported, no discovery command
# runs, no tool is probed and no debuggee starts. Every status is honest: a
# declaration that refuses carries its refusal, a module whose verified bytes are
# absent carries the unavailable status, and one that is both admitted and
# present carries its declaration digest. A retained probe is separate evidence
# and is not consulted here.
type DiscoveryState is Data:
  DsAdmitted{digest: String}
  DsUnavailable{digest: String}
  DsRefused{reason: Decl.DeclReject}

type Discovery is Data:
  Discovery{module_id: String, state: DiscoveryState}

type Discoveries is Data:
  DscNil{}
  DscCons{head: Discovery, rest: Discoveries}

def discovery_state(+o: Decl.DeclOutcome, +installed: Bool) -> DiscoveryState:
  match o:
    case Decl.DeclRefused{reason}: DsRefused{reason}
    case Decl.DeclAdmitted{decl, +digest}:
      Bool.pick(DiscoveryState, installed, DsAdmitted{digest},
                DsUnavailable{digest})

def discovery_entry(+cat: Decl.Cat, +inv: Decl.Inv, +installed: Eng.SS,
                    +decl: Decl.Decl) -> Discovery:
  Discovery{Decl.decl_module_id(decl),
            discovery_state(Decl.admit_declaration(decl, cat, inv),
                            Eng.ss_member(installed,
                                          Decl.decl_module_id(decl)))}

def discovery_walk(+remaining: Decl.Cat, +context: Decl.Cat, +inv: Decl.Inv,
                   +installed: Eng.SS) -> Discoveries:
  match remaining:
    case Decl.CatNil{}: DscNil{}
    case Decl.CatCons{head, rest}:
      DscCons{discovery_entry(context, inv, installed, head),
              discovery_walk(rest, context, inv, installed)}

# Discovery over the declared inventory. `remaining` is the part still to report
# and `context` is the whole candidate set, so admission of one declaration sees
# every other declaration of the same set; walking a shrinking list without the
# context would let a later entry miss an earlier declaration's identity.
def discovery(+cat: Decl.Cat, +inv: Decl.Inv, +installed: Eng.SS) -> Discoveries:
  discovery_walk(cat, cat, inv, installed)

# --- the admission and preparation consumer ----------------------------------
# One composed entry for a caller that holds a canonical request and the supplied
# admitted operands: it admits the catalog, selects the common operation, freezes
# the plan and names the result schema the payload must still satisfy. It
# performs no effect, opens no connection, holds no query row and reads no
# request text. The database, the attachment, the query row and the raw request
# bytes are the caller's operands, and a caller that holds none of them cannot
# manufacture them here.
type RqReason is Data:
  RqCatalogRefused{module_id: String, reason: Decl.DeclReject}
  RqSelectionRefused{reason: SelReason}
  RqPlanRefused{reason: PlanReason}

type Verdict is Data:
  VerdictAdmitted{plan: Plan, result_schema: String}
  VerdictRefused{stage: String, reason: RqReason}

def schema_of_step(+st: StepState) -> String:
  match st:
    case StepMissing{module_id, declaration_digest, operation}: ""
    case StepFound{step}: step_result_schema(step)

# The result schema of the plan's primary step.
def plan_primary_schema(+p: Plan) -> String:
  match p:
    case Plan{+primary, common, steps, effective_effects, inputs, available}:
      schema_of_step(step_lookup(p, bind_module(primary), bind_digest(primary),
                                 bind_operation(primary)))

def verdict_frozen(+o: PlanOutcome, +cat: Decl.Cat) -> Verdict:
  match o:
    case PlanRefused{reason}: VerdictRefused{"plan", RqPlanRefused{reason}}
    case PlanFrozen{+plan}: VerdictAdmitted{plan, plan_primary_schema(plan)}

def verdict_plan(+cand: Cand, +cat: Decl.Cat, +inv: Decl.Inv,
                 +captures: Captures) -> Verdict:
  verdict_frozen(freeze(cat, cand, inv, captures), cat)

def verdict_chosen(+o: SelOutcome, +cat: Decl.Cat, +inv: Decl.Inv,
                   +captures: Captures) -> Verdict:
  match o:
    case SelRefused{reason}:
      VerdictRefused{"selection", RqSelectionRefused{reason}}
    case SelChosen{candidates, chosen}: verdict_plan(chosen, cat, inv, captures)

def verdict_catalog(+o: Decl.CatOutcome, +cat: Decl.Cat, +inputs: SelInputs,
                    +inv: Decl.Inv, +captures: Captures) -> Verdict:
  match o:
    case Decl.CatRefused{module_id, reason}:
      VerdictRefused{"catalog", RqCatalogRefused{module_id, reason}}
    case Decl.CatAdmitted{+admitted}:
      verdict_chosen(select(admitted, inputs, inv), admitted, inv, captures)

# The operands are supplied by their owners and none is produced here: package
# admission supplies the admitted catalog, the inventory digests, the artifact and
# schema identities and the installed closure; the provider step and its retained
# observation supply the captured records; and Codec supplies the decoded request
# operands. Until those counterparts publish, a caller cannot call this entry with
# real operands, and this module invents no substitute for them.
def request_verdict(+cat: Decl.Cat, +inputs: SelInputs, +inv: Decl.Inv,
                    +captures: Captures) -> Verdict:
  verdict_catalog(Decl.admit_catalog(cat, inv), cat, inputs, inv, captures)

# --- the admission decision a caller fills -----------------------------------
# The typed decision a submit path consumes before it creates a row: on success
# the frozen plan and the result schema identity, and on refusal the stage, a code
# naming the typed reason and a rendered detail. The code is the name of the typed
# reason, so no numeric code and no second error vocabulary is invented here; a
# caller maps it to its own closed shape and to its own numbers.
type AdmissionDecision is Data:
  AdmissionAdmits{plan: Plan, result_schema: String}
  AdmissionRefuses{stage: String, code: String, detail: String,
                   reason: RqReason}

def decl_reject_code(+r: Decl.DeclReject) -> String:
  match r:
    case Decl.DrUnsupportedDeclarationVersion{saw}: "unsupportedDeclarationVersion"
    case Decl.DrUnsupportedProtocolVersion{saw}: "unsupportedProtocolVersion"
    case Decl.DrEmptyId{what}: "emptyId"
    case Decl.DrConflictingId{module_id, package_identity}: "conflictingId"
    case Decl.DrMissingDeclarationDigest{module_id}: "missingDeclarationDigest"
    case Decl.DrMissingArtifact{module_id, path}: "missingArtifact"
    case Decl.DrArtifactMismatch{module_id, path, want, saw}: "artifactMismatch"
    case Decl.DrEmptyEntryVector{}: "emptyEntryVector"
    case Decl.DrMissingSchema{module_id, operation, schema}: "missingSchema"
    case Decl.DrDuplicateOperation{module_id, operation}: "duplicateOperation"
    case Decl.DrUnknownCommonOperation{module_id, operation, common}:
      "unknownCommonOperation"
    case Decl.DrEffectRequiresReview{module_id, operation, effect}:
      "effectRequiresReview"
    case Decl.DrMissingLifetimeProfile{module_id, operation}:
      "missingLifetimeProfile"
    case Decl.DrDependencyUnresolved{module_id, operation, dependency}:
      "dependencyUnresolved"
    case Decl.DrDependencyDigestMismatch{module_id, dependency, want, saw}:
      "dependencyDigestMismatch"

def sel_reason_code(+r: SelReason) -> String:
  match r:
    case SelUnknownCommonOperation{common}: "unknownCommonOperation"
    case SelExplicitUnknown{module_id}: "explicitUnknown"
    case SelExplicitDisabled{module_id}: "explicitDisabled"
    case SelExplicitIncompatible{module_id}: "explicitIncompatible"
    case SelExplicitWrongOperation{module_id, operation}: "explicitWrongOperation"
    case SelAmbiguous{candidates}: "ambiguousSelection"
    case SelNoCandidate{subject}: "noCandidate"

def plan_reason_code(+r: PlanReason) -> String:
  match r:
    case PlanStaleSelection{module_id}: "staleSelection"
    case PlanMissingOperation{module_id, operation}: "missingOperation"
    case PlanDependencyUnresolved{dependency, operation}: "dependencyUnresolved"
    case PlanDependencyDigestMismatch{dependency, want, saw}:
      "dependencyDigestMismatch"
    case PlanCycle{module_id}: "cycle"

def rq_code(+r: RqReason) -> String:
  match r:
    case RqCatalogRefused{module_id, reason}: decl_reject_code(reason)
    case RqSelectionRefused{reason}: sel_reason_code(reason)
    case RqPlanRefused{reason}: plan_reason_code(reason)

def rq_detail(+r: RqReason) -> String:
  match r:
    case RqCatalogRefused{module_id, reason}:
      String.append("declaration ", module_id)
    case RqSelectionRefused{reason}:
      String.append("selection ", sel_reason_code(reason))
    case RqPlanRefused{reason}:
      String.append("plan ", plan_reason_code(reason))

def decision_of(+v: Verdict) -> AdmissionDecision:
  match v:
    case VerdictAdmitted{plan, result_schema}: AdmissionAdmits{plan, result_schema}
    case VerdictRefused{stage, +reason}:
      AdmissionRefuses{stage, rq_code(reason), rq_detail(reason), reason}

# --- the selected-step transfer a consumer receives --------------------------
# The exact operands one consumer receives for one selected step: that step's own
# binding, its common operation, its declared effects, its result schema, its
# dependency edges, and the admitted captured records attributed to that step.
# A step the plan does not hold is named rather than substituted, and the records
# are the ones whose producing step is this step, so a dependency result never
# carries the primary step's captures. This assembles values the plan already
# holds; it is not a second interpreter and it wraps no other module.
type StepTransfer is Data:
  StepTransfer{binding: MBind, common: String, declared_effects: Eng.SS,
               result_schema: String, dependencies: StepRefs, inputs: Captures}

type TransferOutcome is Data:
  TransferReady{transfer: StepTransfer}
  TransferMissing{module_id: String, declaration_digest: String,
                  operation: String}

def step_effects(+step: Step) -> Eng.SS:
  match step:
    case Step{binding, common, declared_effects, execution, dependencies,
              result_schema}:
      declared_effects

def plan_inputs(+p: Plan) -> Captures:
  match p:
    case Plan{primary, common, steps, effective_effects, inputs, available}:
      inputs

def transfer_of(+step: Step, +inputs: Captures) -> StepTransfer:
  StepTransfer{step_binding(step), step_common(step), step_effects(step),
               step_result_schema(step), step_dependencies(step),
               captures_of_step(inputs, step)}

def transfer_finish(+st: StepState, +inputs: Captures) -> TransferOutcome:
  match st:
    case StepMissing{module_id, declaration_digest, operation}:
      TransferMissing{module_id, declaration_digest, operation}
    case StepFound{step}: TransferReady{transfer_of(step, inputs)}

def transfer_for_step(+p: Plan, +module_id: String, +digest: String,
                      +want: String) -> TransferOutcome:
  transfer_finish(step_lookup(p, module_id, digest, want), plan_inputs(p))

# --- the declared dependency edge as an accessor -----------------------------
# A consuming step declares its edges as StepRefs. These readers and the accessor
# below let a consumer resolve the producing operation from that edge itself, so a
# TypeScript dependency result is delivered under its own producer binding and its
# own result schema rather than being relabelled as the consuming step's output.
#
# What these functions do not do: transfer_of_edge accepts any edge and looks it
# up in the plan it is handed, so it does not establish that the requesting
# consumer owns that edge; it executes no producer; and it neither ingests nor
# admits a dependency result that has just been returned. The caller sources the
# edge from the consuming step it retained, and the admitted dependency outputs
# must already have been supplied as the plan's captured records by whoever
# admitted them, since a result that has not been admitted is not part of this
# value.
def step_ref_module(+r: StepRef) -> String:
  match r:
    case StepRef{module_id, declaration_digest, operation}: module_id

def step_ref_digest(+r: StepRef) -> String:
  match r:
    case StepRef{module_id, declaration_digest, operation}: declaration_digest

def step_ref_operation(+r: StepRef) -> String:
  match r:
    case StepRef{module_id, declaration_digest, operation}: operation

def transfer_of_edge(+p: Plan, +ref: StepRef) -> TransferOutcome:
  transfer_finish(step_lookup(p, step_ref_module(ref), step_ref_digest(ref),
                              step_ref_operation(ref)),
                  plan_inputs(p))

# --- the declared dependency records -----------------------------------------
# The admitted captured records of the steps a step declares as dependencies. Each
# record keeps its own producing step, so a TypeScript record a catalog step
# consumes is delivered under the TypeScript producer and is never reattributed to
# the consuming step.
#
# Caller condition: a dependency the plan does not hold contributes no record, so
# an empty result here is ambiguous between a producer that is absent and a
# producer that completed with nothing. A caller that must tell those apart
# resolves the edge first, with transfer_of_edge or step_lookup, whose
# TransferMissing or StepMissing names the absent producer, and treats an empty
# capture set from a resolved producer as a completed empty result. These
# selectors are conveniences over an edge the caller already holds from the
# retained consuming step; they establish no ownership of that edge and admit no
# record themselves.
def captures_append(+a: Captures, +b: Captures) -> Captures:
  match a:
    case CapNil{}: b
    case CapCons{head, rest}: CapCons{head, captures_append(rest, b)}

def ref_step_captures(+st: StepState, +xs: Captures) -> Captures:
  match st:
    case StepMissing{module_id, declaration_digest, operation}: CapNil{}
    case StepFound{step}: captures_of_step(xs, step)

def dependency_captures(+refs: StepRefs, +p: Plan, +xs: Captures) -> Captures:
  match refs:
    case StepRefsNil{}: CapNil{}
    case StepRefsCons{+head, rest}:
      captures_append(
        ref_step_captures(step_lookup(p, step_ref_module(head),
                                      step_ref_digest(head),
                                      step_ref_operation(head)), xs),
        dependency_captures(rest, p, xs))

# The records of the step one declared edge names.
def dependency_inputs(+p: Plan, +ref: StepRef) -> Captures:
  dependency_captures(StepRefsCons{ref, StepRefsNil{}}, p, plan_inputs(p))

# The records of every step one step declares as its dependencies.
def dependency_inputs_of_step(+p: Plan, +step: Step) -> Captures:
  dependency_captures(step_dependencies(step), p, plan_inputs(p))

# CLAIM: the lifecycle outcomes of one managed semantic query and the owner
# admission predicate. The refusal document itself belongs to the canonical
# contract module; this module supplies the lifecycle-specific condition tree, the
# navigation argv and the class of each outcome, so no second spelling of the
# refusal object exists.
#
# validationRefusal names the failed predicate and creates nothing, admissionRejected
# retains a refused query whose next is its retained result, hostPreparationFailed
# reports a host stage with its available evidence, and admissionUncertain reports
# that original-binding reconciliation has not established a decision. No outcome
# asserts an absence of a keeper or a child.
import Base
import ../json/canonical.bend as J
import ./contracts.bend as Context

type Stage is Data:
  StageGuard{}
  StageManifest{}
  StagePrepare{}
  StageSocket{}
  StageSpool{}
  StageObserverAttach{}

def stage_text(s: Stage) -> String:
  match s:
    case StageGuard{}: "guard"
    case StageManifest{}: "manifest"
    case StagePrepare{}: "prepare"
    case StageSocket{}: "socket"
    case StageSpool{}: "spool"
    case StageObserverAttach{}: "observerAttach"

# A host error code is the actual numeric error or null. No zero or default value
# stands in for a code that was not observed.
type Code is Data:
  NoCode{}
  HostCode{value: U32}

def code_json(c: Code) -> J.Json:
  match c:
    case NoCode{}: J.Jnull{}
    case HostCode{value}: J.Jint{value}

# One retained artifact reference or an explicit null. A planned pathname is not
# evidence that a file exists.
type Evidence is Data:
  NoEvidence{}
  ArtifactEvidence{path: String, sha256: String, pointer: String}

def evidence_json(e: Evidence) -> J.Json:
  match e:
    case NoEvidence{}: J.Jnull{}
    case ArtifactEvidence{+path, +sha256, +pointer}:
      J.Jobj{J.Jpair{"path", J.Jstr{path},
        J.Jpair{"pointer", J.Jstr{pointer},
        J.Jpair{"sha256", J.Jstr{sha256}, J.Jnil{}}}}}

def evidence_recorded(e: Evidence) -> Bool:
  match e:
    case NoEvidence{}: False{}
    case ArtifactEvidence{path, sha256, pointer}: True{}

type Outcome is Data:
  OutcomeValidation{command: String, condition: String}
  OutcomeRejected{query: String, condition: String}
  OutcomePrepareFailed{stage: Stage, query: String, owner: String, plannedDirectory: String, evidence: Evidence, code: Code, retained: Bool}
  OutcomeUncertain{query: String, owner: String, plannedDirectory: String, evidence: Evidence, retained: Bool}

def optional_text(+value: String) -> J.Json:
  Bool.pick(J.Json, String.eq(value, ""), J.Jnull{}, J.Jstr{value})

def prepare_condition(stage: Stage, +query: String, +owner: String, +plannedDirectory: String, evidence: Evidence, code: Code) -> J.Json:
  J.Jobj{J.Jpair{"code", code_json(code),
    J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"plannedDirectory", optional_text(plannedDirectory),
    J.Jpair{"preparedEvidence", evidence_json(evidence),
    J.Jpair{"query", J.Jstr{query},
    J.Jpair{"stage", J.Jstr{stage_text(stage)}, J.Jnil{}}}}}}}}

def uncertain_condition(+query: String, +owner: String, +plannedDirectory: String, evidence: Evidence) -> J.Json:
  J.Jobj{J.Jpair{"decision", J.Jstr{"unverified"},
    J.Jpair{"owner", J.Jstr{owner},
    J.Jpair{"plannedDirectory", optional_text(plannedDirectory),
    J.Jpair{"preparedEvidence", evidence_json(evidence),
    J.Jpair{"query", J.Jstr{query}, J.Jnil{}}}}}}}

def outcome_condition(o: Outcome) -> J.Json:
  match o:
    case OutcomeValidation{command, condition}: Context.text_condition(condition)
    case OutcomeRejected{query, condition}: Context.text_condition(condition)
    case OutcomePrepareFailed{stage, +query, +owner, plannedDirectory, evidence, code, retained}:
      prepare_condition(stage, query, owner, plannedDirectory, evidence, code)
    case OutcomeUncertain{+query, +owner, plannedDirectory, evidence, retained}:
      uncertain_condition(query, owner, plannedDirectory, evidence)

# A verified retained row is addressed by its query ID; without one the caller must
# supply its original request on stdin, and the refusal never includes that body.
def result_next(query: String) -> Context.Next:
  Context.NextArg{"context-result", Context.NextArg{query, Context.NextStop{}}}

def retained_next(retained: Bool, +query: String, +owner: String) -> Context.Next:
  Bool.pick(Context.Next, retained, result_next(query),
    Context.NextArg{"context-query-file", Context.NextArg{owner, Context.NextArg{query, Context.NextArg{"-", Context.NextStop{}}}}})

def outcome_next(o: Outcome) -> Context.Next:
  match o:
    case OutcomeValidation{command, condition}: Context.NextArg{"context-engines", Context.NextStop{}}
    case OutcomeRejected{query, condition}: result_next(query)
    case OutcomePrepareFailed{stage, +query, +owner, plannedDirectory, evidence, code, retained}:
      retained_next(retained, query, owner)
    case OutcomeUncertain{+query, +owner, plannedDirectory, evidence, retained}:
      retained_next(retained, query, owner)

# The closed outcome surface: class, command, condition and navigation. The
# retained rejection's next is its retained result, and a pre-decision outcome whose
# query row is not verified requires the original request on stdin.
def admission_refusal(o: Outcome) -> Context.Refusal:
  match o:
    case OutcomeValidation{command, condition}:
      Context.Refuse{Context.RfValidation{}, command, Context.text_condition(condition), Context.NextArg{"context-engines", Context.NextStop{}}}
    case OutcomeRejected{+query, condition}:
      Context.Refuse{Context.RfAdmissionRejected{}, "context-query", Context.text_condition(condition), result_next(query)}
    case OutcomePrepareFailed{stage, +query, +owner, plannedDirectory, evidence, code, retained}:
      Context.Refuse{Context.RfHostPreparation{}, "context-query", prepare_condition(stage, query, owner, plannedDirectory, evidence, code), retained_next(retained, query, owner)}
    case OutcomeUncertain{+query, +owner, plannedDirectory, evidence, retained}:
      Context.Refuse{Context.RfAdmissionUncertain{}, "context-query", uncertain_condition(query, owner, plannedDirectory, evidence), retained_next(retained, query, owner)}

# The retained row's own error object. Its kind is the canonical class name taken
# from the contract module, and its limits are empty: the rejection records the
# failed predicate, not an analysis bound.
def rejection_error(+condition: String) -> String:
  J.json_text(J.Jobj{J.Jpair{"condition", J.Jstr{condition},
    J.Jpair{"kind", J.Jstr{Context.refusal_class_name(Context.RfAdmissionRejected{})},
    J.Jpair{"limits", J.Jarr{J.Jnil{}, J.Jnil{}}, J.Jnil{}}}}})

# The stable identity of the rejection notice: the canonical array of the fixed tag
# and the query ID, so a later cleanup change preserves the original notice.
def rejection_message_id(+query: String) -> String:
  J.json_text(J.Jarr{J.Jstr{"context-admission-rejected"}, J.Jarr{J.Jstr{query}, J.Jnil{}}})

type OwnerSubject is Data:
  OwnerOrdinary{}
  OwnerQueryControl{}
  OwnerRuntimeRelease{}

# A stopped owner keeps only its own query-control recover/release and runtime
# release; every ordinary computation subject refuses. An active owner is admitted
# for its own subjects. Ownership is required in both arms.
def stopped_owner_admitted(subject: OwnerSubject) -> Bool:
  match subject:
    case OwnerOrdinary{}: False{}
    case OwnerQueryControl{}: True{}
    case OwnerRuntimeRelease{}: True{}

def owner_admission(active: Bool, owned: Bool, subject: OwnerSubject) -> Bool:
  Bool.and(owned, Bool.or(active, stopped_owner_admitted(subject)))


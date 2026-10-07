# Typed bootstrap and start decisions for one managed native context query.
# The host keeper owns preparation and process observation; this module binds the
# request's immutable values to the decision that permits one idempotent start.
import Base
import ../json/canonical.bend as J
import ./bound-admission.bend as Admission
import ./service.bend as ContextService
import ./identity.bend as ContextIdentity

type Bootstrap is Data:
  QueryBootstrap{query: String, owner: String, database_binding: String,
    request: String, plan_value: String, plan_identity: String,
    result_schema: String, artifact_path: String, keeper_path: String,
    guard_identity: String, guard_key: String, recovery_argv: String}

type StartDecision is Data:
  StartGranted{query: String, owner: String, role: String, incarnation: String,
    request: String, keeper_path: String, artifact_path: String,
    plan_value: String, result_schema: String}
  StartCancelled{query: String, owner: String, reason: String, keeper_path: String}
  StartHeld{reason: String}

type KeeperReadiness is Data:
  KeeperObserverReady{query: String, owner: String, keeper_path: String,
    role: String, incarnation: String}
  KeeperObserverUnavailable{reason: String}

def query_bootstrap(+database_binding: String, +query: String, +owner: String,
                    +request: String, +plan_value: String, +plan_identity: String,
                    +result_schema: String, +artifact_path: String,
                    +keeper_path: String, +guard_key: String,
                    +recovery_argv: String) -> Bootstrap:
  QueryBootstrap{query, owner, database_binding, request, plan_value,
    plan_identity, result_schema, artifact_path, keeper_path,
    ContextIdentity.guard_identity(database_binding,
      ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{}, "0"),
    guard_key, recovery_argv}

def bootstrap_query(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}: query

def bootstrap_owner(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}: owner

def bootstrap_request(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}: request

def bootstrap_keeper_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}: keeper_path

def bootstrap_artifact_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}: artifact_path

def bootstrap_json(+bootstrap: Bootstrap) -> J.Json:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}:
      J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-managed-context-bootstrap-v1"},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"databaseBinding", J.Jstr{database_binding},
      J.Jpair{"request", J.Jstr{request},
      J.Jpair{"planValue", J.Jstr{plan_value},
      J.Jpair{"planIdentity", J.Jstr{plan_identity},
      J.Jpair{"resultSchema", J.Jstr{result_schema},
      J.Jpair{"artifactPath", J.Jstr{artifact_path},
      J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"guardIdentity", J.Jstr{guard_identity},
      J.Jpair{"guardKey", J.Jstr{guard_key},
      J.Jpair{"recoveryArgv", J.Jstr{recovery_argv}, J.Jnil{}}}}}}}}}}}}}}}

def bootstrap_text(+bootstrap: Bootstrap) -> String:
  J.json_text(bootstrap_json(bootstrap))

def accepted_query_state(+state: String) -> Bool:
  Bool.or(String.eq(state, "accepted"),
  Bool.or(String.eq(state, "running"),
  Bool.or(String.eq(state, "complete"),
  Bool.or(String.eq(state, "failed"), String.eq(state, "interrupted")))))

def admission_identity_match(+expected_owner: String, +expected_request: String,
                             +expected_keeper: String, +expected_artifact: String,
                             +admission: Admission.Admission) -> Bool:
  match admission:
    case Admission.AdmissionCreated{+owner, +request, decision, state, attempt,
        +keeperPath, cwd, +artifactPath}:
      Bool.and(String.eq(expected_owner, owner),
      Bool.and(String.eq(expected_request, request),
      Bool.and(String.eq(expected_keeper, keeperPath),
      Bool.and(String.eq(expected_artifact, artifactPath),
      Bool.and(String.eq(decision, "accepted"), accepted_query_state(state))))))
    case Admission.AdmissionRetained{+owner, +request, decision, state, attempt,
        +keeperPath, cwd, +artifactPath}:
      Bool.and(String.eq(expected_owner, owner),
      Bool.and(String.eq(expected_request, request),
      Bool.and(String.eq(expected_keeper, keeperPath),
      Bool.and(String.eq(expected_artifact, artifactPath),
      Bool.and(String.eq(decision, "accepted"), accepted_query_state(state))))))
    case _: False{}

def admission_fields_match(bootstrap: Bootstrap, +admission: Admission.Admission) -> Bool:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}:
      admission_identity_match(owner, request, keeper_path, artifact_path, admission)

def accepted_admission(+bootstrap: Bootstrap, +role: String, +incarnation: String,
                       +admission: Admission.Admission, +stored_plan: String,
                       +stored_schema: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, plan_value,
        plan_identity, result_schema, artifact_path, keeper_path,
        guard_identity, guard_key, recovery_argv}:
      Bool.pick(StartDecision,
        Bool.and(admission_fields_match(bootstrap, admission),
        Bool.and(String.eq(plan_value, stored_plan), String.eq(result_schema, stored_schema))),
        StartGranted{query, owner, role, incarnation, request, keeper_path,
          artifact_path, stored_plan, stored_schema},
        StartHeld{"committedAdmissionMismatch"})

def submission_decision(+bootstrap: Bootstrap, +role: String, +incarnation: String,
                        +submission: ContextService.Submission) -> StartDecision:
  match submission:
    case ContextService.SubmissionAdmitted{+admission, +planValue, resultSchema}:
      accepted_admission(bootstrap, role, incarnation, admission, planValue, resultSchema)
    case ContextService.SubmissionRetainedVerified{+admission, +planValue, resultSchema}:
      accepted_admission(bootstrap, role, incarnation, admission, planValue, resultSchema)
    case ContextService.SubmissionRetainedUnverified{admission, planValue, resultSchema}:
      StartHeld{"retainedAdmissionUnverified"}
    case ContextService.SubmissionRetainedRejected{decision, state, owner, request}:
      StartHeld{"rejectedDecisionRequiresPreparedIdentityReadback"}
    case ContextService.SubmissionPlanRefused{stage, reason}: StartHeld{"planRefused:" ++ stage ++ ":" ++ reason}
    case ContextService.SubmissionAbsent{}: StartHeld{"admissionAbsent"}
    case ContextService.SubmissionForeign{owner, request}: StartHeld{"admissionForeign"}
    case ContextService.SubmissionRefused{code, detail}: StartHeld{"admissionReadFailed"}
    case ContextService.SubmissionUncertain{stage, answer}: StartHeld{"admissionUncertain:" ++ stage}

def start_from_submission(+bootstrap: Bootstrap, readiness: KeeperReadiness,
                          +submission: ContextService.Submission) -> StartDecision:
  match readiness:
    case KeeperObserverUnavailable{reason}: StartHeld{"observerUnavailable:" ++ reason}
    case KeeperObserverReady{query, owner, keeper_path, +role, +incarnation}:
      Bool.pick(StartDecision,
        Bool.and(String.eq(query, bootstrap_query(bootstrap)),
        Bool.and(String.eq(owner, bootstrap_owner(bootstrap)),
        Bool.and(String.eq(keeper_path, bootstrap_keeper_path(bootstrap)),
        Bool.and(String.eq(role, "starter"), String.eq(incarnation, "0"))))),
        submission_decision(bootstrap, role, incarnation, submission),
        StartHeld{"observerIdentityMismatch"})

def rejection_identity_match(+expected_owner: String, +expected_request: String,
                             +expected_keeper: String, +expected_artifact: String,
                             +admission: Admission.Admission) -> Bool:
  match admission:
    case Admission.AdmissionRetained{+owner, +request, decision, state, attempt,
        +keeperPath, cwd, +artifactPath}:
      Bool.and(String.eq(owner, expected_owner),
      Bool.and(String.eq(request, expected_request),
      Bool.and(String.eq(keeperPath, expected_keeper),
      Bool.and(String.eq(artifactPath, expected_artifact),
      Bool.and(String.eq(decision, "rejected"), String.eq(state, "refused"))))))
    case _: False{}

def rejected_admission_decision(+bootstrap: Bootstrap,
                                +admission: Admission.Admission) -> StartDecision:
  Bool.pick(StartDecision,
    rejection_identity_match(bootstrap_owner(bootstrap), bootstrap_request(bootstrap),
      bootstrap_keeper_path(bootstrap), bootstrap_artifact_path(bootstrap), admission),
    StartCancelled{bootstrap_query(bootstrap), bootstrap_owner(bootstrap),
      "admissionRejected", bootstrap_keeper_path(bootstrap)},
    StartHeld{"rejectedAdmissionIdentityMismatch"})

def cancel_rejected(+bootstrap: Bootstrap, readiness: KeeperReadiness,
                    +admission: Admission.Admission) -> StartDecision:
  match readiness:
    case KeeperObserverUnavailable{reason}: StartHeld{"observerUnavailable:" ++ reason}
    case KeeperObserverReady{query, owner, keeper_path, role, incarnation}:
      Bool.pick(StartDecision,
        Bool.and(String.eq(query, bootstrap_query(bootstrap)),
        Bool.and(String.eq(owner, bootstrap_owner(bootstrap)),
        Bool.and(String.eq(keeper_path, bootstrap_keeper_path(bootstrap)),
        Bool.and(String.eq(role, "starter"), String.eq(incarnation, "0"))))),
        rejected_admission_decision(bootstrap, admission),
        StartHeld{"observerIdentityMismatch"})

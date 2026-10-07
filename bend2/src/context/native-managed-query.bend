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
    request: String, cwd: String, origin_attempt: String, source_identity: String,
    plan_value: String, plan_identity: String,
    result_schema: String, artifact_path: String, artifact_sha256: String,
    keeper_path: String, guard_identity: String, guard_key: String,
    physical_role_key: String, owner_witness: String, recovery_argv: String}

type ArtifactEvidence is Data:
  ArtifactEvidence{source_identity: String, artifact_sha256: String}

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
                    +request: String, +cwd: String, +origin_attempt: String,
                    +artifact_evidence: ArtifactEvidence,
                    +plan_value: String, +plan_identity: String,
                    +result_schema: String, +artifact_path: String,
                    +keeper_path: String,
                    +guard_key: String, +physical_role_key: String,
                    +owner_witness: String,
                    +recovery_argv: String) -> Bootstrap:
  match artifact_evidence:
    case ArtifactEvidence{source_identity, artifact_sha256}:
      QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path,
        ContextIdentity.guard_identity(database_binding,
          ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{}, "0"),
        guard_key, physical_role_key, owner_witness, recovery_argv}

def bootstrap_query(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: query

def bootstrap_owner(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: owner

def bootstrap_request(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: request

def bootstrap_cwd(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: cwd

def bootstrap_attempt(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: origin_attempt

def bootstrap_keeper_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: keeper_path

def bootstrap_artifact_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: artifact_path

def bootstrap_artifact_sha256(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: artifact_sha256

def bootstrap_physical_role_key(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: physical_role_key

def bootstrap_owner_witness(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}: owner_witness

def bootstrap_json(+bootstrap: Bootstrap) -> J.Json:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}:
      J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-managed-context-bootstrap-v2"},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"databaseBinding", J.Jstr{database_binding},
      J.Jpair{"request", J.Jstr{request},
      J.Jpair{"cwd", J.Jstr{cwd},
      J.Jpair{"originAttempt", J.Jstr{origin_attempt},
      J.Jpair{"sourceIdentity", J.Jstr{source_identity},
      J.Jpair{"planValue", J.Jstr{plan_value},
      J.Jpair{"planIdentity", J.Jstr{plan_identity},
      J.Jpair{"resultSchema", J.Jstr{result_schema},
      J.Jpair{"artifactPath", J.Jstr{artifact_path},
      J.Jpair{"artifactSha256", J.Jstr{artifact_sha256},
      J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"guardIdentity", J.Jstr{guard_identity},
      J.Jpair{"guardKey", J.Jstr{guard_key},
      J.Jpair{"physicalRoleKey", J.Jstr{physical_role_key},
      J.Jpair{"ownerWitness", J.Jstr{owner_witness},
      J.Jpair{"recoveryArgv", J.Jstr{recovery_argv}, J.Jnil{}}}}}}}}}}}}}}}}}}}}}

def bootstrap_text(+bootstrap: Bootstrap) -> String:
  J.json_text(bootstrap_json(bootstrap))

def accepted_query_state(+state: String) -> Bool:
  Bool.or(String.eq(state, "accepted"), String.eq(state, "running"))

def admission_identity_match(+expected_owner: String, +expected_request: String,
                             +expected_keeper: String, +expected_cwd: String,
                             +expected_attempt: String, +expected_artifact: String,
                             +admission: Admission.Admission) -> Bool:
  match admission:
    case Admission.AdmissionCreated{+owner, +request, decision, state, attempt,
        +keeperPath, +cwd, +artifactPath}:
      Bool.and(String.eq(expected_owner, owner),
      Bool.and(String.eq(expected_request, request),
      Bool.and(String.eq(expected_keeper, keeperPath),
      Bool.and(String.eq(expected_cwd, cwd),
      Bool.and(String.eq(expected_attempt, attempt),
      Bool.and(String.eq(expected_artifact, artifactPath),
      Bool.and(String.eq(decision, "accepted"), accepted_query_state(state))))))))
    case Admission.AdmissionRetained{+owner, +request, decision, state, attempt,
        +keeperPath, +cwd, +artifactPath}:
      Bool.and(String.eq(expected_owner, owner),
      Bool.and(String.eq(expected_request, request),
      Bool.and(String.eq(expected_keeper, keeperPath),
      Bool.and(String.eq(expected_cwd, cwd),
      Bool.and(String.eq(expected_attempt, attempt),
      Bool.and(String.eq(expected_artifact, artifactPath),
      Bool.and(String.eq(decision, "accepted"), accepted_query_state(state))))))))
    case _: False{}

def admission_fields_match(bootstrap: Bootstrap, +admission: Admission.Admission) -> Bool:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}:
      admission_identity_match(owner, request, keeper_path, cwd, origin_attempt,
        artifact_path, admission)

def accepted_admission(+bootstrap: Bootstrap, +role: String, +incarnation: String,
                       +admission: Admission.Admission, +stored_plan: String,
                       +stored_schema: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}:
      Bool.pick(StartDecision,
        Bool.and(admission_fields_match(bootstrap, admission),
        Bool.and(String.eq(plan_value, stored_plan), String.eq(result_schema, stored_schema))),
        StartGranted{query, owner, role, incarnation, request, keeper_path,
          artifact_path, stored_plan, stored_schema},
        StartHeld{"committedAdmissionMismatch"})

def accepted_managed_admission(+bootstrap: Bootstrap, +role: String,
                               +incarnation: String,
                               +admission: Admission.Admission,
                               +stored_plan: String, +stored_identity: String,
                               +stored_schema: String, +artifact_sha: String,
                               +stored_bootstrap: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}:
      Bool.pick(StartDecision,
        Bool.and(admission_fields_match(bootstrap, admission),
        Bool.and(String.eq(plan_value, stored_plan),
        Bool.and(String.eq(plan_identity, stored_identity),
        Bool.and(String.eq(result_schema, stored_schema),
        Bool.and(String.eq(artifact_sha256, artifact_sha),
        String.eq(bootstrap_text(bootstrap), stored_bootstrap)))))),
        StartGranted{query, owner, role, incarnation, request, keeper_path,
          artifact_path, stored_plan, stored_schema},
        StartHeld{"committedManagedAdmissionMismatch"})

def rejection_identity_match(+expected_owner: String, +expected_request: String,
                             +expected_keeper: String, +expected_cwd: String,
                             +expected_attempt: String, +expected_artifact: String,
                             +admission: Admission.Admission) -> Bool:
  match admission:
    case Admission.AdmissionRetained{+owner, +request, decision, state, attempt,
        +keeperPath, +cwd, +artifactPath}:
      Bool.and(String.eq(owner, expected_owner),
      Bool.and(String.eq(request, expected_request),
      Bool.and(String.eq(keeperPath, expected_keeper),
      Bool.and(String.eq(cwd, expected_cwd),
      Bool.and(String.eq(attempt, expected_attempt),
      Bool.and(String.eq(artifactPath, expected_artifact),
      Bool.and(String.eq(decision, "rejected"), String.eq(state, "refused"))))))))
    case _: False{}

def rejected_admission_decision(+bootstrap: Bootstrap,
                                +admission: Admission.Admission) -> StartDecision:
  Bool.pick(StartDecision,
    rejection_identity_match(bootstrap_owner(bootstrap), bootstrap_request(bootstrap),
      bootstrap_keeper_path(bootstrap), bootstrap_cwd(bootstrap),
      bootstrap_attempt(bootstrap), bootstrap_artifact_path(bootstrap), admission),
    StartCancelled{bootstrap_query(bootstrap), bootstrap_owner(bootstrap),
      "admissionRejected", bootstrap_keeper_path(bootstrap)},
    StartHeld{"rejectedAdmissionIdentityMismatch"})

def submission_decision(+bootstrap: Bootstrap, +role: String, +incarnation: String,
                        +submission: ContextService.Submission) -> StartDecision:
  match submission:
    case ContextService.SubmissionAdmitted{+admission, +planValue, resultSchema}:
      accepted_admission(bootstrap, role, incarnation, admission, planValue, resultSchema)
    case ContextService.SubmissionRetainedVerified{+admission, +planValue, resultSchema}:
      accepted_admission(bootstrap, role, incarnation, admission, planValue, resultSchema)
    case ContextService.SubmissionManaged{+admission, +planValue, +planIdentity,
        +resultSchema, +artifactSha256, +bootstrapText}:
      accepted_managed_admission(bootstrap, role, incarnation, admission,
        planValue, planIdentity, resultSchema, artifactSha256, bootstrapText)
    case ContextService.SubmissionManagedUncertain{stage, answer}:
      StartHeld{"managedAdmissionUncertain:" ++ stage}
    case ContextService.SubmissionRetainedUnverified{admission, planValue, resultSchema}:
      StartHeld{"retainedAdmissionUnverified"}
    case ContextService.SubmissionRetainedRejected{+admission, decision, state, owner, request}:
      rejected_admission_decision(bootstrap, admission)
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

# The admission effect runs only after the prepared keeper is attached to the original
# observer with the frozen starter identity. The transaction then binds the same owner,
# canonical request, workspace, attempt, keeper, artifact, and plan to its read-back.
def submit_associated_admission(+bootstrap: Bootstrap, +db: String) -> IO(ContextService.Submission):
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd,
        origin_attempt, source_identity, plan_value, plan_identity, result_schema,
        artifact_path, artifact_sha256, keeper_path, guard_identity, guard_key,
        physical_role_key, owner_witness, recovery_argv}:
      ContextService.admitted_managed_associated(db, database_binding, query,
        owner, request, keeper_path, cwd, origin_attempt, artifact_path,
        plan_value, plan_identity, result_schema, artifact_sha256,
        bootstrap_text(bootstrap))

def submit_after_observer_ready(+bootstrap: Bootstrap, readiness: KeeperReadiness,
                                +db: String) -> IO(StartDecision):
  match readiness:
    case KeeperObserverUnavailable{reason}:
      IO.pure(StartDecision, StartHeld{"observerUnavailable:" ++ reason})
    case KeeperObserverReady{query, owner, keeper_path, +role, +incarnation}:
      Bool.pick(IO(StartDecision),
        Bool.and(String.eq(query, bootstrap_query(bootstrap)),
        Bool.and(String.eq(owner, bootstrap_owner(bootstrap)),
        Bool.and(String.eq(keeper_path, bootstrap_keeper_path(bootstrap)),
        Bool.and(String.eq(role, "starter"), String.eq(incarnation, "0"))))),
        do IO<StartDecision>:
          submission : ContextService.Submission <- submit_associated_admission(bootstrap, db)
          IO.pure(StartDecision, submission_decision(bootstrap, role,
            incarnation, submission)),
        IO.pure(StartDecision, StartHeld{"observerIdentityMismatch"}))

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

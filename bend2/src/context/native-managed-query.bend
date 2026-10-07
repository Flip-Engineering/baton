# Typed bootstrap and start decisions for one managed native context query.
# The host keeper owns preparation and process observation; this module binds the
# request's immutable values to the decision that permits one idempotent start.
import Base
import ../json/canonical.bend as J
import ./bound-admission.bend as Admission
import ./service.bend as ContextService
import ./identity.bend as ContextIdentity
import ./request.bend as Req

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

def readiness_member_value(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def readiness_member(+value: J.Json, +key: String) -> J.Json:
  match value:
    case J.Jobj{+members}: readiness_member_value(Req.member_lookup(key, members))
    case other: J.Jnil{}

def readiness_text(+value: J.Json, +key: String) -> String:
  Req.text_of(readiness_member(value, key))

def readiness_json_text(+value: J.Json, +key: String) -> String:
  J.json_text(readiness_member(value, key))

def readiness_true(+value: J.Json, +key: String) -> Bool:
  match readiness_member(value, key):
    case J.Jtrue{}: True{}
    case other: False{}

def readiness_false(+value: J.Json, +key: String) -> Bool:
  match readiness_member(value, key):
    case J.Jfalse{}: True{}
    case other: False{}

def readiness_key_allowed(+key: String) -> Bool:
  Bool.or(String.eq(key, "schema"), Bool.or(String.eq(key, "state"),
  Bool.or(String.eq(key, "handle"), Bool.or(String.eq(key, "directory"),
  Bool.or(String.eq(key, "ownerIncarnation"), Bool.or(String.eq(key, "ownerEpoch"),
  Bool.or(String.eq(key, "ownerAttempt"), Bool.or(String.eq(key, "guardDevice"),
  Bool.or(String.eq(key, "guardInode"), Bool.or(String.eq(key, "guard"),
  Bool.or(String.eq(key, "observer_ready"), Bool.or(String.eq(key, "native_pid"),
  Bool.or(String.eq(key, "status_known"), Bool.or(String.eq(key, "status"),
  Bool.or(String.eq(key, "spawn_latched"), Bool.or(String.eq(key, "cancelled"),
  Bool.or(String.eq(key, "identity"), Bool.or(String.eq(key, "expectedBinding"),
  Bool.or(String.eq(key, "grant"), String.eq(key, "rejection"))))))))))))))))))))

def readiness_members_allowed(+members: J.Json) -> Bool:
  match members:
    case J.Jpair{key, value, +rest}:
      Bool.and(readiness_key_allowed(key), readiness_members_allowed(rest))
    case J.Jnil{}: True{}
    case other: False{}

def readiness_member_present(found: Maybe<&2, J.Json>) -> Bool:
  match found:
    case Some{value}: True{}
    case None{}: False{}

def readiness_has(+members: J.Json, +key: String) -> Bool:
  readiness_member_present(Req.member_lookup(key, members))

def readiness_required_members(+members: J.Json) -> Bool:
  Bool.and(readiness_has(members, "schema"),
  Bool.and(readiness_has(members, "state"),
  Bool.and(readiness_has(members, "handle"),
  Bool.and(readiness_has(members, "directory"),
  Bool.and(readiness_has(members, "ownerIncarnation"),
  Bool.and(readiness_has(members, "ownerEpoch"),
  Bool.and(readiness_has(members, "ownerAttempt"),
  Bool.and(readiness_has(members, "guardDevice"),
  Bool.and(readiness_has(members, "guardInode"),
  Bool.and(readiness_has(members, "guard"),
  Bool.and(readiness_has(members, "observer_ready"),
  Bool.and(readiness_has(members, "native_pid"),
  Bool.and(readiness_has(members, "status_known"),
  Bool.and(readiness_has(members, "status"),
  Bool.and(readiness_has(members, "spawn_latched"),
  Bool.and(readiness_has(members, "cancelled"),
  Bool.and(readiness_has(members, "identity"),
  Bool.and(readiness_has(members, "expectedBinding"),
  Bool.and(readiness_has(members, "grant"), readiness_has(members, "rejection"))))))))))))))))))))

def readiness_closed(+value: J.Json) -> Bool:
  match value:
    case J.Jobj{+members}:
      Bool.and(readiness_required_members(members), readiness_members_allowed(members))
    case other: False{}

def keeper_readiness_from_host(+bootstrap: Bootstrap, +expected_binding: String,
                               +owner_witness: String, +value: J.Json) -> KeeperReadiness:
  Bool.pick(KeeperReadiness,
    Bool.and(readiness_closed(value),
    Bool.and(String.eq(readiness_text(value, "schema"), "baton2-host-ready-v1"),
    Bool.and(String.eq(readiness_text(value, "state"), "ready"),
    Bool.and(String.eq(readiness_text(value, "directory"), bootstrap_keeper_path(bootstrap)),
    Bool.and(readiness_true(value, "observer_ready"),
    Bool.and(String.eq(readiness_text(value, "identity"), "fixed"),
    Bool.and(String.eq(readiness_text(value, "expectedBinding"), expected_binding),
    Bool.and(String.eq(readiness_json_text(value, "ownerIncarnation") ++ ":"
      ++ readiness_json_text(value, "ownerEpoch"), owner_witness),
    Bool.and(readiness_false(value, "spawn_latched"),
    Bool.and(readiness_false(value, "cancelled"),
    readiness_false(value, "status_known"))))))))))),
    KeeperObserverReady{bootstrap_query(bootstrap), bootstrap_owner(bootstrap),
      bootstrap_keeper_path(bootstrap), "starter", "0"},
    KeeperObserverUnavailable{"hostReadinessMismatch"})

def nullable_text(+value: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(value), J.Jnil{}, J.Jstr{value})

def bootstrap_json(+bootstrap: Bootstrap) -> J.Json:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv}:
      J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-managed-context-bootstrap-v1"},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"databaseBinding", J.Jstr{database_binding},
      J.Jpair{"request", J.Jstr{request},
      J.Jpair{"cwd", J.Jstr{cwd},
      J.Jpair{"originAttempt", nullable_text(origin_attempt),
      J.Jpair{"planValue", J.Jstr{plan_value},
      J.Jpair{"planIdentity", J.Jstr{plan_identity},
      J.Jpair{"resultSchema", J.Jstr{result_schema},
      J.Jpair{"artifactPath", J.Jstr{artifact_path},
      J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"guardIdentity", J.Jstr{guard_identity},
      J.Jpair{"guardKey", J.Jstr{guard_key},
      J.Jpair{"recoveryArgv", J.Jstr{recovery_argv}, J.Jnil{}}}}}}}}}}}}}}}}}}

def start_decision_json(decision: StartDecision) -> J.Json:
  match decision:
    case StartGranted{query, owner, role, incarnation, request, keeper_path,
        artifact_path, plan_value, result_schema}:
      J.Jobj{J.Jpair{"artifactPath", J.Jstr{artifact_path},
      J.Jpair{"incarnation", J.Jstr{incarnation},
      J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"planValue", J.Jstr{plan_value},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"request", J.Jstr{request},
      J.Jpair{"resultSchema", J.Jstr{result_schema},
      J.Jpair{"role", J.Jstr{role},
      J.Jpair{"schema", J.Jstr{"baton2-managed-context-start-v1"}, J.Jnil{}}}}}}}}}}}
    case StartCancelled{query, owner, reason, keeper_path}:
      J.Jobj{J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"reason", J.Jstr{reason},
      J.Jpair{"schema", J.Jstr{"baton2-managed-context-cancel-v1"}, J.Jnil{}}}}}}}
    case StartHeld{reason}:
      J.Jobj{J.Jpair{"reason", J.Jstr{reason},
      J.Jpair{"schema", J.Jstr{"baton2-managed-context-held-v1"}, J.Jnil{}}}}

def start_decision_text(decision: StartDecision) -> String:
  J.json_text(start_decision_json(decision))

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

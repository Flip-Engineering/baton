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
    physical_role_key: String, owner_witness: String, recovery_argv: String,
    executable_path: String, runtime_path: String, provider_path: String,
    invocation_path: String, invocation_sha256: String, answers_text: String}

type ArtifactEvidence is Data:
  ArtifactEvidence{source_identity: String, artifact_sha256: String}

type BootstrapDecode is Data:
  BootstrapDecoded{bootstrap: Bootstrap}
  BootstrapDecodeRefused{reason: String}

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
                    +recovery_argv: String, +executable_path: String,
                    +runtime_path: String, +provider_path: String,
                    +invocation_path: String, +invocation_sha256: String,
                    +answers_text: String) -> Bootstrap:
  match artifact_evidence:
    case ArtifactEvidence{source_identity, artifact_sha256}:
      QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path,
        ContextIdentity.guard_identity(database_binding,
          ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{}, "0"),
        guard_key, physical_role_key, owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}

def bootstrap_answers_text(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: answers_text

def bootstrap_query(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: query

def bootstrap_database_binding(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: database_binding

def bootstrap_plan_value(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: plan_value

def bootstrap_plan_identity(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: plan_identity

def bootstrap_result_schema(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: result_schema

def bootstrap_guard_key(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: guard_key

def bootstrap_recovery_argv(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: recovery_argv

def bootstrap_owner(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: owner

def bootstrap_request(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: request

def bootstrap_cwd(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: cwd

def bootstrap_attempt(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: origin_attempt

def bootstrap_keeper_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: keeper_path

def bootstrap_artifact_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: artifact_path

def bootstrap_artifact_sha256(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: artifact_sha256

def bootstrap_physical_role_key(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: physical_role_key

def bootstrap_owner_witness(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}: owner_witness

def bootstrap_executable_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}: executable_path

def bootstrap_runtime_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}: runtime_path

def bootstrap_provider_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}: provider_path

def bootstrap_invocation_path(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}: invocation_path

def bootstrap_invocation_sha256(bootstrap: Bootstrap) -> String:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}: invocation_sha256

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

def readiness_is_true(+member: J.Json) -> Bool:
  match member:
    case J.Jtrue{}: True{}
    case other: False{}

def readiness_is_false(+member: J.Json) -> Bool:
  match member:
    case J.Jfalse{}: True{}
    case other: False{}

def readiness_true(+value: J.Json, +key: String) -> Bool:
  readiness_is_true(readiness_member(value, key))

def readiness_false(+value: J.Json, +key: String) -> Bool:
  readiness_is_false(readiness_member(value, key))

def readiness_member_present(found: Maybe<&2, J.Json>) -> Bool:
  match found:
    case Some{value}: True{}
    case None{}: False{}

def readiness_has(+members: J.Json, +key: String) -> Bool:
  readiness_member_present(Req.member_lookup(key, members))

def readiness_object(+value: J.Json) -> Bool:
  match value:
    case J.Jobj{+members}: True{}
    case other: False{}

def keeper_readiness_from_host(+bootstrap: Bootstrap, +expected_binding: String,
                               +owner_witness: String, +value: J.Json) -> KeeperReadiness:
  Bool.pick(KeeperReadiness,
    Bool.and(readiness_object(value),
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

def recovery_state_supported(+state: String) -> Bool:
  Bool.or(String.eq(state, "running"), String.eq(state, "exited"))

def recovery_state_latch_matches(+state: String, +value: J.Json) -> Bool:
  Bool.and(recovery_state_supported(state), readiness_true(value, "spawn_latched"))

def recovery_state_status_matches(+state: String, +value: J.Json) -> Bool:
  Bool.pick(Bool, String.eq(state, "exited"), readiness_true(value, "status_known"),
    Bool.pick(Bool, String.eq(state, "running"),
      readiness_false(value, "status_known"),
      recovery_state_supported(state)))

def custody_transition_key_allowed(+key: String) -> Bool:
  Bool.or(String.eq(key, "schema"), Bool.or(String.eq(key, "directory"),
  Bool.or(String.eq(key, "oldOwnerWitness"), Bool.or(String.eq(key, "currentOwnerWitness"),
  Bool.or(String.eq(key, "attemptManifest"), Bool.or(String.eq(key, "ownerAttempt"),
  Bool.or(String.eq(key, "nativePid"), Bool.or(String.eq(key, "nativeBirth"),
  Bool.or(String.eq(key, "custodyMode"), Bool.or(String.eq(key, "observation"),
  Bool.or(String.eq(key, "historicalGuard"), String.eq(key, "terminalStatus"))))))))))))

def custody_transition_members_allowed(+members: J.Json) -> Bool:
  match members:
    case J.Jpair{key, value, +rest}:
      Bool.and(custody_transition_key_allowed(key), custody_transition_members_allowed(rest))
    case J.Jnil{}: True{}
    case other: False{}

def custody_transition_required(+members: J.Json) -> Bool:
  Bool.and(readiness_has(members, "schema"),
  Bool.and(readiness_has(members, "directory"),
  Bool.and(readiness_has(members, "oldOwnerWitness"),
  Bool.and(readiness_has(members, "currentOwnerWitness"),
  Bool.and(readiness_has(members, "attemptManifest"),
  Bool.and(readiness_has(members, "ownerAttempt"),
  Bool.and(readiness_has(members, "nativePid"),
  Bool.and(readiness_has(members, "nativeBirth"),
  Bool.and(readiness_has(members, "custodyMode"),
  Bool.and(readiness_has(members, "observation"),
  Bool.and(readiness_has(members, "historicalGuard"),
    readiness_has(members, "terminalStatus"))))))))))))

def custody_transition_identity_matches(+bootstrap: Bootstrap, +current_witness: String,
                                        +value: J.Json) -> Bool:
  Bool.and(String.eq(readiness_text(value, "schema"), "baton2-custody-transition-v1"),
  Bool.and(String.eq(readiness_text(value, "directory"), bootstrap_keeper_path(bootstrap)),
  Bool.and(String.eq(readiness_text(value, "oldOwnerWitness"), bootstrap_owner_witness(bootstrap)),
  String.eq(readiness_text(value, "currentOwnerWitness"), current_witness))))

def custody_transition_facts_match(+value: J.Json) -> Bool:
  Bool.and(Nat.is_eq(String.length(readiness_text(value, "attemptManifest")), 16n),
  Bool.and(Bool.not(String.is_empty(readiness_json_text(value, "ownerAttempt"))),
  Bool.and(Bool.not(String.is_empty(readiness_json_text(value, "nativePid"))),
  Bool.not(String.is_empty(readiness_text(value, "nativeBirth"))))))

def custody_transition_pid_matches(+transition: J.Json, +host: J.Json) -> Bool:
  String.eq(readiness_json_text(transition, "nativePid"),
    readiness_json_text(host, "native_pid"))

def custody_transition_mode_matches(+bootstrap: Bootstrap, +current_witness: String,
                                    +value: J.Json) -> Bool:
  Bool.and(String.eq(readiness_text(value, "historicalGuard"), "not-carried"),
    Bool.pick(Bool, String.eq(readiness_text(value, "custodyMode"), "same-owner-observer"),
      String.eq(current_witness, bootstrap_owner_witness(bootstrap)),
      Bool.and(String.eq(readiness_text(value, "custodyMode"), "owner-rebound-monitor"),
        Bool.not(String.eq(current_witness, bootstrap_owner_witness(bootstrap))))))

def custody_transition_status_matches(+value: J.Json) -> Bool:
  Bool.pick(Bool, String.eq(readiness_text(value, "observation"), "live"),
    String.eq(readiness_text(value, "terminalStatus"), "unavailable"),
    Bool.and(String.eq(readiness_text(value, "observation"), "exited"),
      String.eq(readiness_text(value, "terminalStatus"), "known")))

def custody_transition_host_status_matches(+transition: J.Json, +host: J.Json) -> Bool:
  Bool.pick(Bool, String.eq(readiness_text(transition, "observation"), "live"),
    Bool.and(String.eq(readiness_text(host, "state"), "running"),
      readiness_false(host, "status_known")),
    Bool.and(String.eq(readiness_text(host, "state"), "exited"),
      readiness_true(host, "status_known")))

def custody_transition_matches(+bootstrap: Bootstrap, +current_witness: String,
                               +value: J.Json) -> Bool:
  match value:
    case J.Jobj{+members}:
      Bool.and(custody_transition_required(members),
      Bool.and(custody_transition_members_allowed(members),
      Bool.and(custody_transition_identity_matches(bootstrap, current_witness, value),
      Bool.and(Bool.not(String.is_empty(current_witness)),
      Bool.and(custody_transition_facts_match(value),
      Bool.and(custody_transition_status_matches(value),
        custody_transition_mode_matches(bootstrap, current_witness, value)))))))
    case other: False{}

# Recovery readiness is derived from the attached keeper's host record.
# It accepts only a live process with unknown terminal status or an exited
# process with a durable terminal status, and requires the typed witness
# transition returned by the elected owner.
def keeper_recovery_readiness_from_host(+bootstrap: Bootstrap,
                                       +expected_binding: String,
                                       +owner_witness: String,
                                       +transition: J.Json,
                                       +value: J.Json) -> KeeperReadiness:
  Bool.pick(KeeperReadiness,
    Bool.and(custody_transition_matches(bootstrap, owner_witness, transition),
    Bool.and(custody_transition_pid_matches(transition, value),
    Bool.and(custody_transition_host_status_matches(transition, value),
    Bool.and(readiness_object(value),
    Bool.and(String.eq(readiness_text(value, "schema"), "baton2-host-ready-v1"),
    Bool.and(recovery_state_latch_matches(readiness_text(value, "state"), value),
    Bool.and(recovery_state_status_matches(readiness_text(value, "state"), value),
    Bool.and(String.eq(readiness_text(value, "directory"), bootstrap_keeper_path(bootstrap)),
    Bool.and(readiness_true(value, "observer_ready"),
    Bool.and(String.eq(readiness_text(value, "identity"), "fixed"),
    Bool.and(String.eq(readiness_text(value, "expectedBinding"), expected_binding),
    Bool.and(String.eq(readiness_json_text(value, "ownerIncarnation") ++ ":"
      ++ readiness_json_text(value, "ownerEpoch"), owner_witness),
      readiness_false(value, "cancelled"))))))))))))),
    KeeperObserverReady{bootstrap_query(bootstrap), bootstrap_owner(bootstrap),
      bootstrap_keeper_path(bootstrap), "starter", "0"},
    KeeperObserverUnavailable{"hostRecoveryReadinessMismatch"})

def bootstrap_from_json(+value: J.Json, +expected_owner: String,
                        +expected_query: String) -> BootstrapDecode:
  match value:
    case J.Jobj{+members}:
      +query = Req.text_of(readiness_member(value, "query"))
      +owner = Req.text_of(readiness_member(value, "owner"))
      +database_binding = Req.text_of(readiness_member(value, "databaseBinding"))
      +request = Req.text_of(readiness_member(value, "request"))
      +cwd = Req.text_of(readiness_member(value, "cwd"))
      origin_attempt = Req.text_of(readiness_member(value, "originAttempt"))
      +plan_value = Req.text_of(readiness_member(value, "planValue"))
      +plan_identity = Req.text_of(readiness_member(value, "planIdentity"))
      +result_schema = Req.text_of(readiness_member(value, "resultSchema"))
      +artifact_path = Req.text_of(readiness_member(value, "artifactPath"))
      +artifact_sha256 = Req.text_of(readiness_member(value, "artifactSha256"))
      +keeper_path = Req.text_of(readiness_member(value, "keeperPath"))
      +guard_identity = Req.text_of(readiness_member(value, "guardIdentity"))
      +guard_key = Req.text_of(readiness_member(value, "guardKey"))
      +physical_role_key = Req.text_of(readiness_member(value, "physicalRoleKey"))
      +owner_witness = Req.text_of(readiness_member(value, "ownerWitness"))
      +recovery_argv = Req.text_of(readiness_member(value, "recoveryArgv"))
      +source_identity = Req.text_of(readiness_member(value, "sourceIdentity"))
      +executable_path = Req.text_of(readiness_member(value, "executablePath"))
      +runtime_path = Req.text_of(readiness_member(value, "runtimePath"))
      +provider_path = Req.text_of(readiness_member(value, "providerPath"))
      +invocation_path = Req.text_of(readiness_member(value, "invocationPath"))
      +invocation_sha256 = Req.text_of(readiness_member(value, "invocationSha256"))
      +answers_text = Req.text_of(readiness_member(value, "answersText"))
      Bool.pick(BootstrapDecode,
        Bool.and(String.eq(readiness_text(value, "schema"), "baton2-managed-context-bootstrap-v2"),
        Bool.and(String.eq(query, expected_query),
        Bool.and(String.eq(owner, expected_owner),
        Bool.and(Nat.is_eq(String.length(guard_key), 64n),
        Bool.and(Nat.is_eq(String.length(artifact_sha256), 64n),
        Bool.and(Nat.is_eq(String.length(physical_role_key), 64n),
        Bool.and(Bool.not(String.is_empty(owner_witness)),
        Bool.and(Bool.not(String.is_empty(source_identity)),
        Bool.and(String.eq(guard_identity,
          ContextIdentity.guard_identity(database_binding,
            ContextIdentity.SubjectQuery{query}, ContextIdentity.RoleStarter{}, "0")),
        Bool.and(Bool.not(String.is_empty(request)),
        Bool.and(Bool.not(String.is_empty(cwd)),
        Bool.and(Bool.not(String.is_empty(plan_value)),
        Bool.and(Bool.not(String.is_empty(plan_identity)),
        Bool.and(Bool.not(String.is_empty(result_schema)),
        Bool.and(Bool.not(String.is_empty(artifact_path)),
        Bool.and(Bool.not(String.is_empty(keeper_path)),
        Bool.and(Bool.not(String.is_empty(recovery_argv)),
        Bool.and(Bool.not(String.is_empty(executable_path)),
        Bool.and(Bool.not(String.is_empty(runtime_path)),
        Bool.and(Bool.not(String.is_empty(provider_path)),
        Bool.and(String.eq(invocation_path, keeper_path ++ "/invocation.json"),
          Nat.is_eq(String.length(invocation_sha256), 64n))))))))))))))))))))))
        BootstrapDecoded{QueryBootstrap{query, owner, database_binding,
          request, cwd, origin_attempt, source_identity, plan_value, plan_identity,
          result_schema, artifact_path, artifact_sha256, keeper_path, guard_identity,
          guard_key, physical_role_key, owner_witness, recovery_argv,
          executable_path, runtime_path, provider_path, invocation_path,
          invocation_sha256, answers_text}},
        BootstrapDecodeRefused{"managedBootstrapIdentityMismatch"})
    case other: BootstrapDecodeRefused{"managedBootstrapShape"}

def nullable_text(+value: String) -> J.Json:
  Bool.pick(J.Json, String.is_empty(value), J.Jnull{}, J.Jstr{value})

# Preserve the member set of retained bootstraps that predate answer storage.
def bootstrap_answers_json(answers_text: String, +members: J.Json) -> J.Json:
  match answers_text:
    case SNil{}: members
    case SCon{head, tail}: J.Jpair{"answersText", J.Jstr{SCon{head, tail}}, members}

def bootstrap_json(+bootstrap: Bootstrap) -> J.Json:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}:
      J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-managed-context-bootstrap-v2"},
      bootstrap_answers_json(answers_text,
      J.Jpair{"artifactPath", J.Jstr{artifact_path},
      J.Jpair{"artifactSha256", J.Jstr{artifact_sha256},
      J.Jpair{"cwd", J.Jstr{cwd},
      J.Jpair{"databaseBinding", J.Jstr{database_binding},
      J.Jpair{"executablePath", J.Jstr{executable_path},
      J.Jpair{"guardIdentity", J.Jstr{guard_identity},
      J.Jpair{"guardKey", J.Jstr{guard_key},
      J.Jpair{"invocationPath", J.Jstr{invocation_path},
      J.Jpair{"invocationSha256", J.Jstr{invocation_sha256},
      J.Jpair{"keeperPath", J.Jstr{keeper_path},
      J.Jpair{"originAttempt", nullable_text(origin_attempt),
      J.Jpair{"owner", J.Jstr{owner},
      J.Jpair{"ownerWitness", J.Jstr{owner_witness},
      J.Jpair{"physicalRoleKey", J.Jstr{physical_role_key},
      J.Jpair{"planIdentity", J.Jstr{plan_identity},
      J.Jpair{"planValue", J.Jstr{plan_value},
      J.Jpair{"providerPath", J.Jstr{provider_path},
      J.Jpair{"query", J.Jstr{query},
      J.Jpair{"recoveryArgv", J.Jstr{recovery_argv},
      J.Jpair{"request", J.Jstr{request},
      J.Jpair{"resultSchema", J.Jstr{result_schema},
      J.Jpair{"runtimePath", J.Jstr{runtime_path},
      J.Jpair{"sourceIdentity", J.Jstr{source_identity}, J.Jnil{}}}}}}}}}}}}}}}}}}}}}}}})}}

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
      J.Jpair{"schema", J.Jstr{"baton2-managed-context-start-v1"}, J.Jnil{}}}}}}}}}}}}
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

def recovery_query_state(+state: String) -> Bool:
  Bool.or(accepted_query_state(state),
    Bool.or(String.eq(state, "complete"),
    Bool.or(String.eq(state, "failed"), String.eq(state, "interrupted"))))

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
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}:
      admission_identity_match(owner, request, keeper_path, cwd, origin_attempt,
        artifact_path, admission)

def recovery_admission_identity_match(+expected_owner: String,
                                      +expected_request: String,
                                      +expected_keeper: String,
                                      +expected_cwd: String,
                                      +expected_attempt: String,
                                      +expected_artifact: String,
                                      +admission: Admission.Admission) -> Bool:
  match admission:
    case Admission.AdmissionCreated{+owner, +request, decision, state, attempt,
        +keeperPath, +cwd, +artifactPath}:
      Bool.and(String.eq(owner, expected_owner),
      Bool.and(String.eq(request, expected_request),
      Bool.and(String.eq(keeperPath, expected_keeper),
      Bool.and(String.eq(cwd, expected_cwd),
      Bool.and(String.eq(attempt, expected_attempt),
      Bool.and(String.eq(artifactPath, expected_artifact),
      Bool.and(String.eq(decision, "accepted"), recovery_query_state(state))))))))
    case Admission.AdmissionRetained{+owner, +request, decision, state, attempt,
        +keeperPath, +cwd, +artifactPath}:
      Bool.and(String.eq(owner, expected_owner),
      Bool.and(String.eq(request, expected_request),
      Bool.and(String.eq(keeperPath, expected_keeper),
      Bool.and(String.eq(cwd, expected_cwd),
      Bool.and(String.eq(attempt, expected_attempt),
      Bool.and(String.eq(artifactPath, expected_artifact),
      Bool.and(String.eq(decision, "accepted"), recovery_query_state(state))))))))
    case _: False{}

def recovery_admission_fields_match(bootstrap: Bootstrap,
                                    +admission: Admission.Admission) -> Bool:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}:
      recovery_admission_identity_match(owner, request, keeper_path, cwd,
        origin_attempt, artifact_path, admission)

def accepted_admission(+bootstrap: Bootstrap, +role: String, +incarnation: String,
                       +admission: Admission.Admission, +stored_plan: String,
                       +stored_schema: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}:
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
                               +stored_bootstrap: String, +stored_answers: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}:
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

def accepted_recovery_managed_admission(+bootstrap: Bootstrap, +role: String,
                                        +incarnation: String,
                                        +admission: Admission.Admission,
                                        +stored_plan: String,
                                        +stored_identity: String,
                                        +stored_schema: String,
                                        +artifact_sha: String,
                                        +stored_bootstrap: String, +stored_answers: String) -> StartDecision:
  match bootstrap:
    case QueryBootstrap{query, owner, database_binding, request, cwd, origin_attempt,
        source_identity, plan_value, plan_identity, result_schema, artifact_path,
        artifact_sha256, keeper_path, guard_identity, guard_key, physical_role_key,
        owner_witness, recovery_argv, executable_path, runtime_path, provider_path,
        invocation_path, invocation_sha256, answers_text}:
      Bool.pick(StartDecision,
        Bool.and(recovery_admission_fields_match(bootstrap, admission),
        Bool.and(String.eq(plan_value, stored_plan),
        Bool.and(String.eq(plan_identity, stored_identity),
        Bool.and(String.eq(result_schema, stored_schema),
        Bool.and(String.eq(artifact_sha256, artifact_sha),
        String.eq(bootstrap_text(bootstrap), stored_bootstrap)))))),
        StartGranted{query, owner, role, incarnation, request, keeper_path,
          artifact_path, stored_plan, stored_schema},
        StartHeld{"recoveryManagedAdmissionMismatch"})

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
        +resultSchema, +artifactSha256, +bootstrapText, +answersText}:
      accepted_managed_admission(bootstrap, role, incarnation, admission,
        planValue, planIdentity, resultSchema, artifactSha256, bootstrapText, answersText)
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

def reconcile_admission_association(+bootstrap: Bootstrap, +role: String,
                                    +incarnation: String,
                                    +admission: Admission.Admission,
                                    recovery: Bool,
                                    association: Result<&1,&1,U32 & String,Admission.ManagedAssociation>) -> StartDecision:
  match association:
    case Fail{error}: StartHeld{"committedDecisionAssociationUnavailable"}
    case Done{+stored}:
      match stored:
        case Admission.ManagedAssociationStored{+planValue, +planIdentity,
            +resultSchema, +artifactSha256, +bootstrapText, +answersText}:
          Bool.pick(StartDecision, recovery,
            accepted_recovery_managed_admission(bootstrap, role, incarnation,
              admission, planValue, planIdentity, resultSchema, artifactSha256,
              bootstrapText, answersText),
            accepted_managed_admission(bootstrap, role, incarnation, admission,
              planValue, planIdentity, resultSchema, artifactSha256, bootstrapText, answersText))
        case other: StartHeld{"committedDecisionAssociationMissing"}

def reconciled_admission_decision(+bootstrap: Bootstrap, +role: String,
                                  +incarnation: String,
                                  +admission: Admission.Admission,
                                  recovery: Bool,
                                  association: Result<&1,&1,U32 & String,Admission.ManagedAssociation>) -> StartDecision:
  Bool.pick(StartDecision,
    rejection_identity_match(bootstrap_owner(bootstrap), bootstrap_request(bootstrap),
      bootstrap_keeper_path(bootstrap), bootstrap_cwd(bootstrap),
      bootstrap_attempt(bootstrap), bootstrap_artifact_path(bootstrap), admission),
    rejected_admission_decision(bootstrap, admission),
    reconcile_admission_association(bootstrap, role, incarnation, admission,
      recovery, association))

def reconcile_stored_admission(+bootstrap: Bootstrap, +role: String,
                               +incarnation: String, +db: String,
                               recovery: Bool,
                               +admission: Admission.Admission) -> IO(StartDecision):
  do IO<StartDecision>:
    association : Result<&1,&1,U32 & String,Admission.ManagedAssociation> <-
      Admission.readback_managed_association(db,
        bootstrap_database_binding(bootstrap), bootstrap_query(bootstrap))
    IO.pure(StartDecision, reconciled_admission_decision(bootstrap,
      role, incarnation, admission, recovery, association))

def reconcile_admission_result(+bootstrap: Bootstrap, +role: String,
                               +incarnation: String, +db: String,
                               recovery: Bool,
                               result: Result<&1,&1,U32 & String,Admission.Admission>) -> IO(StartDecision):
  match result:
    case Fail{error}: IO.pure(StartDecision,
      StartHeld{"committedDecisionReadbackUnavailable"})
    case Done{+admission}: reconcile_stored_admission(bootstrap, role,
      incarnation, db, recovery, admission)

def reconcile_committed_admission_mode(+bootstrap: Bootstrap, +role: String,
                                      +incarnation: String, +db: String,
                                      recovery: Bool) -> IO(StartDecision):
  do IO<StartDecision>:
    admission : Result<&1,&1,U32 & String,Admission.Admission> <-
      Admission.readback(db, bootstrap_database_binding(bootstrap),
        bootstrap_query(bootstrap))
    reconcile_admission_result(bootstrap, role, incarnation, db, recovery, admission)

def reconcile_committed_admission(+bootstrap: Bootstrap, +role: String,
                                 +incarnation: String, +db: String) -> IO(StartDecision):
  reconcile_committed_admission_mode(bootstrap, role, incarnation, db, False{})

def reconcile_recovery_admission(+bootstrap: Bootstrap, +role: String,
                                 +incarnation: String, +db: String) -> IO(StartDecision):
  reconcile_committed_admission_mode(bootstrap, role, incarnation, db, True{})

def reconcile_unresolved_decision(+bootstrap: Bootstrap, +role: String,
                                  +incarnation: String, +db: String,
                                  +decision: StartDecision) -> IO(StartDecision):
  match decision:
    case StartGranted{query, owner, role, incarnation, request, keeper_path,
        artifact_path, plan_value, result_schema}:
      IO.pure(StartDecision, StartGranted{query, owner, role, incarnation,
        request, keeper_path, artifact_path, plan_value, result_schema})
    case StartCancelled{query, owner, reason, keeper_path}:
      IO.pure(StartDecision, StartCancelled{query, owner, reason, keeper_path})
    case StartHeld{reason}:
      reconcile_committed_admission(bootstrap, role, incarnation, db)

def submission_or_reconcile(+bootstrap: Bootstrap, +role: String,
                            +incarnation: String, +db: String,
                            +submission: ContextService.Submission) -> IO(StartDecision):
  reconcile_unresolved_decision(bootstrap, role, incarnation, db,
    submission_decision(bootstrap, role, incarnation, submission))

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
        physical_role_key, owner_witness, recovery_argv, executable_path, runtime_path, provider_path, invocation_path, invocation_sha256, answers_text}:
      ContextService.admitted_managed_associated(db, database_binding, query,
        owner, request, keeper_path, cwd, origin_attempt, artifact_path,
        plan_value, plan_identity, result_schema, artifact_sha256,
        bootstrap_text(bootstrap), answers_text)

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
          submission_or_reconcile(bootstrap, role, incarnation, db, submission),
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

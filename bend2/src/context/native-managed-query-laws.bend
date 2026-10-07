# Operative laws for the sourceAnalysis managed starter boundary.
import Base
import ./native-managed-query.bend as Managed
import ./bound-admission.bend as Admission
import ./service.bend as Service
import ../json/canonical.bend as J

def managed_bootstrap() -> Managed.Bootstrap:
  Managed.query_bootstrap("db-binding", "q-1", "owner-1", "{}", "/work", "0",
    Managed.ArtifactEvidence{"source-identity",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    "[]", "plan-identity", "result-v1", "/work/.baton/context-artifacts/q",
    "/logs/keeper-q", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "owner-token:1", "native-recover-argv", "/opt/baton2/bin/baton2",
    "/usr/bin/node", "/opt/baton2/libexec/baton2/context-provider.mjs",
    "/logs/keeper-q/invocation.json",
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")

law sealed_bootstrap_recovery_preserves_the_original_owner_witness_and_artifact:
  {Managed.bootstrap_from_json(Managed.bootstrap_json(managed_bootstrap()),
    "owner-1", "q-1") == Managed.BootstrapDecoded{managed_bootstrap()} : Managed.BootstrapDecode}

def sealed_bootstrap_recovery_preserves_the_original_owner_witness_and_artifact():
  {==}

law an_absent_origin_attempt_serializes_as_null:
  {Managed.nullable_text("") == J.Jnil{} : J.Json}

def an_absent_origin_attempt_serializes_as_null():
  {==}

law the_captured_active_attempt_remains_the_launch_provenance:
  {Managed.bootstrap_attempt(managed_bootstrap()) == "0" : String}

def the_captured_active_attempt_remains_the_launch_provenance():
  {==}

law the_sealed_bootstrap_retains_the_executable_runtime_and_invocation_identity:
  {Managed.bootstrap_executable_path(managed_bootstrap()) ++ "\n"
    ++ Managed.bootstrap_runtime_path(managed_bootstrap()) ++ "\n"
    ++ Managed.bootstrap_provider_path(managed_bootstrap()) ++ "\n"
    ++ Managed.bootstrap_invocation_path(managed_bootstrap()) ++ "\n"
    ++ Managed.bootstrap_invocation_sha256(managed_bootstrap()) ==
    "/opt/baton2/bin/baton2\n/usr/bin/node\n/opt/baton2/libexec/baton2/context-provider.mjs\n/logs/keeper-q/invocation.json\ncccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" : String}

def the_sealed_bootstrap_retains_the_executable_runtime_and_invocation_identity():
  {==}

law a_granted_start_has_a_canonical_core_decision_document:
  {Managed.start_decision_text(Managed.StartGranted{"q-1", "owner-1", "starter", "0",
    "{}", "/logs/keeper-q", "/work/.baton/context-artifacts/q", "[]", "result-v1"}) ==
    "{\"artifactPath\":\"/work/.baton/context-artifacts/q\",\"incarnation\":\"0\",\"keeperPath\":\"/logs/keeper-q\",\"owner\":\"owner-1\",\"planValue\":\"[]\",\"query\":\"q-1\",\"request\":\"{}\",\"resultSchema\":\"result-v1\",\"role\":\"starter\",\"schema\":\"baton2-managed-context-start-v1\"}" : String}

def a_granted_start_has_a_canonical_core_decision_document():
  {==}

def accepted_admission() -> Admission.Admission:
  Admission.AdmissionCreated{"owner-1", "{}", "accepted", "accepted", "0",
    "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"}

def accepted_submission() -> Service.Submission:
  Service.SubmissionAdmitted{accepted_admission(), "[]", "result-v1"}

def ready_keeper() -> Managed.KeeperReadiness:
  Managed.KeeperObserverReady{"q-1", "owner-1", "/logs/keeper-q", "starter", "0"}

def ready_host_json(+binding: String, +incarnation: U32, +epoch: U32) -> J.Json:
  J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-host-ready-v1"},
  J.Jpair{"state", J.Jstr{"ready"},
  J.Jpair{"handle", J.Jint{1},
  J.Jpair{"directory", J.Jstr{"/logs/keeper-q"},
  J.Jpair{"ownerAttempt", J.Jint{1},
  J.Jpair{"guardDevice", J.Jint{1},
  J.Jpair{"guardInode", J.Jint{1},
  J.Jpair{"guard", J.Jstr{"1:1"},
  J.Jpair{"observer_ready", J.Jtrue{},
  J.Jpair{"native_pid", J.Jint{0},
  J.Jpair{"status", J.Jint{0},
  J.Jpair{"identity", J.Jstr{"fixed"},
  J.Jpair{"expectedBinding", J.Jstr{binding},
  J.Jpair{"ownerIncarnation", J.Jint{incarnation},
  J.Jpair{"ownerEpoch", J.Jint{epoch},
  J.Jpair{"spawn_latched", J.Jfalse{},
  J.Jpair{"cancelled", J.Jfalse{},
  J.Jpair{"grant", J.Jstr{""},
  J.Jpair{"rejection", J.Jstr{""},
  J.Jpair{"status_known", J.Jfalse{}, J.Jnil{}}}}}}}}}}}}}}}}}}}}}}

law host_readiness_requires_the_bootstrap_digest_and_current_owner_witness:
  {Managed.keeper_readiness_from_host(managed_bootstrap(), "binding-digest", "7:1",
    ready_host_json("binding-digest", 7, 1)) ==
    Managed.KeeperObserverReady{"q-1", "owner-1", "/logs/keeper-q", "starter", "0"} : Managed.KeeperReadiness}

def host_readiness_requires_the_bootstrap_digest_and_current_owner_witness():
  {==}

law changed_host_owner_witness_holds_managed_start:
  {Managed.keeper_readiness_from_host(managed_bootstrap(), "binding-digest", "7:1",
    ready_host_json("binding-digest", 8, 1)) ==
    Managed.KeeperObserverUnavailable{"hostReadinessMismatch"} : Managed.KeeperReadiness}

def changed_host_owner_witness_holds_managed_start():
  {==}

def managed_submission() -> Service.Submission:
  Service.SubmissionManaged{accepted_admission(), "[]", "plan-identity", "result-v1",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Managed.bootstrap_text(managed_bootstrap())}

law a_retained_observer_and_matching_committed_admission_are_required_for_start:
  {Managed.start_from_submission(managed_bootstrap(), ready_keeper(),
    accepted_submission()) == Managed.StartGranted{"q-1", "owner-1", "starter", "0",
      "{}", "/logs/keeper-q", "/work/.baton/context-artifacts/q", "[]", "result-v1"} : Managed.StartDecision}

def a_retained_observer_and_matching_committed_admission_are_required_for_start():
  {==}

law managed_admission_requires_the_exact_artifact_digest_and_bootstrap:
  {Managed.start_from_submission(managed_bootstrap(), ready_keeper(),
    managed_submission()) == Managed.StartGranted{"q-1", "owner-1", "starter", "0",
      "{}", "/logs/keeper-q", "/work/.baton/context-artifacts/q", "[]", "result-v1"} : Managed.StartDecision}

def managed_admission_requires_the_exact_artifact_digest_and_bootstrap():
  {==}

law terminal_admission_does_not_grant_a_duplicate_native_start:
  {Managed.accepted_admission(managed_bootstrap(), "starter", "0",
    Admission.AdmissionRetained{"owner-1", "{}", "accepted", "complete", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"},
    "[]", "result-v1") == Managed.StartHeld{"committedAdmissionMismatch"} : Managed.StartDecision}

def terminal_admission_does_not_grant_a_duplicate_native_start():
  {==}

law recovery_replays_the_original_grant_after_terminal_publication:
  {Managed.accepted_recovery_managed_admission(managed_bootstrap(), "starter", "0",
    Admission.AdmissionRetained{"owner-1", "{}", "accepted", "complete", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"},
    "[]", "plan-identity", "result-v1",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    Managed.bootstrap_text(managed_bootstrap())) ==
    Managed.StartGranted{"q-1", "owner-1", "starter", "0", "{}",
      "/logs/keeper-q", "/work/.baton/context-artifacts/q", "[]", "result-v1"} : Managed.StartDecision}

def recovery_replays_the_original_grant_after_terminal_publication():
  {==}

law an_unavailable_original_observer_never_grants_a_start:
  {Managed.start_from_submission(managed_bootstrap(),
    Managed.KeeperObserverUnavailable{"observerAttach"}, accepted_submission()) ==
    Managed.StartHeld{"observerUnavailable:observerAttach"} : Managed.StartDecision}

def an_unavailable_original_observer_never_grants_a_start():
  {==}

law a_different_query_never_receives_the_prepared_keeper_grant:
  {Managed.start_from_submission(managed_bootstrap(),
    Managed.KeeperObserverReady{"q-2", "owner-1", "/logs/keeper-q", "starter", "0"},
    accepted_submission()) == Managed.StartHeld{"observerIdentityMismatch"} : Managed.StartDecision}

def a_different_query_never_receives_the_prepared_keeper_grant():
  {==}

law a_nonstarter_role_cannot_receive_the_initial_query_grant:
  {Managed.start_from_submission(managed_bootstrap(),
    Managed.KeeperObserverReady{"q-1", "owner-1", "/logs/keeper-q", "adapter", "7"},
    accepted_submission()) == Managed.StartHeld{"observerIdentityMismatch"} : Managed.StartDecision}

def a_nonstarter_role_cannot_receive_the_initial_query_grant():
  {==}

law a_changed_artifact_path_invalidates_the_committed_start:
  {Managed.accepted_admission(managed_bootstrap(), "starter", "0",
    Admission.AdmissionCreated{"owner-1", "{}", "accepted", "accepted", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/other"},
    "[]", "result-v1") == Managed.StartHeld{"committedAdmissionMismatch"} : Managed.StartDecision}

def a_changed_artifact_path_invalidates_the_committed_start():
  {==}

law a_different_owner_workspace_invalidates_the_committed_start:
  {Managed.accepted_admission(managed_bootstrap(), "starter", "0",
    Admission.AdmissionCreated{"owner-1", "{}", "accepted", "accepted", "0",
      "/logs/keeper-q", "/foreign-worktree", "/work/.baton/context-artifacts/q"},
    "[]", "result-v1") == Managed.StartHeld{"committedAdmissionMismatch"} : Managed.StartDecision}

def a_different_owner_workspace_invalidates_the_committed_start():
  {==}

law a_different_origin_attempt_invalidates_the_committed_start:
  {Managed.accepted_admission(managed_bootstrap(), "starter", "0",
    Admission.AdmissionCreated{"owner-1", "{}", "accepted", "accepted", "1",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"},
    "[]", "result-v1") == Managed.StartHeld{"committedAdmissionMismatch"} : Managed.StartDecision}

def a_different_origin_attempt_invalidates_the_committed_start():
  {==}

law rejected_admission_cancels_only_after_exact_retained_identity_readback:
  {Managed.cancel_rejected(managed_bootstrap(), ready_keeper(),
    Admission.AdmissionRetained{"owner-1", "{}", "rejected", "refused", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"}) ==
    Managed.StartCancelled{"q-1", "owner-1", "admissionRejected", "/logs/keeper-q"} : Managed.StartDecision}

def rejected_admission_cancels_only_after_exact_retained_identity_readback():
  {==}

law a_rejected_service_readback_retains_the_admission_for_identity_checks:
  {Managed.submission_decision(managed_bootstrap(), "starter", "0",
    Service.SubmissionRetainedRejected{
      Admission.AdmissionRetained{"owner-1", "{}", "rejected", "refused", "0",
        "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"},
      "rejected", "refused", "owner-1", "{}"}) ==
    Managed.StartCancelled{"q-1", "owner-1", "admissionRejected", "/logs/keeper-q"} : Managed.StartDecision}

def a_rejected_service_readback_retains_the_admission_for_identity_checks():
  {==}

law a_changed_artifact_never_cancels_a_rejected_preparation:
  {Managed.cancel_rejected(managed_bootstrap(), ready_keeper(),
    Admission.AdmissionRetained{"owner-1", "{}", "rejected", "refused", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/other"}) ==
    Managed.StartHeld{"rejectedAdmissionIdentityMismatch"} : Managed.StartDecision}

def a_changed_artifact_never_cancels_a_rejected_preparation():
  {==}

law a_foreign_workspace_never_cancels_a_rejected_preparation:
  {Managed.cancel_rejected(managed_bootstrap(), ready_keeper(),
    Admission.AdmissionRetained{"owner-1", "{}", "rejected", "refused", "0",
      "/logs/keeper-q", "/foreign-worktree", "/work/.baton/context-artifacts/q"}) ==
    Managed.StartHeld{"rejectedAdmissionIdentityMismatch"} : Managed.StartDecision}

def a_foreign_workspace_never_cancels_a_rejected_preparation():
  {==}

law a_different_origin_attempt_never_cancels_a_rejected_preparation:
  {Managed.cancel_rejected(managed_bootstrap(), ready_keeper(),
    Admission.AdmissionRetained{"owner-1", "{}", "rejected", "refused", "1",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"}) ==
    Managed.StartHeld{"rejectedAdmissionIdentityMismatch"} : Managed.StartDecision}

def a_different_origin_attempt_never_cancels_a_rejected_preparation():
  {==}

law an_accepted_retained_row_can_replay_its_original_start_grant:
  {Managed.start_from_submission(managed_bootstrap(), ready_keeper(),
    Service.SubmissionRetainedVerified{
      Admission.AdmissionRetained{"owner-1", "{}", "accepted", "running", "0",
        "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"},
      "[]", "result-v1"}) ==
    Managed.StartGranted{"q-1", "owner-1", "starter", "0",
      "{}", "/logs/keeper-q", "/work/.baton/context-artifacts/q", "[]", "result-v1"} : Managed.StartDecision}

def an_accepted_retained_row_can_replay_its_original_start_grant():
  {==}

law a_rejected_row_for_another_request_keeps_the_prepared_keeper:
  {Managed.cancel_rejected(managed_bootstrap(), ready_keeper(),
    Admission.AdmissionRetained{"owner-1", "{\"different\":true}", "rejected", "refused", "0",
      "/logs/keeper-q", "/work", "/work/.baton/context-artifacts/q"}) ==
    Managed.StartHeld{"rejectedAdmissionIdentityMismatch"} : Managed.StartDecision}

def a_rejected_row_for_another_request_keeps_the_prepared_keeper():
  {==}

law an_unreadable_admission_does_not_start_or_cancel_the_keeper:
  {Managed.start_from_submission(managed_bootstrap(), ready_keeper(),
    Service.SubmissionUncertain{"readback", "unavailable"}) ==
    Managed.StartHeld{"admissionUncertain:readback"} : Managed.StartDecision}

def an_unreadable_admission_does_not_start_or_cancel_the_keeper():
  {==}

law no_admission_effect_runs_before_original_observer_readiness:
  {Managed.submit_after_observer_ready(managed_bootstrap(),
    Managed.KeeperObserverUnavailable{"observerAttach"}, "db") ==
    IO.pure(Managed.StartDecision,
      Managed.StartHeld{"observerUnavailable:observerAttach"}) : IO(Managed.StartDecision)}

def no_admission_effect_runs_before_original_observer_readiness():
  {==}

law an_observer_for_another_query_cannot_reach_the_admission_effect:
  {Managed.submit_after_observer_ready(managed_bootstrap(),
    Managed.KeeperObserverReady{"q-2", "owner-1", "/logs/keeper-q", "starter", "0"}, "db") ==
    IO.pure(Managed.StartDecision, Managed.StartHeld{"observerIdentityMismatch"}) : IO(Managed.StartDecision)}

def an_observer_for_another_query_cannot_reach_the_admission_effect():
  {==}

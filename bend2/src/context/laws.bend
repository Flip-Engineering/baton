# CLAIM: the operative laws of the managed semantic context lifecycle, each stated
# over the function that implements it and proved beside its claim. The fixture
# entry imports this module, so compiling the fixture verifies every law here, and an
# unproven or false law fails that compile. The production entry's law module must
# import this module through the interfaces owner; until it does, these laws are
# component evidence and not shipping-gate coverage.
#
# Which entries are bound to real functions, and to which:
#  - role identity: guard_identity, subject_kind, subject_id, role_text,
#    hex_expand_go, guard_lock_name, role_directory, role_guard_key's argument
#    identity, identity_admitted;
#  - progress: cleanup_of, cleanup_settled, settled_duties, phase_admitted,
#    terminal, state_after, progress_json, waiting_json;
#  - admission: admission_refusal (class, command, condition, next),
#    rejection_error, rejection_message_id, owner_admission, stopped_owner_admitted;
#  - store: replay_guard, envelope_sql, accept_sql, reject_sql, state_publish_sql,
#    progress_body_sql, owner_notice_sql, json_or_null, text_or_null;
#  - roles: cursor_expected, cursor_seen, role_present_guard, owed_notice_for,
#    replay_column, role_row_sql, event_commit_sql,
#    release_claim_sql, intent_read_sql, progress_notice_id, terminal_notice_id;
#  - control: cleanup_intent_text, role_release_intent_text, recovery_intent_text,
#    pending_release_text, signal_ordering, controllable, control_admit_sql,
#    control_result_sql;
#  - lifecycle: rejected_cleanup_ready, release_attempt_delivery, release_ack_delivery,
#    intent_owed, intent_settled, intent_missing, intent_step, companion_step,
#    owns_live_duty, intent_owed;
#  - bound: binding_document, token_member, physical_tuple.
# The host digest, the guard-anchor directory creation and SQLite execution remain
# foreign assumptions exercised by the native fixture.
import Base
import ./equality.bend as ContextEquality
import ../json/canonical.bend as J
import ../coordinator/commands.bend as C
import ./contracts.bend as Context
import ./identity.bend as ContextRole
import ./progress.bend as ContextProgress
import ./admission.bend as ContextAdmission
import ./store.bend as ContextStore
import ./roles.bend as ContextRoles
import ./control.bend as ContextControl
import ./lifecycle.bend as ContextLifecycle
import ./bound.bend as ContextBound
import ./bound-admission.bend as ContextAdmit
import ./duties.bend as ContextDuties
import ./observer.bend as ContextObserver
import ./service.bend as ContextService

# ---------------------------------------------------------------------------
# Role identity. The identity is the canonical array of the fixed tag, binding,
# subject kind, subject ID, role and incarnation; no member is truncated.

law role_identity_is_the_canonical_array:
  for +binding: String
  for +subject: ContextRole.Subject
  for role: ContextRole.Role
  for +incarnation: String
  {ContextRole.guard_identity(binding,subject,role,incarnation) == J.json_text(J.Jarr{J.Jstr{"context-role"},J.Jarr{J.Jstr{binding},J.Jarr{J.Jstr{ContextRole.subject_kind(subject)},J.Jarr{J.Jstr{ContextRole.subject_id(subject)},J.Jarr{J.Jstr{ContextRole.role_text(role)},J.Jarr{J.Jstr{incarnation},J.Jnil{}}}}}}}) : String}

def role_identity_is_the_canonical_array(binding,subject,role,incarnation):
  {==}

law a_query_subject_names_its_query_and_a_runtime_subject_its_runtime:
  for +id: String
  {ContextRole.subject_kind(ContextRole.SubjectQuery{id}) == "query" : String}

def a_query_subject_names_its_query_and_a_runtime_subject_its_runtime(id):
  {==}

# Two hexadecimal characters per key byte, high nibble first; the ASCII byte 0x61
# is exactly the two characters `6` and `1`.
law hex_expansion_writes_the_high_nibble_first:
  {ContextRole.hex_expand("a") == "61" : String}

def hex_expansion_writes_the_high_nibble_first():
  {==}

law the_guard_lock_name_is_the_hex_expansion_beside_the_fixed_directory:
  for key: String
  {ContextRole.guard_lock_name(key) == "g.lock-" ++ ContextRole.hex_expand(key) : String}

def the_guard_lock_name_is_the_hex_expansion_beside_the_fixed_directory(key):
  {==}

law the_keeper_directory_is_the_digest_under_the_log_directory:
  for +log_dir: String
  for key: String
  {ContextRole.role_directory(log_dir,key) == log_dir ++ "/" ++ key : String}

def the_keeper_directory_is_the_digest_under_the_log_directory(log_dir,key):
  {==}

law the_guard_anchor_is_the_fixed_g_directory:
  for +log_dir: String
  {ContextRole.guard_anchor(log_dir) == log_dir ++ "/g" : String}

def the_guard_anchor_is_the_fixed_g_directory(log_dir):
  {==}

law a_different_recorded_identity_is_not_admitted:
  for +expected: String
  for +recorded: String
  {ContextRole.identity_admitted(expected,recorded) == String.eq(expected,recorded) : Bool}

def a_different_recorded_identity_is_not_admitted(expected,recorded):
  {==}

# ---------------------------------------------------------------------------
# Progress and cleanup aggregation.

law no_cleanup_intent_precedes_every_role_state:
  for unreconciled: U32
  for unresolved: U32
  {ContextProgress.cleanup_of(False{},unreconciled,unresolved) == ContextProgress.CleanupNotRequested{} : ContextProgress.Cleanup}

def no_cleanup_intent_precedes_every_role_state(unreconciled,unresolved):
  {==}

law an_unreconciled_role_makes_cleanup_unavailable:
  for unresolved: U32
  {ContextProgress.cleanup_of(True{},1,unresolved) == ContextProgress.CleanupUnavailable{} : ContextProgress.Cleanup}

def an_unreconciled_role_makes_cleanup_unavailable(unresolved):
  {==}

law an_unsettled_role_keeps_cleanup_pending:
  {ContextProgress.cleanup_of(True{},0,1) == ContextProgress.CleanupPending{} : ContextProgress.Cleanup}

def an_unsettled_role_keeps_cleanup_pending():
  {==}

law every_role_settled_completes_cleanup:
  {ContextProgress.cleanup_of(True{},0,0) == ContextProgress.CleanupComplete{} : ContextProgress.Cleanup}

def every_role_settled_completes_cleanup():
  {==}

law a_settled_phase_requires_settled_duties:
  for cleanup: ContextProgress.Cleanup
  for owed: U32
  {ContextProgress.phase_admitted(ContextProgress.PhaseSettled{},cleanup,owed) == ContextProgress.settled_duties(cleanup,owed) : Bool}

def a_settled_phase_requires_settled_duties(cleanup,owed):
  {==}

law a_running_phase_is_admitted_without_settlement:
  for cleanup: ContextProgress.Cleanup
  for owed: U32
  {ContextProgress.phase_admitted(ContextProgress.PhaseRunning{},cleanup,owed) == True{} : Bool}

def a_running_phase_is_admitted_without_settlement(cleanup,owed):
  {==}

law an_owed_notice_keeps_the_query_unsettled:
  for cleanup: ContextProgress.Cleanup
  {ContextProgress.settled_duties(cleanup,1) == Bool.and(ContextProgress.cleanup_settled(cleanup),U32.is_eq(1,0)) : Bool}

def an_owed_notice_keeps_the_query_unsettled(cleanup):
  {==}

law a_committed_terminal_state_is_immutable:
  for recorded: Context.QueryState
  for next: Context.QueryState
  {ContextProgress.state_after(recorded,next) == Bool.pick(Context.QueryState,Bool.not(ContextProgress.terminal(recorded)),next,recorded) : Context.QueryState}

def a_committed_terminal_state_is_immutable(recorded,next):
  {==}

law a_late_failure_cannot_replace_a_completed_result:
  {ContextProgress.state_after(Context.QsComplete{},Context.QsFailed{}) == Context.QsComplete{} : Context.QueryState}

def a_late_failure_cannot_replace_a_completed_result():
  {==}

law an_ordinary_transition_from_a_nonterminal_state_is_admitted:
  {ContextProgress.state_after(Context.QsAccepted{},Context.QsRunning{}) == Context.QsRunning{} : Context.QueryState}

def an_ordinary_transition_from_a_nonterminal_state_is_admitted():
  {==}

law a_query_without_managed_roles_stores_null_progress:
  for phase: ContextProgress.Phase
  for control: ContextProgress.Control
  for cleanup: ContextProgress.Cleanup
  {ContextProgress.progress_json(False{},phase,Nil{},control,cleanup) == "null" : String}

def a_query_without_managed_roles_stores_null_progress(phase,control,cleanup):
  {==}

law the_empty_waiting_set_is_the_empty_array:
  {ContextProgress.waiting_json(Nil{}) == J.Jarr{J.Jnil{},J.Jnil{}} : J.Json}

def the_empty_waiting_set_is_the_empty_array():
  {==}

# The encoded document of a running query with no outstanding event. The member
# order is the shared canonical encoder's: cleanup, control, phase, waitingFor.
law a_running_query_without_events_encodes_an_empty_waiting_array:
  {ContextProgress.progress_document(ContextProgress.PhaseRunning{},Nil{},ContextProgress.ControlUnobserved{},ContextProgress.CleanupNotRequested{}) == "{\"cleanup\":\"notRequested\",\"control\":\"unobserved\",\"phase\":\"running\",\"waitingFor\":[]}" : String}

def a_running_query_without_events_encodes_an_empty_waiting_array():
  {==}

law a_clangd_diagnostic_event_names_its_uri_and_numeric_version:
  for +uri: String
  for version: U32
  {ContextProgress.waiting_json(Con{ContextProgress.WaitingDiagnostics{uri,version},Nil{}}) == J.Jarr{J.Jobj{J.Jpair{"kind",J.Jstr{"clangdDiagnostics"},J.Jpair{"reason",J.Jstr{"diagnosticsUnobserved"},J.Jpair{"uri",J.Jstr{uri},J.Jpair{"version",J.Jint{version},J.Jnil{}}}}}},J.Jnil{}} : J.Json}

def a_clangd_diagnostic_event_names_its_uri_and_numeric_version(uri,version):
  {==}

# ---------------------------------------------------------------------------
# Admission surfaces.

law a_foreign_subject_is_never_admitted:
  for active: Bool
  for +subject: ContextAdmission.OwnerSubject
  {ContextAdmission.owner_admission(active,False{},subject) == False{} : Bool}

def a_foreign_subject_is_never_admitted(active,subject):
  {==}

law a_stopped_owner_admits_only_its_own_control_and_release:
  for +subject: ContextAdmission.OwnerSubject
  {ContextAdmission.owner_admission(False{},True{},subject) == ContextAdmission.stopped_owner_admitted(subject) : Bool}

def a_stopped_owner_admits_only_its_own_control_and_release(subject):
  {==}

law an_ordinary_subject_is_refused_for_a_stopped_owner:
  {ContextAdmission.stopped_owner_admitted(ContextAdmission.OwnerOrdinary{}) == False{} : Bool}

def an_ordinary_subject_is_refused_for_a_stopped_owner():
  {==}

law a_query_control_subject_is_admitted_for_its_stopped_owner:
  {ContextAdmission.stopped_owner_admitted(ContextAdmission.OwnerQueryControl{}) == True{} : Bool}

def a_query_control_subject_is_admitted_for_its_stopped_owner():
  {==}

law a_runtime_release_is_admitted_for_its_stopped_owner:
  {ContextAdmission.stopped_owner_admitted(ContextAdmission.OwnerRuntimeRelease{}) == True{} : Bool}

def a_runtime_release_is_admitted_for_its_stopped_owner():
  {==}

law a_retained_rejection_refuses_with_its_retained_result_argv:
  for +query: String
  for +condition: String
  {Context.refusal_text(ContextAdmission.admission_refusal(ContextAdmission.OutcomeRejected{query,condition})) == J.json_text(J.Jobj{J.Jpair{"command",J.Jstr{"context-query"},J.Jpair{"condition",J.Jstr{condition},J.Jpair{"error",J.Jstr{"admissionRejected"},J.Jpair{"next",J.Jarr{J.Jstr{"context-result"},J.Jarr{J.Jstr{query},J.Jnil{}}},J.Jnil{}}}}}}) : String}

def a_retained_rejection_refuses_with_its_retained_result_argv(query,condition):
  {==}

law an_unverified_decision_requires_the_original_request_when_no_row_is_verified:
  for +query: String
  for +owner: String
  {ContextAdmission.outcome_next(ContextAdmission.OutcomeUncertain{query,owner,"",ContextAdmission.NoEvidence{},False{}}) == Context.NextArg{"context-query-file",Context.NextArg{owner,Context.NextArg{query,Context.NextArg{"-",Context.NextStop{}}}}} : Context.Next}

def an_unverified_decision_requires_the_original_request_when_no_row_is_verified(query,owner):
  {==}

law an_unverified_decision_condition_names_its_owner_and_query:
  for +query: String
  for +owner: String
  {ContextAdmission.outcome_condition(ContextAdmission.OutcomeUncertain{query,owner,"",ContextAdmission.NoEvidence{},False{}}) == J.Jobj{J.Jpair{"decision",J.Jstr{"unverified"},J.Jpair{"owner",J.Jstr{owner},J.Jpair{"plannedDirectory",J.Jnull{},J.Jpair{"preparedEvidence",J.Jnull{},J.Jpair{"query",J.Jstr{query},J.Jnil{}}}}}}} : J.Json}

def an_unverified_decision_condition_names_its_owner_and_query(query,owner):
  {==}

law a_prepare_failure_with_a_retained_row_addresses_the_result:
  for +query: String
  for +owner: String
  {ContextAdmission.outcome_next(ContextAdmission.OutcomePrepareFailed{ContextAdmission.StageSpool{},query,owner,"",ContextAdmission.NoEvidence{},ContextAdmission.NoCode{},True{}}) == Context.NextArg{"context-result",Context.NextArg{query,Context.NextStop{}}} : Context.Next}

def a_prepare_failure_with_a_retained_row_addresses_the_result(query,owner):
  {==}

law a_prepare_failure_condition_names_its_stage_and_code:
  for +query: String
  for +owner: String
  {ContextAdmission.outcome_condition(ContextAdmission.OutcomePrepareFailed{ContextAdmission.StageSpool{},query,owner,"/log",ContextAdmission.NoEvidence{},ContextAdmission.HostCode{5},True{}}) == J.Jobj{J.Jpair{"code",J.Jint{5},J.Jpair{"owner",J.Jstr{owner},J.Jpair{"plannedDirectory",J.Jstr{"/log"},J.Jpair{"preparedEvidence",J.Jnull{},J.Jpair{"query",J.Jstr{query},J.Jpair{"stage",J.Jstr{"spool"},J.Jnil{}}}}}}}} : J.Json}

def a_prepare_failure_condition_names_its_stage_and_code(query,owner):
  {==}

law a_rejection_notice_identity_is_the_fixed_tag_and_the_query:
  for +query: String
  {ContextAdmission.rejection_message_id(query) == J.json_text(J.Jarr{J.Jstr{"context-admission-rejected"},J.Jarr{J.Jstr{query},J.Jnil{}}}) : String}

def a_rejection_notice_identity_is_the_fixed_tag_and_the_query(query):
  {==}

law a_retained_rejection_error_names_its_kind_and_carries_no_limit:
  for +condition: String
  {ContextAdmission.rejection_error(condition) == J.json_text(J.Jobj{J.Jpair{"condition",J.Jstr{condition},J.Jpair{"kind",J.Jstr{"admissionRejected"},J.Jpair{"limits",J.Jarr{J.Jnil{},J.Jnil{}},J.Jnil{}}}}}) : String}

def a_retained_rejection_error_names_its_kind_and_carries_no_limit(condition):
  {==}

law an_evidence_record_is_the_artifact_reference_or_null:
  for +path: String
  for +sha256: String
  for +pointer: String
  {ContextAdmission.evidence_json(ContextAdmission.ArtifactEvidence{path,sha256,pointer}) == J.Jobj{J.Jpair{"path",J.Jstr{path},J.Jpair{"pointer",J.Jstr{pointer},J.Jpair{"sha256",J.Jstr{sha256},J.Jnil{}}}}} : J.Json}

def an_evidence_record_is_the_artifact_reference_or_null(path,sha256,pointer):
  {==}

# ---------------------------------------------------------------------------
# Store statements.

law a_repeated_query_id_replays_only_an_identical_owner_and_request:
  {ContextStore.replay_guard() == " ON CONFLICT(id) DO UPDATE SET id=CASE WHEN semantic_queries.owner=excluded.owner AND semantic_queries.request_json=excluded.request_json THEN semantic_queries.id ELSE NULL END;" : String}

def a_repeated_query_id_replays_only_an_identical_owner_and_request():
  {==}

law an_absent_optional_text_is_sql_null_and_a_present_one_is_quoted:
  {ContextStore.text_or_null("") == "NULL" : String}

def an_absent_optional_text_is_sql_null_and_a_present_one_is_quoted():
  {==}

law a_json_document_is_stored_verbatim_and_an_absent_one_is_null:
  for +value: String
  {ContextStore.json_or_null(value) == Bool.pick(String,String.is_empty(value),"NULL","json(" ++ C.q(value) ++ ")") : String}

def a_json_document_is_stored_verbatim_and_an_absent_one_is_null(value):
  {==}

law a_committed_terminal_publication_never_overwrites_a_recorded_terminal_state:
  for +id: String
  for +next: String
  for +result: String
  for +error: String
  {ContextStore.state_publish_sql(id,next,result,error) == "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ "UPDATE semantic_queries SET state=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN CASE WHEN state=" ++ C.q(next) ++ " THEN state ELSE NULL END ELSE " ++ C.q(next) ++ " END,result_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN result_json ELSE " ++ ContextStore.json_or_null(result) ++ " END,error_json=CASE WHEN " ++ ContextStore.terminal_recorded() ++ " THEN error_json ELSE " ++ ContextStore.json_or_null(error) ++ " END WHERE id=" ++ C.q(id) ++ ";" ++ ContextStore.envelope_sql(id) ++ "COMMIT;" : String}

def a_committed_terminal_publication_never_overwrites_a_recorded_terminal_state(id,next,result,error):
  {==}

law an_owner_notice_is_a_self_addressed_report_under_the_shared_upsert:
  for +id: String
  for +owner: String
  for +body: String
  {ContextStore.owner_notice_sql(id,owner,body) == Bool.pick(String, String.is_empty(id), "", "INSERT INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ ",s.id,s.id,'report'," ++ C.q(body) ++ " FROM sessions s WHERE s.id=" ++ C.q(owner) ++ C.message_upsert()) : String}

def an_owner_notice_is_a_self_addressed_report_under_the_shared_upsert(id,owner,body):
  {==}

law an_absent_notice_identity_inserts_nothing:
  for +owner: String
  for +body: String
  {ContextStore.owner_notice_sql("",owner,body) == "" : String}

def an_absent_notice_identity_inserts_nothing(owner,body):
  {==}

# ---------------------------------------------------------------------------
# Role statements.

law an_event_identity_names_its_expected_and_next_cursor:
  for +cursor: String
  {ContextRoles.cursor_expected(cursor) == "observer_cursor=" ++ C.q(cursor) : String}

def an_event_identity_names_its_expected_and_next_cursor(cursor):
  {==}

law an_event_identity_names_its_next_cursor:
  for +cursor: String
  {ContextRoles.cursor_seen(cursor) == "observer_cursor=" ++ C.q(cursor) : String}

def an_event_identity_names_its_next_cursor(cursor):
  {==}

law a_missing_role_row_aborts_the_event_transaction:
  for +query: String
  for +role: String
  for +incarnation: String
  {ContextRoles.role_present_guard(query,role,incarnation) == "UPDATE semantic_queries SET id=CASE WHEN EXISTS(SELECT 1 FROM semantic_roles WHERE query_id=" ++ C.q(query) ++ " AND role=" ++ C.q(role) ++ " AND incarnation=" ++ C.q(incarnation) ++ ") THEN id ELSE NULL END WHERE id=" ++ C.q(query) ++ ";" : String}

def a_missing_role_row_aborts_the_event_transaction(query,role,incarnation):
  {==}

law a_progress_notice_identity_names_its_role_incarnation_and_sequence:
  for +query: String
  for +role: String
  for +incarnation: String
  for +sequence: String
  {ContextRoles.progress_notice_id(query,role,incarnation,sequence) == J.json_text(J.Jarr{J.Jstr{"context-progress"},J.Jarr{J.Jstr{query},J.Jarr{J.Jstr{role},J.Jarr{J.Jstr{incarnation},J.Jarr{J.Jstr{sequence},J.Jnil{}}}}}}) : String}

def a_progress_notice_identity_names_its_role_incarnation_and_sequence(query,role,incarnation,sequence):
  {==}

law a_terminal_notice_identity_uses_the_query_identity:
  for +query: String
  {ContextRoles.terminal_notice_id(query) == J.json_text(J.Jarr{J.Jstr{"context-terminal"},J.Jarr{J.Jstr{query},J.Jnil{}}}) : String}

def a_terminal_notice_identity_uses_the_query_identity(query):
  {==}

# ---------------------------------------------------------------------------
# Control statements.

law a_release_intent_names_its_control_query_and_signal:
  for +controlQuery: String
  for +signal: String
  {ContextControl.cleanup_intent_text(controlQuery,signal) == J.json_text(J.Jobj{J.Jpair{"controlQuery",J.Jstr{controlQuery},J.Jpair{"signal",J.Jstr{signal},J.Jnil{}}}}) : String}

def a_release_intent_names_its_control_query_and_signal(controlQuery,signal):
  {==}

law a_pending_release_intent_starts_with_null_evidence:
  for +controlQuery: String
  for +signal: String
  {ContextControl.pending_release_text(controlQuery,signal) == J.json_text(J.Jobj{J.Jpair{"controlQuery",J.Jstr{controlQuery},J.Jpair{"delivery",J.Jstr{"pending"},J.Jpair{"evidence",J.Jnull{},J.Jpair{"signal",J.Jstr{signal},J.Jnil{}}}}}}) : String}

def a_pending_release_intent_starts_with_null_evidence(controlQuery,signal):
  {==}

law a_recovery_intent_names_only_its_control_query:
  for +controlQuery: String
  {ContextControl.recovery_intent_text(controlQuery) == J.json_text(J.Jobj{J.Jpair{"controlQuery",J.Jstr{controlQuery},J.Jnil{}}}) : String}

def a_recovery_intent_names_only_its_control_query(controlQuery):
  {==}

law an_explicit_kill_is_never_downgraded_to_term:
  {ContextControl.signal_ordering("SIGKILL","SIGTERM") == "SIGKILL" : String}

def an_explicit_kill_is_never_downgraded_to_term():
  {==}

law a_term_request_upgrades_to_kill:
  {ContextControl.signal_ordering("SIGTERM","SIGKILL") == "SIGKILL" : String}

def a_term_request_upgrades_to_kill():
  {==}

law a_control_query_cannot_control_itself:
  for +owner: String
  for +query: String
  {ContextControl.controllable(owner,query) == "EXISTS(SELECT 1 FROM semantic_queries c WHERE c.id=" ++ C.q(query) ++ " AND c.owner=" ++ C.q(owner) ++ " AND c.runtime_id IS NULL AND NOT (c.result_json IS NOT NULL AND json_extract(c.result_json,'$.kind')='queryControl'))" : String}

def a_control_query_cannot_control_itself(owner,query):
  {==}

law a_release_records_the_query_intent_before_any_role_intent:
  for +owner: String
  for +controlledQuery: String
  for +controlQuery: String
  for +signal: String
  {ContextControl.release_intent_sql(owner,controlledQuery,controlQuery,signal) == "UPDATE semantic_queries SET cleanup_intent_json=CASE WHEN json_extract(cleanup_intent_json,'$.signal')='SIGKILL' THEN cleanup_intent_json ELSE " ++ C.q(ContextControl.cleanup_intent_text(controlQuery,signal)) ++ " END WHERE id=" ++ C.q(controlledQuery) ++ " AND " ++ ContextControl.controllable(owner,controlledQuery) ++ ";" : String}

def a_release_records_the_query_intent_before_any_role_intent(owner,controlledQuery,controlQuery,signal):
  {==}

law a_role_keeps_an_attempted_delivery:
  for +owner: String
  for +controlledQuery: String
  for +controlQuery: String
  for +signal: String
  {ContextControl.role_intent_sql(owner,controlledQuery,controlQuery,signal) == "UPDATE semantic_roles SET release_intent_json=CASE WHEN release_intent_json IS NULL THEN " ++ C.q(ContextControl.pending_release_text(controlQuery,signal)) ++ " WHEN json_extract(release_intent_json,'$.delivery')='pending' THEN CASE WHEN json_extract(release_intent_json,'$.signal')='SIGKILL' THEN release_intent_json ELSE " ++ C.q(ContextControl.pending_release_text(controlQuery,signal)) ++ " END ELSE release_intent_json END WHERE query_id=" ++ C.q(controlledQuery) ++ " AND " ++ ContextControl.controllable(owner,controlledQuery) ++ ";" : String}

def a_role_keeps_an_attempted_delivery(owner,controlledQuery,controlQuery,signal):
  {==}

law the_control_row_is_inserted_only_for_a_controllable_subject:
  for +controlQuery: String
  for +owner: String
  for +requestJson: String
  for +cwd: String
  for +artifactPath: String
  for +controlledQuery: String
  {ContextControl.control_row_sql(controlQuery,owner,requestJson,cwd,artifactPath,controlledQuery) == "INSERT INTO semantic_queries(id,owner,request_json,admission_decision,cwd,origin_attempt,state,result_json,artifact_path) SELECT " ++ C.q(controlQuery) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ C.q(cwd) ++ ",'0','complete'," ++ ContextControl.control_result_sql(controlledQuery) ++ "," ++ C.q(artifactPath) ++ " WHERE " ++ ContextControl.controllable(owner,controlledQuery) ++ ContextStore.replay_guard() : String}

def the_control_row_is_inserted_only_for_a_controllable_subject(controlQuery,owner,requestJson,cwd,artifactPath,controlledQuery):
  {==}

# ---------------------------------------------------------------------------
# Lifecycle and binding.

law rejected_cleanup_requires_all_four_evidence_predicates:
  for binding: Bool
  for protocol: Bool
  for lifetime: Bool
  for decision: Bool
  {ContextLifecycle.rejected_cleanup_ready(binding,protocol,lifetime,decision) == Bool.and(binding,Bool.and(protocol,Bool.and(lifetime,decision))) : Bool}

def rejected_cleanup_requires_all_four_evidence_predicates(binding,protocol,lifetime,decision):
  {==}

law only_a_pending_intent_becomes_attempted:
  for +recorded: String
  {ContextLifecycle.release_attempt_delivery(recorded) == Bool.pick(String,String.eq(recorded,"pending"),"attempted",recorded) : String}

def only_a_pending_intent_becomes_attempted(recorded):
  {==}

law an_unacknowledged_signal_is_unknown:
  {ContextLifecycle.release_ack_delivery(False{}) == "unknown" : String}

def an_unacknowledged_signal_is_unknown():
  {==}

law the_binding_document_names_its_physical_tuple:
  for +scheme: String
  for version: U32
  for +path: String
  for +device: String
  for +file: String
  for +birth: String
  for +vfs: String
  {ContextBound.binding_document(ContextBound.Binding{scheme,version,path,device,file,birth,vfs,""}) == J.json_text(J.Jobj{J.Jpair{"birth",J.Jstr{birth},J.Jpair{"device",J.Jstr{device},J.Jpair{"file",J.Jstr{file},J.Jpair{"path",J.Jstr{path},J.Jpair{"scheme",J.Jstr{scheme},J.Jpair{"version",J.Jint{version},J.Jpair{"vfs",J.Jstr{vfs},J.Jnil{}}}}}}}}}) : String}

def the_binding_document_names_its_physical_tuple(scheme,version,path,device,file,birth,vfs):
  {==}

law an_absent_logical_token_is_not_a_member:
  {ContextBound.token_member("") == J.Jnil{} : J.Json}

def an_absent_logical_token_is_not_a_member():
  {==}

# ---------------------------------------------------------------------------
# Atomic bound admission. The insert runs only while the identity is absent and the
# read-back reports what the transaction did, so a concurrent admission of the same
# identity resolves to one row and the answer names the recorded preparation. The
# decoder is closed over the exact row grammar and its value domains.

law every_answer_column_is_guarded_by_presence:
  for +id: String
  for +expression: String
  {ContextAdmit.admit_column(id,expression) == "CASE WHEN " ++ ContextAdmit.admit_present(id) ++ " THEN " ++ expression ++ " ELSE '' END" : String}

def every_answer_column_is_guarded_by_presence(id,expression):
  {==}

law the_admission_inserts_only_an_absent_identity:
  for +id: String
  for +owner: String
  for +requestJson: String
  for +keeperPath: String
  for +cwd: String
  for +originAttempt: String
  for +artifactPath: String
  {ContextAdmit.admit_sql(id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath) == "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ ("INSERT INTO semantic_queries(id,owner,request_json,admission_decision,prepared_keeper_path,cwd,origin_attempt,state,artifact_path) SELECT " ++ C.q(id) ++ "," ++ C.q(owner) ++ "," ++ C.q(requestJson) ++ ",'accepted'," ++ ContextStore.text_or_null(keeperPath) ++ "," ++ C.q(cwd) ++ "," ++ ContextStore.text_or_null(originAttempt) ++ ",'accepted'," ++ C.q(artifactPath) ++ " WHERE NOT EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(id) ++ ");") ++ ContextAdmit.admit_row_sql(id) ++ "COMMIT;" : String}

def the_admission_inserts_only_an_absent_identity(id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath):
  {==}

law a_created_answer_names_the_recorded_identity_and_preparation:
  {ContextAdmit.admit_decode("present\tcreated\troot\trq\taccepted\taccepted\tattempt-1\t/log/q3\t/work\t/art/q3\n") == ContextAdmit.AdmissionCreated{"root","rq","accepted","accepted","attempt-1","/log/q3","/work","/art/q3"} : ContextAdmit.Admission}

def a_created_answer_names_the_recorded_identity_and_preparation():
  {==}

law a_retained_answer_names_the_recorded_attempt:
  {ContextAdmit.admit_decode("present\tretained\troot\trq\taccepted\tcomplete\tattempt-1\t/log/q3\t/work\t/art/q3\n") == ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","attempt-1","/log/q3","/work","/art/q3"} : ContextAdmit.Admission}

def a_retained_answer_names_the_recorded_attempt():
  {==}

law an_absent_answer_is_a_proven_absence:
  {ContextAdmit.admit_decode("absent\t\t\t\t\t\t\t\t\t\n") == ContextAdmit.AdmissionAbsent{} : ContextAdmit.Admission}

def an_absent_answer_is_a_proven_absence():
  {==}

law a_short_answer_is_not_a_record:
  {ContextAdmit.admit_decode("present\tcreated\troot\n") == ContextAdmit.AdmissionUncertain{"short","present\tcreated\troot\n"} : ContextAdmit.Admission}

def a_short_answer_is_not_a_record():
  {==}

law a_surplus_column_is_not_a_record:
  {ContextAdmit.admit_decode("present\tcreated\troot\trq\taccepted\taccepted\ta\t/l\t/w\t/art\textra\n") == ContextAdmit.AdmissionUncertain{"surplus","present\tcreated\troot\trq\taccepted\taccepted\ta\t/l\t/w\t/art\textra\n"} : ContextAdmit.Admission}

def a_surplus_column_is_not_a_record():
  {==}

law an_unknown_marker_is_not_a_record:
  {ContextAdmit.admit_decode("present\tsomething\troot\trq\taccepted\taccepted\ta\t/l\t/w\t/art\n") == ContextAdmit.AdmissionUncertain{"mark","present\tsomething\troot\trq\taccepted\taccepted\ta\t/l\t/w\t/art\n"} : ContextAdmit.Admission}

def an_unknown_marker_is_not_a_record():
  {==}

law a_value_outside_the_domain_is_not_a_record:
  {ContextAdmit.admit_decode("present\tcreated\troot\trq\tbogus\taccepted\ta\t/l\t/w\t/art\n") == ContextAdmit.AdmissionUncertain{"domain","present\tcreated\troot\trq\tbogus\taccepted\ta\t/l\t/w\t/art\n"} : ContextAdmit.Admission}

def a_value_outside_the_domain_is_not_a_record():
  {==}

law the_state_domain_comes_from_the_canonical_contract:
  {ContextAdmit.admit_state_ok("running") == True{} : Bool}

def the_state_domain_comes_from_the_canonical_contract():
  {==}

law an_unknown_state_is_outside_the_domain:
  {ContextAdmit.admit_state_ok("bogus") == False{} : Bool}

def an_unknown_state_is_outside_the_domain():
  {==}

law the_decision_domain_admits_both_recorded_decisions:
  {ContextAdmit.admit_decision_ok("accepted") == True{} : Bool}

def the_decision_domain_admits_both_recorded_decisions():
  {==}

law a_created_answer_matches_no_retained_identity:
  {ContextAdmit.admit_identical(ContextAdmit.AdmissionCreated{"root","rq","accepted","accepted","a","/l","/w","/art"},"root","rq") == False{} : Bool}

def a_created_answer_matches_no_retained_identity():
  {==}

law a_retained_answer_matches_its_own_owner_and_request:
  {ContextAdmit.admit_identical(ContextAdmit.AdmissionRetained{"root","rq","accepted","accepted","a","/l","/w","/art"},"root","rq") == True{} : Bool}

def a_retained_answer_matches_its_own_owner_and_request():
  {==}

law a_retained_answer_with_a_different_request_is_a_conflict:
  {ContextAdmit.admit_identical(ContextAdmit.AdmissionRetained{"root","rq","accepted","accepted","a","/l","/w","/art"},"root","other") == False{} : Bool}

def a_retained_answer_with_a_different_request_is_a_conflict():
  {==}

law an_absent_answer_matches_nothing:
  {ContextAdmit.admit_identical(ContextAdmit.AdmissionAbsent{},"root","rq") == False{} : Bool}

def an_absent_answer_matches_nothing():
  {==}

law an_unreadable_answer_matches_nothing:
  {ContextAdmit.admit_identical(ContextAdmit.AdmissionUncertain{"short","x"},"root","rq") == False{} : Bool}

def an_unreadable_answer_matches_nothing():
  {==}

# ---------------------------------------------------------------------------
# Coordinator duty enumeration. The enumeration selects the context's own
# unsettled records, each duty row is six columns, and every row of an enumeration
# must be a known record before the caller may treat the set as settled.

law the_open_computation_predicate_names_every_nonterminal_state:
  {ContextDuties.duty_query_open() == "state NOT IN ('complete','failed','interrupted','refused')" : String}

def the_open_computation_predicate_names_every_nonterminal_state():
  {==}

law the_open_cleanup_predicate_names_both_unsettled_values:
  {ContextDuties.duty_query_cleanup_open() == "json_extract(progress_json,'$.cleanup') IN ('pending','unavailable')" : String}

def the_open_cleanup_predicate_names_both_unsettled_values():
  {==}

law the_open_intent_predicate_names_both_committed_intents:
  {ContextDuties.duty_query_intent_open() == "cleanup_intent_json IS NOT NULL OR recovery_intent_json IS NOT NULL" : String}

def the_open_intent_predicate_names_both_committed_intents():
  {==}

law the_open_role_predicate_names_an_unsettled_cleanup_or_release:
  {ContextDuties.duty_role_open() == "cleanup_phase IN ('pending','unavailable') OR release_intent_json IS NOT NULL" : String}

def the_open_role_predicate_names_an_unsettled_cleanup_or_release():
  {==}

law the_owed_notice_predicate_selects_only_context_notices:
  {ContextDuties.duty_notice_owed() == "m.receipt IS NULL AND substr(m.id,1,10)='[\"context-'" : String}

def the_owed_notice_predicate_selects_only_context_notices():
  {==}

law a_duty_line_reads_six_columns:
  {ContextDuties.duty_line("query\tq1\t\t\tcomputationOpen\t") == Some{ContextDuties.DutyRecord{"query","q1","","","computationOpen",""}} : Maybe<&2,ContextDuties.DutyRecord>}

def a_duty_line_reads_six_columns():
  {==}

law a_short_duty_line_is_not_a_record:
  {ContextDuties.duty_line("query\tq1") == None{} : Maybe<&2,ContextDuties.DutyRecord>}

def a_short_duty_line_is_not_a_record():
  {==}

law a_duty_without_a_subject_is_not_a_record:
  {ContextDuties.duty_line("query\t\t\t\topen\tevidence") == None{} : Maybe<&2,ContextDuties.DutyRecord>}

def a_duty_without_a_subject_is_not_a_record():
  {==}

law an_empty_enumeration_is_wellformed:
  {ContextDuties.duty_wellformed("") == True{} : Bool}

def an_empty_enumeration_is_wellformed():
  {==}

law an_unknown_duty_kind_makes_the_enumeration_unusable:
  {ContextDuties.duty_wellformed("unknown\tnot-a-context-id\t\t\tnotice\treport\n") == False{} : Bool}

def an_unknown_duty_kind_makes_the_enumeration_unusable():
  {==}

law one_unreadable_line_makes_the_enumeration_unusable:
  {ContextDuties.duty_wellformed("query\tq1\t\t\topen\t\nshort\n") == False{} : Bool}

def one_unreadable_line_makes_the_enumeration_unusable():
  {==}

law a_one_column_absent_answer_is_not_a_proven_absence:
  {ContextAdmit.admit_decode("absent\n") == ContextAdmit.AdmissionUncertain{"shape","absent\n"} : ContextAdmit.Admission}

def a_one_column_absent_answer_is_not_a_proven_absence():
  {==}

law a_runtime_epoch_is_stored_as_decimal_text:
  {ContextStore.runtime_epoch_column() == "epoch TEXT NOT NULL" : String}

def a_runtime_epoch_is_stored_as_decimal_text():
  {==}

law a_runtime_epoch_is_inserted_as_quoted_text:
  for +epoch: String
  {ContextStore.runtime_epoch_value(epoch) == C.q(epoch) : String}

def a_runtime_epoch_is_inserted_as_quoted_text(epoch):
  {==}

law an_empty_enumeration_is_recorded_as_no_duties:
  {ContextDuties.duty_view("") == ContextDuties.DutyNone{} : ContextDuties.DutyView}

def an_empty_enumeration_is_recorded_as_no_duties():
  {==}

law an_unreadable_enumeration_names_its_line_and_answer:
  {ContextDuties.duty_view("short\n") == ContextDuties.DutyUnreadable{"short","short\n"} : ContextDuties.DutyView}

def an_unreadable_enumeration_names_its_line_and_answer():
  {==}

law an_absent_answer_with_a_nonempty_value_is_not_a_proven_absence:
  {ContextAdmit.admit_decode("absent\t\t\t\t\t\t\t\tvalue\t\n") == ContextAdmit.AdmissionUncertain{"shape","absent\t\t\t\t\t\t\t\tvalue\t\n"} : ContextAdmit.Admission}

def an_absent_answer_with_a_nonempty_value_is_not_a_proven_absence():
  {==}

law a_valid_enumeration_is_recorded_as_rows:
  {ContextDuties.duty_view("notice\tq1\t\t\tnotice\treport\n") == ContextDuties.DutyRows{1,"notice\tq1\t\t\tnotice\treport\n"} : ContextDuties.DutyView}

def a_valid_enumeration_is_recorded_as_rows():
  {==}

law an_unknown_kind_makes_the_exported_enumeration_unreadable:
  {ContextDuties.duty_view("other\tq1\t\t\tstage\t\n") == ContextDuties.DutyUnreadable{"other\tq1\t\t\tstage\t","other\tq1\t\t\tstage\t\n"} : ContextDuties.DutyView}

def an_unknown_kind_makes_the_exported_enumeration_unreadable():
  {==}

law an_empty_line_makes_the_exported_enumeration_unreadable:
  {ContextDuties.duty_view("\n") == ContextDuties.DutyUnreadable{"","\n"} : ContextDuties.DutyView}

def an_empty_line_makes_the_exported_enumeration_unreadable():
  {==}

law a_notice_is_matched_by_its_json_query_field:
  for +query: String
  {ContextRoles.owed_notice_for(query) == "EXISTS(SELECT 1 FROM messages m WHERE m.receipt IS NULL AND json_valid(m.id) AND json_extract(m.id,'$[1]')=" ++ C.q(query) ++ " AND json_extract(m.id,'$[0]') IN ('context-progress','context-terminal','context-admission-rejected'))" : String}

def a_notice_is_matched_by_its_json_query_field(query):
  {==}

law a_repeated_event_identity_admits_only_an_identical_replay:
  for +query: String
  for +role: String
  for +incarnation: String
  for +next: String
  for +capture: String
  for +evidence: String
  for +progress: String
  for +recorded: String
  {ContextRoles.replay_column(next,query,role,incarnation,next,"value",capture,evidence,progress,recorded) == ContextRoles.strict_replay_column(query,role,incarnation,next,capture,evidence,progress,recorded) : String}

def a_repeated_event_identity_admits_only_an_identical_replay(query,role,incarnation,next,capture,evidence,progress,recorded):
  %ContextEquality.string_eq_self(next) : {ContextRoles.replay_column(next,query,role,incarnation,next,"value",capture,evidence,progress,recorded) == Bool.pick(String,_,ContextRoles.strict_replay_column(query,role,incarnation,next,capture,evidence,progress,recorded),ContextRoles.first_or_replay_column(next,query,role,incarnation,next,"value",capture,evidence,progress,recorded)) : String}
  {==}

law a_large_canonical_counter_is_admitted:
  {ContextStore.runtime_epoch_ok("12345678901234567890123456789012345") == True{} : Bool}

def a_large_canonical_counter_is_admitted():
  {==}

law a_leading_zero_counter_is_refused:
  {ContextStore.runtime_epoch_ok("0123") == False{} : Bool}

def a_leading_zero_counter_is_refused():
  {==}

law a_signed_or_fractional_counter_is_refused:
  {ContextStore.runtime_epoch_ok("-1") == False{} : Bool}

def a_signed_or_fractional_counter_is_refused():
  {==}

law an_empty_counter_is_refused:
  {ContextStore.runtime_epoch_ok("") == False{} : Bool}

def an_empty_counter_is_refused():
  {==}

law an_unreadable_enumeration_is_not_a_settled_set:
  {ContextDuties.duty_text(ContextDuties.duty_view("short\n")) == "unreadable:short" : String}

def an_unreadable_enumeration_is_not_a_settled_set():
  {==}

law a_settled_enumeration_names_no_duty:
  {ContextDuties.duty_text(ContextDuties.duty_view("")) == "none" : String}

def a_settled_enumeration_names_no_duty():
  {==}

law a_duty_enumeration_reports_its_count:
  {ContextDuties.duty_text(ContextDuties.duty_view("notice\tq1\t\t\tnotice\treport\n")) == "rows:1" : String}

def a_duty_enumeration_reports_its_count():
  {==}

law the_counter_profile_is_one_sql_predicate:
  for +expr: String
  {ContextStore.runtime_epoch_sql_ok(expr) == "((" ++ expr ++ ")='0' OR ((" ++ expr ++ ") GLOB '[1-9]*' AND (" ++ expr ++ ") NOT GLOB '*[^0-9]*'))" : String}

def the_counter_profile_is_one_sql_predicate(expr):
  {==}

law a_duty_obligation_is_found_by_its_identity:
  {ContextDuties.duty_contains(ContextDuties.duty_view("notice\tq1\t\t\tnotice\treport\n"), "notice", "q1") == True{} : Bool}

def a_duty_obligation_is_found_by_its_identity():
  {==}

law a_duty_obligation_does_not_match_another_subject:
  {ContextDuties.duty_contains(ContextDuties.duty_view("notice\tq1\t\t\tnotice\treport\n"), "notice", "q2") == False{} : Bool}

def a_duty_obligation_does_not_match_another_subject():
  {==}

law an_unreadable_enumeration_contains_no_obligation:
  {ContextDuties.duty_contains(ContextDuties.duty_view("short\n"), "notice", "q1") == False{} : Bool}

def an_unreadable_enumeration_contains_no_obligation():
  {==}

law a_ref_lookup_matches_its_exact_ref_identity:
  for +refId: String
  {ContextStore.ref_id_match(refId) == "(CASE WHEN entry.type='object' THEN json_extract(entry.value,'$.id') ELSE NULL END)=" ++ C.q(refId) : String}

def a_ref_lookup_matches_its_exact_ref_identity(refId):
  {==}

law a_ref_lookup_decodes_against_the_requested_identity:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t7b22656e67696e65223a2274797065736372697074222c227375626a656374223a7b226b696e64223a22656e74697479222c226461746162617365223a2264222c22736368656d61223a2273222c226e616d65223a226e227d2c22736e617073686f744964223a227331222c2270726f6a656374696f6e73223a5b22646566696e6974696f6e225d7d\t1\n") == ContextStore.RefFound{"q7","ref-1","complete","{\"engine\":\"typescript\",\"subject\":{\"kind\":\"entity\",\"database\":\"d\",\"schema\":\"s\",\"name\":\"n\"},\"snapshotId\":\"s1\",\"projections\":[\"definition\"]}"} : ContextStore.RefLookup}

def a_ref_lookup_decodes_against_the_requested_identity():
  {==}

law an_unfinished_query_never_becomes_a_found_selector:
  {ContextStore.ref_lookup_decode("q7","ref-1","running\tpresent\t1\t7b7d\t1\n") == ContextStore.RefOpen{"q7","ref-1","running"} : ContextStore.RefLookup}

def an_unfinished_query_never_becomes_a_found_selector():
  {==}

law a_failed_query_never_becomes_a_found_selector:
  {ContextStore.ref_lookup_decode("q7","ref-1","failed\tpresent\t1\t7b7d\t1\n") == ContextStore.RefFailed{"q7","ref-1","failed"} : ContextStore.RefLookup}

def a_failed_query_never_becomes_a_found_selector():
  {==}

law an_unknown_state_never_becomes_a_found_selector:
  {ContextStore.ref_lookup_decode("q7","ref-1","bogus\tpresent\t1\t7b7d\t1\n") == ContextStore.RefUnreadable{"state","bogus\tpresent\t1\t7b7d\t1\n"} : ContextStore.RefLookup}

def an_unknown_state_never_becomes_a_found_selector():
  {==}

law a_null_result_never_becomes_a_found_selector:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tnull\t1\t7b7d\t1\n") == ContextStore.RefUnretained{"q7","ref-1"} : ContextStore.RefLookup}

def a_null_result_never_becomes_a_found_selector():
  {==}

law a_bad_hex_entry_keeps_its_raw_answer:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t7b7\t1\n") == ContextStore.RefUnreadable{"framing","complete\tpresent\t1\t7b7\t1\n"} : ContextStore.RefLookup}

def a_bad_hex_entry_keeps_its_raw_answer():
  {==}

law a_container_failure_is_never_an_absent_ref:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\tcontainer\t\t0\n") == ContextStore.RefUnreadable{"container","complete\tpresent\tcontainer\t\t0\n"} : ContextStore.RefLookup}

def a_container_failure_is_never_an_absent_ref():
  {==}

law an_incomplete_entry_is_never_an_absent_ref:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\tentry\t\t0\n") == ContextStore.RefUnreadable{"entry","complete\tpresent\tentry\t\t0\n"} : ContextStore.RefLookup}

def an_incomplete_entry_is_never_an_absent_ref():
  {==}

law a_ref_lookup_decodes_a_tabbed_unicode_entry:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t6109620ac3a9e4b8ad\t1\n") == ContextStore.RefFound{"q7","ref-1","complete","a\tb\né中"} : ContextStore.RefLookup}

def a_ref_lookup_decodes_a_tabbed_unicode_entry():
  {==}

law an_unfinished_query_is_not_an_absent_ref:
  {ContextStore.ref_lookup_decode("q7","ref-1","running\tabsent\t0\t\t0\n") == ContextStore.RefOpen{"q7","ref-1","running"} : ContextStore.RefLookup}

def an_unfinished_query_is_not_an_absent_ref():
  {==}

law a_query_without_a_retained_result_is_not_an_absent_ref:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tnull\t0\t\t0\n") == ContextStore.RefUnretained{"q7","ref-1"} : ContextStore.RefLookup}

def a_query_without_a_retained_result_is_not_an_absent_ref():
  {==}

law a_failed_query_names_its_state:
  {ContextStore.ref_lookup_decode("q7","ref-1","failed\tabsent\t0\t\t0\n") == ContextStore.RefFailed{"q7","ref-1","failed"} : ContextStore.RefLookup}

def a_failed_query_names_its_state():
  {==}

law an_absent_query_row_is_not_an_absent_ref:
  {ContextStore.ref_lookup_decode("q7","ref-1","\tabsent\t0\t\t0\n") == ContextStore.RefQueryMissing{"q7","ref-1"} : ContextStore.RefLookup}

def an_absent_query_row_is_not_an_absent_ref():
  {==}

law a_completed_result_without_a_matching_ref_is_absent:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t0\t\t0\n") == ContextStore.RefAbsent{"q7","ref-1"} : ContextStore.RefLookup}

def a_completed_result_without_a_matching_ref_is_absent():
  {==}

law two_matching_entries_are_ambiguous:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t2\t7b7d\t1\n") == ContextStore.RefAmbiguous{"q7","ref-1","2"} : ContextStore.RefLookup}

def two_matching_entries_are_ambiguous():
  {==}

law an_entry_without_the_exact_selector_shape_is_malformed:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t7b22656e67696e65223a6e756c6c7d\t0\n") == ContextStore.RefUnreadable{"shape","complete\tpresent\t1\t7b22656e67696e65223a6e756c6c7d\t0\n"} : ContextStore.RefLookup}

def an_entry_without_the_exact_selector_shape_is_malformed():
  {==}

law an_entry_that_is_not_utf8_is_malformed_with_its_reason:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\tff\t1\n") == ContextStore.RefUnreadable{"scalar","complete\tpresent\t1\tff\t1\n"} : ContextStore.RefLookup}

def an_entry_that_is_not_utf8_is_malformed_with_its_reason():
  {==}


law an_unknown_query_state_is_unreadable:
  {ContextStore.ref_lookup_decode("q7","ref-1","bogus\tpresent\t0\t\t0\n") == ContextStore.RefUnreadable{"state","bogus\tpresent\t0\t\t0\n"} : ContextStore.RefLookup}

def an_unknown_query_state_is_unreadable():
  {==}

law a_noncanonical_count_is_unreadable:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t-1\t\t1\n") == ContextStore.RefUnreadable{"count","complete\tpresent\t-1\t\t1\n"} : ContextStore.RefLookup}

def a_noncanonical_count_is_unreadable():
  {==}

law an_invalid_shape_flag_is_unreadable:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t7b7d\tmaybe\n") == ContextStore.RefUnreadable{"shape","complete\tpresent\t1\t7b7d\tmaybe\n"} : ContextStore.RefLookup}

def an_invalid_shape_flag_is_unreadable():
  {==}

law a_surplus_ref_row_is_unreadable:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\t1\t7b7d\t1\textra\n") == ContextStore.RefUnreadable{"surplus","complete\tpresent\t1\t7b7d\t1\textra\n"} : ContextStore.RefLookup}

def a_surplus_ref_row_is_unreadable():
  {==}

law a_non_array_refs_container_is_unreadable:
  {ContextStore.ref_lookup_decode("q7","ref-1","complete\tpresent\tcontainer\t\t0\n") == ContextStore.RefUnreadable{"container","complete\tpresent\tcontainer\t\t0\n"} : ContextStore.RefLookup}

def a_non_array_refs_container_is_unreadable():
  {==}

# --- the effect service and the observer consumer -----------------------------

law an_envelope_statement_is_its_body_plus_its_terminator:
  {ContextStore.envelope_sql(id) == ContextStore.envelope_body_sql(id) ++ ";" : String}

def an_envelope_statement_is_its_body_plus_its_terminator():
  {==}

law a_retained_read_is_one_observation_of_state_and_envelope:
  {ContextService.retained_sql(query) == "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") THEN 'present' ELSE 'absent' END," ++ "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),'')," ++ "coalesce((" ++ ContextStore.envelope_body_sql(query) ++ "),'');" : String}

def a_retained_read_is_one_observation_of_state_and_envelope():
  {==}

law the_terminal_payload_guard_compares_result_and_error:
  {ContextObserver.terminal_payload_matches(next, result, error) == "state=" ++ C.q(next) ++ " AND result_json IS " ++ ContextStore.json_or_null(result) ++ " AND error_json IS " ++ ContextStore.json_or_null(error) : String}

def the_terminal_payload_guard_compares_result_and_error():
  {==}

law a_present_retained_row_is_found:
  {ContextService.retained_decode("q7","present\tcomplete\t{\"v\":1}\n") == ContextService.RetainedFound{"complete","{\"v\":1}"} : ContextService.Retained}

def a_present_retained_row_is_found():
  {==}

law an_absent_retained_row_is_absent:
  {ContextService.retained_decode("q7","absent\t\t\n") == ContextService.RetainedAbsent{"q7"} : ContextService.Retained}

def an_absent_retained_row_is_absent():
  {==}

law an_absent_retained_row_carrying_a_state_is_malformed:
  {ContextService.retained_decode("q7","absent\tcomplete\t\n") == ContextService.RetainedUnreadable{"absentShape","absent\tcomplete\t\n"} : ContextService.Retained}

def an_absent_retained_row_carrying_a_state_is_malformed():
  {==}

law a_present_retained_row_without_an_envelope_is_malformed:
  {ContextService.retained_decode("q7","present\tcomplete\t\n") == ContextService.RetainedUnreadable{"presentEnvelope","present\tcomplete\t\n"} : ContextService.Retained}

def a_present_retained_row_without_an_envelope_is_malformed():
  {==}

law a_present_retained_row_with_an_unknown_state_is_malformed:
  {ContextService.retained_decode("q7","present\tqueued\t{\"v\":1}\n") == ContextService.RetainedUnreadable{"stateDomain","present\tqueued\t{\"v\":1}\n"} : ContextService.Retained}

def a_present_retained_row_with_an_unknown_state_is_malformed():
  {==}

law a_present_retained_row_whose_envelope_is_not_an_object_is_malformed:
  {ContextService.retained_decode("q7","present\tcomplete\tnot-json\n") == ContextService.RetainedUnreadable{"envelopeShape","present\tcomplete\tnot-json\n"} : ContextService.Retained}

def a_present_retained_row_whose_envelope_is_not_an_object_is_malformed():
  {==}

law a_short_retained_row_is_unreadable:
  {ContextService.retained_decode("q7","present\n") == ContextService.RetainedUnreadable{"short","present\n"} : ContextService.Retained}

def a_short_retained_row_is_unreadable():
  {==}

law a_created_admission_is_admitted:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionCreated{"root","{\"v\":1}","accepted","accepted","","/k","/w","/a"}) == ContextService.SubmissionAdmitted{ContextAdmit.AdmissionCreated{"root","{\"v\":1}","accepted","accepted","","/k","/w","/a"},"plan-1","schema-1"} : ContextService.Submission}

def a_created_admission_is_admitted():
  {==}

law a_retained_admission_of_this_owner_and_request_is_unverified:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","accepted","","/k","/w","/a"}) == ContextService.SubmissionRetainedUnverified{ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","accepted","","/k","/w","/a"},"plan-1","schema-1"} : ContextService.Submission}

def a_retained_admission_of_this_owner_and_request_is_unverified():
  {==}

law a_retained_admission_of_another_owner_is_foreign:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionRetained{"kid","{\"v\":1}","accepted","accepted","","/k","/w","/a"}) == ContextService.SubmissionForeign{"kid","{\"v\":1}"} : ContextService.Submission}

def a_retained_admission_of_another_owner_is_foreign():
  {==}

law an_absent_admission_is_absent:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionAbsent{}) == ContextService.SubmissionAbsent{} : ContextService.Submission}

def an_absent_admission_is_absent():
  {==}

law an_uncertain_admission_keeps_its_stage:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionUncertain{"shape","short"}) == ContextService.SubmissionUncertain{"shape","short"} : ContextService.Submission}

def an_uncertain_admission_keeps_its_stage():
  {==}

law a_custody_under_this_binding_is_admitted:
  {ContextObserver.custody_check("b1","b1","k1","k1") == ContextObserver.CustodyAdmitted{"b1"} : ContextObserver.CustodyCheck}

def a_custody_under_this_binding_is_admitted():
  {==}

law a_custody_under_another_binding_is_a_mismatch:
  {ContextObserver.custody_check("b1","b2","k1","k1") == ContextObserver.CustodyMismatch{"b1","b2"} : ContextObserver.CustodyCheck}

def a_custody_under_another_binding_is_a_mismatch():
  {==}

law a_release_without_custody_names_the_missing_operand:
  {ContextObserver.release_refusal("b1","k1",None{}) == Some{ContextObserver.ReleaseMissingCustody{"keeper under admitted custody"}} : Maybe<&2,ContextObserver.ReleaseOutcome>}

def a_release_without_custody_names_the_missing_operand():
  {==}

law a_release_under_another_binding_names_both_bindings:
  {ContextObserver.release_refusal("b1","k1",Some{ContextObserver.Custody{"k1","b2","h"}}) == Some{ContextObserver.ReleaseCustodyMismatch{"b1","b2"}} : Maybe<&2,ContextObserver.ReleaseOutcome>}

def a_release_under_another_binding_names_both_bindings():
  {==}

law a_release_with_matching_custody_has_no_refusal:
  {ContextObserver.release_refusal("b1","k1",Some{ContextObserver.Custody{"k1","b1","h"}}) == None{} : Maybe<&2,ContextObserver.ReleaseOutcome>}

def a_release_with_matching_custody_has_no_refusal():
  {==}

law an_unavailable_keeper_action_names_the_primitive:
  {ContextObserver.release_unavailable("k1","h","keeper release effect") == ContextObserver.ReleaseEffectUnavailable{"k1","h","keeper release effect"} : ContextObserver.ReleaseOutcome}

def an_unavailable_keeper_action_names_the_primitive():
  {==}

law an_empty_failure_document_is_absent:
  {ContextObserver.failure_schema("") == None{} : Maybe<&2,String>}

def an_empty_failure_document_is_absent():
  {==}

law a_rendered_failure_document_is_present:
  {ContextObserver.failure_schema("{\"code\":2}") == Some{"{\"code\":2}"} : Maybe<&2,String>}

def a_rendered_failure_document_is_present():
  {==}

law a_retained_rejected_admission_is_not_admitted:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionRetained{"root","{\"v\":1}","rejected","refused","","/k","/w","/a"}) == ContextService.SubmissionRetainedRejected{"rejected","refused","root","{\"v\":1}"} : ContextService.Submission}

def a_retained_rejected_admission_is_not_admitted():
  {==}

law a_retained_accepted_record_for_another_request_is_foreign:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionRetained{"root","{\"v\":2}","accepted","accepted","","/k","/w","/a"}) == ContextService.SubmissionForeign{"root","{\"v\":2}"} : ContextService.Submission}

def a_retained_accepted_record_for_another_request_is_foreign():
  {==}

law a_retained_completed_record_replays_without_claiming_the_plan:
  {ContextService.submission_of("root","{\"v\":1}","plan-1","schema-1",ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","complete","","/k","/w","/a"}) == ContextService.SubmissionRetainedUnverified{ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","complete","","/k","/w","/a"},"plan-1","schema-1"} : ContextService.Submission}

def a_retained_completed_record_replays_without_claiming_the_plan():
  {==}

law an_admissible_intent_is_the_recorded_delivery:
  {ContextObserver.intent_decision("present","1","pending","pending") == ContextObserver.IntentAdmissible{"pending"} : ContextObserver.ReleaseIntent}

def an_admissible_intent_is_the_recorded_delivery():
  {==}

law a_different_delivery_state_is_a_stale_intent:
  {ContextObserver.intent_decision("present","1","attempted","pending") == ContextObserver.IntentStale{"attempted","pending"} : ContextObserver.ReleaseIntent}

def a_different_delivery_state_is_a_stale_intent():
  {==}

law an_absent_role_has_no_release_intent:
  {ContextObserver.intent_decision("absent","0","","pending") == ContextObserver.IntentMissing{"role"} : ContextObserver.ReleaseIntent}

def an_absent_role_has_no_release_intent():
  {==}

law a_role_without_an_intent_column_has_no_release_intent:
  {ContextObserver.intent_decision("present","0","","pending") == ContextObserver.IntentMissing{"intent"} : ContextObserver.ReleaseIntent}

def a_role_without_an_intent_column_has_no_release_intent():
  {==}

law a_custody_naming_another_keeper_is_foreign:
  {ContextObserver.custody_check("b1","b1","k2","k1") == ContextObserver.CustodyForeignKeeper{"k2","k1"} : ContextObserver.CustodyCheck}

def a_custody_naming_another_keeper_is_foreign():
  {==}

law a_claim_is_issued_against_the_matched_label:
  {ContextObserver.claim_statement("q1","starter","0","pending","{}") == ContextRoles.release_claim_sql("q1","starter","0","pending","{}") : String}

def a_claim_is_issued_against_the_matched_label():
  {==}

law an_attempt_claim_matches_the_committed_delivery:
  {ContextObserver.claim_attempt_statement("q1","starter","0","pending","{\"delivery\":\"attempted\"}") == ContextRoles.release_claim_sql("q1","starter","0","pending","{\"delivery\":\"attempted\"}") : String}

def an_attempt_claim_matches_the_committed_delivery():
  {==}

law a_completion_claim_matches_the_attempt_state:
  {ContextObserver.claim_completion_statement("q1","starter","0","attempted","{\"delivery\":\"acknowledged\"}") == ContextRoles.release_claim_sql("q1","starter","0","attempted","{\"delivery\":\"acknowledged\"}") : String}

def a_completion_claim_matches_the_attempt_state():
  {==}

law a_release_refusal_of_a_mismatched_binding_names_both:
  {ContextObserver.release_refusal_of("b1",ContextObserver.CustodyMismatch{"b1","b2"}) == Some{ContextObserver.ReleaseCustodyMismatch{"b1","b2"}} : Maybe<&2,ContextObserver.ReleaseOutcome>}

def a_release_refusal_of_a_mismatched_binding_names_both():
  {==}

law a_release_refusal_of_an_admitted_custody_is_absent:
  {ContextObserver.release_refusal_of("b1",ContextObserver.CustodyAdmitted{"b1"}) == None{} : Maybe<&2,ContextObserver.ReleaseOutcome>}

def a_release_refusal_of_an_admitted_custody_is_absent():
  {==}

law a_receipt_row_of_the_requested_identity_is_committed:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t1\t1\t0\n") == ContextObserver.ReceiptPresent{ContextObserver.Receipt{"q1","starter","0","2",True{},False{}}} : ContextObserver.ReceiptRead}

def a_receipt_row_of_the_requested_identity_is_committed():
  {==}

law a_receipt_row_of_another_incarnation_is_malformed:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t0\t1\t1\t0\n") == ContextObserver.ReceiptMalformed{"identity","present\t1\t1\t0\t1\t1\t0\n"} : ContextObserver.ReceiptRead}

def a_receipt_row_of_another_incarnation_is_malformed():
  {==}

law a_receipt_row_at_another_cursor_is_malformed:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t0\t1\t0\n") == ContextObserver.ReceiptMalformed{"cursor","present\t1\t1\t1\t0\t1\t0\n"} : ContextObserver.ReceiptRead}

def a_receipt_row_at_another_cursor_is_malformed():
  {==}

law an_absent_receipt_row_with_stray_columns_is_malformed:
  {ContextObserver.receipt_decode("q1","starter","0","2","absent\t1\t1\t1\t1\t1\t0\n") == ContextObserver.ReceiptMalformed{"absentShape","absent\t1\t1\t1\t1\t1\t0\n"} : ContextObserver.ReceiptRead}

def an_absent_receipt_row_with_stray_columns_is_malformed():
  {==}

law a_document_shaped_answer_is_not_a_committed_receipt:
  {ContextObserver.receipt_decode("q1","starter","0","2","{}\n") == ContextObserver.ReceiptMalformed{"short","{}\n"} : ContextObserver.ReceiptRead}

def a_document_shaped_answer_is_not_a_committed_receipt():
  {==}

law an_absent_receipt_row_of_all_zero_flags_is_absent:
  {ContextObserver.receipt_decode("q1","starter","0","2","absent\t0\t0\t0\t0\t0\t0\n") == ContextObserver.ReceiptAbsent{} : ContextObserver.ReceiptRead}

def an_absent_receipt_row_of_all_zero_flags_is_absent():
  {==}

law an_eight_column_receipt_row_is_surplus:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t1\t1\t1\t0\n") == ContextObserver.ReceiptMalformed{"surplus","present\t1\t1\t1\t1\t1\t1\t0\n"} : ContextObserver.ReceiptRead}

def an_eight_column_receipt_row_is_surplus():
  {==}

law a_receipt_row_with_an_invalid_capture_flag_is_malformed:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t1\tx\t0\n") == ContextObserver.ReceiptMalformed{"evidence","present\t1\t1\t1\t1\tx\t0\n"} : ContextObserver.ReceiptRead}

def a_receipt_row_with_an_invalid_capture_flag_is_malformed():
  {==}

law a_receipt_row_with_an_invalid_exit_flag_is_malformed:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t1\t1\tx\n") == ContextObserver.ReceiptMalformed{"evidence","present\t1\t1\t1\t1\t1\tx\n"} : ContextObserver.ReceiptRead}

def a_receipt_row_with_an_invalid_exit_flag_is_malformed():
  {==}

law a_receipt_row_missing_its_last_flag_is_short:
  {ContextObserver.receipt_decode("q1","starter","0","2","present\t1\t1\t1\t1\t1\n") == ContextObserver.ReceiptMalformed{"short","present\t1\t1\t1\t1\t1\n"} : ContextObserver.ReceiptRead}

def a_receipt_row_missing_its_last_flag_is_short():
  {==}

law a_retained_replay_does_not_claim_the_supplied_plan:
  {ContextService.submission_of("root","{\"v\":1}","plan-2","schema-2",ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","complete","","/k","/w","/a"}) == ContextService.SubmissionRetainedUnverified{ContextAdmit.AdmissionRetained{"root","{\"v\":1}","accepted","complete","","/k","/w","/a"},"plan-2","schema-2"} : ContextService.Submission}

def a_retained_replay_does_not_claim_the_supplied_plan():
  {==}

law an_empty_plan_identity_is_absent:
  {ContextService.plan_identity_present("") == False{} : Bool}

def an_empty_plan_identity_is_absent():
  {==}

law a_supplied_plan_identity_is_carried_unexamined:
  {ContextService.plan_identity_present("plan-1") == True{} : Bool}

def a_supplied_plan_identity_is_carried_unexamined():
  {==}

# ---------------------------------------------------------------------------
# The retained admission association.

law an_absent_association_row_is_a_missing_association:
  {ContextAdmit.association_decode("absent\t\t\n") == ContextAdmit.AssociationMissing{} : ContextAdmit.Association}

def an_absent_association_row_is_a_missing_association():
  {==}

law a_stored_association_row_decodes_its_plan_and_schema:
  {ContextAdmit.association_decode("present\t706c616e\t6964656e74697479\t736368656d61\n") == ContextAdmit.AssociationStored{"plan","identity","schema"} : ContextAdmit.Association}

def a_stored_association_row_decodes_its_plan_and_schema():
  {==}

law an_absent_association_row_carrying_a_value_is_malformed:
  {ContextAdmit.association_decode("absent\t706c616e\t\t\n") == ContextAdmit.AssociationMalformed{"shape","absent\t706c616e\t\t\n"} : ContextAdmit.Association}

def an_absent_association_row_carrying_a_value_is_malformed():
  {==}

law a_stored_association_row_with_odd_framing_is_malformed:
  {ContextAdmit.association_decode("present\t706c61\t6964\t736368656d61\n") == ContextAdmit.AssociationMalformed{"framing","present\t706c61\t6964\t736368656d61\n"} : ContextAdmit.Association}

def a_stored_association_row_with_odd_framing_is_malformed():
  {==}

law a_short_association_row_is_malformed:
  {ContextAdmit.association_decode("present\t706c616e\n") == ContextAdmit.AssociationMalformed{"short","present\t706c616e\n"} : ContextAdmit.Association}

def a_short_association_row_is_malformed():
  {==}

law a_surplus_association_column_is_malformed:
  {ContextAdmit.association_decode("present\t706c616e\t6964656e74697479\t736368656d61\textra\n") == ContextAdmit.AssociationMalformed{"surplus","present\t706c616e\t6964656e74697479\t736368656d61\textra\n"} : ContextAdmit.Association}

def a_surplus_association_column_is_malformed():
  {==}

law an_empty_association_answer_is_malformed:
  {ContextAdmit.association_decode("") == ContextAdmit.AssociationMalformed{"empty",""} : ContextAdmit.Association}

def an_empty_association_answer_is_malformed():
  {==}

law the_association_is_written_only_by_the_transaction_that_created_the_row:
  for +id: String
  for +planValue: String
  for +resultSchema: String
  for +originAttempt: String
  {ContextStore.association_insert_sql(id,planValue,planIdentity,resultSchema,originAttempt) == "INSERT INTO semantic_admissions(query_id,plan_value,plan_identity,result_schema,origin_attempt) SELECT " ++ C.q(id) ++ "," ++ C.q(planValue) ++ "," ++ C.q(planIdentity) ++ "," ++ C.q(resultSchema) ++ "," ++ ContextStore.text_or_null(originAttempt) ++ " WHERE changes()=1 AND NOT EXISTS(SELECT 1 FROM semantic_admissions WHERE query_id=" ++ C.q(id) ++ ");" : String}

def the_association_is_written_only_by_the_transaction_that_created_the_row(id,planValue,resultSchema,originAttempt):
  {==}

law the_associated_admission_records_the_association_before_the_readback:
  for +id: String
  for +owner: String
  for +requestJson: String
  for +keeperPath: String
  for +cwd: String
  for +originAttempt: String
  for +artifactPath: String
  for +planValue: String
  for +planIdentity: String
  for +resultSchema: String
  {ContextAdmit.admit_associated_sql(id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath,planValue,planIdentity,resultSchema) == "BEGIN IMMEDIATE;" ++ ContextStore.schema() ++ ContextAdmit.admit_query_insert_sql(id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath) ++ ContextStore.association_insert_sql(id,planValue,planIdentity,resultSchema,originAttempt) ++ ContextAdmit.admit_row_sql(id) ++ "COMMIT;" : String}

def the_associated_admission_records_the_association_before_the_readback(id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath,planValue,resultSchema):
  {==}

law two_different_plans_do_not_share_an_association_insert:
  for +id: String
  for +originAttempt: String
  {Bool.not(String.eq(ContextStore.association_insert_sql(id,"plan-a","id-a","schema-a",originAttempt), ContextStore.association_insert_sql(id,"plan-b","id-b","schema-a",originAttempt))) == True{} : Bool}

def two_different_plans_do_not_share_an_association_insert(id,originAttempt):
  {==}

law two_different_schemas_do_not_share_an_association_insert:
  for +id: String
  for +originAttempt: String
  {Bool.not(String.eq(ContextStore.association_insert_sql(id,"plan-a","id-a","schema-a",originAttempt), ContextStore.association_insert_sql(id,"plan-a","id-a","schema-b",originAttempt))) == True{} : Bool}

def two_different_schemas_do_not_share_an_association_insert(id,originAttempt):
  {==}

law an_association_answer_row_carries_the_absent_marker_for_a_row_without_one:
  {ContextStore.association_row_sql("q1") == "SELECT CASE WHEN " ++ ContextStore.association_present("q1") ++ " THEN 'present' ELSE 'absent' END," ++ "coalesce((SELECT hex(plan_value) FROM semantic_admissions WHERE query_id=" ++ C.q("q1") ++ "),'')," ++ "coalesce((SELECT hex(plan_identity) FROM semantic_admissions WHERE query_id=" ++ C.q("q1") ++ "),'')," ++ "coalesce((SELECT hex(result_schema) FROM semantic_admissions WHERE query_id=" ++ C.q("q1") ++ "),'');" : String}

def an_association_answer_row_carries_the_absent_marker_for_a_row_without_one():
  {==}

law an_absent_plan_identity_refuses_without_reaching_the_admission:
  for +db: String
  for +binding: String
  for +id: String
  for +owner: String
  for +requestJson: String
  for +keeperPath: String
  for +cwd: String
  for +originAttempt: String
  for +artifactPath: String
  for +plan: String
  for +resultSchema: String
  {ContextService.submit_identified(True{},db,binding,id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath,plan,resultSchema) == IO.pure(ContextService.Submission, ContextService.SubmissionPlanRefused{"plan","absent"}) : IO(ContextService.Submission)}

def an_absent_plan_identity_refuses_without_reaching_the_admission(db,binding,id,owner,requestJson,keeperPath,cwd,originAttempt,artifactPath,plan,resultSchema):
  {==}

law a_replayed_identity_that_equals_the_stored_one_verifies_the_association:
  {ContextService.submission_replayed("root","rq","plan","schema",ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},ContextAdmit.AssociationStored{"pv","plan","s"}) == ContextService.SubmissionRetainedVerified{ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},"pv","s"} : ContextService.Submission}

def a_replayed_identity_that_equals_the_stored_one_verifies_the_association():
  {==}

law a_replayed_identity_that_differs_from_the_stored_one_refuses_as_stale:
  {ContextService.submission_replayed("root","rq","other-plan","schema",ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},ContextAdmit.AssociationStored{"pv","plan","s"}) == ContextService.SubmissionPlanRefused{"plan","stale"} : ContextService.Submission}

def a_replayed_identity_that_differs_from_the_stored_one_refuses_as_stale():
  {==}

law a_created_admission_answers_with_the_stored_rendering_and_schema:
  {ContextService.submission_replayed("root","rq","plan","schema",ContextAdmit.AdmissionCreated{"root","rq","accepted","accepted","a","/l","/w","/art"},ContextAdmit.AssociationStored{"pv","plan","s"}) == ContextService.SubmissionAdmitted{ContextAdmit.AdmissionCreated{"root","rq","accepted","accepted","a","/l","/w","/art"},"pv","s"} : ContextService.Submission}

def a_created_admission_answers_with_the_stored_rendering_and_schema():
  {==}

law a_row_without_a_stored_association_stays_unestablished:
  {ContextService.submission_replayed("root","rq","plan","schema",ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},ContextAdmit.AssociationMissing{}) == ContextService.SubmissionRetainedUnverified{ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},"plan","schema"} : ContextService.Submission}

def a_row_without_a_stored_association_stays_unestablished():
  {==}

law a_retained_row_of_another_owner_is_foreign_however_its_association_reads:
  {ContextService.submission_replayed("root","rq","plan","schema",ContextAdmit.AdmissionRetained{"kid","rq","accepted","complete","a","/l","/w","/art"},ContextAdmit.AssociationStored{"pv","plan","s"}) == ContextService.SubmissionForeign{"kid","rq"} : ContextService.Submission}

def a_retained_row_of_another_owner_is_foreign_however_its_association_reads():
  {==}

law a_malformed_association_keeps_its_stage:
  {ContextService.submission_replayed("root","rq","plan","schema",ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},ContextAdmit.AssociationMalformed{"framing","x"}) == ContextService.SubmissionUncertain{"framing","x"} : ContextService.Submission}

def a_malformed_association_keeps_its_stage():
  {==}

law a_read_back_association_decides_the_replay:
  {ContextService.association_after("root","rq","plan","schema",ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},Done{ContextAdmit.AssociationStored{"pv","plan","s"}}) == IO.pure(ContextService.Submission, ContextService.SubmissionRetainedVerified{ContextAdmit.AdmissionRetained{"root","rq","accepted","complete","a","/l","/w","/art"},"pv","s"}) : IO(ContextService.Submission)}

def a_read_back_association_decides_the_replay():
  {==}

# These laws bind native projection, parsing and read dispatch. Host tests qualify
# SQLite read-only opening, snapshot behavior and database preservation.
import Base
import ./commands.bend as C
import ./index-reads.bend as IndexReads
import ../host/sqlite.bend as DB

law metadata_snapshot_uses_the_readonly_host_effect:
  for db: String
  for command: C.Command
  {IndexReads.snapshot(db,command) == DB.Sql.read(db,C.sql(command)) : IO(Result<&1,&1,U32 & String,String>)}

def metadata_snapshot_uses_the_readonly_host_effect(db,command):
  {==}

law metadata_filters_are_conjunctive_and_ordered:
  for r: C.IndexText
  for s: C.IndexText
  for k: C.IndexText
  for state: String
  {C.message_index_sql(r,s,k,state) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT " ++ C.message_index_row() ++ " AS item FROM messages m WHERE " ++ C.index_filter("m.recipient",r) ++ " AND " ++ C.index_filter("m.sender",s) ++ " AND " ++ C.index_filter("m.kind",k) ++ " AND " ++ C.index_state_sql(state) ++ " ORDER BY m.seq);" : String}

def metadata_filters_are_conjunctive_and_ordered(r,s,k,state):
  {==}

law metadata_rows_preserve_receipt_and_input_dispositions:
  {C.message_index_row() == "json_patch(json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'seq',m.seq,'bodyBytes',length(CAST(m.body AS BLOB)),'receiptState',CASE WHEN m.receipt IS NULL THEN 'unacknowledged' ELSE 'acknowledged' END)," ++ C.input_state_sql("m") ++ ")" : String}

def metadata_rows_preserve_receipt_and_input_dispositions():
  {==}

law pending_index_selects_null_receipts:
  {C.index_state_sql("pending") == "m.receipt IS NULL" : String}

def pending_index_selects_null_receipts():
  {==}

law exact_index_filter_quotes_its_literal:
  for column: String
  for value: String
  {C.index_filter(column,C.IndexExact{value}) == column ++ "=" ++ C.q(value) : String}

def exact_index_filter_quotes_its_literal(column,value):
  {==}

law omitted_index_filter_has_no_predicate:
  for column: String
  {C.index_filter(column,C.IndexAny{}) == "1" : String}

def omitted_index_filter_has_no_predicate(column):
  {==}

law inbox_index_fixes_recipient_and_defaults_pending:
  for session: String
  {C.parse(["inbox",session,"--index"]) == C.MessageIndex{C.IndexExact{session},C.IndexAny{},C.IndexAny{},"pending"} : C.Command}

def inbox_index_fixes_recipient_and_defaults_pending(session):
  {==}

law pending_index_preserves_explicit_empty_filter:
  {C.parse(["pending","--index","--recipient",""]) == C.MessageIndex{C.IndexExact{""},C.IndexAny{},C.IndexAny{},"pending"} : C.Command}

def pending_index_preserves_explicit_empty_filter():
  {==}

law repeated_index_filter_refuses:
  {C.parse(["pending","--index","--sender","a","--sender","b"]) == C.Invalid{} : C.Command}

def repeated_index_filter_refuses():
  {==}

law metadata_filters_require_index_admission:
  {C.parse(["pending","--kind","report"]) == C.Invalid{} : C.Command}

def metadata_filters_require_index_admission():
  {==}

law metadata_unknown_state_refuses:
  {C.parse(["pending","--index","--state","read"]) == C.Invalid{} : C.Command}

def metadata_unknown_state_refuses():
  {==}

law focused_orchestra_keeps_the_requested_subject:
  for session: String
  {C.parse(["orchestra","--pretty","--for",session,"--index"]) == C.Pretty{C.OrchestraIndex{C.IndexExact{session}}} : C.Command}

def focused_orchestra_keeps_the_requested_subject(session):
  {==}

law unknown_focus_refusal_preserves_error_status:
  for saved: String
  for pretty: Bool
  {IndexReads.answer(saved,pretty,True{}) == IO.die(Unit,2,saved) : IO(Unit)}

def unknown_focus_refusal_preserves_error_status(saved,pretty):
  {==}

law metadata_command_uses_the_shared_projection:
  for r: C.IndexText
  for s: C.IndexText
  for k: C.IndexText
  for state: String
  {C.sql(C.MessageIndex{r,s,k,state}) == C.message_index_sql(r,s,k,state) : String}

def metadata_command_uses_the_shared_projection(r,s,k,state):
  {==}

law orchestra_command_uses_the_focused_projection:
  for focus: C.IndexText
  {C.sql(C.OrchestraIndex{focus}) == C.orchestra_index_sql(focus) : String}

def orchestra_command_uses_the_focused_projection(focus):
  {==}

law orchestra_reference_expansion_uses_only_the_base_and_selected_ensembles:
  for +focus: C.IndexText
  {C.orchestra_index_scope(focus) == ("WITH base(id) AS (SELECT s.id FROM sessions s WHERE " ++ C.index_focus_text(focus) ++ " IS NULL OR s.id=" ++ C.index_focus_text(focus) ++ " OR s.id IN (" ++ C.ancestors(C.index_focus_text(focus)) ++ ") OR " ++ C.descendant(C.index_focus_text(focus),"s.id") ++ "),"
  ++ "chosen_ensembles(id) AS (SELECT e.id FROM ensembles e WHERE e.owner IN (SELECT id FROM base) OR EXISTS(SELECT 1 FROM ensemble_members em WHERE em.ensemble=e.id AND em.session=" ++ C.index_focus_text(focus) ++ ")),"
  ++ "chosen_routes(id) AS (SELECT r.id FROM sessions r WHERE " ++ C.index_focus_text(focus) ++ " IS NOT NULL AND " ++ C.message_route(C.index_focus_text(focus),"r.id") ++ "),"
  ++ "selected(id) AS (SELECT id FROM base UNION SELECT e.owner FROM ensembles e JOIN chosen_ensembles ce ON ce.id=e.id UNION SELECT em.session FROM ensemble_members em JOIN chosen_ensembles ce ON ce.id=em.ensemble UNION SELECT id FROM chosen_routes) ") : String}

def orchestra_reference_expansion_uses_only_the_base_and_selected_ensembles(focus):
  {==}

law structural_index_preserves_recorded_process_and_assignment_facts:
  for condition: String
  {C.orchestra_index_players(condition) == "(SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_object('id',s.id,'kind'," ++ C.session_kind("s.id") ++ ",'role'," ++ C.public_role("s.id") ++ ",'parent',s.parent,'harness',s.harness,'model',s.model,'effort',s.effort,'observedHarness',s.observed_harness,'observedModel',s.observed_model,'observedEffort',s.observed_effort,'workspace',s.workspace,'branch',s.branch,'base',s.base,'reference',json(CASE WHEN s.id IN (SELECT id FROM base) THEN 'false' ELSE 'true' END),'execution',(SELECT json_object('attempt',id,'mode',mode,'phase',phase,'status',status) FROM executions WHERE session=s.id),'stop',(SELECT json_object('id',id,'status',outcome,'attempt',nullif(attempt,''),'reportId',nullif(report_id,'')) FROM session_stops WHERE session=s.id),'endpointRegistered',json(CASE WHEN s.endpoint='' THEN 'false' ELSE 'true' END),'lastTurnId',(SELECT t.id FROM turns t WHERE t.worker=s.id ORDER BY rowid DESC LIMIT 1),'latestReportId',(SELECT m.id FROM messages m WHERE m.sender=s.id AND m.kind='report' ORDER BY m.seq DESC LIMIT 1),'pendingCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL AND NOT (" ++ C.stopped_session_sql("s.id") ++ " AND " ++ C.execution_input_sql("messages.kind") ++ ")),'unacknowledgedCount',(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL),'inputRead',json_array('inbox',s.id,'--index'),'ownedEnsembles',(SELECT json_group_array(id) FROM (SELECT id FROM ensembles WHERE owner=s.id ORDER BY id)),'memberEnsembles',(SELECT json_group_array(ensemble) FROM (SELECT ensemble FROM ensemble_members WHERE session=s.id ORDER BY ensemble))) AS item FROM sessions s WHERE s.id IN (SELECT id FROM selected) AND " ++ condition ++ " ORDER BY s.id))" : String}

def structural_index_preserves_recorded_process_and_assignment_facts(condition):
  {==}

law structural_index_contains_structure_and_actor_counts:
  for +focus: C.IndexText
  {C.orchestra_index_sql(focus) == (C.orchestra_index_scope(focus)
  ++ "SELECT CASE WHEN " ++ C.index_focus_text(focus) ++ " IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.index_focus_text(focus) ++ ") THEN json_object('error','orchestra-subject-unknown','command','orchestra','condition','The focused session is not registered.','next','Read players or orchestra --index and select a recorded ID.') ELSE json_object('version',1,'subject'," ++ C.index_focus_text(focus) ++ ",'selection',json_object('mode',CASE WHEN " ++ C.index_focus_text(focus) ++ " IS NULL THEN 'all' ELSE 'connected' END,'rule','parent-owner-member-routes-v1'),'players'," ++ C.orchestra_index_players(C.assigned_role("s.id") ++ "<>'operator'") ++ ",'operators'," ++ C.orchestra_index_players(C.assigned_role("s.id") ++ "='operator'") ++ ",'ensembles',(SELECT json_group_array(json(item)) FROM (SELECT " ++ C.ensemble_row("e") ++ " AS item FROM ensembles e WHERE e.id IN (SELECT id FROM chosen_ensembles) ORDER BY e.id)),'routes',json(CASE WHEN " ++ C.index_focus_text(focus) ++ " IS NULL THEN 'null' ELSE (SELECT json_group_array(json_object('sender'," ++ C.index_focus_text(focus) ++ ",'recipient',id)) FROM chosen_routes) END),'limitations',(SELECT json_group_array(json_object('kind','reference','id',id,'next',json_array('orchestra','--index','--for',id))) FROM (SELECT id FROM selected WHERE id NOT IN (SELECT id FROM base) ORDER BY id))) END;") : String}

def structural_index_contains_structure_and_actor_counts(focus):
  {==}

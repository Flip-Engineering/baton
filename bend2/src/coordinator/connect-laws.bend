# The entry imports these admission laws. SQLite evaluates the declared
# predicate and transaction; the native connect tests verify stored state and
# delivery through the real executable.
import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../git/text.bend as Tx

law session_answer_preserves_the_supplied_admission_condition:
  for condition: String
  {C.session_result_where(condition) == "SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ C.endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ")," ++ C.session_state_sql("sessions.id") ++ ") FROM sessions WHERE " ++ condition ++ ";" : String}

def session_answer_preserves_the_supplied_admission_condition(condition):
  {==}

law connect_commands_apply_endpoint_admission:
  for id: String
  for native: String
  for endpoint: String
  {C.sql(C.Connect{id,native,endpoint}) == C.connect_sql(id,native,endpoint) : String}

def connect_commands_apply_endpoint_admission(id,native,endpoint):
  {==}

law connect_admission_requires_native_argv_or_explicit_disconnection:
  for +endpoint: String
  {C.endpoint_admitted(endpoint) == "(" ++ C.q(endpoint) ++ "='' OR CASE WHEN json_valid(" ++ C.q(endpoint) ++ ") THEN json_type(" ++ C.q(endpoint) ++ ")='array' AND json_array_length(" ++ C.q(endpoint) ++ ")>0 AND NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(endpoint) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) AND coalesce(json_extract(" ++ C.q(endpoint) ++ ",'$[0]'),'')<>'' ELSE 0 END)" : String}

def connect_admission_requires_native_argv_or_explicit_disconnection(endpoint):
  {==}

law connect_updates_and_answers_only_after_admission:
  for +id: String
  for native: String
  for +endpoint: String
  {C.connect_sql(id,native,endpoint) == "UPDATE sessions SET native=" ++ C.q(native) ++ ",endpoint=" ++ C.q(endpoint) ++ " WHERE id=" ++ C.q(id) ++ " AND " ++ C.endpoint_admitted(endpoint) ++ ";"
  ++ "SELECT json_object('error','invalid-endpoint','session'," ++ C.q(id) ++ ",'condition','Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.','next','Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.') WHERE NOT " ++ C.endpoint_admitted(endpoint) ++ ";"
  ++ C.session_result_where("id=" ++ C.q(id) ++ " AND " ++ C.endpoint_admitted(endpoint)) : String}

def connect_updates_and_answers_only_after_admission(id,native,endpoint):
  {==}

law connect_refusal_is_classified_before_delivery:
  for +saved: String
  {Store.refused(saved) == Bool.or(Store.naming_refused(saved),Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\"")))) : Bool}

def connect_refusal_is_classified_before_delivery(saved):
  {==}

law refused_connections_return_the_structured_error:
  for db: String
  for id: String
  for native: String
  for endpoint: String
  for saved: String
  {Store.route_accepted(db,C.Connect{id,native,endpoint},saved,True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)}) : IO(Result<&1,&1,U32 & String,String>)}

def refused_connections_return_the_structured_error(db,id,native,endpoint,saved):
  {==}

law connect_invalid_endpoint_output_is_refused:
  {Store.refused("{\"error\":\"invalid-endpoint\",\"session\":\"lead\",\"condition\":\"Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.\",\"next\":\"Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.\"}\n") == True{} : Bool}

def connect_invalid_endpoint_output_is_refused():
  {==}

law connect_invalid_endpoint_output_returns_exit_two:
  for db: String
  for command: C.Command
  {Store.committed(db,command,Done{"{\"error\":\"invalid-endpoint\",\"session\":\"lead\",\"condition\":\"Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.\",\"next\":\"Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.\"}\n"}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"{\"error\":\"invalid-endpoint\",\"session\":\"lead\",\"condition\":\"Use an empty endpoint to disconnect, or a nonempty JSON array of text arguments with a nonempty executable and no NUL characters.\",\"next\":\"Pass the JSON argv array itself as one ENDPOINT argument; inspect session and inbox, then retry retained input after connecting.\"}\n")}) : IO(Result<&1,&1,U32 & String,String>)}

def connect_invalid_endpoint_output_returns_exit_two(db,command):
  {==}

law endpoint_reads_present_the_stored_argv_array:
  for +column: String
  {C.endpoint_argv(column) == "CASE WHEN json_valid(" ++ column ++ ") THEN CASE WHEN json_type(" ++ column ++ ")='array' THEN json(" ++ column ++ ") ELSE NULL END ELSE NULL END" : String}

def endpoint_reads_present_the_stored_argv_array(column):
  {==}

law delivery_rows_present_the_recipient_endpoint_argv:
  {C.delivery_row() == "json_patch(json_object('id',m.id,'sender',m.sender,'recipient',m.recipient,'kind',m.kind,'body',m.body,'receipt',m.receipt,'harness',s.harness,'native',s.native,'endpoint',s.endpoint,'endpointArgv'," ++ C.endpoint_argv("s.endpoint") ++ ")," ++ C.input_state_sql("m") ++ ")" : String}

def delivery_rows_present_the_recipient_endpoint_argv():
  {==}

law status_rows_present_the_stored_endpoint_argv:
  {C.sql(C.Status{}) == "SELECT coalesce(json_group_array(json(item)),json('[]')) FROM (SELECT json_patch(json_object('id',id,'parent',parent,'harness',harness,'model',model,'effort',effort,'native',native,'observedHarness',observed_harness,'observedModel',observed_model,'observedEffort',observed_effort,'endpoint',endpoint,'endpointArgv'," ++ C.endpoint_argv("endpoint") ++ ",'workspace',workspace,'branch',branch,'base',base,'kind'," ++ C.session_kind("sessions.id") ++ ",'role'," ++ C.public_role("sessions.id") ++ ",'pending',(SELECT count(*) FROM messages WHERE recipient=sessions.id AND receipt IS NULL AND NOT (" ++ C.stopped_session_sql("sessions.id") ++ " AND " ++ C.execution_input_sql("messages.kind") ++ ")))," ++ C.session_state_sql("sessions.id") ++ ") AS item FROM sessions ORDER BY id);" : String}

def status_rows_present_the_stored_endpoint_argv():
  {==}

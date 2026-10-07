import Base
import ./turn.bend as Turn
import ./commands.bend as C

law muse_primary_identity_comes_from_the_admitted_turn_input:
  for +event: String
  {Turn.primary_command_sql(event) == "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.payload_type')='turn.input.user' AND json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='turn_input_user' THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.payload.command_id'),'') ELSE '' END ELSE '' END;" : String}

law muse_terminal_requires_the_admitted_command:
  for +event: String
  for +primary: String
  {Turn.primary_terminal_expr(event,primary) == "CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' AND " ++ C.q(primary) ++ "<>'' AND json_extract(" ++ C.q(event) ++ ",'$.payload.command_id')=" ++ C.q(primary) ++ " THEN 1 ELSE 0 END ELSE 0 END" : String}

law omp_terminal_normalizes_message_and_content_members:
  for +event: String
  for +message: String
  {Turn.omp_terminal_messages_sql(event,message) == "CASE WHEN " ++ Turn.omp_terminal_objects_sql(event) ++ "=0 AND json_valid(" ++ C.q(message) ++ ") THEN json_array(json(" ++ C.q(message) ++ ")) ELSE " ++ Turn.omp_terminal_kept_sql(event) ++ " END" : String}

law omp_terminal_assistant_content_contains_only_object_blocks:
  for +message: String
  {Turn.omp_content_sql(message) == "CASE WHEN json_extract(" ++ C.q(message) ++ ",'$.role')='assistant' THEN json_set(" ++ C.q(message) ++ ",'$.content',json(CASE WHEN json_type(" ++ C.q(message) ++ ",'$.content')='array' THEN coalesce((SELECT json_group_array(json(content.value)) FROM (SELECT c.value AS value,c.key AS key FROM json_each(" ++ C.q(message) ++ ",'$.content') c WHERE json_type(" ++ C.q(message) ++ ",'$.content[' || c.key || ']')='object' ORDER BY c.key) content),'[]') ELSE '[]' END)) ELSE json(" ++ C.q(message) ++ ") END" : String}

law completion_identity_refuses_changed_reports_without_null_ids:
  for +id: String
  for +player: String
  for +event: String
  {Turn.completion_state_expr(id,player,event) == "CASE WHEN EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body(event) ++ ") THEN 'same' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body(event) ++ ") THEN '' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") OR EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") THEN 'conflict' ELSE '' END" : String}

def muse_primary_identity_comes_from_the_admitted_turn_input(event):
  {==}

def muse_terminal_requires_the_admitted_command(event,primary):
  {==}

def omp_terminal_normalizes_message_and_content_members(event,message):
  {==}

def omp_terminal_assistant_content_contains_only_object_blocks(message):
  {==}

def completion_identity_refuses_changed_reports_without_null_ids(id,player,event):
  {==}

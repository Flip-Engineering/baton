# CLAIM: the candidate report and its wake address are fixed values. Each law
# pins one value the module must produce: the row query's exact text so a change
# to the classification is a deliberate edit, one stalled row's JSON object, an
# empty report being an empty array, empty and malformed lines being skipped
# with rows separated by commas, and the owed message each eligible row
# contributes to the wake. The fixtures pin that active, stopped and blocked
# candidates contribute no wake address.
# Serves: docs/pure-bend2/pending-stall-bend2.md.
import Base
import ./stall.bend as Stall
import ../coordinator/commands.bend as C

def row() -> String:
  "worker\t18\tattempt-1\texited\t1\tm7\t0\t\tstalled"

def active_row() -> String:
  "worker\t18\tattempt-1\trunning\t1\tm7\t0\t\tactive"

def stopped_row() -> String:
  "worker\t18\tattempt-1\texited\t1\tm7\t1\t\tstopped"

def blocked_row() -> String:
  "worker\t18\tattempt-1\texited\t0\tm7\t0\t\tblocked"

def claimed_row() -> String:
  "worker\t18\tattempt-1\texited\t1\tm7\t0\tclaimed\tclaimed"

def never_row() -> String:
  "worker\t18\t\t\t1\tm7\t0\t\tblocked"

def two_rows() -> List<String>:
  Con{"", Con{row(), Con{"", Con{row(), Nil{}}}}}

law the_row_query_selects_pending_candidates_and_classifies_them:
  {Stall.stalled_rows_sql(True{}) == "SELECT s.id||char(9)||CAST((SELECT count(*) FROM messages m WHERE m.recipient=s.id AND NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=m.id AND owed_read.recipient=m.recipient) AND NOT " ++ C.task_closed_sql("s.id") ++ ") AS TEXT)||char(9)||coalesce(e.id,'')||char(9)||coalesce(e.phase,'')||char(9)||CAST(CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END AS TEXT)||char(9)||coalesce((SELECT m.id FROM messages m WHERE m.recipient=s.id AND NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=m.id AND owed_read.recipient=m.recipient) ORDER BY m.seq LIMIT 1),'')||char(9)||CAST(EXISTS(SELECT 1 FROM session_stops WHERE session=s.id) AS TEXT)||char(9)||coalesce((SELECT state FROM wake_claims WHERE session=s.id),'')||char(9)||CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=s.id) THEN 'stopped' WHEN coalesce((SELECT state FROM wake_claims WHERE session=s.id),'')='claimed' THEN 'claimed' WHEN coalesce(e.phase,'')='' THEN 'blocked' WHEN e.phase='exited' AND (CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END)=0 THEN 'blocked' WHEN e.phase='exited' THEN 'stalled' ELSE 'active' END FROM sessions s LEFT JOIN executions e ON e.session=s.id WHERE (SELECT count(*) FROM messages m WHERE m.recipient=s.id AND NOT EXISTS(SELECT 1 FROM message_reads owed_read WHERE owed_read.message=m.id AND owed_read.recipient=m.recipient) AND NOT " ++ C.task_closed_sql("s.id") ++ ")>0 ORDER BY s.id;" : String}

def the_row_query_selects_pending_candidates_and_classifies_them():
  {==}

law the_claimless_query_omits_the_claim_table:
  {String.contains(Stall.stalled_rows_sql(False{}),"wake_claims") == False{} : Bool}

def the_claimless_query_omits_the_claim_table():
  {==}

law a_stalled_row_becomes_the_fact_object:
  {Stall.row_json(row()) == "{\"id\":\"worker\",\"pending\":18,\"attempt\":{\"id\":\"attempt-1\",\"phase\":\"exited\"},\"endpointPresent\":1,\"owedMessage\":\"m7\",\"stopped\":0,\"claim\":\"\",\"state\":\"stalled\"}" : String}

def a_stalled_row_becomes_the_fact_object():
  {==}

law a_never_started_row_is_blocked:
  {Stall.row_json(never_row()) == "{\"id\":\"worker\",\"pending\":18,\"attempt\":{\"id\":\"\",\"phase\":\"\"},\"endpointPresent\":1,\"owedMessage\":\"m7\",\"stopped\":0,\"claim\":\"\",\"state\":\"blocked\"}" : String}

def a_never_started_row_is_blocked():
  {==}

law a_row_without_nine_fields_is_skipped:
  {Stall.row_json("worker\t18") == SNil{} : String}

def a_row_without_nine_fields_is_skipped():
  {==}

law an_empty_report_is_an_empty_array:
  {Stall.report_text(Stall.rows_json(Nil{}, True{})) == "{\"candidates\":[]}" : String}

def an_empty_report_is_an_empty_array():
  {==}

law a_stalled_row_contributes_its_owed_message:
  {Stall.owed_of(row()) == ["m7"] : List<String>}

def a_stalled_row_contributes_its_owed_message():
  {==}

law an_active_row_contributes_no_wake:
  {Stall.owed_of(active_row()) == Nil{} : List<String>}

def an_active_row_contributes_no_wake():
  {==}

law a_stopped_row_contributes_no_wake:
  {Stall.owed_of(stopped_row()) == Nil{} : List<String>}

def a_stopped_row_contributes_no_wake():
  {==}

law a_blocked_row_contributes_no_wake:
  {Stall.owed_of(blocked_row()) == Nil{} : List<String>}

def a_blocked_row_contributes_no_wake():
  {==}

law an_exited_claimed_row_contributes_its_owed_message:
  {Stall.owed_of(claimed_row()) == ["m7"] : List<String>}

def an_exited_claimed_row_contributes_its_owed_message():
  {==}

law a_row_without_an_owed_message_contributes_nothing:
  {Stall.owed_of("worker\t18\tattempt-1\texited\t1\t\t0\t\tstalled") == Nil{} : List<String>}

def a_row_without_an_owed_message_contributes_nothing():
  {==}

law rows_json_skips_empty_lines_and_separates_rows:
  {Stall.rows_json(two_rows(), True{}) == Stall.row_json(row()) ++ "," ++ Stall.row_json(row()) : String}

def rows_json_skips_empty_lines_and_separates_rows():
  {==}

law rows_json_of_empty_lines_is_empty:
  {Stall.rows_json(Con{"", Con{"", Nil{}}}, True{}) == "" : String}

def rows_json_of_empty_lines_is_empty():
  {==}

law rows_json_skips_a_malformed_row_before_a_valid_row:
  {Stall.rows_json(Con{"malformed", Con{row(), Nil{}}}, True{}) == Stall.row_json(row()) : String}

def rows_json_skips_a_malformed_row_before_a_valid_row():
  {==}

law rows_json_skips_a_malformed_row_between_valid_rows:
  {Stall.rows_json(Con{row(), Con{"malformed", Con{row(), Nil{}}}}, True{}) == Stall.row_json(row()) ++ "," ++ Stall.row_json(row()) : String}

def rows_json_skips_a_malformed_row_between_valid_rows():
  {==}

law rows_json_skips_a_malformed_row_after_a_valid_row:
  {Stall.rows_json(Con{row(), Con{"malformed", Nil{}}}, True{}) == Stall.row_json(row()) : String}

def rows_json_skips_a_malformed_row_after_a_valid_row():
  {==}

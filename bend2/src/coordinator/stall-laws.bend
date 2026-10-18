# CLAIM: the stall report and its wake address are fixed values. Each law pins one
# value the module must produce: the row query's exact text so a change to the
# predicate is a deliberate edit, one row's JSON object, a malformed row being
# skipped, an empty report being an empty array, empty lines and malformed rows
# skipped with rows separated by commas, and the owed message each row
# contributes to the wake.
# Serves: docs/pure-bend2/pending-stall-bend2.md.
import Base
import ./stall.bend as Stall

def row() -> String:
  "worker\t18\tattempt-1\trunning\t1\tm7"

def two_rows() -> List<String>:
  Con{"", Con{row(), Con{"", Con{row(), Nil{}}}}}

law the_row_query_selects_live_attempts_with_owed_input_and_an_endpoint:
  {Stall.stalled_rows_sql() == "SELECT s.id||char(9)||CAST((SELECT count(*) FROM messages m WHERE m.recipient=s.id AND m.receipt IS NULL) AS TEXT)||char(9)||coalesce(e.id,'')||char(9)||coalesce(e.phase,'')||char(9)||CAST(CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END AS TEXT)||char(9)||coalesce((SELECT m.id FROM messages m WHERE m.recipient=s.id AND m.receipt IS NULL ORDER BY m.seq LIMIT 1),'') FROM sessions s JOIN executions e ON e.session=s.id WHERE e.phase<>'exited' AND (SELECT count(*) FROM messages m WHERE m.recipient=s.id AND m.receipt IS NULL)>0 AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END=1 ORDER BY s.id;" : String}

def the_row_query_selects_live_attempts_with_owed_input_and_an_endpoint():
  {==}

law a_row_becomes_the_fact_object:
  {Stall.row_json(row()) == "{\"id\":\"worker\",\"pending\":18,\"attempt\":{\"id\":\"attempt-1\",\"phase\":\"running\"},\"endpointPresent\":1,\"owedMessage\":\"m7\"}" : String}

def a_row_becomes_the_fact_object():
  {==}

law a_row_without_six_fields_is_skipped:
  {Stall.row_json("worker\t18") == SNil{} : String}

def a_row_without_six_fields_is_skipped():
  {==}

law an_empty_report_is_an_empty_array:
  {Stall.report_text(Stall.rows_json(Nil{}, True{})) == "{\"stalled\":[]}" : String}

def an_empty_report_is_an_empty_array():
  {==}

law a_row_contributes_its_owed_message:
  {Stall.owed_of(row()) == ["m7"] : List<String>}

def a_row_contributes_its_owed_message():
  {==}

law a_row_without_an_owed_message_contributes_nothing:
  {Stall.owed_of("worker\t18\tattempt-1\trunning\t1\t") == Nil{} : List<String>}

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

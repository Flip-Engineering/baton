# Laws for the Claude Code stdin delivery rule (#1298): stdin stays open after the
# first prompt so a native that outlives its turn for background tasks can receive
# owed input; the observer closes it once the native lists no task. The retained
# path's keep_stdin law also stands in laws.bend as
# m13_a_retained_claude_attempt_keeps_its_input_open_as_an_omp_attempt_does; the
# laws.bend entry overflows the compiler's stack under the pinned compiler, so the
# copy here is the one that is checked.
import Base
import ./turn.bend as Turn
import ./guidance.bend as Guidance

# #1298: a Claude Code native that outlives its turn for background tasks can
# receive owed input only while its stdin is open. The direct path keeps stdin open
# for Claude Code and OMP and closes it after the first prompt for the others.
law claude_stdin_stays_open_after_the_first_prompt:
  {Turn.stdin_kept_open("claude-code\n") == True{} : Bool}

def claude_stdin_stays_open_after_the_first_prompt():
  {==}

law a_retained_claude_attempt_keeps_its_input_open_as_an_omp_attempt_does:
  {U32.is_eq(Turn.retained_keep_stdin(False{},False{},True{}),Turn.retained_keep_stdin(False{},True{},False{})) == True{} : Bool}

def a_retained_claude_attempt_keeps_its_input_open_as_an_omp_attempt_does():
  {==}

law omp_stdin_stays_open_after_the_first_prompt:
  {Turn.stdin_kept_open("omp\n") == True{} : Bool}

def omp_stdin_stays_open_after_the_first_prompt():
  {==}

law codex_stdin_closes_after_the_first_prompt:
  {Turn.stdin_kept_open("codex\n") == False{} : Bool}

def codex_stdin_closes_after_the_first_prompt():
  {==}

law dsh_stdin_closes_after_the_first_prompt:
  {Turn.stdin_kept_open("dsh\n") == False{} : Bool}

def dsh_stdin_closes_after_the_first_prompt():
  {==}

# The observer holds a Claude Code native's stdin open while it lists background
# tasks, drains owed input and closes it once it lists none, and leaves every
# other harness and a native that has not ended a turn to the existing paths.
law claude_holds_stdin_while_background_tasks_run:
  {Guidance.claude_mode(True{},True{},True{}) == "hold" : String}

def claude_holds_stdin_while_background_tasks_run():
  {==}

law claude_drains_and_closes_when_no_background_task_runs:
  {Guidance.claude_mode(True{},True{},False{}) == "drain" : String}

def claude_drains_and_closes_when_no_background_task_runs():
  {==}

law claude_before_its_first_result_keeps_hook_delivery:
  {Guidance.claude_mode(True{},False{},True{}) == "" : String}

def claude_before_its_first_result_keeps_hook_delivery():
  {==}

law other_harnesses_keep_their_input_paths:
  {Guidance.claude_mode(False{},True{},False{}) == "" : String}

def other_harnesses_keep_their_input_paths():
  {==}

# The background state follows the native's own task list and is unchanged by
# any other frame.
law a_task_list_with_tasks_marks_background_work:
  {Guidance.background_next("1\n","0") == "1" : String}

def a_task_list_with_tasks_marks_background_work():
  {==}

law an_empty_task_list_clears_background_work:
  {Guidance.background_next("0\n","1") == "0" : String}

def an_empty_task_list_clears_background_work():
  {==}

law another_frame_keeps_the_background_state:
  {Guidance.background_next("","1") == "1" : String}

def another_frame_keeps_the_background_state():
  {==}

law background_work_is_live_only_while_tasks_are_listed:
  {Guidance.background_live("1") == True{} : Bool}

def background_work_is_live_only_while_tasks_are_listed():
  {==}

# A commit notice drains owed input for OMP before its terminal and for Claude
# Code after its first result.
law a_notice_drains_claude_input_after_its_result:
  {Turn.awake_woke("claude-code\n","{}","result") == True{} : Bool}

def a_notice_drains_claude_input_after_its_result():
  {==}

law a_notice_before_a_claude_result_leaves_input_to_hooks:
  {Turn.awake_woke("claude-code\n","{}","") == False{} : Bool}

def a_notice_before_a_claude_result_leaves_input_to_hooks():
  {==}

law a_notice_drains_omp_input_before_its_terminal:
  {Turn.awake_woke("omp\n","{}","") == True{} : Bool}

def a_notice_drains_omp_input_before_its_terminal():
  {==}

law a_notice_after_an_omp_terminal_drains_nothing:
  {Turn.awake_woke("omp\n","{}","agent_end") == False{} : Bool}

def a_notice_after_an_omp_terminal_drains_nothing():
  {==}

law no_notice_drains_nothing:
  {Turn.awake_woke("claude-code\n","","result") == False{} : Bool}

def no_notice_drains_nothing():
  {==}

# A write the native's closed stdin refuses records no read and leaves the cursor,
# so the owed row stays and the wake path delivers it: a duplicate is possible, a
# lost input is not.
law a_refused_write_leaves_the_cursor_and_the_owed_row:
  for db: String
  for player: String
  for attempt: String
  for +cursor: String
  for next: String
  {Guidance.forwarded(db,player,attempt,cursor,next,Fail{(32,"broken pipe")}) == IO.pure(String,cursor) : IO(String)}

def a_refused_write_leaves_the_cursor_and_the_owed_row(db,player,attempt,cursor,next):
  {==}

# #1298: stdin closes only when the stdout file's latest task list names no task
# (or no list was ever written). A list that names tasks, or one that cannot be
# read, leaves stdin open; a replaying recovery observer therefore never closes on
# an earlier empty list that a later list replaced.
law an_empty_latest_list_lets_stdin_close:
  {Guidance.background_clear("0") == True{} : Bool}

def an_empty_latest_list_lets_stdin_close():
  {==}

law no_list_in_the_stdout_file_lets_stdin_close:
  {Guidance.background_clear("none") == True{} : Bool}

def no_list_in_the_stdout_file_lets_stdin_close():
  {==}

law a_latest_list_with_tasks_keeps_stdin_open:
  {Guidance.background_clear("1") == False{} : Bool}

def a_latest_list_with_tasks_keeps_stdin_open():
  {==}

law an_unreadable_stdout_file_keeps_stdin_open:
  {Guidance.background_clear("?") == False{} : Bool}

def an_unreadable_stdout_file_keeps_stdin_open():
  {==}

law a_failed_last_frame_read_reports_an_unreadable_file:
  for +db: String
  {Guidance.spool_background_found(db,Fail{(2,"no such file")}) == IO.pure(String,"?") : IO(String)}

def a_failed_last_frame_read_reports_an_unreadable_file(db):
  {==}

law a_file_without_a_list_reports_none:
  for +db: String
  {Guidance.spool_background_found(db,Done{""}) == IO.pure(String,"none") : IO(String)}

def a_file_without_a_list_reports_none(db):
  {==}

law a_native_without_a_stdout_file_reports_none:
  for +db: String
  {Guidance.spool_background(db,"") == IO.pure(String,"none") : IO(String)}

def a_native_without_a_stdout_file_reports_none(db):
  {==}

law a_failed_task_list_query_reports_an_unreadable_list:
  {Guidance.spool_background_text(Fail{(5,"query failed")}) == "?" : String}

def a_failed_task_list_query_reports_an_unreadable_list():
  {==}

law a_list_with_tasks_reports_one:
  {Guidance.spool_background_text(Done{"1\n"}) == "1" : String}

def a_list_with_tasks_reports_one():
  {==}

law an_empty_list_reports_zero:
  {Guidance.spool_background_text(Done{"0\n"}) == "0" : String}

def an_empty_list_reports_zero():
  {==}

law a_query_without_a_value_reports_an_unreadable_list:
  {Guidance.spool_background_text(Done{""}) == "?" : String}

def a_query_without_a_value_reports_an_unreadable_list():
  {==}

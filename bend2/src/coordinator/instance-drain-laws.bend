# These obligations bind the deferral of a start that a draining instance owner
# refused (#1399). The receive path, the sweep and the host are exercised by
# bend2/test/shared-instance.py and a Main-level run.
import Base
import ./instance-drain.bend as Drain

law the_drain_refusal_prefix_selects_the_deferral:
  {Drain.drain_refusal("ESHUTDOWN: instance owner for /db is draining: owner pid 7") == True{} : Bool}

def the_drain_refusal_prefix_selects_the_deferral():
  {==}

law other_start_failures_settle_as_before:
  {Drain.drain_refusal("start failed") == False{} : Bool}

def other_start_failures_settle_as_before():
  {==}

law an_empty_refusal_is_not_a_drain:
  {Drain.drain_refusal("") == False{} : Bool}

def an_empty_refusal_is_not_a_drain():
  {==}

law the_deferral_report_names_the_owed_message:
  {Drain.deferred_text("ESHUTDOWN: x","m1") == "start deferred: ESHUTDOWN: x; message m1 stays owed as a drain-deferred claim and the owner's drain sweep delivers it again when the owner exits or the next owner starts" : String}

def the_deferral_report_names_the_owed_message():
  {==}

law the_sweep_failure_report_names_the_session:
  {Drain.sweep_failed_text("2","cause","s1") == "drain sweep could not re-drive the owed input of s1 (2: cause); the claim stays drain-deferred and the next owner start or exit repeats the sweep" : String}

def the_sweep_failure_report_names_the_session():
  {==}

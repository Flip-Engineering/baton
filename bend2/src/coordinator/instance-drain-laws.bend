# These obligations bind the deferral of a start that a draining instance owner
# refused (#1399). The receive path and the host are exercised by
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

# The shell joins the wait and the delivery with && so a failed wait delivers
# nothing.
law the_waiter_waits_for_the_owner_then_delivers_the_message:
  {Drain.redrive_argv("/bin/baton","/db","message-1") == ["/bin/sh","-c","\"$1\" --instance-wait \"$2\" >/dev/null && exec \"$1\" --dispatch-message \"$2\" \"$3\"","sh","/bin/baton","/db","message-1"] : List<String>}

def the_waiter_waits_for_the_owner_then_delivers_the_message():
  {==}

law the_deferral_report_names_the_owed_message:
  {Drain.deferred_text("ESHUTDOWN: x","m1") == "start deferred: ESHUTDOWN: x; message m1 stays owed and a waiter delivers it again after the owner exits; a waiter whose wait fails delivers nothing and the next wake delivers the message" : String}

def the_deferral_report_names_the_owed_message():
  {==}

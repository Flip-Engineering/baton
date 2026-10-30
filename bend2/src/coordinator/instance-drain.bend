# A start that the draining instance owner refused is deferred, not failed: the
# input stays owed and a detached waiter delivers it again once the owner has
# exited (#1399). These functions hold the classification, the waiter command and
# the report text, so their laws check without the receive module.
import Base
import ../git/text.bend as Tx

# The host starts the refusal detail with ESHUTDOWN: (process-spawn.c
# br_drain_detail).
def drain_refusal(error: String) -> Bool:
  Tx.starts_with(error,"ESHUTDOWN:")

# Waits for the owner to exit or be replaced, then delivers the owed message
# through the entry the wake path already uses (--dispatch-message). The first
# argument of the shell is the executable of this release, so the successor
# owner starts from it.
def redrive_argv(self: String, db: String, head: String) -> List<String>:
  ["/bin/sh","-c","\"$1\" --instance-wait \"$2\" >/dev/null; exec \"$1\" --dispatch-message \"$2\" \"$3\"","sh",self,db,head]

def deferred_text(error: String, head: String) -> String:
  "start deferred: " ++ error ++ "; message " ++ head ++ " stays owed and a waiter delivers it again after the owner exits"

def redrive_failed_text(code: String, cause: String, head: String) -> String:
  "start deferred but re-delivery could not be scheduled (" ++ code ++ ": " ++ cause ++ "); message " ++ head ++ " stays owed and the next wake delivers it"

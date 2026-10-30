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

# The waiter is this release's own --drain-redeliver entry. It waits in process
# for the owner to exit or be replaced, then redelivers the owed message through
# Control.redeliver, whose failures are observed and reported by the existing
# delivery control (drain-redeliver.bend). The successor owner starts from this
# executable.
def redrive_argv(self: String, db: String, head: String) -> List<String>:
  [self,"--drain-redeliver",db,head]

def deferred_text(error: String, head: String) -> String:
  "start deferred: " ++ error ++ "; message " ++ head ++ " stays owed and a waiter delivers it again after the owner exits; a failure of the wait or of the delivery is reported to the orchestrator"

def redrive_failed_text(code: String, cause: String, head: String) -> String:
  "start deferred but re-delivery could not be scheduled (" ++ code ++ ": " ++ cause ++ "); message " ++ head ++ " stays owed and the next wake delivers it"

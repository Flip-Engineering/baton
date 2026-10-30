# A start that the draining instance owner refused is deferred, not failed: the
# input stays owed as a drain-deferred claim, and the owner's drain sweep starts
# the delivery again once the owner has exited or a successor owner starts
# (#1399). These functions hold the classification and the report text, so their
# laws check without the receive module.
import Base
import ../git/text.bend as Tx

# The host starts the refusal detail with ESHUTDOWN: (process-spawn.c
# br_drain_detail).
def drain_refusal(error: String) -> Bool:
  Tx.starts_with(error,"ESHUTDOWN:")

def deferred_text(error: String, head: String) -> String:
  "start deferred: " ++ error ++ "; message " ++ head ++ " stays owed as a drain-deferred claim and the owner's drain sweep delivers it again when the owner exits or the next owner starts"

def sweep_failed_text(code: String, cause: String, session: String) -> String:
  "drain sweep could not re-drive the owed input of " ++ session ++ " (" ++ code ++ ": " ++ cause ++ "); the claim stays drain-deferred and the next owner start or exit repeats the sweep"

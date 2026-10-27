# Narrow native test entry for the production Codex inbox module.
# It exposes only the commands exercised by focused-codex-inbox.py.
import Base
import ../src/coordinator/codex-inbox.bend as CodexInbox
import ../src/host/instance.bend as Custody

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-shutdown" <> +db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case +db <> "codex-inbox-session" <> +session <> +native <> +message <> +token <> Nil{}:
      IO.try(Unit,CodexInbox.session(db,session,native,message,token))
    case +db <> "codex-inbox-session" <> +session <> +native <> +message <> Nil{}:
      IO.try(Unit,CodexInbox.session(db,session,native,message,""))
    case +db <> "codex-inbox-follow" <> +session <> +native <> Nil{}:
      IO.try(Unit,CodexInbox.follow(db,session,native))
    case +db <> "codex-inbox-deliver" <> +native <> +pointer <> Nil{}:
      IO.try(Unit,CodexInbox.deliver(db,native,pointer))
    case +db <> "codex-input-witness" <> +native <> Nil{}:
      IO.try(Unit,CodexInbox.witness(db,native))
    case other: IO.die(Unit,2,"unsupported focused Codex inbox fixture command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)

# Focused entry for the completion decision actions. It parses and routes the
# public actions through the same Route.parse and AgentCommand.route as the full
# executable, so completion-confirmed with and without --next, completion-request,
# send, session and the other contextual actions run the actual handlers over a
# database prepared by the full executable. Database-first setup verbs are
# outside this entry. The instance-owner modes let Store publish commits.
#
# usage: confirm-focused DB as SESSION ACTION ARGS
import Base
import ../src/coordinator/agent-route.bend as Route
import ../src/coordinator/agent-command.bend as Agent
import ../src/host/instance.bend as Custody

def route(request: Route.Route) -> IO(Unit):
  match request:
    case Route.Action{context}: Agent.route(context)
    case Route.Legacy{args}: IO.die(Unit,2,"confirm-focused routes only contextual actions")

def run(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case other: route(Route.parse(other))

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)

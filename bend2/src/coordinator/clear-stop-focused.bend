import Base
import ./agent-route.bend as Route
import ./agent-command.bend as Agent
import ./agent-actions.bend as A
import ./agent-native.bend as Native
import ../coordinator/commands.bend as C
import ./stop.bend as Stop
import ./accounts.bend as Accounts
import ./usage-windows.bend as UsageWindows

# Public actions retain the ordinary parser, context resolution and child results.
def prepared(request: Agent.PreparedRequest) -> IO(Unit):
  match request:
    case Agent.Prepared{db,session,action}:
      match action:
        case A.Native{items}: do IO<Unit>:
          saved : String <- Native.operations(db,session,items)
          IO.write(saved)
        case A.Help{verb}: IO.write(A.help(verb))
        case A.Invalid{cause}: IO.die(Unit,2,cause)
        case other: IO.die(Unit,2,"unsupported focused stop action")

def legacy_command(db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.ClearStop{session}: Stop.clear(db,session)
    case C.UsageWindowReset{+session,resets,source}: do IO<Unit>:
      label : String <- Accounts.handoff_label_io(db,session)
      UsageWindows.reset_exhausted(db,session,resets,source,label)
    case other: IO.die(Unit,2,"invalid clear-stop arguments")

# These are the same positional parser functions used by the full CLI.
def legacy(args: List<String>) -> IO(Unit):
  match args:
    case db <> verb <> session <> Nil{}:
      legacy_command(db,C.parse_verb_id(verb,session))
    case db <> verb <> session <> flag <> Nil{}:
      legacy_command(db,C.parse_verb_session_id(verb,session,flag))
    case db <> verb <> session <> resets <> source <> Nil{}:
      legacy_command(db,C.parse_verb_three_args(verb,session,resets,source))
    case other: IO.die(Unit,2,"invalid clear-stop arguments")

def route(request: Route.Route) -> IO(Unit):
  match request:
    case Route.Action{context}: do IO<Unit>:
      request : Agent.PreparedRequest <- Agent.prepare_request(context)
      prepared(request)
    case Route.Legacy{args}: legacy(args)

def run(args: List<String>) -> IO(Unit):
  route(Route.parse(args))

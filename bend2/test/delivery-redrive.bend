# The detached delivery entries of the coordinator (#1054, instances A1 and
# A3): --dispatch-message delivers committed input and starts a redelivery for
# the recipient's owed input when the endpoint fails; --redeliver-message
# reports a repeated failure to the recipient's coordinator.
import Base
import ../src/coordinator/control.bend as Control

def route(args: List<String>) -> IO(Unit):
  match args:
    case "--dispatch-message" <> +db <> +id <> Nil{}: Control.deliver(db,id)
    case "--redeliver-message" <> +db <> +id <> Nil{}: Control.redeliver(db,id)
    case other: IO.die(Unit,2,"usage: delivery-redrive --dispatch-message|--redeliver-message DB ID")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)

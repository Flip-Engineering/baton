# Focused behavioral evidence for the pending-input candidate report and wake.
# The entry drives the same Commands parsing and Stall handlers the coordinator
# CLI dispatches, without compiling the coordinator Main.

import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/stall.bend as Stall
import ../src/host/sqlite.bend as DB
import ../src/coordinator/delivery.bend as Delivery

def init_db(+db: String) -> IO(Unit):
  do IO<Unit>:
    written : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    IO.print("INIT " ++ db)

def parser_check(name: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Stall{}: IO.print("PARSER " ++ name ++ ": stall")
    case C.StallWake{}: IO.print("PARSER " ++ name ++ ": stall-wake")
    case other: IO.print("PARSER " ++ name ++ ": unexpected")

def dispatch(db: String, mode: String) -> IO(Unit):
  match mode:
    case "init": init_db(db)
    case "report": Stall.report(db)
    case "wake": Stall.wake_stalled(db)
    case other: IO.die(Unit, 2, "usage: stall-evidence DB init|report|wake | parse")

# The wake driver launches this same entry with --dispatch-message to hand one
# owed message to its recorded endpoint. The delivery result determines the
# child exit status.
def dispatch_message(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    delivered : String <- IO.try(String,Delivery.deliver(db,id,"1",""))
    IO.pure(Unit,Unit{})

def evidence(args: List<&1, String>) -> IO(Unit):
  match args:
    case "parse" <> Nil{}: do IO<Unit>:
      first : Unit <- parser_check("stall", C.parse(["stall"]))
      parser_check("stall-wake", C.parse(["stall-wake"]))
    case "--dispatch-message" <> db <> id <> Nil{}: dispatch_message(db,id)
    case db <> mode <> Nil{}: dispatch(db,mode)
    case _: IO.die(Unit, 2, "usage: stall-evidence DB init|report|wake | parse | --dispatch-message DB ID")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<&1, String> <- IO.args()
    evidence(args)

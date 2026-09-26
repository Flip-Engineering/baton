import Base
import ./store.bend as Store
import ./commands.bend as C
import ../host/text.bend as T

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

def run(db: String, command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String, Store.apply(db,command))
    print_result(result)

def execute(db: String, command: C.Command) -> IO(Unit):
  match command:
    case C.Invalid{}:
      IO.die(Unit,2,"usage: baton2 DATABASE COMMAND ARGS\nattach ID HARNESS NATIVE ENDPOINT\nworker ID PARENT HARNESS MODEL EFFORT WORKSPACE BRANCH BASE\nconnect ID NATIVE ENDPOINT\nbind ID NATIVE HARNESS MODEL EFFORT\nmessage ID SENDER RECIPIENT KIND BODY\nmessage-file ID SENDER RECIPIENT KIND PATH\nobserve ID WORKER EVENT_JSON\nobserve-file ID WORKER PATH\nreport ID WORKER BODY\nreport-file ID WORKER PATH\nsession ID\ndelivery ID\npending\ninbox RECIPIENT\nack ID RECIPIENT NATIVE_RECEIPT\nstatus\nPATH - reads stdin")
    case C.ObserveFile{id,worker,path}:
      do IO<Unit>:
        event : String <- IO.try(String,T.Text.read(path))
        run(db,C.Observe{id,worker,event})
    case C.ReportFile{id,sender,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Report{id,sender,body})
    case C.MessageFile{id,sender,recipient,kind,path}:
      do IO<Unit>:
        body : String <- IO.try(String,T.Text.read(path))
        run(db,C.Message{id,sender,recipient,kind,body})
    case valid: run(db,valid)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case db <> rest: execute(db,C.parse(rest))
    case Nil{}: execute("",C.Invalid{})

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)

# The turn-start prompt selection and prompt-record statements (#1212). The
# stop-hook entry fixture does not carry these so that it builds on trees whose
# production modules lack them.
import Base
import ../src/coordinator/message-status.bend as MessageStatus

def prompt_selection_statement(args: List<String>) -> IO(Unit):
  match args:
    case session <> cursor <> Nil{}: IO.print(MessageStatus.prompt_selection_sql(session,cursor))
    case other: IO.die(Unit,2,"usage: prompt-status-entry prompt-selection-sql SESSION CURSOR")

def prompt_record_statement(args: List<String>) -> IO(Unit):
  match args:
    case attempt <> native <> identity <> input <> Nil{}: IO.print(MessageStatus.prompt_record_sql("worker",attempt,native,identity,input))
    case other: IO.die(Unit,2,"usage: prompt-status-entry prompt-record-sql ATTEMPT NATIVE IDENTITY INPUT_JSON")

def route(args: List<String>) -> IO(Unit):
  match args:
    case "prompt-selection-sql" <> rest: prompt_selection_statement(rest)
    case "prompt-record-sql" <> rest: prompt_record_statement(rest)
    case other: IO.die(Unit,2,"usage: prompt-status-entry prompt-selection-sql|prompt-record-sql")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)

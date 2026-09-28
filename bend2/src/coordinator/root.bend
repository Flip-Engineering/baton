import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T

# The endpoint is an argv JSON array. The committed message ID is its last argument.
def endpoint_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' ELSE 0 END AND " ++ condition ++ "),'');"

def result(saved: String, log: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},out}: Done{saved}
    case other: Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")}

def completed(db: String, saved: String, run: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match run:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+output}: do IO<Result<&1,&1,U32 & String,String>>:
      +log : String <- IO.pure(String,db ++ ".root.log")
      written : Unit <- IO.try(Unit,Text.Text.append(log,output ++ "\n"))
      IO.pure(Result<&1,&1,U32 & String,String>,result(saved,log,Tx.run_res(Done{output})))

def launch(db: String, id: String, saved: String, argv: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})
    case False{}: do IO<Result<&1,&1,U32 & String,String>>:
      run : Result<&1,&1,U32 & String,String> <- Process.Process.run(argv ++ Tx.enc_argv(Con{id,Nil{}}),".")
      completed(db,saved,run)

def deliver(+db: String, +id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    encoded : String <- IO.try(String,DB.Sql.query(db,endpoint_sql(id,condition)))
    +argv : String <- IO.pure(String,Tx.trim_nl(encoded))
    launch(db,id,saved,argv,String.is_empty(argv))

def after(db: String, command: C.Command, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  match command:
    case C.Report{id,sender,body}: deliver(db,id,"1",saved)
    case C.Ask{id,worker,body}: deliver(db,id,"1",saved)
    case C.Message{id,sender,recipient,kind,body}: deliver(db,id,"1",saved)
    case C.Observe{id,worker,event}: deliver(db,id,C.terminal(event),saved)
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

def wake_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case Fail{error}: Fail{error}
    case Done{output}: Done{Unit{}}

# The completed native owner has released its session lock before this read.
def wake_pending(+db: String, session: String, cursor: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +id : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),'');"))
    delivered : Result<&1,&1,U32 & String,String> <- deliver(db,Tx.trim_nl(id),"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,wake_result(delivered))

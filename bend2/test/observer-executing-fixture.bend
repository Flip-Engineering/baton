# Focused fixture for the retained-observer executing call.
#
# `init` installs the app schema and one parentless OMP session.
# `start` admits one retained native attempt under the database instance owner,
# records its recovery argv, prints `started`, and waits for the optional gate
# file. The admitting process is the observer, so its exit is observer loss
# while the keeper lives, and the keeper invokes the recorded
# `--recover-receive` call. The gate lets a caller establish a database lock
# before the observer leaves and the keeper starts recovery.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/store.bend as Store
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/turn.bend as Turn
import ../src/host/files.bend as F
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as Lock
import ../src/git/text.bend as Tx
import ../src/host/process.bend as P

def session_name() -> String:
  "parent"

def init_db(+db: String, harness: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ "INSERT OR IGNORE INTO sessions(id,parent,harness,model) VALUES(" ++ C.q(session_name()) ++ ",NULL," ++ C.q(harness) ++ ",'');COMMIT;")
    IO.pure(Unit,Unit{})

def wait_gate_for(+path: String, remaining: Nat) -> IO(Unit):
  match remaining:
    case 0n: IO.die(Unit,2,"fixture gate was not released: " ++ path)
    case 1n+p: do IO<Unit>:
      regular : String <- IO.try(String,F.Files.regular(path))
      Bool.pick(IO(Unit),String.eq(regular,"1"),
        IO.pure(Unit,Unit{}),
        do IO<Unit>:
          IO.sleep(20)
          wait_gate_for(path,p))

def wait_gate(path: String) -> IO(Unit):
  wait_gate_for(path,3000n)

def first_pending(db: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session_name()) ++ " AND receipt IS NULL ORDER BY seq LIMIT 1),'');"))
    IO.pure(String,Tx.trim_nl(saved))

def retain_claim(+db: String, +session: String, +directory: String, claimed: String) -> IO(Unit):
  do IO<Unit>:
    claimed_unit : Unit <- Store.claim(db,session,claimed)
    +owner : String <- Store.claim_owner(db,session)
    +generation : String <- Store.claim_generation(db,session)
    retained : Unit <- Store.retain_ticket(db,session,directory,Tx.trim_nl(owner),Tx.trim_nl(generation))
    IO.pure(Unit,Unit{})

def start_attempt(+db: String, +id: String, +directory: String, +workspace: String,
                  +log: String, +observed: String, +helper: String, +harness: String,
                  +model: String, +effort: String, +python: String, +native: String,
                  +marker: String, +cursor: String, +gate: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    allowed : Bool <- Stop.admit(canonical,session_name(),id,"retained",directory)
    admitted : Unit <- Stop.admitted(allowed)
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session_name()))
    started : Unit <- Stop.started(canonical,session_name(),id,directory)
    +head : String <- first_pending(canonical)
    claimed : Unit <- Bool.pick(IO(Unit),String.is_empty(head),IO.pure(Unit,Unit{}),retain_claim(canonical,session_name(),directory,head))
    +arguments : String = P.argv([python,native,observed,marker])
    +recovery : String = P.argv([helper,"--recover-receive",canonical,session_name(),id,cursor,native,model,effort,workspace,log,harness,directory,observed])
    launch : Turn.RetainedLaunch = Turn.Prepared{arguments,"","fixture task",0,False{}}
    started_result : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained_admit(canonical,directory,workspace,"fixture task",lock,recovery,launch))
    IO.print("started " ++ id)
    gated : Unit <- Bool.pick(IO(Unit),String.is_empty(gate),IO.pure(Unit,Unit{}),wait_gate(gate))
    IO.pure(Unit,Unit{})

def run(args: List<String>) -> IO(Unit):
  match args:
    case "init" <> +db <> +harness <> Nil{}: init_db(db,harness)
    case "start" <> +db <> +id <> +directory <> +workspace <> +log <> +observed <> +helper <> +harness <> +model <> +effort <> +python <> +native <> +marker <> +cursor <> +gate <> Nil{}:
      start_attempt(db,id,directory,workspace,log,observed,helper,harness,model,effort,python,native,marker,cursor,gate)
    case "settle" <> +db <> +session <> +directory <> Nil{}:
      Receive.settle_recovery_ticket(db,session,directory)
    case other: IO.die(Unit,2,"usage: observer-executing-fixture init DB HARNESS | start DB ID DIRECTORY WORKSPACE LOG OBSERVED HELPER HARNESS MODEL EFFORT PYTHON SCRIPT MARKER CURSOR GATE | settle DB SESSION DIRECTORY")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)

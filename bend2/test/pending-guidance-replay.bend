import Base
import ../src/coordinator/guidance.bend as Guidance
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB
import ../src/host/process.bend as P
import ../src/git/text.bend as Tx

# Reproduce the rejected-checkpoint replay condition without a native process:
# this attempt already forwarded report seq 2, and the observer state was reset,
# so the caller restarts the input cursor at "0". Replay resumes at seq 2 while
# the still-owed question at seq 3 remains selectable. A fresh attempt must
# receive each pending input kind. No read row is recorded by this fixture.
def check(+name: String, +expected: String, +actual: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(expected,actual),
    IO.print(name ++ ":ok"),
    IO.die(Unit,1,name ++ ": expected " ++ expected ++ " got " ++ actual))

def seed(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    root : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness) VALUES('root',NULL,'omp');"))
    player : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO sessions(id,parent,harness) VALUES('player','root','omp');"))
    one : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g1','root','player','guidance','one');"))
    two : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g2','root','player','report','two');"))
    three : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g3','root','player','question','three');"))
    four : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g4','root','player','task-continuation','four');"))
    IO.pure(Unit,Unit{})

def select(+db: String, +cursor: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,Guidance.pending_sql("player",cursor)))
    IO.pure(String,Tx.trim_nl(value))

def run(+db: String, +attempt: String, +fresh: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db)
    forwarded : Unit <- Guidance.record_forwarded(attempt,"2")
    +watched : String <- Guidance.forwarded_high(db,attempt)
    check("journal high-water", "2", watched)
    +missing : String <- Guidance.forwarded_high(db,fresh)
    check("missing journal", "0", missing)
    # The replay starts from the reset cursor; the journal holds it at seq 2.
    +resumed : String <- Guidance.replay_cursor(db,attempt,"0")
    check("replay cursor", "2", resumed)
    # The old behavior (cursor 0) re-selects the forwarded message: that is the
    # duplicate the replay sent 10,639 times in the live attempt.
    +duplicate : String <- select(db,"0")
    check("unfixed cursor duplicates", "1", duplicate)
    +next : String <- select(db,resumed)
    check("next unforwarded input", "3", next)
    # A new attempt has no journal: all pending input is offered again, once.
    +fresh_start : String <- Guidance.replay_cursor(db,fresh,"0")
    check("fresh attempt cursor", "0", fresh_start)
    +first : String <- select(db,fresh_start)
    check("fresh attempt first pending", "1", first)
    +owed : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE recipient='player' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient);"))
    check("pending queue preserved", "4\n", owed)
    IO.pure(Unit,Unit{})

@unsafe
def print_frames(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      IO.print(status)
    case Some{text}: do IO<Unit>:
      printed : Unit <- IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      print_frames(handle,next)

# A completed read remains complete while an observer wakes repeatedly.
# The child echoes actual native stdin frames so the caller can check delivery.
def forward_probe(+db: String, +attempt: String, harness: String, +scenario: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    seeded : String <- IO.try(String,DB.Sql.query(db,
      "INSERT INTO sessions(id,parent,harness) VALUES('root',NULL,'operator'),('player','root'," ++ C.q(harness) ++ ");"
      ++ "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('original','root','player','task','Already read task.');"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','original','player','native','fixture');"))
    added : String <- IO.try(String,DB.Sql.query(db,
      "INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'new','root','player','guidance','new complete input' || char(10) || 'second line' WHERE " ++ C.q(scenario) ++ "='new';"))
    +handle : U32 <- IO.try(U32,P.ProcessChild.spawn(P.argv(["/bin/cat"]),".",attempt ++ "/native.stderr"))
    +first : String <- Guidance.awake_pending(db,"player",handle,attempt,"1",True{})
    read : String <- IO.try(String,DB.Sql.query(db,
      "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT 'fixture',id,recipient,'native','fixture' FROM messages WHERE id='new';"))
    +second : String <- Guidance.awake_pending(db,"player",handle,attempt,first,True{})
    third : String <- Guidance.awake_pending(db,"player",handle,attempt,second,True{})
    closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
    line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    print_frames(handle,line)

def run_args(args: List<String>) -> IO(Unit):
  match args:
    case "forward" <> db <> attempt <> harness <> scenario <> Nil{}: forward_probe(db,attempt,harness,scenario)
    case db <> attempt <> fresh <> Nil{}: run(db,attempt,fresh)
    case other: IO.die(Unit,2,"usage: pending-guidance-replay DB ATTEMPT_DIR FRESH_DIR")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run_args(args)

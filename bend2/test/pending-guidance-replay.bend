import Base
import ../src/coordinator/guidance.bend as Guidance
import ../src/coordinator/store.bend as Store
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

# Reproduce the rejected-checkpoint replay condition without a native process:
# this attempt already forwarded guidance seq 2, and the observer state was
# reset, so the caller restarts the guidance cursor at "0". The replay must
# resume at the forwarded position (never seq 2 again) while the still-owed
# seq 3 stays selectable, and a fresh attempt (no journal) must still receive
# every pending message. The queue is never consumed: all receipts stay NULL.
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
    two : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g2','root','player','guidance','two');"))
    three : String <- IO.try(String,DB.Sql.query(db,"INSERT INTO messages(id,sender,recipient,kind,body) VALUES('g3','root','player','guidance','three');"))
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
    check("next unforwarded guidance", "3", next)
    # A new attempt has no journal: all pending input is offered again, once.
    +fresh_start : String <- Guidance.replay_cursor(db,fresh,"0")
    check("fresh attempt cursor", "0", fresh_start)
    +first : String <- select(db,fresh_start)
    check("fresh attempt first pending", "1", first)
    +owed : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE recipient='player' AND kind='guidance' AND receipt IS NULL;"))
    check("pending queue preserved", "3\n", owed)
    IO.pure(Unit,Unit{})

def run_args(args: List<String>) -> IO(Unit):
  match args:
    case db <> attempt <> fresh <> Nil{}: run(db,attempt,fresh)
    case other: IO.die(Unit,2,"usage: pending-guidance-replay DB ATTEMPT_DIR FRESH_DIR")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run_args(args)

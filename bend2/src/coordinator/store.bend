import Base
import ../host/sqlite.bend as DB
import ./commands.bend as C
import ./delivery.bend as Delivery
import ../git/text.bend as Tx

def accepted(db: String, command: C.Command, saved: String, stopped: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Session is terminally stopped; input was not committed. Read its session and retained inbox, or recruit a new session.")})
    case False{}: Delivery.after(db,command,saved)

# Endpoint delivery starts after the message transaction commits.
def route_accepted(db: String, command: C.Command, +saved: String, denied: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match denied:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)})
    case False{}: accepted(db,command,saved,Tx.starts_with(saved,"{\"error\":\"session-stopped\""))

def naming_refused(+saved: String) -> Bool:
  Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-role\""),Tx.starts_with(saved,"{\"error\":\"section-refused\""))

def refused(+saved: String) -> Bool:
  Bool.or(naming_refused(saved),Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\""))))

def committed(db: String, command: C.Command, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+saved}: route_accepted(db,command,saved,refused(saved))
def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")

def apply(+db: String, +command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- commit(db,command)
    committed(db,command,result)

# Wake-claim transitions for issue #685. The table is created by
# C.wake_claim_schema(), which C.schema() runs on every commit. Claimed only
# while holding the session lock, after re-reading a nonzero pending count:
# holding the lock proves no live owner exists, so the write is a safe
# takeover and a dead owner never suppresses the wake. The owner names the
# message the obligation hands over; the generation fences takeovers so a
# late finisher can never mistake an older write for the live row. Released
# to unclaimed only by a lock holder when input is owed and no retained
# attempt is recorded live. Deleted when acknowledgement clears every owed
# input, or when an admitted stop resolves the obligation.
def claim_sql(+session: String, +owner: String) -> String:
  "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) VALUES(" ++ C.q(session) ++ ",'claimed'," ++ C.q(owner) ++ ",coalesce((SELECT generation FROM wake_claims WHERE session=" ++ C.q(session) ++ "),0)+1);"

def release_sql(+session: String) -> String:
  "UPDATE wake_claims SET state='unclaimed' WHERE session=" ++ C.q(session) ++ ";"

def clear_claim_sql(+session: String) -> String:
  "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ ";"

# Absent-tolerant claim read. SQLite resolves every named table when it
# prepares a statement, so one statement cannot guard on sqlite_master and
# read the guarded table at once. The read is two steps: presence check, then
# the value read only when the table exists. Empty string when the table is
# missing or no row exists, otherwise the recorded state.
def claim_state_present_sql() -> String:
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='wake_claims';"

def claim_state_value_sql(+session: String) -> String:
  "SELECT coalesce((SELECT state FROM wake_claims WHERE session=" ++ C.q(session) ++ "),'');"

def read_claim_when_present(+db: String, +session: String, present: Bool) -> IO(String):
  match present:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,claim_state_value_sql(session)))

def claim_state(+db: String, +session: String) -> IO(String):
  do IO<String>:
    present : String <- IO.try(String,DB.Sql.query(db,claim_state_present_sql()))
    state : String <- read_claim_when_present(db,session,String.eq(present,"1\n"))
    IO.pure(String,state)

def claim(db: String, session: String, owner: String) -> IO(Unit):
  do IO<Unit>:
    claimed : String <- IO.try(String,DB.Sql.query(db,claim_sql(session,owner)))
    IO.pure(Unit,Unit{})

def release(db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    released : String <- IO.try(String,DB.Sql.query(db,release_sql(session)))
    IO.pure(Unit,Unit{})

def clear_claim(db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    cleared : String <- IO.try(String,DB.Sql.query(db,clear_claim_sql(session)))
    IO.pure(Unit,Unit{})

law claim_sql_writes_a_claimed_row:
  for session: String
  for owner: String
  {claim_sql(session,owner) == "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) VALUES(" ++ C.q(session) ++ ",'claimed'," ++ C.q(owner) ++ ",coalesce((SELECT generation FROM wake_claims WHERE session=" ++ C.q(session) ++ "),0)+1);" : String}

def claim_sql_writes_a_claimed_row(session,owner):
  {==}

law release_sql_marks_the_session_unclaimed:
  for session: String
  {release_sql(session) == "UPDATE wake_claims SET state='unclaimed' WHERE session=" ++ C.q(session) ++ ";" : String}

def release_sql_marks_the_session_unclaimed(session):
  {==}

law release_sql_inserts_no_row:
  for session: String
  {Tx.starts_with(release_sql(session),"INSERT") == False{} : Bool}

def release_sql_inserts_no_row(session):
  {==}

law clear_claim_sql_deletes_the_session_row:
  for session: String
  {clear_claim_sql(session) == "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ ";" : String}

def clear_claim_sql_deletes_the_session_row(session):
  {==}

law clear_claim_sql_updates_no_state:
  for session: String
  {Tx.starts_with(clear_claim_sql(session),"UPDATE") == False{} : Bool}

def clear_claim_sql_updates_no_state(session):
  {==}

law claim_and_release_are_distinct_transitions:
  for session: String
  for owner: String
  {String.eq(claim_sql(session,owner),release_sql(session)) == False{} : Bool}

def claim_and_release_are_distinct_transitions(session,owner):
  {==}

law missing_claim_table_reads_empty:
  for db: String
  for session: String
  {read_claim_when_present(db,session,False{}) == IO.pure(String,"") : IO(String)}

def missing_claim_table_reads_empty(db,session):
  {==}

import Base
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../coordinator/commands.bend as C
import ../git/text.bend as Tx

def accepted(saved: String, stopped: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Session is terminally stopped; input was not committed. Read its session and retained inbox, or recruit a new session.")})
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

# The caller drives delivery after the committed admission is accepted.
def route_accepted(+saved: String, denied: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match denied:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)})
    case False{}: accepted(saved,Tx.starts_with(saved,"{\"error\":\"session-stopped\""))

def naming_refused(+saved: String) -> Bool:
  Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-role\""),
    Bool.or(Tx.starts_with(saved,"{\"error\":\"section-refused\""),
      Tx.starts_with(saved,"{\"error\":\"ensemble-owner-conflict\"")))

def refused(+saved: String) -> Bool:
  Bool.or(naming_refused(saved),
    Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),
      Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),
        Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\""),
          Bool.or(Tx.starts_with(saved,"{\"error\":\"message-id-conflict\""),
            Bool.or(Tx.starts_with(saved,"{\"error\":\"finding-id-conflict\""),
              Bool.or(Tx.starts_with(saved,"{\"error\":\"knowledge-notice-conflict\""),
                Bool.or(Tx.starts_with(saved,"{\"error\":\"promotion-id-conflict\""),
                  Tx.starts_with(saved,"{\"error\":\"promotion-notice-conflict\"")))))))))

# Change-publication contract for the coordinator queue. The projection
# installer runs before the writer's own transaction begins; the committed
# cursor publishes only after that transaction commits. A rolled-back
# transaction never reaches publication, and a publication failure is not a
# transaction rollback: the commit stands and the generation-gap resync
# covers the missed notice.
#
# Preflight installs the app schema and the canonical native_changes
# projection before the writer's own transaction begins. The host installer
# runs the schema text, then its own projection array, in one transaction,
# so a fresh database converges atomically and later commits pay existence
# checks. Installation lives with the host owner; this call site carries
# no copy of the projection text.
def ensure_before_begin(db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : String <- IO.try(String,DB.Sql.ensure_projection(db,C.schema()))
    IO.pure(Unit,Unit{})

law ensure_before_begin_installs_through_the_canonical_installer:
  for db: String
  {ensure_before_begin(db) == (do IO<Unit>:
    ensured : String <- IO.try(String,DB.Sql.ensure_projection(db,C.schema()))
    IO.pure(Unit,Unit{})) : IO(Unit)}

def ensure_before_begin_installs_through_the_canonical_installer(db):
  {==}

def high_water_sql() -> String:
  "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"

def read_high_water(db: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,high_water_sql())

def publish_water(db: String, water: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match water:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case Done{+cursor}: do IO<Result<&1,&1,U32 & String,Unit>>:
      noticed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.publish_commit(db,Tx.trim_nl(cursor))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def publish_committed(+db: String, +saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    water : Result<&1,&1,U32 & String,String> <- read_high_water(db)
    published : Result<&1,&1,U32 & String,Unit> <- publish_water(db,water)
    IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

def publish_after_commit(db: String, committed: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match committed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+saved}: publish_committed(db,saved)

def transact_sql(+db: String, sql: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    ensured : Unit <- ensure_before_begin(db)
    committed : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,sql)
    publish_after_commit(db,committed)


law rolled_back_transaction_publishes_nothing:
  for db: String
  {publish_after_commit(db,Fail{(2,"commit failed")}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"commit failed")}) : IO(Result<&1,&1,U32 & String,String>)}

def rolled_back_transaction_publishes_nothing(db):
  {==}

def committed(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+saved}: route_accepted(saved,refused(saved))

# The single statement a commit runs: schema, command SQL, one transaction.
def commit_sql(command: C.Command) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;"

def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  transact_sql(db,commit_sql(command))

def read(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  DB.Sql.read(db,C.sql(command))

def apply(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- commit(db,command)
    committed(result)


# Wake-claim transitions for issue #685. The table is owned by this module:
# every writer ensures it with the canonical definition first, so a fresh
# database needs no schema-layer registration. Claimed only while holding
# the session lock, after re-reading a nonzero pending count: holding the
# lock proves no live owner exists, so the write is a safe takeover and a
# dead owner never suppresses the wake. The owner names the message the
# obligation hands over; the generation fences takeovers so a late finisher
# can never mistake an older write for the live row. Released to unclaimed
# only by a lock holder when no input is owed and no retained attempt is
# recorded live. Deleted when acknowledgement clears every owed input, or
# when an admitted stop resolves the obligation.
def claim_schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);"

def claim_sql(+session: String, +owner: String) -> String:
  "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) VALUES(" ++ C.q(session) ++ ",'claimed'," ++ C.q(owner) ++ ",coalesce((SELECT generation FROM wake_claims WHERE session=" ++ C.q(session) ++ "),0)+1);"

# A release names the exact row it settles: the owner and generation written
# at admission, read back under the same held lock. A delete that names a
# stale ticket removes nothing, so a late settler can never clear a newer
# owner's row that an acknowledgement, a stop, or a takeover left behind.
def release_ticket_sql(+session: String, +owner: String, +generation: String) -> String:
  "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ " AND owner=" ++ C.q(owner) ++ " AND generation=CAST(" ++ C.q(generation) ++ " AS INTEGER);"

# Stale execution metadata recovery. When host custody observes the recorded
# attempt dead, the takeover marks its row exited with a fixed owner-death
# marker instead of trusting its phase. The row's exit code stays in the
# attempt directory's status file; the marker only records how the row died.
# The phase guard keeps the write idempotent.
def record_owner_death_sql(+session: String) -> String:
  "UPDATE executions SET phase='exited',status='owner-death' WHERE session=" ++ C.q(session) ++ " AND phase<>'exited';"

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

# Absent-tolerant ticket reads. Empty owner and zero generation when the table
# is missing or no row exists, otherwise the recorded admission identity. The
# settler reads both under its held lock and releases only the exact row.
def claim_owner_value_sql(+session: String) -> String:
  "SELECT coalesce((SELECT owner FROM wake_claims WHERE session=" ++ C.q(session) ++ "),'');"

def claim_generation_value_sql(+session: String) -> String:
  "SELECT coalesce((SELECT generation FROM wake_claims WHERE session=" ++ C.q(session) ++ "),0);"

def read_claim_owner_when_present(+db: String, +session: String, present: Bool) -> IO(String):
  match present:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,claim_owner_value_sql(session)))

def read_claim_generation_when_present(+db: String, +session: String, present: Bool) -> IO(String):
  match present:
    case False{}: IO.pure(String,"0\n")
    case True{}: IO.try(String,DB.Sql.query(db,claim_generation_value_sql(session)))

def claim_owner(+db: String, +session: String) -> IO(String):
  do IO<String>:
    present : String <- IO.try(String,DB.Sql.query(db,claim_state_present_sql()))
    owner : String <- read_claim_owner_when_present(db,session,String.eq(present,"1\n"))
    IO.pure(String,owner)

def claim_generation(+db: String, +session: String) -> IO(String):
  do IO<String>:
    present : String <- IO.try(String,DB.Sql.query(db,claim_state_present_sql()))
    generation : String <- read_claim_generation_when_present(db,session,String.eq(present,"1\n"))
    IO.pure(String,generation)

def claim(+db: String, session: String, owner: String) -> IO(Unit):
  do IO<Unit>:
    ensured : String <- IO.try(String,DB.Sql.query(db,claim_schema_sql()))
    claimed : String <- IO.try(String,DB.Sql.query(db,claim_sql(session,owner)))
    IO.pure(Unit,Unit{})

def release_ticket(+db: String, session: String, owner: String, generation: String) -> IO(Unit):
  do IO<Unit>:
    ensured : String <- IO.try(String,DB.Sql.query(db,claim_schema_sql()))
    released : String <- IO.try(String,DB.Sql.query(db,release_ticket_sql(session,owner,Tx.trim_nl(generation))))
    IO.pure(Unit,Unit{})

def record_owner_death(db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,DB.Sql.query(db,record_owner_death_sql(session)))
    IO.pure(Unit,Unit{})

law claim_sql_writes_a_claimed_row:
  for session: String
  for owner: String
  {claim_sql(session,owner) == "INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) VALUES(" ++ C.q(session) ++ ",'claimed'," ++ C.q(owner) ++ ",coalesce((SELECT generation FROM wake_claims WHERE session=" ++ C.q(session) ++ "),0)+1);" : String}

def claim_sql_writes_a_claimed_row(session,owner):
  {==}

law claim_schema_creates_the_claim_table:
  {claim_schema_sql() == "CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);" : String}

def claim_schema_creates_the_claim_table():
  {==}

law release_names_the_exact_admission_ticket:
  for session: String
  for owner: String
  for generation: String
  {release_ticket_sql(session,owner,generation) == "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ " AND owner=" ++ C.q(owner) ++ " AND generation=CAST(" ++ C.q(generation) ++ " AS INTEGER);" : String}

def release_names_the_exact_admission_ticket(session,owner,generation):
  {==}

law release_inserts_no_row:
  for session: String
  for owner: String
  for generation: String
  {Tx.starts_with(release_ticket_sql(session,owner,generation),"INSERT") == False{} : Bool}

def release_inserts_no_row(session,owner,generation):
  {==}

law owner_death_marks_only_unexited_attempts:
  for session: String
  {record_owner_death_sql(session) == "UPDATE executions SET phase='exited',status='owner-death' WHERE session=" ++ C.q(session) ++ " AND phase<>'exited';" : String}

def owner_death_marks_only_unexited_attempts(session):
  {==}

law claim_and_release_are_distinct_transitions:
  for session: String
  for owner: String
  for generation: String
  {String.eq(claim_sql(session,owner),release_ticket_sql(session,owner,generation)) == False{} : Bool}

def claim_and_release_are_distinct_transitions(session,owner,generation):
  {==}

law missing_claim_table_reads_empty:
  for db: String
  for session: String
  {read_claim_when_present(db,session,False{}) == IO.pure(String,"") : IO(String)}

def missing_claim_table_reads_empty(db,session):
  {==}

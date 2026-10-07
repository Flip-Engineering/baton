import Base
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
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

# Change-publication contract for the coordinator queue. The projection
# installer runs before the writer's own transaction begins; the committed
# cursor publishes only after that transaction commits. A rolled-back
# transaction never reaches publication, and a publication failure is not a
# transaction rollback: the commit stands and the generation-gap resync
# covers the missed notice.
#
# The projection definition below mirrors the host installer statement by
# statement in host order (bend2/src/host/sqlite.c baton_change_schema at
# e78afd62). It is interim until the host owner delivers a
# Sql.projection_schema() accessor, which replaces this text without
# changing callers. Byte identity against the host array is verified in
# qualification receipts; runtime fixtures cover installation and trigger fire.
def projection_schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS native_changes (change_id INTEGER PRIMARY KEY AUTOINCREMENT,recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),entity TEXT NOT NULL,entity_id TEXT NOT NULL,session_id TEXT NOT NULL DEFAULT '',operation TEXT NOT NULL CHECK(operation IN ('insert','update','delete')),kind TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_retention AFTER INSERT ON native_changes BEGIN DELETE FROM native_changes WHERE change_id<=NEW.change_id-10000; END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_insert AFTER INSERT ON sessions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',NEW.id,NEW.id,'insert','session','session inserted'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_update AFTER UPDATE ON sessions WHEN OLD.parent IS NOT NEW.parent OR OLD.harness IS NOT NEW.harness OR OLD.model IS NOT NEW.model OR OLD.effort IS NOT NEW.effort OR OLD.native IS NOT NEW.native OR OLD.observed_harness IS NOT NEW.observed_harness OR OLD.observed_model IS NOT NEW.observed_model OR OLD.observed_effort IS NOT NEW.observed_effort OR OLD.endpoint IS NOT NEW.endpoint OR OLD.workspace IS NOT NEW.workspace OR OLD.branch IS NOT NEW.branch OR OLD.base IS NOT NEW.base BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',NEW.id,NEW.id,'update','session','session updated'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sessions_delete AFTER DELETE ON sessions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('player',OLD.id,OLD.id,'delete','session','session deleted'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_roles_insert AFTER INSERT ON session_roles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',NEW.session,NEW.session,'insert','role',NEW.role); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_roles_update AFTER UPDATE ON session_roles WHEN OLD.role IS NOT NEW.role BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',NEW.session,NEW.session,'update','role',NEW.role); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_roles_delete AFTER DELETE ON session_roles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('role',OLD.session,OLD.session,'delete','role',OLD.role); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_executions_insert AFTER INSERT ON executions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',NEW.session,NEW.session,'insert','execution',NEW.phase || ' ' || NEW.status); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_executions_update AFTER UPDATE ON executions WHEN OLD.id IS NOT NEW.id OR OLD.mode IS NOT NEW.mode OR OLD.directory IS NOT NEW.directory OR OLD.phase IS NOT NEW.phase OR OLD.status IS NOT NEW.status BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',NEW.session,NEW.session,'update','execution',NEW.phase || ' ' || NEW.status); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_executions_delete AFTER DELETE ON executions BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('execution',OLD.session,OLD.session,'delete','execution',OLD.phase || ' ' || OLD.status); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_stops_insert AFTER INSERT ON session_stops BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',NEW.session,NEW.session,'insert','stop',NEW.outcome); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_stops_update AFTER UPDATE ON session_stops WHEN OLD.id IS NOT NEW.id OR OLD.reason IS NOT NEW.reason OR OLD.attempt IS NOT NEW.attempt OR OLD.directory IS NOT NEW.directory OR OLD.signal IS NOT NEW.signal OR OLD.applied_signal IS NOT NEW.applied_signal OR OLD.control_error IS NOT NEW.control_error OR OLD.outcome IS NOT NEW.outcome OR OLD.native_status IS NOT NEW.native_status OR OLD.report_id IS NOT NEW.report_id BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',NEW.session,NEW.session,'update','stop',NEW.outcome); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_stops_delete AFTER DELETE ON session_stops BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('stop',OLD.session,OLD.session,'delete','stop',OLD.outcome); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_messages_insert AFTER INSERT ON messages BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',NEW.id,NEW.recipient,'insert','message:' || NEW.kind,NEW.kind || ' from ' || NEW.sender); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_messages_update AFTER UPDATE ON messages WHEN OLD.sender IS NOT NEW.sender OR OLD.recipient IS NOT NEW.recipient OR OLD.kind IS NOT NEW.kind OR OLD.body IS NOT NEW.body OR OLD.receipt IS NOT NEW.receipt BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',NEW.id,NEW.recipient,'update',CASE WHEN OLD.receipt IS NOT NEW.receipt THEN 'receipt' ELSE 'message:' || NEW.kind END,CASE WHEN OLD.receipt IS NOT NEW.receipt THEN 'acknowledged' ELSE NEW.kind || ' from ' || NEW.sender END); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_messages_delete AFTER DELETE ON messages BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('message',OLD.id,OLD.recipient,'delete','message:' || OLD.kind,OLD.kind || ' from ' || OLD.sender); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_turns_insert AFTER INSERT ON turns BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',NEW.id,NEW.worker,'insert','report','turn report recorded'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_turns_update AFTER UPDATE ON turns WHEN OLD.worker IS NOT NEW.worker OR OLD.event IS NOT NEW.event BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',NEW.id,NEW.worker,'update','report','turn report updated'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_turns_delete AFTER DELETE ON turns BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('turn',OLD.id,OLD.worker,'delete','report','turn report removed'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_insert AFTER INSERT ON ensembles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',NEW.id,NEW.owner,'insert','ensemble',NEW.coupling); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_update AFTER UPDATE ON ensembles WHEN OLD.owner IS NOT NEW.owner OR OLD.coupling IS NOT NEW.coupling BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',NEW.id,NEW.owner,'update','ensemble',NEW.coupling); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_ensembles_delete AFTER DELETE ON ensembles BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('ensemble',OLD.id,OLD.owner,'delete','ensemble',OLD.coupling); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_members_insert AFTER INSERT ON ensemble_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('membership',NEW.ensemble,NEW.session,'insert','membership',NEW.ensemble); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_members_delete AFTER DELETE ON ensemble_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('membership',OLD.ensemble,OLD.session,'delete','membership',OLD.ensemble); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sections_insert AFTER INSERT ON sections BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',NEW.ensemble || '/' || NEW.id,e.owner,'insert','section',NEW.capability FROM ensembles e WHERE e.id=NEW.ensemble; END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sections_update AFTER UPDATE ON sections WHEN OLD.ensemble IS NOT NEW.ensemble OR OLD.id IS NOT NEW.id OR OLD.capability IS NOT NEW.capability BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',NEW.ensemble || '/' || NEW.id,e.owner,'update','section',NEW.capability FROM ensembles e WHERE e.id=NEW.ensemble; END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_sections_delete AFTER DELETE ON sections BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section',OLD.ensemble || '/' || OLD.id,e.owner,'delete','section',OLD.capability FROM ensembles e WHERE e.id=OLD.ensemble; END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_section_members_insert AFTER INSERT ON section_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section-membership',NEW.ensemble || '/' || NEW.section,NEW.session,'insert','section-membership',s.capability FROM sections s WHERE s.ensemble=NEW.ensemble AND s.id=NEW.section; END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_section_members_delete AFTER DELETE ON section_members BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) SELECT 'section-membership',OLD.ensemble || '/' || OLD.section,OLD.session,'delete','section-membership',s.capability FROM sections s WHERE s.ensemble=OLD.ensemble AND s.id=OLD.section; END;"

# The app tables come first: projection triggers reference them, and SQLite
# refuses a trigger whose subject table does not exist yet. The schema
# installer always runs, so a fresh database converges on first use. The
# projection installer runs only while its objects are missing: the count
# below names the table plus one trigger per row effect above, so a partial
# install self-heals and later commits pay two small existence checks.
def projection_object_total() -> String:
  "30"

def projection_count_sql() -> String:
  "SELECT CAST(count(*) AS TEXT) FROM sqlite_master WHERE name LIKE 'native_changes_%';"

def ensure_projection_unless_present(+db: String, present: Bool) -> IO(Unit):
  match present:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      ensured : String <- IO.try(String,DB.Sql.ensure_projection(db,projection_schema_sql()))
      IO.pure(Unit,Unit{})

def ensure_before_begin(+db: String) -> IO(Unit):
  do IO<Unit>:
    schemad : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    counted : String <- IO.try(String,DB.Sql.query(db,projection_count_sql()))
    ensured : Unit <- ensure_projection_unless_present(db,String.eq(Tx.trim_nl(counted),projection_object_total()))
    IO.pure(Unit,Unit{})

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

def committed(db: String, command: C.Command, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+saved}: route_accepted(db,command,saved,refused(saved))

# The single statement a commit runs: schema, command SQL, one transaction.
def commit_sql(command: C.Command) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;"

def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  transact_sql(db,commit_sql(command))

def apply(+db: String, +command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- commit(db,command)
    committed(db,command,result)


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

# CLAIM: the managed one-shot and runtime lifecycle composition. The intent
# companion reads committed query and role intents through the bound database path
# and waits one second between reads while its role has live or unsettled duties;
# the release attempt moves a pending intent to attempted before the syscall and
# records an acknowledgment or an unknown outcome; and the rejected-preparation
# cleanup branch is admitted only when all four of its evidence predicates hold.
#
# The companion owns no listener, keeper, spool cursor or second attachment. The
# final predicate of the rejected branch is a cross-process protocol assumption that
# the shared process implementation owns; this module pins the conjunction and its
# placement, not that protocol's foreign execution.
import Base
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./roles.bend as ContextRoles

def rejected_cleanup_ready(sameRejectedBinding: Bool, preparedProtocolBound: Bool, keeperLifetimeEnded: Bool, acceptedDecisionRequiredForGrant: Bool) -> Bool:
  Bool.and(sameRejectedBinding, Bool.and(preparedProtocolBound, Bool.and(keeperLifetimeEnded, acceptedDecisionRequiredForGrant)))

# The signal-attempt delivery state. Only a pending intent becomes attempted; a
# recorded attempt is never silently retried as a fresh signal.
def release_attempt_delivery(+recorded: String) -> String:
  Bool.pick(String, String.eq(recorded, "pending"), "attempted", recorded)

def release_ack_delivery(+acknowledged: Bool) -> String:
  Bool.pick(String, acknowledged, "acknowledged", "unknown")

def owns_live_duty(+recorded: String) -> Bool:
  Bool.or(Bool.or(String.eq(recorded, "pending"), String.eq(recorded, "attempted")), Bool.or(String.eq(recorded, "unknown"), String.eq(recorded, "unavailable")))

# The companion's read answers `1\n` while this role still has a live or unsettled
# duty; anything else is a settled role and ends the companion.
def intent_owed(+row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "1")

def intent_settled(row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "0")

def intent_missing(row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "missing")

# One companion step: a bound read of committed intents, then the caller's duty
# probe, then either one second of waiting and the continuation or the end. A failed
# bound read ends the companion without claiming a wake; the original keeper and
# observer retain their duty.
def reconcile_delay(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    waited : Unit <- IO.sleep(1000)
    again(Unit{})

# The role observer starts exactly one in-process companion and keeps its own handle
# and spool reader.
def reconcile_settled(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(Unit), owed: Bool, live: Bool) -> IO(Unit):
  Bool.pick(IO(Unit), Bool.or(owed, live), reconcile_delay(db, binding, query, role, incarnation, duty, again), IO.pure(Unit, Unit{}))

def reconcile_after(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(Unit), read: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match read:
    case Fail{error}: IO.pure(Unit, Unit{})
    case Done{+captured}: do IO<Unit>:
      live : Bool <- duty(Unit{})
      reconcile_settled(db, binding, query, role, incarnation, duty, again, intent_owed(captured), live)

def reconcile_intents(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(Unit)) -> IO(Unit):
  do IO<Unit>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.intent_read_sql(query, role, incarnation))
    reconcile_after(db, binding, query, role, incarnation, duty, again, read)

def start_reconcile(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(Unit)) -> IO(Chan(Unit)):
  IO.fork(Unit, reconcile_intents(db, binding, query, role, incarnation, duty, again))

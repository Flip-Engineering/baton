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

# The companion's read answers `1` while this role has a live or unsettled duty, `0` for a
# recorded role with nothing outstanding, and `missing` when no role row is recorded. Any
# other answer is carried as unreadable rather than being read as a settled role.
def intent_owed(+row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "1")

def intent_settled(row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "0")

def intent_missing(row: String) -> Bool:
  String.eq(Tx.trim_nl(row), "missing")

# What one companion step concluded. A settled role ends the companion; a missing
# custody answer is a failure with its own answer text, never a settled role; and a
# failed bound read keeps its host error.
type CompanionStep is Data:
  StepContinue{}
  StepSettled{}
  StepMissing{answer: String}
  StepUnreadable{answer: String}
  StepFailed{code: U32, message: String}

# One companion conclusion as text, the same way the duty and admission modules render
# theirs, so a caller can observe a step without re-deriving it.
def companion_text(+step: CompanionStep) -> String:
  match step:
    case StepContinue{}: "continue"
    case StepSettled{}: "settled"
    case StepMissing{+answer}: "missing:" ++ Tx.trim_nl(answer)
    case StepUnreadable{+answer}: "unreadable:" ++ Tx.trim_nl(answer)
    case StepFailed{+code, +message}: "failed:" ++ U32.show(code) ++ ":" ++ message

def intent_step(answer: String) -> CompanionStep:
  Bool.pick(CompanionStep, intent_owed(answer), StepContinue{},
  Bool.pick(CompanionStep, intent_settled(answer), StepSettled{},
  Bool.pick(CompanionStep, intent_missing(answer), StepMissing{answer}, StepUnreadable{answer})))

# One reading: the bound intent answer, then the caller's duty probe while the
# recorded duties are settled but the role may still be live.
def companion_answer(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), step: CompanionStep) -> IO(CompanionStep):
  match step:
    case StepContinue{}: IO.pure(CompanionStep, StepContinue{})
    case StepSettled{}: do IO<CompanionStep>:
      live : Bool <- duty(Unit{})
      IO.pure(CompanionStep, Bool.pick(CompanionStep, live, StepContinue{}, StepSettled{}))
    case StepMissing{answer}: IO.pure(CompanionStep, StepMissing{answer})
    case StepUnreadable{answer}: IO.pure(CompanionStep, StepUnreadable{answer})
    case StepFailed{code, message}: IO.pure(CompanionStep, StepFailed{code, message})

# The companion: one reading, then one second of waiting and the continuation while
# the role has a live or unsettled duty. A settled, missing or failed conclusion ends
# the companion and is returned to its caller.
def companion_step(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool)) -> IO(CompanionStep):
  do IO<CompanionStep>:
    read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, ContextRoles.intent_read_sql(query, role, incarnation))
    match read:
      case Fail{error}:
        match error:
          case (code, message): IO.pure(CompanionStep, StepFailed{code, message})
      case Done{+answer}: companion_answer(db, binding, query, role, incarnation, duty, intent_step(answer))

def reconcile_step(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(CompanionStep), step: CompanionStep) -> IO(CompanionStep):
  match step:
    case StepContinue{}: do IO<CompanionStep>:
      waited : Unit <- IO.sleep(1000)
      again(Unit{})
    case StepSettled{}: IO.pure(CompanionStep, StepSettled{})
    case StepMissing{answer}: IO.pure(CompanionStep, StepMissing{answer})
    case StepUnreadable{answer}: IO.pure(CompanionStep, StepUnreadable{answer})
    case StepFailed{code, message}: IO.pure(CompanionStep, StepFailed{code, message})

# The role observer starts exactly one in-process companion and keeps its own handle
# and spool reader.
def reconcile_intents(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(CompanionStep)) -> IO(CompanionStep):
  do IO<CompanionStep>:
    step : CompanionStep <- companion_step(db, binding, query, role, incarnation, duty)
    reconcile_step(db, binding, query, role, incarnation, duty, again, step)

def start_reconcile(+db: String, +binding: String, +query: String, +role: String, +incarnation: String, duty: Unit -> IO(Bool), again: Unit -> IO(CompanionStep)) -> IO(Chan(CompanionStep)):
  IO.fork(CompanionStep, reconcile_intents(db, binding, query, role, incarnation, duty, again))

import Base
import ./commands.bend as C
import ./receive.bend as Receive
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx

# The fixed coordinator drives every session with actionable pending input as
# concurrent native tasks under the elected database owner. One serve process
# holds the physical coordinator role and one committed-change subscription per
# database; the subscription is opened before the first snapshot, so no
# committed input falls between the snapshot and the subscriber registration.
# The main loop blocks only on one shared event channel. Every native task
# carries a relay that joins only its own task and reports TaskDone; one
# independent owner-notice waiter reports Commit, Gap or Closed and the loop
# rearms it on consumption. Every event replays the full pending snapshot, so
# a late commit starts while older tasks are still held, and older actionable
# IDs replay after any restart. The owner publishes the high-water; this loop
# only reads rows and never publishes.
type Event is Data:
  TaskDone{session: String, ok: Bool}
  Commit{}
  Gap{}
  Closed{}

# The fixed coordinator role tag: one constant 64-hex digest, independent of
# the database path, the query subject and the owner epoch. The lock file also
# names the physical device, file and birth tuple, so hard-link aliases of one
# database contend on the same role while UI subscriptions stay multi-client.
def coordinator_role_key() -> String:
  "676b676b676b676b676b676b676b676b676b676b676b676b676b676b676b676b"

# Sessions holding actionable pending input: unacknowledged messages on live
# sessions with a registered receiver endpoint, excluding terminally stopped
# sessions like the wake path. The harness travels with the session so every
# task keeps its native identity down to the route.
def endpoint_field_sql(+session: String, index: String) -> String:
  "SELECT COALESCE(CASE WHEN json_valid(endpoint) THEN json_extract(endpoint,'$[" ++ index ++ "]') ELSE '' END,'') FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def recorded_endpoint(+db: String, +session: String, index: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String, DB.Sql.query(db, endpoint_field_sql(session, index)))
    IO.pure(String, Tx.trim_nl(saved))

def dirty_session_sql() -> String:
  "SELECT DISTINCT m.recipient || '|' || s.harness FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT " ++ C.stopped_session_sql("m.recipient") ++ " AND s.harness IN ('codex','omp','muse','claude-code') AND s.endpoint <> '' ORDER BY m.recipient;"

def split_parts(parts: List<&2,String>, +line: String) -> String & String:
  match parts:
    case session <> harness <> Nil{}: (Tx.trim_nl(session), Tx.trim_nl(harness))
    case other: (Tx.trim_nl(line), "")

def split_pair(+line: String) -> String & String:
  split_parts(String.split(line, Char.from_u32(124)), line)

def parse_pairs(lines: List<String>) -> List<(String & String)>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest: Con{split_pair(line), parse_pairs(rest)}

def snapshot(+db: String) -> IO(List<(String & String)>):
  do IO<List<(String & String)>>:
    saved : String <- IO.try(String, DB.Sql.query(db, dirty_session_sql()))
    IO.pure(List<(String & String)>, parse_pairs(Tx.split_lines(saved)))

# Only the receive route can start a native from pending input in this loop:
# Receive admits Codex and OMP sessions through the session lock and consumes
# the inbox on completion. Muse and Claude Code sessions keep their Turn
# handler route, which conductors drive with dispatch-turn; the loop refuses
# them explicitly instead of attempting a receive that cannot admit them.
def receivable(+harness: String) -> Bool:
  Bool.or(String.eq(harness, "codex"), String.eq(harness, "omp"))

def without_session_eq(rest: List<(String & String)>, +id: String, session: String, harness: String, same: Bool) -> List<(String & String)>:
  match same:
    case True{}: without_session(rest, id)
    case False{}: Con{(session, harness), without_session(rest, id)}

def without_session(pairs: List<(String & String)>, +id: String) -> List<(String & String)>:
  match pairs:
    case Nil{}: Nil{}
    case (+session, +harness) <> rest: without_session_eq(rest, id, session, harness, String.eq(session, id))

# Linear strip: each known session is removed by threading the remainder, and
# the known set is returned alongside so no list is ever read twice.
def strip_cons(stripped: List<(String & String)> & List<String>, id: String) -> List<(String & String)> & List<String>:
  match stripped:
    case (fresh, kept): (fresh, Con{id, kept})

def strip_known(pairs: List<(String & String)>, known: List<String>) -> List<(String & String)> & List<String>:
  match known:
    case Nil{}: (pairs, Nil{})
    case id <> rest: strip_cons(strip_known(without_session(pairs, id), rest), id)

def partition_fit(rest: List<(String & String)>, session: String, harness: String, fork: List<(String & String)>, refuse: List<(String & String)>, fits: Bool) -> List<(String & String)> & List<(String & String)>:
  match fits:
    case True{}: partition_go(rest, Con{(session, harness), fork}, refuse)
    case False{}: partition_go(rest, fork, Con{(session, harness), refuse})

def partition_go(pairs: List<(String & String)>, fork: List<(String & String)>, refuse: List<(String & String)>) -> List<(String & String)> & List<(String & String)>:
  match pairs:
    case Nil{}: (fork, refuse)
    case (+session, +harness) <> rest: partition_add(rest, session, harness, fork, refuse)

def partition_add(rest: List<(String & String)>, session: String, +harness: String, fork: List<(String & String)>, refuse: List<(String & String)>) -> List<(String & String)> & List<(String & String)>:
  partition_fit(rest, session, harness, fork, refuse, receivable(harness))

def partition(pairs: List<(String & String)>) -> List<(String & String)> & List<(String & String)>:
  partition_go(pairs, Nil{}, Nil{})

def sessions_of(pairs: List<(String & String)>) -> List<String>:
  match pairs:
    case Nil{}: Nil{}
    case (session, harness) <> rest: Con{session, sessions_of(rest)}

def without_id_eq(rest: List<String>, +id: String, session: String, same: Bool) -> List<String>:
  match same:
    case True{}: without_id(rest, id)
    case False{}: Con{session, without_id(rest, id)}

def without_id(sessions: List<String>, +id: String) -> List<String>:
  match sessions:
    case Nil{}: Nil{}
    case +session <> rest: without_id_eq(rest, id, session, String.eq(session, id))

def member_eq(rest: List<String>, +id: String, same: Bool) -> Bool:
  match same:
    case True{}: True{}
    case False{}: member(rest, id)

def member(sessions: List<String>, +id: String) -> Bool:
  match sessions:
    case Nil{}: False{}
    case +session <> rest: member_eq(rest, id, String.eq(session, id))

def fork_of(decided: List<(String & String)> & List<(String & String)>) -> List<String>:
  match decided:
    case (fork, refuse): sessions_of(fork)

def refuse_of(decided: List<(String & String)> & List<(String & String)>) -> List<String>:
  match decided:
    case (fork, refuse): sessions_of(refuse)

def stripped_fresh(stripped: List<(String & String)> & List<String>) -> List<(String & String)>:
  match stripped:
    case (fresh, kept): fresh

def stripped_kept(stripped: List<(String & String)> & List<String>) -> List<String>:
  match stripped:
    case (fresh, kept): kept

# One session task runs the recorded receive entry with the recorded harness
# executable and log resolved from the receiver endpoint array. Model, effort
# and workspace stay empty so the entry selects the recorded route. The
# session lock inside Receive refuses a second task for the same session with
# queued, so the in-flight set plus the lock agree on admission. Stop
# admission, native conversation identity, pending-input recovery and parent
# notification run in that path unchanged.
def serve_task(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    cmd : String <- recorded_endpoint(db, session, "4")
    log : String <- recorded_endpoint(db, session, "8")
    Receive.run(db, session, cmd, "", "", "", log, "")

def report_send(sent: Bool) -> IO(Event):
  match sent:
    case True{}: IO.pure(Event, Commit{})
    case False{}: do IO<Event>:
      logged : Unit <- IO.write("completion relay could not queue its event; the serve exits.\n")
      IO.die(Event, 1, "The event channel refused a completion.")

# A failed send means the event loop is gone; the diagnostic stays on the
# serve log and the serve exits instead of dropping a completion silently.
# Unsatisfied work stays in the database for the next serve to replay.
def send_or_die(chan: Chan(Event), event: Event) -> IO(Event):
  do IO<Event>:
    sent : Bool <- Chan.send(Event, chan, event)
    report_send(sent)

# Each relay joins only its own native task, then queues one TaskDone carrying
# whether the task succeeded. The returned event is never observed: no task
# joins a relay, so the relay result only satisfies the fork type.
def relay_done(+session: String, +chan: Chan(Event), done: Result<&1,&1,U32 & String,Unit>) -> IO(Event):
  match done:
    case Done{unit}: send_or_die(chan, TaskDone{session, True{}})
    case Fail{error}: send_or_die(chan, TaskDone{session, False{}})

@unsafe
def relay(task: Chan(Result<&1,&1,U32 & String,Unit>), +session: String, +chan: Chan(Event)) -> IO(Event):
  do IO<Event>:
    done : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>, task)
    relay_done(session, chan, done)

def kind_commit(commit: Bool) -> IO(Event):
  match commit:
    case True{}: IO.pure(Event, Commit{})
    case False{}: IO.pure(Event, Gap{})

# A notice carries only the cursor high-water, so every notice replays the
# full pending snapshot; a gap notice is served by the same snapshot. An
# unknown kind replays as a gap, the conservative full read.
def classify(db: String, text: String) -> IO(Event):
  do IO<Event>:
    saved : String <- IO.try(String, DB.Sql.query(db, "SELECT json_extract(" ++ C.q(text) ++ ",'$.kind');"))
    kind_commit(String.eq(Tx.trim_nl(saved), "commit"))

def await_notice(db: String, result: Result<&1,&1,U32 & String,String>, chan: Chan(Event)) -> IO(Event):
  match result:
    case Fail{error}: send_or_die(chan, Closed{})
    case Done{text}: do IO<Event>:
      event : Event <- classify(db, text)
      send_or_die(chan, event)

# The single independent owner-notice waiter: one notice becomes one event,
# then this task ends and the loop rearms a fresh waiter. A failed notice
# means the owner is gone; the loop closes the subscription and exits with
# the carried status instead of acting for a stale owner.
@unsafe
def waiter(db: String, handle: U32, chan: Chan(Event)) -> IO(Event):
  do IO<Event>:
    result : Result<&1,&1,U32 & String,String> <- Custody.Instance.notice(handle)
    await_notice(db, result, chan)

# A failed task carries its failure to the shutdown exit. A stop racing the
# snapshot can fail a task whose input the stop retained; the next serve
# excludes that stopped input, so the exit stays truthful while the input
# stays pending.
def note_task(failed: Bool, ok: Bool) -> IO(Bool):
  match ok:
    case True{}: IO.pure(Bool, failed)
    case False{}: IO.pure(Bool, True{})

def drop_chan(chan: Chan(Event)) -> IO(Unit):
  IO.pure(Unit, Unit{})

@unsafe
def fork_each(+db: String, +chan: Chan(Event), pairs: List<(String & String)>, flying: List<String>) -> IO(List<String>):
  match pairs:
    case Nil{}: IO.pure(List<String>, flying)
    case (+session, harness) <> rest: do IO<List<String>>:
      task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>, serve_task(db, session))
      relay_task : Chan(Event) <- IO.fork(Event, relay(task, session, chan))
      dropped : Unit <- drop_chan(relay_task)
      fork_each(db, chan, rest, Con{session, flying})

# Sessions outside the receive route are refused aloud on every committed
# change: the refusal names the session, its harness and the conductor Turn
# route that serves it. Refusals never fork a native and never mark the serve
# failed; TaskDone events do not re-probe them, so an instantly refused
# session cannot spin the loop.
def refuse_each(pairs: List<(String & String)>, refused: List<String>) -> IO(List<String>):
  match pairs:
    case Nil{}: IO.pure(List<String>, refused)
    case (session, +harness) <> rest: do IO<List<String>>:
      logged : Unit <- IO.write("serve-refused " ++ session ++ " " ++ harness ++ ": this loop serves Codex and OMP sessions through receive; serve " ++ harness ++ " sessions with dispatch-turn.\n")
      refuse_each(rest, Con{session, refused})

def fork_split(+db: String, +chan: Chan(Event), split: List<(String & String)> & List<(String & String)>, flying: List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match split:
    case (fork, refuse): do IO<Result<&1,&1,U32 & String,Unit>>:
      flying_now : List<String> <- fork_each(db, chan, fork, flying)
      refused_now : List<String> <- refuse_each(refuse, refused)
      again(failed, flying_now, refused_now)

def fork_stripped2(+db: String, +chan: Chan(Event), stripped2: List<(String & String)> & List<String>, flying: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stripped2:
    case (fresh2, refused): fork_split(db, chan, partition(fresh2), flying, refused, failed, again)

def fork_stripped(+db: String, +chan: Chan(Event), stripped1: List<(String & String)> & List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stripped1:
    case (fresh1, flying): fork_stripped2(db, chan, strip_known(fresh1, refused), flying, failed, again)

def fork_new(+db: String, +chan: Chan(Event), pairs: List<(String & String)>, flying: List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  fork_stripped(db, chan, strip_known(pairs, flying), refused, failed, again)

def kept(result: Result<&1,&1,U32 & String,Unit>, failed: Bool) -> IO(Bool):
  match result:
    case Done{unit}: IO.pure(Bool, failed)
    case Fail{error}: IO.pure(Bool, True{})

def release_guard(guard: U32, failed: Bool) -> IO(Bool):
  do IO<Bool>:
    result : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(guard)
    kept(result, failed)

def close_subscription(+handle: U32, +failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(handle)
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{(1, "The serve recorded a swept task failure.")})
    case False{}: Custody.Instance.unsubscribe(handle)

def close_guarded(handle: U32, guard: U32, failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    failed_now : Bool <- release_guard(guard, failed)
    close_subscription(handle, failed_now)

# One event advances the loop. TaskDone drops the session from the in-flight
# set and replays the snapshot without re-probing refusals. Commit and Gap
# re-arm the notice waiter first, clear the refused set for a fresh probe,
# and replay the same full snapshot. Closed releases the coordinator role,
# closes the subscription and exits carrying the swept status.
@unsafe
def on_event(+db: String, handle: U32, guard: U32, +chan: Chan(Event), event: Event, failed: Bool, flying: List<String>, refused: List<String>, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match event:
    case TaskDone{session, ok}: do IO<Result<&1,&1,U32 & String,Unit>>:
      failed_now : Bool <- note_task(failed, ok)
      fresh : List<(String & String)> <- snapshot(db)
      fork_new(db, chan, fresh, without_id(flying, session), refused, failed_now, again)
    case Commit{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      waiter_task : Chan(Event) <- IO.fork(Event, waiter(db, handle, chan))
      dropped : Unit <- drop_chan(waiter_task)
      fresh : List<(String & String)> <- snapshot(db)
      fork_new(db, chan, fresh, flying, Nil{}, failed, again)
    case Gap{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      waiter_task : Chan(Event) <- IO.fork(Event, waiter(db, handle, chan))
      dropped : Unit <- drop_chan(waiter_task)
      fresh : List<(String & String)> <- snapshot(db)
      fork_new(db, chan, fresh, flying, Nil{}, failed, again)
    case Closed{}: close_guarded(handle, guard, failed)

def dispatch_maybe(db: String, handle: U32, guard: U32, chan: Chan(Event), failed: Bool, flying: List<String>, refused: List<String>, event: Maybe<&1,Event>, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match event:
    case None{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      logged : Unit <- IO.write("The serve event channel closed; the serve exits.\n")
      close_guarded(handle, guard, True{})
    case Some{ev}: on_event(db, handle, guard, chan, ev, failed, flying, refused, again)

# The main loop blocks only on the shared event channel. The drive itself is
# the only self-recursive definition; every handler above is ordered before
# its callers and the loop state travels as three separate values through one
# affine continuation.
@unsafe
def drive(+db: String, +handle: U32, +guard: U32, +chan: Chan(Event), failed: Bool, flying: List<String>, refused: List<String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    event : Maybe<&1,Event> <- Chan.recv(Event, chan)
    dispatch_maybe(db, handle, guard, chan, failed, flying, refused, event, failed_next => flying_next => refused_next => drive(db, handle, guard, chan, failed_next, flying_next, refused_next))

def arm(db: String, handle: U32, chan: Chan(Event)) -> IO(Unit):
  do IO<Unit>:
    waiter_task : Chan(Event) <- IO.fork(Event, waiter(db, handle, chan))
    drop_chan(waiter_task)

def drive_new(+db: String, +handle: U32, guard: U32, +chan: Chan(Event), failed: Bool, pairs: List<(String & String)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    armed : Unit <- arm(db, handle, chan)
    fork_new(db, chan, pairs, Nil{}, Nil{}, failed, failed_next => flying_next => refused_next => drive(db, handle, guard, chan, failed_next, flying_next, refused_next))

def admitted(+db: String, guard: U32, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Bool <- release_guard(guard, False{})
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(handle, readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      chan : Chan(Event) <- Chan.new(Event, 1024)
      fresh : List<(String & String)> <- snapshot(db)
      drive_new(db, handle, guard, chan, False{}, fresh)

def enter(+db: String, guarded: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match guarded:
    case Fail{(code, text)}: IO.die(Result<&1,&1,U32 & String,Unit>, 2, "coordinator-held " ++ db ++ ": another serve holds the fixed coordinator role for this database (" ++ text ++ "); join it or stop it first.")
    case Done{guard}: do IO<Result<&1,&1,U32 & String,Unit>>:
      subscribed : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db, "0", "0")
      admitted(db, guard, subscribed)

# The coordinator role is acquired before the subscription: the guard names
# the physical database tuple, so a second serve on the same database or one
# of its hard-link aliases is refused here and exits short-lived. Ordinary
# status and UI subscriptions take no role and stay multi-client.
def serve(+db: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    bound : String <- IO.try(String, DB.Sql.binding(db))
    guarded : Result<&1,&1,U32 & String,U32> <- DB.Sql.role_guard(db, bound, coordinator_role_key())
    enter(db, guarded)

def status_read(+db: String, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(handle, readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      Custody.Instance.unsubscribe(handle)

# One-shot owner readiness for admission and discovery: the generation, the
# committed cursor and the gap flag, then the subscription closes.
def owner_status(+db: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    subscribed : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db, "0", "0")
    status_read(db, subscribed)

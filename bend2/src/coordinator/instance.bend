import Base
import ../coordinator/commands.bend as C
import ./receive.bend as Receive
import ../host/session-lock.bend as Lock
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx
import ../harness/codex-player.bend as Codex
import ./delivery.bend as Delivery

# The fixed coordinator drives every session with actionable pending input as
# concurrent native tasks under the elected database owner. One serve process
# holds the physical coordinator role and one committed-change subscription per
# database; the subscription is opened before the first snapshot, so no
# committed input falls between the snapshot and the subscriber registration.
# The main loop blocks only on one shared event channel. Every native task
# carries a relay that joins only its own task and reports TaskDone; one
# independent owner-notice waiter reports Committed, Gap or Closed and the loop
# rearms it on consumption. Every event replays the full pending snapshot, so
# a late commit starts while older tasks are still held, and older actionable
# IDs replay after any restart. The owner publishes the high-water; this loop
# only reads rows and never publishes.
type Event is Type:
  TaskDone{session: String, result: Result<&1,&1,U32 & String,Unit>}
  Committed{}
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
  "SELECT COALESCE(CASE WHEN json_valid(endpoint) THEN json_extract(endpoint,'$[' || ("
  ++ "CASE WHEN json_extract(endpoint,'$[2]')='receive' THEN 0 ELSE "
  ++ "(SELECT key+1 FROM json_each(endpoint) WHERE value='--' AND json_extract(endpoint,'$[' || (key+3) || ']')='receive' LIMIT 1) END"
  ++ " + " ++ index ++ ") || ']') ELSE '' END,'') FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def recorded_endpoint(+db: String, +session: String, index: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String, DB.Sql.query(db, endpoint_field_sql(session, index)))
    IO.pure(String, Tx.trim_nl(saved))

def managed_receiver_sql() -> String:
  "s.harness='codex' AND s.native<>'' AND CASE WHEN s.endpoint='' THEN 1 WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND (json_array_length(s.endpoint)=0 OR (json_extract(s.endpoint,'$[1]') LIKE '%/codex-inbox-wake.mjs' AND json_extract(s.endpoint,'$[#-5]')='--session' AND json_extract(s.endpoint,'$[#-2]')=s.id AND json_extract(s.endpoint,'$[#-1]')=s.native)) ELSE 0 END"

def native_receiver_sql() -> String:
  Delivery.native_receiver_sql()

def dirty_session_sql() -> String:
  "SELECT DISTINCT m.recipient || '|' || s.harness || '|' || CASE WHEN (" ++ native_receiver_sql() ++ ") OR (" ++ managed_receiver_sql() ++ ") THEN 'serve' ELSE 'refuse' END FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT " ++ C.stopped_session_sql("m.recipient") ++ " AND s.harness IN ('codex','omp','muse','claude-code') ORDER BY m.recipient;"

def split_triple_parts(parts: List<&2,String>, +line: String) -> (String & String) & String:
  match parts:
    case session <> harness <> route <> Nil{}: ((Tx.trim_nl(session), Tx.trim_nl(harness)), Tx.trim_nl(route))
    case other: ((Tx.trim_nl(line), ""), "refuse")

def split_triple(+line: String) -> (String & String) & String:
  split_triple_parts(String.split(line, Char.from_u32(124)), line)

# Generated receivers use Receive for Codex, OMP, Muse and Claude Code.
# Codex App sessions with an empty receiver or a configured managed helper
# subscribe to their recorded conversation.
# Other routes retain their recorded endpoint and report their required setup.
def parse_fit(fit: Bool, session: String, harness: String, serve: List<(String & String)>, refuse: List<(String & String)>) -> List<(String & String)> & List<(String & String)>:
  match fit:
    case True{}: (Con{(session, harness), serve}, refuse)
    case False{}: (serve, Con{(session, harness), refuse})

def parse_routed(split: List<(String & String)> & List<(String & String)>, session: String, harness: String, fit: Bool) -> List<(String & String)> & List<(String & String)>:
  match split:
    case (serve, refuse): parse_fit(fit, session, harness, serve, refuse)

def parse_cons(triple: (String & String) & String, split: List<(String & String)> & List<(String & String)>) -> List<(String & String)> & List<(String & String)>:
  match triple:
    case ((session, harness), route): parse_routed(split, session, harness, String.eq(route, "serve"))

def parse_split(lines: List<String>) -> List<(String & String)> & List<(String & String)>:
  match lines:
    case Nil{}: (Nil{}, Nil{})
    case line <> rest: parse_cons(split_triple(line), parse_split(rest))

def snapshot(+db: String) -> IO(List<(String & String)> & List<(String & String)>):
  do IO<List<(String & String)> & List<(String & String)>>:
    saved : String <- IO.try(String, DB.Sql.query(db, dirty_session_sql()))
    IO.pure(List<(String & String)> & List<(String & String)>, parse_split(Tx.split_lines(saved)))

def keep_or_drop(same: Bool, session: String, harness: String, tail: List<(String & String)>) -> List<(String & String)>:
  match same:
    case True{}: tail
    case False{}: Con{(session, harness), tail}

def without_session(pairs: List<(String & String)>, +id: String) -> List<(String & String)>:
  match pairs:
    case Nil{}: Nil{}
    case (+session, +harness) <> rest:
      tail = without_session(rest, id)
      keep_or_drop(String.eq(session, id), session, harness, tail)

# Linear strip: each known session is removed by threading the remainder, and
# the known set is returned alongside so no list is ever read twice.
def strip_cons(stripped: List<(String & String)> & List<String>, id: String) -> List<(String & String)> & List<String>:
  match stripped:
    case (fresh, kept): (fresh, Con{id, kept})

def strip_known(known: List<String>, pairs: List<(String & String)>) -> List<(String & String)> & List<String>:
  match known:
    case Nil{}: (pairs, Nil{})
    case +id <> rest: strip_cons(strip_known(rest, without_session(pairs, id)), id)

def serve_part(split: List<(String & String)> & List<(String & String)>) -> List<(String & String)>:
  match split:
    case (serve, refuse): serve

def refuse_part(split: List<(String & String)> & List<(String & String)>) -> List<(String & String)>:
  match split:
    case (serve, refuse): refuse

def sessions_of(pairs: List<(String & String)>) -> List<String>:
  match pairs:
    case Nil{}: Nil{}
    case (session, harness) <> rest: Con{session, sessions_of(rest)}

def keep_or_drop_id(same: Bool, session: String, tail: List<String>) -> List<String>:
  match same:
    case True{}: tail
    case False{}: Con{session, tail}

def without_id(sessions: List<String>, +id: String) -> List<String>:
  match sessions:
    case Nil{}: Nil{}
    case +session <> rest:
      tail = without_id(rest, id)
      keep_or_drop_id(String.eq(session, id), session, tail)

def member_or(hit: Bool, found: Bool) -> Bool:
  match hit:
    case True{}: True{}
    case False{}: found

def member(sessions: List<String>, +id: String) -> Bool:
  match sessions:
    case Nil{}: False{}
    case +session <> rest:
      +found = member(rest, id)
      member_or(String.eq(session, id), found)

def stripped_fresh(stripped: List<(String & String)> & List<String>) -> List<(String & String)>:
  match stripped:
    case (fresh, kept): fresh

def stripped_kept(stripped: List<(String & String)> & List<String>) -> List<String>:
  match stripped:
    case (fresh, kept): kept

# Each session task uses its recorded native receiver or managed App helper.
# The coordinator keeps that task in its in-flight set through turn settlement.
def managed_result(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{saved}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def serve_managed(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    row : String <- IO.try(String,DB.Sql.query(db,"SELECT native FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    executable : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.executable()
    run : Result<&1,&1,U32 & String,String> <- Codex.inbox_follow(executable,db,session,Tx.trim_nl(row))
    logged : Result<&1,&1,U32 & String,String> <- Delivery.completed(db,"",run)
    managed_result(logged)

def serve_native(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    cmd : String <- recorded_endpoint(db, session, "4")
    model : String <- recorded_endpoint(db, session, "5")
    effort : String <- recorded_endpoint(db, session, "6")
    cwd : String <- recorded_endpoint(db, session, "7")
    log : String <- recorded_endpoint(db, session, "8")
    Receive.serve(db, session, cmd, model, effort, cwd, log)

def serve_selected(db: String, session: String, managed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match managed:
    case True{}: serve_managed(db,session)
    case False{}: serve_native(db,session)

def serve_task(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    row : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ managed_receiver_sql() ++ " FROM sessions s WHERE s.id=" ++ C.q(session) ++ ";"))
    serve_selected(db,session,String.eq(Tx.trim_nl(row),"1"))

def report_send(sent: Bool) -> IO(Event):
  match sent:
    case True{}: IO.pure(Event, Committed{})
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

# Each relay sends its task's actual result through the shared event channel.
def relay_done(+session: String, +chan: Chan(Event), done: Result<&1,&1,U32 & String,Unit>) -> IO(Event):
  send_or_die(chan, TaskDone{session,done})

@unsafe
def relay(task: Chan(Result<&1,&1,U32 & String,Unit>), +session: String, +chan: Chan(Event)) -> IO(Event):
  do IO<Event>:
    done : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>, task)
    relay_done(session, chan, done)

def kind_commit(commit: Bool) -> IO(Event):
  match commit:
    case True{}: IO.pure(Event, Committed{})
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

# Sessions outside the receive route are refused aloud whenever no native
# holds them: the refusal names the session, its harness and the route that
# serves it. A session with an active native stays quiet because its input is
# being served. Refusals never fork a native and never mark the serve failed;
# TaskDone events do not re-probe them, so an instantly refused session cannot
# spin the loop.
def refusal_route(+session: String, +harness: String, turn: Bool) -> String:
  match turn:
    case True{}: "serve-refused " ++ session ++ " " ++ harness ++ ": register a native receiver or run this session with dispatch-turn.\n"
    case False{}: "serve-refused " ++ session ++ " " ++ harness ++ ": register a native receiver or a managed Codex App helper endpoint for this session.\n"

def refusal_text(+session: String, +harness: String) -> String:
  refusal_route(session, harness, Bool.or(String.eq(harness, "muse"), String.eq(harness, "claude-code")))

def refuse_emit(held: Maybe<U32>, +session: String, +harness: String, tail: List<String>) -> IO(List<String>):
  match held:
    case None{}: IO.pure(List<String>, tail)
    case Some{lock}: do IO<List<String>>:
      released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
      logged : Unit <- IO.write(refusal_text(session, harness))
      IO.pure(List<String>, tail)

def refuse_loop(+canonical: String, pairs: List<(String & String)>, refused: List<String>) -> IO(List<String>):
  match pairs:
    case Nil{}: IO.pure(List<String>, refused)
    case (+session, +harness) <> rest: do IO<List<String>>:
      held : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(canonical, session))
      tail : List<String> <- refuse_loop(canonical, rest, Con{session, refused})
      refuse_emit(held, session, harness, tail)

def refuse_each(+db: String, pairs: List<(String & String)>, refused: List<String>) -> IO(List<String>):
  do IO<List<String>>:
    canonical : String <- IO.try(String, Lock.SessionLock.canonical(db))
    refuse_loop(canonical, pairs, refused)

def fork_both(+db: String, +chan: Chan(Event), fresh_serve: List<(String & String)>, fresh_refuse: List<(String & String)>, flying: List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    flying_now : List<String> <- fork_each(db, chan, fresh_serve, flying)
    refused_now : List<String> <- refuse_each(db, fresh_refuse, refused)
    again(failed, flying_now, refused_now)

def fork_refusing(+db: String, +chan: Chan(Event), fresh_serve: List<(String & String)>, stripped_refuse: List<(String & String)> & List<String>, flying: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stripped_refuse:
    case (fresh_refuse, refused): fork_both(db, chan, fresh_serve, fresh_refuse, flying, refused, failed, again)

def fork_serving(+db: String, +chan: Chan(Event), stripped_serve: List<(String & String)> & List<String>, refuse: List<(String & String)>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stripped_serve:
    case (fresh_serve, flying): fork_refusing(db, chan, fresh_serve, strip_known(refused, refuse), flying, failed, again)

def fork_unrefused(+db: String, +chan: Chan(Event), stripped: List<(String & String)> & List<String>, refuse: List<(String & String)>, flying: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stripped:
    case (serve, refused): fork_serving(db, chan, strip_known(flying, serve), refuse, refused, failed, again)

def fork_new(+db: String, +chan: Chan(Event), serve: List<(String & String)>, refuse: List<(String & String)>, flying: List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  fork_unrefused(db, chan, strip_known(refused, serve), refuse, flying, failed, again)

def fork_fresh(+db: String, +chan: Chan(Event), fresh: List<(String & String)> & List<(String & String)>, flying: List<String>, refused: List<String>, failed: Bool, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match fresh:
    case (serve, refuse): fork_new(db, chan, serve, refuse, flying, refused, failed, again)

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

def task_completed(+db: String, handle: U32, guard: U32, +chan: Chan(Event), +session: String, result: Result<&1,&1,U32 & String,Unit>, failed: Bool, flying: List<String>, refused: List<String>, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{(+code,+cause)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      logged : Unit <- IO.write("Serve task " ++ session ++ " failed: " ++ U32.show(code) ++ ": " ++ cause ++ "\n")
      fresh : List<(String & String)> & List<(String & String)> <- snapshot(db)
      fork_fresh(db,chan,fresh,without_id(flying,session),Con{session,without_id(refused,session)},True{},again)
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      fresh : List<(String & String)> & List<(String & String)> <- snapshot(db)
      fork_fresh(db,chan,fresh,without_id(flying,session),refused,failed,again)

# TaskDone releases the in-flight entry and replays pending input. A failed
# session prints its actual cause and waits for Committed or Gap reconsideration;
# the shared subscription and other sessions remain active.
# Committed and Gap re-arm the notice waiter and replay the current snapshot.
# Closed releases the coordinator role and closes its subscription.
@unsafe
def on_event(+db: String, handle: U32, guard: U32, +chan: Chan(Event), event: Event, failed: Bool, flying: List<String>, refused: List<String>, again: Bool -> List<String> -> List<String> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match event:
    case TaskDone{session, result}: task_completed(db,handle,guard,chan,session,result,failed,flying,refused,again)
    case Committed{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      waiter_task : Chan(Event) <- IO.fork(Event, waiter(db, handle, chan))
      dropped : Unit <- drop_chan(waiter_task)
      fresh : List<(String & String)> & List<(String & String)> <- snapshot(db)
      fork_fresh(db, chan, fresh, flying, Nil{}, failed, again)
    case Gap{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      waiter_task : Chan(Event) <- IO.fork(Event, waiter(db, handle, chan))
      dropped : Unit <- drop_chan(waiter_task)
      fresh : List<(String & String)> & List<(String & String)> <- snapshot(db)
      fork_fresh(db, chan, fresh, flying, Nil{}, failed, again)
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

def drive_new(+db: String, +handle: U32, guard: U32, +chan: Chan(Event), failed: Bool, fresh: List<(String & String)> & List<(String & String)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    armed : Unit <- arm(db, handle, chan)
    fork_fresh(db, chan, fresh, Nil{}, Nil{}, failed, failed_next => flying_next => refused_next => drive(db, handle, guard, chan, failed_next, flying_next, refused_next))

def admitted(+db: String, guard: U32, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Bool <- release_guard(guard, False{})
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(handle, readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      chan : Chan(Event) <- Chan.new(Event, 1024)
      fresh : List<(String & String)> & List<(String & String)> <- snapshot(db)
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

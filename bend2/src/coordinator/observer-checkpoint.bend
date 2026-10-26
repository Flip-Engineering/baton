import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx
import ../context/text.bend as ContextText
import ./../coordinator/logs.bend as Logs
import ./checkpoint-codec.bend as CheckpointCodec

# Reducer state committed with the host spool cursor for one retained native
# attempt. The host binds the encoded value to its attempt identity and byte
# offset in the same atomic checkpoint record.
type State is Data:
  State{guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String, omp_activity: String, output: String, output_done: Bool, episode: String}

# The reducer state restored from an attempt checkpoint. Rejected preserves the
# existing checkpoint and custody; it writes no state and moves no cursor.
type RestoreOutcome is Data:
  Restored{state: State}
  Rejected{reason: String}

def schema_version() -> U32:
  1

def empty() -> State:
  State{"0\n","","","","","","","","","0",False{},"0"}

def make(guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String) -> State:
  State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,"","0",False{},"0"}

# Construct the reducer state once with the frame's full payload. The chained
# with_* helpers each rebuilt the whole state, copying the large terminal and
# message fields on every frame.
def make_full(guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String, omp_activity: String, output: String, episode: String) -> State:
  State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,False{},episode}

# The optional schema-1 field records the assistant activity and completed error
# identities needed to recognize an elided terminal repeating an observed error.
def with_omp_activity(state: State, omp_activity: String) -> State:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,previous,output,output_done,episode}:
      State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}

# The byte position shares the raw cursor's existing atomic checkpoint. Older
# schema-1 records have an empty position and establish it at the current tail.
def with_output(state: State, output: String) -> State:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,previous,output_done,episode}:
      State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}

def output(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: output

# Successful EOF output clears held frames and records its completed flush/note.
def finish_output(state: State, output: String) -> State:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,previous,output_done,episode}:
      State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,"",omp_activity,output,True{},episode}

def output_done(state: State) -> Bool:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: output_done

# The episode sequence records later terminal positions for report delivery.
def with_episode(state: State, episode: String) -> State:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,previous}:
      State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}

def episode(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: episode

def omp_activity(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: omp_activity

def cursor(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: guidance_cursor

def last_message(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: last_message

def muse_primary(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: muse_primary

def muse_current(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: muse_current

def terminal(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: terminal

def filter_mode(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: filter_mode

def codex_log(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: codex_log

def held(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}: held


def with_held(state: State, held: String) -> State:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,previous,omp_activity,output,output_done,episode}:
      State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}

# Held OMP prefixes stay in memory while a message or tool call is active. They
# are included in the next semantic checkpoint, but do not cause a disk write
# for every cumulative progress frame. Restart replays from the prior offset.
def changed_when(enabled: Bool, previous: String, next: String) -> Bool:
  match enabled:
    case False{}: False{}
    case True{}: Bool.not(String.eq(previous,next))

# Turn supplies the payload fields its reducer can change on this frame.
# Cursor, command and filter changes always participate in the decision.
def checkpoint_due_next(+previous_episode: String, +previous_cursor: String, +previous_message: String, +previous_activity: String, +previous_primary: String, +previous_current: String, +previous_terminal: String, +previous_filter: String, +previous_codex: String, next: State, message_enabled: Bool, terminal_enabled: Bool, codex_enabled: Bool) -> Bool:
  match next:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}:
      +episode_changed = Bool.not(String.eq(previous_episode,episode))
      +guidance_changed = Bool.not(String.eq(previous_cursor,guidance_cursor))
      +message_changed = changed_when(message_enabled,previous_message,last_message)
      # The spool byte cursor is committed with the next semantic snapshot.
      # Positioned replay rewrites the same bytes from the prior durable offset.
      +activity_changed = Bool.not(String.eq(previous_activity,omp_activity))
      +primary_changed = Bool.not(String.eq(previous_primary,muse_primary))
      +current_changed = Bool.not(String.eq(previous_current,muse_current))
      +terminal_changed = changed_when(terminal_enabled,previous_terminal,terminal)
      +filter_changed = Bool.not(String.eq(previous_filter,filter_mode))
      +codex_changed = changed_when(codex_enabled,previous_codex,codex_log)
      Bool.or(episode_changed,Bool.or(activity_changed,Bool.or(guidance_changed,Bool.or(message_changed,Bool.or(primary_changed,Bool.or(current_changed,Bool.or(terminal_changed,Bool.or(filter_changed,codex_changed))))))))

# Destructure each state once. The previous accessor chain matched the whole
# state for every field, copying the terminal and message strings repeatedly.
def checkpoint_due_fields(+previous: State, +next: State, message_enabled: Bool, terminal_enabled: Bool, codex_enabled: Bool) -> Bool:
  match previous:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}:
      checkpoint_due_next(episode,guidance_cursor,last_message,omp_activity,muse_primary,muse_current,terminal,filter_mode,codex_log,next,message_enabled,terminal_enabled,codex_enabled)

def checkpoint_due(previous: State, next: State) -> Bool:
  checkpoint_due_fields(previous,next,True{},True{},True{})

# SQLite encodes every reducer field as a JSON string, including raw provider
# frames and the newline-delimited held log state.
def encode_sql(+state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode}:
      "SELECT json_object('schema',1,'guidance_cursor'," ++ C.q(guidance_cursor) ++ ",'last_message'," ++ C.q(last_message) ++ ",'muse_primary'," ++ C.q(muse_primary) ++ ",'muse_current'," ++ C.q(muse_current) ++ ",'terminal'," ++ C.q(terminal) ++ ",'filter_mode'," ++ C.q(filter_mode) ++ ",'codex_log'," ++ C.q(codex_log) ++ ",'held'," ++ C.q(held) ++ ",'omp_activity'," ++ C.q(omp_activity) ++ ",'output'," ++ C.q(output) ++ ",'output_done',json(" ++ C.q(Bool.pick(String,output_done,"true","false")) ++ "),'episode'," ++ C.q(episode) ++ ");"

def valid_fields_sql() -> String:
  "json_type(value)='object' AND json_type(value,'$.schema')='integer' AND json_extract(value,'$.schema')=1 AND json_type(value,'$.guidance_cursor')='text' AND json_type(value,'$.last_message')='text' AND json_type(value,'$.muse_primary')='text' AND json_type(value,'$.muse_current')='text' AND json_type(value,'$.terminal')='text' AND json_type(value,'$.filter_mode')='text' AND json_type(value,'$.codex_log')='text' AND json_type(value,'$.held')='text' AND (json_type(value,'$.omp_activity') IS NULL OR json_type(value,'$.omp_activity')='text') AND (json_type(value,'$.output') IS NULL OR json_type(value,'$.output')='text') AND (json_type(value,'$.output_done') IS NULL OR json_type(value,'$.output_done') IN ('true','false')) AND (json_type(value,'$.episode') IS NULL OR json_type(value,'$.episode')='text')"

def valid_sql(+value: String) -> String:
  +quoted = C.q(value)
  +valid = valid_fields_sql()
  "WITH checkpoint(value) AS (VALUES(" ++ quoted ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN " ++ valid ++ " THEN '1' ELSE '0' END ELSE '0' END FROM checkpoint;"

# Quote the complete checkpoint once. Hex columns preserve UTF-8, tabs,
# newlines and empty fields in the SQL row, including the optional activity.
def decode_fields_sql(+value: String) -> String:
  "WITH checkpoint(value) AS (VALUES(" ++ C.q(value) ++ ")) SELECT hex(json_extract(value,'$.guidance_cursor')),hex(json_extract(value,'$.last_message')),hex(json_extract(value,'$.muse_primary')),hex(json_extract(value,'$.muse_current')),hex(json_extract(value,'$.terminal')),hex(json_extract(value,'$.filter_mode')),hex(json_extract(value,'$.codex_log')),hex(json_extract(value,'$.held')),hex(coalesce(json_extract(value,'$.omp_activity'),'')),hex(coalesce(json_extract(value,'$.output'),'')),CASE WHEN json_extract(value,'$.output_done')=1 THEN '1' ELSE '0' END,hex(coalesce(json_extract(value,'$.episode'),'0')) FROM checkpoint;"

def without_query_newline_reversed(+reversed: String, +raw: String) -> String:
  match reversed:
    case SNil{}: ""
    case SCon{c,rest}: Bool.pick(String,Tx.is_nl(c),Tx.str_rev(rest),raw)

def without_query_newline(+raw: String) -> String:
  without_query_newline_reversed(Tx.str_rev(raw),raw)

def decode_field(hex: String) -> IO(String):
  CheckpointCodec.decode_field(hex)

def decode_fields(fields: List<String>) -> IO(State):
  match fields:
    case guidance_hex <> message_hex <> primary_hex <> current_hex <> terminal_hex <> filter_hex <> codex_hex <> held_hex <> activity_hex <> output_hex <> output_done_text <> episode_hex <> Nil{}:
      do IO<State>:
        guidance_cursor : String <- decode_field(guidance_hex)
        last_message : String <- decode_field(message_hex)
        muse_primary : String <- decode_field(primary_hex)
        muse_current : String <- decode_field(current_hex)
        terminal : String <- decode_field(terminal_hex)
        filter_mode : String <- decode_field(filter_hex)
        codex_log : String <- decode_field(codex_hex)
        held : String <- decode_field(held_hex)
        omp_activity : String <- decode_field(activity_hex)
        output : String <- decode_field(output_hex)
        output_done : Bool <- IO.pure(Bool,String.eq(output_done_text,"1"))
        episode : String <- decode_field(episode_hex)
        IO.pure(State,State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,omp_activity,output,output_done,episode})
    case other: IO.die(State,3,"Native observer checkpoint field row is malformed.")

def decode_valid(db: String, value: String) -> IO(State):
  do IO<State>:
    row : String <- IO.try(String,DB.Sql.query(db,decode_fields_sql(value)))
    decode_fields(ContextText.split_tabs(without_query_newline(row)))

# The host state names the custody held by this handle. Monitor custody writes
# reducer state through its separately validated operation.
def monitor_handle(db: String, handle: U32) -> IO(Bool):
  do IO<Bool>:
    facts : String <- IO.try(String,Custody.Instance.state(handle))
    mode : String <- IO.try(String,DB.Sql.query(db,"SELECT json_extract(" ++ C.q(facts) ++ ",'$.observation');"))
    IO.pure(Bool,String.eq(Tx.trim_nl(mode),"monitor"))

def commit_with(monitor: Bool, handle: U32, +saved: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match monitor:
    case True{}: Custody.Instance.monitor_commit(handle,schema_version(),saved)
    case False{}: Custody.Instance.commit(handle,schema_version(),saved)

def commit(db: String, handle: U32, +state: State, enabled: Bool, monitor: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match enabled:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      saved : String <- IO.try(String,DB.Sql.query(db,encode_sql(state)))
      commit_with(monitor,handle,saved)

def reset_nonmonitor(db: String, +handle: U32) -> IO(State):
  do IO<State>:
    reset : Unit <- IO.try(Unit,Custody.Instance.replay(handle))
    committed : Unit <- IO.try(Unit,commit(db,handle,empty(),True{},False{}))
    IO.pure(State,empty())

def empty_checkpoint_outcome(db: String, +handle: U32, monitor: Bool) -> IO(RestoreOutcome):
  match monitor:
    case True{}: IO.pure(RestoreOutcome,Rejected{"Native observer checkpoint state is empty or invalid at its retained cursor."})
    case False{}: do IO<RestoreOutcome>:
      state : State <- reset_nonmonitor(db,handle)
      IO.pure(RestoreOutcome,Restored{state})

def decode_valid_outcome(+db: String, +value: String) -> IO(RestoreOutcome):
  do IO<RestoreOutcome>:
    state : State <- decode_valid(db,value)
    IO.pure(RestoreOutcome,Restored{state})

def decode_invalid(db: String, +handle: U32, monitor: Bool) -> IO(RestoreOutcome):
  match monitor:
    case True{}: IO.pure(RestoreOutcome,Rejected{"Native observer checkpoint state is invalid at its retained cursor."})
    case False{}: empty_checkpoint_outcome(db,handle,monitor)

def decode_nonempty(+db: String, handle: U32, +value: String, monitor: Bool) -> IO(RestoreOutcome):
  do IO<RestoreOutcome>:
    valid : String <- IO.try(String,DB.Sql.query(db,valid_sql(value)))
    Bool.pick(IO(RestoreOutcome),String.eq(Tx.trim_nl(valid),"1"),decode_valid_outcome(db,value),decode_invalid(db,handle,monitor))

def decode_nonempty_choice(db: String, handle: U32, +value: String, monitor: Bool, empty_value: Bool) -> IO(RestoreOutcome):
  match empty_value:
    case True{}: empty_checkpoint_outcome(db,handle,monitor)
    case False{}: decode_nonempty(db,handle,value,monitor)

def decode(db: String, handle: U32, +value: String, monitor: Bool) -> IO(RestoreOutcome):
  decode_nonempty_choice(db,handle,value,monitor,String.is_empty(value))

def restore(db: String, +handle: U32, monitor: Bool) -> IO(RestoreOutcome):
  do IO<RestoreOutcome>:
    saved : String <- IO.try(String,Custody.Instance.restore(handle,schema_version()))
    decode(db,handle,without_query_newline(saved),monitor)

# Keep the materialized held projection for the next iteration only after
# its checkpoint is durable. A failed or skipped checkpoint retains the raw
# span tokens so replay starts from the prior durable cursor.
def held_after_checkpoint(enabled: Bool, +materialized: String, +pending: String, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Fail{error}: pending
    case Done{unit}: Bool.pick(String,enabled,materialized,pending)

def checkpoint_state(+spool: String, +state: State, enabled: Bool) -> IO(State):
  match enabled:
    case False{}: IO.pure(State,state)
    case True{}:
      +final = Bool.or(output_done(state),Bool.not(String.is_empty(terminal(state))))
      Bool.pick(IO(State),final,
        (do IO<State>:
          raw_held : String <- Logs.materialize_held(spool,held(state))
          IO.pure(State,with_held(state,raw_held))),
        IO.pure(State,state))

def commit_with_held(+db: String, handle: U32, +spool: String, +state: State, enabled: Bool, monitor: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match enabled:
    case False{}: commit(db,handle,state,False{},monitor)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      prepared : State <- checkpoint_state(spool,state,True{})
      commit(db,handle,prepared,True{},monitor)

def after_materialized_observation(db: String, handle: U32, +state: State, enabled: Bool, monitor: Bool, observed: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{text}: commit(db,handle,state,enabled,monitor)

def after_observation(db: String, handle: U32, +spool: String, +state: State, enabled: Bool, monitor: Bool, observed: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{text}: commit_with_held(db,handle,spool,state,enabled,monitor)

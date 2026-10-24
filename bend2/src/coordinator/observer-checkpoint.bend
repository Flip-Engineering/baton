import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx
import ../context/text.bend as ContextText
import ../context/request.bend as Request

# Reducer state committed with the host spool cursor for one retained native
# attempt. The host binds the encoded value to its attempt identity and byte
# offset in the same atomic checkpoint record.
type State is Data:
  State{guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String, omp_activity: String, output: String, output_done: Bool, episode: String}

def schema_version() -> U32:
  1

def empty() -> State:
  State{"0\n","","","","","","","","","0",False{},"0"}

def make(guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String) -> State:
  State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held,"","0",False{},"0"}

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

# Held OMP prefixes stay in memory while a message or tool call is active. They
# are included in the next semantic checkpoint, but do not cause a disk write
# for every cumulative progress frame. Restart replays from the prior offset.
def changed_when(enabled: Bool, previous: String, next: String) -> Bool:
  match enabled:
    case False{}: False{}
    case True{}: Bool.not(String.eq(previous,next))

# Turn supplies the payload fields its reducer can change on this frame.
# Cursor, command and filter changes always participate in the decision.
def checkpoint_due_fields(+previous: State, +next: State, message_enabled: Bool, terminal_enabled: Bool, codex_enabled: Bool) -> Bool:
  +episode_changed = Bool.not(String.eq(episode(previous),episode(next)))
  +guidance_changed = Bool.not(String.eq(cursor(previous),cursor(next)))
  +message_changed = changed_when(message_enabled,last_message(previous),last_message(next))
  +output_changed = Bool.not(String.eq(output(previous),output(next)))
  +activity_changed = Bool.not(String.eq(omp_activity(previous),omp_activity(next)))
  +primary_changed = Bool.not(String.eq(muse_primary(previous),muse_primary(next)))
  +current_changed = Bool.not(String.eq(muse_current(previous),muse_current(next)))
  +terminal_changed = changed_when(terminal_enabled,terminal(previous),terminal(next))
  +filter_changed = Bool.not(String.eq(filter_mode(previous),filter_mode(next)))
  +codex_changed = changed_when(codex_enabled,codex_log(previous),codex_log(next))
  Bool.or(episode_changed,Bool.or(output_changed,Bool.or(activity_changed,Bool.or(guidance_changed,Bool.or(message_changed,Bool.or(primary_changed,Bool.or(current_changed,Bool.or(terminal_changed,Bool.or(filter_changed,codex_changed)))))))))

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

# Checkpoint fields retain NUL code points. Other bytes use the existing UTF-8
# decoder, including its pending multi-byte state.
def decode_byte(state: Request.DState, +byte: U32) -> Request.DState:
  match state:
    case Request.DStart{+acc}:
      Bool.pick(Request.DState,U32.is_eq(byte,0),Request.DStart{SCon{Char.from_u32(0),acc}},Request.step_state(Request.DStart{acc},byte))
    case other: Request.step_state(other,byte)

def decode_bytes(bytes: String, +state: Request.DState) -> Request.DState:
  match bytes:
    case SNil{}: state
    case SCon{+head,+tail}: decode_bytes(tail,decode_byte(state,Char.to_u32(head)))

def decode_scalar(scalar: Request.Scalar) -> IO(String):
  match scalar:
    case Request.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,3,"Native observer checkpoint field decode failed: " ++ Request.scalar_reason(other))

def decode_field(hex: String) -> IO(String):
  decode_scalar(Request.state_scalar(decode_bytes(ContextText.hex_decode(hex),Request.DStart{SNil{}})))

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

def reset_empty(handle: U32) -> IO(State):
  do IO<State>:
    reset : Unit <- IO.try(Unit,Custody.Instance.replay(handle))
    IO.pure(State,empty())

def decode_nonempty(+db: String, handle: U32, +value: String) -> IO(State):
  do IO<State>:
    valid : String <- IO.try(String,DB.Sql.query(db,valid_sql(value)))
    Bool.pick(IO(State),String.eq(Tx.trim_nl(valid),"1"),decode_valid(db,value),reset_empty(handle))

def decode(db: String, handle: U32, +value: String) -> IO(State):
  Bool.pick(IO(State),String.is_empty(value),IO.pure(State,empty()),decode_nonempty(db,handle,value))

def restore(db: String, +handle: U32) -> IO(State):
  do IO<State>:
    saved : String <- IO.try(String,Custody.Instance.restore(handle,schema_version()))
    decode(db,handle,without_query_newline(saved))

def commit(db: String, handle: U32, +state: State, enabled: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match enabled:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      saved : String <- IO.try(String,DB.Sql.query(db,encode_sql(state)))
      Custody.Instance.commit(handle,schema_version(),Tx.trim_nl(saved))

def after_observation(db: String, handle: U32, +state: State, enabled: Bool, observed: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match observed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{text}: commit(db,handle,state,enabled)

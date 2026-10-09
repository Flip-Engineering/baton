import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx

# Reducer state committed with the host spool cursor for one retained native
# attempt. The host binds the encoded value to its attempt identity and byte
# offset in the same atomic checkpoint record.
type State is Data:
  State{guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String}

def schema_version() -> U32:
  1

def empty() -> State:
  State{"0\n","","","","","","",""}

def make(guidance_cursor: String, last_message: String, muse_primary: String, muse_current: String, terminal: String, filter_mode: String, codex_log: String, held: String) -> State:
  State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}

def cursor(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: guidance_cursor

def last_message(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: last_message

def muse_primary(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: muse_primary

def muse_current(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: muse_current

def terminal(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: terminal

def filter_mode(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: filter_mode

def codex_log(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: codex_log

def held(state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}: held

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
  +guidance_changed = Bool.not(String.eq(cursor(previous),cursor(next)))
  +message_changed = changed_when(message_enabled,last_message(previous),last_message(next))
  +primary_changed = Bool.not(String.eq(muse_primary(previous),muse_primary(next)))
  +current_changed = Bool.not(String.eq(muse_current(previous),muse_current(next)))
  +terminal_changed = changed_when(terminal_enabled,terminal(previous),terminal(next))
  +filter_changed = Bool.not(String.eq(filter_mode(previous),filter_mode(next)))
  +codex_changed = changed_when(codex_enabled,codex_log(previous),codex_log(next))
  Bool.or(guidance_changed,Bool.or(message_changed,Bool.or(primary_changed,Bool.or(current_changed,Bool.or(terminal_changed,Bool.or(filter_changed,codex_changed))))))

def checkpoint_due(previous: State, next: State) -> Bool:
  checkpoint_due_fields(previous,next,True{},True{},True{})

# SQLite encodes every reducer field as a JSON string, including raw provider
# frames and the newline-delimited held log state.
def encode_sql(+state: State) -> String:
  match state:
    case State{guidance_cursor,last_message,muse_primary,muse_current,terminal,filter_mode,codex_log,held}:
      "SELECT json_object('schema',1,'guidance_cursor'," ++ C.q(guidance_cursor) ++ ",'last_message'," ++ C.q(last_message) ++ ",'muse_primary'," ++ C.q(muse_primary) ++ ",'muse_current'," ++ C.q(muse_current) ++ ",'terminal'," ++ C.q(terminal) ++ ",'filter_mode'," ++ C.q(filter_mode) ++ ",'codex_log'," ++ C.q(codex_log) ++ ",'held'," ++ C.q(held) ++ ");"

def valid_fields_sql() -> String:
  "json_type(value)='object' AND json_type(value,'$.schema')='integer' AND json_extract(value,'$.schema')=1 AND json_type(value,'$.guidance_cursor')='text' AND json_type(value,'$.last_message')='text' AND json_type(value,'$.muse_primary')='text' AND json_type(value,'$.muse_current')='text' AND json_type(value,'$.terminal')='text' AND json_type(value,'$.filter_mode')='text' AND json_type(value,'$.codex_log')='text' AND json_type(value,'$.held')='text'"

def valid_sql(+value: String) -> String:
  +quoted = C.q(value)
  +valid = valid_fields_sql()
  "WITH checkpoint(value) AS (VALUES(" ++ quoted ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN " ++ valid ++ " THEN '1' ELSE '0' END ELSE '0' END FROM checkpoint;"

def field_sql(+value: String, +field: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(value) ++ ") THEN json_extract(" ++ C.q(value) ++ "," ++ C.q("$." ++ field) ++ ") ELSE '' END;"

def without_query_newline_reversed(+reversed: String, +raw: String) -> String:
  match reversed:
    case SNil{}: ""
    case SCon{c,rest}: Bool.pick(String,Tx.is_nl(c),Tx.str_rev(rest),raw)

def without_query_newline(+raw: String) -> String:
  without_query_newline_reversed(Tx.str_rev(raw),raw)

def decode_valid(+db: String, +value: String) -> IO(State):
  do IO<State>:
    guidance_cursor : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"guidance_cursor")))
    last_message : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"last_message")))
    muse_primary : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"muse_primary")))
    muse_current : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"muse_current")))
    terminal : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"terminal")))
    filter_mode : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"filter_mode")))
    codex_log : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"codex_log")))
    held : String <- IO.try(String,DB.Sql.query(db,field_sql(value,"held")))
    IO.pure(State,State{without_query_newline(guidance_cursor),without_query_newline(last_message),without_query_newline(muse_primary),without_query_newline(muse_current),without_query_newline(terminal),without_query_newline(filter_mode),without_query_newline(codex_log),without_query_newline(held)})

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

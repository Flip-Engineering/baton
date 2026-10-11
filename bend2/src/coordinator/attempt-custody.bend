import Base
import ./commands.bend as C
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../git/text.bend as Tx

# Attempt custody records, decoded from the files the running lifecycle already
# writes. The writers are the authority for every format here. host/process-spawn.c
# writes the manifest (BATONRP1 or BATONRP2: magic 8 bytes, then count uint64
# field lengths, then keep_stdin and reserved as four bytes each, then the fields
# in order, the first being the argv in its length-colon-bytes encoding), native.pid
# as text and the acknowledged marker; host/instance.bend frames the checkpoint as
# BATONC03 around the schema-1 JSON that observer-checkpoint.bend encodes, whose
# first field after schema is guidance_cursor. The admission and lifecycle records
# are read through the custody host's own projection, Instance.state, whose JSON
# keys the host builds from those records in br_instance_state_call.

# The runtime identity is argv element zero of the recorded manifest: the binary
# path the attempt was admitted with. The manifest header occupies 8 + 8*count +
# 8 characters, and count is 6 or 8, so the argv field begins at byte 64 for
# either version. A file the reader refuses, including for its binary header
# bytes, is an absent identity, reported as an empty string.
def manifest_identity(directory: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- IO.try(String,T.Text.read(directory ++ "/manifest"))
    manifest_identity_read(read)

def manifest_identity_read(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{error}: IO.pure(String,"")
    case Done{+text}: manifest_argv_element(custody_drop(text,64))

# One length-colon-bytes element: a decimal character count, a colon, then that
# many characters. A malformed element is an absent identity.
def manifest_argv_element(rest: String) -> IO(String):
  manifest_argv_take(custody_digits(rest,0,False{}),rest)

def manifest_argv_take(count: Maybe<U32>, rest: String) -> IO(String):
  match count:
    case None{}: IO.pure(String,"")
    case Some{n}: manifest_argv_value(custody_take(custody_drop_colon(rest),0,n,""))

def manifest_argv_value(taken: Maybe<String>) -> IO(String):
  match taken:
    case None{}: IO.pure(String,"")
    case Some{value}: IO.pure(String,value)

def custody_drop(text: String, count: U32) -> String:
  custody_drop_step(text,count,U32.is_lt(count,1))

def custody_drop_step(text: String, count: U32, more: Bool) -> String:
  match more:
    case False{}: text
    case True{}: custody_drop_more(text,count)

def custody_drop_more(text: String, count: U32) -> String:
  match text:
    case SNil{}: SNil{}
    case SCon{c,rest}: custody_drop(rest,(count - 1 : U32))

# The characters up to and including the next colon are the length prefix; the
# colon is consumed with it.
def custody_drop_colon(rest: String) -> String:
  match rest:
    case SNil{}: SNil{}
    case SCon{c,more}: custody_colon_step(String.eq(Tx.one_char(c),":"),more)

def custody_colon_step(colon: Bool, more: String) -> String:
  match colon:
    case True{}: more
    case False{}: custody_drop_colon(more)

# A decimal character count up to the next colon, range checked as it
# accumulates.
def custody_digits(rest: String, value: U32, seen: Bool) -> Maybe<U32>:
  match rest:
    case SNil{}: custody_seen(seen,value)
    case SCon{c,more}: custody_digits_step(String.eq(Tx.one_char(c),":"),c,more,value,seen)

def custody_seen(seen: Bool, value: U32) -> Maybe<U32>:
  match seen:
    case True{}: Some{value}
    case False{}: None{}

def custody_digits_step(colon: Bool, c: Char, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match colon:
    case True{}: custody_seen(seen,value)
    case False{}: custody_digit(custody_digit_value(c),more,value,seen)

def custody_digit_value(c: Char) -> Maybe<U32>:
  match c:
    case '0': Some{0}
    case '1': Some{1}
    case '2': Some{2}
    case '3': Some{3}
    case '4': Some{4}
    case '5': Some{5}
    case '6': Some{6}
    case '7': Some{7}
    case '8': Some{8}
    case '9': Some{9}
    case other: None{}

def custody_digit(digit: Maybe<U32>, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match digit:
    case None{}: None{}
    case Some{d}: custody_fit(U32.is_lt(value,429496730),d,more,value,seen)

def custody_fit(room: Bool, d: U32, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match room:
    case False{}: None{}
    case True{}: custody_digits(more,((value * 10 + d) : U32),True{})

# Exactly the declared number of characters.
def custody_take(rest: String, count: U32, target: U32, seen: String) -> Maybe<String>:
  custody_take_step(U32.is_lt(count,target),count,target,rest,seen)

def custody_take_step(short: Bool, count: U32, target: U32, rest: String, seen: String) -> Maybe<String>:
  match short:
    case False{}: Some{seen}
    case True{}: custody_take_more(count,target,rest,seen)

def custody_take_more(count: U32, target: U32, rest: String, seen: String) -> Maybe<String>:
  match rest:
    case SNil{}: None{}
    case SCon{c,more}: custody_take((count + 1 : U32),target,more,seen ++ Tx.one_char(c))

# The release directory name: the path segment two levels above the binary, so a
# release path like releases/1.1.0-fca7af87/bin/baton2 yields 1.1.0-fca7af87 and
# the source pin is read from it. This one derivation is the shared shape for
# every surface that names the runtime identity.
def release_segment(path: String) -> String:
  release_scan(path,"","")

def release_scan(rest: String, previous: String, current: String) -> String:
  match rest:
    case SNil{}: previous
    case SCon{c,more}: release_step(String.eq(Tx.one_char(c),"/"),c,more,previous,current)

def release_step(slash: Bool, c: Char, more: String, previous: String, current: String) -> String:
  match slash:
    case True{}: release_scan(more,current,"")
    case False{}: release_scan(more,previous,current ++ Tx.one_char(c))

# The recorded pid is text in native.pid. It is a recorded value only; it is
# never presented as evidence that a process is alive.
def recorded_pid(directory: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- IO.try(String,T.Text.read(directory ++ "/native.pid"))
    recorded_pid_read(read)

def recorded_pid_read(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{error}: IO.pure(String,"")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

# The acknowledged marker is present when the reader can read it.
def acknowledged(directory: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- IO.try(String,T.Text.read(directory ++ "/acknowledged"))
    acknowledged_read(read)

def acknowledged_read(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{error}: IO.pure(String,"false")
    case Done{+text}: IO.pure(String,"true")

# The input-consumption boundary: the guidance cursor of the attempt's
# checkpoint, restored through the custody host exactly as the turn path
# restores it, and read only at $.guidance_cursor. The last_message field of the
# same record is deliberately not read.
def checkpoint_cursor(db: String, directory: String) -> IO(String):
  do IO<String>:
    attached : Result<&1,&1,U32 & String,U32> <- IO.try(U32,Custody.Instance.attach(db,directory))
    checkpoint_attached(db,attached)

def checkpoint_attached(db: String, attached: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match attached:
    case Fail{error}: IO.pure(String,"")
    case Done{+handle}: do IO<String>:
      saved : Result<&1,&1,U32 & String,String> <- IO.try(String,Custody.Instance.restore(handle,1))
      checkpoint_extract(db,saved)

def checkpoint_extract(db: String, saved: Result<&1,&1,U32 & String,String>) -> IO(String):
  match saved:
    case Fail{error}: IO.pure(String,"")
    case Done{+body}: do IO<String>:
      extracted : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.query(db,"WITH checkpoint(value) AS (VALUES(" ++ C.q(body) ++ ")) SELECT coalesce(CASE WHEN json_valid(value) THEN json_extract(value,'$.guidance_cursor') END,'') FROM checkpoint;"))
      checkpoint_read(extracted)

def checkpoint_read(extracted: Result<&1,&1,U32 & String,String>) -> IO(String):
  match extracted:
    case Fail{error}: IO.pure(String,"")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

# The recorded host lifecycle facts for one attempt, read through the custody
# host's own projection rather than by parsing the binary record. Instance.state
# returns one JSON object the host builds in br_instance_state_call, whose keys
# come from the durable lifecycle record and the process observation: the state
# token from br_lifecycle_state, spawn_latched, cancelled and observer_ready from
# the record's own latch words, the recorded native pid, and whether its exit
# status is known. An attach refusal, a refused state read and a body that is not
# the host's JSON are three explicit outcomes, never silent defaults.
def custody_lifecycle(db: String, directory: String) -> IO(String):
  do IO<String>:
    attached : Result<&1,&1,U32 & String,U32> <- IO.try(U32,Custody.Instance.attach(db,directory))
    lifecycle_attached(db,attached)

def lifecycle_attached(db: String, attached: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match attached:
    case Fail{error}: IO.pure(String,"{\"lifecycleState\":\"unavailable\"}")
    case Done{+handle}: do IO<String>:
      stated : Result<&1,&1,U32 & String,String> <- IO.try(String,Custody.Instance.state(handle))
      lifecycle_extract(db,stated)

def lifecycle_extract(db: String, stated: Result<&1,&1,U32 & String,String>) -> IO(String):
  match stated:
    case Fail{error}: IO.pure(String,"{\"lifecycleState\":\"transport\"}")
    case Done{+body}: do IO<String>:
      extracted : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.query(db,"WITH state(value) AS (VALUES(" ++ C.q(body) ++ ")) SELECT CASE WHEN json_valid(value) THEN json_object('lifecycleState',json_extract(value,'$.state'),'spawnLatched',json_extract(value,'$.spawn_latched'),'cancelled',json_extract(value,'$.cancelled'),'observerReady',json_extract(value,'$.observer_ready'),'recordedPid',json_extract(value,'$.native_pid'),'statusKnown',json_extract(value,'$.status_known'),'status',json_extract(value,'$.status')) ELSE json_object('lifecycleState','corrupt') END FROM state;"))
      lifecycle_read(extracted)

def lifecycle_read(extracted: Result<&1,&1,U32 & String,String>) -> IO(String):
  match extracted:
    case Fail{error}: IO.pure(String,"{\"lifecycleState\":\"corrupt\"}")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

# The composing read for one session's recorded attempt. The directory comes from
# the executions row, which is the session's recorded attempt pointer; every
# custody fact here describes that recorded attempt and none of them claims a
# process is active. This function lives beside the decoder rather than in
# commands.bend because commands.bend holds no imports of it and must not gain
# one: the projection SQL there stays pure.
def custody_facts(db: String, session: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.read(db,"SELECT coalesce(directory,'') FROM executions WHERE session=" ++ C.q(session) ++ ";"))
    custody_directory(found,db)

def custody_directory(found: Result<&1,&1,U32 & String,String>, db: String) -> IO(String):
  match found:
    case Fail{error}: IO.pure(String,"{}")
    case Done{+text}: custody_recorded(db,Tx.trim_nl(text))

def custody_recorded(db: String, directory: String) -> IO(String):
  match String.is_empty(directory):
    case True{}: IO.pure(String,"{}")
    case False{}: do IO<String>:
      binary : String <- manifest_identity(directory)
      pid : String <- recorded_pid(directory)
      marker : String <- acknowledged(directory)
      cursor : String <- checkpoint_cursor(db,directory)
      lifecycle : String <- custody_lifecycle(db,directory)
      +release : String <- IO.pure(String,release_segment(binary))
      rendered : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.query(db,"SELECT json_object('binaryPath'," ++ C.q(binary) ++ ",'release'," ++ C.q(release) ++ ",'recordedPid'," ++ C.q(pid) ++ ",'acknowledged',json(" ++ marker ++ "),'guidanceCursor'," ++ C.q(cursor) ++ ",'lifecycle',json(" ++ lifecycle ++ "));"))
      custody_rendered(rendered)

def custody_rendered(rendered: Result<&1,&1,U32 & String,String>) -> IO(String):
  match rendered:
    case Fail{error}: IO.pure(String,"{}")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

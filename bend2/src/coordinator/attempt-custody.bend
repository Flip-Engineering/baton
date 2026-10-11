import Base
import ./commands.bend as C
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../git/text.bend as Tx

# Attempt custody facts, read through the custody host's passive reference. The
# public read path never joins an attempt's observation owner and never positions
# a reader: Instance.job queries the owner socket read-only and reads the
# retained files, and its JSON carries the facts this projection surfaces — the
# admitted binary path as argv element zero of the manifest, the lifecycle token
# with its spawn_latched, cancelled and observer_ready latch words, the
# checkpoint's guidance cursor from the verified state bytes, and the validated
# checkpoint offset, which stays distinct from the application cursor. The
# recorded pid and the acknowledged marker come from their retained files as
# text. A refused job read and a body that is not the host's JSON are explicit
# outcomes, never silent defaults.

# The binary path of the recorded attempt, taken from the passive reference's
# argv0 field. An absent field is an empty path, and the composing read labels
# the manifest record unreadable, which is also the outcome of the retained text
# copy when the reader refuses its binary header.
def job_argv0(db: String, body: String) -> IO(String):
  do IO<String>:
    extracted : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.query(db,"WITH job(value) AS (VALUES(" ++ C.q(body) ++ ")) SELECT coalesce(CASE WHEN json_valid(value) THEN json_extract(value,'$.argv0') END,'') FROM job;"))
    job_argv0_read(extracted)

def job_argv0_read(extracted: Result<&1,&1,U32 & String,String>) -> IO(String):
  match extracted:
    case Fail{error}: IO.pure(String,"")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

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

# The release directory name, derived from the actual layout
# releases/<segment>/bin/<name>: the segment is two path components above the
# binary name, one past the bin component, so releases/1.1.0-fca7af87/bin/baton2
# yields 1.1.0-fca7af87 and the source pin is read from it. This one derivation is
# the shared shape for every surface that names the runtime identity.
def release_segment(path: String) -> String:
  release_scan(path,"","")

def release_scan(rest: String, two_back: String, one_back: String) -> String:
  match rest:
    case SNil{}: two_back
    case SCon{c,more}: release_step(String.eq(Tx.one_char(c),"/"),c,more,two_back,one_back)

def release_step(slash: Bool, c: Char, more: String, two_back: String, one_back: String) -> String:
  match slash:
    case True{}: release_scan(more,one_back,"")
    case False{}: release_scan(more,two_back,one_back ++ Tx.one_char(c))

# The composing read for one session's recorded attempt. The directory comes from
# the executions row, which is the session's recorded attempt pointer; every
# custody fact here describes that recorded attempt and none of them claims a
# process is active. A refused passive read renders jobRead unavailable, and a
# body that is not the host's JSON renders jobRead corrupt.
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
      job : Result<&1,&1,U32 & String,String> <- IO.try(String,Custody.Instance.job(db,directory))
      pid : String <- recorded_pid(directory)
      marker : String <- acknowledged(directory)
      custody_job(db,job,pid,marker)

def custody_job(db: String, job: Result<&1,&1,U32 & String,String>, pid: String, marker: String) -> IO(String):
  match job:
    case Fail{error}: IO.pure(String,"{\"jobRead\":\"unavailable\"}")
    case Done{+body}: do IO<String>:
      binary : String <- job_argv0(db,body)
      custody_render(db,body,binary,pid,marker)

def custody_render(db: String, body: String, binary: String, pid: String, marker: String) -> IO(String):
  do IO<String>:
    +release : String <- IO.pure(String,release_segment(binary))
    rendered : Result<&1,&1,U32 & String,String> <- IO.try(String,DB.Sql.query(db,"WITH job(value) AS (VALUES(" ++ C.q(body) ++ ")) SELECT CASE WHEN json_valid(value) THEN json_object('jobRead','read','binaryPath',coalesce(json_extract(value,'$.argv0'),''),'manifestRead',CASE WHEN coalesce(json_extract(value,'$.argv0'),'')='' THEN 'unreadable-record' ELSE 'read' END,'release'," ++ C.q(release) ++ ",'recordedPid'," ++ C.q(pid) ++ ",'acknowledged',json(" ++ marker ++ "),'guidanceCursor',coalesce(json_extract(value,'$.guidance_cursor'),''),'checkpointOffset',coalesce(json_extract(value,'$.checkpoint_offset'),0),'checkpointVerified',coalesce(json_extract(value,'$.checkpoint_verified'),json('false')),'lifecycleState',coalesce(json_extract(value,'$.lifecycle_state'),''),'spawnLatched',coalesce(json_extract(value,'$.spawn_latched'),json('false')),'cancelled',coalesce(json_extract(value,'$.cancelled'),json('false')),'observerReady',coalesce(json_extract(value,'$.observer_ready'),json('false'))) ELSE json_object('jobRead','corrupt') END FROM job;"))
    custody_rendered(rendered)

def custody_rendered(rendered: Result<&1,&1,U32 & String,String>) -> IO(String):
  match rendered:
    case Fail{error}: IO.pure(String,"{\"jobRead\":\"corrupt\"}")
    case Done{+text}: IO.pure(String,Tx.trim_nl(text))

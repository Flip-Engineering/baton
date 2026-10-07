# The optional read-only Orchestra live view (#682). `view SUBJECT [READER [PORT]]`
# starts the packaged Node server bound to loopback under one immutable reader
# identity, prints the URL, tries to open a browser, and serves until this command
# exits. The server reads only committed coordinator state through the native_changes
# projection; it never writes to the database.
import Base
import ../host/text.bend as T
import ../host/process.bend as P
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx

def drop_to_slash(s: String) -> Maybe<String>:
  match s:
    case SNil{}: None{}
    case SCon{+head, +tail}:
      Bool.pick(Maybe<String>,Char.is_eq(head,Char.from_u32(47)),Some{tail},drop_to_slash(tail))

# The text before the last '/' of a path; the executable's install directory.
# Matches scrutinize parameters, so computed values get their own defs.
def directory_of_rev(rev: Maybe<String>) -> Maybe<String>:
  match rev:
    case None{}: None{}
    case Some{+rest}: Some{Tx.str_rev(rest)}

def directory_of(path: String) -> Maybe<String>:
  directory_of_rev(drop_to_slash(Tx.str_rev(path)))

law directory_of_keeps_the_text_before_the_last_slash:
  {directory_of("/usr/local/bin/baton2") == Some{"/usr/local/bin"} : Maybe<String>}

def directory_of_keeps_the_text_before_the_last_slash():
  {==}

law directory_of_a_bare_name_is_empty:
  {directory_of("baton2") == None{} : Maybe<String>}

def directory_of_a_bare_name_is_empty():
  {==}

# Installed payload first, source checkout second, matching Control.identity.
# Bend binds names in order, so resolution is unrolled over the two candidates.
def installed_candidate(dir: Maybe<String>) -> String:
  match dir:
    case None{}: ""
    case Some{+parent}: parent ++ "/../libexec/baton2/ui/server.mjs"

def source_candidate(dir: Maybe<String>) -> String:
  match dir:
    case None{}: ""
    case Some{+parent}: parent ++ "/../../bend2/ui/orchestra/server.mjs"

def resolve_source(source: Result<&1,&1,U32 & String,String>) -> IO(String):
  match source:
    case Done{+path}: IO.pure(String,path)
    case Fail{error}:
      IO.die(String,2,"The Orchestra view server is not installed; expected libexec/baton2/ui/server.mjs beside the baton2 executable or bend2/ui/orchestra/server.mjs in a source checkout.")

def resolve_choice(installed: Result<&1,&1,U32 & String,String>, source: Result<&1,&1,U32 & String,String>) -> IO(String):
  match installed:
    case Done{+path}: IO.pure(String,path)
    case Fail{error}: resolve_source(source)

def resolve_server(+executable: String) -> IO(String):
  do IO<String>:
    installed_path : String <- IO.pure(String,installed_candidate(directory_of(executable)))
    source_path : String <- IO.pure(String,source_candidate(directory_of(executable)))
    installed : Result<&1,&1,U32 & String,String> <- Host.Control.command(installed_path)
    source : Result<&1,&1,U32 & String,String> <- Host.Control.command(source_path)
    resolve_choice(installed,source)

def error_text(error: U32 & String) -> String:
  (code,text) = error
  text

def open_fallback_result(opened: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match opened:
    case Done{+text}: IO.pure(Unit,Unit{})
    case Fail{error}: IO.write("No browser opener answered; visit the URL above in a browser.\n")

def open_fallback(db: String, +url: String) -> IO(Unit):
  do IO<Unit>:
    opened : Result<&1,&1,U32 & String,String> <- Host.Control.launch(Tx.enc_argv(["xdg-open",url]),db,"view-open")
    open_fallback_result(opened)

def open_result(db: String, url: String, opened: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match opened:
    case Done{+text}: IO.pure(Unit,Unit{})
    case Fail{error}: open_fallback(db,url)

def open_browser(db: String, +url: String) -> IO(Unit):
  do IO<Unit>:
    opened : Result<&1,&1,U32 & String,String> <- Host.Control.launch(Tx.enc_argv(["open",url]),db,"view-open")
    open_result(db,url,opened)

def finish(status: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match status:
    case Done{+text}: IO.write("Orchestra live view server exited: " ++ text)
    case Fail{+error}: IO.die(Unit,2,"The view server wait failed: " ++ error_text(error))

def serving(db: String, reader: String, +url: String, handle: U32, line: String) -> IO(Unit):
  do IO<Unit>:
    IO.write("Orchestra live view: " ++ url ++ "\n")
    IO.write("Reader " ++ reader ++ "; read-only recorded coordinator state; the reader's admitted scope applies. Serving until this command exits (Ctrl-C stops it).\n")
    IO.write("Server: " ++ line)
    opened : Unit <- open_browser(db,url)
    status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    finish(status)

def serve(db: String, reader: String, url: String, handle: U32, first: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Unit):
  match first:
    case Fail{+error}:
      IO.die(Unit,2,"The view server address could not be read: " ++ error_text(error) ++ " See " ++ db ++ ".view.stderr.")
    case Done{None{}}:
      IO.die(Unit,2,"The view server exited before reporting its address; the port may be in use. Pass another PORT. See " ++ db ++ ".view.stderr.")
    case Done{Some{+line}}:
      serving(db,reader,url,handle,line)

def run_started(db: String, reader: String, url: String, spawned: Result<&1,&1,U32 & String,U32>) -> IO(Unit):
  match spawned:
    case Fail{+error}:
      IO.die(Unit,2,"The view server could not start: " ++ error_text(error))
    case Done{+handle}:
      do IO<Unit>:
        first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        serve(db,reader,url,handle,first)

def run_body(db: String, subject: String, reader: String, port: String, canonical: String) -> IO(Unit):
  do IO<Unit>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    node : String <- IO.try(String,Host.Control.command("node"))
    server : String <- resolve_server(executable)
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(P.argv([node,server,"--database",canonical,"--reader",reader,"--subject",subject,"--host","127.0.0.1","--port",port]),".",canonical ++ ".view.stderr")
    run_started(canonical,reader,"http://127.0.0.1:" ++ port ++ "/",spawned)

def run(db: String, subject: String, reader: String, port: String) -> IO(Unit):
  do IO<Unit>:
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    run_body(db,subject,reader,port,canonical)

# The entry serves the canonical database under the declared reader: it resolves the
# installed server beside the executable, spawns it bound to loopback with the durable
# database path, and serves until the server exits.
law view_run_serves_the_canonical_database_under_the_declared_reader:
  for db: String
  for subject: String
  for reader: String
  for port: String
  {run(db,subject,reader,port) == (do IO<Unit>:
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    run_body(db,subject,reader,port,canonical)) : IO(Unit)}

def view_run_serves_the_canonical_database_under_the_declared_reader(db,subject,reader,port):
  {==}

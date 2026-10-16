import Base

def SessionLock.release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def SessionLock.try_acquire(database: String, session: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  import "./process-spawn.c"

# A serve task waits for the current session owner to release its physical lock.
def SessionLock.wait_acquire(database: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# Replaces the selected observer after recorded native exit and returns its
# session lock and attached attempt. The retained checkpoint stays intact.
def SessionLock.recover_observer(database: String, session: String, directory: String, observer: U32) -> IO(Result<&1,&1,U32 & String,U32 & U32>):
  import "./process-spawn.c"

def SessionLock.executable() -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

def SessionLock.canonical(database: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

# Receive and direct turns acquire ownership under the same physical database and session identity.
def SessionLock.acquire_session(-A: Type, database: String, session: String, next: @+canonical: String -> Maybe<U32> -> IO(A)) -> IO(A):
  do IO<A>:
    +canonical : String <- IO.try(String,SessionLock.canonical(database))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,SessionLock.try_acquire(canonical,session))
    next(canonical,lock)

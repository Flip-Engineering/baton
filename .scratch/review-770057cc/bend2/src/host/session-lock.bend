import Base

def SessionLock.release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./session-lock.c"

def SessionLock.try_acquire(database: String, session: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  import "./session-lock.c"

def SessionLock.executable() -> IO(Result<&1,&1,U32 & String,String>):
  import "./session-lock.c"

def SessionLock.canonical(database: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./session-lock.c"

# Receive and direct turns acquire ownership under the same canonical identity.
def SessionLock.acquire_session(-A: Type, database: String, session: String, next: @+canonical: String -> Maybe<U32> -> IO(A)) -> IO(A):
  do IO<A>:
    +canonical : String <- IO.try(String,SessionLock.canonical(database))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,SessionLock.try_acquire(canonical,session))
    next(canonical,lock)

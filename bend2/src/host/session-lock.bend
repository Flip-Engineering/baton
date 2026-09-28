import Base

def SessionLock.acquire(database: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./session-lock.c"

def SessionLock.release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./session-lock.c"

def SessionLock.try_acquire(database: String, session: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32>>):
  import "./session-lock.c"

def SessionLock.executable() -> IO(Result<&1,&1,U32 & String,String>):
  import "./session-lock.c"

def SessionLock.canonical(database: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./session-lock.c"

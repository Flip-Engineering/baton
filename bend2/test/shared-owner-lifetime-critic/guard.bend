import Base
import ../../src/host/session-lock.bend as Lock

def finish(label: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.print(label ++ ":busy")
    case Some{handle}: do IO<Unit>:
      printed : Unit <- IO.print(label ++ ":acquired")
      IO.try(Unit,Lock.SessionLock.release(handle))

def first(alias: String, canonical: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Fresh fixture guard was busy.")
    case Some{handle}: do IO<Unit>:
      second : Unit <- Lock.SessionLock.acquire_session(Unit,alias,"player",path => other => finish("same-session",other))
      sibling : Unit <- Lock.SessionLock.acquire_session(Unit,canonical,"sibling",path => other => finish("other-session",other))
      IO.try(Unit,Lock.SessionLock.release(handle))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{database,Con{alias,Nil{}}}:
      Lock.SessionLock.acquire_session(Unit,database,"player",canonical => lock => first(alias,canonical,lock))
    case other: IO.die(Unit,2,"Expected database and alias paths.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)

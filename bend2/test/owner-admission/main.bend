import Base
import ../../src/coordinator/owner-admission.bend as A

def show(decision: A.Decision) -> String:
  match decision:
    case A.Fresh{}: "fresh"
    case A.Replay{attempt}: "replay:" ++ attempt
    case A.Conflict{}: "conflict"
    case A.Invalid{}: "invalid"

def record(stored: String, attempt: String) -> Maybe<A.Record>:
  match stored:
    case "absent": None{}
    case other: Some{A.Recorded{A.Identity{"db","request","session","receive","input"},attempt}}

def run(db: String, request: String, session: String, operation: String, payload: String, stored: String, attempt: String) -> IO(Unit):
  IO.print(show(A.decide(A.Identity{db,request,session,operation,payload},record(stored,attempt))))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{db,Con{request,Con{session,Con{operation,Con{payload,Con{stored,Con{attempt,Nil{}}}}}}}}:
      run(db,request,session,operation,payload,stored,attempt)
    case other: IO.die(Unit,2,"Expected database, request, session, operation, payload, stored state and attempt.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)

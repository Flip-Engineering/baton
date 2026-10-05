import Base

# Inputs are canonical command bytes and a qualified database binding supplied
# by the caller. This module decides replay; the caller owns atomic persistence.
type Request is Data:
  Identity{database: String, request: String, session: String, operation: String, payload: String}

type Record is Data:
  Recorded{identity: Request, attempt: String}

type Decision is Data:
  Fresh{}
  Replay{attempt: String}
  Conflict{}
  Invalid{}

def valid(identity: Request) -> Bool:
  match identity:
    case Identity{database,request,session,operation,payload}:
      Bool.and(Bool.not(String.is_empty(database)),
        Bool.and(Bool.not(String.is_empty(request)),
          Bool.and(Bool.not(String.is_empty(session)),Bool.not(String.is_empty(operation)))))

def same(left: Request, right: Request) -> Bool:
  match left:
    case Identity{db,request,session,operation,payload}:
      match right:
        case Identity{other_db,other_request,other_session,other_operation,other_payload}:
          Bool.and(String.eq(db,other_db),
            Bool.and(String.eq(request,other_request),
              Bool.and(String.eq(session,other_session),
                Bool.and(String.eq(operation,other_operation),String.eq(payload,other_payload)))))

def replay(attempt: String, matches: Bool) -> Decision:
  match matches:
    case False{}: Conflict{}
    case True{}: Replay{attempt}

def recorded(expected: Request, existing: Request, +attempt: String, usable: Bool) -> Decision:
  match usable:
    case False{}: Invalid{}
    case True{}: replay(attempt,same(expected,existing))

def present(expected: Request, stored: Maybe<Record>) -> Decision:
  match stored:
    case None{}: Fresh{}
    case Some{Recorded{existing,+attempt}}:
      recorded(expected,existing,attempt,Bool.not(String.is_empty(attempt)))

def checked(expected: Request, stored: Maybe<Record>, usable: Bool) -> Decision:
  match usable:
    case False{}: Invalid{}
    case True{}: present(expected,stored)

# Owner-process identity is deliberately outside the durable request identity.
# A replacement owner revalidates storage authority before calling this function.
def decide(+expected: Request, stored: Maybe<Record>) -> Decision:
  checked(expected,stored,valid(expected))

law absent_request_requires_new_admission:
  {decide(Identity{"db","request","session","receive","input"},None{}) == Fresh{} : Decision}

def absent_request_requires_new_admission():
  {==}

law identical_retry_preserves_original_attempt:
  for attempt: String
  {replay(attempt,True{}) == Replay{attempt} : Decision}

def identical_retry_preserves_original_attempt(attempt):
  {==}

law committed_request_replays_original_attempt:
  {decide(Identity{"db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Replay{"attempt-a"} : Decision}

def committed_request_replays_original_attempt():
  {==}

law changed_payload_refuses_request_reuse:
  {decide(Identity{"db","request","session","receive","changed"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Conflict{} : Decision}

def changed_payload_refuses_request_reuse():
  {==}

law changed_database_refuses_request_reuse:
  {decide(Identity{"other-db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Conflict{} : Decision}

def changed_database_refuses_request_reuse():
  {==}

law missing_attempt_does_not_authorize_new_grant:
  {decide(Identity{"db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},""}}) == Invalid{} : Decision}

def missing_attempt_does_not_authorize_new_grant():
  {==}

law missing_request_is_refused:
  {decide(Identity{"db","","session","receive","input"},None{}) == Invalid{} : Decision}

def missing_request_is_refused():
  {==}

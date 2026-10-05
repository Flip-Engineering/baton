import Base

# Inputs are canonical command bytes and a qualified database binding supplied
# by the caller. This module decides replay; the caller owns atomic persistence.
type Request is Data:
  Identity{database: String, request: String, session: String, operation: String, payload: String}

type Record is Data:
  Recorded{identity: Request, attempt: String}

type Field is Data:
  DatabaseField{}
  RequestField{}
  SessionField{}
  OperationField{}
  PayloadField{}
  AttemptField{}

type Decision is Data:
  Fresh{}
  Replay{attempt: String}
  Conflict{attempt: String, field: Field}
  Invalid{field: Field}

def first(field: Field, differs: Bool, rest: Maybe<Field>) -> Maybe<Field>:
  match differs:
    case True{}: Some{field}
    case False{}: rest

def missing(identity: Request) -> Maybe<Field>:
  match identity:
    case Identity{database,request,session,operation,payload}:
      first(DatabaseField{},String.is_empty(database),
        first(RequestField{},String.is_empty(request),
          first(SessionField{},String.is_empty(session),
            first(OperationField{},String.is_empty(operation),None{}))))

def difference(left: Request, right: Request) -> Maybe<Field>:
  match left:
    case Identity{db,request,session,operation,payload}:
      match right:
        case Identity{other_db,other_request,other_session,other_operation,other_payload}:
          first(DatabaseField{},Bool.not(String.eq(db,other_db)),
            first(RequestField{},Bool.not(String.eq(request,other_request)),
              first(SessionField{},Bool.not(String.eq(session,other_session)),
                first(OperationField{},Bool.not(String.eq(operation,other_operation)),
                  first(PayloadField{},Bool.not(String.eq(payload,other_payload)),None{})))))

def replay(attempt: String, mismatch: Maybe<Field>) -> Decision:
  match mismatch:
    case Some{field}: Conflict{attempt,field}
    case None{}: Replay{attempt}

def recorded(expected: Request, existing: Request, +attempt: String, usable: Bool) -> Decision:
  match usable:
    case False{}: Invalid{AttemptField{}}
    case True{}: replay(attempt,difference(expected,existing))

def present(expected: Request, stored: Maybe<Record>) -> Decision:
  match stored:
    case None{}: Fresh{}
    case Some{Recorded{existing,+attempt}}:
      recorded(expected,existing,attempt,Bool.not(String.is_empty(attempt)))

def checked(expected: Request, stored: Maybe<Record>, absent: Maybe<Field>) -> Decision:
  match absent:
    case Some{field}: Invalid{field}
    case None{}: present(expected,stored)

# Owner-process identity is deliberately outside the durable request identity.
# A replacement owner revalidates storage authority before calling this function.
def decide(+expected: Request, stored: Maybe<Record>) -> Decision:
  checked(expected,stored,missing(expected))

law absent_request_requires_new_admission:
  {decide(Identity{"db","request","session","receive","input"},None{}) == Fresh{} : Decision}

def absent_request_requires_new_admission():
  {==}

law identical_retry_preserves_original_attempt:
  for attempt: String
  {replay(attempt,None{}) == Replay{attempt} : Decision}

def identical_retry_preserves_original_attempt(attempt):
  {==}

law conflict_preserves_attempt_and_field:
  for attempt: String
  for field: Field
  {replay(attempt,Some{field}) == Conflict{attempt,field} : Decision}

def conflict_preserves_attempt_and_field(attempt,field):
  {==}

law committed_request_replays_original_attempt:
  {decide(Identity{"db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Replay{"attempt-a"} : Decision}

def committed_request_replays_original_attempt():
  {==}

law changed_payload_refuses_request_reuse:
  {decide(Identity{"db","request","session","receive","changed"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Conflict{"attempt-a",PayloadField{}} : Decision}

def changed_payload_refuses_request_reuse():
  {==}

law changed_database_refuses_request_reuse:
  {decide(Identity{"other-db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},"attempt-a"}}) == Conflict{"attempt-a",DatabaseField{}} : Decision}

def changed_database_refuses_request_reuse():
  {==}

law missing_attempt_does_not_authorize_new_grant:
  {decide(Identity{"db","request","session","receive","input"},Some{Recorded{Identity{"db","request","session","receive","input"},""}}) == Invalid{AttemptField{}} : Decision}

def missing_attempt_does_not_authorize_new_grant():
  {==}

law missing_request_is_refused:
  {decide(Identity{"db","","session","receive","input"},None{}) == Invalid{RequestField{}} : Decision}

def missing_request_is_refused():
  {==}

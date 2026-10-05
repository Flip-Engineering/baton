import Base

# The binding and owner are correlation values issued by the qualified caller.
# Comparing them does not qualify a SQL connection or authorize a host effect.
type Correlation is Data:
  Correlation{database: String, owner: String, request: String, session: String}

type CapturedInput is Data:
  UnusedInput{}
  InputBytes{bytes: String}

type CapturedFile is Data:
  CapturedFile{argument: String, resolved: String, bytes: String}

# The client supplies literal argv and already captured invocation input.
# File/stdin capture, path resolution and canonical encoding belong to callers.
type InvocationContext is Type:
  Invocation{cwd: String, argv: List<String>, stdin: CapturedInput, files: List<CapturedFile>}

type ReceiveRequest is Type:
  ReceiveRequest{version: U32, correlation: Correlation, invocation: InvocationContext, command: String, model: String, effort: String, workspace: String, log: String, wake: Maybe<String>}

# A sink reference is resolved by the owner under the full correlation.
# No client-supplied process-local child or descriptor index is carried here.
type RequestOutput is Data:
  RequestOutput{correlation: Correlation, reference: String}

type Stream is Data:
  Stdout{}
  Stderr{}

type OutputFrame is Data:
  OutputFrame{correlation: Correlation, stream: Stream, cursor: String, bytes: String}

# Both outcomes retain the original frame. The caller owns ordered delivery,
# disconnect handling and durable output retention after owner acceptance.
type OutputRoute is Data:
  Matched{frame: OutputFrame}
  Mismatched{frame: OutputFrame}

def same(left: Correlation, right: Correlation) -> Bool:
  match left:
    case Correlation{database,owner,request,session}:
      match right:
        case Correlation{other_database,other_owner,other_request,other_session}:
          Bool.and(String.eq(database,other_database),
            Bool.and(String.eq(owner,other_owner),
              Bool.and(String.eq(request,other_request),String.eq(session,other_session))))

def select(frame: OutputFrame, matches: Bool) -> OutputRoute:
  match matches:
    case True{}: Matched{frame}
    case False{}: Mismatched{frame}

def route(expected: Correlation, frame: OutputFrame) -> OutputRoute:
  match frame:
    case OutputFrame{+correlation,stream,cursor,bytes}:
      select(OutputFrame{correlation,stream,cursor,bytes},same(expected,correlation))

# The legacy appended empty argument denotes an internal continuation wake.
# A nonempty message remains a wake identifier, without a consuming attempt.
def wake(message: String) -> Maybe<String>:
  match message:
    case "": None{}
    case other: Some{other}

law matching_output_preserves_frame:
  for stream: Stream
  for cursor: String
  for bytes: String
  {route(Correlation{"db","owner","request","session"},OutputFrame{Correlation{"db","owner","request","session"},stream,cursor,bytes}) == Matched{OutputFrame{Correlation{"db","owner","request","session"},stream,cursor,bytes}} : OutputRoute}

def matching_output_preserves_frame(stream,cursor,bytes):
  {==}

law different_database_preserves_unrouted_frame:
  {route(Correlation{"db","owner","request","session"},OutputFrame{Correlation{"other-db","owner","request","session"},Stdout{},"cursor","body"}) == Mismatched{OutputFrame{Correlation{"other-db","owner","request","session"},Stdout{},"cursor","body"}} : OutputRoute}

def different_database_preserves_unrouted_frame():
  {==}

law different_owner_preserves_unrouted_frame:
  {route(Correlation{"db","owner","request","session"},OutputFrame{Correlation{"db","other-owner","request","session"},Stdout{},"cursor","body"}) == Mismatched{OutputFrame{Correlation{"db","other-owner","request","session"},Stdout{},"cursor","body"}} : OutputRoute}

def different_owner_preserves_unrouted_frame():
  {==}

law different_request_preserves_unrouted_frame:
  {route(Correlation{"db","owner","request","session"},OutputFrame{Correlation{"db","owner","other-request","session"},Stdout{},"cursor","body"}) == Mismatched{OutputFrame{Correlation{"db","owner","other-request","session"},Stdout{},"cursor","body"}} : OutputRoute}

def different_request_preserves_unrouted_frame():
  {==}

law different_session_preserves_unrouted_frame:
  {route(Correlation{"db","owner","request","session"},OutputFrame{Correlation{"db","owner","request","other-session"},Stdout{},"cursor","body"}) == Mismatched{OutputFrame{Correlation{"db","owner","request","other-session"},Stdout{},"cursor","body"}} : OutputRoute}

def different_session_preserves_unrouted_frame():
  {==}

law continuation_has_no_message_identifier:
  {wake("") == None{} : Maybe<String>}

def continuation_has_no_message_identifier():
  {==}

law nonempty_wake_keeps_message_identifier:
  {wake("message") == Some{"message"} : Maybe<String>}

def nonempty_wake_keeps_message_identifier():
  {==}

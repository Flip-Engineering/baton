# CLAIM: the context service companion for the native context operations. It submits one
# query through validated admission, reads the retained envelope of one query with its state,
# and performs passive discovery through a supplied catalog selection, with every failure
# keeping its original code and detail.
#
# The Core selected-plan validation and the catalog selection arrive as supplied operands,
# because Core's modules are not part of this worktree's closure and this module does not
# invent a bridge to them. A pure plan decision is validation, not an effect callable, and
# this module calls it as such.
#
# Reference expansion is not restated here: ContextStore.ref_lookup is the typed ref access
# of this service, with its own staged answers and its own host failure, and a second shape
# for the same operation would add nothing.
import Base
import ./bound-admission.bend as ContextAdmit
import ./store.bend as ContextStore
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C

# What one submission concluded. The refusal keeps the host or validation code with its
# detail, and the uncertain answer keeps the stage and the raw answer so a caller never reads
# a short, surplus or malformed admission answer as an admitted one.
type Submission is Data:
  SubmissionAdmitted{admission: ContextAdmit.Admission}
  SubmissionRefused{code: U32, detail: String}
  SubmissionUncertain{stage: String, answer: String}

# What one retained read concluded, from a single statement so the state and the envelope
# describe the same row.
type Retained is Data:
  RetainedFound{state: String, envelope: String}
  RetainedAbsent{query: String}
  RetainedUnreadable{stage: String, answer: String}
  RetainedRefused{code: U32, detail: String}

# What passive discovery concluded. The selection document is the supplied catalog answer;
# this module starts no target and no module for discovery.
type Discovery is Data:
  DiscoverySelected{document: String}
  DiscoveryRefused{code: U32, detail: String}

# The retained read of one query: whether the row exists, its state, and its envelope. The
# envelope is one line of JSON, so the row framing cannot be broken by its content.
def retained_sql(+query: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM semantic_queries WHERE id=" ++ C.q(query) ++ ") THEN 'present' ELSE 'absent' END,"
  ++ "coalesce((SELECT state FROM semantic_queries WHERE id=" ++ C.q(query) ++ "),''),"
  ++ "coalesce((" ++ ContextStore.envelope_sql(query) ++ "),'');"

def retained_answer(+query: String, +presence: String, +state: String, +envelope: String, +answer: String) -> Retained:
  Bool.pick(Retained, String.eq(presence, "absent"), RetainedAbsent{query},
  Bool.pick(Retained, String.eq(presence, "present"), RetainedFound{state, envelope}, RetainedUnreadable{"presence", answer}))

def retained_tabs(+query: String, +fields: List<String>, +answer: String) -> Retained:
  match fields:
    case +presence <> more0:
      match more0:
        case +state <> more1:
          match more1:
            case +envelope <> more2:
              match more2:
                case Nil{}: retained_answer(query, presence, state, envelope, answer)
                case _: RetainedUnreadable{"surplus", answer}
            case _: RetainedUnreadable{"short", answer}
        case _: RetainedUnreadable{"short", answer}
    case _: RetainedUnreadable{"short", answer}

def retained_decode(+query: String, +row: String) -> Retained:
  match Tx.split_lines(row):
    case Nil{}: RetainedUnreadable{"empty", row}
    case +line <> +rest:
      match rest:
        case Nil{}: retained_tabs(query, Tx.split_tabs(line), row)
        case _: RetainedUnreadable{"surplus", row}

def retained_after(+query: String, result: Result<&1,&1,U32 & String,String>) -> IO(Retained):
  match result:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Retained, RetainedRefused{code, detail})
    case Done{+rows}: IO.pure(Retained, retained_decode(query, rows))

# The retained envelope of one query, read on the qualified connection.
def retained(+db: String, +binding: String, +query: String) -> IO(Retained):
  do IO<Retained>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(db, binding, retained_sql(query))
    retained_after(query, result)

def submission_after(result: Result<&1,&1,U32 & String,ContextAdmit.Admission>) -> IO(Submission):
  match result:
    case Done{+admission}: IO.pure(Submission, SubmissionAdmitted{admission})
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})

# One submission: the Core plan validation runs first and a refusal there creates no row, then
# the atomic admission creates or replays the row and returns its own answer.
def submit(+db: String, +binding: String, +id: String, +owner: String, +requestJson: String, +keeperPath: String, +cwd: String, +originAttempt: String, +artifactPath: String, validate: String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Submission):
  do IO<Submission>:
    verdict : Result<&1,&1,U32 & String,String> <- validate(requestJson)
    match verdict:
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(Submission, SubmissionRefused{code, detail})
      case Done{+accepted}:
        admitted : Result<&1,&1,U32 & String,ContextAdmit.Admission> <- ContextAdmit.admit(db, binding, id, owner, accepted, keeperPath, cwd, originAttempt, artifactPath)
        submission_after(admitted)

# Passive discovery: the supplied catalog selection answers, and this module reads no target,
# starts no module and admits nothing.
def discover(catalog: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Discovery):
  do IO<Discovery>:
    selected : Result<&1,&1,U32 & String,String> <- catalog(Unit{})
    match selected:
      case Done{+document}: IO.pure(Discovery, DiscoverySelected{document})
      case Fail{error}:
        match error:
          case (code, detail): IO.pure(Discovery, DiscoveryRefused{code, detail})

# Intent preparation against the ACTUAL receipt record contract.
#
# The contract is the one this pinned receipt.c implements: every semantic outcome,
# including absent, failed, unreadable, unsyncable, may-exist, unpublished and uncertain,
# is returned as an ordinary Done carrying a six field record
#   tag \t path \t error \t phase \t pending \t detail
# and only transport or allocation failures take the outer Fail. Done therefore does not
# mean admitted, and this module treats it that way: a record is admitted here only when
# its tag field is exactly "qualified", and admission is still NOT publication readiness,
# because the exact attempt, path and content association is not established on this path.
#
# Receipt.qualify takes a RECEIPT FILE PATH and reports its durability. The candidate and
# the basis are immutable Git object ids, not receipt paths, so they are carried in their
# own fields and are never passed to qualify; what gets qualified is the receipt file the
# intent was published to.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git
import ../host/receipt.bend as R

type IntentInput is Data:
  IntentRequested{attempt: String, common: String, target: String, destination: String, candidate: String, basis: String, intent_path: String, holder: String, retry: String}

type IntentPrepared is Data:
  IntentUnready{step: String, tag: String, raw: String}
  IntentProvisional{request: IntentInput, qualified_path: String, head: T.GitOut, index: T.GitOut, status: T.GitOut}

# The tag field of the record, and whether that tag is the one admitted value.
def record_tag(record: String) -> String:
  match Tx.split_tabs(record):
    case SNil{}: ""
    case SCon{tag, rest}: tag

def record_is_qualified(tag: String) -> Bool:
  match Tx.str_eq(tag, "qualified"):
    case True{}: True{}
    case False{}: False{}

def admitted_by(record: String) -> Bool:
  record_is_qualified(record_tag(record))

law an_absent_record_is_not_admitted:
  {admitted_by("absent\t/x\t0\tqualify\t0\tabsent") == False{} : Bool}

def an_absent_record_is_not_admitted():
  {==}

law a_failed_record_is_not_admitted:
  {admitted_by("failed\t/x\t13\tpublish\t0\tfirst failure") == False{} : Bool}

def a_failed_record_is_not_admitted():
  {==}

law an_uncertain_record_is_not_admitted:
  {admitted_by("uncertain\t/x\t0\tpublish\t1\texisting") == False{} : Bool}

def an_uncertain_record_is_not_admitted():
  {==}

law an_unpublished_record_is_not_admitted:
  {admitted_by("unpublished\t/x\t0\tpublish\t0\tnothing durable") == False{} : Bool}

def an_unpublished_record_is_not_admitted():
  {==}

law only_a_qualified_record_is_admitted:
  {admitted_by("qualified\t/x\t0\tqualify\t0\t/x") == True{} : Bool}

def only_a_qualified_record_is_admitted():
  {==}

# Laws over the actual caller: a semantic Done that is not qualified reaches unready with
# its raw record retained, and a host Fail reaches unready without inventing a tag.
law a_done_absent_record_reaches_unready:
  for request: IntentInput
  {Intent.recorded(request, "absent\t/x\t0\tqualify\t0\tabsent") == IO.pure(IntentPrepared, IntentUnready{"record", record_tag("absent\t/x\t0\tqualify\t0\tabsent"), "absent\t/x\t0\tqualify\t0\tabsent"}) : IO(IntentPrepared)}

def a_done_absent_record_reaches_unready(request):
  {==}

law a_done_uncertain_record_reaches_unready:
  for request: IntentInput
  {Intent.recorded(request, "uncertain\t/x\t0\tpublish\t1\texisting") == IO.pure(IntentPrepared, IntentUnready{"record", record_tag("uncertain\t/x\t0\tpublish\t1\texisting"), "uncertain\t/x\t0\tpublish\t1\texisting"}) : IO(IntentPrepared)}

def a_done_uncertain_record_reaches_unready(request):
  {==}

law a_host_failure_reaches_unready_without_a_tag:
  for request: IntentInput
  for error: U32 & String
  {Intent.record_failed(request, Fail{error}) == IO.pure(IntentPrepared, IntentUnready{"record-fail", "", ""}) : IO(IntentPrepared)}

def a_host_failure_reaches_unready_without_a_tag(request,error):
  {==}

# Preparation: the holder is observed only after an admitted record, and the observation
# never yields publication readiness. Every branch keeps the raw record or the host error.
def Intent.observe_holder(request: IntentInput, qualified_path: String) -> IO(IntentPrepared):
  +h = request.holder
  do IO<IntentPrepared>:
    head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentProvisional{request, qualified_path, head, index, status})

def Intent.recorded(request: IntentInput, raw: String) -> IO(IntentPrepared):
  match admitted_by(raw):
    case False{}: IO.pure(IntentPrepared, IntentUnready{"record", record_tag(raw), raw})
    case True{}: Intent.observe_holder(request, request.intent_path)

def Intent.record_failed(request: IntentInput, observed: Result<U32 & String, String>) -> IO(IntentPrepared):
  match observed:
    case Fail{error}: IO.pure(IntentPrepared, IntentUnready{"record-fail", "", ""})
    case Done{raw}: Intent.recorded(request, raw)

def Intent.qualified_path(request: IntentInput, qualified: Result<U32 & String, String>) -> IO(IntentPrepared):
  match qualified:
    case Fail{error}: IO.pure(IntentPrepared, IntentUnready{"qualify", "", ""})
    case Done{raw}: Intent.record_failed(request, Done{raw})

def Intent.read_record(request: IntentInput, qualified: Result<U32 & String, String>) -> IO(IntentPrepared):
  Intent.qualified_path(request, qualified)

def Intent.prepare(request: IntentInput) -> IO(IntentPrepared):
  do IO<IntentPrepared>:
    qualified : Result<U32 & String, String> <- R.Receipt.qualify(request.intent_path)
    Intent.read_record(request, qualified)

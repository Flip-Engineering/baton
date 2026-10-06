# Intent preparation against the ACTUAL receipt record contract.
#
# receipt.c receipt_record builds one six field record
#   tag \t path \t error \t phase \t pending \t detail
# and returns it with io_done for EVERY semantic outcome: published, existing, may-exist,
# unpublished, qualified, absent, unreadable, unsyncable, present, created, listed,
# uncertain, absent-root and failed. Only transport or allocation failures take the outer
# Fail. Done therefore does not mean admitted.
#
# Receipt.qualify takes a RECEIPT FILE PATH and reports its durability against it. The
# candidate and the basis are immutable Git object ids, not receipt paths, so they stay in
# their own fields and are never passed to qualify.
#
# The decoder is conservative and NOT a lossless protocol. Tx.split_tabs drops a trailing
# empty field, which is the shape a normally qualified record has (empty phase and empty
# detail), so five fields are accepted only when every value matches the qualified
# production shape and six fields only when the sixth is empty. A truncated record that
# happens to split into those same five fields cannot be told apart by this splitter, and
# the shared Git splitter is not changed here to repair a receipt boundary. The producer
# does not escape embedded tabs in paths or detail, so a raw record is always retained and
# an ambiguous one is refused rather than resolved.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git
import ../host/receipt.bend as R

type IntentInput is Data:
  IntentRequested{attempt: String, common: String, target: String, destination: String, candidate: String, basis: String, intent_path: String, holder: String, retry: String}

type ReceiptVerdict is Data:
  VerdictAdmitted{raw: String, path: String}
  VerdictPending{raw: String, pending: String}
  VerdictRefused{raw: String, reason: String}

type IntentPrepared is Data:
  IntentUnready{step: String, tag: String, raw: String}
  IntentHostFailed{step: String, error: U32 & String, raw: String}
  IntentPending{request: IntentInput, raw: String, pending: String}
  IntentAdmitted{request: IntentInput, raw: String, qualified_path: String, head: T.GitOut, index: T.GitOut, status: T.GitOut}

# The tag field alone, for the caller's report.
def record_tag(record: String) -> String:
  match Tx.split_tabs(record):
    case Nil{}: ""
    case Con{first, rest}: first

# The qualified production shape: tag qualified, the requested path, error 0, empty phase,
# and a pending field whose value decides between admission and an explicit pending
# disposition. A negative pending value is unknown, not quiet, and is refused.
def verdict_shape(tag: String, path: String, error: String, phase: String, pending: String, detail: String, raw: String, wanted: String) -> ReceiptVerdict:
  match Tx.str_eq(tag, "qualified"):
    case False{}: VerdictRefused{raw, "tag is not the qualified tag"}
    case True{}: verdict_fields(path, error, phase, pending, detail, raw, wanted)

def verdict_fields(path: String, error: String, phase: String, pending: String, detail: String, raw: String, wanted: String) -> ReceiptVerdict:
  match Tx.str_eq(path, wanted):
    case False{}: VerdictRefused{raw, "path is not the requested receipt path"}
    case True{}: verdict_numbers(error, phase, pending, detail, raw, path)

def verdict_numbers(error: String, phase: String, pending: String, detail: String, raw: String, path: String) -> ReceiptVerdict:
  match Tx.str_eq(error, "0"):
    case False{}: VerdictRefused{raw, "error field is not zero"}
    case True{}: verdict_phase(phase, pending, detail, raw, path)

def verdict_phase(phase: String, pending: String, detail: String, raw: String, path: String) -> ReceiptVerdict:
  match Tx.str_eq(phase, ""):
    case False{}: VerdictRefused{raw, "phase field is not empty"}
    case True{}: verdict_pending(pending, detail, raw, path)

def verdict_pending(pending: String, detail: String, raw: String, path: String) -> ReceiptVerdict:
  match Tx.str_eq(pending, "0"):
    case True{}: verdict_detail(detail, raw, path)
    case False{}: VerdictPending{raw, pending}

def verdict_detail(detail: String, raw: String, path: String) -> ReceiptVerdict:
  match Tx.str_eq(detail, ""):
    case True{}: VerdictAdmitted{raw, path}
    case False{}: VerdictRefused{raw, "detail field is not empty"}

# Six fields exactly, or the five field shape with the trailing detail dropped by the splitter.
def receipt_verdict(record: String, wanted: String) -> ReceiptVerdict:
  match Tx.split_tabs(record):
    case Nil{}: VerdictRefused{record, "record has no fields"}
    case Con{tag, r1}:
      match r1:
        case Nil{}: VerdictRefused{record, "record has one field"}
        case Con{path, r2}:
          match r2:
            case Nil{}: VerdictRefused{record, "record has two fields"}
            case Con{error, r3}:
              match r3:
                case Nil{}: VerdictRefused{record, "record has three fields"}
                case Con{phase, r4}:
                  match r4:
                    case Nil{}: VerdictRefused{record, "record has four fields"}
                    case Con{pending, r5}:
                      match r5:
                        case Nil{}: verdict_shape(tag, path, error, phase, pending, "", record, wanted)
                        case Con{detail, r6}:
                          match r6:
                            case Nil{}: verdict_shape(tag, path, error, phase, pending, detail, record, wanted)
                            case Con{extra, r7}: VerdictRefused{record, "record has more than six fields"}

def verdict_admitted(verdict: ReceiptVerdict) -> Bool:
  match verdict:
    case VerdictAdmitted{raw, path}: True{}
    case VerdictPending{raw, pending}: False{}
    case VerdictRefused{raw, reason}: False{}

# Preparation, callers first. The holder is observed only after admission, the qualified
# raw record is retained on the admitted branch, and no branch advertises publication
# readiness: the exact attempt, content and association are not established here.
def Intent.observe_holder(request: IntentInput, raw: String, qualified_path: String) -> IO(IntentPrepared):
  +h = request.holder
  do IO<IntentPrepared>:
    head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentAdmitted{request, raw, qualified_path, head, index, status})

def Intent.decided(request: IntentInput, raw: String, verdict: ReceiptVerdict) -> IO(IntentPrepared):
  match verdict:
    case VerdictAdmitted{admitted_raw, path}: Intent.observe_holder(request, admitted_raw, path)
    case VerdictPending{pending_raw, pending}: IO.pure(IntentPrepared, IntentPending{request, pending_raw, pending})
    case VerdictRefused{refused_raw, reason}: IO.pure(IntentPrepared, IntentUnready{"record", record_tag(refused_raw), refused_raw})

def Intent.recorded(request: IntentInput, raw: String) -> IO(IntentPrepared):
  Intent.decided(request, raw, receipt_verdict(raw, request.intent_path))

def Intent.record_observed(request: IntentInput, observed: Result<U32 & String, String>) -> IO(IntentPrepared):
  match observed:
    case Fail{error}: IO.pure(IntentPrepared, IntentHostFailed{"record", error, ""})
    case Done{raw}: Intent.recorded(request, raw)

def Intent.read_observed(request: IntentInput, observed: Result<U32 & String, String>) -> IO<IntentPrepared>:
  match observed:
    case Fail{error}: IO.pure(IntentPrepared, IntentHostFailed{"qualify", error, ""})
    case Done{raw}: Intent.record_observed(request, Done{raw})

def Intent.prepare(request: IntentInput) -> IO<IntentPrepared>:
  do IO<IntentPrepared>:
    observed : Result<U32 & String, String> <- R.Receipt.qualify(request.intent_path)
    Intent.read_observed(request, observed)

# Laws over the revised decoder, stated over the actual caller where the caller decides.
law a_qualified_record_with_empty_phase_and_detail_is_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t0\t\t0\t", "/x")) == True{} : Bool}

def a_qualified_record_with_empty_phase_and_detail_is_admitted():
  {==}

law a_qualified_prefix_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified-x\t/x\t0\t\t0\t", "/x")) == False{} : Bool}

def a_qualified_prefix_is_not_admitted():
  {==}

law a_truncated_record_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t0\t", "/x")) == False{} : Bool}

def a_truncated_record_is_not_admitted():
  {==}

law a_record_with_extra_fields_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t0\t\t0\t\tmore", "/x")) == False{} : Bool}

def a_record_with_extra_fields_is_not_admitted():
  {==}

law a_record_for_another_path_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/other\t0\t\t0\t", "/x")) == False{} : Bool}

def a_record_for_another_path_is_not_admitted():
  {==}

law a_record_with_a_nonzero_error_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t13\t\t0\t", "/x")) == False{} : Bool}

def a_record_with_a_nonzero_error_is_not_admitted():
  {==}

law a_record_with_a_nonempty_phase_is_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t0\tfsync-dir\t0\t", "/x")) == False{} : Bool}

def a_record_with_a_nonempty_phase_is_not_admitted():
  {==}

law a_record_with_a_negative_pending_is_refused_not_admitted:
  {verdict_admitted(receipt_verdict("qualified\t/x\t0\t\t-1\t", "/x")) == False{} : Bool}

def a_record_with_a_negative_pending_is_refused_not_admitted():
  {==}

law a_semantic_nonqualified_record_is_not_admitted:
  {verdict_admitted(receipt_verdict("uncertain\t/x\t0\tpublish\t1\texisting", "/x")) == False{} : Bool}

def a_semantic_nonqualified_record_is_not_admitted():
  {==}

law a_semantic_refusal_reaches_unready_with_its_raw_record:
  for request: IntentInput
  {Intent.recorded(request, "absent\t/x\t0\tqualify\t0\tabsent") == IO.pure(IntentPrepared, IntentUnready{"record", "absent", "absent\t/x\t0\tqualify\t0\tabsent"}) : IO(IntentPrepared)}

def a_semantic_refusal_reaches_unready_with_its_raw_record(request):
  {==}

law a_host_failure_keeps_the_exact_host_error:
  for request: IntentInput
  {Intent.record_observed(request, Fail{(13, "i/o error")}) == IO.pure(IntentPrepared, IntentHostFailed{"record", (13, "i/o error"), ""}) : IO(IntentPrepared)}

def a_host_failure_keeps_the_exact_host_error(request):
  {==}

law an_admitted_record_is_retained_raw_on_the_admitted_branch:
  for request: IntentInput
  for head: T.GitOut
  for index: T.GitOut
  for status: T.GitOut
  {Intent.observe_holder(request, "qualified\t/x\t0\t\t0\t", "/x") == (do IO<IntentPrepared>:
    +h = request.holder
    observed_head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    observed_index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    observed_status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentAdmitted{request, "qualified\t/x\t0\t\t0\t", "/x", observed_head, observed_index, observed_status})) : IO(IntentPrepared)}

def an_admitted_record_is_retained_raw_on_the_admitted_branch(request,head,index,status):
  {==}

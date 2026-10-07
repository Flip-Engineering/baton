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
# The decoder does not split the record. Tx.split_tabs destroys the bytes that distinguish
# a record with a missing final separator from one with an empty final field, so this
# module compares the whole raw record against the exact strings the producer builds for a
# qualified call, and refuses everything else while preserving its raw bytes. That is a
# bounded whitelist, not a general receipt parser, and it does not change the shared Git
# splitter. The producer does not escape embedded tabs in paths or detail, so a requested
# path carrying a separator is refused before any comparison and no raw record is
# fabricated for a host failure.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git
import ../host/receipt.bend as R

type IntentInput is Data:
  IntentRequested{attempt: String, common: String, target: String, destination: String, candidate: String, basis: String, intent_path: String, holder: String, retry: String}

type ReceiptVerdict is Data:
  VerdictAdmitted{raw: String, path: String}
  VerdictPending{raw: String, path: String, pending: String}
  VerdictRefused{raw: String, reason: String}

type IntentPrepared is Data:
  IntentUnready{step: String, reason: String, raw: String}
  IntentHostFailed{step: String, request: IntentInput, error: U32 & String}
  IntentPending{request: IntentInput, raw: String, pending: String}
  IntentObserved{request: IntentInput, raw: String, qualified_path: String, head: T.GitOut, index: T.GitOut, status: T.GitOut}

# Field access through the declared constructor, in place of an unverified accessor form.
def requested_path(request: IntentInput) -> String:
  match request:
    case IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}: intent_path

def requested_holder(request: IntentInput) -> String:
  match request:
    case IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}: holder

# A separator in the requested path would make the comparison ambiguous, because the
# producer does not escape it.
def carries_tab_go(text: String, found: Bool) -> Bool:
  match text:
    case SNil{}: found
    case SCon{c, rest}:
      +here = c
      +hit = Tx.is_tab(here)
      +next = Bool.or(found, hit)
      carries_tab_go(rest, next)

def carries_tab(text: String) -> Bool:
  +start = False{}
  carries_tab_go(text, start)

# Leaves first. Every supported shape is compared whole, so a missing or extra separator
# and a malformed pending field each reach their own refusal instead of being flattened.
def verdict_pending_missing(raw: String, path: String) -> ReceiptVerdict:
  VerdictRefused{raw, "record has no pending field"}

def verdict_trailing(raw: String, path: String) -> ReceiptVerdict:
  VerdictRefused{raw, "record has an extra trailing separator"}

def verdict_no_final_separator(raw: String, path: String) -> ReceiptVerdict:
  VerdictRefused{raw, "record is missing its final separator"}

def verdict_fifth(raw: String, wanted: String) -> ReceiptVerdict:
  +r5 = raw
  +w5 = wanted
  +whole5 = Tx.str_cat("qualified\t", Tx.str_cat(w5, "\t0\t\t"))
  Bool.pick(ReceiptVerdict, Tx.str_eq(r5, whole5),
    verdict_pending_missing(r5, w5),
    VerdictRefused{r5, "record does not match the qualified production shape"})
def verdict_fourth(raw: String, wanted: String) -> ReceiptVerdict:
  +r4 = raw
  +w4 = wanted
  +whole4 = Tx.str_cat("qualified\t", Tx.str_cat(w4, "\t0\t\t0\t\t"))
  Bool.pick(ReceiptVerdict, Tx.str_eq(r4, whole4),
    verdict_trailing(r4, w4),
    verdict_fifth(r4, w4))
def verdict_third(raw: String, wanted: String) -> ReceiptVerdict:
  +r3 = raw
  +w3 = wanted
  +whole3 = Tx.str_cat("qualified\t", Tx.str_cat(w3, "\t0\t\t0"))
  Bool.pick(ReceiptVerdict, Tx.str_eq(r3, whole3),
    verdict_no_final_separator(r3, w3),
    verdict_fourth(r3, w3))
def verdict_second(raw: String, wanted: String) -> ReceiptVerdict:
  +r2 = raw
  +w2 = wanted
  +whole2 = Tx.str_cat("qualified\t", Tx.str_cat(w2, "\t0\t\t1\t"))
  Bool.pick(ReceiptVerdict, Tx.str_eq(r2, whole2),
    VerdictPending{r2, w2, "1"},
    verdict_third(r2, w2))
def verdict_exact(raw: String, wanted: String) -> ReceiptVerdict:
  +r8 = raw
  +w8 = wanted
  +whole8 = Tx.str_cat("qualified\t", Tx.str_cat(w8, "\t0\t\t0\t"))
  Bool.pick(ReceiptVerdict, Tx.str_eq(r8, whole8),
    VerdictAdmitted{r8, w8},
    verdict_second(r8, w8))
def receipt_verdict(record: String, wanted: String) -> ReceiptVerdict:
  +raw = record
  +path = wanted
  Bool.pick(ReceiptVerdict, carries_tab(path),
    VerdictRefused{raw, "requested path carries a separator"},
    verdict_exact(raw, path))
def verdict_admitted(verdict: ReceiptVerdict) -> Bool:
  match verdict:
    case VerdictAdmitted{raw, path}: True{}
    case VerdictPending{raw, path, pending}: False{}
    case VerdictRefused{raw, reason}: False{}

# Preparation, callers first. The holder is observed only after an admitted record, the
# qualified raw record is retained, and the branch is an observation: the exact attempt,
# content and association are not established here, so nothing claims readiness.
def Intent.observe_holder(request: IntentInput, raw: String, qualified_path: String) -> IO(IntentPrepared):
  +req = request
  +record = raw
  +path = qualified_path
  +h = requested_holder(req)
  do IO<IntentPrepared>:
    head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentObserved{req, record, path, head, index, status})

def Intent.decided(request: IntentInput, raw: String, verdict: ReceiptVerdict) -> IO(IntentPrepared):
  match verdict:
    case VerdictAdmitted{admitted_raw, path}: Intent.observe_holder(request, admitted_raw, path)
    case VerdictPending{pending_raw, path, pending}: IO.pure(IntentPrepared, IntentPending{request, pending_raw, pending})
    case VerdictRefused{refused_raw, reason}: IO.pure(IntentPrepared, IntentUnready{"record", reason, refused_raw})

def Intent.recorded(request: IntentInput, raw: String) -> IO(IntentPrepared):
  +req = request
  +record = raw
  +path = requested_path(req)
  Intent.decided(req, record, receipt_verdict(record, path))

def Intent.record_observed(request: IntentInput, host: Result<&1, &1, U32 & String, String>) -> IO(IntentPrepared):
  match host:
    case Fail{error}: IO.pure(IntentPrepared, IntentHostFailed{"record", request, error})
    case Done{raw}: Intent.recorded(request, raw)

def Intent.read_observed(request: IntentInput, host: Result<&1, &1, U32 & String, String>) -> IO(IntentPrepared):
  match host:
    case Fail{error}: IO.pure(IntentPrepared, IntentHostFailed{"qualify", request, error})
    case Done{raw}: Intent.record_observed(request, Done{raw})

def Intent.prepare(request: IntentInput) -> IO(IntentPrepared):
  +req = request
  +path = requested_path(req)
  +again = req
  do IO<IntentPrepared>:
    observed : Result<&1, &1, U32 & String, String> <- R.Receipt.qualify(path)
    Intent.read_observed(again, observed)

law a_complete_qualified_record_is_admitted:
  {receipt_verdict("qualified\t/x\t0\t\t0\t", "/x") == VerdictAdmitted{"qualified\t/x\t0\t\t0\t", "/x"} : ReceiptVerdict}

def a_complete_qualified_record_is_admitted():
  {==}

law a_record_missing_its_final_separator_is_refused:
  {receipt_verdict("qualified\t/x\t0\t\t0", "/x") == VerdictRefused{"qualified\t/x\t0\t\t0", "record is missing its final separator"} : ReceiptVerdict}

def a_record_missing_its_final_separator_is_refused():
  {==}

law a_record_with_an_extra_trailing_separator_is_refused:
  {receipt_verdict("qualified\t/x\t0\t\t0\t\t", "/x") == VerdictRefused{"qualified\t/x\t0\t\t0\t\t", "record has an extra trailing separator"} : ReceiptVerdict}

def a_record_with_an_extra_trailing_separator_is_refused():
  {==}

law a_supported_pending_one_record_is_pending:
  {receipt_verdict("qualified\t/x\t0\t\t1\t", "/x") == VerdictPending{"qualified\t/x\t0\t\t1\t", "/x", "1"} : ReceiptVerdict}

def a_supported_pending_one_record_is_pending():
  {==}

law a_negative_pending_record_is_refused:
  {receipt_verdict("qualified\t/x\t0\t\t-1\t", "/x") == VerdictRefused{"qualified\t/x\t0\t\t-1\t", "record does not match the qualified production shape"} : ReceiptVerdict}

def a_negative_pending_record_is_refused():
  {==}

law a_record_without_a_pending_field_is_refused:
  {receipt_verdict("qualified\t/x\t0\t\t", "/x") == VerdictRefused{"qualified\t/x\t0\t\t", "record has no pending field"} : ReceiptVerdict}

def a_record_without_a_pending_field_is_refused():
  {==}

law a_record_for_another_path_is_refused:
  {receipt_verdict("qualified\t/other\t0\t\t0\t", "/x") == VerdictRefused{"qualified\t/other\t0\t\t0\t", "record does not match the qualified production shape"} : ReceiptVerdict}

def a_record_for_another_path_is_refused():
  {==}

law a_requested_path_with_a_separator_is_refused:
  {receipt_verdict("qualified\t/x\ty\t0\t\t0\t", "/x\ty") == VerdictRefused{"qualified\t/x\ty\t0\t\t0\t", "requested path carries a separator"} : ReceiptVerdict}

def a_requested_path_with_a_separator_is_refused():
  {==}

# The reason precedence is real: a record for a path carrying a separator is refused for
# the separator before the record is even compared, so this law is stated for a path
# without one, and the counterpart below states the separator case.
law a_semantic_refusal_for_a_valid_path_reaches_unready_with_its_reason_and_raw_record:
  {Intent.recorded(IntentRequested{"a", "/c", "refs/heads/t", "/d", "cand", "base", "/x", "/h", ""}, "absent\t/x\t0\tqualify\t0\tabsent") == IO.pure(IntentPrepared, IntentUnready{"record", "record does not match the qualified production shape", "absent\t/x\t0\tqualify\t0\tabsent"}) : IO(IntentPrepared)}

def a_semantic_refusal_for_a_valid_path_reaches_unready_with_its_reason_and_raw_record():
  {==}

law a_requested_path_with_a_separator_reaches_unready_for_the_separator:
  {Intent.recorded(IntentRequested{"a", "/c", "refs/heads/t", "/d", "cand", "base", "/x\ty", "/h", ""}, "qualified\t/x\ty\t0\t\t0\t") == IO.pure(IntentPrepared, IntentUnready{"record", "requested path carries a separator", "qualified\t/x\ty\t0\t\t0\t"}) : IO(IntentPrepared)}

def a_requested_path_with_a_separator_reaches_unready_for_the_separator():
  {==}

law a_host_failure_keeps_the_request_the_step_and_the_exact_error:
  for request: IntentInput
  {Intent.record_observed(request, Fail{(13, "i/o error")}) == IO.pure(IntentPrepared, IntentHostFailed{"record", request, (13, "i/o error")}) : IO(IntentPrepared)}

def a_host_failure_keeps_the_request_the_step_and_the_exact_error(request):
  {==}

law an_admitted_record_is_retained_raw_on_the_observation_branch:
  for request: IntentInput
  {Intent.decided(request, "qualified\t/x\t0\t\t0\t", VerdictAdmitted{"qualified\t/x\t0\t\t0\t", "/x"}) == (do IO<IntentPrepared>:
    +h = requested_holder(request)
    observed_head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    observed_index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    observed_status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentObserved{request, "qualified\t/x\t0\t\t0\t", "/x", observed_head, observed_index, observed_status})) : IO(IntentPrepared)}

def an_admitted_record_is_retained_raw_on_the_observation_branch(request):
  {==}

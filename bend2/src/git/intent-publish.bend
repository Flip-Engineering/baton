# Immutable intent publication: ensure the owned attempt directory, publish the intent
# bytes, interpret the publish outcome, and read the exact content back before anything
# qualifies it.
#
# This is not guarded publication and it is not admission. The candidate, basis,
# destination and holder association and the retained evidence are not established here,
# so the result of this module is only that the intent bytes are on disk and were read
# back identical. Qualification is a separate step that takes the receipt file path; this
# module does not infer the content association from qualify, and it never treats a
# published record as a qualified one.
#
# Every effect used here answers the same tagged record this pinned receipt.c builds, so
# the tags are read from the leading field with Tx.starts_with, which stops at the
# separator, rather than by splitting. The record's own path field is not re-verified
# against the requested path in this revision: that is a known limit, recorded rather
# than hidden.
import Base
import ./text.bend as Tx
import ./intent.bend as I
import ../host/receipt.bend as R
import ../host/text.bend as Text

type IntentPublish is Data:
  PublishHostFailed{step: String, request: I.IntentInput, error: U32 & String}
  PublishRefused{request: I.IntentInput, step: String, tag: String, raw: String}
  PublishContentMismatch{request: I.IntentInput, raw: String, expected: String, found: String}
  IntentBytesPublished{request: I.IntentInput, raw: String, path: String, content: String}

def record_begins(raw: String, tag: String) -> Bool:
  Tx.starts_with(raw, Tx.str_cat(tag, "\t"))

def tag_is(raw: String, tag: String) -> Bool:
  +r = raw
  +t = tag
  record_begins(r, t)

# Naming a tag without splitting: the tags this module can see, in the order it tests them.
def publish_tag(raw: String) -> String:
  +r = raw
  match tag_is(r, "published"):
    case True{}: "published"
    case False{}: publish_tag_rest(r)

def publish_tag_rest(raw: String) -> String:
  +r = raw
  match tag_is(r, "existing"):
    case True{}: "existing"
    case False{}: publish_tag_third(r)

def publish_tag_third(raw: String) -> String:
  +r = raw
  match tag_is(r, "may-exist"):
    case True{}: "may-exist"
    case False{}: publish_tag_fourth(r)

def publish_tag_fourth(raw: String) -> String:
  +r = raw
  match tag_is(r, "unpublished"):
    case True{}: "unpublished"
    case False{}: publish_tag_fifth(r)

def publish_tag_fifth(raw: String) -> String:
  +r = raw
  match tag_is(r, "present"):
    case True{}: "present"
    case False{}: publish_tag_sixth(r)

def publish_tag_sixth(raw: String) -> String:
  +r = raw
  match tag_is(r, "created"):
    case True{}: "created"
    case False{}: "other"

def ensure_ok(raw: String) -> Bool:
  +r = raw
  match Tx.str_eq(publish_tag(r), "present"):
    case True{}: True{}
    case False{}: ensure_created(r)

def ensure_created(raw: String) -> Bool:
  +r = raw
  match Tx.str_eq(publish_tag(r), "created"):
    case True{}: True{}
    case False{}: False{}

def publish_ok(raw: String) -> Bool:
  +r = raw
  match Tx.str_eq(publish_tag(r), "published"):
    case True{}: True{}
    case False{}: publish_existing(r)

def publish_existing(raw: String) -> Bool:
  +r = raw
  match Tx.str_eq(publish_tag(r), "existing"):
    case True{}: True{}
    case False{}: False{}

def intent_path(directory: String, name: String) -> String:
  +d = directory
  +n = name
  Tx.str_cat(d, Tx.str_cat("/", n))

def refuse_unless_safe(request: I.IntentInput, step: String, name: String, raw: String) -> IO(IntentPublish):
  +req = request
  +s = step
  +n = name
  +r = raw
  match I.carries_tab(n):
    case True{}: IO.pure(IntentPublish, PublishRefused{req, "name", "name", r})
    case False{}: IO.pure(IntentPublish, PublishRefused{req, s, publish_tag(r), r})

# The content read back is compared as exact bytes; a mismatch is reported with both sides.
def Intent.read_back(request: I.IntentInput, raw: String, path: String, content: String) -> IO(IntentPublish):
  +req = request
  +r = raw
  +p = path
  +want = content
  do IO<IntentPublish>:
    observed : Result<&1, &1, U32 & String, String> <- Text.read(p)
    Intent.read_back_seen(req, r, p, want, observed)

def Intent.read_back_seen(request: I.IntentInput, raw: String, path: String, content: String, observed: Result<&1, &1, U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +r = raw
  +p = path
  +want = content
  match observed:
    case Fail{code, detail}: IO.pure(IntentPublish, PublishHostFailed{"read-back", req, {code, detail}})
    case Done{found}:
      +seen = found
      match Tx.str_eq(seen, want):
        case True{}: IO.pure(IntentPublish, IntentBytesPublished{req, r, p, seen})
        case False{}: IO.pure(IntentPublish, PublishContentMismatch{req, r, want, seen})

def Intent.published(request: I.IntentInput, path: String, content: String, observed: Result<U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  match observed:
    case Fail{error}: IO.pure(IntentPublish, PublishHostFailed{"publish", req, error})
    case Done{raw}:
      +r = raw
      match publish_ok(r):
        case False{}: refuse_unless_safe(req, "publish", "", r)
        case True{}: Intent.read_back(req, r, p, want)

def Intent.ensured(request: I.IntentInput, path: String, content: String, name: String, observed: Result<U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +n = name
  match observed:
    case Fail{error}: IO.pure(IntentPublish, PublishHostFailed{"ensure", req, error})
    case Done{raw}:
      +r = raw
      match ensure_ok(r):
        case False{}: refuse_unless_safe(req, "ensure", "", r)
        case True{}: Intent.publish_now(req, p, want, n)

def Intent.publish_now(request: I.IntentInput, path: String, content: String, name: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +n = name
  do IO<IntentPublish>:
    observed : Result<U32 & String, String> <- R.Receipt.publish(I.requested_directory(req), n, want)
    Intent.published(req, p, want, observed)

# The entry: a directory and a name that cannot carry the separator, the owned attempt
# directory ensured, the bytes published, then read back and compared.
def Intent.publish_intent(request: I.IntentInput, directory: String, name: String, content: String) -> IO(IntentPublish):
  +req = request
  +dir = directory
  +n = name
  +want = content
  +p = intent_path(dir, n)
  match I.carries_tab(dir):
    case True{}: IO.pure(IntentPublish, PublishRefused{req, "directory", "directory", dir})
    case False{}:
      +safe = dir
      do IO<IntentPublish>:
        observed : Result<U32 & String, String> <- R.Receipt.ensure(safe)
        Intent.ensured(req, p, want, n, observed)

law a_published_tag_is_recognised:
  {publish_tag("published\t/x\t0\t\t0\t/published") == "published" : String}

def a_published_tag_is_recognised():
  {==}

law an_existing_and_a_published_record_both_proceed:
  {publish_ok("published\t/x\t0\t\t0\t/published") == True{} : Bool}

def an_existing_and_a_published_record_both_proceed():
  {==}

law a_may_exist_record_does_not_proceed:
  {publish_ok("may-exist\t/x\t17\tpublish\t1\t/published") == False{} : Bool}

def a_may_exist_record_does_not_proceed():
  {==}

law an_unpublished_record_does_not_proceed:
  {publish_ok("unpublished\t/x\t0\tpublish\t0\tnothing durable") == False{} : Bool}

def an_unpublished_record_does_not_proceed():
  {==}

law a_created_or_present_ensure_record_proceeds:
  {ensure_ok("created\t/x\t0\tensure\t0\t/x") == True{} : Bool}

def a_created_or_present_ensure_record_proceeds():
  {==}

law a_failed_ensure_record_does_not_proceed:
  {ensure_ok("failed\t/x\t13\tensure\t0\tfirst failure") == False{} : Bool}

def a_failed_ensure_record_does_not_proceed():
  {==}

law the_intent_path_joins_the_directory_and_the_name:
  {intent_path("/d", "n") == "/d/n" : String}

def the_intent_path_joins_the_directory_and_the_name():
  {==}

law a_mismatched_read_back_is_reported_with_both_sides:
  for request: I.IntentInput
  {Intent.read_back_seen(request, "published\t/x\t0\t\t0\t/published", "/x", "wanted", Done{"found"}) == IO.pure(IntentPublish, PublishContentMismatch{request, "published\t/x\t0\t\t0\t/published", "wanted", "found"}) : IO(IntentPublish)}

def a_mismatched_read_back_is_reported_with_both_sides(request):
  {==}

law a_matching_read_back_reports_the_published_bytes:
  for request: I.IntentInput
  {Intent.read_back_seen(request, "published\t/x\t0\t\t0\t/published", "/x", "wanted", Done{"wanted"}) == IO.pure(IntentPublish, IntentBytesPublished{request, "published\t/x\t0\t\t0\t/published", "/x", "wanted"}) : IO(IntentPublish)}

def a_matching_read_back_reports_the_published_bytes(request):
  {==}

law a_read_back_host_failure_keeps_its_code_and_detail:
  for request: I.IntentInput
  {Intent.read_back_seen(request, "published\t/x\t0\t\t0\t/published", "/x", "wanted", Fail{(2, "no such file")}) == IO.pure(IntentPublish, PublishHostFailed{"read-back", request, (2, "no such file")}) : IO(IntentPublish)}

def a_read_back_host_failure_keeps_its_code_and_detail(request):
  {==}

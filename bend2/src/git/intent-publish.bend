# Immutable intent publication: ensure the owned attempt directory, publish the intent
# bytes, interpret the publish outcome against the exact record this producer writes, and
# read the exact content back before anything qualifies it.
#
# This is not guarded publication and not admission. The candidate, basis, destination and
# holder association and the retained evidence are not established here, so the result is
# only that the bytes are on disk and were read back identical. Qualification is a separate
# later step taking the receipt file path; this module does not infer content association
# from qualify and never treats a published record as a qualified one.
#
# Publish production, read from receipt.c: a fresh publication is
#   published\t<directory>/<name>\t0\t\t0\t
# because that call made and removed its own temp and recorded pending 0; an existing
# receipt reached through the probe or a losing link keeps pending 0 or 1; may-exist,
# unpublished, uncertain and failed all carry an error. Ensure reports present, created or
# failed. Every comparison is against the whole supported record, never a leading tag, so a
# wrong path, a nonzero error or an unsupported pending value cannot proceed on a shared
# prefix. Anything else is refused with its raw record.
#
# The name is validated before any effect, including the empty name and the separator.
# Directory containment is not asserted from concatenating a path; only that the name
# cannot carry the separator. Content may contain tabs.
import Base
import ./text.bend as Tx
import ./intent.bend as I
import ../host/receipt.bend as R
import ../host/text.bend as Text

type IntentPublish is Data:
  PublishHostFailed{step: String, request: I.IntentInput, error: U32 & String}
  PublishRefused{request: I.IntentInput, step: String, name: String, raw: String}
  PublishExistingPending{request: I.IntentInput, raw: String, path: String}
  PublishContentMismatch{request: I.IntentInput, raw: String, expected: String, found: String}
  PublishReadbackFailed{request: I.IntentInput, publication: String, path: String, error: U32 & String}
  IntentBytesPublished{request: I.IntentInput, raw: String, path: String, content: String}

def intent_path(directory: String, name: String) -> String:
  +d = directory
  +n = name
  Tx.str_cat(d, Tx.str_cat("/", n))

# The whole record this producer writes for a tag, path and pending field, with the empty
# error, phase and detail a successful call leaves.
def production_record(tag: String, path: String, pending: String) -> String:
  +t = tag
  +p = path
  +n = pending
  Tx.str_cat(t, Tx.str_cat("\t", Tx.str_cat(p, Tx.str_cat("\t0\t\t", Tx.str_cat(n, "\t")))))

def name_has_slash(name: String) -> Bool:
  +n = name
  match Tx.str_eq(n, ""):
    case True{}: False{}
    case False{}: name_ok_otherwise(n)

def name_ok_otherwise(name: String) -> Bool:
  +n = name
  match Tx.starts_with(n, "/"):
    case True{}: False{}
    case False{}: True{}

def name_is_safe(name: String) -> Bool:
  +n = name
  match I.carries_tab(n):
    case True{}: False{}
    case False{}: name_has_slash(n)

# Whole-record classification, one comparison per supported shape.
def classify_publish(raw: String, path: String) -> String:
  +r = raw
  +p = path
  match Tx.str_eq(r, production_record("published", p, "0")):
    case True{}: "published"
    case False{}: publish_second(r, p)

def publish_second(raw: String, path: String) -> String:
  +r = raw
  +p = path
  match Tx.str_eq(r, production_record("existing", p, "0")):
    case True{}: "existing"
    case False{}: publish_third(r, p)

def publish_third(raw: String, path: String) -> String:
  +r = raw
  +p = path
  match Tx.str_eq(r, production_record("existing", p, "1")):
    case True{}: "existing-pending"
    case False{}: "other"

def classify_ensure(raw: String, path: String) -> String:
  +r = raw
  +p = path
  match Tx.str_eq(r, production_record("created", p, "0")):
    case True{}: "created"
    case False{}: ensure_second(r, p)

def ensure_second(raw: String, path: String) -> String:
  +r = raw
  +p = path
  match Tx.str_eq(r, production_record("present", p, "0")):
    case True{}: "present"
    case False{}: "other"

def Intent.refused(request: I.IntentInput, step: String, name: String, raw: String) -> IO(IntentPublish):
  +req = request
  +s = step
  +n = name
  +r = raw
  IO.pure(IntentPublish, PublishRefused{req, s, n, r})

# The publication observation is carried into the readback failure so a receipt that exists
# cannot be mistaken for a publication that never happened.
def Intent.read_back_seen(request: I.IntentInput, publication: String, path: String, content: String, observed: Result<&1, &1, U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +pub = publication
  +p = path
  +want = content
  match observed:
    case Fail{(code, detail)}: IO.pure(IntentPublish, PublishReadbackFailed{req, pub, p, (code, detail)})
    case Done{found}: Intent.read_back_compare(req, pub, p, want, found)

def Intent.read_back_compare(request: I.IntentInput, publication: String, path: String, content: String, seen: String) -> IO(IntentPublish):
  +req = request
  +pub = publication
  +p = path
  +want = content
  +got = seen
  match Tx.str_eq(got, want):
    case True{}: IO.pure(IntentPublish, IntentBytesPublished{req, pub, p, got})
    case False{}: IO.pure(IntentPublish, PublishContentMismatch{req, pub, want, got})

def Intent.read_back(request: I.IntentInput, publication: String, path: String, content: String) -> IO(IntentPublish):
  +req = request
  +pub = publication
  +p = path
  +want = content
  do IO<IntentPublish>:
    observed : Result<&1, &1, U32 & String, String> <- Text.Text.read(p)
    Intent.read_back_seen(req, pub, p, want, observed)

def publish_admit_second(request: I.IntentInput, path: String, content: String, raw: String, kind: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +r = raw
  match Tx.str_eq(kind, "existing"):
    case True{}: Intent.read_back(req, r, p, want)
    case False{}: publish_admit_third(req, p, want, r, kind)

def publish_admit_third(request: I.IntentInput, path: String, content: String, raw: String, kind: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +r = raw
  match Tx.str_eq(kind, "existing-pending"):
    case True{}: IO.pure(IntentPublish, PublishExistingPending{req, r, p})
    case False{}: Intent.refused(req, "publish", "", r)

def Intent.publish_admit(request: I.IntentInput, path: String, content: String, raw: String, kind: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +r = raw
  match Tx.str_eq(kind, "published"):
    case True{}: Intent.read_back(req, r, p, want)
    case False{}: publish_admit_second(req, p, want, r, kind)

def Intent.publish_classify(request: I.IntentInput, path: String, content: String, raw: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +r = raw
  +kind = classify_publish(r, p)
  Intent.publish_admit(req, p, want, r, kind)

def Intent.published(request: I.IntentInput, path: String, content: String, observed: Result<U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  match observed:
    case Fail{error}: IO.pure(IntentPublish, PublishHostFailed{"publish", req, error})
    case Done{raw}: Intent.publish_classify(req, p, want, raw)

def Intent.ensure_next(request: I.IntentInput, path: String, content: String, directory: String, name: String, raw: String, kind: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +dir = directory
  +n = name
  +r = raw
  match Tx.str_eq(kind, "other"):
    case True{}: Intent.refused(req, "ensure", n, r)
    case False{}: Intent.publish_now(req, p, want, dir, n)

def Intent.ensure_admit(request: I.IntentInput, path: String, content: String, directory: String, name: String, raw: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +dir = directory
  +n = name
  +r = raw
  +kind = classify_ensure(r, dir)
  Intent.ensure_next(req, p, want, dir, n, r, kind)

def Intent.ensured(request: I.IntentInput, path: String, content: String, directory: String, name: String, observed: Result<U32 & String, String>) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +dir = directory
  +n = name
  match observed:
    case Fail{error}: IO.pure(IntentPublish, PublishHostFailed{"ensure", req, error})
    case Done{raw}: Intent.ensure_admit(req, p, want, dir, n, raw)

def Intent.publish_now(request: I.IntentInput, path: String, content: String, directory: String, name: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +dir = directory
  +n = name
  do IO<IntentPublish>:
    observed : Result<U32 & String, String> <- R.Receipt.publish(dir, n, want)
    Intent.published(req, p, want, observed)

def publish_directory(request: I.IntentInput, path: String, content: String, directory: String, name: String) -> IO(IntentPublish):
  +req = request
  +p = path
  +want = content
  +dir = directory
  +n = name
  match I.carries_tab(dir):
    case True{}: IO.pure(IntentPublish, PublishRefused{req, "directory", n, dir})
    case False{}:
      +safe = dir
      do IO<IntentPublish>:
        observed : Result<U32 & String, String> <- R.Receipt.ensure(safe)
        Intent.ensured(req, p, want, safe, n, observed)

# The entry. The name is validated before any effect runs.
def Intent.publish_intent(request: I.IntentInput, directory: String, name: String, content: String) -> IO(IntentPublish):
  +req = request
  +dir = directory
  +n = name
  +want = content
  +p = intent_path(dir, n)
  match name_is_safe(n):
    case False{}: IO.pure(IntentPublish, PublishRefused{req, "name", n, ""})
    case True{}: publish_directory(req, p, want, dir, n)

law a_fresh_publication_record_is_admitted:
  {classify_publish("published\t/d/n\t0\t\t0\t", "/d/n") == "published" : String}

def a_fresh_publication_record_is_admitted():
  {==}

law an_existing_record_with_pending_zero_is_admitted:
  {classify_publish("existing\t/d/n\t0\t\t0\t", "/d/n") == "existing" : String}

def an_existing_record_with_pending_zero_is_admitted():
  {==}

law an_existing_record_with_pending_one_keeps_its_own_state:
  {classify_publish("existing\t/d/n\t0\t\t1\t", "/d/n") == "existing-pending" : String}

def an_existing_record_with_pending_one_keeps_its_own_state():
  {==}

law a_published_record_for_another_path_is_not_admitted:
  {classify_publish("published\t/elsewhere\t0\t\t0\t", "/d/n") == "other" : String}

def a_published_record_for_another_path_is_not_admitted():
  {==}

law a_published_record_with_a_nonzero_error_is_not_admitted:
  {classify_publish("published\t/d/n\t17\tpublish\t0\t", "/d/n") == "other" : String}

def a_published_record_with_a_nonzero_error_is_not_admitted():
  {==}

law a_published_record_with_a_nonempty_phase_is_not_admitted:
  {classify_publish("published\t/d/n\t0\tfsync-dir\t0\t", "/d/n") == "other" : String}

def a_published_record_with_a_nonempty_phase_is_not_admitted():
  {==}

law a_bare_published_prefix_is_not_admitted:
  {classify_publish("published\t", "/d/n") == "other" : String}

def a_bare_published_prefix_is_not_admitted():
  {==}

law an_unpublished_record_is_not_admitted:
  {classify_publish("unpublished\t/d/n\t13\twrite\t1\t", "/d/n") == "other" : String}

def an_unpublished_record_is_not_admitted():
  {==}

law a_may_exist_record_is_not_admitted:
  {classify_publish("may-exist\t/d/n\t13\tfsync-dir\t0\t", "/d/n") == "other" : String}

def a_may_exist_record_is_not_admitted():
  {==}

law a_bare_created_prefix_is_not_admitted:
  {classify_ensure("created\t", "/d") == "other" : String}

def a_bare_created_prefix_is_not_admitted():
  {==}

law a_created_record_for_another_directory_is_not_admitted:
  {classify_ensure("created\t/elsewhere\t0\t\t0\t", "/d") == "other" : String}

def a_created_record_for_another_directory_is_not_admitted():
  {==}

law a_failed_ensure_record_is_not_admitted:
  {classify_ensure("failed\t/d\t13\tensure\t0\tfirst failure", "/d") == "other" : String}

def a_failed_ensure_record_is_not_admitted():
  {==}

law a_created_record_is_admitted:
  {classify_ensure("created\t/d\t0\t\t0\t", "/d") == "created" : String}

def a_created_record_is_admitted():
  {==}

law a_name_carrying_the_separator_is_not_safe:
  {name_is_safe("/d/n") == False{} : Bool}

def a_name_carrying_the_separator_is_not_safe():
  {==}

law an_empty_name_is_not_safe:
  {name_is_safe("") == False{} : Bool}

def an_empty_name_is_not_safe():
  {==}

law a_plain_name_is_safe:
  {name_is_safe("n") == True{} : Bool}

def a_plain_name_is_safe():
  {==}

law a_matching_read_back_reports_the_published_bytes:
  for request: I.IntentInput
  {Intent.read_back_compare(request, "published\t/d/n\t0\t\t0\t", "/d/n", "wanted", "wanted") == IO.pure(IntentPublish, IntentBytesPublished{request, "published\t/d/n\t0\t\t0\t", "/d/n", "wanted"}) : IO(IntentPublish)}

def a_matching_read_back_reports_the_published_bytes(request):
  {==}

law a_mismatched_read_back_is_reported_with_both_sides:
  for request: I.IntentInput
  {Intent.read_back_compare(request, "published\t/d/n\t0\t\t0\t", "/d/n", "wanted", "found") == IO.pure(IntentPublish, PublishContentMismatch{request, "published\t/d/n\t0\t\t0\t", "wanted", "found"}) : IO(IntentPublish)}

def a_mismatched_read_back_is_reported_with_both_sides(request):
  {==}

law a_readback_failure_keeps_the_publication_observation:
  for request: I.IntentInput
  {Intent.read_back_seen(request, "published\t/d/n\t0\t\t0\t", "/d/n", "wanted", Fail{(2, "no such file")}) == IO.pure(IntentPublish, PublishReadbackFailed{request, "published\t/d/n\t0\t\t0\t", "/d/n", (2, "no such file")}) : IO(IntentPublish)}

def a_readback_failure_keeps_the_publication_observation(request):
  {==}

law an_existing_pending_receipt_reaches_the_pending_outcome:
  for request: I.IntentInput
  {Intent.publish_admit(request, "/d/n", "wanted", "existing\t/d/n\t0\t\t1\t", "existing-pending") == IO.pure(IntentPublish, PublishExistingPending{request, "existing\t/d/n\t0\t\t1\t", "/d/n"}) : IO(IntentPublish)}

def an_existing_pending_receipt_reaches_the_pending_outcome(request):
  {==}

law an_unsupported_record_reaches_the_refusal_with_its_raw_bytes:
  for request: I.IntentInput
  {Intent.publish_admit(request, "/d/n", "wanted", "may-exist\t/d/n\t13\tfsync-dir\t0\t", "other") == IO.pure(IntentPublish, PublishRefused{request, "publish", "", "may-exist\t/d/n\t13\tfsync-dir\t0\t"}) : IO(IntentPublish)}

def an_unsupported_record_reaches_the_refusal_with_its_raw_bytes(request):
  {==}

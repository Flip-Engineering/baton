# The guarded landing chain: claim the guard, record the intent, read the association, then
# perform the compare-and-swap mutation through the guarded capture, and release.
#
# The operands are the ones the existing caller chain already holds: ff_stage3 reads
# refs/heads/<target> and carries the old target in FFNext's tb, and ff_stage5's mutation is
# update-ref refs/heads/<target> wc tb. This chain takes the same wc, tb, repo and target, so
# the compare-and-swap is preserved rather than replaced, and the old-value compare compares
# the association's freshly read target head against tb.
#
# The claim is the live descriptor Receipt.claim holds until Receipt.release, so the reads run
# while the guard is held. The mutation itself goes through Process.capture_holding with that
# live descriptor, the artifact and the canonical guard path, so the child custody, the
# stderr capture, the artifact and the terminal or uncertain outcome come from the existing
# guarded effect rather than a second runner.
#
# Every exit keeps its own evidence: the typed refusal it stopped on, the release observation
# that actually happened, and the publish or capture observation. A release failure is
# reported as a release failure and does not erase what the chain observed before it.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./association.bend as A
import ./intent.bend as I
import ./intent-publish.bend as P
import ./process.bend as Process
import ../host/receipt.bend as R

type LandingRequest is Data:
  LandingRequested{intent: I.IntentInput, name: String, old_target: String, content: String,
                   guard: String, artifact: String, attempt_directory: String, repository: String}

type Landing is Data:
  LandingClaimFailed{error: U32 & String}
  LandingGuardBusy{target: String}
  LandingAssociationRefused{step: String, observation: T.GitOut, released: Result<U32 & String, Unit>}
  LandingOldValueMismatch{expected: String, found: String, released: Result<U32 & String, Unit>}
  LandingPublishRefused{outcome: P.IntentPublish, released: Result<U32 & String, Unit>}
  LandingHeld{request: LandingRequest, candidate: String, basis: String, published: String,
              mutation: Result<&1,&1,U32 & String,String & String>, released: Result<U32 & String, Unit>}

# The attempt scratch is derived from the canonical common directory and the attempt name:
# the directory the publication writes into and the artifact the guarded capture retains both
# come from these two, so neither is a free-standing caller string.
def attempt_directory_for(common: String, attempt: String) -> String:
  +c = common
  +a = attempt
  Tx.str_cat(c, Tx.str_cat("/baton2-attempts/", a))

def attempt_artifact_for(common: String, attempt: String) -> String:
  +c = common
  +a = attempt
  Tx.str_cat(attempt_directory_for(c, a), "/stderr")

# The bytes the intent records are the resolved operands themselves, so the recorded intent
# carries the immutable candidate, basis and qualified target rather than caller content.
def intent_content(candidate: String, basis: String, target: String) -> String:
  +c = candidate
  +b = basis
  +t = target
  Tx.str_cat(c, Tx.str_cat("\n", Tx.str_cat(b, Tx.str_cat("\n", Tx.str_cat(qualified_target(t), "\n")))))

def zero_oid() -> String:
  "0000000000000000000000000000000000000000"

def qualified_target(target: String) -> String:
  +t = target
  Tx.str_cat("refs/heads/", t)

# Absence is the empty head; the zero object name is only the mutation's argument for it.
def expected_head(old_target: String) -> String:
  +o = old_target
  o

def mutation_old_value(old_target: String) -> String:
  +o = old_target
  Bool.pick(Bool, Tx.str_eq(o, ""),
    zero_oid(),
    o)
def request_holder(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, mutation}:
      I.requested_holder(intent)

# The target, read through the declared constructor rather than an invented projection.
def request_target(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, mutation}:
      intent_target(intent)

def intent_target(intent: I.IntentInput) -> String:
  match intent:
    case I.IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}:
      target

def intent_name(intent: I.IntentInput) -> String:
  match intent:
    case I.IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}:
      attempt

def intent_common(intent: I.IntentInput) -> String:
  match intent:
    case I.IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}:
      common

# The release happens on every exit, and its own observation is kept beside the refusal.
def Landing.released(request: LandingRequest, handle: U32, outcome: Landing, release: Result<U32 & String, Unit>) -> IO(Landing):
  +req = request
  +h = handle
  +prior = outcome
  +observed = release
  IO.pure(Landing, replace_release(prior, observed))

def replace_release(outcome: Landing, release: Result<U32 & String, Unit>) -> Landing:
  +o = outcome
  +r = release
  match o:
    case LandingAssociationRefused{step, observation, released}: LandingAssociationRefused{step, observation, r}
    case LandingOldValueMismatch{expected, found, released}: LandingOldValueMismatch{expected, found, r}
    case LandingPublishRefused{outcome, released}: LandingPublishRefused{outcome, r}
    case LandingHeld{request, candidate, basis, published, mutation, released}: LandingHeld{request, candidate, basis, published, mutation, r}
    case LandingClaimFailed{error}: LandingClaimFailed{error}
    case LandingGuardBusy{target}: LandingGuardBusy{target}

def Landing.stopped(request: LandingRequest, handle: U32, outcome: Landing) -> IO(Landing):
  +req = request
  +h = handle
  +prior = outcome
  do IO<Landing>:
    released : Result<U32 & String, Unit> <- R.Receipt.release(h)
    Landing.released(req, h, prior, released)

def Landing.associations(request: LandingRequest, handle: U32, published: String, observation: A.Association) -> IO(Landing):
  +req = request
  +h = handle
  +pub = published
  +obs = observation
  match obs:
    case A.AssociationRefused{step, observation}:
      Landing.stopped(req, h, LandingAssociationRefused{step, observation, Done{Unit{}}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common}:
      Landing.old_value_checked(h, req, pub, candidate_oid, basis_oid, target_head)

def Landing.old_value_checked(handle: U32, request: LandingRequest, published: String, candidate: String, basis: String, head: String) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +cand = candidate
  +base = basis
  +found = head
  +expected = expected_head(req.old_target)
  Bool.pick(Bool, Tx.str_eq(found, expected),
    Landing.mutated(h, req, cand, base, pub),
    Landing.stopped(req, h, LandingOldValueMismatch{expected, found, Done{Unit{}}}))
# The mutation runs through the guarded capture with the live claim descriptor, so the child
# inherits the lock and the artifact retains the diagnostics and the terminal outcome.
def Landing.mutated(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +cand = candidate
  +base = basis
  +argv = Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(req.intent)), Con{cand, Con{mutation_old_value(req.old_target), Nil{}}}}}})
  do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(argv, req.repository, h, req.guard, req.artifact)
    Landing.release(h, req, cand, base, pub, observed)

def Landing.release(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String, mutation: Result<&1,&1,U32 & String,String & String>) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +pub = published
  +m = mutation
  do IO<Landing>:
    released : Result<U32 & String, Unit> <- R.Receipt.release(h)
    IO.pure(Landing, LandingHeld{req, cand, base, pub, m, released})

# The publication goes into the attempt directory after the association, and the content is
# derived from the associated operands rather than taken from the caller.
def Landing.published(handle: U32, request: LandingRequest, outcome: P.IntentPublish) -> IO(Landing):
  +h = handle
  +req = request
  +out = outcome
  match out:
    case P.IntentBytesPublished{request, raw, path, content}:
      Landing.associate_now(h, req, raw)
    case P.PublishRefused{request, step, name, raw}: Landing.stopped(req, h, LandingPublishRefused{out, Done{Unit{}}})
    case P.PublishExistingPending{request, raw, path}: Landing.stopped(req, h, LandingPublishRefused{out, Done{Unit{}}})
    case P.PublishContentMismatch{request, raw, expected, found}: Landing.stopped(req, h, LandingPublishRefused{out, Done{Unit{}}})
    case P.PublishReadbackFailed{request, publication, path, error}: Landing.stopped(req, h, LandingPublishRefused{out, Done{Unit{}}})
    case P.PublishHostFailed{step, request, error}: Landing.stopped(req, h, LandingPublishRefused{out, Done{Unit{}}})

def Landing.associate_now(handle: U32, request: LandingRequest, published: String) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +intent = req.intent
  do IO<Landing>:
    decision : A.Association <- A.Association.decide(A.AssociationRequested{intent.attempt, intent.common, intent.target, intent.destination, intent.candidate, intent.basis, intent.holder, intent.retry})
    Landing.associations(req, h, pub, decision)

# The association runs before the publication, so no bytes are written for an unassociated
# request, and the publication uses the attempt directory the request names.
def Landing.claimed_associated(handle: U32, request: LandingRequest) -> IO(Landing):
  +h = handle
  +req = request
  +intent = req.intent
  do IO<Landing>:
    decision : A.Association <- A.Association.decide(A.AssociationRequested{intent.attempt, intent.common, intent.target, intent.destination, intent.candidate, intent.basis, intent.holder, intent.retry})
    Landing.association_before_publish(h, req, decision)

def Landing.association_before_publish(handle: U32, request: LandingRequest, observation: A.Association) -> IO(Landing):
  +h = handle
  +req = request
  +obs = observation
  match obs:
    case A.AssociationRefused{step, observation}:
      Landing.stopped(req, h, LandingAssociationRefused{step, observation, Done{Unit{}}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common}:
      Landing.publish_now(h, req, candidate_oid, basis_oid)

def Landing.publish_now(handle: U32, request: LandingRequest, candidate: String, basis: String) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +intent = req.intent
  do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(intent, attempt_directory_for(intent_common(intent), intent_name(intent)), req.name, intent_content(cand, base, intent_target(intent)))
    Landing.published(h, req, written)

def Landing.decided(request: LandingRequest, claimed: Result<U32 & String, Maybe<U32>>) -> IO(Landing):
  +req = request
  +res = claimed
  match res:
    case Fail{error}: IO.pure(Landing, LandingClaimFailed{error})
    case Done{held}:
      match held:
        case None{}: IO.pure(Landing, LandingGuardBusy{intent_target(req.intent)})
        case Some{handle}: Landing.claimed_associated(handle, req)

# The guarded operands come from the caller and are checked here rather than assumed: an
# empty guard, artifact, attempt directory or repository never reaches an effect.
# The caller's guarded operands are checked for presence before any effect. This is a
# precondition, not a derivation: guard, artifact and attempt directory are still caller
# strings, and deriving them from the admitted attempt is the open caller work.
def nonempty(text: String) -> Bool:
  +s = text
  Bool.not(Tx.str_eq(s, ""))

def preconditions_hold(request: LandingRequest) -> Bool:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}:
      preconditions_four(nonempty(name), nonempty(guard), nonempty(artifact), nonempty(attempt_directory))

def preconditions_four(name: Bool, guard: Bool, artifact: Bool, attempt_directory: Bool) -> Bool:
  +a = name
  +b = guard
  +c = artifact
  +d = attempt_directory
  Bool.pick(Bool, a, Bool.pick(Bool, b, Bool.pick(Bool, c, d, False{}), False{}), False{})

def Landing.run(request: LandingRequest) -> IO(Landing):
  +req = request
  +intent = req.intent
  do IO<Landing>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(intent.common, intent.target)
    Landing.decided(req, claimed)

law the_zero_object_name_is_only_the_mutation_argument:
  {mutation_old_value("") == "0000000000000000000000000000000000000000" : String}

def the_zero_object_name_is_only_the_mutation_argument():
  {==}

law an_absent_old_target_expects_an_absent_head:
  {expected_head("") == "" : String}

def an_absent_old_target_expects_an_absent_head():
  {==}

law a_present_old_target_expects_itself:
  {expected_head("0123456789abcdef0123456789abcdef01234567") == "0123456789abcdef0123456789abcdef01234567" : String}

def a_present_old_target_expects_itself():
  {==}

law the_target_is_qualified_once:
  {qualified_target("main") == "refs/heads/main" : String}

def the_target_is_qualified_once():
  {==}

law an_absent_old_target_consumes_an_absent_head:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  {Landing.old_value_checked(1, LandingRequested{intent, name, old_target: "", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "") == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value(""), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, old_target: "", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "published", observed, released})) : IO(Landing)}

def an_absent_old_target_consumes_an_absent_head(intent,name,content,guard,artifact,attempt_directory,repository):
  {==}

law a_present_old_target_matching_the_head_consumes_it:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  {Landing.old_value_checked(1, LandingRequested{intent, name, old_target: "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222") == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value("2222222222222222222222222222222222222222"), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, old_target: "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "published", observed, released})) : IO(Landing)}

def a_present_old_target_matching_the_head_consumes_it(intent,name,content,guard,artifact,attempt_directory,repository):
  {==}

law a_present_old_target_differing_from_the_head_is_refused:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  {Landing.old_value_checked(1, LandingRequested{intent, name, old_target: "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "3333333333333333333333333333333333333333") == (do IO<Landing>:
    released : Result<U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingOldValueMismatch{"2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333", released})) : IO(Landing)}

def a_present_old_target_differing_from_the_head_is_refused(intent,name,content,guard,artifact,attempt_directory,repository):
  {==}

law a_busy_guard_refuses_before_any_effect:
  for request: LandingRequest
  {Landing.decided(request, Done{None{}}) == IO.pure(Landing, LandingGuardBusy{intent_target(request.intent)}) : IO(Landing)}

def a_busy_guard_refuses_before_any_effect(request):
  {==}

law a_release_failure_keeps_the_earlier_refusal:
  for request: LandingRequest
  {replace_release(LandingOldValueMismatch{"a", "b", Done{Unit{}}}, Fail{(13, "release failed")}) == LandingOldValueMismatch{"a", "b", Fail{(13, "release failed")}} : Landing}

def a_release_failure_keeps_the_earlier_refusal(request):
  {==}

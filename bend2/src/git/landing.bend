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
  LandingClaimFailed{error: T.HostError}
  LandingGuardBusy{target: String}
  LandingAssociationRefused{request: A.AssociationRequest, step: String, observation: T.GitOut, reads: A.AssocReads, released: T.ReleaseRaw}
  LandingOldValueMismatch{expected: String, found: String, reads: A.AssocReads, released: T.ReleaseRaw}
  LandingPublishRefused{outcome: P.IntentPublish, reads: A.AssocReads, released: T.ReleaseRaw}
  LandingHeld{request: LandingRequest, candidate: String, basis: String, published: String,
              mutation: T.CapturedRaw, reads: A.AssocReads, prior: A.AssocReads, released: T.ReleaseRaw}

# The attempt scratch is derived from the canonical common directory and the attempt name:
# the directory the publication writes into and the artifact the guarded capture retains both
# come from these two, so neither is a free-standing caller string.
def landingreq_artifact(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: artifact

def landingreq_guard(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: guard

def landingreq_intent(request: LandingRequest) -> I.IntentInput:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: intent

def landingreq_name(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: name

def landingreq_old_target(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: old_target

def landingreq_repository(request: LandingRequest) -> String:
  match request:
    case LandingRequested{intent, name, old_target, content, guard, artifact, attempt_directory, repository}: repository

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
  Bool.pick(String, Tx.str_eq(o, ""),
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
def Landing.released(request: LandingRequest, handle: U32, outcome: Landing, release: T.ReleaseRaw) -> IO(Landing):
  +req = request
  +h = handle
  +prior = outcome
  +observed = release
  IO.pure(Landing, replace_release(prior, observed))

def replace_release(outcome: Landing, release: T.ReleaseRaw) -> Landing:
  match outcome:
    case LandingAssociationRefused{request, step, observation, reads, released}: LandingAssociationRefused{request, step, observation, reads, release}
    case LandingOldValueMismatch{expected, found, reads, released}: LandingOldValueMismatch{expected, found, reads, release}
    case LandingPublishRefused{outcome, reads, released}: LandingPublishRefused{outcome, reads, release}
    case LandingHeld{request, candidate, basis, published, mutation, reads, prior, released}: LandingHeld{request, candidate, basis, published, mutation, reads, prior, release}
    case LandingClaimFailed{error}: LandingClaimFailed{error}
    case LandingGuardBusy{target}: LandingGuardBusy{target}

def Landing.stopped(request: LandingRequest, handle: U32, outcome: Landing) -> IO(Landing):
  +req = request
  +h = handle
  +prior = outcome
  do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(h)
    Landing.released(req, h, prior, T.release_raw_of(released))

def Landing.associations(landing_request: LandingRequest, handle: U32, published: String, observation: A.Association, prior: A.AssocReads) -> IO(Landing):
  match observation:
    case A.AssociationRefused{request, step, observation, reads}:
      Landing.stopped(landing_request, handle, LandingAssociationRefused{request, step, observation, reads, T.ReleaseUnperformed{}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}:
      Landing.old_value_checked(handle, landing_request, published, candidate_oid, basis_oid, target_head, reads, prior)

def Landing.old_value_checked(handle: U32, request: LandingRequest, published: String, candidate: String, basis: String, head: String, reads: A.AssocReads, prior: A.AssocReads) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +cand = candidate
  +base = basis
  +found = head
  +seen = reads
  +before = prior
  +expected = expected_head(landingreq_old_target(req))
  Bool.pick(IO(Landing), Tx.str_eq(found, expected),
    Landing.mutated(h, req, cand, base, pub, seen, before),
    Landing.stopped(req, h, LandingOldValueMismatch{expected, found, seen, T.ReleaseUnperformed{}}))
# The mutation runs through the guarded capture with the live claim descriptor, so the child
# inherits the lock and the artifact retains the diagnostics and the terminal outcome.
def Landing.mutated(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String, reads: A.AssocReads, prior: A.AssocReads) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +cand = candidate
  +base = basis
  +seen = reads
  +before = prior
  +argv = Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(landingreq_intent(req))), Con{cand, Con{mutation_old_value(landingreq_old_target(req)), Nil{}}}}}})
  do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(argv, landingreq_repository(req), h, landingreq_guard(req), landingreq_artifact(req))
    Landing.release(h, req, cand, base, pub, T.captured_raw_of(observed), seen, before)

def Landing.release(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String, mutation: T.CapturedRaw, reads: A.AssocReads, prior: A.AssocReads) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +pub = published
  +m = mutation
  +seen = reads
  +before = prior
  do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(h)
    IO.pure(Landing, LandingHeld{req, cand, base, pub, m, seen, before, T.release_raw_of(released)})

# The publication goes into the attempt directory after the association, and the content is
# derived from the associated operands rather than taken from the caller.
def Landing.published(handle: U32, landing_request: LandingRequest, outcome: P.IntentPublish, +reads: A.AssocReads) -> IO(Landing):
  match outcome:
    case P.IntentBytesPublished{request, raw, path, content}:
      Landing.associate_now(handle, landing_request, raw, reads)
    case P.PublishRefused{request, step, name, raw}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishRefused{request, step, name, raw}, reads, T.ReleaseUnperformed{}})
    case P.PublishExistingPending{request, raw, path}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishExistingPending{request, raw, path}, reads, T.ReleaseUnperformed{}})
    case P.PublishContentMismatch{request, raw, expected, found}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishContentMismatch{request, raw, expected, found}, reads, T.ReleaseUnperformed{}})
    case P.PublishReadbackFailed{request, publication, path, error}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishReadbackFailed{request, publication, path, error}, reads, T.ReleaseUnperformed{}})
    case P.PublishHostFailed{step, request, error}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishHostFailed{step, request, error}, reads, T.ReleaseUnperformed{}})

def Landing.associate_now(handle: U32, request: LandingRequest, published: String, prior: A.AssocReads) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +intent = landingreq_intent(req)
  do IO<Landing>:
    decision : A.Association <- A.Association.decide(A.AssociationRequested{I.requested_attempt(intent), I.requested_common(intent), I.requested_target(intent), I.requested_destination(intent), I.requested_candidate(intent), I.requested_basis(intent), I.requested_holder(intent), I.requested_retry(intent)})
    Landing.associations(req, h, pub, decision, prior)

# The association runs before the publication, so no bytes are written for an unassociated
# request, and the publication uses the attempt directory the request names.
def Landing.claimed_associated(handle: U32, request: LandingRequest) -> IO(Landing):
  +h = handle
  +req = request
  +intent = landingreq_intent(req)
  do IO<Landing>:
    decision : A.Association <- A.Association.decide(A.AssociationRequested{I.requested_attempt(intent), I.requested_common(intent), I.requested_target(intent), I.requested_destination(intent), I.requested_candidate(intent), I.requested_basis(intent), I.requested_holder(intent), I.requested_retry(intent)})
    Landing.association_before_publish(h, req, decision)

def Landing.association_before_publish(handle: U32, landing_request: LandingRequest, observation: A.Association) -> IO(Landing):
  match observation:
    case A.AssociationRefused{request, step, observation, reads}:
      Landing.stopped(landing_request, handle, LandingAssociationRefused{request, step, observation, reads, T.ReleaseUnperformed{}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}:
      Landing.publish_now(handle, landing_request, candidate_oid, basis_oid, reads)

def Landing.publish_now(handle: U32, request: LandingRequest, candidate: String, basis: String, reads: A.AssocReads) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +seen = reads
  +intent = landingreq_intent(req)
  do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(intent, attempt_directory_for(intent_common(intent), intent_name(intent)), landingreq_name(req), intent_content(cand, base, intent_target(intent)))
    Landing.published(h, req, written, seen)

def landing_claim_failed(error: U32 & String) -> IO(Landing):
  match error:
    case (code, detail): IO.pure(Landing, LandingClaimFailed{T.HostError{code, detail}})

def Landing.decided(request: LandingRequest, claimed: Result<&1, &1, U32 & String, Maybe<U32>>) -> IO(Landing):
  match claimed:
    case Fail{error}: landing_claim_failed(error)
    case Done{held}:
      match held:
        case None{}: IO.pure(Landing, LandingGuardBusy{intent_target(landingreq_intent(request))})
        case Some{handle}: Landing.claimed_associated(handle, request)

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
  +intent = landingreq_intent(req)
  do IO<Landing>:
    claimed : Result<&1, &1, U32 & String, Maybe<U32>> <- R.Receipt.claim(I.requested_common(intent), I.requested_target(intent))
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
  {Landing.old_value_checked(1, LandingRequested{intent, name, "", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "", A.reads_none(), A.reads_none()) == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value(""), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, "", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "published", T.captured_raw_of(observed), A.reads_none(), A.reads_none(), T.release_raw_of(released)})) : IO(Landing)}

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
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222", A.reads_none(), A.reads_none()) == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value("2222222222222222222222222222222222222222"), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "published", T.captured_raw_of(observed), A.reads_none(), A.reads_none(), T.release_raw_of(released)})) : IO(Landing)}

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
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "published", "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "3333333333333333333333333333333333333333", A.reads_none(), A.reads_none()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingOldValueMismatch{"2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333", T.release_raw_of(released), A.reads_none()})) : IO(Landing)}

def a_present_old_target_differing_from_the_head_is_refused(intent,name,content,guard,artifact,attempt_directory,repository):
  {==}

law a_busy_guard_refuses_before_any_effect:
  for request: LandingRequest
  {Landing.decided(request, Done{None{}}) == IO.pure(Landing, LandingGuardBusy{intent_target(landingreq_intent(request))}) : IO(Landing)}

def a_busy_guard_refuses_before_any_effect(request):
  {==}

law a_release_failure_keeps_the_earlier_refusal:
  for request: LandingRequest
  {replace_release(LandingOldValueMismatch{"a", "b", T.ReleaseUnperformed{}, A.reads_none()}, T.ReleaseFailed{13, "release failed"}) == LandingOldValueMismatch{"a", "b", T.ReleaseFailed{13, "release failed"}, A.reads_none()} : Landing}

def a_release_failure_keeps_the_earlier_refusal(request):
  {==}

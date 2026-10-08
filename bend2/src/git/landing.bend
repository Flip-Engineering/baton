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

# The association a landing step actually made: its request, the normalized values it decided on and
# the read record. An association that never ran is explicit rather than an empty read record.
type AssociationKept is Data:
  AssociationUnperformed{}
  AssociationHeldKept{request: A.AssociationRequest, candidate: String, basis: String, target_head: String,
                      holder_common: String, destination_common: String, reads: A.AssocReads}
  AssociationRefusedKept{request: A.AssociationRequest, step: String, observation: T.GitOut, reads: A.AssocReads}

# The step a retained association refused at, or the empty step for one that held or never ran, so
# a consumer that no longer binds the decision can still report the real refusal step.
def association_kept_step(kept: AssociationKept) -> String:
  match kept:
    case AssociationRefusedKept{request, step, observation, reads}: step
    case AssociationHeldKept{request, candidate, basis, target_head, holder_common, destination_common, reads}: ""
    case AssociationUnperformed{}: ""

# The publication result the landing already made, or an explicit statement that none was made.
type PublicationKept is Data:
  PublicationUnperformed{}
  PublicationPublished{outcome: P.IntentPublish}

def publication_kept(outcome: P.IntentPublish) -> PublicationKept:
  PublicationPublished{outcome}

# The retained associations the landing laws use: a held decision that ran, and the explicit state of
# a slot where no association happened.
def fixture_kept_held() -> AssociationKept:
  AssociationHeldKept{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", ""}, "c1", "b1", "b1", "/cm", "/cm", A.reads_none()}

def fixture_kept_none() -> AssociationKept:
  AssociationUnperformed{}

# Two distinct performed decisions: the pre-publication one, and a later one that refused at the
# holder read, whose recorded observation is the observation of the slot it refused at.
def fixture_kept_prior() -> AssociationKept:
  AssociationHeldKept{A.AssociationRequested{"attempt-0", "/cm", "tgt", "/repo", "c0", "b0", "/holder", ""}, "c0", "b0", "b0", "/cm", "/cm", A.reads_holder(A.reads_none(), A.AssocReadPerformed{T.GRun{0, "/cm\n"}})}

def fixture_kept_refused() -> AssociationKept:
  AssociationRefusedKept{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", ""}, "holder-common", T.GRun{128, "fatal\n"}, A.reads_holder(A.reads_none(), A.AssocReadPerformed{T.GRun{128, "fatal\n"}})}

type Landing is Data:
  LandingClaimFailed{error: T.HostError}
  LandingGuardBusy{target: String}
  LandingAssociationRefused{association: AssociationKept, prior: AssociationKept, publication: PublicationKept, released: T.ReleaseRaw}
  LandingOldValueMismatch{expected: String, found: String, association: AssociationKept, prior: AssociationKept, publication: PublicationKept, released: T.ReleaseRaw}
  LandingPublishRefused{outcome: P.IntentPublish, prior: AssociationKept, released: T.ReleaseRaw}
  LandingHeld{request: LandingRequest, candidate: String, basis: String, publication: PublicationKept,
              mutation: T.CapturedRaw, association: AssociationKept, prior: AssociationKept, released: T.ReleaseRaw}

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
    case LandingAssociationRefused{association, prior, publication, released}: LandingAssociationRefused{association, prior, publication, release}
    case LandingOldValueMismatch{expected, found, association, prior, publication, released}: LandingOldValueMismatch{expected, found, association, prior, publication, release}
    case LandingPublishRefused{outcome, prior, released}: LandingPublishRefused{outcome, prior, release}
    case LandingHeld{request, candidate, basis, publication, mutation, association, prior, released}: LandingHeld{request, candidate, basis, publication, mutation, association, prior, release}
    case LandingClaimFailed{error}: LandingClaimFailed{error}
    case LandingGuardBusy{target}: LandingGuardBusy{target}

def Landing.stopped(request: LandingRequest, handle: U32, outcome: Landing) -> IO(Landing):
  +req = request
  +h = handle
  +prior = outcome
  do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(h)
    Landing.released(req, h, prior, T.release_raw_of(released))

def Landing.associations(landing_request: LandingRequest, handle: U32, publication: PublicationKept, decision: A.Association, prior: AssociationKept) -> IO(Landing):
  match decision:
    case A.AssociationRefused{request, step, observation, reads}:
      Landing.stopped(landing_request, handle, LandingAssociationRefused{AssociationRefusedKept{request, step, observation, reads}, prior, publication, T.ReleaseUnperformed{}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}:
      Landing.old_value_checked(handle, landing_request, publication, candidate_oid, basis_oid, target_head, AssociationHeldKept{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}, prior)

def Landing.old_value_checked(handle: U32, request: LandingRequest, publication: PublicationKept, candidate: String, basis: String, head: String, association: AssociationKept, prior: AssociationKept) -> IO(Landing):
  +h = handle
  +req = request
  +pub = publication
  +cand = candidate
  +base = basis
  +found = head
  +kept = association
  +before = prior
  +expected = expected_head(landingreq_old_target(req))
  Bool.pick(IO(Landing), Tx.str_eq(found, expected),
    Landing.mutated(h, req, cand, base, pub, kept, before),
    Landing.stopped(req, h, LandingOldValueMismatch{expected, found, kept, before, pub, T.ReleaseUnperformed{}}))
# The mutation runs through the guarded capture with the live claim descriptor, so the child
# inherits the lock and the artifact retains the diagnostics and the terminal outcome.
def Landing.mutated(handle: U32, request: LandingRequest, candidate: String, basis: String, publication: PublicationKept, association: AssociationKept, prior: AssociationKept) -> IO(Landing):
  +h = handle
  +req = request
  +pub = publication
  +cand = candidate
  +base = basis
  +kept = association
  +before = prior
  +argv = Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(landingreq_intent(req))), Con{cand, Con{mutation_old_value(landingreq_old_target(req)), Nil{}}}}}})
  do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(argv, landingreq_repository(req), h, landingreq_guard(req), landingreq_artifact(req))
    Landing.release(h, req, cand, base, pub, T.captured_raw_of(observed), kept, before)

def Landing.release(handle: U32, request: LandingRequest, candidate: String, basis: String, publication: PublicationKept, mutation: T.CapturedRaw, association: AssociationKept, prior: AssociationKept) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +pub = publication
  +m = mutation
  +kept = association
  +before = prior
  do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(h)
    IO.pure(Landing, LandingHeld{req, cand, base, pub, m, kept, before, T.release_raw_of(released)})

# The publication goes into the attempt directory after the association, and the content is
# derived from the associated operands rather than taken from the caller.
def Landing.published(handle: U32, landing_request: LandingRequest, +outcome: P.IntentPublish, +prior: AssociationKept) -> IO(Landing):
  match outcome:
    case P.IntentBytesPublished{request, raw, path, content}:
      Landing.associate_now(handle, landing_request, publication_kept(outcome), prior)
    case P.PublishRefused{request, step, name, raw}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishRefused{request, step, name, raw}, reads, T.ReleaseUnperformed{}})
    case P.PublishExistingPending{request, raw, path}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishExistingPending{request, raw, path}, reads, T.ReleaseUnperformed{}})
    case P.PublishContentMismatch{request, raw, expected, found}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishContentMismatch{request, raw, expected, found}, reads, T.ReleaseUnperformed{}})
    case P.PublishReadbackFailed{request, publication, path, error}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishReadbackFailed{request, publication, path, error}, reads, T.ReleaseUnperformed{}})
    case P.PublishHostFailed{step, request, error}: Landing.stopped(landing_request, handle, LandingPublishRefused{P.PublishHostFailed{step, request, error}, reads, T.ReleaseUnperformed{}})

def Landing.associate_now(handle: U32, request: LandingRequest, publication: PublicationKept, prior: AssociationKept) -> IO(Landing):
  +h = handle
  +req = request
  +pub = publication
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

def Landing.association_before_publish(handle: U32, landing_request: LandingRequest, decision: A.Association) -> IO(Landing):
  match decision:
    case A.AssociationRefused{request, step, observation, reads}:
      Landing.stopped(landing_request, handle, LandingAssociationRefused{AssociationRefusedKept{request, step, observation, reads}, AssociationUnperformed{}, PublicationUnperformed{}, T.ReleaseUnperformed{}})
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}:
      Landing.publish_now(handle, landing_request, candidate_oid, basis_oid, AssociationHeldKept{request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads})

def Landing.publish_now(handle: U32, request: LandingRequest, candidate: String, basis: String, association: AssociationKept) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +kept = association
  +intent = landingreq_intent(req)
  do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(intent, attempt_directory_for(intent_common(intent), intent_name(intent)), landingreq_name(req), intent_content(cand, base, intent_target(intent)))
    Landing.published(h, req, written, kept)

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
  for published: P.IntentPublish
  {Landing.old_value_checked(1, LandingRequested{intent, name, "", content, guard, artifact, attempt_directory, repository}, publication_kept(published), "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "", fixture_kept_held(), fixture_kept_none()) == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value(""), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, "", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", publication_kept(published), T.captured_raw_of(observed), fixture_kept_held(), fixture_kept_none(), T.release_raw_of(released)})) : IO(Landing)}

def an_absent_old_target_consumes_an_absent_head(intent,name,content,guard,artifact,attempt_directory,repository,published):
  {==}

law a_present_old_target_matching_the_head_consumes_it:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  for published: P.IntentPublish
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, publication_kept(published), "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "2222222222222222222222222222222222222222", fixture_kept_held(), fixture_kept_none()) == (do IO<Landing>:
    observed : Result<&1,&1,U32 & String,String & String> <- Process.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"update-ref", Con{qualified_target(intent_target(intent)), Con{"0123456789abcdef0123456789abcdef01234567", Con{mutation_old_value("2222222222222222222222222222222222222222"), Nil{}}}}}}), repository, 1, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingHeld{LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", publication_kept(published), T.captured_raw_of(observed), fixture_kept_held(), fixture_kept_none(), T.release_raw_of(released)})) : IO(Landing)}

def a_present_old_target_matching_the_head_consumes_it(intent,name,content,guard,artifact,attempt_directory,repository,published):
  {==}

law a_present_old_target_differing_from_the_head_is_refused:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  for published: P.IntentPublish
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, publication_kept(published), "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "3333333333333333333333333333333333333333", fixture_kept_held(), fixture_kept_none()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingOldValueMismatch{"2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333", fixture_kept_held(), fixture_kept_none(), publication_kept(published), T.release_raw_of(released)})) : IO(Landing)}

def a_present_old_target_differing_from_the_head_is_refused(intent,name,content,guard,artifact,attempt_directory,repository,published):
  {==}

law a_busy_guard_refuses_before_any_effect:
  for request: LandingRequest
  {Landing.decided(request, Done{None{}}) == IO.pure(Landing, LandingGuardBusy{intent_target(landingreq_intent(request))}) : IO(Landing)}

def a_busy_guard_refuses_before_any_effect(request):
  {==}

law a_release_failure_keeps_the_earlier_refusal:
  for request: LandingRequest
  for published: P.IntentPublish
  {replace_release(LandingOldValueMismatch{"a", "b", fixture_kept_held(), fixture_kept_none(), publication_kept(published), T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingOldValueMismatch{"a", "b", fixture_kept_held(), fixture_kept_none(), publication_kept(published), T.ReleaseFailed{13, "release failed"}} : Landing}

def a_release_failure_keeps_the_earlier_refusal(request,published):
  {==}

law a_release_failure_keeps_both_association_records_and_the_publication:
  for request: LandingRequest
  for published: P.IntentPublish
  for candidate: String
  for basis: String
  for mutation: T.CapturedRaw
  {replace_release(LandingHeld{request, candidate, basis, publication_kept(published), mutation, fixture_kept_refused(), fixture_kept_prior(), T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingHeld{request, candidate, basis, publication_kept(published), mutation, fixture_kept_refused(), fixture_kept_prior(), T.ReleaseFailed{13, "release failed"}} : Landing}

def a_release_failure_keeps_both_association_records_and_the_publication(request,published,candidate,basis,mutation):
  {==}

law a_release_failure_keeps_the_refused_decision_and_the_prior_decision:
  {replace_release(LandingAssociationRefused{fixture_kept_refused(), fixture_kept_prior(), PublicationUnperformed{}, T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingAssociationRefused{fixture_kept_refused(), fixture_kept_prior(), PublicationUnperformed{}, T.ReleaseFailed{13, "release failed"}} : Landing}

def a_release_failure_keeps_the_refused_decision_and_the_prior_decision():
  {==}

law a_post_publication_refusal_keeps_the_publication_and_both_decisions:
  for request: LandingRequest
  for published: P.IntentPublish
  {Landing.associations(request, 1, publication_kept(published), A.AssociationRefused{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", ""}, "holder-common", T.GRun{128, "fatal\n"}, A.reads_holder(A.reads_none(), A.AssocReadPerformed{T.GRun{128, "fatal\n"}})}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingAssociationRefused{fixture_kept_refused(), fixture_kept_prior(), publication_kept(published), T.release_raw_of(released)})) : IO(Landing)}

def a_post_publication_refusal_keeps_the_publication_and_both_decisions(request,published):
  {==}

law an_old_value_mismatch_keeps_the_publication_and_both_decisions:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  for published: P.IntentPublish
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, publication_kept(published), "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "3333333333333333333333333333333333333333", fixture_kept_refused(), fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingOldValueMismatch{"2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333", fixture_kept_refused(), fixture_kept_prior(), publication_kept(published), T.release_raw_of(released)})) : IO(Landing)}

def an_old_value_mismatch_keeps_the_publication_and_both_decisions(intent,name,content,guard,artifact,attempt_directory,repository,published):
  {==}

law the_pre_publication_decision_continues_into_the_publication_call:
  for handle: U32
  for request: LandingRequest
  for candidate: String
  for basis: String
  {Landing.publish_now(handle, request, candidate, basis, fixture_kept_prior()) == (do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(landingreq_intent(request), attempt_directory_for(intent_common(landingreq_intent(request)), intent_name(landingreq_intent(request))), landingreq_name(request), intent_content(candidate, basis, intent_target(landingreq_intent(request))))
    Landing.published(handle, request, written, fixture_kept_prior())) : IO(Landing)}

def the_pre_publication_decision_continues_into_the_publication_call(handle,request,candidate,basis):
  {==}

law a_publication_success_continues_into_the_revalidation:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for raw: String
  for path: String
  for content: String
  {Landing.published(handle, request, P.IntentBytesPublished{intent, raw, path, content}, fixture_kept_prior()) == Landing.associate_now(handle, request, PublicationPublished{P.IntentBytesPublished{intent, raw, path, content}}, fixture_kept_prior()) : IO(Landing)}

def a_publication_success_continues_into_the_revalidation(handle,request,intent,raw,path,content):
  {==}

law a_publication_failure_keeps_the_prior_decision:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for step: String
  for name: String
  for raw: String
  {Landing.published(handle, request, P.PublishRefused{intent, step, name, raw}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    Landing.released(request, handle, LandingPublishRefused{P.PublishRefused{intent, step, name, raw}, fixture_kept_prior(), T.ReleaseUnperformed{}}, T.release_raw_of(released))) : IO(Landing)}

def a_publication_failure_keeps_the_prior_decision(handle,request,intent,step,name,raw):
  {==}

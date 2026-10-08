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

type PublicationKept is Data:
  PublicationUnperformed{}
  PublicationPublished{outcome: P.IntentPublish}

type Landing is Data:
  LandingClaimFailed{error: T.HostError}
  LandingGuardBusy{target: String}
  LandingAssociationRefused{association: AssociationKept, prior: AssociationKept, publication: PublicationKept, released: T.ReleaseRaw}
  LandingOldValueMismatch{expected: String, found: String, association: AssociationKept, prior: AssociationKept, publication: PublicationKept, released: T.ReleaseRaw}
  LandingPublishRefused{outcome: P.IntentPublish, prior: AssociationKept, released: T.ReleaseRaw}
  LandingHeld{request: LandingRequest, candidate: String, basis: String, publication: PublicationKept,
              mutation: T.CapturedRaw, association: AssociationKept, prior: AssociationKept, released: T.ReleaseRaw}

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

def qualified_target(target: String) -> String:
  +t = target
  Tx.str_cat("refs/heads/", t)

law the_zero_object_name_is_only_the_mutation_argument:
  {mutation_old_value("") == "0000000000000000000000000000000000000000" : String}

law an_absent_old_target_expects_an_absent_head:
  {expected_head("") == "" : String}

law a_present_old_target_expects_itself:
  {expected_head("0123456789abcdef0123456789abcdef01234567") == "0123456789abcdef0123456789abcdef01234567" : String}

law the_target_is_qualified_once:
  {qualified_target("main") == "refs/heads/main" : String}

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

law a_busy_guard_refuses_before_any_effect:
  for request: LandingRequest
  {Landing.decided(request, Done{None{}}) == IO.pure(Landing, LandingGuardBusy{intent_target(landingreq_intent(request))}) : IO(Landing)}

law a_release_failure_keeps_the_earlier_refusal:
  for request: LandingRequest
  for published: P.IntentPublish
  {replace_release(LandingOldValueMismatch{"a", "b", fixture_kept_held(), fixture_kept_none(), publication_kept(published), T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingOldValueMismatch{"a", "b", fixture_kept_held(), fixture_kept_none(), publication_kept(published), T.ReleaseFailed{13, "release failed"}} : Landing}

law a_release_failure_keeps_both_association_records_and_the_publication:
  for request: LandingRequest
  for published: P.IntentPublish
  for candidate: String
  for basis: String
  for mutation: T.CapturedRaw
  {replace_release(LandingHeld{request, candidate, basis, publication_kept(published), mutation, fixture_kept_current(), fixture_kept_prior(), T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingHeld{request, candidate, basis, publication_kept(published), mutation, fixture_kept_current(), fixture_kept_prior(), T.ReleaseFailed{13, "release failed"}} : Landing}

law a_release_failure_keeps_the_refused_decision_and_the_prior_decision:
  {replace_release(LandingAssociationRefused{fixture_kept_refused(), fixture_kept_prior(), PublicationUnperformed{}, T.ReleaseUnperformed{}}, T.ReleaseFailed{13, "release failed"}) == LandingAssociationRefused{fixture_kept_refused(), fixture_kept_prior(), PublicationUnperformed{}, T.ReleaseFailed{13, "release failed"}} : Landing}

law a_post_publication_refusal_keeps_the_publication_and_both_decisions:
  for request: LandingRequest
  for published: P.IntentPublish
  {Landing.associations(request, 1, publication_kept(published), A.AssociationRefused{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", ""}, "holder-common", T.GRun{128, "fatal\n"}, A.reads_holder(A.reads_none(), A.AssocReadPerformed{T.GRun{128, "fatal\n"}})}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingAssociationRefused{AssociationRefusedKept{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", ""}, "holder-common", T.GRun{128, "fatal\n"}, A.reads_holder(A.reads_none(), A.AssocReadPerformed{T.GRun{128, "fatal\n"}})}, fixture_kept_prior(), publication_kept(published), T.release_raw_of(released)})) : IO(Landing)}

law an_old_value_mismatch_keeps_the_publication_and_both_decisions:
  for intent: I.IntentInput
  for name: String
  for content: String
  for guard: String
  for artifact: String
  for attempt_directory: String
  for repository: String
  for published: P.IntentPublish
  {Landing.old_value_checked(1, LandingRequested{intent, name, "2222222222222222222222222222222222222222", content, guard, artifact, attempt_directory, repository}, publication_kept(published), "0123456789abcdef0123456789abcdef01234567", "1111111111111111111111111111111111111111", "3333333333333333333333333333333333333333", fixture_kept_current(), fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(1)
    IO.pure(Landing, LandingOldValueMismatch{"2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333", fixture_kept_current(), fixture_kept_prior(), publication_kept(published), T.release_raw_of(released)})) : IO(Landing)}

law the_pre_publication_decision_continues_into_the_publication_call:
  for handle: U32
  for request: LandingRequest
  for candidate: String
  for basis: String
  {Landing.publish_now(handle, request, candidate, basis, fixture_kept_prior()) == (do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(landingreq_intent(request), attempt_directory_for(intent_common(landingreq_intent(request)), intent_name(landingreq_intent(request))), landingreq_name(request), intent_content(candidate, basis, intent_target(landingreq_intent(request))))
    Landing.published(handle, request, written, fixture_kept_prior())) : IO(Landing)}

law a_publication_success_continues_into_the_revalidation:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for raw: String
  for path: String
  for content: String
  {Landing.published(handle, request, P.IntentBytesPublished{intent, raw, path, content}, fixture_kept_prior()) == Landing.associate_now(handle, request, PublicationPublished{P.IntentBytesPublished{intent, raw, path, content}}, fixture_kept_prior()) : IO(Landing)}

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

law a_held_decision_is_retained_and_continues_into_the_publication_call:
  for handle: U32
  for request: LandingRequest
  for candidate: String
  for basis: String
  for target_head: String
  for holder_common: String
  for destination_common: String
  for reads: A.AssocReads
  {Landing.association_before_publish(handle, request, A.AssociationHeld{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", candidate, basis, "/holder", ""}, candidate, basis, target_head, holder_common, destination_common, reads}) == Landing.publish_now(handle, request, candidate, basis, AssociationHeldKept{A.AssociationRequested{"attempt-1", "/cm", "tgt", "/repo", candidate, basis, "/holder", ""}, candidate, basis, target_head, holder_common, destination_common, reads}) : IO(Landing)}

law a_publication_host_failure_keeps_the_prior_decision:
  for handle: U32
  for request: LandingRequest
  for step: String
  for intent: I.IntentInput
  for error: T.HostError
  {Landing.published(handle, request, P.PublishHostFailed{step, intent, error}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    Landing.released(request, handle, LandingPublishRefused{P.PublishHostFailed{step, intent, error}, fixture_kept_prior(), T.ReleaseUnperformed{}}, T.release_raw_of(released))) : IO(Landing)}

law a_publication_content_mismatch_keeps_the_prior_decision:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for raw: String
  for expected: String
  for found: String
  {Landing.published(handle, request, P.PublishContentMismatch{intent, raw, expected, found}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    Landing.released(request, handle, LandingPublishRefused{P.PublishContentMismatch{intent, raw, expected, found}, fixture_kept_prior(), T.ReleaseUnperformed{}}, T.release_raw_of(released))) : IO(Landing)}

law a_publication_existing_pending_keeps_the_prior_decision:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for raw: String
  for path: String
  {Landing.published(handle, request, P.PublishExistingPending{intent, raw, path}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    Landing.released(request, handle, LandingPublishRefused{P.PublishExistingPending{intent, raw, path}, fixture_kept_prior(), T.ReleaseUnperformed{}}, T.release_raw_of(released))) : IO(Landing)}

law a_publication_readback_failure_keeps_the_prior_decision:
  for handle: U32
  for request: LandingRequest
  for intent: I.IntentInput
  for publication: String
  for path: String
  for error: T.HostError
  {Landing.published(handle, request, P.PublishReadbackFailed{intent, publication, path, error}, fixture_kept_prior()) == (do IO<Landing>:
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    Landing.released(request, handle, LandingPublishRefused{P.PublishReadbackFailed{intent, publication, path, error}, fixture_kept_prior(), T.ReleaseUnperformed{}}, T.release_raw_of(released))) : IO(Landing)}

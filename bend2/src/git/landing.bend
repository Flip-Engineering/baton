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

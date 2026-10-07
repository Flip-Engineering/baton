# The guarded landing chain: claim the guard, record the intent, read the association, then
# move the ref against the old value the caller read, and release the claim.
#
# The claim taken here is a live locked descriptor: Receipt.claim holds it and Receipt.release
# frees it, so the association reads in between happen while the guard is held, without
# threading a claim integer through effects that do not use one. The mutation is
# `update-ref <ref> <new> <old>`, git's compare and swap: it fails if the ref no longer
# points at the old value the caller read, which is the old-value compare this chain
# preserves. The reference is a qualified literal ref name and --end-of-options is not needed
# for update-ref, but the target the caller supplies is qualified here once, so every step
# compares the same name.
#
# Nothing here is executed by writing it. The terminal or uncertain outcome of the mutation
# and of the release is retained separately, and a release failure does not erase the
# mutation's observation.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./association.bend as A
import ./intent.bend as I
import ./intent-publish.bend as P
import ./process.bend as Git
import ../host/receipt.bend as R

type LandingRequest is Data:
  LandingRequested{intent: I.IntentInput, name: String, old_target: String, content: String}

type Landing is Data:
  LandingClaimFailed{error: U32 & String}
  LandingGuardBusy{target: String}
  LandingRefused{step: String, detail: String}
  LandingHeld{request: LandingRequest, candidate: String, basis: String, published: String, update: T.GitOut, released: Result<U32 & String, Unit>}

def zero_oid() -> String:
  "0000000000000000000000000000000000000000"

def qualified_target(target: String) -> String:
  +t = target
  Tx.str_cat("refs/heads/", t)

def old_value_for(old_target: String) -> String:
  +o = old_target
  match Tx.str_eq(o, ""):
    case True{}: zero_oid()
    case False{}: o

def refuse(step: String, detail: String) -> IO(Landing):
  +s = step
  +d = detail
  IO.pure(Landing, LandingRefused{s, d})

# The release happens on the ordinary path and its observation is kept beside the mutation's.
def Landing.release(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String, update: T.GitOut) -> IO(Landing):
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +pub = published
  +u = update
  do IO<Landing>:
    released : Result<U32 & String, Unit> <- R.Receipt.release(h)
    IO.pure(Landing, LandingHeld{req, cand, base, pub, u, released})

def Landing.associated(handle: U32, request: LandingRequest, published: String, observation: A.Association) -> IO(Landing):
  +h = handle
  +req = request
  +pub = published
  +obs = observation
  match obs:
    case A.AssociationRefused{step, observation}:
      Landing.release_after_refusal(h, req, step)
    case A.AssociationHeld{request, candidate_oid, basis_oid, target_head, holder_common, destination_common}:
      Landing.old_value_checked(h, req, pub, candidate_oid, basis_oid, target_head)

# A refusal still releases the claim: the guard is not left held by a decision that stopped.
def Landing.release_after_refusal(handle: U32, request: LandingRequest, step: String) -> IO<Landing>:
  +h = handle
  +req = request
  +s = step
  do IO<Landing>:
    released : Result<U32 & String, Unit> <- R.Receipt.release(h)
    IO.pure(Landing, LandingRefused{s, "the association refused and the claim was released"})

def Landing.old_value_checked(handle: U32, request: LandingRequest, published: String, candidate: String, basis: String, head: String) -> IO<Landing>:
  +h = handle
  +req = request
  +pub = published
  +cand = candidate
  +base = basis
  +observed_head = head
  +expected = old_value_for(req.old_target)
  match Tx.str_eq(observed_head, expected):
    case False{}: Landing.release_after_refusal(h, req, "old-target")
    case True{}: Landing.mutated(h, req, cand, base, pub, expected)

# git's compare and swap: the ref must still point at the old value the caller read.
def Landing.mutated(handle: U32, request: LandingRequest, candidate: String, basis: String, published: String, old_value: String) -> IO<Landing>:
  +h = handle
  +req = request
  +cand = candidate
  +base = basis
  +pub = published
  +old = old_value
  do IO<Landing>:
    update : T.GitOut <- Git.runGit(req.intent.holder, ["update-ref", qualified_target(req.intent.target), cand, old])
    Landing.release(h, req, cand, base, pub, update)

def Landing.published(handle: U32, request: LandingRequest, outcome: P.IntentPublish) -> IO<Landing>:
  +h = handle
  +req = request
  +out = outcome
  match out:
    case P.IntentBytesPublished{request, raw, path, content}:
      Landing.associated_now(h, req, raw)
    case P.PublishRefused{request, step, name, raw}: Landing.release_after_refusal(h, req, step)
    case P.PublishExistingPending{request, raw, path}: Landing.release_after_refusal(h, req, "existing-pending")
    case P.PublishContentMismatch{request, raw, expected, found}: Landing.release_after_refusal(h, req, "content-mismatch")
    case P.PublishReadbackFailed{request, publication, path, error}: Landing.release_after_refusal(h, req, "readback")
    case P.PublishHostFailed{step, request, error}: Landing.release_after_refusal(h, req, step)

def Landing.associated_now(handle: U32, request: LandingRequest, published: String) -> IO<Landing>:
  +h = handle
  +req = request
  +pub = published
  +intent = req.intent
  do IO<Landing>:
    decision : A.Association <- A.Association.decide(A.AssociationRequested{intent.attempt, intent.common, intent.target, intent.destination, intent.candidate, intent.basis, intent.holder, intent.retry})
    Landing.associated(h, req, pub, decision)

def Landing.claimed(handle: U32, request: LandingRequest) -> IO<Landing>:
  +h = handle
  +req = request
  +intent = req.intent
  do IO<Landing>:
    written : P.IntentPublish <- P.Intent.publish_intent(intent, intent.common, req.name, req.content)
    Landing.published(h, req, written)

def Landing.decided(request: LandingRequest, claimed: Result<U32 & String, Maybe<U32>>) -> IO<Landing>:
  +req = request
  +res = claimed
  match res:
    case Fail{error}: IO.pure(Landing, LandingClaimFailed{error})
    case Done{held}:
      match held:
        case None{}: IO.pure(Landing, LandingGuardBusy{req.intent.target})
        case Some{handle}: Landing.claimed(handle, req)

# The entry: one claim for the whole finite chain of reads, publication and mutation.
def Landing.run(request: LandingRequest) -> IO(Landing):
  +req = request
  +intent = req.intent
  do IO<Landing>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(intent.common, intent.target)
    Landing.decided(req, claimed)

law an_absent_old_target_uses_the_zero_object_name:
  {old_value_for("") == "0000000000000000000000000000000000000000" : String}

def an_absent_old_target_uses_the_zero_object_name():
  {==}

law a_present_old_target_is_used_unchanged:
  {old_value_for("0123456789abcdef0123456789abcdef01234567") == "0123456789abcdef0123456789abcdef01234567" : String}

def a_present_old_target_is_used_unchanged():
  {==}

law the_target_is_qualified_once:
  {qualified_target("main") == "refs/heads/main" : String}

def the_target_is_qualified_once():
  {==}

law a_busy_guard_refuses_before_any_effect:
  for request: LandingRequest
  {Landing.decided(request, Done{None{}}) == IO.pure(Landing, LandingGuardBusy{request.intent.target}) : IO(Landing)}

def a_busy_guard_refuses_before_any_effect(request):
  {==}

law a_failed_claim_refuses_with_its_own_error:
  for request: LandingRequest
  {Landing.decided(request, Fail{(13, "i/o error")}) == IO.pure(Landing, LandingClaimFailed{(13, "i/o error")}) : IO(Landing)}

def a_failed_claim_refuses_with_its_own_error(request):
  {==}

law the_chain_claims_once_and_decides_from_the_claim:
  for request: LandingRequest
  {Landing.run(request) == (do IO<Landing>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(request.intent.common, request.intent.target)
    Landing.decided(request, claimed)) : IO(Landing)}

def the_chain_claims_once_and_decides_from_the_claim(request):
  {==}

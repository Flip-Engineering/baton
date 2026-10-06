# A low-level guarded capture over the receipt claim and the guarded host effect.
#
# This is NOT an attempt identity and NOT the admitted publication operation. The pair of
# common directory and target is the guard RESOURCE key: successive attempts on the same
# target share it. There is no candidate, basis, destination, holder or retry association
# here, no qualified intent input, and no Receipt.publish or Receipt.qualify call. It
# captures under a claim and records what happened; publication is composed on top of it
# under custody, with qualification, the protected association, and the post-effect
# evidence written before the guard is released. The qualification side is intent.bend.
#
# The returned boundary keeps the effect observation and the release observation as
# separate fields of one variant, so a completed effect is never discarded by a release
# failure, two failures both survive, and a release failure is never retagged as an effect
# failure that would invite a replay of an effect that already ran.
import Base
import ./process.bend as P
import ../host/receipt.bend as R

type AttemptCapture is Data:
  AttemptClaimFailed{error: U32 & String}
  AttemptClaimBusy{target: String}
  AttemptCaptured{observed: Result<&1,&1,U32 & String,String & String>, released: Result<U32 & String,Unit>}

def attempt_disposition(capture: AttemptCapture) -> String:
  match capture:
    case AttemptClaimFailed{error}: "claim-failed"
    case AttemptClaimBusy{target}: "claim-busy"
    case AttemptCaptured{observed, released}: "captured"

def capture_began(capture: AttemptCapture) -> Bool:
  match capture:
    case AttemptClaimFailed{error}: False{}
    case AttemptClaimBusy{target}: False{}
    case AttemptCaptured{observed, released}: True{}

law a_failed_claim_records_no_capture:
  for error: U32 & String
  {capture_began(AttemptClaimFailed{error}) == False{} : Bool}

def a_failed_claim_records_no_capture(error):
  {==}

law a_busy_guard_records_no_capture:
  for target: String
  {capture_began(AttemptClaimBusy{target}) == False{} : Bool}

def a_busy_guard_records_no_capture(target):
  {==}

law an_acquired_claim_reports_the_captured_disposition:
  for observed: Result<&1,&1,U32 & String,String & String>
  for released: Result<U32 & String,Unit>
  {attempt_disposition(AttemptCaptured{observed, released}) == "captured" : String}

def an_acquired_claim_reports_the_captured_disposition(observed,released):
  {==}

# The chain, leaf first. The release is attempted only where a handle exists.
def Attempt.under_claim(handle: U32, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  do IO<AttemptCapture>:
    observed : Result<&1,&1,U32 & String,String & String> <- P.Process.capture_holding(argv, cwd, handle, guard, artifact)
    released : Result<U32 & String, Unit> <- R.Receipt.release(handle)
    IO.pure(AttemptCapture, AttemptCaptured{observed, released})

def Attempt.held(held: Maybe<U32>, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  match held:
    case None{}: IO.pure(AttemptCapture, AttemptClaimBusy{target})
    case Some{handle}: Attempt.under_claim(handle, guard, artifact, argv, cwd)

def Attempt.claimed(claimed: Result<U32 & String, Maybe<U32>>, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  match claimed:
    case Fail{error}: IO.pure(AttemptCapture, AttemptClaimFailed{error})
    case Done{held}: Attempt.held(held, target, guard, artifact, argv, cwd)

# Law of this IO chain, stated here because a repository law is an equation over pure
# expressions and this chain is not one: the effect runs only after the claim was taken,
# the release is attempted on that branch and no other, its observation is kept beside the
# effect's rather than replacing it, and no release success is recorded for a branch in
# which no claim was taken. A failed claim reaches no release because no handle exists.
def Attempt.capture_guarded(common: String, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  do IO<AttemptCapture>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(common, target)
    Attempt.claimed(claimed, target, guard, artifact, argv, cwd)

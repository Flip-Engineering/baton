# A low-level guarded capture over the receipt claim and the guarded host effect.
#
# This is NOT an attempt identity and NOT the admitted publication path. The pair of
# common directory and target is the guard RESOURCE key: successive attempts on the same
# target share it, so it identifies the resource, not the attempt. There is no candidate,
# basis, destination, holder or retry association here, no qualified intent input, and no
# call to Receipt.publish or Receipt.qualify. Publication must be composed on top of this
# under custody, with qualification and the protected association, and the post-effect
# evidence must be recorded before the guard is released; wiring ff_stage5 or ld_advance
# before that would replace public publication with an arbitrary command under a lock.
#
# The returned boundary keeps the effect observation and the release observation as
# separate fields, so a completed effect is never discarded by a release failure and two
# failures both survive. A release failure must not turn evidence of an effect into an
# untagged failure that invites a replay.
import Base
import ./process.bend as P
import ../host/receipt.bend as R

AttemptOutcome{observed: Result<&1,&1,U32 & String,String & String>, released: Result<U32 & String,Unit>}

def Attempt.publish_guarded(common: String, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptOutcome):
  do IO<AttemptOutcome>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(common, target)
    Attempt.claimed(claimed, guard, artifact, argv, cwd)

def Attempt.claimed(claimed: Result<U32 & String, Maybe<U32>>, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptOutcome):
  match claimed:
    case Fail{error}: IO.pure(AttemptOutcome, AttemptOutcome{AttemptNoClaim{error}, AttemptNoRelease{Unit{}}})
    case Done{held}: Attempt.held(held, guard, artifact, argv, cwd)

def Attempt.held(held: Maybe<U32>, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptOutcome):
  match held:
    case None{}: IO.pure(AttemptOutcome, AttemptOutcome{AttemptNoClaim{(1, "another attempt holds the guard for this target and ref")}, AttemptNoRelease{Unit{}}})
    case Some{handle}: Attempt.under_claim(handle, guard, artifact, argv, cwd)

def Attempt.under_claim(handle: U32, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptOutcome):
  do IO<AttemptOutcome>:
    observed : Result<&1,&1,U32 & String,String & String> <- P.Process.capture_holding(argv, cwd, handle, guard, artifact)
    released : Result<U32 & String, Unit> <- R.Receipt.release(handle)
    IO.pure(AttemptOutcome, AttemptOutcome{observed, released})

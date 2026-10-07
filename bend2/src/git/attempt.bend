# A low-level guarded capture over the receipt claim and the guarded host effect.
#
# This is NOT an attempt identity and NOT the admitted publication operation. The pair of
# common directory and target is the guard RESOURCE key: successive attempts on the same
# target share it. It captures under a claim and records what happened; publication is
# composed on top of it under custody, with qualification, the protected association, and
# the post-effect evidence written before the guard is released. The qualification side is
# intent.bend.
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
  AttemptCaptured{observed: Result<&1,&1,U32 & String,String & String>, released: Result<&1, &1, U32 & String, Unit>}

# The chain, leaf first. The release is attempted only where a handle exists.
def Attempt.under_claim(handle: U32, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  do IO<AttemptCapture>:
    observed : Result<&1,&1,U32 & String,String & String> <- P.Process.capture_holding(argv, cwd, handle, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    IO.pure(AttemptCapture, AttemptCaptured{observed, released})

def Attempt.held(held: Maybe<U32>, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  match held:
    case None{}: IO.pure(AttemptCapture, AttemptClaimBusy{target})
    case Some{handle}: Attempt.under_claim(handle, guard, artifact, argv, cwd)

def Attempt.claimed(claimed: Result<&1, &1, U32 & String, Maybe<U32>>, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  match claimed:
    case Fail{error}: IO.pure(AttemptCapture, AttemptClaimFailed{error})
    case Done{held}: Attempt.held(held, target, guard, artifact, argv, cwd)

def Attempt.capture_guarded(common: String, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(AttemptCapture):
  do IO<AttemptCapture>:
    claimed : Result<&1, &1, U32 & String, Maybe<U32>> <- R.Receipt.claim(common, target)
    Attempt.claimed(claimed, target, guard, artifact, argv, cwd)

# Laws over the actual chain. A law here is an expression over effects, so these equate the
# API form with the IO expression it stands for: they state which branch runs no effect at
# all, and that the capture runs the release after the effect and keeps both results.
law a_failed_claim_runs_no_capture:
  for error: U32 & String
  for target: String
  for guard: String
  for artifact: String
  for argv: String
  for cwd: String
  {Attempt.claimed(Fail{error}, target, guard, artifact, argv, cwd) == IO.pure(AttemptCapture, AttemptClaimFailed{error}) : IO(AttemptCapture)}

def a_failed_claim_runs_no_capture(error,target,guard,artifact,argv,cwd):
  {==}

law a_busy_guard_runs_no_capture:
  for target: String
  for guard: String
  for artifact: String
  for argv: String
  for cwd: String
  {Attempt.held(None{}, target, guard, artifact, argv, cwd) == IO.pure(AttemptCapture, AttemptClaimBusy{target}) : IO(AttemptCapture)}

def a_busy_guard_runs_no_capture(target,guard,artifact,argv,cwd):
  {==}

law the_capture_attempts_the_release_after_the_effect_and_keeps_both:
  for handle: U32
  for guard: String
  for artifact: String
  for argv: String
  for cwd: String
  {Attempt.under_claim(handle, guard, artifact, argv, cwd) == (do IO<AttemptCapture>:
    observed : Result<&1,&1,U32 & String,String & String> <- P.Process.capture_holding(argv, cwd, handle, guard, artifact)
    released : Result<&1, &1, U32 & String, Unit> <- R.Receipt.release(handle)
    IO.pure(AttemptCapture, AttemptCaptured{observed, released})) : IO(AttemptCapture)}

def the_capture_attempts_the_release_after_the_effect_and_keeps_both(handle,guard,artifact,argv,cwd):
  {==}

law the_entry_claims_the_guard_then_decides_the_branch:
  for common: String
  for target: String
  for guard: String
  for artifact: String
  for argv: String
  for cwd: String
  {Attempt.capture_guarded(common, target, guard, artifact, argv, cwd) == (do IO<AttemptCapture>:
    claimed : Result<&1, &1, U32 & String, Maybe<U32>> <- R.Receipt.claim(common, target)
    Attempt.claimed(claimed, target, guard, artifact, argv, cwd)) : IO(AttemptCapture)}

def the_entry_claims_the_guard_then_decides_the_branch(common,target,guard,artifact,argv,cwd):
  {==}

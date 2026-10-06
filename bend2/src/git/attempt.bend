# The typed attempt wrapper over the receipt primitive and the guarded host effect.
#
# An attempt is one guarded publication. Its identity is the pair of the canonical
# common directory and the target ref; its evidence is the artifact, which the host
# effect writes and retains; its custody is the claim, which the effect holds through
# the child. The caller supplies the guard path and must have claimed that path: the
# host effect refuses a descriptor that is not the same file as that path.
#
# Constructors for Maybe and the pair returned by the capture effect are assumed here
# as None/Some and an opaque pair; this source has not been compiled and the
# assumption is recorded in the report rather than hidden.
import Base
import ./process.bend as P
import ../host/receipt.bend as R

def Attempt.publish_guarded(common: String, target: String, guard: String, artifact: String, argv: String, cwd: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  do IO<Result<&1,&1,U32 & String,String & String>>:
    claimed : Result<U32 & String, Maybe<U32>> <- R.Receipt.claim(common, target)
    match claimed:
      case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String & String>, Fail{error})
      case Done{held}:
        match held:
          case None{}: IO.pure(Result<&1,&1,U32 & String,String & String>, Fail{(1, "another attempt holds the guard for this target and ref")})
          case Some{handle}:
            observed : Result<&1,&1,U32 & String,String & String> <- P.Process.capture_holding(argv, cwd, handle, guard, artifact)
            released : Result<U32 & String, Unit> <- R.Receipt.release(handle)
            match released:
              case Fail{release_error}:
                match observed:
                  case Fail{effect_error}:
                    IO.pure(Result<&1,&1,U32 & String,String & String>, Fail{effect_error})
                  case Done{evidence}:
                    IO.pure(Result<&1,&1,U32 & String,String & String>, Fail{release_error})
              case Done{unit}:
                IO.pure(Result<&1,&1,U32 & String,String & String>, observed)

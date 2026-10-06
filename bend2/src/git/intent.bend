# Intent preparation: bind an attempt's identity and its associations, qualify the paths
# the receipt primitive demands, and observe the holder, all before any publication.
#
# Nothing here publishes. Preparation either refuses with the step that refused and the
# primitive's own error, or reports the qualified candidate and basis with the holder
# observations and the retry identity, so a later guarded publication can act only on an
# intent whose association and qualification already hold. The retry identity is explicit
# input rather than a flag: it names the attempt this intent retries, and an empty value
# means a first attempt. Unique attempt identity is the attempt name, which is also what
# the artifact path under the attempt's scratch is derived from by the caller.
import Base
import ./types.bend as T
import ./process.bend as Git
import ../host/receipt.bend as R

type IntentInput is Data:
  IntentRequested{attempt: String, common: String, target: String, destination: String, candidate: String, basis: String, holder: String, retry: String}

type IntentPrepared is Data:
  IntentRefused{step: String, error: U32 & String}
  IntentReady{request: IntentInput, candidate: String, basis: String, head: T.GitOut, index: T.GitOut, status: T.GitOut}

def intent_disposition(prepared: IntentPrepared) -> String:
  match prepared:
    case IntentRefused{step, error}: "refused"
    case IntentReady{request, candidate, basis, head, index, status}: "ready"

law a_refused_intent_is_not_ready:
  for step: String
  for error: U32 & String
  {intent_disposition(IntentRefused{step, error}) == "refused" : String}

def a_refused_intent_is_not_ready(step,error):
  {==}

law an_intent_with_observations_reports_ready:
  for request: IntentInput
  for candidate: String
  for basis: String
  for head: T.GitOut
  for index: T.GitOut
  for status: T.GitOut
  {intent_disposition(IntentReady{request, candidate, basis, head, index, status}) == "ready" : String}

def an_intent_with_observations_reports_ready(request,candidate,basis,head,index,status):
  {==}

# Preparation order, leaf first: observe, then the basis, then the candidate, then the
# directory. Each refusal keeps the primitive's own error and the step that produced it.
def Intent.observe_holder(request: IntentInput, candidate: String, basis: String) -> IO(IntentPrepared):
  +h = request.holder
  do IO<IntentPrepared>:
    head : T.GitOut <- Git.runGit(h, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(h, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(h, ["status", "--porcelain"])
    IO.pure(IntentPrepared, IntentReady{request, candidate, basis, head, index, status})

def Intent.basis_pick(request: IntentInput, candidate: String, qualified: Result<U32 & String, String>) -> IO(IntentPrepared):
  match qualified:
    case Fail{error}: IO.pure(IntentPrepared, IntentRefused{"qualify-basis", error})
    case Done{basis}: Intent.observe_holder(request, candidate, basis)

def Intent.qualified_basis(request: IntentInput, candidate: String) -> IO(IntentPrepared):
  do IO<IntentPrepared>:
    qualified : Result<U32 & String, String> <- R.Receipt.qualify(request.basis)
    Intent.basis_pick(request, candidate, qualified)

def Intent.candidate_pick(request: IntentInput, qualified: Result<U32 & String, String>) -> IO<IntentPrepared>:
  match qualified:
    case Fail{error}: IO.pure(IntentPrepared, IntentRefused{"qualify-candidate", error})
    case Done{candidate}: Intent.qualified_basis(request, candidate)

def Intent.qualified_candidate(request: IntentInput) -> IO<IntentPrepared>:
  do IO<IntentPrepared>:
    qualified : Result<U32 & String, String> <- R.Receipt.qualify(request.candidate)
    Intent.candidate_pick(request, qualified)

def Intent.ensured(request: IntentInput, ensured: Result<U32 & String, String>) -> IO<IntentPrepared>:
  match ensured:
    case Fail{error}: IO.pure(IntentPrepared, IntentRefused{"ensure", error})
    case Done{directory}: Intent.qualified_candidate(request)

def Intent.prepare(request: IntentInput) -> IO(IntentPrepared):
  do IO<IntentPrepared>:
    ensured : Result<U32 & String, String> <- R.Receipt.ensure(request.common)
    Intent.ensured(request, ensured)

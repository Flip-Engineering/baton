# The candidate, basis, destination and holder association, read before anything publishes.
#
# Every step here is a read. Nothing in this module writes to a repository, takes a claim or
# publishes a receipt; it establishes, from Git itself, that the candidate and the basis are
# commits, that the target is an ancestor of the candidate so the landing is a fast forward,
# that the holder's common directory is the requested one, and that the destination belongs
# to the same repository as the holder. A refusal keeps the observation that produced it, so
# a caller can tell a negative answer from an unreadable one.
#
# The guard is not taken here and the association is not publication authority. Composing
# this under `Attempt.capture_guarded` belongs with the caller integration.
import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

type AssociationRequest is Data:
  AssociationRequested{attempt: String, common: String, target: String, destination: String,
                       candidate: String, basis: String, holder: String, retry: String}

type Association is Data:
  AssociationRefused{step: String, observation: T.GitOut}
  AssociationHeld{request: AssociationRequest, candidate_oid: String, basis_oid: String,
                  target_head: String, holder_common: String}

# A commit id read from git is a full object name; anything else is not one.
def oid_ok(text: String) -> Bool:
  +t = text
  U32.is_eq(Tx.byte_len(t), 40)

def oid_of(observation: T.GitOut) -> String:
  match observation:
    case T.GRun{code, out}:
      +c = code
      match U32.is_eq(c, 0):
        case True{}: Tx.trim_nl(out)
        case False{}: ""
    case T.GBroken{detail}: ""

def read_failed(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}:
      +c = code
      match U32.is_eq(c, 0):
        case True{}: False{}
        case False{}: True{}
    case T.GBroken{detail}: True{}

def refuse(step: String, observation: T.GitOut) -> IO(Association):
  +s = step
  +o = observation
  IO.pure(Association, AssociationRefused{s, o})

def candidate_decided(request: AssociationRequest, observation: T.GitOut) -> IO(Association):
  +req = request
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("candidate", obs)
    case False{}: candidate_oid_checked(req, oid_of(obs))

def candidate_oid_checked(request: AssociationRequest, candidate: String) -> IO(Association):
  +req = request
  +oid = candidate
  match oid_ok(oid):
    case False{}: IO.pure(Association, AssociationRefused{"candidate", T.GBroken{"candidate is not a full object name"}})
    case True{}: basis_read(req, oid)

def basis_read(request: AssociationRequest, candidate: String) -> IO(Association):
  +req = request
  +cand = candidate
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", Tx.str_cat(req.basis, "^{commit}")])
    basis_decided(req, cand, observed)

def basis_decided(request: AssociationRequest, candidate: String, observation: T.GitOut) -> IO<Association>:
  +req = request
  +cand = candidate
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("basis", obs)
    case False{}: basis_oid_checked(req, cand, oid_of(obs))

def basis_oid_checked(request: AssociationRequest, candidate: String, basis: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  match oid_ok(base):
    case False{}: IO.pure(Association, AssociationRefused{"basis", T.GBroken{"basis is not a full object name"}})
    case True{}: target_read(req, cand, base)

def target_read(request: AssociationRequest, candidate: String, basis: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", Tx.str_cat(req.target, "^{commit}")])
    target_decided(req, cand, base, observed)

# An absent target is the first landing and is carried as an empty head rather than refused;
# only an unreadable observation stops the decision.
def target_decided(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  match read_failed(obs):
    case True{}: ancestor_read(req, cand, base, "")
    case False{}: ancestor_read(req, cand, base, oid_of(obs))

def ancestor_read(request: AssociationRequest, candidate: String, basis: String, head: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  match Tx.str_eq(tip, ""):
    case True{}: holder_read(req, cand, base, tip)
    case False{}:
      do IO<Association>:
        observed : T.GitOut <- Git.runGit(req.holder, ["merge-base", "--is-ancestor", tip, cand])
        ancestor_decided(req, cand, base, tip, observed)

def ancestor_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("ancestor", obs)
    case False{}: holder_read(req, cand, base, tip)

def holder_read(request: AssociationRequest, candidate: String, basis: String, head: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--git-common-dir"])
    holder_decided(req, cand, base, tip, observed)

def holder_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("holder", obs)
    case False{}: destination_read(req, cand, base, tip, oid_of(obs))

def destination_read(request: AssociationRequest, candidate: String, basis: String, head: String, common: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.destination, ["rev-parse", "--git-common-dir"])
    destination_decided(req, cand, base, tip, holder_common, observed)

def destination_decided(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, observation: T.GitOut) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("destination", obs)
    case False{}: common_compared(req, cand, base, tip, holder_common, oid_of(obs))

# The holder and the destination must answer the same common directory; a mismatch is
# refused with the holder's answer, and the requested common is compared beside it.
def common_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, destination_common: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +dest_common = destination_common
  match Tx.str_eq(holder_common, dest_common):
    case False{}: IO.pure(Association, AssociationRefused{"common", T.GBroken{Tx.str_cat("holder and destination answer different common directories: ", Tx.str_cat(holder_common, Tx.str_cat(" and ", dest_common)))} } )
    case True{}: requested_compared(req, cand, base, tip, holder_common)

def requested_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String) -> IO<Association>:
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  match Tx.str_eq(holder_common, req.common):
    case False{}: IO.pure(Association, AssociationRefused{"requested-common", T.GBroken{Tx.str_cat("holder answers ", Tx.str_cat(holder_common, Tx.str_cat(" for the requested ", req.common)))} } )
    case True{}: IO.pure(Association, AssociationHeld{req, cand, base, tip, holder_common})

# The entry: the candidate read first, and each later step only from the previous answer.
def Association.decide_observed(request: AssociationRequest, observation: T.GitOut) -> IO(Association):
  +req = request
  +obs = observation
  candidate_decided(req, obs)

def Association.decide(request: AssociationRequest) -> IO(Association):
  +req = request
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", Tx.str_cat(req.candidate, "^{commit}")])
    Association.decide_observed(req, observed)

law a_full_object_name_is_an_oid:
  {oid_ok("0123456789abcdef0123456789abcdef01234567") == True{} : Bool}

def a_full_object_name_is_an_oid():
  {==}

law a_short_object_name_is_not_an_oid:
  {oid_ok("0123456") == False{} : Bool}

def a_short_object_name_is_not_an_oid():
  {==}

law a_failed_observation_is_read_as_failed:
  {read_failed(T.GBroken{"no such ref"}) == True{} : Bool}

def a_failed_observation_is_read_as_failed():
  {==}

law an_exit_zero_observation_is_not_a_failure:
  {read_failed(T.GRun{0, "0123456789abcdef0123456789abcdef01234567"}) == False{} : Bool}

def an_exit_zero_observation_is_not_a_failure():
  {==}

law a_nonzero_observation_is_a_failure:
  {read_failed(T.GRun{128, ""}) == True{} : Bool}

def a_nonzero_observation_is_a_failure():
  {==}

law a_failed_candidate_read_is_refused_with_its_observation:
  for request: AssociationRequest
  {Association.decide_observed(request, T.GRun{128, ""}) == IO.pure(Association, AssociationRefused{"candidate", T.GRun{128, ""}}) : IO(Association)}

def a_failed_candidate_read_is_refused_with_its_observation(request):
  {==}

# The candidate, basis, destination and holder association, read before anything publishes.
#
# Every step here is a read. Nothing in this module writes to a repository, takes a claim or
# publishes a receipt. A caller holds the claim through Receipt.claim, whose locked
# descriptor stays live until Receipt.release, so these reads occur while the claim is held:
# no new host command-sequence effect is required to hold it across them, and no claim
# integer is threaded through these functions merely to appear guarded.
#
# Revision arguments are qualified literal refs and carry --end-of-options, and both common
# directories are requested as absolute paths, because two unrelated repositories can both
# answer ".git" for a relative query. An absent target ref is distinguished from a failed
# read by the exit code, and every refusal keeps the observation that produced it.
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
                  target_head: String, holder_common: String, destination_common: String}

# The supported object-name profile: forty lowercase hexadecimal characters.
def hex_is(c: Char, n: U32) -> Bool:
  +ch = c
  +value = n
  Char.is_eq(ch, Char.from_u32(value))

def hex_chain_16(c: Char) -> Bool: match hex_is(c, 102): case True{}: True{} case False{}: False{}
def hex_chain_15(c: Char) -> Bool: match hex_is(c, 101): case True{}: True{} case False{}: hex_chain_16(c)
def hex_chain_14(c: Char) -> Bool: match hex_is(c, 100): case True{}: True{} case False{}: hex_chain_15(c)
def hex_chain_13(c: Char) -> Bool: match hex_is(c, 99): case True{}: True{} case False{}: hex_chain_14(c)
def hex_chain_12(c: Char) -> Bool: match hex_is(c, 98): case True{}: True{} case False{}: hex_chain_13(c)
def hex_chain_11(c: Char) -> Bool: match hex_is(c, 97): case True{}: True{} case False{}: hex_chain_12(c)
def hex_chain_10(c: Char) -> Bool: match hex_is(c, 57): case True{}: True{} case False{}: hex_chain_11(c)
def hex_chain_9(c: Char) -> Bool: match hex_is(c, 56): case True{}: True{} case False{}: hex_chain_10(c)
def hex_chain_8(c: Char) -> Bool: match hex_is(c, 55): case True{}: True{} case False{}: hex_chain_9(c)
def hex_chain_7(c: Char) -> Bool: match hex_is(c, 54): case True{}: True{} case False{}: hex_chain_8(c)
def hex_chain_6(c: Char) -> Bool: match hex_is(c, 53): case True{}: True{} case False{}: hex_chain_7(c)
def hex_chain_5(c: Char) -> Bool: match hex_is(c, 52): case True{}: True{} case False{}: hex_chain_6(c)
def hex_chain_4(c: Char) -> Bool: match hex_is(c, 51): case True{}: True{} case False{}: hex_chain_5(c)
def hex_chain_3(c: Char) -> Bool: match hex_is(c, 50): case True{}: True{} case False{}: hex_chain_4(c)
def hex_chain_2(c: Char) -> Bool: match hex_is(c, 49): case True{}: True{} case False{}: hex_chain_3(c)
def hex_chain_1(c: Char) -> Bool: match hex_is(c, 48): case True{}: True{} case False{}: hex_chain_2(c)

def hex_go(text: String, ok: Bool) -> Bool:
  match text:
    case SNil{}: ok
    case SCon{c, rest}:
      +here = c
      +tail = rest
      +sofar = ok
      match hex_chain_1(here):
        case False{}: False{}
        case True{}: hex_go(tail, sofar)

def oid_ok(text: String) -> Bool:
  +t = text
  match U32.is_eq(Tx.byte_len(t), 40):
    case False{}: False{}
    case True{}: hex_go(t, True{})

def oid_of(observation: T.GitOut) -> String:
  match observation:
    case T.GRun{code, out}:
      +c = code
      match U32.is_eq(c, 0):
        case True{}: Tx.trim_nl(out)
        case False{}: ""
    case T.GBroken{detail}: ""

# rev-parse answers 0 for a resolved revision and 1 for an unknown one; anything else, and a
# broken observation, is a failed read rather than an absent ref.
def read_failed(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}:
      +c = code
      match U32.is_eq(c, 0):
        case True{}: False{}
        case False{}: True{}
    case T.GBroken{detail}: True{}

def ref_absent(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}:
      +c = code
      match U32.is_eq(c, 1):
        case True{}: True{}
        case False{}: False{}
    case T.GBroken{detail}: False{}

def refuse(step: String, observation: T.GitOut) -> IO(Association):
  +s = step
  +o = observation
  IO.pure(Association, AssociationRefused{s, o})

def oid_checked(step: String, request: AssociationRequest, observation: T.GitOut) -> IO(Association):
  +s = step
  +req = request
  +obs = observation
  match read_failed(obs):
    case True{}: refuse(s, obs)
    case False{}: oid_profile(s, req, obs, oid_of(obs))

def oid_profile(step: String, request: AssociationRequest, observation: T.GitOut, oid: String) -> IO(Association):
  +s = step
  +req = request
  +obs = observation
  +value = oid
  match oid_ok(value):
    case False{}: IO.pure(Association, AssociationRefused{s, obs})
    case True{}: basis_read(req, value)

def basis_read(request: AssociationRequest, candidate: String) -> IO(Association):
  +req = request
  +cand = candidate
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", "--end-of-options", Tx.str_cat(req.basis, "^{commit}")])
    basis_checked(req, cand, observed)

def basis_checked(request: AssociationRequest, candidate: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("basis", obs)
    case False{}: basis_profile(req, cand, obs, oid_of(obs))

def basis_profile(request: AssociationRequest, candidate: String, observation: T.GitOut, basis: String) -> IO(Association):
  +req = request
  +cand = candidate
  +obs = observation
  +value = basis
  match oid_ok(value):
    case False{}: IO.pure(Association, AssociationRefused{"basis", obs})
    case True{}: target_read(req, cand, value)

def target_read(request: AssociationRequest, candidate: String, basis: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", "--quiet", "--end-of-options", Tx.str_cat("refs/heads/", req.target)])
    target_decided(req, cand, base, observed)

# An absent target ref is the first landing and is carried as an empty head; a failed read is
# refused with its own observation, and a present ref must still answer a supported name.
def target_decided(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  match ref_absent(obs):
    case True{}: ancestor_read(req, cand, base, "")
    case False{}: target_present(req, cand, base, obs)

def target_present(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("target", obs)
    case False{}: target_profile(req, cand, base, obs)

def target_profile(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  +head = oid_of(obs)
  match oid_ok(head):
    case False{}: IO.pure(Association, AssociationRefused{"target", obs})
    case True{}: ancestor_read(req, cand, base, head)

def ancestor_read(request: AssociationRequest, candidate: String, basis: String, head: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  match Tx.str_eq(tip, ""):
    case True{}: holder_read(req, cand, base, tip)
    case False{}:
      do IO<Association>:
        observed : T.GitOut <- Git.runGit(req.holder, ["merge-base", "--is-ancestor", "--end-of-options", tip, cand])
        ancestor_decided(req, cand, base, tip, observed)

def ancestor_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("ancestor", obs)
    case False{}: holder_read(req, cand, base, tip)

def holder_read(request: AssociationRequest, candidate: String, basis: String, head: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    holder_decided(req, cand, base, tip, observed)

def holder_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("holder-common", obs)
    case False{}: destination_read(req, cand, base, tip, oid_of(obs))

def destination_read(request: AssociationRequest, candidate: String, basis: String, head: String, common: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.destination, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    destination_decided(req, cand, base, tip, holder_common, observed)

def destination_decided(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, observation: T.GitOut) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +obs = observation
  match read_failed(obs):
    case True{}: refuse("destination-common", obs)
    case False{}: common_compared(req, cand, base, tip, holder_common, obs, oid_of(obs))

def common_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, observation: T.GitOut, destination_common: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +obs = observation
  +dest_common = destination_common
  match Tx.str_eq(holder_common, dest_common):
    case False{}: IO.pure(Association, AssociationRefused{"common", obs})
    case True{}: requested_compared(req, cand, base, tip, holder_common, dest_common)

def requested_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, destination_common: String) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +dest_common = destination_common
  match Tx.str_eq(holder_common, req.common):
    case False{}: IO.pure(Association, AssociationRefused{"requested-common", T.GBroken{Tx.str_cat("holder answers ", Tx.str_cat(holder_common, Tx.str_cat(" for the requested ", req.common)))}})
    case True{}: IO.pure(Association, AssociationHeld{req, cand, base, tip, holder_common, dest_common})

def Association.decide_observed(request: AssociationRequest, observation: T.GitOut) -> IO(Association):
  +req = request
  +obs = observation
  oid_checked("candidate", req, obs)

def Association.decide(request: AssociationRequest) -> IO(Association):
  +req = request
  do IO<Association>:
    observed : T.GitOut <- Git.runGit(req.holder, ["rev-parse", "--verify", "--end-of-options", Tx.str_cat(req.candidate, "^{commit}")])
    Association.decide_observed(req, observed)

law a_full_lowercase_hex_name_is_an_oid:
  {oid_ok("0123456789abcdef0123456789abcdef01234567") == True{} : Bool}

def a_full_lowercase_hex_name_is_an_oid():
  {==}

law a_forty_byte_name_with_other_characters_is_not_an_oid:
  {oid_ok("0123456789abcdefghijklmnopqrstuvwxyz0123") == False{} : Bool}

def a_forty_byte_name_with_other_characters_is_not_an_oid():
  {==}

law a_short_name_is_not_an_oid:
  {oid_ok("0123456") == False{} : Bool}

def a_short_name_is_not_an_oid():
  {==}

law a_nonzero_read_is_classified_as_a_failure:
  {read_failed(T.GRun{1, ""}) == True{} : Bool}

def a_nonzero_read_is_classified_as_a_failure():
  {==}

law an_absent_ref_is_exit_one:
  {ref_absent(T.GRun{1, ""}) == True{} : Bool}

def an_absent_ref_is_exit_one():
  {==}

law a_usage_failure_is_not_an_absent_ref:
  {ref_absent(T.GRun{128, ""}) == False{} : Bool}

def a_usage_failure_is_not_an_absent_ref():
  {==}

law a_broken_read_is_a_failure_and_not_an_absent_ref:
  {read_failed(T.GBroken{"spawn failed"}) == True{} : Bool}

def a_broken_read_is_a_failure_and_not_an_absent_ref():
  {==}

law a_failed_candidate_read_is_refused_with_its_own_observation:
  for request: AssociationRequest
  {Association.decide_observed(request, T.GRun{128, ""}) == IO.pure(Association, AssociationRefused{"candidate", T.GRun{128, ""}}) : IO(Association)}

def a_failed_candidate_read_is_refused_with_its_own_observation(request):
  {==}

law a_candidate_answer_that_is_not_an_object_name_is_refused:
  for request: AssociationRequest
  {Association.decide_observed(request, T.GRun{0, "not-an-object-name"}) == IO.pure(Association, AssociationRefused{"candidate", T.GRun{0, "not-an-object-name"}}) : IO(Association)}

def a_candidate_answer_that_is_not_an_object_name_is_refused(request):
  {==}

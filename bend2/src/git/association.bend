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

# One read position: performed with the observation it produced, or skipped because the chain did
# not reach it. A skipped position carries no observation.
type AssocRead is Data:
  AssocReadSkipped{}
  AssocReadPerformed{observation: T.GitOut}

# The six read positions in the order the chain reaches them. The record is carried cumulatively,
# so a refusal keeps the reads performed before it and leaves the later ones skipped.
type AssocReads is Data:
  AssocReads{candidate: AssocRead, basis: AssocRead, target: AssocRead,
             ancestor: AssocRead, holder: AssocRead, destination: AssocRead}

def reads_none() -> AssocReads:
  AssocReads{AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}}

def reads_candidate(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{read, basis, target, ancestor, holder, destination}

def reads_basis(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{candidate, read, target, ancestor, holder, destination}

def reads_target(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{candidate, basis, read, ancestor, holder, destination}

def reads_ancestor(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{candidate, basis, target, read, holder, destination}

def reads_holder(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{candidate, basis, target, ancestor, read, destination}

def reads_destination(reads: AssocReads, read: AssocRead) -> AssocReads:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: AssocReads{candidate, basis, target, ancestor, holder, read}

def reads_candidate_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: candidate

def reads_basis_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: basis

def reads_target_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: target

def reads_ancestor_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: ancestor

def reads_holder_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: holder

def reads_destination_of(reads: AssocReads) -> AssocRead:
  match reads:
    case AssocReads{candidate, basis, target, ancestor, holder, destination}: destination

def read_performed(read: AssocRead) -> Bool:
  match read:
    case AssocReadPerformed{observation}: True{}
    case AssocReadSkipped{}: False{}

def read_skipped(read: AssocRead) -> Bool:
  match read:
    case AssocReadSkipped{}: True{}
    case AssocReadPerformed{observation}: False{}

# The decision carries the request and every read position it reached: a refusal keeps the reads
# performed before it, and the positions it never reached stay skipped.
type Association is Data:
  AssociationRefused{request: AssociationRequest, step: String, observation: T.GitOut, reads: AssocReads}
  AssociationHeld{request: AssociationRequest, candidate_oid: String, basis_oid: String,
                  target_head: String, holder_common: String, destination_common: String,
                  reads: AssocReads}

# The supported object-name profile: forty lowercase hexadecimal characters.
def assocreq_basis(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: basis

def assocreq_candidate(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: candidate

def assocreq_common(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: common

def assocreq_destination(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: destination

def assocreq_holder(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: holder

def assocreq_target(request: AssociationRequest) -> String:
  match request:
    case AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: target

def hex_is(c: Char, n: U32) -> Bool:
  +ch = c
  +value = n
  Char.is_eq(ch, Char.from_u32(value))

def hex_chain_16(c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 102),
    True{},
    False{})
def hex_chain_15(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 101),
    True{},
    hex_chain_16(c))
def hex_chain_14(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 100),
    True{},
    hex_chain_15(c))
def hex_chain_13(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 99),
    True{},
    hex_chain_14(c))
def hex_chain_12(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 98),
    True{},
    hex_chain_13(c))
def hex_chain_11(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 97),
    True{},
    hex_chain_12(c))
def hex_chain_10(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 57),
    True{},
    hex_chain_11(c))
def hex_chain_9(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 56),
    True{},
    hex_chain_10(c))
def hex_chain_8(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 55),
    True{},
    hex_chain_9(c))
def hex_chain_7(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 54),
    True{},
    hex_chain_8(c))
def hex_chain_6(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 53),
    True{},
    hex_chain_7(c))
def hex_chain_5(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 52),
    True{},
    hex_chain_6(c))
def hex_chain_4(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 51),
    True{},
    hex_chain_5(c))
def hex_chain_3(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 50),
    True{},
    hex_chain_4(c))
def hex_chain_2(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 49),
    True{},
    hex_chain_3(c))
def hex_chain_1(+c: Char) -> Bool:
  Bool.pick(Bool, hex_is(c, 48),
    True{},
    hex_chain_2(c))

def hex_go(text: String, ok: Bool) -> Bool:
  match text:
    case SNil{}: ok
    case SCon{c, rest}:
      +here = c
      +tail = rest
      +sofar = ok
      Bool.pick(Bool, hex_chain_1(here),
        hex_go(tail, sofar),
        False{})
def oid_ok(text: String) -> Bool:
  +t = text
  Bool.pick(Bool, U32.is_eq(Tx.byte_len(t), 40),
    hex_go(t, True{}),
    False{})
def oid_of(observation: T.GitOut) -> String:
  match observation:
    case T.GRun{code, out}:
      +c = code
      Bool.pick(String, U32.is_eq(c, 0),
        Tx.trim_nl(out),
        "")
    case T.GBroken{detail}: ""

# rev-parse answers 0 for a resolved revision and 1 for an unknown one; anything else, and a
# broken observation, is a failed read rather than an absent ref.
def read_failed(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}:
      +c = code
      Bool.pick(Bool, U32.is_eq(c, 0),
        False{},
        True{})
    case T.GBroken{detail}: True{}

def ref_absent(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}:
      +c = code
      Bool.pick(Bool, U32.is_eq(c, 1),
        True{},
        False{})
    case T.GBroken{detail}: False{}

def refuse(step: String, request: AssociationRequest, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +o = observation
  IO.pure(Association, AssociationRefused{req, step, o, reads})

def requested_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, destination_common: String, destination_observed: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +dest_common = destination_common
  +dest_obs = destination_observed
  +seen = reads
  Bool.pick(IO(Association), Tx.str_eq(holder_common, assocreq_common(req)),
    IO.pure(Association, AssociationHeld{req, cand, base, tip, holder_common, dest_common, seen}),
    refuse("requested-common", req, dest_obs, seen))

def common_compared(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, observation: T.GitOut, destination_common: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +obs = observation
  +dest_common = destination_common
  +seen = reads
  Bool.pick(IO(Association), Tx.str_eq(holder_common, dest_common),
    requested_compared(req, cand, base, tip, holder_common, dest_common, obs, seen),
    refuse("common", req, obs, seen))

def destination_decided(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +obs = observation
  +seen = reads_destination(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), read_failed(obs),
    refuse("destination-common", req, obs, seen),
    common_compared(req, cand, base, tip, holder_common, obs, oid_of(obs), seen))

def destination_read(request: AssociationRequest, candidate: String, basis: String, head: String, common: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +holder_common = common
  +seen = reads
  do IO<Association>:
    +observed : T.GitOut <- Git.runGit(assocreq_destination(req), ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    destination_decided(req, cand, base, tip, holder_common, observed, seen)

def holder_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  +seen = reads_holder(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), read_failed(obs),
    refuse("holder-common", req, obs, seen),
    destination_read(req, cand, base, tip, oid_of(obs), seen))

def holder_read(request: AssociationRequest, candidate: String, basis: String, head: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +seen = reads
  do IO<Association>:
    +observed : T.GitOut <- Git.runGit(assocreq_holder(req), ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    holder_decided(req, cand, base, tip, observed, seen)

def ancestor_decided(request: AssociationRequest, candidate: String, basis: String, head: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +obs = observation
  +seen = reads_ancestor(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), read_failed(obs),
    refuse("ancestor", req, obs, seen),
    holder_read(req, cand, base, tip, seen))

def ancestor_read(request: AssociationRequest, candidate: String, basis: String, head: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +tip = head
  +seen = reads
  Bool.pick(IO(Association), Tx.str_eq(tip, ""),
    holder_read(req, cand, base, tip, seen),
    do IO<Association>:
        +observed : T.GitOut <- Git.runGit(assocreq_holder(req), ["merge-base", "--is-ancestor", "--end-of-options", tip, cand])
        ancestor_decided(req, cand, base, tip, observed, seen))

def target_profile(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  +seen = reads
  +head = oid_of(obs)
  Bool.pick(IO(Association), oid_ok(head),
    ancestor_read(req, cand, base, head, seen),
    refuse("target", req, obs, seen))

def target_present(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  +seen = reads
  Bool.pick(IO(Association), read_failed(obs),
    refuse("target", req, obs, seen),
    target_profile(req, cand, base, obs, seen))

def target_decided(request: AssociationRequest, candidate: String, basis: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +obs = observation
  +seen = reads_target(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), ref_absent(obs),
    ancestor_read(req, cand, base, "", seen),
    target_present(req, cand, base, obs, seen))

def target_read(request: AssociationRequest, candidate: String, basis: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +base = basis
  +seen = reads
  do IO<Association>:
    +observed : T.GitOut <- Git.runGit(assocreq_holder(req), ["rev-parse", "--verify", "--quiet", "--end-of-options", Tx.str_cat("refs/heads/", assocreq_target(req))])
    target_decided(req, cand, base, observed, seen)

# An absent target ref is the first landing and is carried as an empty head; a failed read is
# refused with its own observation, and a present ref must still answer a supported name.

def basis_profile(request: AssociationRequest, candidate: String, observation: T.GitOut, basis: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +obs = observation
  +value = basis
  +seen = reads
  Bool.pick(IO(Association), oid_ok(value),
    target_read(req, cand, value, seen),
    refuse("basis", req, obs, seen))

def basis_checked(request: AssociationRequest, candidate: String, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +obs = observation
  +seen = reads_basis(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), read_failed(obs),
    refuse("basis", req, obs, seen),
    basis_profile(req, cand, obs, oid_of(obs), seen))

def basis_read(request: AssociationRequest, candidate: String, reads: AssocReads) -> IO(Association):
  +req = request
  +cand = candidate
  +seen = reads
  do IO<Association>:
    +observed : T.GitOut <- Git.runGit(assocreq_holder(req), ["rev-parse", "--verify", "--end-of-options", Tx.str_cat(assocreq_basis(req), "^{commit}")])
    basis_checked(req, cand, observed, seen)

def oid_profile(step: String, request: AssociationRequest, observation: T.GitOut, oid: String, reads: AssocReads) -> IO(Association):
  +s = step
  +req = request
  +obs = observation
  +value = oid
  +seen = reads
  Bool.pick(IO(Association), oid_ok(value),
    basis_read(req, value, seen),
    refuse(s, req, obs, seen))

def oid_checked(step: String, request: AssociationRequest, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +s = step
  +req = request
  +obs = observation
  +seen = reads_candidate(reads, AssocReadPerformed{obs})
  Bool.pick(IO(Association), read_failed(obs),
    refuse(s, req, obs, seen),
    oid_profile(s, req, obs, oid_of(obs), seen))

# The candidate read is the first position, so the chain starts with that position performed and
# the other five skipped.
def Association.decide_observed(request: AssociationRequest, observation: T.GitOut, reads: AssocReads) -> IO(Association):
  +req = request
  +obs = observation
  oid_checked("candidate", req, obs, reads)

def Association.decide(request: AssociationRequest) -> IO(Association):
  +req = request
  do IO<Association>:
    +observed : T.GitOut <- Git.runGit(assocreq_holder(req), ["rev-parse", "--verify", "--end-of-options", Tx.str_cat(assocreq_candidate(req), "^{commit}")])
    Association.decide_observed(req, observed, reads_none())

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
  for reads: AssocReads
  {Association.decide_observed(request, T.GRun{128, ""}, reads) == IO.pure(Association, AssociationRefused{request, "candidate", T.GRun{128, ""}, reads_candidate(reads, AssocReadPerformed{T.GRun{128, ""}})}) : IO(Association)}

def a_failed_candidate_read_is_refused_with_its_own_observation(request, reads):
  {==}

law a_candidate_answer_that_is_not_an_object_name_is_refused:
  for request: AssociationRequest
  for reads: AssocReads
  {Association.decide_observed(request, T.GRun{0, "not-an-object-name"}, reads) == IO.pure(Association, AssociationRefused{request, "candidate", T.GRun{0, "not-an-object-name"}, reads_candidate(reads, AssocReadPerformed{T.GRun{0, "not-an-object-name"}})}) : IO(Association)}

def a_candidate_answer_that_is_not_an_object_name_is_refused(request, reads):
  {==}

# The retention equations: each handler keeps the reads performed before it, leaves the positions it
# never reached skipped, and keeps the observation the refusing read actually produced.
law a_failed_basis_read_is_recorded_in_its_position_and_refused:
  for request: AssociationRequest
  for candidate_oid: String
  for reads: AssocReads
  {basis_checked(request, candidate_oid, T.GRun{128, "fatal: not a git repository\n"}, reads) == IO.pure(Association, AssociationRefused{request, "basis", T.GRun{128, "fatal: not a git repository\n"}, reads_basis(reads, AssocReadPerformed{T.GRun{128, "fatal: not a git repository\n"}})}) : IO(Association)}

def a_failed_basis_read_is_recorded_in_its_position_and_refused(request, candidate_oid, reads):
  {==}

law a_failed_ancestor_read_is_recorded_in_its_position_and_refused:
  for request: AssociationRequest
  for candidate_oid: String
  for basis_oid: String
  for head: String
  for reads: AssocReads
  {ancestor_decided(request, candidate_oid, basis_oid, head, T.GRun{1, ""}, reads) == IO.pure(Association, AssociationRefused{request, "ancestor", T.GRun{1, ""}, reads_ancestor(reads, AssocReadPerformed{T.GRun{1, ""}})}) : IO(Association)}

def a_failed_ancestor_read_is_recorded_in_its_position_and_refused(request, candidate_oid, basis_oid, head, reads):
  {==}

law an_absent_target_skips_the_ancestor_read:
  for request: AssociationRequest
  for candidate_oid: String
  for basis_oid: String
  for reads: AssocReads
  {ancestor_read(request, candidate_oid, basis_oid, "", reads) == holder_read(request, candidate_oid, basis_oid, "", reads) : IO(Association)}

def an_absent_target_skips_the_ancestor_read(request, candidate_oid, basis_oid, reads):
  {==}

law a_requested_common_answer_returns_the_held_decision_with_the_reads:
  for request: AssociationRequest
  for candidate_oid: String
  for basis_oid: String
  for head: String
  for reads: AssocReads
  {requested_compared(request, candidate_oid, basis_oid, head, assocreq_common(request), assocreq_common(request), T.GRun{0, assocreq_common(request)}, reads) == IO.pure(Association, AssociationHeld{request, candidate_oid, basis_oid, head, assocreq_common(request), assocreq_common(request), reads}) : IO(Association)}

def a_requested_common_answer_returns_the_held_decision_with_the_reads(request, candidate_oid, basis_oid, head, reads):
  {==}

law the_six_read_positions_start_skipped:
  {reads_none() == AssocReads{AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}} : AssocReads}

def the_six_read_positions_start_skipped():
  {==}

law each_position_stores_the_observation_it_was_given:
  {reads_holder(reads_none(), AssocReadPerformed{T.GRun{0, "/common\n"}}) == AssocReads{AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadSkipped{}, AssocReadPerformed{T.GRun{0, "/common\n"}}, AssocReadSkipped{}} : AssocReads}

def each_position_stores_the_observation_it_was_given():
  {==}

law a_performed_position_keeps_its_unnormalized_bytes:
  {reads_holder_of(reads_holder(reads_none(), AssocReadPerformed{T.GRun{0, "/common\n"}})) == AssocReadPerformed{T.GRun{0, "/common\n"}} : AssocRead}

def a_performed_position_keeps_its_unnormalized_bytes():
  {==}

law a_requested_common_mismatch_keeps_both_commons_the_destination_bytes_and_the_reason:
  for reads: AssocReads
  {requested_compared(AssociationRequested{"attempt-1", "/requested", "tgt", "/repo", "cand", "base", "/holder", ""}, "cand", "base", "base", "/observed", "/observed", T.GRun{0, "/observed\n"}, reads) == IO.pure(Association, AssociationRefused{AssociationRequested{"attempt-1", "/requested", "tgt", "/repo", "cand", "base", "/holder", ""}, "requested-common", T.GRun{0, "/observed\n"}, reads}) : IO(Association)}

def a_requested_common_mismatch_keeps_both_commons_the_destination_bytes_and_the_reason(reads):
  {==}

law the_two_common_reads_are_recorded_in_their_own_positions:
  for request: AssociationRequest
  for candidate: String
  for basis: String
  for head: String
  for reads: AssocReads
  {destination_decided(request, candidate, basis, head, "/common", T.GRun{0, "/common"}, reads) == common_compared(request, candidate, basis, head, "/common", T.GRun{0, "/common"}, "/common", reads_destination(reads, AssocReadPerformed{T.GRun{0, "/common"}})) : IO(Association)}

def the_two_common_reads_are_recorded_in_their_own_positions(request, candidate, basis, head, reads):
  {==}

law a_failed_destination_read_is_recorded_in_its_position_and_refused:
  for request: AssociationRequest
  for candidate: String
  for basis: String
  for head: String
  for common: String
  for reads: AssocReads
  {destination_decided(request, candidate, basis, head, common, T.GRun{128, "fatal: not a git repository\n"}, reads) == IO.pure(Association, AssociationRefused{request, "destination-common", T.GRun{128, "fatal: not a git repository\n"}, reads_destination(reads, AssocReadPerformed{T.GRun{128, "fatal: not a git repository\n"}})}) : IO(Association)}

def a_failed_destination_read_is_recorded_in_its_position_and_refused(request, candidate, basis, head, common, reads):
  {==}

law an_absent_target_read_is_recorded_and_skips_the_ancestor:
  for request: AssociationRequest
  for candidate: String
  for basis: String
  for reads: AssocReads
  {target_decided(request, candidate, basis, T.GRun{1, ""}, reads) == ancestor_read(request, candidate, basis, "", reads_target(reads, AssocReadPerformed{T.GRun{1, ""}})) : IO(Association)}

def an_absent_target_read_is_recorded_and_skips_the_ancestor(request, candidate, basis, reads):
  {==}

law the_holder_read_is_recorded_in_its_own_position:
  for request: AssociationRequest
  for candidate: String
  for basis: String
  for head: String
  for reads: AssocReads
  {holder_decided(request, candidate, basis, head, T.GRun{0, "/common\n"}, reads) == destination_read(request, candidate, basis, head, "/common", reads_holder(reads, AssocReadPerformed{T.GRun{0, "/common\n"}})) : IO(Association)}

def the_holder_read_is_recorded_in_its_own_position(request, candidate, basis, head, reads):
  {==}

# CLAIM: a Bend2 law's witness can drive the real implementation. This program
# requires impl/src/swarm-state.mjs and impl/src/host-capacity.mjs from its JS
# half and, for an enumerated corpus, compares what the real code retains and
# admits against what the checked models in laws.bend predict. Each case prints
# `agree` or `DISAGREE`, so a disagreement is visible in the run.
#
# Scope: the corpus is enumerated here, not quantified. The real fold is driven
# through its own public entry (foldSwarmEvent) and the real admission through the
# capacity authority's own observation; no impl/src file is modified.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-transition.evidence.md.
import Base
import ./laws-history-model.bend as History
import ./laws-worker-model.bend as Worker

# The real review append: `n` accepted review rows folded into one contribution,
# answered as the base-3 fingerprint of the rows the real fold retained.
def Real.reviews_fingerprint(n: Nat) -> IO(Nat):
  import "./laws-transition.js"

# The real worker admission: 1 when the real capacity authority reports room for
# a worker under this case's observation, 0 otherwise.
def Real.worker_room(tight: U32, free_mb: U32) -> IO(U32):
  import "./laws-transition.js"


def next_decision(d: History.Decision) -> History.Decision:
  match d:
    case History.Accept{}: History.Reject{}
    case History.Reject{}: History.Comment{}
    case History.Comment{}: History.Accept{}

# Cycle accept, reject, comment, accept; counting `k` down shrinks the argument.
def decision_at(k: Nat, d: History.Decision) -> History.Decision:
  match k:
    case 0n: d
    case 1n+p: decision_at(p, next_decision(d))

def corpus_decision(n: Nat) -> History.Decision:
  decision_at(n, History.Accept{})

# The corpus row the model appends: identity, author, artifact and basis are the
# step index, and the decision cycles the same way the host half's does.
def corpus_row(+n: Nat) -> History.Review:
  History.Row{n, n, n, n, corpus_decision(n)}

# The model's own fingerprint for the same corpus: append_review applied `n`
# times, then the base-3 fingerprint of the resulting list. This is the value the
# checked M-5 obligations are about.
def decision_value(d: History.Decision) -> Nat:
  match d:
    case History.Accept{}: 0n
    case History.Reject{}: 1n
    case History.Comment{}: 2n

def decision_digit(row: History.Review) -> Nat:
  match row:
    case History.Row{_, _, _, _, +d}: decision_value(d)

# The fingerprint is a base-3 number folded left to right, each row contributing
# its decision digit plus one, so neither a dropped row nor a reordered pair can
# leave it unchanged.
def list_fingerprint(+history: +List<History.Review>, +acc: Nat) -> Nat:
  match history:
    case Nil{}: acc
    case h <> t: list_fingerprint(t, (acc * 3n + decision_digit(h) + 1n : Nat))

# The row index counts up while the remaining count counts down, so the model
# appends the corpus in the same order the host half folds it.
def model_list(+k: Nat, +i: Nat, history: +List<History.Review>) -> +List<History.Review>:
  match k:
    case 0n: history
    case 1n+p: model_list(p, (i + 1n : Nat), History.append_review(history, corpus_row(i)))

def model_fingerprint(n: Nat) -> Nat:
  list_fingerprint(model_list(n, 0n, []), 0n)

def verdict(ok: Bool) -> String:
  match ok:
    case True{}: "agree"
    case False{}: "DISAGREE"

# One report line per compared case: the real value, the model's value, and the
# verdict that compares them. Nat and U32 are Data, so a case def can use each
# value twice.
def nat_case(+real: Nat, +model: Nat) -> String:
  "real " ++ Nat.show(real) ++ " model " ++ Nat.show(model) ++ " " ++ verdict(Nat.is_eq(real, model))

def u32_case(+real: U32, +model: U32) -> String:
  "real " ++ U32.show(real) ++ " model " ++ U32.show(model) ++ " " ++ verdict(U32.is_eq(real, model))

# The model's worker answer as a U32: `room_for(Worker{}, mt, bf)` is the checked
# M-10 obligation, and this is the same value the host half reports.
def model_worker_room(tight: U32, free_mb: U32) -> U32:
  Bool.to_u32(Worker.room_for(Worker.Worker{}, U32.is_ne(tight, 0), U32.is_lt(free_mb, 512)))

def main() -> IO(Unit):
  do IO<Unit>:
    r0 : Nat <- Real.reviews_fingerprint(0n)
    r1 : Nat <- Real.reviews_fingerprint(1n)
    r2 : Nat <- Real.reviews_fingerprint(2n)
    r3 : Nat <- Real.reviews_fingerprint(3n)
    r4 : Nat <- Real.reviews_fingerprint(4n)
    IO.print("reviews n=0 " ++ nat_case(r0, model_fingerprint(0n)))
    IO.print("reviews n=1 " ++ nat_case(r1, model_fingerprint(1n)))
    IO.print("reviews n=2 " ++ nat_case(r2, model_fingerprint(2n)))
    IO.print("reviews n=3 " ++ nat_case(r3, model_fingerprint(3n)))
    IO.print("reviews n=4 " ++ nat_case(r4, model_fingerprint(4n)))
    w0 : U32 <- Real.worker_room(0, 4096)
    w1 : U32 <- Real.worker_room(18, 64)
    w2 : U32 <- Real.worker_room(64, 1)
    IO.print("worker tight=0 free=4096 " ++ u32_case(w0, model_worker_room(0, 4096)))
    IO.print("worker tight=18 free=64 " ++ u32_case(w1, model_worker_room(18, 64)))
    IO.print("worker tight=64 free=1 " ++ u32_case(w2, model_worker_room(64, 1)))
    IO.print("transition witness: 8 cases compared; every line above must read agree.")

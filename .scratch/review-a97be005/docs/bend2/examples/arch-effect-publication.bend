# CLAIM: at pin bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868 with bend 2.0.25, a Bend2
# program validates an issued capability record before use, records a durable accept intent in an
# append-only journal, dispatches a canonical publication to a target bound by an identity read, and
# settles a lost-response attempt from the target's own evidence without dispatching a second effect.
# The same program records where the native surface runs out: the accept intent gets no durability
# receipt, an absent destination is a value rather than an exception, and the only transport for the
# publication is the filesystem.
#
# Evidence: arch-effect-publication.evidence.md (exact commands, fixtures and observed output).
#
# The fixture path is created by the evidence's own commands, never by this program: Base supplies no
# directory creation, so a missing directory is one of the failures this program has to answer.

import Base

# One issued capability record, and the verdict of checking it against the operation it is used for.
type Capability is Data:
  Capability{operation: String, resource: String, generation: U32}

type Verdict is Data:
  Accepted{operation: String}
  Refused{reason: String}

def show_nat(n: Nat) -> String:
  Nat.show(n)

def show_verdict(v: Verdict) -> String:
  match v:
    case Accepted{operation}:
      String.append("accepted:", operation)
    case Refused{reason}:
      String.append("refused:", reason)

# A record's own fields are checked before it is used. The check establishes that the record names
# the operation being attempted and carries a live generation; it cannot establish who issued the
# record, because at this pin an importing module can construct one (LANG-F-28).
def verdict_operation(matched: Bool, operation: String) -> Verdict:
  match matched:
    case True{}:
      Accepted{operation}
    case False{}:
      Refused{"capability_operation_mismatch"}

def check_operation(+operation: String, op: String) -> Verdict:
  verdict_operation(String.eq(operation, op), operation)

def verdict_resource(missing: Bool, operation: String, op: String) -> Verdict:
  match missing:
    case True{}:
      Refused{"capability_resource_missing"}
    case False{}:
      check_operation(operation, op)

def check_resource(operation: String, resource: String, op: String) -> Verdict:
  verdict_resource(String.is_empty(resource), operation, op)

def verdict_generation(absent: Bool, operation: String, resource: String, op: String) -> Verdict:
  match absent:
    case True{}:
      Refused{"capability_generation_zero"}
    case False{}:
      check_resource(operation, resource, op)

def check_generation(operation: String, resource: String, generation: U32, op: String) -> Verdict:
  verdict_generation(U32.is_zero(generation), operation, resource, op)

def check_capability(record: Capability, op: String) -> Verdict:
  match record:
    case Capability{operation, resource, generation}:
      check_generation(operation, resource, generation, op)

# A Result's payload, or the empty string when the read failed (an absent file is a value here).
def result_text(r: Result<&1, &1, (U32 & String), String>) -> String:
  match r:
    case Done{value}:
      value
    case Fail{error}:
      ""

def result_ok(r: Result<&1, &1, (U32 & String), Unit>) -> Bool:
  match r:
    case Done{value}:
      True{}
    case Fail{error}:
      False{}

# Lines of a text, not counting the empty tail a trailing newline leaves.
def adjust_count(n: Nat, trailing: Bool) -> Nat:
  match trailing:
    case True{}:
      Nat.sub(n, 1n)
    case False{}:
      n

def count_lines(+text: String) -> Nat:
  adjust_count(List.length(&2, String, String.lines(text)), String.ends_with(text, "\n"))

# --- the file effects, each a request and an observed outcome ---

def read_go(m: File & Result<&1, &1, (U32 & String), String>) -> IO(String):
  (f, r) = m
  do IO<String>:
    c : Unit <- File.close(f)
    IO.pure(String, result_text(r))

def read_opened(opened: Result<&1, &1, (U32 & String), File>) -> IO(String):
  match opened:
    case Fail{error}:
      IO.pure(String, "")
    case Done{file}:
      do IO<String>:
        m : File & Result<&1, &1, (U32 & String), String> <- File.read(file, 8192)
        read_go(m)

def read_file(path: String) -> IO(String):
  do IO<String>:
    opened : Result<&1, &1, (U32 & String), File> <- File.open(path, "r")
    read_opened(opened)

def write_go(w: File & Result<&1, &1, (U32 & String), Unit>) -> IO(Bool):
  (f, r) = w
  do IO<Bool>:
    c : Unit <- File.close(f)
    IO.pure(Bool, result_ok(r))

def append_opened(opened: Result<&1, &1, (U32 & String), File>, text: String) -> IO(Bool):
  match opened:
    case Fail{error}:
      IO.pure(Bool, False{})
    case Done{file}:
      do IO<Bool>:
        w : File & Result<&1, &1, (U32 & String), Unit> <- File.write(file, text)
        write_go(w)

def append(path: String, text: String) -> IO(Bool):
  do IO<Bool>:
    opened : Result<&1, &1, (U32 & String), File> <- File.open(path, "a")
    append_opened(opened, text)

def write_new_opened(opened: Result<&1, &1, (U32 & String), File>, text: String) -> IO(Bool):
  match opened:
    case Fail{error}:
      IO.pure(Bool, False{})
    case Done{file}:
      do IO<Bool>:
        w : File & Result<&1, &1, (U32 & String), Unit> <- File.write(file, text)
        write_go(w)

def write_new(path: String, text: String) -> IO(Bool):
  do IO<Bool>:
    opened : Result<&1, &1, (U32 & String), File> <- File.open(path, "w")
    write_new_opened(opened, text)

# --- the publication operation ---

def settled_of(matched: Bool) -> String:
  match matched:
    case True{}:
      "observed"
    case False{}:
      "no_evidence"

def settle(observed: String, payload: String) -> String:
  settled_of(String.eq(observed, payload))

def report_dispatch_count(dispatches: String) -> IO(Unit):
  IO.print(String.concat(["dispatch_count=", show_nat(count_lines(dispatches))]))

def report_settled(settled: String) -> IO(Unit):
  IO.print(String.concat(["settled=", settled]))

# The settlement path reads the destination and nothing else: no in-memory result of the attempt
# reaches it, which is what a restarted process would have.
def recover(payload: String) -> IO(Unit):
  do IO<Unit>:
    artifact : String <- read_file(".scratch/arch-effect/target/artifact.op-1")
    dispatches : String <- read_file(".scratch/arch-effect/target/dispatches.log")
    a : Unit <- report_settled(settle(artifact, payload))
    report_dispatch_count(dispatches)

def publish_refused() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("dispatch=refused:destination_identity_mismatch")
    IO.pure(Unit, Unit{})

def publish_identity(matched: Bool, +payload: String) -> IO(Unit):
  match matched:
    case False{}:
      publish_refused()
    case True{}:
      do IO<Unit>:
        a : Unit <- IO.print("dispatch=issued")
        _ : Bool <- append(".scratch/arch-effect/target/dispatches.log", "op-1\n")
        _ : Bool <- write_new(".scratch/arch-effect/target/artifact.op-1", payload)
        recover(payload)

def publish_exchange(identity: String, expected: String, +payload: String) -> IO(Unit):
  publish_identity(String.eq(identity, expected), payload)

def append_intent(payload: String) -> IO(Unit):
  do IO<Unit>:
    ok : Bool <- append(".scratch/arch-effect/journal.log", "accept:op-1\n")
    j : String <- read_file(".scratch/arch-effect/journal.log")
    a : Unit <- IO.print(String.append("intent_appended=", Bool.show(ok)))
    b : Unit <- IO.print(String.concat(["journal_lines=", show_nat(count_lines(j))]))
    IO.print("durability_receipt=none")

def publish() -> IO(Unit):
  do IO<Unit>:
    identity : String <- read_file(".scratch/arch-effect/target/identity")
    i : Unit <- append_intent("op=op-1|payload=canonical-v1")
    publish_exchange(identity, "target-A", "op=op-1|payload=canonical-v1")

# An absent destination is a value, not an exception: the dispatch reports failure, the attempt
# stays unsettled, and nothing is retried.
def ambiguous() -> IO(Unit):
  do IO<Unit>:
    ok : Bool <- append(".scratch/arch-effect/absent/target/dispatches.log", "op-1\n")
    a : Unit <- IO.print(String.append("dispatch=", Bool.show(ok)))
    artifact : String <- read_file(".scratch/arch-effect/absent/target/artifact.op-1")
    b : Unit <- IO.print(String.concat(["unsettled=", settle(artifact, "op=op-1|payload=canonical-v1")]))
    IO.print("retry=none")

def validate() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print(String.append("valid=", show_verdict(check_capability(Capability{"stop_run", "run-A", 4}, "stop_run"))))
    b : Unit <- IO.print(String.append("forged_generation=", show_verdict(check_capability(Capability{"stop_run", "run-A", 0}, "stop_run"))))
    c : Unit <- IO.print(String.append("forged_operation=", show_verdict(check_capability(Capability{"stop_run", "run-A", 4}, "publish"))))
    IO.print(String.append("forged_resource=", show_verdict(check_capability(Capability{"stop_run", "", 4}, "stop_run"))))

def dispatch_recover_mode(is_recover: Bool) -> IO(Unit):
  match is_recover:
    case True{}:
      recover("op=op-1|payload=canonical-v1")
    case False{}:
      publish()

def dispatch_rest_mode(is_ambiguous: Bool, +mode: String) -> IO(Unit):
  match is_ambiguous:
    case True{}:
      ambiguous()
    case False{}:
      dispatch_recover_mode(String.eq(mode, "recover"))

def dispatch_mode(is_validate: Bool, +mode: String) -> IO(Unit):
  match is_validate:
    case True{}:
      validate()
    case False{}:
      dispatch_rest_mode(String.eq(mode, "ambiguous"), mode)

def dispatch_named(+mode: String) -> IO(Unit):
  dispatch_mode(String.eq(mode, "validate"), mode)

def read_mode(m: Result<&1, &1, (U32 & String), String>) -> IO(Unit):
  match m:
    case Done{value}:
      dispatch_named(value)
    case Fail{error}:
      publish()

def main() -> IO(Unit):
  do IO<Unit>:
    m : Result<&1, &1, (U32 & String), String> <- IO.get_env("ARCH_EFFECT_MODE")
    read_mode(m)

# The pure derivation helpers the shared landing path uses: the attempt directory, the artifact
# destination under it, the intent record's bytes and the qualified target ref. The effect chain that
# once lived here was consolidated into the shared route in land.bend, so this module holds no effects
# and no laws.
import Base
import ./text.bend as Tx

def attempt_directory_for(common: String, attempt: String) -> String:
  +c = common
  +a = attempt
  Tx.str_cat(c, Tx.str_cat("/baton2-attempts/", a))

def attempt_artifact_for(common: String, attempt: String) -> String:
  +c = common
  +a = attempt
  Tx.str_cat(attempt_directory_for(c, a), "/stderr")

def qualified_target(target: String) -> String:
  +t = target
  Tx.str_cat("refs/heads/", t)

# The bytes the intent records are the resolved operands themselves, so the recorded intent
# carries the immutable candidate, basis and qualified target rather than caller content.
def intent_content(candidate: String, basis: String, target: String) -> String:
  +c = candidate
  +b = basis
  +t = target
  Tx.str_cat(c, Tx.str_cat("\n", Tx.str_cat(b, Tx.str_cat("\n", Tx.str_cat(qualified_target(t), "\n")))))

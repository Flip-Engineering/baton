import Base
import ../git/text.bend as Tx

# Native API-credit launch boundary: product policy for resolving a secret
# reference and confining the credential to the child environment. The policy
# in this module is complete Bend2 using only constructs the existing tree
# already proves. The final spawn needs one host effect the pinned compiler
# does not expose yet (a child spawn whose environment carries one file-sourced
# variable - docs/bend2/api-key-exec-native-boundary.md specifies that effect
# for the runtime seat). Until the effect lands, the executed driver remains
# bend2/harness/api-key-exec.mjs and this module is source-ready only: it is
# not imported by the coordinator and sits outside every check gate.

# The one credential variable the launch sets. Claude reads ANTHROPIC_API_KEY;
# in non-interactive mode a present key always wins over subscription login.
def credential_variable() -> String:
  "ANTHROPIC_API_KEY"

type Refusal is Data:
  Reject{condition: String, detail: String}

def refusal(condition: String, +detail: String) -> Refusal:
  Reject{condition,detail}

# Everything up to and including the first colon: the kind of reference, never
# its payload. Refusal output carries this kind and nothing more.
def reference_kind(+reference: String) -> String:
  match String.split(reference,Char.from_u32(58)):
    case +scheme <> rest: Tx.join(":",Con{scheme,Nil{}}) ++ ":"
    case other: reference

def reference_scheme(+reference: String) -> String:
  match String.split(reference,Char.from_u32(58)):
    case +scheme <> rest: scheme
    case other: ""

def reference_target(+reference: String) -> String:
  match String.split(reference,Char.from_u32(58)):
    case +scheme <> +target <> rest: target
    case other: ""

# A file reference names a nonempty path.
def parse_file_reference(+reference: String) -> Maybe<String>:
  Bool.pick(Maybe<String>,Bool.and(String.eq(reference_scheme(reference),"file"),Bool.not(String.is_empty(reference_target(reference)))),Some{reference_target(reference)},None{})

# A keychain reference is keychain:SERVICE/ACCOUNT with both parts nonempty.
def parse_keychain_parts(+reference: String) -> Maybe<String>:
  match String.split(reference_target(reference),Char.from_u32(47)):
    case +service <> +account <> Nil{}:
      Bool.pick(Maybe<String>,Bool.and(Bool.not(String.is_empty(service)),Bool.not(String.is_empty(account))),Some{Tx.join("/",Con{service,Con{account,Nil{}}})},None{})
    case other: None{}

# The typed refusal for a reference this boundary does not understand. The
# detail carries the scheme, never the full reference payload.
def parse_refusal(+reference: String) -> Refusal:
  refusal("unsupportedSecretReference","reference scheme " ++ reference_scheme(reference) ++ " is not file:PATH or keychain:SERVICE/ACCOUNT")

# The env spec file body for one credential variable: NAME=VALUE lines, one
# per entry, written 0600 and consumed by the host spawn effect.
def env_spec_lines(+variable: String, +value: String) -> String:
  variable ++ "=" ++ value ++ "\n"

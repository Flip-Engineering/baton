# Fixture for the per-request reply mapping of the credit transport. An admitted request is
# forwarded. A balance exhaustion is answered with the provider's credit-stop body, and any
# other refusal is answered with its reason and never with that body. Account, organization
# and amounts are fixtures and prove no live balance.
import Base
import ../src/coordinator/accounts.bend as A
import ../src/coordinator/credit-transport.bend as T

def check(label: String, is_ok: Bool) -> IO(Unit):
  match is_ok:
    case True{}: IO.print("fixture-transport " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"fixture-transport " ++ label ++ ": refused")

def admitted() -> A.CreditAdmission:
  A.CAdmitted{"org-fixture","2026-10-cycle","10","0","0"}

def forward_total(reply: T.TransportReply) -> String:
  match reply:
    case Forward{reserved_total}: reserved_total
    case other: ""

def hold_body(reply: T.TransportReply) -> String:
  match reply:
    case Hold{body}: body
    case other: ""

def refused_body_of(reply: T.TransportReply) -> String:
  match reply:
    case Refused{body}: body
    case other: ""

def transport_checks() -> IO(Unit):
  do IO<Unit>:
    forward : Unit <- check("reply-admitted-forwards",T.reply_is_forward(T.transport_reply(admitted())))
    total : Unit <- check("reply-admitted-carries-reserved-total",String.eq(forward_total(T.transport_reply(admitted())),"10"))
    insufficient : Unit <- check("reply-insufficient-is-hold",T.reply_is_hold(T.transport_reply(A.CRefused{"promotionalCreditInsufficient"})))
    exhausted : Unit <- check("reply-exhausted-is-hold",T.reply_is_hold(T.transport_reply(A.CRefused{"promotionalCreditExhausted"})))
    body : Unit <- check("reply-hold-carries-provider-stop-body",String.eq(hold_body(T.transport_reply(A.CRefused{"promotionalCreditInsufficient"})),T.credit_stop_body()))
    unverified : Unit <- check("reply-unverified-organization-is-refused",T.reply_is_refused(T.transport_reply(A.CRefused{"organizationUnverified"})))
    not_stop : Unit <- check("reply-refusal-is-not-the-stop-body",Bool.not(String.eq(refused_body_of(T.transport_reply(A.CRefused{"organizationUnverified"})),T.credit_stop_body())))
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    transport : Unit <- transport_checks()
    printed : Unit <- IO.print("fixture-transport-ok")
    IO.pure(Unit,Unit{})

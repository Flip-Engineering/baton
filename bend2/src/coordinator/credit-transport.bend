# Reply policy for the per-request credit transport (docs/bend2/credit-request-transport.md).
# The native listener calls the admission for one Messages request and writes the reply
# this module returns. The pure mapping lives here: an admitted request is forwarded, a
# balance exhaustion is answered with the provider's own credit-stop wording, which the
# handoff classifier reads as exhaustion, and any other refusal is answered with its
# reason, so no other cause reads as exhaustion. The I/O that builds the admission for a
# request is not in this module.
import Base
import ./accounts.bend as A

type TransportReply is Data:
  Forward{reserved_total: String}
  Hold{body: String}
  Refused{body: String}

# The provider's own credit-stop text, as the classifier matches it.
def credit_stop_text() -> String:
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."

def credit_stop_body() -> String:
  "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"" ++ credit_stop_text() ++ "\"}}"

def refused_body(+reason: String) -> String:
  "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"credit transport refused the request: " ++ reason ++ "\"}}"

# Refusals that mean the promotional balance is spent for this cycle. Every other reason
# names a different cause and is not reported as a balance stop.
def balance_exhausted(+reason: String) -> Bool:
  Bool.or(String.eq(reason,"promotionalCreditInsufficient"),String.eq(reason,"promotionalCreditExhausted"))

def transport_reply(admission: A.CreditAdmission) -> TransportReply:
  match admission:
    case A.CAdmitted{organization,cycle,reserved_total,balance_after_reserve,cap_after_reserve}: Forward{reserved_total}
    case A.CRefused{reason}: Bool.pick(TransportReply,balance_exhausted(reason),Hold{credit_stop_body()},Refused{refused_body(reason)})

def reply_is_hold(reply: TransportReply) -> Bool:
  match reply:
    case Hold{body}: True{}
    case other: False{}

def reply_is_forward(reply: TransportReply) -> Bool:
  match reply:
    case Forward{reserved_total}: True{}
    case other: False{}

def reply_is_refused(reply: TransportReply) -> Bool:
  match reply:
    case Refused{body}: True{}
    case other: False{}

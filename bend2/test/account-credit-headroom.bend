# Fixture for the balance-headroom rule of the request admission. The open
# reservations for one grant cycle are carried in the meter's reserved total, and
# a request is admitted while that total plus its bounded charge fits in the
# promotional balance. The cases cover an exact fit, one unit over, two open
# reservations that sum against the balance, and an unbounded charge. Account,
# organization and amounts here are fixtures and prove no live balance.
import Base
import ../src/coordinator/accounts.bend as A

def check(label: String, is_ok: Bool) -> IO(Unit):
  match is_ok:
    case True{}: IO.print("fixture-headroom " ++ label ++ ": ok")
    case False{}: IO.die(Unit,1,"fixture-headroom " ++ label ++ ": refused")

def reason_is(admission: A.CreditAdmission, +expected: String, +label: String) -> IO(Unit):
  check(label,String.eq(A.credit_admission_reason(admission),expected))

def headroom_checks() -> IO(Unit):
  do IO<Unit>:
    exact : Unit <- check("headroom-exact-fit-admitted",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")))
    exact_left : Unit <- check("headroom-exact-fit-leaves-zero",String.eq(A.credit_admission_balance_after(A.credit_request_admission(A.Ac{"claude-credit","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")),"0"))
    over : Unit <- reason_is(A.credit_request_admission(A.Ac{"claude-credit","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","11"),"promotionalCreditInsufficient","headroom-one-unit-over-refused")
    summed : Unit <- check("headroom-open-reservations-summed",String.eq(A.credit_admission_reserved_total(A.credit_request_admission(A.Ac{"claude-credit","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")),"50"))
    unbounded : Unit <- reason_is(A.credit_request_admission(A.Ac{"claude-credit","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","0"},"2026-10-cycle","2026-10","0"),"requestChargeUnbounded","headroom-zero-charge-refused")
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    headroom : Unit <- headroom_checks()
    printed : Unit <- IO.print("fixture-headroom-ok")
    IO.pure(Unit,Unit{})

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
    exact : Unit <- check("headroom-exact-fit-admitted",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")))
    exact_left : Unit <- check("headroom-exact-fit-leaves-zero",String.eq(A.credit_admission_balance_after(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")),"0"))
    over : Unit <- check("headroom-one-unit-over-admitted-estimate",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","11")))
    summed : Unit <- check("headroom-open-reservations-summed",String.eq(A.credit_admission_reserved_total(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","40"},"2026-10-cycle","2026-10","10")),"50"))
    unbounded : Unit <- check("headroom-zero-charge-refused",A.credit_admission_admitted(A.credit_request_admission(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CMeter{"org-fixture","reported","2026-10-cycle","50","USD","200","2026-10","0","0"},"2026-10-cycle","2026-10","0")))
    IO.pure(Unit,Unit{})

def reserve_fits(grant_spend: String, balance: String, request: String, +label: String, +expected_total: String) -> IO(Unit):
  check(label,String.eq(A.credit_admission_reserved_total(A.credit_reserve_arithmetic(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CObs{"reported",balance,"USD","2026-10-cycle","1793000000000"},"1",grant_spend,"0","2026-10-cycle","2026-10","1793000000000","1792600000000",request)),expected_total))

def reserve_reason_is(grant_spend: String, balance: String, request: String, +expected: String, +label: String) -> IO(Unit):
  check(label,String.eq(A.credit_admission_reason(A.credit_reserve_arithmetic(A.Ac{"claude-credit-primary","anthropic","claude-code","api_key","file:/fixture/secrets/api","org-fixture","2026-10-18"},A.CObs{"reported",balance,"USD","2026-10-cycle","1793000000000"},"1",grant_spend,"0","2026-10-cycle","2026-10","1793000000000","1792600000000",request)),expected))

# The grant spend already holds open reservations and settled cost for the cycle, so
# the balance left for a new request is the balance minus that spend.
def reserve_headroom_checks() -> IO(Unit):
  do IO<Unit>:
    fits : Unit <- reserve_fits("40","50","10","reserve-request-fits-after-open-spend","10")
    over : Unit <- reserve_fits("40","50","11","reserve-request-over-remaining-admitted-estimate","11")
    spent : Unit <- reserve_fits("50","50","1","reserve-balance-spent-by-cycle-admitted-estimate","1")
    past : Unit <- reserve_fits("60","50","1","reserve-spend-beyond-balance-admitted-estimate","1")
    IO.pure(Unit,Unit{})

def main() -> IO(Unit):
  do IO<Unit>:
    headroom : Unit <- headroom_checks()
    reserve : Unit <- reserve_headroom_checks()
    printed : Unit <- IO.print("fixture-headroom-ok")
    IO.pure(Unit,Unit{})

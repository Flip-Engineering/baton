# Fixture for the #797 usage-window store and gate. It drives the real
# provider-prefix, window-kind, and reset-time extraction over the observed
# Kimi, ZAI, and Claude wordings, and the real gate match SQL shape: fixtures
# prove the extraction literals and nothing else. The sqlite store, the wake
# gate, and the command surface are exercised by the receive integration
# fixtures on remote validation runners.
import Base
import ../src/coordinator/usage-windows.bend as UW
import ../src/git/text.bend as Tx

def kimi_cause() -> String:
  "You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."

def zai_cause() -> String:
  "Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52"

def claude_weekly() -> String:
  "You've hit your weekly limit"

def claude_monthly() -> String:
  "usage limit reached for monthly billing cycle"

def iso_z() -> String:
  "Your usage window resets at 2026-10-12T23:25:59Z"

def iso_offset() -> String:
  "resets 2026-10-17T03:41:00+00:00"

def split_dt() -> String:
  "reset at 2026-10-06 07:12:52"

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-window " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-window " ++ label ++ ": refused"))

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    provider_kimi : Unit <- expect("provider-kimi",String.eq(UW.provider_of("kimi-code/kimi-for-coding"),"kimi-code"))
    provider_zai : Unit <- expect("provider-zai",String.eq(UW.provider_of("zai/glm-5.3-flash"),"zai"))
    provider_bare : Unit <- expect("provider-bare-is-empty",String.eq(UW.provider_of("gpt-6-astra"),""))
    label_kimi : Unit <- expect("label-kimi-5-hour",String.eq(UW.window_label_of(UW.lower_ascii(kimi_cause())),"5-hour"))
    label_zai : Unit <- expect("label-zai-5-hour",String.eq(UW.window_label_of(UW.lower_ascii(zai_cause())),"5-hour"))
    label_weekly : Unit <- expect("label-claude-weekly",String.eq(UW.window_label_of(UW.lower_ascii(claude_weekly())),"7-day"))
    label_monthly : Unit <- expect("label-claude-monthly",String.eq(UW.window_label_of(UW.lower_ascii(claude_monthly())),"monthly"))
    label_unknown : Unit <- expect("label-unknown-is-empty",String.eq(UW.window_label_of("rate limit exceeded"),""))
    reset_kimi : Unit <- expect("reset-kimi-none",String.eq(UW.reset_text_of(kimi_cause()),""))
    reset_zai : Unit <- expect("reset-zai-split",String.eq(UW.reset_text_of(zai_cause()),"2026-10-06 07:12:52"))
    reset_iso : Unit <- expect("reset-iso-z",String.eq(UW.reset_text_of(iso_z()),"2026-10-12T23:25:59Z"))
    reset_offset : Unit <- expect("reset-iso-offset",String.eq(UW.reset_text_of(iso_offset()),"2026-10-17T03:41:00+00:00"))
    reset_split : Unit <- expect("reset-split-date-time",String.eq(UW.reset_text_of(split_dt()),"2026-10-06 07:12:52"))
    reset_plain : Unit <- expect("reset-none-plain",String.eq(UW.reset_text_of("quota exceeded"),""))
    reset_clock : Unit <- expect("reset-clock-alone-none",String.eq(UW.reset_text_of("resets at 07:12:52"),""))
    match_binding : Unit <- expect("match-binding",Tx.starts_with(UW.window_match_sql("omp","kimi-code","main"),"harness='omp' AND provider='kimi-code' AND (account='main' OR account='')"))
    unknown_reset : Unit <- expect("record-null-reset",String.eq(UW.parsed_reset_sql(""),"NULL"))
    dated_reset : Unit <- expect("record-parsed-reset",Tx.starts_with(UW.parsed_reset_sql("2026-10-06 07:12:52"),"(SELECT CAST(strftime('%s','2026-10-06 07:12:52',"))
    printed : Unit <- IO.print("fixture-windows-ok")
    IO.pure(Unit,Unit{})

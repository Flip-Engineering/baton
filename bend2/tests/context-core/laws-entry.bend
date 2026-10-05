# The isolated qualification entry of the context core modules. It imports the
# three law modules, so this compile verifies every law they state, and it runs
# the real selection, identity, applicability and admission functions over one
# fixture each and prints the observed answer. It is module qualification: the
# delivered gate is the import of these law modules by coordinator/laws.bend,
# which the interfaces owner wires.
#
# Build and run from the repository root:
#   sh bend2/scripts/build-native.sh bend2/tests/context-core/laws-entry.bend .scratch/context-core-entry
#   ./.scratch/context-core-entry

import Base
import ../../src/context/engines.bend as Eng
import ../../src/context/snapshot.bend as Snap
import ../../src/context/refs.bend as Refs
import ../../src/context/engines-laws.bend as EngLaws
import ../../src/context/snapshot-laws.bend as SnapLaws
import ../../src/context/refs-laws.bend as RefLaws

def choice_text(c: Eng.EngineChoice) -> String:
  match c:
    case Eng.EOne{engine}: "one:" ++ engine
    case Eng.EMany{candidates}: "many"
    case Eng.ENone{reason}: "none:" ++ reason

def resolved_text(r: Eng.EngineResolved) -> String:
  match r:
    case Eng.RSelected{engine, provider, version, executable}: "selected:" ++ engine ++ ":" ++ provider ++ ":" ++ version
    case Eng.RUnavailable{engine, reason}: "unavailable:" ++ engine ++ ":" ++ reason
    case Eng.RExcluded{engine, reason}: "excluded:" ++ engine ++ ":" ++ reason
    case Eng.RCandidates{candidates}: "candidates"
    case Eng.RNone{reason}: "none:" ++ reason

def applies_text(a: Snap.Applies) -> String:
  match a:
    case Snap.ACurrent{}: "current"
    case Snap.AStale{changed}: "stale"
    case Snap.AHistorical{reason}: "historical:" ++ reason
    case Snap.AUnknown{reason}: "unknown:" ++ reason

# The comma-joined effect names of a chain, empty when nothing is required.
def effects_text(xs: Eng.SS) -> String:
  match xs:
    case Eng.SSNil{}: ""
    case Eng.SSCons{h, Eng.SSNil{}}: h
    case Eng.SSCons{h, r}: h ++ "," ++ effects_text(r)

def check_text(c: Snap.CaptureCheck) -> String:
  match c:
    case Snap.CCIntact{}: "intact"
    case Snap.CCChanged{paths}: "changed"

def decision_text(d: Refs.RefDecision) -> String:
  match d:
    case Refs.RAllow{projections}: "allow"
    case Refs.RUnknownId{}: "unknown"
    case Refs.RUnverified{reason}: "unverified:" ++ reason
    case Refs.RStaleRef{fresh}: "stale:" ++ fresh
    case Refs.REffectMissing{effect}: "missing:" ++ effect
    case Refs.RProjectionRefused{projection}: "projection:" ++ projection
    case Refs.RSubjectRefused{kind}: "subject:" ++ kind

def chk(ok: Bool, +why: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("ok " ++ why)
    case False{}: IO.die(Unit, 1, "FAIL " ++ why)

def all_ok() -> List<Bool>:
  [ String.eq(choice_text(Eng.auto("position", "src/handler.ts", "", Eng.ss_one("definition"))), "one:typescript"),
    String.eq(choice_text(Eng.auto("symbol", "src/report.c", "", Eng.ss_two("authorization", "databaseAccesses"))), "one:clang-analyzer"),
    String.eq(choice_text(Eng.auto("position", "src/handler.cpp", "", Eng.ss_one("authorization"))), "none:C++ analysis projections are outside the initial supported set"),
    String.eq(choice_text(Eng.auto("position", "src/handler", "", Eng.ss_one("definition"))), "many"),
    String.eq(resolved_text(Eng.resolve(Eng.EOne{"clangd"}, [Eng.Engine{"clangd", "llvm-clangd", "20.1.8", "/usr/local/bin/clangd", Eng.SSNil{}, Eng.SSNil{}, Eng.AvUnavailable{"probe failed"}, Eng.SSNil{}}])), "unavailable:clangd:probe failed"),
    String.eq(Snap.identity_text("typescript", "5.9.3", ["project/lib.json"], Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}])), "[\"baton2.context.snapshot.v1\",\"typescript\",\"5.9.3\",[\"project/lib.json\"],[[\"source\",\"/work/a.ts\",\"aa\"]]]"),
    String.eq(applies_text(Snap.applies(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.RvOk{Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "bb"}])})), "stale"),
    String.eq(check_text(Snap.capture_check(Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "aa"}]), Snap.fps_of_list([Snap.FpFile{"source", "/work/a.ts", "bb"}]))), "changed"),
    String.eq(Refs.source_ref("/work/a.ts", "sha", 40, 17, "definition"), "[\"source\",\"/work/a.ts\",\"sha\",40,17,\"definition\"]"),
    String.eq(decision_text(Refs.admit(Refs.RQ{True{}, "symbol", Eng.ss_one("authorization"), Eng.ss_one("authorization"), Snap.ACurrent{}, Eng.ss_one("planTargetSql"), Eng.SSNil{}, "[]"})), "missing:planTargetSql"),
    String.eq(decision_text(Refs.admit(Refs.RQ{True{}, "symbol", Eng.ss_one("definition"), Eng.ss_one("definition"), Snap.ACurrent{}, Eng.SSNil{}, Eng.SSNil{}, "[]"})), "allow"),
    String.eq(Refs.condition(Refs.RStaleRef{"[]"}), "staleReference"),
    String.eq(effects_text(Eng.required_effects(Eng.op_runtime_observe())), ""),
    String.eq(effects_text(Eng.required_effects(Eng.op_runtime_evaluate())), "controlRuntime,evaluateRuntime"),
    String.eq(effects_text(Eng.required_effects(Eng.op_schema_validation())), ""),
    String.eq(effects_text(Eng.required_effects(Eng.op_migration_replay())), "replayMigrations"),
    String.eq(effects_text(Eng.required_effects(Eng.op_code_access_join())), "planTargetSql"),
    String.eq(effects_text(Eng.required_effects(Eng.op_query_control_release())), "controlRuntime"),
    String.eq(effects_text(Eng.required_effects(Eng.op_query_control_recover())), ""),
    String.eq(choice_text(Eng.auto("runtime", "", "", Eng.ss_one("state"))), "one:cdp") ]

def run_go(xs: List<Bool>, +i: U32) -> IO(Unit):
  match xs:
    case Nil{}: IO.print("context-core fixtures: all green")
    case h <> t:
      IO.bind(Unit, Unit, chk(h, U32.show(i)),
      _u => run_go(t, U32.add(i, 1)))

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    _a : Unit <- run_go(all_ok(), 1)
    _b : Unit <- IO.print(Refs.runtime_ref("rt:q7", "ad:1", "worker:2", 3, 5, "object", "handle:9"))
    _c : Unit <- IO.print(resolved_text(Eng.resolve(Eng.EMany{Eng.ss_two("typescript", "clangd")}, [])))
    _d : Unit <- IO.print(choice_text(Eng.auto("entity", "", "sqlite-schema", Eng.ss_one("entities"))))
    IO.pure(Unit, Unit{})

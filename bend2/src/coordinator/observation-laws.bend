import Base
import ./turn.bend as Turn
import ./logs.bend as Logs
import ../coordinator/commands.bend as C

law a_terminal_outside_the_admitted_execution_is_not_a_report:
  for +state: String
  {Turn.terminal_observation_sealed(False{},True{},False{},state) == True{} : Bool}

law the_first_admitted_terminal_remains_reportable:
  {Turn.terminal_observation_sealed(False{},True{},True{},"") == False{} : Bool}

law a_repeated_or_conflicting_terminal_is_sealed:
  for +state: String
  {Turn.terminal_observation_sealed(False{},True{},True{},state) == Bool.not(String.is_empty(state)) : Bool}

def a_terminal_outside_the_admitted_execution_is_not_a_report(state):
  {==}

def the_first_admitted_terminal_remains_reportable():
  {==}

def a_repeated_or_conflicting_terminal_is_sealed(state):
  {==}

law a_quiet_level_drops_a_classified_nonterminal_projection:
  {Logs.store_projected("quiet","response","line") == "" : String}

law a_quiet_level_keeps_terminal_and_unclassified_projections:
  {Bool.and(String.eq(Logs.store_projected("quiet","agent_end","line"),"line"),
    String.eq(Logs.store_projected("quiet","","line"),"line")) == True{} : Bool}

law default_and_diagnostic_levels_keep_the_retained_line:
  {Bool.and(String.eq(Logs.store_projected("default","response","line"),"line"),
    String.eq(Logs.store_projected("diagnostic","response","line"),"line")) == True{} : Bool}

law only_the_cumulative_omp_kinds_upsert:
  {Bool.and(Logs.cumulative_kind("message_update"),
    Bool.and(Logs.cumulative_kind("tool_execution_update"),
      Bool.not(Logs.cumulative_kind("message_start")))) == True{} : Bool}

law an_observation_without_an_attempt_stores_nothing:
  {C.observation_store_sql("player","","message_update","r1","default","frame","line",True{}) == "" : String}

def a_quiet_level_drops_a_classified_nonterminal_projection():
  {==}

def a_quiet_level_keeps_terminal_and_unclassified_projections():
  {==}

def default_and_diagnostic_levels_keep_the_retained_line():
  {==}

def only_the_cumulative_omp_kinds_upsert():
  {==}

def an_observation_without_an_attempt_stores_nothing():
  {==}

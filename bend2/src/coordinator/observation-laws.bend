import Base
import ./turn.bend as Turn

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

import Base

def actions() -> String:
  "Use baton inbox to read complete input, baton report \"text\" to report progress, and baton ask \"question\" to reach your coordinator. Use baton send PLAYER \"text\" to send a report and baton guide PLAYER \"text\" to send guidance. Use baton finish \"summary\" when the assignment is ready; your coordinator confirms it with baton confirm PLAYER. Baton resolves your project and session and records handling of complete owned reads after a successful native turn. Direct operator instructions and explicit stops remain effective.\n"

def pending() -> String:
  "Baton input is pending. Run baton inbox and handle the complete input. Baton records handling after a successful turn. Continue the assignment until your coordinator confirms completion. Explicit stops remain effective."

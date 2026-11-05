import Base

def actions() -> String:
  "Use baton inbox to read complete input, baton report \"text\" to report progress, and baton ask \"question\" to reach your coordinator. Use baton send PLAYER \"text\" to send a report and baton guide PLAYER \"text\" to send guidance. Use baton finish \"summary\" when the assignment is ready; your coordinator confirms it with baton confirm PLAYER. Baton records delivery and complete reads internally. Direct operator instructions and explicit stops remain effective.\nUse repl context to read your committed context value. A pure Bend2 String evaluation can carry JSON context; repl checkpoint selects that checked cell as your context variable. Native turn completion pins its exact version. Use repl share for a recipient-authorized citation and repl context --cell CITATION with offset and length for appended bounded reads.\n"

def pending() -> String:
  "Baton input is pending. Run baton inbox and handle the complete input. Baton records delivery and complete reads internally. Continue the assignment until your coordinator confirms completion. Explicit stops remain effective."

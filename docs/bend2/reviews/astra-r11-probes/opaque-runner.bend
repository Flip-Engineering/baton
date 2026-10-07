import Base

law Outcome:
  Data

def run() -> IO(Outcome):
  import "./opaque-runner.c"
  import "./opaque-runner.js"

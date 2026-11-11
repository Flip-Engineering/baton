import Base

type Outcome is Data:
  Passed{}
  Failed{}
  Absent{}

def run() -> Outcome:
  Passed{}

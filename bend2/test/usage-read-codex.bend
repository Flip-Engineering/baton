# Runs the usage reader for the fake app-server shutdown fixture.
import Base
import ../harness/usage-read.bend as Reader

def main() -> IO(Unit):
  Reader.main()

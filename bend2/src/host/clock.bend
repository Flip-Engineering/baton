import Base

# The wall clock in milliseconds. The value is a decimal text because the
# observation record carries milliseconds without a narrowing conversion.
def Clock.millis() -> IO(Result<&1,&1,U32 & String,String>):
  import "./credit-transport.c"

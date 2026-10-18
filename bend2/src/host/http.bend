import Base

# Mechanical HTTPS request. The arguments are the method, URL, newline-separated
# request headers, and the body. The result is the HTTP status text and the
# response body bytes. Policy stays in the caller.
def Http.request(method: String, url: String, headers: String, body: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  import "./credit-transport.c"

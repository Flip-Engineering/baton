# One usage request. The native usage-read helper resolves the named credential
# inside its request boundary and passes it only to this header construction.
import Base
import ../src/host/http.bend as Http
import ../src/coordinator/kimi-usage.bend as Parser

def source() -> String:
  "GET https://api.kimi.com/coding/v1/usages"

def windows_sql(+response: String) -> String:
  Parser.kimi_windows_sql(response)

def request(+key: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  Http.Http.request("GET","https://api.kimi.com/coding/v1/usages","Authorization: Bearer " ++ key ++ "","")

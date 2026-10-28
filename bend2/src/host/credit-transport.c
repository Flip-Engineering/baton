/* Mechanical transport for the native credit observation helper. Product
   policy lives in Bend2; this file performs one HTTPS request, validates JSON
   with the linked SQLite reader, and reports the wall clock in milliseconds. */
#include <curl/curl.h>
#include <sqlite3.h>
#include <time.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef CID_HTTP_REQUEST
typedef struct {
  char *method;
  char *url;
  char *headers;
  size_t headers_length;
  char *body;
  size_t body_length;
  char *response;
  size_t response_length;
  long status;
  int error;
  char detail[256];
} BatonHttpRequest;

static size_t br_http_write(char *bytes, size_t size, size_t count, void *data) {
  BatonHttpRequest *call = (BatonHttpRequest *)data;
  size_t length = size * count;
  if (length > (size_t)-1 - call->response_length - 1) return 0;
  char *next = realloc(call->response, call->response_length + length + 1);
  if (!next) { call->error = ENOMEM; return 0; }
  call->response = next;
  memcpy(call->response + call->response_length, bytes, length);
  call->response_length += length;
  call->response[call->response_length] = 0;
  return length;
}

static int br_http_headers(BatonHttpRequest *call, struct curl_slist **list) {
  size_t start = 0;
  for (size_t i = 0; i <= call->headers_length; i++) {
    int end = i == call->headers_length || call->headers[i] == 0 || call->headers[i] == '\n';
    if (!end) continue;
    if (i > start) {
      char saved = call->headers[i];
      call->headers[i] = 0;
      struct curl_slist *next = curl_slist_append(*list, call->headers + start);
      call->headers[i] = saved;
      if (!next) return ENOMEM;
      *list = next;
    }
    start = i + 1;
  }
  return 0;
}

static void br_http_call(IoWork *w) {
  BatonHttpRequest *call = (BatonHttpRequest *)w->data;
  CURL *curl = curl_easy_init();
  if (!curl) { call->error = ENOMEM; return; }
  struct curl_slist *headers = NULL;
  call->error = br_http_headers(call, &headers);
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_URL, call->url) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, call->method) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, "") != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, br_http_write) != CURLE_OK;
  /* curl_easy_setopt is variadic and libcurl reads CURLOPT_WRITEDATA as void *. */
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void *)call) != CURLE_OK;
  if (!call->error) call->error = curl_easy_setopt(curl, CURLOPT_ERRORBUFFER, call->detail) != CURLE_OK;
  if (!call->error && call->body_length)
    call->error = curl_easy_setopt(curl, CURLOPT_POSTFIELDS, call->body) != CURLE_OK ||
      curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)call->body_length) != CURLE_OK;
  if (!call->error) {
    CURLcode code = curl_easy_perform(curl);
    if (code != CURLE_OK) {
      call->error = EIO;
      if (!call->detail[0])
        snprintf(call->detail, sizeof(call->detail), "%s", curl_easy_strerror(code));
    } else if (curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &call->status) != CURLE_OK) {
      call->error = EIO;
      snprintf(call->detail, sizeof(call->detail), "response status is unavailable");
    }
  }
  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);
}

static Term br_http_pack(Env e, IoWork *w) {
  BatonHttpRequest *call = (BatonHttpRequest *)w->data;
  Term result;
  if (call->error) {
    result = io_fail(e, call->error, call->detail[0] ? call->detail : "HTTP transport failed");
  } else {
    char status[32];
    snprintf(status, sizeof(status), "%ld", call->status);
    result = io_done(e, io_tup(e,
      io_str(e, status, strlen(status)),
      io_str(e, call->response ? call->response : "", call->response_length)));
  }
  free(call->method); free(call->url); free(call->headers); free(call->body); free(call->response); free(call);
  w->data = NULL;
  return result;
}

static Term br_http_request(Env e, Term *f, IoWork *w) {
  BatonHttpRequest *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  u64 method_length = 0, url_length = 0, body_length = 0;
  call->method = io_cstr(e, f[0], &method_length);
  call->url = io_cstr(e, f[1], &url_length);
  call->headers = io_cstr(e, f[2], &call->headers_length);
  call->body = io_cstr(e, f[3], &body_length);
  call->body_length = body_length;
  if (!call->method || strlen(call->method) != method_length) call->error = EINVAL;
  if (!call->url || strlen(call->url) != url_length) call->error = EINVAL;
  if (!call->headers) call->error = EINVAL;
  if (!call->body) call->error = EINVAL;
  w->data = (char *)call;
  if (call->error) return br_http_pack(e, w);
  return io_work(w, br_http_call, br_http_pack);
}

static void __attribute__((constructor)) br_http_use(void) {
  curl_global_init(CURL_GLOBAL_DEFAULT);
  io_eff(CID_HTTP_REQUEST, br_http_request, 0);
}
#endif

#ifdef CID_JSON_VALID
typedef struct {
  char *text;
  size_t length;
  int valid;
  int error;
  char detail[128];
} BatonJsonValid;

static void br_json_valid_call(IoWork *w) {
  BatonJsonValid *call = (BatonJsonValid *)w->data;
  sqlite3 *db = NULL;
  sqlite3_stmt *statement = NULL;
  int rc = sqlite3_open(":memory:", &db);
  if (rc != SQLITE_OK) { call->error = EIO; snprintf(call->detail, sizeof(call->detail), "sqlite open failed: %d", rc); goto done; }
  rc = sqlite3_prepare_v2(db, "SELECT json_valid(?1)", -1, &statement, NULL);
  if (rc != SQLITE_OK) { call->error = EIO; snprintf(call->detail, sizeof(call->detail), "sqlite prepare failed: %d", rc); goto done; }
  if (call->length > 0x7fffffff) { call->error = EINVAL; snprintf(call->detail, sizeof(call->detail), "JSON document is too large"); goto done; }
  rc = sqlite3_bind_text(statement, 1, call->text, (int)call->length, SQLITE_TRANSIENT);
  if (rc != SQLITE_OK) { call->error = EIO; snprintf(call->detail, sizeof(call->detail), "sqlite bind failed: %d", rc); goto done; }
  rc = sqlite3_step(statement);
  if (rc != SQLITE_ROW) { call->error = EIO; snprintf(call->detail, sizeof(call->detail), "sqlite step failed: %d", rc); goto done; }
  call->valid = sqlite3_column_int(statement, 0);
done:
  if (statement) sqlite3_finalize(statement);
  if (db) sqlite3_close(db);
}

static Term br_json_valid_pack(Env e, IoWork *w) {
  BatonJsonValid *call = (BatonJsonValid *)w->data;
  Term result = call->error
    ? io_fail(e, call->error, call->detail)
    : io_done(e, (Term)(u32)call->valid);
  free(call->text); free(call); w->data = NULL;
  return result;
}

static Term br_json_valid(Env e, Term *f, IoWork *w) {
  BatonJsonValid *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  call->text = io_cstr(e, f[0], &call->length);
  if (!call->text) { free(call); return io_fail(e, EINVAL, NULL); }
  w->data = (char *)call;
  return io_work(w, br_json_valid_call, br_json_valid_pack);
}

static void __attribute__((constructor)) br_json_valid_use(void) {
  io_eff(CID_JSON_VALID, br_json_valid, 0);
}
#endif

#ifdef CID_CLOCK_MILLIS
typedef struct { int error; char text[32]; } BatonClock;

static void br_clock_call(IoWork *w) {
  BatonClock *call = (BatonClock *)w->data;
  struct timespec now;
  if (clock_gettime(CLOCK_REALTIME, &now)) { call->error = errno; return; }
  long long millis = (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
  snprintf(call->text, sizeof(call->text), "%lld", millis);
}

static Term br_clock_pack(Env e, IoWork *w) {
  BatonClock *call = (BatonClock *)w->data;
  Term result = call->error
    ? io_fail(e, call->error, "wall clock is unavailable")
    : io_done(e, io_str(e, call->text, strlen(call->text)));
  free(call); w->data = NULL;
  return result;
}

static Term br_clock_millis(Env e, Term *f, IoWork *w) {
  (void)f;
  BatonClock *call = calloc(1, sizeof(*call));
  if (!call) return io_fail(e, ENOMEM, NULL);
  w->data = (char *)call;
  return io_work(w, br_clock_call, br_clock_pack);
}

static void __attribute__((constructor)) br_clock_use(void) {
  io_eff(CID_CLOCK_MILLIS, br_clock_millis, 0);
}
#endif

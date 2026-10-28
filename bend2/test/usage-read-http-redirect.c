/* Preloaded into the usage-read helper by usage-read-deepseek.py. When the helper
   sets a request URL that starts with BATON2_TEST_HTTP_FROM, the URL is rewritten
   to start with BATON2_TEST_HTTP_TO and the original URL is appended to
   BATON2_TEST_HTTP_RECORD. Every other option, the request headers and the
   transfer go to libcurl unchanged. The declarations below follow the libcurl
   ABI: curl_easy_setopt is variadic, CURLcode is an int, and CURLOPT_URL is
   CURLOPTTYPE_STRINGPOINT (10000) + 2. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FIXTURE_CURLOPT_URL 10002

int curl_easy_setopt(void *handle, int option, ...) {
  static int (*library)(void *, int, ...);
  va_list arguments;
  va_start(arguments, option);
  void *value = va_arg(arguments, void *);
  va_end(arguments);
  if (!library) library = (int (*)(void *, int, ...))dlsym(RTLD_NEXT, "curl_easy_setopt");
  const char *from = getenv("BATON2_TEST_HTTP_FROM");
  const char *to = getenv("BATON2_TEST_HTTP_TO");
  if (option == FIXTURE_CURLOPT_URL && value && from && to && strncmp((const char *)value, from, strlen(from)) == 0) {
    const char *url = (const char *)value;
    const char *record = getenv("BATON2_TEST_HTTP_RECORD");
    if (record) {
      FILE *file = fopen(record, "a");
      if (file) {
        fprintf(file, "%s\n", url);
        fclose(file);
      }
    }
    size_t length = strlen(to) + strlen(url + strlen(from)) + 1;
    char *rewritten = malloc(length);
    if (!rewritten) return library(handle, option, value);
    snprintf(rewritten, length, "%s%s", to, url + strlen(from));
    /* libcurl copies a URL string option, so the buffer may be released. */
    int result = library(handle, option, rewritten);
    free(rewritten);
    return result;
  }
  return library(handle, option, value);
}

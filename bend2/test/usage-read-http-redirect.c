/* Preloaded into the usage-read helper by usage-read-deepseek.py. When the helper
   sets a request URL that starts with BATON2_TEST_HTTP_FROM, the URL is rewritten
   to start with BATON2_TEST_HTTP_TO and the original URL is appended to
   BATON2_TEST_HTTP_RECORD. Every other option, the request headers and the
   transfer go to libcurl unchanged. With BATON2_TEST_HTTP_OPTIONS set, each
   forwarded option number and the type it was read as are appended to that file,
   with the value of a long option.

   curl_easy_setopt is variadic, and the option number selects the type of its
   one argument (curl.h CURLOPTTYPE_*): below 10000 a long, 10000-19999 an object
   pointer, 20000-29999 a function pointer, 30000-39999 a curl_off_t and 40000 and
   above a struct curl_blob pointer. bend2/src/host/credit-transport.c passes long
   values (CURLOPT_FOLLOWLOCATION, CURLOPT_NOSIGNAL, CURLOPT_POSTFIELDSIZE),
   object pointers (CURLOPT_URL, CURLOPT_HTTPHEADER, CURLOPT_WRITEDATA) and a
   function pointer (CURLOPT_WRITEFUNCTION). Each argument is read with its own
   type and forwarded with that type. This host has no curl headers, so the
   declarations follow the libcurl ABI: CURLcode is an int and CURLOPT_URL is
   10000 + 2. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FIXTURE_CURLOPTTYPE_OBJECTPOINT 10000
#define FIXTURE_CURLOPTTYPE_FUNCTIONPOINT 20000
#define FIXTURE_CURLOPTTYPE_OFF_T 30000
#define FIXTURE_CURLOPTTYPE_BLOB 40000
#define FIXTURE_CURLOPT_URL (FIXTURE_CURLOPTTYPE_OBJECTPOINT + 2)

typedef int (*setopt_function)(void *, int, ...);
typedef void (*callback_function)(void);

static setopt_function library_setopt(void) {
  static setopt_function library;
  if (!library) library = (setopt_function)dlsym(RTLD_NEXT, "curl_easy_setopt");
  return library;
}

static int redirected_url(void *handle, const char *url) {
  const char *from = getenv("BATON2_TEST_HTTP_FROM");
  const char *to = getenv("BATON2_TEST_HTTP_TO");
  if (!url || !from || !to || strncmp(url, from, strlen(from)) != 0)
    return library_setopt()(handle, FIXTURE_CURLOPT_URL, url);
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
  if (!rewritten) return library_setopt()(handle, FIXTURE_CURLOPT_URL, url);
  snprintf(rewritten, length, "%s%s", to, url + strlen(from));
  /* libcurl copies a URL string option, so the buffer may be released. */
  int result = library_setopt()(handle, FIXTURE_CURLOPT_URL, rewritten);
  free(rewritten);
  return result;
}

static void record_option(int option, const char *type, const char *value) {
  const char *path = getenv("BATON2_TEST_HTTP_OPTIONS");
  if (!path) return;
  FILE *file = fopen(path, "a");
  if (!file) return;
  fprintf(file, "%d %s%s%s\n", option, type, value ? " " : "", value ? value : "");
  fclose(file);
}

int curl_easy_setopt(void *handle, int option, ...) {
  va_list arguments;
  va_start(arguments, option);
  int result;
  if (option < FIXTURE_CURLOPTTYPE_OBJECTPOINT) {
    long value = va_arg(arguments, long);
    char text[32];
    snprintf(text, sizeof text, "%ld", value);
    record_option(option, "long", text);
    result = library_setopt()(handle, option, value);
  } else if (option < FIXTURE_CURLOPTTYPE_FUNCTIONPOINT) {
    void *value = va_arg(arguments, void *);
    record_option(option, "object", NULL);
    result = option == FIXTURE_CURLOPT_URL ? redirected_url(handle, (const char *)value)
                                           : library_setopt()(handle, option, value);
  } else if (option < FIXTURE_CURLOPTTYPE_OFF_T) {
    callback_function value = va_arg(arguments, callback_function);
    record_option(option, "function", NULL);
    result = library_setopt()(handle, option, value);
  } else if (option < FIXTURE_CURLOPTTYPE_BLOB) {
    int64_t value = va_arg(arguments, int64_t);
    record_option(option, "off_t", NULL);
    result = library_setopt()(handle, option, value);
  } else {
    void *value = va_arg(arguments, void *);
    record_option(option, "blob", NULL);
    result = library_setopt()(handle, option, value);
  }
  va_end(arguments);
  return result;
}

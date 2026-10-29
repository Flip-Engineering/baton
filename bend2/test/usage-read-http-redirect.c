/* Preloaded into the usage-read helper by usage-read-deepseek.py. When the helper
   sets a request URL that starts with BATON2_TEST_HTTP_FROM, the URL is rewritten
   to start with BATON2_TEST_HTTP_TO and the original URL is appended to
   BATON2_TEST_HTTP_RECORD. Every other option, the request headers and the
   transfer go to libcurl unchanged.

   curl_easy_setopt is variadic. va_arg must name a type compatible with the
   argument the caller passed, so the shim handles exactly the options that
   bend2/src/host/credit-transport.c sets and reads each one with the type that
   file passes:
     CURLOPT_URL, CURLOPT_CUSTOMREQUEST, CURLOPT_ACCEPT_ENCODING,
       CURLOPT_ERRORBUFFER, CURLOPT_POSTFIELDS        char *
     CURLOPT_HTTPHEADER                               struct curl_slist *
     CURLOPT_WRITEFUNCTION                            curl_write_callback, the
       type of br_http_write
     CURLOPT_WRITEDATA                                void *
     CURLOPT_FOLLOWLOCATION, CURLOPT_NOSIGNAL,
       CURLOPT_POSTFIELDSIZE                          long
   Each value is forwarded to libcurl with the same type. Any other option is not
   read: the call records it as unsupported and returns CURLE_UNKNOWN_OPTION, so
   a transport that sets a new option fails the test. With
   BATON2_TEST_HTTP_OPTIONS set, each call appends its option number, the type it
   was read as and a long option's value to that file. */
#define _GNU_SOURCE
#include <curl/curl.h>
#include <dlfcn.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* curl.h defines curl_easy_setopt as a type-checking macro for GCC and clang. */
#undef curl_easy_setopt

typedef CURLcode (*setopt_function)(CURL *, CURLoption, ...);

static setopt_function library_setopt(void) {
  static setopt_function library;
  if (!library) library = (setopt_function)dlsym(RTLD_NEXT, "curl_easy_setopt");
  return library;
}

static void record_option(CURLoption option, const char *type, const char *value) {
  const char *path = getenv("BATON2_TEST_HTTP_OPTIONS");
  if (!path) return;
  FILE *file = fopen(path, "a");
  if (!file) return;
  fprintf(file, "%d %s%s%s\n", (int)option, type, value ? " " : "", value ? value : "");
  fclose(file);
}

static CURLcode redirected_url(CURL *handle, char *url) {
  const char *from = getenv("BATON2_TEST_HTTP_FROM");
  const char *to = getenv("BATON2_TEST_HTTP_TO");
  if (!url || !from || !to || strncmp(url, from, strlen(from)) != 0)
    return library_setopt()(handle, CURLOPT_URL, url);
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
  if (!rewritten) return library_setopt()(handle, CURLOPT_URL, url);
  snprintf(rewritten, length, "%s%s", to, url + strlen(from));
  /* libcurl copies a URL string option, so the buffer may be released. */
  CURLcode result = library_setopt()(handle, CURLOPT_URL, rewritten);
  free(rewritten);
  return result;
}

CURLcode curl_easy_setopt(CURL *handle, CURLoption option, ...) {
  va_list arguments;
  va_start(arguments, option);
  CURLcode result;
  switch (option) {
    case CURLOPT_URL: {
      char *value = va_arg(arguments, char *);
      record_option(option, "char*", NULL);
      result = redirected_url(handle, value);
      break;
    }
    case CURLOPT_CUSTOMREQUEST:
    case CURLOPT_ACCEPT_ENCODING:
    case CURLOPT_ERRORBUFFER:
    case CURLOPT_POSTFIELDS: {
      char *value = va_arg(arguments, char *);
      record_option(option, "char*", NULL);
      result = library_setopt()(handle, option, value);
      break;
    }
    case CURLOPT_HTTPHEADER: {
      struct curl_slist *value = va_arg(arguments, struct curl_slist *);
      record_option(option, "curl_slist*", NULL);
      result = library_setopt()(handle, option, value);
      break;
    }
    case CURLOPT_WRITEFUNCTION: {
      curl_write_callback value = va_arg(arguments, curl_write_callback);
      record_option(option, "curl_write_callback", NULL);
      result = library_setopt()(handle, option, value);
      break;
    }
    case CURLOPT_WRITEDATA: {
      void *value = va_arg(arguments, void *);
      record_option(option, "void*", NULL);
      result = library_setopt()(handle, option, value);
      break;
    }
    case CURLOPT_FOLLOWLOCATION:
    case CURLOPT_NOSIGNAL:
    case CURLOPT_POSTFIELDSIZE: {
      long value = va_arg(arguments, long);
      char text[32];
      snprintf(text, sizeof text, "%ld", value);
      record_option(option, "long", text);
      result = library_setopt()(handle, option, value);
      break;
    }
    default:
      record_option(option, "unsupported", NULL);
      result = CURLE_UNKNOWN_OPTION;
      break;
  }
  va_end(arguments);
  return result;
}

/* Actual file-I/O fixture for the generic JSONL snapshot reader. */
#include <stdio.h>
#include "../src/host/jsonl.c"

static const char *fixture_path, *fixture_action;
static int fixture_changed;

static void fixture_change(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc; (void)argv;
  if (!fixture_changed++) {
    if (!strcmp(fixture_action, "replace")) {
      size_t n = strlen(fixture_path) + 20;
      char *replacement = malloc(n);
      if (!replacement) { sqlite3_result_error_nomem(context); return; }
      snprintf(replacement, n, "%s.replacement", fixture_path);
      FILE *file = fopen(replacement, "wb");
      if (!file) { free(replacement); sqlite3_result_error(context, "open", -1); return; }
      fputs("{\"replacement\":true}\n", file);
      int error = fclose(file) || rename(replacement, fixture_path);
      free(replacement);
      if (error) { sqlite3_result_error(context, "replace", -1); return; }
    } else {
      FILE *file = fopen(fixture_path, !strcmp(fixture_action, "append") ? "ab" : "wb");
      if (!file) { sqlite3_result_error(context, "open", -1); return; }
      fputs("{\"changed\":true}\n", file);
      if (fclose(file)) { sqlite3_result_error(context, "write", -1); return; }
    }
  }
  sqlite3_result_int(context, 1);
}

static int fixture_extension(sqlite3 *database, char **error, const sqlite3_api_routines *api) {
  (void)error; (void)api;
  return sqlite3_create_function(database, "fixture_change", 1, SQLITE_UTF8,
                                NULL, fixture_change, NULL, NULL);
}

int main(int argc, char **argv) {
  if (argc != 3 && argc != 4) return 2;
  fixture_path = argv[1]; fixture_action = argc == 4 ? argv[3] : "";
  if (argc == 4 && sqlite3_auto_extension((void (*)(void))fixture_extension) != SQLITE_OK) return 2;
  char *text = NULL;
  size_t length = 0;
  int error = baton_jsonl_read_suffix(argv[1], argv[2], &text, &length);
  if (error) { fprintf(stderr, "%d\n", error); return 1; }
  int failed = length && fwrite(text, 1, length, stdout) != length;
  free(text);
  return failed ? 2 : 0;
}

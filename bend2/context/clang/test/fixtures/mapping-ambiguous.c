/* Mapping-ambiguity discriminator. The handler body is byte-identical to a
 * second function in the same file, so any generated/original segment search
 * for either function finds two occurrences and must refuse the original
 * correspondence for both while keeping direct generated-source facts. */
struct Stmt;
typedef struct Stmt Stmt;

int prepare(Stmt *stmt, const char *sql);
int step(Stmt *stmt);
int g_ok(void);

void handler(void) {
  Stmt q;
  if (!g_ok()) {
    return;
  }
  if (prepare(&q, "SELECT id FROM events") != 0)
    return;
  while (step(&q) == 0) {
  }
}

void handler_copy(void) {
  Stmt q;
  if (!g_ok()) {
    return;
  }
  if (prepare(&q, "SELECT id FROM events") != 0)
    return;
  while (step(&q) == 0) {
  }
}

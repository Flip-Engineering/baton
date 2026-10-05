/* S13: a declared filter whose body is unavailable. The declaration supplies a
   role assumption; it cannot establish sanitization or an enforcement claim. */
extern int declared_filter(const char *zValue);
int recorded_effect(void);

int handler(int ok, const char *zValue) {
  if (!ok) {
    return -1;
  }
  if (declared_filter(zValue)) {
    return 0;
  }
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

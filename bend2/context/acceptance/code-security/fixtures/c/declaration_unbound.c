/* S14: the declared requirement's principal and resource are not the operands
   the guard tests. The selectors resolve, and no code relationship matches, so
   the requirement reports declarationUnbound with no invented relation. */
int recorded_effect(void);

int handler(int ok, const char *zValue) {
  int unused_principal = ok;
  const char *unused_resource = zValue;
  if (!ok) {
    return -1;
  }
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

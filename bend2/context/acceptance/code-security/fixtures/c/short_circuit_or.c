/* S2: an `||` guard. Both true edges are in the accepted set: the edge taken
   when the first operand is true, and the edge taken when the first operand is
   false and the second is true. No single short-circuit edge dominates the
   call. */
int recorded_effect(void);

int handler(int ok, int tkt) {
  int r = 0;
  if (ok || tkt) {
    r = recorded_effect();
  }
  return r;
}

int recorded_effect(void) { return 1; }

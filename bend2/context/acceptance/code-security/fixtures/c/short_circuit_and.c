/* S1: an `&&` guard. The accepted exit-edge set holds the true edges of both
   operands, so the witness references the whole set. */
int recorded_effect(void);

int handler(int ok, int tkt) {
  int r = 0;
  if (ok && tkt) {
    r = recorded_effect();
  }
  return r;
}

int recorded_effect(void) { return 1; }

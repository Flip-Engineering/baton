/* S6: a reachable cycle on the denial side. The cycle leaves the guarded
   relation unavailable; the remaining facts stay available. */
int recorded_effect(void);

int handler(int ok, int n) {
  if (!ok) {
    while (n) {
      n = n - 1;
    }
    return -1;
  }
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

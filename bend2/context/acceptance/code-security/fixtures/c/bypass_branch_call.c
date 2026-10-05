/* S5: an effect call on a branch that skips the guard. The guarded relation may
   name only a call whose removal of the whole accepted edge set disconnects
   entry from that call. */
int recorded_effect(void);

int handler(int mode, int ok) {
  int r = 0;
  if (mode) {
    r = recorded_effect();
  }
  if (!ok) {
    return -1;
  }
  r = recorded_effect();
  return r;
}

int recorded_effect(void) { return 1; }

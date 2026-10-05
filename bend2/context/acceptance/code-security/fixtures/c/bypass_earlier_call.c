/* S4: an effect call before the guard. Entry reaches this call without passing
   through the guard, so no guarded relation may name it. */
int recorded_effect(void);

int handler(int ok) {
  int r = recorded_effect();
  if (!ok) {
    return -1;
  }
  r = recorded_effect();
  return r;
}

int recorded_effect(void) { return 1; }

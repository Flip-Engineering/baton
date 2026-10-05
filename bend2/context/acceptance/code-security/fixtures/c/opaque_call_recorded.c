/* S7: an intervening opaque call between the guard and the effect call. The
   call is recorded and keeps the ordinary call/return assumption. The guard
   operand is not address-taken, so the relation stays available. */
int recorded_effect(void);
extern int opaque_step(int x);

int handler(int ok) {
  if (!ok) {
    return -1;
  }
  opaque_step(1);
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

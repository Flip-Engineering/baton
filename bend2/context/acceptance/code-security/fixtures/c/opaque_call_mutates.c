/* S8: the guard operand's address escapes to an opaque call before the effect
   call. The call may replace the value the guard tested, so the guarded
   relation is unavailable. */
int recorded_effect(void);
extern int opaque_use(int *p);

int handler(int ok) {
  if (!ok) {
    return -1;
  }
  opaque_use(&ok);
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

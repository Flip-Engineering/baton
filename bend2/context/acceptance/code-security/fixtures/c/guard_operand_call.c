/* S9: a call inside the guard expression. A guard expression admits
   nonvolatile integer and record-field reads; a call makes the guard relation
   unavailable. */
int recorded_effect(void);
extern int probe(int x);

int handler(int ok) {
  if (!probe(ok)) {
    return -1;
  }
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

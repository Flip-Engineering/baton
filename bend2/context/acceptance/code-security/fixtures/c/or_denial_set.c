/* S3: an `||` denial. The denied routes hold the false-edges of both operands
   and each route reaches the mapped return before the effect call. */
int recorded_effect(void);

int handler(int a, int b) {
  if (!a || !b) {
    return -1;
  }
  return recorded_effect();
}

int recorded_effect(void) { return 1; }

#include <stdio.h>

/* The real native-entry wrapper supplies the runtime argv after routing. */
int baton2_runtime_main(int argc, char **argv) {
  for (int i = 0; i < argc; i++) puts(argv[i]);
  int value;
  while ((value = getchar()) != EOF) putchar(value);
  return 0;
}

#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

int baton2_runtime_main(int argc, char **argv);

/* Pass the complete application argv through the runtime's argument boundary. */
int main(int argc, char **argv) {
  if (argc < 1 || argc == INT_MAX ||
      (size_t)argc > SIZE_MAX / sizeof(char *) - 2) {
    fputs("baton2: invalid native argument count.\n", stderr);
    return 1;
  }
  char **application = calloc((size_t)argc + 2, sizeof(*application));
  if (!application) {
    fputs("baton2: cannot allocate native arguments.\n", stderr);
    return 1;
  }
  application[0] = argv[0];
  application[1] = "--";
  for (int i = 1; i < argc; i++) application[i + 1] = argv[i];
  int status = baton2_runtime_main(argc + 1, application);
  free(application);
  return status;
}

/* Capture identity subject: this file and both headers carry a phase line that
   the runner rewrites while a query runs. A published snapshot records the
   inputs of one phase. */
#include "alpha.h"
#include "beta.h"

#define MAIN_PHASE 0

int capture_subject(int ok) {
  if (!ok) {
    return -1;
  }
  return alpha_value() + beta_value();
}

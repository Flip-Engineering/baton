#include "handler.h"

/* Negative: a pointer dereference in the condition makes the guard relation
 * unavailable; the call fact itself remains ordinary discovery. */
int view_deref(const int *p) {
    if (*p == 0) {
        return 1;
    }
    return record_view();
}

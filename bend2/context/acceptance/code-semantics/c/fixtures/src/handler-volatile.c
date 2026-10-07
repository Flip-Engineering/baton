#include "handler.h"

/* Negative: a volatile operand makes the guard relation unavailable. */
void view_volatile(void) {
    if (g_state.volatile_flag == 0) {
        return;
    }
    (void)record_view();
}

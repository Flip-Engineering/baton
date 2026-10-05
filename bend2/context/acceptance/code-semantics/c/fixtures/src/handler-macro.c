#include "handler.h"

#define DENIED_READ (g_state.ok_read == 0)

/* Negative: the condition exists only through macro expansion; no exact source
 * mapping for the condition span means the guard mapping is unavailable. */
void view_macro(void) {
    if (DENIED_READ) {
        return;
    }
    (void)record_view();
}

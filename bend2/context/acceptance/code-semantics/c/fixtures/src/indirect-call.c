#include "handler.h"

typedef int (*view_effect)(void);

/* Indirect call: the callee identity is unavailable while the call fact and its
 * pointer operand remain ordinary discovery results. */
int view_indirect(view_effect effect) {
    if (!g_state.ok_read) {
        return 1;
    }
    return effect();
}

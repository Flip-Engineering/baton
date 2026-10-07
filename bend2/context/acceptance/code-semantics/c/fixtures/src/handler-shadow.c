#include "handler.h"

/* Negative: shadowed names are distinct declarations. Neither the local
 * variable nor the parameter binds to the global record_view function, and
 * neither site is a call. */
int view_shadow_local(void) {
    int record_view = 0;
    if (record_view == 0) {
        return 1;
    }
    return record_view;
}

static int invoke_effect(int record_view) {
    if (record_view < 0) {
        return 0;
    }
    return record_view + 1;
}

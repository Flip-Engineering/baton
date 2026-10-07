#include "handler.h"

/* CFG mapping fixture: decision with two successors, short-circuit operands,
 * a loop back edge, and an early return. Expected relations are asserted
 * against actual extracted blocks, never against block numbers. */
int cfg_ifelse(int a, int b) {
    int r = 0;
    if (a > b) {
        r = 1;
    } else {
        r = 2;
    }
    return r;
}

int cfg_shortcircuit(int a, int b) {
    if (a > 0 && b > 0) {
        return 1;
    }
    return 0;
}

int cfg_loop(int n) {
    int i = 0;
    int acc = 0;
    while (i < n) {
        acc += i;
        i += 1;
    }
    return acc;
}

int cfg_earlyreturn(int a) {
    if (a < 0) {
        return -1;
    }
    return a * 2;
}

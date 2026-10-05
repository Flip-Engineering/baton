#ifndef HANDLER_H
#define HANDLER_H

/* Shared fixture surface for the code-semantics C corpus. The db_* helpers are
 * stand-in definitions with the authentic callee shape (pointer-to-stmt first
 * parameter, const char * statement, variadic tail); they are fixture inputs,
 * not provider or target software. */

struct session_state {
    int ok_read;
    int ok_edit;
    volatile int volatile_flag;
};

typedef struct stmt {
    int state;
} stmt;

extern struct session_state g_state;

extern int log_note(const char *msg);
extern int record_view(void);
extern int db_prepare(stmt **pstmt, const char *sql, ...);
extern int db_step(stmt *s);
extern int db_finalize(stmt *s);

#endif

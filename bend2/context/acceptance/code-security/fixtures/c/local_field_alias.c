/* S15: the guard reads a resolved local record field and the effect argument
   carries the same field. The input path steps are definition, resolved field
   load and direct-call argument binding. */
typedef struct Req {
  int ok;
  const char *zUser;
} Req;

int recorded_effect(const char *zValue);

int handler(Req *pReq) {
  if (!pReq->ok) {
    return -1;
  }
  return recorded_effect(pReq->zUser);
}

int recorded_effect(const char *zValue) { return zValue != 0; }

// C effect: connect to a Unix domain socket, write data, close.
// Used for Claude Code cross-session wake delivery to /tmp/cc-socks/<pid>.sock.

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#ifdef CID_UNIXSOCKET_SEND

// UnixSocket.send(path: String, data: String) -> IO(Unit)
// Connect to a Unix domain socket, write data, and close. One-shot delivery.
Term unixsocket_send_run(Env e, Term* f, IoWork* w) {
  u64 path_len = 0, data_len = 0;
  char* path = io_cstr(e, f[0], &path_len);
  char* data = io_cstr(e, f[1], &data_len);

  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    int err = errno;
    free(path);
    free(data);
    return io_fail(e, err, "socket creation failed");
  }

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  if (path_len >= sizeof(addr.sun_path)) {
    close(fd);
    free(path);
    free(data);
    return io_fail(e, ENAMETOOLONG, "socket path too long");
  }
  memcpy(addr.sun_path, path, path_len);
  free(path);

  if (connect(fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) {
    int err = errno;
    close(fd);
    free(data);
    return io_fail(e, err, "socket connect failed");
  }

  // Write all data then close.
  u64 written = 0;
  while (written < data_len) {
    ssize_t n = write(fd, data + written, data_len - written);
    if (n < 0) {
      int err = errno;
      close(fd);
      free(data);
      return io_fail(e, err, "socket write failed");
    }
    written += (u64)n;
  }

  close(fd);
  free(data);
  return term_pak(CID_UNIT, 0);
}

static void __attribute__((constructor)) unixsocket_send_use(void) {
  io_eff(CID_UNIXSOCKET_SEND, unixsocket_send_run, 0);
}

#endif

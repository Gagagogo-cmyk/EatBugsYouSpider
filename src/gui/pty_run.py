#!/usr/bin/env python3
"""pty_run.py -- run a command inside a pseudo-terminal and relay it over
plain pipes. Used by edit_agent.js ("CLAUDE LOGIN FROM THE PAGE") to run
`claude setup-token`, which needs a real terminal, from the hub (whose
stdin/stdout are pipes/sockets -- macOS `script` refuses those with
"tcgetattr/ioctl: Operation not supported on socket").
usage: pty_run.py <cmd> [args...]   (stdin -> terminal, terminal -> stdout)"""
import os, sys, pty, select, struct, fcntl, termios, subprocess, signal

def main():
    if len(sys.argv) < 2:
        sys.exit("usage: pty_run.py cmd [args...]")
    master, slave = pty.openpty()
    try:  # a very wide terminal, so long URLs/tokens are never wrapped
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 4000, 0, 0))
    except OSError:
        pass
    env = dict(os.environ, TERM=os.environ.get("TERM") or "xterm-256color", COLUMNS="4000", LINES="50")
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, env=env,
                             start_new_session=True, close_fds=True)
    os.close(slave)
    signal.signal(signal.SIGTERM, lambda *a: (child.terminate(), sys.exit(0)))
    stdin_open = True
    out = sys.stdout.buffer
    while True:
        fds = [master] + ([sys.stdin.fileno()] if stdin_open else [])
        try:
            r, _, _ = select.select(fds, [], [], 0.5)
        except InterruptedError:
            continue
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data:
                break
            out.write(data); out.flush()
        if stdin_open and sys.stdin.fileno() in r:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                stdin_open = False
            else:
                os.write(master, data)
        if child.poll() is not None and master not in r:
            # drain whatever is left
            try:
                while True:
                    r2, _, _ = select.select([master], [], [], 0.2)
                    if not r2: break
                    data = os.read(master, 65536)
                    if not data: break
                    out.write(data); out.flush()
            except OSError:
                pass
            break
    sys.exit(child.wait())

if __name__ == "__main__":
    main()

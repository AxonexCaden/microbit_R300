#!/usr/bin/env python3
"""Serialise work that must not run twice at once, on this machine.

Four repos share one IDF 6.1 tree, venv, component cache and ccache, so only one
build may run at a time. The same helper guards the other exclusive lanes; pick
the lock by setting BUILD_LOCK_PATH:

    build   /tmp/companionrobots-build.lock   global   shared toolchain
    git     /tmp/git-<repo>.lock             per repo  index.lock, non-fast-forward
    gh      /tmp/gh-<repo>.lock              per repo  Actions concurrency, issue index
    flash   /tmp/flash.lock                  global   one serial port

Usage:

    lock.py '<shell command>'
    BUILD_LOCK_PATH=/tmp/git-MyRepo.lock lock.py 'git commit -F msg'

Exit code = wrapped command's exit code. Blocks until the lock is free.
"""
import fcntl
import os
import subprocess
import sys
import time

LOCK = os.environ.get("BUILD_LOCK_PATH", "/tmp/companionrobots-build.lock")
if len(sys.argv) < 2:
    sys.exit("usage: lock.py '<command>'")

fd = os.open(LOCK, os.O_CREAT | os.O_RDWR, 0o644)
t0 = time.time()
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    print(f"[lock] waiting for {LOCK}", file=sys.stderr, flush=True)
    fcntl.flock(fd, fcntl.LOCK_EX)
print(
    f"[lock] acquired pid={os.getpid()} waited={time.time()-t0:.1f}s",
    file=sys.stderr,
    flush=True,
)
try:
    rc = subprocess.call(["bash", "-c", sys.argv[1]])
finally:
    print("[lock] released", file=sys.stderr, flush=True)
sys.exit(rc)

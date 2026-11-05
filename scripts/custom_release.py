#!/usr/bin/env python3
"""Build this MakeCode extension and stage the hex in releases/.

    python3 scripts/custom_release.py [--name NAME] [--json] [--list]
    python3 scripts/custom_release.py all

Every run takes the machine-wide build lock, so an ESP-IDF build in another
repo cannot collide with it. `pxt build` compiles pxt.json `files` and
`testFiles` into one program; the artifact is `releases/<name>_v<version>.hex`.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK_PATH = os.environ.get("BUILD_LOCK_PATH", "/tmp/companionrobots-build.lock")


def pxt_json() -> dict:
    return json.loads((ROOT / "pxt.json").read_text(encoding="utf-8"))


def acquire_lock():
    if os.environ.get("BUILD_LOCK_HELD") == "1":
        return None
    fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o644)
    t0 = time.time()
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"[build-lock] waiting for {LOCK_PATH}", file=sys.stderr, flush=True)
        fcntl.flock(fd, fcntl.LOCK_EX)
    print(
        f"[build-lock] acquired pid={os.getpid()} waited={time.time() - t0:.1f}s",
        file=sys.stderr,
        flush=True,
    )
    return fd


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git(*args: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def ensure_pxt_ready() -> int:
    """A fresh clone has neither the local-target marker nor `pxt_modules/`.

    `npm ci` installs the target package but not `node_modules/pxtcli.json`, the
    file pxt reads to learn which target lives in `node_modules`; without it every
    pxt command fails with "Cannot find node_modules/pxtcli.json nor pxtarget.json".
    `pxt build` then also needs `pxt_modules/` (`pxt install` creates it). Both are
    gitignored state, so a laptop already has them and CI does not — doing it here
    keeps one entry point for both.
    """
    marker = ROOT / "node_modules" / "pxtcli.json"
    if (ROOT / "node_modules" / "pxt-microbit").is_dir() and not marker.exists():
        marker.write_text('{\n    "targetdir": "pxt-microbit"\n}\n', encoding="utf-8")
        print(f"wrote {marker.relative_to(ROOT)} (local target marker)", file=sys.stderr, flush=True)
    if not (ROOT / "pxt_modules").is_dir():
        print("pxt_modules/ missing — running `pxt install`", file=sys.stderr, flush=True)
        rc = subprocess.call(["pxt", "install"], cwd=ROOT)
        if rc != 0:
            print(f"pxt install failed (exit {rc})", file=sys.stderr)
            return rc
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "target",
        nargs="?",
        default="all",
        help="'all' (default); kept for CLI parity with the other repos",
    )
    ap.add_argument("--name", help="artifact base name (default: repo folder name)")
    ap.add_argument("--json", action="store_true", help="one-line JSON on stdout instead of the field list")
    ap.add_argument("--list", action="store_true", help="show the program files and exit")
    args = ap.parse_args()

    meta = pxt_json()
    version = meta.get("version", "0.0.0")
    name = args.name or ROOT.name

    if args.list:
        out = {
            "target": "microbit",
            "name": name,
            "version": version,
            "files": meta.get("files", []),
            "test_files": meta.get("testFiles", []),
        }
        print(json.dumps(out, indent=2) if not args.json else json.dumps(out))
        return 0

    if args.target != "all":
        print(f"note: this repo has one program; ignoring target '{args.target}'", file=sys.stderr)

    head, branch = git("rev-parse", "--short", "HEAD"), git("rev-parse", "--abbrev-ref", "HEAD")
    fd = acquire_lock()
    t0 = time.time()
    try:
        rc = ensure_pxt_ready()
        if rc == 0:
            rc = subprocess.call(["pxt", "build"], cwd=ROOT)
    finally:
        if fd is not None:
            print("[build-lock] released", file=sys.stderr, flush=True)
            os.close(fd)
    duration = time.time() - t0

    if rc != 0:
        print(f"pxt build failed (exit {rc})", file=sys.stderr)
        return rc

    src = ROOT / "built" / "binary.hex"
    if not src.exists():
        print("pxt build reported success but built/binary.hex is missing", file=sys.stderr)
        return 1

    out_dir = ROOT / "releases"
    out_dir.mkdir(exist_ok=True)
    dst = out_dir / f"{name}_v{version}.hex"
    shutil.copyfile(src, dst)

    result = {
        "target": "microbit",
        "name": name,
        "version": version,
        "head": head,
        "branch": branch,
        "artifact": str(dst),
        "size": dst.stat().st_size,
        "sha256": sha256(dst),
        "duration_s": round(duration, 2),
        "exit": 0,
    }
    if args.json:
        print(json.dumps(result))
    else:
        for key in (
            "target",
            "name",
            "version",
            "head",
            "branch",
            "artifact",
            "size",
            "sha256",
            "duration_s",
            "exit",
        ):
            print(f"{key}={result[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

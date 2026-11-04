#!/usr/bin/env python3
"""Check (and optionally rewrite) the doc tables that point at line numbers.

Enforced:

1. Every relative link and every `#anchor` resolves inside this repository.
2. Every `| L123 | [title](#anchor) |` table-of-contents row points at the line the
   anchor really is on. `--write` fixes the number; the default mode fails.

    python3 scripts/check_docs.py            # check
    python3 scripts/check_docs.py --write    # rewrite stale L numbers

Generated or vendored trees are skipped; see SKIP_DIRS.
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

SKIP_DIRS = {
    ".git", "node_modules", "build", "managed_components", "pxt_modules", "yotta_modules",
    "_site", "releases", "release", "built", "legacy", ".venv", "venv", "__pycache__",
}

TOC_ROW = re.compile(r"^\|\s*L(\d+)\s*\|\s*(·?\s*\[[^\]]+\]\(#[^)]+\)\s*)\|")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$")


def slug(text: str) -> str:
    """GitHub-style anchor: keep letters/digits, spaces to dashes, drop punctuation.

    CJK ideographs are letters (unicode category Lo) so they survive; em dashes,
    full-width brackets and other punctuation do not, which is what GitHub does.
    """
    out: list[str] = []
    for ch in text.strip().lower():
        if ch in " \t·":
            out.append("-")
        elif ch in "-_":
            out.append(ch)
        elif unicodedata.category(ch)[0] in ("L", "N"):
            out.append(ch)
    return "".join(out).strip("-")


def heading_map(lines: list[str]) -> dict[str, int]:
    """anchor -> first line number, matching GitHub's duplicate suffixing."""
    seen: dict[str, int] = {}
    out: dict[str, int] = {}
    for i, line in enumerate(lines, start=1):
        m = HEADING.match(line)
        if not m:
            continue
        base = slug(m.group(2).replace("`", ""))
        if base in seen:
            seen[base] += 1
            key = f"{base}-{seen[base]}"
        else:
            seen[base] = 0
            key = base
        out.setdefault(key, i)
    return out


def md_files(root: Path) -> list[Path]:
    files = []
    for p in root.rglob("*.md"):
        if any(part in SKIP_DIRS for part in p.relative_to(root).parts[:-1]):
            continue
        if p.name.startswith("."):
            continue
        files.append(p)
    return sorted(files)


def is_external(target: str) -> bool:
    return target.startswith(("http://", "https://", "mailto:", "tel:", "file:"))


def check_file(path: Path, root: Path, write: bool) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    own = heading_map(lines)
    errors: list[str] = []
    changed = False

    for i, line in enumerate(lines, start=1):
        inline = re.findall(r"`[^`]*`", line)
        for target in LINK.findall(line):
            if is_external(target) or any(target in code for code in inline):
                continue
            if target.startswith("#"):
                anchor = target[1:]
                if re.fullmatch(r"L\d+", anchor):
                    continue          # GitHub source-line anchors, not headings
                if anchor and anchor not in own:
                    errors.append(f"{path.relative_to(root)}:{i}: missing anchor #{anchor}")
                continue
            rel, _, frag = target.partition("#")
            dest = (path.parent / rel).resolve()
            if not dest.exists():
                errors.append(f"{path.relative_to(root)}:{i}: missing file {rel}")
                continue
            if frag and dest.suffix == ".md":
                other = heading_map(dest.read_text(encoding="utf-8").splitlines())
                if frag not in other:
                    errors.append(f"{path.relative_to(root)}:{i}: missing anchor {rel}#{frag}")

        m = TOC_ROW.match(line)
        if not m:
            continue
        current = int(m.group(1))
        anchor = re.search(r"\(#([^)]+)\)", m.group(2)).group(1)
        real = own.get(anchor)
        if real is None:
            # Hand-written TOCs often abbreviate the heading. Accept a unique prefix and,
            # in --write mode, replace the abbreviation with the real anchor.
            candidates = [k for k in own if k.startswith(anchor)]
            if len(candidates) == 1:
                full = candidates[0]
                real = own[full]
                if write:
                    lines[i - 1] = lines[i - 1].replace(f"(#{anchor})", f"(#{full})").replace(
                        f"| L{current} |", f"| L{real} |", 1
                    )
                    changed = True
                else:
                    errors.append(
                        f"{path.relative_to(root)}:{i}: TOC anchor #{anchor} should be #{full}"
                    )
                continue
            errors.append(f"{path.relative_to(root)}:{i}: TOC anchor #{anchor} not found")
        elif real != current:
            if write:
                lines[i - 1] = line.replace(f"| L{current} |", f"| L{real} |", 1)
                changed = True
            else:
                errors.append(
                    f"{path.relative_to(root)}:{i}: TOC says L{current}, #{anchor} is L{real}"
                )

    if write and changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"updated {path.relative_to(root)}")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", nargs="?", default=".", help="repository root (default: cwd)")
    ap.add_argument("--write", action="store_true", help="rewrite stale L numbers instead of failing")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    files = md_files(root)
    errors: list[str] = []
    for f in files:
        errors.extend(check_file(f, root, args.write))

    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        print(f"\n{len(errors)} problem(s) in {len(files)} file(s)", file=sys.stderr)
        return 1
    if not args.quiet:
        print(f"ok: {len(files)} markdown file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

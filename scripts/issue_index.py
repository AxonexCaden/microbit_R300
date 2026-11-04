#!/usr/bin/env python3
"""Regenerate the issue and phase index blocks from GitHub.

The markdown file holds the human-written prose; the tables are derived. Everything
between the markers is rewritten, so never edit inside them by hand:

    <!-- PHASE-INDEX:BEGIN -->  ... <!-- PHASE-INDEX:END -->
    <!-- ISSUE-INDEX:BEGIN -->  ... <!-- ISSUE-INDEX:END -->

    python3 scripts/issue_index.py            # check (exit 1 if stale)
    python3 scripts/issue_index.py --write    # rewrite the blocks
    python3 scripts/issue_index.py --repo owner/name

GitHub is canonical: this tool only reads. It never creates or edits issues.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FILE = ROOT / "ISSUES_AND_PROGRESS.md"

LIGHT_ORDER = ["light/red", "light/yellow", "light/green", "light/white", "light/done"]


def gh_json(*args: str) -> list[dict]:
    out = subprocess.check_output(["gh", *args], text=True)
    return json.loads(out or "[]")


def detect_repo() -> str:
    try:
        return subprocess.check_output(
            ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
            cwd=ROOT, text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def labels_of(issue: dict) -> list[str]:
    return [lbl.get("name", "") for lbl in issue.get("labels", []) or []]


def light(labels: list[str]) -> str:
    for name in LIGHT_ORDER:
        if name in labels:
            return name.split("/", 1)[1]
    return ""


def area(labels: list[str]) -> str:
    areas = [x.split("/", 1)[1] for x in labels if x.startswith("area/")]
    return ", ".join(areas)


def cell(text: str) -> str:
    return str(text).replace("|", "\\|").strip()


def render(issues: list[dict]) -> tuple[str, str]:
    phase_rows = ["| # | Phase | Labels | Status | Date |", "|---|---|---|---|---|"]
    issue_rows = ["| # | Title | light | area | State | Updated |", "|---|---|---|---|---|---|"]

    for issue in sorted(issues, key=lambda i: i["number"], reverse=True):
        labels = labels_of(issue)
        date = (issue.get("updatedAt") or "")[:10]
        state = issue.get("state", "").lower()
        if "phase" in labels:
            extra = ", ".join(sorted(x for x in labels if x != "phase")) or "—"
            phase_rows.append(
                f"| #{issue['number']} | {cell(issue['title'])} | {cell(extra)} | {state} | {date} |"
            )
        else:
            issue_rows.append(
                f"| #{issue['number']} | {cell(issue['title'])} | {cell(light(labels)) or '—'} "
                f"| {cell(area(labels)) or '—'} | {state} | {date} |"
            )
    return "\n".join(phase_rows), "\n".join(issue_rows)


def replace_block(text: str, name: str, body: str) -> tuple[str, bool]:
    begin, end = f"<!-- {name}:BEGIN -->", f"<!-- {name}:END -->"
    pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        return text, False
    new = f"{begin}\n{body}\n{end}"
    return pattern.sub(lambda _: new, text, count=1), True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", default=str(DEFAULT_FILE), help=f"markdown file (default: {DEFAULT_FILE.name})")
    ap.add_argument("--repo", default="", help="owner/name (default: current git remote)")
    ap.add_argument("--write", action="store_true", help="rewrite the blocks instead of checking")
    ap.add_argument("--limit", type=int, default=500)
    args = ap.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"missing {path}", file=sys.stderr)
        return 2
    text = path.read_text(encoding="utf-8")
    if "<!-- ISSUE-INDEX:BEGIN -->" not in text and "<!-- PHASE-INDEX:BEGIN -->" not in text:
        print(f"{path.name}: no index markers, nothing to do")
        return 0

    repo = args.repo or detect_repo()
    if not repo:
        print("cannot determine repo; pass --repo owner/name", file=sys.stderr)
        return 2
    try:
        issues = gh_json(
            "issue", "list", "-R", repo, "--state", "all", "--limit", str(args.limit),
            "--json", "number,title,labels,state,updatedAt",
        )
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"gh failed for {repo}: {exc}", file=sys.stderr)
        return 2

    phase_body, issue_body = render(issues)
    updated, found_phase = replace_block(text, "PHASE-INDEX", phase_body)
    updated, found_issue = replace_block(updated, "ISSUE-INDEX", issue_body)
    if not (found_phase or found_issue):
        print(f"{path.name}: no index markers, nothing to do")
        return 0

    if updated == text:
        print(f"ok: {path.name} up to date ({len(issues)} issue(s) from {repo})")
        return 0

    if args.write:
        path.write_text(updated, encoding="utf-8")
        print(f"updated {path.name} ({len(issues)} issue(s) from {repo})")
        return 0

    print(f"{path.name} is stale — run with --write", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

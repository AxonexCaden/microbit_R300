---
name: ship-docs
description: "Use when: the user says ship docs, sync docs, 出 doc, 收尾, 更新文件, write up what changed, or asks to bring the documentation in line with the code and commit. Syncs the doc set for CompanionRobots, MicroBit and EmotionDisplay, regenerates TOC line numbers and the GitHub issue index, verifies every link, then makes one commit on the current branch."
argument-hint: "Optional: which repo, or 'docs only' to skip the build gate"
---

# ship-docs

Bring the repository documentation in line with the code that was just changed, then
make **one** commit on the current branch.

**This skill is a team standard, which is why it is committed.** Everyone working in these
repos should follow the same routing, row shape, commit-message convention and build gate —
if you skip a step, the docs stop agreeing with each other. Personal shortcuts do not belong
here; they live in `~/.copilot/skills/` instead.

Works in: `CompanionRobots`, `MicroBit`, `EmotionDisplay`.
Not yet migrated: `r300-motor-code` (separate owner; do not apply this skill there).

If there are no uncommitted changes at all, say so and stop.

## Doc set per repo

| Repo | Root docs | Component docs | Issue index | Build entry |
|---|---|---|---|---|
| **CompanionRobots** | `ARCHITECTURE.md` (structure), `ISSUES_AND_PROGRESS.md` (work log + indices), `CLAUDE.md` (gitignored rules) | `main/boards/R300/` `R300_README.md` + `R300_PROGRESS.md`; `main/boards/R100v3/` likewise; `main/characters/characters_README.md` + `_PROGRESS.md` | hand-indexed §2/§3 of `ISSUES_AND_PROGRESS.md` (no markers yet) | `python3 scripts/custom_release.py <board> --name …` |
| **MicroBit** | `README.md` (product + quick start), `ARCHITECTURE.md` (protocol), `ISSUES_AND_PROGRESS.md` (indices) | `PROTOCOL_PROGRESS.md` (build/link gotchas) | marker blocks in `ISSUES_AND_PROGRESS.md` | `python3 scripts/custom_release.py` |
| **EmotionDisplay** | `README.md`, `ARCHITECTURE.md`, `ISSUES_AND_PROGRESS.md` | `main/FIRMWARE_README.md` + `main/FIRMWARE_PROGRESS.md`; `tools/GIF_README.md`; `tools/electron/ELECTRON_README.md` | marker blocks in `ISSUES_AND_PROGRESS.md` | `python3 scripts/custom_release.py --build <pengu\|floki\|bduck>` |

All three repos use the same names. Never introduce an alias or a second copy of a document:
one document, one path.

## Where each kind of knowledge goes

| The change is… | Goes to |
|---|---|
| a stable fact, pin, key, option, procedure | the component `<X>_README.md` (or `ARCHITECTURE.md` if it spans components) |
| a rule learned from a failure | the component `<X>_PROGRESS.md`: **rule first, then evidence** |
| a rule that holds across boards/components | `ISSUES_AND_PROGRESS.md` §5 (CR) / `ISSUES_AND_PROGRESS.md` §5 (MB, ED) |
| structure: layers, protocol shape, build flow, folder layout | `ARCHITECTURE.md` (CR: `ARCHITECTURE.md`) — only when structure actually changed |
| a phase of work | a GitHub issue `[Phase N]` + one row in the phase index |
| a new problem or decision | a GitHub issue (`light/*` + `area/*`, `decision` where relevant) + one row in the issue index |

Never put a board- or component-specific detail in the root docs. Never write a pointer where
an explanation is expected: "see Phase 277" alone teaches the reader nothing.

## Locks: four exclusive lanes

Some operations must never run twice at once on this machine. Take the matching lock with
`scripts/lock.py`; it blocks until the lock is free and passes the wrapped command's exit code.

| Lane | `BUILD_LOCK_PATH` | Scope | Why |
|---|---|---|---|
| build | `/tmp/companionrobots-build.lock` (default) | global | all repos share one IDF tree, venv, component cache and ccache |
| git | `/tmp/git-<repo>.lock` | per repo | `.git/index.lock` and non-fast-forward: two pushes to one repo always fight |
| gh | `/tmp/gh-<repo>.lock` | per repo | Actions `concurrency` cancels in-progress runs; the issue index is one table |
| flash | `/tmp/flash.lock` | global | one serial port |

```bash
# build lane (custom_release.py already takes it, so you normally do not)
python3 scripts/lock.py 'python3 scripts/custom_release.py --build pengu'

# git lane — commit and push under one lock, so a second agent queues instead of racing
BUILD_LOCK_PATH=/tmp/git-CompanionRobots.lock \
  python3 scripts/lock.py 'git add -A && git commit -F /tmp/msg && git push origin HEAD'

# gh lane — never dispatch the same workflow + ref twice
BUILD_LOCK_PATH=/tmp/gh-CompanionRobots.lock \
  python3 scripts/lock.py 'gh workflow run build-companion.yml --ref <branch>'
```

The lock is advisory and only protects what runs inside it. It does **not** resolve conflicts:
if `git push` is rejected, `git pull --rebase` and push again — never `--force`.

### Order is not optional

```
docs written → commit → push → CI dispatch → watch → issue index → verify
```

Never open a PR before the push lands, never close an issue before CI is green, and never let
two agents edit the issue index.

## Procedure

1. **See what changed.** `git status --porcelain=v1 -b` and `git diff` (plus `git diff --stat`
   for untracked files you added). Decide per file: code, doc, or generated (skip generated).

2. **Read the maintenance rules of every file you are about to edit.** Each root and component
   doc has a `Doc maintenance requirements` section near the top. Follow it; it overrides this
   skill where they disagree.

3. **Route the change** using the table above. One rule = one place. If you catch yourself
   writing the same sentence in two files, one of them is wrong — keep the detail next to the
   code and put a one-line rule plus a link in the summary doc.

4. **Record the work** (only if the session produced a phase, an issue, or a decision):
   - CR: `gh issue create -R AxonexCaden/CompanionRobots` — title `[Phase N] <topic>`, labels
     `phase` (or `light/*` + `area/*` for a problem, plus `decision` for a design decision).
     Then add one row to §2 (phase) or §3 (issue) of `ISSUES_AND_PROGRESS.md` under the matching
     bucket. Rows are append-only: never move a row between buckets, never chase its status.
   - MB / ED: same `gh issue create -R <repo>`, then run
     `python3 scripts/issue_index.py --write`. Never hand-edit the marker block.
   - Phase numbers: `gh issue list --label phase` gives the highest in use. On a feature branch
     prefer `TBD` and number it at ship time.

5. **Regenerate every derived number.** Never hand-count.
   - All three repos: `python3 scripts/check_docs.py --write` — rewrites every `| L… |` TOC row
     to the real line of its anchor, and repairs abbreviated anchors when the match is unique.
   - CR only, additionally: recount the `· N 條` suffix on bucket headings (see the snippet at
     the end of this file). `check_docs.py` does not do that.
   - MB / ED: `python3 scripts/issue_index.py --write`.

6. **Verify.**
   - `python3 scripts/check_docs.py` — links, anchors, TOC numbers. MB and ED must report
     `ok: N markdown file(s)`.
   - **CompanionRobots has a known baseline of findings** (hand-abbreviated TOC anchors, links to
     folders deleted in 2026-10). It was 39 on 2026-11-04 and the number moves as docs are edited.
     Do not fix them here. Gate on "the count did not go up": capture the number before step 5 and
     compare after.
   - `grep -rn "<old path or old heading>"` for anything you moved or renamed.
   - No conflict markers: `grep -rn '^<<<<<<<\|^>>>>>>>' --include='*.md' .`.

7. **Build only if code changed.** Docs alone never need a build.
   - If the change touched `sdkconfig.defaults*`, `CMakeLists.txt`, `Kconfig.projbuild`,
     `partitions.csv`, `ci/products.json` or a `character.json`, an incremental build is **not**
     enough: delete exactly one variant build dir (`build/<variant>/`, derived by
     `variant_dir_name()` in `scripts/custom_release.py`) and rebuild. Never `rm -rf build/`,
     never `idf.py fullclean` — the variant dir owns its own `sdkconfig`, so deleting it is the
     whole reset. (A local-only `clean-release` skill walks through this; it is not in the repo.)
   - CR: `python3 scripts/custom_release.py <board> --name <name>` (18 s incremental; never bare
     `idf.py build`, never `rm -rf build/`).
   - MB: `python3 scripts/custom_release.py --name <name>` — an EXIT 0 is the only proof the
     program still fits; `README.md` is compiled into the hex, so a doc edit can change its size.
   - ED: `python3 scripts/custom_release.py --build <character>`.
   - All builds take `/tmp/companionrobots-build.lock` automatically. Never start a second one.
   - If a build fails, fix the cause or stop and report it. Do not retry blindly, and do not
     commit a failed build.

8. **Commit once**, all changed files, on the current branch, under the git lock (see [Locks](#locks-four-exclusive-lanes)):

   Header — `[<scope>] <type>(<layer>): <Summary>`
   - `scope`: CR → board-profile (`R300-edu-microbit-pengu`, `R100v3-head`, `R100v3-body`), or
     `repo` for cross-cutting work; MB → `microbit`; ED → `emotion-display`.
   - `type`: `feat` / `fix` / `docs` / `refactor` / `chore` / `perf` / `build`.
   - `layer` (CR only, optional): `engine` / `gameplay` / `character` / `driver` / `docs` /
     `build`, joined by `/` when a commit genuinely spans layers.
   - Summary: imperative, capitalized, no trailing period. Do not append "update docs" — this
     workflow implies it.
   - Body only when 2+ distinct points: `-` for independent points, `1.` for an ordered
     sequence, `1-1.` for detail under a point. Explain intent, not "changed file X".
   - No `Co-Authored-By` trailer in these repos.

9. **Push** to the current branch when the user asked to ship (this skill is usually invoked as
   "ship it"), in the same git-lock command. If the push is rejected, `git pull --rebase`
   and push again. Never `--force`, never rebase a shared branch, never push to `upstream`.

   ⚠️ **If a branch name also exists as a directory, the bare name is ambiguous.** CompanionRobots
   and EmotionDisplay both have a `main/` folder, so `git log main`, `git diff … main` and
   `git rev-list --count main` die with `fatal: ambiguous argument 'main': both revision and
   filename`. `git merge-base main HEAD`, `git switch main`, `git merge main`, `git push` and range
   forms like `main..dev` are fine. Never `git branch -f main …` — in EmotionDisplay that created a
   real branch named `refs/heads/main`. Use `git update-ref refs/heads/main <sha>` and
   `git push origin HEAD:refs/heads/main`. MicroBit has no `main/` folder today, so the rule does not
   bite there — but it stays identical in all three copies.

## Merge conflicts

Everyone runs ship-docs on their own branch, so the index files conflict on most merges.
**Resolve it yourself; do not hand it back to the user.** Most of it is two people appending —
keep both sides.

Two things are derived, not content:

- **TOC line numbers** — both sides are wrong after a merge. Clear the conflict by taking either
  side, then run `check_docs.py --write` (plus the CR bucket recount).
- **Phase numbers (CR only)** — check `git log --all --grep=<id>` on both sides first: a commit
  message that already cites the number cannot be edited, so that side keeps it. Otherwise the
  earlier-dated row keeps it; same date, the side already merged into the integration branch
  keeps it. Then `grep -rn` the old number across docs **and** code and update every hit.

One issue must never end up with two rows: if both sides added a row for the same issue, merge
them into one.

Merge direction: pull the integration branch **into** the feature branch, resolve there, then
fast-forward the integration branch.

## Important

Finish the job without handing decisions back — stale line numbers, a taken phase number, a
conflict: decide from the code and the history, then report what you did. Stop only for something
a reader genuinely cannot decide (for example, two contradictory on-device results).

Keep the doc update proportional to the change. If the docs are already accurate, skip the edits
and just commit.

A code change can invalidate a paragraph written minutes earlier. After a rework, re-read what you
wrote for the previous version: a phase row is history and stays, but `ARCHITECTURE.md` and
`CLAUDE.md` describe the present and become active misdirection.

`CLAUDE.md` is gitignored (CR). Anything a teammate needs must also land in a tracked file.

## CR bucket-count snippet

`check_docs.py` fixes TOC line numbers and anchors but not the `· N 條` counts on bucket
headings. Run this from the CompanionRobots root after the TOC pass:

```bash
python3 - <<'PY'
import re
from pathlib import Path
p = Path("ISSUES_AND_PROGRESS.md")
lines = p.read_text(encoding="utf-8").split("\n")
changed = 0
rows = 0
for i in range(len(lines) - 1, -1, -1):
    line = lines[i]
    m = re.match(r"^#{3} (.+?) · (\d+) 條$", line)
    if m:
        if rows != int(m.group(2)):
            lines[i] = f"### {m.group(1)} · {rows} 條"
            changed += 1
        rows = 0
        continue
    if line.startswith("### ") or line.startswith("## "):
        rows = 0
        continue
    if line.startswith("| ") and not line.startswith(("| 時間", "|---")):
        rows += 1
p.write_text("\n".join(lines), encoding="utf-8")
print(f"ISSUES_AND_PROGRESS.md: fixed {changed} bucket count(s)")
PY
```

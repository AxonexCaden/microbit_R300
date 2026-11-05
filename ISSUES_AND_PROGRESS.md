# MicroBit — Issues & Progress

> **This file:** the repo-side index of phases and issues. The issue text itself lives on GitHub
> (`gh issue list -R AxonexCaden/microbit_R300`), which is canonical.
> **Not here:** product facts → [README.md](README.md); protocol → [ARCHITECTURE.md](ARCHITECTURE.md);
> gotchas → [PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md).

## Table of contents

| Section |
|---|
| [1. Doc maintenance requirements](#1-doc-maintenance-requirements) |
| [2. Phase index](#2-phase-index) |
| [3. Issue index](#3-issue-index) |
| [4. Cross-repo lessons](#4-cross-repo-lessons) |
| [5. Generic gotchas](#5-generic-gotchas) |

## 1. Doc maintenance requirements

1. Open the issue on GitHub first, then regenerate the index — never hand-edit the marker block.
   `python3 scripts/issue_index.py --write` rewrites everything between the markers.
2. Labels follow the CompanionRobots scheme: `light/{red,yellow,green,white,done}`, `area/*`,
   plus `phase` and `decision`.
3. Do not mirror issue state here; GitHub is the single source of truth.

## 2. Phase index

<!-- PHASE-INDEX:BEGIN -->
| # | Phase | Labels | Status | Date |
|---|---|---|---|---|
<!-- PHASE-INDEX:END -->

## 3. Issue index

<!-- ISSUE-INDEX:BEGIN -->
| # | Title | light | area | State | Updated |
|---|---|---|---|---|---|
| #6 | [task] CI 閘：build-microbit.yml 加 check_docs.py gate | — | — | open | 2026-11-05 |
| #5 | [task] Feishu 測試線：補 upload_to_feishu 單元測試 | — | — | closed | 2026-11-05 |
| #4 | [task] 文件／索引線：ARCHITECTURE §3 重複句、repo layout 校正、issue index 重生 | — | — | closed | 2026-11-05 |
| #3 | [order] onboard-3：mention 喺 body | — | — | open | 2026-11-05 |
| #2 | [onboard-2] 讀文件＋計劃 §27/§28.2，拆多條工作線 | — | — | open | 2026-11-05 |
| #1 | [onboard] 讀文件 + git 歷史，交 12 行摘要 | — | — | open | 2026-11-05 |
<!-- ISSUE-INDEX:END -->

## 4. Cross-repo lessons

| Lesson | Where it came from |
|---|---|
| A payload that exceeds the receiver's line buffer is dropped **silently** — no log, no ack. Size every new field against the receiver buffer before shipping it. | R300 `MicrobitLink` (host) + this repo's `setRxBufferSize` |

## 5. Generic gotchas

- See [PROTOCOL_PROGRESS.md](PROTOCOL_PROGRESS.md) for everything specific to this repo.
- **A build that succeeds does not prove the hex on the board is the new one.** Compare
  `built/binary.hex` mtime against the last source edit, and re-flash.

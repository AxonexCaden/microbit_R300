# Feishu 子資料夾 — microbit R300 執行計劃

> **範圍：只做 microbit_R300。** CompanionRobots 另開；EmotionDisplay 已完成（見該 repo 同名檔）。
>
> **流程**：每個 task 由 superagent 完成 → 喺 issue 貼 `done task=<ID> branch=<branch> sha=<sha7> pr=#<n>` →
> reviewer（Caden 嘅 agent）驗證 + feedback → **通過之後才有下一個 task 嘅 issue**。
> 唔准自己開始下一個 task。

## 背景（事實）

- Feishu root folder（`TI7mfL6sLlyDaHdCZMacYxBjnig`）平鋪四個 repo 嘅產物，靠檔名 prefix
  （`CR_`／`ED_`／`MB_`／`MOTOR_`）分 repo。目標：每個 repo 一個子資料夾。
- Feishu app **只有 `drive:file:upload`**；`drive:drive:readonly` 同 `drive:drive` 都冇
  （證據：CompanionRobots `verify-feishu.yml` run `42943601783` → `99991672`）
  ⇒ **用 API 開／列子資料夾做唔到**。
- 子資料夾已由人手喺 Feishu UI 開好：`CompanionRobots/microbit R300`，其 token 已設成 repo secret
  `FEISHU_FOLDER_MB`。**secret 值唔准寫入任何檔案、唔准貼出。**

## 不變式

1. **Layout 問題 ≠ 出貨事故**：子資料夾用唔到（冇設／`1061043` app 唔係協作者）就 fallback root，
   上載照樣要成功，只印 `[warn]`。
2. 冇 secret 時 CI 行為要同今日**完全一樣**（`--strict` 語意不變）。
3. `python3 -m unittest discover -s scripts/tests -q` 一定要過（`scripts/tests/test_upload_to_feishu.py`
   有 `_ISOLATED_ENV` 清單，新增環境變數要一齊加落去，否則測試會讀到開發者真 config）。
4. **唔准 push `main`**；每個 task 一條 branch `agent/feishu-<task>`，PR base `main`。
5. 每個 task **只准改自己列出嘅檔案**；改其他檔案即當失敗。
6. 呢個 repo 係 **public**：唔准喺任何檔案／issue 寫 secret 值或者 folder token。

## Task 表

| ID | 內容 | 驗收（reviewer 照呢個驗） | Status | Evidence |
|---|---|---|---|---|
| T1 | 建立本檔 `docs/feishu-subfolder-plan.md`，內容照 T1 issue 原文 | 檔案存在、5 個 task 齊、狀態全部 `todo` | todo | — |
| T2 | `scripts/upload_to_feishu.py`：讀 `FEISHU_FOLDER_MB`（bare token 或 `…/drive/folder/<token>?…` URL）、冇設就 fallback root 印一句 `[warn]`、`1061043` 都 fallback root、`doctor` 印「上載目標」；`scripts/tests/test_upload_to_feishu.py` 嘅 `_ISOLATED_ENV` 加 `FEISHU_FOLDER_MB` | `py_compile` exit 0；未設／已設／URL 形式三個 `--dry-run` 目標正確；stub `1061043` → fallback root 且 `cmd_upload` 回 0；`python3 -m unittest discover -s scripts/tests -q` 全過 | todo | — |
| T3 | `.github/workflows/build-microbit.yml` 嘅 Upload step `env:` 加一行 `FEISHU_FOLDER_MB: ${{ secrets.FEISHU_FOLDER_MB }}` | `grep -c FEISHU_FOLDER_MB .github/workflows/build-microbit.yml` = 1；workflow YAML 可 parse；除呢一行外冇改動 | todo | — |
| T4 | `README.md` 第 124 行附近（「…to the shared Feishu Drive folder…」）加子資料夾、fallback、同 `drive:file:upload` 限制嘅說明 | `grep -c 'FEISHU_FOLDER_MB' README.md` ≥ 1；`grep -c '1061043' README.md` ≥ 1；`python3 scripts/check_docs.py` 過 | todo | — |
| T5 | 真 upload：`gh workflow run build-microbit.yml`，等 run 完，貼 log | run 綠；log 有 `[feishu] microbit R300/<stamp>_MB_r300_v<version>.hex`；**冇** `[warn]` | todo | — |

## 狀態圖例

`todo` 未開工｜`doing` 已派工未交｜`review` 已交等 reviewer｜`done` reviewer 驗證通過｜`blocked` 卡住（要寫原因）

## 每次交貨要寫落 issue 嘅格式

```
done task=<ID> branch=<branch> sha=<sha7> pr=#<n>
```

加 3 樣：**改咗邊幾個檔**、**逐條驗收命令 + 真實輸出**、**冇做／做唔到嘅嘢**。

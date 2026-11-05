#!/usr/bin/env python3
"""Publish firmware artifacts to Feishu (Lark): one Drive folder + one chat card.

Why a folder and not just a message: a chat scrolls away, a Drive folder is the
place a non-developer can be told "去呢個資料夾攞最新 firmware" and keep coming back
to. The card exists only to tell people that the folder changed.

Two subcommands, because the two halves run in different CI jobs (the upload is
per-board, the card is one message for the whole run):

    upload FILE...                 → Drive folder (FEISHU_FOLDER_TOKEN)
    notify [--title T] [--body B]  → group chat   (FEISHU_CHAT_ID)
    doctor                         → check the 4 env vars, the token, the folder, the groups

File names are stamped in front: `2026-10-26_1430_R300-edu-microbit-floki_full.bin`.
Date first so the folder sorts chronologically, time in UTC+8 because CI runs in UTC
and the readers do not. A repo tag follows the stamp
(`2026-11-05_1430_ED_pengu_emotion_display.bin`): more than one repo uploads here, and
`r300.hex` (micro:bit) vs `R300-edu-microbit-pengu_full.bin` (the ESP32 robot) is not a
distinction a reader can make from the name alone. The tag comes from `--repo-tag`, or
from `GITHUB_REPOSITORY` when that is set.

One-time Feishu setup (無 code 可以做，見 scripts/scripts_README.md 4):

  1. 自建應用 → 只加 `drive:file:upload`（Approval required = No，加完即刻生效；
     `drive:drive` 係 Yes＝要管理員批，上載唔需要佢）
  2. Drive 開個資料夾 → 添加協作者 → 揀你個應用 → 可編輯 → 抄 URL 尾段
     （`https://xxx.feishu.cn/drive/folder/<token>`）；漏咗呢步會回 1061043
  3. 卡片（可選）：`im:message:send_as_bot` → 群機械人加應用；chat_id 係 `oc_…`

Environment (never hardcode): FEISHU_APP_ID, FEISHU_APP_SECRET, plus
FEISHU_FOLDER_TOKEN (upload) / FEISHU_CHAT_ID (notify). Optional FEISHU_BASE for
Lark international (`https://open.larksuite.com`; default is open.feishu.cn).

Missing config prints `[SKIP]` and exits 0, so CI stays green before the secrets
exist; pass `--strict` to turn that into a failure instead.

Feishu's `upload_all` caps a single file at 20 MB. Bigger needs a chunked
upload_prepare/upload_part dance, which this script does not do — it fails loudly.

Same filename uploaded twice becomes two files (Drive never overwrites), so
`--stamp` prefixes `2026-10-26_1430_`. Both halves of a release land in the folder
under the same stamp, so a reader sees a pair.
"""

import argparse
import datetime as _dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

# 20 MB per upload_all call (Feishu hard limit for the simple upload path).
_MAX_UPLOAD = 20 * 1024 * 1024

# Hong Kong standard time: CI runners are UTC, the people reading the folder are not.
# A fixed +8 offset, not ZoneInfo — no tzdata in every container, and HK has no DST.
_TZ = _dt.timezone(_dt.timedelta(hours=8))

# `R300-edu-microbit-pengu_full.bin` → stamp goes before _full/_ota so the kind stays last.
_NAME_RE = re.compile(r"^(?P<base>.+)_(?P<kind>full|ota|app)\.bin$")

# People paste the whole folder URL, tracking query included. Take the token out of it.
_FOLDER_URL_RE = re.compile(r"/drive/folder/(?P<token>[^/?#]+)")

# Short, stable tag per producing repo. Keep it 2-4 characters so it reads as a prefix,
# not as part of the product id.
_REPO_TAGS = {
    "CompanionRobots": "CR",
    "EmotionDisplay": "ED",
    "microbit_R300": "MB",
    "r300-motor-code": "MOTOR",
}

_SESSION = None
_TOKEN: Optional[str] = None


def _http():
    """Lazily import requests — a runner without it must still reach the [SKIP] path.

    `requests.RequestException` subclasses `IOError`, so `_api()` catches `OSError`
    and still surfaces network failures without needing the module at import time.
    """
    global _SESSION
    if _SESSION is None:
        try:
            import requests  # noqa: PLC0415 - deliberately deferred
        except ImportError:
            raise RuntimeError(
                "requests is missing — 用 IDF 嘅 python 跑"
                "（$IDF_PYTHON_ENV_PATH/bin/python），或者 pip install requests"
            )
        _SESSION = requests.Session()
    return _SESSION


def base_url() -> str:
    return os.environ.get("FEISHU_BASE", "https://open.feishu.cn").rstrip("/")


def _cfg(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def folder_token() -> str:
    """`FEISHU_FOLDER_TOKEN` may be a bare token or a whole `…/drive/folder/<token>?…` URL."""
    raw = _cfg("FEISHU_FOLDER_TOKEN")
    if not raw:
        return ""
    match = _FOLDER_URL_RE.search(raw)
    return match["token"] if match else raw.split("?")[0].strip()


def _skip(message: str, strict: bool) -> int:
    """Missing configuration is not an error until someone asks for strict mode."""
    print(f"[SKIP] {message}")
    return 1 if strict else 0


def _api(method: str, path: str, *, token: Optional[str] = None, **kwargs):
    """Call the open API and return `data`, raising on a non-zero `code`.

    Feishu signals failure two ways (HTTP 4xx/5xx *and* `{"code": 0}` in a 200
    body), and the `msg` is usually the only thing that names the real cause —
    e.g. 1061043 = 應用唔係資料夾協作者. Print both verbatim.
    """
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{base_url()}{path}"
    try:
        response = _http().request(method, url, headers=headers, timeout=60, **kwargs)
    except OSError as error:
        raise RuntimeError(f"{method} {path} failed: {error}") from error

    try:
        payload = response.json()
    except ValueError:
        raise RuntimeError(f"{method} {path} returned HTTP {response.status_code}: {response.text[:200]}")

    code = payload.get("code", 0)
    if response.status_code >= 400 or code != 0:
        raise RuntimeError(
            f"{method} {path} → HTTP {response.status_code} code={code} msg={payload.get('msg')!r}"
        )
    return payload.get("data", payload)


def tenant_token() -> str:
    """Cache the tenant_access_token for this process (it lives 2 hours)."""
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    app_id, app_secret = _cfg("FEISHU_APP_ID"), _cfg("FEISHU_APP_SECRET")
    if not app_id or not app_secret:
        raise RuntimeError("FEISHU_APP_ID / FEISHU_APP_SECRET 未設")
    data = _api(
        "POST",
        "/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
    )
    _TOKEN = data["tenant_access_token"]
    return _TOKEN


def _stamp() -> str:
    """`2026-10-26_1430` in UTC+8 — the time a reader in HK recognises."""
    return _dt.datetime.now(_TZ).strftime("%Y-%m-%d_%H%M")


def stamped_name(path: Path, stamp: str, tag: str = "") -> str:
    """`X_full.bin` → `<stamp>_<TAG>_X_full.bin`; unknown shapes get both in front."""
    prefix = f"{stamp}_" if stamp else ""
    if tag:
        prefix += f"{tag}_"
    match = _NAME_RE.match(path.name)
    if not match:
        return f"{prefix}{path.name}"
    return f"{prefix}{match['base']}_{match['kind']}.bin"


def repo_tag(explicit: str = "") -> str:
    """`--repo-tag` wins; otherwise derive it from `GITHUB_REPOSITORY` (empty off CI)."""
    if explicit.strip():
        return explicit.strip()
    slug = (os.environ.get("GITHUB_REPOSITORY") or "").rsplit("/", 1)[-1].strip()
    if not slug:
        return ""
    return _REPO_TAGS.get(slug, slug)


def upload_file(path: Path, name: str, folder_token: str) -> str:
    """upload_all → file_token. Raises on the 20 MB limit instead of truncating."""
    size = path.stat().st_size
    if size > _MAX_UPLOAD:
        raise RuntimeError(
            f"{path.name} is {size} bytes — over Feishu's {_MAX_UPLOAD} byte upload_all "
            "limit; needs the chunked upload_prepare/upload_part path"
        )
    with path.open("rb") as handle:
        data = _api(
            "POST",
            "/open-apis/drive/v1/files/upload_all",
            token=tenant_token(),
            data={
                "file_name": name,
                "parent_type": "explorer",
                "parent_node": folder_token,
                "size": str(size),
            },
            files={"file": (name, handle, "application/octet-stream")},
        )
    return data["file_token"]


def cmd_upload(args: argparse.Namespace) -> int:
    files = [Path(p) for p in args.files]
    missing_files = [str(p) for p in files if not p.is_file()]
    if missing_files:
        print(f"[ERROR] not found: {', '.join(missing_files)}", file=sys.stderr)
        return 1

    stamp = _stamp() if args.stamp else ""
    tag = repo_tag(args.repo_tag)
    folder = folder_token()
    if not folder:
        return _skip("FEISHU_FOLDER_TOKEN 未設 —— 未上載", args.strict)

    for path in files:
        name = stamped_name(path, stamp, tag) if (stamp or tag) else path.name
        if args.dry_run:
            print(f"[DRY] upload {path} as {name} ({path.stat().st_size} B) → folder {folder}")
            continue
        token = upload_file(path, name, folder)
        print(f"[feishu] {name} → file_token={token}")
    return 0


def _card(title: str, body: str) -> str:
    """Interactive card v2 shape — a header plus one markdown block."""
    return json.dumps(
        {
            "config": {"wide_screen_mode": True},
            "header": {"title": {"tag": "plain_text", "content": title}},
            "elements": [{"tag": "div", "text": {"tag": "lark_md", "content": body}}],
        },
        ensure_ascii=False,
    )


def cmd_notify(args: argparse.Namespace) -> int:
    chat_id = _cfg("FEISHU_CHAT_ID")
    if not chat_id:
        return _skip("FEISHU_CHAT_ID 未設 —— 未發卡片", args.strict)

    body = args.body
    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8").strip()
    if not body:
        print("[ERROR] notify 要 --body 或 --body-file", file=sys.stderr)
        return 1

    title = args.title
    if not title:
        branch = (os.environ.get("GITHUB_REF_NAME") or "").strip()
        title = f"{_stamp()} 新 firmware 已上載" + (f"（{branch}）" if branch else "")

    folder_url = _cfg("FEISHU_FOLDER_URL")
    if folder_url:
        body = f"{body}\n\n[打開 firmware 資料夾]({folder_url})"

    if args.dry_run:
        print(f"[DRY] card → chat {chat_id}\n{_card(title, body)}")
        return 0

    data = _api(
        "POST",
        "/open-apis/im/v1/messages",
        token=tenant_token(),
        params={"receive_id_type": "chat_id"},
        json={"receive_id": chat_id, "msg_type": "interactive", "content": _card(title, body)},
    )
    print(f"[feishu] card → message_id={data.get('message_id')}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Verify the four env vars against the real API — no writes, so it is safe to spam.

    Most setup mistakes are invisible until a release: a folder the app was never added
    to (1061043), a bot that was never added to the group (no chat_id at all), or a
    scope that was never published. This names each one separately.
    """
    print(f"[doctor] base = {base_url()}")
    for name in ("FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_FOLDER_TOKEN", "FEISHU_CHAT_ID"):
        print(f"  {'✓' if _cfg(name) else '·'} {name}{'' if _cfg(name) else '（未設）'}")
    if not (_cfg("FEISHU_APP_ID") and _cfg("FEISHU_APP_SECRET")):
        print("[doctor] 憑證未設 —— 未做任何請求")
        return 1 if args.strict else 0

    try:
        token = tenant_token()
    except RuntimeError as error:
        print(f"[doctor] ✗ token: {error}")
        return 1
    print("[doctor] ✓ tenant_access_token")

    healthy = True
    folder = folder_token()
    if folder:
        try:
            data = _api(
                "GET",
                "/open-apis/drive/v1/files",
                token=token,
                params={"folder_token": folder, "page_size": 1},
            )
            print(f"[doctor] ✓ 資料夾讀得到（{len(data.get('files') or [])} 個檔）")
        except RuntimeError as error:
            # 99991672 here = only the *read* scopes are missing; upload needs drive:file:upload
            if "99991672" in str(error):
                print("[doctor] · 資料夾列表要 drive:drive:readonly —— 上載唔需要，可以唔理")
            elif "1061043" in str(error):
                healthy = False
                print(f"[doctor] ✗ 資料夾: {error}（app 未加做資料夾協作者）")
            else:
                healthy = False
                print(f"[doctor] ✗ 資料夾: {error}")
        print("[doctor] · 上載 scope（drive:file:upload）冇 API 可查，跑一次 upload 就知")

    # Only checked when a chat is configured: the card is optional, so a missing im:*
    # scope must not make an otherwise healthy upload setup look broken.
    if _cfg("FEISHU_CHAT_ID"):
        try:
            data = _api("GET", "/open-apis/im/v1/chats", token=token, params={"page_size": 20})
            chats = data.get("items") or []
            print(f"[doctor] ✓ bot 喺 {len(chats)} 個群（揀一個做 FEISHU_CHAT_ID）：")
            for chat in chats:
                print(f"        {chat.get('chat_id')}  {chat.get('name')}")
        except RuntimeError as error:
            healthy = False
            print(f"[doctor] ✗ 群列表: {error}（需要 im:chat:readonly scope）")

    return 0 if healthy else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--strict", action="store_true", help="missing env → exit 1 instead of skip")
    parser.add_argument("--dry-run", action="store_true", help="print what would happen")
    sub = parser.add_subparsers(dest="command", required=True)

    up = sub.add_parser("upload", help="upload files to the Drive folder")
    up.add_argument("files", nargs="+")
    up.add_argument("--stamp", action="store_true", help="prefix <YYYY-MM-DD_HHMM>_ to the name")
    up.add_argument(
        "--repo-tag",
        default="",
        help="short repo tag after the stamp (CR/ED/MB/…); default from GITHUB_REPOSITORY",
    )
    up.set_defaults(func=cmd_upload)

    no = sub.add_parser("notify", help="post a card to the group chat")
    no.add_argument("--title", help="card title; defaults to '<stamp> 新 firmware 已上載（<branch>）'")
    no.add_argument("--body", default="")
    no.add_argument("--body-file")
    no.set_defaults(func=cmd_notify)

    sub.add_parser("doctor", help="check env, token, folder access and bot groups").set_defaults(
        func=cmd_doctor
    )

    args = parser.parse_args()
    try:
        return args.func(args)
    except RuntimeError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

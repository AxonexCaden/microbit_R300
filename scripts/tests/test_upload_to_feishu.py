"""Unit tests for the pure-function layer of `scripts/upload_to_feishu.py`.

Issue #467: pin the naming/repo-tag/`--strict` behaviour of the delivery gate.
The upload gate is shared by the CR/ED/MB repos, so a silent rename regression
means "CI green but the folder got no file" — the expensive failure mode.

No network: `_http` is replaced with a guard that fails the test if anything
reaches it, and every test clears the Feishu/GitHub environment first.

Run with the stdlib only (the repo has no pytest dependency):

    python3 -m unittest discover -s scripts/tests -q

Also works under `python3 -m pytest scripts/tests/ -q` when pytest is present.
"""

import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import upload_to_feishu as feishu  # noqa: E402  (path bootstrap must run first)

# Any test that leaves one of these set would read the developer's real config.
_ISOLATED_ENV = (
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_FOLDER_TOKEN",
    "FEISHU_FOLDER_MB",
    "FEISHU_FOLDER_URL",
    "FEISHU_CHAT_ID",
    "FEISHU_BASE",
    "GITHUB_REPOSITORY",
    "GITHUB_REF_NAME",
)


class _IsolatedTest(unittest.TestCase):
    """Clear env vars, block HTTP, and give each test its own temp directory."""

    def setUp(self):
        env_patch = mock.patch.dict(os.environ, {}, clear=False)
        env_patch.start()
        self.addCleanup(env_patch.stop)
        for key in _ISOLATED_ENV:
            os.environ.pop(key, None)

        http_guard = mock.patch.object(
            feishu,
            "_http",
            side_effect=AssertionError("unit tests must never call the Feishu API"),
        )
        http_guard.start()
        self.addCleanup(http_guard.stop)

        tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        self.tmpdir = Path(tmpdir.name)

    def make_file(self, name: str) -> Path:
        path = self.tmpdir / name
        path.write_bytes(b"\x00")
        return path

    def run_main(self, *argv: str):
        """Call the real CLI entry point; return (exit code, stdout)."""
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["upload_to_feishu.py", *argv]):
            with redirect_stdout(out):
                code = feishu.main()
        return code, out.getvalue()

    def dry_run_upload(self, filename: str, *extra_args: str, env=None):
        """Run `--dry-run upload --stamp` and return its stdout."""
        path = self.make_file(filename)
        with mock.patch.object(feishu, "_stamp", return_value="2026-11-05_1430"):
            with mock.patch.dict(os.environ, env or {}):
                code, out = self.run_main("--dry-run", "upload", "--stamp", *extra_args, str(path))
        self.assertEqual(code, 0, out)
        return out


class RepoTagTests(_IsolatedTest):
    """`repo_tag()`: known repos map to short tags, unknown ones fall back."""

    def test_known_repo_mapping(self):
        cases = {
            "CompanionRobots": "CR",
            "EmotionDisplay": "ED",
            "microbit_R300": "MB",
            "r300-motor-code": "MOTOR",
        }
        for repo, expected in cases.items():
            with self.subTest(repo=repo):
                with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": f"AxonexCaden/{repo}"}):
                    self.assertEqual(feishu.repo_tag(), expected)

    def test_unknown_repo_falls_back_to_slug(self):
        env = {"GITHUB_REPOSITORY": "AxonexCaden/SomeNewRobotRepo"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(feishu.repo_tag(), "SomeNewRobotRepo")

    def test_repository_without_owner_prefix_still_maps(self):
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "EmotionDisplay"}):
            self.assertEqual(feishu.repo_tag(), "ED")

    def test_no_repository_and_no_explicit_tag_is_empty(self):
        self.assertEqual(feishu.repo_tag(), "")

    def test_explicit_tag_wins_over_repository(self):
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "AxonexCaden/EmotionDisplay"}):
            self.assertEqual(feishu.repo_tag("MOTOR"), "MOTOR")

    def test_explicit_tag_is_stripped(self):
        self.assertEqual(feishu.repo_tag("  MB  "), "MB")

    def test_blank_explicit_tag_falls_back_to_repository(self):
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "AxonexCaden/microbit_R300"}):
            self.assertEqual(feishu.repo_tag("   "), "MB")


class NameRegexTests(unittest.TestCase):
    """`_NAME_RE`: only the three artifact kinds in a `.bin` suffix are renamed."""

    def test_matches_full_ota_and_app_bins(self):
        cases = {
            "R300-edu-microbit-pengu_full.bin": ("R300-edu-microbit-pengu", "full"),
            "R300-edu-microbit-pengu_ota.bin": ("R300-edu-microbit-pengu", "ota"),
            "R300-edu-microbit-pengu_app.bin": ("R300-edu-microbit-pengu", "app"),
        }
        for name, (base, kind) in cases.items():
            with self.subTest(name=name):
                match = feishu._NAME_RE.fullmatch(name)
                self.assertIsNotNone(match)
                self.assertEqual(match["base"], base)
                self.assertEqual(match["kind"], kind)

    def test_matches_already_stamped_full_shape(self):
        name = "2026-11-05_1430_CR_R300-edu-microbit-pengu_v1.2.3_full.bin"
        match = feishu._NAME_RE.fullmatch(name)
        self.assertIsNotNone(match)
        self.assertEqual(
            match["base"], "2026-11-05_1430_CR_R300-edu-microbit-pengu_v1.2.3"
        )
        self.assertEqual(match["kind"], "full")

    def test_does_not_match_docs_metadata_or_logs(self):
        for name in ("notes.txt", "firmware_full.map", "build.log", "release_notes.txt"):
            with self.subTest(name=name):
                self.assertIsNone(feishu._NAME_RE.fullmatch(name))

    def test_does_not_match_hex_files(self):
        # The production regex only re-stamps full/ota/app `.bin` artifacts; a
        # `.hex` (micro:bit) file is passed through by `stamped_name` untouched,
        # keeping `r300.hex` from being mistaken for an ESP32 `_full.bin`.
        for name in ("r300.hex", "firmware_full.hex", "pengu_app.hex"):
            with self.subTest(name=name):
                self.assertIsNone(feishu._NAME_RE.fullmatch(name))

    def test_does_not_match_bin_without_a_known_kind(self):
        for name in ("firmware.bin", "firmware_full_v2.bin", "full.bin"):
            with self.subTest(name=name):
                self.assertIsNone(feishu._NAME_RE.fullmatch(name))


class StampedNameTests(unittest.TestCase):
    """`stamped_name()`: `<date>_<hhmm>_<TAG>_<name>_v<ver>.<ext>` full shape."""

    def test_known_kinds_keep_the_kind_at_the_end(self):
        cases = {
            "R300-edu-microbit-pengu_full.bin": (
                "2026-11-05_1430_CR_R300-edu-microbit-pengu_full.bin"
            ),
            "R300-edu-microbit-pengu_ota.bin": (
                "2026-11-05_1430_CR_R300-edu-microbit-pengu_ota.bin"
            ),
            "R300-edu-microbit-pengu_app.bin": (
                "2026-11-05_1430_CR_R300-edu-microbit-pengu_app.bin"
            ),
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(feishu.stamped_name(Path(name), "2026-11-05_1430", "CR"), expected)

    def test_versioned_hex_gets_the_complete_stamp_tag_shape(self):
        result = feishu.stamped_name(
            Path("R300-edu-microbit-pengu_v1.2.3.hex"), "2026-11-05_1430", "MB"
        )
        self.assertEqual(
            result, "2026-11-05_1430_MB_R300-edu-microbit-pengu_v1.2.3.hex"
        )

    def test_microbit_hex_is_prefixed_not_reordered(self):
        # The module docstring's own example: `r300.hex` must stay recognisably
        # a micro:bit file next to the ESP32 `_full.bin` in the shared folder.
        self.assertEqual(
            feishu.stamped_name(Path("r300.hex"), "2026-11-05_1430", "MB"),
            "2026-11-05_1430_MB_r300.hex",
        )

    def test_unknown_artifact_shapes_only_get_the_prefix(self):
        cases = {
            "build.log": "2026-11-05_1430_ED_build.log",
            "firmware.map": "2026-11-05_1430_ED_firmware.map",
            "release_notes.txt": "2026-11-05_1430_ED_release_notes.txt",
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(feishu.stamped_name(Path(name), "2026-11-05_1430", "ED"), expected)

    def test_stamp_without_tag(self):
        self.assertEqual(
            feishu.stamped_name(Path("robot_full.bin"), "2026-11-05_1430"),
            "2026-11-05_1430_robot_full.bin",
        )

    def test_tag_without_stamp(self):
        self.assertEqual(
            feishu.stamped_name(Path("robot_ota.bin"), "", "MOTOR"),
            "MOTOR_robot_ota.bin",
        )

    def test_no_stamp_and_no_tag_is_identity(self):
        self.assertEqual(
            feishu.stamped_name(Path("robot_full.bin"), "", ""),
            "robot_full.bin",
        )


class StrictModeTests(_IsolatedTest):
    """`--strict`: missing config is a skip by default and a failure in strict mode."""

    def test_upload_without_folder_token_skips_with_exit_zero(self):
        path = self.make_file("robot_full.bin")
        code, out = self.run_main("upload", str(path))
        self.assertEqual(code, 0)
        self.assertIn("[SKIP] FEISHU_FOLDER_TOKEN", out)

    def test_upload_without_folder_token_strict_exits_non_zero(self):
        path = self.make_file("robot_full.bin")
        code, out = self.run_main("--strict", "upload", str(path))
        self.assertEqual(code, 1)
        self.assertIn("[SKIP] FEISHU_FOLDER_TOKEN", out)

    def test_upload_with_app_credentials_but_no_folder_still_skips(self):
        path = self.make_file("robot_full.bin")
        env = {"FEISHU_APP_ID": "cli_test", "FEISHU_APP_SECRET": "secret_test"}
        with mock.patch.dict(os.environ, env):
            code, out = self.run_main("--strict", "upload", str(path))
        self.assertEqual(code, 1)
        self.assertIn("[SKIP] FEISHU_FOLDER_TOKEN", out)

    def test_notify_without_chat_id_skips_with_exit_zero(self):
        code, out = self.run_main("notify", "--body", "hello")
        self.assertEqual(code, 0)
        self.assertIn("[SKIP] FEISHU_CHAT_ID", out)

    def test_notify_without_chat_id_strict_exits_non_zero(self):
        code, out = self.run_main("--strict", "notify", "--body", "hello")
        self.assertEqual(code, 1)
        self.assertIn("[SKIP] FEISHU_CHAT_ID", out)

    def test_doctor_without_credentials_is_ok_by_default(self):
        code, out = self.run_main("doctor")
        self.assertEqual(code, 0)
        self.assertIn("憑證未設", out)

    def test_doctor_without_credentials_strict_exits_non_zero(self):
        code, out = self.run_main("--strict", "doctor")
        self.assertEqual(code, 1)
        self.assertIn("憑證未設", out)


class RepoTagCliTests(_IsolatedTest):
    """`--repo-tag`: default (derive from GITHUB_REPOSITORY) and explicit override."""

    def _parse_upload_args(self, *upload_args: str):
        calls = []

        def fake_cmd_upload(args):
            calls.append(args)
            return 0

        with mock.patch.object(feishu, "cmd_upload", side_effect=fake_cmd_upload):
            with mock.patch.object(
                sys, "argv", ["upload_to_feishu.py", "upload", *upload_args]
            ):
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(feishu.main(), 0)
        self.assertEqual(len(calls), 1)
        return calls[0]

    def test_argument_default_is_empty(self):
        default_args = self._parse_upload_args("robot_full.bin")
        self.assertEqual(default_args.repo_tag, "")
        explicit_args = self._parse_upload_args("--repo-tag", "MOTOR", "robot_full.bin")
        self.assertEqual(explicit_args.repo_tag, "MOTOR")

    def test_upload_derives_tag_from_github_repository(self):
        out = self.dry_run_upload(
            "robot_full.bin",
            env={
                "FEISHU_FOLDER_TOKEN": "fld_test",
                "GITHUB_REPOSITORY": "AxonexCaden/EmotionDisplay",
            },
        )
        self.assertIn("as 2026-11-05_1430_ED_robot_full.bin", out)

    def test_upload_explicit_repo_tag_overrides_repository(self):
        out = self.dry_run_upload(
            "robot_full.bin",
            "--repo-tag",
            "MOTOR",
            env={
                "FEISHU_FOLDER_TOKEN": "fld_test",
                "GITHUB_REPOSITORY": "AxonexCaden/EmotionDisplay",
            },
        )
        self.assertIn("as 2026-11-05_1430_MOTOR_robot_full.bin", out)

    def test_upload_unknown_repository_uses_the_slug(self):
        out = self.dry_run_upload(
            "robot_full.bin",
            env={
                "FEISHU_FOLDER_TOKEN": "fld_test",
                "GITHUB_REPOSITORY": "AxonexCaden/SomeNewRobotRepo",
            },
        )
        self.assertIn("as 2026-11-05_1430_SomeNewRobotRepo_robot_full.bin", out)

    def test_upload_without_repository_or_tag_keeps_stamp_only(self):
        out = self.dry_run_upload("robot_full.bin", env={"FEISHU_FOLDER_TOKEN": "fld_test"})
        self.assertIn("as 2026-11-05_1430_robot_full.bin", out)

    def test_upload_without_stamp_uses_tag_only(self):
        path = self.make_file("robot_ota.bin")
        with mock.patch.dict(
            os.environ,
            {"FEISHU_FOLDER_TOKEN": "fld_test", "GITHUB_REPOSITORY": "AxonexCaden/microbit_R300"},
        ):
            code, out = self.run_main("--dry-run", "upload", str(path))
        self.assertEqual(code, 0, out)
        self.assertIn("as MB_robot_ota.bin", out)


if __name__ == "__main__":
    unittest.main()

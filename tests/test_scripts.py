#!/usr/bin/env python3
"""脚本层的单元测试（构建/校验工具的纯逻辑部分）。

跑法：
    npm run test:scripts
    # 或 uv run python -m unittest discover -s tests -p "test_*.py" -v
"""

import contextlib
import importlib.util
import io
import plistlib
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(rel_path: str):
    """按路径加载 script/ 下的脚本（它们不是包，没有 __init__）。"""
    spec = importlib.util.spec_from_file_location(Path(rel_path).stem, ROOT / rel_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sync_appex_version = load("script/sync_appex_version.py")
check_android_build = load("script/check_android_build.py")
check_widget_setup = load("script/check_widget_setup.py")


class TestManifestVersion(unittest.TestCase):
    """manifest.json 带注释，不能直接 json.load —— 这里把正则抠字段的行为锁住。"""

    def write(self, text: str) -> Path:
        tmp = Path(tempfile.mkdtemp()) / "manifest.json"
        tmp.write_text(text, encoding="utf-8")
        return tmp

    def test_reads_version_with_comments(self):
        path = self.write(
            '{\n\t"name": "Ecowitt",\n\t/* 注释 */\n'
            '\t"versionName": "1.1.75",\n\t"versionCode": 11075,\n'
            '\t"app-plus": { /* 5+App特有相关 */ }\n}\n'
        )
        self.assertEqual(sync_appex_version.read_manifest_version(path), ("1.1.75", "11075"))

    def test_missing_field_exits(self):
        path = self.write('{ "name": "Ecowitt" }')
        with self.assertRaises(SystemExit):
            sync_appex_version.read_manifest_version(path)


class TestPatchAppex(unittest.TestCase):
    """.appex 版本号必须与主 App 一致（否则上架报 ITMS-90473），保留其它字段。"""

    def make_appex(self, short: str, build: str) -> Path:
        appex = Path(tempfile.mkdtemp()) / "EcowittWidget.appex"
        appex.mkdir()
        plist = {
            "CFBundleIdentifier": "com.ost.testecowittapp.widget",
            "CFBundleShortVersionString": short,
            "CFBundleVersion": build,
            "EcowittAppGroup": "group.com.ost.ecowitt",
            "NSExtension": {"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"},
        }
        with (appex / "Info.plist").open("wb") as f:
            plistlib.dump(plist, f)
        return appex

    def test_patches_version_and_keeps_other_keys(self):
        appex = self.make_appex("1.0", "1")
        with contextlib.redirect_stdout(io.StringIO()):
            sync_appex_version.patch_appex(appex, "1.1.75", "11075")
        with (appex / "Info.plist").open("rb") as f:
            data = plistlib.load(f)
        self.assertEqual(data["CFBundleShortVersionString"], "1.1.75")
        self.assertEqual(data["CFBundleVersion"], "11075")
        self.assertEqual(data["CFBundleIdentifier"], "com.ost.testecowittapp.widget")
        self.assertEqual(data["EcowittAppGroup"], "group.com.ost.ecowitt")
        self.assertEqual(
            data["NSExtension"]["NSExtensionPointIdentifier"], "com.apple.widgetkit-extension"
        )

    def test_missing_plist_exits(self):
        empty = Path(tempfile.mkdtemp()) / "Empty.appex"
        empty.mkdir()
        with self.assertRaises(SystemExit):
            sync_appex_version.patch_appex(empty, "1.1.75", "11075")


class TestProfileGrant(unittest.TestCase):
    """mobileprovision 是 CMS 签名包，但里面的 plist 明文可搜，不需要 macOS 也能查能力。"""

    def test_finds_entitlement_string(self):
        path = Path(tempfile.mkdtemp()) / "ios-widget-dev.mobileprovision"
        path.write_bytes(b"<plist><key>com.apple.security.application-groups</key>"
                         b"<array><string>group.com.ost.ecowitt</string></array></plist>")
        self.assertTrue(check_widget_setup.profile_grant(path, "com.apple.security.application-groups"))
        self.assertTrue(check_widget_setup.profile_grant(path, "group.com.ost.ecowitt"))
        self.assertFalse(check_widget_setup.profile_grant(path, "group.com.other"))

    def test_missing_file_is_false(self):
        self.assertFalse(check_widget_setup.profile_grant(Path("nope.mobileprovision"), "x"))


class TestVersionKey(unittest.TestCase):
    """android-9 必须排在 android-36 前面，否则会挑错 SDK/platform。"""

    def test_numeric_ordering(self):
        names = ["android-9", "android-34", "android-36", "android-32"]
        ordered = sorted((Path(n) for n in names), key=check_android_build.version_key)
        self.assertEqual([p.name for p in ordered],
                         ["android-9", "android-32", "android-34", "android-36"])

    def test_build_tools_ordering(self):
        names = ["35.0.0", "36.0.0", "35.0.1"]
        ordered = sorted((Path(n) for n in names), key=check_android_build.version_key)
        self.assertEqual([p.name for p in ordered], ["35.0.0", "35.0.1", "36.0.0"])


class TestCommandsDocCoverage(unittest.TestCase):
    """COMMANDS.md 是命令总表。新增命令忘了写文档，这里会 FAIL。

    之前出现过「文档写着 Android 空实现，实际已可用」这类漂移，
    所以把文档覆盖也做成一条测试。
    """

    DOC = ROOT / "native/ios-widget/COMMANDS.md"

    def test_doc_exists(self):
        self.assertTrue(self.DOC.exists(), "COMMANDS.md 不存在")

    def test_every_widget_and_test_script_is_documented(self):
        import json

        scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
        tracked = [k for k in scripts if k.startswith("widget:") or k.startswith("test")]
        text = self.DOC.read_text(encoding="utf-8")
        missing = [f"npm run {k}" for k in tracked if f"npm run {k}`" not in text and k not in text]
        self.assertEqual(missing, [], f"这些命令没写进 COMMANDS.md：{missing}")


if __name__ == "__main__":
    unittest.main(verbosity=2)

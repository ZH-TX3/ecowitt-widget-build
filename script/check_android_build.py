#!/usr/bin/env python3
"""Android 端本地编译校验。

在没有 Android Studio 的机器上也能跑：只需要 JDK + Android SDK，
kotlinc 可以从 HBuilderX 自带的目录里借用（uniapp-runextension/plugins/kotlinc）。

做三件事：
  1. 用 android.jar 编译 hybrid.kt（抓 Kotlin 语法/类型错误）
  2. aapt2 compile 校验 res（抓布局/资源 XML 错误）
  3. aapt2 link 把一个临时 manifest 和资源链起来（抓 @xml / @drawable 等引用错误、清单属性错误）

    uv run script/check_android_build.py
    uv run script/check_android_build.py --verbose

它不能替代云打包：uts 的 index.uts -> Kotlin 转换、插件与宿主工程的合并只有 HBuilderX 能做。
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 两种布局都要支持：
#   uni-app 仓库：<root>/uni_modules/ecowitt-widget/utssdk/app-android
#   CI 镜像仓库： <root>/app-android
ANDROID_SRC = ROOT / "uni_modules/ecowitt-widget/utssdk/app-android"
if not ANDROID_SRC.is_dir() and (ROOT / "app-android").is_dir():
    ANDROID_SRC = ROOT / "app-android"
KT_FILE = ANDROID_SRC / "hybrid.kt"
RES_DIR = ANDROID_SRC / "res"
MANIFEST = ANDROID_SRC / "AndroidManifest.xml"
PACKAGE_NAME = "uni.modules.ecowittwidget"

ok = 0
fail = 0


def report(label: str, passed: bool, detail: str = "") -> None:
    global ok, fail
    if passed:
        ok += 1
        print(f"[PASS] {label}" + (f"  -> {detail}" if detail else ""))
    else:
        fail += 1
        print(f"[FAIL] {label}" + (f"  -> {detail}" if detail else ""))


def find_kotlinc() -> str:
    for env in ("KOTLINC", "KOTLIN_HOME"):
        v = os.environ.get(env)
        if v:
            p = Path(v)
            for cand in (p, p / "bin/kotlinc.bat", p / "bin/kotlinc"):
                if cand.is_file():
                    return str(cand)
    patterns = [
        "D:/soft/HBuilderX*/HBuilderX/plugins/uniapp-runextension/kotlinc/bin/kotlinc.bat",
        "C:/Program Files/HBuilderX/plugins/uniapp-runextension/kotlinc/bin/kotlinc.bat",
        "C:/soft/HBuilderX*/HBuilderX/plugins/uniapp-runextension/kotlinc/bin/kotlinc.bat",
        "D:/HBuilderX*/HBuilderX/plugins/uniapp-runextension/kotlinc/bin/kotlinc.bat",
    ]
    for pat in patterns:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    which = shutil.which("kotlinc")
    return which or ""


def find_sdk() -> Path:
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        v = os.environ.get(env)
        if v and Path(v).is_dir():
            return Path(v)
    for cand in (
        Path("D:/Android/Sdk"),
        Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk",
        Path.home() / "AppData/Local/Android/Sdk",
    ):
        if cand.is_dir():
            return cand
    return Path()


def version_key(p: Path) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", p.name) or [0])


def pick(sdk: Path, kind: str, name: str):
    """返回找到的路径，找不到返回 None（注意 Path('.') 是 truthy，不能用空 Path 当缺省）。"""
    base = sdk / kind
    if not base.is_dir():
        return None
    cands = sorted([p for p in base.iterdir() if p.is_dir()], key=version_key)
    for d in reversed(cands):
        f = d / name
        if f.exists():
            return f
    return None


def run(cmd, cwd: Path = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd or ROOT), capture_output=True, text=True, shell=isinstance(cmd, str))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    print("=" * 62)
    print("android widget build check")
    print("=" * 62)

    kotlinc = find_kotlinc()
    sdk = find_sdk()
    android_jar = pick(sdk, "platforms", "android.jar")
    aapt2 = pick(sdk, "build-tools", "aapt2.exe") or pick(sdk, "build-tools", "aapt2")

    report("kotlinc found", bool(kotlinc), kotlinc or "没找到（可设 KOTLINC 环境变量）")
    report("Android SDK found", bool(sdk), str(sdk) if sdk else "没找到（可设 ANDROID_HOME）")
    report("android.jar found", android_jar is not None, str(android_jar) if android_jar else "platforms/ 下没有 android.jar")
    report("aapt2 found", aapt2 is not None, str(aapt2) if aapt2 else "build-tools/ 里没有 aapt2（可装 build-tools;35.0.0）")
    if not (kotlinc and android_jar and aapt2):
        summary()
        return

    tmp = Path(tempfile.mkdtemp(prefix="android-check-"))
    try:
        # 1. Kotlin
        classes = tmp / "classes"
        classes.mkdir()
        cmd = f'"{kotlinc}" -nowarn -cp "{android_jar}" -d "{classes}" "{KT_FILE}"'
        r = run(cmd)
        detail = (r.stderr or r.stdout).strip()
        report("kotlinc compiles hybrid.kt", r.returncode == 0,
               "" if r.returncode == 0 else detail[:600])
        class_count = len(list(classes.rglob("*.class")))
        if r.returncode == 0:
            report("kotlin classes produced", class_count > 0, f"{class_count} classes")

        # 2. 资源编译
        res_zip = tmp / "res.zip"
        r = run([str(aapt2), "compile", "--dir", str(RES_DIR), "-o", str(res_zip)])
        report("aapt2 compile res", r.returncode == 0,
               "" if r.returncode == 0 else (r.stderr or r.stdout).strip()[:600])

        # 3. 清单 + 资源链接（临时补 package 属性，插件清单本身是库清单）
        if res_zip.exists():
            manifest_tmp = tmp / "AndroidManifest.xml"
            text = MANIFEST.read_text(encoding="utf-8")
            text = text.replace(
                '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
                f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{PACKAGE_NAME}">',
            )
            manifest_tmp.write_text(text, encoding="utf-8")
            apk = tmp / "out.apk"
            cmd = [
                str(aapt2), "link", "-o", str(apk),
                "-I", str(android_jar),
                "--manifest", str(manifest_tmp),
                "-R", str(res_zip),
                "--min-sdk-version", "22",
                "--target-sdk-version", "36",
                "--auto-add-overlay",
            ]
            r = run(cmd)
            out = (r.stderr or r.stdout).strip()
            report("aapt2 link (manifest + resource refs)", r.returncode == 0,
                   "" if r.returncode == 0 else out[:800])
            if args.verbose and out:
                print(out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    summary()


def summary() -> None:
    print("-" * 62)
    print(f"PASS {ok}  FAIL {fail}")
    if fail:
        print("修完再云打包。本地能过 ≠ 云打包能过，但本地不过就一定过不了。")
        sys.exit(1)
    print("本地校验通过。下一步：云打包自定义基座，装机验收。")


if __name__ == "__main__":
    main()

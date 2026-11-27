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
PACKAGE_NAME = "uts.sdk.modules.ecowittWidget"

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


class _Result:
    __slots__ = ("returncode", "stdout", "stderr")

    def __init__(self, rc: int, out: bytes, err: bytes):
        self.returncode = rc
        # 一律按 utf-8 解码并容错：Windows 控制台/管道的 GBK 解码会在读取线程里抛
        # UnicodeDecodeError，直接把 stdout 变成 None
        self.stdout = (out or b"").decode("utf-8", errors="replace")
        self.stderr = (err or b"").decode("utf-8", errors="replace")


def run(cmd, cwd: Path = None) -> _Result:
    r = subprocess.run(cmd, cwd=str(cwd or ROOT), capture_output=True, shell=isinstance(cmd, str))
    return _Result(r.returncode, r.stdout, r.stderr)


def lint_two_column_alignment(layout_dir: Path) -> list:
    """横向两栏（两个非空垂直容器并排）必须 gravity=center_vertical。

    否则内容少的那一栏会贴顶 —— v4 联调时 large 的 hero 左栏就是这么错位的，
    而且这类问题单测看不见（RemoteViews 不能在 JVM 里 inflate），只能真机截图。
    """
    import xml.etree.ElementTree as ET

    ns = "{http://schemas.android.com/apk/res/android}"
    bad = []
    for f in sorted(layout_dir.glob("ecowitt_widget_v4_*.xml")):
        root = ET.parse(f).getroot()
        for el in root.iter():
            if el.tag != "LinearLayout" or el.get(ns + "orientation") != "horizontal":
                continue
            cols = [
                k for k in el
                if k.tag == "LinearLayout"
                and k.get(ns + "orientation") == "vertical"
                and len(k) > 0
            ]
            if len(cols) < 2:
                continue
            if "center_vertical" not in (el.get(ns + "gravity") or ""):
                bad.append(f"{f.name}: 一行里的两栏缺 gravity=center_vertical")
    return bad


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--apk", nargs="?", const="unpackage/debug/android_debug.apk", default=None,
                        help="校验云打包的自定义基座 apk（不给路径时用 unpackage/debug/android_debug.apk）")
    args = parser.parse_args()

    # Windows 控制台默认 GBK，日志/输出里有非 GBK 字符会抛 UnicodeEncodeError
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    print("=" * 62)
    print("android widget build check")
    print("=" * 62)

    kotlinc = find_kotlinc()
    sdk = find_sdk()
    android_jar = pick(sdk, "platforms", "android.jar")
    aapt2 = pick(sdk, "build-tools", "aapt2.exe") or pick(sdk, "build-tools", "aapt2")

    if args.apk:
        # 只看产物：不需要 kotlinc
        report("Android SDK found", bool(sdk), str(sdk) if sdk else "没找到（可设 ANDROID_HOME）")
        aapt2 = pick(sdk, "build-tools", "aapt2.exe") or pick(sdk, "build-tools", "aapt2")
        report("aapt2 found", aapt2 is not None, str(aapt2) if aapt2 else "build-tools/ 里没有 aapt2")
        if aapt2:
            check_apk(args.apk, aapt2)
        summary()
        return

    report("kotlinc found", bool(kotlinc), kotlinc or "没找到（可设 KOTLINC 环境变量）")
    report("Android SDK found", bool(sdk), str(sdk) if sdk else "没找到（可设 ANDROID_HOME）")
    report("android.jar found", android_jar is not None, str(android_jar) if android_jar else "platforms/ 下没有 android.jar")
    report("aapt2 found", aapt2 is not None, str(aapt2) if aapt2 else "build-tools/ 里没有 aapt2（可装 build-tools;35.0.0）")
    if not (kotlinc and android_jar and aapt2):
        summary()
        return
    # 4'. 版本敏感的 stdlib API。
    # 本地 kotlinc 通常比云端新，max() / min() 这类从 1.7 起被标成 HIDDEN 的调用
    # 本地能过、云打包报「None of the following candidates is applicable」。
    # 2026-11 云打包就是这么挂在 bars() 里的 values.max() 上的。
    risky = [
        (r"\.max\(\)", "max() → maxOrNull()"),
        (r"\.min\(\)", "min() → minOrNull()"),
        (r"\.maxBy\(", "maxBy {} → maxByOrNull {}"),
        (r"\.minBy\(", "minBy {} → minByOrNull {}"),
        (r"\.sumBy\(", "sumBy {} → sumOf {}"),
    ]
    kt_text = KT_FILE.read_text(encoding="utf-8")
    hits = [label for pat, label in risky if re.search(pat, kt_text)]
    report("no stdlib APIs removed in Kotlin 1.7", not hits,
           "、".join(hits) if hits else "max/min 都用了 OrNull 版本")

    # 5''. uts 里的数字恒等比较（.length === 0、=== 1）会编成 Kotlin 的 Int === Int，
    # 语法合法但已废弃，云端 Gradle 每条都打 warning。uts 不在本地 kotlinc 的编译范围里，
    # 只能静态抓 —— 顺手也就成了「云端一直报警」这类问题的本地出口。
    import re as _re

    uts_hits = []
    for f in sorted(ANDROID_SRC.parent.rglob("*.uts")):
        text = f.read_text(encoding="utf-8")
        for m in _re.finditer(r"\.length\s*===|\.length\s*!==|===\s*\d+\b|!==\s*\d+\b", text):
            line = text[: m.start()].count("\n") + 1
            uts_hits.append(f"{f.relative_to(ROOT).as_posix()}:{line}")
    report(
        "no numeric identity comparison in uts",
        not uts_hits,
        "、".join(uts_hits[:4]) if uts_hits else "uts 里没有 Int === Int 的写法",
    )

    # 5'. 布局 lint：横向两栏必须垂直居中（内容少的一栏贴顶是真机才看得见的坑）
    bad_rows = lint_two_column_alignment(RES_DIR / "layout")
    report("two-column rows are vertically centred", not bad_rows,
           "；".join(bad_rows) if bad_rows else "两栏布局都居中了")


    tmp = Path(tempfile.mkdtemp(prefix="android-check-"))
    try:
        # 1. Kotlin
        classes = tmp / "classes"
        classes.mkdir()
        # 不加 -nowarn：云端 Gradle 会把 warning 打出来（v4 联调时就报了 5 条
        # always-true / 恒等比较废弃），本地静音等于看不见同一批提示。
        # warning 不影响退出码，只是打印，方便比云端日志。
        cmd = f'"{kotlinc}" -cp "{android_jar}" -d "{classes}" "{KT_FILE}"'
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
            has_package = re.search(r'<manifest[^>]*package="([^"]+)"', text)
            if not has_package:
                # 真清单必须自带 package，否则 HBuilderX 本地构建的 aapt2 link 会失败
                report("manifest declares package attribute", False,
                       "缺 package：HBuilderX 本地构建会报 '<manifest> must have a package attribute'")
                text = text.replace(
                    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
                    f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{PACKAGE_NAME}">',
                )
            else:
                actual = has_package.group(1)
                manifest_pkg_ok = (actual == PACKAGE_NAME)
                report("manifest package matches kotlin package", manifest_pkg_ok,
                       f"{actual} vs {PACKAGE_NAME}")
                if not manifest_pkg_ok:
                    text = re.sub(r'(<manifest[^>]*package=")[^"]+(")', rf"\g<1>{PACKAGE_NAME}\g<2>", text, count=1)
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

    report_fastloop()
    summary()


HX_ROOTS = [
    "D:/Program Files/HBuilderX",
    "C:/Program Files/HBuilderX",
    "D:/soft/HBuilderX",
    "C:/soft/HBuilderX",
]


def list_installations() -> list:
    """列出所有 HBuilderX 安装：(目录, 版本, 是否装了 uts-development-android)。

    机器上可能同时存在多个版本（升级残留），只报一个会误导——按版本号全部列出。
    """
    import json

    seen = []
    candidates = []
    for root in HX_ROOTS:
        p = Path(root)
        if (p / "plugins").is_dir():
            candidates.append(p)
    for pat in ("D:/soft/HBuilderX*", "C:/soft/HBuilderX*", "D:/HBuilderX*", "C:/HBuilderX*"):
        for hit in glob.glob(pat):
            for inner in (Path(hit), Path(hit) / "HBuilderX"):
                if (inner / "plugins").is_dir():
                    candidates.append(inner)

    for p in candidates:
        if p in seen:
            continue
        seen.append(p)
        # HBuilderX 安装目录里没有 package.json，版本只能从目录名读；
        # 形如 HBuilderX.3.6.15.20221228 是升级残留，不带版本号的那个才是当前安装
        version = ""
        m = re.search(r"HBuilderX[._-]?(\d+\.\d+\.\d+)", p.as_posix())
        if m:
            version = m.group(1)
        has_plugin = (p / "plugins/uts-development-android").is_dir()
        yield (p, version, has_plugin)


def report_fastloop() -> None:
    """报告 UTS 工具链状态：哪些平台能本地联编、哪些能断点调试。

    注意 HBuilderX 升级后安装目录名可能还是旧版本号（例如 HBuilderX.3.6.15.20221228），
    所以「按目录名判版本」会误判，这里改为按插件是否齐全来判定当前生效的安装。
    """
    import json

    installs = list(list_installations())
    print()
    print("--- UTS 工具链 ---")
    if not installs:
        print("[INFO] 未找到 HBuilderX 安装目录（不影响云打包）")
        print()
        return

    def plugin_version(root: Path, name: str) -> str:
        try:
            return json.loads((root / f"plugins/{name}/package.json").read_text(encoding="utf-8")).get("version", "")
        except Exception:  # noqa: BLE001
            return ""

    for path, version, _ in installs:
        dev_and = (path / "plugins/uts-development-android").is_dir()
        dev_ios = (path / "plugins/uts-development-ios").is_dir()
        dbg_and = (path / "plugins/uts-android-debug").is_dir()
        dbg_ios = (path / "plugins/uts-debug-ios").is_dir()
        if not (dev_and or dev_ios or dbg_and or dbg_ios):
            print(f"[INFO] {path}  (无 UTS 插件)")
            continue
        label = version or "目录名未标版本"
        print(f"[INFO] {path}")
        print(f"       目录名标注: {label}（升级后可能是残留，以插件版本为准）")
        print(f"       uts-development-android {plugin_version(path, 'uts-development-android') or '-'}"
              f" | uts-android-debug {plugin_version(path, 'uts-android-debug') or '-'}")
        print(f"       uts-development-ios     {plugin_version(path, 'uts-development-ios') or '-'}"
              f" | uts-debug-ios     {plugin_version(path, 'uts-debug-ios') or '-'}")

        print()
        if dev_and:
            print("[INFO] Android 本地联编: 可用 —— 改 hybrid.kt / res 后真机运行即可，不需要云打包")
        else:
            print("[INFO] Android 本地联编: 不可用 —— HBuilderX → 工具 → 插件安装 → 「UTS 开发扩展-Android」")

        if dev_ios:
            if sys.platform == "darwin":
                print("[INFO] iOS 本地联编: 可用（需 Xcode）—— Swift 改完可真机运行，HBuilderX 自动重签基座")
            else:
                print("[INFO] iOS 本地联编: 本机为 Windows，装了这个插件也编不了 Swift；iOS 仍走云端")
        else:
            print("[INFO] iOS 本地联编: 未安装「UTS 开发扩展-iOS」")

        if dbg_and or dbg_ios:
            print("[INFO] 断点调试: 插件已装，但只能断在插件代码（.uts / Kotlin / Swift）；")
            print("       小组件自身的渲染（RemoteViews / WidgetKit 扩展进程）断不到，看日志更实际")
            print("       Android 侧 widget provider 与 App 同进程，logcat 过滤 EcowittWidget 即可")
        return

    print()


def check_apk(apk_path: str, aapt2) -> None:
    """校验云打包出来的 apk 里，插件是否真的被合并进宿主。

    这一步对应 iOS 的 widget:check:ipa —— 装在手机上之前先把「插件到底进没进包」查清楚。
    """
    import zipfile

    apk = Path(apk_path)
    if not apk.is_absolute():
        apk = ROOT / apk
    if not apk.exists():
        report(f"apk exists ({apk.name})", False, str(apk))
        return

    print(f"[INFO] 校验 {apk.relative_to(ROOT) if apk.is_relative_to(ROOT) else apk}")
    manifest = run([str(aapt2), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)]).stdout
    report("receiver merged into AndroidManifest", "EcowittWidgetProvider" in manifest,
           "" if "EcowittWidgetProvider" in manifest else "插件清单没合并：基座里没有 AppWidget")
    report("appwidget.provider meta-data present", "appwidget.provider" in manifest)

    resources = run([str(aapt2), "dump", "resources", str(apk)]).stdout
    report("layout ecowitt_widget merged into res", "ecowitt_widget" in resources,
           "" if "ecowitt_widget" in resources else "插件 res 没合并：getIdentifier 会返回 0，卡片空白")
    report("xml ecowitt_widget_info merged into res", "ecowitt_widget_info" in resources)

    with zipfile.ZipFile(apk) as z:
        dex = b"".join(z.read(n) for n in z.namelist() if n.endswith(".dex"))
    has_class = b"EcowittWidgetProvider" in dex
    report("EcowittWidgetProvider compiled into dex", has_class,
           "" if has_class else "插件 Kotlin 没编进基座：uts 插件被跳过")


def summary() -> None:
    print("-" * 62)
    print(f"PASS {ok}  FAIL {fail}")
    if fail:
        print("有 FAIL 项，按上面的提示处理后再继续。")
        sys.exit(1)
    print("全部通过。")


if __name__ == "__main__":
    main()

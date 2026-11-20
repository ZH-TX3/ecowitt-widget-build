#!/usr/bin/env python3
"""iOS / Android 小组件一致性检查。

约定：**iOS 是基准，Android 跟随**。改行为先改 iOS，再同步到 Android。
但"记得同步"靠人记不住，所以把能静态比对的东西都锁成检查项。

检查的都是两端必须一致的常量与能力集合：
  payload key / widget kind / schemaVersion 门禁 / 色位 / 视觉件 / 布局 / view id / 旋转语义

    uv run script/check_widget_parity.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def resolve(*candidates: str) -> Path:
    """同一份脚本要在 uni-app 仓库和 CI 镜像仓库两种布局下都能跑。"""
    for rel in candidates:
        p = ROOT / rel
        if p.exists():
            return p
    return ROOT / candidates[0]


IOS_DIR = resolve("native/ios-widget/EcowittWidget", "EcowittWidget")
IOS_PAYLOAD = IOS_DIR / "WidgetPayload.swift"
IOS_VIEW = IOS_DIR / "EcowittWidget.swift"
IOS_VIEWS = IOS_DIR / "EcowittWidgetViews.swift"
IOS_PLAN = IOS_DIR / "WidgetPlan.swift"
IOS_BRIDGE = resolve(
    "uni_modules/ecowitt-widget/utssdk/app-ios/WidgetDataBridge.swift", "app-ios/WidgetDataBridge.swift"
)
IOS_INDEX = resolve("uni_modules/ecowitt-widget/utssdk/app-ios/index.uts", "app-ios/index.uts")

AND_DIR = resolve("uni_modules/ecowitt-widget/utssdk/app-android", "app-android")
AND_KT = AND_DIR / "hybrid.kt"
AND_INDEX = AND_DIR / "index.uts"

JS_SYNC = resolve("common/js/widgetSync.js")
JS_DESIGN = resolve("common/js/widgetDesign.js")
JS_PAYLOAD = resolve("common/js/widgetPayloadV4.js")
JS_PLAN = resolve("common/js/widgetPlan.js")

AND_LAYOUT_DIR = AND_DIR / "res" / "layout"

# v4 的四个布局：三档 + 一个瓦片模板（large 用 addView 塞进去）
V4_LAYOUTS = {
    "small": "ecowitt_widget_v4_small",
    "medium": "ecowitt_widget_v4_medium",
    "large": "ecowitt_widget_v4_large",
    "tile": "ecowitt_widget_v4_tile",
}

# 14 个色位：主题基础色 5 + 模块身份色 5 + 语义状态色 4
THEME_KEYS = (
    "bg", "ink", "muted", "well", "border",
    "temp", "water", "wind", "pressure", "sun",
    "up", "down", "danger", "ok",
)

VISUAL_KINDS = ("glyph", "ring", "dial", "gauge", "uv", "bars", "sun", "battery")

# 纯结构容器：只负责撑开或分组，渲染器不需要按名字找它
STRUCTURAL_ID = re.compile(r"^w4_(?:.*_)?(?:spacer|meta_row|footer|zones|rows|axis|current)$")

# Kotlin 里靠字符串拼出来的 id（前缀 + 后缀 / 前缀 + 行列号），不可能以字面量出现
DYNAMIC_ID = re.compile(
    r"^w4_(?:"
    r"(?:small|medium|large_hero)_(?:delta|peak_max|peak_min|peak_max_ico|peak_min_ico)"
    r"|large_row\d|large_r\d c\d|large_r\dc\d"
    r"|large_hero_row\d(?:_label|_value)?"
    r"|tile_row\d(?:_label|_value)?"
    r")$"
)

ok = 0
fail = 0


def check(label: str, passed: bool, detail: str = "") -> None:
    global ok, fail
    if passed:
        ok += 1
        print(f"[PASS] {label}" + (f"  -> {detail}" if detail else ""))
    else:
        fail += 1
        print(f"[FAIL] {label}" + (f"  -> {detail}" if detail else ""))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def one(text: str, pattern: str) -> str:
    m = re.search(pattern, text)
    return m.group(1) if m else ""


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

    print("=" * 62)
    print("ios / android widget parity")
    print("=" * 62)

    for p in (IOS_PAYLOAD, IOS_VIEW, IOS_VIEWS, IOS_PLAN, IOS_BRIDGE, IOS_INDEX, AND_KT, AND_INDEX, JS_SYNC):
        check(f"source exists: {p.relative_to(ROOT) if p.is_relative_to(ROOT) else p}", p.exists())

    ios_payload = read(IOS_PAYLOAD)
    ios_view = read(IOS_VIEW)
    ios_views = read(IOS_VIEWS)
    ios_plan = read(IOS_PLAN)
    ios_bridge = read(IOS_BRIDGE)
    ios_index = read(IOS_INDEX)
    and_kt = read(AND_KT)
    and_index = read(AND_INDEX)
    js = read(JS_SYNC)
    js_design = read(JS_DESIGN)
    js_payload = read(JS_PAYLOAD)
    js_plan = read(JS_PLAN)

    # 1. payload key 前缀：两端必须一致，否则同一个 App Group / SharedPreferences 里读不到对方的数据
    ios_prefix = one(ios_bridge, r'payloadKeyPrefix\s*=\s*"([^"]+)"')
    and_prefix = one(and_kt, r'(?:payloadKeyPrefix|PAYLOAD_KEY_PREFIX)\s*=\s*"([^"]+)"')
    check("payloadKeyPrefix", bool(ios_prefix) and ios_prefix == and_prefix,
          f"ios={ios_prefix or '<none>'} android={and_prefix or '<none>'}")

    # 2. widget kind：JS 传参、iOS 默认、Android 默认三处一致
    ios_kind = one(ios_payload, r'widgetKind\s*=\s*"([^"]+)"') or one(ios_index, r"DEFAULT_WIDGET_KIND\s*=\s*'([^']+)'")
    and_kind = one(and_index, r"DEFAULT_WIDGET_KIND\s*=\s*'([^']+)'")
    js_kind = one(js, r"WIDGET_KIND\s*=\s*'([^']+)'")
    check("widget kind", len({v for v in (ios_kind, and_kind, js_kind) if v}) == 1,
          f"ios={ios_kind} android={and_kind} js={js_kind}")

    # 3. v2 已完全退役：两端都不该再有插槽式 block 的结构
    check(
        "v2 render path removed",
        "LegacyBlocksView" not in ios_view and "EcowittWidgetV3" not in and_kt,
        f"ios.LegacyBlocksView={'LegacyBlocksView' in ios_view}",
    )

    # 4. schemaVersion 门禁：两端必须一样，否则同一份数据会出现
    #    「iOS 当 v4 渲染、Android 不渲染」的错位
    ios_gate = one(ios_payload, r'supportedSchemaVersion\s*=\s*(\d+)')
    and_gate = one(and_kt, r'const val SCHEMA\s*=\s*(\d+)')
    js_gate = one(js_payload, r'WIDGET_SCHEMA_V4\s*=\s*(\d+)')
    gates = {v for v in (ios_gate, and_gate, js_gate) if v}
    check("schemaVersion gate", len(gates) == 1 and "4" in gates,
          f"ios={ios_gate} android={and_gate} js={js_gate}")

    # 5. 14 个色位：少一个键就会有一端不上色
    ios_theme = {k for k in THEME_KEYS if "var " + k in ios_payload}
    and_theme = {k for k in THEME_KEYS if '"' + k + '"' in and_kt}
    js_theme = {k for k in THEME_KEYS if k + ":" in js_design}
    check("theme slots", ios_theme == and_theme == js_theme == set(THEME_KEYS),
          f"ios缺={sorted(set(THEME_KEYS) - ios_theme)} android缺={sorted(set(THEME_KEYS) - and_theme)}")

    # 6. 视觉件：8 种 kind 两端都要有分支，少一个就会出现「iOS 有图、安卓空白」
    ios_kinds = {k for k in VISUAL_KINDS if 'case "' + k + '"' in ios_views}
    and_kinds = {k for k in VISUAL_KINDS if '"' + k + '" ->' in and_kt}
    check("visual kinds", ios_kinds == and_kinds == set(VISUAL_KINDS),
          f"ios={sorted(ios_kinds)} android={sorted(and_kinds)}")

    # 7. 布局齐全：Android 少一个布局，那一档就不渲染
    and_layouts = {p.stem for p in AND_LAYOUT_DIR.glob("*.xml")} if AND_LAYOUT_DIR.is_dir() else set()
    missing_layouts = [name for name in V4_LAYOUTS.values() if name not in and_layouts]
    check("v4 layouts (android)", not missing_layouts,
          f"缺失={missing_layouts}" if missing_layouts else f"{len(V4_LAYOUTS)} 套齐全")

    # 8. 视觉件尺寸：两端都从 payload 的 shape.viz / shape.vizXs 取，不许写死
    check("viz size from payload (ios)", "shape.viz" in ios_payload and "vizXs" in ios_payload,
          "shape.viz / vizXs")
    check("viz size from payload (android)", "shape.viz" in and_kt and "vizXs" in and_kt,
          "shape.viz / vizXs")

    # 8.5 外边距：两端都从 shape.inset 取（iOS=0 用系统边距，Android=12 自己加）
    check("inset token from payload (ios)", "shape.inset" in ios_payload, "shape.inset.ios")
    check("inset token from payload (android)", "shape.inset" in and_kt, "shape.inset.android")

    # 8.6 medium 左栏占比：iOS 读 payload，Android 写死在 XML，两者必须一致
    js_split = one(js_design, r'mediumLeft:\s*(\d+)')
    media_xml = read(AND_LAYOUT_DIR / "ecowitt_widget_v4_medium.xml")
    # 布局里还有 weight=1 的占位符，所以要在全部权重里找这一对（n / 100-n）
    weights = re.findall(r'android:layout_weight="(\d+)"', media_xml)
    pair_ok = bool(js_split) and js_split in weights and str(100 - int(js_split or 0)) in weights
    check("medium split in sync (js token vs android weight)", pair_ok,
          f"js={js_split} android 权重={','.join(weights)}")

    # 9. 布局预算：两端都要读 payload 的 shape.plan（iOS 实测后夹住，Android 直接用）
    check("plan budget from payload (ios)", "shape.plan" in ios_payload, "shape.plan")
    check("plan budget from payload (android)", "shape.plan" in and_kt, "shape.plan")
    check("plan algorithm has three implementations",
          "planLarge" in js_plan and "LargeLayout" in ios_plan and "planFor" in and_kt,
          "js / swift / kotlin")

    # 10. 图标：两端都从 payload 的 icons 取路径（不再各自查表）
    check("icons from payload (ios)", '"icons"' in ios_payload, 'icons')
    check("icons from payload (android)", '"icons"' in and_kt, 'icons')

    # 11. 风向：两端都按真实角度连续旋转，且都遵循气象惯例 +180
    check("wind rotation used on ios", "rotationEffect" in ios_views, ".rotationEffect")
    check("wind bearing flipped (ios)", "bearing" in ios_views, "bearing")
    check("wind bearing flipped (android)", "+ 180f" in and_kt, "bearing + 180f")

    # 12. 时间范围：v4 砍掉了 1H/6H/24H/7D，两端都不该再有范围字段
    check("no range switching", "rangeHours" not in ios_views and "rangeHours" not in and_kt
          and "rangeHours" not in js_payload, "固定 24 小时窗口")

    # 13. 模块 / 读数模型：两端都按 modules → readings 取值
    check("modules model (ios)", "modules" in ios_payload and "readings" in ios_payload, "modules/readings")
    check("modules model (android)", "modules" in and_kt and "readings" in and_kt, "modules/readings")

    # 14. 平台门控：JS 必须同时放行两端
    check("js allows both platforms",
          "isIosApp()" in js and "isAndroidApp()" in js and "isCanCallPlugin" not in js,
          "isIosApp / isAndroidApp")

    # 15. Android 的 id 是运行时 getIdentifier 取的，拼错既不会编译报错也不会资源报错，
    #     表现就是那一块永远空白。这里把布局里声明的 w4_* 和 Kotlin 里用到的对一遍。
    declared_ids = set()
    for path in sorted(AND_LAYOUT_DIR.glob("*.xml")):
        declared_ids |= set(re.findall(r"@\+id/([A-Za-z0-9_]+)", read(path)))
    referenced = {name for name in re.findall(r'"(w4_[a-z0-9_]+)"', and_kt)}
    # 拼接前缀本身不是 id（如 "w4_tile_row" + i）
    referenced = {n for n in referenced if not n.endswith("_")}
    unused = sorted(
        n for n in declared_ids
        if n.startswith("w4_") and n not in referenced
        and not DYNAMIC_ID.match(n) and not STRUCTURAL_ID.match(n)
    )
    check("v4 widget ids (android)", not unused,
          f"布局里有、Kotlin 没用到={unused}" if unused else f"{len(declared_ids)} 个 id 全部有着落")

    print("-" * 62)
    print(f"PASS {ok}  FAIL {fail}")
    if fail:
        print("两端不一致。按约定先改 iOS，再把同样的改动同步到 Android。")
        sys.exit(1)
    print("两端一致。")


if __name__ == "__main__":
    main()

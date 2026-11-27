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


WIDGET_DIR = resolve("native/ios-widget", ".")
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
APPEX_DIR = resolve("uni_modules/ecowitt-widget/utssdk/app-ios/Plugins", "app-ios/Plugins")
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


def info(msg: str) -> None:
    """不计分的说明行：用于「平台限制、不是欠债」这类必须看到但不算失败的项。"""
    print(f"[INFO] {msg}")


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

    # 8.7 medium 左栏宽度上限：**只有 Android 读**。
    #   RemoteViews 的 TextView 必须自己 setMaxWidth 兜底；iOS 一给自己套上限，
    #   HStack 的自动分配就变成「定宽框」→ 框宽了中间空一片、框窄了字被压小。
    #   large 的 hero 从来没这问题，就因为它左栏什么都不套。
    check("medium left max is android-only",
          "mediumLeftMax" in and_kt and "mediumLeftMax" not in ios_payload,
          "shape.mediumLeftMax 只在 Android 侧读")

    # 8.75 文案原样渲染：模块名 / 读数名现在都由后端给（dashboard 信封的 title），
    #   payload 里是什么就画什么。原生自己再 uppercased 一层，等于在契约外面
    #   偷偷改了文案 —— 中文看不出来，拉丁字母的后端名字会被改形。
    #   真要全大写，应该是 payload 发一个 token，不是原生写死。
    check("module label rendered as-is (ios)",
          "label.uppercased" not in ios_views,
          "不做大小写变换")
    check("module label rendered as-is (android)",
          "label.uppercase" not in and_kt,
          "不做大小写变换")

    # 8.8 全局字号系数：两端都要读 payload 的 fontScale    check("font scale from payload (ios)", "fontScale" in ios_payload, "fontScale")
    check("font scale from payload (android)", "fontScale" in and_kt, "fontScale")

    # 8.81 「半通字段」守卫：payload 下发了、某一端却写死 —— 改 token 只会改一端，而且没人会红。
    #   chipSize 就是这么漏的：payload 有、iOS 读、Android 零引用（值恰好相等，肉眼看不出来）。
    #   检查方式：**按词边界**匹配该端源码（`cardGap` 不能靠 `cardGapLarge` 蒙过去），
    #   先剥掉 // 注释 —— 注释里提到不算读到。
    and_code = "\n".join(line.split("//")[0] for line in and_kt.split("\n"))

    def read_by_both(key: str) -> tuple[bool, bool]:
        pattern = re.compile(rf"\b{re.escape(key)}\b")
        return bool(pattern.search(ios_payload) or pattern.search(ios_views)), bool(pattern.search(and_code))

    # RemoteViews 真的做不到的（不是欠债，是能力边界）：不静默放行，逐条打 INFO 说明，
    # 免得以后有人以为这些字段已经通了。
    REMOTEVIEWS_LOCKED = {
        "cardRadius": "drawable 里的圆角，运行时改不了（只能换预置的四套资源）",
        "wellRadius": "同上",
        "cardGap": "XML layout_margin，RemoteViews 不支持运行时改单边间距（cardGapLarge 已进 plan 预算，不算锁死）",
    }
    for key, why in REMOTEVIEWS_LOCKED.items():
        info(f"shape.{key} 受 RemoteViews 限制：{why}")

    SHARED_SHAPE_KEYS = (
        "cardPadding", "cardGapLarge", "chipSize", "chipRadius",
        "heroCap", "tileMin", "heroMin", "budget",
    )
    for key in SHARED_SHAPE_KEYS:
        ios_read, and_read = read_by_both(key)
        check(f"shape.{key} read by both ends", ios_read and and_read,
              f"iOS={ios_read} Android={and_read} —— 一端写死就是半通字段")

    # 8.82 曲线几何 / 字缩系数：可调项不许写死在原生（曲线是视觉主体，改 1pt 就重打基座不可接受）
    for key in ("chart", "textShrink", "gridRatios", "dotR", "padRatio", "minPoints"):
        ios_read, and_read = read_by_both(key)
        check(f"shape.{key} read by both ends", ios_read and and_read,
              f"iOS={ios_read} Android={and_read}")
    for key in ("tileValue",):
        check(f"shape.textShrink.{key} read by both ends",
              key in ios_views and key in and_code, "字缩系数")

    # 8.84 medium 左栏密度：挤的时候让谁让位（这是 medium 挤不挤的直接旋钮，必须两端都能热调）
    check("medium density switches read by both ends",
          "peaks" in ios_views and "peaks" in and_code, "shape.detail.medium.peaks")
    check("meta row shrinks instead of truncating (both ends)",
          "textShrink.meta" in ios_views and '"meta"' in and_code,
          "textShrink.meta —— 极值行先缩再截断")
    # 画布：iOS 由系统给尺寸，不需要；Android 与预览都必须读 payload 的那一份
    check("canvas from payload (android)", "canvas" in and_code, "canvas.{small,medium,large}")
    preview = read(resolve("components/ecowitt-widget-preview/ecowitt-widget-preview.vue"))
    check("canvas from payload (preview)", "canvas" in preview or "WIDGET_CANVAS" in preview,
          "预览的画布尺寸")
    # 预览的字号必须**逐节点**挂 inline：nvue 不继承样式，H5 下 <text> 里再嵌 <text>/纯文本时
    #   外层 style 也可能被丢 → 挂容器上实测无效（次要数据行就是这么「看着好大」的）。
    check("preview text nodes carry explicit font-size",
          ':style="{ opacity' not in preview,
          "每个 <text> 都走 textStyle()/valueStyle()，不许只给 opacity 靠继承")
    check("preview secondary rows are not nested texts",
          '<text v-if="module.compact">' not in preview and '<text v-if="reading.attach">' not in preview,
          "不要用外层 <text> 包内层 <text>，拆成并列的两个 <text>")

    # 8.82b 每模块主读数（selection.featured）：两端都必须读，否则只有一端认配置
    check("featured reading per module read by both ends",
          "featured" in ios_payload and "featured" in and_code,
          "selection.featured —— large 里每个模块显示哪条读数")

    # 8.83 孤儿字段守卫：payload 里发了但谁都不读（白养 + 误导后来的自己）
    #   zoneGap：两端实际都读 cardGapLarge，发两份就是两份真相
    check("no orphan field: plan.zoneGap", "zoneGap:" not in js_payload, "别把 zoneGap 派发进 payload")
    check("no orphan field: mediumLeftMode", "mediumLeftMode" not in js_payload, "左栏模式旋钮已删")

    # 8.9 SwiftUI 两栏布局：把已踩过的坑锁成静态规则
    #   medium 与 large·hero 是同一结构（左数值栏 + 右曲线栏），规则只有一条：
    #   左栏**什么都不套**，曲线栏显式 maxWidth: .infinity 吃剩余。
    #   给左栏套定宽框（frame(width:) / frame(maxWidth:) / fixedSize / 正的 layoutPriority）
    #   就等于「框宽了中间空一片、框窄了字被压小」——medium 在这上面栽过两次。
    # 只看代码，忽略 // 注释（注释里会提到这些写法）
    ios_code = "\n".join(line.split("//")[0] for line in ios_views.split("\n"))
    check(
        "no fixed-width frame in widget views",
        "frame(width: geo.size.width" not in ios_code,
        "两栏必须用 maxWidth 提议宽度，不能用 .frame(width:)",
    )
    # fixedSize 只允许用来「取自然宽度」（行尾写 `允许 fixedSize` 标注）：
    #   它曾和 frame(maxWidth:) 一起把左栏套成定宽框（框窄压字、框宽留白）。
    #   单独用在内容上是对的 —— 保证列宽 = 最宽那一行，不被别的行压窄。
    # 注意这里扫**原始文本**（含注释）：标注就写在行尾注释里
    bad_fixed = [
        line for line in ios_views.split("\n")
        if "fixedSize(horizontal: true" in line and "允许" not in line
    ]
    check(
        "no fixedSize on two-column rows",
        not bad_fixed,
        "取自然宽度要标 `允许 fixedSize`，其余一律交给 HStack 分配",
    )
    # 只禁「把优先级调高」的用法：负优先级（让某段文字先让位）是正当的
    check(
        "no layoutPriority on capped columns",
        re.search(r"layoutPriority\([^-)]", ios_code) is None,
        "不要用正的 layoutPriority 撑左栏",
    )
    check(
        "chart columns fill remaining width",
        ios_views.count(".frame(maxWidth: .infinity, alignment: .leading)") >= 2,
        "medium 与 hero 的曲线栏都要显式吃掉剩余宽度",
    )

    # 8.85 明细行策略：两端都要读 payload 的 shape.detail
    check("detail rows from payload (ios)", "shape.detail" in ios_payload, "shape.detail")
    check("detail rows from payload (android)", "shape.detail" in and_kt, "shape.detail")

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

    # 9. iOS appex 新鲜度：产物比源码旧 = 打基座用的还是上一版。
    #    这是真踩过的坑：改了 Swift 忘了重编，打出来的基座里 uppercased / 跳转全是旧的，
    #    表现就像「改完没生效」，排查半天才发现产物是两天前的。
    #    appex 不在 git 里（只有 README），新克隆没有产物时跳过。
    appex_bin = APPEX_DIR / "EcowittWidget.appex" / "EcowittWidget"
    if appex_bin.exists():
        # 只比 Swift 源码：project.yml 是构建脚本自己会在结尾改写的（版本号），
        # 拿它比会永远「落后 100ms」，变成常驻误报。
        sources = sorted(IOS_DIR.glob("*.swift"))
        newest = max((f.stat().st_mtime for f in sources if f.exists()), default=0)
        stale = appex_bin.stat().st_mtime < newest
        check("ios appex 比源码新", not stale,
              "产物落后于源码，先跑 npm run widget:build:test 再打基座" if stale else "appex 已是最新")
    else:
        print("[INFO] 没有 appex 产物（未构建），跳过新鲜度检查 -> npm run widget:build:test")

    print("-" * 62)
    print(f"PASS {ok}  FAIL {fail}")
    if fail:
        print("两端不一致。按约定先改 iOS，再把同样的改动同步到 Android。")
        sys.exit(1)
    print("两端一致。")


if __name__ == "__main__":
    main()

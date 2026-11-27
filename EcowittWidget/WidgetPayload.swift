//
//  WidgetPayload.swift
//  EcowittWidget
//
//  payload v4 数据契约：模块 / 读数驱动。
//
//  设计约束（重要，改动前先读 DESIGN-SPEC-v4.md 第 4 节）：
//  1. 字段全部可缺省，缺了就用兜底值，绝不 crash —— 旧 App + 新扩展也可能出现。
//  2. 不认识的 visual.kind 直接不画，不猜、不崩。
//  3. 文案、单位、数值、颜色、字号、图标路径**全部**来自 payload。
//     扩展只负责摆位，不做换算、不做翻译 —— 所以改这些不用重编 .appex。
//
//  唯一需要重编的是布局骨架（EcowittWidgetViews.swift）与 planLarge（WidgetPlan.swift）。
//

import Foundation
import SwiftUI
import WidgetKit  // WidgetFamily 定义在这里

enum WidgetStore {
    /// App Group 优先从扩展的 Info.plist 读（云打包时由 nativeResources/ios/ios-extension.json
    /// 的 plists 字段注入），读不到才退回下面的兜底值。
    static let fallbackAppGroup = "group.com.ost.ecowitt"

    static var appGroup: String {
        (Bundle.main.object(forInfoDictionaryKey: "EcowittAppGroup") as? String) ?? fallbackAppGroup
    }

    /// key 前缀，与 uts 插件 WidgetDataBridge.swift 中的同名常量必须一致。
    /// 真正的 key = 前缀 + 主 App Bundle ID 转义，所以两个环境共用 App Group 也不会串数据。
    static let payloadKeyPrefix = "widget_payload__"
    static let extensionSuffix = ".widget"

    static var mainAppBundleId: String {
        let id = Bundle.main.bundleIdentifier ?? ""
        guard id.hasSuffix(extensionSuffix) else { return id }
        return String(id.dropLast(extensionSuffix.count))
    }

    static var payloadKey: String {
        payloadKeyPrefix + mainAppBundleId.replacingOccurrences(of: ".", with: "_")
    }

    static let widgetKind = "EcowittWidget"

    /// 当前扩展能解析的最低契约版本。低于它的 payload 视为旧版，显示占位。
    static let supportedSchemaVersion = 4
}

// MARK: - 颜色

extension Color {
    /// 支持 "#RRGGBB" / "RRGGBB" / "#RRGGBBAA"
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 8, let value = UInt64(s, radix: 16) else { return nil }
        let r, g, b, a: Double
        if s.count == 8 {
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8) & 0xFF) / 255
            a = Double(value & 0xFF) / 255
        } else {
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
            a = 1
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}

// MARK: - token

/**
 颜色三类互不越界（DESIGN-SPEC-v4 第 2.4 节）：
   模块身份色 temp/water/wind/pressure/sun —— 块标题、块内图标、状态、曲线
   语义状态色 up/down/danger/ok —— 涨跌、极值、告警
   主题基础色 bg/ink/muted/well/border —— 卡底、正文、次级文字、well 块、分隔线
 */
struct WidgetPalette {
    var bg = Color(hex: "#141a23") ?? .black
    var ink = Color(hex: "#f1f5f9") ?? .white
    var muted = Color(hex: "#a3b1c3") ?? .gray
    var well = Color(hex: "#202a37") ?? .black
    var border = Color(hex: "#303e50") ?? .gray
    var temp = Color(hex: "#fb7185") ?? .pink
    var water = Color(hex: "#38bdf8") ?? .blue
    var wind = Color(hex: "#34d399") ?? .green
    var pressure = Color(hex: "#a78bfa") ?? .purple
    var sun = Color(hex: "#fbbf24") ?? .yellow
    var up = Color(hex: "#ed7839") ?? .orange
    var down = Color(hex: "#09a8e6") ?? .blue
    var danger = Color(hex: "#dd524d") ?? .red
    var ok = Color(hex: "#26d800") ?? .green

    /// 模块身份色槽位 → 颜色。认不出的槽位退回 water，绝不返回 nil。
    func accent(_ slot: String) -> Color {
        switch slot {
        case "temp": return temp
        case "water": return water
        case "wind": return wind
        case "pressure": return pressure
        case "sun": return sun
        default: return water
        }
    }
}

/**
 三档字号。payload 里是「已归一」的扁表（name/value/value-sm/unit/sub/foot/…），
 primitive 只认通用名，所以三档差异全部在 JS 侧收敛。
 */
struct WidgetTypeScale {
    var family: String = "small"
    var values: [String: CGFloat] = [:]

    func size(_ key: String, _ fallback: CGFloat) -> CGFloat {
        values[key] ?? fallback
    }

    // 通用名，兜底值按三档各自的默认
    var name: CGFloat { size("name", 10) }
    var value: CGFloat { size("value", 34) }
    var valueSmall: CGFloat { size("value-sm", 28) }
    var unit: CGFloat { size("unit", 10) }
    var sub: CGFloat { size("sub", 10) }
    var foot: CGFloat { size("foot", 8) }
    var caption: CGFloat { size("caption", 8) }
    var axis: CGFloat { size("axis", 8) }
    var state: CGFloat { size("state", 8) }
    // large 专属
    var brand: CGFloat { size("brand", 12) }
    var station: CGFloat { size("station", 10) }
    var title: CGFloat { size("title", 10) }
    var side: CGFloat { size("side", 14) }
    var wellValue: CGFloat { size("well", 22) }
    var baro: CGFloat { size("baro", 22) }
    var lower: CGFloat { size("lower", 16) }
    var detail: CGFloat { size("detail", 8) }
    var tick: CGFloat { size("tick", 6) }
}

/** 视觉件的两档尺寸：默认（small 卡 / hero）与 xs（瓦片 / medium 左栏） */
struct WidgetVizSize {
    var compass: CGFloat = 48
    var ring: CGFloat = 34
    var gauge: CGFloat = 58
    var uvbar: CGFloat = 64
    var barsH: CGFloat = 22
    var sun: CGFloat = 26
    var glyphW: CGFloat = 26
    var glyphH: CGFloat = 26
    var batteryH: CGFloat = 12
}

/**
 形状与布局。视觉件尺寸属于「形状」不属于字号；layout 是块内边距与视觉件内部几何。
 全部取偶 —— 奇数在 @2x/@3x 会落到半像素。
 */
struct WidgetShape {
    var cardRadius: CGFloat = 24
    var cardPadding: CGFloat = 12
    var cardGap: CGFloat = 4
    var cardGapLarge: CGFloat = 6
    var wellRadius: CGFloat = 14
    var chipSize: CGFloat = 22
    var chipRadius: CGFloat = 6
    var viz = WidgetVizSize()
    var vizXs = WidgetVizSize(compass: 26, ring: 20, gauge: 30, uvbar: 40, barsH: 14, sun: 16, glyphW: 14, glyphH: 14, batteryH: 10)
    // 布局类：块内边距 / 行间距 / 视觉件内部尺寸
    var tilePad: CGFloat = 8
    var tilePadTight: CGFloat = 6
    var lineGap: CGFloat = 2
    var blockGap: CGFloat = 4
    var ringInset: CGFloat = 4
    var cellW: CGFloat = 2
    var cellGap: CGFloat = 2
    var ringIco: CGFloat = 14
    var ringIcoXs: CGFloat = 8
    /// 卡片自己的外边距。iOS 交给系统的 16pt content margin，所以默认 0（payload 可覆盖）
    var insetIos: CGFloat = 0
    /// UV 光谱条是物理刻度色，不随主题变，属于形状常量
    var uvScale: [Color] = [
        Color(hex: "#19996f") ?? .green,
        Color(hex: "#d7a212") ?? .yellow,
        Color(hex: "#db7821") ?? .orange,
        Color(hex: "#d34a57") ?? .red,
        Color(hex: "#9751b7") ?? .purple
    ]
    // 间距刻度 --sp-1..6 = 2/4/6/8/10/12
    func sp(_ step: Int) -> CGFloat { CGFloat(min(6, max(1, step)) * 2) }
}

/**
 曲线几何（payload 的 shape.chart）。网格位置、线宽、圆点半径、采样区留白、
 值域取景、最少点数全部由 payload 决定 —— 这些都属于「能调的值」，原生只留画法。
 */
struct WidgetChart {
    /// 两条网格线的 y 位置，占可视高度的比例（0–1）
    var gridRatios: [CGFloat] = [20.0 / 76.0, 48.0 / 76.0]
    /// 曲线线宽
    var lineW: CGFloat = 2
    /// 网格线宽
    var gridW: CGFloat = 0.5
    /// 曲线末端圆点半径
    var dotR: CGFloat = 2.6
    /// 网格虚线节奏 [实, 虚]；空数组 = 实线
    var dash: [CGFloat] = [2, 4]
    /// 采样区左右留白（px）
    var padX: CGFloat = 4
    /// 采样区上下留白（px）
    var padY: CGFloat = 8
    /// 值域取景：上下各留 padRatio 的跨度
    var padRatio: CGFloat = 0.18
    /// 最少留 minPad 个单位，免得平线贴边
    var minPad: CGFloat = 0.6
    /// 少于这么多点就走空图分支
    var minPoints: Int = 2
}

/// 字缩系数（payload 的 shape.textShrink），对应 SwiftUI 的 minimumScaleFactor，1 = 不缩
struct WidgetTextShrink {
    var value: CGFloat = 0.55
    var tileValue: CGFloat = 0.6
    var attach: CGFloat = 0.8
    var footer: CGFloat = 0.8
    /// 变化量 + 极值那行（medium 左栏最挤的一行）
    var meta: CGFloat = 0.8
}

// MARK: - 数据模型

/** 一条明细读数：label 左、值右 */
struct WidgetRow {
    var label = ""
    var value = ""
    var unit = ""
}

/** 变化量：方向 + -1 / 0 / 1，值为已格式化字符串 */
struct WidgetDelta {
    var dir = 0
    var value = ""
}

/** 极值：只允许 max，或 max + min */
struct WidgetPeak {
    var maxValue = ""
    var maxTime = ""
    var minValue: String?
    var minTime = ""
}

/** 视觉签名，8 种 kind（DESIGN-SPEC-v4 第 6 节） */
struct WidgetVisual {
    var kind = ""
    var icon = ""
    /// ring 的填充比例 0–100
    var fill: Double = 0
    /// dial 的朝向（已 +180°，直接当旋转角用）
    var bearing: Double = 0
    /// gauge 的指针位置 0–1
    var ratio: Double = -1
    /// uv 的刻度位置 0–100
    var pos: Double = 0
    /// bars 的柱高（自动归一化）
    var values: [Double] = []
    /// battery 的满格数 0–5
    var level: Int = 0
    /// 小卡是否画签名。默认 false：小卡最紧、头部已有 chip，只有显式声明 true 才画
    var inSmall = false
    /// 瓦片里不画（长度不够）
    var inline = true
}

/** 一条可突出读数。变化量 / 极值 / 附带项都属于读数，不属于模块 */
struct WidgetReading {
    var key = ""
    var label = ""
    var value = "—"
    var unit = ""
    var accent = "water"
    /// 四位数值（气压、CO₂）降一档字
    var small = false
    var visual: WidgetVisual?
    var delta: WidgetDelta?
    var peak: WidgetPeak?
    /// 状态槽：有值时显示状态（Raining），没值就留空
    var stateSlot = false
    var state = ""
    /// 一整句替代「另一条读数」（风：From SW · Gust 26.3）
    var attachText = ""
    var attach: WidgetRow?
    /// 瓦片/hero 的明细行：同模块其它维度优先，再补模块 rows
    var lines: [WidgetRow] = []
}

/** 一个传感器模块 */
struct WidgetModule {
    var key = ""
    var label = ""
    var icon = "temperature"
    var accent = "temp"
    /// 趋势 [[时间戳 ms, 数值], ...]，nil 走空图分支
    var series: [(t: Double, v: Double)] = []
    var compact = ""
    var compactLabel = ""
    var rows: [WidgetRow] = []
    var readings: [WidgetReading] = []
}

// MARK: - payload

/**
 不走强类型 JSONDecoder，直接把原始字典留着按路径取值。

 原因：文案、单位、开关这类东西要能随时在 App 侧增删而不用改扩展，
 一旦写死成 struct，每加一个字段就得重编 .appex。路径取值 + 兜底值保证字段缺了也绝不 crash。
 */
struct WidgetPayloadV4 {
    let raw: [String: Any]

    /// 解析结果缓存：body 一次渲染会多次读 modules / icons，别每帧重新解 JSON。
    /// 用引用类型做缓存，所以 `let` 的 payload 也能命中。
    private final class Cache {
        var modules: [WidgetModule]?
        var icons: [String: [String]]?
    }
    private let cache = Cache()

    init(raw: [String: Any]) {
        self.raw = raw
    }

    /// 读 App Group；schemaVersion 不是 4 时返回 nil，显示占位卡片
    static func load() -> WidgetPayloadV4? {
        // 每一步都可能返回 nil，而界面上「没数据」是同一个样子。
        // 这里把原因打出来：Console.app / log stream 过滤 EcowittWidget 就能看到是哪一步断的。
        guard let defaults = UserDefaults(suiteName: WidgetStore.appGroup) else {
            NSLog("[EcowittWidget] App Group 不可用: %@", WidgetStore.appGroup)
            return nil
        }
        guard let json = defaults.string(forKey: WidgetStore.payloadKey) else {
            NSLog("[EcowittWidget] 共享区没有数据, key=%@", WidgetStore.payloadKey)
            return nil
        }
        guard
            let data = json.data(using: .utf8),
            let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            NSLog("[EcowittWidget] JSON 解析失败, %d 字节（开头: %@）", json.count, String(json.prefix(80)))
            return nil
        }
        let version = raw["schemaVersion"] as? Int ?? -1
        guard version >= WidgetStore.supportedSchemaVersion else {
            NSLog("[EcowittWidget] schemaVersion=%d < %d，显示占位。App 侧发的还是旧契约",
                   version, WidgetStore.supportedSchemaVersion)
            return nil
        }
        let moduleCount = (raw["modules"] as? [Any])?.count ?? 0
        NSLog("[EcowittWidget] payload ok: v%d, %d 字节, %d 个模块, feature=%@",
               version, json.count, moduleCount, raw["selection"] == nil ? "-" : "有")
        return WidgetPayloadV4(raw: raw)
    }

    static let placeholder = WidgetPayloadV4(raw: Mock.placeholder)

    private enum Mock {
        static let reading: [String: Any] = [
            "key": "temperature", "label": "Temperature", "value": "--", "unit": "°C",
            "accent": "temp", "visual": ["kind": "glyph", "icon": "temperature"],
            "attach": ["label": "Humidity", "value": "--", "unit": "%"],
            "lines": [["label": "Dew point", "value": "--", "unit": "°C"]]
        ]
        static let module: [String: Any] = [
            "key": "outdoor", "label": "Outdoor", "icon": "temperature", "accent": "temp",
            "series": [], "rows": [[String: Any]](), "readings": [reading]
        ]
        static let placeholder: [String: Any] = [
            "schemaVersion": 4,
            "appearance": "dark",
            "station": "Weather Station",
            "brand": "ecowitt",
            "updated": "--",
            "updatedShort": "--:--",
            "status": ["text": "", "tone": "ok"],
            "selection": ["feature": "outdoor.temperature", "hero": "outdoor"],
            "axis": ["", "", ""],
            "theme": [
                "bg": "#141a23", "ink": "#f1f5f9", "muted": "#a3b1c3",
                "well": "#202a37", "border": "#303e50",
                "temp": "#fb7185", "water": "#38bdf8", "wind": "#34d399",
                "pressure": "#a78bfa", "sun": "#fbbf24",
                "up": "#ed7839", "down": "#09a8e6", "danger": "#dd524d", "ok": "#26d800"
            ],
            "modules": [module]
        ]
    }

    // MARK: 路径取值

    private func node(_ path: String) -> Any? {
        var current: Any? = raw
        for part in path.split(separator: ".") {
            guard let dict = current as? [String: Any] else { return nil }
            current = dict[String(part)]
        }
        return current
    }

    func str(_ path: String, _ fallback: String = "") -> String {
        if let s = node(path) as? String, !s.isEmpty { return s }
        if let n = node(path) as? NSNumber { return n.stringValue }
        return fallback
    }

    func dbl(_ path: String, _ fallback: Double = 0) -> Double {
        if let d = node(path) as? Double { return d }
        if let i = node(path) as? Int { return Double(i) }
        if let n = node(path) as? NSNumber { return n.doubleValue }
        if let s = node(path) as? String, let d = Double(s) { return d }
        return fallback
    }

    func int(_ path: String, _ fallback: Int = 0) -> Int {
        let v = dbl(path, Double(fallback))
        // NaN / inf 直接转 Int 会 trap，和「字段缺了也绝不 crash」的契约冲突
        guard v.isFinite else { return fallback }
        return Int(v)
    }

    func bool(_ path: String, _ fallback: Bool = false) -> Bool {
        if let b = node(path) as? Bool { return b }
        if let n = node(path) as? NSNumber { return n.boolValue }
        return fallback
    }

    private func dict(_ path: String) -> [String: Any] {
        (node(path) as? [String: Any]) ?? [:]
    }

    private func array(_ path: String) -> [Any] {
        (node(path) as? [Any]) ?? []
    }

    // MARK: token

    var appearance: String { str("appearance", "dark") }

    var theme: WidgetPalette {
        let d = dict("theme")
        func color(_ key: String, _ fallback: String) -> Color {
            let hex = (d[key] as? String) ?? fallback
            return Color(hex: hex) ?? Color(hex: fallback) ?? .gray
        }
        return WidgetPalette(
            bg: color("bg", "#141a23"),
            ink: color("ink", "#f1f5f9"),
            muted: color("muted", "#a3b1c3"),
            well: color("well", "#202a37"),
            border: color("border", "#303e50"),
            temp: color("temp", "#fb7185"),
            water: color("water", "#38bdf8"),
            wind: color("wind", "#34d399"),
            pressure: color("pressure", "#a78bfa"),
            sun: color("sun", "#fbbf24"),
            up: color("up", "#ed7839"),
            down: color("down", "#09a8e6"),
            danger: color("danger", "#dd524d"),
            ok: color("ok", "#26d800")
        )
    }

    /// 全局字号系数（occupancy 紧张时整卡缩字），默认 1
    var fontScale: CGFloat {
        let v = dbl("fontScale", 1)
        return v > 0.5 && v <= 2 ? CGFloat(v) : 1
    }

    /// 三档归一后的字号表，按 WidgetFamily 取；统一乘上全局系数
    func type(_ family: String) -> WidgetTypeScale {
        let d = dict("typography.\(family)")
        let scale = fontScale
        var values: [String: CGFloat] = [:]
        d.forEach { key, value in
            if let n = value as? NSNumber { values[key] = CGFloat(n.doubleValue) * scale }
        }
        return WidgetTypeScale(family: family, values: values)
    }

    var shape: WidgetShape {
        var s = WidgetShape()
        let n = { (path: String, fallback: CGFloat) -> CGFloat in
            let v = self.dbl(path, Double(fallback))
            return v > 0 ? CGFloat(v) : fallback
        }
        s.cardRadius = n("shape.cardRadius", 24)
        s.cardPadding = n("shape.cardPadding", 12)
        s.cardGap = n("shape.cardGap", 4)
        s.cardGapLarge = n("shape.cardGapLarge", 6)
        s.wellRadius = n("shape.wellRadius", 14)
        s.chipSize = n("shape.chipSize", 22)
        s.chipRadius = n("shape.chipRadius", 6)
        s.viz = WidgetVizSize(
            compass: n("shape.viz.compass", 48),
            ring: n("shape.viz.ring", 34),
            gauge: n("shape.viz.gauge", 58),
            uvbar: n("shape.viz.uvbar", 64),
            barsH: n("shape.viz.barsH", 22),
            sun: n("shape.viz.sun", 26),
            glyphW: n("shape.viz.glyphW", 26),
            glyphH: n("shape.viz.glyphH", 26),
            batteryH: n("shape.viz.batteryH", 12)
        )
        s.vizXs = WidgetVizSize(
            compass: n("shape.vizXs.compass", 26),
            ring: n("shape.vizXs.ring", 20),
            gauge: n("shape.vizXs.gauge", 30),
            uvbar: n("shape.vizXs.uvbar", 40),
            barsH: n("shape.vizXs.barsH", 14),
            sun: n("shape.vizXs.sun", 16),
            glyphW: n("shape.vizXs.glyphW", 14),
            glyphH: n("shape.vizXs.glyphH", 14),
            batteryH: n("shape.vizXs.batteryH", 10)
        )
        s.tilePad = n("shape.layout.tilePad", 8)
        s.tilePadTight = n("shape.layout.tilePadTight", 6)
        s.lineGap = n("shape.layout.lineGap", 2)
        s.blockGap = n("shape.layout.blockGap", 4)
        s.ringInset = n("shape.layout.ringInset", 4)
        s.cellW = n("shape.layout.cellW", 2)
        s.cellGap = n("shape.layout.cellGap", 2)
        s.ringIco = n("shape.layout.ringIco", 14)
        s.ringIcoXs = n("shape.layout.ringIcoXs", 8)
        // medium 左栏不设宽度上限：交给 HStack 按内容分配（与 hero 同一条规则），
        // payload 里那条上限只给 Android 用（RemoteViews 的 TextView 必须自己限宽）
        // 注意这里不能用 n()：它会跳过 0，而 iOS 的合法值就是 0
        let inset = dbl("shape.inset.ios", 0)
        s.insetIos = inset >= 0 ? CGFloat(inset) : 0
        if let scale = node("shape.uvScale") as? [Any], scale.count >= 2 {
            let colors = scale.compactMap { item -> Color? in
                guard let hex = item as? String else { return nil }
                return Color(hex: hex)
            }
            if colors.count >= 2 { s.uvScale = colors }
        }
        return s
    }

    // MARK: 曲线几何 / 字缩系数

    /// 必须为正的数值：非正数、NaN、inf 一律回落默认，否则会画出倒置网格或 NaN 坐标
    private func positive(_ dict: [String: Any], _ key: String, _ fallback: CGFloat, max cap: CGFloat = 512) -> CGFloat {
        guard let v = (dict[key] as? NSNumber)?.doubleValue, v.isFinite, v > 0 else { return fallback }
        return CGFloat(min(v, Double(cap)))
    }

    /// 允许 0 的数值：留白 / 比例 / 最小跨度这几类，0 是合法取值
    private func nonNegative(_ dict: [String: Any], _ key: String, _ fallback: CGFloat, max cap: CGFloat) -> CGFloat {
        guard let v = (dict[key] as? NSNumber)?.doubleValue, v.isFinite, v >= 0 else { return fallback }
        return CGFloat(min(v, Double(cap)))
    }

    var chart: WidgetChart {
        var c = WidgetChart()
        let d = dict("shape.chart")
        guard !d.isEmpty else { return c }
        c.lineW = positive(d, "lineW", c.lineW, max: 16)
        c.gridW = positive(d, "gridW", c.gridW, max: 16)
        c.dotR = positive(d, "dotR", c.dotR, max: 32)
        c.padX = nonNegative(d, "padX", c.padX, max: 64)
        c.padY = nonNegative(d, "padY", c.padY, max: 64)
        c.padRatio = nonNegative(d, "padRatio", c.padRatio, max: 0.5)
        c.minPad = nonNegative(d, "minPad", c.minPad, max: 64)
        // 网格线位置：长度 0–4，每条都得落在 0–1（空数组 = 不画网格线）
        if let raw = d["gridRatios"] as? [Any] {
            var ratios: [CGFloat] = []
            var ok = raw.count <= 4
            for item in raw {
                guard let v = (item as? NSNumber)?.doubleValue, v.isFinite, v >= 0, v <= 1 else { ok = false; break }
                ratios.append(CGFloat(v))
            }
            if ok { c.gridRatios = ratios }
        }
        // 虚线节奏：成对的正数（奇数长度会让 SwiftUI 把节奏错位，空数组 = 实线）
        if let raw = d["dash"] as? [Any] {
            var dash: [CGFloat] = []
            var ok = raw.count % 2 == 0
            for item in raw {
                guard let v = (item as? NSNumber)?.doubleValue, v.isFinite, v > 0 else { ok = false; break }
                dash.append(CGFloat(v))
            }
            if ok { c.dash = dash }
        }
        let points = int("shape.chart.minPoints", c.minPoints)
        c.minPoints = (points >= 1 && points <= 20) ? points : c.minPoints
        return c
    }

    var textShrink: WidgetTextShrink {
        var t = WidgetTextShrink()
        let d = dict("shape.textShrink")
        guard !d.isEmpty else { return t }
        // minimumScaleFactor 的合法域是 (0, 1]，越界回落默认
        func factor(_ key: String, _ fallback: CGFloat) -> CGFloat {
            guard let v = (d[key] as? NSNumber)?.doubleValue, v.isFinite, v > 0, v <= 1 else { return fallback }
            return CGFloat(v)
        }
        t.value = factor("value", t.value)
        t.tileValue = factor("tileValue", t.tileValue)
        t.attach = factor("attach", t.attach)
        t.footer = factor("footer", t.footer)
        t.meta = factor("meta", t.meta)
        return t
    }

    /// large 的布局预算常量（规范第 5 节），Android 用同一份
    var planBudget: CGFloat { CGFloat(dbl("shape.plan.budget", 328)) }
    var heroCap: CGFloat { CGFloat(dbl("shape.plan.heroCap", 164)) }
    var tileMin: CGFloat { CGFloat(dbl("shape.plan.tileMin", 48)) }
    var heroMin: CGFloat { CGFloat(dbl("shape.plan.heroMin", 88)) }

    /// 图标路径表：name → 若干 SVG path 的 d 字符串
    var icons: [String: [String]] {
        if let cached = cache.icons { return cached }
        var out: [String: [String]] = [:]
        dict("icons").forEach { name, value in
            if let d = value as? String, !d.isEmpty { out[name] = [d] }
        }
        cache.icons = out
        return out
    }

    // MARK: 顶层字段

    /// 明细行策略（shape.detail）：hero / 瓦片各显示几行、瓦片是否带同行摘要
    /// 兜底值必须与 JS 契约 DETAIL 一致（默认全关）—— 否则预览干净、真机多画明细行
    var detailHeroRows: Int { max(0, min(6, int("shape.detail.heroRows", 0))) }
    var detailTileRows: Int { max(0, min(4, int("shape.detail.tileRows", 0))) }
    var detailInline: Bool { bool("shape.detail.inline", false) }

    /// medium 左栏密度策略（shape.detail.medium）
    /// 默认全显示 = 设计稿原样；塞不下时由 payload 逐个关掉让位
    var detailMediumMeta: Bool { bool("shape.detail.medium.meta", true) }
    var detailMediumAttach: Bool { bool("shape.detail.medium.attach", true) }
    /// 极值留几个：'both' 最大+最小 | 'max' 只留最大 | 'none' 不留；非法值回落 'both'
    var detailMediumPeaks: String {
        let v = str("shape.detail.medium.peaks", "both")
        return ["both", "max", "none"].contains(v) ? v : "both"
    }

    var station: String { str("station", "Weather Station") }
    /// 这份数据属于哪台设备；点组件时用来拼「回首页并切设备」的链接
    var deviceId: String { str("deviceId", "") }
    var brand: String { str("brand", "ecowitt") }
    var updatedFull: String { str("updated", "--") }
    var updatedShort: String { str("updatedShort", "--:--") }
    var statusText: String { str("status.text") }
    var statusTone: String { str("status.tone", "ok") }
    var featureUid: String { str("selection.feature") }
    var heroKey: String { str("selection.hero") }

    var axisLabels: [String] {
        array("axis").map { "\($0)" }
    }

    var footerLeft: String { str("footer.left") }
    var footerRight: String { str("footer.right") }
    var emptyTitle: String { str("labels.noHistory", "Insufficient history") }
    var emptyBody: String { str("labels.noTrend", "No generated trend") }

    // MARK: 模块

    var modules: [WidgetModule] {
        if let cached = cache.modules { return cached }
        let parsed: [WidgetModule] = array("modules").compactMap { item -> WidgetModule? in
            guard let dict = item as? [String: Any] else { return nil }
            let m = WidgetModule(
                key: (dict["key"] as? String) ?? "",
                label: (dict["label"] as? String) ?? "",
                icon: (dict["icon"] as? String) ?? "temperature",
                accent: (dict["accent"] as? String) ?? "temp",
                series: Self.parseSeries(dict["series"]),
                compact: (dict["compact"] as? String) ?? "",
                compactLabel: (dict["compactLabel"] as? String) ?? "",
                rows: Self.parseRows(dict["rows"]),
                readings: Self.parseReadings(dict["readings"])
            )
            return m.readings.isEmpty ? nil : m
        }
        cache.modules = parsed
        return parsed
    }

    /// 突出项：先按 uid 找，找不到退回第一个模块的第一条读数
    func feature(in modules: [WidgetModule]) -> (module: WidgetModule, reading: WidgetReading)? {
        let uid = featureUid
        for module in modules {
            for reading in module.readings where module.key + "." + reading.key == uid {
                return (module, reading)
            }
        }
        guard let module = modules.first, let reading = module.readings.first else { return nil }
        return (module, reading)
    }

    /// selection.featured：moduleKey → readingKey。只收非空字符串对，缺字段 = 空字典
    var featuredKeys: [String: String] {
        var out: [String: String] = [:]
        dict("selection.featured").forEach { key, value in
            guard let s = value as? String else { return }
            let v = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty && !v.isEmpty { out[key] = v }
        }
        return out
    }

    /**
     large 卡里某个模块该展示哪条读数 —— 渲染处唯一入口。
     1. featured[module.key] 命中，且该模块确实有这条 reading → 用它
     2. 该模块就是 feature 所属模块 → 用 feature 那条
     3. 再否则 → module.readings[0]

     2/3 就是 feature(in:) 对单个模块的语义，所以这里只补第 1 条。
     与 Android 的 EcowittWidgetV4.featuredReading 逐字一致。
     */
    func featuredReading(for module: WidgetModule) -> WidgetReading? {
        guard !module.readings.isEmpty else { return nil }
        if let key = featuredKeys[module.key],
           let reading = module.readings.first(where: { $0.key == key }) {
            return reading
        }
        return feature(in: [module])?.reading
    }

    // MARK: 反序列化（全部容错）

    private static func parseSeries(_ value: Any?) -> [(t: Double, v: Double)] {
        guard let items = value as? [Any] else { return [] }
        return items.compactMap { item -> (t: Double, v: Double)? in
            guard let pair = item as? [Any], pair.count >= 2 else { return nil }
            let t = (pair[0] as? NSNumber)?.doubleValue ?? Double(pair[0] as? String ?? "") ?? 0
            let v = (pair[1] as? NSNumber)?.doubleValue ?? Double(pair[1] as? String ?? "") ?? 0
            return (t, v)
        }
    }

    private static func parseRows(_ value: Any?) -> [WidgetRow] {
        guard let items = value as? [Any] else { return [] }
        return items.compactMap { item in
            guard let d = item as? [String: Any] else { return nil }
            return WidgetRow(
                label: (d["label"] as? String) ?? "",
                value: (d["value"] as? String) ?? "",
                unit: (d["unit"] as? String) ?? ""
            )
        }
    }

    private static func parseVisual(_ value: Any?) -> WidgetVisual? {
        guard let d = value as? [String: Any], let kind = d["kind"] as? String, !kind.isEmpty else { return nil }
        var v = WidgetVisual(kind: kind)
        v.icon = (d["icon"] as? String) ?? ""
        v.fill = (d["fill"] as? NSNumber)?.doubleValue ?? 0
        v.bearing = (d["bearing"] as? NSNumber)?.doubleValue ?? 0
        v.ratio = (d["ratio"] as? NSNumber)?.doubleValue ?? -1
        v.pos = (d["pos"] as? NSNumber)?.doubleValue ?? 0
        v.level = (d["level"] as? NSNumber)?.intValue ?? 0
        if let bars = d["values"] as? [Any] {
            v.values = bars.compactMap { ($0 as? NSNumber)?.doubleValue }
        }
        if let flag = d["inSmall"] as? NSNumber { v.inSmall = flag.boolValue }
        if let flag = d["inline"] as? NSNumber { v.inline = flag.boolValue }
        return v
    }

    private static func parseReadings(_ value: Any?) -> [WidgetReading] {
        guard let items = value as? [Any] else { return [] }
        return items.compactMap { item in
            guard let d = item as? [String: Any] else { return nil }
            var r = WidgetReading()
            r.key = (d["key"] as? String) ?? ""
            r.label = (d["label"] as? String) ?? ""
            r.value = (d["value"] as? String) ?? "—"
            r.unit = (d["unit"] as? String) ?? ""
            r.accent = (d["accent"] as? String) ?? "water"
            r.small = (d["small"] as? NSNumber)?.boolValue ?? false
            r.visual = parseVisual(d["visual"])
            if let delta = d["delta"] as? [String: Any] {
                r.delta = WidgetDelta(
                    dir: (delta["dir"] as? NSNumber)?.intValue ?? 0,
                    value: (delta["value"] as? String) ?? ""
                )
            }
            if let peak = d["peak"] as? [String: Any] {
                var p = WidgetPeak()
                if let max = peak["max"] as? [String: Any] {
                    p.maxValue = (max["value"] as? String) ?? ""
                    p.maxTime = (max["time"] as? String) ?? ""
                }
                if let min = peak["min"] as? [String: Any] {
                    p.minValue = (min["value"] as? String)
                    p.minTime = (min["time"] as? String) ?? ""
                }
                if !p.maxValue.isEmpty { r.peak = p }
            }
            r.stateSlot = (d["stateSlot"] as? NSNumber)?.boolValue ?? false
            r.state = (d["state"] as? String) ?? ""
            r.attachText = (d["attachText"] as? String) ?? ""
            if let attach = d["attach"] as? [String: Any] {
                r.attach = WidgetRow(
                    label: (attach["label"] as? String) ?? "",
                    value: (attach["value"] as? String) ?? "",
                    unit: (attach["unit"] as? String) ?? ""
                )
            }
            r.lines = parseRows(d["lines"])
            return r
        }
    }
}

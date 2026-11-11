//
//  WidgetPayload.swift
//  EcowittWidget
//
//  数据契约 v2：插槽式。
//  主 App 通过 App Group 写入一份 JSON，这里只负责解析 + 容错，渲染逻辑在 EcowittWidget.swift。
//
//  设计约束（重要）：
//  1. 字段全部可缺省，缺了就用兜底值，绝不 crash —— 旧 App + 新扩展、新 App + 旧扩展都可能出现。
//  2. 不认识的 block 类型直接跳过，新类型由 App 侧决定要不要发，扩展侧不需要同步升级就能忽略。
//  3. 排序、显示哪些指标、每尺寸显示几条，全部由 App 侧在 JSON 里决定，这里不写业务规则。
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

    /// 当前扩展能解析的最高契约版本。App 侧发的版本更高时会降级渲染已知字段。
    static let supportedSchemaVersion = 2
}

// MARK: - 主题

struct WidgetTheme {
    var background: Color = Color(red: 0.07, green: 0.11, blue: 0.18)
    var accent: Color = Color(red: 0.29, green: 0.61, blue: 1.0)
    var text: Color = .white
    var muted: Color = Color.white.opacity(0.62)
    var panel: Color = Color.white.opacity(0.06)
    var fontScale: Double = 1.0
}

// MARK: - 区块

struct WidgetBlock: Identifiable {
    enum Kind: String {
        case hero
        case metric
        case divider
    }

    var id: String
    var kind: Kind
    var label: String
    var value: String
    var unit: String
    var icon: String
    /// 图标旋转角度，风向用；0 表示不旋转
    var rotate: Double
    /// 副文本，如风向 "NE"
    var sub: String
}

// MARK: - payload

struct WidgetPayload {
    var device: String
    var blocks: [WidgetBlock]
    /// 每个尺寸渲染多少条，由 App 侧下发；缺省按 1 / 3 / 6
    var counts: [String: Int]
    var theme: WidgetTheme
    var updatedAt: Date?

    static let placeholder = WidgetPayload(
        device: "Ecowitt",
        blocks: [
            WidgetBlock(id: "ph-hero", kind: .hero, label: "室外", value: "--", unit: "°C",
                        icon: "thermometer.medium", rotate: 0, sub: ""),
            WidgetBlock(id: "ph-hum", kind: .metric, label: "湿度", value: "--", unit: "%",
                        icon: "drop.fill", rotate: 0, sub: ""),
            WidgetBlock(id: "ph-wind", kind: .metric, label: "风", value: "--", unit: "m/s",
                        icon: "arrow.up", rotate: 0, sub: ""),
            WidgetBlock(id: "ph-rain", kind: .metric, label: "降雨", value: "--", unit: "mm",
                        icon: "cloud.rain.fill", rotate: 0, sub: "")
        ],
        counts: ["small": 1, "medium": 3, "large": 6],
        theme: WidgetTheme(),
        updatedAt: nil
    )

    /// 某个尺寸该渲染几条
    func limit(for family: WidgetFamily) -> Int {
        let fallback = ["small": 1, "medium": 3, "large": 6]
        let key = family == .systemSmall ? "small" : (family == .systemMedium ? "medium" : "large")
        let value = counts[key] ?? fallback[key] ?? 3
        return max(1, min(value, blocks.count))
    }

    /// 从 App Group 读取并解析；任何异常都退回 placeholder
    static func load() -> WidgetPayload {
        guard
            let defaults = UserDefaults(suiteName: WidgetStore.appGroup),
            let json = defaults.string(forKey: WidgetStore.payloadKey),
            let data = json.data(using: .utf8),
            let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            return .placeholder
        }
        return parse(raw)
    }

    static func parse(_ raw: [String: Any]) -> WidgetPayload {
        var payload = WidgetPayload.placeholder
        payload.device = string(raw["device"]) ?? payload.device

        if let blocks = raw["blocks"] as? [[String: Any]] {
            // schemaVersion 高于扩展支持版本时，只认已知类型，未知的按 nil 跳过
            _ = raw["schemaVersion"] as? Int ?? 1
            let parsed = blocks.compactMap { parseBlock($0) }
            if !parsed.isEmpty {
                payload.blocks = parsed
            }
        }

        if let counts = raw["counts"] as? [String: Any] {
            var map: [String: Int] = [:]
            for (k, v) in counts {
                if let n = v as? Int { map[k] = n }
                else if let n = v as? NSNumber { map[k] = n.intValue }
            }
            if !map.isEmpty { payload.counts = map }
        }

        if let theme = raw["theme"] as? [String: Any] {
            payload.theme = parseTheme(theme)
        }

        if let ts = raw["updatedAt"] as? Double {
            payload.updatedAt = Date(timeIntervalSince1970: ts)
        } else if let ts = raw["updatedAt"] as? Int {
            payload.updatedAt = Date(timeIntervalSince1970: Double(ts))
        }

        return payload
    }

    private static func parseBlock(_ dict: [String: Any]) -> WidgetBlock? {
        guard let typeRaw = string(dict["type"]), let kind = WidgetBlock.Kind(rawValue: typeRaw) else {
            return nil // 不认识的类型直接跳过，别崩
        }
        return WidgetBlock(
            id: string(dict["key"]) ?? string(dict["id"]) ?? UUID().uuidString,
            kind: kind,
            label: string(dict["label"]) ?? "",
            value: string(dict["value"]) ?? "--",
            unit: string(dict["unit"]) ?? "",
            icon: string(dict["icon"]) ?? "",
            rotate: number(dict["rotate"]) ?? 0,
            sub: string(dict["sub"]) ?? ""
        )
    }

    private static func parseTheme(_ dict: [String: Any]) -> WidgetTheme {
        var theme = WidgetTheme()
        if let v = string(dict["bg"]) { theme.background = Color(hex: v) ?? theme.background }
        if let v = string(dict["accent"]) { theme.accent = Color(hex: v) ?? theme.accent }
        if let v = string(dict["text"]) { theme.text = Color(hex: v) ?? theme.text }
        if let v = string(dict["muted"]) { theme.muted = Color(hex: v) ?? theme.muted }
        if let v = string(dict["panel"]) { theme.panel = Color(hex: v) ?? theme.panel }
        if let v = number(dict["fontScale"]), v > 0.5, v < 2.0 { theme.fontScale = v }
        return theme
    }

    private static func string(_ value: Any?) -> String? {
        if let s = value as? String, !s.isEmpty { return s }
        if let n = value as? NSNumber { return n.stringValue }
        return nil
    }

    private static func number(_ value: Any?) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let n = value as? NSNumber { return n.doubleValue }
        if let s = value as? String { return Double(s) }
        return nil
    }
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

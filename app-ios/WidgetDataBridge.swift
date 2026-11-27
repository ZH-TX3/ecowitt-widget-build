//
//  WidgetDataBridge.swift
//  uts 插件 app-ios 混编文件（名字不能叫 index.swift）
//
//  职责：把小组件要展示的数据写进 App Group 共享区，然后通知 WidgetKit 刷新时间线。
//  注意：所有方法参数都不带外部标签（全部用 _），这样 uts 侧可以按位置直接调用，
//        不用去猜 Swift 的参数标签规则。
//

import Foundation

#if canImport(WidgetKit)
import WidgetKit
#endif

public class WidgetDataBridge {

    /// key 前缀，与 native/ios-widget/EcowittWidget/WidgetPayload.swift 中的同名常量必须一致。
    /// 真正的 key 由「前缀 + 主 App Bundle ID 转义」组成，这样测试服和正式服
    /// 即使共用同一个 App Group，数据也不会互相覆盖。
    static let payloadKeyPrefix = "widget_payload__"
    static let updatedAtKeySuffix = "__updated_at"

    /// 当前 App 的 Bundle ID 转义形式，如 com.ost.ecowitt -> com_ost_ecowitt
    static var bundleKeyPart: String {
        (Bundle.main.bundleIdentifier ?? "unknown").replacingOccurrences(of: ".", with: "_")
    }

    static var payloadKey: String {
        payloadKeyPrefix + bundleKeyPart
    }

    static var updatedAtKey: String {
        payloadKey + updatedAtKeySuffix
    }

    /// 「桌面上有没有这个组件」的缓存键
    static let presenceKeySuffix = "__has_widgets"

    static var presenceKey: String {
        payloadKey + presenceKeySuffix
    }

    /// 触发一次异步查询（WidgetKit 只给 completion 回调），结果写进共享区。
    /// 首次调用可能读到上一次的缓存值，再调一次就准了。
    public static func refreshWidgetPresence(_ appGroup: String) {
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.getCurrentConfigurations { result in
                let list = (try? result.get()) ?? []
                UserDefaults(suiteName: appGroup)?.set(list.isEmpty ? "0" : "1", forKey: presenceKey)
            }
        }
        #endif
    }

    /// 桌面是否放着这个组件；没查过时返回 true（宁可多刷，也不要错误地停更）
    public static func hasWidgets(_ appGroup: String) -> Bool {
        guard let v = UserDefaults(suiteName: appGroup)?.string(forKey: presenceKey) else { return true }
        return v == "1"
    }

    /// 写入 JSON 字符串
    /// 返回 false 表示 App Group 拿不到（通常是 entitlements 没配好，或描述文件没带 App Group）
    public static func savePayloadJson(_ json: String, _ appGroup: String, _ widgetKind: String) -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            NSLog("[EcowittWidget] UserDefaults(suiteName:) 为 nil，App Group 不可用: %@", appGroup)
            return false
        }
        defaults.set(json, forKey: payloadKey)
        defaults.set(Date().timeIntervalSince1970, forKey: updatedAtKey)
        _ = defaults.synchronize()

        reloadTimelines(widgetKind)
        return true
    }

    /// 读回当前共享数据，调试用
    public static func readPayloadJson(_ appGroup: String) -> String {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            return ""
        }
        return defaults.string(forKey: payloadKey) ?? ""
    }

    /// 触发刷新
    public static func reloadTimelines(_ widgetKind: String) {
        #if canImport(WidgetKit)
        if #available(iOS 14.0, *) {
            if widgetKind.isEmpty {
                WidgetCenter.shared.reloadAllTimelines()
            } else {
                WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
            }
        }
        #endif
    }

    /// 清空共享数据（调试用）
    public static func clearPayload(_ appGroup: String) -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroup) else {
            return false
        }
        defaults.removeObject(forKey: payloadKey)
        defaults.removeObject(forKey: updatedAtKey)
        return true
    }

    // MARK: - 小组件点击 → 待跳转页

    private static let pendingNavKey = "ecowitt.pendingNav"

    /// 记录「被 URL Scheme 唤起」的目标地址（生层钩子调用，原样存，解析交给 JS）
    public static func capturePendingNavUrl(_ url: String, _ appGroup: String) -> Bool {
        guard let d = UserDefaults(suiteName: appGroup) else { return false }
        d.set(url, forKey: pendingNavKey)
        d.synchronize()
        return true
    }

    /// 读取并清空「小组件点击要跳转的页面」（由 appex 的 AppIntent 写入）
    public static func takePendingNav(_ appGroup: String) -> String {
        guard let d = UserDefaults(suiteName: appGroup) else { return "" }
        let v = d.string(forKey: pendingNavKey) ?? ""
        if !v.isEmpty {
            d.removeObject(forKey: pendingNavKey)
            d.synchronize()
        }
        return v
    }
}

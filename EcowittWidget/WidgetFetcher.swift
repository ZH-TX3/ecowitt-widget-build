//
//  WidgetFetcher.swift
//  EcowittWidget
//
//  原生自拉取：App 不在前台 / 已被杀掉时，组件自己取一份数据段。
//
//  分工（DATA-SOURCE.md §6）：
//    JS（前台） 写整份 payload：token 段 + 一次数据段 + fetch 段
//    原生（这里）只替换**数据段**，token 段原样不动
//    服务端      只返回数据段
//
//  三条铁律：
//    1. 地址、认证、间隔、超时全部从 payload.fetch 读，写死在 Swift 里等于要重打基座
//    2. 拉取失败必须用旧数据出图，绝不能返回空时间线（那会白屏）
//    3. 只覆盖 WidgetFetch.dataKeys 里的键，其它一个都不许动
//

import Foundation

enum WidgetFetch {

    /// 与 common/js/widgetFetch.js 的 WIDGET_DATA_KEYS 必须完全一致，
    /// script/check_widget_parity.py 会红着脸告诉你哪个少了一个。
    static let dataKeys = [
        "deviceId",
        "station",
        "updated",
        "updatedShort",
        "status",
        "observedAt",
        "selection",
        "modules"
    ]

    /// 拉取结果：payload 一律是「可以画的那份」（拉失败就是原来那份，绝不返回空）
    struct Outcome {
        let payload: [String: Any]
        /// 下次什么时候再来（秒，已含抖动）
        let nextSeconds: Double
    }

    private static func nextDelay(minutes: Int, fetch: [String: Any]) -> Double {
        // 抖动上限也由 JS 下发：所有组件同一分钟醒来对服务端不友好，系统也更容易限流
        let cap = clamp(intOf(fetch["jitterSeconds"], fallback: 120), 0, 600)
        return Double(clamp(minutes, 1, 240) * 60) + Double(Int.random(in: 0...cap))
    }

    /// 上次写盘时间（epoch 秒）。与 WidgetDataBridge.swift 的 updatedAtKey 同一命名，
    /// 主 App 写 payload 时也会更新它 —— 这就是「前台还在喂数据」的信号。
    private static var lastWriteKey: String {
        WidgetStore.payloadKey + "__updated_at"
    }

    /// 上次**发起网络请求**的时间（epoch 秒），用来给多实例去重。
    private static var lastFetchKey: String {
        WidgetStore.payloadKey + "__last_fetch_at"
    }

    /// 从共享区读 payload → 按 fetch 段拉一次 → 合并数据段 → 写回共享区
    static func pull(completion: @escaping (Outcome?) -> Void) {
        guard let defaults = UserDefaults(suiteName: WidgetStore.appGroup) else {
            NSLog("[EcowittWidget][fetch] App Group 不可用: %@", WidgetStore.appGroup)
            completion(nil)
            return
        }
        guard
            let json = defaults.string(forKey: WidgetStore.payloadKey),
            let data = json.data(using: .utf8),
            let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            NSLog("[EcowittWidget][fetch] 共享区没有可解析的 payload")
            completion(nil)
            return
        }
        // 与 WidgetPayloadV4.load() 同一道版本闸：旧契约的 payload 不动它，
        // 否则合并完写回去反而把 App 的写盘污染了
        let version = (raw["schemaVersion"] as? NSNumber)?.intValue ?? -1
        guard version >= WidgetStore.supportedSchemaVersion else {
            NSLog("[EcowittWidget][fetch] schemaVersion=%d 太旧，跳过", version)
            completion(nil)
            return
        }
        guard let fetch = raw["fetch"] as? [String: Any] else {
            // 老版本 App 写进来的 payload：没有 fetch 段，什么都不做
            completion(nil)
            return
        }
        let enabled = (fetch["enabled"] as? Bool) ?? false
        let interval = clamp(intOf(fetch["intervalMinutes"], fallback: 30), 15, 240)
        guard enabled else {
            NSLog("[EcowittWidget][fetch] 已关闭")
            completion(Outcome(payload: raw, nextSeconds: nextDelay(minutes: interval, fetch: fetch)))
            return
        }

        // 兜底语义：前台刚写过盘就别拉。App 在跑的时候它自己会喂数据，
        // 这时候再拉一次纯属抢活 —— 多一次请求、多一次重绘，数据还是一样的。
        // 缺省 = 间隔 - 5（与 JS 侧一致）：老 payload 没有这个字段时行为也一样
        let minAge = clamp(intOf(fetch["minAgeMinutes"], fallback: max(1, interval - 5)), 1, 240)
        // 失败后多久再来一次：也由 JS 下发，方便不发版就调
        let retry = clamp(intOf(fetch["retryMinutes"], fallback: 15), 1, 240)
        let lastWrite = defaults.double(forKey: lastWriteKey)
        if lastWrite > 0 {
            let age = Date().timeIntervalSince1970 - lastWrite
            if age < Double(minAge * 60) {
                NSLog("[EcowittWidget][fetch] 跳过：%d 秒前刚写过（阈值 %d 分钟）", Int(age), minAge)
                completion(Outcome(payload: raw, nextSeconds: nextDelay(minutes: interval, fetch: fetch)))
                return
            }
        }
        // 多实例去重：reloadTimelines 会把整个 kind 的**所有实例**都叫起来，
        // 每个实例的 getTimeline 都跑一次 pull()。不去重的话桌面放两个组件就是两倍请求
        // （实测同一秒两条、耗时 229ms / 486ms 并发）。
        // getTimeline 是主线程串行回调，所以「先写时间戳再发请求」兄弟实例就能看到。
        let sinceFetch = Date().timeIntervalSince1970 - defaults.double(forKey: lastFetchKey)
        if sinceFetch < 10 {
            NSLog("[EcowittWidget][fetch] 跳过：%.0f 秒前别的实例刚拉过", sinceFetch)
            completion(Outcome(payload: raw, nextSeconds: nextDelay(minutes: interval, fetch: fetch)))
            return
        }

        guard let url = requestURL(fetch) else {
            NSLog("[EcowittWidget][fetch] 地址无效: %@", String(describing: fetch["url"]))
            completion(Outcome(payload: raw, nextSeconds: nextDelay(minutes: retry, fetch: fetch)))
            return
        }
        // 时间戳在**发请求之前**写：并发的兄弟实例进来时才有东西可比
        defaults.set(Date().timeIntervalSince1970, forKey: lastFetchKey)

        var request = URLRequest(url: url)
        request.timeoutInterval = clampTimeout(fetch["timeoutMs"])
        request.httpMethod = "GET"
        if let header = fetch["authHeader"] as? String, !header.isEmpty,
           let value = fetch["authValue"] as? String, !value.isEmpty {
            request.setValue(value, forHTTPHeaderField: header)
        }

        let started = Date()
        // 失败一律回旧 payload + 按 retry 排下一次：绝不让时间线空手而归（白屏）
        let failed = {
            completion(Outcome(payload: raw, nextSeconds: nextDelay(minutes: retry, fetch: fetch)))
        }
        URLSession.shared.dataTask(with: request) { body, response, error in
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            if let error = error {
                NSLog("[EcowittWidget][fetch] 失败 %dms: %@", ms, error.localizedDescription)
                failed()
                return
            }
            guard let http = response as? HTTPURLResponse else {
                NSLog("[EcowittWidget][fetch] 没有 HTTP 响应")
                failed()
                return
            }
            guard http.statusCode == 200, let body = body else {
                NSLog("[EcowittWidget][fetch] HTTP %d", http.statusCode)
                failed()
                return
            }
            guard let segment = segmentOf(body) else {
                NSLog("[EcowittWidget][fetch] 响应里没有可渲染的 modules，%d 字节", body.count)
                failed()
                return
            }
            let merged = merge(raw: raw, segment: segment)
            writeBack(merged, defaults: defaults)
            NSLog("[EcowittWidget][fetch] ok %dms, modules=%d",
                  ms, (segment["modules"] as? [Any])?.count ?? 0)
            completion(Outcome(payload: merged, nextSeconds: nextDelay(minutes: interval, fetch: fetch)))
        }.resume()
    }

    // MARK: - 内部

    /// `{id}` 由原生替换。设备走 query 参数（`?device_id=`），所以按 URL 查询串的规则转义
    private static func requestURL(_ fetch: [String: Any]) -> URL? {
        guard var text = fetch["url"] as? String, !text.isEmpty else { return nil }
        let deviceId = fetch["deviceId"] as? String ?? ""
        let safe = deviceId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        text = text.replacingOccurrences(of: "{id}", with: safe)
        return URL(string: text)
    }

    /// 超时必须有上限：时间线里挂太久会被系统当卡死，卡片直接白屏
    private static func clampTimeout(_ value: Any?) -> TimeInterval {
        return TimeInterval(clamp(intOf(value, fallback: 5000), 2000, 20000)) / 1000
    }

    /// JSONSerialization 的数字统一是 NSNumber，直接 `as? Int` 会踩到桥接细节
    private static func intOf(_ value: Any?, fallback: Int) -> Int {
        if let n = value as? NSNumber { return n.intValue }
        if let d = value as? Double { return Int(d) }
        if let s = value as? String, let d = Double(s) { return Int(d) }
        return fallback
    }

    private static func clamp(_ value: Int, _ low: Int, _ high: Int) -> Int {
        return min(max(value, low), high)
    }

    /// 后端可能直接回数据段，也可能套一层 `{code, data}` —— 两种都认
    private static func segmentOf(_ body: Data) -> [String: Any]? {
        guard let root = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            return nil
        }
        if let nested = root["data"] as? [String: Any], hasModules(nested) {
            return nested
        }
        return hasModules(root) ? root : nil
    }

    /// `modules` 必须是非空数组。
    ///
    /// 空数组**不算成功**：那是「后端算不出东西」，合并进去会把桌面刷成空白。
    /// 保留旧数据永远比变空白好 —— 这条和 Android 必须一致。
    private static func hasModules(_ dict: [String: Any]) -> Bool {
        guard let list = dict["modules"] as? [Any] else { return false }
        return !list.isEmpty
    }

    /// 只覆盖白名单，不做深合并 —— 深合并是 bug 温床（§6.3）
    private static func merge(raw: [String: Any], segment: [String: Any]) -> [String: Any] {
        var out = raw
        for key in dataKeys {
            if let value = segment[key] {
                out[key] = value
            }
        }
        // 刻度跟着新数据走（axis 不在白名单里，见 axisLabels 的注释）
        out["axis"] = axisLabels(for: out)
        return out
    }

    /// 曲线刻度的三段文字（起 / 中 / 末）。
    ///
    /// `axis` 是 JS 算好的 token 段、不在数据白名单里，所以合并完不会动它 ——
    /// 结果是「头部时间更新了、曲线刻度还停在 App 上次写盘的时刻」，看着像曲线卡住。
    /// 这里用**设备本地时区**重算，和 JS 的 axisText 一致：24 小时固定窗口，HH:mm。
    private static func axisLabels(for payload: [String: Any]) -> [String] {
        let observed = (payload["observedAt"] as? NSNumber)?.doubleValue ?? 0
        // observedAt 是毫秒
        let anchor = observed > 0 ? Date(timeIntervalSince1970: observed / 1000) : Date()
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        fmt.locale = Locale.current
        let span: TimeInterval = 24 * 3600
        return [
            fmt.string(from: anchor.addingTimeInterval(-span)),
            fmt.string(from: anchor.addingTimeInterval(-span / 2)),
            fmt.string(from: anchor)
        ]
    }

    private static func writeBack(_ payload: [String: Any], defaults: UserDefaults) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            NSLog("[EcowittWidget][fetch] 合并结果无法序列化，放弃写回")
            return
        }
        defaults.set(json, forKey: WidgetStore.payloadKey)
        // 自己写盘也要盖时间戳：否则下一次周期会觉得自己「刚被 App 写过」而不动，
        // 或者反过来每次都想拉 —— 两条路都不对
        defaults.set(Date().timeIntervalSince1970, forKey: lastWriteKey)
    }
}

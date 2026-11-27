//
//  EcowittWidget.swift
//  EcowittWidget
//
//  入口与分发。
//
//  只有一套契约：payload v4（modules → readings）。v3 及更早的 payload 一律显示占位，
//  不再保留旧渲染路径 —— 扩展和 App 一起发版，留两套渲染只会让升级用户先看到一版旧样式。
//
//  三种尺寸的实现都在 EcowittWidgetViews.swift；
//  布局算法在 WidgetPlan.swift；SVG 图标解析在 WidgetSvg.swift。
//

import SwiftUI
import WidgetKit

struct EcowittEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayloadV4
}

struct EcowittProvider: TimelineProvider {

    private func makeEntry() -> EcowittEntry {
        EcowittEntry(date: Date(), payload: WidgetPayloadV4.load() ?? .placeholder)
    }

    func placeholder(in context: Context) -> EcowittEntry {
        EcowittEntry(date: Date(), payload: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (EcowittEntry) -> Void) {
        completion(makeEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EcowittEntry>) -> Void) {
        // 先拿本地那份：拉取失败 / 没开自拉取时就用它出图，
        // **绝不能返回空时间线** —— 那会让卡片白屏
        let fallback = makeEntry()
        WidgetFetch.pull { outcome in
            let payload = outcome.flatMap { WidgetPayloadV4(raw: $0.payload) } ?? fallback.payload
            let entry = EcowittEntry(date: Date(), payload: payload)
            // 间隔 / 失败重试 / 抖动全在 payload 的 fetch 段里算好了（WidgetFetcher.Outcome），
            // 这里只兜「连 payload 都读不出来」这一种情况
            let next = Date().addingTimeInterval(outcome?.nextSeconds ?? 900)
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

struct EcowittWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: EcowittEntry

    var body: some View {
        // 只用 widgetURL：实测 Button(intent:) 在扩展里没注册成功时是死区，点了连 App 都不打开。
        // 目标页通过 scheme 传给 App（e-cowitt://pages/index/widgetSetting），
        // App 侧用它自己的通道解析（见 App.vue / widgetSync）。
        parameterBody(entry.payload)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())          // 整卡可点，空白处也命中
            .widgetURL(tapURL(entry.payload))
            .widgetBackground(entry.payload.theme.bg)
    }

    /// 点击落到首页，并带上这台设备的 id：App 侧据此切设备（见 App.vue applyWidgetNav）
    private func tapURL(_ payload: WidgetPayloadV4) -> URL? {
        let id = payload.deviceId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "ecowitt://pages/index/index?deviceId=" + id)
    }

    @ViewBuilder
    private func parameterBody(_ payload: WidgetPayloadV4) -> some View {
        switch family {
        case .systemSmall:
            SmallCardView(p: payload)
        case .systemMedium:
            MediumCardView(p: payload)
        default:
            LargeDashboardView(p: payload)
        }
    }
}

extension View {
    /// iOS 17 起必须用 containerBackground 设背景，否则系统只显示一条提示条
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.background(color)
        }
    }
}

/// 类型名不要和 module（EcowittWidget）同名，否则 Swift 会报符号歧义
@main
struct EcowittHomeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetStore.widgetKind, provider: EcowittProvider()) { entry in
            EcowittWidgetView(entry: entry)
        }
        .configurationDisplayName("Ecowitt")
        .description("Outdoor weather and indoor climate at a glance")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

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
        let entry = makeEntry()
        // 15 分钟兜底；主 App 也会主动 reloadTimelines
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())
            ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct EcowittWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: EcowittEntry

    var body: some View {
        parameterBody(entry.payload)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetBackground(entry.payload.theme.bg)
            .widgetURL(URL(string: "ecowitt://pages/index/widgetSetting"))
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

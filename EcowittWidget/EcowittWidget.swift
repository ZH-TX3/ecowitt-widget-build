//
//  EcowittWidget.swift
//  EcowittWidget
//
//  渲染器：不写业务规则，只把 payload.blocks 按尺寸画出来。
//  - small  : 第一个 block 当主数值，若配置允许多条则再显示一行
//  - medium : 主数值 + 最多 2 条副指标（两列）
//  - large  : 主数值 + 最多 5 条副指标（两列）
//  显示几条第几项、顺序、文案、颜色，全部来自 App 侧下发的 JSON。
//

import SwiftUI
import WidgetKit

struct EcowittEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload
}

struct EcowittProvider: TimelineProvider {

    func placeholder(in context: Context) -> EcowittEntry {
        EcowittEntry(date: Date(), payload: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (EcowittEntry) -> Void) {
        completion(EcowittEntry(date: Date(), payload: WidgetPayload.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EcowittEntry>) -> Void) {
        let entry = EcowittEntry(date: Date(), payload: WidgetPayload.load())
        // 15 分钟兜底；主 App 也会主动 reloadTimelines
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())
            ?? Date().addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct EcowittWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: EcowittEntry

    private var payload: WidgetPayload { entry.payload }
    private var theme: WidgetTheme { payload.theme }
    private var isSmall: Bool { family == .systemSmall }
    private var isLarge: Bool { family == .systemLarge }

    var body: some View {
        let limit = payload.limit(for: family)
        let shown = Array(payload.blocks.prefix(limit))
        let hero = shown.first(where: { $0.kind == .hero }) ?? shown.first
        let rest = shown.filter { $0.id != hero?.id && $0.kind != .divider }

        VStack(alignment: .leading, spacing: isSmall ? 4 : 8) {
            header

            if let hero = hero {
                heroRow(hero)
            }

            if !rest.isEmpty {
                metricArea(rest)
            }

            Spacer(minLength: 0)
        }
        .padding(isSmall ? 10 : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetBackground(theme.background)
        .widgetURL(URL(string: "ecowitt://page/index"))
    }

    // MARK: - 头部

    private var header: some View {
        HStack(spacing: 4) {
            Text(payload.device)
                .font(.system(size: 10 * theme.fontScale))
                .foregroundColor(theme.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let updated = payload.updatedAt {
                Text(updated, style: .time)
                    .font(.system(size: 9 * theme.fontScale))
                    .foregroundColor(theme.muted.opacity(0.8))
            }
        }
    }

    // MARK: - 主数值

    private func heroRow(_ block: WidgetBlock) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            if !block.icon.isEmpty {
                Image(systemName: block.icon)
                    .font(.system(size: (isSmall ? 12 : 14) * theme.fontScale, weight: .medium))
                    .foregroundColor(theme.accent)
                    .rotationEffect(.degrees(block.rotate))
            }
            Text(block.value)
                .font(.system(size: (isSmall ? 32 : 40) * theme.fontScale, weight: .semibold))
                .foregroundColor(theme.text)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text(block.unit)
                .font(.system(size: 12 * theme.fontScale))
                .foregroundColor(theme.muted)
            Spacer(minLength: 0)
            if !block.label.isEmpty {
                Text(block.label)
                    .font(.system(size: 10 * theme.fontScale))
                    .foregroundColor(theme.muted)
            }
        }
    }

    // MARK: - 副指标

    @ViewBuilder
    private func metricArea(_ blocks: [WidgetBlock]) -> some View {
        if blocks.count <= 1 || isSmall {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(blocks) { block in
                    metricRow(block, compact: isSmall)
                }
            }
        } else {
            // 两列：iOS 14 没有 Grid，用 HStack 拆半
            let left = blocks.enumerated().filter { $0.offset % 2 == 0 }.map { $0.element }
            let right = blocks.enumerated().filter { $0.offset % 2 == 1 }.map { $0.element }
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(left) { block in metricRow(block, compact: false) }
                }
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(right) { block in metricRow(block, compact: false) }
                }
            }
        }
    }

    private func metricRow(_ block: WidgetBlock, compact: Bool) -> some View {
        HStack(spacing: 3) {
            if !block.icon.isEmpty {
                Image(systemName: block.icon)
                    .font(.system(size: 9 * theme.fontScale, weight: .medium))
                    .foregroundColor(theme.accent.opacity(0.9))
                    .rotationEffect(.degrees(block.rotate))
            }
            Text(block.label)
                .font(.system(size: 10 * theme.fontScale))
                .foregroundColor(theme.muted)
                .lineLimit(1)
            Spacer(minLength: 2)
            Text(block.value)
                .font(.system(size: 11 * theme.fontScale, weight: .medium))
                .foregroundColor(theme.text)
                .lineLimit(1)
            if !block.unit.isEmpty {
                Text(block.unit)
                    .font(.system(size: 9 * theme.fontScale))
                    .foregroundColor(theme.muted)
            }
            if !block.sub.isEmpty {
                Text(block.sub)
                    .font(.system(size: 9 * theme.fontScale))
                    .foregroundColor(theme.muted)
            }
        }
        .padding(.vertical, compact ? 0 : 2)
    }
}

private extension View {
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

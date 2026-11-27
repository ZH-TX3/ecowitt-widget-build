//
//  EcowittWidgetViews.swift
//  EcowittWidget
//
//  payload v4 的三套布局 + primitive 层 + 8 种视觉件。
//
//  分工（DESIGN-SPEC-v4 第 1 节）：
//  - L1 primitive：.head / .chip / .value / .unit / .row-line / .well / .foot / .axis
//    只读 token，零魔法数字。
//  - L2 layout：small / medium / large(hero + tiles)，只有结构没有具体尺寸。
//  - 数据全部来自 payload，这里不换算、不翻译。
//
//  改这个文件要重编 .appex；改颜色字号图标文案不用。
//

import SwiftUI
import WidgetKit

// MARK: - 一次渲染要用的全部 token

struct WidgetStyle {
    let palette: WidgetPalette
    let shape: WidgetShape
    let type: WidgetTypeScale
    let icons: [String: [String]]
    /// 曲线几何与字缩系数：同样是 payload 决定的可调值，只是不属于「形状」
    let chart: WidgetChart
    let textShrink: WidgetTextShrink

    init(p: WidgetPayloadV4, family: String) {
        palette = p.theme
        shape = p.shape
        type = p.type(family)
        icons = p.icons
        chart = p.chart
        textShrink = p.textShrink
    }

    /// 画一个 24 网格线描图标。线宽按尺寸等比缩放，任何档位都与设计稿同粗细。
    @ViewBuilder
    func icon(_ name: String, size: CGFloat, color: Color, weight: CGFloat = 1.6) -> some View {
        let d = icons[name]?.first ?? icons["temperature"]?.first ?? "M10 3a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z M12 8v9"
        SVGShape(d: d)
            .stroke(color, style: StrokeStyle(
                lineWidth: max(0.6, weight * size / 24),
                lineCap: .round,
                lineJoin: .round
            ))
            .frame(width: size, height: size)
    }
}

// MARK: - 卡片容器

struct WidgetCard<Content: View>: View {
    let s: WidgetStyle
    let content: Content

    init(s: WidgetStyle, @ViewBuilder content: () -> Content) {
        self.s = s
        self.content = content()
    }

    var body: some View {
        content
            // 外面距读 payload 的 shape.inset.ios（默认 0）：WidgetKit 已经给了 16pt content margin，
            // 再叠设计稿的 cardPadding(12) 等于两边各缩 28pt，medium 那种扁盒子直接放不下数据。
            .padding(s.shape.insetIos)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // 背景**只由 containerBackground 提供**（见 EcowittWidget.swift 的 widgetBackground）。
        // 自己再画一层就是两层：系统那层在深色下会被轻微调色，交界处就是一圈色差。
        // 想换底色改 payload 的 theme.bg，不用重打基座。
    }
}

// MARK: - L1 primitive

/// 模块头只有一种：chip + 模块名 + 时间/图标。四个形态共用。
struct CardHead: View {
    let s: WidgetStyle
    let icon: String
    let name: String
    let meta: String
    let accent: Color
    var nameUppercased = false

    var body: some View {
        HStack(spacing: s.shape.cardGap) {
            ZStack {
                RoundedRectangle(cornerRadius: s.shape.chipRadius, style: .continuous)
                    .fill(accent.opacity(0.11))
                s.icon(icon, size: s.shape.chipSize * 0.6, color: accent)
            }
            .frame(width: s.shape.chipSize, height: s.shape.chipSize)

            Text(nameUppercased ? name.uppercased() : name)
                .font(.system(size: s.type.name, weight: .semibold))
                .foregroundColor(s.palette.ink)
                .lineLimit(1)

            Spacer(minLength: 2)

            Text(meta)
                .font(.system(size: s.type.caption))
                .foregroundColor(s.palette.muted)
                .lineLimit(1)
        }
        .frame(minHeight: s.shape.chipSize, alignment: .leading)
    }
}

/// 数值行只有一种：数值 + 单位（单位贴基线）
struct ValueLine: View {
    let s: WidgetStyle
    let value: String
    let unit: String
    /// 正常档字号；small = true 时改用四位数值那一档
    let size: CGFloat
    var small = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: s.shape.sp(1)) {
            Text(value)
                .font(.system(size: small ? s.type.valueSmall : size, weight: .semibold).monospacedDigit())
                .foregroundColor(s.palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(s.textShrink.value)
            if !unit.isEmpty {
                Text(unit)
                    .font(.system(size: s.type.unit, weight: .medium))
                    .foregroundColor(s.palette.muted)
                    .lineLimit(1)
            }
        }
    }
}

/// 极值留几个：both = 最大 + 最小（设计稿原样）、maxOnly = 只留最大、none = 都不留
enum PeakMode: Equatable {
    case both
    case maxOnly
    case none
}

/// 变化量 + 极值同一行，极值不重复印单位
struct MetaRow: View {
    let s: WidgetStyle
    let reading: WidgetReading
    var size: CGFloat?
    /// 默认 both：small / hero / 瓦片不传就是原行为，只有 medium 由 payload 决定
    var peaks: PeakMode = .both

    var body: some View {
        let fs = size ?? s.type.foot
        HStack(spacing: s.shape.sp(4)) {
            if let delta = reading.delta, delta.dir != 0 {
                HStack(spacing: s.shape.sp(1)) {
                    Text(delta.dir > 0 ? "▲" : "▼")
                    Text(delta.value)
                }
                .font(.system(size: fs).monospacedDigit())
                .foregroundColor(delta.dir > 0 ? s.palette.up : s.palette.down)
            }
            if let peak = reading.peak, peaks != .none {
                HStack(spacing: s.shape.sp(1)) {
                    s.icon("maxOut", size: 8, color: s.palette.up, weight: 2.6)
                    Text(peak.maxValue)
                }
                .font(.system(size: fs).monospacedDigit())
                .foregroundColor(s.palette.up)
                if let min = peak.minValue, peaks == .both {
                    HStack(spacing: s.shape.sp(1)) {
                        s.icon("minOut", size: 8, color: s.palette.down, weight: 2.6)
                        Text(min)
                    }
                    .font(.system(size: fs).monospacedDigit())
                    .foregroundColor(s.palette.down)
                }
            }
        }
        .lineLimit(1)
        // 放不下先缩字，别直接截断（medium 左栏最挤的就是这一行）
        .minimumScaleFactor(s.textShrink.meta)
        // 这一行必须按**自然宽度**报尺寸：lineLimit(1) 只会报「塞进提议宽度的宽度」，
        // 于是左栏宽度被主数值那行定死 —— 温度 21.4（81pt）窄于极值行（95pt）就被压成 …，
        // 气压 1013.8（124pt）刚好更宽所以看不出问题。实测：把温度补两位后就正常了。
        .fixedSize(horizontal: true, vertical: false) // 允许 fixedSize：取自然宽度
    }
}

/// 次要读数只有一种：label 左、值右
struct RowLineView: View {
    let s: WidgetStyle
    let row: WidgetRow
    var compact = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: s.shape.sp(3)) {
            Text(row.label)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 2)
            HStack(spacing: s.shape.sp(1)) {
                Text(row.value)
                    .fontWeight(.semibold)
                    .foregroundColor(s.palette.ink)
                if !row.unit.isEmpty {
                    Text(row.unit)
                        .foregroundColor(s.palette.muted)
                }
            }
            .lineLimit(1)
        }
        .font(.system(size: compact ? s.type.detail : s.type.sub))
        .foregroundColor(s.palette.muted)
    }
}

/// 整句附带项（From SW · Gust 26.3 / Dew point 13.7°C）
struct AttachLine: View {
    let s: WidgetStyle
    let reading: WidgetReading
    let accent: Color
    var size: CGFloat?

    var body: some View {
        Group {
            if !reading.attachText.isEmpty {
                Text(reading.attachText)
                    .foregroundColor(s.palette.muted)
            } else if let attach = reading.attach {
                HStack(spacing: s.shape.sp(1)) {
                    Text(attach.label)
                        .foregroundColor(s.palette.muted.opacity(0.85))
                    Text(attach.value + (attach.unit.isEmpty ? "" : " " + attach.unit))
                        .foregroundColor(s.palette.muted)
                }
            }
        }
        .font(.system(size: size ?? s.type.sub))
        .lineLimit(1)
        .minimumScaleFactor(s.textShrink.attach)
    }
}

/// 曲线下方的时间轴：三段刻度（起点 / 中点 / 终点）。medium 与 hero 共用。
struct AxisRow: View {
    let s: WidgetStyle
    let labels: [String]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(labels.indices, id: \.self) { index in
                Text(labels[index])
                    .font(.system(size: s.type.axis))
                    .foregroundColor(s.palette.muted)
                    .lineLimit(1)
                if index < labels.count - 1 { Spacer(minLength: 4) }
            }
        }
    }
}

// MARK: - 8 种视觉件

struct VisualView: View {
    let s: WidgetStyle
    let visual: WidgetVisual
    let accent: Color
    /// 紧凑档（瓦片 / medium 左栏）
    var xs = false

    private var viz: WidgetVizSize { xs ? s.shape.vizXs : s.shape.viz }

    var body: some View {
        switch visual.kind {
        case "glyph": glyph
        case "ring": ring
        case "dial": dial
        case "gauge": gauge
        case "uv": uvBar
        case "bars": bars
        case "sun": sun
        case "battery": battery
        default: EmptyView()
        }
    }

    // 线描图标
    private var glyph: some View {
        s.icon(visual.icon.isEmpty ? "temperature" : visual.icon,
               size: viz.glyphW,
               color: accent)
            .frame(width: viz.glyphW, height: viz.glyphH)
    }

    // 环形填充：湿度 / 土壤
    private var ring: some View {
        let side = viz.ring
        let thickness = xs ? 2 : s.shape.ringInset
        let ico = xs ? s.shape.ringIcoXs : s.shape.ringIco
        return ZStack {
            Circle().strokeBorder(s.palette.well, lineWidth: thickness)
            Circle()
                .trim(from: 0, to: min(1, max(0, visual.fill / 100)))
                .stroke(accent, style: StrokeStyle(lineWidth: thickness, lineCap: .butt))
                .rotationEffect(.degrees(-90))
            s.icon(visual.icon.isEmpty ? "humidity" : visual.icon, size: ico, color: accent)
        }
        .frame(width: side, height: side)
    }

    // 风向罗盘
    private var dial: some View {
        let side = viz.compass
        return ZStack {
            Circle().stroke(accent.opacity(0.34), lineWidth: 1)
            if !xs {
                Text("N").font(.system(size: s.type.tick)).foregroundColor(s.palette.muted).offset(y: -side / 2 + 4)
                Text("S").font(.system(size: s.type.tick)).foregroundColor(s.palette.muted).offset(y: side / 2 - 4)
                Text("W").font(.system(size: s.type.tick)).foregroundColor(s.palette.muted).offset(x: -side / 2 + 4)
                Text("E").font(.system(size: s.type.tick)).foregroundColor(s.palette.muted).offset(x: side / 2 - 4)
            }
            // 紧凑档不画 N/S/W/E（设计稿只有默认档有刻度），箭头也放大到 70%：
            // 26dp 的罗盘里 56% 只有 14dp，实机上几乎看不清
            s.icon("arrow", size: side * (xs ? 0.70 : 0.56), color: accent)
                .rotationEffect(.degrees(visual.bearing))
        }
        .frame(width: side, height: side)
    }

    // 半圆刻度 + 指针：气压 / CO₂
    private var gauge: some View {
        let w = viz.gauge
        let h = w / 2 + 2
        let ratio = min(1, max(0, visual.ratio < 0 ? 0 : visual.ratio))
        return Canvas { context, size in
            let scale = size.width / 100
            let center = CGPoint(x: 50 * scale, y: 50 * scale)
            let radius = 46 * scale
            func arcPath(to: Double) -> Path {
                var p = Path()
                // SwiftUI 的 y 轴朝下：角度 180° → 360° 走的是上半圆
                p.addArc(center: center, radius: radius,
                         startAngle: .degrees(180),
                         endAngle: .degrees(180 + 180 * to),
                         clockwise: false)
                return p
            }
            context.stroke(arcPath(to: 1), with: .color(accent.opacity(0.34)),
                           style: StrokeStyle(lineWidth: 4 * scale, lineCap: .butt))
            context.stroke(arcPath(to: ratio), with: .color(accent),
                           style: StrokeStyle(lineWidth: 4 * scale, lineCap: .round))
            let angle = Double.pi - Double.pi * ratio
            var needle = Path()
            needle.move(to: center)
            needle.addLine(to: CGPoint(
                x: (50 + 32 * cos(angle)) * scale,
                y: (50 - 32 * sin(angle)) * scale
            ))
            context.stroke(needle, with: .color(s.palette.ink),
                           style: StrokeStyle(lineWidth: max(0.8, 1.6 * scale), lineCap: .round))
        }
        .frame(width: w, height: h)
    }

    // 渐变色标：UV
    private var uvBar: some View {
        let w = viz.uvbar
        let h: CGFloat = 6
        return ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(LinearGradient(colors: s.shape.uvScale,
                                     startPoint: .leading, endPoint: .trailing))
            Rectangle()
                .fill(s.palette.ink)
                .frame(width: 4, height: xs ? 6 : 12)
                .overlay(Rectangle().stroke(s.palette.bg, lineWidth: 1))
                .offset(x: max(0, min(w - 4, w * visual.pos / 100 - 2)))
        }
        .frame(width: w, height: h)
    }

    // 柱状：雨强 / PM
    private var bars: some View {
        let h = viz.barsH
        let mx = max(visual.values.max() ?? 1, 0.001)
        return HStack(alignment: .bottom, spacing: s.shape.sp(1)) {
            ForEach(visual.values.indices, id: \.self) { index in
                let ratio = max(0.08, visual.values[index] / mx)
                let lit = index >= visual.values.count - 2
                RoundedRectangle(cornerRadius: 1)
                    .fill(accent.opacity(lit ? 1 : 0.5))
                    .frame(width: 4, height: h * CGFloat(ratio))
            }
        }
        .frame(height: h, alignment: .bottom)
    }

    // 光圈：光照
    private var sun: some View {
        let side = viz.sun
        return ZStack {
            Circle().stroke(accent.opacity(0.42), lineWidth: 1)
            s.icon(visual.icon.isEmpty ? "sun" : visual.icon, size: side * 0.6, color: accent)
        }
        .frame(width: side, height: side)
    }

    // 电池：外框 + 5 格 + 电极，≤1 格转告警红
    private var battery: some View {
        let h = viz.batteryH
        let cells = 5
        let level = min(cells, max(0, visual.level))
        let low = level <= 1
        return HStack(spacing: s.shape.sp(1)) {
            HStack(spacing: s.shape.cellGap) {
                ForEach(Array(0..<cells), id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(index < level
                              ? (low ? s.palette.danger : s.palette.ok)
                              : s.palette.ink.opacity(0.14))
                        .frame(width: s.shape.cellW)
                }
            }
            .padding(s.shape.sp(1))
            .frame(height: h)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(s.palette.ink.opacity(0.42), lineWidth: 1)
            )
            RoundedRectangle(cornerRadius: 1)
                .fill(s.palette.ink.opacity(0.42))
                .frame(width: 2, height: h * 0.44)
        }
        .frame(height: h)
    }
}

// MARK: - 趋势图（medium 与 hero 共用；只有它们有曲线）

struct TrendChart: View {
    let points: [(t: Double, v: Double)]
    let accent: Color
    let border: Color
    /// 网格位置 / 线宽 / 圆点半径 / 虚线 / 留白 / 取景 / 最少点数，全部来自 payload
    let chart: WidgetChart

    var body: some View {
        Canvas { context, size in
            guard points.count >= chart.minPoints, size.width > 1, size.height > 1 else { return }
            // 网格：y 位置是「占可视高度的比例」，不是绝对坐标
            for ratio in chart.gridRatios {
                let y = size.height * ratio
                var grid = Path()
                grid.move(to: CGPoint(x: 0, y: y))
                grid.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(grid, with: .color(border),
                               style: StrokeStyle(lineWidth: chart.gridW, dash: chart.dash))
            }
            let geometry = ChartGeometry(points: points, size: size, chart: chart)
            context.stroke(geometry.line, with: .color(accent),
                           style: StrokeStyle(lineWidth: chart.lineW, lineCap: .round, lineJoin: .round))
            let last = geometry.last
            let dot = Path(ellipseIn: CGRect(x: last.x - chart.dotR,
                                             y: last.y - chart.dotR,
                                             width: chart.dotR * 2,
                                             height: chart.dotR * 2))
            context.fill(dot, with: .color(accent))
        }
    }
}

/// 单调三次插值：压掉锯齿又不至于过冲（与 HTML 的 path() 同一套算法）
private struct ChartGeometry {
    let line: Path
    let last: CGPoint

    init(points: [(t: Double, v: Double)], size: CGSize, chart: WidgetChart) {
        let rawValues = points.map { $0.v }
        var minV = rawValues.min() ?? 0
        var maxV = rawValues.max() ?? 1
        // 值域取景：上下各留 padRatio 的跨度，最少 minPad 个单位
        let pad = max((maxV - minV) * Double(chart.padRatio), Double(chart.minPad))
        minV -= pad
        maxV += pad
        let spanV = max(maxV - minV, 0.0001)

        let xs = points.map { $0.t }
        let x0 = xs.min() ?? 0
        let x1 = xs.max() ?? 1
        let spanX = max(x1 - x0, 0.0001)

        // 采样区留白；画布比留白还窄时不能出现负宽度，否则曲线会镜像翻转
        let padX = Double(chart.padX)
        let padY = Double(chart.padY)
        let innerW = max(0, Double(size.width) - padX * 2)
        let innerH = max(0, Double(size.height) - padY * 2)

        let pts = points.map { point -> CGPoint in
            let x = padX + (point.t - x0) / spanX * innerW
            let y = Double(size.height) - padY - (point.v - minV) / spanV * innerH
            return CGPoint(x: x, y: y)
        }

        var path = Path()
        if pts.count >= 2 {
            var slopes: [CGFloat] = []
            for index in 1..<pts.count {
                let dx = pts[index].x - pts[index - 1].x
                slopes.append(dx == 0 ? 0 : (pts[index].y - pts[index - 1].y) / dx)
            }
            var tangents = [CGFloat](repeating: 0, count: pts.count)
            tangents[0] = slopes[0]
            tangents[pts.count - 1] = slopes[slopes.count - 1]
            if pts.count > 2 {
                for index in 1..<(pts.count - 1) {
                    let a = slopes[index - 1]
                    let b = slopes[index]
                    tangents[index] = (a * b <= 0 || a == 0 || b == 0) ? 0 : 2 / (1 / a + 1 / b)
                }
            }
            path.move(to: pts[0])
            for index in 0..<(pts.count - 1) {
                let a = pts[index]
                let b = pts[index + 1]
                let dx = (b.x - a.x) / 3
                path.addCurve(
                    to: b,
                    control1: CGPoint(x: a.x + dx, y: a.y + tangents[index] * dx),
                    control2: CGPoint(x: b.x - dx, y: b.y - tangents[index + 1] * dx)
                )
            }
        }
        line = path
        last = pts.last ?? .zero
    }
}

// MARK: - small：一条突出读数 + 一个附带项

struct SmallCardView: View {
    let p: WidgetPayloadV4
    private var s: WidgetStyle { WidgetStyle(p: p, family: "small") }

    var body: some View {
        let entry = p.feature(in: p.modules)
        let module = entry?.module
        let reading = entry?.reading
        let accent = s.palette.accent(module?.accent ?? "temp")

        return WidgetCard(s: s) {
            VStack(alignment: .leading, spacing: s.shape.cardGap) {
                CardHead(s: s,
                         icon: module?.icon ?? "temperature",
                         name: module?.label ?? "",
                         meta: p.updatedShort,
                         accent: accent)
                HStack(alignment: .center, spacing: s.shape.sp(2)) {
                    VStack(alignment: .leading, spacing: s.shape.sp(1)) {
                        ValueLine(s: s,
                                  value: reading?.value ?? "—",
                                  unit: reading?.unit ?? "",
                                  size: s.type.value,
                                  small: reading?.small ?? false)
                        if let reading = reading {
                            MetaRow(s: s, reading: reading, size: s.type.foot)
                        }
                    }
                    Spacer(minLength: 2)
                    rightSlot(module: module, reading: reading, accent: accent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                foot(module: module, reading: reading, accent: accent)
            }
        }
    }

    /// 右侧槽位：状态文案优先；小卡默认不画签名，只有显式声明 inSmall 的才画
    @ViewBuilder
    private func rightSlot(module: WidgetModule?, reading: WidgetReading?, accent: Color) -> some View {
        let state = reading?.state ?? ""
        let visual = reading?.visual
        let hidden = (reading?.stateSlot ?? false) || !(visual?.inSmall ?? false)
        if !state.isEmpty {
            Text(state)
                .font(.system(size: s.type.sub, weight: .semibold))
                .foregroundColor(accent)
                .lineLimit(1)
        } else if !hidden, let visual = visual {
            VisualView(s: s, visual: visual, accent: accent)
        } else {
            EmptyView()
        }
    }

    /// 副行取值优先级：成对摘要（日出→日落）> 同一模块的另一条读数 > 模块 rows[0]
    @ViewBuilder
    private func foot(module: WidgetModule?, reading: WidgetReading?, accent: Color) -> some View {
        HStack(spacing: 0) {
            if let module = module, !module.compact.isEmpty {
                HStack(spacing: s.shape.sp(1)) {
                    Text(module.compactLabel)
                        .foregroundColor(s.palette.muted.opacity(0.85))
                    Text(module.compact)
                        .foregroundColor(s.palette.muted)
                }
                .font(.system(size: s.type.foot))
                .lineLimit(1)
            } else if let reading = reading {
                AttachLine(s: s, reading: reading, accent: accent, size: s.type.foot)
            }
            Spacer(minLength: 2)
        }
    }
}

// MARK: - medium：同一条读数 + 它的趋势

struct MediumCardView: View {
    let p: WidgetPayloadV4
    private var s: WidgetStyle { WidgetStyle(p: p, family: "medium") }

    var body: some View {
        let entry = p.feature(in: p.modules)
        let module = entry?.module
        let reading = entry?.reading
        let accent = s.palette.accent(module?.accent ?? "temp")

        return WidgetCard(s: s) {
            VStack(alignment: .leading, spacing: s.shape.cardGap) {
                CardHead(s: s,
                         icon: module?.icon ?? "temperature",
                         name: module?.label ?? "",
                         meta: p.updatedShort,
                         accent: accent)
                // 左栏**不加任何宽度约束** —— 与 large 的 hero 同一条规则：
                // HStack 先把不灵活的文字栏按理想宽度摆好，剩下的全给显式 maxWidth: .infinity 的曲线栏。
                // 一旦给左栏套 frame(width:) / frame(maxWidth:) / fixedSize，它就成了「定宽框」：
                // 框比内容宽 → 内容到曲线之间空一片；框比内容窄 → 字被 minimumScaleFactor 压小。
                HStack(alignment: .center, spacing: s.shape.sp(5)) {
                    // 与 small 的 main / foot 同构：数值+变化量在剩余空间里居中，附带项压列底
                    VStack(alignment: .leading, spacing: s.shape.sp(2)) {
                        VStack(alignment: .leading, spacing: s.shape.sp(1)) {
                            ValueLine(s: s,
                                      value: reading?.value ?? "—",
                                      unit: reading?.unit ?? "",
                                      size: s.type.value,
                                      small: reading?.small ?? false)
                            if let reading = reading, p.detailMediumMeta {
                                MetaRow(s: s, reading: reading, size: s.type.state, peaks: metaPeaks)
                            }
                        }
                        .frame(maxHeight: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: .infinity, alignment: .topLeading)
                    // 左栏取「最宽那一行」的自然宽度，别的行不许把它压窄。
                    // 不取的话列宽会被主数值那一行决定：温度主数值 81pt < 极值行 95pt，
                    // 极值行就被压到 81 并砍成 …（气压反过来，主数值更宽所以没这问题）。
                    .fixedSize(horizontal: true, vertical: false) // 允许 fixedSize：只为取自然宽度

                    VStack(alignment: .leading, spacing: s.shape.sp(1)) {
                        if let module = module, module.series.count >= s.chart.minPoints {
                            TrendChart(points: module.series, accent: accent, border: s.palette.border, chart: s.chart)
                        } else {
                            emptyChart
                        }
                        axis
                    }
                    // 曲线栏必须显式吃掉剩余宽度：Canvas / AxisRow 的理想宽度都很小，
                    // 不给 maxWidth 的话整行会按内容居中，中间就是一大片空白
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                footer(module: module, reading: reading, accent: accent)
            }
        }
    }

    /// 极值格数，来自 payload 的 shape.detail.medium.peaks（解析层已把非法值落到 'both'）
    private var metaPeaks: PeakMode {
        switch p.detailMediumPeaks {
        case "max": return .maxOnly
        case "none": return .none
        default: return .both
        }
    }

    private var emptyChart: some View {
        VStack(spacing: s.shape.sp(2)) {
            s.icon("chart", size: 22, color: s.palette.muted.opacity(0.7))
            Text(p.emptyTitle)
                .font(.system(size: s.type.state, weight: .semibold))
                .foregroundColor(s.palette.muted)
            Text(p.emptyBody)
                .font(.system(size: s.type.state))
                .foregroundColor(s.palette.muted.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: s.shape.wellRadius, style: .continuous).fill(s.palette.well))
    }

    private var axis: some View {
        AxisRow(s: s, labels: p.axisLabels)
    }

    /// 底栏与小卡同一套展示：模块成对摘要优先，否则 attach（室外就是湿度）。
    /// 左栏不再放 attach —— 一条次要数据只出现在一个位置，跟小卡对齐。
    @ViewBuilder
    private func footer(module: WidgetModule?, reading: WidgetReading?, accent: Color) -> some View {
        HStack(spacing: 0) {
            if let module = module, !module.compact.isEmpty {
                HStack(spacing: s.shape.sp(1)) {
                    Text(module.compactLabel)
                        .foregroundColor(s.palette.muted.opacity(0.85))
                    Text(module.compact)
                }
                .lineLimit(1)
            } else if let reading = reading, p.detailMediumAttach {
                AttachLine(s: s, reading: reading, accent: accent, size: s.type.foot)
            }
            Spacer(minLength: 4)
            Text(p.footerLeft)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .font(.system(size: s.type.foot))
        .foregroundColor(s.palette.muted)
        .minimumScaleFactor(s.textShrink.footer)
    }
}

// MARK: - large：hero + 瓦片

struct LargeDashboardView: View {
    let p: WidgetPayloadV4
    private var s: WidgetStyle { WidgetStyle(p: p, family: "large") }

    var body: some View {
        // hero 一定在最前，其余保持模块数组原顺序
        var ordered = p.modules
        if let index = ordered.firstIndex(where: { $0.key == p.heroKey }), index > 0 {
            let hero = ordered.remove(at: index)
            ordered.insert(hero, at: 0)
        }

        return WidgetCard(s: s) {
            VStack(alignment: .leading, spacing: s.shape.cardGapLarge) {
                station
                GeometryReader { geo in
                    let plan = LargeLayout.plan(
                        count: ordered.count,
                        budget: geo.size.height,
                        zoneGap: s.shape.cardGapLarge,
                        heroCap: p.heroCap,
                        tileMin: p.tileMin,
                        heroMin: p.heroMin
                    )
                    blocks(modules: ordered, plan: plan)
                        // 同样用 maxWidth 提议：子块自带 maxWidth，定宽框只会让它们各自按内容宽
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
        }
    }

    private var station: some View {
        HStack(spacing: s.shape.sp(3)) {
            Text(p.brand)
                .font(.system(size: s.type.brand, weight: .bold))
                .foregroundColor(s.palette.ink)
            Text(p.station)
                .font(.system(size: s.type.station))
                .foregroundColor(s.palette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 2)
            Text(p.updatedShort)
                .font(.system(size: s.type.state))
                .foregroundColor(s.palette.muted)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func blocks(modules: [WidgetModule], plan: LargePlan) -> some View {
        let shown = Array(modules.prefix(max(1, plan.shown)))
        if plan.mode == .pair {
            VStack(spacing: s.shape.cardGapLarge) {
                ForEach(shown.indices, id: \.self) { index in
                    heroBlock(module: shown[index], height: plan.heroH, rows: plan.heroRows, tight: plan.heroH < 120)
                }
            }
        } else {
            VStack(spacing: s.shape.cardGapLarge) {
                if let hero = shown.first {
                    heroBlock(module: hero, height: plan.heroH, rows: plan.heroRows, tight: plan.heroH < 120)
                }
                tilesGrid(Array(shown.dropFirst()), plan: plan)
            }
        }
    }

    /// 瓦片网格：列数由高度预算决定，行高固定，块级覆盖自己的 accent
    @ViewBuilder
    private func tilesGrid(_ tiles: [WidgetModule], plan: LargePlan) -> some View {
        if !tiles.isEmpty {
            let cols = max(1, plan.tileCols)
            let rows = stride(from: 0, to: tiles.count, by: cols).map {
                Array(tiles[$0..<min($0 + cols, tiles.count)])
            }
            VStack(spacing: s.shape.cardGapLarge) {
                ForEach(rows.indices, id: \.self) { rowIndex in
                    let row = rows[rowIndex]
                    HStack(spacing: s.shape.cardGapLarge) {
                        ForEach(row.indices, id: \.self) { cellIndex in
                            tileBlock(module: row[cellIndex], height: plan.tileH, rows: plan.tileRows)
                        }
                        // 最后一行不满时补空位，保证格子宽度一致
                        if row.count < cols {
                            ForEach(Array(row.count..<cols), id: \.self) { _ in
                                Color.clear.frame(maxWidth: .infinity)
                            }
                        }
                    }
                    .frame(height: plan.tileH)
                }
            }
        }
    }

    /// hero = medium 的结构（头 + 趋势），只是更高、明细更多
    private func heroBlock(module: WidgetModule, height: CGFloat, rows: Int, tight: Bool) -> some View {
        // 取哪条读数：规则在 WidgetPayloadV4.featuredReading（含 selection.featured）
        let reading = p.featuredReading(for: module) ?? WidgetReading()
        let accent = s.palette.accent(reading.accent)
        let padH: CGFloat = tight ? s.shape.sp(5) : s.shape.sp(6)
        let padV: CGFloat = tight ? s.shape.sp(4) : s.shape.sp(5)
        // 明细行：布局能放几行（rows）× 用户要看几行（payload 的 shape.detail.heroRows）取小
        let heroRows = min(max(0, rows), p.detailHeroRows)
        let lines = heroRows > 0 ? Array(reading.lines.prefix(heroRows)) : []

        return VStack(alignment: .leading, spacing: s.shape.sp(2)) {
            HStack(spacing: s.shape.cardGap) {
                ZStack {
                    RoundedRectangle(cornerRadius: s.shape.chipRadius, style: .continuous)
                        .fill(accent.opacity(0.11))
                    s.icon(module.icon, size: s.shape.chipSize * 0.6, color: accent)
                }
                .frame(width: s.shape.chipSize, height: s.shape.chipSize)
                Text(module.label)
                    .font(.system(size: s.type.name, weight: .semibold))
                    .foregroundColor(s.palette.ink)
                    .lineLimit(1)
                heroState(reading: reading, accent: accent)
                Spacer(minLength: 2)
                Text(p.updatedShort)
                    .font(.system(size: s.type.caption))
                    .foregroundColor(s.palette.muted)
                    .lineLimit(1)
            }
            .frame(minHeight: s.shape.chipSize, alignment: .leading)

            HStack(alignment: .center, spacing: s.shape.sp(5)) {
                VStack(alignment: .leading, spacing: s.shape.sp(1)) {
                    ValueLine(s: s,
                              value: reading.value,
                              unit: reading.unit,
                              size: s.type.value,
                              small: reading.small || height < 140)
                    MetaRow(s: s, reading: reading, size: s.type.detail)
                    if !lines.isEmpty {
                        VStack(alignment: .leading, spacing: s.shape.lineGap) {
                            ForEach(lines.indices, id: \.self) { index in
                                RowLineView(s: s, row: lines[index])
                            }
                        }
                    }
                }
                VStack(alignment: .leading, spacing: s.shape.sp(1)) {
                    if module.series.count >= s.chart.minPoints {
                        TrendChart(points: module.series, accent: accent, border: s.palette.border, chart: s.chart)
                    } else {
                        emptyChart
                    }
                    AxisRow(s: s, labels: p.axisLabels)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, padH)
        .padding(.vertical, padV)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: s.shape.wellRadius, style: .continuous).fill(s.palette.well))
    }

    /// 2-up 中等瓦片：头（模块名 + 状态/签名）+ 数值行（含同行明细）+ 明细行
    private func tileBlock(module: WidgetModule, height: CGFloat, rows: Int) -> some View {
        let reading = p.featuredReading(for: module) ?? WidgetReading()
        let accent = s.palette.accent(reading.accent)
        let tight = height < 70
        let pad: CGFloat = tight ? s.shape.tilePadTight : s.shape.tilePad
        // 同行摘要（设计稿的 .detail-in）由 payload 的 shape.detail.inline 控制
        let detail = p.detailInline ? compactText(module: module, reading: reading) : ""
        // 瓦片明细行：可用行数 × 用户上限取小（rows 里已包含数值行的位置）
        let tileRowLimit = min(max(0, rows - 1), p.detailTileRows)
        let lines = tileRowLimit > 0 ? Array(reading.lines.prefix(tileRowLimit)) : []

        return VStack(alignment: .leading, spacing: tight ? s.shape.lineGap : s.shape.blockGap) {
            HStack(spacing: s.shape.sp(1)) {
                Text(module.label)
                    .font(.system(size: s.type.title))
                    .foregroundColor(accent)
                    .lineLimit(1)
                Spacer(minLength: 1)
                stateSlot(reading: reading, accent: accent, xs: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: s.shape.sp(1)) {
                Text(reading.value)
                    .font(.system(size: s.type.lower, weight: .semibold).monospacedDigit())
                    .foregroundColor(s.palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(s.textShrink.tileValue)
                if !reading.unit.isEmpty {
                    Text(reading.unit)
                        .font(.system(size: s.type.detail))
                        .foregroundColor(s.palette.muted)
                        .lineLimit(1)
                }
                if !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: s.type.detail))
                        .foregroundColor(s.palette.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .layoutPriority(-1)
                }
            }
            if !lines.isEmpty {
                VStack(alignment: .leading, spacing: s.shape.lineGap) {
                    ForEach(lines.indices, id: \.self) { index in
                        RowLineView(s: s, row: lines[index])
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, pad)
        .padding(.vertical, pad)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: s.shape.wellRadius, style: .continuous).fill(s.palette.well))
    }

    /// hero 头部右侧：有雨画水滴、无雨留空；否则状态文案。
    /// **不画签名** —— 头部已经有 chip，再画一个是重复，还会把曲线挤窄（时间轴都被挤没了）。
    @ViewBuilder
    private func heroState(reading: WidgetReading, accent: Color) -> some View {
        if reading.stateSlot {
            if !reading.state.isEmpty {
                s.icon("rainfall", size: s.shape.viz.glyphW, color: accent)
            }
        } else if !reading.state.isEmpty {
            Text(reading.state)
                .font(.system(size: s.type.state, weight: .semibold))
                .foregroundColor(accent)
                .lineLimit(1)
        }
    }

    /// 瓦片右侧：状态槽有雨画水滴、无雨留空；否则状态文案；再否则签名（xs）
    @ViewBuilder
    private func stateSlot(reading: WidgetReading, accent: Color, xs: Bool) -> some View {
        if reading.stateSlot {
            if !reading.state.isEmpty {
                s.icon("rainfall", size: xs ? s.shape.vizXs.glyphW : s.shape.viz.glyphW, color: accent)
            }
        } else if !reading.state.isEmpty {
            Text(reading.state)
                .font(.system(size: s.type.state, weight: .semibold))
                .foregroundColor(accent)
                .lineLimit(1)
        } else if let visual = reading.visual, visual.inline {
            // 只看 inline：inSmall 是「小卡右侧」的规则（那里已经有 chip 了），
            // 瓦片里没有 chip，solar 这类 inSmall=false 的签名照样要画。
            VisualView(s: s, visual: visual, accent: accent, xs: xs)
        }
    }

    private var emptyChart: some View {
        VStack(spacing: s.shape.sp(1)) {
            s.icon("chart", size: 16, color: s.palette.muted.opacity(0.7))
            Text(p.emptyTitle)
                .font(.system(size: s.type.detail))
                .foregroundColor(s.palette.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: s.shape.wellRadius, style: .continuous).fill(s.palette.well.opacity(0.6)))
    }

    /// 瓦片数值行里的短摘要：成对摘要优先，否则第一条明细
    private func compactText(module: WidgetModule, reading: WidgetReading) -> String {
        if !module.compact.isEmpty { return module.compact }
        guard let row = reading.lines.first else { return "" }
        return row.label + " " + row.value + (row.unit.isEmpty ? "" : " " + row.unit)
    }
}

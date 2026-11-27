//
//  WidgetPlan.swift
//  EcowittWidget
//
//  large 的布局决策，纯函数，便于推理与对齐 Android。
//  与 DESIGN-SPEC-v4 第 5 节、`docx/Ecowitt-Widgets-v4.html` 的 planLarge 同构。
//
//  规则：
//    n = 2  → 两块等分，各自都是 medium 形态（含曲线）
//    n ≥ 3  → hero + 瓦片区，hero 最多占内容区一半
//    列数   → 2 列优先，hero 被压到 < heroMin 才换 3 列
//    行数   → 由高度反算（13pt 一行明细），装不下就折叠末尾模块（hero 永远保留）
//
//  iOS 的 budget 是**实测出来**的（GeometryReader 给的高度），不是常数；
//  Android 的 RemoteViews 无法测量，用的是 payload 里的 shape.plan.budget。
//

import CoreGraphics
import Foundation

enum LargeMode {
    /// 只有两个模块：不分 hero / 瓦片
    case pair
    /// 三个以上：hero + 瓦片网格
    case hero
}

struct LargePlan {
    var mode: LargeMode = .hero
    /// 参与渲染的模块数（超出预算的末尾模块被折叠）
    var shown = 0
    var hidden = 0
    var heroH: CGFloat = 0
    var tileH: CGFloat = 0
    var tileCols = 2
    /// hero 左栏能放几行明细（可为 0）
    var heroRows = 0
    /// 每个瓦片能放几行明细（含数值行里那一条，所以最少 1）
    var tileRows = 1
}

enum LargeLayout {
    /// 明细行高度（字号 8 + 行距 2 + 余量），实测标定
    private static let detailLine: CGFloat = 13
    /// 瓦片起始行高，逐档 4px 往下压
    private static let tileStart: CGFloat = 88

    // 外部标签保持不变（调用点不用改），内部换名才能声明消毒后的同名变量
    static func plan(count: Int,
                     budget rawBudget: CGFloat,
                     zoneGap rawZoneGap: CGFloat,
                     heroCap rawHeroCap: CGFloat,
                     tileMin rawTileMin: CGFloat,
                     heroMin rawHeroMin: CGFloat) -> LargePlan {
        guard count > 0 else { return LargePlan() }
        // 入参来自 payload（shape.plan.*）：NaN / inf / 0 / 负数都会让下面的 Int(floor(...)) trap，
        // 所以先消毒再参与运算
        func safe(_ v: CGFloat, _ fallback: CGFloat) -> CGFloat {
            v.isFinite && v > 0 ? v : fallback
        }
        let budget = max(80, safe(rawBudget, 328))
        let zoneGap = safe(rawZoneGap, 6)
        let heroCap = safe(rawHeroCap, budget / 2)
        let tileMin = safe(rawTileMin, 48)
        let heroMin = safe(rawHeroMin, 88)

        // 两个模块：等分两块
        if count == 2 {
            let h = floor((budget - zoneGap) / 2)
            var plan = LargePlan()
            plan.mode = .pair
            plan.shown = 2
            plan.heroH = h
            plan.tileH = 0
            plan.tileCols = 1
            // 左栏 = 数值 + 极值 + 明细；155px 高只放得下 2 行
            let base: CGFloat = 20 + 22 + 34 + 13 + 8
            plan.heroRows = max(1, min(2, Int(floor((h - base - 4) / detailLine))))
            return plan
        }

        // 试一种能放下的方案：2 列优先，不行换 3 列
        func layoutFor(_ n: Int) -> (ok: Bool, cols: Int, rows: Int, h: CGFloat, heroH: CGFloat, gaps: CGFloat, duoGaps: CGFloat) {
            let tiles = max(0, n - 1)
            let gaps = tiles > 0 ? zoneGap : 0
            for cols in [2, 3] {
                let rows = tiles > 0 ? Int(ceil(Double(tiles) / Double(cols))) : 0
                let duoGaps = rows > 1 ? CGFloat(rows - 1) * zoneGap : 0
                var h = tileStart
                var heroH = budget - gaps - duoGaps - CGFloat(rows) * h
                // 先把 hero 拉回 96 以上（压瓦片），再不行就接受 88
                while heroH < 96 && h > 58 {
                    h -= 4
                    heroH = budget - gaps - duoGaps - CGFloat(rows) * h
                }
                while heroH < heroMin && h > max(50, tileMin + 2) {
                    h -= 4
                    heroH = budget - gaps - duoGaps - CGFloat(rows) * h
                }
                if heroH >= heroMin {
                    return (true, cols, rows, h, heroH, gaps, duoGaps)
                }
            }
            let rows = Int(ceil(Double(max(0, n - 1)) / 2.0))
            return (false, 2, max(1, rows), 60, heroMin, zoneGap, 0)
        }

        // 装不下就砍掉末尾一个（hero 永远保留）
        var shown = count
        var best = layoutFor(shown)
        while !best.ok && shown > 2 {
            shown -= 1
            best = layoutFor(shown)
        }

        var plan = LargePlan()
        plan.mode = .hero
        // iOS 按设计稿的做法：放不下就砍末尾模块，不按整行取整（Android 那边才做整行折叠）
        plan.shown = shown
        plan.hidden = count - shown
        plan.tileCols = best.cols

        // hero 超过一半就夹住，省下的高度平摊给瓦片
        var heroH = min(best.heroH, heroCap)
        var tileH = best.h
        if best.rows > 0 && best.heroH > heroCap {
            let duoGaps = best.rows > 1 ? CGFloat(best.rows - 1) * zoneGap : 0
            tileH = floor((budget - best.gaps - duoGaps - heroH) / CGFloat(best.rows))
        }
        plan.heroH = heroH
        plan.tileH = tileH

        // 明细行数由高度反算
        let heroPad: CGFloat = heroH < 120 ? 16 : 20
        let heroValue: CGFloat = heroH < 140 ? 34 : 44
        let heroBase = heroPad + 22 + heroValue + 13 + 8
        plan.heroRows = max(0, min(6, Int(floor((heroH - heroBase - 4) / detailLine))))

        let tileTop: CGFloat = tileH < 70 ? 10 : 14
        let tileBase = tileTop + 14 + 3 + 18
        plan.tileRows = 1 + max(0, min(4, Int(floor((tileH - tileBase - 4) / detailLine))))
        return plan
    }
}

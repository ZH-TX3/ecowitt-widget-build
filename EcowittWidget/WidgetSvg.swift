//
//  WidgetSvg.swift
//  EcowittWidget
//
//  SVG path 解析：把 payload 里 24×24 线描图标的 `d` 字符串变成 SwiftUI Path。
//
//  为什么不用 SF Symbols：设计稿的图标是手调的 24 网格线描（stroke 1.6、圆头圆角），
//  SF Symbols 的形状对不上（上一版风向箭头就吃过这个亏）。路径放进 payload 之后，
//  iOS 与 Android 画的是同一份形状，加一个图标也不用重编基座。
//
//  支持的命令：M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z。
//  圆弧（A）按 SVG 规范的端点参数化转成三次贝塞尔 —— 温度计、气压表、太阳都要用。
//

import SwiftUI

enum SVGPathParser {

    /// 解析结果的缓存：路径数据在进程内不变，没必要每帧重解析
    private static var cache: [String: [Path]] = [:]
    private static let lock = NSLock()

    /// 一个 `d` 字符串 → 若干子路径（24 坐标空间，未缩放）
    static func paths(from d: String) -> [Path] {
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[d] { return hit }
        var parser = Parser(d: d)
        let parsed = parser.run()
        cache[d] = parsed
        return parsed
    }
}

private struct Parser {
    let tokens: [(isCommand: Bool, value: Character, number: Double)]
    var index = 0
    var current = CGPoint.zero
    var start = CGPoint.zero
    var lastControl: CGPoint?

    init(d: String) {
        var out: [(Bool, Character, Double)] = []
        var number = ""
        var seenDot = false

        func flush() {
            if !number.isEmpty, let value = Double(number) {
                out.append((false, " ", value))
            }
            number = ""
            seenDot = false
        }

        for ch in d {
            // 只有 ASCII 字母才算命令：非 ASCII 字母（ß/ﬁ）uppercased() 会变成两个字符，
            // 后面 Character(String) 直接崩；科学计数法的 e 由下面 number 分支吃掉
            if ch.isASCII && ch.isLetter {
                flush()
                out.append((true, ch, 0))
            } else if ch.isNumber || ch == "." || ch == "-" || ch == "+" {
                // 不认科学计数法：字母一律当命令（设计稿的图标表里没有 1e-5 这种写法，
                // 真出现了会被 tests/widget-v4.test.mjs 的「图标只用 M/L/H/V/C/A/Z」那条抓住）
                // 负数紧跟在数字后面是新的数（"1-2" 是两个数）
                if (ch == "-" || ch == "+") && !number.isEmpty {
                    let lastChar = number.last!
                    if lastChar.isNumber || lastChar == "." { flush() }
                }
                if ch == "." {
                    if seenDot { flush() }
                    seenDot = true
                }
                number.append(ch)
            } else {
                flush()
            }
        }
        flush()
        tokens = out
    }

    mutating func run() -> [Path] {
        var paths: [Path] = []
        var path = Path()
        var open = false

        while index < tokens.count {
            let token = tokens[index]
            guard token.isCommand else {
                index += 1
                continue
            }
            let cmd = token.value
            index += 1
            let relative = cmd.isLowercase
            let upper = Character(cmd.uppercased())

            // 每个命令自己消耗若干数字；Z 不消耗
            switch upper {
            case "M":
                let p = point(relative)
                path.move(to: p)
                current = p
                start = p
                open = true
                lastControl = nil
                // 后续隐式坐标按 L 处理
                while hasNumber() {
                    let q = point(relative)
                    path.addLine(to: q)
                    current = q
                }
            case "L":
                while hasNumber() {
                    let q = point(relative)
                    path.addLine(to: q)
                    current = q
                    lastControl = nil
                }
            case "H":
                while hasNumber() {
                    let x = number()
                    let target = CGPoint(x: relative ? current.x + CGFloat(x) : CGFloat(x), y: current.y)
                    path.addLine(to: target)
                    current = target
                    lastControl = nil
                }
            case "V":
                while hasNumber() {
                    let y = number()
                    let target = CGPoint(x: current.x, y: relative ? current.y + CGFloat(y) : CGFloat(y))
                    path.addLine(to: target)
                    current = target
                    lastControl = nil
                }
            case "C":
                while hasNumber() {
                    let c1 = point(relative)
                    let c2 = point(relative)
                    let end = point(relative)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                }
            case "S":
                while hasNumber() {
                    let c2 = point(relative)
                    let end = point(relative)
                    let c1 = reflectedControl()
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                }
            case "Q":
                while hasNumber() {
                    let c = point(relative)
                    let end = point(relative)
                    path.addQuadCurve(to: end, control: c)
                    lastControl = c
                    current = end
                }
            case "T":
                while hasNumber() {
                    let end = point(relative)
                    let c = reflectedControl()
                    path.addQuadCurve(to: end, control: c)
                    lastControl = c
                    current = end
                }
            case "A":
                while hasNumber() {
                    let rx = number()
                    let ry = number()
                    let rotation = number()
                    let largeArc = number() != 0
                    let sweep = number() != 0
                    let end = point(relative)
                    appendArc(path: &path, rx: rx, ry: ry, rotation: rotation,
                              largeArc: largeArc, sweep: sweep, end: end)
                    current = end
                    lastControl = nil
                }
            case "Z":
                if open {
                    path.closeSubpath()
                    current = start
                }
                lastControl = nil
            default:
                break
            }
        }

        if open { paths.append(path) }
        return paths
    }

    private mutating func hasNumber() -> Bool {
        guard index < tokens.count else { return false }
        return !tokens[index].isCommand
    }

    private mutating func number() -> Double {
        guard index < tokens.count else { return 0 }
        let value = tokens[index].number
        index += 1
        return value
    }

    private mutating func point(_ relative: Bool) -> CGPoint {
        let x = CGFloat(number())
        let y = CGFloat(number())
        return relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
    }

    /// S / T 的隐含控制点：上一个控制点关于当前点的镜像
    private func reflectedControl() -> CGPoint {
        guard let last = lastControl else { return current }
        return CGPoint(x: current.x * 2 - last.x, y: current.y * 2 - last.y)
    }

    /// SVG 端点参数化圆弧 → 三次贝塞尔（规范 F.6）
    private func appendArc(path: inout Path, rx: CGFloat, ry: CGFloat, rotation: Double,
                           largeArc: Bool, sweep: Bool, end: CGPoint) {
        let x1 = current.x, y1 = current.y
        let x2 = end.x, y2 = end.y
        if x1 == x2 && y1 == y2 { return }
        var rx = abs(rx), ry = abs(ry)
        if rx == 0 || ry == 0 {
            path.addLine(to: end)
            return
        }

        let phi = CGFloat(rotation.truncatingRemainder(dividingBy: 360) * .pi / 180)
        let cosPhi = cos(phi), sinPhi = sin(phi)

        // 第一步：移到旋转后的坐标系
        let dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy

        // 半径过小就按比例放大（规范 F.6.6）
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let s = sqrt(lambda)
            rx *= s
            ry *= s
        }

        let sign: CGFloat = largeArc == sweep ? -1 : 1
        let numerator = max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p)
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let coef = denominator == 0 ? 0 : sign * sqrt(numerator / denominator)
        let cxp = coef * rx * y1p / ry
        let cyp = -coef * ry * x1p / rx

        let cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

        // 第二步：起止角
        let angle = { (ux: CGFloat, uy: CGFloat, vx: CGFloat, vy: CGFloat) -> CGFloat in
            let dot = ux * vx + uy * vy
            let len = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
            guard len > 0 else { return 0 }
            var a = acos(max(-1, min(1, dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }

        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        // 每段不超过 90°，避免贝塞尔近似失真
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let k = 4 / 3 * tan(step / 4)

        var t = theta1
        var point = CGPoint(
            x: cx + rx * cosPhi * cos(t) - ry * sinPhi * sin(t),
            y: cy + rx * sinPhi * cos(t) + ry * cosPhi * sin(t)
        )
        for _ in 0..<segments {
            let t2 = t + step
            let p2 = CGPoint(
                x: cx + rx * cosPhi * cos(t2) - ry * sinPhi * sin(t2),
                y: cy + rx * sinPhi * cos(t2) + ry * cosPhi * sin(t2)
            )
            let d1 = CGPoint(
                x: -rx * cosPhi * sin(t) - ry * sinPhi * cos(t),
                y: -rx * sinPhi * sin(t) + ry * cosPhi * cos(t)
            )
            let d2 = CGPoint(
                x: -rx * cosPhi * sin(t2) - ry * sinPhi * cos(t2),
                y: -rx * sinPhi * sin(t2) + ry * cosPhi * cos(t2)
            )
            path.addCurve(
                to: p2,
                control1: CGPoint(x: point.x + k * d1.x, y: point.y + k * d1.y),
                control2: CGPoint(x: p2.x - k * d2.x, y: p2.y - k * d2.y)
            )
            point = p2
            t = t2
        }
    }
}

/// 把 24×24 坐标空间的若干子路径，等比缩放进给定 rect 并居中
struct SVGShape: Shape {
    let paths: [Path]
    let viewBox: CGFloat

    init(d: String, viewBox: CGFloat = 24) {
        self.paths = SVGPathParser.paths(from: d)
        self.viewBox = viewBox
    }

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / viewBox
        let offsetX = (rect.width - viewBox * scale) / 2
        let offsetY = (rect.height - viewBox * scale) / 2
        var out = Path()
        for path in paths {
            // addPath(_:transform:) 从 iOS 13 就有；Path.applying(_:) 是高版本 API，别用
            let transform = CGAffineTransform(scaleX: scale, y: scale)
                .concatenating(CGAffineTransform(translationX: offsetX, y: offsetY))
            out.addPath(path, transform: transform)
        }
        return out
    }
}

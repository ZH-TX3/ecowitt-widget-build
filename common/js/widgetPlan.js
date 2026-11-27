/**
 * large 的布局决策 —— 纯函数，只算「几列、每块多高、每块几行明细」。
 *
 * 三处实现必须同构（DESIGN-SPEC-v4 第 5 节）：
 *   docx/Ecowitt-Widgets-v4.html  planLarge()     设计稿原型
 *   common/js/widgetPlan.js       本文件           预览 / 设置页
 *   EcowittWidget/WidgetPlan.swift iOS             budget 由 GeometryReader 实测
 *   hybric.kt (Kotlin)            Android         budget 取 payload 的 shape.plan
 *
 * 改这里要同时改 Swift 与 Kotlin，并把实测值写回规范第 5 节的表。
 */

import { LARGE_PLAN } from './widgetDesign.js'

/** 明细行高度（字号 8 + 行距 2 + 余量），实测标定 */
const DETAIL_LINE = 13

/** 瓦片起始行高，逐档 4px 往下压 */
const TILE_START = 88

/**
 * @param {number} count     模块数（hero 也算在里面）
 * @param {object} [options]
 * @param {number} [options.budget]  内容区可用高度；不给就用标定值
 * @returns {{mode:string, shown:number, hidden:number, heroH:number, tileH:number, cols:number, heroRows:number, tileRows:number, total:number}}
 */
export function planLarge(count, options = {}) {
	const budget = Math.max(80, options.budget || LARGE_PLAN.budget)
	const zoneGap = options.zoneGap || LARGE_PLAN.zoneGap
	const heroCap = options.heroCap || Math.floor(budget / 2)
	const tileMin = options.tileMin || LARGE_PLAN.tileMin
	const heroMin = options.heroMin || LARGE_PLAN.heroMin

	const plan = {
		mode: 'hero',
		shown: 0,
		hidden: 0,
		heroH: 0,
		tileH: 0,
		cols: 2,
		heroRows: 0,
		tileRows: 1,
		total: 0
	}
	if (count <= 0) return plan

	// 只有两个模块：不分 hero / 瓦片，两块等分
	if (count === 2) {
		const h = Math.floor((budget - zoneGap) / 2)
		const base = 20 + 22 + 34 + 13 + 8
		return {
			...plan,
			mode: 'pair',
			shown: 2,
			heroH: h,
			cols: 1,
			// 左栏 = 数值 + 极值 + 明细；这个高度只放得下 2 行
			heroRows: Math.max(1, Math.min(2, Math.floor((h - base - 4) / DETAIL_LINE))),
			total: h * 2 + zoneGap
		}
	}

	/** 试一种能放下的方案：2 列优先，不行换 3 列 */
	const layoutFor = (n) => {
		const tiles = Math.max(0, n - 1)
		const gaps = tiles > 0 ? zoneGap : 0
		for (const cols of [2, 3]) {
			const rows = tiles > 0 ? Math.ceil(tiles / cols) : 0
			const duoGaps = rows > 1 ? (rows - 1) * zoneGap : 0
			let h = TILE_START
			let heroH = budget - gaps - duoGaps - rows * h
			// 先把 hero 拉回 96 以上（压瓦片），再不行就接受 heroMin
			while (heroH < 96 && h > 58) {
				h -= 4
				heroH = budget - gaps - duoGaps - rows * h
			}
			while (heroH < heroMin && h > Math.max(50, tileMin + 2)) {
				h -= 4
				heroH = budget - gaps - duoGaps - rows * h
			}
			if (heroH >= heroMin) return { ok: true, cols, rows, h, heroH, gaps, duoGaps }
		}
		return {
			ok: false,
			cols: 2,
			rows: Math.max(1, Math.ceil(Math.max(0, n - 1) / 2)),
			h: 60,
			heroH: heroMin,
			gaps: zoneGap,
			duoGaps: 0
		}
	}

	// 装不下就砍掉末尾一个（hero 永远保留）
	let shown = count
	let best = layoutFor(shown)
	while (!best.ok && shown > 2) {
		shown -= 1
		best = layoutFor(shown)
	}

	// hero 超过一半就夹住，省下的高度平摊给瓦片
	const heroH = Math.min(best.heroH, heroCap)
	let tileH = best.h
	if (best.rows > 0 && best.heroH > heroCap) {
		const duoGaps = best.rows > 1 ? (best.rows - 1) * zoneGap : 0
		tileH = Math.floor((budget - best.gaps - duoGaps - heroH) / best.rows)
	}

	// 明细行数由高度反算
	const heroPad = heroH < 120 ? 16 : 20
	const heroValue = heroH < 140 ? 34 : 44
	const heroRows = Math.max(
		0,
		Math.min(6, Math.floor((heroH - (heroPad + 22 + heroValue + 13 + 8) - 4) / DETAIL_LINE))
	)
	const tileTop = tileH < 70 ? 10 : 14
	const tileRows =
		1 + Math.max(0, Math.min(4, Math.floor((tileH - (tileTop + 14 + 3 + 18) - 4) / DETAIL_LINE)))

	const rows = best.rows
	const duoGaps = rows > 1 ? (rows - 1) * zoneGap : 0
	return {
		mode: 'hero',
		shown,
		hidden: count - shown,
		heroH,
		tileH,
		cols: best.cols,
		heroRows,
		tileRows,
		total: heroH + best.gaps + duoGaps + rows * tileH
	}
}

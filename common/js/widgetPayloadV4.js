/**
 * 小组件 payload v4 —— 模块 / 读数驱动契约
 *
 * 与 v3 的区别：v3 一张卡 = 一个参数，large 是硬编码的七块格子。表达不了
 * 「一个传感器出两条读数」（室外温度 + 湿度）、「同量多维度」（气压相对/绝对/海平面）、
 * 「格子里哪些是明细」这些结构。v4 换成：
 *
 *   module  = 一个传感器（室外 / 室内 / 风 / 雨 / 气压 / 日照 / UV / CO₂ / 雷电 / 电池）
 *   reading = 这个传感器下可以被「突出」的一条读数（温度、湿度、风速、阵风…）
 *
 * small / medium 取「一条突出读数」，large 取「全部模块，每模块用自己的突出读数」。
 * 变化量、极值、附带项**都属于读数**，不属于模块 —— 室外温度与湿度各有各的极值。
 *
 * 分工仍然照旧：payload 只带数据与 token，布局骨架画死在原生里
 * （Swift: EcowittWidgetViews.swift，Android: hybric.kt + res/layout）。
 *
 * 契约里所有「文案 / 单位 / 数字」都是**格式化好的字符串**。原生不做换算、不做翻译。
 */

import {
	SHAPE,
	DETAIL,
	CHART,
	TEXT_SHRINK,
	WIDGET_CANVAS,
	FONT_SCALE,
	LARGE_PLAN,
	UV_SCALE,
	ICONS,
	featureUidOf,
	resolveTheme,
	typographyPayload
} from './widgetDesign.js'
import {
	DEFAULT_UNITS,
	numberText,
	unitOf,
	directionText,
	timeText,
	timeFullText,
	axisText
} from './widgetFormat.js'
import { windowSeries } from './widgetFixture.js'

export const WIDGET_SCHEMA_V4 = 4

/**
 * 趋势窗口固定 24 小时。
 * v3 有「1H / 6H / 24H / 7D」切换，v4 把它砍了：卡片上没有时间范围筛选，
 * medium 与 hero 的曲线永远画最近 24 小时，底栏写死 Last 24h。
 * 这样 payload 少一个可变维度，两端的布局预算也不用跟着范围变。
 */
export const WIDGET_RANGE_HOURS = 24

/** 24 小时制 H:mm，进极值行 */
function clockText(timestamp) {
	if (!timestamp) return ''
	return timeText(timestamp)
}

const LABELS = {
	en: {
		brand: 'ecowitt',
		fallbackStation: 'Weather Station',
		outdoor: 'Outdoor',
		indoor: 'Indoor',
		wind: 'Wind',
		rainfall: 'Rainfall',
		pressure: 'Pressure',
		solar: 'Solar',
		sun: 'Sun',
		uv: 'UV index',
		co2: 'CO₂',
		co2Pm: 'CO₂ / PM',
		co2TempHumi: 'CO₂ / T&H',
		lightning: 'Lightning',
		battery: 'Battery',
		temperature: 'Temperature',
		humidity: 'Humidity',
		speed: 'Speed',
		gust: 'Gust',
		rate: 'Rate',
		piezo: 'Piezo rain',
		relative: 'Relative',
		absolute: 'Absolute',
		seaLevel: 'Sea level',
		radiation: 'Radiation',
		level: 'Level',
		aqi: 'AQI combo',
		strikes: 'Strikes',
		volt: 'Voltage',
		dewPoint: 'Dew point',
		vpd: 'VPD',
		direction: 'Direction',
		maxGust: 'Max gust',
		daily: 'Daily',
		hourly: 'Hourly',
		day24: '24h',
		week: 'Week',
		month: 'Month',
		sunrise: 'Sunrise',
		sunset: 'Sunset',
		maxToday: 'Max today',
		threshold: 'Threshold',
		avg24: '24h avg',
		status: 'Status',
		last1h: 'Last 1h',
		today: 'Today',
		closest: 'Closest',
		from: 'From',
		raining: 'Raining',
		dry: 'Dry',
		normal: 'Normal',
		online: 'Online',
		offline: 'Offline',
		stale: 'Stale',
		notConnected: 'Not connected',
		demo: 'Demo',
		fixture: 'Test fixture',
		simulated: 'Simulated data',
		noObservation: 'No observation',
		noHistory: 'No data',
		noTrend: 'No generated trend',
		last24h: 'Last 24h',
		dayN: '{n} day'
	},
	zh: {
		brand: 'ecowitt',
		fallbackStation: '气象站',
		outdoor: '室外',
		indoor: '室内',
		wind: '风速',
		rainfall: '雨量',
		pressure: '气压',
		solar: '日照',
		sun: '日照',
		uv: 'UV 指数',
		co2: 'CO₂',
		co2Pm: 'CO₂ / PM',
		co2TempHumi: 'CO₂ 温湿度',
		lightning: '雷电',
		battery: '电池',
		temperature: '温度',
		humidity: '湿度',
		speed: '风速',
		gust: '阵风',
		rate: '强度',
		piezo: '压电雨量',
		relative: '相对',
		absolute: '绝对',
		seaLevel: '海平面',
		radiation: '辐射',
		level: '等级',
		aqi: 'AQI 组合',
		strikes: '次数',
		volt: '电压',
		dewPoint: '露点',
		vpd: 'VPD',
		direction: '风向',
		maxGust: '最大阵风',
		daily: '日累计',
		hourly: '小时',
		day24: '24 小时',
		week: '本周',
		month: '本月',
		sunrise: '日出',
		sunset: '日落',
		maxToday: '今日最高',
		threshold: '阈值',
		avg24: '24h 均值',
		status: '状态',
		last1h: '最近 1 小时',
		today: '今日',
		closest: '最近',
		from: '来自',
		raining: '降雨中',
		dry: '无雨',
		normal: '正常',
		online: '在线',
		offline: '离线',
		stale: '数据过期',
		notConnected: '未连接',
		demo: '演示',
		fixture: '测试数据',
		simulated: '模拟数据',
		noObservation: '暂无观测',
		noHistory: '暂无数据',
		noTrend: '暂无趋势',
		last24h: '最近 24 小时',
		dayN: '{n} 天'
	}
}

function dict(lang) {
	return lang === 'zh' ? LABELS.zh : LABELS.en
}

// ---------------------------------------------------------------------------
// 读数工具
// ---------------------------------------------------------------------------

/**
 * 读数单元（cell）：数据源已经把值格式化好、单位带出来时用它。
 *
 * 形状 `{ text, unit, raw, delta, peak }`，每一项都可缺：
 *   text  —— 显示文本（后端给的，直通，不再换算）
 *   unit  —— 单位文本（后端给的，直通）
 *   raw   —— 原始数值（画刻度、算比例、判档用）
 *   delta —— `{ dir, value }`，数据源算好的变化量
 *   peak  —— `{ max: { value, time }, min: { value, time } }`，数据源算好的极值
 *
 * 纯数字 = 旧路径（内置 fixture、历史序列）：仍由 widgetFormat 换算 + 格式化。
 * 两条路并存，是因为数据源本来就有两种：合成数据没有单位概念，接口数据有。
 */
function cellOf(value) {
	if (value == null) return null
	if (typeof value === 'object') return value
	return isFinite(Number(value)) ? { raw: Number(value) } : null
}

/** 原始数值，缺值 null */
function rawOf(value) {
	const cell = cellOf(value)
	return cell == null || cell.raw == null ? null : Number(cell.raw)
}

/** 显示文本：数据源给了就直通，没给就用 fallback(raw) 现算 */
function tv(value, fallback) {
	const cell = cellOf(value)
	if (cell == null) return null
	if (cell.text != null) return String(cell.text)
	if (cell.raw == null) return null
	return fallback(Number(cell.raw))
}

/** 单位文本：数据源给了就直通，没给就用 fallback */
function unitText(value, fallback) {
	const cell = cellOf(value)
	if (cell != null && cell.unit != null && cell.unit !== '') return String(cell.unit)
	return fallback
}

/**
 * 模块名：优先用后端给的名字（`reading.moduleTitles`，来自 dashboard 卡片的 title，
 * 已按用户语言返回），没有才退回内置文案。LABELS 在这一层只当兜底。
 */
function mlabel(r, key, fallback) {
	const titles = r && r.moduleTitles
	const hit = titles ? titles[key] : null
	return hit ? String(hit) : fallback
}

/**
 * 读数名 / 明细行名：优先用后端信封的 `title`（`reading.readingTitles`，键是 uid），
 * 没有才退回内置文案。跟模块名同一套规矩 —— 后端叫什么就显示什么。
 */
function tl(r, uid, fallback) {
	const titles = r && r.readingTitles
	const hit = titles ? titles[uid] : null
	return hit ? String(hit) : fallback
}

/** 显示单位下的数值文本；delta = true 时温标只做斜率换算 */
function nv(value, parameter, units, delta) {
	if (cellOf(value) == null) return numberText(null, parameter, units, !!delta)
	return tv(value, (raw) => numberText(raw, parameter, units, !!delta))
}

/** 单位文本，优先用数据源带来的单位 */
function vu(value, parameter, units, history) {
	return unitText(value, unitOf(parameter, units, !!history))
}

/** 数据源直接给好的极值；没给就返回 null，**不**回落计算 */
function sourcePeak(value) {
	const cell = cellOf(value)
	return cell != null && cell.peak ? cell.peak : null
}

/** 极值：数据源给了就用，否则按历史序列算 */
function pv(value, points, hours, now, parameter, units, withMin) {
	return sourcePeak(value) || peakOf(points, hours, now, parameter, units, withMin)
}

/** 变化量：数据源给了就用，否则按历史序列算 */
function dv(value, points, hours, now, parameter, units) {
	const cell = cellOf(value)
	if (cell != null && cell.delta) return cell.delta
	return deltaOf(points, hours, now, parameter, units, rawOf(value))
}

/** 一行明细：值为空就整行丢掉，不留「—」占位 */
function row(label, value, unit) {
	if (value == null || value === '' || value === '—') return null
	return { label, value: String(value), unit: unit == null ? '' : String(unit) }
}

function rowsCompact(list) {
	return list.filter(Boolean)
}

/**
 * 取一条历史序列。
 *
 * 键是 uid（`outdoor.temperature`），与 payload 的 `module.reading` 同一套命名 ——
 * 这样 `wind.speed` / `wind.gust`、`pressure.relative` / `.absolute` 各有各的曲线，
 * 多通道（`tempHumi1.temperature`）也不用再改结构。
 *
 * 值既可以是裸的点数组（内置 fixture），也可以是 `{ unit, points }`（接口返回）：
 * 点的形状统一是 `[ts(ms), value]`。
 */
function histOf(hist, uid) {
	const entry = hist ? hist[uid] : null
	if (!entry) return []
	const points = Array.isArray(entry) ? entry : entry.points || []
	// 点两种写法都收：[ts, value] 走接口，{t, v} 走 fixture
	return points.map((p) => (Array.isArray(p) ? { t: Number(p[0]), v: Number(p[1]) } : p))
}

/** 窗口内的趋势，抽稀到 ≤28 点（数值已是展示单位，不再换算） */
function seriesOf(points, hours, now) {
	if (!points || !points.length) return null
	const picked = windowSeries(points, hours, now, 28)
	if (picked.length < 2) return null
	return picked.map((p) => [p.t, Number(Number(p.v).toFixed(2))])
}

/** 同一窗口里的原始点（做极值 / 变化量用，保持基准单位） */
function windowOf(points, hours, now) {
	if (!points || !points.length) return null
	const start = now - hours * 3600 * 1000
	const inWindow = points.filter((p) => p.t >= start && p.t <= now)
	return inWindow.length ? inWindow : null
}

/**
 * 极值：取窗口内的最大 / 最小。
 * 只有单向语义的量（当日最大风速、当日最大 UV、AQI）传 withMin = false，
 * 否则界面会出现一个没有意义的「最低」。
 */
function peakOf(points, hours, now, parameter, units, withMin) {
	const w = windowOf(points, hours, now)
	if (!w || !w.length) return null
	let hi = w[0]
	let lo = w[0]
	w.forEach((p) => {
		if (p.v > hi.v) hi = p
		if (p.v < lo.v) lo = p
	})
	const peak = {
		max: { value: nv(hi.v, parameter, units), time: clockText(hi.t) }
	}
	if (withMin && lo.v !== hi.v) peak.min = { value: nv(lo.v, parameter, units), time: clockText(lo.t) }
	return peak
}

/**
 * 变化量：当前值与 N 小时前最近一点之差。
 * 温差只做斜率换算，不带 32 偏移。
 */
function deltaOf(points, hours, now, parameter, units, current) {
	const w = windowOf(points, hours, now)
	if (!w || !w.length || current == null) return null
	const target = now - hours * 3600 * 1000
	let best = w[0]
	let bestGap = Math.abs(best.t - target)
	w.forEach((p) => {
		const gap = Math.abs(p.t - target)
		if (gap < bestGap) {
			bestGap = gap
			best = p
		}
	})
	const diff = Number(current) - best.v
	const shown = Number(nv(Math.abs(diff), parameter, units, true))
	if (!isFinite(shown)) return null
	return { dir: Math.abs(diff) < 0.05 ? 0 : diff > 0 ? 1 : -1, value: shown.toFixed(shown < 10 ? 1 : 0) }}

/** 一个模块里的「其它维度」摘要，供瓦片的明细行使用 */
function peersOf(readings, self) {
	return readings
		.filter((r) => r.key !== self.key)
		.map((r) => row(r.label, r.value, r.unit))
		.filter(Boolean)
}

/** 附带项：同一模块的另一条读数优先，没有就用模块 rows[0] */
function attachOf(readings, self, rows) {
	const other = readings.filter((r) => r.key !== self.key)[0]
	if (other) return { label: other.label, value: other.value, unit: other.unit }
	return rows[0] ? { label: rows[0].label, value: rows[0].value, unit: rows[0].unit } : null
}

/**
 * 组装一条读数：把「派生字段」（变化量 / 极值 / 附带项 / 明细行）一次算完，
 * 原生只做摆位，不做判断。附带项与明细行都去掉重复的 label。
 */
function reading(spec, ctx) {
	const { readings, moduleRows } = ctx
	const out = {
		key: spec.key,
		label: spec.label,
		value: spec.value,
		unit: spec.unit == null ? '' : spec.unit,
		accent: spec.accent,
		small: !!spec.small,
		visual: spec.visual || null,
		delta: spec.delta || null,
		peak: spec.peak || null,
		state: spec.state || null,
		stateSlot: !!spec.stateSlot,
		attachText: spec.attachText || null
	}
	const attach = spec.attachText ? null : attachOf(readings, out, moduleRows)
	out.attach = attach
	const peers = peersOf(readings, out)
	out.lines = peers.concat(moduleRows.filter((r) => !peers.some((p) => p.label === r.label)))
	return out
}

// ---------------------------------------------------------------------------
// 十个模块
// ---------------------------------------------------------------------------

/**
 * 每个 builder 返回 null 表示「这台设备没有这个传感器」。
 * 判据统一：主读数没有值就不出现 —— 缺数据时宁可不显示，也不要一格空壳。
 */
function buildOutdoor(r, hist, units, L, now, hours) {
	if (r.outdoorCelsius == null && r.outdoorHumidity == null) return null
	const tempSeries = histOf(hist, 'outdoor.temperature')
	const humSeries = histOf(hist, 'outdoor.humidity')
	const readings = []

	if (r.outdoorCelsius != null) {
		readings.push({
			key: 'temperature',
			label: tl(r, 'outdoor.temperature', L.temperature),
			value: nv(r.outdoorCelsius, 'temperature', units),
			unit: vu(r.outdoorCelsius, 'temperature', units),
			accent: 'temp',
			visual: { kind: 'glyph', icon: 'temperature' },
			delta: dv(r.outdoorCelsius, tempSeries, 1, now, 'temperature', units),
			peak: pv(r.outdoorCelsius, tempSeries, 24, now, 'temperature', units, true)
		})
	}
	if (r.outdoorHumidity != null) {
		readings.push({
			key: 'humidity',
			label: tl(r, 'outdoor.humidity', L.humidity),
			value: nv(r.outdoorHumidity, 'humidity', units),
			unit: vu(r.outdoorHumidity, 'humidity', units),
			accent: 'water',
			visual: { kind: 'ring', fill: Math.round(rawOf(r.outdoorHumidity)), icon: 'humidity' },
			peak: pv(r.outdoorHumidity, humSeries, 24, now, 'humidity', units, true)
		})
	}

	const rows = rowsCompact([
		row(tl(r, 'outdoor.dewPoint', L.dewPoint), nv(r.dewPointCelsius, 'temperature', units), vu(r.dewPointCelsius, 'temperature', units)),
		row(tl(r, 'outdoor.vpd', L.vpd), tv(r.vpdKPa, (v) => v.toFixed(2)), unitText(r.vpdKPa, 'kPa'))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'outdoor',
		label: mlabel(r, 'outdoor', L.outdoor),
		icon: 'temperature',
		accent: 'temp',
		series: seriesOf(tempSeries, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildIndoor(r, hist, units, L, now, hours) {
	if (r.indoorCelsius == null && r.indoorHumidity == null) return null
	const tempSeries = histOf(hist, 'indoor.temperature')
	const readings = []

	if (r.indoorCelsius != null) {
		readings.push({
			key: 'temperature',
			label: tl(r, 'indoor.temperature', L.temperature),
			value: nv(r.indoorCelsius, 'temperature', units),
			unit: vu(r.indoorCelsius, 'temperature', units),
			accent: 'temp',
			visual: { kind: 'glyph', icon: 'house' },
			delta: dv(r.indoorCelsius, tempSeries, 1, now, 'temperature', units),
			peak: pv(r.indoorCelsius, tempSeries, 24, now, 'temperature', units, true)
		})
	}
	if (r.indoorHumidity != null) {
		readings.push({
			key: 'humidity',
			label: tl(r, 'indoor.humidity', L.humidity),
			value: nv(r.indoorHumidity, 'humidity', units),
			unit: vu(r.indoorHumidity, 'humidity', units),
			accent: 'water',
			visual: { kind: 'ring', fill: Math.round(rawOf(r.indoorHumidity)), icon: 'humidity' },
			peak: pv(r.indoorHumidity, histOf(hist, 'indoor.humidity'), 24, now, 'humidity', units, true)
		})
	}

	const rows = rowsCompact([
		row(tl(r, 'indoor.dewPoint', L.dewPoint), nv(r.indoorDewPointCelsius, 'temperature', units), vu(r.indoorDewPointCelsius, 'temperature', units)),
		row(tl(r, 'indoor.humidity', L.humidity), nv(r.indoorHumidity, 'humidity', units), vu(r.indoorHumidity, 'humidity', units))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'indoor',
		label: mlabel(r, 'indoor', L.indoor),
		icon: 'house',
		accent: 'temp',
		series: seriesOf(tempSeries, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildWind(r, hist, units, L, now, hours) {
	if (r.windKPH == null && r.gustKPH == null) return null
	const series = histOf(hist, 'wind.speed')
	const bearing = r.windDegrees == null ? null : (rawOf(r.windDegrees) + 180) % 360
	const dir = r.windDirectionText || directionText(rawOf(r.windDegrees))
	const readings = []

	if (r.windKPH != null) {
		readings.push({
			key: 'speed',
			label: tl(r, 'wind.speed', L.speed),
			value: nv(r.windKPH, 'wind', units),
			unit: vu(r.windKPH, 'wind', units),
			accent: 'wind',
			visual: bearing == null ? { kind: 'glyph', icon: 'wind' } : { kind: 'dial', icon: 'arrow', bearing },
			delta: dv(r.windKPH, series, 1, now, 'wind', units),
			// 当日极值取「最大阵风」：风速本身的窗口最大值没有意义
			peak:
				sourcePeak(r.windKPH) ||
				(r.maxGustKPH != null
					? { max: { value: nv(r.maxGustKPH, 'wind', units), time: '' } }
					: peakOf(series, 24, now, 'wind', units, false)),
			attachText:
				r.windDegrees == null
					? tl(r, 'wind.gust', L.gust) + ' ' + nv(r.gustKPH, 'wind', units) + ' ' + vu(r.gustKPH, 'wind', units)
					: L.from + ' ' + dir + ' · ' + tl(r, 'wind.gust', L.gust) + ' ' + nv(r.gustKPH, 'wind', units)
		})
	}
	if (r.gustKPH != null) {
		readings.push({
			key: 'gust',
			label: tl(r, 'wind.gust', L.gust),
			value: nv(r.gustKPH, 'wind', units),
			unit: vu(r.gustKPH, 'wind', units),
			accent: 'wind',
			visual: bearing == null ? { kind: 'glyph', icon: 'wind' } : { kind: 'dial', icon: 'arrow', bearing },
			attachText:
				r.windDegrees == null
					? tl(r, 'wind.speed', L.speed) + ' ' + nv(r.windKPH, 'wind', units)
					: L.from + ' ' + dir + ' · ' + tl(r, 'wind.speed', L.speed) + ' ' + nv(r.windKPH, 'wind', units)
		})
	}

	const rows = rowsCompact([
		row(tl(r, 'wind.direction', L.direction), r.windDegrees == null ? null : dir, ''),
		row(tl(r, 'wind.gust', L.gust), nv(r.gustKPH, 'wind', units), vu(r.gustKPH, 'wind', units)),
		row(tl(r, 'wind.maxGust', L.maxGust), nv(r.maxGustKPH, 'wind', units), vu(r.maxGustKPH, 'wind', units))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'wind',
		label: mlabel(r, 'wind', L.wind),
		icon: 'wind',
		accent: 'wind',
		series: seriesOf(series, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/** 雨量累计：从历史序列按窗口求和，算不出来就整行不显示 */
function rainTotals(r, hist, uid, unit, now, L, dailyRow) {
	const points = histOf(hist, uid)
	if (!points.length) return rowsCompact([dailyRow])
	const sum = (hours) => {
		const w = windowOf(points, hours, now)
		if (!w || w.length < 2) return null
		// 15 分钟一个点，求和近似累计
		const total = w.reduce((acc, p) => acc + p.v, 0) / 4
		return total.toFixed(1)
	}
	return rowsCompact([
		dailyRow,
		row(tl(r, uid.replace(/\.rate$/, '.hourly'), L.hourly), sum(1), unit),
		row(tl(r, uid.replace(/\.rate$/, '.day24'), L.day24), sum(24), unit),
		row(tl(r, uid.replace(/\.rate$/, '.week'), L.week), sum(168), unit)
	])
}

/**
 * 雨量：翻斗（rainratein / dailyrainin）与压电（rrain_piezo / drain_piezo）
 * 在 dashboard 上是两张**不同的卡片**——同一个 dash-rain 组件、不同 id 映射过来。
 * 所以这里也是两个独立的模块，只是共用同一份实现：
 * 每个模块在自己的传感器下提供 rate / daily 两个维度。
 */
function makeRainBuilder(spec) {
	return function buildRain(r, hist, units, L, now, hours) {
		const rate = r[spec.rateField]
		const daily = r[spec.dailyField]
		if (rate == null && daily == null) return null

		const rateUid = spec.uid + '.rate'
		const dailyUid = spec.uid + '.daily'
		const rainState = r.rainState === true || r.rainState === 'raining' ? L.raining : null
		const series = histOf(hist, rateUid)
		const rateUnit = unitText(rate, unitOf('rainfall', units))
		const dailyUnit = unitText(daily, unitOf('rainfall', units, true))
		const bars = (points) => {
			const w = windowOf(points, 6 * 60, now) || []
			const tail = w.slice(-7).map((p) => Number(Number(p.v).toFixed(2)))
			return tail.length >= 3 ? { kind: 'bars', values: tail } : { kind: 'glyph', icon: 'rainfall' }
		}
		const readings = []

		if (rate != null) {
			readings.push({
				key: 'rate',
				label: tl(r, rateUid, L.rate),
				value: nv(rate, 'rainfall', units),
				unit: rateUnit,
				accent: 'water',
				// 小卡右侧是状态槽：有状态显示状态，没状态就留空（不退回图标）
				stateSlot: true,
				state: rainState,
				visual: bars(series),
				delta: dv(rate, series, 1, now, 'rainfall', units),
				attachText:
					daily == null
						? null
						: tl(r, dailyUid, L.daily) + ' ' + nv(daily, 'rainfall', units) + ' ' + dailyUnit
			})
		}
		if (daily != null) {
			readings.push({
				key: 'daily',
				label: tl(r, dailyUid, L.daily),
				value: nv(daily, 'rainfall', units),
				unit: dailyUnit,
				accent: 'water',
				visual: bars(series),
				attachText:
					rate == null
						? null
						: tl(r, rateUid, L.rate) + ' ' + nv(rate, 'rainfall', units) + ' ' + rateUnit
			})
		}

		const rows = rainTotals(
			r,
			hist,
			rateUid,
			dailyUnit,
			now,
			L,
			row(tl(r, dailyUid, L.daily), nv(daily, 'rainfall', units), dailyUnit)
		)
		const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
		return {
			key: spec.key,
			label: mlabel(r, spec.key, L[spec.labelKey]),
			icon: 'rainfall',
			accent: 'water',
			series: seriesOf(series, hours, now),
			rows,
			compact: null,
			compactLabel: null,
			readings: readings.map((s) => reading(s, ctx))
		}
	}
}

function buildPressure(r, hist, units, L, now, hours) {
	const relative = r.relativePressureHPA
	const absolute = r.absolutePressureHPA
	const sea = r.seaLevelPressureHPA
	if (relative == null && absolute == null && sea == null) return null
	const series = histOf(hist, 'pressure.relative')
	// 960~1050 hPa 映射到半圆刻度：低于 960 到底、高于 1050 到顶
	const ratio = (v) => Math.max(0, Math.min(1, (Number(v) - 960) / 90))
	const readings = []

	if (relative != null) {
		readings.push({
			key: 'relative',
			label: tl(r, 'pressure.relative', L.relative),
			value: nv(relative, 'pressure', units),
			unit: vu(relative, 'pressure', units),
			accent: 'pressure',
			// 四位数值，数值与小卡都降一档字
			small: true,
			visual: { kind: 'gauge', ratio: ratio(rawOf(relative)) },
			delta: dv(relative, series, 3, now, 'pressure', units),
			peak: pv(relative, series, 24, now, 'pressure', units, true)
		})
	}
	if (absolute != null) {
		readings.push({
			key: 'absolute',
			label: tl(r, 'pressure.absolute', L.absolute),
			value: nv(absolute, 'pressure', units),
			unit: vu(absolute, 'pressure', units),
			accent: 'pressure',
			small: true,
			visual: { kind: 'gauge', ratio: ratio(rawOf(absolute)) }
		})
	}
	if (sea != null) {
		readings.push({
			key: 'sealevel',
			label: tl(r, 'pressure.sealevel', L.seaLevel),
			value: nv(sea, 'pressure', units),
			unit: vu(sea, 'pressure', units),
			accent: 'pressure',
			small: true,
			visual: { kind: 'gauge', ratio: ratio(rawOf(sea)) }
		})
	}

	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: [] }
	return {
		key: 'pressure',
		label: mlabel(r, 'pressure', L.pressure),
		icon: 'pressure',
		accent: 'pressure',
		series: seriesOf(series, hours, now),
		rows: [],
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * 日照卡（dash-solar）：辐射、UV 指数是同一张卡上的两个维度，
 * 所以就是一个模块、两条读数 —— 用户在大卡里选要展示哪一条。
 */
function buildSolar(r, hist, units, L, now, hours) {
	const sun = r.solarWM2
	const uv = r.uvIndex
	if (sun == null && uv == null) return null

	const sunSeries = histOf(hist, 'solar.radiation')
	const uvSeries = histOf(hist, 'solar.index')
	const readings = []

	if (sun != null) {
		readings.push({
			key: 'radiation',
			label: tl(r, 'solar.radiation', L.radiation),
			value: tv(sun, (v) => String(Math.round(v))),
			unit: unitText(sun, 'W/m²'),
			accent: 'sun',
			visual: { kind: 'sun', icon: 'sun' },
			peak: pv(sun, sunSeries, 24, now, 'solar', units, false)
		})
	}
	if (uv != null) {
		readings.push({
			key: 'index',
			label: tl(r, 'solar.index', L.level),
			value: tv(uv, (v) => v.toFixed(1)),
			unit: unitText(uv, ''),
			accent: 'sun',
			// UV 指数 11 封顶，光谱条长度固定
			visual: { kind: 'uv', pos: Math.round(Math.min(1, rawOf(uv) / 11) * 100) },
			peak: pv(uv, uvSeries, 24, now, 'solar', units, false)
		})
	}

	const sunrise = r.sunriseText || null
	const sunset = r.sunsetText || null
	const rows = rowsCompact([
		row(tl(r, 'solar.sunrise', L.sunrise), sunrise, ''),
		row(tl(r, 'solar.sunset', L.sunset), sunset, ''),
		row(L.level, r.uvLevelText, ''),
		row(tl(r, 'solar.maxToday', L.maxToday), r.uvMaxToday, '')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'solar',
		label: mlabel(r, 'solar', L.solar),
		icon: 'sun',
		accent: 'sun',
		// 模块曲线跟辐射走；只有 UV 时退回 UV
		series: seriesOf(sun != null ? sunSeries : uvSeries, hours, now),
		rows,
		// 成对读数的单行摘要：日出 → 日落
		compact: sunrise && sunset ? sunrise + ' → ' + sunset : null,
		compactLabel: L.sun,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * CO₂ 浓度：对应 dashboard 的 dash-co2 卡片（浓度 / 24h 均值）。
 * PM2.5 与 AQI 是另一张卡（dash-co2-pm），拆成 co2Pm 模块 —— 一张卡一个模块。
 */
function buildCo2(r, hist, units, L, now, hours) {
	const ppm = r.co2PPM
	if (ppm == null) return null
	const series = histOf(hist, 'co2.level')
	const readings = [
		{
			key: 'level',
			label: tl(r, 'co2.level', L.level),
			value: tv(ppm, (v) => String(Math.round(v))),
			unit: unitText(ppm, 'ppm'),
			accent: 'pressure',
			// 400~1200 ppm 映射到半圆刻度
			visual: { kind: 'gauge', ratio: Math.max(0, Math.min(1, (rawOf(ppm) - 400) / 800)) },
			peak: pv(ppm, series, 24, now, 'co2', units, true),
			attachText:
				r.co2Avg24h == null
					? null
					: tl(r, 'co2.avg24', L.avg24) + ' ' + tv(r.co2Avg24h, (v) => String(Math.round(v))) + ' ' + unitText(r.co2Avg24h, 'ppm')
		}
	]
	const rows = rowsCompact([
		row(tl(r, 'co2.avg24', L.avg24), tv(r.co2Avg24h, (v) => String(Math.round(v))), unitText(r.co2Avg24h, 'ppm')),
		row(L.threshold, '1000', 'ppm')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'co2',
		label: mlabel(r, 'co2', L.co2),
		icon: 'pressure',
		accent: 'pressure',
		series: seriesOf(series, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * CO₂ 组合卡的 PM 部分：对应 dashboard 的 dash-co2-pm 卡片。
 * 有 AQI 组合就用它当主读数，否则退回 PM2.5 本身。
 */
function buildCo2Pm(r, hist, units, L, now, hours) {
	const aqi = r.pm25Aqi
	const pm25 = r.pm25
	if (aqi == null && pm25 == null) return null
	const series = histOf(hist, 'co2Pm.aqi')
	const readings = []

	if (aqi != null) {
		readings.push({
			key: 'aqi',
			label: tl(r, 'co2Pm.aqi', L.aqi),
			value: tv(aqi, (v) => String(Math.round(v))),
			unit: unitText(aqi, 'AQI'),
			accent: 'sun',
			// AQI 150 封顶
			visual: { kind: 'gauge', ratio: Math.max(0, Math.min(1, rawOf(aqi) / 150)) },
			peak: pv(aqi, series, 24, now, 'co2', units, false),
			attachText:
				pm25 == null
					? null
					: tl(r, 'co2Pm.pm25', 'PM2.5') + ' ' + tv(pm25, (v) => String(Math.round(v))) + ' ' + unitText(pm25, 'µg/m³')
		})
	} else {
		readings.push({
			key: 'pm25',
			label: tl(r, 'co2Pm.pm25', 'PM2.5'),
			value: tv(pm25, (v) => String(Math.round(v))),
			unit: unitText(pm25, 'µg/m³'),
			accent: 'sun',
			visual: { kind: 'glyph', icon: 'chart' }
		})
	}

	const rows = rowsCompact([
		row(tl(r, 'co2Pm.pm25', 'PM2.5'), tv(pm25, (v) => String(Math.round(v))), unitText(pm25, 'µg/m³')),
		row('PM10', tv(r.pm10, (v) => String(Math.round(v))), unitText(r.pm10, 'µg/m³'))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'co2Pm',
		label: mlabel(r, 'co2Pm', L.co2Pm),
		icon: 'pressure',
		accent: 'sun',
		series: seriesOf(series, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * CO₂ 传感器的温湿度：对应 dashboard 的 dash-co2-temp-humi 卡片（id 11）。
 * 两个维度 —— 温度 / 湿度，跟室内模块同一套形态。
 */
function buildCo2TempHumi(r, hist, units, L, now, hours) {
	const temp = r.co2TempCelsius
	const hum = r.co2Humidity
	if (temp == null && hum == null) return null

	const tempSeries = histOf(hist, 'co2TempHumi.temperature')
	const humSeries = histOf(hist, 'co2TempHumi.humidity')
	const readings = []

	if (temp != null) {
		readings.push({
			key: 'temperature',
			label: tl(r, 'co2TempHumi.temperature', L.temperature),
			value: nv(temp, 'temperature', units),
			unit: vu(temp, 'temperature', units),
			accent: 'temp',
			visual: { kind: 'glyph', icon: 'temperature' },
			delta: dv(temp, tempSeries, 1, now, 'temperature', units),
			peak: pv(temp, tempSeries, 24, now, 'temperature', units, true)
		})
	}
	if (hum != null) {
		readings.push({
			key: 'humidity',
			label: tl(r, 'co2TempHumi.humidity', L.humidity),
			value: nv(hum, 'humidity', units),
			unit: vu(hum, 'humidity', units),
			accent: 'water',
			visual: { kind: 'ring', fill: Math.round(rawOf(hum)), icon: 'humidity' },
			peak: pv(hum, humSeries, 24, now, 'humidity', units, true)
		})
	}

	const rows = []
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'co2TempHumi',
		label: mlabel(r, 'co2TempHumi', L.co2TempHumi),
		icon: 'temperature',
		accent: 'temp',
		series: seriesOf(tempSeries, hours, now),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildLightning(r, hist, units, L, now, hours) {
	if (r.lightningStrikes == null) return null
	const readings = [
		{
			key: 'strikes',
			label: tl(r, 'lightning.strikes', L.strikes),
			value: tv(r.lightningStrikes, (v) => String(Math.round(v))),
			unit: unitText(r.lightningStrikes, ''),
			accent: 'sun',
			visual: { kind: 'glyph', icon: 'bolt' }
		}
	]
	const rows = rowsCompact([
		row(L.last1h, tv(r.lightningLastHour, (v) => String(Math.round(v))), unitText(r.lightningLastHour, '')),
		row(L.today, tv(r.lightningToday, (v) => String(Math.round(v))), unitText(r.lightningToday, '')),
		row(L.closest, tv(r.lightningClosestKm, (v) => String(Math.round(v))), unitText(r.lightningClosestKm, 'km'))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'lightning',
		label: mlabel(r, 'lightning', L.lightning),
		icon: 'bolt',
		accent: 'sun',
		series: null,
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * 电池电量 5 格：2.8V 以下算 0 格，3.8V 以上 5 格，中间线性（3 节 AA 的典型曲线）。
 * 电量格不跟模块色走（用中性 ink），≤1 格转 danger —— 这是唯一用危险色的地方。
 */
function batteryLevel(volt) {
	if (volt == null) return null
	const v = Number(volt)
	return Math.max(0, Math.min(5, Math.round((v - 2.8) / 0.2)))
}

function buildBattery(r, hist, units, L, now, hours) {
	if (r.batteryVolt == null) return null
	const level = batteryLevel(rawOf(r.batteryVolt))
	const readings = [
		{
			key: 'volt',
			label: tl(r, 'battery.volt', L.volt),
			value: tv(r.batteryVolt, (v) => v.toFixed(2)),
			unit: unitText(r.batteryVolt, 'V'),
			accent: 'wind',
			visual: { kind: 'battery', level }
		}
	]
	const rows = rowsCompact([
		row(L.level, level == null ? null : String(level), '/ 5'),
		row(L.status, r.batteryStatus || L.normal, '')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'battery',
		label: mlabel(r, 'battery', L.battery),
		icon: 'chart',
		accent: 'wind',
		series: null,
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/**
 * 模块顺序即 large 的排布顺序（第一个是 hero，除非 payload 指定了别的）。
 * 排序按「室外 → 室内 → 风 → 雨 → 气压 → 日照 → UV → CO₂ → 雷电 → 电池」，
 * 与设计稿默认一致，且不随数据缺失变化。
 */
const BUILDERS = {
	outdoor: buildOutdoor,
	indoor: buildIndoor,
	wind: buildWind,
	// 翻斗 / 压电：dashboard 上是两张卡，小组件里就是两个模块
	rainfall: makeRainBuilder({
		key: 'rainfall',
		uid: 'rainfall',
		rateField: 'rainRateMMH',
		dailyField: 'dailyRainMM',
		labelKey: 'rainfall'
	}),
	rainfallPiezo: makeRainBuilder({
		key: 'rainfallPiezo',
		uid: 'rainfallPiezo',
		rateField: 'piezoRainRateMMH',
		dailyField: 'piezoDailyRainMM',
		labelKey: 'piezo'
	}),
	pressure: buildPressure,
	solar: buildSolar,
	co2: buildCo2,
	// PM2.5 / AQI 在 dashboard 上是另一张卡（dash-co2-pm），所以也是独立模块
	co2Pm: buildCo2Pm,
	co2TempHumi: buildCo2TempHumi,
	lightning: buildLightning,
	battery: buildBattery
}

/**
 * 模块 key 全集，顺序即内置默认展示顺序。
 * 配置层（widgetConfig）的模块白名单也从这里取，不许在别处硬抄第二份。
 */
export const MODULE_KEYS = Object.keys(BUILDERS)

/**
 * 这台设备真正有数据的模块 key —— **不受用户勾选影响**。
 *
 * 设置页要用它决定「哪些模块可以勾」。别拿 `payload.modules` 当答案：
 * payload 已经被 moduleKeys 过滤过，叉掉的模块会从可选列表里消失，再也加不回来。
 */
export function availableModuleKeys(reading, options = {}) {
	const { history = {}, units = DEFAULT_UNITS, lang = 'en', now = Date.now() } = options
	return modulesOf({ reading, history, units, lang, now }).map((m) => m.key)
}

/**
 * 大卡最多展示几个模块（hero + 瓦片总数）。
 * 上限来自布局：large 的瓦片网格是 5 行 × 3 列，扣掉 hero 那一块，
 * 再多就是纯粹的挤压。这里是**契约级上限**，配置层与构建层各挡一次。
 */
export const MAX_MODULES = 12

/**
 * 按数据源给的顺序重排。`order` 里没有的模块保持原相对位置排在最后
 * （sort 稳定，所以内置顺序仍然是它们的次序）。
 */
function orderBySource(modules, order) {
	if (!order || !order.length) return modules
	const rank = {}
	order.forEach((key, i) => {
		if (rank[key] == null) rank[key] = i
	})
	const tail = order.length
	return modules.slice().sort((a, b) => {
		const ra = rank[a.key] == null ? tail : rank[a.key]
		const rb = rank[b.key] == null ? tail : rank[b.key]
		return ra - rb
	})
}

/**
 * 组装全部模块，去掉这台设备没有的。
 *
 * 顺序两个来源，优先级从高到低：
 *   1. `moduleKeys` **且** `useConfigOrder`（用户在小组件设置页真的排过）
 *   2. `reading.moduleOrder`（dashboard 卡片的先后）—— 没排过就跟随首页
 *   3. 内置 MODULE_KEYS 顺序
 *
 * `moduleKeys` 永远只管「显示哪些」，顺序另算 —— 这样用户没动过顺序时，
 * 桌面跟着首页走，而默认不勾的模块（雷电 / 电池）照样不会自己冒出来。
 */
export function modulesOf(options) {
	const {
		reading,
		history = {},
		units = DEFAULT_UNITS,
		lang = 'en',
		now = Date.now(),
		moduleKeys = null,
		useConfigOrder = false
	} = options
	const L = dict(lang)
	const r = reading || {}
	const built = orderBySource(
		MODULE_KEYS.map((key) => BUILDERS[key](r, history, units, L, now, WIDGET_RANGE_HOURS)).filter(Boolean),
		r.moduleOrder
	)
	if (!moduleKeys || !moduleKeys.length) return built.slice(0, MAX_MODULES)
	const picked = built.filter((m) => moduleKeys.indexOf(m.key) >= 0)
	if (!useConfigOrder) return picked.slice(0, MAX_MODULES)
	// 用户给的顺序记成位置表，重复 key 只认第一次
	const rank = {}
	moduleKeys.forEach((key, i) => {
		if (rank[key] == null) rank[key] = i
	})
	return picked.sort((a, b) => rank[a.key] - rank[b.key]).slice(0, MAX_MODULES)
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 状态文本 + 语气。tone: ok（强调色）/ warn（异常）/ muted（灰）
 */
function buildStatus(reading, source, connected, observedMs, now, L) {
	if (source === 'fixture') return { text: L.fixture, tone: 'muted' }
	if (source === 'demo') return { text: L.demo, tone: 'ok' }
	if (!reading) return { text: L.notConnected, tone: 'muted' }
	if (!connected) return { text: L.offline, tone: 'warn' }
	if (now - observedMs > 15 * 60 * 1000) return { text: L.stale, tone: 'warn' }
	return { text: L.online, tone: 'ok' }
}

/** 找一条读数：先按 uid，找不到退回第一个模块的第一条 */
function pickFeature(modules, uid) {
	for (const m of modules) {
		for (const r of m.readings) {
			if (m.key + '.' + r.key === uid) return { module: m, reading: r }
		}
	}
	const m = modules[0]
	if (!m || !m.readings.length) return null
	return { module: m, reading: m.readings[0] }
}

/**
 * 主入口。一次构造同时产出三档要用的全部数据。
 *
 * @param {object} options
 * @param {object|null} options.reading     基准读数（字段见 readingFromDashboard）
 * @param {object} options.history          历史序列，键为 temperature/humidity/pressure/wind/rainfall/solar/uv/indoor/co2/aqi
 * @param {string} options.parameter        突出项（5 个旧参数之一），与 feature 二选一
 * @param {string} options.feature          突出读数 uid，如 'outdoor.humidity'，优先
 * @param {string} options.hero             large 的 hero 模块 key，空则跟随突出项
 * @param {object} options.featured         large 里每个模块展示哪条读数：{moduleKey: readingKey}
 */
/**
 * 签名（visual）归一：每条 reading 的 visual 都**显式写死布尔 inSmall**。
 * 为什么不在原生侧定默认值：原生默认值改一次就得重打基座，热更新就废了。
 * 现在「小卡画不画签名」100% 由这份 JSON 决定 —— 想让某个签名出现在小卡，
 * 给它 inSmall: true 即可（默认全关，小卡太挤）。
 */
function normalizeVisuals(modules) {
	for (const module of modules) {
		for (const reading of module.readings || []) {
			if (reading.visual) reading.visual.inSmall = reading.visual.inSmall === true
		}
	}
	return modules
}

/**
 * featured 归一：只留「模块真的在 payload 里、读数真的挂在这个模块下」的组合。
 *
 * 为什么按构造好的 modules 过滤而不是按 MODULE_KEYS：这台设备没有的模块、
 * 用户没勾进大卡的模块，其 featured 项原生根本读不到，留着只是脏数据。
 * 丢掉的项在原生侧自动走 fallback（feature 所属读数 → readings[0]）。
 */
function normalizeFeatured(featured, modules) {
	const out = {}
	if (!featured || typeof featured !== 'object' || Array.isArray(featured)) return out
	const byKey = {}
	modules.forEach((m) => {
		byKey[m.key] = m
	})
	Object.keys(featured).forEach((moduleKey) => {
		const module = byKey[moduleKey]
		const readingKey = featured[moduleKey]
		if (!module || typeof readingKey !== 'string' || !readingKey) return
		if (!module.readings.some((r) => r.key === readingKey)) return
		out[moduleKey] = readingKey
	})
	return out
}

export function buildWidgetPayloadV4(options = {}) {
	const {
		reading = null,
		history = {},
		parameter = 'temperature',
		feature = null,
		hero = '',
		featured = null,
		moduleKeys = null,
		// true 才按 moduleKeys 的数组顺序排；否则顺序跟 reading.moduleOrder（dashboard 卡片先后）
		useConfigOrder = false,
		appearance = 'dark',
		units = DEFAULT_UNITS,
		lang = 'en',
		now = Date.now(),
		source = 'demo',
		connected = true,
		// 数据属于哪台设备：原生拼「点组件回首页并切设备」的跳转链接要用
		deviceId = ''
	} = options

	const L = dict(lang)
	const r = reading || {}
	const observedMs = r.observedAt ? new Date(r.observedAt).getTime() : now
	const modules = modulesOf({ reading, history, units, lang, now, moduleKeys, useConfigOrder })
	// 签名可见性在出口处统一落定，不依赖原生默认值（见 normalizeVisuals 的注释）
	normalizeVisuals(modules)
	// feature 显式给了（含空串）就不再回头看 parameter：
	// 空串 = 用户没选读数 → pickFeature 落到 modules[0] 的第一条。
	// 只有调用方压根没传 feature（老调用方 / 画廊）才走 parameter 那条路。
	const uid = feature == null ? featureUidOf(parameter) : feature
	const picked = pickFeature(modules, uid)
	const status = buildStatus(reading, source, connected, observedMs, now, L)

	// hero：显式指定优先，其次跟随突出项所在模块，最后第一个
	const featureModuleKey = picked ? picked.module.key : ''
	const heroKey =
		hero && modules.some((m) => m.key === hero)
			? hero
			: modules.some((m) => m.key === featureModuleKey)
				? featureModuleKey
				: modules.length
					? modules[0].key
					: ''

	// 时间轴三段：固定 24 小时窗口的起点 / 中点 / 终点
	const span = WIDGET_RANGE_HOURS * 3600 * 1000
	const ticks = [now - span, now - span / 2, now]

	return {
		schemaVersion: WIDGET_SCHEMA_V4,
		appearance: appearance === 'light' ? 'light' : 'dark',
		lang,
		units,
		deviceId: String(deviceId || ''),
		station: r.stationName || L.fallbackStation,
		brand: L.brand,
		updated: r.observedAt ? timeFullText(observedMs) : L.noObservation,
		updatedShort: r.observedAt ? timeText(observedMs) : '--:--',
		status,
		observedAt: r.observedAt ? observedMs : null,
		// token：颜色 / 字号 / 形状 / 布局预算 / 图标路径，全部下发，改这些不发版
		theme: resolveTheme(appearance),
		typography: typographyPayload(),
		// 全局字号系数：占位不够时整卡缩字，改这里不用重打基座
		fontScale: FONT_SCALE,
		shape: {
			cardRadius: SHAPE.cardRadius,
			cardPadding: SHAPE.cardPadding,
			cardGap: SHAPE.cardGap,
			cardGapLarge: SHAPE.cardGapLarge,
			wellRadius: SHAPE.wellRadius,
			chipSize: SHAPE.chipSize,
			chipRadius: SHAPE.chipRadius,
			// 明细策略：large 的 hero/瓦片行数 + medium 左栏密度。
			// 嵌套对象要显式拷一层，浅展开会把同一个 medium 对象共享给每次构建
			detail: { ...DETAIL, medium: { ...DETAIL.medium } },
			// medium 左栏宽度上限（百分比）：只有 Android 读（TextView 必须自己限宽）
			mediumLeftMax: SHAPE.mediumLeftMax,
			// 曲线几何：网格 / 线宽 / 圆点 / 虚线 / 取景留白 / 最少点数
			chart: { ...CHART, dash: [...CHART.dash], gridRatios: [...CHART.gridRatios] },
			// 字缩系数：长文案挤一行时允许缩到多少
			textShrink: { ...TEXT_SHRINK },
			viz: { ...SHAPE.viz },
			vizXs: { ...SHAPE.vizXs },
			layout: { ...SHAPE.layout },
			// 各平台自己的外边距：iOS 0（系统给了 content margin）、Android 12
			inset: { ...SHAPE.inset },
			// UV 光谱条是物理刻度色，不随主题变
			uvScale: [...UV_SCALE],
			// 布局预算。zoneGap 不单独下发：两端的分区间距实际都读 shape.cardGapLarge
			// （测试锁着这两个值相等），发两份就是两份真相
			plan: {
				budget: LARGE_PLAN.budget,
				heroCap: LARGE_PLAN.heroCap,
				tileMin: LARGE_PLAN.tileMin,
				heroMin: LARGE_PLAN.heroMin
			}
		},
		// 设计画布：容器给宽度、卡片按画布 1:1 画完再 scale，三端都用这份，不许各自写死
		canvas: {
			small: { ...WIDGET_CANVAS.small },
			medium: { ...WIDGET_CANVAS.medium },
			large: { ...WIDGET_CANVAS.large }
		},
		icons: { ...ICONS },
		// 哪条读数当主角 / 哪个模块当 hero / 大卡每块显示哪条读数 —— 用户配置决定，原生只照做。
		// featured 只影响 large；缺省是空对象，small / medium 仍只看 feature。
		selection: {
			feature: picked ? featureModuleKey + '.' + picked.reading.key : '',
			hero: heroKey,
			featured: normalizeFeatured(featured, modules)
		},
		// 空图与兜底文案，同样走 payload（原生不写死英文）
		labels: { noHistory: L.noHistory, noTrend: L.noTrend, raining: L.raining },
		axis: ticks.map((t) => axisText(t, WIDGET_RANGE_HOURS)),
		footer: { left: L.last24h, right: L.noTrend },
		modules
	}
}

// ---------------------------------------------------------------------------
// 生产链路：真实 dashboard → reading
// ---------------------------------------------------------------------------

/**
 * 从 App 的真实 dashboard 数据里抽出基准读数。
 *
 * 字段名照抄接口（`sendible_temp`、`drew_temp`、`rainratein` / `rrain_piezo` 这种拼写别按英文习惯改）。
 * 任何一项缺了就是 null，模块层自动不显示，绝不填假值。
 */
export function readingFromDashboard(item, fallbackStation) {
	if (!item || !item.data) return null
	const d = item.data
	const pick = (key) => {
		const node = d[key]
		if (!node) return null
		const v = Number(node.value)
		return isFinite(v) ? v : null
	}
	const text = (key) => {
		const node = d[key]
		if (!node || node.value == null) return null
		const s = String(node.value)
		return s === '' ? null : s
	}
	const rainStateRaw = text('srain_piezo') || text('rainstate')
	return {
		stationName: item.name || fallbackStation || 'Weather Station',
		outdoorCelsius: pick('tempf'),
		outdoorHumidity: pick('humidity'),
		dewPointCelsius: pick('dewpoint'),
		feelsLikeCelsius: pick('feels_like'),
		indoorCelsius: pick('tempinf'),
		indoorHumidity: pick('humidityin'),
		indoorDewPointCelsius: pick('dewpointin'),
		indoorFeelsLikeCelsius: pick('sendible_tempin'),
		windKPH: pick('windspeed'),
		gustKPH: pick('windgust'),
		windDegrees: pick('winddir'),
		maxGustKPH: pick('maxdailygust'),
		rainRateMMH: pick('rainrate'),
		dailyRainMM: pick('dailyrain'),
		piezoRainRateMMH: pick('rrain_piezo'),
		piezoDailyRainMM: pick('drain_piezo'),
		rainState: rainStateRaw,
		relativePressureHPA: pick('baromrel'),
		absolutePressureHPA: pick('baromabs'),
		solarWM2: pick('solarradiation'),
		uvIndex: pick('uv'),
		co2PPM: pick('co2in'),
		pm25: pick('pm25_ch1'),
		pm10: pick('pm10_ch1'),
		pm25Aqi: pick('pm25_real_time_aqi_co2'),
		batteryVolt: pick('wh65batt'),
		observedAt: Date.now()
	}
}

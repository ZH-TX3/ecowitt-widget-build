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
	SPLIT,
	LARGE_PLAN,
	UV_SCALE,
	ICONS,
	featureUidOf,
	resolveTheme,
	typographyPayload
} from './widgetDesign.js'
import {
	DEFAULT_UNITS,
	convert,
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
		lightning: 'Lightning',
		battery: 'Battery',
		temperature: 'Temperature',
		humidity: 'Humidity',
		speed: 'Speed',
		gust: 'Gust',
		rainGauge: 'Rain gauge',
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
		feelsLike: 'Feels like',
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
		noHistory: 'Insufficient history',
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
		lightning: '雷电',
		battery: '电池',
		temperature: '温度',
		humidity: '湿度',
		speed: '风速',
		gust: '阵风',
		rainGauge: '雨量计',
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
		feelsLike: '体感',
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
		noHistory: '历史数据不足',
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

/** 显示单位下的数值文本；delta = true 时温标只做斜率换算 */
function nv(value, parameter, units, delta) {
	return numberText(value, parameter, units, !!delta)
}

/** 一行明细：值为空就整行丢掉，不留「—」占位 */
function row(label, value, unit) {
	if (value == null || value === '' || value === '—') return null
	return { label, value: String(value), unit: unit == null ? '' : String(unit) }
}

function rowsCompact(list) {
	return list.filter(Boolean)
}

/** 窗口内的趋势，换算成显示单位，抽稀到 ≤28 点 */
function seriesOf(points, hours, now, parameter, units) {
	if (!points || !points.length) return null
	const picked = windowSeries(points, hours, now, 28)
	if (picked.length < 2) return null
	return picked.map((p) => [p.t, Number(convert(p.v, parameter, units).toFixed(2))])
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
	const tempSeries = hist.temperature || []
	const humSeries = hist.humidity || []
	const readings = []

	if (r.outdoorCelsius != null) {
		readings.push({
			key: 'temperature',
			label: L.temperature,
			value: nv(r.outdoorCelsius, 'temperature', units),
			unit: unitOf('temperature', units),
			accent: 'temp',
			// 跟头部 chip 重复，小卡不画签名
			visual: { kind: 'glyph', icon: 'temperature', inSmall: false },
			delta: deltaOf(tempSeries, 1, now, 'temperature', units, r.outdoorCelsius),
			peak: peakOf(tempSeries, 24, now, 'temperature', units, true)
		})
	}
	if (r.outdoorHumidity != null) {
		readings.push({
			key: 'humidity',
			label: L.humidity,
			value: nv(r.outdoorHumidity, 'humidity', units),
			unit: unitOf('humidity', units),
			accent: 'water',
			visual: { kind: 'ring', fill: Math.round(r.outdoorHumidity), icon: 'humidity' },
			peak: peakOf(humSeries, 24, now, 'humidity', units, true)
		})
	}

	const rows = rowsCompact([
		row(L.dewPoint, nv(r.dewPointCelsius, 'temperature', units), unitOf('temperature', units)),
		row(L.feelsLike, nv(r.feelsLikeCelsius, 'temperature', units), unitOf('temperature', units)),
		row(L.vpd, r.vpdKPa == null ? null : Number(r.vpdKPa).toFixed(2), 'kPa')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'outdoor',
		label: L.outdoor,
		icon: 'temperature',
		accent: 'temp',
		series: seriesOf(tempSeries, hours, now, 'temperature', units),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildIndoor(r, hist, units, L, now, hours) {
	if (r.indoorCelsius == null && r.indoorHumidity == null) return null
	const tempSeries = hist.indoor || []
	const readings = []

	if (r.indoorCelsius != null) {
		readings.push({
			key: 'temperature',
			label: L.temperature,
			value: nv(r.indoorCelsius, 'temperature', units),
			unit: unitOf('temperature', units),
			accent: 'temp',
			visual: { kind: 'glyph', icon: 'house', inSmall: false },
			delta: deltaOf(tempSeries, 1, now, 'temperature', units, r.indoorCelsius),
			peak: peakOf(tempSeries, 24, now, 'temperature', units, true)
		})
	}
	if (r.indoorHumidity != null) {
		readings.push({
			key: 'humidity',
			label: L.humidity,
			value: nv(r.indoorHumidity, 'humidity', units),
			unit: unitOf('humidity', units),
			accent: 'water',
			visual: { kind: 'ring', fill: Math.round(r.indoorHumidity), icon: 'humidity' },
			peak: peakOf(hist.indoorHumidity || [], 24, now, 'humidity', units, true)
		})
	}

	const rows = rowsCompact([
		row(L.dewPoint, nv(r.indoorDewPointCelsius, 'temperature', units), unitOf('temperature', units)),
		row(L.humidity, nv(r.indoorHumidity, 'humidity', units), unitOf('humidity', units)),
		row(L.feelsLike, nv(r.indoorFeelsLikeCelsius, 'temperature', units), unitOf('temperature', units))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'indoor',
		label: L.indoor,
		icon: 'house',
		accent: 'temp',
		series: seriesOf(tempSeries, hours, now, 'temperature', units),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildWind(r, hist, units, L, now, hours) {
	if (r.windKPH == null && r.gustKPH == null) return null
	const series = hist.wind || []
	const bearing = r.windDegrees == null ? null : (Number(r.windDegrees) + 180) % 360
	const dir = directionText(r.windDegrees)
	const readings = []

	if (r.windKPH != null) {
		readings.push({
			key: 'speed',
			label: L.speed,
			value: nv(r.windKPH, 'wind', units),
			unit: unitOf('wind', units),
			accent: 'wind',
			visual: bearing == null ? { kind: 'glyph', icon: 'wind' } : { kind: 'dial', icon: 'arrow', bearing },
			delta: deltaOf(series, 1, now, 'wind', units, r.windKPH),
			// 当日极值取「最大阵风」：风速本身的窗口最大值没有意义
			peak:
				r.maxGustKPH != null
					? { max: { value: nv(r.maxGustKPH, 'wind', units), time: '' } }
					: peakOf(series, 24, now, 'wind', units, false),
			attachText:
				r.windDegrees == null
					? L.gust + ' ' + nv(r.gustKPH, 'wind', units) + ' ' + unitOf('wind', units)
					: L.from + ' ' + dir + ' · ' + L.gust + ' ' + nv(r.gustKPH, 'wind', units)
		})
	}
	if (r.gustKPH != null) {
		readings.push({
			key: 'gust',
			label: L.gust,
			value: nv(r.gustKPH, 'wind', units),
			unit: unitOf('wind', units),
			accent: 'wind',
			visual: bearing == null ? { kind: 'glyph', icon: 'wind' } : { kind: 'dial', icon: 'arrow', bearing },
			attachText:
				r.windDegrees == null
					? L.speed + ' ' + nv(r.windKPH, 'wind', units)
					: L.from + ' ' + dir + ' · ' + L.speed + ' ' + nv(r.windKPH, 'wind', units)
		})
	}

	const rows = rowsCompact([
		row(L.direction, r.windDegrees == null ? null : dir, ''),
		row(L.gust, nv(r.gustKPH, 'wind', units), unitOf('wind', units)),
		row(L.maxGust, r.maxGustKPH == null ? null : nv(r.maxGustKPH, 'wind', units), unitOf('wind', units))
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'wind',
		label: L.wind,
		icon: 'wind',
		accent: 'wind',
		series: seriesOf(series, hours, now, 'wind', units),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

/** 雨量累计：从历史序列按窗口求和，算不出来就整行不显示 */
function rainTotals(hist, units, now, L, dailyRow) {
	const points = hist.rainfall || []
	const unit = unitOf('rainfall', units, true)
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
		row(L.hourly, sum(1), unit),
		row(L.day24, sum(24), unit),
		row(L.week, sum(168), unit)
	])
}

function buildRainfall(r, hist, units, L, now, hours) {
	const hasGauge = r.rainRateMMH != null || r.dailyRainMM != null
	const hasPiezo = r.piezoRainRateMMH != null || r.piezoDailyRainMMH != null
	if (!hasGauge && !hasPiezo) return null

	const rainState = r.rainState === true || r.rainState === 'raining' ? L.raining : null
	const unit = unitOf('rainfall', units)
	const dryUnit = unitOf('rainfall', units, true)
	const bars = (points) => {
		const w = windowOf(points, 6 * 60, now) || []
		const tail = w.slice(-7).map((p) => Number(convert(p.v, 'rainfall', units).toFixed(2)))
		return tail.length >= 3 ? { kind: 'bars', values: tail } : { kind: 'glyph', icon: 'rainfall' }
	}
	const series = hist.rainfall || []
	const readings = []

	if (hasGauge) {
		readings.push({
			key: 'gauge',
			label: L.rainGauge,
			value: nv(r.rainRateMMH, 'rainfall', units),
			unit,
			accent: 'water',
			// 小卡右侧是状态槽：有状态显示状态，没状态就留空（不退回图标）
			stateSlot: true,
			state: rainState,
			visual: bars(series),
			delta: deltaOf(series, 1, now, 'rainfall', units, r.rainRateMMH),
			attachText: r.dailyRainMM == null ? null : L.daily + ' ' + nv(r.dailyRainMM, 'rainfall', units) + ' ' + dryUnit
		})
	}
	if (hasPiezo) {
		readings.push({
			key: 'piezo',
			label: L.piezo,
			value: nv(r.piezoRainRateMMH, 'rainfall', units),
			unit,
			accent: 'water',
			stateSlot: true,
			state: rainState,
			visual: bars(hist.rainfallPiezo || series),
			attachText:
				r.piezoDailyRainMM == null ? null : L.daily + ' ' + nv(r.piezoDailyRainMM, 'rainfall', units) + ' ' + dryUnit
		})
	}

	const rows = rainTotals(
		hist,
		units,
		now,
		L,
		row(L.daily, nv(r.dailyRainMM, 'rainfall', units), dryUnit)
	)
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'rainfall',
		label: L.rainfall,
		icon: 'rainfall',
		accent: 'water',
		series: seriesOf(series, hours, now, 'rainfall', units),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildPressure(r, hist, units, L, now, hours) {
	const relative = r.relativePressureHPA
	const absolute = r.absolutePressureHPA
	const sea = r.seaLevelPressureHPA
	if (relative == null && absolute == null && sea == null) return null
	const series = hist.pressure || []
	// 960~1050 hPa 映射到半圆刻度：低于 960 到底、高于 1050 到顶
	const ratio = (v) => Math.max(0, Math.min(1, (Number(v) - 960) / 90))
	const readings = []

	if (relative != null) {
		readings.push({
			key: 'relative',
			label: L.relative,
			value: nv(relative, 'pressure', units),
			unit: unitOf('pressure', units),
			accent: 'pressure',
			// 四位数值，数值与小卡都降一档字
			small: true,
			visual: { kind: 'gauge', ratio: ratio(relative) },
			delta: deltaOf(series, 3, now, 'pressure', units, relative),
			peak: peakOf(series, 24, now, 'pressure', units, true)
		})
	}
	if (absolute != null) {
		readings.push({
			key: 'absolute',
			label: L.absolute,
			value: nv(absolute, 'pressure', units),
			unit: unitOf('pressure', units),
			accent: 'pressure',
			small: true,
			visual: { kind: 'gauge', ratio: ratio(absolute) }
		})
	}
	if (sea != null) {
		readings.push({
			key: 'sealevel',
			label: L.seaLevel,
			value: nv(sea, 'pressure', units),
			unit: unitOf('pressure', units),
			accent: 'pressure',
			small: true,
			visual: { kind: 'gauge', ratio: ratio(sea) }
		})
	}

	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: [] }
	return {
		key: 'pressure',
		label: L.pressure,
		icon: 'pressure',
		accent: 'pressure',
		series: seriesOf(series, hours, now, 'pressure', units),
		rows: [],
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildSolar(r, hist, units, L, now, hours) {
	if (r.solarWM2 == null) return null
	const series = hist.solar || []
	const sunrise = r.sunriseText || null
	const sunset = r.sunsetText || null
	const rows = rowsCompact([row(L.sunrise, sunrise, ''), row(L.sunset, sunset, '')])
	const readings = [
		{
			key: 'radiation',
			label: L.radiation,
			value: String(Math.round(Number(r.solarWM2))),
			unit: 'W/m²',
			accent: 'sun',
			visual: { kind: 'sun', icon: 'sun', inSmall: false },
			peak: peakOf(series, 24, now, 'solar', units, false)
		}
	]
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'solar',
		label: L.solar,
		icon: 'sun',
		accent: 'sun',
		series: seriesOf(series, hours, now, 'solar', units),
		rows,
		// 成对读数的单行摘要：日出 → 日落
		compact: sunrise && sunset ? sunrise + ' → ' + sunset : null,
		compactLabel: L.sun,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildUv(r, hist, units, L, now, hours) {
	if (r.uvIndex == null) return null
	const series = hist.uv || []
	const readings = [
		{
			key: 'index',
			label: L.level,
			value: Number(r.uvIndex).toFixed(1),
			unit: '',
			accent: 'sun',
			// UV 指数 11 封顶，光谱条长度固定
			visual: { kind: 'uv', pos: Math.round(Math.min(1, Number(r.uvIndex) / 11) * 100) },
			peak: peakOf(series, 24, now, 'uv', units, false)
		}
	]
	const rows = rowsCompact([row(L.level, r.uvLevelText, ''), row(L.maxToday, r.uvMaxToday, '')])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'uv',
		label: L.uv,
		icon: 'sun',
		accent: 'sun',
		series: seriesOf(series, hours, now, 'uv', units),
		rows,
		compact: null,
		compactLabel: null,
		readings: readings.map((s) => reading(s, ctx))
	}
}

function buildCo2(r, hist, units, L, now, hours) {
	const ppm = r.co2PPM
	const aqi = r.pm25Aqi
	if (ppm == null && aqi == null) return null
	const series = hist.co2 || []
	const readings = []

	if (ppm != null) {
		readings.push({
			key: 'level',
			label: L.level,
			value: String(Math.round(Number(ppm))),
			unit: 'ppm',
			accent: 'pressure',
			// 400~1200 ppm 映射到半圆刻度
			visual: { kind: 'gauge', ratio: Math.max(0, Math.min(1, (Number(ppm) - 400) / 800)) },
			peak: peakOf(series, 24, now, 'co2', units, true),
			attachText: r.co2Avg24h == null ? null : L.avg24 + ' ' + Math.round(Number(r.co2Avg24h)) + ' ppm'
		})
	}
	if (aqi != null) {
		readings.push({
			key: 'aqi',
			label: L.aqi,
			value: String(Math.round(Number(aqi))),
			unit: 'AQI',
			accent: 'sun',
			// AQI 150 封顶
			visual: { kind: 'gauge', ratio: Math.max(0, Math.min(1, Number(aqi) / 150)) },
			peak: peakOf(hist.aqi || [], 24, now, 'co2', units, false),
			attachText: r.pm25 == null ? null : 'PM2.5 ' + Math.round(Number(r.pm25)) + ' µg/m³'
		})
	}

	const rows = rowsCompact([
		row('PM2.5', r.pm25 == null ? null : String(Math.round(Number(r.pm25))), 'µg/m³'),
		row('PM10', r.pm10 == null ? null : String(Math.round(Number(r.pm10))), 'µg/m³'),
		row(L.avg24, r.co2Avg24h == null ? null : String(Math.round(Number(r.co2Avg24h))), 'ppm'),
		row(L.threshold, '1000', 'ppm')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'co2',
		label: L.co2,
		icon: 'pressure',
		accent: 'pressure',
		series: seriesOf(series, hours, now, 'co2', units),
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
			label: L.strikes,
			value: String(Math.round(Number(r.lightningStrikes))),
			unit: '',
			accent: 'sun',
			visual: { kind: 'glyph', icon: 'bolt' }
		}
	]
	const rows = rowsCompact([
		row(L.last1h, r.lightningLastHour == null ? null : String(Math.round(Number(r.lightningLastHour))), ''),
		row(L.today, r.lightningToday == null ? null : String(Math.round(Number(r.lightningToday))), ''),
		row(L.closest, r.lightningClosestKm == null ? null : String(Math.round(Number(r.lightningClosestKm))), 'km')
	])
	const ctx = { readings: readings.map((s) => Object.assign({}, s)), moduleRows: rows }
	return {
		key: 'lightning',
		label: L.lightning,
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
	const level = batteryLevel(r.batteryVolt)
	const readings = [
		{
			key: 'volt',
			label: L.volt,
			value: Number(r.batteryVolt).toFixed(2),
			unit: 'V',
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
		label: L.battery,
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
const BUILDERS = [
	buildOutdoor,
	buildIndoor,
	buildWind,
	buildRainfall,
	buildPressure,
	buildSolar,
	buildUv,
	buildCo2,
	buildLightning,
	buildBattery
]

/** 组装全部模块，去掉这台设备没有的 */
export function modulesOf(options) {
	const { reading, history = {}, units = DEFAULT_UNITS, lang = 'en', now = Date.now(), moduleKeys = null } = options
	const L = dict(lang)
	const r = reading || {}
	const built = BUILDERS.map((build) => build(r, history, units, L, now, WIDGET_RANGE_HOURS)).filter(Boolean)
	if (!moduleKeys || !moduleKeys.length) return built
	return built.filter((m) => moduleKeys.indexOf(m.key) >= 0)
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
 */
export function buildWidgetPayloadV4(options = {}) {
	const {
		reading = null,
		history = {},
		parameter = 'temperature',
		feature = null,
		hero = '',
		moduleKeys = null,
		appearance = 'dark',
		units = DEFAULT_UNITS,
		lang = 'en',
		now = Date.now(),
		source = 'demo',
		connected = true
	} = options

	const L = dict(lang)
	const r = reading || {}
	const observedMs = r.observedAt ? new Date(r.observedAt).getTime() : now
	const modules = modulesOf({ reading, history, units, lang, now, moduleKeys })
	const uid = feature || featureUidOf(parameter)
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
		station: r.stationName || L.fallbackStation,
		brand: L.brand,
		updated: r.observedAt ? timeFullText(observedMs) : L.noObservation,
		updatedShort: r.observedAt ? timeText(observedMs) : '--:--',
		status,
		observedAt: r.observedAt ? observedMs : null,
		// token：颜色 / 字号 / 形状 / 布局预算 / 图标路径，全部下发，改这些不发版
		theme: resolveTheme(appearance),
		typography: typographyPayload(),
		shape: {
			cardRadius: SHAPE.cardRadius,
			cardPadding: SHAPE.cardPadding,
			cardGap: SHAPE.cardGap,
			cardGapLarge: SHAPE.cardGapLarge,
			wellRadius: SHAPE.wellRadius,
			chipSize: SHAPE.chipSize,
			chipRadius: SHAPE.chipRadius,
			viz: { ...SHAPE.viz },
			vizXs: { ...SHAPE.vizXs },
			layout: { ...SHAPE.layout },
			// 各平台自己的外边距：iOS 0（系统给了 content margin）、Android 12
			inset: { ...SHAPE.inset },
			// medium 左栏占比：iOS 立即生效，Android 需同步 XML 权重
			split: { ...SPLIT },
			// UV 光谱条是物理刻度色，不随主题变
			uvScale: [...UV_SCALE],
			plan: { ...LARGE_PLAN }
		},
		icons: { ...ICONS },
		// 哪条读数当主角 / 哪个模块当 hero —— 用户配置决定，原生只照做
		selection: { feature: picked ? featureModuleKey + '.' + picked.reading.key : '', hero: heroKey },
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

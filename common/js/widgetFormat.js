/**
 * 小组件数值/单位/时间格式化
 *
 * 规则从 Ecowitt-Widgets-v2.1.html 的 EcowittData 模块一比一移植：
 * convert / unit / number / direction / pressureDelta / samples。
 * 之所以放在 JS 而不是 Swift：格式化结果直接进 payload，
 * 改精度、改单位、改文案都不用重编 .appex。
 */

/** 默认单位制 */
export const DEFAULT_UNITS = {
	temperature: 'C', // C | F
	wind: 'km/h', // km/h | mph | m/s
	rain: 'mm', // mm | in
	pressure: 'hPa' // hPa | inHg
}

/** 每个参数在读数对象里对应的字段 */
export const FIELDS = {
	temperature: 'outdoorCelsius',
	humidity: 'outdoorHumidity',
	pressure: 'relativePressureHPA',
	wind: 'windKPH',
	rainfall: 'rainRateMMH'
}

/** 温标换算：delta=true 时只做斜率换算，不加 32 偏移 */
export function convert(value, parameter, units = DEFAULT_UNITS, delta = false) {
	if (value == null || !isFinite(value)) return null
	const v = Number(value)
	switch (parameter) {
		case 'temperature':
			return units.temperature === 'F' ? v * 1.8 + (delta ? 0 : 32) : v
		case 'wind':
			return units.wind === 'm/s' ? v / 3.6 : units.wind === 'mph' ? v / 1.609344 : v
		case 'rainfall':
			return units.rain === 'in' ? v / 25.4 : v
		case 'pressure':
			return units.pressure === 'inHg' ? v / 33.8638866667 : v
		default:
			return v
	}
}

/** 单位文案。history=true 时雨量去掉 /h */
export function unitOf(parameter, units = DEFAULT_UNITS, history = false) {
	switch (parameter) {
		case 'temperature':
			return '°' + units.temperature
		case 'humidity':
			return '%'
		case 'wind':
			return units.wind
		case 'pressure':
			return units.pressure
		default:
			return units.rain + (history ? '' : '/h')
	}
}

/** 每参数的小数位：湿度 0 位，inHg / inch 雨量 2 位，其余 1 位 */
function precisionOf(parameter, units = DEFAULT_UNITS) {
	if (parameter === 'humidity') return 0
	if (parameter === 'pressure' && units.pressure === 'inHg') return 2
	if (parameter === 'rainfall' && units.rain === 'in') return 2
	return 1
}

/** 换算 + 格式化，缺值返回破折号 */
export function numberText(value, parameter, units = DEFAULT_UNITS, delta = false) {
	const converted = convert(value, parameter, units, delta)
	if (converted == null) return '—'
	return converted.toFixed(precisionOf(parameter, units))
}

/** 带单位的完整文本 */
export function valueText(value, parameter, units = DEFAULT_UNITS, delta = false) {
	return numberText(value, parameter, units, delta) + unitOf(parameter, units, delta)
}

/** 风向角度 -> 八方位文字 */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function directionText(degrees) {
	if (degrees == null) return '—'
	const norm = ((Number(degrees) % 360) + 360) % 360
	return COMPASS[Math.round(norm / 45) % 8]
}

/** HH:mm */
export function timeText(timestamp) {
	if (!timestamp) return ''
	const d = new Date(timestamp)
	const p = (n) => String(n).padStart(2, '0')
	return p(d.getHours()) + ':' + p(d.getMinutes())
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Mon D, HH:mm */
export function timeFullText(timestamp) {
	if (!timestamp) return ''
	const d = new Date(timestamp)
	const p = (n) => String(n).padStart(2, '0')
	return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/** 时间轴刻度标签：7D 用 M/D，其余用 HH:mm */
export function axisText(timestamp, hours) {
	const d = new Date(timestamp)
	const p = (n) => String(n).padStart(2, '0')
	if (hours === 168) return MONTHS[d.getMonth()] + ' ' + d.getDate()
	return p(d.getHours()) + ':' + p(d.getMinutes())
}

/**
 * 3 小时气压趋势。
 * 从历史序列里找离「当前观测 - 3h」最近的点，15 分钟内才算有效。
 */
export function pressureDelta(reading, series) {
	if (!reading || reading.relativePressureHPA == null) return null
	if (!series || series.length === 0) return null
	const target = new Date(reading.observedAt).getTime() - 3 * 3600 * 1000
	let best = null
	let bestGap = Infinity
	series.forEach((point) => {
		const gap = Math.abs(point.t - target)
		if (gap < bestGap) {
			bestGap = gap
			best = point
		}
	})
	if (!best || bestGap > 15 * 60 * 1000) return null
	return reading.relativePressureHPA - best.v
}

/**
 * 趋势方向文本：→ / ↑ / ↓ + 差值
 * HTML 里 |Δ| < 0.05 视为持平
 */
export function deltaText(delta, units = DEFAULT_UNITS) {
	if (delta == null) return '3h trend unavailable'
	const arrow = Math.abs(delta) < 0.05 ? '→' : delta > 0 ? '↑' : '↓'
	return arrow + ' ' + numberText(Math.abs(delta), 'pressure', units, true) + ' ' + unitOf('pressure', units) + ' / 3h'
}

/**
 * 环填充比例（0~100），湿度环用
 */
export function ringFill(value) {
	if (value == null || !isFinite(value)) return 0
	return Math.max(0, Math.min(100, Number(value)))
}

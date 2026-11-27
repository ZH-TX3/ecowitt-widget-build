/**
 * 小组件内置示例数据（fixture）
 *
 * 调试台在没有登录态 / 没连设备时用它把视觉定死。
 * 数据是确定性生成的（固定种子），同一时刻刷新结果一致，方便对图。
 *
 * 历史按 **uid** 归类（`outdoor.temperature`），与 payload 的 `module.reading` 同一套命名。
 * 点里的数值就是展示单位：构建器不再换算，接口给什么就画什么。
 */

/** 基准读数，字段与接口 dashboard/list 的语义字段一致 */
export const DEMO_READING = {
	stationName: 'Backyard Station',
	outdoorCelsius: 21.4,
	feelsLikeCelsius: 20.9,
	outdoorHumidity: 62,
	dewPointCelsius: 13.7,
	vpdKPa: 0.94,
	windKPH: 14.8,
	gustKPH: 26.3,
	windDegrees: 135,
	maxGustKPH: 31.2,
	rainRateMMH: 0.6,
	dailyRainMM: 4.2,
	piezoRainRateMMH: 0.4,
	piezoDailyRainMM: 3.8,
	rainState: 'raining',
	relativePressureHPA: 1013.8,
	absolutePressureHPA: 1009.2,
	seaLevelPressureHPA: 1013.8,
	solarWM2: 486,
	uvIndex: 3.4,
	uvLevelText: 'Moderate',
	uvMaxToday: '5.1',
	sunriseText: '06:12',
	sunsetText: '18:41',
	indoorCelsius: 23.1,
	indoorHumidity: 48,
	indoorDewPointCelsius: 12.8,
	indoorFeelsLikeCelsius: 23.1,
	co2PPM: 612,
	co2TempCelsius: 22.4,
	co2Humidity: 51,
	co2Avg24h: 588,
	pm25: 8,
	pm10: 14,
	pm25Aqi: 42,
	lightningStrikes: 12,
	lightningLastHour: 3,
	lightningToday: 12,
	lightningClosestKm: 9,
	batteryVolt: 3.62,
	batteryStatus: 'Normal'
}

/** 无历史数据的读数，用来验证 chart-empty 分支 */
export const MISSING_READING = {
	...DEMO_READING,
	windKPH: null,
	gustKPH: null,
	windDegrees: null,
	maxGustKPH: null,
	rainRateMMH: null,
	dailyRainMM: null,
	piezoRainRateMMH: null,
	piezoDailyRainMM: null,
	rainState: null
}

const HOUR = 3600 * 1000
const SAMPLE_STEP = 15 * 60 * 1000 // 15 分钟一个点，7 天 = 672 点

/** 线性同余伪随机，保证每次生成完全一致 */
function seeded(seed) {
	let s = seed >>> 0
	return function next() {
		s = (s * 1664525 + 1013904223) >>> 0
		return s / 4294967296
	}
}

/**
 * 生成 7 天历史。
 * 每条序列都围绕读数本身的量级波动，末端强制收敛到当前读数，
 * 这样趋势图的最后一格和主数值是对得上的。
 */
/**
 * 读数可能是「读数单元」（`{ text, unit, raw }`，见 widgetPayloadV4 的 cellOf），
 * 也可能就是裸数字。这里统一取成数字 —— 否则 `base + 波动` 会变成字符串拼接，
 * 后面 `v.toFixed` 直接报「not a function」。
 */
function numeric(value) {
	if (value == null) return null
	if (typeof value === 'object') return isFinite(Number(value.raw)) ? Number(value.raw) : null
	const n = Number(value)
	return isFinite(n) ? n : null
}

export function buildHistory(reading = DEMO_READING, now = Date.now()) {
	// 先拍平成裸数字，下面一律用 src
	const src = {}
	Object.keys(reading || {}).forEach((key) => {
		src[key] = numeric(reading[key])
	})
	const rnd = seeded(20260219)
	const total = Math.floor((7 * 24 * 60 * 60 * 1000) / SAMPLE_STEP)

	/** 生成一条围绕 base 波动的序列，最后一点等于 base */
	function series(base, swing, seedOffset) {
		const points = []
		for (let i = 0; i <= total; i++) {
			const t = now - (total - i) * SAMPLE_STEP
			const phase = (i + seedOffset) / 26
			const wave = Math.sin(phase) * swing + Math.sin(phase * 2.7) * swing * 0.35
			const noise = (rnd() - 0.5) * swing * 0.22
			const decay = i / total // 越靠后越贴近当前值
			const v = base + (wave + noise) * (1 - decay * 0.75)
			points.push({ t, v: Number(v.toFixed(2)) })
		}
		points[points.length - 1] = { t: now, v: base }
		return points
	}

	// 风速是 0 起跳的正值，气压波动小，雨量偶尔冒尖
	const clamp = (lo, hi) => (p) => ({ t: p.t, v: Math.min(hi, Math.max(lo, p.v)) })
	const windSeries = series(src.windKPH == null ? 12 : src.windKPH, 9, 0).map(clamp(0, 200))
	const rainSeries = series(src.rainRateMMH == null ? 0.4 : src.rainRateMMH, 1.6, 71).map(clamp(0, 80))
	const piezoSeries = series(src.piezoRainRateMMH == null ? 0.4 : src.piezoRainRateMMH, 1.6, 83).map(
		clamp(0, 80)
	)
	const humiditySeries = series(src.outdoorHumidity == null ? 60 : src.outdoorHumidity, 14, 13).map(
		clamp(0, 100)
	)

	return {
		'outdoor.temperature': series(src.outdoorCelsius == null ? 20 : src.outdoorCelsius, 5.5, 37),
		'outdoor.humidity': humiditySeries,
		'pressure.relative': series(
			src.relativePressureHPA == null ? 1013 : src.relativePressureHPA,
			2.4,
			53
		),
		'wind.speed': windSeries,
		'rainfall.rate': rainSeries,
		'rainfallPiezo.rate': piezoSeries,
		'indoor.temperature': series(src.indoorCelsius == null ? 23 : src.indoorCelsius, 1.2, 7),
		'solar.radiation': series(src.solarWM2 == null ? 300 : src.solarWM2, 120, 91).map(clamp(0, 1400)),
		'solar.index': series(src.uvIndex == null ? 3 : src.uvIndex, 1.6, 103).map(clamp(0, 11)),
		'co2.level': series(src.co2PPM == null ? 600 : src.co2PPM, 90, 11).map(clamp(400, 2000)),
		'co2TempHumi.temperature': series(src.co2TempCelsius == null ? 22 : src.co2TempCelsius, 1.1, 29),
		'co2TempHumi.humidity': series(src.co2Humidity == null ? 50 : src.co2Humidity, 6, 31).map(clamp(0, 100)),
		'co2Pm.aqi': series(src.pm25Aqi == null ? 40 : src.pm25Aqi, 12, 17).map(clamp(0, 300))
	}
}

/**
 * 取窗口内的点并按目标点数抽稀。
 * 抽稀用「桶内保留极值幅度最大的点」，比等间隔采样更能保住曲线形状。
 */
export function windowSeries(points, hours, now = Date.now(), maxPoints = 28) {
	if (!points || points.length === 0) return []
	const start = now - hours * HOUR
	const inWindow = points.filter((p) => p.t >= start && p.t <= now)
	if (inWindow.length <= maxPoints) return inWindow

	const bucketSize = inWindow.length / maxPoints
	const result = []
	for (let i = 0; i < maxPoints; i++) {
		const from = Math.floor(i * bucketSize)
		const to = Math.max(from + 1, Math.floor((i + 1) * bucketSize))
		const bucket = inWindow.slice(from, to)
		if (bucket.length === 0) continue
		const avg = bucket.reduce((acc, p) => acc + p.v, 0) / bucket.length
		let pick = bucket[0]
		let best = -1
		bucket.forEach((p) => {
			const dev = Math.abs(p.v - avg)
			if (dev > best) {
				best = dev
				pick = p
			}
		})
		result.push(pick)
	}
	return result
}

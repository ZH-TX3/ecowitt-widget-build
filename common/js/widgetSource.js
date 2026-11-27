/**
 * 小组件数据源适配层
 *
 * 把首页 dashboard 接口（GET /dashboard/data）的响应翻译成
 * buildWidgetPayloadV4 的入参，让「生产链路」与「内置 fixture」走同一个构建器。
 *
 * 用户已定的约定，决定了这个文件长什么样：
 *   1. 单位由后端返回，前端零换算 —— 产出「读数单元」`{ text, unit, raw }`。
 *   2. 变化量 / 极值 / 状态同样由后端返回 —— 有就直通，没有才退回按历史序列算。
 *   3. 多通道（tempHumi1..8 / soil / leaf / lds）暂不接，见文件末尾的缺口清单。
 *
 * 展示名（指标名 / 模块名）暂时仍由构建器的 LABELS 出。后端 `title` 已确认是
 * 按用户语言返回的、要原样上屏 —— 那件事还没做，方案定了再动这里。
 *
 * 键名照抄接口原样拼写（`tempf`、`windspeedmph`、`drew_temp`、`rrain_piezo` 这类
 * 历史命名），别按英文习惯改。dashboard 返回的每个指标都是信封：
 *
 *     data.tempf           = { title, value, unit }
 *     data.tempf_increment = { value, unit, symbol }
 *     data.max_daily_tempf = { value, unit, time }   // time 是 'HH:mm' 字符串
 */

import { DEFAULT_UNITS } from './widgetFormat.js'

/** 后端单位文本 → 配置层的单位枚举。认不出来的不覆盖默认值。 */
const UNIT_TOKENS = {
	'°C': 'C',
	'℃': 'C',
	'°F': 'F',
	'℉': 'F',
	'km/h': 'km/h',
	mph: 'mph',
	'm/s': 'm/s',
	mm: 'mm',
	in: 'in',
	'mm/h': 'mm',
	'in/h': 'in',
	hPa: 'hPa',
	inHg: 'inHg'
}

/**
 * 读数绑定：widget 读数字段 → dashboard 信封 key。
 * 空值/`-` 一律当缺测，模块层自动不显示，绝不填假值。
 */
const FIELDS = {
	outdoorCelsius: 'tempf',
	outdoorHumidity: 'humidity',
	dewPointCelsius: 'drew_temp',
	vpdKPa: 'vpd',
	indoorCelsius: 'tempinf',
	indoorHumidity: 'humidityin',
	indoorDewPointCelsius: 'drew_tempin',
	windKPH: 'windspeedmph',
	gustKPH: 'windgustmph',
	maxGustKPH: 'max_daily_windgustmph',
	rainRateMMH: 'rainratein',
	dailyRainMM: 'dailyrainin',
	piezoRainRateMMH: 'rrain_piezo',
	piezoDailyRainMM: 'drain_piezo',
	relativePressureHPA: 'baromrelin',
	absolutePressureHPA: 'baromabsin',
	solarWM2: 'solarradiation',
	uvIndex: 'uv',
	co2PPM: 'co2',
	co2Avg24h: 'co2_24h',
	co2TempCelsius: 'tf_co',
	co2Humidity: 'humi_co',
	pm25: 'pm25_co2',
	pm25Aqi: 'pm25_real_time_aqi_co2',
	lightningStrikes: 'lightning'
}

/**
 * 模块名来源：模块 key → 用哪张卡片的标题。
 * dashboard 的 list 项自带 `title_custom` / `title`，而且后端已按用户语言返回，
 * 所以模块名直接取它 —— 构建器里的 LABELS 只当后端没给时的兜底。
 */
const MODULE_TITLE_SOURCE = {
	outdoor: 'tempf',
	indoor: 'tempinf',
	wind: 'windspeedmph',
	rainfall: 'rainratein',
	rainfallPiezo: 'rrain_piezo',
	pressure: 'baromrelin',
	solar: 'solarradiation',
	co2: 'co2',
	co2Pm: 'pm25_co2',
	co2TempHumi: 'tf_co',
	lightning: 'lightning'
}

/** 变化量绑定：widget 读数字段 → dashboard 的 `*_increment` 信封 */
const DELTAS = {
	outdoorCelsius: 'tempf_increment',
	indoorCelsius: 'tempinf_increment',
	relativePressureHPA: 'baromrelin_increment',
	absolutePressureHPA: 'baromabsin_increment'
}

/** 极值绑定：widget 读数字段 → [最大信封, 最小信封]（最小可缺，单向语义的量没有） */
const PEAKS = {
	outdoorCelsius: ['max_daily_tempf', 'min_daily_tempf'],
	outdoorHumidity: ['max_daily_humidity', 'min_daily_humidity'],
	indoorCelsius: ['max_daily_tempinf', 'min_daily_tempinf'],
	indoorHumidity: ['max_daily_humidityin', 'min_daily_humidityin'],
	windKPH: ['max_daily_windspeedmph'],
	relativePressureHPA: ['max_daily_baromrelin', 'min_daily_baromrelin'],
	absolutePressureHPA: ['max_daily_baromabsin', 'min_daily_baromabsin'],
	solarWM2: ['max_daily_solarradiation'],
	uvIndex: ['max_daily_uv'],
	co2PPM: ['max_daily_co2', 'min_daily_co2'],
	co2TempCelsius: ['max_daily_tf_co', 'min_daily_tf_co'],
	co2Humidity: ['max_daily_humi_co', 'min_daily_humi_co']
}

/** 纯文本字段：widget 字段 → [信封 key, 子键] */
const TEXTS = {
	sunriseText: ['sunrise_time', 'value'],
	sunsetText: ['sunset_time', 'value'],
	uvMaxToday: ['max_daily_uv', 'value']
}

/**
 * 把所有卡片的 data 拍成两张表：
 *   nodes  —— key → 信封
 *   owners —— key → 这张卡片的标题（信封自己不带卡片名）
 *
 * dashboard 的 key 全局唯一（tempf / tempinf / windspeedmph…），所以不用管
 * 卡片属于谁、卡是什么 id —— 少一张需要跟后端同步的 id 映射表。
 */
function indexNodes(list) {
	const nodes = {}
	const owners = {}
	if (!list) return { nodes, owners }
	const items = Array.isArray(list) ? list : Object.keys(list).map((k) => list[k])
	items.forEach((item) => {
		const data = item && item.data
		if (!data) return
		// 顺序不能反：卡片上显示的是 `title`（用户改名写回的就是它，见 dashboard-wrap 的
		// title setter），`title_custom` 只是改名弹框的 placeholder 提示，不是当前名字。
		const title = item.title || item.title_custom || item.name || ''
		Object.keys(data).forEach((key) => {
			if (nodes[key] == null && data[key] != null) nodes[key] = data[key]
			if (owners[key] == null && title) owners[key] = String(title)
		})
	})
	return { nodes, owners }
}

/** 信封 → 读数单元；缺测返回 null */
function cellOf(node) {
	if (!node || node.value == null) return null
	const raw = node.value
	if (raw === '' || raw === '-') return null
	const unit = node.unit == null ? '' : String(node.unit)
	const num = Number(raw)
	if (!isFinite(num)) return { text: String(raw), unit }
	return { text: String(raw), unit, raw: num }
}

/**
 * 变化量信封 → `{ dir, value }`。
 * payload 里的变化量只带方向与幅度，符号由 dir 表达，所以 value 取绝对值。
 */
function deltaOfNode(node) {
	const cell = cellOf(node)
	if (!cell || cell.raw == null) return null
	const abs = Math.abs(cell.raw)
	const symbol = Number(node.symbol)
	return {
		dir: symbol > 0 ? 1 : symbol < 0 ? -1 : 0,
		value: abs < 10 ? abs.toFixed(1) : String(Math.round(abs))
	}
}

/** 极值信封对 → payload 的 peak 形状；两端都缺就是 null */
function peakOfNodes(maxNode, minNode) {
	const max = cellOf(maxNode)
	const min = cellOf(minNode)
	if (!max && !min) return null
	const peak = {}
	if (max) peak.max = { value: max.text, time: maxNode.time == null ? '' : String(maxNode.time) }
	// 最高最低同值时不算「有最低」，否则界面上会出现两个一样的数
	if (min && (!max || min.text !== max.text)) {
		peak.min = { value: min.text, time: minNode.time == null ? '' : String(minNode.time) }
	}
	return peak
}

/**
 * 雨状态码。dashboard 的 `srain_piezo.value`：
 * 0 = 无雨，2 = 漏水传感器离线（不宣称有没有雨），其余 = 有雨。
 */
function rainStateOfNode(node) {
	if (!node) return null
	const code = Number(node.value)
	if (!isFinite(code) || code === 2) return null
	return code === 0 ? 'dry' : 'raining'
}

/** 从信封里读出单位制；认不出来的项保持默认 */
function unitsOf(nodes) {
	const out = { ...DEFAULT_UNITS }
	const token = (key) => {
		const cell = cellOf(nodes[key])
		return cell && cell.unit ? UNIT_TOKENS[cell.unit] || null : null
	}
	const pick = (keys, field) => {
		for (let i = 0; i < keys.length; i++) {
			const t = token(keys[i])
			if (t) {
				out[field] = t
				return
			}
		}
	}
	pick(['tempf', 'tempinf'], 'temperature')
	pick(['windspeedmph', 'windgustmph'], 'wind')
	pick(['rainratein', 'dailyrainin', 'rrain_piezo'], 'rain')
	pick(['baromrelin', 'baromabsin'], 'pressure')
	return out
}

/** 读数名：信封自带的 `title`，键是 uid。后端叫什么就显示什么 */
function readingTitlesOf(nodes) {
	const out = {}
	Object.keys(DASH_UIDS).forEach((key) => {
		const node = nodes[key]
		if (node && node.title) out[DASH_UIDS[key]] = String(node.title)
	})
	return out
}

/** 模块名：锚点信封 → 所属卡片的标题；卡片标题缺失时退回信封自己的 title */
function moduleTitlesOf(nodes, owners) {	const out = {}
	Object.keys(MODULE_TITLE_SOURCE).forEach((moduleKey) => {
		const sourceKey = MODULE_TITLE_SOURCE[moduleKey]
		const node = nodes[sourceKey]
		const title = owners[sourceKey] || (node && node.title) || ''
		if (title) out[moduleKey] = String(title)
	})
	return out
}

/**
 * 模块顺序：按 dashboard `list` 里卡片出现的先后，把每张卡认成哪个模块。
 *
 * 为什么不在前端排：首页的卡片顺序是用户自己在排序页拖出来的（本地 Order 上行成
 * 后端的 ddash_ids），小组件跟随它就不用再让用户配第二遍。
 */
function moduleOrderOf(list) {
	const out = []
	if (!list) return out
	const items = Array.isArray(list) ? list : Object.keys(list).map((k) => list[k])
	const moduleKeys = Object.keys(MODULE_TITLE_SOURCE)
	items.forEach((item) => {
		const data = item && item.data
		if (!data) return
		for (let i = 0; i < moduleKeys.length; i++) {
			const moduleKey = moduleKeys[i]
			if (out.indexOf(moduleKey) >= 0) continue
			if (data[MODULE_TITLE_SOURCE[moduleKey]] != null) {
				out.push(moduleKey)
				return
			}
		}
	})
	return out
}

/**
 * dashboard 响应 → 构建器入参。
 *
 * @param {object} data  `res.data`，需要 `list` / `last_update` / `device_name`
 * @param {object} [opts]
 * @param {number} [opts.now]            当前毫秒（测试注入）
 * @param {string} [opts.fallbackStation] 设备名为空时的兜底
 * @returns {{ reading: object|null, history: object, units: object, connected: boolean }}
 */
export function snapshotFromDashboard(data, opts = {}) {
	const now = opts.now || Date.now()
	if (!data) return { reading: null, history: {}, units: { ...DEFAULT_UNITS }, connected: false }

	const indexed = indexNodes(data.list)
	const nodes = indexed.nodes
	if (!Object.keys(nodes).length) {
		return { reading: null, history: {}, units: { ...DEFAULT_UNITS }, connected: false }
	}

	const reading = {
		stationName: data.device_name || opts.fallbackStation || 'Weather Station',
		// 模块名：取承载该模块的那张卡片的标题（后端已按用户语言返回）
		moduleTitles: moduleTitlesOf(nodes, indexed.owners),
		// 读数名：信封自己的 title，同样以后端为准
		readingTitles: readingTitlesOf(nodes),
		// 模块顺序：跟着 dashboard 卡片的先后走
		moduleOrder: moduleOrderOf(data.list),
		// last_update 是「距上次上报的秒数」，-1 = 无数据。没这个字段就没法定 stale。
		observedAt: null
	}
	const seconds = Number(data.last_update)
	const connected = isFinite(seconds) && seconds >= 0
	if (connected) reading.observedAt = now - seconds * 1000

	Object.keys(FIELDS).forEach((field) => {
		reading[field] = cellOf(nodes[FIELDS[field]])
	})

	Object.keys(DELTAS).forEach((field) => {
		const cell = reading[field]
		const delta = deltaOfNode(nodes[DELTAS[field]])
		if (cell && delta) cell.delta = delta
	})

	Object.keys(PEAKS).forEach((field) => {
		const cell = reading[field]
		const peak = peakOfNodes(nodes[PEAKS[field][0]], nodes[PEAKS[field][1]])
		if (cell && peak) cell.peak = peak
	})

	Object.keys(TEXTS).forEach((field) => {
		const node = nodes[TEXTS[field][0]]
		if (node && node[TEXTS[field][1]] != null) reading[field] = String(node[TEXTS[field][1]])
	})

	// 风向：角度留给指针用，文字直接用后端给的方位（`direction`）
	const winddir = nodes.winddir
	if (winddir) {
		const deg = Number(winddir.value)
		if (isFinite(deg)) reading.windDegrees = deg
		if (winddir.direction != null) reading.windDirectionText = String(winddir.direction)
	}

	reading.rainState = rainStateOfNode(nodes.srain_piezo)

	return { reading, history: {}, units: unitsOf(nodes), connected }
}

// ---------------------------------------------------------------------------
// 历史序列：复用 graph 页那条现成的接口（GET /graph/data，mode=5 = 最近 24 小时）
// ---------------------------------------------------------------------------

/**
 * dashboard 的字段 key → payload 的 uid。
 *
 * 这张表是**唯一**的对应关系来源：
 *   - 历史序列靠它归类（`/graph/data` 的 list key → uid）
 *   - 读数名靠它取信封的 `title`（后端已按用户语言返回）
 *
 * 键名照抄接口原样拼写，别按英文习惯改。
 */
const DASH_UIDS = {
	tempf: 'outdoor.temperature',
	humidity: 'outdoor.humidity',
	drew_temp: 'outdoor.dewPoint',
	vpd: 'outdoor.vpd',
	tempinf: 'indoor.temperature',
	humidityin: 'indoor.humidity',
	drew_tempin: 'indoor.dewPoint',
	windspeedmph: 'wind.speed',
	windgustmph: 'wind.gust',
	max_daily_windgustmph: 'wind.maxGust',
	winddir: 'wind.direction',
	// 雨量：dashboard 是两张卡（同一个 dash-rain 组件、不同 id），
	// 所以小组件里也是两个模块，各自带 rate / daily 两个维度
	rainratein: 'rainfall.rate',
	dailyrainin: 'rainfall.daily',
	hourlyrainin: 'rainfall.hourly',
	last24hrainin: 'rainfall.day24',
	weeklyrainin: 'rainfall.week',
	rrain_piezo: 'rainfallPiezo.rate',
	drain_piezo: 'rainfallPiezo.daily',
	hrain_piezo: 'rainfallPiezo.hourly',
	last24hrain_piezo: 'rainfallPiezo.day24',
	wrain_piezo: 'rainfallPiezo.week',
	baromrelin: 'pressure.relative',
	baromabsin: 'pressure.absolute',
	solarradiation: 'solar.radiation',
	sunrise_time: 'solar.sunrise',
	sunset_time: 'solar.sunset',
	// 辐射与 UV 是同一张 dash-solar 卡上的两个维度
	uv: 'solar.index',
	max_daily_uv: 'solar.maxToday',
	co2: 'co2.level',
	co2_24h: 'co2.avg24',
	// dash-co2-temp-humi（id 11）：温度 + 湿度两个维度
	tf_co: 'co2TempHumi.temperature',
	humi_co: 'co2TempHumi.humidity',
	max_daily_tf_co: 'co2TempHumi.maxToday',
	min_daily_tf_co: 'co2TempHumi.minToday',
	max_daily_humi_co: 'co2TempHumi.maxHumidity',
	min_daily_humi_co: 'co2TempHumi.minHumidity',
	// PM2.5 / AQI 在 dashboard 上是另一张卡（dash-co2-pm）
	pm25_co2: 'co2Pm.pm25',
	pm25_real_time_aqi_co2: 'co2Pm.aqi',
	lightning: 'lightning.strikes'
}

/** 其中「能画成曲线」的那部分 key（graph 接口会给时间序列的） */
const SERIES_KEYS = [
	'tempf',
	'humidity',
	'tempinf',
	'humidityin',
	'windspeedmph',
	'windgustmph',
	'rainratein',
	'rrain_piezo',
	'baromrelin',
	'baromabsin',
	'solarradiation',
	'uv',
	'co2',
	'pm25_real_time_aqi_co2',
	'tf_co',
	'humi_co'
]

const STAMP_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/

/**
 * `'2026-02-19 14:30:00'` → 毫秒。
 * 不交给 `new Date(str)`：JSCore 不认这种带空格的写法，会解析成 Invalid Date。
 */
function stampOf(text) {
	const m = STAMP_RE.exec(String(text == null ? '' : text))
	if (!m) return null
	return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
}

/** 一张 list 项里最长的值数组长度（各序列长度应当一致，取最大以免截断） */
function longestSeries(list) {
	let n = 0
	Object.keys(list || {}).forEach((key) => {
		const arr = list[key]
		if (Array.isArray(arr) && arr.length > n) n = arr.length
	})
	return n
}

/**
 * 横轴时间戳。
 *
 * graph 接口只给 `times`（`'14:30'` 这种人看的字符串）和 `dates`（完整日期时间），
 * 而 payload 的窗口过滤、极值、变化量全按 epoch 毫秒算，所以这里必须以 `dates` 为准。
 * `dates` 缺失或解析失败时退回「末点 = now，往前等距铺」——mode=5 就是最近 24 小时，
 * 这条退路至少能画出形状，而不是整块空图。
 */
function stampsOf(data, now) {
	const length = longestSeries(data.list)
	if (!length) return []
	const dates = Array.isArray(data.dates) ? data.dates : []
	if (dates.length >= length) {
		const parsed = []
		for (let i = 0; i < length; i++) parsed.push(stampOf(dates[i]))
		if (parsed.every((v) => v != null)) return parsed
	}
	const end = now
	const step = length > 1 ? (24 * 3600 * 1000) / (length - 1) : 0
	const out = []
	for (let i = 0; i < length; i++) out.push(Math.round(end - step * (length - 1 - i)))
	return out
}

/**
 * `/graph/data` 的 `res.data` → 按 uid 归类的历史序列，喂给 buildWidgetPayloadV4。
 *
 * 一个 graph 里可能有多条序列（室外图 = 温度 + 湿度），全部收下：
 * 用不上的会被构建器忽略，多收不花钱。
 *
 * @param {object} data `res.data`
 * @param {object} [opts]
 * @param {number} [opts.now] 当前毫秒（测试注入）
 * @returns {object} `{ 'outdoor.temperature': { points: [[ts, v], ...] }, ... }`
 */
export function historyFromGraph(data, opts = {}) {
	const out = {}
	if (!data || !data.list) return out
	const now = opts.now || Date.now()
	const stamps = stampsOf(data, now)
	if (!stamps.length) return out

	Object.keys(data.list).forEach((key) => {
		if (SERIES_KEYS.indexOf(key) < 0) return
		const values = data.list[key]
		if (!Array.isArray(values) || !values.length) return
		const points = []
		for (let i = 0; i < values.length && i < stamps.length; i++) {
			const raw = values[i]
			// graph 用 null / '' 表示缺测：跳过这个点，不要把 0 画进曲线
			if (raw == null || raw === '') continue
			const v = Number(raw)
			if (!isFinite(v)) continue
			points.push([stamps[i], v])
		}
		if (points.length >= 2) out[DASH_UIDS[key]] = { points }
	})
	return out
}

/**
 * 找出承载某个 uid 的那张卡片，拿到它的 graph_id —— 用来发历史请求。
 * dashboard 的 list 项带 `graph_id`，一个 graph_id 对应 graph 页里的一个图表。
 *
 * @returns {{ graphId: string, sourceKey: string } | null}
 */
export function graphTargetOf(list, uid) {
	if (!list || !uid) return null
	let sourceKey = ''
	SERIES_KEYS.forEach((key) => {
		if (DASH_UIDS[key] === uid) sourceKey = key
	})
	if (!sourceKey) return null
	const items = Array.isArray(list) ? list : Object.keys(list).map((k) => list[k])
	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (!item || !item.data || item.data[sourceKey] == null) continue
		if (item.graph_id == null || item.graph_id === '') return null
		return { graphId: String(item.graph_id), sourceKey }
	}
	return null
}

/**
 * 组件要画哪几条曲线（payload 的 uid 列表，最多两条）。
 *
 * 大卡的 hero 和 small/medium 的 feature **可能不是同一个模块**：
 * feature 走 pickFeature，uid 找不到时会回落到「已排序模块的第一个」，
 * 而 hero 用的是配置里的 modules[0]。两者一分叉，只取 feature 那份历史，
 * 大卡第一块的曲线就是空的（Android 上直接 GONE，连空态都没有）。
 *
 * 所以两个都取，按模块去重。App 侧取数和原生自拉取的 demo/后端服务都用这一份，
 * 别各写一套 —— 分叉的代价是「前端有曲线、后台回来没曲线」这种最难查的 bug。
 */
export function historyUidsOf(payload) {
	const out = []
	const p = payload && typeof payload === 'object' ? payload : {}
	const selection = p.selection && typeof p.selection === 'object' ? p.selection : {}
	const pushUid = (uid) => {
		const moduleKey = String(uid || '').split('.')[0]
		if (!moduleKey) return
		if (out.some((u) => u.split('.')[0] === moduleKey)) return
		out.push(uid)
	}
	pushUid(selection.feature)
	const modules = Array.isArray(p.modules) ? p.modules : []
	const hero = modules.filter((m) => m.key === selection.hero)[0]
	if (hero && hero.readings && hero.readings[0]) {
		pushUid(hero.key + '.' + hero.readings[0].key)
	}
	return out
}

// ---------------------------------------------------------------------------
// 最近一次真实数据源：设置页预览 / 保存都拿它，避免用样例数据覆盖桌面
// ---------------------------------------------------------------------------

/** 缓存键。键名带版本：结构变了老缓存直接失效，不用写迁移 */
export const WIDGET_SOURCE_KEY = 'ecowitt_widget_source_v1'

/**
 * 首页写完小组件后，把「这次用的数据」留一份。
 *
 * 为什么要存：设置页保存时会重新构建一次 payload 推给桌面。它手上没有真实读数，
 * 以前用内置样例数据凑 —— 一保存，桌面上的数字就变成假值，等下次数据上报才改回来。
 * 表现就是数字在真实值和样例值之间跳。
 */
export function writeCachedSource(value) {
	try {
		uni.setStorageSync(WIDGET_SOURCE_KEY, value)
	} catch (e) {
		// 存不下（配额/序列化失败）就算了，设置页自然退回样例数据
	}
}

/** 读回上次的真实数据源；没有 / 已失效返回 null */
export function readCachedSource(opts = {}) {
	try {
		const hit = uni.getStorageSync(WIDGET_SOURCE_KEY)
		const value = typeof hit === 'string' ? JSON.parse(hit) : hit
		if (!value || !value.reading) return null
		// 超过半天的数据不再用于「预览」，否则设置页会显示过时数值
		const ttl = opts.ttl == null ? 12 * 3600 * 1000 : opts.ttl
		if (value.at && Date.now() - value.at > ttl) return null
		return value
	} catch (e) {
		return null
	}
}

/**
 * 已知缺口（等后端补字段，不要在前端编数据）：
 *   pressure.sealevel    dashboard 没有海平面气压，靠后端口径定
 *   rainfall.piezo 合计  只有 rrain_piezo / drain_piezo，周月年没有 piezo 版
 *   uv.level             dashboard 不给等级文字，只有数值 → 该行不显示
 *   lightning.*          只有 `lightning` 一个信封：最近 1 小时 / 今日 / 最近距离都没有
 *   battery.volt         电池卡只有 low/normal/offline 三个状态键，没有电压
 *   多通道               每通道是独立的 list 项（temp{n} / soilmoisture{n} /
 *                        tf_ch{n} / leafwetness{n} / air_ch{n}），需要按通道生成
 *                        module key（tempHumi1..8…），要等 MAX_MODULES 扩容方案定下来
 *   历史序列             dashboard 不给时间序列，曲线只能等 /device/{id}/widget 接口
 */

/**
 * 原生自拉取：payload 的 `fetch` 段 + 数据段的合并规则
 *
 * 背景见 native/ios-widget/DATA-SOURCE.md §6。一句话：
 *   App 不在前台时，组件自己按 fetch 段里的地址拉一份「数据段」写回共享区，
 *   token 段（配色/字号/图标/文案）原样保留。
 *
 * 这里有两个只能有一份实现的东西：
 *   1. `fetch` 段怎么拼（地址、认证、间隔、超时）
 *   2. 数据段是哪几个键（WIDGET_DATA_KEYS）
 * 原生两端各抄一份合并逻辑（Swift / Kotlin 没法 import JS），
 * 键名是否一致由 script/check_widget_parity.py 守着。
 */

/** 用户有没有自己排过模块顺序 —— 决定自拉取回来的模块按谁的顺序走 */
import { orderCustomized } from './widgetConfig.js'

/** 接口路径。改它只需要发一版 JS，不用重打基座。
 *
 * 设备不进路径、走 `?device_id=`：和 /dashboard/data、/graph/data 一个风格，
 * 后端换路由也不用动原生。值里的 `{id}` 由原生替换成 payload.deviceId。
 *
 * TODO(接正式接口) 路径待后端定；定了只改这一行 —— 原生不认识路径，它只认 fetch.url。
 */
export const WIDGET_FETCH_PATH = '/widget/data'

/** 请求超时（毫秒）。原生侧必须严格遵守，否则 iOS 时间线会被系统判超时 */
export const WIDGET_FETCH_TIMEOUT = 5000

/**
 * 兜底阈值下限（分钟）。
 *
 * 「前台还在喂数据就别去拉」—— 判据是共享区上一次写盘的时间。
 * 阈值太小学不到东西还费电，所以给个下限。
 */
export const WIDGET_FETCH_MIN_AGE = 5

/** 拉取失败后多久再试（分钟）。iOS 时间线用它排下一次；Android 由周期任务自己兜 */
export const WIDGET_FETCH_RETRY_MINUTES = 15

/** 时间线抖动上限（秒）。iOS 用：避免所有组件在同一分钟醒来 */
export const WIDGET_FETCH_JITTER_SECONDS = 120

/**
 * 数据段 = 原生允许覆盖的键。
 *
 * 白名单**不是**「数据相关的键」，而是「后端能独立算出、且与 token 段无关的键」。
 * 加新键之前先问：JS 写的和原生写的会不会打架？会打架的键不许进来。
 */
export const WIDGET_DATA_KEYS = [
	'deviceId',
	'station',
	'updated',
	'updatedShort',
	'status',
	'observedAt',
	'selection',
	'modules'
]

/**
 * 联调用的地址覆盖键（uni storage）。
 *
 * 本地 demo 服务、临时域名、灰度环境都靠它切，不用改代码重新发版。
 * 生产环境留空 = 用 setWidgetFetchBase 注入的正式地址。
 */
export const WIDGET_FETCH_BASE_KEY = 'widgetFetchBase'

/**
 * 联调用：把兜底阈值临时压小（分钟）。
 *
 * 门控默认是 interval−5，最少 10 分钟 —— 想立刻验一次「组件会不会自己拉」要等太久。
 * iOS 尤其难受（没有 adb，只能删组件重加来触发）。
 * 联调时 `uni.setStorageSync('widgetFetchMinAge', 1)`，重启 App 就生效，不用重打基座。
 * **上线前记得 removeStorageSync 掉**。
 */
export const WIDGET_FETCH_MINAGE_KEY = 'widgetFetchMinAge'

/** 正式基址，由 App 启动时从 unit/config.js 注入（见 App.vue） */
let fetchBase = ''

/** 环境：test | prod。由 App 启动时按 config.js 的判定结果注入 */
let fetchEnv = 'prod'
/**
 * ===== TEMP 联调开关 =====
 *
 * TODO(接正式接口) 后端 `/widget/data` 上线后，把下面两个常量清空/删掉整段。
 *   改完要让 App 跑上新代码：HBuilderX 重新运行一次即可，不用重打基座。
 *
 * DEBUG_FETCH_BASE 非空时，App 启动直接用它当基址，**盖掉 config.appBaseUrl**：
 * 自拉取会打到本机的 demo 适配服务（`docx/widget-demo-server.mjs` + ngrok），
 * 而不是 api.ecowitt.net 上还没实现的 /widget/data。
 *
 * DEBUG_FETCH_MIN_AGE 非空时，App 启动会把它写进 storage（等同于手动设 WIDGET_FETCH_MINAGE_KEY），
 * 兜底阈值直接用它，不用等 interval−5。
 *
 * ⚠️ 只要 DEBUG_FETCH_BASE 非空，设置页的「恢复正式地址」也回不到线上。
 */
export const DEBUG_FETCH_BASE = 'https://tiara-corded-theressa.ngrok-free.dev'
export const DEBUG_FETCH_MIN_AGE = 1
// ===== TEMP 结束 =====

/** 注入正式基址。widgetSync 在 H5 / 小程序下不会调用，留空即可 */
export function setWidgetFetchBase(url) {
	fetchBase = String(url || '')
		.replace(/\/+$/, '')
}

/**
 * 告诉后面那台服务：这台设备连的是哪个环境（`test` / `prod`）。
 *
 * 为什么由 JS 说而不是让服务端猜：环境是 `unit/config.js` 按 `plus.storage.testEnv`
 * 在**运行时**定的，服务端静态读那个文件只会读到默认值。
 * 而联调时请求会打到本机适配服务（ngrok / 局域网），host 里已经看不出环境了，
 * 所以必须显式带上 —— 否则正式服 token 打测试服，报错和「token 过期」一模一样。
 */
export function setWidgetFetchEnv(env) {
	fetchEnv = env === 'test' ? 'test' : 'prod'
}

/** 从任意 base 地址反推环境（config.appBaseUrl 里有 apitest 就是测试服） */
export function envOfBase(base) {
	return String(base || '').indexOf('apitest') >= 0 ? 'test' : 'prod'
}

export function getWidgetFetchBase() {
	return fetchBase
}

/**
 * 真正下发给原生的地址。
 *
 * 整条 URL 由 JS 拼完整：设备、用户、以及「要渲染哪些模块」的配置全在里面。
 * 原生只做一件事 —— 把 `{id}` 换成 payload.deviceId 然后 GET。
 *
 * 为什么配置要跟着请求走：数据段里的 modules/selection 完全由用户配置决定，
 * 后端（或 demo 服务）不知道用户桌面上排了哪几张卡就算不出来。
 * 塞进 query 而不是让原生读 payload 的一部分，是为了让原生不用理解 payload 结构 ——
 * 它只认 fetch 段，token 段里再多字段都和它无关。
 */
export function resolveFetchUrl(options = {}) {
	const fromEnv = String(readStorage(WIDGET_FETCH_BASE_KEY) || '').replace(/\/+$/, '')
	const base = fromEnv || fetchBase
	if (!base) return ''
	const query = ['device_id={id}']
	if (options.userId) query.push('user_id=' + encodeURIComponent(options.userId))
	const cfg = renderConfigOf(options.payload, options.config)
	if (cfg) query.push('cfg=' + encodeURIComponent(JSON.stringify(cfg)))
	// 告诉适配服务该用哪个环境的上游（见 setWidgetFetchEnv 的注释）
	// TODO(接正式接口) 正式接口如果靠自己域名区分环境，这个参数可以删；
	//   留着也无害 —— 不认识的自定义后端忽略未知 query 即可
	query.push('env=' + fetchEnv)
	return base + WIDGET_FETCH_PATH + (query.length ? '?' + query.join('&') : '')
}

/**
 * 请求里带的那份渲染配置。
 *
 * `modules` 取用户配置（不是 payload 里过滤后的结果）：传感器临时掉线时卡片应该还在，
 * 只是没有读数，而不是整块消失 —— 这个过滤由后端按数据做，和 App 侧同一套规则。
 */
function renderConfigOf(payload, config) {
	const p = payload && typeof payload === 'object' ? payload : {}
	const cfg = config && typeof config === 'object' ? config : {}
	const selection = p.selection && typeof p.selection === 'object' ? p.selection : {}
	const modules = Array.isArray(cfg.modules) ? cfg.modules : []
	if (!modules.length) return null
	return {
		modules,
		feature: selection.feature || '',
		hero: selection.hero || '',
		featured: selection.featured || {},
		lang: p.lang || 'en',
		/**
		 * 模块顺序要不要按 modules 这个数组来。
		 *
		 * 用户没自己排过 → false，跟 dashboard 卡片顺序（App 侧就是 useConfigOrder=false）。
		 * 少了这个标志，自拉取回来的模块顺序可能和 App 写的不是一套：
		 * 数值都对，顺序一跳，看着就像「桌面自己乱动」。
		 */
		order: !!orderCustomized(cfg)
	}
}


function readStorage(key) {
	try {
		return uni.getStorageSync(key)
	} catch (e) {
		return ''
	}
}

/**
 * 兜底阈值：默认 `interval − 5`（下限 5），联调可用 storage 压到 1 分钟。
 * 覆盖值只在 1~240 之间生效，脏值一律忽略 —— 0 / 空串 / 乱填都会走默认。
 */
function minAgeOf(interval) {
	const override = Number(readStorage(WIDGET_FETCH_MINAGE_KEY))
	if (isFinite(override) && override >= 1 && override <= 240) return Math.floor(override)
	return Math.max(WIDGET_FETCH_MIN_AGE, interval - 5)
}

/**
 * 拼 `fetch` 段。
 *
 * 没有登录态时 `enabled = false`：登出后共享区里还留着 token 段是既定事实，
 * 但绝不能让组件带着旧 token 继续打接口。
 */
export function buildFetchSegment(options = {}) {
	const enabled = options.enabled !== false
	const token = options.token == null ? '' : String(options.token)
	const userId = options.userId == null ? '' : String(options.userId)
	const deviceId = options.deviceId == null ? '' : String(options.deviceId)
	const url = enabled ? resolveFetchUrl(options) : ''
	const interval = Number(options.intervalMinutes) > 0 ? Number(options.intervalMinutes) : 30
	return {
		// 四个维度缺一不可：地址、设备、用户、登录态。
		// 少一个就让原生别动 —— 带病请求只会换来一堆 401，还费电
		enabled: !!(enabled && url && token && userId && deviceId),
		url,
		// 原生拼请求时替换 {id}；也是「点组件切设备」用的那个 id
		deviceId,
		intervalMinutes: interval,
		/**
		 * 兜底阈值：共享区超过这么久没被写过，才轮到原生去拉。
		 *
		 * 取 `interval - 5` 而不是等于 interval：周期任务的唤醒本来就有几秒到几分钟的抖动，
		 * 阈值卡在正好的位置会让「拉不拉」在边界上来回摇。留 5 分钟余量，行为就稳定了。
		 * 联调可以用 storage 覆盖（见 WIDGET_FETCH_MINAGE_KEY）。
		 */
		minAgeMinutes: minAgeOf(interval),
		// 失败后的重试间隔（iOS 时间线用）
		retryMinutes: WIDGET_FETCH_RETRY_MINUTES,
		// 时间线抖动上限（iOS 用；Android 的抖动由 JobScheduler 自己加）
		jitterSeconds: WIDGET_FETCH_JITTER_SECONDS,
		authHeader: 'Token',
		authValue: token,
		timeoutMs: WIDGET_FETCH_TIMEOUT
		// TODO(接正式接口) 认证方式定下来后，这里可能是 Bearer / 签名参数；
		//   改这里就行，原生只按 authHeader/authValue 照做
	}
}

/**
 * 写盘前的最后一步：给 payload 挂上 `fetch` 段。
 *
 * 只依赖入参和 storage，不 import 任何业务模块 —— 这样三条写盘路径
 * （首页 mixin / 设置页 / 调试页）都能用同一个函数，不会各拼一套。
 */
export function attachWidgetFetch(payload, config) {
	const cfg = config || {}
	const base = payload && typeof payload === 'object' ? payload : {}
	return {
		...base,
		fetch: buildFetchSegment({
			enabled: cfg.fetchEnabled !== false,
			deviceId: base.deviceId,
			intervalMinutes: cfg.refreshMinutes,
			payload: base,
			config: cfg,
			// 没有登录态时 enabled=false：登出后共享区里还留着旧 token 是既定事实，
			// 但绝不能让组件带着它继续打接口
			token: readStorage('token'),
			userId: readStorage('user_id')
		})
	}
}

/** 从整份 payload 里摘出数据段（demo 服务、测试、后端都按这个口径） */export function dataSegmentOf(payload) {
	const out = {}
	if (!payload || typeof payload !== 'object') return out
	WIDGET_DATA_KEYS.forEach((key) => {
		if (payload[key] !== undefined) out[key] = payload[key]
	})
	return out
}

/**
 * 合并数据段。原生两端是这段逻辑的翻译版，行为必须一致：
 * 只覆盖白名单里的键，其余原样；数据段里缺的键不删也不要设成 undefined。
 */
export function mergeDataSegment(payload, segment) {
	const out = { ...(payload || {}) }
	if (!segment || typeof segment !== 'object') return out
	WIDGET_DATA_KEYS.forEach((key) => {
		if (segment[key] !== undefined) out[key] = segment[key]
	})
	return out
}

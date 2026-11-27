/**
 * 桌面小组件数据同步
 *
 * 数据契约 v2（插槽式）：App 侧决定「显示哪些指标、什么顺序、每种尺寸几条、什么颜色」，
 * 扩展侧只负责按块渲染。所以下面这些变化都不需要重编 .appex：
 *   - 加减指标、调顺序、改文案/单位
 *   - 换主数值、改每尺寸条数
 *   - 改配色
 *
 * 真正需要重编的只有：卡片布局结构、刷新策略、新增 block 类型。
 *
 * 真实接入点：在拿到设备实时数据的地方（首页 / dashboard）调用 syncWidget，
 * 把 6 个指标的值映射进 values 即可。
 *
 * 说明：标准基座里不含 uts 插件，调用会被抛错拦截在原生层，
 * 所以这里全部包了 try/catch，保证 demo 页在任意环境都不会崩。
 *
 * 平台：iOS 走 WidgetKit，Android 走 AppWidgetProvider，两端共用同一份 payload。
 * 差异（App Group / 刷新预算 / 图标体系）由原生侧吸收，JS 层保持一致。
 */

// 用 APP-PLUS 而不是 APP-IOS：旧版 HBuilderX 不认 APP-IOS 条件编译，
// 会把整块连同 import 一起剥掉，表现就是「当前平台不支持桌面小组件」。
// 平台差异放到运行时判断（isIosApp / isAndroidApp）。两端插件都有实现，import 安全。
// #ifdef APP-PLUS
import {
	pushWidgetData,
	reloadWidget,
	readWidgetData,
	takePendingNav,
	hasWidgets as pluginHasWidgets
} from '@/uni_modules/ecowitt-widget'
// #endif

import { attachWidgetFetch } from './widgetFetch.js'
import { getWidgetConfig } from './widgetConfig.js'



/** 与 nativeResources/ios、WidgetPayload.swift 中的 App Group 必须完全一致 */
export const WIDGET_APP_GROUP = 'group.com.ost.ecowitt'
export const WIDGET_KIND = 'EcowittWidget'

/** 运行时是否为 Android App */
export function isAndroidApp() {
	// #ifdef APP-PLUS
	try {
		return uni.getSystemInfoSync().platform === 'android'
	} catch (e) {
		return false
	}
	// #endif
	return false
}

/** 运行时是否为 iOS App（不依赖条件编译，旧版 HBuilderX 也能正确判断） */
export function isIosApp() {
	// #ifdef APP-PLUS
	try {
		return uni.getSystemInfoSync().platform === 'ios'
	} catch (e) {
		return false
	}
	// #endif
	return false
}

/** 当前环境是否可能真的写出数据（只做平台判断，不保证原生产物已打进包） */
export function isWidgetPlatform() {
	return isIosApp() || isAndroidApp()
}

/** 能否调用原插件（两端都走同一套 uts 插件 API） */
function canCallPlugin() {
	return isIosApp() || isAndroidApp()
}

/**
 * 设备端诊断：把「编译进了哪条分支、平台是什么、插件模块能不能拿到」一次说清。
 * 用于排查「提示当前平台不支持桌面小组件」这类问题，不需要连电脑看日志。
 */
export function getPlatformInfo() {
	const info = {
		builtWithAppPlus: false, // APP-PLUS 条件编译是否生效
		platform: 'unknown',
		isIos: false,
		isAndroid: false,
		pluginAvailable: false,
		pluginError: ''
	}

	// #ifdef APP-PLUS
	info.builtWithAppPlus = true
	try {
		info.platform = uni.getSystemInfoSync().platform
		info.isIos = info.platform === 'ios'
		info.isAndroid = info.platform === 'android'
	} catch (e) {
		info.platform = 'getSystemInfoSync failed: ' + (e && e.message)
	}
	try {
		// 真正调一次插件，能拿到（哪怕是空串）就说明 native 侧在
		readWidgetData(WIDGET_APP_GROUP)
		info.pluginAvailable = true
	} catch (e) {
		info.pluginError = (e && e.message) ? e.message : String(e)
	}
	// #endif

	return info
}

/** 失败时给一句能直接定位的话 */
function unsupportedMessage() {
	// #ifdef APP-PLUS
	try {
		const p = uni.getSystemInfoSync().platform
		if (p !== 'ios' && p !== 'android') {
			return '当前平台是 ' + p + '，桌面小组件仅支持 iOS / Android'
		}
		if (p === 'android') {
			return 'Android 端未生效（请确认自定义基座里包含 ecowitt-widget 插件）'
		}
	} catch (e) {
		// ignore
	}
	// #endif
	return '当前平台不支持桌面小组件（请确认是自定义基座，且已包含 ecowitt-widget 插件）'
}

/**
 * 桌面上是否真的放着这个组件。
 *
 * 只有真的放了，才值得去请求数据、写盘、reload —— 否则纯属白烧电和流量。
 * 结果缓存 60 秒（用户加/删组件不会通知我们，只能粗粒度轮询）。
 *
 * 拿不到结果时一律返回 true：老基座没有这个 API 时保持原有行为，
 * 也不因为一次查询失败就永久停更。
 */
let presenceCache = { at: 0, value: true }

export function isWidgetInstalled() {
	if (!isWidgetPlatform()) return false
	const now = Date.now()
	if (presenceCache.at && now - presenceCache.at < 60 * 1000) return presenceCache.value
	let value = true
	// #ifdef APP-PLUS
	if (canCallPlugin()) {
		try {
			value = pluginHasWidgets() === true
		} catch (e) {
			value = true
		}
	}
	// #endif
	presenceCache = { at: now, value }
	return value
}

/** 用户可能在设置页刚加 / 刚删组件，需要强制重新查一次 */
export function invalidateWidgetPresence() {
	presenceCache = { at: 0, value: true }
}

/**
 * 写盘前挂上 `fetch` 段（原生自拉取的地址 / 认证 / 间隔）。
 *
 * 放在这里而不是各个调用点：写盘只有这一个出口，谁漏了都会变成
 * 「桌面更新一开始好用、后来不动了」这种要连电脑才查得出来的问题。
 */
function withFetch(payload) {
	if (!payload || typeof payload !== 'object') return payload
	try {
		return attachWidgetFetch(payload, getWidgetConfig())
	} catch (e) {
		// 配置读失败也要能发：发一份关掉自拉取的 payload，总比什么都写不了强
		return attachWidgetFetch(payload, { fetchEnabled: false })
	}
}

export function syncWidgetPayload(payload) {
	return pushJson(withFetch(payload))
}

/** 真正落盘的那一步：不掺杂任何「补字段」的逻辑，登出时也要用它 */
function pushJson(payload) {
	const json = JSON.stringify(payload)
	let result = {
		success: false,
		message: unsupportedMessage()
	}

	// #ifdef APP-PLUS
	if (canCallPlugin()) {
		try {
			result = pushWidgetData(json, WIDGET_APP_GROUP, WIDGET_KIND)
		} catch (e) {
			result = {
				success: false,
				message: '调用失败：' + (e && e.message ? e.message : '基座未包含 ecowitt-widget 插件')
			}
		}
	}
	// #endif

	return result
}

/** 只刷新，不写数据 */
export function refreshWidget() {
	let result = {
		success: false,
		message: unsupportedMessage()
	}
	// #ifdef APP-PLUS
	if (canCallPlugin()) {
		try {
			result = reloadWidget(WIDGET_KIND)
		} catch (e) {
			result = {
				success: false,
				message: '调用失败：' + (e && e.message ? e.message : 'unknown')
			}
		}
	}
	// #endif
	return result
}

/** 读回共享区当前数据，调试用 */
export function readWidgetDataJson() {
	let json = ''
	// #ifdef APP-PLUS
	if (canCallPlugin()) {
		try {
			json = readWidgetData(WIDGET_APP_GROUP)
		} catch (e) {
			json = ''
		}
	}
	// #endif
	return json
}

/**
 * 把共享区里那份 payload 的 fetch 段按「当前配置」重算一遍，变了才写。
 *
 * 为什么需要：接口地址是热更新的（`widgetFetchBase` / `config.appBaseUrl`），
 * 但地址只在**写盘时**才会被重新拼进 payload。App 开着、dashboard 数据又没变化时
 * （指纹去重不写盘），桌面会一直用旧地址 —— 表现是「改了地址没反应」。
 *
 * 所以：启动时、切环境后、联调改地址后，调一次这个。
 * 比的是**整段 fetch**（url / 间隔 / 阈值 / token 都算）：只要有一项变了就重写，
 * 一项都没变就一次都不写 —— 多写一次会刷新 updated_at，把原生自拉取的门控白挡一轮。
 */
export function syncWidgetFetchIfChanged() {
	const json = readWidgetDataJson()
	if (!json) return { applied: false, reason: '共享区没有数据' }
	let payload
	try {
		payload = JSON.parse(json)
	} catch (e) {
		return { applied: false, reason: '共享区数据不是合法 JSON' }
	}
	let next
	try {
		next = attachWidgetFetch(payload, getWidgetConfig())
	} catch (e) {
		return { applied: false, reason: '读取组件配置失败' }
	}
	const before = JSON.stringify((payload && payload.fetch) || {})
	if (JSON.stringify(next.fetch) === before) return { applied: false, reason: 'fetch 段没变' }
	return { applied: true, result: pushJson(next) }
}

/**
 * 登出：把共享区里那份 payload 的自拉取关掉。
 *
 * 共享区里的 token 段是所有扩展进程都能读的（DATA-SOURCE.md §6.2 的既定取舍），
 * 登出后不清掉，组件就会一直带着上一个账号的 token 去打接口。
 * 不清整份数据 —— 那会让桌面变空白，比「数据停在最后一刻」更糟。
 */
export function disableWidgetFetch() {
	const json = readWidgetDataJson()
	if (!json) return { success: false, message: '共享区没有数据' }
	try {
		const payload = JSON.parse(json)
		return pushJson(attachWidgetFetch(payload, { fetchEnabled: false }))
	} catch (e) {
		return { success: false, message: '读取共享区失败：' + (e && e.message ? e.message : 'unknown') }
	}
}

/**
 * 读取「小组件被点击后要跳转的页面」，读完即清空。
 * iOS：appex 的 AppIntent 把目标路径写进 App Group（因为 DCloud 运行时拿不到 scheme 参数）
 * Android：点击走启动 Intent 的 data，走 plus.runtime.arguments，这里返回空串
 */
export function takeWidgetPendingNav() {
	if (!isIosApp()) return ''
	try {
		return String(takePendingNav('') || '')
	} catch (e) {
		return ''
	}
}
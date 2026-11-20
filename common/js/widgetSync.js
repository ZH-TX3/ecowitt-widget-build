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
import { pushWidgetData, reloadWidget, readWidgetData } from '@/uni_modules/ecowitt-widget'
// #endif



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

export function syncWidgetPayload(payload) {
	const json = JSON.stringify(payload)
	let result = { success: false, message: unsupportedMessage() }

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

	console.log('[widget] sync v' + (payload && payload.schemaVersion), result)
	return result
}

/** 只刷新，不写数据 */
export function refreshWidget() {
	let result = { success: false, message: unsupportedMessage() }
	// #ifdef APP-PLUS
	if (canCallPlugin()) {
		try {
			result = reloadWidget(WIDGET_KIND)
		} catch (e) {
			result = { success: false, message: '调用失败：' + (e && e.message ? e.message : 'unknown') }
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

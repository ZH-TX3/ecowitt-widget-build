/**
 * 小组件用户配置（v3）
 *
 * 参数驱动的配置模型。v2 那套「勾选指标 + 挑主数值」已退役，不再维护。
 *
 * v3 语义：一张卡 = 一个参数。用户能配的是「看哪个参数、什么单位、什么外观、
 * 多久刷一次」，不是勾一堆指标。
 *
 * 一个当前限制：payload 里 `parameter` 是单个字段，small / medium 必然显示
 * 同一个参数（见 DESIGN.md 15.1）。要按尺寸独立配置得改多 kind，那步没做之前
 * 这里只保留一个 parameter。
 */

import { DEFAULT_UNITS } from './widgetFormat.js'
import { PARAMETER_KEYS } from './widgetDesign.js'

const STORAGE_KEY = 'ecowitt_widget_config'

/** 外观三档 */
export const APPEARANCES = ['auto', 'light', 'dark']

/** 组件语言三档：auto = 跟随 App 当前语言 */
export const LANG_MODES = ['auto', 'en', 'zh']

/** 刷新间隔三档（分钟），对应 DESIGN.md 9.1 的 N */
export const REFRESH_OPTIONS = [15, 30, 60]

/** 单位白名单：脏值绝不能进 payload，否则格式化会出错 */
const UNIT_WHITELIST = {
	temperature: ['C', 'F'],
	wind: ['km/h', 'mph', 'm/s'],
	rain: ['mm', 'in'],
	pressure: ['hPa', 'inHg']
}

export const DEFAULT_CONFIG_ = {
	/** 哪台设备的数据进 payload；空串表示跟随首页当前设备 */
	deviceId: '',
	/** small / medium 显示哪个参数 */
	parameter: 'temperature',
	/** 单位制，与 widgetFormat 的 DEFAULT_UNITS 同结构 */
	units: { ...DEFAULT_UNITS },
	/** auto = 跟随系统，light / dark = 强制 */
	appearance: 'auto',
	/** auto = 跟随 App 当前语言，en / zh = 强制 */
	lang: 'auto',
	/** 快照可接受的最大年龄（分钟） */
	refreshMinutes: 15,
	/** 静默刷新开关，对应 payload 的 fetch.enabled；关掉后只靠 App 前台写入 */
	fetchEnabled: true
}

/** 把任意输入收敛成合法配置，坏值一律退回默认 */
export function normalizeConfig(config) {
	const raw = config || {}
	const merged = {
		...DEFAULT_CONFIG_,
		...raw,
		units: { ...DEFAULT_UNITS, ...(raw.units || {}) }
	}

	if (PARAMETER_KEYS.indexOf(merged.parameter) < 0) merged.parameter = DEFAULT_CONFIG_.parameter
	if (APPEARANCES.indexOf(merged.appearance) < 0) merged.appearance = DEFAULT_CONFIG_.appearance
	if (LANG_MODES.indexOf(merged.lang) < 0) merged.lang = DEFAULT_CONFIG_.lang
	if (REFRESH_OPTIONS.indexOf(merged.refreshMinutes) < 0) {
		merged.refreshMinutes = DEFAULT_CONFIG_.refreshMinutes
	}

	Object.keys(UNIT_WHITELIST).forEach((key) => {
		if (UNIT_WHITELIST[key].indexOf(merged.units[key]) < 0) {
			merged.units[key] = DEFAULT_UNITS[key]
		}
	})

	merged.fetchEnabled = !!merged.fetchEnabled
	merged.deviceId = merged.deviceId == null ? '' : String(merged.deviceId)
	return merged
}

export function getWidgetConfig() {
	try {
		const raw = uni.getStorageSync(STORAGE_KEY)
		return normalizeConfig(raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null)
	} catch (e) {
		console.warn('[widget] 读取 v3 配置失败，使用默认值', e)
		return normalizeConfig(null)
	}
}

export function saveWidgetConfig(patch) {
	const next = normalizeConfig({ ...getWidgetConfig(), ...(patch || {}) })
	try {
		uni.setStorageSync(STORAGE_KEY, next)
	} catch (e) {
		console.warn('[widget] 保存 v3 配置失败', e)
	}
	return next
}

export function resetWidgetConfig() {
	try {
		uni.removeStorageSync(STORAGE_KEY)
	} catch (e) {
		// ignore
	}
	return normalizeConfig(null)
}

/**
 * 外观解析：auto 时按系统深浅色，其余强制。
 * 返回 'light' | 'dark'，直接喂给 buildWidgetPayload 的 appearance。
 */
export function resolveAppearance(appearance, systemDark) {
	if (appearance === 'light' || appearance === 'dark') return appearance
	return systemDark ? 'dark' : 'light'
}

/**
 * 组件语言解析：auto 时跟 App 当前语言走。
 * 返回 'en' | 'zh'，直接喂给 buildWidgetPayload 的 lang。
 */
export function resolveWidgetLang(lang, appLang) {
	if (lang === 'en' || lang === 'zh') return lang
	return appLang === 'zh' ? 'zh' : 'en'
}

/**
 * 配置 → buildWidgetPayload 的入参。
 * 只做翻译，不掺业务逻辑。
 */
export function toPayloadOptions(config, extra) {
	const cfg = normalizeConfig(config)
	const more = extra || {}
	return {
		...more,
		parameter: cfg.parameter,
		units: { ...cfg.units },
		appearance: resolveAppearance(cfg.appearance, !!more.systemDark),
		lang: resolveWidgetLang(cfg.lang, more.appLang)
	}
}

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
import { MODULE_KEYS, MAX_MODULES } from './widgetPayloadV4.js'

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
	/**
	 * 桌面显示哪台设备；空串 = 跟随首页当前设备。
	 * 非空时这个 id 必须校验（切账号 / 设备被删后会失效），见设置页的 resolveDeviceId。
	 */
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
	fetchEnabled: true,
	/**
	 * 大卡展示哪些模块；**数组顺序 = 展示顺序**。
	 * 默认八项与设计原型的 DEFAULT_MODULE_KEYS 一致（不含 lightning / battery），
	 * 后两个属于「有数据才关心」的模块，默认不占大卡位置，用户可自行勾上。
	 */
	modules: ['outdoor', 'indoor', 'wind', 'rainfall', 'pressure', 'solar', 'co2'],
	/** large 的 hero 模块 key；空串 = 跟随主参数所在模块 */
	hero: '',
	/**
	 * large 里每个模块展示哪条读数：{moduleKey: readingKey}。
	 * 没写 / 写了但模块与读数对不上 = 走原生 fallback（feature 所属读数 → readings[0]）。
	 * 配置层拿不到模块与读数的完整清单，这里只做形状归一，真伪留给 payload 层。
	 */
	featured: {}
}

/**
 * 模块列表归一：只留合法 key、去重、**保留用户给的顺序**；过滤后空了就回落默认。
 * 顺序就是大卡的展示顺序，所以这里绝不能顺手排序。
 */
function normalizeModules(list) {
	const out = []
	if (Array.isArray(list)) {
		list.forEach((key) => {
			if (MODULE_KEYS.indexOf(key) >= 0 && out.indexOf(key) < 0) out.push(key)
		})
	}
	// 大卡布局上限：多出来的截断（用户勾再多，大卡也放不下）
	const picked = out.length ? out : [...DEFAULT_CONFIG_.modules]
	return picked.slice(0, MAX_MODULES)
}

/**
 * featured 归一：只做形状校验 —— {string: string}，两侧都非空，值里不许带 `.`
 * （reading key 是裸 key，不是 `module.reading` 这种 uid）。
 * 「模块 / 读数到底存不存在」配置层认不出来，交给 payload 层按真实数据过滤。
 */
function normalizeFeatured(value) {
	const out = {}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return out
	Object.keys(value).forEach((moduleKey) => {
		const readingKey = value[moduleKey]
		if (!moduleKey) return
		if (typeof readingKey !== 'string' || !readingKey || readingKey.indexOf('.') >= 0) return
		out[moduleKey] = readingKey
	})
	return out
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

	merged.modules = normalizeModules(merged.modules)
	// hero 必须是已勾选模块之一，否则退回「跟随主参数」
	merged.hero = merged.modules.indexOf(merged.hero) >= 0 ? String(merged.hero) : DEFAULT_CONFIG_.hero
	merged.featured = normalizeFeatured(merged.featured)

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
 * 用户有没有动过模块顺序。
 *
 * 没动过 → 小组件的展示顺序跟随数据源（首页 dashboard 卡片的先后），
 * 用户不用为了对齐桌面再排一遍。排过 → 以用户为准。
 */
export function orderCustomized(config) {
	// 收原始配置就行，内部归一 —— 外部调用方（设置页）不必自己先 normalize
	const modules = normalizeConfig(config).modules
	const def = DEFAULT_CONFIG_.modules
	if (modules.length !== def.length) return true
	for (let i = 0; i < def.length; i++) {
		if (modules[i] !== def[i]) return true
	}
	return false
}

/**
 * 主角读数：第一个模块 + 它选中的读数；没选就空串，走构建器的兜底（readings[0]）。
 *
 * 这条规则**只能有一份实现**。首页运行时算一遍、设置页预览再算一遍，一旦算法不同，
 * 两条写入路径就会互相覆盖 —— 表现就是桌面上的主读数在两套之间来回跳。
 */
export function featureUidOfConfig(config) {
	const cfg = normalizeConfig(config)
	const first = cfg.modules[0]
	if (!first) return ''
	const reading = cfg.featured[first]
	return reading ? first + '.' + reading : ''
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
		// 主角：从 modules[0] + featured 派生，不再有独立的 parameter / hero 设置
		feature: featureUidOfConfig(cfg),
		// hero 交给构建器按「主角所在的模块」推：显式传 config.modules[0] 会跟 feature
		// 分叉 —— featured 为空时 feature 回落到「排序后的第一个模块」，而 modules[0]
		// 是配置里的第一个，两者不是一个，大卡第一块的曲线就会缺（历史只按 feature 取）
		hero: '',
		// 数据源带了单位制（接口返回的）就用它的 —— 单位归后端，这是既定的分工
		units: more.units ? { ...more.units } : { ...cfg.units },
		appearance: resolveAppearance(cfg.appearance, !!more.systemDark),
		lang: resolveWidgetLang(cfg.lang, more.appLang),
		moduleKeys: [...cfg.modules],
		useConfigOrder: orderCustomized(cfg),
		featured: { ...cfg.featured }
	}
}

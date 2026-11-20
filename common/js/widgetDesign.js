/**
 * 小组件视觉规格 v4 —— 唯一事实来源
 *
 * 对应 `native/ios-widget/DESIGN-SPEC-v4.md`，可运行原型是 `docx/Ecowitt-Widgets-v4.html`。
 * 改这里的数字等于改设计稿；改完跑 `npm test`，其中一条会校验规范文档与本文件是否同步。
 *
 * 三层，谁都不许越界：
 *   1. token    —— 本文件（颜色 / 字号 / 形状 / 图标路径）
 *   2. primitive —— 原生各自实现（.head / .value / .row-line / .well）
 *   3. layout   —— 原生各自实现（small / medium / large 的骨架）
 *
 * payload 只带 token 与数据，骨架画死在原生里。所以「改色改字不发版，改结构才重打基座」。
 */

/** 三档几何（pt），HTML 的 Geometry 下拉。仅预览与文档用，真机尺寸由系统给 */
export const GEOMETRY = {
	compact: { small: 155, wide: 329, large: 345 },
	standard: { small: 170, wide: 364, large: 382 },
	roomy: { small: 180, wide: 382, large: 402 }
}

/**
 * 颜色三类，互不越界：
 *   模块身份色  temp / water / wind / pressure / sun —— 块标题、块内图标、状态、曲线
 *   语义状态色  up / down / danger / ok —— 涨跌、极值、告警
 *   主题基础色  bg / ink / muted / well / border —— 卡底、正文、次级文字、well 块、分隔线
 *
 * light 的 temp/water 等值来自设计稿；up/down 取自 App 的 .orange-color / .blue-color，
 * 且深浅色下**不变**（语义色不随主题漂移）。
 */
export const TOKENS = {
	light: {
		bg: '#ffffff',
		ink: '#0f172a',
		muted: '#526276',
		well: '#eef2f7',
		border: '#dce3eb',
		temp: '#be3955',
		water: '#0875a4',
		wind: '#08775a',
		pressure: '#7044b7',
		sun: '#95600a',
		up: '#ed7839',
		down: '#09a8e6',
		danger: '#dd524d',
		ok: '#26d800'
	},
	dark: {
		bg: '#141a23',
		ink: '#f1f5f9',
		muted: '#a3b1c3',
		well: '#202a37',
		border: '#303e50',
		temp: '#fb7185',
		water: '#38bdf8',
		wind: '#34d399',
		pressure: '#a78bfa',
		sun: '#fbbf24',
		up: '#ed7839',
		down: '#09a8e6',
		danger: '#dd524d',
		ok: '#26d800'
	}
}

/** 模块身份色槽位。payload 里模块/读数只带槽位名，不带宽色值 */
export const ACCENT_SLOTS = ['temp', 'water', 'wind', 'pressure', 'sun']

/** 语义状态色槽位 */
export const SEMANTIC_SLOTS = ['up', 'down', 'danger', 'ok']

/**
 * 间距刻度，唯一一套。
 * 卡片内部所有 gap / padding / margin 只用这六档或 SHAPE.layout，写死 px 即违规。
 * 例外：边框 1px、视觉件描边、刻度偏移这类「几何」，它们跟视觉件尺寸走。
 */
export const SPACING = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12 }

/**
 * 字号表（pt / dp），**全部偶数** —— 奇数在 @2x / @3x 会落到半像素，字重和描边发虚。
 * valuePressure 用于四位数值（气压、CO₂），小卡与 hero 自动降档。
 */
export const TYPE = {
	small: {
		name: 10,
		value: 34,
		valuePressure: 28,
		unit: 10,
		support: 10,
		footer: 8
	},
	medium: {
		name: 10,
		value: 32,
		valuePressure: 26,
		unit: 10,
		state: 8,
		caption: 8,
		axis: 8,
		footer: 8
	},
	large: {
		brand: 12,
		station: 10,
		state: 8,
		metricTitle: 10,
		outdoorValue: 38,
		sideValue: 14,
		wellValue: 22,
		barometerValue: 22,
		lowerValue: 16,
		detail: 8,
		footer: 8,
		compassTick: 6
	}
}

/**
 * 形状。视觉件尺寸属于「形状」不属于字号，两档：
 *   viz   默认档（small 卡、hero）
 *   vizXs 紧凑档（瓦片、medium 左栏）
 * layout 是块内边距与视觉件内部几何，一并取偶。
 */
export const SHAPE = {
	cardRadius: 24,
	cardPadding: 12,
	cardGap: 4,
	cardGapLarge: 6,
	wellRadius: 14,
	chipSize: 22,
	chipRadius: 6,
	viz: { compass: 48, ring: 34, gauge: 58, uvbar: 64, barsH: 22, sun: 26, glyphW: 26, glyphH: 26, batteryH: 12 },
	vizXs: { compass: 26, ring: 20, gauge: 30, uvbar: 40, barsH: 14, sun: 16, glyphW: 14, glyphH: 14, batteryH: 10 },
	layout: { tilePad: 8, tilePadTight: 6, lineGap: 2, blockGap: 4, ringInset: 4, cellW: 2, cellGap: 2, ringIco: 14, ringIcoXs: 8 },
	/**
	 * 卡片自己的外边距，按平台分开 —— 这是「一条规则两个值」的唯一地方。
	 * iOS：WidgetKit 已经给了 16pt content margin，我们再加就把 medium 挤爆，所以是 0。
	 * Android：RemoteViews 没有系统边距，必须自己加，等于设计稿的 cardPadding。
	 * 调它只改 payload，不用重打基座。
	 */
	inset: { ios: 0, android: 12 }
}

/**
 * 设计画布（px）。只表示三个尺寸之间的比例关系，**不是真机 pt**。
 * 容器给宽度，卡片按画布 1:1 画完再 scale —— 这是外壳与画布两个域之间唯一的接口。
 */
export const WIDGET_CANVAS = {
	small: { w: 170, h: 170 },
	medium: { w: 364, h: 170 },
	large: { w: 364, h: 382 }
}

/**
 * large 的布局预算（实测标定，改动必须重新量，且要同步 DESIGN-SPEC-v4 第 5 节）。
 *   budget     large 内容区可用高度（382 − padding − 站名行 − 间隙）
 *   zoneGap    分区之间的间距 = SHAPE.cardGapLarge
 *   heroCap     hero 最多占半个大卡
 *   tileMin    瓦片行高底线，再小就压字
 *   heroMin     2 列装不下时 hero 的底线，低于它就换 3 列
 */
export const LARGE_PLAN = {
	budget: 328,
	zoneGap: 6,
	heroCap: 164,
	tileMin: 48,
	heroMin: 88
}

/**
 * medium 的左栏占比（百分比，整数）。
 * iOS 读 payload 立即生效；Android 是 XML 的 layout_weight，改这里必须同步改
 * ecowitt_widget_v4_medium.xml（parity 会比对两者是否一致）。
 */
export const SPLIT = { mediumLeft: 42 }

/**
 * 图标表：24×24 线描，stroke 1.6，圆头圆角。
 * 路径进 payload，两端各自描边渲染 —— 这样「加一个图标」不用重编基座，
 * 也不会出现「iOS 用 SF Symbol、Android 用 drawable，形状对不上」的老问题。
 */
export const ICONS = {
	temperature: 'M10 3a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z M12 8v9',
	humidity: 'M12 2C9 7 5 10 5 14a7 7 0 0 0 14 0c0-4-4-7-7-12Z M9 16l6-6',
	pressure: 'M4 19a9 9 0 1 1 16 0 M12 13l5-5 M6 16h12',
	wind: 'M3 8h12a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h5',
	rainfall: 'M12 2C9 7 6 11 6 15a6 6 0 0 0 12 0c0-4-3-8-6-13Z',
	sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
	house: 'M3 11l9-8 9 8 M5 10v11h14V10 M10 21v-7h4v7',
	arrow: 'M12 2L21 21L12 16L3 21Z',
	chart: 'M3 3v18h18 M6 15l5-5 4 3 6-8',
	bolt: 'M13 2 5 13h6l-1 9 8-11h-6l1-9Z',
	maxOut: 'M5 4h14 M12 20V8 M12 8l-4.5 4.5 M12 8l4.5 4.5',
	minOut: 'M5 20h14 M12 4v12 M12 16l-4.5-4.5 M12 16l4.5-4.5'
}

/** 图标名白名单（测试与两端兜底都读它） */
export const ICON_KEYS = Object.keys(ICONS)

/** UV 光谱条的刻度色：物理常量，不随主题变 */
export const UV_SCALE = ['#19996f', '#d7a212', '#db7821', '#d34a57', '#9751b7']

/** 八种视觉件，与 DESIGN-SPEC-v4 第 6 节一一对应 */
export const VISUAL_KINDS = ['glyph', 'ring', 'dial', 'gauge', 'uv', 'bars', 'sun', 'battery']

/**
 * 五种可突出的读数（客户在设置页选的那一个）。
 * key 是读数 uid 的简写，uid 形如 `outdoor.temperature`。
 * 保留这层是因为 v3 的配置与设置页都按 parameter 存，换 uid 会牵动全部页面。
 */
export const PARAMETERS = {
	temperature: {
		accent: 'temp',
		icon: 'temperature',
		uid: 'outdoor.temperature',
		en: 'Temperature',
		zh: '温度'
	},
	humidity: {
		accent: 'water',
		icon: 'humidity',
		uid: 'outdoor.humidity',
		en: 'Humidity',
		zh: '湿度'
	},
	pressure: {
		accent: 'pressure',
		icon: 'pressure',
		uid: 'pressure.relative',
		en: 'Pressure',
		zh: '气压'
	},
	wind: {
		accent: 'wind',
		icon: 'wind',
		uid: 'wind.speed',
		en: 'Wind',
		zh: '风速'
	},
	rainfall: {
		accent: 'water',
		icon: 'rainfall',
		uid: 'rainfall.gauge',
		en: 'Rainfall',
		zh: '雨量'
	}
}

/** 小组件固定 5 个可选项；large 是整站仪表盘，不走参数 */
export const PARAMETER_KEYS = ['temperature', 'humidity', 'pressure', 'wind', 'rainfall']

/** parameter → 突出读数 uid；认不出就退回第一个 */
export function featureUidOf(parameter) {
	const meta = PARAMETERS[parameter]
	return meta ? meta.uid : PARAMETERS.temperature.uid
}

/** 取某主题的完整色表（不带 accent：accent 由模块/读数自己覆盖） */
export function resolveTheme(appearance) {
	return { ...TOKENS[appearance === 'light' ? 'light' : 'dark'] }
}

/**
 * 字号归一：三档差异全部收敛在这里，primitive 只认通用名。
 * 原生拿到的是这张扁表（payload.typography），不是 TYPE 的分组结构。
 */
export function normalizeType(family) {
	const t = TYPE[family]
	if (family === 'small') {
		return {
			name: t.name,
			value: t.value,
			'value-sm': t.valuePressure,
			unit: t.unit,
			sub: t.support,
			foot: t.footer,
			caption: t.support,
			axis: t.support,
			state: t.support
		}
	}
	if (family === 'medium') {
		return {
			name: t.name,
			value: t.value,
			'value-sm': t.valuePressure,
			unit: t.unit,
			sub: t.state,
			foot: t.footer,
			caption: t.caption,
			axis: t.axis,
			state: t.state
		}
	}
	return {
		name: t.metricTitle,
		value: t.outdoorValue,
		'value-sm': t.barometerValue,
		unit: t.detail,
		sub: t.sideValue,
		foot: t.footer,
		caption: t.detail,
		axis: t.detail,
		state: t.state,
		brand: t.brand,
		station: t.station,
		title: t.metricTitle,
		side: t.sideValue,
		well: t.wellValue,
		baro: t.barometerValue,
		lower: t.lowerValue,
		detail: t.detail,
		tick: t.compassTick
	}
}

/** 三档归一后的字号表，整包进 payload */
export function typographyPayload() {
	return {
		small: normalizeType('small'),
		medium: normalizeType('medium'),
		large: normalizeType('large')
	}
}

/** 参数名的多语言兜底表 */
export function parameterLabel(parameter, lang) {
	const meta = PARAMETERS[parameter]
	if (!meta) return ''
	return lang === 'zh' ? meta.zh : meta.en
}

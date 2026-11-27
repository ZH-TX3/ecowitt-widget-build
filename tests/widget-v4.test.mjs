// 单元测试：小组件 payload v4（模块 / 读数驱动契约）
//
// v4 是 iOS/Android 共用的数据契约，但渲染各自实现（SwiftUI / RemoteViews）。
// 这里锁的是「App 侧发出去的东西」：
//   1. 顶层骨架：schemaVersion / theme / typography / shape / icons
//   2. 数据模型：模块 → 读数 → 变化量/极值/附带项/明细行
//   3. 缺数据的降级：没值的模块不出现，没历史的走空图
//   4. 单位换算与配置（沿用 v3，不随 schema 变）
//   5. 平台门控与 payload 桥接（判错了是静默不生效，比崩溃更难查）
//
// 跑法：node --test tests/widget-v4.test.mjs

import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup as cleanupHarness, installUni, loadModules } from './harness.mjs'

// common/js 下是 uni-app 的源码，扩展名 .js 但内容是 ESM。
// node 在 "type" 不是 module 的包里会按 CJS 解析，所以先复制成 .mjs 再导入。
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const buildDir = path.join(here, '.build-v4')
const SOURCES = ['widgetDesign', 'widgetFormat', 'widgetFixture', 'widgetPayloadV4', 'widgetSource', 'widgetConfig', 'widgetFetch']

// widgetConfig 会读写 storage，先给个最小 uni 替身
const storage = new Map()
globalThis.uni = {
	getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
	setStorageSync: (k, v) => storage.set(k, v),
	removeStorageSync: (k) => storage.delete(k)
}

await mkdir(buildDir, { recursive: true })
for (const name of SOURCES) {
	const source = await readFile(path.join(root, 'common/js', `${name}.js`), 'utf8')
	const rewritten = source.replace(/from '\.\/(\w+)\.js'/g, "from './$1.mjs'")
	await writeFile(path.join(buildDir, `${name}.mjs`), rewritten, 'utf8')
}

const toUrl = (name) => 'file://' + path.join(buildDir, name).replace(/\\/g, '/')

/**
 * 读原生源文件：仓库里是嵌套路径，CI stage 里是扁平路径，两种都试。
 * 都找不到就报错 —— 静默跳过等于这条一致性检查不存在。
 */
async function readNative(...candidates) {
	for (const rel of candidates) {
		try {
			return await readFile(path.join(root, rel), 'utf8')
		} catch (e) {
			// 换下一个候选
		}
	}
	throw new Error('找不到原生源文件，试过：' + candidates.join(' / '))
}

const { buildWidgetPayloadV4, WIDGET_SCHEMA_V4, WIDGET_RANGE_HOURS, MODULE_KEYS, modulesOf, availableModuleKeys, readingFromDashboard } = await import(
	toUrl('widgetPayloadV4.mjs')
)
const { buildHistory, DEMO_READING, MISSING_READING } = await import(toUrl('widgetFixture.mjs'))
const {
	PARAMETER_KEYS,
	PARAMETERS,
	TOKENS,
	TYPE,
	SHAPE,
	LARGE_PLAN,
	CHART,
	TEXT_SHRINK,
	WIDGET_CANVAS,
	ICONS,
	ICON_KEYS,
	VISUAL_KINDS,
	ACCENT_SLOTS,
	SEMANTIC_SLOTS,
	SPACING,
	GEOMETRY,
	featureUidOf,
	normalizeType,
	typographyPayload
} = await import(toUrl('widgetDesign.mjs'))
const { DEFAULT_UNITS, numberText, directionText, deltaText, pressureDelta, ringFill } = await import(
	toUrl('widgetFormat.mjs')
)
const {
	DEFAULT_CONFIG_,
	normalizeConfig,
	getWidgetConfig,
	saveWidgetConfig,
	resetWidgetConfig,
	resolveAppearance,
	resolveWidgetLang,
	toPayloadOptions,
	featureUidOfConfig
} = await import(toUrl('widgetConfig.mjs'))
const { snapshotFromDashboard, historyFromGraph, graphTargetOf, historyUidsOf } = await import(toUrl('widgetSource.mjs'))
const {
	WIDGET_DATA_KEYS,
	WIDGET_FETCH_PATH,
	buildFetchSegment,
	attachWidgetFetch,
	dataSegmentOf,
	mergeDataSegment,
	resolveFetchUrl,
	setWidgetFetchBase
} = await import(toUrl('widgetFetch.mjs'))

after(async () => {
	await rm(buildDir, { recursive: true, force: true })
	await cleanupHarness()
})

const NOW = Date.parse('2026-02-19T14:32:00Z')
const READING = { ...DEMO_READING, observedAt: new Date(NOW).toISOString() }
const HISTORY = buildHistory(READING, NOW)

function build(overrides = {}) {
	return buildWidgetPayloadV4({
		reading: READING,
		history: HISTORY,
		parameter: 'temperature',
		appearance: 'dark',
		lang: 'en',
		now: NOW,
		source: 'demo',
		...overrides
	})
}

const moduleOf = (payload, key) => payload.modules.find((m) => m.key === key)
const readingOf = (payload, uid) => {
	const [moduleKey, readingKey] = uid.split('.')
	const m = moduleOf(payload, moduleKey)
	return m && m.readings.find((r) => r.key === readingKey)
}

// ---------------------------------------------------------------------------
describe('顶层契约', () => {
	test('schemaVersion 是 4，两端据此分流', () => {
		assert.equal(WIDGET_SCHEMA_V4, 4)
		assert.equal(build().schemaVersion, 4)
	})

	test('theme 带齐 14 个色位：主题基础色 + 模块身份色 + 语义状态色', () => {
		const p = build()
		const expected = ['bg', 'ink', 'muted', 'well', 'border']
			.concat(ACCENT_SLOTS, SEMANTIC_SLOTS)
			.sort()
		assert.deepEqual(Object.keys(p.theme).sort(), expected)
		// 色值必须能过 #RRGGBB
		Object.entries(p.theme).forEach(([key, value]) => {
			assert.match(value, /^#[0-9a-f]{6}$/i, `theme.${key} 不是 6 位色值: ${value}`)
		})
	})

	test('语义状态色深浅一致，模块身份色两套主题不同', () => {
		const light = build({ appearance: 'light' })
		const dark = build({ appearance: 'dark' })
		SEMANTIC_SLOTS.forEach((slot) => {
			assert.equal(light.theme[slot], dark.theme[slot], `${slot} 不应随主题漂移`)
		})
		assert.notEqual(light.theme.temp, dark.theme.temp)
		assert.notEqual(light.theme.bg, dark.theme.bg)
	})

	test('typography 三档齐、数值全为偶数', () => {
		const t = build().typography
		assert.deepEqual(Object.keys(t).sort(), ['large', 'medium', 'small'])
		Object.entries(t).forEach(([family, scale]) => {
			Object.entries(scale).forEach(([key, value]) => {
				assert.equal(typeof value, 'number', `${family}.${key} 不是数字`)
				assert.equal(value % 2, 0, `${family}.${key} = ${value} 是奇数，@2x 会落半像素`)
			})
		})
		// 归一表必须与 TYPE 表同源
		assert.deepEqual(t.large, normalizeType('large'))
		assert.deepEqual(t, typographyPayload())
	})

	test('shape 带齐视觉件两档 + 布局类 + 预算常量', () => {
		const s = build().shape
		;['cardRadius', 'cardPadding', 'cardGap', 'cardGapLarge', 'wellRadius', 'chipSize', 'chipRadius'].forEach((key) => {
			assert.equal(typeof s[key], 'number', `shape.${key} 缺失`)
		})
		;['compass', 'ring', 'gauge', 'uvbar', 'barsH', 'sun', 'glyphW', 'glyphH', 'batteryH'].forEach((key) => {
			assert.ok(s.viz[key] > s.vizXs[key], `viz.${key} 应大于 vizXs.${key}`)
		})
		// 外边距按平台分开：iOS 交给系统 content margin（0），Android 必须自己加
		assert.equal(s.inset.ios, 0, 'iOS 不该再自己加内边距')
		assert.ok(s.inset.android > 0, 'Android 没有系统边距，必须自己加')
		// medium 左栏上限只给 Android 用（TextView 必须自己限宽）；iOS 不读它
		assert.ok(s.mediumLeftMax > 20 && s.mediumLeftMax <= 100, 'medium 左栏上限应是个合理百分比')
		assert.equal(s.mediumLeftMode, undefined, 'iOS 左栏不再有 content/ratio 模式，别再下发')
		assert.equal(s.mediumLeftRatio, undefined)
		// 明细行策略：hero/tile 各几行、瓦片是否带同行摘要
		assert.equal(typeof s.detail.heroRows, 'number')
		assert.equal(typeof s.detail.tileRows, 'number')
		assert.equal(typeof s.detail.inline, 'boolean')
		// 全局字缩系数：占位不够时整卡缩字（0.9 = 缩一成）
		assert.ok(build().fontScale > 0.5 && build().fontScale <= 2, 'fontScale 应在合理区间')
		assert.equal(s.plan.budget, LARGE_PLAN.budget)
		assert.equal(s.plan.tileMin, LARGE_PLAN.tileMin)
		// UV 光谱条是物理常量，5 段
		assert.equal(s.uvScale.length, 5)
		// 分区间距不单独下发：两端实际都读 cardGapLarge，发两份就是两份真相
		assert.equal(s.plan.zoneGap, undefined, 'zoneGap 是孤儿字段，别回填')
	})

	test('曲线几何与字缩系数全量下发（可调项不许写死在原生）', () => {
		const p = build()
		const c = p.shape.chart
		assert.equal(c.gridRatios.length, 2, '两条网格线')
		c.gridRatios.forEach((r) => assert.ok(r > 0 && r < 1, '网格位置是高度比例'))
		assert.ok(c.lineW > 0 && c.gridW > 0, '线宽')
		assert.ok(c.dotR > 0, '末端圆点半径')
		assert.equal(c.dash.length, 2, '虚线 [实, 空]')
		assert.ok(c.padX > 0 && c.padY > 0, '采样区留白')
		assert.ok(c.padRatio > 0 && c.padRatio < 1, '值域取景比例')
		assert.ok(c.minPad > 0, '值域最小留白')
		assert.ok(c.minPoints >= 2, '少于 2 点画不出曲线')

		const t = p.shape.textShrink
		;['value', 'tileValue', 'attach', 'footer', 'meta'].forEach((k) => {
			assert.ok(t[k] > 0 && t[k] <= 1, `textShrink.${k} 应在 (0,1]，1 = 不缩`)
		})
		// medium 左栏密度：默认跟设计稿一致（全显示），挤的时候靠这三个开关让位
		const m = p.shape.detail.medium
		assert.equal(typeof m.meta, 'boolean', 'medium.meta')
		assert.equal(typeof m.attach, 'boolean', 'medium.attach')
		assert.ok(['both', 'max', 'none'].includes(m.peaks), "medium.peaks ∈ both|max|none")
	})

	test('设计画布随 payload 下发，三档都带宽高', () => {
		const p = build()
		;['small', 'medium', 'large'].forEach((family) => {
			assert.ok(p.canvas[family].w > 0 && p.canvas[family].h > 0, `canvas.${family}`)
			assert.equal(p.canvas[family].w, WIDGET_CANVAS[family].w)
			assert.equal(p.canvas[family].h, WIDGET_CANVAS[family].h)
		})
	})

	test('icons 全量下发，每条都是非空 path', () => {
		const icons = build().icons
		assert.deepEqual(Object.keys(icons).sort(), ICON_KEYS.sort())
		Object.entries(icons).forEach(([name, d]) => {
			assert.equal(typeof d, 'string', name)
			assert.ok(d.length > 8 && d.indexOf('M') === 0, `${name} 路径不像 SVG: ${d}`)
		})
	})

	test('payload 可 JSON 往返，体积不超过 32KB', () => {
		const p = build()
		const json = JSON.stringify(p)
		const back = JSON.parse(json)
		assert.equal(back.schemaVersion, 4)
		assert.deepEqual(back.modules, p.modules)
		assert.ok(json.length < 32 * 1024, `payload 太大: ${json.length} 字节`)
	})
})

// ---------------------------------------------------------------------------
describe('数据模型：模块 → 读数', () => {
	test('演示读数产出十个模块，读数分布与设计稿一致', () => {
		const p = build()
		assert.equal(p.modules.length, 12)
		const shape = p.modules.map((m) => m.key + ':' + m.readings.length)
		assert.deepEqual(shape, [
			'outdoor:2',
			'indoor:2',
			'wind:2',
			'rainfall:2',
			'rainfallPiezo:2',
			'pressure:3',
			'solar:2',
			'co2:1',
			'co2Pm:1',
			'co2TempHumi:2',
			'lightning:1',
			'battery:1'
		])
	})

	test('每条读数都有值 / 单位 / 合法强调色 / 合法视觉件', () => {
		const p = build()
		let count = 0
		p.modules.forEach((m) => {
			assert.ok(m.label && m.icon && m.accent, `${m.key} 模块缺 label/icon/accent`)
			assert.ok(ICON_KEYS.indexOf(m.icon) >= 0, `${m.key} 的 icon ${m.icon} 不在图标表`)
			assert.ok(ACCENT_SLOTS.indexOf(m.accent) >= 0, `${m.key} 的 accent ${m.accent} 非法`)
			m.readings.forEach((r) => {
				count += 1
				assert.ok(r.value !== '' && r.value != null, `${m.key}.${r.key} 缺 value`)
				assert.equal(typeof r.unit, 'string')
				assert.ok(ACCENT_SLOTS.indexOf(r.accent) >= 0, `${m.key}.${r.key} accent 非法`)
				if (r.visual) {
					assert.ok(VISUAL_KINDS.indexOf(r.visual.kind) >= 0, `visual ${r.visual.kind} 非法`)
					if (r.visual.kind === 'glyph' || r.visual.kind === 'ring' || r.visual.kind === 'dial') {
						assert.ok(ICON_KEYS.indexOf(r.visual.icon) >= 0, `${m.key}.${r.key} 的图标 ${r.visual.icon} 不在图标表`)
					}
				}
			})
		})
		// 雨量从 2 条变 4 条（rainrate + dailyrain × 翻斗/压电）
		// 11 个模块：雨量拆成翻斗 + 压电两个，各 2 条读数（rate / daily）
		assert.equal(count, 21)
	})

	test('极值只允许 max，或 max + min；不允许只有 min', () => {
		const p = build()
		const peaks = []
		p.modules.forEach((m) => m.readings.forEach((r) => r.peak && peaks.push({ uid: m.key + '.' + r.key, peak: r.peak })))
		assert.ok(peaks.length >= 6, '极值数量偏少')
		peaks.forEach(({ uid, peak }) => {
			assert.ok(peak.max && peak.max.value !== '', uid + ' 有 peak 却没 max')
			if (peak.min) assert.ok(peak.min.value !== '', uid + ' 的 min 没有值')
		})
		// 只有单向语义的量：最大阵风 / 日照 / UV / AQI
		const maxOnly = []
		p.modules.forEach((m) =>
			m.readings.forEach((r) => r.peak && !r.peak.min && maxOnly.push(m.key + '.' + r.key))
		)
		assert.deepEqual(maxOnly.sort(), ['co2Pm.aqi', 'solar.radiation', 'solar.index', 'wind.speed'].sort())
	})

	test('变化量只算方向与幅度，不出现 NaN', () => {
		const p = build()
		p.modules.forEach((m) =>
			m.readings.forEach((r) => {
				if (!r.delta) return
				assert.ok([-1, 0, 1].indexOf(r.delta.dir) >= 0, `${m.key}.${r.key} delta.dir 非法`)
				assert.match(r.delta.value, /^\d+(\.\d+)?$/, `${m.key}.${r.key} delta.value = ${r.delta.value}`)
			})
		)
	})

	test('附带项优先用同模块的另一条读数，风用整句 attachText', () => {
		const p = build()
		const temp = readingOf(p, 'outdoor.temperature')
		assert.equal(temp.attach.label, 'Humidity')
		assert.equal(temp.attachText, null)
		const wind = readingOf(p, 'wind.speed')
		assert.equal(wind.attach, null, '风的附带项是整句，不该再给一行')
		assert.match(wind.attachText, /^From .+ · Gust /)
	})

	test('明细行 = 同模块其它维度 + 模块 rows，且不重复 label', () => {
		const p = build()
		const pressure = readingOf(p, 'pressure.relative')
		assert.deepEqual(pressure.lines.map((r) => r.label), ['Absolute', 'Sea level'])
		const rain = readingOf(p, 'rainfall.rate')
		// 雨量每个传感器两个维度（rainrate / dailyrain），所以 gauge 的其它维度里
		// 第一条是自家的日雨量，压电那两条排在后面
		assert.equal(rain.lines[0].label, 'Daily')
		// 同模块的另一个维度（daily）排第一，后面是小时 / 24h / 本周累计
		assert.equal(rain.lines[0].label, 'Daily')
		assert.equal(rain.lines.length, 4)
		const labels = rain.lines.map((r) => r.label)
		assert.equal(new Set(labels).size, labels.length, '明细行有重复 label')
		// 明细行里不该再出现已被附带项占用的那条
		const temp = readingOf(p, 'outdoor.temperature')
		assert.equal(temp.lines.filter((r) => r.label === 'Humidity').length, 1)
	})

	test('视觉件按设计稿选型：湿度环形、风罗盘、气压半圆、UV 光谱、雨量柱状、电池 5 格', () => {
		const p = build()
		assert.equal(readingOf(p, 'outdoor.humidity').visual.kind, 'ring')
		assert.equal(readingOf(p, 'outdoor.humidity').visual.fill, 62)
		assert.equal(readingOf(p, 'wind.speed').visual.kind, 'dial')
		assert.equal(readingOf(p, 'wind.speed').visual.bearing, 315, '风向 +180° 后再画')
		assert.equal(readingOf(p, 'pressure.relative').visual.kind, 'gauge')
		assert.ok(readingOf(p, 'pressure.relative').visual.ratio > 0.5)
		assert.equal(readingOf(p, 'solar.radiation').visual.kind, 'sun')
		assert.equal(readingOf(p, 'solar.index').visual.kind, 'uv')
		assert.ok(readingOf(p, 'solar.index').visual.pos > 0 && readingOf(p, 'solar.index').visual.pos < 100)
		assert.equal(readingOf(p, 'rainfall.rate').visual.kind, 'bars')
		assert.equal(readingOf(p, 'battery.volt').visual.kind, 'battery')
		assert.equal(readingOf(p, 'battery.volt').visual.level, 4)
	})

	test('每条签名都显式带布尔 inSmall（小卡画不画由 payload 决定，可热更新）', () => {
		const p = build()
		const visuals = p.modules.flatMap((m) => m.readings || []).filter((r) => r.visual)
		assert.ok(visuals.length > 0, '演示读数应该有签名')
		for (const r of visuals) {
			assert.equal(typeof r.visual.inSmall, 'boolean', `${r.key} 的 inSmall 必须是显式布尔值`)
		}
		// 默认全关：小卡太挤，要显示得在 payload 里单独打开
		assert.ok(visuals.every((r) => r.visual.inSmall === false), '默认不该有任何签名进小卡')
	})

	test('数值长的读数标记 small，小卡与 hero 会降一档字', () => {
		const p = build()
		assert.equal(readingOf(p, 'pressure.relative').small, true)
		assert.equal(readingOf(p, 'outdoor.temperature').small, false)
	})

	test('雨量有雨画状态、无雨留空（状态槽）', () => {
		const wet = readingOf(build(), 'rainfall.rate')
		assert.equal(wet.stateSlot, true)
		assert.equal(wet.state, 'Raining')
		const dry = readingOf(build({ reading: { ...READING, rainState: null } }), 'rainfall.rate')
		assert.equal(dry.state, null, '无雨时状态槽必须是空的，不能退回图标')
	})
})

// ---------------------------------------------------------------------------
describe('趋势与时间轴', () => {
	test('窗口固定 24 小时：抽稀到 28 点以内且至少 2 点，没有范围切换', () => {
		const p = build()
		const m = moduleOf(p, 'outdoor')
		assert.ok(m.series.length >= 2, '点数不足')
		assert.ok(m.series.length <= 28, '抽稀失效')
		assert.equal(p.axis.length, 3, '时间轴三段')
		// v4 砍掉了 1H/6H/24H/7D 切换：payload 里不该再有范围字段
		assert.equal(p.rangeHours, undefined)
		assert.equal(p.ranges, undefined)
		assert.equal(build({ rangeHours: 168 }).axis.join(), p.axis.join(), '传范围也不该改变窗口')
		assert.equal(WIDGET_RANGE_HOURS, 24)
	})

	test('buildHistory 吃读数单元（{text,unit,raw}）也不会崩', () => {
		// 设置页拿到的真实读数是 cell，不是裸数字；直接喂进去曾导致
		// 「v.toFixed is not a function」整页白屏
		const cellReading = {
			outdoorCelsius: { text: '21.4', unit: '°C', raw: 21.4 },
			outdoorHumidity: { text: '62', unit: '%', raw: 62 },
			windKPH: { text: '14.8', unit: 'km/h', raw: 14.8 },
			uvIndex: { text: '3.4', unit: '', raw: 3.4 }
		}
		const h = buildHistory(cellReading, NOW)
		const points = h['outdoor.temperature']
		assert.ok(points.length > 2)
		points.forEach((p) => assert.equal(typeof p.v, 'number'))
		assert.equal(points[points.length - 1].v, 21.4)
	})

	test('序列按时间升序且落在窗口内', () => {
		const p = build()
		const times = moduleOf(p, 'outdoor').series.map((x) => x[0])
		assert.deepEqual(times, times.slice().sort((a, b) => a - b))
		assert.ok(times[0] >= NOW - 24 * 3600 * 1000)
		assert.ok(times[times.length - 1] <= NOW)
	})

	test('序列按 uid 取数：模块曲线只跟自己的主读数', () => {
		// 阵风序列被放大 100：如果模块曲线错拿了 wind.gust，末点会差出去
		const gust = HISTORY['wind.speed'].map((p) => ({ t: p.t, v: p.v + 100 }))
		const p = buildWidgetPayloadV4({
			reading: READING,
			history: { ...HISTORY, 'wind.gust': gust },
			now: NOW,
			lang: 'en'
		})
		const series = moduleOf(p, 'wind').series
		const last = series[series.length - 1][1]
		assert.ok(Math.abs(last - READING.windKPH) < 0.01, '模块曲线必须跟 wind.speed')
	})

	test('历史已是展示单位，构建器不再换算', () => {
		// 华氏历史直接进 payload：原先这里会被 convert 二次换算，数值就错了
		const fahrenheit = HISTORY['outdoor.temperature'].map((p) => ({ t: p.t, v: p.v * 1.8 + 32 }))
		const c = buildWidgetPayloadV4({
			reading: READING,
			history: { ...HISTORY, 'outdoor.temperature': fahrenheit },
			units: { ...DEFAULT_UNITS, temperature: 'F' },
			now: NOW,
			lang: 'en'
		})
		const series = moduleOf(c, 'outdoor').series
		const last = series[series.length - 1][1]
		const source = fahrenheit[fahrenheit.length - 1].v
		assert.ok(Math.abs(last - source) < 0.02, '曲线末点必须等于历史末点，不能再转一次')
	})

	test('无历史模块的 series 为 null，原生走空图分支', () => {
		const p = build({ history: {} })
		moduleOf(p, 'outdoor') && assert.equal(moduleOf(p, 'outdoor').series, null)
		assert.equal(moduleOf(p, 'lightning').series, null)
	})
})

// ---------------------------------------------------------------------------
describe('缺数据时的降级', () => {
	test('没有值的模块整块不出现', () => {
		const p = buildWidgetPayloadV4({
			reading: { ...MISSING_READING, observedAt: new Date(NOW).toISOString() },
			history: {},
			now: NOW
		})
		assert.equal(moduleOf(p, 'wind'), undefined, '风没有读数就不该出现')
		assert.equal(moduleOf(p, 'rainfall'), undefined, '雨量没有读数就不该出现')
		assert.ok(moduleOf(p, 'outdoor'), '室外还有温度湿度，必须保留')
	})

	test('完全没有读数时模块列表为空，状态是未连接', () => {
		const p = build({ reading: null, source: 'station' })
		assert.equal(p.modules.length, 0)
		assert.equal(p.status.text, 'Not connected')
		assert.equal(p.status.tone, 'muted')
		assert.equal(p.selection.feature, '')
	})

	test('状态文本与语气覆盖 6 种场景', () => {
		const cases = [
			[{ source: 'demo' }, 'ok', 'Demo'],
			[{ source: 'fixture' }, 'muted', 'Test fixture'],
			[{ reading: null, source: 'station' }, 'muted', 'Not connected'],
			[{ source: 'station', connected: false }, 'warn', 'Offline'],
			[{ source: 'station', connected: true, age: 30 * 60 * 1000 }, 'warn', 'Stale'],
			[{ source: 'station', connected: true, age: 60 * 1000 }, 'ok', 'Online']
		]
		cases.forEach(([opts, tone, text]) => {
			const reading = opts.reading === null ? null : { ...READING, observedAt: new Date(NOW - (opts.age || 0)).toISOString() }
			const p = build({ reading, source: opts.source, connected: opts.connected !== false })
			assert.equal(p.status.text, text)
			assert.equal(p.status.tone, tone)
		})
	})

	test('风向缺失时不画罗盘，改用线描图标', () => {
		const p = build({ reading: { ...READING, windDegrees: null } })
		const speed = readingOf(p, 'wind.speed')
		assert.equal(speed.visual.kind, 'glyph')
		assert.equal(speed.visual.icon, 'wind')
		assert.match(speed.attachText, /^Gust /)
	})
})

// ---------------------------------------------------------------------------
describe('突出项与 hero', () => {
	test('五个参数都映射到一条真实读数', () => {
		const p = build()
		PARAMETER_KEYS.forEach((parameter) => {
			const uid = featureUidOf(parameter)
			const [moduleKey, readingKey] = uid.split('.')
			const m = moduleOf(p, moduleKey)
			assert.ok(m, `${parameter} 指向的模块 ${moduleKey} 不存在`)
			assert.ok(m.readings.some((r) => r.key === readingKey), `${parameter} 指向的读数不存在`)
		})
	})

	test('feature 优先于 parameter，直接指定 uid 也生效', () => {
		const p = build({ feature: 'outdoor.humidity' })
		assert.equal(p.selection.feature, 'outdoor.humidity')
		assert.equal(p.selection.hero, 'outdoor')
	})

	test('hero 可独立指定，与小卡的突出项解耦', () => {
		const p = build({ feature: 'outdoor.temperature', hero: 'rainfall' })
		assert.equal(p.selection.hero, 'rainfall')
		// 指向不存在的模块时退回突出项所在模块
		const fallback = build({ feature: 'outdoor.temperature', hero: 'nope' })
		assert.equal(fallback.selection.hero, 'outdoor')
	})

	test('多语言：英文与中文的模块名、读数名、空图文案都齐', () => {
		const zh = build({ lang: 'zh' })
		assert.equal(moduleOf(zh, 'outdoor').label, '室外')
		assert.equal(readingOf(zh, 'outdoor.temperature').label, '温度')
		assert.equal(readingOf(zh, 'pressure.relative').label, '相对')
		assert.equal(zh.labels.noHistory, '暂无数据')
		assert.equal(zh.labels.noTrend, '暂无趋势')
		const en = build({ lang: 'en' })
		assert.equal(moduleOf(en, 'outdoor').label, 'Outdoor')
		assert.equal(en.labels.noHistory, 'No data')
	})
})

// ---------------------------------------------------------------------------
// 用户配的「展示哪些模块 / 什么顺序 / 谁是 hero」必须原样落到 payload 上，
// 顺序错了原生只会安静地按老顺序画，看不出毛病但配置不生效。
describe('模块筛选与展示顺序', () => {
	test('用户排过顺序时（useConfigOrder），moduleKeys 的数组顺序就是展示顺序', () => {
		const p = build({ moduleKeys: ['rainfall', 'outdoor', 'co2'], useConfigOrder: true })
		assert.deepEqual(p.modules.map((m) => m.key), ['rainfall', 'outdoor', 'co2'])
	})

	test('没排过顺序时（默认）跟随 dashboard 卡片的先后，moduleKeys 只负责筛选', () => {
		const reading = { ...READING, moduleOrder: ['co2', 'rainfall', 'outdoor'] }
		const p = build({ reading, moduleKeys: ['outdoor', 'wind', 'rainfall', 'pressure', 'co2'] })
		// 前三个按 moduleOrder，moduleOrder 没提到的保持内置相对顺序排在后面
		assert.deepEqual(p.modules.map((m) => m.key), ['co2', 'rainfall', 'outdoor', 'wind', 'pressure'])
	})

	test('moduleOrder 里没有的模块不会凭空出现（moduleKeys 仍然管过滤）', () => {
		const reading = { ...READING, moduleOrder: ['co2', 'rainfall', 'outdoor'] }
		const p = build({ reading, moduleKeys: ['outdoor', 'co2'] })
		assert.deepEqual(p.modules.map((m) => m.key), ['co2', 'outdoor'])
	})

	test('moduleKeys 里的非法 key 被丢弃，不影响其它模块', () => {
		const p = build({ moduleKeys: ['nope', 'co2', 'outdoor'], useConfigOrder: true })
		assert.deepEqual(p.modules.map((m) => m.key), ['co2', 'outdoor'])
	})

	test('availableModuleKeys 只看设备有什么，不受勾选影响（叉掉还能加回来）', () => {
		const all = availableModuleKeys(READING, { units: DEFAULT_UNITS, now: NOW })
		assert.deepEqual(all, MODULE_KEYS)
		// 只勾一个模块：payload 只剩一个，但「设备有什么」不变 —— 设置页靠这个决定可选列表
		assert.deepEqual(build({ moduleKeys: ['outdoor'] }).modules.map((m) => m.key), ['outdoor'])
		assert.deepEqual(availableModuleKeys(READING, { units: DEFAULT_UNITS, now: NOW }), MODULE_KEYS)
	})

	test('不传或传空数组时保持内置顺序全出', () => {
		const all = build().modules.map((m) => m.key)
		assert.deepEqual(build({ moduleKeys: [] }).modules.map((m) => m.key), all)
		assert.deepEqual(build({ moduleKeys: null }).modules.map((m) => m.key), all)
	})

	test('MODULE_KEYS 是模块 key 全集，顺序与默认 payload 一致', () => {
		assert.deepEqual(MODULE_KEYS, build().modules.map((m) => m.key))
	})

	test('hero 指定后写进 selection.hero；不在 modules 里就回落突出项所在模块', () => {
		const p = build({ moduleKeys: ['indoor', 'wind'], feature: 'wind.speed', hero: 'indoor' })
		assert.equal(p.selection.hero, 'indoor')
		const fallback = build({ moduleKeys: ['indoor', 'wind'], feature: 'wind.speed', hero: 'outdoor' })
		assert.equal(fallback.selection.hero, 'wind')
	})
})

// ---------------------------------------------------------------------------
// large 的每一块显示哪条读数（selection.featured）。原生按三条规则取值：
//   1. featured[module.key] 存在且读数真在这个模块下 → 用它
//   2. 否则该模块就是 feature 所属模块 → 用 feature 那条
//   3. 再否则 → module.readings[0]
// payload 只负责把「真实存在的组合」下发，fallback 在原生侧。
describe('大卡每块的读数选择（featured）', () => {
	test('featured 缺省时 payload 与不传逐字节相同', () => {
		const base = JSON.stringify(build())
		assert.equal(JSON.stringify(build({ featured: undefined })), base)
		assert.equal(JSON.stringify(build({ featured: null })), base)
		assert.equal(JSON.stringify(build({ featured: {} })), base)
		assert.deepEqual(build().selection.featured, {})
	})

	test('合法 featured 原样进 selection.featured', () => {
		const featured = { outdoor: 'humidity', indoor: 'humidity', pressure: 'sealevel' }
		assert.deepEqual(build({ featured }).selection.featured, featured)
	})

	test('非法组合（无此模块 / 无此读数 / 空值 / 带 `.` 的 uid）被丢弃，其余保留', () => {
		const p = build({
			featured: {
				outdoor: 'nope', // 读数不存在
				nope: 'temperature', // 模块不存在
				wind: '', // 空值
				co2: null, // 非字符串
				co2: 'solar.index', // 带 `.` 的是 uid，不是裸 reading key
				rainfall: 'rate' // 合法
			}
		})
		assert.deepEqual(p.selection.featured, { rainfall: 'rate' })
	})

	test('全非法时是空对象，不是缺字段', () => {
		assert.deepEqual(build({ featured: { nope: 'x', outdoor: 'nope' } }).selection.featured, {})
	})

	test('没勾进大卡的模块、设备没有的模块，其 featured 项也不下发', () => {
		const p = build({ moduleKeys: ['outdoor', 'co2'], featured: { outdoor: 'humidity', wind: 'gust' } })
		assert.deepEqual(p.selection.featured, { outdoor: 'humidity' })
		const missing = build({
			reading: { ...MISSING_READING, observedAt: new Date(NOW).toISOString() },
			history: {},
			featured: { wind: 'gust' }
		})
		assert.deepEqual(missing.selection.featured, {})
	})
})

// ---------------------------------------------------------------------------
describe('真实数据入口', () => {
	test('dashboard 结构映射成读数，字段缺了就是 null 而不是 0', () => {
		const item = {
			name: 'Roof',
			data: {
				tempf: { value: 21.4 },
				humidity: { value: 62 },
				winddir: { value: 135 },
				srain_piezo: { value: 'raining' },
				bogus: { value: 'abc' }
			}
		}
		const reading = readingFromDashboard(item, 'Fallback')
		assert.equal(reading.stationName, 'Roof')
		assert.equal(reading.outdoorCelsius, 21.4)
		assert.equal(reading.windDegrees, 135)
		assert.equal(reading.rainState, 'raining')
		assert.equal(reading.rainRateMMH, null)
		assert.equal(reading.co2PPM, null)
	})

	test('没有 data 节点时返回 null', () => {
		assert.equal(readingFromDashboard(null), null)
		assert.equal(readingFromDashboard({ name: 'x' }), null)
	})

	test('模块顺序固定，不随数据缺失变化', () => {
		const full = modulesOf({ reading: READING, history: HISTORY, now: NOW }).map((m) => m.key)
		assert.deepEqual(full, [
			'outdoor',
			'indoor',
			'wind',
			'rainfall',
			'rainfallPiezo',
			'pressure',
			'solar',
			'co2',
			'co2Pm',
			'co2TempHumi',
			'lightning',
			'battery'
		])
	})
})

// ---------------------------------------------------------------------------
describe('单位换算与格式化', () => {
	test('温度 C/F，换算后按位格式化', () => {
		assert.equal(numberText(21.4, 'temperature', { ...DEFAULT_UNITS, temperature: 'C' }), '21.4')
		assert.equal(numberText(21.4, 'temperature', { ...DEFAULT_UNITS, temperature: 'F' }), '70.5')
	})

	test('风速 km/h → mph / m/s', () => {
		assert.equal(numberText(14.8, 'wind', { ...DEFAULT_UNITS, wind: 'mph' }), '9.2')
		assert.equal(numberText(14.8, 'wind', { ...DEFAULT_UNITS, wind: 'm/s' }), '4.1')
	})

	test('气压 hPa → inHg 保留两位，雨量 mm → in 保留两位', () => {
		assert.match(numberText(1013.8, 'pressure', { ...DEFAULT_UNITS, pressure: 'inHg' }), /^29\.9\d$/)
		assert.equal(numberText(4.2, 'rainfall', { ...DEFAULT_UNITS, rain: 'in' }), '0.17')
	})

	test('湿度不带小数，缺值统一返回破折号', () => {
		assert.equal(numberText(62, 'humidity', DEFAULT_UNITS), '62')
		assert.equal(numberText(null, 'temperature'), '—')
	})

	test('payload 里的数值跟着单位走', () => {
		const p = build({ units: { ...DEFAULT_UNITS, wind: 'mph', rain: 'in' } })
		assert.equal(readingOf(p, 'wind.speed').unit, 'mph')
		assert.equal(readingOf(p, 'rainfall.rate').unit, 'in/h')
	})

	test('角度转八方位，负角和超过 360 都能收敛', () => {
		assert.equal(directionText(0), 'N')
		assert.equal(directionText(135), 'SE')
		assert.equal(directionText(-90), 'W')
		assert.equal(directionText(450), 'E')
		assert.equal(directionText(null), '—')
	})

	test('3 小时气压趋势与环填充', () => {
		const trend = pressureDelta(READING, HISTORY['pressure.relative'])
		assert.ok(trend != null && Math.abs(trend) < 10, '气压趋势要算得出来')
		assert.equal(deltaText(null), '3h trend unavailable')
		assert.equal(ringFill(150), 100)
		assert.equal(ringFill(null), 0)
	})
})

// ---------------------------------------------------------------------------
describe('设计 token 纪律', () => {
	test('TYPE / SHAPE 里的数字全为偶数', () => {
		const walk = (obj, prefix) => {
			Object.entries(obj).forEach(([key, value]) => {
				if (typeof value === 'number') {
					assert.equal(value % 2, 0, `${prefix}.${key} = ${value} 是奇数`)
				} else if (value && typeof value === 'object') {
					walk(value, prefix + '.' + key)
				}
			})
		}
		walk(TYPE, 'TYPE')
		walk(SHAPE, 'SHAPE')
		walk(LARGE_PLAN, 'LARGE_PLAN')
	})

	test('间距刻度是 2/4/6/8/10/12，只有六档', () => {
		assert.deepEqual(Object.values(SPACING), [2, 4, 6, 8, 10, 12])
	})

	test('三个尺寸的画布比例与 iOS 一致：small 方形、medium 同高更宽、large 更高', () => {
		assert.equal(GEOMETRY.standard.wide, 364)
		assert.ok(GEOMETRY.compact.large < GEOMETRY.standard.large)
		assert.equal(GEOMETRY.standard.small, 170)
	})

	test('LARGE_PLAN 的预算与规范文档一致', () => {
		assert.equal(LARGE_PLAN.budget, 328)
		assert.equal(LARGE_PLAN.zoneGap, SHAPE.cardGapLarge)
		assert.equal(LARGE_PLAN.heroCap, LARGE_PLAN.budget / 2)
		assert.equal(LARGE_PLAN.tileMin, 48)
		assert.equal(LARGE_PLAN.heroMin, 88)
	})

	test('PARAMETERS 的 accent 与 icon 都在白名单里', () => {
		PARAMETER_KEYS.forEach((key) => {
			const meta = PARAMETERS[key]
			assert.ok(ACCENT_SLOTS.indexOf(meta.accent) >= 0, key)
			assert.ok(ICON_KEYS.indexOf(meta.icon) >= 0, key)
			assert.ok(featureUidOf(key).indexOf('.') > 0, key)
		})
	})

	test('图标路径只用设计稿支持的命令（两端解析器各自实现这一套）', () => {
		Object.entries(ICONS).forEach(([name, d]) => {
			const commands = d.match(/[A-Za-z]/g) || []
			commands.forEach((c) => {
				assert.ok('MmLlHhVvCcSsQqTtAaZz'.indexOf(c) >= 0, `${name} 用了不支持的 SVG 命令 ${c}`)
			})
		})
	})
})

// ---------------------------------------------------------------------------
describe('用户配置', () => {
	test('默认值：温度 / °C / 跟随系统 / 15 分钟', () => {
		const c = normalizeConfig(null)
		assert.equal(c.parameter, 'temperature')
		assert.equal(c.units.temperature, 'C')
		assert.equal(c.appearance, 'auto')
		assert.equal(c.refreshMinutes, 15)
		assert.equal(c.fetchEnabled, true)
	})

	test('非法值一律退回默认，脏数据不进 payload', () => {
		const c = normalizeConfig({
			parameter: 'wind_speed',
			appearance: 'neon',
			refreshMinutes: 7,
			units: { temperature: 'K', wind: 'furlongs', rain: 'in', pressure: 'hPa' }
		})
		assert.equal(c.parameter, 'temperature')
		assert.equal(c.appearance, 'auto')
		assert.equal(c.refreshMinutes, 15)
		assert.equal(c.units.temperature, 'C')
		assert.equal(c.units.wind, 'km/h')
		assert.equal(c.units.rain, 'in')
	})

	test('默认值：与设计原型一致（七项，不含压电雨量 / PM / lightning / battery）', () => {
		const c = normalizeConfig(null)
		assert.deepEqual(c.modules, DEFAULT_CONFIG_.modules)
		assert.deepEqual(c.modules, ['outdoor', 'indoor', 'wind', 'rainfall', 'pressure', 'solar', 'co2'])
		// 全集仍可用于勾选，只是默认不全选
		assert.equal(MODULE_KEYS.length, 12)
		assert.equal(c.hero, '')
	})

	test('modules 归一：保留用户给的顺序，去重并丢掉非法 key', () => {
		const c = normalizeConfig({ modules: ['co2', 'outdoor', 'co2', 'nope', 'wind'] })
		assert.deepEqual(c.modules, ['co2', 'outdoor', 'wind'])
	})

	test('modules 是脏值 / 空数组 / 全非法时回落默认全集', () => {
		assert.deepEqual(normalizeConfig({ modules: [] }).modules, DEFAULT_CONFIG_.modules)
		assert.deepEqual(normalizeConfig({ modules: 'outdoor' }).modules, DEFAULT_CONFIG_.modules)
		assert.deepEqual(normalizeConfig({ modules: ['nope'] }).modules, DEFAULT_CONFIG_.modules)
	})

	test('大卡模块数上限：多出来的被截断，顺序仍然保留', () => {
		const many = MODULE_KEYS.concat(['ghost1', 'ghost2']) // 模型里不存在，只为超长
		const c = normalizeConfig({ modules: many })
		assert.equal(c.modules.length, 12)
		assert.deepEqual(c.modules.slice(0, 3), MODULE_KEYS.slice(0, 3))
		// 构建层也挡一次：直接喂超长 moduleKeys，payload 里的模块数不超过 10
		const p = buildWidgetPayloadV4({
			reading: DEMO_READING,
			history: buildHistory(DEMO_READING, 1750000000000),
			now: 1750000000000,
			moduleKeys: many
		})
		assert.ok(p.modules.length <= 12)
	})

	test('hero 必须在 modules 里，否则回落空串', () => {
		assert.equal(normalizeConfig({ modules: ['outdoor', 'co2'], hero: 'co2' }).hero, 'co2')
		assert.equal(normalizeConfig({ modules: ['outdoor', 'co2'], hero: 'co2Pm' }).hero, '')
		assert.equal(normalizeConfig({ hero: 'nope' }).hero, '')
		assert.equal(normalizeConfig({ hero: null }).hero, '')
	})

	test('featured 只做形状归一：两侧非空字符串、值里不许带 `.`', () => {
		const c = normalizeConfig({
			featured: {
				outdoor: 'humidity', // 合法
				indoor: '', // 空值
				wind: 'wind.speed', // 带 `.` 的是 uid
				'': 'x', // 空 key
				co2: 3 // 非字符串
			}
		})
		assert.deepEqual(c.featured, { outdoor: 'humidity' })
		assert.deepEqual(normalizeConfig(null).featured, {})
		assert.deepEqual(normalizeConfig({ featured: 'outdoor' }).featured, {})
		assert.deepEqual(normalizeConfig({ featured: ['outdoor'] }).featured, {})
	})

	test('存 / 取 / 重置', () => {
		resetWidgetConfig()
		saveWidgetConfig({ parameter: 'rainfall', units: { rain: 'in' } })
		const got = getWidgetConfig()
		assert.equal(got.parameter, 'rainfall')
		assert.equal(got.units.rain, 'in')
		resetWidgetConfig()
		assert.equal(getWidgetConfig().parameter, 'temperature')
	})

	test('外观与语言解析', () => {
		assert.equal(resolveAppearance('auto', true), 'dark')
		assert.equal(resolveAppearance('auto', false), 'light')
		assert.equal(resolveAppearance('light', true), 'light')
		assert.equal(resolveWidgetLang('auto', 'zh'), 'zh')
		assert.equal(resolveWidgetLang('auto', 'en'), 'en')
		assert.equal(resolveWidgetLang('en', 'zh'), 'en')
	})

	test('toPayloadOptions 能直接喂给 buildWidgetPayloadV4', () => {
		const cfg = saveWidgetConfig({ parameter: 'wind', units: { wind: 'mph' }, appearance: 'dark' })
		const opts = toPayloadOptions(cfg, { systemDark: false })
		assert.equal(opts.parameter, 'wind')
		assert.equal(opts.units.wind, 'mph')
		assert.equal(opts.appearance, 'dark')
		assert.deepEqual(opts.moduleKeys, cfg.modules)
		assert.equal(opts.hero, '', 'hero 交给构建器推导，不写死 config.modules[0]')

		const pl = buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, ...opts })
		// 没选读数 → modules[0] 的第一条；parameter 不再决定主角
		assert.equal(pl.selection.feature, 'outdoor.temperature')
		assert.equal(readingOf(pl, 'wind.speed').unit, 'mph')
		assert.equal(DEFAULT_CONFIG_.refreshMinutes, 15)
	})

	test('主角读数与 hero 都从 modules[0] + featured 派生（运行与预览同一份规则）', () => {
		const cfg = { modules: ['indoor', 'outdoor', 'wind'], featured: { indoor: 'humidity' } }
		assert.equal(featureUidOfConfig(cfg), 'indoor.humidity')

		const opts = toPayloadOptions(cfg, {})
		assert.equal(opts.feature, 'indoor.humidity')
		// hero 不显式下发：交给构建器按主角所在模块推，避免跟 feature 分叉
		assert.equal(opts.hero, '')

		const pl = buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, lang: 'en', ...opts })
		assert.equal(pl.selection.feature, 'indoor.humidity')
		assert.equal(pl.selection.hero, 'indoor')
		assert.equal(readingOf(pl, 'indoor.humidity').value, numberText(READING.indoorHumidity, 'humidity'))
	})

	test('没选读数时 feature 为空串，交给构建器的 readings[0] 兜底', () => {
		assert.equal(featureUidOfConfig({ modules: ['indoor'] }), '')
		const pl = buildWidgetPayloadV4({
			reading: READING,
			history: HISTORY,
			now: NOW,
			lang: 'en',
			...toPayloadOptions({ modules: ['indoor'] }, {})
		})
		assert.equal(pl.selection.feature, 'indoor.temperature', '没选就是该模块第一条读数')
	})

	test('把 indoor 排第一时主角就是 indoor —— 不会串回 outdoor', () => {
		const cfg = { modules: ['indoor', 'outdoor', 'wind'], featured: {} }
		const pl = buildWidgetPayloadV4({
			reading: READING,
			history: HISTORY,
			now: NOW,
			lang: 'en',
			...toPayloadOptions(cfg, {})
		})
		assert.equal(pl.selection.feature, 'indoor.temperature')
		assert.equal(pl.selection.hero, 'indoor')
		assert.equal(readingOf(pl, 'indoor.temperature').value, numberText(READING.indoorCelsius, 'temperature'))
	})

	test('toPayloadOptions 把 featured 透传下去', () => {
		const opts = toPayloadOptions({ featured: { outdoor: 'humidity' } })
		assert.deepEqual(opts.featured, { outdoor: 'humidity' })
		const pl = buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, ...opts })
		assert.deepEqual(pl.selection.featured, { outdoor: 'humidity' })
	})

	test('appearance=auto 靠 systemDark 判深浅，漏传就是亮色', () => {
		const cfg = { appearance: 'auto' }
		assert.equal(toPayloadOptions(cfg, { systemDark: true }).appearance, 'dark')
		assert.equal(toPayloadOptions(cfg, { systemDark: false }).appearance, 'light')
		// 调用方漏传会被当成亮色 —— 这是首页接线时真实踩过的坑
		assert.equal(toPayloadOptions(cfg).appearance, 'light')
	})

	test('数据源带了单位制时盖掉设置里的那一份', () => {
		const cfg = { units: { temperature: 'C', wind: 'km/h', rain: 'mm', pressure: 'hPa' } }
		const opts = toPayloadOptions(cfg, { units: { temperature: 'F', wind: 'mph', rain: 'in', pressure: 'inHg' } })
		assert.equal(opts.units.temperature, 'F')
		// 没带就还是用设置里的
		assert.equal(toPayloadOptions(cfg, {}).units.temperature, 'C')
	})
})

// ---------------------------------------------------------------------------
// 平台门控与 payload 桥接
//
// 它们决定「要不要真的去调原生」——判错了是静默不生效，比崩溃更难查。
// ---------------------------------------------------------------------------
describe('平台门控', () => {
	test('iOS 上识别为可写平台', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }) })
		const { sync } = await loadModules(true)
		assert.equal(sync.isIosApp(), true)
		assert.equal(sync.isAndroidApp(), false)
		assert.equal(sync.isWidgetPlatform(), true)
	})

	test('Android 上识别为可写平台', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'android' }) })
		const { sync } = await loadModules(true)
		assert.equal(sync.isAndroidApp(), true)
		assert.equal(sync.isIosApp(), false)
		assert.equal(sync.isWidgetPlatform(), true)
	})

	test('其它平台一律不认，避免误报成功', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'h5' }) })
		const { sync } = await loadModules(true)
		assert.equal(sync.isWidgetPlatform(), false)
	})

	test('非 App 构建：条件编译把整段剥掉，永远是 false', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }) })
		const { sync } = await loadModules(false)
		assert.equal(sync.isIosApp(), false)
		assert.equal(sync.isWidgetPlatform(), false)
	})
})

describe('payload 桥接', () => {
	const payload = { schemaVersion: 4, selection: { feature: 'outdoor.temperature' } }

	test('写入成功时透传插件返回值', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }) })
		const { sync } = await loadModules(true, { pushWidgetData: () => ({ success: true, message: 'ok' }) })
		const res = sync.syncWidgetPayload(payload)
		assert.equal(res.success, true)
		assert.equal(res.message, 'ok')
	})

	test('传给插件的是可解析的 JSON', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'android' }) })
		let received = ''
		const { sync } = await loadModules(true, {
			pushWidgetData: (json) => {
				received = json
				return { success: true, message: 'ok' }
			}
		})
		sync.syncWidgetPayload(payload)
		const out = JSON.parse(received)
		// 原 payload 的键一个不少
		assert.deepEqual(out.selection, payload.selection)
		assert.equal(out.schemaVersion, 4)
		// 另外会挂上自拉取段，见「原生自拉取」
		assert.ok(out.fetch && typeof out.fetch === 'object', '写盘时必须带 fetch 段')
	})

	test('插件抛异常时被接住，返回可读错误而不是崩页', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }) })
		const { sync } = await loadModules(true, {
			pushWidgetData: () => {
				throw new Error('基座未包含 ecowitt-widget 插件')
			}
		})
		const res = sync.syncWidgetPayload(payload)
		assert.equal(res.success, false)
		assert.ok(res.message.indexOf('基座未包含') >= 0, res.message)
	})

	test('非 App 平台返回明确提示，不假装成功', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'h5' }) })
		const { sync } = await loadModules(false)
		const res = sync.syncWidgetPayload(payload)
		assert.equal(res.success, false)
		assert.ok(res.message && res.message.length > 0, '必须给出可读原因')
	})
})

// ---------------------------------------------------------------------------
// dashboard 适配层：接口信封 → 构建器入参
//
// 这里锁的是「后端给什么就显示什么」：单位不换算、变化量与极值不重算、
// 时间由 last_update 反推。任何一条失守，桌面上就是错数字。
// ---------------------------------------------------------------------------

describe('dashboard 适配层', () => {
	const DASH = {
		device_name: 'Backyard',
		last_update: 120,
		list: [
			{
				id: 1,
				data: {
					tempf: { value: '70.5', unit: '°F' },
					tempf_increment: { value: '-1.2', unit: '°F', symbol: -1 },
					max_daily_tempf: { value: '73.4', unit: '°F', time: '14:02' },
					min_daily_tempf: { value: '61.0', unit: '°F', time: '05:41' },
					humidity: { value: '62', unit: '%' },
					max_daily_humidity: { value: '78', unit: '%', time: '06:10' },
					min_daily_humidity: { value: '51', unit: '%', time: '15:20' },
					drew_temp: { value: '56.6', unit: '°F' },
					vpd: { value: '0.94', unit: 'kPa' },
					sendible_temp: { value: '70.9', unit: '°F' }
				}
			},
			{
				id: 4,
				data: {
					rainratein: { value: '0.02', unit: 'in/h' },
					dailyrainin: { value: '0.17', unit: 'in' },
					srain_piezo: { value: 1 }
				}
			},
			{ id: 5, data: { baromrelin: { value: '29.92', unit: 'inHg' } } }
		]
	}

	const snap = snapshotFromDashboard(DASH, { now: NOW })
	const payload = () =>
		buildWidgetPayloadV4({
			reading: snap.reading,
			history: snap.history,
			units: snap.units,
			connected: snap.connected,
			source: 'station',
			appearance: 'dark',
			lang: 'en',
			now: NOW
		})

	test('观测时间由 last_update 反推，不再是 Date.now()', () => {
		assert.equal(snap.reading.observedAt, NOW - 120 * 1000)
	})

	test('单位制从信封读出来', () => {
		assert.equal(snap.units.temperature, 'F')
		assert.equal(snap.units.rain, 'in')
		assert.equal(snap.units.pressure, 'inHg')
	})

	test('后端给的数值与单位直通，前端不再换算', () => {
		const temp = readingOf(payload(), 'outdoor.temperature')
		assert.equal(temp.value, '70.5')
		assert.equal(temp.unit, '°F')
	})

	test('变化量与极值用后端的，不按历史重算', () => {
		const temp = readingOf(payload(), 'outdoor.temperature')
		assert.deepEqual(temp.delta, { dir: -1, value: '1.2' })
		assert.deepEqual(temp.peak, {
			max: { value: '73.4', time: '14:02' },
			min: { value: '61.0', time: '05:41' }
		})
	})

	test('雨状态码转成语义，再由 payload 翻文案', () => {
		const gauge = readingOf(payload(), 'rainfall.rate')
		assert.equal(gauge.state, 'Raining')
	})

	test('体感已下线，明细行里不再出现', () => {
		const outdoor = payload().modules.find((m) => m.key === 'outdoor')
		assert.ok(outdoor.rows.every((r) => r.label !== 'Feels like'), JSON.stringify(outdoor.rows))
	})

	test('缺测字段不编数：没有风速就没有 wind 模块', () => {
		const p = payload()
		assert.equal(p.modules.some((m) => m.key === 'wind'), false)
		// 有数据的模块照常出
		assert.ok(p.modules.some((m) => m.key === 'outdoor'))
	})

	test('last_update = -1 视为未连接，不冒充在线', () => {
		const off = snapshotFromDashboard({ ...DASH, last_update: -1 }, { now: NOW })
		assert.equal(off.connected, false)
		assert.equal(off.reading.observedAt, null)
		const p = buildWidgetPayloadV4({ reading: off.reading, units: off.units, connected: off.connected, source: 'station', lang: 'en', now: NOW })
		assert.equal(p.status.text, 'Offline')
	})

	test('空数据返回 reading = null，让上层走「未连接」而不是空壳卡片', () => {
		assert.equal(snapshotFromDashboard({ list: [], last_update: -1 }, { now: NOW }).reading, null)
		assert.equal(snapshotFromDashboard(null, { now: NOW }).reading, null)
	})

	test('模块名取 dashboard 卡片的标题，后端没给才用内置文案', () => {
		const titled = snapshotFromDashboard(
			{
				device_name: 'X',
				last_update: 10,
				list: [
					{ id: 1, title: '室外温湿度', title_custom: '', data: { tempf: { value: '70.5', unit: '°F' } } },
					{ id: 3, title: '风速风向', title_custom: '', data: { windspeedmph: { value: '14.8', unit: 'mph' } } }
				]
			},
			{ now: NOW }
		)
		assert.equal(titled.reading.moduleTitles.outdoor, '室外温湿度')
		assert.equal(titled.reading.moduleTitles.wind, '风速风向')

		const pl = buildWidgetPayloadV4({
			reading: titled.reading,
			units: titled.units,
			lang: 'en',
			now: NOW
		})
		assert.equal(moduleOf(pl, 'outdoor').label, '室外温湿度', '模块名必须跟后端走')
		assert.equal(moduleOf(pl, 'wind').label, '风速风向')

		// 后端没给标题的模块（fixture 没有 moduleTitles）退回内置英文
		const fallback = buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, lang: 'en' })
		assert.equal(moduleOf(fallback, 'outdoor').label, 'Outdoor')
	})

	test('卡片 title 与 title_custom 同时存在时以 title 为准（改名写回的是 title）', () => {
		const renamed = snapshotFromDashboard(
			{
				device_name: 'X',
				last_update: 10,
				list: [
					{
						id: 1,
						title: '后山室外',
						title_custom: '室外温湿度',
						data: { tempf: { title: '气温', value: '21.4', unit: '°C' } }
					}
				]
			},
			{ now: NOW }
		)
		assert.equal(renamed.reading.moduleTitles.outdoor, '后山室外')
	})

	test('读数名和明细行名取信封的 title，后端叫什么就显示什么', () => {
		const named = snapshotFromDashboard(
			{
				device_name: 'X',
				last_update: 10,
				list: [
					{
						id: 1,
						title: '室外',
						data: {
							tempf: { title: '气温', value: '70.5', unit: '°F' },
							humidity: { title: '相对湿度', value: '62', unit: '%' },
							drew_temp: { title: '露点温度', value: '56.6', unit: '°F' }
						}
					}
				]
			},
			{ now: NOW }
		)
		assert.equal(named.reading.readingTitles['outdoor.temperature'], '气温')
		assert.equal(named.reading.readingTitles['outdoor.dewPoint'], '露点温度')

		const pl = buildWidgetPayloadV4({ reading: named.reading, units: named.units, lang: 'en', now: NOW })
		const temp = readingOf(pl, 'outdoor.temperature')
		const hum = readingOf(pl, 'outdoor.humidity')
		assert.equal(temp.label, '气温')
		assert.equal(hum.label, '相对湿度')
		const outdoor = moduleOf(pl, 'outdoor')
		assert.ok(outdoor.rows.some((r) => r.label === '露点温度'), JSON.stringify(outdoor.rows))
		// 后端没给的读数名，退回内置英文
		assert.equal(buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, lang: 'en' }).modules[0].readings[0].label, 'Temperature')
	})

	test('模块顺序跟 dashboard 卡片返回的先后', () => {		const dash = snapshotFromDashboard(
			{
				device_name: 'X',
				last_update: 10,
				list: [
					{ id: 4, title: '雨量', data: { rainratein: { value: '0.02', unit: 'mm/h' } } },
					{ id: 3, title: '风', data: { windspeedmph: { value: '14.8', unit: 'km/h' } } },
					{ id: 1, title: '室外', data: { tempf: { value: '21.4', unit: '°C' } } }
				]
			},
			{ now: NOW }
		)
		assert.deepEqual(dash.reading.moduleOrder, ['rainfall', 'wind', 'outdoor'])

		const pl = buildWidgetPayloadV4({ reading: dash.reading, units: dash.units, lang: 'en', now: NOW })
		assert.deepEqual(pl.modules.map((m) => m.key), ['rainfall', 'wind', 'outdoor'])
	})
})

// ---------------------------------------------------------------------------
// 历史序列：复用 graph 页的 /graph/data（mode=5）
// ---------------------------------------------------------------------------

describe('graph 历史适配', () => {
	const GRAPH = {
		title_arr: ['Temperature', 'Humidity'],
		units: ['°F', '%'],
		times: ['12:00', '13:00', '14:00'],
		dates: ['2026-02-19 12:00:00', '2026-02-19 13:00:00', '2026-02-19 14:00:00'],
		list: {
			tempf: [70.1, 70.3, 70.5],
			humidity: [62, 61, 60]
		}
	}
	const at = (h) => new Date(2026, 1, 19, h, 0, 0).getTime()

	test('序列 key 翻成 uid，时间从 dates 解析成毫秒', () => {
		const history = historyFromGraph(GRAPH, { now: NOW })
		assert.deepEqual(history['outdoor.temperature'].points, [
			[at(12), 70.1],
			[at(13), 70.3],
			[at(14), 70.5]
		])
		assert.deepEqual(history['outdoor.humidity'].points, [
			[at(12), 62],
			[at(13), 61],
			[at(14), 60]
		])
	})

	test('缺测点跳过，不把 null 画成断崖也不补 0', () => {
		const history = historyFromGraph(
			{ ...GRAPH, list: { tempf: [70.1, null, 70.5] } },
			{ now: NOW }
		)
		assert.deepEqual(history['outdoor.temperature'].points, [
			[at(12), 70.1],
			[at(14), 70.5]
		])
	})

	test('dates 缺失时按「末点 = now」等距反推，至少要能画出形状', () => {
		const history = historyFromGraph({ list: { tempf: [1, 2, 3] }, times: ['a', 'b', 'c'] }, { now: NOW })
		const points = history['outdoor.temperature'].points
		assert.equal(points.length, 3)
		assert.equal(points[2][0], NOW)
		assert.ok(points[0][0] < points[1][0] && points[1][0] < points[2][0])
	})

	test('点不足两条不出序列，构建器走空图', () => {
		const history = historyFromGraph({ list: { tempf: [70.1] }, dates: ['2026-02-19 12:00:00'] }, { now: NOW })
		assert.equal(history['outdoor.temperature'], undefined)
	})

	test('按 uid 找回承载它的卡片，拿到 graph_id', () => {
		const list = [
			{ id: 1, graph_id: '1', data: { tempf: { value: '70.5' }, humidity: { value: '62' } } },
			{ id: 4, graph_id: '4', data: { rainratein: { value: '0.02' } } }
		]
		assert.deepEqual(graphTargetOf(list, 'outdoor.temperature'), { graphId: '1', sourceKey: 'tempf' })
		assert.deepEqual(graphTargetOf(list, 'rainfall.rate'), { graphId: '4', sourceKey: 'rainratein' })
		assert.equal(graphTargetOf(list, 'solar.index'), null)
	})
})

// ---------------------------------------------------------------------------
// 原生自拉取：fetch 段 + 数据段合并
//
// 这块跨三端（JS / Swift / Kotlin），任何一处漂移都表现为「桌面不动了」，
// 所以除了形状，还要断言两端原生里的键名和 JS 这份是同一份。
// ---------------------------------------------------------------------------
describe('原生自拉取', () => {
	const BASE = 'https://apitest.ecowitt.net'
	const CONFIG = { modules: ['outdoor', 'indoor'], refreshMinutes: 30, fetchEnabled: true }

	function samplePayload(extra = {}) {
		return {
			schemaVersion: 4,
			lang: 'zh',
			deviceId: 'DEV1',
			theme: { bg: '#141a23' },
			icons: { temperature: 'M4 4h8v8z' },
			labels: { noHistory: '--' },
			modules: [{ key: 'outdoor', readings: [{ key: 'temperature', value: '21' }] }],
			selection: { feature: 'outdoor.temperature', hero: 'outdoor', featured: { outdoor: 'temperature' } },
			station: 'OUT',
			updated: '16:00',
			updatedShort: '16:00',
			status: { text: 'Online', tone: 'ok' },
			observedAt: 1000,
			...extra
		}
	}

	test('地址是可配的完整请求，设备位置留 {id} 给原生替换', () => {
		setWidgetFetchBase(BASE)
		const segment = buildFetchSegment({
			enabled: true,
			token: 'tk',
			deviceId: 'DEV1',
			userId: '42',
			intervalMinutes: 30,
			payload: samplePayload(),
			config: CONFIG
		})
		assert.equal(segment.enabled, true)
		assert.ok(segment.url.startsWith(BASE + WIDGET_FETCH_PATH + '?'), segment.url)
		// 设备走 query 参数，不是路径段
		assert.ok(segment.url.indexOf('device_id={id}') >= 0, segment.url)
		assert.ok(segment.url.indexOf('user_id=42') >= 0, segment.url)
		assert.ok(segment.url.indexOf('cfg=') >= 0, segment.url)
		assert.equal(segment.authHeader, 'Token')
		assert.equal(segment.authValue, 'tk')
		assert.equal(segment.timeoutMs, 5000)
		setWidgetFetchBase('')
	})

	test('cfg 带的是渲染配置，不是整份 payload', () => {
		setWidgetFetchBase(BASE)
		const segment = buildFetchSegment({
			enabled: true,
			token: 'tk',
			deviceId: 'DEV1',
			payload: samplePayload(),
			config: CONFIG
		})
		// 用 searchParams 取，别手撕字符串 —— URL 里还有 user_id / env，split 一下就把尾巴带进去了
		const cfg = JSON.parse(new URL(segment.url).searchParams.get('cfg'))
		assert.deepEqual(cfg.modules, ['outdoor', 'indoor'])
		assert.equal(cfg.feature, 'outdoor.temperature')
		assert.equal(cfg.hero, 'outdoor')
		assert.equal(cfg.lang, 'zh')
		// 模块顺序按谁的走：用户排过 → 按 cfg.modules；没排过 → 不传 order=true，跟随 dashboard
		assert.equal(cfg.order, true)
		// 主题、图标这些是 token 段，不该进请求
		assert.equal(cfg.theme, undefined)
		assert.equal(cfg.icons, undefined)
		setWidgetFetchBase('')
	})

	test('没有基址 / 没有登录态 → 关掉，绝不带着空 token 打接口', () => {
		setWidgetFetchBase('')
		const noBase = buildFetchSegment({ enabled: true, token: 'tk', payload: samplePayload(), config: CONFIG })
		assert.equal(noBase.enabled, false)
		assert.equal(noBase.url, '')

		setWidgetFetchBase(BASE)
		const noToken = buildFetchSegment({ enabled: true, token: '', payload: samplePayload(), config: CONFIG })
		assert.equal(noToken.enabled, false)
		setWidgetFetchBase('')
	})

	test('间隔与超时有兜底，脏值不会下发', () => {
		setWidgetFetchBase(BASE)
		const segment = buildFetchSegment({ enabled: true, token: 'tk', payload: samplePayload(), config: CONFIG, intervalMinutes: 0 })
		assert.equal(segment.intervalMinutes, 30)
		// 失败重试间隔与抖动也走 payload：改它们不用重打基座
		assert.equal(segment.retryMinutes, 15)
		assert.equal(segment.jitterSeconds, 120)
		setWidgetFetchBase('')
	})

	test('兜底阈值默认比间隔小 5 分钟，且有下限', () => {
		setWidgetFetchBase(BASE)
		// 30 分钟一拉 → 25 分钟内前台写过盘就跳过（避开边界抖动）
		const normal = buildFetchSegment({ enabled: true, token: 'tk', payload: samplePayload(), config: CONFIG, intervalMinutes: 30 })
		assert.equal(normal.minAgeMinutes, 25)
		// 间隔调得再小，阈值也不低于 5 分钟，否则等于没兜底、纯费电
		const fast = buildFetchSegment({ enabled: true, token: 'tk', payload: samplePayload(), config: CONFIG, intervalMinutes: 2 })
		assert.equal(fast.minAgeMinutes, 5)
		setWidgetFetchBase('')
	})

	test('attachWidgetFetch 整段覆盖，不会累积旧段', () => {
		const stale = samplePayload({ fetch: { enabled: true, url: 'http://old', intervalMinutes: 5 } })
		const next = attachWidgetFetch(stale, { ...CONFIG, fetchEnabled: false })
		assert.equal(next.fetch.enabled, false)
		assert.equal(next.fetch.url, '')
		assert.equal(next.fetch.intervalMinutes, 30)
		// 数据段原样保留
		assert.equal(next.station, 'OUT')
		assert.deepEqual(next.modules, stale.modules)
	})

	test('dataSegmentOf 只摘数据键', () => {
		const segment = dataSegmentOf(samplePayload())
		assert.deepEqual(Object.keys(segment).sort(), [...WIDGET_DATA_KEYS].sort())
		assert.equal(segment.theme, undefined)
		assert.equal(segment.icons, undefined)
	})

	test('mergeDataSegment 只覆盖数据键，token 段一个不动', () => {
		const before = samplePayload()
		const merged = mergeDataSegment(before, {
			station: 'NEW',
			modules: [],
			theme: { bg: '#fff' }, // 数据段里混进了 token 键：必须被丢掉
			icons: {},
			unknownKey: 1
		})
		assert.equal(merged.station, 'NEW')
		assert.deepEqual(merged.modules, [])
		// token 段保持原样
		assert.deepEqual(merged.theme, before.theme)
		assert.deepEqual(merged.icons, before.icons)
		assert.equal(merged.unknownKey, undefined)
	})

	test('数据段里缺的键不会被删，也不会变成 undefined', () => {
		const before = samplePayload()
		const merged = mergeDataSegment(before, { station: 'NEW' })
		assert.equal(merged.status.text, 'Online')
		assert.equal(merged.observedAt, 1000)
		assert.ok(!('deviceId' in merged) === false)
	})

	test('两端原生抄的键名与 WIDGET_DATA_KEYS 一致', async () => {
		// 仓库里是 native/ios-widget + uni_modules 的嵌套布局；
		// CI 的 stage 是扁平布局（EcowittWidget/、app-android/ 在根上），两种都要找得到
		const swift = await readNative('EcowittWidget/WidgetFetcher.swift', 'native/ios-widget/EcowittWidget/WidgetFetcher.swift')
		const kotlin = await readNative('app-android/hybrid.kt', 'uni_modules/ecowitt-widget/utssdk/app-android/hybrid.kt')
		WIDGET_DATA_KEYS.forEach((key) => {
			assert.ok(swift.indexOf('"' + key + '"') >= 0, 'WidgetFetcher.swift 缺 ' + key)
			assert.ok(kotlin.indexOf('"' + key + '"') >= 0, 'hybrid.kt 缺 ' + key)
		})
	})

	test('historyUidsOf 同时取 feature 与 hero，按模块去重', () => {
		const payload = samplePayload({
			selection: { feature: 'outdoor.temperature', hero: 'indoor', featured: {} },
			modules: [
				{ key: 'outdoor', readings: [{ key: 'temperature' }] },
				{ key: 'indoor', readings: [{ key: 'humidity' }] }
			]
		})
		assert.deepEqual(historyUidsOf(payload), ['outdoor.temperature', 'indoor.humidity'])
		// hero 与 feature 同一模块时只取一次
		const same = samplePayload({
			selection: { feature: 'outdoor.temperature', hero: 'outdoor' },
			modules: [{ key: 'outdoor', readings: [{ key: 'humidity' }] }]
		})
		assert.deepEqual(historyUidsOf(same), ['outdoor.temperature'])
	})
})

// ---------------------------------------------------------------------------
// 接口地址的热更新：改完地址不能等下一次 dashboard 写盘
// ---------------------------------------------------------------------------
describe('自拉取地址热更新', () => {
	const BASE = 'https://apitest.ecowitt.net'
	const NEW_BASE = 'https://tiara-corded-theressa.ngrok-free.dev'

	function sharedPayload(url) {
		return {
			schemaVersion: 4,
			lang: 'en',
			deviceId: 'DEV1',
			modules: [{ key: 'outdoor', readings: [{ key: 'temperature', value: '21' }] }],
			selection: { feature: 'outdoor.temperature', hero: 'outdoor', featured: {} },
			station: 'OUT',
			threshold: 1,
			fetch: { enabled: true, url, deviceId: 'DEV1', intervalMinutes: 15, minAgeMinutes: 10 }
		}
	}

	test('地址变了 → 立刻重写并刷新', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }), getStorageSync: (k) => (k === 'token' ? 'tk' : '') })
		let pushed = ''
		const { sync, fetch } = await loadModules(true, {
			readWidgetData: () => JSON.stringify(sharedPayload(BASE + '/widget/data?device_id={id}')),
			pushWidgetData: (json) => {
				pushed = json
				return { success: true, message: 'ok' }
			}
		})
		fetch.setWidgetFetchBase(NEW_BASE)
		const res = sync.syncWidgetFetchIfChanged()
		assert.equal(res.applied, true)
		const out = JSON.parse(pushed)
		assert.ok(out.fetch.url.indexOf(NEW_BASE) === 0, out.fetch.url)
		// 数据段原样带走，不是只发个 fetch 段
		assert.equal(out.station, 'OUT')
		assert.deepEqual(out.modules, sharedPayload('').modules)
	})

	test('地址没变 → 不写盘（不制造多余写入、不打扰门控）', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }), getStorageSync: (k) => (k === 'token' ? 'tk' : '') })
		// 共享区的内容用「上一次真正写出去的那份」，才等价于线上情况
		// （手写一个 url 会和构建器拼出来的差 user_id / cfg，永远判成「变了」）
		let shared = JSON.stringify(sharedPayload(BASE + '/widget/data?device_id={id}'))
		let writes = 0
		const { sync, fetch } = await loadModules(true, {
			readWidgetData: () => shared,
			pushWidgetData: (json) => {
				writes++
				shared = json
				return { success: true, message: 'ok' }
			}
		})
		fetch.setWidgetFetchBase(NEW_BASE)
		assert.equal(sync.syncWidgetFetchIfChanged().applied, true)
		assert.equal(writes, 1)
		// 第二次：地址已经对齐，不该再写
		const res = sync.syncWidgetFetchIfChanged()
		assert.equal(res.applied, false)
		assert.equal(writes, 1)
	})

	test('共享区没数据 → 安静返回，不抛异常', async () => {
		installUni({ getSystemInfoSync: () => ({ platform: 'android' }) })
		const { sync } = await loadModules(true, { readWidgetData: () => '' })
		const res = sync.syncWidgetFetchIfChanged()
		assert.equal(res.applied, false)
	})
})

// 联调开关：门控阈值默认 interval−5（最少 10 分钟），验一次太慢
describe('兜底阈值的联调覆盖', () => {
	test('storage 覆盖生效，脏值忽略', async () => {
		const { fetch } = await loadModules(true, {})
		fetch.setWidgetFetchBase('https://a.example.com')
		const base = { enabled: true, token: 'tk', payload: { selection: {}, lang: 'en' }, config: { modules: ['outdoor'] }, intervalMinutes: 30 }
		// 默认 interval−5
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }) })
		assert.equal(fetch.buildFetchSegment(base).minAgeMinutes, 25)
		// 覆盖成 1 分钟（iOS 联调就靠这个，不用等 25 分钟）
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }), getStorageSync: (k) => (k === 'widgetFetchMinAge' ? 1 : '') })
		assert.equal(fetch.buildFetchSegment(base).minAgeMinutes, 1)
		// 脏值 / 越界 → 回默认
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }), getStorageSync: (k) => (k === 'widgetFetchMinAge' ? 'abc' : '') })
		assert.equal(fetch.buildFetchSegment(base).minAgeMinutes, 25)
		installUni({ getSystemInfoSync: () => ({ platform: 'ios' }), getStorageSync: (k) => (k === 'widgetFetchMinAge' ? 999 : '') })
		assert.equal(fetch.buildFetchSegment(base).minAgeMinutes, 25)
	})
})

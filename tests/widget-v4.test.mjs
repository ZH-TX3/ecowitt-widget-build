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
const SOURCES = ['widgetDesign', 'widgetFormat', 'widgetFixture', 'widgetPayloadV4', 'widgetConfig']

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

const { buildWidgetPayloadV4, WIDGET_SCHEMA_V4, WIDGET_RANGE_HOURS, modulesOf, readingFromDashboard } = await import(
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
	toPayloadOptions
} = await import(toUrl('widgetConfig.mjs'))

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
		assert.ok(s.split.mediumLeft > 30 && s.split.mediumLeft < 60, 'medium 左栏占比应是个合理的百分比')
		assert.equal(s.plan.budget, LARGE_PLAN.budget)
		assert.equal(s.plan.tileMin, LARGE_PLAN.tileMin)
		// UV 光谱条是物理常量，5 段
		assert.equal(s.uvScale.length, 5)
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
		assert.equal(p.modules.length, 10)
		const shape = p.modules.map((m) => m.key + ':' + m.readings.length)
		assert.deepEqual(shape, [
			'outdoor:2',
			'indoor:2',
			'wind:2',
			'rainfall:2',
			'pressure:3',
			'solar:1',
			'uv:1',
			'co2:2',
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
		assert.equal(count, 17)
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
		assert.deepEqual(maxOnly.sort(), ['co2.aqi', 'solar.radiation', 'uv.index', 'wind.speed'].sort())
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
		const rain = readingOf(p, 'rainfall.gauge')
		assert.equal(rain.lines[0].label, 'Piezo rain')
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
		assert.equal(readingOf(p, 'uv.index').visual.kind, 'uv')
		assert.ok(readingOf(p, 'uv.index').visual.pos > 0 && readingOf(p, 'uv.index').visual.pos < 100)
		assert.equal(readingOf(p, 'rainfall.gauge').visual.kind, 'bars')
		assert.equal(readingOf(p, 'battery.volt').visual.kind, 'battery')
		assert.equal(readingOf(p, 'battery.volt').visual.level, 4)
	})

	test('数值长的读数标记 small，小卡与 hero 会降一档字', () => {
		const p = build()
		assert.equal(readingOf(p, 'pressure.relative').small, true)
		assert.equal(readingOf(p, 'outdoor.temperature').small, false)
	})

	test('雨量有雨画状态、无雨留空（状态槽）', () => {
		const wet = readingOf(build(), 'rainfall.gauge')
		assert.equal(wet.stateSlot, true)
		assert.equal(wet.state, 'Raining')
		const dry = readingOf(build({ reading: { ...READING, rainState: null } }), 'rainfall.gauge')
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

	test('序列按时间升序且落在窗口内', () => {
		const p = build()
		const times = moduleOf(p, 'outdoor').series.map((x) => x[0])
		assert.deepEqual(times, times.slice().sort((a, b) => a - b))
		assert.ok(times[0] >= NOW - 24 * 3600 * 1000)
		assert.ok(times[times.length - 1] <= NOW)
	})

	test('序列换算成显示单位', () => {
		const c = build({ units: { ...DEFAULT_UNITS, temperature: 'F' } })
		const series = moduleOf(c, 'outdoor').series
		assert.ok(series[series.length - 1][1] > 60, '华氏下末点应该 > 60')
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
		assert.equal(zh.labels.noHistory, '历史数据不足')
		assert.equal(zh.labels.noTrend, '暂无趋势')
		const en = build({ lang: 'en' })
		assert.equal(moduleOf(en, 'outdoor').label, 'Outdoor')
		assert.equal(en.labels.noHistory, 'Insufficient history')
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
			'pressure',
			'solar',
			'uv',
			'co2',
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
		assert.equal(readingOf(p, 'rainfall.gauge').unit, 'in/h')
	})

	test('角度转八方位，负角和超过 360 都能收敛', () => {
		assert.equal(directionText(0), 'N')
		assert.equal(directionText(135), 'SE')
		assert.equal(directionText(-90), 'W')
		assert.equal(directionText(450), 'E')
		assert.equal(directionText(null), '—')
	})

	test('3 小时气压趋势与环填充', () => {
		assert.ok(Math.abs(pressureDelta(READING, HISTORY.pressure)) < 10)
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

		const pl = buildWidgetPayloadV4({ reading: READING, history: HISTORY, now: NOW, ...opts })
		assert.equal(pl.selection.feature, 'wind.speed')
		assert.equal(readingOf(pl, 'wind.speed').unit, 'mph')
		assert.equal(DEFAULT_CONFIG_.refreshMinutes, 15)
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
		assert.deepEqual(JSON.parse(received), payload)
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

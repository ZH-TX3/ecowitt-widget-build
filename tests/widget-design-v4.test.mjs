// 单元测试：docx/Ecowitt-Widgets-v4.html（设计系统的可运行原型）
//
// 锁的是「这条链路上反复被打断的契约」，不是像素：
//   1. 数据模型：模块 → 读数（突出项）→ 变化量/极值/附带项/签名
//   2. 渲染契约：small / medium / large 各自该出现什么、不该重复什么
//   3. 自适应规则：模块数 → 列数 / dense / 跨列 / hero 展开行数
//   4. token 纪律：样式里引用的变量都有产出，画布区不写死字号、不串外壳度量
//
// 页面脚本是普通 <script>（无模块），直接在 vm 里跑，DOM 用最小替身。
//
// 跑法：node --test tests/widget-design-v4.test.mjs

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const htmlPath = path.resolve(here, '..', 'docx', 'Ecowitt-Widgets-v4.html')
// docx/ 被 .gitignore 掉，别人 clone 下来可能没有这个文件 —— 缺了就跳过，不要弄红 CI
const hasHtml = fs.existsSync(htmlPath)
let script = ''
let style = ''

/** 最小 DOM 替身：只要 innerHTML / style / classList / addEventListener */
function makeDom() {
	const nodes = new Map()
	const mk = (id) => ({
		id,
		innerHTML: '',
		style: {},
		classList: {
			list: new Set(),
			toggle(c, on) { on ? this.list.add(c) : this.list.delete(c) },
			contains(c) { return this.list.has(c) }
		},
		addEventListener() {},
		querySelectorAll: () => [],
		querySelector: () => mk(id + '-child')
	})
	return {
		document: {
			getElementById: (id) => {
				if (!nodes.has(id)) nodes.set(id, mk(id))
				return nodes.get(id)
			},
			querySelector: () => mk('q'),
			querySelectorAll: () => []
		},
		nodes
	}
}

describe('Ecowitt 小组件 v4 设计系统', { skip: hasHtml ? false : 'docx/Ecowitt-Widgets-v4.html 不存在（该目录在 .gitignore 里）' }, () => {
	let ctx
	let ev
	let nodes

	before(() => {
		const html = fs.readFileSync(htmlPath, 'utf8')
		script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
		style = html.match(/<style>([\s\S]*?)<\/style>/)[1]
		const dom = makeDom()
		nodes = dom.nodes
		ctx = { document: dom.document, console, Math, Number, Object, Array, JSON, String, fs }
		vm.createContext(ctx)
		new vm.Script(script, { filename: 'widgets-v4.js' }).runInContext(ctx)
		ev = (expr) => new vm.Script(expr).runInContext(ctx)
	})

	// ---------------------------------------------------------------------
	describe('数据模型', () => {
		test('模块与读数的数量对得上真实 dashboard', () => {
			const mods = JSON.parse(ev('JSON.stringify(MODULES.map(m => ({ key: m.key, n: m.readings.length })))'))
			const byKey = Object.fromEntries(mods.map((m) => [m.key, m.n]))
			assert.equal(mods.length, 10)
			assert.deepEqual(byKey, {
				outdoor: 2,   // 温度 / 湿度
				indoor: 2,    // 温度 / 湿度
				wind: 2,      // 实时风速 / 阵风
				rainfall: 2,   // 雨量计 / 压电雨量
				pressure: 3,  // 相对 / 绝对 / 海平面
				solar: 1,
				uv: 1,
				co2: 2,   // 室内浓度 / CO₂+PM 的 AQI 组合
				lightning: 1,
				battery: 1
			})
		})

		test('每条读数都有值 / 单位 / 强调色 / 视觉签名', () => {
			const entries = JSON.parse(ev('JSON.stringify(ENTRIES.map(e => ({ uid: e.uid, value: e.value, unit: e.unit, accent: e.accent, kind: e.visual && e.visual.kind })))'))
			assert.equal(entries.length, 17)
			entries.forEach((e) => {
				assert.ok(e.value !== null && e.value !== undefined && e.value !== '', e.uid + ' 缺 value')
				assert.equal(typeof e.unit, 'string', e.uid + ' 缺 unit')
				assert.ok(['temp', 'water', 'wind', 'pressure', 'sun'].includes(e.accent), e.uid + ' accent 非法: ' + e.accent)
				assert.ok(['glyph', 'ring', 'dial', 'gauge', 'uv', 'bars', 'sun', 'battery'].includes(e.kind), e.uid + ' visual 非法: ' + e.kind)
			})
		})

		test('极值只允许 max，或 max+min；不允许只有 min', () => {
			const peaks = JSON.parse(ev(`JSON.stringify(ENTRIES.filter(e => e.peak).map(e => ({
				uid: e.uid,
				hasMax: !!e.peak.max,
				hasMin: !!e.peak.min,
				maxTime: e.peak.max && e.peak.max.time
			})))`))
			assert.ok(peaks.length >= 6)
			peaks.forEach((p) => {
				assert.ok(p.hasMax, p.uid + ' 有 peak 却没 max')
				if (p.hasMin) assert.ok(p.hasMax, p.uid + ' 有 min 却没 max')
			})
			// 只有单向极值的模块（真实数据里就没有反向）
			const maxOnly = JSON.parse(ev(`JSON.stringify(ENTRIES.filter(e => e.peak && !e.peak.min).map(e => e.uid))`))
			assert.deepEqual(maxOnly.sort(), ['co2.aqi', 'solar.radiation', 'uv.index', 'wind.speed'].sort())
		})

		test('每条读数都有附带项（同模块另一读数，或 rows[0]）', () => {
			const miss = JSON.parse(ev(`JSON.stringify(ENTRIES.filter(e => !e.attach && !e.attachText).map(e => e.uid))`))
			assert.deepEqual(miss, [])
		})

		test('成对读数互为附带项', () => {
			const pairs = [
				['outdoor.temperature', 'Humidity'],
				['outdoor.humidity', 'Temperature'],
				['wind.speed', 'Gust'],
				['wind.gust', 'Speed'],
				['pressure.relative', 'Absolute'],
				['pressure.absolute', 'Relative']
			]
			pairs.forEach(([uid, expect]) => {
				const label = ev(`entryOf('${uid}').attach.label`)
				assert.ok(
					uid.startsWith('wind') ? ev(`entryOf('${uid}').attachText`).includes(expect) : label === expect,
					uid + ' 的附带项应是 ' + expect + '，实际 ' + label
				)
			})
		})

		test('solar 的成对摘要包含日出和日落', () => {
			const compact = ev("entryOf('solar.radiation').compact")
			assert.match(compact, /06:12/)
			assert.match(compact, /18:41/)
		})
	})

	// ---------------------------------------------------------------------
	describe('small 卡：一个突出项 + 一个附带项', () => {
		const small = (uid) => ev(`cardSmall(entryOf('${uid}')).replace(/<[^>]+>/g, ' ')`)

		test('温度为主时附带湿度，湿度为主时附带温度', () => {
			const temp = small('outdoor.temperature')
			assert.match(temp, /21\.4/)
			assert.match(temp, /Humidity/)
			assert.match(temp, /62/)

			const hum = small('outdoor.humidity')
			assert.match(hum, /62/)
			assert.match(hum, /Temperature/)
			assert.match(hum, /21\.4/)
		})

		test('变化量与极值同行，且极值不印单位', () => {
			const meta = ev("metaHTML(entryOf('outdoor.temperature'))")
			assert.match(meta, /0\.6/)
			assert.match(meta, /24\.8/)
			assert.match(meta, /14\.1/)
			assert.equal(meta.includes('°C'), false, '极值/变化量不应带单位')
			// 极值换成了图标，不再有字母 H / L
			assert.equal(/>H</.test(meta), false)
			assert.match(meta, /class="mi"/)
		})

		test('只有单向极值时只画一个图标', () => {
			const meta = ev("metaHTML(entryOf('wind.speed'))")
			assert.equal((meta.match(/class="mi"/g) || []).length, 1)
			assert.equal(meta.includes('minOut'), false)
		})

		test('头部右侧是时间，不是读数名', () => {
			const head = ev(`cardSmall(entryOf('outdoor.temperature')).match(/<div class="head">[\\s\\S]*?<\\/div>/)[0]`)
			assert.match(head, /14:32/)
			assert.equal(head.includes('Temperature'), false, '头部不应再印读数名')
		})

		test('solar 小卡同时显示日出与日落（回归：曾只剩 Sunrise）', () => {
			const text = small('solar.radiation')
			assert.match(text, /06:12/)
			assert.match(text, /18:41/)
		})

		test('电池图标是 5 格电量，只剩 1 格转红', () => {
			const low = ev("visualHTML({ visual:{ kind:'battery', level:1 } }, true)")
			assert.equal((low.match(/<i/g) || []).length, 5, '固定 5 格')
			assert.match(low, /class="cells"/, '5 格要装在外框里')
			assert.match(low, /class="nub"/, '外框右侧有电极')
			assert.equal((low.match(/on low/g) || []).length, 1, '1 格且是告警态')

			const mid = ev("visualHTML({ visual:{ kind:'battery', level:4 } }, true)")
			assert.equal((mid.match(/class=\"on\"/g) || []).length, 4)
			assert.equal(mid.includes('low'), false, '电量正常不告警')

			const empty = ev("visualHTML({ visual:{ kind:'battery', level:0 } }, true)")
			assert.equal((empty.match(/class=\"on/g) || []).length, 0)

			// 配色来自 token：满格绿（App 的 .green-color）、告警红（error）
			assert.equal(ev('TOKENS.light.ok'), '#26d800')
			assert.equal(ev('TOKENS.light.danger'), '#dd524d')
			assert.equal(JSON.parse(ev("JSON.stringify(varsFor('small','light','battery.volt'))")).ok, '#26d800')
			assert.equal(JSON.parse(ev("JSON.stringify(varsFor('small','light','battery.volt'))")).danger, '#dd524d')
		})

		test('图标可配置：inSmall:false 的小卡不画右侧签名，瓦片照画', () => {
			// 跟头部 chip 重复的三个：室外温度 / 室内温度 / 光照
			for (const uid of ['outdoor.temperature', 'indoor.temperature', 'solar.radiation']) {
				const sm = ev(`cardSmall(entryOf('${uid}'))`)
				assert.equal(sm.includes('class=\"viz'), false, uid + ' 小卡不该有签名')
				// 瓦片（large）里仍然保留
				const tile = ev(`tileHTML(entryOf('${uid}'), 2, 2, 88)`)
				assert.match(tile, /class=\"viz/, uid + ' 瓦片里应保留签名')
			}
			// 没声明的照旧：湿度（环）、风（罗盘）、UV（刻度条）
			for (const uid of ['outdoor.humidity', 'wind.speed', 'uv.index']) {
				assert.match(ev(`cardSmall(entryOf('${uid}'))`), /class=\"viz/, uid + ' 应该画签名')
			}
		})

		test('雨量在 large 里：有雨画水滴，无雨什么都不画', () => {
			const tile = ev("tileHTML(entryOf('rainfall.gauge'), 2, 2, 64)")
			assert.match(tile, /class="viz glyph xs"/, '有雨时是水滴图标')
			assert.equal(tile.includes('Raining'), false, '不再用文字')
			assert.equal(tile.includes('class="chip'), false)

			const hero = ev("heroHTML(entryOf('rainfall.gauge'), 2, 120)")
			assert.match(hero, /class="viz glyph"/, 'hero 里同样画水滴')
			assert.equal(hero.includes('Raining'), false)

			// 无雨：整块留空
			const dry = ev("(() => { const e = Object.assign({}, entryOf('rainfall.gauge'), { state: null }); return tileHTML(e, 2, 2, 64) })()")
			assert.equal(dry.includes('class="viz'), false, '无雨不画')
			assert.equal(dry.includes('state-tag'), false)

			// 对照：非 stateSlot 模块（温度）图标照常
			assert.match(ev("tileHTML(entryOf('outdoor.temperature'), 2, 2, 64)"), /class="viz/)
		})

		test('small 卡里雨量仍是状态文字（水滴只在 large 用）', () => {
			const wet = ev("cardSmall(entryOf('rainfall.gauge'))")
			assert.match(wet, /Raining/, '小卡保留文字状态')
			assert.equal(wet.includes('class=\"viz'), false, '小卡不画图标')

			const dry = ev("(() => { const e = Object.assign({}, entryOf('rainfall.gauge'), { state: null }); return cardSmall(e) })()")
			assert.equal(dry.includes('state-tag'), false, '无雨就不显示状态')
			assert.equal(dry.includes('class=\"viz'), false)
		})

		test('状态槽没有状态时留空，不退回图标', () => {
			const empty = ev("(() => { const e = Object.assign({}, entryOf('rainfall.gauge'), { state: null }); return cardSmall(e) })()")
			assert.equal(empty.includes('class=\"viz'), false, '状态槽为空时不应再画图标')
			assert.equal(empty.includes('state-tag'), false)
			// 槽位仍然占位，副行和主值不受影响
			assert.match(empty, /0\.6/)
			assert.match(empty, /Daily 4\.2 mm/)
		})

		test('最大 → 橙、最小 → 蓝，跟 App 的 .orange-color / .blue-color 一致', () => {
			const up = ev("TOKENS.light.up")
			const down = ev("TOKENS.light.down")
			assert.equal(up.toLowerCase(), '#ed7839')
			assert.equal(down.toLowerCase(), '#09a8e6')
			assert.equal(ev("TOKENS.dark.up"), up, '深色下语义色不变')
			assert.equal(ev("TOKENS.dark.down"), down)

			const meta = ev("metaHTML(entryOf('outdoor.temperature'))")
			assert.match(meta, /class=\"peak-item up\"/)
			assert.match(meta, /class=\"peak-item down\"/)
			assert.match(meta, /class=\"delta up\"/, '上升的变化量走橙色语义')
			assert.equal(meta.includes('delta down'), false, '温度当日是上升，不该出现蓝色那支')

			// 下降方向：换一条数据确认映射到 down
			const downMeta = ev("metaHTML(Object.assign({}, entryOf('indoor.temperature')))")
			assert.match(downMeta, /class=\"delta down\"/)

			const vars = JSON.parse(ev("JSON.stringify(varsFor('small', 'light', 'outdoor.temperature'))"))
			assert.equal(vars.up, '#ed7839')
			assert.equal(vars.down, '#09a8e6')
		})

		test('CO₂ 浓度：没有变化量，只有最大 / 最小', () => {
			const parsed = JSON.parse(ev("JSON.stringify({ delta: !!entryOf('co2.level').delta, max: entryOf('co2.level').peak.max.value, min: entryOf('co2.level').peak.min.value })"))
			assert.equal(parsed.delta, false, '浓度不应有变化量')
			assert.equal(parsed.max, '940')
			assert.equal(parsed.min, '512')
			const meta = ev("metaHTML(entryOf('co2.level'))")
			assert.equal(meta.includes('delta'), false, 'meta 行里不该出现变化量')
			assert.equal((meta.match(/class=\"mi\"/g) || []).length, 2, '最大 / 最小两个图标')
		})

		test('CO₂ 分两类：室内浓度 / CO₂+PM 的 AQI 组合', () => {
			const level = small('co2.level')
			assert.match(level, /612/)
			assert.match(level, /24h avg 588/, '浓度维度的副行是 24h 平均（跟 dashboard 布局一致）')

			const aqi = small('co2.aqi')
			assert.match(aqi, /42/)
			assert.match(aqi, /AQI/)
			assert.match(aqi, /PM2\.5 8/, 'AQI 组合的附带项是 PM2.5 浓度')

			// 两类的读数行各算各的
			const lRows = JSON.parse(ev("JSON.stringify(entryOf('co2.level').rows.map(r => r.label))"))
			const aRows = JSON.parse(ev("JSON.stringify(entryOf('co2.aqi').rows.map(r => r.label))"))
			assert.notDeepEqual(lRows, aRows)
		})

		test('降雨状态只在数据里有时出现（压电维度同样）', () => {
			const piezo = ev("cardSmall(entryOf('rainfall.piezo'))")
			assert.match(piezo, /Raining/)
			assert.match(piezo, /Daily 3\.8 mm/)
		})

		test('风向跟着风速走，不重复印两遍', () => {
			const speed = small('wind.speed')
			assert.match(speed, /SE/)
			assert.match(speed, /Gust/)
			assert.equal((speed.match(/SE/g) || []).length, 1, '风向只应出现一次')
		})
	})

	// ---------------------------------------------------------------------
	describe('medium / large', () => {
		test('medium 有趋势曲线，脚注不重复附带项', () => {
			const md = ev("cardMedium(entryOf('wind.speed'))")
			assert.match(md, /viewBox="0 0 200 76"/)
			const foot = md.match(/<div class="foot">([\s\S]*?)<\/div>/)[1]
			assert.equal(foot.includes('Direction'), false, '附带项已含风向，脚注别再印')
		})

		test('无历史走空图分支', () => {
			ev("state.noHistory = true; state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'; render()")
			const gallery = nodes.get('gallery').innerHTML
			assert.match(gallery, /Insufficient history/)
			ev('state.noHistory = false; render()')
			assert.equal(nodes.get('gallery').innerHTML.includes('Insufficient history'), false)
		})

		test('large：hero 用突出项，其余模块各占一个位子', () => {
			ev("state.modules = ['outdoor','indoor','wind','pressure']; state.largeHero = ''; state.parameter = 'wind.gust'; render()")
			const lg = ev('cardLarge()')
			// hero 是 wind，且用的是突出项（阵风 26.3）而不是第一条读数（14.8）
			assert.match(lg, /class="tile hero well"[^>]*data-module="wind"/)
			assert.match(lg, /26\.3/)
			// 其余三个模块都在（outdoor 会落到 duo，pressure 落到 strip）
			;['OUTDOOR', 'INDOOR', 'PRESSURE'].forEach((k) => assert.match(lg, new RegExp(k)))
			assert.match(lg, /zone-duo/)
			ev("state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'")
		})

		test('无历史走空图分支', () => {
			ev("state.noHistory = true; state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'; render()")
			const gallery = nodes.get('gallery').innerHTML
			assert.match(gallery, /Insufficient history/)
			ev('state.noHistory = false; render()')
			assert.equal(nodes.get('gallery').innerHTML.includes('Insufficient history'), false)
		})

	})

	// ---------------------------------------------------------------------
	describe('large 的组合与布局（planLarge 纯函数）', () => {
		const planFor = (keys, heroKey) => {
			ev(`state.modules = ${JSON.stringify(keys)}; state.largeHero = '${heroKey || ''}'; state.parameter = state.modules[0] + '.' + MODULES.find(m => m.key === state.modules[0]).readings[0].key`)
			return JSON.parse(ev(`(() => { const keys = state.modules; const heroKey = heroModuleKey(); const ordered = [entryForModule(MODULES.find(m => m.key === heroKey))].concat(keys.filter(k => k !== heroKey).map(k => entryForModule(MODULES.find(m => m.key === k)))); return JSON.stringify(planLarge(ordered)) })()`))
		}

		test('所有模块同一种瓦片（没有紧凑区），列数只由高度预算决定', () => {
			const p = planFor(['outdoor', 'pressure', 'rainfall', 'wind', 'lightning', 'battery'], 'outdoor')
			assert.deepEqual(p.nList.map(e => e.moduleKey), ['pressure', 'rainfall', 'wind', 'lightning', 'battery'])
			assert.equal(p.cList, undefined, '不该再有紧凑区')
			assert.ok([2, 3].includes(p.normalCols))
		})

		test('高度预算永不超支（2/4/6/8/10 个模块）', () => {
			for (const n of [2, 4, 6, 8, 10]) {
				const keys = JSON.parse(ev(`JSON.stringify(ALL_MODULE_KEYS.slice(0, ${n}))`))
				const p = planFor(keys, '')
				assert.ok(p.total <= p.budget, `n=${n} 总高 ${p.total} > 预算 ${p.budget}`)
				assert.ok(p.heroH >= 88, `n=${n} hero 只有 ${p.heroH}`)
				if (p.mode === 'pair'){
					assert.equal(p.normalH, 0, 'pair 模式没有瓦片')
					assert.ok(p.heroH * 2 + 6 <= p.budget, '两块等分要放得下')
				} else {
					assert.ok(p.normalH >= 48, `n=${n} 2-up 行高 ${p.normalH}`)
				}  // 48 是实测能放下的底线
			}
		})

		test('hero 永远吃剩余：模块越少 hero 越高', () => {
			const a = planFor(JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.slice(0, 3))')), '')
			const b = planFor(JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.slice(0, 8))')), '')
			assert.ok(a.heroH > b.heroH, `3 个模块 hero ${a.heroH} 应高于 8 个模块的 ${b.heroH}`)
			assert.ok(a.heroRows >= b.heroRows, 'hero 高的时候展开更多行')
		})

		test('2 列装不下自动换 3 列', () => {
			const wide = planFor(JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.slice(0, 10))')), '')
			assert.ok([2, 3].includes(wide.normalCols))
			assert.ok(wide.normalCols === 3, '10 个模块应退化到 3 列')
		})

		test('2 个模块走等分两块；3 个以上 hero 封顶半卡', () => {
			const two = planFor(JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.slice(0, 2))')), '')
			assert.equal(two.mode, 'pair')
			assert.equal(two.nList.length, 0)

			const three = planFor(JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.slice(0, 3))')), '')
			assert.equal(three.mode, 'hero')
			assert.ok(three.heroH <= Math.floor(three.budget / 2) + 1, `hero ${three.heroH} 超过半卡`)

			ev("state.modules = ['outdoor','indoor']; state.largeHero=''; render()")
			const card = ev('cardLarge()')
			assert.equal((card.match(/class="tile hero/g) || []).length, 2, '两块都是 medium 形态')
			assert.equal(card.includes('lg-foot'), false, '页脚已去掉')
			ev("state.modules = DEFAULT_MODULE_KEYS.slice(); render()")
		})

		test('容量按预算动态算：10 个模块全能装下（含雷电/电池）', () => {
			const keys = JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS)'))
			const p = planFor(keys, '')
			assert.equal(p.shown.length, keys.length, '10 个模块应该全放得下')
			assert.equal(p.hidden, 0)
			ev("state.modules = ALL_MODULE_KEYS.slice(); state.largeHero=''; render()")
			const lg = ev('cardLarge()')
			assert.equal(lg.includes('more'), false)
			assert.match(lg, /data-module="lightning"/, '雷电要在 large 里')
			assert.match(lg, /data-module="battery"/)
		})

		test('真要放不下时才折叠末尾模块并标 +N', () => {
			const many = JSON.parse(ev('JSON.stringify(ALL_MODULE_KEYS.concat(ALL_MODULE_KEYS.slice(0, 8)))'))
			const p = planFor(many, '')
			assert.ok(p.shown.length < many.length, '超量时应折叠')
			assert.ok(p.hidden > 0)
			assert.ok(p.total <= p.budget)
		})

		test('hero 由 largeHero 决定，跟 small 的突出项解耦', () => {
			ev("state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'; state.largeHero = 'wind'")
			assert.equal(ev('heroModuleKey()'), 'wind')
			ev("state.largeHero = 'co2'")
			assert.equal(ev('heroModuleKey()'), 'co2')
			ev("state.largeHero = 'not-a-module'")
			assert.equal(ev('heroModuleKey()'), 'outdoor', '非法值退回突出项所属模块')
			ev("state.largeHero = ''")
		})
	})

	// ---------------------------------------------------------------------
	describe('token 纪律', () => {
		test('样式里引用的变量都有产出（varsFor 或 :root）', () => {
			const referenced = [...new Set([...style.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
			const produced = new Set()
			for (const family of ['small', 'medium', 'large']) {
				const keys = JSON.parse(ev(`JSON.stringify(Object.keys(varsFor('${family}', 'light', 'outdoor.temperature')))`))
				keys.forEach((k) => produced.add('--' + k))
			}
			const rootVars = new Set([...style.matchAll(/(--[\w-]+):/g)].map((m) => m[1]))
			const inline = ['--bearing', '--fill']
			const missing = referenced.filter((v) => !produced.has(v) && !rootVars.has(v) && !inline.includes(v))
			assert.deepEqual(missing, [], '悬空变量: ' + missing.join(','))
		})

		test('token 值全部为偶数（奇数会落到半像素）', () => {
			const bad = JSON.parse(ev(`JSON.stringify((() => {
				const out = []
				const walk = (o, pre) => Object.entries(o).forEach(([k, v]) => {
					if (typeof v === 'number') { if (v % 2 !== 0) out.push(pre + k + '=' + v) }
					else if (v && typeof v === 'object') walk(v, pre + k + '.')
				})
				walk(TYPE, 'TYPE.')
				walk(SHAPE, 'SHAPE.')
				return out
			})())`))
			assert.deepEqual(bad, [], '奇数 token: ' + bad.join(', '))
		})

		test('块级覆盖 --accent：每个瓦片/hero 用自己的槽位色', () => {
			const cases = [
				['outdoor.temperature', 'temp'],
				['wind.speed', 'wind'],
				['rainfall.gauge', 'water'],
				['pressure.relative', 'pressure'],
				['solar.radiation', 'sun'],
				['lightning.strikes', 'sun']
			]
			for (const [uid, slot] of cases) {
				const html = ev(`tileHTML(entryOf('${uid}'), 2, 2, 88)`)
				assert.ok(html.includes('--accent:var(--' + slot + ')'), uid + ' 应该覆盖成 --' + slot)
			}
			// 闪电不再跟着 hero 的红色走
			const bolt = ev("tileHTML(entryOf('lightning.strikes'), 2, 2, 88)")
			assert.equal(bolt.includes('--accent:var(--temp)'), false)
		})

		test('每个模块的标题色各自独立（large 里一格一色）', () => {
			const vars = JSON.parse(ev("JSON.stringify(varsFor('large', 'light', 'outdoor.temperature'))"))
			for (const k of ['temp', 'water', 'wind', 'pressure', 'sun']) {
				assert.match(vars[k] || '', /^#[0-9a-fA-F]{6}$/, k + ' 应该是色值，实际 ' + vars[k])
			}
			// 视觉部件尺寸不能占用颜色变量名（--sun 曾被尺寸覆盖成 26px）
			assert.equal(vars['sun-size'], '26px')
			assert.equal(vars['sun'], '#95600a')
		})

		test('画布区不出现硬编码颜色（色谱常量在 :root）', () => {
			const canvas = style.slice(style.indexOf('.viz{'), style.indexOf('/* primitive 探针'))
			const hexes = [...canvas.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
			assert.deepEqual([...new Set(hexes)], [], '画布区仍有硬编码色: ' + hexes.join(' '))
		})

		test('结构性间距只用刻度（--sp-* / 布局 token）', () => {
			const canvas = style.slice(style.indexOf('.viz{'), style.indexOf('/* primitive 探针'))
			const bad = []
			for (const line of canvas.split('\n')) {
				// 只看结构属性：gap / padding / margin
				const m = line.match(/\b(gap|padding|margin[a-z-]*)\s*:\s*([^;}]+)/)
				if (!m) continue
				const value = m[2].trim()
				if (/^auto$/.test(value)) continue
				// 规则：间距里只要出现字面 px 就算违规（0 除外）；var(--*) 一律放行
				if (!/(^|[\s(])\d+px/.test(value)) continue
				bad.push(line.trim().slice(0, 70))
			}
			assert.deepEqual(bad, [], '未走刻度的间距: \n' + bad.join('\n'))
		})

		test('模块头在四个形态里用同一个类名', () => {
			const head = (h) => (h.match(/class="(head|tile-top)"/) || [])[1]
			const forms = {
				small: head(ev("cardSmall(entryOf('outdoor.temperature'))")),
				medium: head(ev("cardMedium(entryOf('outdoor.temperature'))")),
				hero: head(ev("heroHTML(entryOf('outdoor.temperature'), 2, 140)")),
				tile: head(ev("tileHTML(entryOf('outdoor.temperature'), 2, 2, 90)"))
			}
			assert.deepEqual([...new Set(Object.values(forms))], ['head'], '模块头类名不一致: ' + JSON.stringify(forms))
		})

		test('设计规范文档与代码同步（BUDGET / kind 清单）', () => {
			const doc = fs.readFileSync(path.resolve(here, '..', 'native', 'ios-widget', 'DESIGN-SPEC-v4.md'), 'utf8')

			// 文档里写的可用高度必须等于代码里的预算常量
			const budgetInDoc = Number((doc.match(/BUDGET \| (\d+)px/) || [])[1])
			const budgetInCode = JSON.parse(ev("JSON.stringify(planLarge([entryForModule(MODULES[0])]))")).budget
			assert.equal(budgetInDoc, budgetInCode, `文档写 ${budgetInDoc}px，代码是 ${budgetInCode}px`)

			// 文档的视觉件清单必须覆盖代码里的所有 kind
			const kinds = JSON.parse(ev("JSON.stringify([...new Set(ENTRIES.map(e => e.visual && e.visual.kind))])"))
			const missing = kinds.filter((k) => !doc.includes('`' + k + '`'))
			assert.deepEqual(missing, [], '文档缺 kind: ' + missing.join(','))

			// 文档要提到验证入口
			assert.match(doc, /npm run test:design/)
		})

		test('数据模型自洽：图标/调色板/kind/重名', () => {
			const bad = JSON.parse(ev(`JSON.stringify((() => {
				const out = []
				const icons = Object.keys(P)
				const palette = Object.keys(TOKENS.light).filter(k => !['bg','ink','muted','well','border','up','down','danger','ok'].includes(k))
				const kinds = ['glyph','ring','dial','gauge','uv','bars','sun','battery']
				MODULES.forEach(m => {
					if (icons.indexOf(m.icon) < 0) out.push('图标未定义 ' + m.key + '.' + m.icon)
					const seen = []
					m.readings.forEach(r => {
						if (palette.indexOf(r.accent) < 0) out.push('强调色越界 ' + m.key + '.' + r.key)
						if (r.visual && kinds.indexOf(r.visual.kind) < 0) out.push('未知 kind ' + m.key + '.' + r.key)
						if (seen.indexOf(r.label) >= 0) out.push('读数重名 ' + m.key + '.' + r.label)
						seen.push(r.label)
					})
				})
				return out
			})())`))
			assert.deepEqual(bad, [], bad.join(' / '))
		})

		test('画布区不写死字号、不串外壳度量', () => {
			const canvas = style.slice(style.indexOf('.viz{'), style.indexOf('/* primitive 探针'))
			assert.equal(/font-size:\s*[0-9.]+px/.test(canvas), false, '画布区出现写死字号')
			assert.equal(/rpx|--ec-/.test(canvas), false, '画布区串了外壳度量')
		})

		test('三档字号差异只来自 TYPE 表', () => {
			const v = (family) => JSON.parse(ev(`JSON.stringify(varsFor('${family}', 'light', 'outdoor.temperature'))`))
			assert.equal(v('small')['t-value'], '34px')
			assert.equal(v('medium')['t-value'], '32px')
			assert.equal(v('large')['t-value'], '38px')
		})
	})

	// ---------------------------------------------------------------------
	describe('页面契约', () => {
		test('参数下拉由读数生成', () => {
			const n = ev('ENTRIES.length')
			assert.equal((nodes.get('parameter').innerHTML.match(/<option/g) || []).length, n)
		})

		test('模块勾选框由模块生成（10 项）', () => {
			assert.equal((nodes.get('metricCtl').innerHTML.match(/data-metric=/g) || []).length, 10)
		})

		test('每个突出项 × 三种尺寸都能渲染（不抛异常、不缺字段）', () => {
			const uids = JSON.parse(ev('JSON.stringify(ALL_ENTRY_KEYS)'))
			assert.ok(uids.length >= 16)
			uids.forEach((uid) => {
				assert.doesNotThrow(() => {
					ev(`cardSmall(entryOf('${uid}'))`)
					ev(`cardMedium(entryOf('${uid}'))`)
				}, uid + ' 渲染抛异常')
			})
			// 全模块开启时 large 也要能出
			assert.doesNotThrow(() => ev("state.modules = ALL_MODULE_KEYS.slice(); render()"))
			ev("state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'; render()")
		})

		test('画廊三种尺寸都在，small 一卡一读数', () => {
			ev("state.modules = DEFAULT_MODULE_KEYS.slice(); state.parameter = 'outdoor.temperature'; render()")
			const list = ev('activeEntries().length')
			assert.equal(list, DEFAULT_MODULE_COUNT())
			const gallery = nodes.get('gallery').innerHTML
			assert.match(gallery, /SMALL/)
			assert.match(gallery, /MEDIUM/)
			assert.match(gallery, /LARGE/)
			assert.equal((gallery.match(/class="card sm"/g) || []).length, list)
		})

		function DEFAULT_MODULE_COUNT() {
			return ev('DEFAULT_MODULE_KEYS.length')
		}
	})
})

<template>
	<!--
	  wp-frame 占满父容器宽度，高度按卡片宽高比撑开；
	  里面的卡片按固定设计画布绘制，再等比缩放到容器宽度。

	  为什么这么做：小组件在真机上的尺寸因机型/系统而异，把 CSS 尺寸和 pt 绑死
	  只会得到"在某些设备上刚好、在另一些上溢出"的结果。这里退一步——
	  卡片只定义一次理想比例，由容器决定最终大小，任何宽度都能放下，
	  内部比例也永远不会被拉伸变形。

	  数据全部来自 payload v4（modules → readings），本组件不做换算、不做翻译：
	  数值、单位、文案、颜色、字号、图标路径都是 App 侧算好发过来的。
	-->
	<view class="wp-frame" :style="frameStyle">
		<view class="wp-scale" :style="scaleStyle">
			<view class="wp" :class="'wp-' + family" :style="cardStyle">
				<!-- ================= small：一条突出读数 + 一个附带项 ================= -->
				<template v-if="family === 'small'">
					<view class="wp-head">
						<view class="wp-chip" :style="{ background: withAlpha(accent, 0.11) }">
							<image class="wp-chip-icon" :src="iconOf(module.icon, accent, chipIcon)" mode="aspectFit" />
						</view>
						<text class="wp-name" :style="textStyle(t.name, 600)">{{ module.label }}</text>
						<view class="wp-spacer"></view>
						<text :style="textStyle(t.caption, 400, theme.muted)">{{ payload.updatedShort }}</text>
					</view>

					<view class="wp-main">
						<view class="wp-value-col">
							<view class="wp-value">
								<text :style="valueStyle(reading.small ? t['value-sm'] : t.value)">{{ reading.value }}</text>
								<text v-if="reading.unit" class="wp-value-unit" :style="textStyle(t.unit, 500, theme.muted)">{{ reading.unit }}</text>
							</view>
							<view v-if="hasMeta(reading)" class="wp-meta-row">
								<text v-if="reading.delta && reading.delta.dir" :style="textStyle(t.foot, 400, deltaColor(reading))">
									{{ reading.delta.dir > 0 ? '▲' : '▼' }} {{ reading.delta.value }}
								</text>
								<block v-if="reading.peak && reading.peak.max">
									<image class="wp-mi" :src="iconOf('maxOut', theme.up, 8)" mode="aspectFit" />
									<text :style="textStyle(t.foot, 400, theme.up)">{{ reading.peak.max.value }}</text>
								</block>
								<block v-if="reading.peak && reading.peak.min">
									<image class="wp-mi" :src="iconOf('minOut', theme.down, 8)" mode="aspectFit" />
									<text :style="textStyle(t.foot, 400, theme.down)">{{ reading.peak.min.value }}</text>
								</block>
							</view>
						</view>
						<view class="wp-spacer"></view>
						<text v-if="reading.state" :style="textStyle(t.sub, 600, accent)">{{ reading.state }}</text>
						<image v-else-if="showVisualInSmall(reading)" :src="visualUri(reading.visual, accent, false)" :style="visualBox(reading.visual, false)" mode="aspectFit" />
					</view>

					<!-- 次要数据行：不嵌套 <text>，每个文本节点自己带字号（nvue 不继承样式，容器上挂无效） -->
					<view class="wp-foot">
						<template v-if="module.compact">
							<text :style="textStyle(t.foot, 400, theme.muted, { opacity: 0.85, marginRight: '4px' })">{{ module.compactLabel }}</text>
							<text :style="textStyle(t.foot, 400, theme.muted)">{{ module.compact }}</text>
						</template>
						<text v-else-if="reading.attachText" :style="textStyle(t.foot, 400, theme.muted)">{{ reading.attachText }}</text>
						<template v-else-if="reading.attach">
							<text :style="textStyle(t.foot, 400, theme.muted, { opacity: 0.85, marginRight: '4px' })">{{ reading.attach.label }}</text>
							<text :style="textStyle(t.foot, 400, theme.muted)">{{ rowText(reading.attach) }}</text>
						</template>
						<view class="wp-spacer"></view>
					</view>
				</template>

				<!-- ================= medium：同一条读数 + 它的趋势 ================= -->
				<template v-else-if="family === 'medium'">
					<view class="wp-head">
						<view class="wp-chip" :style="{ background: withAlpha(accent, 0.11) }">
							<image class="wp-chip-icon" :src="iconOf(module.icon, accent, chipIcon)" mode="aspectFit" />
						</view>
						<text class="wp-name" :style="textStyle(t.name, 600)">{{ module.label }}</text>
						<view class="wp-spacer"></view>
						<text :style="textStyle(t.caption, 400, theme.muted)">{{ payload.updatedShort }}</text>
					</view>

					<view class="wp-trend">
						<view class="wp-current">
							<view class="wp-value">
								<text :style="valueStyle(reading.small ? t['value-sm'] : t.value)">{{ reading.value }}</text>
								<text v-if="reading.unit" class="wp-value-unit" :style="textStyle(t.unit, 500, theme.muted)">{{ reading.unit }}</text>
							</view>
							<view v-if="hasMeta(reading)" class="wp-meta-row">
								<text v-if="reading.delta && reading.delta.dir" :style="textStyle(t.state, 400, deltaColor(reading))">
									{{ reading.delta.dir > 0 ? '▲' : '▼' }} {{ reading.delta.value }}
								</text>
								<block v-if="reading.peak && reading.peak.max">
									<image class="wp-mi" :src="iconOf('maxOut', theme.up, 8)" mode="aspectFit" />
									<text :style="textStyle(t.state, 400, theme.up)">{{ reading.peak.max.value }}</text>
								</block>
								<block v-if="reading.peak && reading.peak.min">
									<image class="wp-mi" :src="iconOf('minOut', theme.down, 8)" mode="aspectFit" />
									<text :style="textStyle(t.state, 400, theme.down)">{{ reading.peak.min.value }}</text>
								</block>
							</view>
							<!-- 附带项只在底栏画一次（见下面的 .wp-foot）：这里再画一遍，
							     CO₂ 这类有 attachText 的读数就会在 medium 里出现两条一样的 -->
						</view>

						<view class="wp-chartbox">
							<image v-if="chartUri" class="wp-chart" :src="chartUri" mode="scaleToFill" />
							<view v-else class="wp-chart-empty" :style="{ background: theme.well, borderRadius: wellRadius + 'px' }">
								<image class="wp-empty-icon" :src="iconOf('chart', theme.muted, 22)" mode="aspectFit" />
								<text :style="textStyle(t.state, 600, theme.muted)">{{ emptyTitle }}</text>
								<text :style="textStyle(t.state, 400, theme.muted)">{{ emptyBody }}</text>
							</view>
							<view class="wp-axis">
								<text v-for="(label, i) in axisLabels" :key="i" :style="textStyle(t.axis, 400, theme.muted)">{{ label }}</text>
							</view>
						</view>
					</view>

					<!-- 次要数据与小卡同一套：摘要优先，否则 attach（左），右侧留 Last 24h -->
					<view class="wp-foot">
						<template v-if="module.compact">
							<text :style="textStyle(t.foot, 400, theme.muted, { opacity: 0.85, marginRight: '4px' })">{{ module.compactLabel }}</text>
							<text :style="textStyle(t.foot, 400, theme.muted)">{{ module.compact }}</text>
						</template>
						<text v-else-if="reading.attachText" :style="textStyle(t.foot, 400, theme.muted)">{{ reading.attachText }}</text>
						<template v-else-if="reading.attach">
							<text :style="textStyle(t.foot, 400, theme.muted, { opacity: 0.85, marginRight: '4px' })">{{ reading.attach.label }}</text>
							<text :style="textStyle(t.foot, 400, theme.muted)">{{ rowText(reading.attach) }}</text>
						</template>
						<view class="wp-spacer"></view>
						<text :style="textStyle(t.foot, 400, theme.muted)">{{ footerLeft }}</text>
					</view>
				</template>

				<!-- ================= large：hero + 瓦片 ================= -->
				<template v-else>
					<view class="wp-station">
						<text :style="textStyle(t.brand, 750, theme.ink)">{{ payload.brand }}</text>
						<text class="wp-station-name" :style="textStyle(t.station, 400, theme.ink)">{{ payload.station }}</text>
						<view class="wp-spacer"></view>
						<text :style="textStyle(t.state, 400, theme.muted)">{{ payload.updatedShort }}</text>
					</view>

					<view class="wp-zones">
						<!-- hero（pair 模式下两块都是 hero） -->
						<view v-for="item in heroEntries" :key="'hero-' + item.module.key" class="wp-tile wp-hero" :style="heroStyle(item)">
							<view class="wp-head">
								<view class="wp-chip" :style="{ background: withAlpha(accentOf(item), 0.11) }">
									<image class="wp-chip-icon" :src="iconOf(item.module.icon, accentOf(item), chipIcon)" mode="aspectFit" />
								</view>
								<text class="wp-name" :style="textStyle(t.name, 600)">{{ item.module.label }}</text>
								<image v-if="item.reading.stateSlot && item.reading.state" :src="iconOf('rainfall', accentOf(item), glyphBig)" :style="iconBox(glyphBig)" mode="aspectFit" />
								<text v-else-if="item.reading.state" :style="textStyle(t.state, 600, accentOf(item))">{{ item.reading.state }}</text>
								<view class="wp-spacer"></view>
								<text :style="textStyle(t.caption, 400, theme.muted)">{{ payload.updatedShort }}</text>
							</view>

							<view class="wp-trend">
								<view class="wp-current">
									<view class="wp-value">
										<text :style="valueStyle(heroValueSize(item), theme.ink)">{{ item.reading.value }}</text>
										<text v-if="item.reading.unit" class="wp-value-unit" :style="textStyle(t.unit, 500, theme.muted)">{{ item.reading.unit }}</text>
									</view>
									<view v-if="hasMeta(item.reading)" class="wp-meta-row">
										<text v-if="item.reading.delta && item.reading.delta.dir" :style="textStyle(t.detail, 400, deltaColor(item.reading))">
											{{ item.reading.delta.dir > 0 ? '▲' : '▼' }} {{ item.reading.delta.value }}
										</text>
										<block v-if="item.reading.peak && item.reading.peak.max">
											<image class="wp-mi" :src="iconOf('maxOut', theme.up, 8)" mode="aspectFit" />
											<text :style="textStyle(t.detail, 400, theme.up)">{{ item.reading.peak.max.value }}</text>
										</block>
										<block v-if="item.reading.peak && item.reading.peak.min">
											<image class="wp-mi" :src="iconOf('minOut', theme.down, 8)" mode="aspectFit" />
											<text :style="textStyle(t.detail, 400, theme.down)">{{ item.reading.peak.min.value }}</text>
										</block>
									</view>
									<view v-if="heroLines(item).length" class="wp-rows">
										<view v-for="(row, i) in heroLines(item)" :key="i" class="wp-row-line">
											<text class="wp-row-label" :style="textStyle(t.detail, 400, theme.muted)">{{ row.label }}</text>
											<text :style="textStyle(t.detail, 600, theme.ink)">
												{{ row.value }}<text v-if="row.unit" :style="{ fontWeight: 400, color: theme.muted }"> {{ row.unit }}</text>
											</text>
										</view>
									</view>
								</view>
								<view class="wp-chartbox">
									<image v-if="chartFor(item)" class="wp-chart" :src="chartFor(item)" mode="scaleToFill" />
									<view v-else class="wp-chart-empty" :style="{ background: theme.well, borderRadius: wellRadius + 'px' }">
										<image class="wp-empty-icon" :src="iconOf('chart', theme.muted, 16)" mode="aspectFit" />
										<text :style="textStyle(t.detail, 400, theme.muted)">{{ emptyTitle }}</text>
									</view>
									<!-- 时间轴：与 medium 同一套三段刻度（原生 large hero 也有，之前预览漏了） -->
									<view class="wp-axis">
										<text v-for="(label, i) in axisLabels" :key="i" :style="textStyle(t.axis, 400, theme.muted)">{{ label }}</text>
									</view>
								</view>
							</view>
						</view>

						<!-- 瓦片网格 -->
						<view v-if="tiles.length" class="wp-grid">
							<view v-for="(item, i) in tiles" :key="item.module.key" class="wp-tile" :class="{ 'wp-tile-edge': (i + 1) % tileCols === 0 }" :style="tileStyle(item)">
								<view class="wp-head wp-tile-head">
									<text class="wp-mtitle" :style="textStyle(t.title, 400, accentOf(item))">{{ item.module.label }}</text>
									<view class="wp-spacer"></view>
									<image v-if="item.reading.stateSlot && item.reading.state" :src="iconOf('rainfall', accentOf(item), glyphSmall)" :style="iconBox(glyphSmall)" mode="aspectFit" />
									<text v-else-if="item.reading.state" :style="textStyle(t.state, 600, accentOf(item))">{{ item.reading.state }}</text>
									<image v-else-if="showVisualInTile(item.reading)" :src="visualUri(item.reading.visual, accentOf(item), true)" :style="visualBox(item.reading.visual, true)" mode="aspectFit" />
								</view>

								<view class="wp-value wp-tile-value">
									<text :style="valueStyle(t.lower, theme.ink)">{{ item.reading.value }}</text>
									<text v-if="item.reading.unit" class="wp-value-unit" :style="textStyle(t.detail, 500, theme.muted)">{{ item.reading.unit }}</text>
									<text v-if="tileDetail(item)" class="wp-detail-in" :style="textStyle(t.detail, 400, theme.muted)">{{ tileDetail(item) }}</text>
								</view>

								<view v-if="tileLines(item).length" class="wp-rows">
									<view v-for="(row, i) in tileLines(item)" :key="i" class="wp-row-line">
										<text class="wp-row-label" :style="textStyle(t.detail, 400, theme.muted)">{{ row.label }}</text>
										<text :style="textStyle(t.detail, 600, theme.ink)">
											{{ row.value }}<text v-if="row.unit" :style="{ fontWeight: 400, color: theme.muted }"> {{ row.unit }}</text>
										</text>
									</view>
								</view>
							</view>
						</view>
					</view>
				</template>
			</view>
		</view>
	</view>
</template>

<script>
	/*
	 * payload v4 的纯展示层。
	 *
	 * 分工：颜色来自 payload.theme，字号来自 payload.typography（三档已归一），
	 * 形状与间距来自 payload.shape，图标是 payload.icons 里的 SVG path。
	 * 这里只决定「谁放哪」，不决定「多大多粗什么色」——
	 * 与 native/ios-widget/EcowittWidget/ + utssdk/app-android/ 的三套布局一一对应，
	 * 改了一边记得改另一边（Design-SPEC-v4 第 9 节）。
	 */

	import {
		WIDGET_CANVAS,
		TOKENS,
		DETAIL
	} from '@/common/js/widgetDesign.js'
	import {
		planLarge
	} from '@/common/js/widgetPlan.js'

	const svgUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg)

	/** 三档字号的兜底值：payload 缺 typography 时也不至于塌掉 */
	const TYPE_FALLBACK = {
		small: {
			name: 10,
			value: 34,
			'value-sm': 28,
			unit: 10,
			sub: 10,
			foot: 8,
			caption: 10,
			axis: 10,
			state: 10
		},
		medium: {
			name: 10,
			value: 32,
			'value-sm': 26,
			unit: 10,
			sub: 8,
			foot: 8,
			caption: 8,
			axis: 8,
			state: 8
		},
		large: {
			name: 10,
			value: 38,
			'value-sm': 22,
			unit: 8,
			sub: 14,
			foot: 8,
			caption: 8,
			axis: 8,
			state: 8,
			brand: 12,
			station: 10,
			title: 10,
			side: 14,
			well: 22,
			baro: 22,
			lower: 16,
			detail: 8,
			tick: 6
		}
	}

	const SHAPE_FALLBACK = {
		cardRadius: 24,
		cardPadding: 12,
		cardGap: 4,
		cardGapLarge: 6,
		wellRadius: 14,
		chipSize: 22,
		chipRadius: 6,
		viz: {
			compass: 48,
			ring: 34,
			gauge: 58,
			uvbar: 64,
			barsH: 22,
			sun: 26,
			glyphW: 26,
			glyphH: 26,
			batteryH: 14
		},
		vizXs: {
			compass: 18,
			ring: 20,
			gauge: 24,
			uvbar: 40,
			barsH: 14,
			sun: 16,
			glyphW: 14,
			glyphH: 14,
			batteryH: 12
		},
		layout: {
			tilePad: 8,
			tilePadTight: 6,
			lineGap: 2,
			blockGap: 4,
			ringInset: 4,
			cellW: 4,
			cellGap: 2,
			ringIco: 14,
			ringIcoXs: 8
		},
		uvScale: ['#19996f', '#d7a212', '#db7821', '#d34a57', '#9751b7']
	}

	export default {
		name: 'ecowitt-widget-preview',
		props: {
			payload: {
				type: Object,
				default: () => ({})
			},
			family: {
				type: String,
				default: 'medium' // small | medium | large
			}
		},
		data() {
			return {
				scale: 1
			}
		},
		computed: {
			canvas() {
				return WIDGET_CANVAS[this.family] || WIDGET_CANVAS.medium
			},
			appearance() {
				return this.payload.appearance === 'light' ? 'light' : 'dark'
			},
			theme() {
				return Object.assign({}, TOKENS[this.appearance], this.payload.theme || {})
			},
			shape() {
				const s = this.payload.shape || {}
				return {
					...SHAPE_FALLBACK,
					...s,
					viz: {
						...SHAPE_FALLBACK.viz,
						...(s.viz || {})
					},
					vizXs: {
						...SHAPE_FALLBACK.vizXs,
						...(s.vizXs || {})
					},
					layout: {
						...SHAPE_FALLBACK.layout,
						...(s.layout || {})
					},
					// 明细裁剪策略：payload 缺省时按契约的「全关」处理
					detail: {
						...DETAIL,
						...(s.detail || {})
					},
					uvScale: (s.uvScale && s.uvScale.length ? s.uvScale : SHAPE_FALLBACK.uvScale)
				}
			},
			/** 明细裁剪上限（hero 行数 / 瓦片行数 / 瓦片同行摘要），0 或 false = 不显示 */
			detailCfg() {
				const d = this.shape.detail || DETAIL
				return {
					heroRows: Math.max(0, parseInt(d.heroRows, 10) || 0),
					tileRows: Math.max(0, parseInt(d.tileRows, 10) || 0),
					inline: !!d.inline
				}
			},
			/** 归一后的字号表；缺的键用兜底值补齐 */
			t() {
				const family = this.family === 'large' ? 'large' : this.family === 'small' ? 'small' : 'medium'
				const given = (this.payload.typography || {})[family] || {}
				return {
					...TYPE_FALLBACK[family],
					...given
				}
			},
			icons() {
				return this.payload.icons || {}
			},
			cardRadius() {
				return this.shape.cardRadius
			},
			wellRadius() {
				return this.shape.wellRadius
			},
			chipIcon() {
				return Math.round(this.shape.chipSize * 0.6)
			},
			glyphBig() {
				return this.shape.viz.glyphW
			},
			glyphSmall() {
				return this.shape.vizXs.glyphW
			},
			axisLabels() {
				const axis = this.payload.axis || []
				return axis.length ? axis : ['', '', '']
			},
			footerLeft() {
				return (this.payload.footer || {}).left || ''
			},
			emptyTitle() {
				return (this.payload.labels || {}).noHistory || 'Insufficient history'
			},
			emptyBody() {
				return (this.payload.labels || {}).noTrend || ''
			},
			modules() {
				return this.payload.modules || []
			},
			/** 当前突出项（small / medium 用）：selection.feature → 所属模块的那条读数 */
			featureEntry() {
				const uid = (this.payload.selection || {}).feature || ''
				const [moduleKey, readingKey] = String(uid).split('.')
				const hit = this.modules.find((m) => m.key === moduleKey)
				if (hit && hit.readings && hit.readings.length) {
					const reading = hit.readings.find((r) => r.key === readingKey)
					return {
						module: hit,
						reading: reading || hit.readings[0]
					}
				}
				const first = this.modules[0]
				if (!first || !first.readings || !first.readings.length) {
					return {
						module: this.emptyModule(),
						reading: this.emptyReading()
					}
				}
				return {
					module: first,
					reading: first.readings[0]
				}
			},
			module() {
				return this.featureEntry.module
			},
			reading() {
				return this.featureEntry.reading
			},
			accent() {
				return this.accentOf(this.featureEntry)
			},
			/** large：hero 在最前，其余保持模块数组原顺序 */
			orderedEntries() {
				const entries = this.modules.map((m) => ({
					module: m,
					reading: this.readingForModule(m)
				}))
				const heroKey = (this.payload.selection || {}).hero || ''
				const index = entries.findIndex((e) => e.module.key === heroKey)
				if (index > 0) {
					const [hero] = entries.splice(index, 1)
					entries.unshift(hero)
				}
				return entries
			},
			plan() {
				if (this.family !== 'large') return planLarge(0)
				const own = (this.payload.shape || {}).plan || {}
				return planLarge(this.orderedEntries.length, {
					budget: own.budget,
					zoneGap: this.shape.cardGapLarge,
					heroCap: own.heroCap,
					tileMin: own.tileMin,
					heroMin: own.heroMin
				})
			},
			shownEntries() {
				return this.orderedEntries.slice(0, Math.max(1, this.plan.shown))
			},
			heroEntries() {
				if (this.plan.mode === 'pair') return this.shownEntries
				return this.shownEntries.slice(0, 1)
			},
			tiles() {
				if (this.plan.mode === 'pair') return []
				return this.shownEntries.slice(1)
			},
			tileCols() {
				return Math.max(1, this.plan.cols || 2)
			},
			/** medium 底栏左边：成对摘要 > 未被附带项占用的第一条明细 */
			/** 趋势曲线（与设计稿 path() 同规则：单调三次插值 + 末点圆点） */
			chartUri() {
				return this.chartFor(this.featureEntry)
			},
			frameStyle() {
				const ratio = (this.canvas.h / this.canvas.w) * 100
				return 'padding-bottom:' + ratio.toFixed(4) + '%;'
			},
			scaleStyle() {
				return 'transform:scale(' + this.scale + ');transform-origin:top left;'
			},
			cardStyle() {
				const pad = this.shape.cardPadding
				return (
					'width:' + this.canvas.w + 'px;height:' + this.canvas.h + 'px;' +
					'padding:' + pad + 'px;' +
					'border-radius:' + this.shape.cardRadius + 'px;' +
					'background:' + this.theme.bg + ';' +
					'color:' + this.theme.ink + ';'
				)
			}
		},
		mounted() {
			this.measure()
		},
		watch: {
			family() {
				this.$nextTick(() => this.measure())
			}
		},
		methods: {
			// ---------- 取值 ----------
			emptyModule() {
				return {
					key: '',
					label: '',
					icon: 'temperature',
					accent: 'temp',
					compact: '',
					compactLabel: '',
					rows: []
				}
			},
			emptyReading() {
				return {
					key: '',
					label: '',
					value: '—',
					unit: '',
					accent: 'water',
					lines: []
				}
			},
			readingForModule(module) {
				const uid = (this.payload.selection || {}).feature || ''
				if (String(uid).indexOf(module.key + '.') === 0) {
					const key = String(uid).slice(module.key.length + 1)
					const hit = (module.readings || []).find((r) => r.key === key)
					if (hit) return hit
				}
				return (module.readings || [])[0] || this.emptyReading()
			},
			accentOf(entry) {
				return this.theme[(entry.reading && entry.reading.accent) || entry.module.accent] || this.theme.water
			},
			rowText(row) {
				if (!row) return ''
				return row.value + (row.unit ? ' ' + row.unit : '')
			},
			hasMeta(reading) {
				const hasDelta = !!(reading.delta && reading.delta.dir)
				const hasPeak = !!(reading.peak && (reading.peak.max || reading.peak.min))
				return hasDelta || hasPeak
			},
			deltaColor(reading) {
				return reading.delta && reading.delta.dir > 0 ? this.theme.up : this.theme.down
			},
			/** small 右侧：状态槽留空；签名默认不画，只有显式声明 inSmall:true 才画 */
			showVisualInSmall(reading) {
				if (!reading.visual) return false
				if (reading.stateSlot) return false
				return reading.visual.inSmall === true
			},
			showVisualInTile(reading) {
				if (!reading.visual) return false
				return reading.visual.inline !== false
			},
			/** 瓦片同行摘要，格子里放不下、或 payload 关了 inline 都不放 */
			tileDetail(item) {
				if (!this.detailCfg.inline) return ''
				if (this.plan.tileH && this.plan.tileH < 70) return ''
				if (item.module.compact) return item.module.compact
				const row = (item.reading.lines || [])[0]
				return row ? row.label + ' ' + row.value + (row.unit ? ' ' + row.unit : '') : ''
			},
			/** 瓦片明细行：布局放得下的行数 × detail.tileRows 取小（plan.tileRows 含数值行） */
			tileLines(item) {
				const rows = item.reading.lines || []
				const n = Math.min(Math.max(0, (this.plan.tileRows || 1) - 1), this.detailCfg.tileRows)
				return n > 0 ? rows.slice(0, n) : []
			},
			/** hero 明细行：布局放得下的行数 × detail.heroRows 取小 */
			heroLines(item) {
				const rows = item.reading.lines || []
				const n = Math.min(this.plan.heroRows || 0, this.detailCfg.heroRows)
				return n > 0 ? rows.slice(0, n) : []
			},
			heroValueSize(item) {
				const heroH = this.plan.heroH || 0
				return item.reading.small || heroH < 140 ? this.t['value-sm'] : this.t.value
			},

			// ---------- 样式 ----------
			/** 全局字号系数，与两端同源 */
			fontScale() {
				const v = Number(this.payload.fontScale)
				return v > 0.5 && v <= 2 ? v : 1
			},
			/**
			 * 字号一律**逐节点**挂 inline：nvue 不继承样式；H5 下 <text> 里再嵌 <text>/纯文本时
			 * 外层 style 也可能被丢 → 挂容器上实测无效。
			 * 返回**对象**而不是字符串 —— 字符串形式在部分基座里会被整体丢掉，表现就是
			 * 「font-size 没生效、掉回浏览器默认 16px、看着好大」。
			 * extra 合并额外声明（opacity / marginRight…），不要再用字符串拼接。
			 */
			textStyle(size, weight, color, extra) {
				return Object.assign(
					{
						fontSize: size * this.fontScale() + 'px',
						fontWeight: weight || 400,
						color: color || this.theme.ink
					},
					extra || {}
				)
			},
			valueStyle(size, color, extra) {
				return Object.assign(
					{
						fontSize: size * this.fontScale() + 'px',
						fontWeight: 600,
						letterSpacing: '-0.5px',
						lineHeight: 1.3,
						color: color || this.theme.ink
					},
					extra || {}
				)
			},
			iconBox(size) {
				return 'width:' + size + 'px;height:' + size + 'px;flex-shrink:0;'
			},
			withAlpha(hex, alpha) {
				const h = String(hex || '#000000').replace('#', '')
				if (h.length !== 6) return hex
				const r = parseInt(h.slice(0, 2), 16)
				const g = parseInt(h.slice(2, 4), 16)
				const b = parseInt(h.slice(4, 6), 16)
				return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
			},

			/** hero 块：well 底 + 自己的 accent padding */
			heroStyle(item) {
				const pad = this.plan.heroH < 120 ?
					this.sp(4) + 'px ' + this.sp(5) + 'px' :
					this.sp(5) + 'px ' + this.sp(6) + 'px'
				return (
					'background:' + this.theme.well + ';' +
					'border-radius:' + this.wellRadius + 'px;' +
					'padding:' + pad + ';' +
					'height:' + (this.plan.heroH || 0) + 'px;' +
					'margin-bottom:' + this.shape.cardGapLarge + 'px;'
				)
			},
			/** 瓦片：列宽按画布算死，最后一行不满也是等宽 */
			tileStyle(item) {
				const gap = this.shape.cardGapLarge
				const cols = this.tileCols
				const content = this.canvas.w - this.shape.cardPadding * 2
				const width = (content - (cols - 1) * gap) / cols
				const tight = this.plan.tileH < 70
				const pad = tight ? this.shape.layout.tilePadTight : this.shape.layout.tilePad
				return (
					'width:' + width.toFixed(2) + 'px;' +
					'height:' + (this.plan.tileH || 0) + 'px;' +
					'padding:' + pad + 'px;' +
					'margin-right:' + gap + 'px;' +
					'margin-bottom:' + gap + 'px;' +
					'background:' + this.theme.well + ';' +
					'border-radius:' + this.wellRadius + 'px;'
				)
			},
			sp(step) {
				return step * 2
			},

			// ---------- SVG ----------
			iconOf(name, color, size) {
				const d = this.icons[name] || this.icons.temperature || ''
				return svgUri(
					'<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' +
					'<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" ' +
					'stroke-linecap="round" stroke-linejoin="round"/></svg>'
				)
			},
			/** 视觉件尺寸（默认档 / xs 档），visualBox 与 visualUri 共用 */
			visualSize(visual, xs) {
				const viz = xs ? this.shape.vizXs : this.shape.viz
				const layout = this.shape.layout
				const kind = visual.kind
				if (kind === 'ring') return {
					w: viz.ring,
					h: viz.ring
				}
				if (kind === 'dial') return {
					w: viz.compass,
					h: viz.compass
				}
				if (kind === 'gauge') return {
					w: viz.gauge,
					h: viz.gauge / 2 + 2
				}
				if (kind === 'uv') return {
					w: viz.uvbar,
					h: 6
				}
				if (kind === 'sun') return {
					w: viz.sun,
					h: viz.sun
				}
				if (kind === 'bars') {
					const n = Math.min(7, (visual.values || []).length)
					return {
						w: n ? n * 4 + (n - 1) * 2 : 0,
						h: viz.barsH
					}
				}
				if (kind === 'battery') {
					const cells = 5
					const bodyW = cells * layout.cellW + (cells - 1) * layout.cellGap + 4
					return {
						w: bodyW + 4,
						h: viz.batteryH
					}
				}
				return {
					w: viz.glyphW,
					h: viz.glyphH
				}
			},
			visualBox(visual, xs) {
				const size = this.visualSize(visual, xs)
				return 'width:' + size.w + 'px;height:' + size.h + 'px;flex-shrink:0;'
			},
			visualUri(visual, accent, xs) {
				if (!visual || !visual.kind) return ''
				const viz = xs ? this.shape.vizXs : this.shape.viz
				const kind = visual.kind
				const iconD = this.icons[visual.icon || (kind === 'sun' ? 'sun' : kind === 'dial' ? 'arrow' : 'temperature')] || ''
				const well = this.theme.well
				let svg = ''
				let w = viz.glyphW
				let h = viz.glyphH

				if (kind === 'glyph') {
					return this.iconOf(visual.icon || 'temperature', accent, viz.glyphW)
				}

				if (kind === 'ring') {
					w = h = viz.ring
					const inset = xs ? 2 : this.shape.layout.ringInset
					const r = 50 - (inset / w) * 100 / 2
					const circ = 2 * Math.PI * r
					const filled = Math.max(0, Math.min(100, Number(visual.fill) || 0))
					const icoSize = xs ? this.shape.layout.ringIcoXs : this.shape.layout.ringIco
					const scale = (icoSize / w) * 100 / 24
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 100 100">' +
						'<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + well + '" stroke-width="' + (inset / w) * 100 + '"/>' +
						'<circle cx="50" cy="50" r="' + r + '" fill="none" stroke="' + accent + '" stroke-width="' + (inset / w) * 100 + '"' +
						' stroke-dasharray="' + (circ * filled / 100) + ' ' + circ + '" transform="rotate(-90 50 50)"/>' +
						'<g transform="translate(' + (50 - 12 * scale) + ',' + (50 - 12 * scale) + ') scale(' + scale + ')">' +
						'<path d="' + iconD + '" fill="none" stroke="' + accent + '" stroke-width="4" ' +
						'stroke-linecap="round" stroke-linejoin="round"/></g></svg>'
					return svgUri(svg)
				}

				if (kind === 'dial') {
					w = h = viz.compass
					const tick = this.t.tick || 6
					const marks = xs ?
						'' :
						'<text x="50" y="9" font-size="' + (tick * 100 / w) + '" fill="' + this.theme.muted + '" text-anchor="middle">N</text>' +
						'<text x="50" y="98" font-size="' + (tick * 100 / w) + '" fill="' + this.theme.muted + '" text-anchor="middle">S</text>' +
						'<text x="8" y="54" font-size="' + (tick * 100 / w) + '" fill="' + this.theme.muted + '" text-anchor="middle">W</text>' +
						'<text x="92" y="54" font-size="' + (tick * 100 / w) + '" fill="' + this.theme.muted + '" text-anchor="middle">E</text>'
					const scale = 56 / 24
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 100 100">' +
						'<circle cx="50" cy="50" r="49" fill="none" stroke="' + this.withAlpha(accent, 0.34) + '" stroke-width="1"/>' +
						marks +
						'<g transform="rotate(' + (Number(visual.bearing) || 0) + ' 50 50) translate(' + (50 - 12 * scale) + ',' + (50 - 12 * scale) + ') scale(' + scale + ')">' +
						'<path d="' + iconD + '" fill="none" stroke="' + accent + '" stroke-width="2.6" ' +
						'stroke-linecap="round" stroke-linejoin="round"/></g></svg>'
					return svgUri(svg)
				}

				if (kind === 'gauge') {
					w = viz.gauge
					h = viz.gauge / 2 + 2
					const ratio = Math.max(0, Math.min(1, Number(visual.ratio) < 0 ? 0 : Number(visual.ratio) || 0))
					const ang = Math.PI - Math.PI * ratio
					const px = 50 + 46 * Math.cos(ang)
					const py = 50 - 46 * Math.sin(ang)
					const nx = 50 + 32 * Math.cos(ang)
					const ny = 50 - 32 * Math.sin(ang)
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 100 54">' +
						'<path d="M4 50 A46 46 0 0 1 96 50" fill="none" stroke="' + this.withAlpha(accent, 0.22) + '" stroke-width="4"/>' +
						'<path d="M4 50 A46 46 0 0 1 ' + px + ' ' + py + '" fill="none" stroke="' + accent + '" stroke-width="4" stroke-linecap="round"/>' +
						'<path d="M50 50 L' + nx + ' ' + ny + '" fill="none" stroke="' + this.theme.ink + '" stroke-width="1.6" stroke-linecap="round"/>' +
						'</svg>'
					return svgUri(svg)
				}

				if (kind === 'uv') {
					w = viz.uvbar
					h = 6
					const pos = Math.max(0, Math.min(100, Number(visual.pos) || 0))
					const stops = this.shape.uvScale
						.map((c, i) => '<stop offset="' + ((i / (this.shape.uvScale.length - 1)) * 100).toFixed(1) + '%" stop-color="' + c + '"/>')
						.join('')
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
						'<defs><linearGradient id="uv" x1="0" y1="0" x2="1" y2="0">' + stops + '</linearGradient></defs>' +
						'<rect x="0" y="0" width="' + w + '" height="' + h + '" rx="3" fill="url(#uv)"/>' +
						'<rect x="' + Math.max(0, Math.min(w - 4, (w * pos) / 100 - 2)) + '" y="' + (xs ? h / 2 - 3 : -3) + '" width="4" height="' + (xs ? 6 : 12) + '" fill="' + this.theme.ink + '" stroke="' +
						this.theme.bg + '" stroke-width="1"/>' +
						'</svg>'
					return svgUri(svg)
				}

				if (kind === 'bars') {
					const values = (visual.values || []).slice(0, 7)
					const size = this.visualSize(visual, xs)
					h = size.h
					const barW = 4
					const gapBar = 2
					w = size.w
					const max = Math.max.apply(null, values.concat([0.001]))
					const rects = values
						.map((v, i) => {
							const bh = Math.max(h * 0.08, (v / max) * h)
							const lit = i >= values.length - 2
							return '<rect x="' + (i * (barW + gapBar)) + '" y="' + (h - bh) + '" width="' + barW + '" height="' + bh +
								'" rx="1" fill="' + accent + '" opacity="' + (lit ? 1 : 0.5) + '"/>'
						})
						.join('')
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
						rects + '</svg>'
					return svgUri(svg)
				}

				if (kind === 'sun') {
					w = h = viz.sun
					// 图标占圆内的 60%（与 iOS / Android 同一比例）。
					// 之前在 100 的 viewBox 里用 56/24 又乘 2.2，路径尺寸到了 123 单位，
					// 既溢出 viewBox 又没按实际尺寸居中 —— 这就是看到的「错位」。
					const scale = (w * 0.6) / 24 * (100 / w)
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 100 100">' +
						'<circle cx="50" cy="50" r="49" fill="none" stroke="' + this.withAlpha(accent, 0.42) + '" stroke-width="1.5"/>' +
						'<g transform="translate(' + (50 - 12 * scale) + ',' + (50 - 12 * scale) + ') scale(' + scale + ')">' +
						'<path d="' + iconD + '" fill="none" stroke="' + accent + '" stroke-width="1.6" ' +
						'stroke-linecap="round" stroke-linejoin="round"/></g></svg>'
					return svgUri(svg)
				}

				if (kind === 'battery') {
					const size = this.visualSize(visual, xs)
					h = size.h
					const cells = 5
					const level = Math.max(0, Math.min(cells, Number(visual.level) || 0))
					const low = level <= 1
					const cellW = this.shape.layout.cellW
					const cellGap = this.shape.layout.cellGap
					const pad = 2
					const bodyW = cells * cellW + (cells - 1) * cellGap + pad * 2
					w = size.w
					let rects = ''
					for (let i = 0; i < cells; i++) {
						const on = i < level
						const color = on ? (low ? this.theme.danger : this.theme.ok) : this.withAlpha(this.theme.ink, 0.14)
						rects += '<rect x="' + (pad + i * (cellW + cellGap)) + '" y="' + pad + '" width="' + cellW +
							'" height="' + (h - pad * 2) + '" rx="1" fill="' + color + '"/>'
					}
					svg =
						'<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
						'<rect x="0.5" y="0.5" width="' + (bodyW - 1) + '" height="' + (h - 1) + '" rx="2" fill="none" stroke="' +
						this.withAlpha(this.theme.ink, 0.42) + '" stroke-width="1"/>' +
						rects +
						'<rect x="' + bodyW + '" y="' + h * 0.28 + '" width="2" height="' + h * 0.44 + '" rx="1" fill="' +
						this.withAlpha(this.theme.ink, 0.42) + '"/>' +
						'</svg>'
					return svgUri(svg)
				}

				return ''
			},
			/** 曲线：单调三次插值，与设计稿 path() 同一套算法 */
			chartFor(entry) {
				const series = (entry.module && entry.module.series) || []
				if (series.length < 2) return ''
				const accent = this.accentOf(entry)
				const vals = series.map((p) => p[1])
				let min = Math.min.apply(null, vals)
				let max = Math.max.apply(null, vals)
				const pad = Math.max((max - min) * 0.18, 0.6)
				min -= pad
				max += pad
				const spanV = Math.max(max - min, 0.0001)
				const times = series.map((p) => p[0])
				const t0 = Math.min.apply(null, times)
				const t1 = Math.max.apply(null, times)
				const spanT = Math.max(t1 - t0, 1)
				const pts = series.map((p) => ({
					x: 4 + ((p[0] - t0) / spanT) * 192,
					y: 68 - ((p[1] - min) / spanV) * 60
				}))
				const slopes = []
				for (let i = 1; i < pts.length; i++) {
					const dx = pts[i].x - pts[i - 1].x
					slopes.push(dx === 0 ? 0 : (pts[i].y - pts[i - 1].y) / dx)
				}
				const tan = pts.map((_, i) => {
					if (i === 0) return slopes[0]
					if (i === pts.length - 1) return slopes[slopes.length - 1]
					const a = slopes[i - 1]
					const b = slopes[i]
					return a * b <= 0 ? 0 : 2 / (1 / a + 1 / b)
				})
				let d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1)
				for (let i = 0; i < pts.length - 1; i++) {
					const a = pts[i]
					const b = pts[i + 1]
					const dx = (b.x - a.x) / 3
					d += ' C' + (a.x + dx).toFixed(1) + ',' + (a.y + tan[i] * dx).toFixed(1) +
						' ' + (b.x - dx).toFixed(1) + ',' + (b.y - tan[i + 1] * dx).toFixed(1) +
						' ' + b.x.toFixed(1) + ',' + b.y.toFixed(1)
				}
				const last = pts[pts.length - 1]
				return svgUri(
					'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="76" viewBox="0 0 200 76" preserveAspectRatio="none">' +
					'<path d="M0 20H200 M0 48H200" stroke="' + this.theme.border + '" stroke-width="0.5" stroke-dasharray="2 4"/>' +
					'<path d="' + d + '" fill="none" stroke="' + accent + '" stroke-width="2" stroke-linecap="round"/>' +
					'<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="2.6" fill="' + accent + '"/>' +
					'</svg>'
				)
			},

			/** 量自己的宽度算缩放比；量不到就先按 1 显示，下一帧再试 */
			measure() {
				const query = uni.createSelectorQuery().in(this)
				query
					.select('.wp-frame')
					.boundingClientRect((rect) => {
						const width = rect && rect.width
						if (!width) {
							this.$nextTick(() => setTimeout(() => this.measure(), 60))
							return
						}
						const next = width / this.canvas.w
						if (Math.abs(next - this.scale) > 0.001) this.scale = next
					})
					.exec()
			}
		}
	}
</script>

<style lang="scss" scoped>
	/*
	 * 尺寸单位统一用 px —— 这里是设计画布单位，不是真机 pt。
	 * 卡片整体由 scaleStyle 等比缩放到容器宽度，所以这些数值只决定比例。
	 *
	 * 注意：块间距一律用 margin，**不要用 flex/grid 的 gap**：
	 * 安卓 app-plus 走 X5 内核，低版本不认 gap，表现就是所有块贴在一起
	 * （iOS 的 WKWebView 够新所以看不出来）。
	 */

	.wp-frame {
		position: relative;
		width: 100%;
		height: 0;
		overflow: hidden;
	}

	.wp-scale {
		position: absolute;
		top: 0;
		left: 0;
	}

	/* ---------- 卡片骨架 ---------- */
	.wp {
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		font-variant-numeric: tabular-nums;
		overflow: hidden;
	}

	.wp-small {
		justify-content: flex-start;
	}

	.wp-medium,
	.wp-large {
		justify-content: flex-start;
	}

	.wp-spacer {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* ---------- 通用 primitive ---------- */
	.wp-head {
		display: flex;
		align-items: center;
		min-height: 22px;
		flex: 0 0 auto;
	}

	.wp-chip {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-right: 4px;
	}

	.wp-chip-icon {
		width: 13px;
		height: 13px;
	}

	.wp-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wp-value {
		display: flex;
		align-items: baseline;
		white-space: nowrap;
		min-width: 0;
	}

	.wp-value-unit {
		margin-left: 2px;
	}

	.wp-value-col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.wp-meta-row {
		display: flex;
		align-items: center;
		white-space: nowrap;
		overflow: hidden;
		margin-top: 2px;
	}

	.wp-meta-row>text {
		margin-right: 8px;
	}

	.wp-mi {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		margin-right: 2px;
		margin-left: 6px;
	}

	.wp-main {
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		min-height: 0;
	}

	.wp-main>.wp-value-col {
		flex: 0 1 auto;
	}

	.wp-foot {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		margin-top: 4px;
		white-space: nowrap;
		overflow: hidden;
	}

	.wp-foot > text {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ---------- medium ---------- */
	.wp-trend {
		display: flex;
		align-items: center;
		flex: 1 1 auto;
		min-height: 0;
		margin-top: 4px;
		/* 曲线栏有 min-width 下限，极端情况下两者加起来会超出行宽 —— 一律裁掉，不许溢出卡片 */
		overflow: hidden;
	}

	/*
	 * 左栏是「多少字就多宽」，不设任何宽度上限（与 iOS 的 MediumCardView / heroBlock 同一条规则）：
	 * 一旦套定宽框，框比内容宽 → 内容到曲线之间空一片；框比内容窄 → 字被挤小。
	 * 曲线栏靠 flex: 1 1 auto 吃掉剩下的全部宽度。
	 */
	.wp-current {
		display: flex;
		flex-direction: column;
		/* 让位用：平时按内容宽，曲线栏触及 min-width 时才收缩 */
		flex: 0 1 auto;
		min-width: 0;
		padding-right: 8px;
		box-sizing: border-box;
	}

	/*
	 * 曲线栏：吃掉剩下的宽高，且不能被挤没。
	 *
	 * min-width 是给时间轴留的三段刻度余量 —— 左栏是 flex:0 0 auto（内容多宽就多宽），
	 * 没有这条下限时，长数值 / 长明细会把右栏压到 0，曲线和刻度一起消失。
	 */
	.wp-chartbox {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		/* 行容器是 align-items: center，这里改成撑满，高度才是确定的 —— 下面 image 的
		 * height:100% 才有参照物。用 height:0 + flex-grow 在 app-vue 里会塌成 0： */
		align-self: stretch;
		min-width: 88px;
		min-height: 0;
		overflow: hidden;
	}

	/*
	 * uni-app 的 <image> 自带 320×240 的默认尺寸，不写高度时它会按内容撑到 240px，
	 * 把下面的时间轴顶出卡片。所以给满高的 100%，由 flex 决定实际可用高度。
	 */
	.wp-chart {
		flex: 1 1 auto;
		height: 100%;
		min-height: 0;
		width: 100%;
	}

	.wp-chart-empty {
		flex: 1 1 auto;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		opacity: 0.75;
		overflow: hidden;
	}

	.wp-empty-icon {
		width: 22px;
		height: 22px;
		margin-bottom: 4px;
	}

	.wp-axis {
		display: flex;
		justify-content: space-between;
		flex: 0 0 auto;
		min-height: 0;
		margin-top: 2px;
		overflow: hidden;
		white-space: nowrap;
	}

	/* ---------- large ---------- */
	.wp-station {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		margin-bottom: 6px;
	}

	.wp-station-name {
		margin-left: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wp-zones {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
	}

	/* 块内 padding 与高度由 heroStyle / tileStyle 给（要跟着 payload 的 shape 走） */
	.wp-tile {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}

	.wp-hero {
		justify-content: flex-start;
		flex: 0 0 auto;
	}

	/* 行尾那一格不留右边距 —— 否则 flex-wrap 会多算一个间距，整行错位 */
	.wp-tile-edge {
		margin-right: 0 !important;
	}

	.wp-hero .wp-trend {
		margin-top: 4px;
	}

	.wp-tile-head {
		justify-content: space-between;
		flex: 0 0 auto;
		min-height: 0;
	}

	.wp-mtitle {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wp-tile-value {
		margin-top: 2px;
		overflow: hidden;
	}

	.wp-detail-in {
		margin-left: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wp-grid {
		display: flex;
		flex-wrap: wrap;
		flex: 1 1 auto;
		min-height: 0;
		align-content: flex-start;
	}

	.wp-rows {
		display: flex;
		flex-direction: column;
		min-width: 0;
		margin-top: 2px;
	}

	.wp-row-line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		min-width: 0;
	}

	.wp-row-line>text {
		white-space: nowrap;
	}

	.wp-row-label {
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1 1 auto;
		min-width: 0;
		margin-right: 6px;
	}
</style>
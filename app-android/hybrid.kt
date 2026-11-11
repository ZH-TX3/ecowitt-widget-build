//
//  hybrid.kt
//  uts 插件 app-android 混编文件
//
//  职责：把 payload 写进 SharedPreferences，然后刷新所有 AppWidget 实例。
//  与 iOS 的对应关系：
//    WidgetDataBridge.swift  <->  EcowittWidgetStore / EcowittWidgetBridge（写入 + 刷新）
//    EcowittWidget.swift     <->  EcowittWidgetRenderer（RemoteViews 渲染）
//
//  几个必须守住的约束：
//   1. 所有资源 id 运行时用 getIdentifier 取，不用 R.xxx（插件编译进宿主包，包名打包时才定）
//   2. RemoteViews 只支持有限控件，布局一律 LinearLayout + TextView + ImageView
//   3. payload 解析全程容错：字段缺失走兜底，未知 block.type 直接跳过，绝不抛到调用方
//   4. 不在 Kotlin 里做单位换算 / 文案翻译，label 与 unit 全部来自 payload
//

package uni.modules.ecowittwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val ECOWITT_WIDGET_TAG = "EcowittWidget"

private const val DEFAULT_DEVICE = "Ecowitt"
private const val DEFAULT_VALUE = "--"

/** 与 iOS WidgetDataBridge.swift 的 payloadKeyPrefix 保持一致 */
private const val PAYLOAD_KEY_PREFIX = "widget_payload__"
private const val UPDATED_AT_KEY_SUFFIX = "__updated_at"
private const val PREFS_NAME = "ecowitt_widget"

/** 最多渲染的副指标行数（两列 × 3 行） */
private const val MAX_ROWS_PER_COLUMN = 3
private const val COLUMN_COUNT = 2

// MARK: - 数据模型

class EcowittWidgetBlock {
	var key: String = ""
	var type: String = ""
	var label: String = ""
	var value: String = DEFAULT_VALUE
	var unit: String = ""
	var icon: String = ""
	var rotate: Double = 0.0
	var sub: String = ""
}

class EcowittWidgetPayload {
	var device: String = DEFAULT_DEVICE
	var blocks: MutableList<EcowittWidgetBlock> = ArrayList()
	var updatedAt: Long = 0L

	// counts：每个尺寸最多显示几条（含主数值）
	var countSmall: Int = 1
	var countMedium: Int = 3
	var countLarge: Int = 6

	// theme
	var bgHex: String = ""
	var accentHex: String = ""
	var textHex: String = ""
	var mutedHex: String = ""
	var fontScale: Double = 1.0
}

// MARK: - 存储

object EcowittWidgetStore {

	fun payloadKey(context: Context): String {
		val part = try {
			context.packageName.replace(".", "_")
		} catch (t: Throwable) {
			"unknown"
		}
		return PAYLOAD_KEY_PREFIX + part
	}

	fun updatedAtKey(context: Context): String = payloadKey(context) + UPDATED_AT_KEY_SUFFIX

	fun save(context: Context, json: String): Boolean {
		return try {
			context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
				.edit()
				.putString(payloadKey(context), json)
				.putLong(updatedAtKey(context), System.currentTimeMillis() / 1000)
				.commit()
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "save payload failed", t)
			false
		}
	}

	fun read(context: Context): String {
		return try {
			context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
				.getString(payloadKey(context), "") ?: ""
		} catch (t: Throwable) {
			""
		}
	}
}

// MARK: - 渲染

object EcowittWidgetRenderer {

	private val idCache = HashMap<String, Int>()

	private fun resId(context: Context, name: String, type: String): Int {
		val cacheKey = type + "/" + name
		val cached = idCache[cacheKey]
		if (cached != null && cached != 0) return cached
		val id = try {
			context.resources.getIdentifier(name, type, context.packageName)
		} catch (t: Throwable) {
			0
		}
		idCache[cacheKey] = id
		return id
	}

	/**
	 * iOS 侧的 payload 是 #RRGGBB / #RRGGBBAA；Android 的 Color.parseColor 认 #AARRGGBB。
	 * 8 位时要把 alpha 从末尾挪到最前。
	 */
	private fun parseColor(hex: String, fallback: Int): Int {
		if (TextUtils.isEmpty(hex)) return fallback
		var s = hex.trim()
		if (s.startsWith("#")) s = s.substring(1)
		return try {
			when (s.length) {
				6 -> Color.parseColor("#" + s)
				8 -> {
					val r = s.substring(0, 2)
					val g = s.substring(2, 4)
					val b = s.substring(4, 6)
					val a = s.substring(6, 8)
					Color.parseColor("#" + a + r + g + b)
				}
				else -> fallback
			}
		} catch (t: Throwable) {
			fallback
		}
	}

	fun parse(json: String): EcowittWidgetPayload {
		val payload = EcowittWidgetPayload()
		if (TextUtils.isEmpty(json)) return payload
		try {
			val root = JSONObject(json)
			payload.device = root.optString("device", DEFAULT_DEVICE)
			payload.updatedAt = root.optLong("updatedAt", 0L)

			val counts = root.optJSONObject("counts")
			if (counts != null) {
				payload.countSmall = counts.optInt("small", payload.countSmall)
				payload.countMedium = counts.optInt("medium", payload.countMedium)
				payload.countLarge = counts.optInt("large", payload.countLarge)
			}

			val theme = root.optJSONObject("theme")
			if (theme != null) {
				payload.bgHex = theme.optString("bg", "")
				payload.accentHex = theme.optString("accent", "")
				payload.textHex = theme.optString("text", "")
				payload.mutedHex = theme.optString("muted", "")
				val scale = theme.optDouble("fontScale", 1.0)
				payload.fontScale = if (scale >= 0.5 && scale <= 2.0) scale else 1.0
			}

			val blocks = root.optJSONArray("blocks")
			if (blocks != null) {
				for (i in 0 until blocks.length()) {
					val obj = blocks.optJSONObject(i) ?: continue
					val block = EcowittWidgetBlock()
					block.key = obj.optString("key", "")
					block.type = obj.optString("type", "")
					block.label = obj.optString("label", "")
					block.value = obj.optString("value", DEFAULT_VALUE)
					block.unit = obj.optString("unit", "")
					block.icon = obj.optString("icon", "")
					block.rotate = obj.optDouble("rotate", 0.0)
					block.sub = obj.optString("sub", "")
					payload.blocks.add(block)
				}
			}
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "parse payload failed", t)
		}
		return payload
	}

	/** 控件尺寸分档：拿不到就来 medium，和 iOS default 一致 */
	/**
	 * 还没同步过数据时的占位内容。对应 iOS 的 WidgetPayload.placeholder：
	 * 显示图标 + "--"，而不是一片空白。文案留空，等 App 首次写入后由 payload 决定。
	 */
	fun placeholderPayload(): EcowittWidgetPayload {
		val payload = EcowittWidgetPayload()
		payload.blocks.add(block("ph-hero", "hero", "°C", "thermometer.medium"))
		payload.blocks.add(block("ph-humidity", "metric", "%", "drop.fill"))
		payload.blocks.add(block("ph-wind", "metric", "m/s", "arrow.up"))
		payload.blocks.add(block("ph-rain", "metric", "mm", "cloud.rain.fill"))
		return payload
	}

	private fun block(key: String, type: String, unit: String, icon: String): EcowittWidgetBlock {
		val b = EcowittWidgetBlock()
		b.key = key
		b.type = type
		b.value = DEFAULT_VALUE
		b.unit = unit
		b.icon = icon
		return b
	}

	fun sizeKey(context: Context, manager: AppWidgetManager, widgetId: Int): String {
		val widthDp = try {
			val options = manager.getAppWidgetOptions(widgetId)
			Math.max(
				options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0),
				options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
			)
		} catch (t: Throwable) {
			0
		}
		return when {
			widthDp <= 0 -> "medium"
			widthDp < 200 -> "small"
			widthDp < 320 -> "medium"
			else -> "large"
		}
	}

	private fun limitFor(payload: EcowittWidgetPayload, size: String): Int {
		val declared = when (size) {
			"small" -> payload.countSmall
			"large" -> payload.countLarge
			else -> payload.countMedium
		}
		val want = if (declared <= 0) 3 else declared
		val capped = Math.min(want, payload.blocks.size)
		return if (capped < 1) 0 else capped
	}

	private fun iconDrawable(context: Context, block: EcowittWidgetBlock): Int {
		// 风向：rotate != 0 或图标就是 arrow.up 时走 8 方向 drawable
		if (block.rotate != 0.0 || block.icon == "arrow.up") {
			return arrowDrawable(context, block.rotate)
		}
		val name = when (block.icon) {
			"thermometer.medium", "thermometer", "thermometer.high" -> "ecowitt_widget_ic_temp"
			"drop.fill", "drop", "humidity.fill" -> "ecowitt_widget_ic_humidity"
			"cloud.rain.fill", "cloud.rain" -> "ecowitt_widget_ic_rain"
			"house.fill", "house" -> "ecowitt_widget_ic_indoor"
			else -> ""
		}
		if (name.isEmpty()) return 0
		return resId(context, name, "drawable")
	}

	private fun arrowDrawable(context: Context, degrees: Double): Int {
		val normalized = ((degrees % 360.0) + 360.0) % 360.0
		val index = (Math.round(normalized / 45.0).toInt()) % 8
		val names = arrayOf("n", "ne", "e", "se", "s", "sw", "w", "nw")
		return resId(context, "ecowitt_widget_arrow_" + names[index], "drawable")
	}

	private fun clickIntent(context: Context): PendingIntent? {
		return try {
			val flags = if (Build.VERSION.SDK_INT >= 23) {
				PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
			} else {
				PendingIntent.FLAG_UPDATE_CURRENT
			}
			val schemeIntent = Intent(Intent.ACTION_VIEW, Uri.parse("ecowitt://page/index"))
			schemeIntent.setPackage(context.packageName)
			val resolved = context.packageManager.resolveActivity(schemeIntent, 0)
			val target = if (resolved != null) {
				schemeIntent
			} else {
				context.packageManager.getLaunchIntentForPackage(context.packageName)
			}
			if (target == null) null else PendingIntent.getActivity(context, 0, target, flags)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "click intent failed", t)
			null
		}
	}

	private fun setText(views: RemoteViews, context: Context, idName: String, value: String) {
		val id = resId(context, idName, "id")
		if (id != 0) views.setTextViewText(id, value)
	}

	private fun setColor(views: RemoteViews, context: Context, idName: String, color: Int) {
		val id = resId(context, idName, "id")
		if (id != 0) views.setTextColor(id, color)
	}

	private fun setSize(views: RemoteViews, context: Context, idName: String, sp: Float) {
		val id = resId(context, idName, "id")
		if (id != 0) views.setFloat(id, "setTextSize", sp)
	}

	private fun setVisible(views: RemoteViews, context: Context, idName: String, visible: Boolean) {
		val id = resId(context, idName, "id")
		if (id != 0) views.setViewVisibility(id, if (visible) View.VISIBLE else View.GONE)
	}

	private val DEFAULT_ACCENT = Color.parseColor("#4B9BFF")

	private fun setIcon(
		views: RemoteViews,
		context: Context,
		idName: String,
		block: EcowittWidgetBlock,
		accent: Int
	) {
		val id = resId(context, idName, "id")
		if (id == 0) return
		val drawable = iconDrawable(context, block)
		if (drawable == 0) {
			views.setViewVisibility(id, View.GONE)
			return
		}
		views.setViewVisibility(id, View.VISIBLE)
		views.setImageViewResource(id, drawable)
		// 图标内置是主题色；主题换色时尝试覆盖（部分 ROM 上 setColorFilter 无效，失败不影响显示）
		if (accent != DEFAULT_ACCENT) {
			try {
				views.setInt(id, "setColorFilter", accent)
			} catch (t: Throwable) {
				// 不支持就算了，图标保持内置颜色
			}
		}
	}

	fun build(context: Context, manager: AppWidgetManager, widgetId: Int): RemoteViews? {
		val layoutId = resId(context, "ecowitt_widget", "layout")
		if (layoutId == 0) {
			Log.w(ECOWITT_WIDGET_TAG, "layout ecowitt_widget not found, skip render")
			return null
		}

		val views = RemoteViews(context.packageName, layoutId)
		val raw = EcowittWidgetStore.read(context)
		val payload = if (TextUtils.isEmpty(raw)) placeholderPayload() else parse(raw)
		val size = sizeKey(context, manager, widgetId)

		// 主题
		val bg = parseColor(payload.bgHex, Color.parseColor("#121C2C"))
		val accent = parseColor(payload.accentHex, DEFAULT_ACCENT)
		val textColor = parseColor(payload.textHex, Color.WHITE)
		val muted = parseColor(payload.mutedHex, Color.parseColor("#9AA3B2"))

		val rootId = resId(context, "ecowitt_widget_root", "id")
		if (rootId != 0) views.setInt(rootId, "setBackgroundColor", bg)

		val scale = payload.fontScale.toFloat()
		val small = size == "small"

		// 头部
		setText(views, context, "ecowitt_widget_device", payload.device)
		setColor(views, context, "ecowitt_widget_device", muted)
		setSize(views, context, "ecowitt_widget_device", 10f * scale)

		val timeText = if (payload.updatedAt > 0L) {
			try {
				SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(payload.updatedAt * 1000L))
			} catch (t: Throwable) {
				""
			}
		} else {
			""
		}
		setText(views, context, "ecowitt_widget_time", timeText)
		setColor(views, context, "ecowitt_widget_time", muted)
		setSize(views, context, "ecowitt_widget_time", 9f * scale)

		// 主数值 + 副指标
		val limit = limitFor(payload, size)
		val shown = ArrayList<EcowittWidgetBlock>()
		for (i in 0 until limit) {
			val b = payload.blocks.getOrNull(i) ?: break
			shown.add(b)
		}

		var heroIndex = -1
		for (i in shown.indices) {
			if (shown[i].type == "hero") {
				heroIndex = i
				break
			}
		}
		if (heroIndex < 0 && shown.isNotEmpty()) heroIndex = 0

		val hero = if (heroIndex >= 0) shown[heroIndex] else null
		val rest = ArrayList<EcowittWidgetBlock>()
		for (i in shown.indices) {
			if (i == heroIndex) continue
			if (shown[i].type == "divider") continue
			rest.add(shown[i])
		}

		// 主数值
		if (hero == null) {
			setVisible(views, context, "ecowitt_widget_hero", false)
		} else {
			setVisible(views, context, "ecowitt_widget_hero", true)
			setIcon(views, context, "ecowitt_widget_hero_icon", hero, accent)
			setText(views, context, "ecowitt_widget_hero_value", hero.value)
			setColor(views, context, "ecowitt_widget_hero_value", textColor)
			setSize(views, context, "ecowitt_widget_hero_value", (if (small) 30f else 38f) * scale)
			setText(views, context, "ecowitt_widget_hero_unit", hero.unit)
			setColor(views, context, "ecowitt_widget_hero_unit", muted)
			setSize(views, context, "ecowitt_widget_hero_unit", 12f * scale)
			setText(views, context, "ecowitt_widget_hero_label", hero.label)
			setColor(views, context, "ecowitt_widget_hero_label", muted)
			setSize(views, context, "ecowitt_widget_hero_label", 10f * scale)
		}

		// 先全部隐藏，再按需显示（RemoteViews 没有「循环」概念，只能固定槽位）
		for (col in 0 until COLUMN_COUNT) {
			for (row in 0 until MAX_ROWS_PER_COLUMN) {
				setVisible(views, context, rowId(col, row), false)
			}
		}

		// 单列 / 双列规则与 iOS 一致：rest <= 1 或 small 尺寸走单列，否则奇偶拆两列
		val singleColumn = rest.size <= 1 || small
		for (i in rest.indices) {
			val block = rest[i]
			val col: Int
			val row: Int
			if (singleColumn) {
				col = 0
				row = i
			} else {
				col = i % COLUMN_COUNT
				row = i / COLUMN_COUNT
			}
			if (row >= MAX_ROWS_PER_COLUMN) continue
			renderRow(views, context, block, col, row, scale, textColor, muted, accent)
		}
		// 单列时右列整体隐藏
		if (singleColumn) {
			for (row in 0 until MAX_ROWS_PER_COLUMN) {
				setVisible(views, context, rowId(1, row), false)
			}
		}

		val pendingIntent = clickIntent(context)
		if (pendingIntent != null && rootId != 0) {
			views.setOnClickPendingIntent(rootId, pendingIntent)
		}

		return views
	}

	private fun rowId(col: Int, row: Int): String = "ecowitt_widget_row_" + col + "_" + row

	private fun renderRow(
		views: RemoteViews,
		context: Context,
		block: EcowittWidgetBlock,
		col: Int,
		row: Int,
		scale: Float,
		textColor: Int,
		muted: Int,
		accent: Int
	) {
		val suffix = "_" + col + "_" + row
		setVisible(views, context, rowId(col, row), true)

		setIcon(views, context, "ecowitt_widget_icon" + suffix, block, accent)

		setText(views, context, "ecowitt_widget_label" + suffix, block.label)
		setColor(views, context, "ecowitt_widget_label" + suffix, muted)
		setSize(views, context, "ecowitt_widget_label" + suffix, 10f * scale)

		setText(views, context, "ecowitt_widget_value" + suffix, block.value)
		setColor(views, context, "ecowitt_widget_value" + suffix, textColor)
		setSize(views, context, "ecowitt_widget_value" + suffix, 11f * scale)

		setText(views, context, "ecowitt_widget_unit" + suffix, block.unit)
		setColor(views, context, "ecowitt_widget_unit" + suffix, muted)
		setSize(views, context, "ecowitt_widget_unit" + suffix, 9f * scale)

		val subVisible = !TextUtils.isEmpty(block.sub)
		setText(views, context, "ecowitt_widget_sub" + suffix, block.sub)
		setColor(views, context, "ecowitt_widget_sub" + suffix, muted)
		setSize(views, context, "ecowitt_widget_sub" + suffix, 9f * scale)
		setVisible(views, context, "ecowitt_widget_sub" + suffix, subVisible)
	}

	fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
		try {
			val views = build(context, manager, widgetId) ?: return
			manager.updateAppWidget(widgetId, views)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "render failed for widget " + widgetId, t)
		}
	}
}

// MARK: - Provider

class EcowittWidgetProvider : AppWidgetProvider() {

	override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
		for (id in appWidgetIds) {
			EcowittWidgetRenderer.render(context, appWidgetManager, id)
		}
	}

	override fun onAppWidgetOptionsChanged(
		context: Context,
		appWidgetManager: AppWidgetManager,
		appWidgetId: Int,
		newOptions: Bundle?
	) {
		// 用户拉伸控件后重新按新尺寸分档
		EcowittWidgetRenderer.render(context, appWidgetManager, appWidgetId)
	}

	override fun onEnabled(context: Context) {
		try {
			val manager = AppWidgetManager.getInstance(context)
			val component = ComponentName(context, EcowittWidgetProvider::class.java)
			for (id in manager.getAppWidgetIds(component)) {
				EcowittWidgetRenderer.render(context, manager, id)
			}
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "onEnabled failed", t)
		}
	}
}

// MARK: - uts 桥

/**
 * 所有方法返回 String：空串表示成功，非空是失败原因。
 * 这样 uts 侧只处理字符串，不用在 Kotlin/UTS 之间做对象转换。
 */
object EcowittWidgetBridge {

	@JvmStatic
	fun savePayloadJson(context: Context?, json: String?, widgetKind: String?): String {
		if (context == null) return "context is null"
		if (TextUtils.isEmpty(json)) return "payload is empty"
		return try {
			if (!EcowittWidgetStore.save(context, json!!)) {
				return "shared preferences write failed"
			}
			if (!refreshAll(context)) {
				// 桌面还没有添加控件，写成功但没东西可刷，不算失败
				Log.i(ECOWITT_WIDGET_TAG, "payload saved, no widget instance yet")
			}
			""
		} catch (t: Throwable) {
			Log.e(ECOWITT_WIDGET_TAG, "savePayloadJson failed", t)
			t.message ?: t.javaClass.simpleName
		}
	}

	@JvmStatic
	fun readPayloadJson(context: Context?): String {
		if (context == null) return ""
		return EcowittWidgetStore.read(context)
	}

	@JvmStatic
	fun reloadWidget(context: Context?, widgetKind: String?): String {
		if (context == null) return "context is null"
		return try {
			refreshAll(context)
			""
		} catch (t: Throwable) {
			t.message ?: t.javaClass.simpleName
		}
	}

	/** 刷新所有已添加的实例；返回是否存在实例 */
	private fun refreshAll(context: Context): Boolean {
		val manager = AppWidgetManager.getInstance(context)
		val component = ComponentName(context, EcowittWidgetProvider::class.java)
		val ids = manager.getAppWidgetIds(component)
		if (ids == null || ids.isEmpty()) return false
		for (id in ids) {
			EcowittWidgetRenderer.render(context, manager, id)
		}
		return true
	}
}

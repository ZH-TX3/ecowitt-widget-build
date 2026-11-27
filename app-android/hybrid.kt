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

// 包名不能自定义：UTS 把 index.uts 编译到 uts.sdk.modules.<camelize(插件id)>，
// 只有同包才能直接引用本文件里的类。ecowitt-widget -> uts.sdk.modules.ecowittWidget
package uts.sdk.modules.ecowittWidget

import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import org.json.JSONArray
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val ECOWITT_WIDGET_TAG = "EcowittWidget"

private const val DEFAULT_DEVICE = "Ecowitt"
private const val DEFAULT_VALUE = "--"

/** 与 iOS WidgetDataBridge.swift 的 payloadKeyPrefix 保持一致 */
private const val PAYLOAD_KEY_PREFIX = "widget_payload__"
private const val UPDATED_AT_KEY_SUFFIX = "__updated_at"
private const val LAST_FETCH_KEY_SUFFIX = "__last_fetch_at"
private const val PREFS_NAME = "ecowitt_widget"

/** 点击刷新图标时派发的 action，与 AndroidManifest 里 receiver 的 intent-filter 一致 */
private const val ACTION_REFRESH = "uts.sdk.modules.ecowittWidget.ACTION_REFRESH"

/** 最多渲染的副指标行数（两列 × 3 行） */
private const val MAX_ROWS_PER_COLUMN = 3
private const val COLUMN_COUNT = 2

// MARK: - 数据模型

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

	/** 上次**发起网络请求**的时间（epoch 秒），用来给并发 job 去重 */
	fun lastFetchKey(context: Context): String = payloadKey(context) + LAST_FETCH_KEY_SUFFIX

	fun readLastFetch(context: Context): Long {
		return try {
			context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
				.getLong(lastFetchKey(context), 0L)
		} catch (t: Throwable) {
			0L
		}
	}

	fun markFetched(context: Context) {
		try {
			context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
				.edit()
				.putLong(lastFetchKey(context), System.currentTimeMillis() / 1000)
				.apply()
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "markFetched failed", t)
		}
	}

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

	/**
	 * 上次写盘时间（epoch 秒），0 = 从没写过。
	 *
	 * 这是「前台还在喂数据」的唯一判据：App 每次前台刷新都会写一遍。
	 * 只有它变老到阈值之外，原生才该去拉。
	 */
	fun readUpdatedAt(context: Context): Long {
		return try {
			context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
				.getLong(updatedAtKey(context), 0L)
		} catch (t: Throwable) {
			0L
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

	/** 控件尺寸分档：拿不到就来 medium，和 iOS default 一致 */
	/**
	 * 还没同步过数据时的占位内容。对应 iOS 的 WidgetPayload.placeholder：
	 * 显示图标 + "--"，而不是一片空白。文案留空，等 App 首次写入后由 payload 决定。
	 */
	/**
 * 立即刷新所有已添加到桌面的实例。
 *
 * 现在只是重读 SharedPreferences 后重绘（把 App 刚写入的数据立刻显示出来）；
 * 等「小组件自拉数据」落地后，这里改成拉一次网络再绘制，调用方不用变。
 */
internal fun refreshAll(context: Context) {
	try {
		val manager = AppWidgetManager.getInstance(context)
		val component = ComponentName(context, EcowittWidgetProvider::class.java)
		val ids = manager.getAppWidgetIds(component)
		for (id in ids) {
			EcowittWidgetRenderer.render(context, manager, id)
		}
		Log.i(ECOWITT_WIDGET_TAG, "refreshAll: " + ids.size + " instance(s)")
	} catch (t: Throwable) {
		Log.w(ECOWITT_WIDGET_TAG, "refreshAll failed", t)
	}
}

	fun clickIntent(context: Context, deviceId: String?): PendingIntent? {
		return try {
			val flags = if (Build.VERSION.SDK_INT >= 23) {
				PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
			} else {
				PendingIntent.FLAG_UPDATE_CURRENT
			}
			// 用**启动 Intent + data** 而不是 ACTION_VIEW 的 scheme Intent：
			// 后者要能 resolveActivity 才生效，很多设备上 resolve 不到就退回「只打开 App」，
			// 表现就是点组件只回到上次停留的页面。启动 Intent 一定能解析，data 会进
			// plus.runtime.arguments，App 侧再按 ecowitt:// 解析跳转。
			val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
				?: return null
			// 点组件落到首页，带上设备 id：App 侧据此切到这台设备（App.vue applyWidgetNav）
			val id = Uri.encode(deviceId ?: "")
			launch.data = Uri.parse("ecowitt://pages/index/index?deviceId=" + id)
			launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
			PendingIntent.getActivity(context, 0, launch, flags)
		} catch (e: Exception) {
			Log.w(ECOWITT_WIDGET_TAG, "click intent failed: " + e.message)
			null
		}
	}

	/** 点击刷新图标的 PendingIntent：广播到自己，原地重绘，不进 App */
	fun refreshIntent(context: Context): PendingIntent? {
		return try {
			val flags = if (Build.VERSION.SDK_INT >= 23) {
				PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
			} else {
				PendingIntent.FLAG_UPDATE_CURRENT
			}
			val intent = Intent(context, EcowittWidgetProvider::class.java).setAction(ACTION_REFRESH)
			PendingIntent.getBroadcast(context, 1, intent, flags)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "refresh intent failed", t)
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

	fun build(context: Context, manager: AppWidgetManager, widgetId: Int): RemoteViews? {
		val raw = EcowittWidgetStore.read(context)
		// v4（schemaVersion >= 4）：模块 / 读数驱动，走 EcowittWidgetV4Renderer 的三套布局。
		// 解析不出来说明是旧版 App 发的数据，直接不渲染（v3 的旧渲染路径已退役）。
		val v4 = EcowittWidgetV4.fromJson(raw)
		if (v4 != null) {
			// 之前这里没有 try/catch，一旦 build 内部抛异常就会一路冒到
			// AppWidgetProvider，外层看到的是 "Null RemoteViews"，
			// 完全看不出真实原因。包一层把栈打出来。
			return try {
				EcowittWidgetV4Renderer.build(context, manager, widgetId, v4)
			} catch (t: Throwable) {
				Log.e(ECOWITT_WIDGET_TAG, "v4 render failed for widget " + widgetId, t)
				null
			}
		}
		// v2 的插槽式契约已完全退役：解析不到 v3 就不渲染，
		// 不再回退到老的 block 布局（那会让升级用户先看到一版旧样式）。
		Log.w(ECOWITT_WIDGET_TAG, "payload is not v4, skip render")
		return null
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

	override fun onReceive(context: Context, intent: Intent) {
		if (intent.action == ACTION_REFRESH) {
			// 用户点刷新图标：他是真的想拿新数据，不是想重画一遍。
			// 先用旧数据立刻重绘（点了要有反应），拉回来后会再重绘一次。
			// userInitiated = true：用户主动要求的，不受兜底阈值拦。
			EcowittWidgetFetch.pullNow(context, true)
			EcowittWidgetRenderer.refreshAll(context)
			return
		}
		super.onReceive(context, intent)
	}

	override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
		// 系统按 updatePeriodMillis（30 分钟）戳这里一次 —— 顺手当自拉取任务的看门狗：
		// job 被 ROM 清掉时，最迟半小时内会被补回来（schedule 会先查 it 还在不在）
		EcowittWidgetFetch.schedule(context)
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
			// 桌面第一次放上组件：顺手把自拉取的周期任务补注册一次
			EcowittWidgetFetch.schedule(context, true)
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

/**
 * 开机与 App 升级后刷新。
 *
 * 为什么需要：updatePeriodMillis 最小 30 分钟且不保证准时，用户重启手机后卡片会一直停在旧值，
 * 直到系统下一次唤醒。BOOT_COMPLETED 属于隐式广播白名单，manifest 注册在 8.0+ 仍然可用。
 */
/**
 * 开机 / App 升级后要做的事。抽出来是因为调试台要能单独触发一次
 * （`bench.BOOT`）—— 应用自己发 `BOOT_COMPLETED` 会被系统拒，
 * 只能直接调这段逻辑，不能靠「模拟广播」。
 */
internal fun onWidgetBoot(context: Context) {
	// 关机/重装会清掉 JobScheduler 的周期任务，这里补注册（force：签名没变也要重设）
	EcowittWidgetFetch.schedule(context, true)
	// 开机后数据必然是旧的，用户解锁就在看桌面 —— 立刻拉一次。
	// 一次性任务不受 15 分钟最小周期限制，通常几秒内就发出去
	EcowittWidgetFetch.pullNow(context)
	// 先用旧数据把桌面画出来，别等网络
	EcowittWidgetRenderer.refreshAll(context)
}

class EcowittBootReceiver : BroadcastReceiver() {
	override fun onReceive(context: Context, intent: Intent) {
		when (intent.action) {
			Intent.ACTION_BOOT_COMPLETED,
			Intent.ACTION_MY_PACKAGE_REPLACED -> {
				Log.i(ECOWITT_WIDGET_TAG, "boot/package-replaced: refresh widgets")
				onWidgetBoot(context)
			}
		}
	}
}

// ============================================================================
// MARK: - 原生自拉取（App 不在也能更新）
// ============================================================================

/**
 * 与 iOS 的 WidgetFetcher.swift / common/js/widgetFetch.js 一一对应。
 *
 * 分工：JS 写整份 payload（token 段 + 一次数据段 + fetch 段），
 * 这里只替换**数据段**，token 段原样不动。
 *
 * 调度用 framework 的 JobScheduler，不引 androidx.work：
 *   - 插件是编译进宿主包的，加依赖就得重打基座且要改 uni-app 的构建配置
 *   - JobScheduler 从 API 21 起就有，最小周期 15 分钟，正好覆盖 15/30/60 三档
 *   - JobScheduler 本身就是 WorkManager 的底座，能力上没缺
 */
private val FETCH_DATA_KEYS = arrayOf(
	"deviceId", "station", "updated", "updatedShort",
	"status", "observedAt", "selection", "modules"
)

private const val FETCH_JOB_ID = 0xEC0
/** 一次性「立刻拉一次」的 jobId。与周期任务分开，互不影响 */
private const val FETCH_NOW_JOB_ID = 0xEC1
/** 上一次注册时的「开/关 + 间隔」签名，用来避免高频写盘把周期任务一直重置 */
private const val FETCH_SIGNATURE_KEY = "fetch_job_signature"
/** 一次性 job 的附加参数：用户主动点的，跳过兜底阈值 */
private const val EXTRA_IGNORE_AGE = "ignoreAge"

/** 曲线固定 24 小时窗口，与 common/js/widgetPayloadV4.js 的 WIDGET_RANGE_HOURS 一致 */
private const val WIDGET_RANGE_HOURS = 24
private const val FETCH_MIN_MINUTES = 15
private const val FETCH_MAX_MINUTES = 240
private const val FETCH_DEFAULT_TIMEOUT = 5000

object EcowittWidgetFetch {

	/**
	 * 按 payload 里的 fetch.intervalMinutes 注册周期任务。
	 *
	 * 同一 jobId 再 schedule 一次 = **覆盖**，周期会从这一刻重新算。
	 * 所以只在配置真的变了才重设：App 前台刷新很勤，每次都重设的话
	 * 周期永远走不完一圈（表现就是「自拉取从来不动」）。
	 *
	 * @param force 开机 / 重装后必须调用：事件会清掉已注册的任务，
	 *              但配置签名没变，不走 force 就补不回来
	 */
	fun schedule(context: Context, force: Boolean = false) {
		try {
			val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler
				?: return
			val fetch = fetchConfig(context)
			val on = fetch != null && fetch.enabled
			val minutes = (fetch?.intervalMinutes ?: 0).coerceIn(FETCH_MIN_MINUTES, FETCH_MAX_MINUTES)
			val signature = (if (on) "1" else "0") + ":" + minutes
			val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
			val sameSignature = prefs.getString(FETCH_SIGNATURE_KEY, "") == signature

			// 光比签名不够：**注册过的 job 会被系统 / ROM 清掉**（实测 MIUI 会，
			// 清完之后签名还留着，于是「以为注册过了」再也不补，自拉取静默死亡）。
			// 所以必须问一次「现在到底还挂着没有」。
			val registered = try {
				scheduler.allPendingJobs?.any { it.id == FETCH_JOB_ID } == true
			} catch (t: Throwable) {
				// 查不到就当成没注册，宁可多设一次
				false
			}

			if (!force && sameSignature && registered) return
			if (!registered) {
				Log.w(ECOWITT_WIDGET_TAG, "fetch: 周期任务不在了（被系统清掉？），补注册")
			}
			prefs.edit().putString(FETCH_SIGNATURE_KEY, signature).apply()

			if (fetch == null || !fetch.enabled) return cancel(context)
			val info = JobInfo.Builder(FETCH_JOB_ID, ComponentName(context, EcowittFetchJobService::class.java))
				.setPeriodic(minutes * 60_000L)
				.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
				.setPersisted(true)
				.build()
			scheduler.schedule(info)
			Log.i(ECOWITT_WIDGET_TAG, "fetch job scheduled: " + minutes + "min")
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "schedule fetch job failed", t)
		}
	}

	fun cancel(context: Context) {
		try {
			val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler
			scheduler?.cancel(FETCH_JOB_ID)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "cancel fetch job failed", t)
		}
	}

	/**
	 * 一次性「立刻拉一次」。
	 *
	 * 关键点：**一次性任务不受周期任务 15 分钟的最小限制**，有网就马上跑。
	 * 用在三个地方 ——
	 *   1. 开机 / App 升级后：此时数据必然是旧的，用户解锁就在看桌面
	 *   2. 用户点组件上的刷新图标：他是主动要新数据
	 *   3. 调试台 `bench.BOOT`
	 *
	 * 不做成「在广播接收器里直接发请求」：BroadcastReceiver 的 onReceive 一返回，
	 * 进程就随时可能被回收，网络请求会被拦腰砍断。交给 JobScheduler 才稳。
	 *
	 * @param userInitiated 用户主动点的。true 时跳过兜底阈值 ——
	 *        否则他点刷新前 1 分钟 App 刚写过盘，会被判成「数据还新」而不动，看着就像按钮坏了
	 */
	fun pullNow(context: Context, userInitiated: Boolean = false) {
		try {
			val scheduler = context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as? JobScheduler
				?: return
			val extras = PersistableBundle()
			extras.putBoolean(EXTRA_IGNORE_AGE, userInitiated)
			val info = JobInfo.Builder(FETCH_NOW_JOB_ID, ComponentName(context, EcowittFetchJobService::class.java))
				.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
				// 0 = 越快越好，不要等
				.setOverrideDeadline(0)
				.setExtras(extras)
				.build()
			scheduler.schedule(info)
			Log.i(ECOWITT_WIDGET_TAG, "fetch: 立刻拉一次的 job 已排队" + if (userInitiated) "（用户主动，免阈值）" else "")
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "schedule pullNow failed", t)
		}
	}

	/**
	 * 阻塞式拉一次；成功写回返回 true。调用方负责换线程
	 *
	 * @param ignoreAge true = 用户主动要求的，不看兜底阈值
	 */
	fun pull(context: Context, ignoreAge: Boolean = false): Boolean {
		// 桌面上一个组件都没有就别折腾：不请求、不解析、不写盘。
		// hasWidgets 查不到时返回 true（宁可多刷一次，也不要错误地停更）。
		if (!EcowittWidgetBridge.hasWidgets(context)) {
			Log.i(ECOWITT_WIDGET_TAG, "fetch: 跳过，桌面上没有组件")
			return false
		}
		val raw = EcowittWidgetStore.read(context)
		if (raw.isEmpty()) return false
		val root = try {
			JSONObject(raw)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: payload 解析失败", t)
			return false
		}
		// 与 EcowittWidgetV4.fromJson 同一道版本闸：旧契约不动它
		if (root.optInt("schemaVersion", 0) < EcowittWidgetV4.SCHEMA) return false
		val fetch = fetchConfig(context) ?: return false
		if (!fetch.enabled || fetch.url.isEmpty()) return false

		// 兜底语义：前台刚写过盘就别拉。App 在跑的时候它自己会喂数据，
		// 这时候再拉一次纯属抢活 —— 多一次请求、多一次重绘，数据还是一样的。
		// 用户主动点刷新的（ignoreAge）例外：他要的就是「现在去问一次」。
		if (!ignoreAge) {
			val lastWrite = EcowittWidgetStore.readUpdatedAt(context)
			if (lastWrite > 0) {
				val age = System.currentTimeMillis() / 1000 - lastWrite
				if (age < fetch.minAgeMinutes * 60L) {
					Log.i(ECOWITT_WIDGET_TAG, "fetch: 跳过，" + age + " 秒前刚写过（阈值 " + fetch.minAgeMinutes + " 分钟）")
					return false
				}
			}
		}

		// 并发去重：开机时 onWidgetBoot 会排一个一次性任务，而系统恢复的周期任务
		// 往往同一时刻也到期了 —— 两个 job 同时进来就是两次请求、两份同样的数据
		// （实测三星重启后同一秒两条）。10 秒内有人拉过就退让。
		// 注意：用户主动点刷新的（ignoreAge）不去重，那是明确的一次点击。
		if (!ignoreAge) {
			val sinceFetch = System.currentTimeMillis() / 1000 - EcowittWidgetStore.readLastFetch(context)
			if (sinceFetch in 0 until 10) {
				Log.i(ECOWITT_WIDGET_TAG, "fetch: 跳过，" + sinceFetch + " 秒前刚拉过（并发去重）")
				return false
			}
		}

		val url = fetch.url.replace("{id}", Uri.encode(fetch.deviceId))
		// 时间戳在**发请求之前**写：并发的兄弟 job 进来时才有东西可比
		EcowittWidgetStore.markFetched(context)
		val started = System.currentTimeMillis()
		val body = httpGet(url, fetch.authHeader, fetch.authValue, fetch.timeoutMs)
		if (body == null) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: " + url + " 失败 " + (System.currentTimeMillis() - started) + "ms")
			return false
		}
		val parsed = try {
			JSONObject(body)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: 响应不是 JSON（" + body.length + " 字节）")
			return false
		}
		// 后端可能直接回数据段，也可能套一层 { code, data } —— 两种都认
		val nested = parsed.optJSONObject("data")
		val segment = if (nested != null && hasModules(nested)) nested else parsed
		if (!hasModules(segment)) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: 响应里没有可渲染的 modules")
			return false
		}
		val ok = merge(context, segment)
		Log.i(ECOWITT_WIDGET_TAG, "fetch: ok " + (System.currentTimeMillis() - started) + "ms, merged=" + ok)
		return ok
	}

	/**
	 * 只覆盖白名单，不做深合并（DATA-SOURCE.md §6.3）。
	 *
	 * 重新读一遍共享区再合并：JS 可能在拉取的同时刚写过 token 段，
	 * 用内存里那份旧的合并会把新的配色/字号盖回去。
	 */
	internal fun merge(context: Context, segment: JSONObject): Boolean {
		val raw = EcowittWidgetStore.read(context)
		if (raw.isEmpty()) return false
		return try {
			val root = JSONObject(raw)
			for (key in FETCH_DATA_KEYS) {
				if (segment.has(key)) root.put(key, segment.get(key))
			}
			// 刻度跟着新数据走，否则时间戳变了、刻度还停在旧时刻
			refreshAxis(root)
			EcowittWidgetStore.save(context, root.toString())
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: merge failed", t)
			false
		}
	}

	private class FetchConfig(
		val enabled: Boolean,
		val url: String,
		val deviceId: String,
		val intervalMinutes: Int,
		/** 共享区超过这么久没被写过才拉；见 common/js/widgetFetch.js 的 minAgeMinutes */
		val minAgeMinutes: Int,
		val authHeader: String,
		val authValue: String,
		val timeoutMs: Int
	)

	private fun fetchConfig(context: Context): FetchConfig? {
		val raw = EcowittWidgetStore.read(context)
		if (raw.isEmpty()) return null
		return try {
			val root = JSONObject(raw)
			val fetch = root.optJSONObject("fetch") ?: return null
			val interval = if (fetch.optInt("intervalMinutes", 0) > 0) fetch.optInt("intervalMinutes", 30) else 30
			FetchConfig(
				enabled = fetch.optBoolean("enabled", false),
				url = fetch.optString("url", ""),
				deviceId = fetch.optString("deviceId", ""),
				intervalMinutes = interval,
				// 缺省 = 间隔 - 5（与 JS 侧一致）：老 payload 没有这个字段时行为也一样
				minAgeMinutes = fetch.optInt("minAgeMinutes", (interval - 5).coerceAtLeast(1)).coerceIn(1, 240),
				authHeader = fetch.optString("authHeader", ""),
				authValue = fetch.optString("authValue", ""),
				// 超时必须有上限：拉得比系统给的窗口还久，任务会被直接掐掉
				timeoutMs = fetch.optInt("timeoutMs", FETCH_DEFAULT_TIMEOUT).coerceIn(2000, 20000)
			)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: 读配置失败", t)
			null
		}
	}

	/**
	 * `modules` 必须是非空数组。
	 *
	 * 空数组**不算成功**：那是「后端算不出东西」，合并进去会把桌面刷成空白。
	 * 保留旧数据永远比变空白好 —— 这条和 iOS 必须一致。
	 */
	private fun hasModules(obj: JSONObject): Boolean {
		val list = obj.optJSONArray("modules") ?: return false
		return list.length() > 0
	}

	/**
	 * 曲线刻度的三段文字（起 / 中 / 末）跟着数据刷新。
	 *
	 * `axis` 不在数据段白名单里（它是 JS 算好的 token 段），所以合并完不会动它 ——
	 * 结果是「头部时间更新了、曲线刻度还停在 App 上次写盘的时刻」，看着像曲线卡住了。
	 * 这里用**设备本地时区**重算，和 JS 的 axisText 一致：24 小时固定窗口，HH:mm。
	 * （用设备时区而不是让后端算：组件的刻度必须跟手机时间一致）
	 */
	private fun refreshAxis(root: JSONObject) {
		val observed = root.optLong("observedAt", 0L)
		val anchor = if (observed > 0L) observed else System.currentTimeMillis()
		val span = WIDGET_RANGE_HOURS * 3600L * 1000L
		try {
			val fmt = SimpleDateFormat("HH:mm", Locale.getDefault())
			root.put("axis", JSONArray().apply {
				put(fmt.format(Date(anchor - span)))
				put(fmt.format(Date(anchor - span / 2)))
				put(fmt.format(Date(anchor)))
			})
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "refreshAxis failed", t)
		}
	}

	private fun httpGet(url: String, header: String, value: String, timeoutMs: Int): String? {
		var conn: HttpURLConnection? = null
		return try {
			conn = URL(url).openConnection() as HttpURLConnection
			conn.requestMethod = "GET"
			conn.connectTimeout = timeoutMs
			conn.readTimeout = timeoutMs
			if (header.isNotEmpty() && value.isNotEmpty()) conn.setRequestProperty(header, value)
			if (conn.responseCode != 200) {
				Log.w(ECOWITT_WIDGET_TAG, "fetch: HTTP " + conn.responseCode + " " + url)
				return null
			}
			conn.inputStream.bufferedReader().use { it.readText() }
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "fetch: 请求异常 " + t.message)
			null
		} finally {
			try {
				conn?.disconnect()
			} catch (t: Throwable) {
				// ignore
			}
		}
	}
}

/**
 * 周期拉取。JobScheduler 会为它拉起进程，所以 App 被杀掉也照跑。
 *
 * onStartJob 在主线执行，网络必须在别的线程；返回 true 表示「活还没干完」，
 * 干完自己调 jobFinished。
 */
class EcowittFetchJobService : JobService() {

	override fun onStartJob(params: JobParameters?): Boolean {
		val context = applicationContext
		// 用户主动点的（点刷新图标）：不看兜底阈值
		val ignoreAge = try {
			params?.extras?.getBoolean(EXTRA_IGNORE_AGE, false) ?: false
		} catch (t: Throwable) {
			false
		}
		Thread {
			var ok = false
			try {
				ok = EcowittWidgetFetch.pull(context, ignoreAge)
			} catch (t: Throwable) {
				Log.w(ECOWITT_WIDGET_TAG, "fetch job failed", t)
			}
			if (ok) {
				EcowittWidgetRenderer.refreshAll(context)
			}
			// 不要求重试：周期任务下一轮自己会来，失败时急着重试只会连打接口。
			// params 理论上非空，但 java 平台类型允许 null，传进去会 NPE
			if (params != null) jobFinished(params, false)
		}.start()
		return true
	}

	/** 系统要收走任务（例如断网）：这次算了，下轮再说 */
	override fun onStopJob(params: JobParameters?): Boolean = true
}

// MARK: - uts 桥

/**
 * 所有方法返回 String：空串表示成功，非空是失败原因。
 * 这样 uts 侧只处理字符串，不用在 Kotlin/UTS 之间做对象转换。
 */
object EcowittWidgetBridge {

	/**
	 * 桌面上有没有这个小组件的实例。
	 * 查不到（异常 / 无权限）一律返回 true：宁可多刷一次，也不要错误地停掉更新。
	 */
	@JvmStatic
	fun hasWidgets(context: Context?): Boolean {
		if (context == null) return true
		return try {
			val manager = AppWidgetManager.getInstance(context)
			val component = ComponentName(context, EcowittWidgetProvider::class.java)
			manager.getAppWidgetIds(component).isNotEmpty()
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "hasWidgets failed", t)
			true
		}
	}

	@JvmStatic
	fun savePayloadJson(context: Context?, json: String?, widgetKind: String?): String {
		if (context == null) return "context is null"
		if (TextUtils.isEmpty(json)) return "payload is empty"
		return try {
			if (!EcowittWidgetStore.save(context, json!!)) {
				return "shared preferences write failed"
			}
			// 每次写盘都按最新的 fetch 段重设周期任务：间隔改了要立刻生效，
			// 关掉自拉取时这里会把它 cancel 掉
			EcowittWidgetFetch.schedule(context)
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

// ============================================================================
// MARK: - payload v3：参数驱动契约
// ============================================================================
//
// 与 iOS 的 WidgetPayloadV3 / EcowittWidgetViews 一一对应。
//
// 分工（和 v2 不同，别沿用旧逻辑）：
//   v2：App 决定放哪几个 block，Android 只画「标签 + 数值 + 图标」。
//   v3：一个卡片对应一个参数，结构固定在布局 XML 里，
//       但**文案、单位、数值全部由 App 侧格式化好放进 payload**，
//       Android 不重算单位、不补文案，拿到什么显示什么。
//
// 兼容：schemaVersion < 3 继续走上面的 v2 渲染，一行没动。

private const val V3_SCHEMA_MIN = 3

/** v3 主题 token，全部来自 payload */
// ============================================================================
// MARK: - payload v4（模块 / 读数驱动）
// ============================================================================

/**
 * 色值：iOS 侧是 #RRGGBB / #RRGGBBAA，Android 的 Color.parseColor 认 #AARRGGBB。
 * 8 位时要把 alpha 从末尾挪到最前。空串走兜底，绝不返回 0（0 是透明黑）。
 */
internal fun widgetColor(hex: String?, fallback: Int): Int {
	if (hex == null || hex.isEmpty()) return fallback
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

/**

 * JSONObject.optString 对显式 null 会返回字符串 "null"，直接显示就是界面上一个 null。

 * 这里统一清成空串，让上层走各自的兜底 / GONE。

 */

private fun clean(value: String?): String {

	if (value == null) return ""

	val t = value.trim()

	return if (t == "null" || t == "undefined") "" else value

}

/** 14 个色位：主题基础色 / 模块身份色 / 语义状态色，全部由 payload 下发 */
class EcowittWidgetV4Theme(root: JSONObject) {
	private val table: JSONObject? = root.optJSONObject("theme")

	private fun c(key: String, fallback: String): Int {
		val hex = table?.let { clean(it.optString(key)) }
		return widgetColor(if (hex.isNullOrEmpty()) fallback else hex, widgetColor(fallback, Color.GRAY))
	}

	val bg = c("bg", "#141a23")
	val ink = c("ink", "#f1f5f9")
	val muted = c("muted", "#a3b1c3")
	val well = c("well", "#202a37")
	val border = c("border", "#303e50")
	val temp = c("temp", "#fb7185")
	val water = c("water", "#38bdf8")
	val wind = c("wind", "#34d399")
	val pressure = c("pressure", "#a78bfa")
	val sun = c("sun", "#fbbf24")
	val up = c("up", "#ed7839")
	val down = c("down", "#09a8e6")
	val danger = c("danger", "#dd524d")
	val ok = c("ok", "#26d800")

	val appearance: String = if (root.optString("appearance") == "light") "light" else "dark"

	/** 模块身份色槽位 → 颜色。认不出的槽位退回 water，绝不返回 0 */
	fun accent(slot: String?): Int {
		return when (slot) {
			"temp" -> temp
			"water" -> water
			"wind" -> wind
			"pressure" -> pressure
			"sun" -> sun
			else -> water
		}
	}
}

/** 一行明细：label 左、值右 */
class V4Row(val label: String, val value: String, val unit: String) {
	fun text(): String = if (unit.isEmpty()) value else value + " " + unit
}

/** 视觉签名，8 种 kind（DESIGN-SPEC-v4 第 6 节） */
class V4Visual(
	val kind: String,
	val icon: String,
	val fill: Double,
	val bearing: Double,
	val ratio: Double,
	val pos: Double,
	val values: List<Double>,
	val level: Int,
	val inSmall: Boolean,
	val inline: Boolean
)

/** 一条可突出读数。变化量 / 极值 / 附带项都属于读数，不属于模块 */
class V4Reading(
	val key: String,
	val label: String,
	val value: String,
	val unit: String,
	val accent: String,
	val small: Boolean,
	val visual: V4Visual?,
	val deltaDir: Int,
	val deltaValue: String,
	val peakMax: String,
	val peakMin: String,
	val stateSlot: Boolean,
	val state: String,
	val attachText: String,
	val attach: V4Row?,
	val lines: List<V4Row>
)

/** 一个传感器模块 */
class V4Module(
	val key: String,
	val label: String,
	val icon: String,
	val accent: String,
	val series: List<Pair<Double, Double>>,
	val compact: String,
	val compactLabel: String,
	val rows: List<V4Row>,
	val readings: List<V4Reading>
) {
	/**
	 * 这个模块在 large 里显示哪条读数：feature 属于它就取它，否则用第一条。
	 * 规则 2/3，自己别直接用 —— 渲染走 EcowittWidgetV4.featuredReading（还含 featured 覆盖）。
	 */
	fun entry(featureUid: String): V4Reading? {
		if (readings.isEmpty()) return null
		if (featureUid.startsWith(key + ".")) {
			val wanted = featureUid.substring(key.length + 1)
			for (r in readings) {
				if (r.key == wanted) return r
			}
		}
		return readings[0]
	}

}

/**
 * payload v4 的只读视图。全部按路径取值 + 兜底，字段缺了不崩 ——
 * 旧 App + 新基座、新 App + 旧基座都可能出现。
 */
class EcowittWidgetV4 private constructor(private val root: JSONObject) {

	companion object {
		const val SCHEMA = 4
		fun fromJson(raw: String?): EcowittWidgetV4? {
			if (raw == null || raw.isEmpty()) return null
			return try {
				val obj = JSONObject(raw)
				if (obj.optInt("schemaVersion", 0) < SCHEMA) return null
				EcowittWidgetV4(obj)
			} catch (t: Throwable) {
				Log.w(ECOWITT_WIDGET_TAG, "payload v4 parse failed", t)
				null
			}
		}
	}

	// ---- 路径取值 ----

	private fun node(path: String): Any? {
		var cur: Any? = root
		for (part in path.split(".")) {
			val o = cur as? JSONObject ?: return null
			cur = o.opt(part) ?: return null
		}
		return cur
	}

	private fun obj(path: String): JSONObject? = node(path) as? JSONObject

	private fun arr(path: String): JSONArray? = node(path) as? JSONArray

	fun str(path: String, fallback: String = ""): String {
		val v = node(path) ?: return fallback
		return when (v) {
			is String -> if (v.isEmpty()) fallback else v
			is Number -> v.toString()
			is Boolean -> if (v) "true" else "false"
			else -> fallback
		}
	}

	fun dbl(path: String, fallback: Double = 0.0): Double {
		val v = node(path) ?: return fallback
		return when (v) {
			is Number -> v.toDouble()
			is String -> v.toDoubleOrNull() ?: fallback
			else -> fallback
		}
	}

	fun integer(path: String, fallback: Int = 0): Int = dbl(path, fallback.toDouble()).toInt()

	fun boolean(path: String, fallback: Boolean = false): Boolean {
		val v = node(path) ?: return fallback
		return v as? Boolean ?: fallback
	}

	// ---- token ----

	val theme: EcowittWidgetV4Theme = EcowittWidgetV4Theme(root)

	/** 字号：typography.<family>.<key>，key 可能是 value-sm 这种带横线的名字 */
	fun type(family: String, key: String, fallback: Float): Float {
		val v = obj("typography." + family)?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	fun shape(key: String, fallback: Float): Float {
		val v = obj("shape")?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	/** 视觉件尺寸：viz.<key> / vizXs.<key> */
	fun vizSize(xs: Boolean, key: String, fallback: Float): Float {
		val group = if (xs) "shape.vizXs" else "shape.viz"
		val v = obj(group)?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	/** 明细策略：shape.detail.<key>（heroRows / tileRows / inline） */
	fun detailInt(key: String, fallback: Int): Int {
		val v = obj("shape.detail")?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toInt()
	}

	fun detailBool(key: String, fallback: Boolean): Boolean {
		val o = obj("shape.detail") ?: return fallback
		return if (o.has(key)) o.optBoolean(key, fallback) else fallback
	}

	/** medium 左栏密度：shape.detail.medium.<key>（meta / attach 两个布尔开关） */
	fun detailMediumBool(key: String, fallback: Boolean): Boolean {
		val o = obj("shape.detail.medium") ?: return fallback
		return if (o.has(key)) o.optBoolean(key, fallback) else fallback
	}

	/** medium 极值档位：shape.detail.medium.peaks。缺字段或非法值一律回落 "both"（设计稿原样） */
	fun detailMediumPeaks(): String {
		val v = obj("shape.detail.medium")?.optString("peaks", "both") ?: "both"
		return if (v == "both" || v == "max" || v == "none") v else "both"
	}

	/** 各平台自己的外边距：shape.inset.<platform>，允许 0 */
	fun inset(platform: String, fallback: Float): Float {
		val v = obj("shape.inset")?.optDouble(platform, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	fun layoutSize(key: String, fallback: Float): Float {
		val v = obj("shape.layout")?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	fun planValue(key: String, fallback: Float): Float {
		val v = obj("shape.plan")?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	/** 字缩下限：shape.textShrink.<key>（1 = 不缩，Android 没有 minimumScaleFactor，当槽位下限用） */
	fun textShrink(key: String, fallback: Float): Float {
		val v = obj("shape.textShrink")?.optDouble(key, Double.NaN) ?: Double.NaN
		return if (v.isNaN()) fallback else v.toFloat()
	}

	/** 数字数组取值：shape.chart.gridRatios / dash 这类 */
	private fun dblArr(path: String, fallback: List<Float>): List<Float> {
		val a = arr(path) ?: return fallback
		if (a.length() == 0) return fallback
		val out = ArrayList<Float>(a.length())
		for (i in 0 until a.length()) {
			val v = a.optDouble(i, Double.NaN)
			if (v.isNaN()) return fallback
			out.add(v.toFloat())
		}
		return out
	}

	/**
	 * 曲线几何：shape.chart 整组下发（网格比例 / 线宽 / 虚线 / 圆点 / 采样留白 / 值域取景 / 最少点数）。
	 * 兜底值 = 设计稿 200×76 的换算值，字段缺了照样能画。
	 */
	val chartCfg: V4ChartCfg by lazy {
		V4ChartCfg(
			gridRatios = dblArr("shape.chart.gridRatios", listOf(20f / 76f, 48f / 76f)),
			lineW = dbl("shape.chart.lineW", 2.0).toFloat(),
			gridW = dbl("shape.chart.gridW", 0.5).toFloat(),
			dotR = dbl("shape.chart.dotR", 2.6).toFloat(),
			dash = dblArr("shape.chart.dash", listOf(2f, 4f)),
			padX = dbl("shape.chart.padX", 4.0).toFloat(),
			padY = dbl("shape.chart.padY", 8.0).toFloat(),
			padRatio = dbl("shape.chart.padRatio", 0.18).toFloat(),
			minPad = dbl("shape.chart.minPad", 0.6).toFloat(),
			minPoints = Math.max(2, integer("shape.chart.minPoints", 2))
		)
	}

	val icons: Map<String, String> by lazy {
		val out = HashMap<String, String>()
		val o = obj("icons")
		if (o != null) {
			val keys = o.keys()
			while (keys.hasNext()) {
				val k = keys.next()
				val d = clean(o.optString(k))
				if (!d.isNullOrEmpty()) out[k] = d
			}
		}
		out
	}

	fun iconD(name: String): String {
		return icons[name] ?: icons["temperature"] ?: ""
	}

	val uvScale: List<Int> by lazy {
		val out = ArrayList<Int>()
		val a = arr("shape.uvScale")
		if (a != null) {
			val n = a.length()
			for (i in 0 until n) {
				out.add(widgetColor(clean(a.optString(i)), Color.GRAY))
			}
		}
		out
	}

	// ---- 顶层字段 ----

	val station: String get() = str("station", "Weather Station")
	val brand: String get() = str("brand", "ecowitt")
	val updatedShort: String get() = str("updatedShort", "--:--")
	val statusText: String get() = str("status.text")
	val featureUid: String get() = str("selection.feature")
	val heroKey: String get() = str("selection.hero")

	/** 这份数据属于哪台设备；点组件时拼「回首页并切设备」的链接用 */
	val deviceId: String get() = str("deviceId")

	/** selection.featured：moduleKey -> readingKey。只收非空字符串对，取不到 = 空 map */
	val featured: Map<String, String> by lazy {
		val out = HashMap<String, String>()
		val o = obj("selection.featured") ?: return@lazy out
		val keys = o.keys()
		while (keys.hasNext()) {
			val key = keys.next()
			val value = clean(o.optString(key))
			if (key.isNotEmpty() && value.isNotEmpty()) out[key] = value
		}
		out
	}
	val emptyTitle: String get() = str("labels.noHistory", "Insufficient history")
	val emptyBody: String get() = str("labels.noTrend", "No generated trend")
	val footerLeft: String get() = str("footer.left", "Last 24h")

	val axis: List<String> by lazy {
		val out = ArrayList<String>()
		val a = arr("axis")
		if (a != null) {
			for (i in 0 until a.length()) out.add(clean(a.optString(i)))
		}
		out
	}

	// ---- 模块 ----

	val modules: List<V4Module> by lazy {
		val out = ArrayList<V4Module>()
		val a = arr("modules") ?: return@lazy out
		for (i in 0 until a.length()) {
			val m = a.optJSONObject(i) ?: continue
			val readings = ArrayList<V4Reading>()
			val ra = m.optJSONArray("readings")
			if (ra != null) {
				for (j in 0 until ra.length()) {
					val r = ra.optJSONObject(j) ?: continue
					readings.add(parseReading(r))
				}
			}
			if (readings.isEmpty()) continue
			out.add(
				V4Module(
					key = clean(m.optString("key")),
					label = clean(m.optString("label")),
					icon = clean(m.optString("icon")).ifEmpty { "temperature" },
					accent = clean(m.optString("accent")).ifEmpty { "temp" },
					series = parseSeries(m.optJSONArray("series")),
					compact = clean(m.optString("compact")),
					compactLabel = clean(m.optString("compactLabel")),
					rows = parseRows(m.optJSONArray("rows")),
					readings = readings
				)
			)
		}
		out
	}

	/** 突出项所在模块 + 读数；找不到退回第一个模块的第一条 */
	fun featureModule(): V4Module? {
		val uid = featureUid
		for (m in modules) {
			if (uid.startsWith(m.key + ".")) {
				val wanted = uid.substring(m.key.length + 1)
				for (r in m.readings) {
					if (r.key == wanted) return m
				}
			}
		}
		return modules.firstOrNull()
	}

	fun featureReading(): V4Reading? {
		val m = featureModule() ?: return null
		return m.entry(featureUid)
	}

	/**
	 * large 卡里某个模块该展示哪条读数 —— 渲染处唯一入口。
	 * 1. featured[module.key] 命中，且该模块确实有这条 reading → 用它
	 * 2. 该模块就是 feature 所属模块 → 用 feature 那条
	 * 3. 再否则 → module.readings[0]
	 * 2/3 就是 V4Module.entry 的语义，所以这里只补第 1 条。
	 * 与 iOS 的 WidgetPayloadV4.featuredReading(for:) 逐字一致。
	 */
	fun featuredReading(module: V4Module): V4Reading? {
		val explicit = featured[module.key]
		if (!explicit.isNullOrEmpty()) {
			for (r in module.readings) {
				if (r.key == explicit) return r
			}
		}
		return module.entry(featureUid)
	}

	/** large 的顺序：hero 在最前，其余保持模块数组原顺序 */
	fun orderedModules(): List<V4Module> {
		val list = ArrayList(modules)
		val idx = list.indexOfFirst { it.key == heroKey }
		if (idx > 0) {
			val hero = list.removeAt(idx)
			list.add(0, hero)
		}
		return list
	}

	// ---- 反序列化（全部容错） ----

	private fun parseSeries(a: JSONArray?): List<Pair<Double, Double>> {
		val out = ArrayList<Pair<Double, Double>>()
		if (a == null) return out
		for (i in 0 until a.length()) {
			val pair = a.optJSONArray(i) ?: continue
			if (pair.length() < 2) continue
			val t = pair.optDouble(0, 0.0)
			val v = pair.optDouble(1, 0.0)
			out.add(t to v)
		}
		return out
	}

	private fun parseRows(a: JSONArray?): List<V4Row> {
		val out = ArrayList<V4Row>()
		if (a == null) return out
		for (i in 0 until a.length()) {
			val o = a.optJSONObject(i) ?: continue
			out.add(V4Row(clean(o.optString("label")), clean(o.optString("value")), clean(o.optString("unit"))))
		}
		return out
	}

	private fun parseVisual(o: JSONObject?): V4Visual? {
		if (o == null) return null
		val kind = clean(o.optString("kind"))
		if (kind.isEmpty()) return null
		val values = ArrayList<Double>()
		val va = o.optJSONArray("values")
		if (va != null) {
			for (i in 0 until va.length()) values.add(va.optDouble(i, 0.0))
		}
		return V4Visual(
			kind = kind,
			icon = clean(o.optString("icon")),
			fill = o.optDouble("fill", 0.0),
			bearing = o.optDouble("bearing", 0.0),
			ratio = o.optDouble("ratio", -1.0),
			pos = o.optDouble("pos", 0.0),
			values = values,
			level = o.optInt("level", 0),
			inSmall = o.optBoolean("inSmall", false),
			inline = o.optBoolean("inline", true)
		)
	}

	private fun parseReading(r: JSONObject): V4Reading {
		val delta = r.optJSONObject("delta")
		val peak = r.optJSONObject("peak")
		val peakMax = peak?.optJSONObject("max")
		val peakMin = peak?.optJSONObject("min")
		val attach = r.optJSONObject("attach")
		return V4Reading(
			key = clean(r.optString("key")),
			label = clean(r.optString("label")),
			value = clean(r.optString("value")).ifEmpty { "—" },
			unit = clean(r.optString("unit")),
			accent = clean(r.optString("accent")).ifEmpty { "water" },
			small = r.optBoolean("small", false),
			visual = parseVisual(r.optJSONObject("visual")),
			deltaDir = delta?.optInt("dir", 0) ?: 0,
			deltaValue = clean(delta?.optString("value")),
			peakMax = clean(peakMax?.optString("value")),
			peakMin = clean(peakMin?.optString("value")),
			stateSlot = r.optBoolean("stateSlot", false),
			state = clean(r.optString("state")),
			attachText = clean(r.optString("attachText")),
			attach = if (attach == null) null else V4Row(
				clean(attach.optString("label")), clean(attach.optString("value")), clean(attach.optString("unit"))
			),
			lines = parseRows(r.optJSONArray("lines"))
		)
	}
}

/**
 * 曲线几何参数（payload 的 shape.chart）。默认值 = 设计稿 200×76 的换算值，
 * 由 EcowittWidgetV4.chartCfg 读下来，Painter 只管照着画。
 */
class V4ChartCfg(
	/** 网格线 y 位置，占可视高度的比例 */
	val gridRatios: List<Float> = listOf(20f / 76f, 48f / 76f),
	val lineW: Float = 2f,
	val gridW: Float = 0.5f,
	val dotR: Float = 2.6f,
	val dash: List<Float> = listOf(2f, 4f),
	/** 采样区左 / 上留白（viewBox 单位） */
	val padX: Float = 4f,
	val padY: Float = 8f,
	/** 值域取景：上下各留 padRatio 的跨度，最少留 minPad，避免平线贴边 */
	val padRatio: Float = 0.18f,
	val minPad: Float = 0.6f,
	/** 少于这么多点就走空图分支 */
	val minPoints: Int = 2
)

object EcowittWidgetPainter {

	/** iOS 侧重试的颜色是 #RRGGBB / #RRGGBBAA；Android 要 #AARRGGBB */
	fun parseColor(hex: String, fallback: Int): Int {
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

	private fun density(context: Context): Float {
		return try {
			context.resources.displayMetrics.density
		} catch (t: Throwable) {
			2f
		}
	}

	private fun dp(context: Context, value: Float): Int {
		return Math.max(1, (value * density(context)).toInt())
	}

	/**
	 * 趋势图。宽高比固定 200:76，由 ImageView 的 fitXY 拉伸到实际槽位。
	 *
	 * v4 的曲线只有一种形态：折线 + 末点圆点（DESIGN-SPEC-v4 第 3 节「只有 medium 与 hero 有曲线」）。
	 * v3 那套「雨量画柱状」的做法没有保留 —— 设计稿的雨量也走折线，柱状只在 reading 的
	 * `bars` 视觉件里出现（那是缩略图，不是曲线）。
	 */
	fun chart(
		context: Context,
		points: List<Pair<Double, Double>>,
		accent: Int,
		border: Int,
		cfg: V4ChartCfg
	): Bitmap? {
		if (points.size < cfg.minPoints) return null
		val width = dp(context, ChartGeometry.VIEW_W)
		val height = dp(context, ChartGeometry.VIEW_H)
		val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		canvas.scale(width / ChartGeometry.VIEW_W, height / ChartGeometry.VIEW_H)
		val xs = FloatArray(points.size)
		val ys = FloatArray(points.size)
		val plot = ChartGeometry.compute(points, xs, ys, cfg) ?: return null
		val paint = Paint(Paint.ANTI_ALIAS_FLAG)
		// 网格线：y 位置取 payload 的 gridRatios（占可视高度比例），虚线取 dash
		paint.style = Paint.Style.STROKE
		paint.color = border
		paint.strokeWidth = cfg.gridW
		if (cfg.dash.size >= 2) paint.pathEffect = DashPathEffect(cfg.dash.toFloatArray(), 0f)
		for (ratio in cfg.gridRatios) {
			val y = ratio * ChartGeometry.VIEW_H
			canvas.drawLine(0f, y, ChartGeometry.VIEW_W, y, paint)
		}
		// 分段：相邻点间隔超过 2 小时不连线，避免把空档画成一条假线
		val segments = ArrayList<ArrayList<Int>>()
		var current = ArrayList<Int>()
		segments.add(current)
		for (i in points.indices) {
			if (i > 0 && points[i].first - points[i - 1].first > 2 * 3600.0 * 1000.0) {
				current = ArrayList<Int>()
				segments.add(current)
			}
			current.add(i)
		}
		val linePaint = Paint(Paint.ANTI_ALIAS_FLAG)
		linePaint.style = Paint.Style.STROKE
		linePaint.color = accent
		linePaint.strokeWidth = cfg.lineW
		linePaint.strokeCap = Paint.Cap.ROUND
		linePaint.strokeJoin = Paint.Join.ROUND
		for (segment in segments) {
			if (segment.size < 2) continue
			val path = monotonePath(segment, xs, ys)
			if (path != null) canvas.drawPath(path, linePaint)
		}
		val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
		dotPaint.style = Paint.Style.FILL
		dotPaint.color = accent
		canvas.drawCircle(xs[points.size - 1], ys[points.size - 1], cfg.dotR, dotPaint)
		return bitmap
	}

	/**
	 * 曲线的坐标换算，抽出来是为了让预览/调试台能复用同一套（也方便对着设计稿算）。
	 * 归一化：x 在 padX..VIEW_W-padX，y 在 padY..VIEW_H-padY，两个边距都来自 payload 的 shape.chart。
	 */
	object ChartGeometry {
		/** 设计稿 viewBox，Bitmap 按这个比例画完再由 ImageView fitXY 拉伸 */
		const val VIEW_W = 200f
		const val VIEW_H = 76f

		fun compute(
			points: List<Pair<Double, Double>>,
			xs: FloatArray,
			ys: FloatArray,
			cfg: V4ChartCfg
		): Unit? {
			if (points.size < cfg.minPoints) return null
			var minV = points[0].second
			var maxV = points[0].second
			for (p in points) {
				if (p.second < minV) minV = p.second
				if (p.second > maxV) maxV = p.second
			}
			val pad = Math.max((maxV - minV) * cfg.padRatio.toDouble(), cfg.minPad.toDouble())
			minV -= pad
			maxV += pad
			val span = Math.max(maxV - minV, 0.0001)
			val x0 = points[0].first
			val x1 = points[points.size - 1].first
			val spanX = Math.max(x1 - x0, 1.0)
			val innerW = VIEW_W - cfg.padX * 2f
			val innerH = VIEW_H - cfg.padY * 2f
			val top = VIEW_H - cfg.padY
			for (i in points.indices) {
				xs[i] = cfg.padX + ((points[i].first - x0) / spanX).toFloat() * innerW
				ys[i] = top - ((points[i].second - minV) / span).toFloat() * innerH
			}
			return Unit
		}
	}

	/**
	 * 单调整三次插值。
	 * 斜率在**像素空间**里算（和 iOS 一样），否则 t 是毫秒、v 是数值，
	 * 两个量纲差几个数量级，切线会完全跑偏。
	 */
	private fun monotonePath(indices: List<Int>, xs: FloatArray, ys: FloatArray): Path? {
		val n = indices.size
		if (n < 2) return null
		val slopes = FloatArray(n - 1)
		for (i in 1 until n) {
			val dx = xs[indices[i]] - xs[indices[i - 1]]
			slopes[i - 1] = if (dx == 0f) 0f else (ys[indices[i]] - ys[indices[i - 1]]) / dx
		}
		val tangents = FloatArray(n)
		tangents[0] = slopes[0]
		tangents[n - 1] = slopes[n - 2]
		for (i in 1 until (n - 1)) {
			val a = slopes[i - 1]
			val b = slopes[i]
			tangents[i] = if (a * b <= 0f || a == 0f || b == 0f) 0f else 2f / (1f / a + 1f / b)
		}
		val path = Path()
		path.moveTo(xs[indices[0]], ys[indices[0]])
		for (i in 0 until (n - 1)) {
			val ax = xs[indices[i]]
			val ay = ys[indices[i]]
			val bx = xs[indices[i + 1]]
			val by = ys[indices[i + 1]]
			val dx = (bx - ax) / 3f
			path.cubicTo(
				ax + dx, ay + tangents[i] * dx,
				bx - dx, by - tangents[i + 1] * dx,
				bx, by
			)
		}
		return path
	}

	/** 风向罗盘：外圈 + N/E/S/W + 旋转箭头 */
	/**
	 * 风向罗盘。
	 *
	 * 两个参数是给紧凑档留的（瓦片里空间小）：
	 *   ticks     —— 只有默认档画 N/S/W/E，紧凑档不画（DESIGN-SPEC-v4 第 6 节）
	 *   arrowRatio —— 箭头占罗盘边长的比例。之前这里手搓一个 24% 高的三角形，
	 *                 实机上几乎看不清；现在改成用设计稿的 SVG 路径，默认 56%、紧凑档 70%
	 */
	fun compass(
		context: Context,
		bearing: Double,
		accent: Int,
		muted: Int,
		scale: Float = 1f,
		ticks: Boolean = true,
		arrowRatio: Float = 0.56f
	): Bitmap {
		// 罗盘尺寸跟着盒子高度缩放：矮盒子里 48dp 会顶掉相邻块
		val size = dp(context, 48f * scale)
		val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG)
		ringPaint.style = Paint.Style.STROKE
		ringPaint.strokeWidth = dp(context, 1f).toFloat()
		ringPaint.color = (accent and 0x00FFFFFF) or (0x4D shl 24) // 30% alpha
		canvas.drawCircle(size / 2f, size / 2f, (size / 2f) - ringPaint.strokeWidth, ringPaint)
		if (ticks) {
			val label = Paint(Paint.ANTI_ALIAS_FLAG)
			label.color = muted
			label.textSize = size * 0.15f
			label.textAlign = Paint.Align.CENTER
			val cy = size / 2f
			val edge = size * 0.28f
			canvas.drawText("N", size / 2f, cy - edge, label)
			canvas.drawText("S", size / 2f, cy + edge + label.textSize * 0.8f, label)
			canvas.drawText("W", size / 2f - edge, cy + label.textSize * 0.35f, label)
			canvas.drawText("E", size / 2f + edge, cy + label.textSize * 0.35f, label)
		}
		// 箭头：设计稿的 arrow 路径（stroke + fill:none），整张按 bearing + 180 旋转。
		// 气象惯例：bearing 是风的**来源**方位，箭头要指向气流去向。
		val d = SvgIcons.paths["arrow"] ?: "M12 2L21 21L12 16L3 21Z"
		val arrowPx = size * arrowRatio
		val arrow = Paint(Paint.ANTI_ALIAS_FLAG)
		arrow.style = Paint.Style.STROKE
		arrow.color = accent
		arrow.strokeWidth = arrowPx / 24f * 1.6f
		arrow.strokeCap = Paint.Cap.ROUND
		arrow.strokeJoin = Paint.Join.ROUND
		canvas.save()
		canvas.rotate(bearing.toFloat() + 180f, size / 2f, size / 2f)
		canvas.drawPath(SvgIcons.toPath(d, arrowPx, size / 2f, size / 2f), arrow)
		canvas.restore()
		return bitmap
	}

	/**
	 * HTML 里那套 SVG 图标，直接用 Canvas 画出来。
	 *
	 * 之前用的是手搓的 vector drawable，形状和设计稿对不上（温度计、风、气压针都走了样）。
	 * 这里把 `docx/Ecowitt-Widgets.html` 里 `paths` 对象的 d 串原样搬过来，
	 * viewBox 是 0 0 24 24，描边宽度 1.6、圆头圆角，和 HTML 的 CSS 一致。
	 */
	object SvgIcons {
		val paths = mapOf(
			"temperature" to "M10 3a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0Z M12 8v9",
			"humidity" to "M12 2C9 7 5 10 5 14a7 7 0 0 0 14 0c0-4-4-7-7-12Z M9 16l6-6",
			"wind" to "M3 8h12a3 3 0 1 0-3-3 M3 12h16a3 3 0 1 1-3 3 M3 16h5",
			"rainfall" to "M12 2C9 7 6 11 6 15a6 6 0 0 0 12 0c0-4-3-8-6-13Z",
			"pressure" to "M4 19a9 9 0 1 1 16 0 M12 13l5-5 M6 16h12",
			"sun" to "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
			"house" to "M3 11l9-8 9 8 M5 10v11h14V10 M10 21v-7h4v7",
			"arrow" to "M12 2L21 21L12 16L3 21Z",
			"chart" to "M3 3v18h18 M6 15l5-5 4 3 6-8"
		)
		/** 把 viewBox 0..24 的路径映射到以 (cx,cy) 为中心、边长 size 的方块里 */
		fun toPath(d: String, size: Float, cx: Float, cy: Float): Path {
			val k = size / 24f
			val ox = cx - size / 2f
			val oy = cy - size / 2f
			val path = Path()
			val tokens = Regex("[MmLlHhVvCcAaZz]|-?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?")
				.findAll(d).map { it.value }.toList()
			var i = 0
			var curX = 0f
			var curY = 0f
			var startX = 0f
			var startY = 0f
			var cmd = ' '
			fun num(): Float = tokens[i++].toFloat()
			fun px(v: Float) = ox + v * k
			fun py(v: Float) = oy + v * k
			while (i < tokens.size) {
				if (tokens[i].length == 1 && tokens[i][0].isLetter()) {
					cmd = tokens[i][0]
					i++
				}
				val relative = cmd.isLowerCase()
				when (cmd.uppercaseChar()) {
					'M' -> {
						val x = num(); val y = num()
						curX = if (relative) curX + x else x
						curY = if (relative) curY + y else y
						path.moveTo(px(curX), py(curY))
						startX = curX; startY = curY
					}
					'L' -> {
						val x = num(); val y = num()
						curX = if (relative) curX + x else x
						curY = if (relative) curY + y else y
						path.lineTo(px(curX), py(curY))
					}
					'H' -> {
						val x = num()
						curX = if (relative) curX + x else x
						path.lineTo(px(curX), py(curY))
					}
					'V' -> {
						val y = num()
						curY = if (relative) curY + y else y
						path.lineTo(px(curX), py(curY))
					}
					'C' -> {
						val x1 = num(); val y1 = num(); val x2 = num(); val y2 = num()
						val x = num(); val y = num()
						val c1x = if (relative) curX + x1 else x1
						val c1y = if (relative) curY + y1 else y1
						val c2x = if (relative) curX + x2 else x2
						val c2y = if (relative) curY + y2 else y2
						curX = if (relative) curX + x else x
						curY = if (relative) curY + y else y
						path.cubicTo(px(c1x), py(c1y), px(c2x), py(c2y), px(curX), py(curY))
					}
					'A' -> {
						val rx = num(); val ry = num(); num() // x-axis-rotation，本文件里全是 0
						val largeArc = num() != 0f
						val sweep = num() != 0f
						val dx = num(); val dy = num()
						val toX = if (relative) curX + dx else dx
						val toY = if (relative) curY + dy else dy
						arcTo(path, curX, curY, toX, toY, rx, ry, largeArc, sweep, ::px, ::py)
						curX = toX; curY = toY
					}
					'Z' -> {
						path.close()
						curX = startX; curY = startY
					}
					else -> i++ // 不认识的指令直接跳过，别死循环
				}
			}
			return path
		}
		/**
		 * SVG 端点式圆弧 -> Android 的弧。
		 * 本文件的弧 x-axis-rotation 全是 0，所以不用处理旋转矩阵。
		 */
		private fun arcTo(
			path: Path,
			x0: Float, y0: Float, x1: Float, y1: Float,
			rxIn: Float, ryIn: Float,
			largeArc: Boolean, sweep: Boolean,
			px: (Float) -> Float, py: (Float) -> Float
		) {
			if (rxIn == 0f || ryIn == 0f) {
				path.lineTo(px(x1), py(y1))
				return
			}
			var rx = Math.abs(rxIn)
			var ry = Math.abs(ryIn)
			val dx2 = (x0 - x1) / 2f
			val dy2 = (y0 - y1) / 2f
			val lambda = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry)
			if (lambda > 1f) {
				val s = Math.sqrt(lambda.toDouble()).toFloat()
				rx *= s; ry *= s
			}
			val num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2
			val den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2
			val coef = (if (largeArc == sweep) -1 else 1) *
				Math.sqrt(Math.max(0.0, (num / den).toDouble())).toFloat()
			val cxp = coef * rx * dy2 / ry
			val cyp = -coef * ry * dx2 / rx
			val cx = cxp + (x0 + x1) / 2f
			val cy = cyp + (y0 + y1) / 2f
			fun angle(ux: Float, uy: Float, vx: Float, vy: Float): Float {
				val dot = ux * vx + uy * vy
				val len = Math.sqrt((ux * ux + uy * uy).toDouble()).toFloat() *
					Math.sqrt((vx * vx + vy * vy).toDouble()).toFloat()
				var a = Math.acos((dot / len).coerceIn(-1f, 1f).toDouble()).toFloat()
				if (ux * vy - uy * vx < 0) a = -a
				return a
			}
			val ux = (dx2 - cxp) / rx
			val uy = (dy2 - cyp) / ry
			val vx = (-dx2 - cxp) / rx
			val vy = (-dy2 - cyp) / ry
			val theta1 = angle(1f, 0f, ux, uy)
			var dTheta = angle(ux, uy, vx, vy)
			if (!sweep && dTheta > 0) dTheta -= (2 * Math.PI).toFloat()
			if (sweep && dTheta < 0) dTheta += (2 * Math.PI).toFloat()
			val rect = RectF(px(cx - rx), py(cy - ry), px(cx + rx), py(cy + ry))
			path.arcTo(rect, Math.toDegrees(theta1.toDouble()).toFloat(),
				Math.toDegrees(dTheta.toDouble()).toFloat(), false)
		}
	}

	// ---- v4 的视觉件：全部画成 Bitmap，尺寸取 payload 的 shape.viz / shape.vizXs ----

	/**
	 * 线描图标：路径来自 payload 的 icons（24×24，stroke 1.6，圆头圆角）。
	 * 与 v3 的区别是不再从 SvgIcons.paths 里查表 —— 图标表跟着 payload 走，加图标不用重编基座。

	 */
	fun glyph(context: Context, d: String, color: Int, sizeDp: Float): Bitmap {

		val size = dp(context, Math.max(1f, sizeDp))
		val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
		if (d.isEmpty()) return bitmap
		try {
			val canvas = Canvas(bitmap)
			val paint = Paint(Paint.ANTI_ALIAS_FLAG)
			paint.style = Paint.Style.STROKE
			paint.color = color
			paint.strokeWidth = size / 24f * 1.6f
			paint.strokeCap = Paint.Cap.ROUND
			paint.strokeJoin = Paint.Join.ROUND
			canvas.drawPath(SvgIcons.toPath(d, size.toFloat(), size / 2f, size / 2f), paint)
		} catch (t: Throwable) {
			Log.w(ECOWITT_WIDGET_TAG, "draw glyph failed", t)
		}
		return bitmap

	}

	/**

	 * 环形填充（湿度 / 土壤）。中间可以再叠一个图标。

	 * stroke 宽度 = inset，和 CSS 的 inset: var(--ring-inset) 等价。

	 */

	fun ringSized(

		context: Context,
		percent: Double,
		accent: Int,
		well: Int,
		sizeDp: Float,
		insetDp: Float,
		iconD: String,
		iconColor: Int,
		iconSizeDp: Float

	): Bitmap {

		val size = dp(context, Math.max(2f, sizeDp))
		val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val stroke = dp(context, Math.max(1f, insetDp)).toFloat()
		val half = stroke / 2f
		val rect = RectF(half, half, size - half, size - half)
		val track = Paint(Paint.ANTI_ALIAS_FLAG)
		track.style = Paint.Style.STROKE
		track.strokeWidth = stroke
		track.color = well
		canvas.drawArc(rect, 0f, 360f, false, track)
		val sweep = (Math.max(0.0, Math.min(100.0, percent)) / 100.0 * 360.0).toFloat()
		if (sweep > 0f) {
			val arc = Paint(Paint.ANTI_ALIAS_FLAG)
			arc.style = Paint.Style.STROKE
			arc.strokeWidth = stroke
			arc.color = accent
			canvas.drawArc(rect, -90f, sweep, false, arc)
		}
		if (iconD.isNotEmpty()) {
			val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
			iconPaint.style = Paint.Style.STROKE
			iconPaint.color = iconColor
			val iconPx = dp(context, Math.max(4f, iconSizeDp)).toFloat()
			iconPaint.strokeWidth = iconPx / 24f * 1.6f
			iconPaint.strokeCap = Paint.Cap.ROUND
			iconPaint.strokeJoin = Paint.Join.ROUND
			try {
				canvas.drawPath(SvgIcons.toPath(iconD, iconPx, size / 2f, size / 2f), iconPaint)
			} catch (t: Throwable) {
				// 图标画不出来就只留环，不影响读数
			}
		}
		return bitmap

	}

	fun gauge(context: Context, ratio: Double, accent: Int, ink: Int, widthDp: Float): Bitmap {
		val w = dp(context, Math.max(8f, widthDp))
		val h = Math.max(4, w * 54 / 100)
		val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		// s 按 104 算而不是 100：弧的描边宽是 4s，压在位图边界上会被裁掉右侧
		val s = w / 104f
		val cx = w / 2f
		val cy = h * 50f / 54f
		val rect = RectF(cx - 46 * s, cy - 46 * s, cx + 46 * s, cy + 46 * s)
		val arc = Paint(Paint.ANTI_ALIAS_FLAG)
		arc.style = Paint.Style.STROKE
		arc.strokeWidth = 4 * s
		arc.color = (accent and 0x00FFFFFF) or (0x57 shl 24) // 34%：22% 在深色底上等于看不见
		canvas.drawArc(rect, 180f, 180f, false, arc)
		val r = Math.max(0.0, Math.min(1.0, ratio))
		if (r > 0.0) {
			val fill = Paint(Paint.ANTI_ALIAS_FLAG)
			fill.style = Paint.Style.STROKE
			fill.strokeWidth = 4 * s
			fill.color = accent
			fill.strokeCap = Paint.Cap.ROUND
			canvas.drawArc(rect, 180f, (180.0 * r).toFloat(), false, fill)
		}
		val angle = Math.PI - Math.PI * r
		val needle = Paint(Paint.ANTI_ALIAS_FLAG)
		needle.style = Paint.Style.STROKE
		needle.strokeWidth = Math.max(1f, 1.6f * s)
		needle.color = ink
		needle.strokeCap = Paint.Cap.ROUND
		canvas.drawLine(
			cx, cy,
			cx + (32 * Math.cos(angle)).toFloat() * s, cy - (32 * Math.sin(angle)).toFloat() * s,
			needle
		)
		return bitmap

	}

	/** UV 光谱条：5 段物理刻度色 + 一个刻度游标 */

	fun uvBar(

		context: Context,
		posPercent: Double,
		colors: List<Int>,
		ink: Int,
		bg: Int,
		widthDp: Float

	): Bitmap {

		val w = dp(context, Math.max(8f, widthDp))
		val h = dp(context, 14f)
		val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val barH = dp(context, 6f).toFloat()
		val top = h / 2f - barH / 2f
		val palette = if (colors.size >= 2) colors else listOf(
			Color.parseColor("#19996F"), Color.parseColor("#D7A212"), Color.parseColor("#DB7821"),
			Color.parseColor("#D34A57"), Color.parseColor("#9751B7")
		)
		// 逐段铺色，比 LinearGradient 更接近 CSS 的 linear-gradient（停点明确）
		val segment = w.toFloat() / (palette.size - 1)
		val paint = Paint(Paint.ANTI_ALIAS_FLAG)
		for (i in 0 until palette.size - 1) {
			paint.color = palette[i]
			canvas.drawRect(i * segment, top, (i + 1) * segment + 1f, top + barH, paint)
		}
		val cursorW = dp(context, 4f).toFloat()
		val cx = (w * Math.max(0.0, Math.min(100.0, posPercent)) / 100.0).toFloat() - cursorW / 2f
		val cursor = Paint(Paint.ANTI_ALIAS_FLAG)
		cursor.color = ink
		canvas.drawRect(cx, 0f, cx + cursorW, h.toFloat(), cursor)
		val edge = Paint(Paint.ANTI_ALIAS_FLAG)
		edge.style = Paint.Style.STROKE
		edge.strokeWidth = dp(context, 1f).toFloat()
		edge.color = bg
		canvas.drawRect(cx, 0f, cx + cursorW, h.toFloat(), edge)
		return bitmap

	}

	/** 柱状缩略（雨强 / PM）：末两根不透明，其余压到 50% */

	fun bars(context: Context, values: List<Double>, accent: Int, widthDp: Float, heightDp: Float): Bitmap {

		val w = dp(context, Math.max(8f, widthDp))
		val h = dp(context, Math.max(6f, heightDp))
		val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		if (values.isEmpty()) return bitmap
		// maxOrNull() 从 Kotlin 1.4 就有；max() 在 1.7 起被标成 HIDDEN，
		// 云端打包的 Kotlin 比 HBuilderX 自带的严格，会直接报「没有可用候选」
		val maxV = Math.max(values.maxOrNull() ?: 1.0, 0.001)
		val gap = dp(context, 2f).toFloat()
		val barW = dp(context, 4f).toFloat()
		var x = 0f
		for (i in values.indices) {
			val ratio = Math.max(0.08, values[i] / maxV)
			val barH = (h * ratio).toFloat()
			val paint = Paint(Paint.ANTI_ALIAS_FLAG)
			paint.color = accent
			paint.alpha = if (i >= values.size - 2) 255 else 128
			canvas.drawRoundRect(RectF(x, h - barH, x + barW, h.toFloat()), 1f, 1f, paint)
			x += barW + gap
		}
		return bitmap

	}

	/** 光圈（光照）：细描边圆 + 居中图标 */

	fun sun(context: Context, d: String, accent: Int, sizeDp: Float): Bitmap {

		val size = dp(context, Math.max(8f, sizeDp))
		val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val ring = Paint(Paint.ANTI_ALIAS_FLAG)
		ring.style = Paint.Style.STROKE
		ring.strokeWidth = dp(context, 1f).toFloat()
		ring.color = (accent and 0x00FFFFFF) or (0x6B shl 24)
		val inset = ring.strokeWidth / 2f
		canvas.drawOval(RectF(inset, inset, size - inset, size - inset), ring)
		if (d.isNotEmpty()) {
			val iconPx = size * 0.6f
			val paint = Paint(Paint.ANTI_ALIAS_FLAG)
			paint.style = Paint.Style.STROKE
			paint.color = accent
			paint.strokeWidth = iconPx / 24f * 1.6f
			paint.strokeCap = Paint.Cap.ROUND
			paint.strokeJoin = Paint.Join.ROUND
			try {
				canvas.drawPath(SvgIcons.toPath(d, iconPx, size / 2f, size / 2f), paint)
			} catch (t: Throwable) {
				// 忽略
			}
		}
		return bitmap

	}

	/**

	 * 电池：外框 + 5 格 + 右侧电极。空格中性淡底，满格绿，≤1 格转告警红。

	 * 外框与电极用 ink 中性色，不跟模块强调色走（DESIGN-SPEC-v4 第 6 节）。

	 */

	fun battery(
		context: Context,
		level: Int,
		ok: Int,
		danger: Int,
		ink: Int,
		heightDp: Float,
		cellWidthDp: Float = 2f,
		cellGapDp: Float = 2f
	): Bitmap {
		val h = dp(context, Math.max(6f, heightDp))
		// 格宽/间隙走 payload 的 shape.layout：之前写死 4dp/2dp，图标被拉成 2.9:1 的细长条
		val cellW = dp(context, Math.max(1f, cellWidthDp))
		val cellGap = dp(context, Math.max(1f, cellGapDp))
		val pad = dp(context, 2f)
		val nub = dp(context, 2f)
		val cellsW = cellW * 5 + cellGap * 4 + pad * 2
		val w = cellsW + nub + dp(context, 2f)
		val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val lvl = Math.max(0, Math.min(5, level))
		val low = lvl <= 1
		val frame = Paint(Paint.ANTI_ALIAS_FLAG)
		frame.style = Paint.Style.STROKE
		frame.strokeWidth = dp(context, 1f).toFloat()
		frame.color = (ink and 0x00FFFFFF) or (0x6B shl 24)
		val fw = frame.strokeWidth / 2f
		canvas.drawRoundRect(RectF(fw, fw, cellsW - fw, h - fw), 2f, 2f, frame)
		val cellTop = pad.toFloat()
		val cellH = (h - pad * 2).toFloat()
		for (i in 0 until 5) {
			val left = (pad + i * (cellW + cellGap)).toFloat()
			val paint = Paint(Paint.ANTI_ALIAS_FLAG)
			paint.color = if (i < lvl) (if (low) danger else ok) else ((ink and 0x00FFFFFF) or (0x24 shl 24))
			canvas.drawRoundRect(RectF(left, cellTop, left + cellW, cellTop + cellH), 1f, 1f, paint)
		}
		val nubPaint = Paint(Paint.ANTI_ALIAS_FLAG)
		nubPaint.color = (ink and 0x00FFFFFF) or (0x6B shl 24)
		val nubH = h * 0.44f
		canvas.drawRect(cellsW.toFloat() + dp(context, 1f), h / 2f - nubH / 2f,
			cellsW.toFloat() + dp(context, 1f) + nub, h / 2f + nubH / 2f, nubPaint)
		return bitmap

	}

}

// ============================================================================
// MARK: - v4 渲染
// ============================================================================

/**
 * large 的布局决策（Android 版）。
 *
 * 与 iOS 的区别：iOS 能实测每块的真实高度，Android 的 RemoteViews 拿不到，
 * 所以这里的「块高」是按内容估的（标题 14 + 数值 18 + 每行明细 12 + 上下内边距 16）。
 * 它决定的是**能铺几行瓦片、每格几行明细、要不要折叠末尾模块**，
 * 不决定像素高度 —— 高度由 wrap_content 自己长，盒子太矮时靠 applyContentBudget 继续砍。
 */
private class V4Plan(
	val shown: Int,
	val hidden: Int,
	val cols: Int,
	val heroRows: Int,
	val tileRows: Int,
	/** 内容区可用高度（dp） */
	val budget: Float = 0f,
	/** 按当前模块数估算的内容总高（dp） */
	val contentH: Float = 0f
) {
}

object EcowittWidgetV4Renderer {

	/** 明细行槽位上限：hero 6 行 / 瓦片 4 行，取大值作为「隐藏多余槽位」的遍历上界 */
	private const val ROW_SLOTS = 6

	/** 大卡整体缩小的下限：只有缺口很小（≤5%）才靠缩字解决，缺口大了整行折叠更划算 ——
	 *  瓦片的 padding / minHeight 是 dp 常量，缩字压不下这些高度，硬缩只会溢出。 */
	private const val MIN_FIT = 0.95f

	private val idCache = HashMap<String, Int>()

	fun resId(context: Context, name: String, type: String): Int {
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

	// ---- RemoteViews 小工具 ----

	private fun setText(views: RemoteViews, context: Context, name: String, value: String) {
		val id = resId(context, name, "id")
		if (id != 0) views.setTextViewText(id, value)
	}

	private fun setColor(views: RemoteViews, context: Context, name: String, color: Int) {
		val id = resId(context, name, "id")
		if (id != 0) views.setTextColor(id, color)
	}

	private fun setVisible(views: RemoteViews, context: Context, name: String, visible: Boolean) {
		val id = resId(context, name, "id")
		if (id != 0) views.setViewVisibility(id, if (visible) View.VISIBLE else View.GONE)
	}

	private fun setBitmap(views: RemoteViews, context: Context, name: String, bitmap: Bitmap?) {
		val id = resId(context, name, "id")
		if (id == 0) return
		if (bitmap == null) {
			views.setViewVisibility(id, View.GONE)
		} else {
			views.setViewVisibility(id, View.VISIBLE)
			views.setImageViewBitmap(id, bitmap)
		}
	}

	/**
	 * 当前这次渲染的等比缩放系数。
	 *
	 * 布局是固定 dp 画的，盒子比设计小时不会自己收缩，超出就裁掉（数字被切、整块不见）。
	 * build() 每次渲染前按实际占位算出系数，setSize 统一乘上去。
	 */
	private var textScale = 1f

	/**
	 * 字号。整卡只有一个缩放系数 `textScale`（实测占位 / 设计画布），逐槽位字缩在 Android 上做不到。
	 *
	 * `floor`（payload 的 shape.textShrink.*）**不参与计算**，只保留读取以便两端字段名对齐：
	 * 试过 `max(textScale, floor)` 当下界 —— 短盒子（medium 实测只有设计的 47%）被强行托到 0.8，
	 * 字比原来还大、内容装不下、最后一行被切成半截，整卡的等比缩放适应直接失效。
	 * 逐槽位字缩只对 iOS 的 minimumScaleFactor 成立；Android 走整卡等比缩放这条老路。
	 */
	private fun setSize(views: RemoteViews, context: Context, name: String, dp: Float, floor: Float = 0f) {
		val id = resId(context, name, "id")
		if (id != 0) {
			// 必须用 COMPLEX_UNIT_DIP，不能用 setTextSize(float)。
			// 后者单位是 SP，会再乘一次系统的字体缩放系数（用户把系统字号调大就放大），
			// 于是 textScale 想缩到 0.8 会被系统放大回去，块内装不下就裁切。
			val owned = if (floor > 0f) Math.max(textScale, floor) else textScale
			views.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_DIP, dp * owned)
		}
	}

	/** View.setBackgroundResource(int) 是 int 入参的公开方法，RemoteViews 反射能调 */
	private fun setBackgroundDrawable(
		views: RemoteViews,
		context: Context,
		name: String,
		drawableName: String
	) {
		val id = resId(context, name, "id")
		if (id == 0) return
		val drawable = resId(context, drawableName, "drawable")
		if (drawable == 0) return
		views.setInt(id, "setBackgroundResource", drawable)
	}

	private fun backgroundFor(appearance: String): String {
		return if (appearance == "light") "ecowitt_widget_bg_light" else "ecowitt_widget_bg_dark"
	}

	private fun wellFor(appearance: String): String {
		return if (appearance == "light") "ecowitt_widget_well_light" else "ecowitt_widget_well_dark"
	}

	// ---- 尺寸：这一整段是 v3 实机调出来的，别重写 ----

	private fun densityOf(context: Context): Float {
		return try {
			context.resources.displayMetrics.density
		} catch (t: Throwable) {
			2f
		}
	}

	private fun dpOf(context: Context, value: Float): Int {
		return Math.max(1, Math.round(value * densityOf(context)))
	}

	/**
	 * 读当前实际占位尺寸（dp）。
	 *
	 * 只能用 MIN_WIDTH / MIN_HEIGHT：Android 上这对值就是「当前方向下的实际尺寸」，
	 * 而 MAX_* 是另一个方向（横屏）的尺寸。取 max 会把小盒子判成大盒子，
	 * 结果是大布局塞进小盒子、内容整块被裁。
	 */
	private fun measureDp(manager: AppWidgetManager, widgetId: Int): Pair<Int, Int> {
		return try {
			val options = manager.getAppWidgetOptions(widgetId)
			val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
			val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
			val maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
			val maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
			val w = if (minW > 0) minW else maxW
			val h = if (minH > 0) minH else maxH
			w to h
		} catch (t: Throwable) {
			0 to 0
		}
	}

	/**
	 * 缩放基准 = **布局的原始设计尺寸**，不是期望的盒子尺寸。
	 *
	 * 尺寸取 payload 的 canvas.<tier>（三端共用的设计画布），读不到才回落
	 * 170×170 / 364×170 / 364×382 —— 也就是三个 XML 写死的原始尺寸。
	 * 拿实测盒子（313×67、376×202）当基准的话 scale 会算成 1.0，字号一点不缩，
	 * 而布局整体是按两倍高写的 —— 结果每块只分到一半高度，文字上下被裁、数值整个消失。
	 */
	private fun designSize(payload: EcowittWidgetV4, size: String): Pair<Int, Int> {
		val fallback = when (size) {
			"small" -> 170 to 170
			"large" -> 364 to 382
			else -> 364 to 170
		}
		val w = payload.integer("canvas." + size + ".w", fallback.first)
		val h = payload.integer("canvas." + size + ".h", fallback.second)
		return (if (w > 0) w else fallback.first) to (if (h > 0) h else fallback.second)
	}

	/**
	 * 实际尺寸 / 设计画布 = 等比缩放系数。
	 *
	 * **只缩不放**：上限固定 1.0。盒子比画布大时放大字号看着更饱满，但横向是
	 * wrap_content，一放大就撑破；纵向按内容分配，字一高就把下一块顶掉。
	 * 下限 0.4：扁盒子里 medium 只有 67dp 高、布局是按 170 写的，需要缩到 0.39 才装得下。
	 */
	private fun computeScale(actualW: Int, actualH: Int, designW: Int, designH: Int): Float {
		if (actualW <= 0 || actualH <= 0 || designW <= 0 || designH <= 0) return 1f
		val w = actualW.toFloat() / designW
		val h = actualH.toFloat() / designH
		return Math.max(0.4f, Math.min(1f, Math.min(w, h)))
	}

	/**
	 * 尺寸分档：按**形状**分档，不看绝对 dp（各 launcher 的格高差别太大）。
	 *
	 * 实测这台三星：small 156×156、medium 313×67、large 376×202。
	 *   ratio >= 1.6         → medium（横向拉长）
	 *   height >= 240        → large（4×4 整站盒子；2×2 到不了 240）
	 *   其余（正方/近正方）  → small
	 * 之前 large 写成 ratio <= 0.9，结果 376×314 的大正方形两边都不满足，
	 * 掉进兜底被当成单参数卡，四周全空 —— 实机测出来的。
	 */
	private fun sizeKey(manager: AppWidgetManager, widgetId: Int): String {
		val sizes = measureDp(manager, widgetId)
		val widthDp = sizes.first
		val heightDp = sizes.second
		if (widthDp <= 0 || heightDp <= 0) return "medium"
		val ratio = widthDp.toFloat() / heightDp.toFloat()
		return when {
			// 1.6 是 v3 按 313x67 的极扁条标定的；实测用户会把 2x2 拉到 254x182（1.40），
			// 那时按 old 规则会掉进 small，于是方形的单参数卡被横着拉宽、右边空一半。
			// 设计上 small 是 1:1，只要明显横向就先按 medium 排。
			ratio >= 1.3f -> "medium"
			heightDp >= 240 -> "large"
			else -> "small"
		}
	}

	/**
	 * large 的铺格子决策。
	 *
	 * budget 用实测高度减去 padding / 站名行 / 间距；
	 * 块高按内容估：hero = 16 + 20 + 24 + 12 + heroRows*12 + 48（曲线）；
	 * 瓦片 = 16 + 14 + 18 + tileRows*12。
	 */
	private fun planFor(payload: EcowittWidgetV4, count: Int, widthDp: Int, heightDp: Int): V4Plan {
		if (count <= 0) return V4Plan(0, 0, 2, 0, 0)
		// 预算用**实测**高度：安卓的整站盒子比设计画布矮一半，照抄 shape.plan.budget 会溢出。
		// shape.plan 里的下界常量是跨端共用的，这里直接用，避免两端各写一套魔数。
		val heroMin = payload.planValue("heroMin", 88f)
		val tileMin = payload.planValue("tileMin", 48f)
		// 分区间距 = shape.cardGapLarge（iOS 的 VStack spacing 是同一个值，payload 只发一份）
		val gap = payload.shape("cardGapLarge", 6f)
		val budget = Math.max(60, (heightDp - 24 - 16 - gap).toInt())
		// 列数：格子宽 >= 96dp 才放得下「Piezo rain 0.4 mm/h」这类明细
		var cols = 1
		for (c in 3 downTo 1) {
			val usable = widthDp - 24 - gap * (c - 1)
			if (usable / c >= 96) {
				cols = c
				break
			}
		}
		// 只有两个模块：整宽单个瓦片（安卓盒子太矮，摆不下两块并排的大卡）
		if (count == 2) cols = 1
		// 3 列只在模块多、且宽度真的够时才用
		if (cols == 3 && count <= 6) cols = 2
		// 布局能放几行明细（用户要看几行由 payload 的 shape.detail 决定，两者取小）
		// 布局能放几行 × payload 用户要看几行，取小 —— 估算必须用**实际会画出来的行数**。
		// DETAIL.heroRows 默认 0（不画明细行），那条 heroH 公式里的 heroRows*12 就是白留的，
		// 12dp 足以让 344×281 那档的第二行瓦片差 7dp 装不下、被整行砍掉。
		val heroRows = Math.min(
			if (budget >= 260) 2 else if (budget >= 150) 1 else 0,
			payload.detailInt("heroRows", 0)
		)
		// hero 最多占半个大卡：上限取 payload 的 shape.plan.heroCap（与 iOS 的 WidgetPlan 同一口径）
		val heroCap = payload.planValue("heroCap", 164f)
		// 盒子矮的时候曲线矮一档，把高度让给瓦片（否则只能铺 1 行）
		val rawHeroH = 16 + 20 + 24 + 12 + heroRows * 12 + if (budget >= 300) 48 else 32
		val heroH = Math.min(rawHeroH.toFloat(), Math.max(heroCap, heroMin)).toInt()
		// 瓦片行高底线：低于 tileMin 连标题+数值都塞不进，那就只能少铺一格
		val tileRows = if (budget >= 190) 1 else 0
		// 明细行全关时，一个瓦片 = 内边距 16 + 头部 26（图标行统一高度）+ 数值 18
		val tileH = 16 + 26 + 18
		// 不再折叠模块：v3 是「整体缩放」把数据全塞进去，折叠会让用户看到的数据变少。
		// 这里只算「内容总高 vs 预算」，缩放系数在 bindLarge 里统一乘到 textScale 上。
		val tileCount = Math.max(0, count - 1)
		val rows = if (tileCount <= 0) 0 else Math.ceil(tileCount.toDouble() / cols).toInt()
		val effectiveHero = Math.max(heroH, heroMin.toInt())
		val effectiveTile = Math.max(tileH, tileMin.toInt())
		val contentH = effectiveHero + (if (rows > 0) gap + rows * effectiveTile else 0f)

		// 折叠只按**整行**：宁可少一行（3×3 → 3×2），也不要露出半行被裁掉。
		// 不做整体缩放 —— 字号缩了但瓦片的 padding / minHeight 不缩，
		// 格子高度压不下来，结果就是最后一行被切一半。
		val room = budget.toFloat() - effectiveHero - (if (rows > 0) gap else 0f)
		val rowsFit = if (effectiveTile <= 0) 0 else Math.floor((room / effectiveTile).toDouble()).toInt()
		// 优先**整体缩小**把模块全塞进去（宁可缩，不要砍数据）。
		// contentH / budget = 需要的缩放系数；缩得过狠（< MIN_FIT）才退回整行折叠。
		val fit = if (contentH <= 0f) 1f else Math.min(1f, budget.toFloat() / contentH)
		val folded = if (rowsFit <= 0) 1 else Math.max(1, Math.min(count, 1 + rowsFit * cols))
		val shown = if (fit >= MIN_FIT) count else folded
		return V4Plan(
			shown = shown,
			hidden = count - shown,
			cols = cols,
			heroRows = heroRows,
			tileRows = tileRows,
			budget = budget.toFloat(),
			contentH = contentH.toFloat()
		)
	}

	/**
	 * 内容预算：盒子放不下的行直接不显示，宁可少给信息也不出现遮挡。
	 * （v3 那套「实测高度决定砍哪一行」的思路保留，只是 id 换成 w4_）
	 */
	private fun applyContentBudget(
		views: RemoteViews,
		context: Context,
		size: String,
		actual: Pair<Int, Int>
	) {
		val height = actual.second
		when (size) {
			"small" -> {
				// 副行（湿度 / 露点）是 small 卡的核心信息，设计稿里 .foot 一直存在。
				// 只有盒子小到连标题+数值都挤（<=110dp）才整行去掉；
				// 之前沿用 v3 的 190dp 阈值，结果 2×2 上「湿度 62%」直接消失。
				if (height in 1..110) setVisible(views, context, "w4_small_footer", false)
			}
			"medium" -> {
				// 轴标签行只有一行小字，67dp 的盒子放得下；极端扁（<=55dp）才去掉
				if (height in 1..55) setVisible(views, context, "w4_medium_axis_row", false)
			}
			else -> {
				// large 实测 202dp 高，页脚那一行放不下会露出半截字（v4 无页脚，留给 hero 明细）
			}
		}
	}

	// ---- 视觉件 ----

	/**
	 * 参数 chip：圆角底 + 居中图标，一次画成一张图，省掉叠层。
	 * 边长与圆角都读 payload（shape.chipSize / shape.chipRadius），直接画进位图，
	 * 所以不受 RemoteViews 只能改 View 属性的限制。
	 */
	private fun chipBitmap(context: Context, accent: Int, d: String, sizeDp: Float, radiusDp: Float): Bitmap {
		val size = dpOf(context, sizeDp)
		val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
		val canvas = Canvas(bitmap)
		val bg = Paint(Paint.ANTI_ALIAS_FLAG)
		bg.color = (accent and 0x00FFFFFF) or (0x1C shl 24) // 11% alpha
		val radius = dpOf(context, Math.max(0f, radiusDp)).toFloat()
		canvas.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), radius, radius, bg)
		val iconPx = size * 0.6f
		if (d.isNotEmpty()) {
			val paint = Paint(Paint.ANTI_ALIAS_FLAG)
			paint.style = Paint.Style.STROKE
			paint.color = accent
			paint.strokeWidth = iconPx / 24f * 1.6f
			paint.strokeCap = Paint.Cap.ROUND
			paint.strokeJoin = Paint.Join.ROUND
			try {
				canvas.drawPath(EcowittWidgetPainter.SvgIcons.toPath(d, iconPx, size / 2f, size / 2f), paint)
			} catch (t: Throwable) {
				// 图标画不出来就只留底，不影响读数
			}
		}
		return bitmap
	}

	/**
	 * chip 边长。payload 的 shape.chipSize 是设计稿基准（22，small 直接用）。
	 * medium / hero 装在小盒子里，按基准等比缩到 16/22、18/22 —— 这两个比例是 v3
	 * 实机调出来的（写死的是比例，不是尺寸），所以改 chipSize 三档一起跟着变。
	 */
	private fun chipSizeOf(payload: EcowittWidgetV4, tier: String): Float {
		val base = payload.shape("chipSize", 22f)
		return when (tier) {
			"medium" -> base * 16f / 22f
			"hero" -> base * 18f / 22f
			else -> base
		}
	}

	/**
	 * 8 种视觉件 → Bitmap。尺寸全部取 payload 的 shape.viz / shape.vizXs，
	 * 所以换尺寸不用重编基座。
	 */
	private fun visualBitmap(
		context: Context,
		payload: EcowittWidgetV4,
		visual: V4Visual,
		accent: Int,
		theme: EcowittWidgetV4Theme,
		xs: Boolean
	): Bitmap? {
		return when (visual.kind) {
			"glyph" -> EcowittWidgetPainter.glyph(
				context, payload.iconD(visual.icon), accent,
				payload.vizSize(xs, "glyphW", if (xs) 14f else 26f)
			)
			"ring" -> EcowittWidgetPainter.ringSized(
				context, visual.fill, accent, theme.well,
				payload.vizSize(xs, "ring", if (xs) 20f else 34f),
				if (xs) 2f else payload.layoutSize("ringInset", 4f),
				payload.iconD(if (visual.icon.isEmpty()) "humidity" else visual.icon),
				accent,
				if (xs) payload.layoutSize("ringIcoXs", 8f) else payload.layoutSize("ringIco", 14f)
			)
			"dial" -> EcowittWidgetPainter.compass(
				context, visual.bearing, accent, theme.muted,
				payload.vizSize(xs, "compass", if (xs) 26f else 48f) / 48f,
				ticks = !xs,
				arrowRatio = if (xs) 0.70f else 0.56f
			)
			"gauge" -> EcowittWidgetPainter.gauge(
				context, visual.ratio, accent, theme.ink,
				payload.vizSize(xs, "gauge", if (xs) 24f else 58f)
			)
			"uv" -> EcowittWidgetPainter.uvBar(
				context, visual.pos, payload.uvScale, theme.ink, theme.bg,
				payload.vizSize(xs, "uvbar", if (xs) 40f else 64f)
			)
			"bars" -> EcowittWidgetPainter.bars(
				context, visual.values, accent,
				Math.max(1, visual.values.size) * 6f,
				payload.vizSize(xs, "barsH", if (xs) 14f else 22f)
			)
			"sun" -> EcowittWidgetPainter.sun(
				context, payload.iconD(if (visual.icon.isEmpty()) "sun" else visual.icon), accent,
				payload.vizSize(xs, "sun", if (xs) 16f else 26f)
			)
			"battery" -> EcowittWidgetPainter.battery(
				context, visual.level, theme.ok, theme.danger, theme.ink,
				payload.vizSize(xs, "batteryH", if (xs) 10f else 12f),
				payload.layoutSize("cellW", 2f),
				payload.layoutSize("cellGap", 2f)
			)
			else -> null
		}
	}

	// ---- 小卡各处的绑定 ----

	/**
	 * 变化量 + 极值行。两侧的图标是 8dp 的 maxOut / minOut，
	 * 没有极值就把对应的图标和文字一起 GONE（不占位）。
	 *
	 * 密度开关是「用户策略」层，默认值 = 设计稿原样（全画 / 极值 both / 无字缩下限），
	 * 所以 small 与 hero 的调用点不传即行为不变，只有 medium 传 payload 的
	 * shape.detail.medium.* 与 shape.textShrink.meta。
	 *   showMeta  false → 整行（含容器 `_meta_row`）GONE，让出垂直空间，不是 INVISIBLE
	 *   peaks     'both' 最大+最小 | 'max' 只留最大 | 'none' 不留极值
	 *   floor     该行字号的下界（textShrink 的「缩放下界」语义，不与 textScale 相乘）
	 */
	private fun bindMeta(
		views: RemoteViews,
		context: Context,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme,
		prefix: String,
		reading: V4Reading,
		sizeDp: Float,
		showMeta: Boolean = true,
		peaks: String = "both",
		floor: Float = 0f
	) {
		// 容器单独管：子 View 全 GONE 时容器还在，wrap_content 行高会留一条空白
		setVisible(views, context, prefix + "_meta_row", showMeta)
		val hasDelta = showMeta && reading.deltaDir != 0 && reading.deltaValue.isNotEmpty()
		setText(views, context, prefix + "_delta",
			if (hasDelta) (if (reading.deltaDir > 0) "▲ " else "▼ ") + reading.deltaValue else "")
		setColor(views, context, prefix + "_delta", if (reading.deltaDir > 0) theme.up else theme.down)
		setSize(views, context, prefix + "_delta", sizeDp, floor)
		setVisible(views, context, prefix + "_delta", hasDelta)
		val hasMax = showMeta && peaks != "none" && reading.peakMax.isNotEmpty()
		setBitmap(views, context, prefix + "_peak_max_ico",
			if (hasMax) EcowittWidgetPainter.glyph(context, payload.iconD("maxOut"), theme.up, 8f) else null)
		setText(views, context, prefix + "_peak_max", reading.peakMax)
		setColor(views, context, prefix + "_peak_max", theme.up)
		setSize(views, context, prefix + "_peak_max", sizeDp, floor)
		setVisible(views, context, prefix + "_peak_max", hasMax)
		val hasMin = showMeta && peaks == "both" && reading.peakMin.isNotEmpty()
		setBitmap(views, context, prefix + "_peak_min_ico",
			if (hasMin) EcowittWidgetPainter.glyph(context, payload.iconD("minOut"), theme.down, 8f) else null)
		setText(views, context, prefix + "_peak_min", reading.peakMin)
		setColor(views, context, prefix + "_peak_min", theme.down)
		setSize(views, context, prefix + "_peak_min", sizeDp, floor)
		setVisible(views, context, prefix + "_peak_min", hasMin)
	}

	/** 明细行（label 左、值右），最多 maxRows 行 */
	private fun bindRows(
		views: RemoteViews,
		context: Context,
		prefix: String,
		rows: List<V4Row>,
		maxRows: Int,
		sizeDp: Float,
		theme: EcowittWidgetV4Theme,
		keepSpace: Boolean = false
	) {
		for (i in 1..maxRows) {
			val row = rows.getOrNull(i - 1)
			val box = prefix + i
			val boxId = resId(context, box, "id")
			if (boxId != 0) {
				// keepSpace：留空但不占字（INVISIBLE 仍占高度），
				// 让同一行里明细行数不同的格子高度对齐
				views.setViewVisibility(boxId, when {
					row != null -> View.VISIBLE
					keepSpace -> View.INVISIBLE
					else -> View.GONE
				})
			}
			if (row != null) {
				setText(views, context, box + "_label", row.label)
				setColor(views, context, box + "_label", theme.muted)
				setSize(views, context, box + "_label", sizeDp)
				setText(views, context, box + "_value", row.text())
				setColor(views, context, box + "_value", theme.ink)
				setSize(views, context, box + "_value", sizeDp)
			}
		}
		// XML 里每个 slab 有 4~6 个明细槽位且默认可见；maxRows = 0（明细全关）时上面
		// 的循环一次都不进，这些空槽位就白占高度 —— 实测瓦片 ~114dp，而 planFor 按 60dp 估，
		// 于是 344×380 那档 content(330) ≤ budget(334) 判断成放得下，实际第三行被压成一条缝。
		for (i in (maxRows + 1)..ROW_SLOTS) {
			val boxId = resId(context, prefix + i, "id")
			if (boxId == 0) continue // 该前缀没有这么多槽位（hero 6 / tile 4）
			views.setViewVisibility(boxId, View.GONE)
		}
	}

	/**
	 * 底栏左边：只放模块自己的成对摘要（solar 的日出→日落）。
	 * 与 iOS 同一规则：左栏已有一条次要数据（attach），不再补明细行，
	 * 否则室外那张卡会同时出现「湿度」和「Dew point」两条次要数据。
	 */
	private fun footLeftOf(module: V4Module?): String {
		if (module == null || module.compact.isEmpty()) return ""
		return if (module.compactLabel.isEmpty()) module.compact else module.compactLabel + " " + module.compact
	}

	/** 副行：成对摘要（日出→日落）> 整句附带项 > 同模块另一条读数 */
	private fun attachTextOf(module: V4Module?, reading: V4Reading?): String {
		if (module != null && module.compact.isNotEmpty()) {
			return if (module.compactLabel.isEmpty()) module.compact else module.compactLabel + " " + module.compact
		}
		if (reading == null) return ""
		if (reading.attachText.isNotEmpty()) return reading.attachText
		val a = reading.attach ?: return ""
		return a.label + " " + a.text()
	}

	// ---- 入口 ----

	fun build(
		context: Context,
		manager: AppWidgetManager,
		widgetId: Int,
		payload: EcowittWidgetV4
	): RemoteViews? {
		val size = sizeKey(manager, widgetId)
		val box = measureDp(manager, widgetId)
		Log.i(ECOWITT_WIDGET_TAG, "render tier=" + size + " box=" + box.first + "x" + box.second)
		val layoutName = when (size) {
			"small" -> "ecowitt_widget_v4_small"
			"large" -> "ecowitt_widget_v4_large"
			else -> "ecowitt_widget_v4_medium"
		}
		val layoutId = resId(context, layoutName, "layout")
		if (layoutId == 0) {
			Log.w(ECOWITT_WIDGET_TAG, "layout " + layoutName + " not found, v4 render skipped")
			return null
		}
		val theme = payload.theme
		val views = RemoteViews(context.packageName, layoutId)
		val rootName = when (size) {
			"small" -> "w4_small_root"
			"large" -> "w4_large_root"
			else -> "w4_medium_root"
		}
		// 按实际占位算等比缩放：setSize 统一乘 textScale，根布局内边距同步缩
		val actual = measureDp(manager, widgetId)
		val design = designSize(payload, size)
		textScale = computeScale(actual.first, actual.second, design.first, design.second)
		// 全局字号系数（payload 的 fontScale）：占位紧张时整卡缩字，改 JSON 即可
		textScale *= payload.dbl("fontScale", 1.0).toFloat()
		val rootId = resId(context, rootName, "id")
		if (rootId != 0) {
			// 外面距读 payload 的 shape.inset.android（RemoteViews 没有系统边距，必须自己加）
			val pad = dpOf(context, payload.inset("android", payload.shape("cardPadding", 12f)) * textScale)
			views.setViewPadding(rootId, pad, pad, pad, pad)
		}
		// RemoteViews 限制: shape.cardGap（行内小间距）在 XML 里是 layout_margin，
		//   RemoteViews 不能改 margin；用 setViewPadding 顶替会把整块内容一起位移，等于改了布局，所以留在 XML。
		// RemoteViews 限制: shape.cardRadius / wellRadius 写在 drawable XML 里（24dp / 14dp），
		//   运行时改圆角要换 drawable 资源，RemoteViews 做不到 —— 想调必须发版重打基座。
		//   （chipSize / chipRadius 不受这条限制：chip 是 Canvas 画出来的位图，见 chipBitmap）
		applyContentBudget(views, context, size, actual)
		setBackgroundDrawable(views, context, rootName, backgroundFor(theme.appearance))
		when (size) {
			"small" -> bindSmall(context, views, payload, theme)
			"large" -> bindLarge(context, views, payload, theme, actual)
			else -> bindMedium(context, views, payload, theme, actual.first)
		}
		val click = EcowittWidgetRenderer.clickIntent(context, payload.deviceId)
		if (click != null && rootId != 0) views.setOnClickPendingIntent(rootId, click)
		return views
	}

	// ---- small ----

	private fun bindSmall(
		context: Context,
		views: RemoteViews,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme
	) {
		val module = payload.featureModule()
		val reading = payload.featureReading()
		if (module == null || reading == null) {
			Log.w(ECOWITT_WIDGET_TAG, "no module to draw on small card")
			return
		}
		val accent = theme.accent(reading.accent)
		setBitmap(views, context, "w4_small_chip",
			chipBitmap(context, accent, payload.iconD(module.icon),
				chipSizeOf(payload, "small"), payload.shape("chipRadius", 6f)))
		setText(views, context, "w4_small_name", module.label)
		setColor(views, context, "w4_small_name", theme.ink)
		setSize(views, context, "w4_small_name", payload.type("small", "name", 10f))
		setText(views, context, "w4_small_meta", payload.updatedShort)
		setColor(views, context, "w4_small_meta", theme.muted)
		setSize(views, context, "w4_small_meta", payload.type("small", "caption", 10f))
		setText(views, context, "w4_small_value", reading.value)
		setColor(views, context, "w4_small_value", theme.ink)
		// 四位数值（气压 / CO₂）降一档字，否则撑破卡片
		setSize(views, context, "w4_small_value",
			if (reading.small) payload.type("small", "value-sm", 28f) else payload.type("small", "value", 34f),
			payload.textShrink("value", 0.55f))
		setText(views, context, "w4_small_unit", reading.unit)
		setColor(views, context, "w4_small_unit", theme.muted)
		setSize(views, context, "w4_small_unit", payload.type("small", "unit", 10f))
		bindMeta(views, context, payload, theme, "w4_small", reading, payload.type("small", "foot", 8f))
		// 右侧槽位：状态文案优先（雨量无雨时 state 为空 —— 留空，不退回图标）
		val showState = reading.state.isNotEmpty()
		setText(views, context, "w4_small_state", reading.state)
		setColor(views, context, "w4_small_state", accent)
		setSize(views, context, "w4_small_state", payload.type("small", "sub", 10f))
		setVisible(views, context, "w4_small_state", showState)
		// 视觉签名：状态槽模块不画；小卡默认不画签名，只有显式 inSmall=true 的读数才画。
		// takeIf 收成一个可空局部量，后面只剩一次非空判断（之前多写了一次，云端报 always true）
		val shownVisual = if (!showState && !reading.stateSlot) {
			reading.visual?.takeIf { it.inSmall }
		} else null
		val bitmap = shownVisual?.let { visualBitmap(context, payload, it, accent, theme, false) }
		setBitmap(views, context, "w4_small_visual", bitmap)
		setText(views, context, "w4_small_attach", attachTextOf(module, reading))
		setColor(views, context, "w4_small_attach", theme.muted)
		setSize(views, context, "w4_small_attach", payload.type("small", "foot", 8f),
			payload.textShrink("attach", 0.8f))
		// 设计稿 small 的 foot 只有附带项，右边不放状态文案（之前我多写了一个 Demo）
	}

	// ---- medium ----

	private fun bindMedium(
		context: Context,
		views: RemoteViews,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme,
		widthDp: Int
	) {
		val module = payload.featureModule()
		val reading = payload.featureReading()
		if (module == null || reading == null) {
			Log.w(ECOWITT_WIDGET_TAG, "no module to draw on medium card")
			return
		}
		val accent = theme.accent(reading.accent)
		setBitmap(views, context, "w4_medium_chip",
			chipBitmap(context, accent, payload.iconD(module.icon),
				chipSizeOf(payload, "medium"), payload.shape("chipRadius", 6f)))
		setText(views, context, "w4_medium_name", module.label)
		setColor(views, context, "w4_medium_name", theme.ink)
		setSize(views, context, "w4_medium_name", payload.type("medium", "name", 10f))
		setText(views, context, "w4_medium_meta", payload.updatedShort)
		setColor(views, context, "w4_medium_meta", theme.muted)
		setSize(views, context, "w4_medium_meta", payload.type("medium", "caption", 8f))
		setText(views, context, "w4_medium_value", reading.value)
		setColor(views, context, "w4_medium_value", theme.ink)
		setSize(views, context, "w4_medium_value",
			if (reading.small) payload.type("medium", "value-sm", 26f) else payload.type("medium", "value", 32f),
			payload.textShrink("value", 0.55f))
		setText(views, context, "w4_medium_unit", reading.unit)
		setColor(views, context, "w4_medium_unit", theme.muted)
		setSize(views, context, "w4_medium_unit", payload.type("medium", "unit", 10f))
		// 密度策略由 payload 决定（shape.detail.medium.*），读不到 = 设计稿原样全显示
		bindMeta(
			views, context, payload, theme, "w4_medium", reading, payload.type("medium", "state", 8f),
			payload.detailMediumBool("meta", true),
			payload.detailMediumPeaks(),
			payload.textShrink("meta", 0.8f)
		)
		// 附带项移到卡片底部（与小卡同一套展示），左栏不再放 —— 一条次要数据只出现在一个位置
		setVisible(views, context, "w4_medium_attach", false)
		// 曲线：没历史走空态（两块同时只显示一个）
		val chart = EcowittWidgetPainter.chart(context, module.series, accent, theme.border, payload.chartCfg)
		setBitmap(views, context, "w4_medium_chart", chart)
		setVisible(views, context, "w4_medium_empty", chart == null)
		setText(views, context, "w4_medium_empty", payload.emptyTitle)
		setColor(views, context, "w4_medium_empty", theme.muted)
		setSize(views, context, "w4_medium_empty", payload.type("medium", "state", 8f))
		val axis = payload.axis
		val axisNames = arrayOf("w4_medium_axis_left", "w4_medium_axis_mid", "w4_medium_axis_right")
		for (i in axisNames.indices) {
			setText(views, context, axisNames[i], axis.getOrNull(i) ?: "")
			setColor(views, context, axisNames[i], theme.muted)
			setSize(views, context, axisNames[i], payload.type("medium", "axis", 8f))
		}
		// 左栏是 wrap_content（内容决定），但不能超过卡片一半：
		// ViewGroup 没有 maxWidth，只能给左栏里每个 TextView 设 setMaxWidth
		// —— TextView.setMaxWidth(int) 是公开方法，反射能调，效果等价。
		val leftMaxPx = Math.max(
			1,
			(widthDp * (payload.shape("mediumLeftMax", 50f) / 100f) * densityOf(context)).toInt()
		)
		for (name in arrayOf(
			"w4_medium_value", "w4_medium_unit", "w4_medium_delta",
			"w4_medium_peak_max", "w4_medium_peak_min"
		)) {
			val tid = resId(context, name, "id")
			if (tid != 0) views.setInt(tid, "setMaxWidth", leftMaxPx)
		}

		// 底栏左边与小卡同一套：模块成对摘要优先，否则 attach（受 detail.medium.attach 控制）
		val mediumFoot = footLeftOf(module).ifEmpty {
			if (payload.detailMediumBool("attach", true)) attachTextOf(module, reading) else ""
		}
		setText(views, context, "w4_medium_foot_left", mediumFoot)
		setVisible(views, context, "w4_medium_foot_left", mediumFoot.isNotEmpty())
		setColor(views, context, "w4_medium_foot_left", theme.muted)
		setSize(views, context, "w4_medium_foot_left", payload.type("medium", "foot", 8f),
			payload.textShrink("footer", 0.8f))
		setText(views, context, "w4_medium_foot_right", payload.footerLeft)
		setColor(views, context, "w4_medium_foot_right", theme.muted)
		setSize(views, context, "w4_medium_foot_right", payload.type("medium", "foot", 8f),
			payload.textShrink("footer", 0.8f))
	}

	// ---- large ----

	private fun bindLarge(
		context: Context,
		views: RemoteViews,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme,
		actual: Pair<Int, Int>
	) {
		val ordered = payload.orderedModules()
		if (ordered.isEmpty()) {
			Log.w(ECOWITT_WIDGET_TAG, "no modules to draw on large card")
			return
		}
		val planProbe = planFor(payload, ordered.size, actual.first, actual.second)
		// 模块全显示时按「内容高 / 预算」把整卡字号缩下去，而不是折叠丢数据。
		// planFor 只在缩不到 MIN_FIT 时才折叠，所以这里乘是安全的。
		if (planProbe.hidden == 0 && planProbe.contentH > 0f) {
			val fit = Math.min(1f, planProbe.budget / planProbe.contentH)
			if (fit < 1f) {
				textScale *= fit
				Log.i(ECOWITT_WIDGET_TAG, "large fit=" + fit + " (content=" + planProbe.contentH + " budget=" + planProbe.budget + ")")
			}
		}
		setText(views, context, "w4_large_brand", payload.brand)
		setColor(views, context, "w4_large_brand", theme.ink)
		setSize(views, context, "w4_large_brand", payload.type("large", "brand", 12f))
		setText(views, context, "w4_large_station", payload.station)
		setColor(views, context, "w4_large_station", theme.ink)
		setSize(views, context, "w4_large_station", payload.type("large", "station", 10f))
		setText(views, context, "w4_large_meta", payload.updatedShort)
		setColor(views, context, "w4_large_meta", theme.muted)
		setSize(views, context, "w4_large_meta", payload.type("large", "state", 8f))
		val plan = planProbe
		// 折叠只按整行进行（见 planFor），这里只把决定打出来便于真机核对
		Log.i(
			ECOWITT_WIDGET_TAG,
			"large plan: box=" + actual.first + "x" + actual.second +
				" content=" + plan.contentH + " budget=" + plan.budget +
				" cols=" + plan.cols + " rows=" + Math.ceil((plan.shown - 1).toDouble() / plan.cols).toInt() +
				" shown=" + plan.shown + "/" + ordered.size
		)
		val hero = ordered[0]
		bindHero(context, views, payload, theme, hero, plan)
		// 瓦片：按 plan 铺进行 × 列的格子，其余 GONE
		val tiles = ordered.drop(1).take(plan.shown - 1)
		var index = 0
		for (row in 1..5) {
			var rowUsed = false
			for (col in 1..3) {
				val slotName = "w4_large_r" + row + "c" + col
				val slotId = resId(context, slotName, "id")
				// 超出当前列数的格子：GONE，把宽度让给同行的其它格子
				if (col > plan.cols) {
					if (slotId != 0) views.setViewVisibility(slotId, View.GONE)
					continue
				}
				// 这一行铺满了、但后面没有更多模块：INVISIBLE 占住位置，
				// 否则最后一个格子会被拉成整行宽（weight 只摊给可见的兄弟）
				if (index >= tiles.size) {
					if (slotId != 0) views.setViewVisibility(slotId, View.INVISIBLE)
					continue
				}
				val tile = tiles[index]
				val tileViews = buildTile(context, payload, theme, tile, plan)
				if (slotId != 0 && tileViews != null) {
					views.removeAllViews(slotId)
					views.addView(slotId, tileViews)
					views.setViewVisibility(slotId, View.VISIBLE)
					rowUsed = true
				}
				index++
			}
			val rowId = resId(context, "w4_large_row" + row, "id")
			if (rowId != 0) views.setViewVisibility(rowId, if (rowUsed) View.VISIBLE else View.GONE)
		}
	}

	private fun bindHero(
		context: Context,
		views: RemoteViews,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme,
		module: V4Module,
		plan: V4Plan
	) {
		val reading = payload.featuredReading(module) ?: return
		val accent = theme.accent(reading.accent)
		setBackgroundDrawable(views, context, "w4_large_hero", wellFor(theme.appearance))
		setBitmap(views, context, "w4_large_hero_chip",
			chipBitmap(context, accent, payload.iconD(module.icon),
				chipSizeOf(payload, "hero"), payload.shape("chipRadius", 6f)))
		setText(views, context, "w4_large_hero_name", module.label)
		setColor(views, context, "w4_large_hero_name", theme.ink)
		setSize(views, context, "w4_large_hero_name", payload.type("large", "name", 10f))
		setText(views, context, "w4_large_hero_meta", payload.updatedShort)
		setColor(views, context, "w4_large_hero_meta", theme.muted)
		setSize(views, context, "w4_large_hero_meta", payload.type("large", "caption", 8f))
		// 状态槽：有雨画水滴，无雨留空；非状态槽模块显示状态文案
		val dropIcon = if (reading.stateSlot && reading.state.isNotEmpty())
			EcowittWidgetPainter.glyph(context, payload.iconD("rainfall"), accent, 12f) else null
		setBitmap(views, context, "w4_large_hero_state_icon", dropIcon)
		val showState = !reading.stateSlot && reading.state.isNotEmpty()
		setText(views, context, "w4_large_hero_state", reading.state)
		setColor(views, context, "w4_large_hero_state", accent)
		setSize(views, context, "w4_large_hero_state", payload.type("large", "state", 8f))
		setVisible(views, context, "w4_large_hero_state", showState)
		setText(views, context, "w4_large_hero_value", reading.value)
		setColor(views, context, "w4_large_hero_value", theme.ink)
		setSize(views, context, "w4_large_hero_value",
			if (reading.small) payload.type("large", "value-sm", 22f) else payload.type("large", "well", 22f),
			payload.textShrink("value", 0.55f))
		setText(views, context, "w4_large_hero_unit", reading.unit)
		setColor(views, context, "w4_large_hero_unit", theme.muted)
		setSize(views, context, "w4_large_hero_unit", payload.type("large", "detail", 8f))
		bindMeta(views, context, payload, theme, "w4_large_hero", reading, payload.type("large", "detail", 8f))
		// hero 明细行：布局可用行数 × 用户上限（payload 的 shape.detail.heroRows）取小
		// 兜底必须是 0：契约 DETAIL 默认全关，之前兜底 2 会在真机上多画两行明细
		bindRows(
			views, context, "w4_large_hero_row", reading.lines,
			Math.min(plan.heroRows, payload.detailInt("heroRows", 0)),
			payload.type("large", "detail", 8f), theme
		)
		val chart = EcowittWidgetPainter.chart(context, module.series, accent, theme.border, payload.chartCfg)
		setBitmap(views, context, "w4_large_hero_chart", chart)

		// 曲线下方的时间轴：与 medium 一样三段（起点 / 中点 / 终点）
		val axis = payload.axis
		val axisNames = arrayOf("w4_large_hero_axis_left", "w4_large_hero_axis_mid", "w4_large_hero_axis_right")
		for (i in axisNames.indices) {
			setText(views, context, axisNames[i], axis.getOrNull(i) ?: "")
			setColor(views, context, axisNames[i], theme.muted)
			setSize(views, context, axisNames[i], payload.type("large", "detail", 8f))
		}
	}

	/** 一个瓦片：用 addView 塞进格子容器，所以这里是独立的一份 RemoteViews */
	private fun buildTile(
		context: Context,
		payload: EcowittWidgetV4,
		theme: EcowittWidgetV4Theme,
		module: V4Module,
		plan: V4Plan
	): RemoteViews? {
		val layoutId = resId(context, "ecowitt_widget_v4_tile", "layout")
		if (layoutId == 0) {
			Log.w(ECOWITT_WIDGET_TAG, "tile layout not found")
			return null
		}
		val reading = payload.featuredReading(module) ?: return null
		val accent = theme.accent(reading.accent)
		val views = RemoteViews(context.packageName, layoutId)
		setBackgroundDrawable(views, context, "w4_tile_root", wellFor(theme.appearance))
		setText(views, context, "w4_tile_title", module.label)
		setColor(views, context, "w4_tile_title", accent)
		setSize(views, context, "w4_tile_title", payload.type("large", "title", 10f))
		setText(views, context, "w4_tile_value", reading.value)
		setColor(views, context, "w4_tile_value", theme.ink)
		setSize(views, context, "w4_tile_value", payload.type("large", "lower", 16f),
			payload.textShrink("tileValue", 0.6f))
		setText(views, context, "w4_tile_unit", reading.unit)
		setColor(views, context, "w4_tile_unit", theme.muted)
		setSize(views, context, "w4_tile_unit", payload.type("large", "detail", 8f))
		// 同行短摘要：payload 的 shape.detail.inline 控制（兜底 false，与契约一致），且格子太矮时不挤
		val detail = if (payload.detailBool("inline", false) && plan.tileRows > 0) {
			module.compact.ifEmpty {
				reading.lines.firstOrNull()?.let { it.label + " " + it.text() } ?: ""
			}
		} else ""
		setText(views, context, "w4_tile_detail", detail)
		setColor(views, context, "w4_tile_detail", theme.muted)
		setSize(views, context, "w4_tile_detail", payload.type("large", "detail", 8f))
		// 右侧槽位：状态槽有雨画水滴、无雨留空；否则状态文案；再否则按 kind 分流画签名。
		// 分流是为了不让位图被拉变形：圆形的走 icon，方形的走 wide，罗盘单独一档放大。
		// 只看 inline：inSmall 是「小卡右侧」的规则，瓦片没有 chip，solar 这类照样画。
		val showState = !reading.stateSlot && reading.state.isNotEmpty()
		val shownVisual = if (!showState && !reading.stateSlot) {
			reading.visual?.takeIf { it.inline }
		} else null
		val dropIcon = if (reading.stateSlot && reading.state.isNotEmpty()) {
			EcowittWidgetPainter.glyph(context, payload.iconD("rainfall"), accent, 14f)
		} else null
		val kind = shownVisual?.kind ?: ""
		val xsBitmap = { shownVisual?.let { visualBitmap(context, payload, it, accent, theme, true) } }
		setBitmap(
			views, context, "w4_tile_icon",
			dropIcon ?: if (kind == "glyph" || kind == "ring" || kind == "sun") xsBitmap() else null
		)
		setBitmap(views, context, "w4_tile_icon_dial", if (kind == "dial") xsBitmap() else null)
		setBitmap(
			views, context, "w4_tile_icon_wide",
			if (kind == "gauge" || kind == "uv" || kind == "bars" || kind == "battery") xsBitmap() else null
		)
		setText(views, context, "w4_tile_state", reading.state)
		setColor(views, context, "w4_tile_state", accent)
		setSize(views, context, "w4_tile_state", payload.type("large", "state", 8f))
		setVisible(views, context, "w4_tile_state", showState)
		// 瓦片明细行：可用行数 × 用户上限取小（keepSpace 让同一行的格子等高）
		// 兜底必须是 0：契约 DETAIL.tileRows 默认 0
		bindRows(
			views, context, "w4_tile_row", reading.lines.drop(if (detail.isEmpty()) 0 else 1),
			Math.min(Math.max(0, plan.tileRows - 1), payload.detailInt("tileRows", 0)),
			payload.type("large", "detail", 8f), theme, keepSpace = true
		)
		return views
	}
}

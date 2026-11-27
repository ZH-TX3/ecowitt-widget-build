// 测试用的构建步骤：把 uni-app 的源码预处理成可直接被 node 导入的 ESM。
//
// 需要处理三件事：
//   1. `// #ifdef APP-PLUS ... // #endif` 条件编译（要分别生成「App 平台」和「非 App 平台」两套）
//   2. `import ... from '@/uni_modules/ecowitt-widget'` —— 原生插件在 node 里不存在，先摘掉，
//      测试时用 globalThis 上的假实现顶替
//   3. `.js` 扩展名在 ESM 下要写成 `.mjs`（ESM 不认无扩展名/错误扩展名）

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const buildRoot = path.join(here, '.build')

// widgetFetch / widgetConfig 以及它们的依赖：widgetSync 现在会在写盘前拼 fetch 段
const SOURCES = [
	'widgetSync',
	'widgetFetch',
	'widgetConfig',
	'widgetPayloadV4',
	'widgetDesign',
	'widgetFormat',
	'widgetFixture'
]

/** 处理条件编译：#ifdef APP-PLUS 保留或丢弃，其余原样 */
function preprocess(text, appPlatform) {
	return text
		.split(/\r?\n/)
		.reduce((acc, line) => {
			const open = line.match(/^\s*\/\/\s*#ifdef\s+(\S+)\s*$/)
			const close = line.match(/^\s*\/\/\s*#endif\s*$/)
			if (open) {
				acc.stack.push(open[1] === 'APP-PLUS' ? appPlatform : false)
				return acc
			}
			if (close) {
				acc.stack.pop()
				return acc
			}
			if (acc.stack.some((v) => v === false)) return acc
			acc.lines.push(line)
			return acc
		}, { stack: [], lines: [] })
		.lines.join('\n')
}

/** 摘掉原生插件 import，并在注释里留个记号方便排查 */
function stripNativeImport(text) {
	return text.replace(
		/^import\s*\{[^}]*\}\s*from\s*'@\/uni_modules\/ecowitt-widget'\s*$/m,
		'// [test] native plugin import stripped'
	)
}

function renameLocalImports(text) {
	return text.replace(/from '\.\/(\w+)\.js'/g, "from './$1.mjs'").replace(/from "\.\/(\w+)\.js"/g, 'from "./$1.mjs"')
}

/**
 * 生成两套模块：
 *   app/  —— 等价于 iOS/Android 运行时（APP-PLUS 生效）
 *   web/  —— 等价于 H5/小程序（APP-PLUS 不生效）
 */
export async function build(appPlatform) {
	const dir = path.join(buildRoot, appPlatform ? 'app' : 'web')
	await mkdir(dir, { recursive: true })
	for (const name of SOURCES) {
		const src = await readFile(path.join(root, 'common/js', `${name}.js`), 'utf8')
		let out = preprocess(src, appPlatform)
		if (name === 'widgetSync') out = renameLocalImports(stripNativeImport(out))
		else out = renameLocalImports(out)
		await writeFile(path.join(dir, `${name}.mjs`), out, 'utf8')
	}
	return dir
}

/**
 * 被测代码里带 console.log（widgetSync 会打推送结果），会淹掉测试输出。
 * 收集起来而不是丢弃，需要时可断言。
 */
const capturedLogs = []
export function captureLogs() {
	const original = console.log
	console.log = (...args) => capturedLogs.push(args)
	return {
		logs: capturedLogs,
		restore: () => {
			console.log = original
		}
	}
}

/** 干净的 uni 运行时替身 */
export function installUni(overrides = {}) {
	const storage = new Map()
	globalThis.uni = {
		getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
		setStorageSync: (k, v) => storage.set(k, v),
		removeStorageSync: (k) => storage.delete(k),
		getLocale: () => 'en',
		getSystemInfoSync: () => ({ platform: 'ios' }),
		...overrides
	}
	return { storage }
}

/**
 * 顺序导入一套模块
 * native 参数用于给 APP-PLUS 构建注入假的 uts 插件实现
 */
export async function loadModules(appPlatform, native = {}) {
	const dir = await build(appPlatform)
	globalThis.pushWidgetData = native.pushWidgetData || (() => ({ success: true, message: 'ok' }))
	globalThis.reloadWidget = native.reloadWidget || (() => ({ success: true, message: 'ok' }))
	globalThis.readWidgetData = native.readWidgetData || (() => '')

	const sync = await import(`file://${path.join(dir, 'widgetSync.mjs').replace(/\\/g, '/')}`)
	const fetch = await import(`file://${path.join(dir, 'widgetFetch.mjs').replace(/\\/g, '/')}`)
	return { sync, fetch }
}

export async function cleanup() {
	await rm(buildRoot, { recursive: true, force: true })
}

// dsh-folder 浏览器端行为验证（真实 DOM：jsdom 驱动 lib/client.js）。
//
// 覆盖三处此前的缺陷：
//   1. 打开文件夹走 Host 能力 ctx.remote.session.openWorkspacePath，
//      而不是不存在的 ctx.workspaces.openPath（此前每次点击都 TypeError → 没反应）；
//   2. 菜单由 React 延后挂载/重渲染，注入必须跟着 DOM 变化走，
//      固定延时（setTimeout 0）会与提交竞争 → 部分工作区无菜单项；
//   3. 定位失败/打开失败必须有可见反馈，而不是静默无响应。
//
// 运行：node test/harness.mjs  （需要 devDependency jsdom）

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
// DSH_FOLDER_CLIENT 指向别的 bundle，用于对照验证（例如 git show 出来的旧版本）。
const clientSource = readFileSync(
  process.env.DSH_FOLDER_CLIENT ?? join(here, '..', 'lib', 'client.js'),
  'utf8',
)

/* ------------------------------------------------------------------ 断言 --- */

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message}\n       actual:   ${a}\n       expected: ${b}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等待条件成立（最多 timeoutMs），用于观察 MutationObserver 驱动的注入。 */
async function waitFor(condition, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = condition()
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`timed out: ${message}`)
    await sleep(10)
  }
}

/* --------------------------------------------------------------- 测试环境 --- */

const ZH_LABELS = { rename: '重命名', remove: '删除工作区' }
const EN_LABELS = { rename: 'Rename', remove: 'Delete workspace' }

/**
 * 建一个 jsdom 环境：加载真实客户端 bundle，装配假 ctx，铺好工作区侧边栏行。
 *
 * @param options.title       工作区标题
 * @param options.language    'zh' | 'en'（行 aria-label 与菜单文案）
 * @param options.openResult  openWorkspacePath 的返回（{ok:true}|{ok:false,...}）
 * @param options.hasOpener   是否提供 remote.session.openWorkspacePath
 * @param options.rowCount    侧边栏行数（多行用于验证按行解析）
 */
function createEnvironment(options = {}) {
  const language = options.language ?? 'zh'
  const labels = language === 'zh' ? ZH_LABELS : EN_LABELS
  const titles = options.titles ?? ['DSharness']
  const items = titles.map((title, index) => ({
    workspaceId: `ws-${index}`,
    path: `D:\\work\\${title}`,
    title,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom

  // 采集 bundle 注册的 factory。
  let factory = null
  window.__ModuleLoader__ = {
    mode: 'queue',
    pendingQueue: [],
    load(registration) {
      factory = registration.factory
    },
  }
  window.eval(clientSource)
  assert(factory !== null, 'lib/client.js 未通过 __ModuleLoader__.load 注册 factory')
  const mod = factory(() => {
    throw new Error('dsh-folder 客户端 bundle 不应 require 任何模块')
  })

  const calls = { open: [], effects: [] }
  const ctx = {
    locale: {
      register(namespace, dicts) {
        calls.registered = { namespace, dicts }
        return () => {}
      },
      bind(namespace) {
        const dict = language === 'zh' ? calls.registered.dicts.zh : calls.registered.dicts.en
        return (key) => dict[key] ?? key
      },
    },
    effect(fn, name) {
      const dispose = fn()
      calls.effects.push({ name, dispose })
      return () => {}
    },
    workspaces: {
      // 只有注册表读写：DSH 的 IWorkspaces 没有打开目录的方法。
      list: {
        getSnapshot: () => ({
          items: options.hideItemsFromRegistry ? [] : items,
          archivedSessionIds: [],
          state: 'idle',
          phase: 'ready',
          error: null,
        }),
      },
    },
    remote: {},
  }
  if (options.hasOpener !== false) {
    ctx.remote.session = {
      async openWorkspacePath(request) {
        calls.open.push(request)
        if (options.openResult !== undefined) return options.openResult
        return { ok: true, value: { opened: true } }
      },
    }
  }

  // 侧边栏工作区行：folder 槽 / chevron 槽 / projectText / rowActions(带 aria-label 的操作按钮)
  const rows = []
  const tree = window.document.createElement('div')
  tree.setAttribute('role', 'tree')
  for (const item of items) {
    const row = window.document.createElement('div')
    row.className = '_projectRow_x_1'
    row.setAttribute('role', 'treeitem')
    row.setAttribute('aria-expanded', 'true')
    const folder = window.document.createElement('span')
    const chevron = window.document.createElement('span')
    const projectText = window.document.createElement('span')
    projectText.textContent = item.title
    const actions = window.document.createElement('span')
    const menuButton = window.document.createElement('button')
    menuButton.type = 'button'
    menuButton.setAttribute(
      'aria-label',
      language === 'zh' ? `工作区“${item.title}”的操作` : `Workspace actions for ${item.title}`,
    )
    menuButton.textContent = '⋯'
    actions.appendChild(menuButton)
    row.append(folder, chevron, projectText, actions)
    tree.appendChild(row)
    rows.push({ row, menuButton })
  }
  window.document.body.appendChild(tree)

  return { dom, window, document: window.document, ctx, mod, calls, items, rows, labels, language }
}

/**
 * 模拟 DSH Menu primitive 的门户结构，延迟挂载以模拟 React 的提交时机。
 *
 * @param env - createEnvironment 的返回值
 * @param options.delayMs - 延迟挂载（模拟 React 在本帧之后提交）
 * @param options.withRemove - 是否包含「删除工作区」行（会话菜单为 false）
 * @param options.withRename - 是否包含「重命名」行
 */
function mountMenu(env, options = {}) {
  const { document, labels } = env
  const delayMs = options.delayMs ?? 0
  const withRemove = options.withRemove !== false
  const withRename = options.withRename !== false

  const mount = () => {
    const menu = document.createElement('div')
    menu.className = '_list_1aoad_22 _portal_1aoad_x'
    menu.setAttribute('role', 'menu')
    const viewport = document.createElement('div')
    viewport.className = '_viewport_1aoad_22'
    viewport.setAttribute('role', 'presentation')
    if (withRename) viewport.appendChild(makeRow(document, labels.rename, false))
    if (withRemove) viewport.appendChild(makeRow(document, labels.remove, true))
    menu.appendChild(viewport)
    document.body.appendChild(menu)
    return menu
  }

  if (delayMs === 0) return { menu: mount(), unmount: () => {} }
  let menu = null
  const timer = setTimeout(() => {
    menu = mount()
  }, delayMs)
  return {
    get menu() {
      return menu
    },
    unmount: () => {
      clearTimeout(timer)
      if (menu !== null) menu.remove()
    },
  }
}

/** 构造一行 Menu 行（itemWrap > button[role=menuitem]），类名沿用 DSH 的语义命名。 */
function makeRow(document, text, danger) {
  const wrap = document.createElement('div')
  wrap.className = '_itemWrap_1aoad_92'
  const row = document.createElement('button')
  row.type = 'button'
  row.setAttribute('role', 'menuitem')
  row.className = danger ? '_item_1aoad_92 _danger_1aoad_194' : '_item_1aoad_92'
  const icon = document.createElement('span')
  icon.className = '_itemIcon_1aoad_144'
  const label = document.createElement('span')
  label.className = '_itemLabel_1aoad_174'
  label.textContent = text
  row.append(icon, label)
  wrap.appendChild(row)
  return wrap
}

const findInjected = (document) => document.querySelector('[data-dsh-folder-item]')

/* ------------------------------------------------------------------ 用例 --- */

console.log('dsh-folder client harness')

await checkAsync('点击工作区操作按钮后，在「重命名」与「删除工作区」之间注入「打开文件夹」', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  assertEqual(env.calls.registered.namespace, 'folder', 'locale 命名空间')
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => findInjected(env.document), '菜单项注入')
  const viewport = menu.firstElementChild
  assertEqual(
    Array.from(viewport.children).map((child) => (child.getAttribute('role') === 'menuitem' ? 'injected' : 'builtin')),
    ['builtin', 'injected', 'builtin'],
    '注入位置必须在重命名与删除工作区之间',
  )
  assertEqual(item.textContent, '打开文件夹', '菜单项文案')
  assert(item.querySelector('svg') !== null, '菜单项应带文件夹图标')
  assertEqual(Array.from(item.classList), ['_item_1aoad_92'], '必须复用原生行的样式且不带危险色')
})

await checkAsync('点击「打开文件夹」调用 Host 能力 session.openWorkspacePath 并携带该工作区路径', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  mountMenu(env)
  const item = await waitFor(() => findInjected(env.document), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => env.calls.open.length === 1, '调用 Host 打开目录')
  assertEqual(env.calls.open, [{ path: 'D:\\work\\DSharness' }], '打开的路径')
})

await checkAsync('ctx.workspaces 只有注册表方法时依然可用（回归：openPath 不存在导致每次点击静默失败）', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  assert(env.ctx.workspaces.openPath === undefined, '测试前提：ctx.workspaces 没有 openPath')
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  mountMenu(env)
  const item = await waitFor(() => findInjected(env.document), '菜单项注入')
  let thrown = null
  const onError = (event) => {
    thrown = event.error ?? event.message
    event.preventDefault()
  }
  env.window.addEventListener('error', onError)
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => env.calls.open.length === 1, '调用 Host 打开目录')
  env.window.removeEventListener('error', onError)
  assert(thrown === null, `点击不应抛出错误（实际：${String(thrown)}）`)
  assertEqual(env.calls.open[0].path, 'D:\\work\\DSharness', '打开的路径')
})

await checkAsync('菜单延迟提交（模拟 React 在本帧之后挂载）也能注入', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  mountMenu(env, { delayMs: 120 })
  const item = await waitFor(() => findInjected(env.document), '延迟挂载的菜单仍然注入')
  const viewport = item.parentElement
  assertEqual(Array.from(viewport.children).length, 3, '三行：重命名 / 打开文件夹 / 删除工作区')
  assertEqual(viewport.children[1], item, '注入行位于中间')
})

await checkAsync('React 重渲染丢掉注入行后自动补回', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => findInjected(env.document), '菜单项注入')
  // 模拟 React 重写 viewport 的子节点列表（丢弃非 React 节点）。
  item.remove()
  const restored = await waitFor(() => findInjected(env.document), '重渲染后自动补回')
  assert(restored !== item, '应当是重新插入的新节点')
  assertEqual(
    Array.from(menu.firstElementChild.children).map((child) => (child.getAttribute('role') === 'menuitem' ? 'injected' : 'builtin')),
    ['builtin', 'injected', 'builtin'],
    '补回后仍位于中间',
  )
})

await checkAsync('各行点击各自解析：多个工作区互不串位', async () => {
  const env = createEnvironment({ titles: ['Alpha', 'Beta', 'Gamma'] })
  env.mod.apply(env.ctx)

  const openFor = async (index, expectedCalls) => {
    env.rows[index].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
    const menu = mountMenu(env).menu
    const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), `第 ${index} 行注入`)
    item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
    await waitFor(() => env.calls.open.length === expectedCalls, `第 ${index} 行打开调用`)
    menu.remove()
    await sleep(30)
  }

  await openFor(0, 1)
  await openFor(2, 2)
  await openFor(1, 3)
  assertEqual(
    env.calls.open.map((call) => call.path),
    ['D:\\work\\Alpha', 'D:\\work\\Gamma', 'D:\\work\\Beta'],
    '每次点击都打开对应工作区目录',
  )
})

await checkAsync('标题与注册表不一致时按顺序回退（重命名后仍可用）', async () => {
  const env = createEnvironment({ titles: ['Alpha', 'Beta'] })
  env.mod.apply(env.ctx)
  env.rows[1].menuButton.setAttribute('aria-label', '工作区“Beta（已改名）”的操作')
  env.rows[1].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => env.calls.open.length === 1, '打开调用')
  assertEqual(env.calls.open[0].path, 'D:\\work\\Beta', '按行序回退到第 2 个工作区')
})

await checkAsync('会话菜单（无「删除工作区」）不注入', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env, { withRemove: false })
  await sleep(150)
  assertEqual(menu.querySelectorAll('[data-dsh-folder-item]').length, 0, '不应向会话菜单注入')
})

await checkAsync('English 界面同样可用', async () => {
  const env = createEnvironment({ titles: ['DSharness'], language: 'en' })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '英文界面注入')
  assertEqual(item.textContent, 'Open folder', '英文文案')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => env.calls.open.length === 1, '打开调用')
  assertEqual(env.calls.open[0].path, 'D:\\work\\DSharness', '英文界面打开的路径')
})

await checkAsync('Host 返回失败时给出可见反馈，而不是像死项一样没反应', async () => {
  const env = createEnvironment({
    titles: ['DSharness'],
    openResult: { ok: false, error: { message: 'path open failed: boom' } },
  })
  env.mod.apply(env.ctx)
  const errors = []
  const originalError = env.window.console.error
  env.window.console.error = (...args) => errors.push(args)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => item.textContent === '打开文件夹失败', '失败文案回写')
  env.window.console.error = originalError
  assert(errors.length >= 1, '失败必须写入 console.error')
  assertEqual(Array.from(item.classList), ['_item_1aoad_92', '_danger_1aoad_194'], '失败态复用原生危险色')
})

await checkAsync('环境缺少 session.openWorkspacePath 时提示不可用', async () => {
  const env = createEnvironment({ titles: ['DSharness'], hasOpener: false })
  env.mod.apply(env.ctx)
  const errors = []
  const originalError = env.window.console.error
  env.window.console.error = (...args) => errors.push(args)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => item.textContent === '当前环境无法打开文件夹', '不可用文案')
  env.window.console.error = originalError
  assert(errors.length >= 1, '不可用时也应记录原因')
})

await checkAsync('打开成功后请求关闭菜单（Escape），且重复打开不产生重复项', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  let escapes = 0
  env.document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') escapes += 1
  })
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => escapes === 1, '请求关闭菜单')
  menu.remove()
  await sleep(30)

  // 再次打开同一工作区：仍是唯一一项，并可再次打开。
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const again = mountMenu(env).menu
  const second = await waitFor(() => again.querySelector('[data-dsh-folder-item]'), '第二次注入')
  assertEqual(again.querySelectorAll('[data-dsh-folder-item]').length, 1, '菜单内只应有一项')
  second.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => env.calls.open.length === 2, '第二次打开调用')
  assertEqual(env.calls.open[1].path, 'D:\\work\\DSharness', '第二次打开的路径')
})

await checkAsync('插件卸载后不再介入（监听器与观察者随 ctx.effect 释放）', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  const registration = env.calls.effects.find((entry) => entry.name.includes('workspace row menu entry'))
  assert(registration !== undefined, '应当注册菜单注入 effect')
  registration.dispose()
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  await sleep(150)
  assertEqual(menu.querySelectorAll('[data-dsh-folder-item]').length, 0, '卸载后不应再注入')
})

await checkAsync('注册表尚未就绪时点击不崩溃，并给出可见反馈', async () => {
  const env = createEnvironment({ titles: ['DSharness'], hideItemsFromRegistry: true })
  env.mod.apply(env.ctx)
  const warns = []
  const originalWarn = env.window.console.warn
  env.window.console.warn = (...args) => warns.push(args)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  const item = await waitFor(() => menu.querySelector('[data-dsh-folder-item]'), '菜单项注入')
  item.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  await waitFor(() => item.textContent === '未找到对应的工作区', '未找到文案')
  env.window.console.warn = originalWarn
  assertEqual(env.calls.open.length, 0, '未解析到工作区时不应发起打开调用')
  assert(warns.length >= 1, '未解析到工作区时应记录原因')
})

await checkAsync('菜单长时间停留时仍持续守护（重渲染丢弃后依然补回）', async () => {
  const env = createEnvironment({ titles: ['DSharness'] })
  env.mod.apply(env.ctx)
  env.rows[0].menuButton.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }))
  const { menu } = mountMenu(env)
  await waitFor(() => findInjected(env.document), '菜单项注入')
  // 停留时间超过轮询兜底窗口（4s）：观察者必须仍然守着这一项，
  // 否则用户停留稍久就会出现「菜单项消失 → 看起来没反应」。
  await sleep(4300)
  const dropped = findInjected(env.document)
  assert(dropped !== null, '长时间停留后菜单项仍在')
  dropped.remove()
  const restored = await waitFor(() => findInjected(env.document), '长时间停留后仍能补回')
  assertEqual(
    Array.from(menu.firstElementChild.children).map((child) => (child.getAttribute('role') === 'menuitem' ? 'injected' : 'builtin')),
    ['builtin', 'injected', 'builtin'],
    '补回后仍位于中间',
  )
  // 关闭菜单后守护结束：不应再向新菜单之外的任何位置写入。
  menu.remove()
  await sleep(60)
  assertEqual(findInjected(env.document), null, '菜单关闭后注入项随之移除')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const failure of failures) console.log(`- ${failure.name}`)
  process.exitCode = 1
}

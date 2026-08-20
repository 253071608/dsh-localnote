/**
 * dsh-localnote — node 端
 *
 * 一个 DeepSeek Harness Web 展示型插件的复杂化示例：把"问候浮窗"升级成
 * 一个"笔记 / 待办"面板。
 *
 * cordis 插件：在 dsh web 服务器上注册 /dsh-localnote/* 的 REST 路由：
 *   - GET    /dsh-localnote/notes  列出所有笔记
 *   - POST   /dsh-localnote/notes  新建笔记 { text }
 *   - PATCH  /dsh-localnote/notes/:id/toggle  切换完成态（id 在 body 传）
 *   - DELETE /dsh-localnote/notes/:id         删除笔记（id 在 body 传）
 *   - GET    /dsh-localnote/stats  返回统计（总数 / 已完成数）
 *
 * 数据：持久化到 ~/.localnote/state.json（host 启动读取、变更时写入）。
 *
 * 浏览器端（client.js）通过 fetch 消费这些路由，把面板渲染成页面浮窗。
 *
 * 这是标准的三件套结构：
 *   1. package.json  : 声明 dsh.bundle(补丁层) + dsh.client(浏览器端入口)
 *   2. cordis.patch.yml : 把本插件作为一条 loader 配置项插入
 *   3. index.js(本文件)  : host 端，注册 HTTP 路由 / 服务
 *   4. client.js        : 浏览器端，渲染页面浮窗 / 面板
 */
import { homedir } from 'node:os'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const name = 'dsh-localnote'
/** Required services: webServer（HTTP 路由注册）。 */
const inject = ['webServer']

const STATE_DIR = join(homedir(), '.localnote')
const STATE_FILE = join(STATE_DIR, 'state.json')
const DEFAULT_STATE = { notes: [], nextId: 1 }

/** 读取持久化状态；文件缺失/损坏时回退默认。 */
async function loadState() {
  try {
    const text = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.notes) && typeof parsed.nextId === 'number') {
      return parsed
    }
  } catch {
    /* 首次运行或损坏：使用默认状态 */
  }
  return { notes: [], nextId: 1 }
}

/** 写入持久化状态（幂等创建目录）。 */
async function saveState(state) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** 读取请求体为文本。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** 解析请求体为对象；非法 JSON 时返回 null。 */
async function parseBody(req) {
  const text = await readBody(req)
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

function apply(ctx) {
  // 进程级可变状态（该插件只在一个进程上下文内运行一次）。
  // 通过闭包持有，路由处理器读写同一份 state。
  let state = null

  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `dsh-localnote: ${path}`)

  // 单一前缀路由，统一 URL/方法分发。
  register('/dsh-localnote', async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname.replace(/\/+$/, '') // 去尾部斜杠

    // 惰性加载持久化状态（首次请求时）。
    if (state === null) state = await loadState()

    try {
      // ---- 列表 + 统计 ----
      if (req.method === 'GET' && p === '/dsh-localnote/notes') {
        sendJson(res, 200, { notes: state.notes })
        return
      }
      if (req.method === 'GET' && p === '/dsh-localnote/stats') {
        const done = state.notes.filter((n) => n.done).length
        sendJson(res, 200, { total: state.notes.length, done, open: state.notes.length - done })
        return
      }

      // ---- 新建 ----
      if (req.method === 'POST' && p === '/dsh-localnote/notes') {
        const body = await parseBody(req)
        if (!body || typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, { error: 'text is required' })
          return
        }
        const note = {
          id: state.nextId++,
          text: body.text.trim(),
          done: false,
          createdAt: new Date().toISOString(),
        }
        state.notes.push(note)
        await saveState(state)
        sendJson(res, 201, { note })
        return
      }

      // ---- 切换完成态 ----
      if (req.method === 'PATCH' && p === '/dsh-localnote/notes/toggle') {
        const body = await parseBody(req)
        const note = state.notes.find((n) => n.id === Number(body?.id))
        if (!note) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        note.done = !note.done
        await saveState(state)
        sendJson(res, 200, { note })
        return
      }

      // ---- 删除 ----
      if (req.method === 'DELETE' && p === '/dsh-localnote/notes') {
        const body = await parseBody(req)
        const id = Number(body?.id)
        const before = state.notes.length
        state.notes = state.notes.filter((n) => n.id !== id)
        if (state.notes.length === before) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        await saveState(state)
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (e) {
      sendJson(res, 500, { error: String(e?.message ?? e) })
    }
  })
}

export { apply, inject, name }

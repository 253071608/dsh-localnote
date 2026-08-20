/**
 * dsh-localnote — node 端
 *
 * 一个 DeepSeek Harness Web 展示型插件：左上/右上角"笔记"浮窗面板。
 * 每张笔记 = 标题(text) + 详情文本(content) + 若干图片(images)。
 *
 * cordis 插件：在 dsh web 服务器上注册 /dsh-localnote/* 的 REST 路由：
 *   - GET    /dsh-localnote/notes              列出所有笔记
 *   - POST   /dsh-localnote/notes              新建笔记 { text }
 *   - PATCH  /dsh-localnote/notes              更新 { id, text?, content? }（标题/详情）
 *   - PATCH  /dsh-localnote/notes/toggle       切换完成态 { id }
 *   - DELETE /dsh-localnote/notes              删除笔记 { id }
 *   - POST   /dsh-localnote/notes/images       上传图片 { id, dataUrl, name }
 *   - DELETE /dsh-localnote/notes/images       删除图片 { id, file }
 *   - GET    /dsh-localnote/images/:file       读取图片文件（返回图片二进制）
 *   - GET    /dsh-localnote/stats              返回统计（总数 / 已完成数）
 *
 * 数据：
 *   - ~/.localnote/state.json     笔记元数据（含 images 的 {file,name,createdAt} 引用）
 *   - ~/.localnote/images/        图片二进制文件（文件名：<noteId>-<ts>.<ext>）
 *
 * 浏览器端（client.js）通过 fetch 消费这些路由。
 *
 * 这是标准的三件套结构：
 *   1. package.json  : 声明 dsh.bundle(补丁层) + dsh.client(浏览器端入口)
 *   2. cordis.patch.yml : 把本插件作为一条 loader 配置项插入
 *   3. index.js(本文件)  : host 端，注册 HTTP 路由 / 服务
 *   4. client.js        : 浏览器端，渲染页面浮窗 / 面板
 */
import { homedir } from 'node:os'
import { readFile, writeFile, mkdir, unlink, rm } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

const name = 'dsh-localnote'
const inject = ['webServer']

const STATE_DIR = join(homedir(), '.localnote')
const STATE_FILE = join(STATE_DIR, 'state.json')
const IMAGES_DIR = join(STATE_DIR, 'images')

/** 从 dataURL 中解析 mime 与 base64 数据。 */
function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl))
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

/** 由 mime 推断扩展名。 */
function extFromMime(mime) {
  const map = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' }
  return map[mime] || '.png'
}

/** 读取持久化状态；文件缺失/损坏时回退默认。 */
async function loadState() {
  try {
    const text = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.notes) && typeof parsed.nextId === 'number') {
      return parsed
    }
  } catch {
    /* 首次运行或损坏 */
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
  let state = null

  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), `dsh-localnote: ${path}`)

  // 静态读取图片文件。path 形如 /dsh-localnote/images/<file>
  register('/dsh-localnote/images', async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const file = basename(url.pathname.split('/').pop() || '')
    if (!file || req.method !== 'GET') {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    try {
      const buf = await readFile(join(IMAGES_DIR, file))
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(buf)
    } catch {
      sendJson(res, 404, { error: 'image not found' })
    }
  })

  // 主 REST 路由
  register('/dsh-localnote', async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname.replace(/\/+$/, '') // 去尾部斜杠

    if (state === null) state = await loadState()

    try {
      // ---- 列表 ----
      if (req.method === 'GET' && p === '/dsh-localnote/notes') {
        sendJson(res, 200, { notes: state.notes })
        return
      }

      // ---- 统计 ----
      if (req.method === 'GET' && p === '/dsh-localnote/stats') {
        const done = state.notes.filter((n) => n.done).length
        sendJson(res, 200, { total: state.notes.length, done, open: state.notes.length - done })
        return
      }

      // ---- 新建（标题） ----
      if (req.method === 'POST' && p === '/dsh-localnote/notes') {
        const body = await parseBody(req)
        if (!body || typeof body.text !== 'string' || !body.text.trim()) {
          sendJson(res, 400, { error: 'text is required' })
          return
        }
        const note = {
          id: state.nextId++,
          text: body.text.trim(),
          content: '',
          done: false,
          createdAt: new Date().toISOString(),
          images: [],
        }
        state.notes.push(note)
        await saveState(state)
        sendJson(res, 201, { note })
        return
      }

      // ---- 更新详情文本 (content) ----
      if (req.method === 'PATCH' && p === '/dsh-localnote/notes') {
        const body = await parseBody(req)
        const note = state.notes.find((n) => n.id === Number(body?.id))
        if (!note) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        if (typeof body.content === 'string') note.content = body.content
        if (typeof body.text === 'string' && body.text.trim()) note.text = body.text.trim()
        await saveState(state)
        sendJson(res, 200, { note })
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

      // ---- 删除笔记 ----
      if (req.method === 'DELETE' && p === '/dsh-localnote/notes') {
        const body = await parseBody(req)
        const id = Number(body?.id)
        const idx = state.notes.findIndex((n) => n.id === id)
        if (idx === -1) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        // 删除该笔记关联的图片文件
        const note = state.notes[idx]
        for (const img of note.images || []) {
          try { await unlink(join(IMAGES_DIR, img.file)) } catch { /* 忽略 */ }
        }
        state.notes.splice(idx, 1)
        await saveState(state)
        sendJson(res, 200, { ok: true })
        return
      }

      // ---- 上传图片 ----
      if (req.method === 'POST' && p === '/dsh-localnote/notes/images') {
        const body = await parseBody(req)
        const note = state.notes.find((n) => n.id === Number(body?.id))
        if (!note) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        const parsed = parseDataUrl(body?.dataUrl)
        if (!parsed) {
          sendJson(res, 400, { error: 'invalid dataUrl' })
          return
        }
        await mkdir(IMAGES_DIR, { recursive: true })
        const file = `${note.id}-${Date.now()}${extFromMime(parsed.mime)}`
        await writeFile(join(IMAGES_DIR, file), Buffer.from(parsed.base64, 'base64'))
        const img = { file, name: String(body?.name || file), createdAt: new Date().toISOString() }
        note.images = note.images || []
        note.images.push(img)
        await saveState(state)
        sendJson(res, 201, { image: img })
        return
      }

      // ---- 删除图片 ----
      if (req.method === 'DELETE' && p === '/dsh-localnote/notes/images') {
        const body = await parseBody(req)
        const note = state.notes.find((n) => n.id === Number(body?.id))
        if (!note) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        const file = basename(String(body?.file || ''))
        const before = (note.images || []).length
        note.images = (note.images || []).filter((i) => i.file !== file)
        if (note.images.length === before) {
          sendJson(res, 404, { error: 'image not found' })
          return
        }
        try { await unlink(join(IMAGES_DIR, file)) } catch { /* 忽略 */ }
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

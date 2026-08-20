/**
 * dsh-localnote — node 端
 *
 * 一个 DeepSeek Harness Web 展示型插件：右上角"笔记"浮窗面板。
 * 每张笔记 = 标题(text) + 详情文本(content) + 若干图片(images) + 定时(schedule)。
 *
 * 定时/灵感回访能力：
 *   灵感记下后往往当下没精力处理。可给一张笔记设置"到期时间"与"到点动作"：
 *   - action = 'agent' : 到点后 host 静默用一个子代解析/执行这条灵感
 *                        （可指定 provider/model），把结果写回 note.result，等你回来看。
 *   - action = 'alert' : 到点仅做回访标记，不消耗模型，等你回来看时提示"到点待处理"。
 *   定时器用 ctx.interval 每 30s 扫描一次到期笔记，fire 一次后标记 fired，避免重复。
 *
 * cordis 插件：在 dsh web 服务器上注册 /dsh-localnote/* 的 REST 路由：
 *   - GET    /dsh-localnote/notes                列出所有笔记
 *   - POST   /dsh-localnote/notes                新建笔记 { text }
 *   - PATCH  /dsh-localnote/notes                更新 { id, content }（详情文本/标题）
 *   - PATCH  /dsh-localnote/notes/toggle         切换完成态 { id }
 *   - DELETE /dsh-localnote/notes                删除笔记 { id }
 *   - POST   /dsh-localnote/notes/images         上传图片 { id, dataUrl, name }
 *   - DELETE /dsh-localnote/notes/images         删除图片 { id, file }
 *   - GET    /dsh-localnote/images/:file         读取图片文件（返回图片二进制）
 *   - GET    /dsh-localnote/stats                返回统计（总数 / 已完成数）
 *   - PATCH  /dsh-localnote/notes/schedule       设置/取消定时 { id, dueAt, action, model }
 *   - GET    /dsh-localnote/models               返回可用 provider/model 列表
 *
 * 数据：
 *   - ~/.localnote/state.json     笔记元数据（含 images 的 {file,name,createdAt} 引用、schedule/result）
 *   - ~/.localnote/images/        图片二进制文件（文件名：<noteId>-<ts>.<ext>）
 *
 * 浏览器端（client.js）通过 fetch 消费这些路由。
 */
import { homedir } from 'node:os'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

const name = 'dsh-localnote'
const inject = ['webServer', 'timer', 'agents']

const STATE_DIR = join(homedir(), '.localnote')
const STATE_FILE = join(STATE_DIR, 'state.json')
const IMAGES_DIR = join(STATE_DIR, 'images')

/** 定时扫描间隔（毫秒）。 */
const SCAN_MS = 30_000

/**
 * 定时任务创建一次性 agent 时使用的 cwd（deployment persona 的 {{cwd}} 需要它）。
 * 用家目录保证任何部署环境的用户都有一个有效 cwd。
 */
const AGENT_LOCALNOTE_CWD = homedir()

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
// 定时 / 任务执行
// ---------------------------------------------------------------------------

/** 把一条笔记整理成给模型的执行 prompt。 */
function buildPrompt(note) {
  const title = note.text || '(无标题)'
  const content = note.content || ''
  return [
    '你是一个灵感整理助手。下面是一条用户记录下来的“灵感/待办”，',
    '请基于它继续深入：把它提炼成清晰的结构化要点（理解、拆解、下一步可执行动作），',
    '语言与原文保持一致。不要编造原文没有的事实，直接给出整理结果。',
    '',
    '灵感标题：' + title,
    content ? '灵感详情：' + content : '',
    '',
    '请输出整理后的结果：',
  ].filter((l) => l !== '').join('\n')
}

/** 折叠 session 事件，取最后一条非空 assistant 消息文本。 */
function finalAssistantText(agent) {
  const events = agent && agent.session ? agent.session.events : []
  let message = null          // 最后非空 assistant 消息的文本
  let streamed = []
  for (const ev of events) {
    if (ev.type === 'assistant/message') {
      const content = ev.data && ev.data.message && ev.data.message.content
      if (content && content.length > 0) {
        const text = content.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('')
        if (text) message = text
      }
    } else if (ev.type === 'assistant/chunk' && ev.data && ev.data.chunk && ev.data.chunk.type === 'text-delta') {
      const t = ev.data.chunk.text
      if (typeof t === 'string' && t) streamed.push(t)
    }
  }
  if (message !== null && message.trim()) return message.trim()
  const acc = streamed.join('')
  return acc.trim() || undefined
}

/**
 * 用真实 agent 通道执行一条笔记。定时触发时没有 parent agent，
 * 因此用 ctx.agents.create 开一个一次性 agent（返回可显式 dispose 的
 * AgentHandle），发给它任务，等它跑完，取最后一条输出回写。
 * 这走完整 agent 通道，能正常出文；每次执行完毕显式 dispose 释放资源。
 */
async function renewNote(ctx, note) {
  const agents = ctx.get('agents')
  if (!agents || typeof agents.create !== 'function') {
    throw new Error('agents 服务不可用，无法执行任务')
  }
  // 解析要用的模型：指定了用指定的，否则回退当前默认模型。
  let provider = note.model && note.model.provider ? note.model.provider : undefined
  let model = note.model && note.model.model ? note.model.model : undefined
  if (!provider || !model) {
    const def = ctx.get('agentDefaultModel')
    const sel = def && typeof def.currentSelection === 'function' ? def.currentSelection() : undefined
    if (sel && sel.provider && sel.model) {
      provider = sel.provider
      model = sel.model
    }
  }
  const agentOptions = {}
  if (provider && model) { agentOptions.provider = provider; agentOptions.model = model }

  const prompt = [
    '你是一个可靠的任务执行助手。请根据下面这条用户的灵感/待办，',
    '完成一次独立执行：理解它、展开成清晰结论或可执行结果，',
    '语言与原文一致。把最终成果作为你的回答直接输出。',
    '',
    buildPrompt(note),
  ].join('\n')

  let handle
  try {
    // deployment persona 里用了 {{cwd}} 变量，必须提供 cwd 才能渲染出模型请求。
    handle = await agents.create({
      sessionId: randomUUID(),
      meta: { cwd: AGENT_LOCALNOTE_CWD },
      agentOptions,
    })
    const agent = handle.agent
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'user' },
    })
    await agent.whenIdle()
    const out = finalAssistantText(agent)
    return out || '(模型未返回内容)'
  } finally {
    // 一次性 agent 用完即弃，显式释放，避免累积。
    if (handle && typeof handle.dispose === 'function') {
      try { await handle.dispose() } catch { /* 忽略 */ }
    }
  }
}

/**
 * 处理一张到期的笔记。
 * @returns {Promise<{scheduled: boolean}>} 是否需要重算定时。
 */
async function fireDue(ctx, state, note) {
  note.fired = true
  note.processedAt = new Date().toISOString()
  try {
    if (note.action === 'agent') {
      const result = await renewNote(ctx, note)
      note.result = result || '(模型未返回内容)'
      if (note.log) note.log = `${note.log}\n${note.processedAt} 已执行`.trim()
      else note.log = `${note.processedAt} 已执行`
    } else {
      // alert：仅作回访标记，不消耗模型
      if (note.log) note.log = `${note.log}\n${note.processedAt} 已到点(仅提醒)`.trim()
      else note.log = `${note.processedAt} 已到点(仅提醒)`
    }
  } catch (e) {
    note.result = null
    note.error = String(e?.message || e)
    if (note.log) note.log = `${note.log}\n${note.processedAt} 执行失败: ${note.error}`.trim()
    else note.log = `${note.processedAt} 执行失败: ${note.error}`
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
    const p = url.pathname

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

      // ---- 可用模型列表 ----
      // 返回 [{ provider, model, label }]：遍历已注册 provider 及每个 provider 的模型。
      // 默认模型（agentDefaultModel.currentSelection）排最前，便于前端"默认模型"选项。
      if (req.method === 'GET' && p === '/dsh-localnote/models') {
        const llm = ctx.get('llm')
        const models = []
        // 默认模型
        const def = ctx.get('agentDefaultModel')
        const sel = def && typeof def.currentSelection === 'function' ? def.currentSelection() : undefined
        if (sel && sel.provider && sel.model) {
          models.push({ provider: sel.provider, model: sel.model, label: `默认 (${sel.provider}/${sel.model})`, default: true })
        }
        if (llm) {
          try {
            const seen = new Set(models.map((m) => m.provider + '/' + m.model))
            const providers = (llm.listProviders ? llm.listProviders() : [])
              .map((p) => (p && p.id !== undefined ? p.id : (p && p.name !== undefined ? p.name : String(p))))
            for (const pid of providers) {
              let list = []
              try {
                list = await llm.listModels(pid)
              } catch {
                list = []
              }
              for (const mi of list || []) {
                const mid = mi && mi.id !== undefined ? mi.id : (mi && mi.name !== undefined ? mi.name : null)
                if (!mid) continue
                const key = pid + '/' + mid
                if (seen.has(key)) continue
                seen.add(key)
                models.push({ provider: pid, model: mid, label: `${pid}/${mid}` })
              }
            }
          } catch {
            /* 尽力而为 */
          }
        }
        sendJson(res, 200, { models })
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
          content: typeof body.content === 'string' ? body.content : '',
          done: false,
          createdAt: new Date().toISOString(),
          images: [],
          schedule: null,
          action: 'agent',
          model: null,
          result: null,
          processedAt: null,
          error: null,
          log: null,
          fired: false,
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

      // ---- 设置 / 取消定时 ----
      if (req.method === 'PATCH' && p === '/dsh-localnote/notes/schedule') {
        const body = await parseBody(req)
        const note = state.notes.find((n) => n.id === Number(body?.id))
        if (!note) {
          sendJson(res, 404, { error: 'note not found' })
          return
        }
        // 取消定时
        if (body.dueAt === null || body.dueAt === undefined || body.dueAt === '') {
          note.schedule = null
          note.fired = false
          note.result = null
          note.error = null
          await saveState(state)
          sendJson(res, 200, { note })
          return
        }
        const dueMs = Date.parse(String(body.dueAt))
        if (Number.isNaN(dueMs)) {
          sendJson(res, 400, { error: 'invalid dueAt' })
          return
        }
        const action = body.action === 'alert' ? 'alert' : 'agent'
        note.schedule = { dueAt: new Date(dueMs).toISOString() }
        note.action = action
        if (action === 'agent' && body.model && typeof body.model.provider === 'string' && typeof body.model.model === 'string') {
          note.model = { provider: body.model.provider, model: body.model.model }
        } else if (action === 'alert') {
          note.model = null
        }
        // 重设定时时允许再次触发；清掉上次触发的全部痕迹
        note.fired = false
        note.result = null
        note.error = null
        note.processedAt = null
        note.log = null
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

  // ---- 定时扫描 ----
  // 每 SCAN_MS 检查一次到期的笔记。fired 之后不再重复触发。
  const scanTimer = ctx.interval(async () => {
    if (state === null) return
    const now = Date.now()
    let changed = false
    for (const note of state.notes) {
      if (!note.schedule || note.fired) continue
      const dueMs = Date.parse(note.schedule.dueAt)
      if (Number.isNaN(dueMs) || dueMs > now) continue
      changed = true
      await fireDue(ctx, state, note)
    }
    if (changed) await saveState(state)
  }, SCAN_MS)
  ctx.effect(() => scanTimer, 'dsh-localnote: scan-timer')
}

export { apply, inject, name }

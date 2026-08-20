# 灵感笔记 (dsh-localnote)

> **把"以后再说"的灵感，准时摆到你面前：随手记下，到点由 AI 自动替你把它想透、做透，回来只看结果。**

一个常驻浏览器的灵感 / 待办浮窗插件：随手记灵感，给它设一个"回访时间"，到点由 AI 自动执行并回写结果，或仅提醒你回来处理。不用一直盯着屏幕。

## 功能

- **随手记录**：右上角浮窗随手记灵感，一条 = 标题 + 详情 + 截图图片（详情里直接 Ctrl/Cmd+V 粘贴）。
- **定时回访**：给任意灵感设置「到期时间 + 到点动作」，到点由插件自动接管，不用你守着。
- **任务执行**：到点由 AI 把灵感自动展开成结构化成果（理解 → 要点拆解 → 下一步可执行动作），结果直接回写给这条灵感，回来查看即可；可指定模型或使用默认模型。
- **仅提醒**：到点只弹通知提醒你回来处理，不消耗模型。
- **不遗漏**：页面浮窗 toast + 后台系统通知双通道，到点提醒不丢；localStorage 去重，刷新页面不重复提醒。
- **可见状态**：列表实时显示倒计时 / 已执行 / 出错过错状态，详情页查看任务执行报告。

## 架构

与 DSH 展示型插件标准结构一致：**host 持有真实状态 + REST 数据接口，client 渲染页面面板**。

```
dsh-localnote/
├── package.json        # 声明 dsh.bundle(补丁层) + dsh.client(浏览器端入口)
├── cordis.patch.yml    # 把本插件作为一条 loader 配置项插入
├── index.js            # host 端（Node）：持久化状态 + REST 增删改查 + 定时扫描 + agent 执行
├── client.js           # 浏览器端：在 shell.overlay 槽位渲染灵感面板浮窗
└── README.md           # 本说明
```

### host 端 `index.js`

一个 Cordis 插件，`inject: ['webServer', 'timer', 'agents']`：

- **REST 路由**（`ctx.webServer.register`）：

  | 方法 | 路径 | 作用 |
  |------|------|------|
  | GET  | `/dsh-localnote/notes` | 列出所有灵感 |
  | POST | `/dsh-localnote/notes` | 新建（标题 + 可选详情） |
  | PATCH| `/dsh-localnote/notes` | 更新标题/详情 |
  | PATCH| `/dsh-localnote/notes/toggle` | 切换完成态 |
  | DELETE | `/dsh-localnote/notes` | 删除 |
  | POST | `/dsh-localnote/notes/images` | 上传图片 |
  | DELETE | `/dsh-localnote/notes/images` | 删除图片 |
  | GET  | `/dsh-localnote/images/:file` | 读取图片 |
  | GET  | `/dsh-localnote/stats` | 统计 |
  | PATCH| `/dsh-localnote/notes/schedule` | 设置/取消定时（时间 + 动作 + 模型） |
  | GET  | `/dsh-localnote/models` | 可用模型列表 |

- **定时扫描**：`ctx.interval` 每 30s 检查到期灵感，`fireDue` 触发一次后标记 `fired`，避免重复。
- **任务执行**：到点用 `ctx.agents.create` 开一个一次性 agent 执行任务（走完整 agent 通道，可正常出文），执行完显式 `dispose` 释放；未指定模型时回退 `agentDefaultModel` 的默认模型。结果写回 `note.result`。

- **持久化**：`~/.localnote/state.json`（灵感元数据 + schedule/result），图片存 `~/.localnote/images/`。

### client 端 `client.js`

浏览器插件，`window.__ModuleLoader__.load({ id, factory })` 打包；`apply(ctx)` 用 `ctx.slots.inject('shell.overlay', ...)` 挂进页面浮图层。通过 `fetch` 消费上述路由。

## 安装

插件的装载由「依赖声明 + loader 配置」两部分完成，入口都在 web 配置档（`~/.dsh/profiles/web/`）：

1. **依赖声明**：`~/.dsh/profiles/web/package.json` 的 `dependencies` 里加一行
   `"@253071608/dsh-localnote": "link:<你本地的插件目录路径>"`（本地目录安装），
   并把它加进 `dsh.profile.bundles` 数组。
2. **loader 入口**：插件的 `cordis.patch.yml`（作为 bundle 补丁）把 `dsh-localnote` 作为一条 loader 配置项插入，host 端才会加载 `index.js`；client 端由 `dsh-client-modules` 按 `package.json` 的 `dsh.client` 自动发现 `client.js`。

如果发布到 npm 分发，安装方式更简单（无需 `link:`，用包名）：

```sh
# 发布后装进 web 配置档
dsh plugin --profile web @253071608/dsh-localnote
```

装好后的两种联调：
- 改动 host 端 `index.js`：需重启 DSH 才生效（`bash start.sh restart`）。
- 改动 client 端 `client.js`：刷新页面即可；开发迭代可用 `pnpm run dev:web` 走 HMR 自动热更新。

## 卸载

从 web 配置档移除本插件，两步都做：

1. **删依赖声明**：编辑 `~/.dsh/profiles/web/package.json`，删除
   `"@253071608/dsh-localnote": "link:<你本地的插件目录路径>"`（或当初写的任何安装依赖），
   并把 `@253071608/dsh-localnote` 从 `dsh.profile.bundles` 列表移除。
2. **重启 DSH**（`bash start.sh restart`），让 loader 不再加载该插件并刷新 `__DSH_BOOT__` 图。

> 若当初是用 `dsh plugin --profile web <包名>`（把参数转交给 pnpm 安装）安装的，卸载用
> `dsh plugin --profile web remove @253071608/dsh-localnote`。
>
> 卸载只影响插件装载，**不会删除你的数据**（灵感仍保存在 `~/.localnote/state.json` 与 `~/.localnote/images/`）。想彻底清数据，删除这两个位置即可（`rm -rf ~/.localnote`）。

## 验证

- host 接口：
  ```sh
  curl http://127.0.0.1:3080/dsh-localnote/notes          # []
  curl -X POST http://127.0.0.1:3080/dsh-localnote/notes \
       -H 'content-type: application/json' -d '{"text":"你好"}'
  curl http://127.0.0.1:3080/dsh-localnote/stats          # {"total":1,"done":0,"open":1}
  ```
- client：刷新页面，右上角出现「📝 灵感」胶囊，点开即见面板。

## 常见问题

- 任务执行结果为空 / "模型未返回内容"：确认定时设置里选了模型或用默认模型；agent 执行需要 `{{cwd}}` 有效（插件已内置当前用户家目录）。若仍未出文，看详情里的 `log` 与 `error`。
- 想改插件的展示名/文案：在 `client.js` 里搜「灵感」相关字符串。

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

一个 DSH host 端插件：** host 持有真实状态 + REST 数据接口 + 定时扫描 + agent 执行**。

```
dsh-localnote/
├── package.json        # 声明 dsh.bundle(补丁层)
├── cordis.patch.yml    # 把本插件作为一条 loader 配置项插入
├── index.js            # host 端（Node）：持久化状态 + REST 增删改查 + 定时扫描 + agent 执行
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

## 安装

本地安装到 web 配置档，把 `/path/to/dsh-localnote` 换成你 clone 出来的目录：

```sh
# 1. 克隆代码
git clone <仓库地址> /path/to/dsh-localnote

# 2. 本地安装（dsh 会把本地目录作为依赖装进 ~/.dsh/profiles/web/ 并加进 bundles）
dsh plugin --profile web add /path/to/dsh-localnote
```

改动 host 端 `index.js` 需重启 DSH。

## 卸载

```sh
# 从 web 配置档移除（路径换成你 clone 出来的目录）
dsh plugin --profile web remove /path/to/dsh-localnote
```

卸载只影响插件装载，**不会删除你的数据**（灵感仍保存在 `~/.localnote/state.json` 与 `~/.localnote/images/`）。想彻底清数据，删除这两个位置即可（`rm -rf ~/.localnote`）。

## 验证

- host 接口：
  ```sh
  curl http://127.0.0.1:3080/dsh-localnote/notes          # []
  curl -X POST http://127.0.0.1:3080/dsh-localnote/notes \
       -H 'content-type: application/json' -d '{"text":"你好"}'
  curl http://127.0.0.1:3080/dsh-localnote/stats          # {"total":1,"done":0,"open":1}
  ```
## 常见问题

- 任务执行结果为空 / "模型未返回内容"：确认定时设置里选了模型或用默认模型；agent 执行需要 `{{cwd}}` 有效（插件已内置当前用户家目录）。若仍未出文，看详情里的 `log` 与 `error`。

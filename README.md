# dsh-localnote

一个 **DeepSeek Harness Web 展示型插件**：页面右上角渲染一个「📝 笔记」浮窗面板，可**列出、新建、勾选完成、删除**笔记，并支持**逐条查看/编辑详情**——详情里可写多行文本，还能**直接粘贴截图**保存为图片。

笔记数据由 **host 端（Node）** 持有一份**持久化状态**：
- 笔记元数据（标题/详情/完成态/图片引用）→ `~/.localnote/state.json`
- 粘贴的图片 → `~/.localnote/images/` 目录

client 端通过 REST 路由读写。它演示了 DSH 展示型插件的**标准结构**（与本仓库已安装的 `dsh-stock-watch` 等第三方插件一致）：host 持有真实状态 + REST 数据接口，client 渲染页面面板。

```
dsh-localnote/
├── package.json        # 声明 dsh.bundle(补丁层) + dsh.client(浏览器端入口)
├── cordis.patch.yml    # 把本插件作为一条 loader 配置项插入
├── index.js            # host 端（Node）：笔记/详情/图片的持久化 + REST 增删查改
├── client.js           # 浏览器端：在 shell.overlay 槽位渲染笔记面板 + 详情模态框
└── README.md           # 本说明
```

## 它做了什么

- **host 端** `index.js`：一个 Cordis 插件，`inject: ['webServer']`，通过 `ctx.webServer.register({ kind: 'prefix', path, handler })` 注册前缀路由，内部按 URL/方法分发：

  | 方法 | 路径 | 作用 |
  |------|------|------|
  | GET  | `/dsh-localnote/notes` | 列出所有笔记（含详情/图片引用） |
  | POST | `/dsh-localnote/notes` | 新建笔记 `{ text }`（标题） |
  | PATCH| `/dsh-localnote/notes` | 更新笔记 `{ id, text?, content? }`（标题/详情） |
  | PATCH| `/dsh-localnote/notes/toggle` | 切换完成态 `{ id }` |
  | DELETE | `/dsh-localnote/notes` | 删除笔记 `{ id }`（同时清理其图片文件） |
  | POST | `/dsh-localnote/notes/images` | 上传图片 `{ id, dataUrl, name }` |
  | DELETE | `/dsh-localnote/notes/images` | 删除图片 `{ id, file }` |
  | GET  | `/dsh-localnote/images/:file` | 读取图片文件 |
  | GET  | `/dsh-localnote/stats` | 统计（总数/已完成） |

  状态保存在进程闭包里，并持久化。图片以 base64 dataURL 上传后写入 `~/.localnote/images/`，state.json 只保存引用（`file`/`name`/`createdAt`），避免状态文件膨胀。

- **client 端** `client.js`：浏览器插件，`window.__ModuleLoader__.load({ id, factory })` 打包；`apply(ctx)` 用 `ctx.slots.inject('shell.overlay', ...)` 把 React 面板挂进页面浮图层（additive、可点击）。
  - 点笔记**标题** → 打开**详情模态框**
  - 详情框可编辑多行文本，并**监听 `paste` 事件捕获剪贴板截图**自动上传
  - 图片以 `/dsh-localnote/images/<file>` 展示，可逐张删除
  - 面板和胶囊支持**拖动**（标题栏按住拖动）

- **package.json** 的 `dsh.bundle` 让这个包"贡献一条补丁层"，`dsh.client` 让 `dsh-client-modules` 自动发现并加载浏览器端入口。

## 安装

前置：已按 [从源码运行](https://github.com/deepseek-ai/deepseek-harness) 准备好 DSH 仓库并构建好。

### 从 GitHub（当前推荐）

```sh
dsh plugin --profile web add github:253071608/dsh-localnote
```

### 从 npm（暂未发布）

本仓库目前尚未发布到 npm，故 `@253071608/dsh-localnote` 无法通过 `dsh plugin add @253071608/dsh-localnote` 安装（registry 返回 404）。
已发布后即可使用该命令；在此之前请用上面的 **GitHub** 方式安装。

### 本地源码目录（仅本机开发用）

如果你在本地克隆/保存了源码，也可以直接指向源码目录（放到 `dsh plugin add` 后面的 `本地源码路径` 处，例如 `/path/to/dsh-localnote`）：

```sh
dsh plugin --profile web add <本地源码路径>
```

> 注意：bundle 方式下，插件行在 patch 里按**包名**（`name: '@253071608/dsh-localnote'`）引用，Node 模块解析靠 profile 的 pnpm 依赖定位已安装代码。若再想用 `--patch` 重复插入同一行，会报 `duplicate loader entry id: dsh-localnote`——bundle 本身已提供补丁层，不必重复插入。

装好后**重启 DSH**，打开 `http://127.0.0.1:3080`，右上角出现「📝 笔记」胶囊；点开即可添加笔记、点标题进详情、粘贴截图。

## 验证

- host 端接口：
  ```sh
  curl http://127.0.0.1:3080/dsh-localnote/stats           # {"total":0,"done":0,"open":0}
  curl -X POST http://127.0.0.1:3080/dsh-localnote/notes \
       -H 'content-type: application/json' -d '{"text":"hello"}'
  curl http://127.0.0.1:3080/dsh-localnote/notes           # 新建的笔记
  ```
- 数据文件：`~/.localnote/state.json` 与 `~/.localnote/images/`

## 想加深理解？

- [第一个插件 / 工具 / 配置教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)
- [Cordis 框架教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/index.md)
- `dsh-stock-watch` 是功能更丰富的同构参考实现（数据面板、K 线、扇形菜单）。

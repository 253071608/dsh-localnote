# dsh-localnote

一个 **DeepSeek Harness Web 展示型插件**：页面右上角渲染一个「📝 笔记」浮窗面板，可**列出、新建、勾选完成、删除**笔记。笔记数据由 **host 端（Node）** 持有一份**持久化状态**（写入 `~/.localnote/state.json`），client 端通过 REST 路由读写。

它演示了 DSH 展示型插件的**标准结构**（与本仓库已安装的 `dsh-stock-watch` 等第三方插件一致）：host 持有真实状态 + REST 数据接口，client 渲染页面面板。

```
dsh-localnote/
├── package.json        # 声明 dsh.bundle(补丁层) + dsh.client(浏览器端入口)
├── cordis.patch.yml    # 把本插件作为一条 loader 配置项插入
├── index.js            # host 端（Node）：持久化笔记状态 + REST 增删查改
├── client.js           # 浏览器端：在 shell.overlay 槽位渲染笔记面板浮窗
└── README.md           # 本说明
```

## 它做了什么

- **host 端** `index.js`：一个 Cordis 插件，`inject: ['webServer']`，通过 `ctx.webServer.register({ kind: 'prefix', path, handler })` 注册一条前缀路由，内部按 URL/方法分发：

  | 方法 | 路径 | 作用 |
  |------|------|------|
  | GET  | `/dsh-localnote/notes` | 列出所有笔记 |
  | POST | `/dsh-localnote/notes` | 新建 `{ text }` |
  | PATCH| `/dsh-localnote/notes/toggle` | 切换完成态 `{ id }` |
  | DELETE | `/dsh-localnote/notes` | 删除 `{ id }` |
  | GET  | `/dsh-localnote/stats` | 统计（总数/已完成） |

  状态保存在进程闭包里，并持久化到 `~/.localnote/state.json`（首次请求时惰性加载，变更时写入）。

- **client 端** `client.js`：浏览器插件，`window.__ModuleLoader__.load({ id, factory })` 打包；`apply(ctx)` 用 `ctx.slots.inject('shell.overlay', ...)` 把 React 面板挂进页面浮图层（additive、可点击）。面板通过 `fetch` 调上面的接口。

- **package.json** 的 `dsh.bundle` 让这个包"贡献一条补丁层"，`dsh.client` 让 `dsh-client-modules` 自动发现并加载浏览器端入口。

## 在本地跑起来

前置：已按 [从源码运行](https://github.com/deepseek-ai/deepseek-harness) 准备好 DSH 仓库并构建好。

### 方式 A：作为已安装 bundle（推荐，模拟真实分发）

```sh
# 1. 装进一个 profile（这里用默认的 web）
#    - 已发布到 npm：用包名
dsh plugin --profile web add @253071608/dsh-localnote
#    - 本地源码目录：用路径
#   dsh plugin --profile web add /root/test/dsh-localnote

# 2. 启动（若已在运行，请重启）
dsh --profile web
```

打开 `http://127.0.0.1:3080`，右上角出现「📝 笔记」胶囊，点开即见面板。添加的笔记会持久化到 `~/.localnote/state.json`。

> 注意：bundle 方式下，插件行在 patch 里按**包名**（`name: '@253071608/dsh-localnote'`）引用，Node 模块解析靠 profile 的 pnpm 依赖定位已安装代码。若想在 bundle 之外再用 `--patch` 重复插入同一行，会报 `duplicate loader entry id: dsh-localnote`——bundle 本身已提供补丁层，不必重复插入。

### 方式 B：用 --patch overlay 临时加载（不落 profile）

```sh
dsh web --patch ./dsh-localnote/cordis.patch.yml
```

### 改完 client.js 想生效？

client 端 bundle 由 `dsh-client-modules` 读取并带哈希标识。**Host 端必须重启**才会让新增的 loader entry 进入 `__DSH_BOOT__` 图；host 起来后，`client.js` 源码变更在 Web 模式下经 client-modules 监测对已激活入口生效。开发迭代建议用 `pnpm run dev:web`。

## 验证

- host 端接口：
  ```sh
  curl http://127.0.0.1:3080/dsh-localnote/notes          # []
  curl -X POST http://127.0.0.1:3080/dsh-localnote/notes \
       -H 'content-type: application/json' -d '{"text":"hello"}'
  curl http://127.0.0.1:3080/dsh-localnote/stats          # {"total":1,"done":0,"open":1}
  ```
- client 端：刷新页面，`window.__DSH_BOOT__.entries` 中应含 `dsh-localnote`，右上角出现笔记胶囊。

## 想加深理解？

- [第一个插件 / 工具 / 配置教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)
- [Cordis 框架教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/index.md)
- `dsh-stock-watch` 是功能更丰富的同构参考实现（数据面板、K 线、扇形菜单）。

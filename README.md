# My KanBan · 敏捷项目管理看板

面向中文团队的敏捷项目管理看板。按 Scrum 术语建模：**项目 → 预期成果看板（产品列表）→ 目标项 → 迭代 → 任务项**，并带检查列表、附件、卡片类型、燃尽图与用户权限管理。

React 18 + TypeScript + Vite 前端，[Convex](https://convex.dev) 作后端（数据库 + 云函数 + 文件存储），部署在 Cloudflare Pages。

---

## 功能特性

**项目与成员**
- 项目创建，自动生成 6 位邀请码（`K3F9QA` 形式）用于加入
- 成员邀请 / 加入申请审批、成员移除、拥有者转让与项目设置
- 全局角色：管理员（可管理全部用户与系统预设）/ 普通成员（只看到受邀项目）

**敏捷管理**
- **预期成果看板**（产品列表）：每项目恰好一个，三列「待处理 / 处理中 / 已完成」代表目标的优先级队列
- **迭代**：多个 Sprint，带起止日期、目标、状态（未开始 / 进行中 / 已结束），周期默认 14 天可配
- **目标项**：无负责人、无截止日期的团队承诺，顺序即优先级，可一键「排入迭代 / 移出迭代」
- **任务项**：迭代内可执行单元，必须指定负责人、预计完成日期与关联目标项；状态在三泳道间推进
- 工时可追溯：进入「执行中」记录**预计工时**，进入「已完成」记录**耗费工时**，支持计划执行统计（预计 vs 实际偏差）
- **卡片类型（标签）**：同一类别名与颜色只存一份，卡片存引用；卡片上以颜色小方块标示类别

**可视化**
- 目标项所在列由项目 owner 手工移动（也可由「排入迭代」自动进入处理中）
- 活动日志（项目页按时间倒序列出全部变更，目标项详情里看单项历史）
- 项目进度（按目标项计数）
- **迭代燃尽图**（纵轴 = 本期任务剩余工时）
- **发布燃尽图**（纵轴 = 成果的价值估计）

**协作与内容**
- 目标项检查列表（验收条件，独立于任务）
- 附件：图片内联预览、文档下载，单文件上限 20 MB，类型由服务端判定
- 活动日志（13 种事件）

**其他**
- 登录页可在**开发测试环境 / 生产环境**两个后端之间切换（默认生产）
- 移动端适配：手机上顶栏换为固定底栏，看板列变为横向滑动
- 深色模式（跟随系统）

---

## 核心概念

目标项与任务项的划分是这个项目的核心设计：

| 概念 | 代码 | 说明 |
| --- | --- | --- |
| 预期成果看板 | `boards.kind = "backlog"` | 产品列表，每项目恰好一个 |
| 迭代 | `boards.kind = "sprint"` | 一个 Sprint，可多个 |
| 目标项 | `goals` | **无负责人、无截止日期**，活在产品列表里 |
| 任务项 | `tasks` | **有负责人、有截止日期、记录工时**，活在某个迭代里 |

关键规则：**目标项的状态完全由它的任务派生，不能手动拖动** ——

```
已完成  ⇐ 至少 1 个任务，且全部任务都已完成
处理中  ⇐ 已排入某个迭代，但还有未完成的任务
待处理  ⇐ 尚未排入任何迭代
```

因此目标项没有「完成」按钮：把它的任务做完，它自己就进「已完成」。同理，**迭代一旦开始就不再接受新目标项**，以保证承诺范围不被中途更改。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 18、TypeScript 5.7（`strict`）、Vite 6，无路由库、无 UI 组件库 |
| 后端 | Convex 1.46（TypeScript 云函数 + 文档数据库 + 文件存储） |
| 鉴权 | 自建会话 token（30 天 TTL）+ PBKDF2-HMAC-SHA256，非 Convex Auth |
| 样式 | 手写 CSS（CSS 变量 + 深色模式 + 移动优先），无预处理器 |
| 部署 | Cloudflare Pages（`wrangler.toml` + `public/_redirects` SPA 回退） |

依赖刻意保持精简：**运行时只有 `convex`、`react`、`react-dom` 三个包**。

---

## 快速开始

需要 **Node.js 20+** 和一个 Convex 账号（`npx convex dev` 会引导登录）。

### 1. 安装

```bash
npm install
```

### 2. ⚠️ 把后端指向你自己的 Convex deployment

`src/backend.ts` 里内置了**本项目作者自己的**两个 deployment 地址（作为默认值）。如果你要自己跑一套，**必须先改掉**，否则你的应用会连到别人的后端：

```bash
cp .env.local.example .env.local
```

然后把 `.env.local` 里的占位值换成你自己的（该文件已 gitignore）：

```ini
# 供 `npx convex dev` / `npx convex deploy` 选择 deployment
CONVEX_DEPLOYMENT=dev:your-deployment-name

# 客户端实际连接的两个后端，覆盖 src/backend.ts 里的默认值
VITE_CONVEX_URL_DEV=https://your-dev-deployment.convex.cloud
VITE_CONVEX_URL_PROD=https://your-prod-deployment.convex.cloud
```

> 注意：`VITE_CONVEX_URL`（不带后缀）**客户端已不再读取**，只有 `scripts/project-snapshot.mjs` 还拿它做校验。

### 3. 启动

两个进程，分别在两个终端：

```bash
npx convex dev     # 后端：推送 schema 与云函数、生成 convex/_generated
npm run dev        # 前端：http://127.0.0.1:5173
```

打开页面后**注册的第一个账号会自动成为管理员**（系统借此完成初始化引导）。

### 常用命令

```bash
npm run dev        # 前端开发服务器
npm run typecheck  # tsc --noEmit（本项目唯一的静态校验）
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 本地预览构建产物

npx convex dev --once   # 单次推送云函数到开发版
npx convex deploy       # 部署到产品版（需交互确认）
```

---

## 开发 / 生产环境切换

本项目有**两个完全独立的 Convex deployment**（各自的数据库、各自的账号）。登录页底部的「后端数据」可选：

- **生产环境**（默认）
- **开发测试环境**

切换后会清空本地会话并要求重新登录 —— 因为会话只存在于签发它的那个 deployment 里。切换器的下方会显示当前连接的 deployment 主机名，避免分不清自己在哪个库。

两个环境的地址在 `src/backend.ts` 的 `BACKENDS` 中定义，可被 `VITE_CONVEX_URL_DEV` / `VITE_CONVEX_URL_PROD` 覆盖。

---

## 部署

### 前端 → Cloudflare Pages

```bash
npm run build
wrangler pages deploy dist --project-name=<你的项目名> --branch=main
```

SPA 的回退规则在 `public/_redirects`（`/*  /index.html  200`），Vite 会原样拷贝进 `dist/`。

### 后端 → Convex

```bash
npx convex dev --once   # 开发版
npx convex deploy       # 产品版
```

> **⚠️ 改动数据表结构（`convex/schema.ts`）之前必须先备份两个 deployment。** 用 `bash scripts/backup-deployments.sh` 同时导出 dev 与 prod，再推送 schema；详见 [AGENTS.md](AGENTS.md) §12。

---

## 项目结构

```
convex/           后端：schema（16 张表）+ 各领域云函数 + lib/ 共享逻辑
src/
  backend.ts      两个后端（dev/prod）的定义与切换
  main.tsx        入口：按 env 选 Convex client → Provider → App
  App.tsx         视图状态机（无路由库）
  components/     页面与组件（BoardPage 承载看板主要交互）
  styles.css      全部样式
scripts/          运维脚本（备份 / 快照 / 一次性迁移）
docs/             软件设计说明书 + 维护手册
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/软件设计说明书.md`](docs/软件设计说明书.md) | 架构设计、接口契约（62 个云函数）、15 张数据表、各模块详细说明、核心不变量 |
| [`docs/维护手册.md`](docs/维护手册.md) | 安装、部署、**数据导出/导入**、结构变更流程、故障排查、运维红线 |
| [`AGENTS.md`](AGENTS.md) | 面向 AI Agent 的唯一事实来源（含强制流程与已知坑） |

> ⛔ **运维红线**：**生产库（prod）的数据永远不可删除**；改表结构一律「先导出 → 改 → 再导入」。
> 细节见维护手册第 1 节。

---

## 开发约定与注意事项

- **所有用户可见文案为简体中文**；代码标识符与注释为英文（注释解释「为什么」）。
- **后端错误不能直接渲染给用户**：统一走 `src/lib/ui.ts` 的 `describeError`，新增错误码需登记到 `ERROR_MESSAGES`。
- **新增 npm 依赖前请三思** —— 目前运行时依赖只有 3 个。
- **本项目没有测试、没有 lint、没有 CI**，`npm run typecheck` 是唯一的自动化防线。改动后端业务规则时请手动验证。
- 样式表是**追加式**的：新规则加在文件末尾并写注释段，不要回头改前面的规则。

更详细的架构说明、业务不变量、权限模型、已知技术债与「改完代码要同步文档」的约定，都在 **[AGENTS.md](AGENTS.md)**（本项目的事实来源）。用 AI 协作开发时建议先让它读这个文件。

---

## License

[MIT](LICENSE) © 2026 alex liu

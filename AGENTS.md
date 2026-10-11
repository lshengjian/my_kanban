# AGENTS.md — My KanBan（敏捷项目管理看板）

> **本文件是项目的唯一事实来源（single source of truth）。**
> 开始任何任务前先读本文件，不要重新逐文件通读源码。
> **每次改动代码后，必须回来同步本文件对应章节**（见 §13「维护约定」）。
> ⚠️ **要改数据表结构（`convex/schema.ts`）？先读 §12 的强制流程** —— 必须先备份 dev + prod 两个
> deployment，再推送，最后按需导入数据。

---

## 1. 项目是什么

面向中文团队的**敏捷项目管理看板** Web 应用（个人/小团队自建，非 SaaS 多租户）。
围绕一套 Scrum 术语建模：项目 → 预期成果看板（产品列表 PBL）→ 目标项 → 迭代（Sprint）→ 任务项，
外加检查列表、附件、卡片类型（标签）、活动日志、燃尽图、用户与权限管理。

- 前端 SPA：React 18 + TypeScript + Vite 6
- 后端：Convex 1.46（TypeScript 云函数 + 文档数据库 + 文件存储）
- 部署：Cloudflare Pages（`wrangler.toml`，`name = "kb-app"`，产物目录 `dist/`）
- 用户界面与所有文案：**简体中文**。代码注释、标识符：英文。
- 品牌名不统一（已知问题）：`src/App.tsx` 显示 **My KanBan**，`AuthPage.tsx` 与 `dist/index.html` 标题为 **FlowBoard**，根 `index.html` 标题为「敏捷项目管理看板」。

### 术语表（代码 ↔ 中文 ↔ 英文）

| 中文 | 代码 | 说明 |
| --- | --- | --- |
| 预期成果看板 | `boards.kind === "backlog"` | 产品列表 / PBL。每项目**恰好一个** |
| 迭代列表 | `boards.kind === "sprint"` | 一个 Sprint，可多个 |
| 目标项 | `goals` | 团队共同承诺。**无负责人、无截止日期** |
| 任务项 | `tasks` | 可执行单元，**有负责人、有截止日期、记录工时** |
| 待处理 / 处理中 / 已完成 | goal 列名（固定三列） | 由任务状态**派生**，不可拖拽修改 |
| 提议 / 执行中 / 已完成 | `tasks.status` = `proposed`/`in_progress`/`done` | 迭代看板三条固定泳道 |
| 卡片类型 / 标签 | `labels` | 同一张表两种 scope：`system` 预设 / `project` 项目自有 |
| 客户价值估计 | `goals.value` (1–10) | 发布燃尽图纵轴 |
| 预计工时 / 耗费工时 | `tasks.estimatedHours` / `tasks.actualHours` | 分别在「开始执行」/「标记完成」时录入 |
| 检查列表 | `checklistItems` | 目标项的验收条件，**与任务项独立** |
| 附件 | `attachments` | 图片内联显示，文档下载 |

---

## 2. 常用命令

```bash
npm run dev        # Vite 开发服务器 → http://127.0.0.1:5173
npm run typecheck  # tsc --noEmit（唯一的静态校验手段）
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # 预览 dist/

npx convex dev     # 必需：跑 Convex 后端（无对应 npm script）
npx convex data <table> --format jsonArray   # 读表
npx convex import --table <t> --replace --yes <file>  # ⚠️ 整表覆盖
```

- **没有任何测试框架、没有 lint、没有 CI**（`.github` 不存在，`package.json` 无 test 脚本，仓库内无 `*.test.*`）。
  → 「验证」= `npm run typecheck` 通过 + 人工/脚本冒烟。**改动后端业务规则时务必手动验证或补最小验证手段**。
- `tsconfig.json` 是 `strict` + `noUnusedLocals` + `noUnusedParameters`，且 `include` 同时覆盖 `src` 与 `convex`
  （`convex/_generated` 被 exclude）。因此前后端同一次 typecheck。
- Convex CLI 版本 1.46.0，位于 `node_modules/.bin/convex`；`node_modules` 中**没有 wrangler**，部署在仓库外工具链完成。
- **无 `convex.json`、无 `convex/auth.config.ts`、无 `.env`**；环境变量只在 `.env.local`（已 gitignore）。
  当前该文件里是 `CONVEX_DEPLOYMENT`、`VITE_CONVEX_URL`、`VITE_CONVEX_SITE_URL`；
  可提交的模板见 `.env.local.example`（含客户端实际读取的 `VITE_CONVEX_URL_DEV` / `_PROD`）。
  注意 `VITE_CONVEX_URL` 与 `VITE_CONVEX_SITE_URL` 客户端均已不读（见 §8）。
- **本项目有两个 Convex deployment**（各自的数据库与账号完全独立，见 §9）：

  | | 开发测试环境 (dev) | 生产环境 (prod) |
  | --- | --- | --- |
  | deployment | `lsj1788:kanban:kanban-dev` | `lsj1788:kanban:production` |
  | URL | `https://fine-ibis-920.convex.cloud` | `https://coordinated-camel-303.convex.cloud` |
  | 选它的命令 | 默认（`.env.local`） | 加 `--prod` |
  | 数据 | 当前全部历史数据 | 2026-10-11 初始化，**空库** |

  `npx convex dev --once` 推 dev；`npx convex deploy` 推 prod —— 后者**必须交互确认**，
  非交互环境需要伪终端（见 §9）。
- Git：远端 `origin` = `git@github.com:lshengjian/my_kanban.git`，分支 `main`，全部源码已跟踪并推送。
  历史：`08f75c2 Initial commit`（仅 LICENSE）→ `4eed5fa`（首个完整源码提交）。
  **⚠️ 该仓库是 public 的** —— 提交前务必确认没有把密钥、`.env.local`、`.import-tmp.json`、`snapshots/` 带进去
  （这些都在 `.gitignore` 里，但新增文件时要自己核对）。

---

## 3. 目录结构

```
根目录
  AGENTS.md              本文件 —— 面向 Agent 的唯一事实来源
  README.md              面向使用者的说明：功能、安装、部署、环境切换
  .env.local.example     环境变量模板（可提交；.env.local 本身已 gitignore）
  wrangler.toml          Cloudflare Pages 配置（name=kb-app，输出 dist/）
  .aud.mjs               Playwright 巡检辅助（见 §10）
  index.html / vite.config.ts / tsconfig.json / package.json
convex/                  后端（Convex 函数 + 数据模型）
  schema.ts              全部 15 张表定义与索引 —— 改数据结构先改这里
  auth.ts                注册/登录/登出/me + 管理员用户管理
  projects.ts            项目、成员、加入申请、邀请、邀请码
  boards.ts              看板查询与创建（含列/泳道组装、默认标签播种）
  goals.ts               目标项 + 任务项 + 排入迭代 + 状态派生（业务核心）
  labels.ts              看板级卡片类型 CRUD
  templates.ts           系统级预设 CRUD（仅管理员）
  attachments.ts         检查列表 + 附件（含上传 URL）
  progress.ts            项目进度 + 两种燃尽图查询
  lib/                   纯函数与服务端共享逻辑（无 React、无客户端依赖）
    auth.ts              鉴权守卫（见 §6）
    constants.ts         术语表/颜色/枚举/deriveSprintStatus —— 前后端共用
    password.ts          纯 TS 实现的 PBKDF2-HMAC-SHA256 + randomToken
    burndown.ts          燃尽图读写（基线、序列、upsert）
    activity.ts          logActivity + ActivityType（13 种）
    labelPresets.ts      normalizeColor + seedDefaultLabels
    board.ts             columnsOfBoard
  _generated/            Convex 生成物，不要手改；schema 变更后由 convex dev 重新生成
src/
  main.tsx               Root：按 env 选 Convex client → ConvexProvider → App
  backend.ts             两个后端（prod/dev）的 URL、标签、localStorage 记忆、client 缓存
  App.tsx                视图状态机（无路由库）+ 顶栏/底栏
  session.ts             localStorage 里的 token（key: "flowboard.token"）
  styles.css             全部样式（约 1915 行，见 §8）
  components/
    BoardPage.tsx        1554 行 —— 项目内最主要交互（产品列表 + 迭代视图）
    ProjectPage.tsx      808 行 —— 单项目：看板列表、成员、进度、燃尽图
    ProjectsPage.tsx     493 行 —— 项目列表、创建、邀请码加入
    ui.tsx               共享 UI 原语（Modal/Drawer/Toast/ConfirmButton…）
    types.ts             客户端手写的 Convex 返回类型（保留 Id<> 品牌）
    lib/ui.ts → src/lib/ui.ts   ERROR_MESSAGES + describeError + 格式化
    AuthPage / AccountPage / AdminPage / PresetPage
    LabelManager / TemplateEditor / ColorPicker / BurndownChart / ErrorBoundary
scripts/                 运维脚本（多数具破坏性，见 §10）
  backup-deployments.sh  【强制】schema 变更前备份 dev + prod（见 §12）
backups/                 备份产物（**已 gitignore**：含 sessions 明文 token）
snapshots/               数据快照（已 gitignore）
```

---

## 4. 数据模型（15 张表）

完整定义见 `convex/schema.ts`。索引是查询性能的关键，**新增查询前先确认有可用索引**。

| 表 | 作用 | 主要索引 |
| --- | --- | --- |
| `users` | 账号。`role: admin\|member`，`status: active\|suspended` | `by_email`, `by_role` |
| `sessions` | 自建会话票据，TTL **30 天** | `by_token`, `by_user` |
| `projects` | 项目。`key` = 6 位邀请码，`sprintLengthDays`（默认 14） | `by_owner`, `by_key` |
| `projectMembers` | 成员关系。`role: owner\|member` —— **写权限的唯一依据** | `by_project`, `by_user`, `by_project_user` |
| `joinRequests` | 申请加入 / 邮件邀请，统一为一条记录 | `by_project_status`, `by_user_status`, `by_project_user` |
| `boards` | 看板。`kind: backlog\|sprint`，sprint 带日期/编号/goal | `by_project`, `by_project_kind` |
| `labels` | 卡片类型。`scope: system\|project` | `by_board`, `by_board_position`, `by_scope_kind(_position)` |
| `columns` | **仅**产品列表的三列，`isDone` 标记终态 | `by_board`, `by_board_position` |
| `goals` | 目标项。`labelId` 引用、`sprintId?`（有值 ⇒ 处理中）、`value?` 1–10 | `by_board_column`, `by_board`, `by_column`, `by_project`, `by_label`, `by_sprint` |
| `tasks` | 任务项。`status`、`startDate?`、`estimatedHours?`、`actualCompletedAt?`、`actualHours?` | `by_board`, `by_project`, `by_assignee`, `by_label` |
| `goalTasks` | 目标项 ↔ 任务项 **多对多** | `by_goal`, `by_task`, `by_project` |
| `checklistItems` | 检查项（目标项验收条件） | `by_goal`（含 position）, `by_project` |
| `attachments` | 附件元数据 + `storageId` | `by_goal`（含 createdAt）, `by_project` |
| `activityLog` | 状态改变日志，13 种 `type` | `by_board`, `by_project`（含 createdAt）, `by_goal` |
| `burndown` | 燃尽图快照，`scope: sprint\|release`，一行一 (scope, board, key) | `by_project_scope`, `by_scope_board` |

注意：`sprintStatus` 字段虽存在于 `boards`，但读取一律走 `deriveSprintStatus()`（由日期推导），不要依赖存储值。

---

## 5. 业务规则与不变量（改动前必读）

### 目标项 vs 任务项（最核心的划分）

- **目标项**活在预期成果看板里，**没有负责人、没有截止日期**；它的状态列完全由任务派生。
- **任务项**活在某个迭代里，**必须有负责人、必须有预计完成日期、必须关联 ≥1 个目标项**；关联的目标项必须属于同一迭代。
- 一个任务可以服务多个目标项（`goalTasks` 多对多）。
- **卡片不填描述**：目标项与任务项都只以名称表达，UI 里**没有任何描述输入框**
  （任务项在 schema 里本来就没有 `description` 字段）。
  `goals.description` 这个列**仍保留在 schema 里**，`createGoal` 会写入 `""`、
  `updateGoal` 也仍接受它 —— 属于**已弃用但未删除**的字段，为的是不做破坏性迁移、
  也不丢历史数据。真正的删除需要改 `convex/schema.ts` 并跑迁移，得按 §12 的流程来。
- **新建卡片只要名称，类别后置**：新增目标项只有一个名称输入框；新增任务项只收名称 / 负责人 /
  预计完成日期 / 关联目标项。类别在**详情面板**里设置 —— 目标项在 `GoalDrawer`，任务项在 `TaskEditor`，
  两边都**可选**（下拉里有「未分类」）。服务端 `createGoal` / `createTask` 的 `labelId` 因此是可选参数。
- **目标项的类别与任务项的类别是两套词表，不要混用**：`labels` 属于**单个看板**（`labels.boardId`）。
  目标项永远活在预期成果看板，所以它的类别只能取自**该看板**的词表；任务项的类别取自
  **它所在那个迭代自己的**词表。因此 `getBoard` 同时返回两个列表：
  `labels`（当前看板，供任务项）与 `goalLabels`（预期成果看板的，供目标项）。
  `GoalDrawer` 在迭代看板上也能被打开，必须用 `goalLabels`，否则 `labelOfBoard` 会以
  `LABEL_NOT_ON_BOARD` 拒绝。
- 卡片上的类别**只以颜色小方框呈现**（`LabelSquare` / `.label-square`），**没设类别就不显示方块**；
  类别名通过方块的 `title` 提示与详情面板可见。

### 目标项状态派生（`goals.ts: syncGoalStatus` / `isGoalComplete`）

```
已完成  ⇐ 至少 1 个任务 且 全部任务 done
处理中  ⇐ 未全部完成，但 sprintId 有值（已排入迭代）
待处理  ⇐ 未排入迭代
```

- **空任务集不算完成**（否则新建目标项会立刻"已完成"）。这是刻意的，不要"修复"。
- **手工新增只能落在「待处理」**：服务端 `createGoal` 拒绝把新目标项建到 处理中 / 已完成
  （`NEW_GOAL_MUST_BE_PENDING`），客户端也只在「待处理」列渲染新增框。
  否则会写进一个与派生规则立刻矛盾的列状态（处理中却没有 `sprintId`）。
- 状态列只在服务端派生写入，客户端**不允许**把目标项拖到别的列。
- 任何影响任务的改动后都会重算目标项状态并刷新燃尽图。

### 任务状态流转（`goals.ts: setTaskStatus`）

| 目标状态 | 服务端行为 |
| --- | --- |
| → `in_progress` | 打 `startDate`（若空）、写入 `estimatedHours`、清空 `actualCompletedAt`/`actualHours` |
| → `done` | 打 `startDate`（若空）、打 `actualCompletedAt = now`、写入 `actualHours` |
| → `proposed` | **清空全部四个字段**（重新开始计时，数字保持诚实） |

- 客户端强制**逐级推进**：不能 `proposed → done` 一步到位；`done` 可「撤回」。
- 进入 `in_progress` 时客户端弹窗强制要求预计工时，进入 `done` 时强制要求耗费工时（>0）。
- 返回 `{ goalsCompleted }`，供 UI 提示。

### 迭代（Sprint）

- 每个项目**恰好一个**未归档 backlog（重复创建 → `BACKLOG_ALREADY_EXISTS`）；`createProject` 会自动建 backlog 及三列。
- 产品列表三列固定为 待处理 / 处理中 / 已完成；迭代看板**没有自己的列**，三条泳道由 `tasks.status` 派生。
- `sprintStatus` 由日期推导：开始日当天仍为 未开始，次日起 进行中，结束日之后 已结束。
- 默认周期 14 天（`DEFAULT_SPRINT_DAYS`）；`projects.sprintLengthDays` 校验 1–90，**只影响之后新建的迭代**。
- `endDate` 可省略，服务端按 `startDate + sprintLengthDays * DAY_MS` 补全；`endDate <= startDate` → `INVALID_SPRINT_RANGE`。
- **排入迭代（`planGoalToSprint`）只允许 未开始 的迭代** —— 迭代一旦开始，范围冻结（`SPRINT_NOT_PLANNED`）。
- **移出迭代**（`sprintId: undefined`）会连带删除该目标项的任务：任务属于迭代，会变孤儿；
  但**检查项与附件跟随目标项，保留不动**。
- 迭代名称留空时服务端自动命名为 `迭代 N`（N = 现有最大编号 + 1）。

### 卡片类型 / 标签（`labels.ts`, `templates.ts`, `lib/labelPresets.ts`）

- 一张表两种 scope：`system`（管理员维护的预设，无 boardId）/ `project`（某看板的自有词汇）。
- **卡片只存 `labelId` 引用**，名称与颜色只存一份。删除标签时若有卡片引用 → `LABEL_IN_USE`；最后一个 → `CANNOT_DELETE_LAST_LABEL`。
- 新建看板时**复制**词汇表：优先复制同项目其它看板的标签，只有项目第一个看板才回退到系统预设。
  → 管理员改预设**不会**改写已有卡片。
- `normalizeColor` 只接受 `#rgb` / `#rrggbb`，其它一律回退 `#64748b`（客户端 `ColorPicker` 复用同一函数）。

### 进度与燃尽图（`progress.ts`, `lib/burndown.ts`）

- 项目进度**只按目标项计数**（不是任务项）。`percent = round(completed / total * 100)`，分母为 0 时为 0。
- 燃尽图表一表两用，靠 `scope` 区分：
  - `sprint`：x = 迭代内日期（`"YYYY-MM-DD"`），y = **剩余工时**（未完成任务的 `estimatedHours` 之和）。
    注意：预计工时在「开始执行」时才录入，所以**没人认领的任务暂时不计入**。
  - `release`：x = 迭代 id，y = **剩余客户价值估计**（`completedAt === undefined` 的 goals 的 `value` 之和）。
    未估值的项目贡献 0。
- `baseline` = 迭代开始时的工时 / 立项时的点数；`ideal` 为直线。
- 写入是**按 key upsert**：重开一个目标项会改写当天读数而不是追加一行。
- `scripts/project-snapshot.mjs` **刻意不备份 `burndown`**（派生数据）。

### 检查项与附件

- 检查项（`checklistItems`）是**目标项的验收条件**，与任务表完全独立；文本上限 300。
  **UI 里只保留文本**：不记检查人、也不记检查时间（`assigneeId` / `checkDate` 两个列仍在 schema 与
  `addCheck` 入参里，属**已弃用但未删除**，服务端本来就把它们当可选参数）。
  历史上那两个 `CHECK_ASSIGNEE_REQUIRED` / `CHECK_DATE_REQUIRED` 错误码**服务端早已不再抛出**
  （只有客户端 `ERROR_MESSAGES` 还留着），已随这次改动一并删掉。
- 附件上限 **20 MB**；`isImage` 由**服务端**按 content type 判定（png/jpeg/gif/webp/svg+xml/avif），客户端无法伪装。
- 图片返回内联可渲染 URL；文档走 `getAttachmentUrl` 取一次性签名 URL 后下载。
- `ctx.storage.delete` 是 best-effort（存储非事务），失败只留下孤儿 blob，不报错。

### 其他约束速查

- 标题上限 160（目标项/任务项）、看板名与项目名上限 80、标签名 24、预设名 24、检查项文本 300。
- 密码最小长度 `MIN_PASSWORD_LENGTH`（前端提示「至少 6 位」）；注册邮箱走正则校验并 `trim()+toLowerCase()` 归一化。
- 登录失败**不区分**「用户不存在」与「密码错误」，统一 `INVALID_CREDENTIALS`（防账号枚举）。
- **第一个注册的账号自动成为管理员**（`isFirstUser`）。`scripts/reset-data.sh` 清空 users 表就是为了这个引导流程。
- 管理员不能停用自己（`CANNOT_SUSPEND_SELF`）；系统必须保留 ≥1 名管理员（`LAST_ADMIN`）。
- **停用账号会立即删除其全部会话**（`setUserStatus`）。
- 项目分页 `pageWindow` 把 limit 夹到 [1, 50]、offset ≥ 0。

---

## 6. 权限模型（`convex/lib/auth.ts`）

**鉴权是自建的，不是 Convex Auth、不用 `ctx.auth`。** 每个 Convex 函数都收一个
`token: v.optional(v.string())` 参数，服务端查 `sessions.by_token` 并把 `expiresAt <= now` 视为无效。

| 守卫 | 语义 | 失败错误码 |
| --- | --- | --- |
| `getUserByToken` | 解析票据，无效/过期返回 null | — |
| `requireUser` | 必须是有效且未停用的账号 | `UNAUTHENTICATED` / `SUSPENDED` |
| `requireAdmin` | 全局管理员 | `FORBIDDEN` |
| `requireProjectMember` | **写权限的唯一依据**：必须是项目成员 | `PROJECT_NOT_FOUND` / `NOT_A_PROJECT_MEMBER` |
| `requireBoardMember` | 由看板反查项目并要求成员 | `BOARD_NOT_FOUND` |
| `requireProjectOwnerOf` | 项目 owner 专属：建看板、加目标项 | `PROJECT_OWNER_ONLY` |
| `requireLabelEditor` | 系统预设要 admin；项目标签要 owner | `FORBIDDEN` / `PROJECT_OWNER_ONLY` |
| `requireColumnOfBoard` | 列必须属于该看板 | `COLUMN_NOT_FOUND` |

**关键设计（易踩坑）：全局管理员在项目内是「只读访客」。**
管理员可以查看任何项目，但**写操作以项目成员身份为准**，所以管理员不会悄悄改别人的看板。
反之，`requireProjectOwnerOf` 才是"只有项目经理能做的事"。

**已知不一致（UI 比服务端更严，改动时注意）：**
`getProject` 把 `pendingRequests` 返回给**所有成员**，`decideJoinRequest` / `inviteUser` / `updateProject`
服务端也只要求「是成员」，而 UI 只对 owner 显示这些入口。服务端并未强制 owner。

---

## 7. 后端 API 一览

按模块列出全部导出（`returns` 校验器已写全，改返回值要同步改校验器与 `src/components/types.ts`）。

- **auth.ts**：`register` `login` `logout` `me` `listUsers` `setUserRole` `setUserStatus` `adminStats` `isAdmin`
- **projects.ts**：`createProject` `listMyProjects` `listAllProjects` `myInvitations` `getProject` `discoverProjects`
  `requestToJoin` `inviteUser` `requestToJoinByKey` `decideJoinRequest` `respondToInvitation`
  `listMyJoinRequests` `removeMember` `updateProject` `deleteProject`
- **boards.ts**：`listBoards` `getBoard` `createBoard` `updateBoard`（另导出内部 `createBoardRecord`）
- **goals.ts**：`createGoal` `updateGoal` `deleteGoal` `reorderGoal` `planGoalToSprint`
  `effortStats` `listTasks` `createTask` `setTaskStatus` `updateTask` `deleteTask`
  （导出内部复用：`tasksOfGoal` `isGoalComplete` `syncGoalStatus` `customerValue` `tasksOfSprint` `goalIdsOfTask`）
- **labels.ts**：`listLabels` `createLabel` `updateLabel` `deleteLabel` `moveLabel`
- **templates.ts**：`listTemplates` `createTemplate` `updateTemplate` `deleteTemplate`
- **attachments.ts**：`listChecks` `addCheck` `toggleCheck` `updateCheck` `deleteCheck`
  `generateUploadUrl` `createAttachment` `listAttachments` `getAttachmentUrl` `deleteAttachment`
- **progress.ts**：`getProjectProgress` `getSprintBurndown` `getReleaseBurndown` `snapshotBurndown`（另 re-export `columnsOfBoard`）

- 两个契约细节（改之前先读 §5）：
  `createGoal` / `createTask` 的 `labelId` 是**可选**参数（新建只给名称，类别后置）；
  `boards.getBoard` 同时返回 `labels`（本看板词表，供任务项）与 `goalLabels`（预期成果看板词表，供目标项）。

`convex/lib/` 下的模块**必须保持前后端无关**（`constants.ts` 被前端直接 import），不要引入服务端专属依赖。
`password.ts` 是纯 TS 的 PBKDF2-HMAC-SHA256：因为 Convex 的 V8 isolate 不保证有 `crypto.subtle`，
且 `"use node"` 模块不能被同时导出 query/mutation 的文件 import —— 这是刻意的实现，不要换成原生 crypto。

---

## 8. 前端结构与设计系统

### 视图路由

**没有路由库。** `src/App.tsx` 用 `view` 联合类型状态机切换：

```ts
{ kind: "projects" } | { kind: "project"; id } | { kind: "board"; id; projectId }
| { kind: "admin" } | { kind: "presets" } | { kind: "account" }
```

- 顶栏（桌面）与底部 `.tabbar`（≤760px）是同一组目的地；管理员多出「卡片类型」「用户管理」。
- 会话失效（`me === null`）会清 token 并退回登录页；`booting` 期间显示「加载中…」。
- `BoardPage` 需要 `isProjectOwner`，由 `App` 从 `listMyProjects` 首页推导（超出首页范围时降级为只读）。

### 入口、后端切换与错误边界

`src/main.tsx`：`React.StrictMode` → `ErrorBoundary` → `Root` → `ConvexProvider` → `App`。
**ErrorBoundary 包在 Provider 外层**（故意的），这样任何 query 抛出都不会白屏。

`Root`（main.tsx 内）持有「当前后端」这一状态，是整套切换机制的所在地：

- `clientFor(env)`（`src/backend.ts`）按 env 返回缓存的 `ConvexReactClient`；
  **client 不能建在组件 effect 里** —— React StrictMode 会双挂载 effect，而每个 client 握着 websocket。
  按 env 缓存到模块级 Map 里，来回切换最多只有 2 个 client。
- 切换时 `writeToken(null)` 清掉旧 token（**会话只存在于签发它的那个 deployment**），
  再 `writeEnv` + `setEnv`，并以 `<App key={env}>` 强制重挂载，重置所有视图状态。
- **后端地址由运行时决定**：`BACKENDS[env].url`（`src/backend.ts`）是唯一来源，
  可被 `VITE_CONVEX_URL_PROD` / `VITE_CONVEX_URL_DEV` 覆盖。
  ⚠️ `.env.local` 里那个 `VITE_CONVEX_URL` **客户端已经不再读取**了 —— 它只剩
  `scripts/project-snapshot.mjs` 拿它当 sanity gate。**改它不会切换后端**，要改的是上面两个变量
  或 `BACKENDS` 本身。

### 组件分工

- `BoardPage.tsx`（最复杂的一个文件）：`ProductList`、`PlanModal`、`IterationView`、`TaskCard`、`TaskEditor`、
  `TimeModal`、`NewTaskModal`、`EffortStats`、`SprintHeader`、`BoardTabs`、`GoalDrawer`、
  `CheckListSection`、`AttachmentSection`。唯一数据源是 `api.boards.getBoard`。
  文件顶部有 `LabelSquare`（类别颜色小方框，**无类别时返回 null**）与 `findLabel`（按 `labelId` 解析类别）
  两个共享小工具，卡片显示类别一律走它们。
  类别在哪里改（**新建时都不问类别**）：
  | 卡片 | 新建 | 修改类别 | 用哪套词表 |
  | --- | --- | --- | --- |
  | 目标项 | `ProductList` 的单行输入框（**只在「待处理」列渲染**） | `GoalDrawer`（抽屉，选中即存） | `data.goalLabels` |
  | 任务项 | `NewTaskModal`（名称/负责人/期限/关联目标项） | `TaskEditor`（「未分类」可清空） | `data.labels` |

  `GoalDrawer` 的字段是：标题 / 类别 / 客户价值估计 / 检查列表 / 附件 —— **没有描述**
  （见 §5 的「卡片不填描述」），**也没有任务进展统计**（不显示 N/M 个任务已完成、不带进度条；
  目标的完成度看卡片所在列即可）。
- `ProjectPage.tsx`：看板列表（栏目名 **项目看板**）、成员与加入申请、发布燃尽图、进度卡、项目/看板设置弹窗。
  UI **只能新建迭代**（类型选择器过滤掉 backlog），文案说明 backlog 由创建项目时自动生成。
- `ProjectsPage.tsx`：我的项目 / 全部项目（仅 admin）双 scope、创建项目、6 位邀请码加入、邀请处理、分页（PAGE_SIZE 10）。
- `AuthPage.tsx`：登录/注册 + **「后端数据」切换器**（`环境` 只在这里能改）。
  切换写在登录页而不是设置页是**故意的** —— 两个 deployment 的账号互不相通，所以换后端必然要重新登录。
  切换器下方显示当前 deployment 主机名，避免"看不出自己在哪个库"。
- `AdminPage.tsx` 用户管理；`PresetPage.tsx` + `TemplateEditor.tsx` 管理员维护系统预设；
  `LabelManager.tsx` 看板内卡片类型管理（`canManage` 由 owner 决定，非 owner 见「仅项目经理可修改」）。

### 共享 UI 原语（`src/components/ui.tsx`）—— 必须复用，不要自己造

`Avatar` `Badge` `ProgressBar` `Modal` `Drawer` `ConfirmButton` `useToast` `useAsync` `EmptyState`
（`ConfirmButton` 是两步确认 + 3 秒自动解除；`useToast` 2.6 秒自动消失。）

### 错误处理约定（硬性）

1. **绝不把后端错误原文渲染给用户。** 一律 `describeError(err)`（`src/lib/ui.ts`）。
2. **新增后端错误码必须登记**到 `src/lib/ui.ts` 的 `ERROR_MESSAGES`（约 50 条，码 → 中文）。
   `describeError` 用包含匹配（Convex 会在错误上附请求信息与堆栈），匹配不到则去掉 `Uncaught Error:` 取首行，兜底「操作失败」。
3. 每个 mutation 都要 try/catch 并 toast；**当前有若干处遗漏**（见 §11）。

### 样式约定（`src/styles.css`，约 1915 行）

- 单一 `:root`（L1–30）定义全部 token：`--bg` `--surface` `--border(-strong)` `--text/-dim/-faint`
  `--accent(-soft/-text)` `--danger/--success/--warning` + `-soft`、`--shadow-*`、`--radius-*`。
- 深色模式：**只有一个** `@media (prefers-color-scheme: dark)` 块重声明同名变量；无 `data-theme`、无 JS 切换。
  **新增 token 必须同时写进两个 `:root` 块。**
- 移动优先：断点 760px（主）+ 720px + 420px + `prefers-reduced-motion`。**没有 min-width 桌面优先查询。**
- 结构是**追加式**：前 ~1370 行是基础表，之后是按注释分段叠加的覆盖层（2024 refresh / Mobile /
  Device-adaptive navigation / iPhone 16 fixes / burndown / **Card categories** / **backend switcher**）。
  → **新规则追加到文件末尾并写注释段**，不要回头改前面的规则。
- 颜色只能来自 token 或 `color-mix(...)`；仅 JS 侧调色板（`LABEL_PALETTE`、`AVATAR_COLORS`）是硬编码 hex。
- `.tabbar` 在 760px 以上隐藏，以下是固定底栏，**故意 `z-index: 50`**（低于 `.overlay` 的 60）。

### 服务端常量的单一来源

词表/枚举/颜色来自 `convex/lib/constants.ts`（`BOARD_KINDS` `BOARD_KIND_META` `GOAL_COLUMNS`
`GOAL_COLUMN_META` `TASK_STATUSES` `TASK_LANES` `TASK_STATUS_META` `SPRINT_STATUS_META` `DEFAULT_LABELS`
`LABEL_PALETTE` `DAY_MS` `DEFAULT_SPRINT_DAYS` `deriveSprintStatus`）与 `lib/labelPresets.ts`（`normalizeColor`）。
**前端直接 import 这些**，不要在客户端复制一份 —— 这样客户端校验与服务端完全一致。

---

## 9. 部署

### 前端（Cloudflare Pages）

- `wrangler.toml`：`name = "kb-app"`，`compatibility_date = "2024-11-01"`，`pages_build_output_dir = "dist"`。
  无 `[env]` / routes / vars。
- SPA 回退规则**不在 wrangler.toml**，而在 `public/_redirects`：`/*  /index.html  200`，Vite 会原样拷进 `dist/`。
- 部署：`npm run build` → `wrangler pages deploy dist --project-name=kb-app --branch=main`
  （wrangler 是**全局**安装的，不在 `node_modules`；需要 `wrangler login`，凭证在 `~/Library/Preferences/.wrangler`）。
- 验证：拉生产域名看 bundle 哈希是否等于本地 `dist/assets/`，再核对关键文案（不要只看 HTTP 200）。
- `dist/` 是本地构建产物（已 gitignore，文件名哈希随构建变化），**不要当源码用、也不要提交**。

### 后端（两个 Convex deployment）

前端与后端是**两个独立部署**，`convex/` 的改动不会随 `pages.dev` 生效。

| | dev | prod |
| --- | --- | --- |
| 推送命令 | `npx convex dev --once` | `npx convex deploy` |
| 数据 | 全部历史数据 | 空库（2026-10-11 初始化） |
| 错误信息 | 完整（含错误码与堆栈） | **被脱敏**（见 §11） |

- `npx convex deploy` **强制交互确认**，非交互终端会直接失败（`Cannot prompt for input`）。
  绕过办法是分配伪终端并把确认喂进去：

  ```bash
  ( sleep 6; printf 'y\n'; sleep 90 ) | script -q /dev/null npx convex deploy
  ```

  注意 `script` 必须先 sleep 再送输入，否则 `y` 会在提示出现前被吃掉、**静默不推送**（退出码仍为 0，需靠
  `auth:me` 是否返回 success 来确认）。
- 只改前端时，若 `convex/*` 的 args 校验器被收紧（例如 `labelId` 由可选变必填），
  **旧后端仍按旧校验器运行**，所以线上旧前端可能先崩 —— 顺序上应「先前端、后后端」。
- `npx convex function-spec` 可以**只读**查看线上 deployment 真实生效的 args/returns 校验器
  （判断某字段是否必填的最快手段）。
- `npx convex export --prod` / `npx convex import --prod` 分别针对产品版。

---

## 10. 脚本与运维（`scripts/`）—— 破坏性操作务必先备份

| 脚本 | 用途 | 破坏性 | 用法 |
| --- | --- | --- | --- |
| `backup-deployments.sh` | **schema 变更前的强制备份**：dev + prod 全量导出 | 只读 | `bash scripts/backup-deployments.sh [--files]`（见 §12） |
| `project-snapshot.mjs` | 备份/恢复示例项目（`复刻雷电游戏`） | backup 只读；**restore 用 `--replace` 整表覆盖** | `node scripts/project-snapshot.mjs backup [--project X]` / `... restore` |
| `purge-except.mjs` | 只保留指定项目及其成员用户 | ⛔ **破坏性**，文件头声明 2026-10-10 起禁止对生产库使用 | `ALLOW_PURGE=1 node scripts/purge-except.mjs [项目名]`（未设 `ALLOW_PURGE=1` 直接 exit 1） |
| `reset-data.sh` | 清空 13 张表（含遗留表 `items`/`labelTemplates`，清单已过期，见 §11）为了「首位注册用户即 admin」引导 | ⛔ **破坏性，无任何确认闸门** | `bash scripts/reset-data.sh` |
| `migrate-label-id.mjs` | 一次性：`labelTemplates` → `labels` 双 scope，`labelName` → `labelId` | ⛔ `--replace`；**必须在 schema 切换前跑，且已执行过，勿重跑** | `node scripts/migrate-label-id.mjs` |
| `migrate-customer-value.mjs` | 一次性：`goals.storyPoints` → `goals.value` | 非破坏性（逐行调 `updateGoal`，不做 `--replace`）；**已执行过** | `CONVEX_URL=<url> node scripts/migrate-customer-value.mjs <token>` |
| `.aud.mjs`（仓库根，未被 gitignore 覆盖） | Playwright 巡检辅助：底栏遮挡、横向溢出、左右越界、点击区 <32px | 只读 | `import { run } from "./.aud.mjs"`，`await run(page, label)` |

**备份格式**：`snapshots/<项目名>-YYYY-MM-DDTHH-MM-SS.json`（24 份 + `latest.json` 指针），
顶层 `savedAt` / `project` / `userIds` / `tables`（14 张表，**不含 burndown**）。

**全量备份格式**（`backup-deployments.sh` 的产物）：`backups/<时间戳>/{dev,prod}.zip`，
Convex 原生快照：`README.md` + `_tables/documents.jsonl`（每行一个文档，含表定义行）。
**`backups/` 必须保持 gitignore** —— 里面有 `sessions` 表的明文 bearer token 和成员邮箱，而本仓库是公开的。

---

## 11. 已知问题与技术债（改动相关代码时留意，勿盲目"顺手修"）

**数据/安全**

- ⚠️ **`.import-tmp.json` 含明文 session token**（7 行会话记录，键含 `token`）。它已被 gitignore，但**建议尽早删除**。
- `snapshots/latest.json` 里存的是**绝对路径** `/Users/alex/workspace/kanban/snapshots/...`，
  与当前 checkout `/Users/alex/git_root/my_kanban` **不一致** → 直接 restore 会失败或读到另一份副本。
- `scripts/reset-data.sh` 的表清单**已漂移**：仍含遗留表 `items`、`labelTemplates`，
  却**不含** goals / tasks / goalTasks / attachments → 它并不会清空当前 schema 的目标项与任务项。
  （snapshot 排除 burndown，purge 包含 burndown，三份清单互不一致。）
- `.gitignore` 覆盖 `.env.local` `node_modules` `dist` `snapshots` `.import-tmp.json` `.wrangler`。
  `.aud.mjs` 与 `wrangler.toml` 既未被忽略、现已被跟踪（注意 `.aud.mjs` 是开发辅助脚本，会随源码公开）。

**后端**

- ⚠️ **产品版会脱敏错误信息，导致前端错误文案全部失效。**
  dev 抛 `throw new Error("INVALID_EMAIL")` 时客户端能收到错误码；**prod 只会收到**
  `"[CONVEX M(auth:register)] [Request ID: …] Server Error\n  Called by client"` —— **没有错误码**。
  实测（websocket，即浏览器真实路径）：

  | | `auth:login`（故意错密码）收到的 message |
  | --- | --- |
  | dev | `…Uncaught Error: INVALID_CREDENTIALS\n at handler (../convex/auth.ts:82:13)` |
  | prod | `…Server Error\n  Called by client` |

  于是 `describeError` 的 `ERROR_MESSAGES` 映射在 prod 上**一个都匹配不到**，用户会看到那句原始字符串。
  已在 `describeError` 里加了兜底：剥掉 `[CONVEX …]` / `[Request ID: …]` 外壳，若只剩 `Server Error`
  就显示「操作失败，请重试」，并对未登记的错误码 `console.warn`。

  **正确的修法**（尚未做）：把 `convex/` 里 127 处 `throw new Error("CODE")` 换成 `throw new ConvexError("CODE")`，
  并让 `describeError` 优先读 `err.data`。只有 `ConvexError` 的载荷在 production deployment 上会透传给客户端。
  这是产品环境可用性的前提，不是可选优化。
- `convex/progress.ts` 的 `effortStats` 与 `listTasks` 的 **returns 校验器**里 `labelId` 仍是 `v.optional` —— 这是对的
  （历史数据可能无类别），不要跟着 args 一起收紧。

**前端**

- **没有任何拖拽实现**（`src/` 内无 `onDrag*` / `draggable` / pointer 事件），排序与流转全靠按钮。
  但 `styles.css:617` `.column.drag-over` 与 `:751` `.drop-line` 是**死 CSS**（疑似早期拖拽版残留）。
- `styles.css:1462` 有一段**没有选择器的孤立声明块**（`display:flex` / `align-items` / `gap:12px` /
  `margin-top:20px` / `padding:12px 16px` 共 6 条声明），浏览器会静默丢弃这整块，
  `vite build` 也会打出 `css-syntax-error` 警告（不阻断构建）。
  位于「2024 refresh」追加层，疑似编辑时把选择器行误删；仓库无历史提交可对照，
  **无法确定原选择器，故未擅自补上** —— 修它需要先确认这些声明原本属于哪个元素。
- **`goals.description` 是已弃用但未删除的字段**：UI 已完全不收集、不显示描述（见 §5）。
  它仍在 schema 与 `createGoal` / `updateGoal` 的入参里，`createGoal` 固定写 `""`。
  要真正删列需按 §12 走（备份 dev + prod → 改 schema → 迁移清掉已有文档上的该字段 → 推送）。
- `ProjectPage.submitBoard` **不传 `description`**（服务端 `createBoard` 也无此参数）→ 新建迭代弹窗里的
  「描述（可选）」输入框**是死的**，用户填了会被静默丢弃。属于与上面同类的"描述残留"，
  要么补上 `createBoard` 的 description 参数，要么把这个输入框删掉。
- `AttachmentSection` 把 `getAttachmentUrl` 这个 query 用 `useQuery(api.x, "skip")` + 强制类型转换当**一次性命令式函数**调用 —— 非常规但刻意。
- 多处 mutation 缺 try/catch → 未处理的 rejection：`BoardPage` 的排序按钮、移出迭代、检查项 toggle/remove。
- **`checklistItems.assigneeId` / `checkDate` 是已弃用但未删除的字段**：UI 只保留检查项文本（见 §5）。
  两列仍在 schema 与 `addCheck` / `updateCheck` 入参里，服务端一向把它们当可选参数。
  要真正删列同样得按 §12 走。历史上配套的 `CHECK_ASSIGNEE_REQUIRED` / `CHECK_DATE_REQUIRED`
  两个错误码已从 `ERROR_MESSAGES` 删除（服务端早就不抛它们了）。
- `overdue` 在渲染时用 `Date.now()` 计算 → 页面常开不会自动翻转。
- `SprintHeader` 内 `board.kind === "sprint" ? … : "skip"` 恒真（该组件只在 sprint 下渲染）。
- `BoardPage` 早退 `if (!data) return "加载中…"` → 加载与错误不区分。
- `TaskCard` 有两段重复 JSDoc，第一段已过时；`hours()` 与 `hrs()` 是重复实现。
- 直接展示了错误码字符串 `"INVALID_CUSTOMER_VALUE"` 而非走 `describeError`。
- `ProjectsPage` 的 `listMyJoinRequests` 未加 `"skip"` 守卫（其余 query 都有）。
- `listAllProjects` 返回的 `role` 是按 `ownerId` 推的，不代表调用者的真实成员关系。
- `types.ts` 与 `ProjectPage` 注释里"剩余故事点"是旧叫法，实际纵轴是「剩余客户价值估计」。

---

## 12. 【强制】数据表结构变更流程

**任何对数据表结构（`convex/schema.ts`：加/删表、加/删字段、改字段类型、加/删索引、改枚举）的改动，
都必须按下面四步、按这个顺序执行。** 这条规则优先于「先快速改一下」的冲动。

### 步骤

**1. 先备份 dev 和 prod —— 两个都要**

```bash
bash scripts/backup-deployments.sh          # 加 --files 可连附件一起备份
```

产物：`backups/<时间戳>/{dev,prod}.zip`。脚本会校验归档非空，空归档（例如指错了 deployment）直接 exit 1，
避免出现"以为备份过了"。

**2. 改 schema，并推送到两个 deployment**

```bash
npx convex dev --once     # dev
npx convex deploy         # prod（需要伪终端确认，见 §9）
```

纯新增字段/表/索引不需要数据迁移，Convex 自动处理；索引会在推送后后台构建。

**3. 导入现有数据 —— 仅当变更需要重建表或改写数据时**

```bash
npx convex import --replace backups/<时间戳>/dev.zip
npx convex import --prod --replace backups/<时间戳>/prod.zip
```

⚠️ `--replace` 是**整表覆盖**，会丢掉「导出之后」写入的数据 —— 先确认没有新写入，否则再备份一次。
**纯新增的字段/表不要执行这一步。**

**4. 验证两个环境**

- dev：`npx convex function-spec` 确认 args/returns 校验器符合预期；dev 的报错信息完整，可直接看错误码。
- prod：只能靠**成功返回**判断（`auth:me` 返回 `{"status":"success","value":null}`）。
  **prod 的错误信息被脱敏**（见 §11），拿错误文案做判据会误判成"函数不存在"。

### 为什么两个都要备份

dev 与 prod 是**两个独立数据库**（见 §9），schema 要分别推送。只备份一个，另一个一旦导错就无从恢复。
`backups/` 内含 `sessions` 表的明文 bearer token，**必须保持 gitignore**（本仓库是 public）。

---

## 13. 维护约定 —— 改完代码必须同步本文件

**每次改动后，按下表检查并更新对应章节，然后再交付。** 不要留下过期的 AGENTS.md。

| 若你改了… | 必须更新 |
| --- | --- |
| **`convex/schema.ts`（数据表结构）** | 先按 **§12 强制流程**备份 dev + prod，再推送；并更新 §4 表格、§5 相关规则 |
| 任何 Convex 函数的增删改名、入参或返回结构 | §7 API 一览；若是新错误码 → §5 + `src/lib/ui.ts` 的 `ERROR_MESSAGES` |
| 业务规则/不变量（状态派生、迭代冻结、工时语义…） | §5（这是最需要精确的一节） |
| 权限守卫或成员/管理员语义 | §6 |
| 前端视图、组件增删、状态机、后端切换机制 | §8 |
| 样式 token、断点、class 命名约定 | §8「样式约定」 |
| npm scripts、依赖、构建/部署方式、`.env` 变量、deployment | §2、§9 |
| `scripts/` 增删或破坏性变化、备份/快照格式 | §10、§12 |
| 修掉或新发现的技术债 | §11（修掉的删掉，新发现的补上） |

**给未来 Agent 的硬性要求：**

1. 动手前先读本文件；只有本文件没覆盖的细节才去读源码。
2. 不要"顺手"重构成与本文件描述不符的形态；若确实要改约定，同时改本文件。
3. 改后端行为后**必须至少跑 `npm run typecheck`**（本项目没有测试，这是唯一的自动化防线）。
4. 任何 `--replace` / reset / purge 类命令前先 `project-snapshot.mjs backup`，并明确当前 deployment 不是生产库。
5. 交付时明确说明：改了哪些文件、跑了什么验证、本文件哪几节同步更新了。

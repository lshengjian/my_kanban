import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ---- Identity -------------------------------------------------------
  users: defineTable({
    email: v.string(),
    name: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("active"), v.literal("suspended")),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"]),

  // Token sessions issued by `register` / `login`, stored in the browser.
  sessions: defineTable({
    token: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  // ---- Projects & membership ------------------------------------------
  projects: defineTable({
    name: v.string(),
    key: v.string(), // short invite code, e.g. "K3F9QA"
    description: v.string(),
    ownerId: v.id("users"),
    // Sprint cadence for this project. Optional so it can be introduced on a
    // populated table; readers fall back to DEFAULT_SPRINT_DAYS.
    sprintLengthDays: v.optional(v.number()),
    createdAt: v.number(),
    archived: v.boolean(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_key", ["key"]),

  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    addedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_project_user", ["projectId", "userId"]),

  // A user asks to join, or a member invites them by email.
  joinRequests: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    message: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  })
    .index("by_project_status", ["projectId", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_project_user", ["projectId", "userId"]),

  // ---- Boards ---------------------------------------------------------
  // Two artefacts per project — 预期成果看板 and 敏捷项目管理看板:
  //   backlog — exactly one 预期成果看板: 3 columns of 目标项 (待处理/处理中/已完成)
  //   sprint  — many 迭代列表: the 目标项 it selected, plus their 任务项
  boards: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    kind: v.union(v.literal("backlog"), v.literal("sprint")),
    description: v.string(),
    // Sprint-only lifecycle. Absent on the product list.
    sprintNumber: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    sprintStatus: v.optional(
      v.union(v.literal("planned"), v.literal("active"), v.literal("closed")),
    ),
    goal: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    archived: v.boolean(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_kind", ["projectId", "kind"]),

  // ---- Labels (卡片类型) -------------------------------------------------
  // One table holds both levels:
  //   scope "system"  — the presets an administrator curates. `kind` selects
  //                     which board kind they seed; `boardId` is absent.
  //   scope "project" — a board's own vocabulary, *copied* from the presets
  //                     when the board is created and then free to diverge.
  // Cards store only the label id, so a name or colour lives here exactly once
  // no matter how many cards use it.
  labels: defineTable({
    scope: v.union(v.literal("system"), v.literal("project")),
    // Set for project labels; absent for system presets.
    boardId: v.optional(v.id("boards")),
    projectId: v.optional(v.id("projects")),
    // Which board kind a preset seeds. Absent on project labels.
    kind: v.optional(v.union(v.literal("backlog"), v.literal("sprint"))),
    name: v.string(),
    color: v.string(),
    position: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_board_position", ["boardId", "position"])
    .index("by_scope_kind", ["scope", "kind"])
    .index("by_scope_kind_position", ["scope", "kind", "position"]),

  // The product list's three goal statuses. Sprint boards have no columns of
  // their own: their three task lanes are fixed by the spec and derived from
  // `tasks.status`, so nothing here needs to be editable.
  columns: defineTable({
    boardId: v.id("boards"),
    projectId: v.id("projects"),
    name: v.string(),
    position: v.number(),
    // `isDone` marks the terminal (已完成) column: goals landing here count as
    // complete for progress + burndown.
    isDone: v.boolean(),
    color: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_board_position", ["boardId", "position"]),

  // ---- Goals (目标项) ---------------------------------------------------
  // The team's shared commitments. A goal deliberately has **no owner and no
  // due date** — it lives in the product list as a living backlog ordered by
  // the 产品经理, and its status is derived from its tasks, never dragged.
  goals: defineTable({
    projectId: v.id("projects"),
    // Always the product list; a goal never changes board.
    boardId: v.id("boards"),
    columnId: v.id("columns"),
    title: v.string(),
    // A reference, not a copy: the name and colour live on the label row.
    // Deleting the label is blocked while a card still points at it.
    labelId: v.optional(v.id("labels")),
    // The 迭代 this goal is committed to. Present ⇒ it is 处理中.
    sprintId: v.optional(v.id("boards")),
    // 客户价值估计 — 1~10 的相对价值刻度，由 PO 评定。
    // 这是发布燃尽图的纵轴单位。
    value: v.optional(v.number()),
    position: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_board_column", ["boardId", "columnId", "position"])
    .index("by_board", ["boardId"])
    .index("by_column", ["columnId"])
    .index("by_project", ["projectId"])
    .index("by_label", ["labelId"])
    .index("by_sprint", ["sprintId"]),

  // ---- Tasks (任务项) --------------------------------------------------
  // The executable units the team breaks a goal down into, inside one 迭代.
  // Unlike a goal, a task is owned, dated and time-tracked.
  tasks: defineTable({
    projectId: v.id("projects"),
    // The 迭代 this task belongs to. Every linked goal must be in the same one.
    boardId: v.id("boards"),
    title: v.string(),
    assigneeId: v.id("users"),
    // 计划完成时间 — required when the task is proposed.
    dueDate: v.number(),
    // A reference, not a copy — see the note on goals.
    labelId: v.optional(v.id("labels")),
    status: v.union(
      v.literal("proposed"),
      v.literal("in_progress"),
      v.literal("done"),
    ),
    // Set automatically on the first move to 执行中.
    startDate: v.optional(v.number()),
    // 预计工时 — entered by the user alongside that move.
    estimatedHours: v.optional(v.number()),
    // Set automatically on the move to 已完成.
    actualCompletedAt: v.optional(v.number()),
    // 耗费工时 — entered by the user alongside that move.
    actualHours: v.optional(v.number()),
    position: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_board", ["boardId"])
    .index("by_project", ["projectId"])
    .index("by_assignee", ["assigneeId"])
    .index("by_label", ["labelId"]),

  // Every task belongs to at least one goal, and may serve several: this is the
  // many-to-many join between a 目标项 and its 任务项.
  goalTasks: defineTable({
    projectId: v.id("projects"),
    goalId: v.id("goals"),
    taskId: v.id("tasks"),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_goal", ["goalId"])
    .index("by_task", ["taskId"])
    .index("by_project", ["projectId"]),

  // ---- Checklists (检查列表) -------------------------------------------
  // Acceptance criteria on a 目标项: the things that must be true for the goal
  // to be met. Independent of the task table — tasks are *work*, checks are
  // *conditions*.
  checklistItems: defineTable({
    projectId: v.id("projects"),
    goalId: v.id("goals"),
    text: v.string(),
    done: v.boolean(),
    position: v.number(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_goal", ["goalId", "position"])
    .index("by_project", ["projectId"]),

  // ---- Attachments (附件) ----------------------------------------------
  // Schematics are shown inline; documents (Word/PDF/…) are offered for
  // download. `isImage` is decided server-side from the content type, so the
  // client cannot claim a .doc is a picture.
  attachments: defineTable({
    projectId: v.id("projects"),
    goalId: v.id("goals"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    isImage: v.boolean(),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_goal", ["goalId", "createdAt"])
    .index("by_project", ["projectId"]),

  // ---- Activity log (状态改变日志) -------------------------------------
  activityLog: defineTable({
    projectId: v.id("projects"),
    boardId: v.optional(v.id("boards")),
    goalId: v.optional(v.id("goals")),
    taskId: v.optional(v.id("tasks")),
    actorId: v.id("users"),
    type: v.string(),
    message: v.string(),
    fromColumnId: v.optional(v.id("columns")),
    toColumnId: v.optional(v.id("columns")),
    createdAt: v.number(),
  })
    .index("by_board", ["boardId", "createdAt"])
    .index("by_project", ["projectId", "createdAt"])
    .index("by_goal", ["goalId"]),

  // ---- Burndown -------------------------------------------------------
  // ---- Burndown snapshots ----------------------------------------------
  // Two different charts with different axes, so one table carries both and
  // `scope` says which reading applies:
  //
  //   sprint  — x = calendar day inside one 迭代,
  //             y = 本期任务剩余工时 of that sprint's tasks.
  //   release — x = 迭代,
  //             y = 成果的价值估计 of the goals not yet completed.
  //
  // `key` is the x value: "2026-03-14" for a sprint day, or the sprint's id
  // for a release point. One row per (scope, board, key), upserted in place so
  // reopening a goal rewrites today's reading instead of appending.
  burndown: defineTable({
    projectId: v.id("projects"),
    scope: v.union(v.literal("sprint"), v.literal("release")),
    // Only for scope "sprint".
    boardId: v.optional(v.id("boards")),
    key: v.string(),
    at: v.number(),
    /** Baseline the axis is drawn against: hours at sprint start, points at kickoff. */
    baseline: v.number(),
    /** Current value on the y axis. */
    remaining: v.number(),
  })
    .index("by_project_scope", ["projectId", "scope"])
    .index("by_scope_board", ["scope", "boardId"]),
});

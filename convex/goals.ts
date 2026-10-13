import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import {
  isProjectMember,
  requireBoardMember,
  requireProjectOwnerOf,
  requireUser } from "./lib/auth";
import { columnsOfBoard } from "./lib/board";
import { recordReleaseBurndown, recordSprintBurndown } from "./lib/burndown";
import { GOAL_COLUMNS, TASK_LANES, deriveSprintStatus } from "./lib/constants";

const MAX_TITLE = 160;

/* ------------------------------------------------------------------ *
 * 目标项 (goals)
 * ------------------------------------------------------------------ */

/** The product list's column with this name. */
async function columnNamed(
  ctx: QueryCtx | MutationCtx,
  boardId: Id<"boards">,
  name: string,
): Promise<{ _id: Id<"columns">; name: string; isDone: boolean; position: number; color?: string }> {
  const columns = await columnsOfBoard(ctx, boardId);
  const found = columns.find((c) => c.name === name);
  if (!found) throw new Error("COLUMN_NOT_FOUND");
  return found;
}

export async function tasksOfGoal(
  ctx: QueryCtx | MutationCtx,
  goalId: Id<"goals">,
): Promise<Doc<"tasks">[]> {
  const links = await ctx.db
    .query("goalTasks")
    .withIndex("by_goal", (q) => q.eq("goalId", goalId))
    .collect();
  if (links.length === 0) return [];
  const tasks = await Promise.all(links.map((l) => ctx.db.get(l.taskId)));
  return tasks.filter((t): t is Doc<"tasks"> => t !== null);
}

/**
 * 把目标项放进某一列，维护 `completedAt` 并刷新燃尽图。
 *
 * 手工移动（`moveGoal`）与排入/移出迭代（`syncGoalStatus`）共用这一段，
 * 避免两处各写一套、日子久了行为漂移。
 */
async function applyColumn(
  ctx: MutationCtx,
  goal: Doc<"goals">,
  column: { _id: Id<"columns">; name: string; isDone: boolean },
  actorId: Id<"users">,
  message: string,
): Promise<void> {
  const from = goal.columnId;
  await ctx.db.patch(goal._id, {
    columnId: column._id,
    updatedAt: Date.now(),
    // 进终态列时记完成时间、离开时清掉 —— 进度与发布燃尽图都读这个字段。
    completedAt: column.isDone ? (goal.completedAt ?? Date.now()) : undefined,
  });

  await logActivity(ctx, {
    projectId: goal.projectId,
    boardId: goal.boardId,
    goalId: goal._id,
    actorId,
    type: "goal_moved",
    message,
    fromColumnId: from,
    toColumnId: column._id,
  });

  // 预期成果看板与它所在的迭代都要重画。
  await recordReleaseBurndown(ctx, goal.projectId);
  if (goal.sprintId) await recordSprintBurndown(ctx, goal.projectId, goal.sprintId);
}

/**
 * 排入/移出迭代时同步「待处理 ⇄ 处理中」。
 *
 * **注意：目标项的列不再由任务派生。** 任务全部完成**不会**再自动把目标项改成
 * 「已完成」—— 有些项目只想跟踪目标项本身，完成与否由项目 owner 在成果看板上
 * 手工移动决定（见 `moveGoal`）。
 *
 * 「已完成」是手工结果，因此是**粘性**的：排入迭代不会把它拉回「处理中」。
 */
export async function syncGoalStatus(
  ctx: MutationCtx,
  goal: Doc<"goals">,
  actorId: Id<"users">,
): Promise<{ changed: boolean; columnName: string }> {
  const done = await columnNamed(ctx, goal.boardId, GOAL_COLUMNS[2]);
  if (goal.columnId === done._id) return { changed: false, columnName: GOAL_COLUMNS[2] };

  const name = goal.sprintId ? GOAL_COLUMNS[1] : GOAL_COLUMNS[0];
  const column = await columnNamed(ctx, goal.boardId, name);
  if (goal.columnId === column._id) return { changed: false, columnName: name };

  await applyColumn(ctx, goal, column, actorId, `「${goal.title}」移入${name}`);
  return { changed: true, columnName: name };
}

/**
 * 手工把目标项移到成果看板的另一列 —— **只有项目 owner 可以**。
 *
 * 这是「目标项与任务解耦」的入口：简单的项目可以完全不建任务，只靠移动列来跟踪。
 * 每次移动都写一条 `goal_moved` 日志，前端按时间倒序展示。
 */
export const moveGoal = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    columnId: v.id("columns"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireProjectOwnerOf(ctx, goal.projectId, user._id);

    const column = await ctx.db.get(args.columnId);
    // 列必须属于该目标项所在的看板，防止跨板乱移。
    if (!column || column.boardId !== goal.boardId) throw new Error("COLUMN_NOT_FOUND");
    if (column._id === goal.columnId) return null;

    const from = await ctx.db.get(goal.columnId);
    await applyColumn(
      ctx,
      goal,
      column,
      user._id,
      `「${goal.title}」从${from?.name ?? "未知列"}移到${column.name}`,
    );
    return null;
  },
});

/** Creates a 目标项 in the product list. Goals carry no owner and no due date. */
/** 客户价值估计 is an integer 1–10; anything else is treated as unset. */
export function customerValue(raw: number | undefined): number | undefined {
  if (raw === undefined || !Number.isFinite(raw)) return undefined;
  const n = Math.round(raw);
  return n >= 1 && n <= 10 ? n : undefined;
}

export const createGoal = mutation({
  args: {
    token: v.optional(v.string()),
    boardId: v.id("boards"),
    columnId: v.optional(v.id("columns")),
    title: v.string(),
    // 类别 is optional: a 目标项 is captured by name first and categorised
    // later from its detail panel.
    labelId: v.optional(v.id("labels")),
    position: v.optional(v.number()),
    /** 客户价值估计 — 1~10 的相对价值刻度，发布燃尽图的纵轴单位。 */
    value: v.optional(v.number()),
  },
  returns: v.id("goals"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { board } = await requireBoardMember(ctx, args.boardId, user._id);
    if (board.kind !== "backlog") throw new Error("GOALS_LIVE_IN_PRODUCT_LIST");
    // The product list is the owner's backlog: members work the sprints, they
    // do not author what goes into them.
    await requireProjectOwnerOf(ctx, board.projectId, user._id);

    const title = args.title.trim();
    if (title.length < 1 || title.length > MAX_TITLE) throw new Error("INVALID_TITLE");
    const value = customerValue(args.value);

    const column = args.columnId
      ? (await columnsOfBoard(ctx, args.boardId)).find((c) => c._id === args.columnId)
      : (await columnsOfBoard(ctx, args.boardId))[0];
    if (!column) throw new Error("COLUMN_NOT_FOUND");
    // A goal reaches 处理中 only by being planned into an 迭代, and 已完成 only
    // by finishing its tasks. The product list is therefore hand-filled from
    // 待处理 alone — creating a card straight into a later column would store a
    // state the derivation rule immediately contradicts.
    if (column.isDone || column.name !== GOAL_COLUMNS[0]) {
      throw new Error("NEW_GOAL_MUST_BE_PENDING");
    }

    const now = Date.now();
    const goalId = await ctx.db.insert("goals", {
      projectId: board.projectId,
      boardId: args.boardId,
      columnId: column._id,
      title,
      labelId: await labelOfBoard(ctx, args.boardId, args.labelId),
      value,
      position: args.position ?? Number.MAX_SAFE_INTEGER,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(ctx, {
      projectId: board.projectId,
      boardId: args.boardId,
      goalId,
      actorId: user._id,
      type: "goal_created",
      message: `新增目标项「${title}」`,
    });
    await recordReleaseBurndown(ctx, board.projectId);

    return goalId;
  },
});

export const updateGoal = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    title: v.optional(v.string()),
    labelId: v.optional(v.union(v.id("labels"), v.null())),
    /** 客户价值估计 — 1~10；null 表示清空。修改会刷新发布燃尽图。 */
    value: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.value !== undefined) {
      patch.value = args.value === null ? undefined : customerValue(args.value);
    }
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (title.length < 1 || title.length > MAX_TITLE) throw new Error("INVALID_TITLE");
      patch.title = title;
    }
    if (args.labelId !== undefined) {
      patch.labelId =
        args.labelId === null ? undefined : await labelOfBoard(ctx, goal.boardId, args.labelId);
    }

    await ctx.db.patch(args.goalId, patch);
    return null;
  },
});

export const deleteGoal = mutation({
  args: { token: v.optional(v.string()), goalId: v.id("goals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    for (const task of await tasksOfGoal(ctx, goal._id)) {
      const links = await ctx.db
        .query("goalTasks")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      const orphans = links.filter((l) => l.goalId === goal._id);
      for (const link of orphans) await ctx.db.delete(link._id);
      if (links.length === orphans.length) await ctx.db.delete(task._id);
    }

    // Checks and attachments belong to the goal and go with it.
    for (const check of await ctx.db
      .query("checklistItems")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect()) {
      await ctx.db.delete(check._id);
    }
    for (const row of await ctx.db
      .query("attachments")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect()) {
      await ctx.db.delete(row._id);
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // ignore
      }
    }

    await ctx.db.delete(goal._id);
    await logActivity(ctx, {
      projectId: goal.projectId,
      boardId: goal.boardId,
      actorId: user._id,
      type: "goal_deleted",
      message: `删除目标项「${goal.title}」`,
    });
    await recordReleaseBurndown(ctx, goal.projectId);
    if (goal.sprintId) await recordSprintBurndown(ctx, goal.projectId, goal.sprintId);
    return null;
  },
});

/**
 * 产品经理 keeps the product list ordered — that order *is* the priority. Goals
 * are never dragged between columns; the status column follows the goal's
 * tasks.
 */
export const reorderGoal = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    toIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const siblings = (
      await ctx.db
        .query("goals")
        .withIndex("by_board_column", (q) =>
          q.eq("boardId", goal.boardId).eq("columnId", goal.columnId),
        )
        .collect()
    ).sort((a, b) => a.position - b.position || a._creationTime - b._creationTime);

    const without = siblings.filter((g) => g._id !== goal._id);
    const index = Math.max(0, Math.min(Math.floor(args.toIndex), without.length));
    without.splice(index, 0, goal);

    for (let i = 0; i < without.length; i++) {
      await ctx.db.patch(without[i]!._id, { position: i });
    }
    return null;
  },
});

/**
 * 排入迭代 — commits a goal to a sprint. The goal moves to 处理中 on its own
 * because it now belongs to an iteration; it reaches 已完成 only when all of
 * its tasks are done.
 */
export const planGoalToSprint = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    sprintId: v.optional(v.id("boards")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    if (args.sprintId === undefined) {
      // 移出迭代: the goal's tasks belong to that iteration and would be
      // orphaned, so they are cleared with it.
      // Checks and attachments live with the goal, so they are untouched here;
      // only the sprint-scoped tasks are cleared.
      if (goal.sprintId) {
        for (const task of await tasksOfGoal(ctx, goal._id)) {
          const links = await ctx.db
            .query("goalTasks")
            .withIndex("by_task", (q) => q.eq("taskId", task._id))
            .collect();
          const mine = links.filter((l) => l.goalId === goal._id);
          for (const link of mine) await ctx.db.delete(link._id);
          if (links.length === mine.length) await ctx.db.delete(task._id);
        }
        // 只解除迭代归属；`completedAt` 属于手工完成的结果，不动它。
        await ctx.db.patch(goal._id, { sprintId: undefined });
        await logActivity(ctx, {
          projectId: goal.projectId,
          boardId: goal.boardId,
          goalId: goal._id,
          actorId: user._id,
          type: "goal_unplanned",
          message: `「${goal.title}」移出迭代`,
        });
        await recordSprintBurndown(ctx, goal.projectId, goal.sprintId);
      }
      const fresh = await ctx.db.get(goal._id);
      if (fresh) await syncGoalStatus(ctx, fresh, user._id);
      return null;
    }

    const sprint = await ctx.db.get(args.sprintId);
    if (!sprint) throw new Error("SPRINT_NOT_FOUND");
    if (sprint.kind !== "sprint") throw new Error("NOT_A_SPRINT");
    if (sprint.projectId !== goal.projectId) throw new Error("CROSS_PROJECT");
    // Scope is frozen once work starts: only a 尚未开始 的迭代 can take new
    // goals, so a running sprint's commitment stays as it was agreed.
    // A sprint stops accepting goals once its start day has passed.
    if (deriveSprintStatus(sprint) !== "planned") throw new Error("SPRINT_NOT_PLANNED");
    if (goal.sprintId === sprint._id) return null;

    await ctx.db.patch(goal._id, { sprintId: sprint._id, updatedAt: Date.now() });
    const fresh = (await ctx.db.get(goal._id))!;
    await syncGoalStatus(ctx, fresh, user._id);
    await logActivity(ctx, {
      projectId: goal.projectId,
      boardId: sprint._id,
      goalId: goal._id,
      actorId: user._id,
      type: "goal_planned",
      message: `「${goal.title}」排入 ${sprint.name}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ *
 * 任务项 (tasks)
 * ------------------------------------------------------------------ */

export async function tasksOfSprint(
  ctx: QueryCtx | MutationCtx,
  boardId: Id<"boards">,
): Promise<Doc<"tasks">[]> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .collect();
  return tasks.sort((a, b) => a.position - b.position || a._creationTime - b._creationTime);
}

export async function goalIdsOfTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
): Promise<Id<"goals">[]> {
  const links = await ctx.db
    .query("goalTasks")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  return links.map((l) => l.goalId);
}


/**
 * 计划执行统计 — compares 预计工时 against 实际工时.
 *
 * Only tasks that reached 已完成 are compared, because that is the only state
 * where both numbers exist: 预计工时 is captured on the move to 执行中 and
 * 实际工时 on the move to 已完成. The verdict is signed so "over" reads
 * honestly: positive means the work took longer than planned.
 */
export const effortStats = query({
  args: { token: v.optional(v.string()), boardId: v.id("boards") },
  returns: v.object({
    total: v.number(),
    done: v.number(),
    inProgress: v.number(),
    proposed: v.number(),
    // Done tasks only — the ones where both numbers are known.
    estimated: v.number(),
    actual: v.number(),
    // actual − estimated. Positive = over budget.
    delta: v.number(),
    // null while nothing is done yet, so the UI can say "—" instead of 0%.
    deltaPercent: v.optional(v.number()),
    // Per-label breakdown of the completed tasks.
    byLabel: v.array(
      v.object({
        labelId: v.optional(v.id("labels")),
        name: v.string(),
        color: v.string(),
        count: v.number(),
        estimated: v.number(),
        actual: v.number(),
        delta: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireBoardMember(ctx, args.boardId, user._id);

    const [board, tasks, labels] = await Promise.all([
      ctx.db.get(args.boardId),
      tasksOfSprint(ctx, args.boardId),
      ctx.db
        .query("labels")
        .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
        .collect(),
    ]);
    if (!board) throw new Error("BOARD_NOT_FOUND");

    const done = tasks.filter((t) => t.status === "done");
    const sum = (rows: Doc<"tasks">[], key: "estimatedHours" | "actualHours") =>
      rows.reduce((n, t) => n + (t[key] ?? 0), 0);

    const estimated = sum(done, "estimatedHours");
    const actual = sum(done, "actualHours");
    const delta = Math.round((actual - estimated) * 100) / 100;

    const byLabel = new Map<string, Doc<"tasks">[]>();
    for (const task of done) {
      const key = (task.labelId ?? "__none__") as string;
      byLabel.set(key, [...(byLabel.get(key) ?? []), task]);
    }

    return {
      total: tasks.length,
      done: done.length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      proposed: tasks.filter((t) => t.status === "proposed").length,
      estimated,
      actual,
      delta,
      deltaPercent:
        estimated > 0 ? Math.round((delta / estimated) * 1000) / 10 : undefined,
      byLabel: [...byLabel.entries()]
        .map(([key, rows]) => {
          const label = labels.find((l) => (l._id as string) === key);
          const est = sum(rows, "estimatedHours");
          const act = sum(rows, "actualHours");
          return {
            labelId: label?._id,
            name: label?.name ?? "未分类",
            color: label?.color ?? "#64748b",
            count: rows.length,
            estimated: est,
            actual: act,
            delta: Math.round((act - est) * 100) / 100,
          };
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    };
  },
});

export const listTasks = query({
  args: {
    token: v.optional(v.string()),
    boardId: v.id("boards"),
  },
  returns: v.array(
    v.object({
      _id: v.id("tasks"),
      title: v.string(),
      assigneeId: v.id("users"),
      dueDate: v.number(),
      labelId: v.optional(v.id("labels")),
      status: v.union(
        v.literal("proposed"),
        v.literal("in_progress"),
        v.literal("done"),
      ),
      startDate: v.optional(v.number()),
      estimatedHours: v.optional(v.number()),
      actualCompletedAt: v.optional(v.number()),
      actualHours: v.optional(v.number()),
      position: v.number(),
      goalIds: v.array(v.id("goals")),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireBoardMember(ctx, args.boardId, user._id);
    const out = [];
    for (const task of await tasksOfSprint(ctx, args.boardId)) {
      out.push({
        _id: task._id,
        title: task.title,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        labelId: task.labelId,
        status: task.status,
        startDate: task.startDate,
        estimatedHours: task.estimatedHours,
        actualCompletedAt: task.actualCompletedAt,
        actualHours: task.actualHours,
        position: task.position,
        goalIds: await goalIdsOfTask(ctx, task._id),
      });
    }
    return out;
  },
});

/**
 * A card may only be tagged with a category from its own board: the label's
 * name and colour live on that one row and are never copied onto the card.
 */
async function labelOfBoard(
  ctx: QueryCtx | MutationCtx,
  boardId: Id<"boards">,
  labelId: Id<"labels"> | undefined,
): Promise<Id<"labels"> | undefined> {
  if (labelId === undefined) return undefined;
  const label = await ctx.db.get(labelId);
  if (!label) throw new Error("LABEL_NOT_FOUND");
  if (label.scope !== "project" || label.boardId !== boardId) {
    throw new Error("LABEL_NOT_ON_BOARD");
  }
  return labelId;
}

/**
 * Creates a 任务项 and links it to at least one 目标项.
 *
 * All linked goals must already be committed to this same 迭代, which is what
 * keeps a task from floating in a sprint that owns none of its goals.
 */
export const createTask = mutation({
  args: {
    token: v.optional(v.string()),
    boardId: v.id("boards"),
    title: v.string(),
    assigneeId: v.id("users"),
    dueDate: v.number(),
    goalIds: v.array(v.id("goals")),
    // 类别 is optional and comes from the 迭代's own vocabulary — a task's
    // category is not the goal's. Set later, from the task detail panel.
    labelId: v.optional(v.id("labels")),
  },
  returns: v.id("tasks"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { board } = await requireBoardMember(ctx, args.boardId, user._id);
    if (board.kind !== "sprint") throw new Error("TASKS_LIVE_IN_ITERATION");

    const title = args.title.trim();
    if (title.length < 1 || title.length > MAX_TITLE) throw new Error("INVALID_TITLE");
    if (!args.dueDate) throw new Error("DUE_DATE_REQUIRED");

    const unique = [...new Set(args.goalIds)];
    if (unique.length === 0) throw new Error("GOAL_REQUIRED");

    for (const goalId of unique) {
      const goal = await ctx.db.get(goalId);
      if (!goal) throw new Error("GOAL_NOT_FOUND");
      if (goal.projectId !== board.projectId) throw new Error("CROSS_PROJECT");
      if (goal.sprintId !== board._id) throw new Error("GOAL_NOT_IN_SPRINT");
    }
    if (!(await isProjectMember(ctx, board.projectId, args.assigneeId))) {
      throw new Error("ASSIGNEE_NOT_A_MEMBER");
    }

    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      projectId: board.projectId,
      boardId: args.boardId,
      title,
      assigneeId: args.assigneeId,
      dueDate: args.dueDate,
      labelId: await labelOfBoard(ctx, args.boardId, args.labelId),
      status: "proposed",
      position: (await tasksOfSprint(ctx, args.boardId)).length,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });

    for (const goalId of unique) {
      await ctx.db.insert("goalTasks", {
        projectId: board.projectId,
        goalId,
        taskId,
        createdBy: user._id,
        createdAt: now,
      });
    }

    await logActivity(ctx, {
      projectId: board.projectId,
      boardId: args.boardId,
      goalId: unique[0],
      taskId,
      actorId: user._id,
      type: "task_created",
      message: `新增任务项「${title}」`,
    });

    return taskId;
  },
});

/**
 * Moves a task between 提议 / 执行中 / 已完成.
 *
 * Moving into 执行中 stamps the start date automatically and takes the user's
 * 预计工时. Moving into 已完成 stamps the completion time and takes the user's
 * 耗费工时. Reopening clears those stamps so the numbers stay honest.
 */
export const setTaskStatus = mutation({
  args: {
    token: v.optional(v.string()),
    taskId: v.id("tasks"),
    status: v.union(v.literal("proposed"), v.literal("in_progress"), v.literal("done")),
    estimatedHours: v.optional(v.number()),
    actualHours: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    await requireBoardMember(ctx, task.boardId, user._id);

    const now = Date.now();
    const patch: Record<string, unknown> = { status: args.status, updatedAt: now };

    if (args.status === "in_progress") {
      patch.startDate = task.startDate ?? now;
      patch.estimatedHours = args.estimatedHours ?? task.estimatedHours;
      patch.actualCompletedAt = undefined;
      patch.actualHours = undefined;
    } else if (args.status === "done") {
      patch.startDate = task.startDate ?? now;
      patch.actualCompletedAt = now;
      patch.actualHours = args.actualHours ?? task.actualHours;
    } else {
      patch.startDate = undefined;
      patch.estimatedHours = undefined;
      patch.actualCompletedAt = undefined;
      patch.actualHours = undefined;
    }

    await ctx.db.patch(args.taskId, patch);
    // The sprint chart is in 剩余工时, so every task move redraws it.
    await recordSprintBurndown(ctx, task.projectId, task.boardId);

    const lane = TASK_LANES.find((l) => l.status === args.status)?.name ?? args.status;
    await logActivity(ctx, {
      projectId: task.projectId,
      boardId: task.boardId,
      taskId: task._id,
      actorId: user._id,
      type: "task_status",
      message: `任务项「${task.title}」→ ${lane}`,
    });

    // 任务状态不再影响目标项的列（完成与否由人决定，见 moveGoal）；
    // 迭代燃尽图是「剩余工时」，上面已经重画过。
    return null;
  },
});

export const updateTask = mutation({
  args: {
    token: v.optional(v.string()),
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    dueDate: v.optional(v.number()),
    // Explicit null clears the category; omitting it leaves it unchanged.
    labelId: v.optional(v.union(v.id("labels"), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    await requireBoardMember(ctx, task.boardId, user._id);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (title.length < 1 || title.length > MAX_TITLE) throw new Error("INVALID_TITLE");
      patch.title = title;
    }
    if (args.assigneeId !== undefined) {
      if (!(await isProjectMember(ctx, task.projectId, args.assigneeId))) {
        throw new Error("ASSIGNEE_NOT_A_MEMBER");
      }
      patch.assigneeId = args.assigneeId;
    }
    if (args.dueDate !== undefined) {
      if (!args.dueDate) throw new Error("DUE_DATE_REQUIRED");
      patch.dueDate = args.dueDate;
    }
    if (args.labelId !== undefined) {
      patch.labelId =
        args.labelId === null ? undefined : await labelOfBoard(ctx, task.boardId, args.labelId);
    }

    if (Object.keys(patch).length > 1) await ctx.db.patch(args.taskId, patch);
    return null;
  },
});

export const deleteTask = mutation({
  args: { token: v.optional(v.string()), taskId: v.id("tasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("TASK_NOT_FOUND");
    await requireBoardMember(ctx, task.boardId, user._id);

    const links = await ctx.db
      .query("goalTasks")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .collect();
    for (const link of links) await ctx.db.delete(link._id);
    await ctx.db.delete(args.taskId);

    const rest = (await tasksOfSprint(ctx, task.boardId)).filter(
      (t) => t._id !== task._id,
    );
    for (let i = 0; i < rest.length; i++) await ctx.db.patch(rest[i]!._id, { position: i });

    // 删掉带工时的任务会改变「剩余工时」，重画该迭代的燃尽图。
    await recordSprintBurndown(ctx, task.projectId, task.boardId);
    return null;
  },
});


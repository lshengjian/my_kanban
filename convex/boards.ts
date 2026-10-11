import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logActivity } from "./lib/activity";
import {
  publicUser,
  publicUserValidator,
  requireBoardMember,
  requireProjectMember,
  requireProjectOwnerOf,
  requireUser } from "./lib/auth";
import { columnsOfBoard } from "./lib/board";
import { recordReleaseBurndown, recordSprintBurndown } from "./lib/burndown";
import {
  BOARD_KINDS,
  DEFAULT_SPRINT_DAYS,
  DAY_MS,
  GOAL_COLUMN_META,
  TASK_LANES,
  deriveSprintStatus,
} from "./lib/constants";
import { seedDefaultLabels } from "./lib/labelPresets";

/* ------------------------------------------------------------------ *
 * Validators
 * ------------------------------------------------------------------ */

const boardSummaryValidator = v.object({
  _id: v.id("boards"),
  projectId: v.id("projects"),
  name: v.string(),
  kind: v.union(v.literal("backlog"), v.literal("sprint")),
  description: v.string(),
  sprintNumber: v.optional(v.number()),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  sprintStatus: v.optional(v.union(v.literal("planned"), v.literal("active"), v.literal("closed"))),
  goal: v.optional(v.string()),
  createdAt: v.number(),
  archived: v.boolean(),
  goals: v.number(),
  goalsDone: v.number(),
  tasks: v.number(),
  tasksDone: v.number(),
  progress: v.number(),
});

const goalRowValidator = v.object({
  _id: v.id("goals"),
  title: v.string(),
  description: v.string(),
  labelId: v.optional(v.id("labels")),
  sprintId: v.optional(v.id("boards")),
  columnId: v.id("columns"),
  position: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  value: v.optional(v.number()),
  taskTotal: v.number(),
  taskDone: v.number(),
});

const taskRowValidator = v.object({
  _id: v.id("tasks"),
  title: v.string(),
  assigneeId: v.id("users"),
  dueDate: v.number(),
  labelId: v.optional(v.id("labels")),
  status: v.union(v.literal("proposed"), v.literal("in_progress"), v.literal("done")),
  startDate: v.optional(v.number()),
  estimatedHours: v.optional(v.number()),
  actualCompletedAt: v.optional(v.number()),
  actualHours: v.optional(v.number()),
  position: v.number(),
  goalIds: v.array(v.id("goals")),
});

/* ------------------------------------------------------------------ *
 * Project listings
 * ------------------------------------------------------------------ */

export const listBoards = query({
  args: { token: v.optional(v.string()), projectId: v.id("projects") },
  returns: v.array(boardSummaryValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireProjectMember(ctx, args.projectId, user._id);

    const boards = await ctx.db
      .query("boards")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const live = boards.filter((b) => !b.archived);

    const goals = await ctx.db
      .query("goals")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const doneColumns = new Set<string>();
    for (const board of live) {
      for (const column of await columnsOfBoard(ctx, board._id)) {
        if (column.isDone) doneColumns.add(column._id as string);
      }
    }
    const goalDone = new Set(
      goals.filter((g) => doneColumns.has(g.columnId as string)).map((g) => g._id as string),
    );

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const result = live.map((board) => {
      const owned =
        board.kind === "sprint"
          ? goals.filter((g) => g.sprintId === board._id)
          : goals.filter((g) => g.boardId === board._id);
      const done = owned.filter((g) => goalDone.has(g._id as string)).length;
      const sprintTasks = tasks.filter((t) => t.boardId === board._id);
      return {
        _id: board._id,
        projectId: board.projectId,
        name: board.name,
        kind: board.kind,
        description: board.description,
        sprintNumber: board.sprintNumber,
        startDate: board.startDate,
        endDate: board.endDate,
        sprintStatus: board.kind === "sprint" ? deriveSprintStatus(board) : undefined,
        goal: board.goal,
        createdAt: board.createdAt,
        archived: board.archived,
        goals: owned.length,
        goalsDone: done,
        tasks: sprintTasks.length,
        tasksDone: sprintTasks.filter((t) => t.status === "done").length,
        progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      };
    });

    return result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "backlog" ? -1 : 1;
      return (b.sprintNumber ?? 0) - (a.sprintNumber ?? 0);
    });
  },
});

/* ------------------------------------------------------------------ *
 * Board detail
 * ------------------------------------------------------------------ */

/**
 * The product list returns its three columns of 目标项. An 迭代 returns the row
 * of goals it selected plus the three task lanes underneath.
 */
export const getBoard = query({
  args: { token: v.optional(v.string()), boardId: v.id("boards") },
  returns: v.object({
    board: v.object({
      _id: v.id("boards"),
      projectId: v.id("projects"),
      name: v.string(),
      kind: v.union(v.literal("backlog"), v.literal("sprint")),
      description: v.string(),
      sprintNumber: v.optional(v.number()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      sprintStatus: v.optional(v.union(v.literal("planned"), v.literal("active"), v.literal("closed"))),
      goal: v.optional(v.string()),
      createdAt: v.number(),
      archived: v.boolean(),
    }),
    labels: v.array(
      v.object({
        _id: v.id("labels"),
        name: v.string(),
        color: v.string(),
        position: v.number(),
      }),
    ),
    columns: v.array(
      v.object({
        _id: v.id("columns"),
        name: v.string(),
        isDone: v.boolean(),
        position: v.number(),
        color: v.optional(v.string()),
        goals: v.array(goalRowValidator),
      }),
    ),
    lanes: v.array(
      v.object({
        status: v.union(v.literal("proposed"), v.literal("in_progress"), v.literal("done")),
        name: v.string(),
        color: v.string(),
        tasks: v.array(taskRowValidator),
      }),
    ),
    goals: v.array(goalRowValidator),
    members: v.array(publicUserValidator),
    counts: v.object({
      goals: v.number(),
      goalsDone: v.number(),
      tasks: v.number(),
      tasksDone: v.number(),
      estimatedHours: v.number(),
      actualHours: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { board } = await requireBoardMember(ctx, args.boardId, user._id);

    const [labels, ownColumns, memberRows, allGoals, allTasks, allSprints] = await Promise.all([
      ctx.db
        .query("labels")
        .withIndex("by_board_position", (q) => q.eq("boardId", board._id))
        .collect(),
      columnsOfBoard(ctx, board._id),
      ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", board.projectId))
        .collect(),
      ctx.db
        .query("goals")
        .withIndex("by_project", (q) => q.eq("projectId", board.projectId))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_board", (q) => q.eq("boardId", board._id))
        .collect(),
      ctx.db
        .query("boards")
        .withIndex("by_project", (q) => q.eq("projectId", board.projectId))
        .collect(),
    ]);

    // ---- task ↔ goal links, loaded once ----------------------------
    const links = await ctx.db
      .query("goalTasks")
      .withIndex("by_project", (q) => q.eq("projectId", board.projectId))
      .collect();
    const goalIdsByTask = new Map<string, Id<"goals">[]>();
    const tasksByGoal = new Map<string, Doc<"tasks">[]>();
    for (const link of links) {
      const taskKey = link.taskId as string;
      const list = goalIdsByTask.get(taskKey) ?? [];
      list.push(link.goalId);
      goalIdsByTask.set(taskKey, list);
      const task = allTasks.find((t) => t._id === link.taskId);
      if (task) {
        const forGoal = tasksByGoal.get(link.goalId as string) ?? [];
        forGoal.push(task);
        tasksByGoal.set(link.goalId as string, forGoal);
      }
    }

    const toGoalRow = (goal: Doc<"goals">) => {
      const tasks = tasksByGoal.get(goal._id as string) ?? [];
      return {
        _id: goal._id,
        title: goal.title,
        description: goal.description,
        labelId: goal.labelId,
        sprintId: goal.sprintId,
        columnId: goal.columnId,
        position: goal.position,
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
        completedAt: goal.completedAt,
        value: goal.value,
        taskTotal: tasks.length,
        taskDone: tasks.filter((t) => t.status === "done").length,
      };
    };

    const toTaskRow = (task: Doc<"tasks">) => ({
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
      goalIds: goalIdsByTask.get(task._id as string) ?? [],
    });

    // The product list owns the goal columns; an 迭代 borrows them so the goal
    // strip above the task lanes reads 待处理 / 处理中 / 已完成.
    const backlogBoard = allSprints.find((b) => b.kind === "backlog" && !b.archived);
    const columns =
      board.kind === "backlog"
        ? ownColumns
        : backlogBoard
          ? await columnsOfBoard(ctx, backlogBoard._id)
          : [];

    const memberUsers = await Promise.all(memberRows.map((m) => ctx.db.get(m.userId)));
    const members = memberUsers.filter((m) => m !== null).map((m) => publicUser(m));

    const lanes = TASK_LANES.map((lane) => ({
      status: lane.status,
      name: lane.name,
      color: lane.color,
      tasks: allTasks
        .filter((t) => t.status === lane.status)
        .sort((a, b) => a.position - b.position || a._creationTime - b._creationTime)
        .map(toTaskRow),
    }));

    const counts = {
      goals:
        board.kind === "sprint"
          ? allGoals.filter((g) => g.sprintId === board._id).length
          : allGoals.filter((g) => g.boardId === board._id).length,
      goalsDone: 0,
      tasks: allTasks.length,
      tasksDone: allTasks.filter((t) => t.status === "done").length,
      estimatedHours: allTasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0),
      actualHours: allTasks.reduce((sum, t) => sum + (t.actualHours ?? 0), 0),
    };

    return {
      board: {
        _id: board._id,
        projectId: board.projectId,
        name: board.name,
        kind: board.kind,
        description: board.description,
        sprintNumber: board.sprintNumber,
        startDate: board.startDate,
        endDate: board.endDate,
        sprintStatus: board.kind === "sprint" ? deriveSprintStatus(board) : undefined,
        goal: board.goal,
        createdAt: board.createdAt,
        archived: board.archived,
      },
      labels: labels.map((l) => ({
        _id: l._id,
        name: l.name,
        color: l.color,
        position: l.position,
      })),
      columns: columns.map((c) => ({
        _id: c._id,
        name: c.name,
        isDone: c.isDone,
        position: c.position,
        color: c.color,
        goals: allGoals
          .filter((g) => g.columnId === c._id)
          .sort((a, b) => a.position - b.position || a._creationTime - b._creationTime)
          .map(toGoalRow),
      })),
      lanes,
      goals: allGoals
        .filter((g) => (board.kind === "sprint" ? g.sprintId === board._id : g.boardId === board._id))
        .sort((a, b) => a.position - b.position || a._creationTime - b._creationTime)
        .map(toGoalRow),
      members,
      counts: { ...counts, goalsDone: 0 },
    };
  },
});

/* ------------------------------------------------------------------ *
 * Board lifecycle
 * ------------------------------------------------------------------ */

async function nextSprintNumber(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const boards = await ctx.db
    .query("boards")
    .withIndex("by_project_kind", (q) => q.eq("projectId", projectId).eq("kind", "sprint"))
    .collect();
  return boards.reduce((max, b) => Math.max(max, b.sprintNumber ?? 0), 0) + 1;
}

/** Creates a board plus its status columns and label vocabulary. */
async function createBoardRecord(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    projectId: Id<"projects">;
    kind: "backlog" | "sprint";
    name?: string;
    goal?: string;
    startDate?: number;
    endDate?: number;
    sprintStatus?: "planned" | "active" | "closed";
  },
): Promise<Id<"boards">> {
  const now = Date.now();
  const kind = args.kind;
  const number = kind === "sprint" ? await nextSprintNumber(ctx, args.projectId) : undefined;
  const name =
    args.name?.trim() ||
    (kind === "backlog" ? "预期成果看板" : `迭代 ${number ?? 1}`);

  const project = kind === "sprint" ? await ctx.db.get(args.projectId) : null;
  const sprintDays = project?.sprintLengthDays ?? DEFAULT_SPRINT_DAYS;
  const start = args.startDate ?? now;

  const boardId = await ctx.db.insert("boards", {
    projectId: args.projectId,
    name,
    kind,
    description: "",
    sprintNumber: number,
    startDate: kind === "sprint" ? start : undefined,
    endDate: kind === "sprint" ? (args.endDate ?? start + sprintDays * DAY_MS) : undefined,
    sprintStatus: kind === "sprint" ? (args.sprintStatus ?? "planned") : undefined,
    goal: args.goal,
    createdBy: args.userId,
    createdAt: now,
    archived: false,
  });

  // Only the product list carries goal columns; an 迭代's task lanes are fixed
  // by the spec and derived from `tasks.status`.
  if (kind === "backlog") {
    for (let i = 0; i < GOAL_COLUMN_META.length; i++) {
      const spec = GOAL_COLUMN_META[i]!;
      await ctx.db.insert("columns", {
        boardId,
        projectId: args.projectId,
        name: spec.name,
        position: i,
        isDone: spec.isDone,
        color: spec.color,
        createdAt: now,
      });
    }
  }

  const board = await ctx.db.get(boardId);
  if (board) await seedDefaultLabels(ctx, board, args.userId);

  await logActivity(ctx, {
    projectId: args.projectId,
    boardId,
    actorId: args.userId,
    type: "board_created",
    message: `创建${kind === "backlog" ? "预期成果看板" : "敏捷项目管理看板"}「${name}」`,
  });
  await recordReleaseBurndown(ctx, args.projectId, boardId);
  await recordSprintBurndown(ctx, args.projectId, boardId);
  return boardId;
}

export const createBoard = mutation({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    kind: v.union(v.literal("backlog"), v.literal("sprint")),
    name: v.optional(v.string()),
    goal: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  returns: v.id("boards"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    // Only the project owner shapes the structure: the product list and the
    // sprints that goals get planned into.
    await requireProjectOwnerOf(ctx, args.projectId, user._id);

    if (args.kind === "backlog") {
      const existing = await ctx.db
        .query("boards")
        .withIndex("by_project_kind", (q) => q.eq("projectId", args.projectId).eq("kind", "backlog"))
        .collect();
      if (existing.some((b) => !b.archived)) throw new Error("BACKLOG_ALREADY_EXISTS");
    }
    if (args.endDate !== undefined && args.startDate !== undefined && args.endDate <= args.startDate) {
      throw new Error("INVALID_SPRINT_RANGE");
    }

    return createBoardRecord(ctx, {
      userId: user._id,
      projectId: args.projectId,
      kind: args.kind,
      name: args.name,
      goal: args.goal,
      startDate: args.startDate,
      endDate: args.endDate,
    });
  },
});

export const updateBoard = mutation({
  args: {
    token: v.optional(v.string()),
    boardId: v.id("boards"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    sprintStatus: v.optional(v.union(v.literal("planned"), v.literal("active"), v.literal("closed"))),
    goal: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { board } = await requireBoardMember(ctx, args.boardId, user._id);

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 1 || name.length > 80) throw new Error("INVALID_NAME");
      patch.name = name;
    }
    if (args.description !== undefined) patch.description = args.description;
    if (args.goal !== undefined) patch.goal = args.goal;

    if (board.kind === "sprint") {
      const project = await ctx.db.get(board.projectId);
      const days = project?.sprintLengthDays ?? DEFAULT_SPRINT_DAYS;
      if (args.startDate !== undefined) patch.startDate = args.startDate;
      if (args.endDate !== undefined) patch.endDate = args.endDate;
      if (args.sprintStatus !== undefined) patch.sprintStatus = args.sprintStatus;
      const start = (patch.startDate as number | undefined) ?? board.startDate;
      if (start !== undefined && (patch.endDate === undefined) && (patch.startDate !== undefined)) {
        patch.endDate = start + days * DAY_MS;
      }
      const end = (patch.endDate as number | undefined) ?? board.endDate;
      if (start !== undefined && end !== undefined && end <= start) {
        throw new Error("INVALID_SPRINT_RANGE");
      }
    }

    if (args.archived !== undefined) patch.archived = args.archived;

    if (Object.keys(patch).length > 0) await ctx.db.patch(args.boardId, patch);
    return null;
  },
});

export { createBoardRecord, BOARD_KINDS };

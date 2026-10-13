import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireBoardMember, requireProjectMember, requireUser } from "./lib/auth";
import { columnsOfBoard } from "./lib/board";
import {
  recordReleaseBurndown,
  recordSprintBurndown,
  releaseSeries,
  sprintSeries,
} from "./lib/burndown";

const countsValidator = v.object({
  total: v.number(),
  completed: v.number(),
  remaining: v.number(),
});

/**
 * 项目进度 — always counted over 目标项, which is also what 燃尽图 plots.
 *
 * A goal is complete when it has at least one task and all of them are done, so
 * the counts are always derived from the task table rather than trusted from a
 * stored flag.
 */
export const getProjectProgress = query({
  args: { token: v.optional(v.string()), projectId: v.id("projects") },
  returns: v.object({
    project: countsValidator.extend({ percent: v.number() }),
    tasks: v.object({
      total: v.number(),
      done: v.number(),
      inProgress: v.number(),
      estimatedHours: v.number(),
      actualHours: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireProjectMember(ctx, args.projectId, user._id);

    const allGoals = await ctx.db
      .query("goals")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // A goal is 完成 once every one of its tasks is. Reuse the goal's own
    // completedAt when present, and fall back to the live task list so a goal
    // never looks unfinished the instant its last task closes.
    const doneSet = new Set(
      allGoals.filter((g) => g.completedAt !== undefined).map((g) => g._id as string),
    );
    const total = allGoals.length;
    const completed = doneSet.size;

    return {
      project: {
        total,
        completed,
        remaining: total - completed,
        percent: total === 0 ? 0 : Math.round((completed / total) * 100),
      },
      tasks: {
        total: allTasks.length,
        done: allTasks.filter((t) => t.status === "done").length,
        inProgress: allTasks.filter((t) => t.status === "in_progress").length,
        estimatedHours: allTasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0),
        actualHours: allTasks.reduce((sum, t) => sum + (t.actualHours ?? 0), 0),
      },
    };
  },
});

/**
 * 迭代燃尽图 — x = 迭代内的天数, y = 本期任务剩余工时.
 *
 * The straight `ideal` line runs from the sprint's opening hours to zero; the
 * `remaining` line is what the team actually had left on each recorded day.
 */
export const getSprintBurndown = query({
  args: { token: v.optional(v.string()), boardId: v.id("boards") },
  returns: v.object({
    unit: v.literal("hours"),
    baseline: v.number(),
    points: v.array(
      v.object({
        date: v.string(),
        remaining: v.number(),
        baseline: v.number(),
        ideal: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("BOARD_NOT_FOUND");
    if (board.kind !== "sprint") throw new Error("NOT_A_SPRINT");
    await requireBoardMember(ctx, board._id, user._id);

    const points = await sprintSeries(
      ctx,
      board.projectId,
      board._id,
      board.startDate,
      board.endDate,
    );
    return { unit: "hours" as const, baseline: points[0]?.baseline ?? 0, points };
  },
});

/**
 * 发布燃尽图 — x = 迭代, y = PBL 剩余客户价值估计.
 *
 * Reads the whole product list, because a release burns down across sprints
 * rather than inside any one of them.
 */
export const getReleaseBurndown = query({
  args: { token: v.optional(v.string()), projectId: v.id("projects") },
  returns: v.object({
    unit: v.literal("value"),
    baseline: v.number(),
    points: v.array(
      v.object({
        sprintId: v.string(),
        label: v.string(),
        remaining: v.number(),
        baseline: v.number(),
        ideal: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireProjectMember(ctx, args.projectId, user._id);
    const points = await releaseSeries(ctx, args.projectId);
    return { unit: "value" as const, baseline: points[0]?.baseline ?? 0, points };
  },
});

/** Backfills today's readings for a board's sprint and its project release. */
export const snapshotBurndown = mutation({
  args: { token: v.optional(v.string()), boardId: v.id("boards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const board = await ctx.db.get(args.boardId);
    if (!board) throw new Error("BOARD_NOT_FOUND");
    await requireBoardMember(ctx, board._id, user._id);
    if (board.kind === "sprint") {
      await recordSprintBurndown(ctx, board.projectId, board._id);
      await recordReleaseBurndown(ctx, board.projectId, board._id);
    } else {
      await recordReleaseBurndown(ctx, board.projectId);
    }
    return null;
  },
});

export { columnsOfBoard };

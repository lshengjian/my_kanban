import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireBoardMember, requireProjectMember, requireUser } from "./lib/auth";

/**
 * 活动日志的**读取**接口。
 *
 * 写入在 `lib/activity.ts` 的 `logActivity`（13 种事件，业务改动时自动记录）；
 * 这里只负责按**时间倒序**（最新在上）取出来给界面看。
 */

/** 单次最多返回多少条，避免一次拉爆整个项目的历史。 */
const MAX_ITEMS = 200;

const activityValidator = v.object({
  _id: v.id("activityLog"),
  type: v.string(),
  message: v.string(),
  createdAt: v.number(),
  /** 操作者显示名；账号已删时回退为「已注销用户」。 */
  actorName: v.string(),
  goalId: v.optional(v.id("goals")),
  taskId: v.optional(v.id("tasks")),
});

const clampLimit = (raw: number | undefined): number =>
  Math.min(Math.max(Math.trunc(raw ?? MAX_ITEMS), 1), MAX_ITEMS);

async function actorName(ctx: QueryCtx, actorId: Id<"users">): Promise<string> {
  const user = await ctx.db.get(actorId);
  return user?.name ?? "已注销用户";
}

/** 项目里的全部活动，**最新在上**。 */
export const listActivity = query({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  returns: v.array(activityValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireProjectMember(ctx, args.projectId, user._id);

    // `by_project` 是 [projectId, createdAt]，所以可以直接让数据库倒序返回。
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(clampLimit(args.limit));

    return Promise.all(
      rows.map(async (row) => ({
        _id: row._id,
        type: row.type,
        message: row.message,
        createdAt: row.createdAt,
        actorName: await actorName(ctx, row.actorId),
        goalId: row.goalId,
        taskId: row.taskId,
      })),
    );
  },
});

/** 单个目标项的变更历史，**最新在上**（目标项详情里用）。 */
export const listGoalActivity = query({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    limit: v.optional(v.number()),
  },
  returns: v.array(activityValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    // `by_goal` 只有 [goalId]，没有 createdAt，所以取回后在内存里倒序。
    // 单个目标项的事件本来就不多，这里不做分页。
    const rows = await ctx.db
      .query("activityLog")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      rows.slice(0, clampLimit(args.limit)).map(async (row) => ({
        _id: row._id,
        type: row.type,
        message: row.message,
        createdAt: row.createdAt,
        actorName: await actorName(ctx, row.actorId),
        goalId: row.goalId,
        taskId: row.taskId,
      })),
    );
  },
});

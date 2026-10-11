import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ActivityType =
  | "goal_created"
  | "goal_moved"
  | "goal_planned"
  | "goal_unplanned"
  | "goal_deleted"
  | "check_added"
  | "attachment_added"
  | "task_created"
  | "task_status"
  | "task_deleted"
  | "board_created"
  | "member_joined"
  | "member_left";

export async function logActivity(
  ctx: MutationCtx,
  entry: {
    projectId: Id<"projects">;
    actorId: Id<"users">;
    type: ActivityType;
    message: string;
    boardId?: Id<"boards">;
    goalId?: Id<"goals">;
    taskId?: Id<"tasks">;
    fromColumnId?: Id<"columns">;
    toColumnId?: Id<"columns">;
  },
): Promise<void> {
  await ctx.db.insert("activityLog", {
    projectId: entry.projectId,
    boardId: entry.boardId,
    goalId: entry.goalId,
    taskId: entry.taskId,
    actorId: entry.actorId,
    type: entry.type,
    message: entry.message,
    fromColumnId: entry.fromColumnId,
    toColumnId: entry.toColumnId,
    createdAt: Date.now(),
  });
}

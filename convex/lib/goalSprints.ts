import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * 目标项 ↔ 迭代 的多对多归属（`goalSprints`）。
 *
 * 一个目标项可以排入**多个**迭代，只要那个迭代还没结束。`countsForValue`
 * 标记「首个排入的迭代」—— 客户价值只归它一次；删除该归属时会转给剩下的
 * 最早一个迭代，保证任何时刻至多一条为 true（没有归属时为 0 条）。
 */
export type Ctx = QueryCtx | MutationCtx;
export type GoalSprintLink = Doc<"goalSprints">;

/** 某个目标项排入的全部迭代，按排入时间升序（最早的是价值归属）。 */
export async function linksOfGoal(ctx: Ctx, goalId: Id<"goals">): Promise<GoalSprintLink[]> {
  const links = await ctx.db
    .query("goalSprints")
    .withIndex("by_goal", (q) => q.eq("goalId", goalId))
    .collect();
  return links.sort((a, b) => a.createdAt - b.createdAt || a._creationTime - b._creationTime);
}

/** 某个目标项排入的迭代 id 列表（按排入时间升序）。 */
export async function sprintIdsOfGoal(ctx: Ctx, goalId: Id<"goals">): Promise<Id<"boards">[]> {
  return (await linksOfGoal(ctx, goalId)).map((l) => l.sprintId);
}

/** 单条归属，没有则 null。 */
export async function linkOf(
  ctx: Ctx,
  goalId: Id<"goals">,
  sprintId: Id<"boards">,
): Promise<GoalSprintLink | null> {
  return await ctx.db
    .query("goalSprints")
    .withIndex("by_goal_sprint", (q) => q.eq("goalId", goalId).eq("sprintId", sprintId))
    .first();
}

/** 某个迭代里的全部目标项 id。 */
export async function goalIdsOfSprint(ctx: Ctx, sprintId: Id<"boards">): Promise<Set<string>> {
  const links = await ctx.db
    .query("goalSprints")
    .withIndex("by_sprint", (q) => q.eq("sprintId", sprintId))
    .collect();
  return new Set(links.map((l) => l.goalId as string));
}

/** 整个项目的归属行 —— `getBoard` / `listBoards` 一次取全再内存分组。 */
export async function linksOfProject(
  ctx: Ctx,
  projectId: Id<"projects">,
): Promise<GoalSprintLink[]> {
  return await ctx.db
    .query("goalSprints")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
}

/** 项目级归属行 → 两张内存表（goalId→sprintIds、sprintId→goalIds）。 */
export function groupLinks(links: GoalSprintLink[]): {
  sprintIdsByGoal: Map<string, Id<"boards">[]>;
  goalIdsBySprint: Map<string, Set<string>>;
} {
  const sprintIdsByGoal = new Map<string, Id<"boards">[]>();
  const goalIdsBySprint = new Map<string, Set<string>>();
  for (const link of links) {
    const goal = link.goalId as string;
    const sprint = link.sprintId as string;
    const forGoal = sprintIdsByGoal.get(goal) ?? [];
    forGoal.push(link.sprintId);
    sprintIdsByGoal.set(goal, forGoal);
    const forSprint = goalIdsBySprint.get(sprint) ?? new Set<string>();
    forSprint.add(goal);
    goalIdsBySprint.set(sprint, forSprint);
  }
  return { sprintIdsByGoal, goalIdsBySprint };
}

/** 新增一条归属；首个排入的迭代拿 `countsForValue`。返回是否真的新增。 */
export async function addGoalToSprint(
  ctx: MutationCtx,
  goal: Doc<"goals">,
  sprintId: Id<"boards">,
): Promise<boolean> {
  if (await linkOf(ctx, goal._id, sprintId)) return false;
  const prior = await linksOfGoal(ctx, goal._id);
  await ctx.db.insert("goalSprints", {
    projectId: goal.projectId,
    goalId: goal._id,
    sprintId,
    countsForValue: prior.length === 0,
    createdAt: Date.now(),
  });
  return true;
}

/** 删除一条归属，必要时把 `countsForValue` 转给剩下的最早一个迭代。 */
export async function removeGoalFromSprint(
  ctx: MutationCtx,
  goalId: Id<"goals">,
  sprintId: Id<"boards">,
): Promise<boolean> {
  const link = await linkOf(ctx, goalId, sprintId);
  if (!link) return false;
  await ctx.db.delete(link._id);
  if (link.countsForValue) {
    const rest = await linksOfGoal(ctx, goalId);
    if (rest.length > 0) await ctx.db.patch(rest[0]!._id, { countsForValue: true });
  }
  return true;
}

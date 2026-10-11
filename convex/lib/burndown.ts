import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** "2026-03-14" for an instant, in UTC so the axis is stable across timezones. */
export function dayLabel(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sumHours(rows: { estimatedHours?: number }[]): number {
  return rows.reduce((n, r) => n + (r.estimatedHours ?? 0), 0);
}

export type SprintPoint = {
  date: string;
  remaining: number;
  baseline: number;
  /** Straight line from the baseline to zero across the sprint. */
  ideal: number;
};

export type ReleasePoint = {
  sprintId: string;
  label: string;
  remaining: number;
  baseline: number;
  ideal: number;
};

/**
 * 冲刺燃尽图 — y axis.
 *
 * The remaining effort in one sprint's SBL: every task that is not 已完成
 * still owes its estimate. Note that 预计工时 is entered when a task starts,
 * so a task nobody has picked up yet contributes nothing until it does.
 */
export async function sprintRemainingHours(
  ctx: QueryCtx | MutationCtx,
  boardId: Id<"boards">,
): Promise<number> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_board", (q) => q.eq("boardId", boardId))
    .collect();
  return sumHours(tasks.filter((t) => t.status !== "done"));
}

async function rowsFor(
  ctx: QueryCtx | MutationCtx,
  scope: "sprint" | "release",
  projectId: Id<"projects">,
  boardId?: Id<"boards">,
) {
  const all = await ctx.db
    .query("burndown")
    .withIndex("by_scope_board", (q) =>
      q.eq("scope", scope).eq("boardId", boardId),
    )
    .collect();
  return all.filter((r) => r.projectId === projectId);
}

/**
 * 发布燃尽图 — y axis.
 *
 * 剩余客户价值估计 across the whole PBL. Goals the PO has not valued
 * contribute nothing, so the line only means something once they are.
 */
export async function releaseRemainingPoints(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const goals = await ctx.db
    .query("goals")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return goals
    .filter((g) => g.completedAt === undefined)
    .reduce((n, g) => n + (g.value ?? 0), 0);
}

async function upsert(
  ctx: MutationCtx,
  row: {
    projectId: Id<"projects">;
    scope: "sprint" | "release";
    boardId?: Id<"boards">;
    key: string;
    baseline: number;
    remaining: number;
  },
): Promise<void> {
  // rowsFor already narrows to this project (and sprint board), so matching on
  // key alone is enough — but the filter must run against the *same* scope,
  // otherwise two projects' release points overwrite each other.
  const existing = await rowsFor(ctx, row.scope, row.projectId, row.boardId);
  const match = existing.find((r) => r.key === row.key);
  if (match) {
    // Upsert in place: reopening a goal rewrites today's reading rather than
    // appending a second one.
    await ctx.db.patch(match._id, {
      at: Date.now(),
      baseline: row.baseline,
      remaining: row.remaining,
    });
    return;
  }
  await ctx.db.insert("burndown", { ...row, at: Date.now() });
}

/**
 * Writes today's sprint reading, in 剩余工时.
 *
 * Called whenever a task moves so the line tracks reality rather than only
 * being drawn when a sprint closes.
 */
export async function recordSprintBurndown(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  boardId: Id<"boards">,
): Promise<void> {
  const remaining = await sprintRemainingHours(ctx, boardId);
  const prior = await rowsFor(ctx, "sprint", projectId, boardId);
  // The ideal line starts from the largest reading ever seen, so the chart
  // keeps its shape even if estimates are entered late.
  const baseline = Math.max(remaining, ...prior.map((r) => r.baseline), 0);
  await upsert(ctx, {
    projectId,
    scope: "sprint",
    boardId,
    key: dayLabel(Date.now()),
    baseline,
    remaining,
  });
}

/**
 * Writes one release point per sprint, in 剩余客户价值估计.
 *
 * The baseline is the first reading ever taken, so the ideal line runs from the
 * full backlog down to zero.
 */
export async function recordReleaseBurndown(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  sprintId?: Id<"boards">,
): Promise<void> {
  const remaining = await releaseRemainingPoints(ctx, projectId);
  const prior = await rowsFor(ctx, "release", projectId);
  const baseline = prior.length
    ? Math.max(...prior.map((r) => r.baseline), remaining)
    : remaining;
  await upsert(ctx, {
    projectId,
    scope: "release",
    key: sprintId ?? "backlog",
    baseline,
    remaining,
  });
}

/**
 * Sprint burndown across the sprint's own calendar days.
 *
 * Days with no reading yet carry the last known value forward — dropping to
 * zero would read as "everything finished" when it really means "nothing has
 * happened yet".
 */
export async function sprintSeries(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  boardId: Id<"boards">,
  startDate: number | undefined,
  endDate: number | undefined,
): Promise<SprintPoint[]> {
  const rows = await rowsFor(ctx, "sprint", projectId, boardId);
  const baseline = Math.max(0, ...rows.map((r) => r.baseline));
  const byDate = new Map(rows.map((r) => [r.key, r.remaining]));

  const points: SprintPoint[] = [];
  if (startDate !== undefined && endDate !== undefined && endDate >= startDate) {
    const days = Math.floor((endDate - startDate) / 86_400_000) + 1;
    let carried = baseline;
    for (let i = 0; i < days; i++) {
      const key = dayLabel(startDate + i * 86_400_000);
      if (byDate.has(key)) carried = byDate.get(key)!;
      points.push({ date: key, remaining: carried, baseline, ideal: 0 });
    }
  } else {
    for (const r of rows.sort((a, b) => a.key.localeCompare(b.key))) {
      points.push({ date: r.key, remaining: r.remaining, baseline, ideal: 0 });
    }
  }

  const last = Math.max(1, points.length - 1);
  points.forEach((p, i) => {
    p.ideal = Math.max(0, baseline * (1 - i / last));
  });
  return points;
}

/** Release burndown, one point per sprint, in iteration order. */
export async function releaseSeries(
  ctx: QueryCtx,
  projectId: Id<"projects">,
): Promise<ReleasePoint[]> {
  const rows = await rowsFor(ctx, "release", projectId);
  const sprints = new Map<string, string>();
  const ordered = (
    await ctx.db
      .query("boards")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  )
    .filter((b) => b.kind === "sprint")
    .sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
  for (const b of ordered) sprints.set(b._id as string, b.name);

  // Order by each sprint's own start date so the x axis reads left-to-right in
  // time, then keep the latest reading per sprint (a sprint may be snapshotted
  // several times).
  const latest = new Map<string, { row: (typeof rows)[number]; at: number }>();
  for (const r of rows) {
    if (!sprints.has(r.key)) continue;
    const prev = latest.get(r.key);
    if (!prev || (r.at ?? 0) >= prev.at) latest.set(r.key, { row: r, at: r.at ?? 0 });
  }

  const points: ReleasePoint[] = [...latest.values()]
    .map(({ row }) => ({
      sprintId: row.key,
      label: sprints.get(row.key) ?? row.key,
      remaining: row.remaining,
      baseline: 0,
      ideal: 0,
    }))
    .sort((a, b) => {
      const ba = ordered.find((x) => x._id === a.sprintId);
      const bb = ordered.find((x) => x._id === b.sprintId);
      return (ba?.startDate ?? 0) - (bb?.startDate ?? 0);
    });

  const baseline = Math.max(0, ...rows.map((r) => r.baseline));
  const last = Math.max(1, points.length - 1);
  points.forEach((p, i) => {
    p.baseline = baseline;
    p.ideal = Math.max(0, baseline * (1 - i / last));
  });
  return points;
}
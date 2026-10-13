// Shared vocabulary. Imported by both the Convex functions and the Vite client,
// so it must stay free of any server-only imports.

export const DAY_MS = 86_400_000;

/** A 迭代 runs two weeks unless the project says otherwise. */
/**
 * 默认迭代长度（天）。默认按「一个工作周」：周一开工、周五收尾 ——
 * 最后一天留作缓冲，应付突发情况与常规会议。项目可用 `sprintLengthDays` 覆盖。
 */
export const DEFAULT_SPRINT_DAYS = 5;

export const BOARD_KINDS = ["backlog", "sprint"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const BOARD_KIND_META: Record<
  BoardKind,
  { label: string; emoji: string; hint: string }
> = {
  backlog: {
    label: "预期成果看板",
    emoji: "📋",
    hint: "团队共同目标的活文档，顺序即优先级，由产品经理（Product Owner）维护",
  },
  sprint: {
    label: "迭代列表",
    emoji: "🏃",
    hint: "本迭代选中的目标项，以及拆解出的任务项",
  },
};

// ---- Goal (目标项) statuses -------------------------------------------
/** The product list has exactly three columns. */
export const GOAL_COLUMNS = ["待处理", "处理中", "已完成"] as const;
export type GoalColumnName = (typeof GOAL_COLUMNS)[number];

/** Which product-list column is which. `isDone` marks the terminal one. */
export const GOAL_COLUMN_META: {
  name: GoalColumnName;
  isDone: boolean;
  color: string;
}[] = [
  { name: "待处理", isDone: false, color: "#94a3b8" },
  { name: "处理中", isDone: false, color: "#0ea5e9" },
  { name: "已完成", isDone: true, color: "#22c55e" },
];

// ---- Task (任务项) statuses -------------------------------------------
export const TASK_STATUSES = ["proposed", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The 迭代 board's three task lanes, derived from `tasks.status`. */
export const TASK_LANES: { status: TaskStatus; name: string; color: string }[] = [
  { status: "proposed", name: "提议", color: "#64748b" },
  { status: "in_progress", name: "执行中", color: "#0ea5e9" },
  { status: "done", name: "已完成", color: "#22c55e" },
];

export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  proposed: { label: "提议", color: "#64748b" },
  in_progress: { label: "执行中", color: "#0ea5e9" },
  done: { label: "已完成", color: "#22c55e" },
};

export const SPRINT_STATUS_META: Record<
  "planned" | "active" | "closed",
  { label: string; color: string }
> = {
  planned: { label: "未开始", color: "#94a3b8" },
  active: { label: "进行中", color: "#0ea5e9" },
  closed: { label: "已结束", color: "#22c55e" },
};

/**
 * Default card vocabulary per board kind. Admins maintain the real presets in
 * `labelTemplates`; these are the fallback when none exist yet.
 */
export const DEFAULT_LABELS: Record<BoardKind, { name: string; color: string }[]> = {
  backlog: [
    { name: "用户故事", color: "#22c55e" },
    { name: "功能", color: "#3b82f6" },
    { name: "缺陷", color: "#ef4444" },
    { name: "优化需求", color: "#a855f7" },
    { name: "其它", color: "#64748b" },
  ],
  sprint: [
    { name: "开发任务", color: "#3b82f6" },
    { name: "缺陷修复", color: "#ef4444" },
    { name: "优化", color: "#a855f7" },
    { name: "其它", color: "#64748b" },
  ],
};

export const LABEL_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
] as const;

/**
 * Local-midnight timestamp for a given instant.
 *
 * **凡是「按天」的判断都要先归一到这里**，不要拿存着 00:00 的日期字段直接和
 * `Date.now()` 比 —— 那会让"今天到期"从当天零点起就被当成过期
 * （2026-10-13 修的逾期误报就是这个原因）。前后端共用这一份实现。
 */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 迭代状态 is derived from the dates, never stored and left to drift.
 *
 * A sprint is 未开始 on its start day and 进行中 from the next day, so the
 * transition happens on a calendar day rather than at an arbitrary hour.
 * It closes after its end date.
 */
export function deriveSprintStatus(board: {
  startDate?: number;
  endDate?: number;
}): "planned" | "active" | "closed" {
  const today = startOfDay(Date.now());
  if (board.endDate !== undefined && today > startOfDay(board.endDate)) return "closed";
  if (board.startDate !== undefined && today > startOfDay(board.startDate)) return "active";
  return "planned";
}


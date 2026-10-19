/**
 * Shapes returned by the Convex queries, re-declared for the UI.
 *
 * The `_id` fields keep Convex's branded `Id<>` type so these objects stay
 * assignable to the generated query return types.
 */

import type { Id } from "../../convex/_generated/dataModel";
import type { TaskStatus } from "../../convex/lib/constants";

export type PublicUser = {
  _id: Id<"users">;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "suspended";
  createdAt: number;
  lastLoginAt?: number;
};

export type BoardLabel = {
  _id: Id<"labels">;
  name: string;
  color: string;
  position: number;
};

/** 目标项 — a shared team goal. Deliberately has no owner and no due date. */
export type Goal = {
  _id: Id<"goals">;
  title: string;
  /** A reference to the category; name and colour live on the label row. */
  labelId?: Id<"labels">;
  /** 这个目标项排入的全部迭代（按排入时间升序；可以属于多个迭代）。 */
  sprintIds: Id<"boards">[];
  /** 客户价值估计 — 1~10 的相对价值刻度，发布燃尽图的纵轴单位。 */
  value?: number;
  columnId: Id<"columns">;
  position: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  taskTotal: number;
  taskDone: number;
};

/** 任务项 — owned, dated and time-tracked work inside one 迭代. */
export type Task = {
  _id: Id<"tasks">;
  title: string;
  assigneeId: Id<"users">;
  dueDate: number;
  /** A reference to the category; name and colour live on the label row. */
  labelId?: Id<"labels">;
  status: TaskStatus;
  startDate?: number;
  estimatedHours?: number;
  actualCompletedAt?: number;
  actualHours?: number;
  position: number;
  goalIds: Id<"goals">[];
};

export type GoalColumn = {
  _id: Id<"columns">;
  name: string;
  isDone: boolean;
  position: number;
  color?: string;
  goals: Goal[];
};

/** One of the 迭代 board's three fixed task lanes. */
export type TaskLane = {
  status: TaskStatus;
  name: string;
  color: string;
  tasks: Task[];
};

export type BoardData = {
  board: {
    _id: Id<"boards">;
    projectId: Id<"projects">;
    name: string;
    kind: "backlog" | "sprint";
    description: string;
    sprintNumber?: number;
    startDate?: number;
    endDate?: number;
    sprintStatus?: "planned" | "active" | "closed";
    goal?: string;
    createdAt: number;
    archived: boolean;
  };
  columns: GoalColumn[];
  lanes: TaskLane[];
  goals: Goal[];
  /** This board's own vocabulary — categorises its 任务项 (and its 目标项 on the 预期成果看板). */
  labels: BoardLabel[];
  /**
   * The vocabulary 目标项 are categorised from. On an 迭代 board this is the
   * 预期成果看板's list, because a goal always belongs to the product list.
   */
  goalLabels: BoardLabel[];
  members: PublicUser[];
  counts: {
    goals: number;
    goalsDone: number;
    tasks: number;
    tasksDone: number;
    estimatedHours: number;
    actualHours: number;
  };
};

export type BoardSummary = {
  _id: Id<"boards">;
  projectId: Id<"projects">;
  name: string;
  kind: "backlog" | "sprint";
  description: string;
  sprintNumber?: number;
  startDate?: number;
  endDate?: number;
  sprintStatus?: "planned" | "active" | "closed";
  goal?: string;
  createdAt: number;
  archived: boolean;
  goals: number;
  goalsDone: number;
  tasks: number;
  tasksDone: number;
  progress: number;
};

export type ActivityEntry = {
  _id: Id<"activityLog">;
  projectId: Id<"projects">;
  boardId?: Id<"boards">;
  goalId?: Id<"goals">;
  taskId?: Id<"tasks">;
  actorId: Id<"users">;
  type: string;
  message: string;
  fromColumnId?: Id<"columns">;
  toColumnId?: Id<"columns">;
  createdAt: number;
};

/** 活动日志条目（`activity.listActivity` / `listGoalActivity` 的返回）。 */
export type ActivityItem = {
  _id: Id<"activityLog">;
  type: string;
  message: string;
  createdAt: number;
  actorName: string;
  goalId?: Id<"goals">;
  taskId?: Id<"tasks">;
};

/** 检查列表 entry on a 目标项. */
export type CheckItem = {
  _id: Id<"checklistItems">;
  goalId: Id<"goals">;
  text: string;
  done: boolean;
  position: number;
  createdAt: number;
};

/** 附件. Every row carries a signed `url`: images render, documents download. */
export type Attachment = {
  _id: Id<"attachments">;
  name: string;
  contentType: string;
  size: number;
  isImage: boolean;
  createdAt: number;
  url?: string;
};

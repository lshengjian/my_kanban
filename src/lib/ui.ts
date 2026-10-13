/** Small shared helpers for formatting and the category/priority palette. */

import {
  BOARD_KIND_META,
  SPRINT_STATUS_META,
  startOfDay,
} from "../../convex/lib/constants";
import type { BoardKind } from "../../convex/lib/constants";

export { BOARD_KIND_META, SPRINT_STATUS_META };
export type { BoardKind };

const AVATAR_COLORS = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ef4444",
  "#22c55e",
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // CJK names have no spaces: the first character is the most useful signal.
  return /[一-龥]/.test(trimmed)
    ? trimmed.slice(0, 1)
    : trimmed
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("");
}

export function sprintStatusMeta(
  status: "planned" | "active" | "closed" | undefined,
) {
  return SPRINT_STATUS_META[status ?? "planned"];
}

export function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 任务是否逾期。
 *
 * ⚠️ **完成日当天不算逾期**，只有日期早于今天才算。
 * `dueDate` 存的是当天 00:00（`<input type="date">` 的语义就是"哪一天"），
 * 所以拿它直接和 `Date.now()` 比，会让**当天一过零点就立刻标红** —— 2026-10-13 修的就是这个。
 */
export function isOverdue(dueDate: number, now = Date.now()): boolean {
  return startOfDay(dueDate) < startOfDay(now);
}

/** 下一个周一（今天就是周一时返回今天），本地零点。迭代默认从周一开始。 */
export function nextMonday(from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7));
  return d;
}

/** `Date` → `<input type="date">` 要的 "YYYY-MM-DD"（按本地时区，不走 UTC）。 */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 迭代的默认起止日期：**周一开始**，结束 = 开始 + (周期 - 1) 天。
 * 周期 5 天即「周一开工、周五收尾」，最后一天留作缓冲。
 * 两个日期在界面上都可以手工改。
 */
export function defaultSprintDates(sprintDays: number): { start: string; end: string } {
  const start = nextMonday();
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(1, sprintDays) - 1);
  return { start: toDateInput(start), end: toDateInput(end) };
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Human label for a backend error code, falling back to the raw text. */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL: "邮箱格式不正确",
  INVALID_NAME: "名称不能为空或过长",
  EMAIL_TAKEN: "该邮箱已被注册",
  PASSWORD_TOO_SHORT: "密码至少 6 位",
  INVALID_CREDENTIALS: "邮箱或密码不正确",
  ACCOUNT_SUSPENDED: "该账户已被停用，请联系管理员",
  UNAUTHENTICATED: "登录已失效，请重新登录",
  SUSPENDED: "该账户已被停用",
  FORBIDDEN: "没有权限执行此操作",
  PROJECT_NOT_FOUND: "项目不存在",
  BOARD_NOT_FOUND: "看板不存在",
  COLUMN_NOT_FOUND: "看板列不存在",
  ITEM_NOT_FOUND: "目标项不存在",
  NOT_A_PROJECT_MEMBER: "你不是该项目成员",
  OWNER_ONLY: "只有项目拥有者可以执行此操作",
  ALREADY_A_MEMBER: "已经是项目成员",
  REQUEST_ALREADY_PENDING: "已提交过申请，等待审批",
  REQUEST_NOT_FOUND: "申请不存在",
  REQUEST_ALREADY_DECIDED: "该申请已处理",
  USER_NOT_FOUND: "用户不存在（请确认对方已注册）",
  ASSIGNEE_NOT_A_MEMBER: "负责人必须是项目成员",
  INVALID_CUSTOMER_VALUE: "客户价值估计请填 1 到 10 的整数",
  INVALID_TITLE: "标题不能为空或过长",
  INVALID_TEXT: "内容不能为空或过长",
  BACKLOG_ALREADY_EXISTS: "该项目已有预期成果看板（一个项目只有一个）",
  BACKLOG_NOT_DRAGGABLE: "预期成果看板不可拖动，请用「排入迭代」改变状态",
  NOT_A_BACKLOG: "该操作仅适用于预期成果看板",
  SPRINT_NOT_FOUND: "迭代不存在",
  SPRINT_IN_OTHER_PROJECT: "不能把需求排入其它项目的迭代",
  NOT_A_SPRINT: "该操作仅适用于敏捷项目管理看板",
  INVALID_SPRINT_RANGE: "结束日期必须晚于开始日期",
  SPRINT_NOT_PLANNED: "只能排入尚未开始的迭代；已开始或已结束的迭代不能再加入目标项",
  NEW_GOAL_MUST_BE_PENDING: "新目标项只能加在「待处理」列；「处理中」需通过「排入迭代」进入",
  SPRINT_CLOSED: "该迭代已结束，无法再排入",
  ASSIGNEE_REQUIRED: "排入迭代前，请先为该需求指定负责人和截止日期",
  DUE_DATE_REQUIRED: "排入迭代前，请先为该需求设定截止日期",
  PROJECT_OWNER_ONLY: "只有项目经理可以执行此操作",
  LABEL_NOT_ON_BOARD: "标签不属于当前看板",
  LABEL_NOT_FOUND: "标签不存在",
  LABEL_IN_USE: "该类型下还有卡片在用，请先改掉它们的分类，或直接修改这个类型的名称和颜色",
  LABEL_ALREADY_EXISTS: "同名标签已存在",
  CANNOT_DELETE_LAST_LABEL: "至少要保留一个标签",
  INVALID_LABEL_NAME: "标签名称不能为空或过长",
  COLUMN_NOT_EMPTY: "该列仍有目标项，请先移走",
  CANNOT_DELETE_LAST_COLUMN: "至少要保留一列",
  CANNOT_REMOVE_OWNER: "不能移除项目拥有者",
  CANNOT_SUSPEND_SELF: "不能停用自己的账户",
  LAST_ADMIN: "系统至少需要保留一名管理员",
  ITEM_CREATE_FAILED: "创建失败，请重试",
  PROJECT_DELETE_DISABLED: "项目不可删除：为避免误删，项目创建后不再提供删除功能",
};

export function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Convex prefixes the code with request info and appends a server stack, so
  // match on containment rather than equality.
  const hit = Object.entries(ERROR_MESSAGES).find(([code]) => raw.includes(code));
  if (hit) return hit[1];

  // A *production* Convex deployment redacts the text of thrown errors, so the
  // only thing that arrives is the transport scaffolding:
  //   "[CONVEX M(auth:login)] [Request ID: …] Server Error\n  Called by client"
  // Strip that, and when nothing but a generic "Server Error" survives, show a
  // message a user can act on instead of leaking request ids. Fixing this
  // properly means throwing ConvexError (see AGENTS.md §11).
  const stripped = raw
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID:[^\]]*\]\s*/g, "")
    .replace(/^.*Uncaught Error:\s*/, "")
    .split("\n")[0]!
    .trim();

  if (!stripped || /^(server error|called by client)\.?$/i.test(stripped)) {
    // Surface an *unregistered* code on the console so a missing
    // ERROR_MESSAGES entry is diagnosable, while the user still sees something
    // actionable. A redacted production error has no code at all.
    const code = raw.match(/Uncaught Error:\s*([A-Z][A-Z0-9_]{2,})/)?.[1];
    if (code) console.warn(`[describeError] 未登记的错误码：${code}`);
    return "操作失败，请重试";
  }
  return stripped;
}

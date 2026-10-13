import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatTime } from "../lib/ui";

/**
 * 活动日志列表。
 *
 * - 传 `goalId`：只看这一个目标项的变更（目标项详情抽屉里用）
 * - 只传 `projectId`：列出整个项目的事件（项目页用）
 *
 * 后端已经按时间**倒序**返回（最新在上），这里不再排序 —— 排序规则只留一处，
 * 免得两边不一致。
 */
export function ActivityFeed({
  token,
  projectId,
  goalId,
  emptyHint = "还没有变更记录",
}: {
  token: string;
  projectId?: Id<"projects">;
  goalId?: Id<"goals">;
  emptyHint?: string;
}) {
  // 两个查询各自 "skip"，按传入的是目标项还是项目二选一激活。
  const goalRows = useQuery(
    api.activity.listGoalActivity,
    token && goalId ? { token, goalId } : "skip",
  );
  const projectRows = useQuery(
    api.activity.listActivity,
    token && !goalId && projectId ? { token, projectId } : "skip",
  );
  const rows = goalId ? goalRows : projectRows;

  if (rows === undefined) return <p className="muted">加载中…</p>;
  if (rows.length === 0) return <p className="hint">{emptyHint}</p>;

  return (
    <div className="activity">
      {rows.map((row) => (
        <div className="activity-item" key={row._id}>
          <span className="activity-text">{row.message}</span>
          <span className="muted">{row.actorName}</span>
          <span
            className="activity-time"
            title={new Date(row.createdAt).toLocaleString("zh-CN")}
          >
            {formatTime(row.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

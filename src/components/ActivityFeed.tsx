import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatTime } from "../lib/ui";
import type { ActivityItem } from "./types";
import { Modal } from "./ui";

/** 弹窗里最多拉多少条，与后端 `activity.ts` 的 MAX_ITEMS 一致。 */
const ALL_LIMIT = 200;

/**
 * 共享查询：目标项维度或项目维度，按传参二选一。
 *
 * 两个 `useQuery` 各自 "skip"，所以同一时刻只有一个真正在跑；
 * `enabled=false` 用来让「全部日志」弹窗只在打开时才去拉数据。
 */
function useActivityRows(
  token: string,
  projectId: Id<"projects"> | undefined,
  goalId: Id<"goals"> | undefined,
  limit: number,
  enabled = true,
): ActivityItem[] | undefined {
  const goalRows = useQuery(
    api.activity.listGoalActivity,
    enabled && token && goalId ? { token, goalId, limit } : "skip",
  );
  const projectRows = useQuery(
    api.activity.listActivity,
    enabled && token && !goalId && projectId ? { token, projectId, limit } : "skip",
  );
  return goalId ? goalRows : projectRows;
}

function ActivityList({ rows }: { rows: ActivityItem[] }) {
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

/**
 * 活动日志列表。
 *
 * - 传 `goalId`：只看这一个目标项的变更（目标项详情抽屉里用）
 * - 只传 `projectId`：列出整个项目的事件（项目页用）
 * - 传 `previewLimit`：只显示最近 N 条，并给出「更多」按钮在弹窗里看全部；
 *   不传则直接全部列出
 *
 * 后端已经按时间**倒序**返回（最新在上），这里不再排序 —— 排序规则只留一处，
 * 免得两边不一致。
 */
export function ActivityFeed({
  token,
  projectId,
  goalId,
  emptyHint = "还没有变更记录",
  previewLimit,
  modalTitle = "全部日志",
}: {
  token: string;
  projectId?: Id<"projects">;
  goalId?: Id<"goals">;
  emptyHint?: string;
  /** 只显示最近 N 条并给出「更多」；不给就全部列出。 */
  previewLimit?: number;
  modalTitle?: string;
}) {
  const [open, setOpen] = useState(false);

  // 预览时比要显示的多取一条，仅用来判断「还有更多」——这样不必额外查一次总数。
  const preview = useActivityRows(
    token,
    projectId,
    goalId,
    previewLimit === undefined ? ALL_LIMIT : previewLimit + 1,
  );
  // 全部日志只在弹窗打开时才查，平时不白拉。
  const all = useActivityRows(token, projectId, goalId, ALL_LIMIT, open);

  if (preview === undefined) return <p className="muted">加载中…</p>;
  if (preview.length === 0) return <p className="hint">{emptyHint}</p>;

  const previewing = previewLimit !== undefined;
  const visible = previewing ? preview.slice(0, previewLimit) : preview;
  const hasMore = previewing && preview.length > previewLimit;

  return (
    <>
      <ActivityList rows={visible} />

      {hasMore && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>
            更多
          </button>
        </div>
      )}

      {open && (
        <Modal
          title={modalTitle}
          subtitle={`最新在上 · 共 ${all?.length ?? 0} 条`}
          onClose={() => setOpen(false)}
        >
          {all === undefined ? (
            <p className="muted">加载中…</p>
          ) : (
            <ActivityList rows={all} />
          )}
          {all !== undefined && all.length >= ALL_LIMIT && (
            <p className="hint" style={{ marginTop: 12 }}>
              条目很多，这里只列出最近 {ALL_LIMIT} 条。
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

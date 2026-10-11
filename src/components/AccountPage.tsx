import { useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { Avatar } from "./ui";

/**
 * 我的 — the account sheet reached from the phone's bottom bar.
 *
 * Regular members otherwise get a one-item tab bar, which both looks broken and
 * leaves the only sign-out affordage in the hidden top bar.
 */
export default function AccountPage({
  me,
  onSignOut,
}: {
  me: {
    _id: Id<"users">;
    email: string;
    name: string;
    role: "admin" | "member";
  };
  onSignOut: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>我的</h1>
          <p>账号信息</p>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={me.name} size="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 16 }}>{me.name}</div>
            <div className="faint" style={{ fontSize: 13 }}>{me.email}</div>
          </div>
          <span
            className="badge"
            style={
              me.role === "admin"
                ? { background: "var(--accent-soft)", color: "var(--accent)" }
                : undefined
            }
          >
            {me.role === "admin" ? "👑 管理员" : "普通成员"}
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>
          权限说明
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          {me.role === "admin"
            ? "作为管理员，你可以查看系统中的全部项目，维护卡片类型的系统预设，并管理用户。"
            : "你只能看到自己被邀请加入的项目，以及尚未处理的邀请。卡片类型的增删改由项目创建人负责。"}
        </p>
      </div>

      <div style={{ marginTop: 20 }}>
        {confirming ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-danger" onClick={onSignOut}>
              确认退出登录
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              取消
            </button>
          </div>
        ) : (
          <button className="btn" style={{ width: "100%", minHeight: 44 }} onClick={() => setConfirming(true)}>
            退出登录
          </button>
        )}
      </div>
    </div>
  );
}
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Badge, ConfirmButton, useToast } from "./ui";
import { describeError, formatDate } from "../lib/ui";

export default function AdminPage({ token }: { token: string }) {
  const toast = useToast();
  const users = useQuery(api.auth.listUsers, { token });
  const stats = useQuery(api.auth.adminStats, { token });
  const setUserRole = useMutation(api.auth.setUserRole);
  const setUserStatus = useMutation(api.auth.setUserStatus);
  const [filter, setFilter] = useState<"all" | "admin" | "member" | "suspended">("all");

  const run = async (fn: () => Promise<unknown>, okMessage: string) => {
    try {
      await fn();
      toast.push(okMessage);
    } catch (err) {
      toast.push(describeError(err));
    }
  };

  const visible = (users ?? []).filter((u) => {
    if (filter === "all") return true;
    if (filter === "suspended") return u.status === "suspended";
    return u.role === filter && u.status === "active";
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>用户管理</h1>
          <p>提升其他用户为管理员，或暂停其账户以撤销访问</p>
        </div>
      </div>

      {stats && (
        <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 22 }}>
          {[
            ["用户", stats.users],
            ["管理员", stats.admins],
            ["已停用", stats.suspended],
            ["项目", stats.projects],
            ["看板", stats.boards],
            ["目标项", stats.goals],
          ].map(([label, value]) => (
            <div key={String(label)} className="card" style={{ padding: 16 }}>
              <div className="faint" style={{ fontSize: 12 }}>{label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {String(value)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        {(["all", "admin", "member", "suspended"] as const).map((f) => (
          <button
            key={f}
            className={`btn btn-sm${filter === f ? " btn-primary" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "全部" : f === "admin" ? "管理员" : f === "member" ? "普通用户" : "已停用"}
          </button>
        ))}
      </div>

      <div className="card">
        {users === undefined ? (
          <div style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 140 }} />
          </div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>注册时间</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user._id}>
                  <td>
                    <div className="row">
                      <Avatar name={user.name} size="sm" />
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {user.name}
                          {user.lastLoginAt === undefined && (
                            <span className="faint" style={{ fontSize: 11, marginLeft: 6 }}>
                              未登录
                            </span>
                          )}
                        </div>
                        <div className="faint" style={{ fontSize: 12 }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {user.role === "admin" ? (
                      <Badge color="var(--accent)" soft>管理员</Badge>
                    ) : (
                      <span className="faint" style={{ fontSize: 12 }}>普通用户</span>
                    )}
                  </td>
                  <td>
                    {user.status === "active" ? (
                      <Badge color="var(--success)" soft>正常</Badge>
                    ) : (
                      <Badge color="var(--danger)" soft>已停用</Badge>
                    )}
                  </td>
                  <td className="faint" style={{ fontSize: 12 }}>{formatDate(user.createdAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          run(
                            () =>
                              setUserRole({
                                token,
                                userId: user._id,
                                role: user.role === "admin" ? "member" : "admin",
                              }),
                            user.role === "admin" ? "已取消管理员权限" : "已提升为管理员",
                          )
                        }
                      >
                        {user.role === "admin" ? "取消管理员" : "设为管理员"}
                      </button>
                      <ConfirmButton
                        className={`btn btn-sm${user.status === "active" ? " btn-danger" : ""}`}
                        label={user.status === "active" ? "停用" : "恢复"}
                        confirmLabel={user.status === "active" ? "确认停用？" : "确认恢复？"}
                        onConfirm={() =>
                          run(
                            () =>
                              setUserStatus({
                                token,
                                userId: user._id,
                                status: user.status === "active" ? "suspended" : "active",
                              }),
                            user.status === "active" ? "账户已停用" : "账户已恢复",
                          )
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <p className="faint" style={{ marginTop: 14, fontSize: 12.5 }}>
        停用账户会立即撤销其所有登录会话；系统始终保留至少一名管理员，且管理员不能停用自己。
      </p>

      {toast.node}
    </div>
  );
}

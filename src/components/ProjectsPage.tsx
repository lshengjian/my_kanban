import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState, Modal, ProgressBar, useToast } from "./ui";
import { describeError, formatTime } from "../lib/ui";

export default function ProjectsPage({
  token,
  me,
  onOpenProject,
}: {
  token: string;
  me: { _id: Id<"users">; name: string; role: "admin" | "member" };
  onOpenProject: (id: Id<"projects">) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const isAdmin = me?.role === "admin";
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  // Admins browse every project; everyone else only their own.
  const mine = useQuery(
    api.projects.listMyProjects,
    token ? { token, limit: PAGE_SIZE, offset: page * PAGE_SIZE } : "skip",
  );
  const all = useQuery(
    api.projects.listAllProjects,
    isAdmin && token ? { token, limit: PAGE_SIZE, offset: page * PAGE_SIZE } : "skip",
  );
  const invitations = useQuery(
    api.projects.myInvitations,
    token ? { token } : "skip",
  );
  const myRequests = useQuery(api.projects.listMyJoinRequests, { token });
  const [scope, setScope] = useState<"all" | "mine">("mine");

  // Admins default to the org-wide list; members never leave their own.
  const effectiveScope = isAdmin ? scope : "mine";
  const source = effectiveScope === "all" ? all : mine;
  const projects = source?.items ?? [];
  const total = source?.total ?? 0;
  const hasMore = source?.hasMore ?? false;

  const createProject = useMutation(api.projects.createProject);
  const respond = useMutation(api.projects.respondToInvitation);
  const requestByKey = useMutation(api.projects.requestToJoinByKey);
  const requestToJoin = useMutation(api.projects.requestToJoin);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const deleteProject = useMutation(api.projects.deleteProject);
  const [pendingDelete, setPendingDelete] = useState<{ _id: Id<"projects">; name: string } | null>(
    null,
  );
  const [showJoin, setShowJoin] = useState(false);
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { projectId } = await createProject({ token, name, description });
      setShowCreate(false);
      setName("");
      setDescription("");
      toast.push("项目已创建");
      onOpenProject(projectId);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitJoinByKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    const code = key.trim().toUpperCase();
    try {
      // The server resolves the code, so a member never needs to enumerate
      // projects to find one.
      await requestByKey({ token, key: code });
      setShowJoin(false);
      setKey("");
      toast.push("已提交加入申请，等待项目成员批准");
    } catch (err) {
      setKeyError(describeError(err));
    }
  };

  const pendingCount = (myRequests ?? []).length;
  const invited = new Set((invitations ?? []).map((i) => i.projectId as string));
  const joinable = (all?.items ?? []).filter(
    (p) => p.role !== "owner" && !invited.has(p._id as string),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{effectiveScope === "all" ? "全部项目" : "我的项目"}</h1>
          <p>
            {source === undefined
              ? "加载中…"
              : effectiveScope === "all"
                ? `系统中共 ${total} 个项目`
                : `你参与 ${total} 个项目`}
          </p>
        </div>
        {isAdmin && (
          <div className="seg">
            <button
              className={effectiveScope === "mine" ? "on" : ""}
              onClick={() => {
                setScope("mine");
                setPage(0);
              }}
            >
              我参与的
            </button>
            <button
              className={effectiveScope === "all" ? "on" : ""}
              onClick={() => {
                setScope("all");
                setPage(0);
              }}
            >
              全部
            </button>
          </div>
        )}
        <div className="spacer" />
        <button className="btn" onClick={() => setShowJoin(true)}>
          🔑 通过邀请码加入
        </button>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          ＋ 新建项目
        </button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      {(invitations ?? []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">邀请你加入</div>
          <div className="stack">
            {(invitations ?? []).map((inv) => (
              <div className="row" key={inv.requestId} style={{ gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{inv.name}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {inv.mine ? "你申请加入，等待审批" : `${inv.inviterName} 邀请你加入`}
                    {inv.message ? ` · ${inv.message}` : ""}
                  </div>
                </div>
                {inv.mine ? (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        await respond({ token, requestId: inv.requestId, action: "cancel" });
                        toast.push("已撤回申请");
                      } catch (err) {
                        toast.push(describeError(err));
                      }
                    }}
                  >
                    撤回
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={async () => {
                        try {
                          await respond({ token, requestId: inv.requestId, action: "accept" });
                          toast.push(`已加入「${inv.name}」`);
                        } catch (err) {
                          toast.push(describeError(err));
                        }
                      }}
                    >
                      接受
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          await respond({ token, requestId: inv.requestId, action: "decline" });
                          toast.push("已拒绝邀请");
                        } catch (err) {
                          toast.push(describeError(err));
                        }
                      }}
                    >
                      拒绝
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span>⏳</span>
          <span>
            你有 <b>{pendingCount}</b> 个加入申请正在等待审批：
            {(myRequests ?? []).map((r) => r.projectName).join("、")}
          </span>
        </div>
      )}

      {source === undefined ? (
        <div className="grid-cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 150 }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card" style={{ padding: 8 }}>
          <EmptyState
            emoji="📦"
            title="还没有项目"
            hint="创建一个项目，邀请同事加入，然后开始搭建看板。"
            action={
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                ＋ 新建项目
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid-cards">
          {projects.map((project) => {
            const percent =
              project.totalGoals === 0
                ? 0
                : Math.round((project.completedGoals / project.totalGoals) * 100);
            return (
              <div
                key={project._id}
                className="card project-card"
                onClick={() => onOpenProject(project._id)}
              >
                <div className="row">
                  <h3>{project.name}</h3>
                  <div className="spacer" />
                  {project.role === "owner" && (
                    <>
                      <span className="badge" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        拥有者
                      </span>
                      <button
                        className="icon-btn"
                        title="删除项目"
                        aria-label={`删除项目 ${project.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(project);
                        }}
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
                <div className="row">
                  <span className="key-chip">{project.key}</span>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {project.boards} 个列表 · {project.members} 名成员
                  </span>
                </div>
                {project.description && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {project.description}
                  </div>
                )}
                <div>
                  <div className="row" style={{ marginBottom: 6, fontSize: 12.5 }}>
                    <span className="muted">项目进度</span>
                    <div className="spacer" />
                    <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {project.completedGoals}/{project.totalGoals} · {percent}%
                    </span>
                  </div>
                  <ProgressBar percent={percent} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && source !== undefined && (
        <div className="pager">
          <button
            className="btn btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← 上一页
          </button>
          <span className="muted">
            第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页 · 共 {total} 个
          </span>
          <button
            className="btn btn-sm"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页 →
          </button>
        </div>
      )}

      {isAdmin && effectiveScope === "all" && joinable.length > 0 && (
        <>
          <div className="section-title">可加入的项目</div>
          <div className="card">
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>邀请码</th>
                  <th>成员</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {joinable.map((project) => (
                  <tr key={project._id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{project.name}</div>
                      {project.description ? (
                        <div className="faint" style={{ fontSize: 12 }}>
                          {project.description}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="key-chip">{project.key}</span>
                    </td>
                    <td className="muted">{project.members}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          try {
                            await requestToJoin({
                              token,
                              projectId: project._id,
                              message: "申请加入项目",
                            });
                            toast.push("已提交加入申请");
                          } catch (err) {
                            toast.push(describeError(err));
                          }
                        }}
                      >
                        申请加入
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {showCreate && (
        <Modal
          title="新建项目"
          subtitle="创建后会自动生成一个 6 位邀请码，其他人可以凭它申请加入。"
          onClose={() => setShowCreate(false)}
        >
          <form className="form-row" onSubmit={submitCreate}>
            <div className="field">
              <label htmlFor="pname">项目名称</label>
              <input
                id="pname"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：支付网关重构"
                required
                maxLength={80}
              />
            </div>
            <div className="field">
              <label htmlFor="pdesc">项目描述（可选）</label>
              <textarea
                id="pdesc"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个项目要解决什么问题？"
                maxLength={400}
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "创建中…" : "创建项目"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showJoin && (
        <Modal
          title="通过邀请码加入"
          subtitle="输入项目拥有者分享的 6 位邀请码。"
          onClose={() => setShowJoin(false)}
        >
          <form className="form-row" onSubmit={submitJoinByKey}>
            <div className="field">
              <label htmlFor="pkey">邀请码</label>
              <input
                id="pkey"
                className="input mono"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="例如：K3F9QA"
                maxLength={6}
                style={{ letterSpacing: "0.2em", fontSize: 18, textAlign: "center" }}
              />
            </div>
            {keyError && <div className="error-text">{keyError}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowJoin(false)}>
                取消
              </button>
              <button className="btn btn-primary" type="submit">
                提交申请
              </button>
            </div>
          </form>
        </Modal>
      )}

      {myRequests && myRequests.length > 0 && (
        <div className="faint" style={{ marginTop: 18, fontSize: 12 }}>
          最近一次申请：{formatTime(myRequests[0]!.createdAt)}
        </div>
      )}
      {pendingDelete && (
        <Modal
          title="删除项目"
          subtitle={`「${pendingDelete.name}」及其所有目标项、任务项、附件都会被永久删除`}
          onClose={() => setPendingDelete(null)}
        >
          <div className="form-row">
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const target = pendingDelete;
                  setPendingDelete(null);
                  try {
                    await deleteProject({ token, projectId: target._id });
                    toast.push("项目已删除");
                  } catch (err) {
                    toast.push(describeError(err));
                  }
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast.node}
    </div>
  );
}

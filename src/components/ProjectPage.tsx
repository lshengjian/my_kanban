import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import BurndownChart from "./BurndownChart";
import type { Id } from "../../convex/_generated/dataModel";
import {
  Avatar,
  Badge,
  ConfirmButton,
  Modal,
  ProgressBar,
  useToast,
} from "./ui";
import {
  defaultSprintDates,
  describeError,
  formatDate,
  sprintStatusMeta,
  toDateInput,
} from "../lib/ui";
import { ActivityFeed } from "./ActivityFeed";
import {
  BOARD_KINDS,
  BOARD_KIND_META,
  DEFAULT_LABELS,
  DEFAULT_SPRINT_DAYS,
} from "../../convex/lib/constants";
import type { BoardKind } from "../../convex/lib/constants";

export default function ProjectPage({
  token,
  projectId,
  userId,
  onOpenBoard,
  onBack,
}: {
  token: string;
  projectId: Id<"projects">;
  userId: Id<"users">;
  onOpenBoard: (boardId: Id<"boards">) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const detail = useQuery(api.projects.getProject, { token, projectId });
  // x = 迭代, y = 成果的价值估计之和.
  const release = useQuery(api.progress.getReleaseBurndown, { token, projectId });
  const [showRelease, setShowRelease] = useState(false);
  const boards = useQuery(api.boards.listBoards, { token, projectId });
  const progress = useQuery(api.progress.getProjectProgress, { token, projectId });

  const templates = useQuery(api.templates.listTemplates, { token });
  const createBoard = useMutation(api.boards.createBoard);
  const updateBoard = useMutation(api.boards.updateBoard);
  const updateProject = useMutation(api.projects.updateProject);
  const inviteUser = useMutation(api.projects.inviteUser);
  const decideRequest = useMutation(api.projects.decideJoinRequest);
  const removeMember = useMutation(api.projects.removeMember);

  const [showBoard, setShowBoard] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [boardKind, setBoardKind] = useState<BoardKind>("sprint");
  const [boardDesc, setBoardDesc] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");
  const [sprintGoal, setSprintGoal] = useState("");
  const [settingsFor, setSettingsFor] = useState<BoardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busyInvite, setBusyInvite] = useState(false);

  if (detail === undefined) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 90, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }

  const { project, members, pendingRequests } = detail;
  const isOwner = project.ownerId === userId;
  const canManage = isOwner;

  // Live admin-maintained presets, falling back to the built-in defaults.
  const previewLabels: Record<BoardKind, { name: string; color: string }[]> = {
    backlog: templates?.backlog?.map((l) => ({ name: l.name, color: l.color })) ?? [],
    sprint: templates?.sprint?.map((l) => ({ name: l.name, color: l.color })) ?? [],
  };

  /**
   * 新建迭代：日期默认「下一个周一 → 开始 + (周期 - 1) 天」（周期 5 即周五收尾），
   * 两个日期都能手工改，用来吸收突发情况或常规会议。
   */
  const openNewBoard = () => {
    const days = project.sprintLengthDays ?? DEFAULT_SPRINT_DAYS;
    const { start, end } = defaultSprintDates(days);
    setSprintStart(start);
    setSprintEnd(end);
    setShowBoard(true);
  };

  const submitBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const boardId = await createBoard({
        token,
        projectId,
        name: boardName,
        kind: boardKind,
        goal: boardKind === "sprint" ? sprintGoal : undefined,
        startDate:
          boardKind === "sprint" && sprintStart
            ? new Date(sprintStart + "T00:00:00").getTime()
            : undefined,
        endDate:
          boardKind === "sprint" && sprintEnd
            ? new Date(sprintEnd + "T00:00:00").getTime()
            : undefined,
      });
      setShowBoard(false);
      setBoardName("");
      setBoardDesc("");
      setSprintStart("");
      setSprintEnd("");
      setSprintGoal("");
      toast.push("看板已创建（含三列默认布局）");
      onOpenBoard(boardId);
    } catch (err) {
      toast.push(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setBusyInvite(true);
    try {
      await inviteUser({
        token,
        projectId,
        email: inviteEmail,
        message: inviteMessage,
      });
      setShowInvite(false);
      setInviteEmail("");
      setInviteMessage("");
      toast.push("邀请已发送，等待对方接受");
    } catch (err) {
      setInviteError(describeError(err));
    } finally {
      setBusyInvite(false);
    }
  };

  const percent =
    progress?.project.percent ??
    (project.totalGoals === 0
      ? 0
      : Math.round((project.completedGoals / project.totalGoals) * 100));

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
          ← 项目
        </button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 className="row" style={{ gap: 10 }}>
            {project.name}
            <span className="key-chip">{project.key}</span>
          </h1>
          <p>
            {project.description ? `${project.description} · ` : ""}
            迭代周期 {project.sprintLengthDays ?? DEFAULT_SPRINT_DAYS} 天
          </p>
        </div>
        <button className="btn" onClick={() => setShowInvite(true)}>
          👤 邀请成员
        </button>
        {canManage && (
          <button className="btn" onClick={() => setShowSettings(true)} title="项目设置">
            ⚙ 项目设置
          </button>
        )}
        {/* Only the project owner adds boards. */}
        <button className="btn" onClick={() => setShowRelease((v) => !v)}>
          {showRelease ? "▾ 收起燃尽图" : "📉 燃尽图"}
        </button>
        {canManage && (
          <button className="btn btn-primary" onClick={openNewBoard}>
            ＋ 新建迭代
          </button>
        )}
      </div>

      {showRelease && (
        <div className="card" style={{ padding: 18, marginBottom: 22 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>发布燃尽图</h3>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>横轴＝迭代 · 纵轴＝成果的价值估计</span>
          </div>
          <BurndownChart
            labels={(release?.points ?? []).map((p) => p.label)}
            remaining={(release?.points ?? []).map((p) => p.remaining)}
            ideal={(release?.points ?? []).map((p) => p.ideal)}
            unitLabel="成果的价值估计"
            emptyHint="还没有迭代记录。新建迭代后会开始绘制。"
          />
        </div>
      )}

      <div className="grid-cards" style={{ marginBottom: 22 }}>
        {/* 进度按「完成目标项 / 总目标项」汇报 */}
        <div className="card" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>项目进度</h3>
            <div className="spacer" />
            <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {percent}%
            </span>
          </div>
          <ProgressBar percent={percent} />
          <div className="row" style={{ marginTop: 10, fontSize: 13 }}>
            <span className="muted">
              已完成 <b style={{ color: "var(--text)" }}>{progress?.project.completed ?? project.completedGoals}</b> /{" "}
              {progress?.project.total ?? project.totalGoals} 个目标项
            </span>
            <div className="spacer" />
            {progress && progress.tasks.total > 0 && (
              <span className="muted">
                任务项 {progress.tasks.done}/{progress.tasks.total}
                {progress.tasks.inProgress > 0 && `（${progress.tasks.inProgress} 执行中）`}
                {progress.tasks.estimatedHours > 0 && ` · 预计 ${progress.tasks.estimatedHours}h`}
                {progress.tasks.actualHours > 0 && ` · 实际 ${progress.tasks.actualHours}h`}
              </span>
            )}
          </div>

        </div>
      </div>

      {/* Pending join requests */}
      {pendingRequests.length > 0 && (
        <>
          <div className="section-title">
            待处理的加入申请
            <span className="column-count">{pendingRequests.length}</span>
          </div>
          <div className="card" style={{ marginBottom: 22 }}>
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>申请人</th>
                  <th>留言</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => (
                  <tr key={req._id}>
                    <td>
                      <div className="row">
                        <Avatar name={req.user.name} size="sm" />
                        <span style={{ fontWeight: 600 }}>{req.user.name}</span>
                        <span className="faint" style={{ fontSize: 12 }}>
                          {req.user.email}
                        </span>
                      </div>
                    </td>
                    <td className="muted">{req.message || "—"}</td>
                    <td className="faint" style={{ fontSize: 12 }}>
                      {formatDate(req.createdAt)}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() =>
                          decideRequest({ token, requestId: req._id, approve: true }).then(() =>
                            toast.push("已批准"),
                          )
                        }
                      >
                        批准
                      </button>{" "}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          decideRequest({ token, requestId: req._id, approve: false }).then(() =>
                            toast.push("已拒绝"),
                          )
                        }
                      >
                        拒绝
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {/* Product backlog + sprints */}
      <div className="section-title">项目看板</div>
      {boards === undefined ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : (
        <div className="grid-cards">
          {boards
            .filter((b) => b.kind === "backlog")
            .map((board) => (
              <div
                key={board._id}
                className="card project-card"
                onClick={() => onOpenBoard(board._id)}
                style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))" }}
              >
                <div className="row">
                  <span style={{ fontSize: 18 }}>📋</span>
                  <h3>{board.name}</h3>
                  <div className="spacer" />
                  <Badge color="var(--accent)" soft>预期成果</Badge>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {board.description || BOARD_KIND_META.backlog.hint}
                </div>
                <div className="row" style={{ fontSize: 12.5 }}>
                  <span className="muted">
                    {board.goals} 个目标项 · {board.goalsDone} 已完成
                  </span>
                  <div className="spacer" />
                  {board.progress > 0 && <span className="faint">{board.progress}%</span>}
                </div>
                <ProgressBar percent={board.progress} />
              </div>
            ))}

          {boards
            .filter((b) => b.kind === "sprint")
            .map((board) => {
              const meta = sprintStatusMeta(board.sprintStatus);
              const daysLeft =
                board.endDate === undefined
                  ? null
                  : Math.ceil((board.endDate - Date.now()) / 86_400_000);
              return (
                <div
                  key={board._id}
                  className="card project-card"
                  onClick={() => onOpenBoard(board._id)}
                >
                  <div className="row">
                    <span style={{ fontSize: 18 }}>🏃</span>
                    <h3>{board.name}</h3>
                    <div className="spacer" />
                    <Badge color={meta.color} soft>{meta.label}</Badge>
                    {/* 迭代设置对所有项目成员开放（不是 owner 专属）：服务端
                        updateBoard 本来就只要求「是项目成员」。 */}
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      title="迭代设置"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettingsFor({
                          _id: board._id,
                          name: board.name,
                          goal: board.goal,
                          startDate: board.startDate,
                          endDate: board.endDate,
                        });
                      }}
                    >
                      ⚙
                    </button>
                  </div>
                  {board.goal ? (
                    <div className="muted" style={{ fontSize: 13 }}>🎯 {board.goal}</div>
                  ) : null}
                  <div className="row" style={{ fontSize: 12.5 }}>
                    <span className="muted">
                      {board.goals} 个目标项 · {board.tasks} 个任务项（{board.tasksDone} 已完成）
                    </span>
                    <div className="spacer" />
                    {daysLeft !== null && board.sprintStatus !== "closed" ? (
                      <span className="faint" style={{ fontSize: 11.5 }}>
                        剩 {daysLeft} 天
                      </span>
                    ) : null}
                  </div>
                  <div className="row" style={{ fontSize: 12 }}>
                    <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {board.goalsDone}/{board.goals} · {board.progress}%
                    </span>
                  </div>
                  <ProgressBar percent={board.progress} />
                </div>
              );
            })}

          <button
            className="card project-card"
            onClick={openNewBoard}
            aria-disabled={!canManage}
            disabled={!canManage}
            style={{
              alignItems: "center",
              justifyContent: "center",
              minHeight: 140,
              border: "1px dashed var(--border-strong)",
              background: "transparent",
              color: "var(--text-dim)",
            }}
          >
            ＋ 新建迭代
          </button>
        </div>
      )}


      {/* Members */}
      <div className="section-title">成员 ({members.length})</div>
      <div className="card">
        <div className="table-wrap"><table className="table">
          <tbody>
            {members.map((m) => (
              <tr key={m.user._id}>
                <td>
                  <div className="row">
                    <Avatar name={m.user.name} size="sm" />
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {m.user.name}
                        {m.user._id === userId ? " (我)" : ""}
                      </div>
                      <div className="faint" style={{ fontSize: 12 }}>{m.user.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ width: 120 }}>
                  {m.role === "owner" ? (
                    <Badge color="var(--accent)" soft>拥有者</Badge>
                  ) : (
                    <span className="faint" style={{ fontSize: 12 }}>成员</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  {canManage && m.role !== "owner" && m.user._id !== userId && (
                    <ConfirmButton
                      className="btn btn-sm btn-danger"
                      label="移出项目"
                      confirmLabel="确认移出？"
                      onConfirm={async () => {
                        try {
                          await removeMember({ token, projectId, userId: m.user._id });
                          toast.push("已移出项目");
                        } catch (err) {
                          toast.push(describeError(err));
                        }
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* 活动日志 —— 后端按时间倒序返回，最新在上 */}
      <div className="card" style={{ padding: 18, marginBottom: 22 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>活动日志</h3>
          <div className="spacer" />
          <span className="faint" style={{ fontSize: 12 }}>最新在上</span>
        </div>
        <ActivityFeed token={token} projectId={projectId} previewLimit={5} />
      </div>

      {/* Modals */}
      {showBoard && (
        <Modal
          title="新建迭代"
          subtitle="默认「周一开工、周五收尾」，起止日期都可调整。"
          onClose={() => setShowBoard(false)}
        >
          <form className="form-row" onSubmit={submitBoard}>
            <div className="field">
              <label>类型</label>
              <div className="row wrap" style={{ gap: 8 }}>
                {BOARD_KINDS.filter((k) => k === "sprint").map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => setBoardKind(kind)}
                  >
                    {BOARD_KIND_META[kind].emoji} {BOARD_KIND_META[kind].label}
                  </button>
                ))}
                <span className="faint" style={{ fontSize: 12 }}>
                  预期成果看板每个项目只有一个，创建项目时已自动生成
                </span>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                将自动复制的卡片类型：
                {(previewLabels[boardKind] ?? DEFAULT_LABELS[boardKind]).map((l) => (
                  <span
                    key={l.name}
                    className="badge"
                    style={{
                      marginLeft: 5,
                      background: `color-mix(in srgb, ${l.color} 14%, transparent)`,
                      color: l.color,
                    }}
                  >
                    <i className="dot" style={{ background: l.color }} />
                    {l.name}
                  </span>
                ))}
                {(previewLabels[boardKind] ?? []).length === 0 && (
                  <span style={{ marginLeft: 5 }}>（暂无预设，使用内置默认值）</span>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="bname">迭代名称</label>
              <input
                id="bname"
                className="input"
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                placeholder="留空则自动命名为 迭代 N"
                maxLength={80}
              />
              
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="field">
                <label htmlFor="sstart">开始日期</label>
                <input
                  id="sstart"
                  type="date"
                  className="input"
                  value={sprintStart}
                  onChange={(e) => setSprintStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="send">结束日期</label>
                <input
                  id="send"
                  type="date"
                  className="input"
                  value={sprintEnd}
                  onChange={(e) => setSprintEnd(e.target.value)}
                />
              </div>
            </div>
            <p className="hint" style={{ marginTop: -6 }}>
              默认「周一开工、周五收尾」，最后一天留作缓冲；两个日期都可以改。
            </p>
            <div className="field">
              <label htmlFor="sgoal">迭代目标</label>
              <input
                id="sgoal"
                className="input"
                value={sprintGoal}
                onChange={(e) => setSprintGoal(e.target.value)}
                placeholder="本迭代要达成什么"
                maxLength={200}
              />
            </div>
            <div className="field">
              <label htmlFor="bdesc">描述（可选）</label>
              <textarea
                id="bdesc"
                className="textarea"
                value={boardDesc}
                onChange={(e) => setBoardDesc(e.target.value)}
                maxLength={400}
                placeholder="本迭代要达成什么？"
              />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowBoard(false)}>取消</button>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "创建中…" : "创建看板"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showInvite && (
        <Modal
          title="邀请成员"
          subtitle="对方需已注册。发送后可在「待处理的加入申请」中批准。"
          onClose={() => setShowInvite(false)}
        >
          <form className="form-row" onSubmit={submitInvite}>
            <div className="field">
              <label htmlFor="iemail">对方邮箱</label>
              <input
                id="iemail"
                className="input"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="imsg">留言（可选）</label>
              <input
                id="imsg"
                className="input"
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                placeholder="邀请你加入项目"
                maxLength={200}
              />
            </div>
            {inviteError && <div className="error-text">{inviteError}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setShowInvite(false)}>取消</button>
              <button className="btn btn-primary" type="submit" disabled={busyInvite}>
                {busyInvite ? "发送中…" : "发送邀请"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showSettings && (
        <ProjectSettingsDialog
          token={token}
          project={{
            _id: projectId,
            name: project.name,
            description: project.description,
            sprintLengthDays: project.sprintLengthDays ?? 14,
          }}
          updateProject={updateProject}
          onClose={() => setShowSettings(false)}
          onSaved={(msg) => toast.push(msg)}
        />
      )}

      {settingsFor && (
        <BoardSettingsDialog
          token={token}
          board={settingsFor}
          updateBoard={updateBoard}
          onClose={() => setSettingsFor(null)}
          onSaved={(v) => {
            setSettingsFor((cur) => (cur ? { ...cur, ...v } : cur));
            toast.push("看板设置已保存");
          }}
        />
      )}

      {toast.node}
    </div>
  );
}

function ProjectSettingsDialog({
  token,
  project,
  updateProject,
  onClose,
  onSaved,
}: {
  token: string;
  project: {
    _id: Id<"projects">;
    name: string;
    description: string;
    sprintLengthDays: number;
  };
  updateProject: ReturnType<typeof useMutation<typeof api.projects.updateProject>>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [days, setDays] = useState(project.sprintLengthDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateProject({
        token,
        projectId: project._id,
        name,
        description,
        sprintLengthDays: days,
      });
      onSaved("项目设置已保存");
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="项目设置"
      subtitle="迭代周期会作为新建迭代的默认时长。"
      onClose={onClose}
    >
      <div className="form-row">
        <div className="field">
          <label htmlFor="pname2">项目名称</label>
          <input
            id="pname2"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="field">
          <label htmlFor="pdesc2">项目描述</label>
          <textarea
            id="pdesc2"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={400}
          />
        </div>
        <div className="field">
          <label htmlFor="pdays">迭代周期（天）</label>
          <input
            id="pdays"
            className="input"
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ maxWidth: 140 }}
          />
          <div className="hint">
            默认 14 天（2 周）。已有迭代的起止日期不受影响，仅作用于之后新建的迭代。
          </div>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 迭代设置弹窗要回填的字段；`startDate`/`endDate` 只对迭代看板有值。 */
type BoardSettings = {
  _id: Id<"boards">;
  name: string;
  goal?: string;
  startDate?: number;
  endDate?: number;
};

function BoardSettingsDialog({
  token,
  board,
  updateBoard,
  onClose,
  onSaved,
}: {
  token: string;
  board: BoardSettings;
  updateBoard: ReturnType<typeof useMutation<typeof api.boards.updateBoard>>;
  onClose: () => void;
  onSaved: (v: { name: string; goal: string; startDate?: number; endDate?: number }) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(board.name);
  const [goal, setGoal] = useState(board.goal ?? "");
  const [start, setStart] = useState(
    board.startDate === undefined ? "" : toDateInput(new Date(board.startDate)),
  );
  const [end, setEnd] = useState(
    board.endDate === undefined ? "" : toDateInput(new Date(board.endDate)),
  );
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  /** 只有迭代看板有起止日期（预期成果看板的列没有日期）。 */
  const hasDates = board.startDate !== undefined || board.endDate !== undefined;

  const save = async () => {
    const startTs = start ? new Date(`${start}T00:00:00`).getTime() : undefined;
    const endTs = end ? new Date(`${end}T00:00:00`).getTime() : undefined;
    if (startTs !== undefined && endTs !== undefined && endTs <= startTs) {
      toast.push(describeError(new Error("INVALID_SPRINT_RANGE")));
      return;
    }
    setBusy(true);
    try {
      await updateBoard({
        token,
        boardId: board._id,
        name: trimmed,
        goal: goal.trim(),
        ...(hasDates ? { startDate: startTs, endDate: endTs } : {}),
      });
      onSaved({ name: trimmed, goal: goal.trim(), startDate: startTs, endDate: endTs });
      onClose();
    } catch (err) {
      toast.push(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`迭代设置 · ${board.name}`}
      subtitle="项目成员都可以修改迭代的名称、目标与起止日期"
      onClose={onClose}
    >
      <div className="form-row">
        <div className="field">
          <label htmlFor="bsetname">迭代名称</label>
          <input
            id="bsetname"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="field">
          <label htmlFor="bsetgoal">迭代目标</label>
          <input
            id="bsetgoal"
            className="input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="本迭代要达成什么（可留空）"
            maxLength={200}
          />
        </div>
        {hasDates && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="field">
              <label htmlFor="bsetstart">开始日期</label>
              <input
                id="bsetstart"
                type="date"
                className="input"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="bsetend">结束日期</label>
              <input
                id="bsetend"
                type="date"
                className="input"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

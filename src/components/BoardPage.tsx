import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { DAY_MS, GOAL_COLUMNS, SPRINT_STATUS_META, TASK_STATUS_META } from "../../convex/lib/constants";
import type { Attachment, BoardData, Goal, PublicUser, Task } from "./types";
import { ConfirmButton, Drawer, Modal, ProgressBar, useToast } from "./ui";
import BurndownChart from "./BurndownChart";
import LabelManager from "./LabelManager";
import { describeError, formatDate, isOverdue } from "../lib/ui";
import { ActivityFeed } from "./ActivityFeed";

type Props = {
  token: string;
  boardId: Id<"boards">;
  /** 当前登录用户 —— 新增任务项时默认由自己负责。 */
  currentUserId: Id<"users">;
  onBack: () => void;
  /** Jump straight to a sibling board without going back to the project. */
  onNavigate: (boardId: Id<"boards">) => void;
  /** The project creator may edit the categories copied in from the presets. */
  isProjectOwner: boolean;
};

const hours = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

/** YYYY-MM-DD in local time, for <input type="date">. */
const formatDateInput = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * A card's 类别, drawn as a small square of the category colour in front of the
 * card's name. The name itself is not printed — it lives in the hover title and
 * in the detail sheet — so the board stays scannable by colour.
 */
function LabelSquare({ label }: { label?: { name: string; color: string } }) {
  if (!label) return null;
  return (
    <span
      className="label-square"
      style={{ background: label.color }}
      title={label.name}
      role="img"
      aria-label={`类别：${label.name}`}
    />
  );
}

/** Resolves a card's `labelId` against the board's category vocabulary. */
function findLabel(labels: BoardData["labels"], id?: Id<"labels">) {
  return labels.find((l) => l._id === id);
}

/* ------------------------------------------------------------------ *
 * 预期成果看板 — 目标项 in three columns, ordered by the 产品经理
 * ------------------------------------------------------------------ */

function ProductList({
  data,
  token,
  isOwner,
  onOpenGoal,
}: {
  data: BoardData;
  token: string;
  /**
   * 只有项目 owner 能改成果看板：新增目标项、在列之间移动、把目标项移出迭代
   * （移出会连带删除该目标项的任务，所以不能开放给一般成员）。
   */
  isOwner: boolean;
  onOpenGoal: (goal: Goal) => void;
}) {
  const createGoal = useMutation(api.goals.createGoal);
  const reorder = useMutation(api.goals.reorderGoal);
  const moveGoal = useMutation(api.goals.moveGoal);
  const plan = useMutation(api.goals.planGoalToSprint);
  const boards = useQuery(
    api.boards.listBoards,
    token ? { token, projectId: data.board.projectId } : "skip",
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [planning, setPlanning] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sprints = (boards ?? []).filter((b) => b.kind === "sprint" && !b.archived);
  const sprintName = (id: Id<"boards">) =>
    sprints.find((s) => s._id === id)?.name ?? "迭代";

  /**
   * The product list is hand-filled from 待处理 only. A goal reaches 处理中 by
   * being planned into an 迭代 and 已完成 by an owner moving the card there by
   * hand, so offering an add box in those columns would let you write a state
   * the board immediately contradicts. The server enforces the same rule.
   */
  const intakeColumnId = data.columns.find((c) => c.name === GOAL_COLUMNS[0])?._id;
  /** New cards are name-only; 类别 is picked later in the goal's detail panel. */
  const add = async (columnId: Id<"columns">) => {
    const title = (draft[columnId] ?? "").trim();
    if (!title) return;
    setDraft((d) => ({ ...d, [columnId]: "" }));
    try {
      setError(null);
      await createGoal({
        token,
        boardId: data.board._id,
        columnId,
        title,
      });
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="board-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {data.columns.map((column) => (
          <section className="column" key={column._id}>
            <header className="column-head">
              <span className="dot" style={{ background: column.color ?? "#94a3b8" }} />
              <h3 className="column-title">{column.name}</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                {column.goals.length}
              </span>
            </header>

            <div className="column-body">
              {column.goals.map((goal, index) => (
                <article className="card" key={goal._id}>
                  <div className="card-main" onClick={() => onOpenGoal(goal)}>
                    <div className="card-title">
                      <LabelSquare label={findLabel(data.labels, goal.labelId)} />
                      {goal.title}
                    </div>
                    <div className="card-meta">
                      {goal.taskTotal > 0 && (
                        <span className="badge">
                          任务 {goal.taskDone}/{goal.taskTotal}
                        </span>
                      )}
                      {goal.sprintId && (
                        <span className="badge accent">{sprintName(goal.sprintId)}</span>
                      )}
                    </div>
                  </div>

                  {!column.isDone && goal.sprintId === undefined && (
                    <div className="card-actions">
                      <button
                        className="icon-btn"
                        title="上移（提高优先级）"
                        disabled={index === 0}
                        onClick={() =>
                          reorder({ token, goalId: goal._id, toIndex: index - 1 })
                        }
                      >
                        ↑
                      </button>
                      <button
                        className="icon-btn"
                        title="下移（降低优先级）"
                        disabled={index === column.goals.length - 1}
                        onClick={() =>
                          reorder({ token, goalId: goal._id, toIndex: index + 1 })
                        }
                      >
                        ↓
                      </button>
                      <button className="btn btn-sm" onClick={() => setPlanning(goal)}>
                        排入迭代
                      </button>
                    </div>
                  )}

                  {/* 移出迭代会**连带删除该目标项的任务**（任务属于迭代，会变孤儿），
                      所以：① 只给 owner 看；② 必须两步确认，且确认文案里写明后果。 */}
                  {goal.sprintId && isOwner && (
                    <div className="card-actions">
                      <ConfirmButton
                        label="移出迭代"
                        confirmLabel="确认移出并删除任务"
                        className="btn btn-sm btn-ghost"
                        onConfirm={() => plan({ token, goalId: goal._id })}
                      />
                    </div>
                  )}

                  {/* 目标项与任务解耦：简单的项目可以完全不管任务，由 owner 直接
                      把卡片移到目标列。每次移动都会写进活动日志（见 goal_moved）。 */}
                  {isOwner && (
                    <div className="card-actions">
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        移到
                      </span>
                      {data.columns.map((target) => (
                        <button
                          key={target._id}
                          className="btn btn-sm"
                          disabled={target._id === column._id}
                          title={
                            target._id === column._id
                              ? `已在「${target.name}」`
                              : `移到「${target.name}」`
                          }
                          onClick={() =>
                            moveGoal({ token, goalId: goal._id, columnId: target._id })
                          }
                        >
                          {target.name}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}

              {column._id === intakeColumnId && isOwner && (
                <div className="quick-add">
                  <input
                    className="input"
                    placeholder="＋ 新增目标项"
                    value={draft[column._id] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [column._id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void add(column._id);
                    }}
                  />
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {planning && (
        <PlanModal
          token={token}
          projectId={data.board.projectId}
          goal={planning}
          sprints={sprints.map((s) => ({
            _id: s._id,
            name: s.name,
            status: s.sprintStatus ?? "planned",
          }))}
          onClose={() => setPlanning(null)}
        />
      )}
    </>
  );
}

function PlanModal({
  token,
  projectId,
  goal,
  sprints,
  onClose,
}: {
  token: string;
  projectId: Id<"projects">;
  goal: Goal;
  sprints: { _id: Id<"boards">; name: string; status: "planned" | "active" | "closed" }[];
  onClose: () => void;
}) {
  const plan = useMutation(api.goals.planGoalToSprint);
  const createBoard = useMutation(api.boards.createBoard);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scope is frozen when a sprint starts, so only 未开始 ones are offered.
  const open = sprints.filter((s) => s.status === "planned");
  const blocked = sprints.filter((s) => s.status !== "planned");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="排入迭代" subtitle={`「${goal.title}」将进入「处理中」`} onClose={onClose}>
      {open.length > 0 ? (
        <div className="stack">
          {open.map((sprint) => (
            <button
              className="btn pick"
              key={sprint._id}
              disabled={busy}
              onClick={() => run(() => plan({ token, goalId: goal._id, sprintId: sprint._id }))}
            >
              {sprint.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">没有可加入的迭代 —— 只能排入尚未开始的迭代。</p>
      )}

      {blocked.length > 0 && (
        <div className="stack" style={{ marginTop: 10 }}>
          {blocked.map((sprint) => (
            <div className="btn pick" key={sprint._id} aria-disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              {sprint.name}
              <span className="faint" style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                {sprint.status === "planned" ? "未开始" : SPRINT_STATUS_META[sprint.status].label}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        className="btn pick btn-primary"
        disabled={busy}
        onClick={() =>
          run(async () => {
            // 排入的同时建一个新的迭代，不必退回项目页。
            const sprintId = await createBoard({ token, projectId, kind: "sprint" });
            await plan({ token, goalId: goal._id, sprintId });
          })
        }
      >
        {busy ? "处理中…" : "＋ 新建迭代并排入"}
      </button>

      {error && <div className="error-text">{error}</div>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * 迭代 — a row of the selected goals, then three task lanes
 * ------------------------------------------------------------------ */

function IterationView({
  data,
  token,
  currentUserId,
  onOpenGoal,
}: {
  data: BoardData;
  token: string;
  /** 新增任务项的默认负责人。 */
  currentUserId: Id<"users">;
  onOpenGoal: (goal: Goal) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [timing, setTiming] = useState<{ task: Task; next: "in_progress" | "done" } | null>(
    null,
  );
  const [editing, setEditing] = useState<Task | null>(null);


  return (
    <>
      {/* ---- the row of selected 目标项 ---- */}
      <div className="goal-strip">
        {data.goals.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            还没有选中的目标项 —— 到预期成果看板点「排入迭代」把它们挑进来。
          </p>
        ) : (
          data.goals.map((goal) => (
            <button className="goal-chip" key={goal._id} onClick={() => onOpenGoal(goal)}>
              <span className="goal-chip-title">{goal.title}</span>
              <span className="goal-chip-meta">
                任务 {goal.taskDone}/{goal.taskTotal}
              </span>
              <span className="goal-chip-bar">
                <i
                  style={{
                    width: `${goal.taskTotal ? (goal.taskDone / goal.taskTotal) * 100 : 0}%`,
                  }}
                />
              </span>
            </button>
          ))
        )}
      </div>

      {/* ---- the three task lanes ---- */}
      <div className="board-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        {data.lanes.map((lane) => (
          <section className="column" key={lane.status}>
            <header className="column-head">
              <span className="dot" style={{ background: lane.color }} />
              <h3 className="column-title">{lane.name}</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                {lane.tasks.length}
              </span>
            </header>
            <div className="column-body">
              {lane.tasks.map((task) => (
                <TaskCard
                  key={task._id}
                  token={token}
                  task={task}
                  labels={data.labels}
                  onAdvance={() =>
                    setTiming({
                      task,
                      next: task.status === "proposed" ? "in_progress" : "done",
                    })
                  }
                  onOpen={() => setEditing(task)}
                />
              ))}
              {/* A running sprint may still gain tasks that serve its
                  goal. Only a *finished* sprint is frozen. */}
              {data.board.sprintStatus !== "closed" && lane.status === "proposed" && (
                <button className="btn btn-ghost" onClick={() => setAdding(true)}>
                  ＋ 新增任务项
                </button>
              )}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <TaskEditor
          token={token}
          task={editing}
          labels={data.labels}
          members={data.members}
          goals={data.goals}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && (
        <NewTaskModal
          token={token}
          data={data}
          currentUserId={currentUserId}
          onClose={() => setAdding(false)}
        />
      )}
      {timing && (
        <TimeModal
          token={token}
          task={timing.task}
          next={timing.next}
          onClose={() => setTiming(null)}
        />
      )}
    </>
  );
}

/**
 * The lane card deliberately shows only what you scan for: its category and
 * its name. Everything else — dates, hours, owner, linked goals — lives in the
 * detail sheet behind 修改.
 */
/**
 * The lane card shows what you scan for — category, name — plus the one
 * button that moves the card along. Everything else (dates, hours, owner,
 * linked goals) stays in the detail sheet behind 修改.
 */
function TaskCard({
  token,
  task,
  labels,
  onAdvance,
  onOpen,
}: {
  token: string;
  task: Task;
  labels: BoardData["labels"];
  onAdvance: () => void;
  onOpen: () => void;
}) {
  const setStatus = useMutation(api.goals.setTaskStatus);
  const toast = useToast();
  const meta = TASK_STATUS_META[task.status];
  const label = labels.find((l) => l._id === task.labelId);
  // 按「天」判断：完成日当天不算逾期，只有日期早于今天才算。
  const overdue = task.status !== "done" && isOverdue(task.dueDate);

  return (
    <article className="card slim">
      <span className="lane-tag" style={{ background: meta.color }} />
      <div className="card-open" onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`查看并修改「${task.title}」`}
      >
        <LabelSquare label={label} />
        <span className="card-title">{task.title}</span>
        {overdue && (
          <span className="badge late" title="已超过预计完成日期">
            逾期
          </span>
        )}
      </div>
      {/* The state change stays on the card: it is the lane's main verb.
          Tapping the name above already opens the detail, so no edit button. */}
      <div className="card-row">
        {task.status === "done" ? (
          <button
            className="btn btn-sm"
            onClick={async () => {
              try {
                await setStatus({ token, taskId: task._id, status: "proposed" });
                toast.push("已撤回为提议");
              } catch (err) {
                toast.push(describeError(err));
              }
            }}
          >
            撤回
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={onAdvance}>
            {task.status === "proposed" ? "▶ 开始执行" : "✔ 标记完成"}
          </button>
        )}
      </div>
    </article>
  );
}

/** 任务项 编辑：标题 / 负责人 / 预计完成日期 / 类别。 */
function TaskEditor({
  token,
  task,
  labels,
  members,
  goals,
  onClose,
}: {
  token: string;
  task: Task;
  labels: BoardData["labels"];
  members: PublicUser[];
  goals: Goal[];
  onClose: () => void;
}) {
  const update = useMutation(api.goals.updateTask);
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState<string>(task.assigneeId);
  const [due, setDue] = useState(formatDateInput(task.dueDate));
  const [labelId, setLabelId] = useState<string>(task.labelId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || !due) return;
    setBusy(true);
    setError(null);
    try {
      await update({
        token,
        taskId: task._id,
        title,
        assigneeId: assignee as Id<"users">,
        dueDate: new Date(due).getTime(),
        labelId: labelId ? (labelId as Id<"labels">) : null,
      });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="任务项详情" subtitle="所有字段都在这里查看和修改" onClose={onClose}>
      {/* Read-only facts the app records for you. */}
      <dl className="sheet">
        <div className="sheet-row">
          <dt>关联目标项</dt>
          <dd>
            {goals
              .filter((g) => task.goalIds.includes(g._id))
              .map((g) => g.title)
              .join("、") || "—"}
          </dd>
        </div>
        <div className="sheet-row">
          <dt>实际开始日期</dt>
          <dd>{task.startDate === undefined ? "尚未开始" : formatDate(task.startDate)}</dd>
        </div>
        <div className="sheet-row">
          <dt>实际完成日期</dt>
          <dd>
            {task.actualCompletedAt === undefined
              ? "尚未完成"
              : formatDate(task.actualCompletedAt)}
          </dd>
        </div>
        <div className="sheet-row">
          <dt>工时</dt>
          <dd>
            预计 {task.estimatedHours === undefined ? "—" : `${hours(task.estimatedHours)}h`}
            {" · "}
            耗费 {task.actualHours === undefined ? "—" : `${hours(task.actualHours)}h`}
          </dd>
        </div>
      </dl>

      <div className="form-row">
        <div className="field">
          <label htmlFor="etitle">任务名称 *</label>
          <input
            id="etitle"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="eassignee">负责人 *</label>
          <select
            id="eassignee"
            className="input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            {members.map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="edue">预计完成日期（最后期限）*</label>
          <input
            id="edue"
            className="input"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="elabel">类别</label>
          <select
            id="elabel"
            className="input"
            value={labelId}
            onChange={(e) => setLabelId(e.target.value)}
          >
            <option value="">未分类</option>
            {labels.map((l) => (
              <option key={l._id} value={l._id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={busy || !title.trim() || !due}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>

      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Modals
 * ------------------------------------------------------------------ */

/** 开始执行 asks for 预计工时; 标记完成 asks for 耗费工时. */
function TimeModal({
  token,
  task,
  next,
  onClose,
}: {
  token: string;
  task: Task;
  next: "in_progress" | "done";
  onClose: () => void;
}) {
  const setStatus = useMutation(api.goals.setTaskStatus);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDone = next === "done";

  const submit = async () => {
    const num = Number(value);
    if (!value || !Number.isFinite(num) || num <= 0) {
      setError("请填写大于 0 的工时");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setStatus(
        isDone
          ? { token, taskId: task._id, status: "done", actualHours: num }
          : { token, taskId: task._id, status: "in_progress", estimatedHours: num },
      );
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isDone ? "完成任务项" : "开始执行"}
      subtitle={
        isDone
          ? `将自动记录实际完成日期（今天），请填写耗费工时`
          : `将自动记录实际开始日期（今天），请填写预计工时`
      }
      onClose={onClose}
    >
      <div className="form-row">
        <div className="field">
          <label htmlFor="hrs">{isDone ? "耗费工时（小时）*" : "预计工时（小时）*"}</label>
          <input
            id="hrs"
            className="input"
            type="number"
            min={0.5}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "保存中…" : "确认"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NewTaskModal({
  token,
  data,
  currentUserId,
  onClose,
}: {
  token: string;
  data: BoardData;
  /** 当前登录用户：新增的任务项默认由自己负责。 */
  currentUserId: Id<"users">;
  onClose: () => void;
}) {
  const create = useMutation(api.goals.createTask);
  const [title, setTitle] = useState("");
  // 默认负责人＝当前用户。全局管理员可能是「非成员的只读访客」，此时它不在
  // `members` 里，`<select>` 会选不中任何 option（界面与 state 不一致），
  // 所以这种情况回退到第一位成员。
  const [assignee, setAssignee] = useState<string>(
    data.members.some((m) => m._id === currentUserId)
      ? currentUserId
      : (data.members[0]?._id ?? ""),
  );
  const [due, setDue] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) {
      setError("每个任务项至少要关联一个目标项");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await create({
        token,
        boardId: data.board._id,
        title,
        assigneeId: assignee as Id<"users">,
        dueDate: new Date(due).getTime(),
        goalIds: [...selected] as Id<"goals">[],
      });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="新增任务项" onClose={onClose}>
      <div className="form-row">
        <p className="hint">
          这里填的是<strong>预计完成日期（最后期限）</strong>。实际开始日期在实际点击「开始执行」时自动记录，
          实际完成日期在点击「标记完成」时自动记录，无需手工填写。
        </p>
        <div className="field">
          <label htmlFor="ttitle">任务名称 *</label>
          <input
            id="ttitle"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="tassignee">负责人 *</label>
          <select
            id="tassignee"
            className="input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            {data.members.map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tdue">预计完成日期（最后期限）*</label>
          <input
            id="tdue"
            className="input"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div className="field">
          <label>关联目标项 *（可多选）</label>
          {data.goals.length === 0 ? (
            <p className="muted">本迭代还没有目标项，请先从预期成果看板排入。</p>
          ) : (
            <div className="stack">
              {data.goals.map((g) => (
                <label className="checkline" key={g._id}>
                  <input
                    type="checkbox"
                    checked={selected.has(g._id as string)}
                    onChange={() => toggle(g._id as string)}
                  />
                  {g.title}
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !title.trim() || !due}
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Page shell
 * ------------------------------------------------------------------ */

/** 计划执行统计：已完成任务项的预计工时 vs 实际工时。 */
function EffortStats({ token, boardId, onClose }: {
  token: string;
  boardId: Id<"boards">;
  onClose: () => void;
}) {
  const stats = useQuery(api.goals.effortStats, { token, boardId });
  const hrs = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));

  return (
    <Modal title="计划执行统计" subtitle="已完成任务项的预计工时与实际工时对比" onClose={onClose}>
      {!stats ? (
        <p className="muted">统计中…</p>
      ) : stats.done === 0 ? (
        <p className="muted">还没有已完成的任务项，标记完成一个后即可对比。</p>
      ) : (
        <>
          <div className="effort-grid">
            <div className="effort-cell">
              <span className="effort-k">预计工时</span>
              <span className="effort-v">{hrs(stats.estimated)}h</span>
            </div>
            <div className="effort-cell">
              <span className="effort-k">实际工时</span>
              <span className="effort-v">{hrs(stats.actual)}h</span>
            </div>
            <div className={`effort-cell ${stats.delta > 0 ? "over" : stats.delta < 0 ? "under" : "even"}`}>
              <span className="effort-k">偏差</span>
              <span className="effort-v">
                {stats.delta > 0 ? "+" : ""}
                {hrs(stats.delta)}h
                {stats.deltaPercent !== undefined && `（${stats.deltaPercent > 0 ? "+" : ""}${stats.deltaPercent}%）`}
              </span>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
            {stats.done} 个已完成任务项
            {stats.delta > 0 && "，整体超出计划"}
            {stats.delta < 0 && "，整体快于计划"}
            {stats.delta === 0 && "，与计划持平"}
            。另有 执行中 {stats.inProgress}、提议 {stats.proposed}。
          </p>

          {stats.byLabel.length > 0 && (
            <table className="table effort-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>类别</th>
                  <th>数量</th>
                  <th>预计</th>
                  <th>实际</th>
                  <th>偏差</th>
                </tr>
              </thead>
              <tbody>
                {stats.byLabel.map((row) => (
                  <tr key={row.labelId ?? "none"}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="dot" style={{ background: row.color }} />
                        {row.name}
                      </span>
                    </td>
                    <td>{row.count}</td>
                    <td>{hrs(row.estimated)}h</td>
                    <td>{hrs(row.actual)}h</td>
                    <td style={{ color: row.delta > 0 ? "var(--warning)" : row.delta < 0 ? "var(--success)" : undefined }}>
                      {row.delta > 0 ? "+" : ""}{hrs(row.delta)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}

function SprintHeader({
  board,
  token,
  boardId,
}: {
  board: BoardData["board"];
  token: string;
  boardId: Id<"boards">;
}) {
  // x = 迭代内的天数, y = 本期任务剩余工时.
  const burndown = useQuery(
    api.progress.getSprintBurndown,
    board.kind === "sprint" ? { token, boardId } : "skip",
  );
  const [showChart, setShowChart] = useState(false);
  const start = board.startDate ?? 0;
  const end = board.endDate ?? 0;
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
  // Derived server-side from the sprint's dates, so it is never stale.
  const status = board.sprintStatus ?? "planned";
  const meta2 = SPRINT_STATUS_META[status];
  return (
    <div className="sprint-head">
      <span
        className="badge"
        style={{ background: `${meta2.color}22`, color: meta2.color }}
      >
        {meta2.label}
      </span>
      <button className="btn btn-sm btn-ghost" onClick={() => setShowChart((v) => !v)}>
        {showChart ? "▾ 收起燃尽图" : "📉 燃尽图"}
      </button>
      <span className="muted" style={{ fontSize: 12.5 }}>
        {formatDate(start)} → {formatDate(end)} · 剩 {daysLeft} 天
      </span>
      {board.goal && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          🎯 {board.goal}
        </span>
      )}
      {showChart && (
        <div className="sprint-chart">
          <BurndownChart
            labels={(burndown?.points ?? []).map((p) => p.date.slice(5))}
            remaining={(burndown?.points ?? []).map((p) => p.remaining)}
            ideal={(burndown?.points ?? []).map((p) => p.ideal)}
            unitLabel="本期任务剩余工时（小时）"
            emptyHint="本迭代还没有记录。任务开始执行时会自动开始绘制。"
          />
        </div>
      )}
    </div>
  );
}

/** 预期成果看板 ↔ 各迭代 一键切换，不必退回项目页。 */
function BoardTabs({
  token,
  projectId,
  currentId,
  onNavigate,
}: {
  token: string;
  projectId: Id<"projects">;
  currentId: Id<"boards">;
  onNavigate: (id: Id<"boards">) => void;
}) {
  const boards = useQuery(
    api.boards.listBoards,
    token ? { token, projectId } : "skip",
  );
  const list = boards ?? [];
  const backlog = list.find((b) => b.kind === "backlog");
  const sprints = list.filter((b) => b.kind === "sprint");

  return (
    <div className="tabs" role="tablist">
      {backlog && (
        <button
          role="tab"
          aria-selected={backlog._id === currentId}
          className={`tab${backlog._id === currentId ? " on" : ""}`}
          onClick={() => onNavigate(backlog._id)}
        >
          📋 预期成果看板
        </button>
      )}
      {sprints.map((s) => (
        <button
          role="tab"
          key={s._id}
          aria-selected={s._id === currentId}
          className={`tab${s._id === currentId ? " on" : ""}`}
          onClick={() => onNavigate(s._id)}
        >
          <span className="tab-dot" data-state={s.sprintStatus} />
          {s.name}
          {s.goals > 0 && <span className="tab-count">{s.goalsDone}/{s.goals}</span>}
        </button>
      ))}
    </div>
  );
}

export default function BoardPage({
  token,
  boardId,
  currentUserId,
  onBack,
  onNavigate,
  isProjectOwner,
}: Props) {
  const data = useQuery(api.boards.getBoard, { token, boardId });
  const [openGoal, setOpenGoal] = useState<Goal | null>(null);
  const [showEffort, setShowEffort] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  if (!data) return <div className="muted">加载中…</div>;

  const isProduct = data.board.kind === "backlog";
  const { goals, goalsDone, tasks, tasksDone, estimatedHours, actualHours } = data.counts;

  return (
    // `.page` carries the horizontal gutter and the max width; the bare <div>
    // this used to be left the header flush against the screen edge on phones.
    <div className="page">
      <BoardTabs
        token={token}
        projectId={data.board.projectId}
        currentId={data.board._id}
        onNavigate={onNavigate}
      />

      <div className="page-head">
        <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
          ← 项目
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 className="row" style={{ gap: 10 }}>
            {data.board.name}
            {data.board.kind === "sprint" && data.board.sprintNumber !== undefined && (
              <span className="key-chip">#{data.board.sprintNumber}</span>
            )}
          </h1>
          <p>
            {isProduct
              ? `${goals} 个目标项 · ${goalsDone} 已完成`
              : `${goals} 个目标项 · ${tasks} 个任务项（${tasksDone} 已完成） · 预计 ${hours(estimatedHours)}h${
                  actualHours > 0 ? ` · 实际 ${hours(actualHours)}h` : ""
                }`}
          </p>
        </div>
        {goals > 0 && <ProgressBar percent={Math.round((goalsDone / goals) * 100)} />}
        <button
          className="btn"
          onClick={() => setShowLabels(true)}
          title={isProjectOwner ? "管理本列表的卡片类型" : "查看本列表的卡片类型"}
        >
          🏷 卡片类型
        </button>
        {!isProduct && (
          <button className="btn" onClick={() => setShowEffort(true)}>
            📊 计划执行统计
          </button>
        )}
      </div>

      {!isProduct && <SprintHeader board={data.board} token={token} boardId={boardId} />}

      {isProduct ? (
        <ProductList
          data={data}
          token={token}
          isOwner={isProjectOwner}
          onOpenGoal={setOpenGoal}
        />
      ) : (
        <IterationView
          data={data}
          token={token}
          currentUserId={currentUserId}
          onOpenGoal={setOpenGoal}
        />
      )}

      {showLabels && (
        <Modal
          title="卡片类型"
          subtitle={
            isProjectOwner
              ? "这些分类由系统预设复制而来，你可以随时改名、调整颜色或删除"
              : "本列表使用的分类，由项目创建者维护"
          }
          onClose={() => setShowLabels(false)}
        >
          <LabelManager
            token={token}
            boardId={boardId}
            labels={data.labels}
            canManage={isProjectOwner}
          />
        </Modal>
      )}

      {showEffort && (
        <EffortStats token={token} boardId={boardId} onClose={() => setShowEffort(false)} />
      )}

      {openGoal && (
        <GoalDrawer
          token={token}
          goal={openGoal}
          data={data}
          onClose={() => setOpenGoal(null)}
        />
      )}
    </div>
  );
}

function GoalDrawer({
  token,
  goal,
  data,
  onClose,
}: {
  token: string;
  goal: Goal;
  data: BoardData;
  onClose: () => void;
}) {
  const update = useMutation(api.goals.updateGoal);
  const [title, setTitle] = useState(goal.title);
  const [value, setValue] = useState(goal.value?.toString() ?? "");
  // `goalLabels`, not `labels`: a goal is always categorised from the 预期成果看板's
  // vocabulary, and this drawer is reachable from an 迭代 board too.
  const [labelId, setLabelId] = useState<string>(goal.labelId ?? "");
  const [error, setError] = useState<string | null>(null);

  // Saved on blur: the drawer is a live view, so there is no save button.
  const save = async () => {
    if (title.trim() === goal.title) return;
    setError(null);
    try {
      await update({ token, goalId: goal._id, title });
    } catch (err) {
      setError(describeError(err));
    }
  };

  /** 客户价值估计 (1~10) 是发布燃尽图的纵轴单位，单独编辑。 */
  const saveValue = async () => {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 10)) {
      setError("INVALID_CUSTOMER_VALUE");
      return;
    }
    const current = goal.value ?? null;
    if (next === current) return;
    setError(null);
    try {
      await update({ token, goalId: goal._id, value: next });
    } catch (err) {
      setError(describeError(err));
    }
  };

  /** 类别 is optional, and chosen here rather than when the card is captured. */
  const saveLabel = async (next: string) => {
    setLabelId(next);
    setError(null);
    try {
      await update({
        token,
        goalId: goal._id,
        labelId: next ? (next as Id<"labels">) : null,
      });
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Drawer title={goal.title} onClose={onClose}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="gtitle">标题</label>
          <input
            id="gtitle"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={save}
          />
        </div>
        <div className="field">
          <label htmlFor="glabel">类别</label>
          <select
            id="glabel"
            className="input"
            value={labelId}
            onChange={(e) => void saveLabel(e.target.value)}
          >
            <option value="">未分类</option>
            {data.goalLabels.map((l) => (
              <option key={l._id} value={l._id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="faint" style={{ fontSize: 11.5 }}>
            设为类别后，卡片名称前会显示该类别颜色的方块
          </span>
        </div>
        <div className="field">
          <label htmlFor="gvalue">客户价值估计（1~10）</label>
          <input
            id="gvalue"
            className="input"
            type="number"
            min={1}
            max={10}
            step={1}
            value={value}
            placeholder="未评定"
            onChange={(e) => setValue(e.target.value)}
            onBlur={saveValue}
          />
          <span className="faint" style={{ fontSize: 11.5 }}>
            PO 评定的相对价值，也是发布燃尽图的纵轴单位
          </span>
        </div>
        {error && <div className="error-text">{error}</div>}

        <CheckListSection token={token} goal={goal} />
        <AttachmentSection token={token} goal={goal} />

        {/* 变更历史放在抽屉**最后**：它是只读的追溯信息，不该挡在检查列表、
            附件这些要动手的内容前面。 */}
        <div className="field">
          <label>变更历史</label>
          <ActivityFeed token={token} goalId={goal._id} emptyHint="这个目标项还没有变更记录" />
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * 检查列表
 * ------------------------------------------------------------------ */

function CheckListSection({
  token,
  goal,
}: {
  token: string;
  goal: Goal;
}) {
  const checks = useQuery(api.attachments.listChecks, { token, goalId: goal._id });
  const add = useMutation(api.attachments.addCheck);
  const toggle = useMutation(api.attachments.toggleCheck);
  const remove = useMutation(api.attachments.deleteCheck);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 检查项只保留文本：不记检查人，也不记检查时间。
  const submit = async () => {
    if (!text.trim()) return;
    setError(null);
    try {
      await add({ token, goalId: goal._id, text });
      setText("");
    } catch (err) {
      setError(describeError(err));
    }
  };

  const items = checks?.items ?? [];
  const done = checks?.done ?? 0;
  const total = checks?.total ?? 0;

  return (
    <div className="field">
      <label>
        检查列表
        {total > 0 && (
          <span className="muted" style={{ fontWeight: 400 }}>
            {" "}
            {done}/{total}
          </span>
        )}
      </label>

      {total > 0 && (
        <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
          {items.map((item) => (
            <div className="check-row" key={item._id}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => toggle({ token, checkId: item._id })}
                aria-label={item.text}
              />
              <span className={item.done ? "check-text done" : "check-text"}>{item.text}</span>
              <button
                className="icon-btn"
                title="删除检查项"
                onClick={() => remove({ token, checkId: item._id })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="check-add">
        <input
          className="input"
          placeholder="＋ 添加检查项"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button className="btn" onClick={submit} disabled={!text.trim()}>
          添加
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 附件 — schematics inline, documents for download
 * ------------------------------------------------------------------ */

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif";
const DOC_ACCEPT = `${IMAGE_ACCEPT},.doc,.docx,.pdf,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv`;

const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function AttachmentSection({ token, goal }: { token: string; goal: Goal }) {
  const list = useQuery(api.attachments.listAttachments, { token, goalId: goal._id });
  const generate = useMutation(api.attachments.generateUploadUrl);
  const create = useMutation(api.attachments.createAttachment);
  const remove = useMutation(api.attachments.deleteAttachment);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const { uploadUrl, name } = await generate({
          token,
          goalId: goal._id,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        // Convex allocates the Id<"_storage"> in the upload response.
        const res = await fetch(uploadUrl, { method: "POST", body: file });
        if (!res.ok) throw new Error("UPLOAD_FAILED");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await create({
          token,
          goalId: goal._id,
          storageId,
          name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /**
   * 下载非图片附件。
   *
   * 存储 URL 与页面**不同源**，跨域时浏览器会忽略 `<a download>` 的 download 属性
   * （还会因为 `target="_blank"` 变成"打开新标签页"），所以先把字节取回来，
   * 再用 object URL 触发保存 —— 文件名由我们指定，PDF/Word 都能真正落盘。
   */
  const download = async (attachment: Attachment) => {
    const url = attachment.url;
    if (!url) {
      setError("附件地址不可用，请刷新后重试");
      return;
    }
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = attachment.name;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // 取回失败（例如被跨域策略拦下）时退化为打开签名 URL，浏览器通常会自行下载。
      window.open(url, "_blank", "noopener");
    }
  };

  const items = list ?? [];
  const images = items.filter((a) => a.isImage && a.url);
  const docs = items.filter((a) => !a.isImage);

  return (
    <div className="field">
      <label>附件</label>

      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={DOC_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => upload(e.target.files)}
        />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "上传中…" : "＋ 上传附件"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => fileRef.current?.setAttribute("accept", IMAGE_ACCEPT)}
          onDoubleClick={() => fileRef.current?.setAttribute("accept", DOC_ACCEPT)}
          title="示意图（PNG/JPG/GIF/WebP/SVG）会直接显示"
        >
          只传图片
        </button>
      </div>

      {/* Schematics render inline. */}
      {images.length > 0 && (
        <div className="shot-grid">
          {images.map((a) => (
            <figure className="shot" key={a._id}>
              <img
                src={a.url}
                alt={a.name}
                loading="lazy"
                onClick={() => setLightbox(a)}
              />
              <figcaption>
                <span className="shot-name" title={a.name}>
                  {a.name}
                </span>
                <span className="muted">{fileSize(a.size)}</span>
                <button
                  className="icon-btn"
                  title="删除附件"
                  onClick={() => remove({ token, attachmentId: a._id })}
                >
                  ✕
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {docs.map((a) => (
            <div className="check-row" key={a._id}>
              <span className="doc-ico">📄</span>
              <span className="check-text" title={a.name}>
                {a.name}
              </span>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {fileSize(a.size)}
              </span>
              <button className="btn btn-sm" onClick={() => download(a)}>
                下载
              </button>
              <button
                className="icon-btn"
                title="删除附件"
                onClick={() => remove({ token, attachmentId: a._id })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && !uploading && (
        <p className="hint">
          还没有附件。示意图（PNG/JPG/GIF/WebP/SVG）会直接显示在这里，Word、PDF 等文档可以下载查看。
        </p>
      )}
      {error && <div className="error-text">{error}</div>}

      {lightbox?.url && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.url} alt={lightbox.name} />
          <div className="lightbox-cap">{lightbox.name}</div>
        </div>
      )}
    </div>
  );
}

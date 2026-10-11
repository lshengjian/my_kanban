import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ConfirmButton, Modal, useToast } from "./ui";
import ColorPicker from "./ColorPicker";
import type { BoardLabel } from "./types";
import { describeError } from "../lib/ui";
import { FALLBACK_LABEL_COLOR } from "../../convex/lib/labelPresets";

/**
 * The board's tag vocabulary. Defaults are seeded from the board kind when it
 * is created (需求 → 功能/性能/约束, 缺陷 → 逻辑/界面/性能, 任务 → 需求/优化/调研);
 * only the project owner may change them from here.
 */
export default function LabelManager({
  token,
  boardId,
  labels,
  canManage,
}: {
  token: string;
  boardId: Id<"boards">;
  labels: BoardLabel[];
  canManage: boolean;
}) {
  const toast = useToast();
  const usage = useQuery(
    api.labels.listLabels,
    { token, boardId },
  );

  const createLabel = useMutation(api.labels.createLabel);
  const updateLabel = useMutation(api.labels.updateLabel);
  const deleteLabel = useMutation(api.labels.deleteLabel);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_LABEL_COLOR);
  const [editing, setEditing] = useState<Id<"labels"> | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<string>(FALLBACK_LABEL_COLOR);
  const [busy, setBusy] = useState(false);

  const counts = new Map(
    (usage ?? []).map((l) => [l._id as string, l.usageCount]),
  );

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await createLabel({ token, boardId, name, color });
      setAdding(false);
      setName("");
      setColor(FALLBACK_LABEL_COLOR);
      toast.push("标签已新增");
    } catch (err) {
      toast.push(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      await updateLabel({ token, labelId: editing, name: draftName, color: draftColor });
      setEditing(null);
      toast.push("标签已更新");
    } catch (err) {
      toast.push(describeError(err));
    }
  };

  return (
    <>
      <div className="row wrap" style={{ gap: 7, marginTop: 10 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          标签
        </span>
        {labels.map((label) => (
          <span
            key={label._id}
            className="badge"
            style={{ background: `color-mix(in srgb, ${label.color} 14%, transparent)`, color: label.color }}
          >
            <i className="dot" style={{ background: label.color }} />
            {label.name}
            <span style={{ opacity: 0.65, fontWeight: 500 }}>
              {counts.get(label._id) ?? 0}
            </span>
            {canManage && (
              <button
                className="btn btn-ghost btn-icon btn-sm"
                style={{ width: 18, height: 18, padding: 0, marginLeft: 2 }}
                title="编辑标签"
                onClick={() => {
                  setEditing(label._id);
                  setDraftName(label.name);
                  setDraftColor(label.color);
                }}
              >
                ✎
              </button>
            )}
          </span>
        ))}

        {canManage &&
          (adding ? null : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAdding(true)}
              title="新增标签"
            >
              ＋ 标签
            </button>
          ))}
        {!canManage && (
          <span className="faint" style={{ fontSize: 11.5 }}>
            （仅项目经理可修改）
          </span>
        )}
      </div>

      {adding && (
        <Modal
          title="新增标签"
          subtitle="标签只属于当前看板，不同看板可以有各自的标签体系。"
          onClose={() => setAdding(false)}
        >
          <form className="form-row" onSubmit={submitAdd}>
            <div className="field">
              <label htmlFor="lname">名称</label>
              <input
                id="lname"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：约束"
                maxLength={20}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>颜色</label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
                {busy ? "添加中…" : "添加"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title="编辑标签" onClose={() => setEditing(null)}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="ename">名称</label>
              <input
                id="ename"
                className="input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={20}
              />
            </div>
            <div className="field">
              <label>颜色</label>
              <ColorPicker value={draftColor} onChange={setDraftColor} />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <ConfirmButton
                className="btn btn-danger btn-sm"
                label="删除此分类"
                confirmLabel="确认删除？已有卡片不受影响"
                onConfirm={async () => {
                  try {
                    await deleteLabel({ token, labelId: editing });
                    setEditing(null);
                    // Cards keep the name they were tagged with, so nothing
                    // else needs to be cleaned up.
                    toast.push("分类已删除，已有卡片保持原样");
                  } catch (err) {
                    toast.push(describeError(err));
                  }
                }}
              />
              <div className="row">
                <button className="btn" onClick={() => setEditing(null)}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={submitEdit}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ConfirmButton, Modal, useToast } from "./ui";
import ColorPicker from "./ColorPicker";
import { describeError } from "../lib/ui";
import { BOARD_KINDS, BOARD_KIND_META } from "../../convex/lib/constants";
import { FALLBACK_LABEL_COLOR } from "../../convex/lib/labelPresets";
import type { BoardKind } from "../../convex/lib/constants";

type Template = { _id: Id<"labels">; name: string; color: string; position: number };

/**
 * Organisation-level card-type presets, one set per board kind. System admins
 * curate these; creating a board copies the matching set into that board, so
 * edits here only affect boards created afterwards.
 */
export default function TemplateEditor({
  token,
  standalone = false,
}: {
  token: string;
  standalone?: boolean;
}) {
  const toast = useToast();
  const templates = useQuery(api.templates.listTemplates, { token });
  const createTemplate = useMutation(api.templates.createTemplate);
  const updateTemplate = useMutation(api.templates.updateTemplate);
  const deleteTemplate = useMutation(api.templates.deleteTemplate);

  const [adding, setAdding] = useState<BoardKind | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FALLBACK_LABEL_COLOR);
  const [editing, setEditing] = useState<{ id: Id<"labels">; name: string; color: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.push(ok);
    } catch (err) {
      toast.push(describeError(err));
    }
  };

  return (
    <div className="card" style={{ padding: 18, marginBottom: 22 }}>
      {standalone ? null : (
        <>
          <div className="row" style={{ marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>卡片类型预设</h3>
            <div className="spacer" />
          </div>
        </>
      )}
      <p className="faint" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
        由管理员设置每种列表的默认卡片类型。项目经理新建时会<strong>自动复制</strong>对应预设，
        之后可自行修改、删除或新增，不影响其他看板。
      </p>

      {templates === undefined ? (
        <div className="skeleton" style={{ height: 90 }} />
      ) : (
        <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {BOARD_KINDS.map((kind) => {
            const list: Template[] = (templates[kind] ?? []) as Template[];
            return (
              <div
                key={kind}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                }}
              >
                <div className="row" style={{ marginBottom: 9 }}>
                  <span style={{ fontSize: 15 }}>
                    {BOARD_KIND_META[kind].emoji}
                  </span>
                  <b style={{ fontSize: 13.5 }}>{BOARD_KIND_META[kind].label}</b>
                  <div className="spacer" />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setAdding(kind);
                      setName("");
                      setColor(FALLBACK_LABEL_COLOR);
                    }}
                  >
                    ＋ 新增
                  </button>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {list.length === 0 ? (
                    <span className="faint" style={{ fontSize: 12 }}>
                      暂无预设，新建时将使用内置默认值
                    </span>
                  ) : (
                    list.map((t) => (
                      <span
                        key={t._id}
                        className="badge"
                        style={{
                          background: `color-mix(in srgb, ${t.color} 14%, transparent)`,
                          color: t.color,
                        }}
                      >
                        <i className="dot" style={{ background: t.color }} />
                        {t.name}
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          style={{ width: 18, height: 18, padding: 0 }}
                          title="编辑"
                          onClick={() =>
                            setEditing({ id: t._id, name: t.name, color: t.color })
                          }
                        >
                          ✎
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <Modal
          title={`新增预设 · ${BOARD_KIND_META[adding].label}`}
          subtitle="该预设会在此后新建的同类型列表上生效。"
          onClose={() => setAdding(null)}
        >
          <form
            className="form-row"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await run(
                () => createTemplate({ token, kind: adding, name, color }),
                "预设已新增",
              );
              setBusy(false);
              setAdding(null);
            }}
          >
            <div className="field">
              <label htmlFor="tname">名称</label>
              <input
                id="tname"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              <button type="button" className="btn" onClick={() => setAdding(null)}>
                取消
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
                {busy ? "保存中…" : "新增"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title="编辑预设" onClose={() => setEditing(null)}>
          <TemplateEditBody
            token={token}
            editing={editing}
            updateTemplate={updateTemplate}
            deleteTemplate={deleteTemplate}
            onDone={() => setEditing(null)}
            run={run}
          />
        </Modal>
      )}

      {toast.node}
    </div>
  );
}

function TemplateEditBody({
  token,
  editing,
  updateTemplate,
  deleteTemplate,
  onDone,
  run,
}: {
  token: string;
  editing: { id: Id<"labels">; name: string; color: string };
  updateTemplate: ReturnType<typeof useMutation<typeof api.templates.updateTemplate>>;
  deleteTemplate: ReturnType<typeof useMutation<typeof api.templates.deleteTemplate>>;
  onDone: () => void;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [name, setName] = useState(editing.name);
  const [color, setColor] = useState(editing.color);
  const [busy, setBusy] = useState(false);

  return (
    <div className="form-row">
      <div className="field">
        <label htmlFor="ename">名称</label>
        <input
          id="ename"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
        />
      </div>
      <div className="field">
        <label>颜色</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <ConfirmButton
          className="btn btn-danger btn-sm"
          label="删除此预设"
          confirmLabel="确认删除？"
          onConfirm={async () => {
            await run(() => deleteTemplate({ token, id: editing.id }), "预设已删除");
            onDone();
          }}
        />
        <div className="row">
          <button className="btn" onClick={onDone}>
            取消
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run(
                () => updateTemplate({ token, id: editing.id, name, color }),
                "预设已更新",
              );
              setBusy(false);
              onDone();
            }}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

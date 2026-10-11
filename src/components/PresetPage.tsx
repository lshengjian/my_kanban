import TemplateEditor from "./TemplateEditor";

/**
 * Card-type presets live on their own top-level page rather than inside user
 * management: they describe how work is classified, not who can access it, and
 * the project owner edits the per-board copies from the board itself.
 */
export default function PresetPage({ token }: { token: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>卡片类型预设</h1>
          <p>按敏捷项目管理看板类型维护默认卡片类型，新建时自动复制一份给项目经理</p>
        </div>
      </div>

      <TemplateEditor token={token} standalone />
    </div>
  );
}

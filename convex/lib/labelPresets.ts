import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DEFAULT_LABELS } from "./constants";

export const FALLBACK_LABEL_COLOR = "#64748b";

/**
 * Accepts `#rgb` and `#rrggbb` only. Anything else falls back rather than
 * being written, so a malformed value can never reach a CSS colour.
 */
export function normalizeColor(raw: string | undefined | null): string {
  if (typeof raw !== "string") return FALLBACK_LABEL_COLOR;
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return FALLBACK_LABEL_COLOR;
}

/**
 * Seeds a newly created board's category vocabulary.
 *
 * A board inside an existing project inherits **that project's own** labels
 * first, so an 迭代's cards can be categorised the same way its product list
 * is. Only a project's first board falls back to the system presets — which
 * are written for software work and mean nothing to, say, a 迎评 project.
 * With no system presets configured at all, the built-in `DEFAULT_LABELS` are
 * used, so a board is never created with an empty 类别 list.
 */
export async function seedDefaultLabels(
  ctx: MutationCtx,
  board: { _id: Id<"boards">; projectId: Id<"projects">; kind: "backlog" | "sprint" },
  userId: Id<"users">,
): Promise<void> {
  const siblings = await ctx.db
    .query("labels")
    .withIndex("by_board", (q) =>
      q.eq("boardId", board._id),
    )
    .collect();
  if (siblings.length > 0) return; // already seeded

  // Any other board in this project carries the vocabulary to copy.
  const projectBoards = await ctx.db
    .query("boards")
    .withIndex("by_project", (q) => q.eq("projectId", board.projectId))
    .collect();
  const sourceBoardId = projectBoards.find((b) => b._id !== board._id)?._id;

  const fromProject = sourceBoardId !== undefined;
  const presets: { name: string; color: string; position: number }[] = fromProject
    ? (
        await ctx.db
          .query("labels")
          .withIndex("by_board_position", (q) => q.eq("boardId", sourceBoardId))
          .collect()
      ).map((l) => ({ name: l.name, color: l.color, position: l.position }))
    : (
        await ctx.db
          .query("labels")
          .withIndex("by_scope_kind_position", (q) =>
            q.eq("scope", "system").eq("kind", board.kind),
          )
          .collect()
      ).map((l) => ({ name: l.name, color: l.color, position: l.position }));

  // No administrator presets configured (a fresh deployment, or an admin who
  // deleted them all) would otherwise leave the new board with an empty 类别
  // list while the new-board dialog still previews DEFAULT_LABELS. Falling back
  // here is what makes that preview honest.
  const chosen =
    presets.length > 0
      ? presets
      : DEFAULT_LABELS[board.kind].map((l, index) => ({ ...l, position: index }));

  const now = Date.now();
  for (const preset of chosen) {
    await ctx.db.insert("labels", {
      scope: "project",
      boardId: board._id,
      projectId: board.projectId,
      name: preset.name,
      color: preset.color,
      position: preset.position,
      createdBy: userId,
      createdAt: now,
    });
  }
}

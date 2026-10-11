import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireBoardMember, requireLabelEditor, requireProjectOwner, requireUser } from "./lib/auth";
import { normalizeColor } from "./lib/labelPresets";

const labelValidator = v.object({
  _id: v.id("labels"),
  // Absent on system presets, which live without a board.
  boardId: v.optional(v.id("boards")),
  name: v.string(),
  color: v.string(),
  position: v.number(),
  usageCount: v.number(),
});

export const listLabels = query({
  args: { token: v.optional(v.string()), boardId: v.id("boards") },
  returns: v.array(labelValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireBoardMember(ctx, args.boardId, user._id);

    const labels = await ctx.db
      .query("labels")
      .withIndex("by_board_position", (q) => q.eq("boardId", args.boardId))
      .collect();

    const [goals, tasks] = await Promise.all([
      ctx.db
        .query("goals")
        .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_board", (q) => q.eq("boardId", args.boardId))
        .collect(),
    ]);
    // Cards point at the label, so usage is a straight reference count.
    const counts = new Map<string, number>();
    for (const row of [...goals, ...tasks]) {
      if (!row.labelId) continue;
      const key = row.labelId as string;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return labels
      .sort((a, b) => a.position - b.position)
      .map((label) => ({
        _id: label._id,
        boardId: label.boardId,
        name: label.name,
        color: label.color,
        position: label.position,
        usageCount: counts.get(label._id as string) ?? 0,
      }));
  },
});

export const createLabel = mutation({
  args: {
    token: v.optional(v.string()),
    boardId: v.id("boards"),
    name: v.string(),
    color: v.optional(v.string()),
  },
  returns: v.id("labels"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const board = await requireProjectOwner(ctx, args.boardId, user._id);

    const name = args.name.trim();
    if (name.length < 1 || name.length > 20) throw new Error("INVALID_LABEL_NAME");

    const existing = await ctx.db
      .query("labels")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();
    if (existing.some((l) => l.name === name)) throw new Error("LABEL_ALREADY_EXISTS");

    return await ctx.db.insert("labels", {
      scope: "project",
      boardId: board._id,
      projectId: board.projectId,
      name,
      color: normalizeColor(args.color ?? ""),
      position: existing.length,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const updateLabel = mutation({
  args: {
    token: v.optional(v.string()),
    labelId: v.id("labels"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Authenticate first so a system preset (no board) still resolves a user,
    // then hand the real label to the editor check.
    await requireUser(ctx, args.token);
    const label = await ctx.db.get(args.labelId);
    if (!label) throw new Error("LABEL_NOT_FOUND");
    await requireLabelEditor(ctx, args.token, label);

    const patch: { name?: string; color?: string } = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 1 || name.length > 20) throw new Error("INVALID_LABEL_NAME");
      const siblings = await ctx.db
        .query("labels")
        .withIndex("by_board", (q) => q.eq("boardId", label.boardId))
        .collect();
      if (siblings.some((l) => l._id !== label._id && l.name === name)) {
        throw new Error("LABEL_ALREADY_EXISTS");
      }
      patch.name = name;
    }
    if (args.color !== undefined) patch.color = normalizeColor(args.color);

    if (Object.keys(patch).length > 0) await ctx.db.patch(label._id, patch);
    return null;
  },
});

/**
 * Removes a category from the board's vocabulary.
 *
 * Cards hold a reference, so a category still in use cannot be deleted —
 * reassign those cards first, or just rename/recolour the category. Only the
 * last remaining category is protected: an empty vocabulary leaves nothing to
 * pick from.
 */
export const deleteLabel = mutation({
  args: { token: v.optional(v.string()), labelId: v.id("labels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const label = await ctx.db.get(args.labelId);
    if (!label) throw new Error("LABEL_NOT_FOUND");
    await requireLabelEditor(ctx, args.token, label);

    const siblings = await ctx.db
      .query("labels")
      .withIndex("by_board", (q) => q.eq("boardId", label.boardId))
      .collect();
    if (siblings.length <= 1) throw new Error("CANNOT_DELETE_LAST_LABEL");

    const [usedByGoals, usedByTasks] = await Promise.all([
      ctx.db
        .query("goals")
        .withIndex("by_label", (q) => q.eq("labelId", label._id))
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_label", (q) => q.eq("labelId", label._id))
        .collect(),
    ]);
    if (usedByGoals.length + usedByTasks.length > 0) throw new Error("LABEL_IN_USE");

    await ctx.db.delete(label._id);

    const remaining = siblings
      .filter((l) => l._id !== label._id)
      .sort((a, b) => a.position - b.position);
    for (let i = 0; i < remaining.length; i++) {
      await ctx.db.patch(remaining[i]!._id, { position: i });
    }
    return null;
  },
});

export const moveLabel = mutation({
  args: {
    token: v.optional(v.string()),
    labelId: v.id("labels"),
    toIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireUser(ctx, args.token);
    const label = await ctx.db.get(args.labelId);
    if (!label) throw new Error("LABEL_NOT_FOUND");
    await requireLabelEditor(ctx, args.token, label);

    const labels = await ctx.db
      .query("labels")
      .withIndex("by_board_position", (q) => q.eq("boardId", label.boardId))
      .collect();
    const ids = labels.sort((a, b) => a.position - b.position).map((l) => l._id);
    const from = ids.indexOf(label._id);
    if (from === -1) return null;

    ids.splice(from, 1);
    const clamped = Math.max(0, Math.min(Math.floor(args.toIndex), ids.length));
    ids.splice(clamped, 0, label._id);

    for (let i = 0; i < ids.length; i++) await ctx.db.patch(ids[i]!, { position: i });
    return null;
  },
});

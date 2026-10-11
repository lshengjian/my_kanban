import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { normalizeColor } from "./lib/labelPresets";

/**
 * 系统预设 — the organisation-wide card categories.
 *
 * They live in the same `labels` table as a project's own categories, marked
 * `scope: "system"`. Creating a board *copies* them into the project, so an
 * admin editing a preset never rewrites anyone's existing cards.
 */

const templateValidator = v.object({
  _id: v.id("labels"),
  kind: v.union(v.literal("backlog"), v.literal("sprint")),
  name: v.string(),
  color: v.string(),
  position: v.number(),
});

/** All kinds at once — one call powers the admin preset editor. */
export const listTemplates = query({
  args: { token: v.optional(v.string()) },
  returns: v.object({
    backlog: v.array(templateValidator),
    sprint: v.array(templateValidator),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("labels")
      .withIndex("by_scope_kind", (q) => q.eq("scope", "system"))
      .collect();

    const pick = (kind: "backlog" | "sprint") =>
      rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.position - b.position)
        .map((r) => ({
          _id: r._id,
          kind,
          name: r.name,
          color: r.color,
          position: r.position,
        }));

    return { backlog: pick("backlog"), sprint: pick("sprint") };
  },
});

export const createTemplate = mutation({
  args: {
    token: v.optional(v.string()),
    kind: v.union(v.literal("backlog"), v.literal("sprint")),
    name: v.string(),
    color: v.optional(v.string()),
  },
  returns: v.id("labels"),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx, args.token);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 24) throw new Error("INVALID_NAME");

    const siblings = await ctx.db
      .query("labels")
      .withIndex("by_scope_kind", (q) => q.eq("scope", "system").eq("kind", args.kind))
      .collect();

    return await ctx.db.insert("labels", {
      scope: "system",
      kind: args.kind,
      name,
      color: normalizeColor(args.color),
      position: siblings.length,
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const updateTemplate = mutation({
  args: {
    token: v.optional(v.string()),
    id: v.id("labels"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.id);
    if (!row || row.scope !== "system") throw new Error("TEMPLATE_NOT_FOUND");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 1 || name.length > 24) throw new Error("INVALID_NAME");
      patch.name = name;
    }
    if (args.color !== undefined) patch.color = normalizeColor(args.color);

    if (Object.keys(patch).length > 0) await ctx.db.patch(row._id, patch);
    return null;
  },
});

export const deleteTemplate = mutation({
  args: { token: v.optional(v.string()), id: v.id("labels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const row = await ctx.db.get(args.id);
    if (!row || row.scope !== "system") throw new Error("TEMPLATE_NOT_FOUND");

    const siblings = await ctx.db
      .query("labels")
      .withIndex("by_scope_kind", (q) =>
        q.eq("scope", "system").eq("kind", row.kind ?? "backlog"),
      )
      .collect();
    if (siblings.length <= 1) throw new Error("CANNOT_DELETE_LAST_LABEL");

    await ctx.db.delete(row._id);

    const remaining = siblings
      .filter((l) => l._id !== row._id)
      .sort((a, b) => a.position - b.position);
    for (let i = 0; i < remaining.length; i++) {
      await ctx.db.patch(remaining[i]!._id, { position: i });
    }
    return null;
  },
});
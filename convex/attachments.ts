import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity } from "./lib/activity";
import { isProjectMember, requireBoardMember, requireUser } from "./lib/auth";

/* ------------------------------------------------------------------ *
 * 检查列表 — acceptance criteria on a 目标项
 * ------------------------------------------------------------------ */

const MAX_TEXT = 300;

const checkValidator = v.object({
  _id: v.id("checklistItems"),
  goalId: v.id("goals"),
  text: v.string(),
  done: v.boolean(),
  assigneeId: v.optional(v.id("users")),
  checkDate: v.optional(v.number()),
  position: v.number(),
  createdAt: v.number(),
});

export const listChecks = query({
  args: { token: v.optional(v.string()), goalId: v.id("goals") },
  returns: v.object({
    items: v.array(checkValidator),
    done: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const items = await ctx.db
      .query("checklistItems")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect();
    const ordered = items.sort((a, b) => a.position - b.position);
    return {
      items: ordered.map((i) => ({
        _id: i._id,
        goalId: i.goalId,
        text: i.text,
        done: i.done,
        assigneeId: i.assigneeId,
        checkDate: i.checkDate,
        position: i.position,
        createdAt: i.createdAt,
      })),
      done: ordered.filter((i) => i.done).length,
      total: ordered.length,
    };
  },
});

export const addCheck = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    text: v.string(),
    assigneeId: v.optional(v.id("users")),
    checkDate: v.optional(v.number()),
  },
  returns: v.id("checklistItems"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const text = args.text.trim();
    if (text.length < 1 || text.length > MAX_TEXT) throw new Error("INVALID_TEXT");

    if (args.assigneeId !== undefined) {
      if (!(await isProjectMember(ctx, goal.projectId, args.assigneeId))) {
        throw new Error("ASSIGNEE_NOT_A_MEMBER");
      }
    }

    const existing = await ctx.db
      .query("checklistItems")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect();

    const id = await ctx.db.insert("checklistItems", {
      projectId: goal.projectId,
      goalId: goal._id,
      text,
      done: false,
      assigneeId: args.assigneeId,
      checkDate: args.checkDate,
      position: existing.length,
      createdBy: user._id,
      createdAt: Date.now(),
    });

    await logActivity(ctx, {
      projectId: goal.projectId,
      boardId: goal.boardId,
      goalId: goal._id,
      actorId: user._id,
      type: "check_added",
      message: `为「${goal.title}」新增检查项「${text}」`,
    });
    return id;
  },
});

export const toggleCheck = mutation({
  args: { token: v.optional(v.string()), checkId: v.id("checklistItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const check = await ctx.db.get(args.checkId);
    if (!check) throw new Error("CHECK_NOT_FOUND");
    const goal = await ctx.db.get(check.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    await ctx.db.patch(check._id, { done: !check.done });
    return null;
  },
});

export const updateCheck = mutation({
  args: {
    token: v.optional(v.string()),
    checkId: v.id("checklistItems"),
    text: v.optional(v.string()),
    assigneeId: v.optional(v.union(v.id("users"), v.null())),
    checkDate: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const check = await ctx.db.get(args.checkId);
    if (!check) throw new Error("CHECK_NOT_FOUND");
    const goal = await ctx.db.get(check.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const patch: Record<string, unknown> = {};
    if (args.text !== undefined) {
      const text = args.text.trim();
      if (text.length < 1 || text.length > MAX_TEXT) throw new Error("INVALID_TEXT");
      patch.text = text;
    }
    if (args.assigneeId !== undefined) {
      if (args.assigneeId !== null) {
        if (!(await isProjectMember(ctx, goal.projectId, args.assigneeId))) {
          throw new Error("ASSIGNEE_NOT_A_MEMBER");
        }
        patch.assigneeId = args.assigneeId;
      } else {
        patch.assigneeId = undefined;
      }
    }
    if (args.checkDate !== undefined) {
      patch.checkDate = args.checkDate === null ? undefined : args.checkDate;
    }

    if (Object.keys(patch).length > 0) await ctx.db.patch(check._id, patch);
    return null;
  },
});

export const deleteCheck = mutation({
  args: { token: v.optional(v.string()), checkId: v.id("checklistItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const check = await ctx.db.get(args.checkId);
    if (!check) throw new Error("CHECK_NOT_FOUND");
    const goal = await ctx.db.get(check.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    await ctx.db.delete(check._id);
    const rest = (
      await ctx.db
        .query("checklistItems")
        .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
        .collect()
    )
      .filter((c) => c._id !== check._id)
      .sort((a, b) => a.position - b.position);
    for (let i = 0; i < rest.length; i++) {
      await ctx.db.patch(rest[i]!._id, { position: i });
    }
    return null;
  },
});

/* ------------------------------------------------------------------ *
 * 附件 — inline schematics, downloadable documents
 * ------------------------------------------------------------------ */

/** Only real raster/vector images are rendered inline. */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
]);

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

const attachmentValidator = v.object({
  _id: v.id("attachments"),
  name: v.string(),
  contentType: v.string(),
  size: v.number(),
  isImage: v.boolean(),
  createdAt: v.number(),
  /** Present only for images, so the card can render them straight away. */
  url: v.optional(v.string()),
});

function safeName(raw: string): string {
  const name = raw.split(/[\\/]/).pop()?.trim() || "附件";
  return name.length > 120 ? name.slice(0, 120) : name;
}

/**
 * Hands out a one-time upload URL. The client PUTs the bytes to it, then calls
 * `createAttachment` with the returned storageId.
 */
export const generateUploadUrl = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.object({ uploadUrl: v.string(), name: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    if (!Number.isFinite(args.size) || args.size <= 0) throw new Error("INVALID_SIZE");
    if (args.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
    if (!args.contentType || args.contentType.length > 120) throw new Error("INVALID_TYPE");

    // The client POSTs the bytes to this URL; the response body carries the
    // new Id<"_storage">, which it then hands to `createAttachment`.
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl, name: safeName(args.name) };
  },
});

/** Records a completed upload. Rejects anything the server did not authorise. */
export const createAttachment = mutation({
  args: {
    token: v.optional(v.string()),
    goalId: v.id("goals"),
    storageId: v.id("_storage"),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.id("attachments"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    if (args.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");

    const name = safeName(args.name);
    const id = await ctx.db.insert("attachments", {
      projectId: goal.projectId,
      goalId: goal._id,
      storageId: args.storageId,
      name,
      contentType: args.contentType,
      size: args.size,
      isImage: IMAGE_TYPES.has(args.contentType),
      uploadedBy: user._id,
      createdAt: Date.now(),
    });

    await logActivity(ctx, {
      projectId: goal.projectId,
      boardId: goal.boardId,
      goalId: goal._id,
      actorId: user._id,
      type: "attachment_added",
      message: `为「${goal.title}」上传附件「${name}」`,
    });
    return id;
  },
});

/**
 * A goal's attachments. Images come back with a renderable URL so the card can
 * show the schematic; documents come back as metadata and are fetched on click.
 */
export const listAttachments = query({
  args: { token: v.optional(v.string()), goalId: v.id("goals") },
  returns: v.array(attachmentValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const goal = await ctx.db.get(args.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const rows = await ctx.db
      .query("attachments")
      .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
      .collect();
    rows.sort((a, b) => a.createdAt - b.createdAt);

    const out = [];
    for (const row of rows) {
      out.push({
        _id: row._id,
        name: row.name,
        contentType: row.contentType,
        size: row.size,
        isImage: row.isImage,
        createdAt: row.createdAt,
        url: row.isImage ? ((await ctx.storage.getUrl(row.storageId)) ?? undefined) : undefined,
      });
    }
    return out;
  },
});

/** One-shot signed URL for downloading a non-image attachment. */
export const getAttachmentUrl = query({
  args: { token: v.optional(v.string()), attachmentId: v.id("attachments") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const row = await ctx.db.get(args.attachmentId);
    if (!row) throw new Error("ATTACHMENT_NOT_FOUND");
    const goal = await ctx.db.get(row.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    const url = await ctx.storage.getUrl(row.storageId);
    if (!url) throw new Error("FILE_MISSING");
    return url;
  },
});

export const deleteAttachment = mutation({
  args: { token: v.optional(v.string()), attachmentId: v.id("attachments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const row = await ctx.db.get(args.attachmentId);
    if (!row) throw new Error("ATTACHMENT_NOT_FOUND");
    const goal = await ctx.db.get(row.goalId);
    if (!goal) throw new Error("GOAL_NOT_FOUND");
    await requireBoardMember(ctx, goal.boardId, user._id);

    await ctx.db.delete(row._id);
    // Storage is not transactional; a failure here only orphans a blob.
    try {
      await ctx.storage.delete(row.storageId);
    } catch {
      // ignore
    }
    return null;
  },
});

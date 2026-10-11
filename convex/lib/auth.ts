import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { randomToken } from "./password";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type Ctx = QueryCtx | MutationCtx;

export type PublicUser = {
  _id: Id<"users">;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "active" | "suspended";
  createdAt: number;
  lastLoginAt?: number;
};

/** Never let `passwordHash` cross the wire. */
export function publicUser(user: Doc<"users">): PublicUser {
  return {
    _id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export const publicUserValidator = v.object({
  _id: v.id("users"),
  email: v.string(),
  name: v.string(),
  role: v.union(v.literal("admin"), v.literal("member")),
  status: v.union(v.literal("active"), v.literal("suspended")),
  createdAt: v.number(),
  lastLoginAt: v.optional(v.number()),
});

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolves the bearer session token to a user, or null if absent/expired. */
export async function getUserByToken(
  ctx: Ctx,
  token: string | null | undefined,
): Promise<Doc<"users"> | null> {
  if (!token) return null;

  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    // Expired rows are cleaned up opportunistically on the write path; reads
    // simply treat them as absent.
    return null;
  }

  return await ctx.db.get(session.userId);
}

/** Identity for reads and writes; throws when the session is missing. */
export async function requireUser(
  ctx: Ctx,
  token: string | null | undefined,
): Promise<Doc<"users">> {
  const user = await getUserByToken(ctx, token);
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  if (user.status === "suspended") {
    throw new Error("SUSPENDED");
  }
  return user;
}

export async function requireAdmin(
  ctx: Ctx,
  token: string | null | undefined,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx, token);
  if (user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return user;
}

export async function createSession(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await ctx.db.insert("sessions", {
    token,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

export async function isProjectMember(
  ctx: Ctx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<boolean> {
  const row = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) =>
      q.eq("projectId", projectId).eq("userId", userId),
    )
    .first();
  return row !== null;
}

export type ProjectAccess = {
  project: Doc<"projects">;
  membership: Doc<"projectMembers">;
};

/**
 * Project-scoped authorization. Global admins are read-only guests here: they
 * may inspect any project, but membership is what grants write access, so an
 * admin cannot silently mutate someone else's board.
 */
export async function requireProjectMember(
  ctx: Ctx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<ProjectAccess> {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  const membership = await ctx.db
    .query("projectMembers")
    .withIndex("by_project_user", (q) =>
      q.eq("projectId", projectId).eq("userId", userId),
    )
    .first();
  if (!membership) throw new Error("NOT_A_PROJECT_MEMBER");

  return { project, membership };
}

export async function requireBoardMember(
  ctx: Ctx,
  boardId: Id<"boards">,
  userId: Id<"users">,
): Promise<{ board: Doc<"boards">; membership: Doc<"projectMembers"> }> {
  const board = await ctx.db.get(boardId);
  if (!board) throw new Error("BOARD_NOT_FOUND");
  const { membership } = await requireProjectMember(ctx, board.projectId, userId);
  return { board, membership };
}

/**
 * Owner-only guard keyed by a board. Used where the caller already holds a
 * board (the label vocabulary, the board settings dialog).
 */
export async function requireProjectOwner(
  ctx: Ctx,
  boardId: Id<"boards">,
  userId: Id<"users">,
): Promise<Doc<"boards">> {
  const board = await ctx.db.get(boardId);
  if (!board) throw new Error("BOARD_NOT_FOUND");
  await requireProjectOwnerOf(ctx, board.projectId, userId);
  return board;
}

/**
 * Owner-only guard keyed by the project.
 *
 * Creating a board and adding a goal to the product list are the owner's call:
 * members run the sprints they are given. Everything else in a project is open
 * to any member.
 */
export async function requireProjectOwnerOf(
  ctx: Ctx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<void> {
  const { membership } = await requireProjectMember(ctx, projectId, userId);
  if (membership.role !== "owner") throw new Error("PROJECT_OWNER_ONLY");
}

/**
 * Asserts the user created the project that owns this label.
 *
 * System presets (`scope: "system"`) carry no board and are curated by site
 * admins instead, so they are routed to `requireAdmin`.
 */
export async function requireLabelEditor(
  ctx: Ctx,
  token: string | null | undefined,
  label: { scope: "system" | "project"; boardId?: Id<"boards"> },
): Promise<void> {
  if (label.scope === "system" || label.boardId === undefined) {
    await requireAdmin(ctx, token);
    return;
  }
  const user = await requireUser(ctx, token);
  const board = await ctx.db.get(label.boardId);
  if (!board) throw new Error("BOARD_NOT_FOUND");
  const { membership } = await requireProjectMember(ctx, board.projectId, user._id);
  if (membership.role !== "owner") throw new Error("PROJECT_OWNER_ONLY");
}

/** Loads a board column and asserts it belongs to the expected board. */
export async function requireColumnOfBoard(
  ctx: Ctx,
  columnId: Id<"columns">,
  boardId: Id<"boards">,
): Promise<Doc<"columns">> {
  const column = await ctx.db.get(columnId);
  if (!column || column.boardId !== boardId) {
    throw new Error("COLUMN_NOT_FOUND");
  }
  return column;
}

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logActivity } from "./lib/activity";
import {
  isProjectMember,
  normalizeEmail,
  publicUser,
  publicUserValidator,
  requireAdmin,
  requireProjectMember,
  requireUser,
} from "./lib/auth";
import { randomToken } from "./lib/password";
import { createBoardRecord } from "./boards";
import { DEFAULT_SPRINT_DAYS } from "./lib/constants";

const projectValidator = v.object({
  _id: v.id("projects"),
  name: v.string(),
  key: v.string(),
  description: v.string(),
  ownerId: v.id("users"),
  sprintLengthDays: v.number(),
  createdAt: v.number(),
  archived: v.boolean(),
  role: v.string(),
  boards: v.number(),
  members: v.number(),
  completedGoals: v.number(),
  totalGoals: v.number(),
});

const memberValidator = v.object({
  user: publicUserValidator,
  role: v.union(v.literal("owner"), v.literal("member")),
  joinedAt: v.number(),
});

const joinRequestValidator = v.object({
  _id: v.id("joinRequests"),
  projectId: v.id("projects"),
  projectName: v.string(),
  user: publicUserValidator,
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
  ),
  message: v.string(),
  createdAt: v.number(),
  decidedAt: v.optional(v.number()),
});

/** 6-character invite code, retried on the (astronomically rare) collision. */
async function generateProjectKey(ctx: MutationCtx): Promise<string> {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = randomToken(6);
    let key = "";
    for (let i = 0; i < 6; i++) {
      key += alphabet[parseInt(bytes[i]!, 16) % alphabet.length]!;
    }
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!clash) return key;
  }
  throw new Error("KEY_GENERATION_FAILED");
}

/**
 * Total vs. completed item counts for a project. "Completed" is derived from
 * the board's columns rather than a stored flag, so it stays correct even after
 * a user toggles a column's done flag.
 */
async function countCompleted(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
): Promise<number> {
  const boards = await ctx.db
    .query("boards")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  if (boards.length === 0) return 0;

  const goals = await ctx.db
    .query("goals")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  if (goals.length === 0) return 0;

  const doneColumnIds = new Set<string>();
  for (const board of boards) {
    const columns = await ctx.db
      .query("columns")
      .withIndex("by_board", (q) => q.eq("boardId", board._id))
      .collect();
    for (const column of columns) {
      if (column.isDone) doneColumnIds.add(column._id as string);
    }
  }

  return goals.filter((goal) => doneColumnIds.has(goal.columnId as string)).length;
}


const nowMs = () => Date.now();

export const createProject = mutation({
  args: {
    token: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id("projects"),
    key: v.string(),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const name = args.name.trim();
    if (name.length < 1 || name.length > 80) throw new Error("INVALID_NAME");

    const key = await generateProjectKey(ctx);
    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      name,
      key,
      description: (args.description ?? "").trim(),
      ownerId: user._id,
      sprintLengthDays: DEFAULT_SPRINT_DAYS,
      createdAt: now,
      archived: false,
    });

    await ctx.db.insert("projectMembers", {
      projectId,
      userId: user._id,
      role: "owner",
      addedBy: user._id,
      createdAt: now,
    });

    // Every project starts with exactly one 预期成果看板, so the sprint
    // invariant (one backlog per project) holds by construction.
    await createBoardRecord(ctx, {
      projectId,
      userId: user._id,
      kind: "backlog",
    });

    return { projectId, key };
  },
});

/** Builds one row of the project list. */
async function projectSummary(
  ctx: QueryCtx,
  project: Doc<"projects">,
  role: "owner" | "member",
) {
  const [boards, memberCount, goals] = await Promise.all([
    ctx.db
      .query("boards")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
    ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
    ctx.db
      .query("goals")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .collect(),
  ]);

  return {
    _id: project._id,
    name: project.name,
    key: project.key,
    description: project.description,
    ownerId: project.ownerId,
    sprintLengthDays: project.sprintLengthDays ?? DEFAULT_SPRINT_DAYS,
    createdAt: project.createdAt,
    archived: project.archived,
    role,
    boards: boards.filter((b) => !b.archived).length,
    members: memberCount.length,
    completedGoals: await countCompleted(ctx, project._id),
    totalGoals: goals.length,
  };
}

/** Clamps the page window so a client cannot ask for an unbounded slice. */
function pageWindow(limit: number | undefined, offset: number | undefined) {
  const size = Math.min(Math.max(limit ?? 10, 1), 50);
  const skip = Math.max(offset ?? 0, 0);
  return { size, skip };
}

const pagedProjectsValidator = v.object({
  items: v.array(projectValidator),
  total: v.number(),
  hasMore: v.boolean(),
});

/**
 * Projects the signed-in user belongs to.
 *
 * Regular users see only these — never a browsable list of the whole system.
 * Pending invitations arrive separately through `myInvitations`.
 */
export const listMyProjects = query({
  args: {
    token: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: pagedProjectsValidator,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);

    const memberships = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const results = [];
    for (const membership of memberships) {
      const project = await ctx.db.get(membership.projectId);
      if (!project || project.archived) continue;
      results.push(await projectSummary(ctx, project, membership.role));
    }
    results.sort((a, b) => b.createdAt - a.createdAt);

    const { size, skip } = pageWindow(args.limit, args.offset);
    return {
      items: results.slice(skip, skip + size),
      total: results.length,
      hasMore: skip + size < results.length,
    };
  },
});

/**
 * Every project in the deployment — **admin only**.
 *
 * This is the browsable/organise view; a regular member must not be able to
 * enumerate other people's projects.
 */
export const listAllProjects = query({
  args: {
    token: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  returns: pagedProjectsValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const projects = (await ctx.db.query("projects").collect()).filter((p) => !p.archived);
    projects.sort((a, b) => b.createdAt - a.createdAt);

    const memberships = new Map<string, "owner" | "member">();
    for (const m of await ctx.db.query("projectMembers").collect()) {
      memberships.set(m.userId as string, m.role);
    }

    const { size, skip } = pageWindow(args.limit, args.offset);
    const page = projects.slice(skip, skip + size);
    const items = [];
    for (const project of page) {
      const role = memberships.get(project.ownerId as string) ?? "member";
      items.push(await projectSummary(ctx, project, role));
    }

    return {
      items,
      total: projects.length,
      hasMore: skip + size < projects.length,
    };
  },
});

/**
 * Projects that have invited this user and are waiting for a decision.
 *
 * A regular user's only route into a project they do not yet belong to.
 */
export const myInvitations = query({
  args: { token: v.optional(v.string()) },
  returns: v.array(
    v.object({
      requestId: v.id("joinRequests"),
      projectId: v.id("projects"),
      name: v.string(),
      key: v.string(),
      description: v.string(),
      message: v.string(),
      createdAt: v.number(),
      inviterName: v.string(),
      /** True when this is my own join request rather than an invite. */
      mine: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);

    const requests = await ctx.db
      .query("joinRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .collect();

    const out = [];
    for (const request of requests) {
      const project = await ctx.db.get(request.projectId);
      if (!project || project.archived) continue;
      // Skip anything already handled by a membership row.
      if (
        await ctx.db
          .query("projectMembers")
          .withIndex("by_project_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id),
          )
          .first()
      ) {
        continue;
      }
      const inviter = await ctx.db.get(request.createdBy);
      out.push({
        requestId: request._id,
        projectId: project._id,
        name: project.name,
        key: project.key,
        description: project.description,
        message: request.message,
        createdAt: request.createdAt,
        inviterName: inviter?.name ?? "未知",
        mine: request.createdBy === user._id,
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getProject = query({
  args: { token: v.optional(v.string()), projectId: v.id("projects") },
  returns: v.object({
    project: projectValidator,
    members: v.array(memberValidator),
    pendingRequests: v.array(joinRequestValidator),
  }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { project, membership } = await requireProjectMember(
      ctx,
      args.projectId,
      user._id,
    );

    const [memberRows, boards, goals, requests] = await Promise.all([
      ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("boards")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("goals")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("joinRequests")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", "pending"),
        )
        .collect(),
    ]);

    const members = [];
    for (const row of memberRows) {
      const memberUser = await ctx.db.get(row.userId);
      if (!memberUser) continue;
      members.push({
        user: publicUser(memberUser),
        role: row.role,
        joinedAt: row.createdAt,
      });
    }
    members.sort((a, b) =>
      a.role === b.role ? a.joinedAt - b.joinedAt : a.role === "owner" ? -1 : 1,
    );

    const pendingRequests = [];
    for (const request of requests) {
      const requester = await ctx.db.get(request.userId);
      if (!requester) continue;
      pendingRequests.push({
        _id: request._id,
        projectId: request.projectId,
        projectName: project.name,
        user: publicUser(requester),
        status: request.status,
        message: request.message,
        createdAt: request.createdAt,
        decidedAt: request.decidedAt,
      });
    }

    return {
      project: {
        _id: project._id,
        name: project.name,
        key: project.key,
        description: project.description,
        ownerId: project.ownerId,
        sprintLengthDays: project.sprintLengthDays ?? DEFAULT_SPRINT_DAYS,
        createdAt: project.createdAt,
        archived: project.archived,
        role: membership.role,
        boards: boards.filter((b) => !b.archived).length,
        members: memberRows.length,
        completedGoals: await countCompleted(ctx, args.projectId),
        totalGoals: goals.length,
      },
      members,
      pendingRequests,
    };
  },
});

/**
 * @deprecated Replaced by `listAllProjects`, which is admin-only and paged.
 * Kept as an alias so an older client keeps working, with the same admin gate.
 */
export const discoverProjects = query({
  args: { token: v.optional(v.string()) },
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      name: v.string(),
      key: v.string(),
      description: v.string(),
      createdAt: v.number(),
      members: v.number(),
      isMember: v.boolean(),
      hasPendingRequest: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    // Enumerating every project is an administrator capability: a regular
    // member must only ever see projects they were invited to.
    await requireAdmin(ctx, args.token);
    const user = await requireUser(ctx, args.token);
    const projects = await ctx.db.query("projects").collect();

    const visible = [];
    for (const project of projects) {
      if (project.archived) continue;

      const [memberRows, pending] = await Promise.all([
        ctx.db
          .query("projectMembers")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .collect(),
        ctx.db
          .query("joinRequests")
          .withIndex("by_project_user", (q) =>
            q.eq("projectId", project._id).eq("userId", user._id),
          )
          .first(),
      ]);

      visible.push({
        _id: project._id,
        name: project.name,
        key: project.key,
        description: project.description,
        createdAt: project.createdAt,
        members: memberRows.length,
        isMember: memberRows.some((m) => m.userId === user._id),
        hasPendingRequest: pending?.status === "pending",
      });
    }

    return visible.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const requestToJoin = mutation({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    message: v.optional(v.string()),
  },
  returns: v.id("joinRequests"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.archived) throw new Error("PROJECT_NOT_FOUND");

    if (await isProjectMember(ctx, args.projectId, user._id)) {
      throw new Error("ALREADY_A_MEMBER");
    }

    const existing = await ctx.db
      .query("joinRequests")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", user._id),
      )
      .first();

    const message = (args.message ?? "").trim();
    if (existing?.status === "pending") {
      throw new Error("REQUEST_ALREADY_PENDING");
    }

    const now = Date.now();
    if (existing) {
      // Re-open a previously rejected request instead of duplicating history.
      await ctx.db.patch(existing._id, {
        status: "pending",
        message,
        createdBy: user._id,
        createdAt: now,
        decidedAt: undefined,
        decidedBy: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("joinRequests", {
      projectId: args.projectId,
      userId: user._id,
      status: "pending",
      message,
      createdBy: user._id,
      createdAt: now,
    });
  },
});

export const inviteUser = mutation({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    email: v.string(),
    message: v.optional(v.string()),
  },
  returns: v.id("joinRequests"),
  handler: async (ctx, args) => {
    const inviter = await requireUser(ctx, args.token);
    const { project } = await requireProjectMember(ctx, args.projectId, inviter._id);

    const email = normalizeEmail(args.email);
    const invitee = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!invitee) throw new Error("USER_NOT_FOUND");
    if (invitee.status === "suspended") throw new Error("ACCOUNT_SUSPENDED");
    if (await isProjectMember(ctx, args.projectId, invitee._id)) {
      throw new Error("ALREADY_A_MEMBER");
    }

    const existing = await ctx.db
      .query("joinRequests")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", invitee._id),
      )
      .first();

    const now = Date.now();
    const message = (args.message ?? "").trim() || `邀请你加入项目「${project.name}」`;

    if (existing?.status === "pending") return existing._id;

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "pending",
        message,
        createdBy: inviter._id,
        createdAt: now,
        decidedAt: undefined,
        decidedBy: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("joinRequests", {
      projectId: args.projectId,
      userId: invitee._id,
      status: "pending",
      message,
      createdBy: inviter._id,
      createdAt: now,
    });
  },
});

/**
 * Joins by invite code without needing to enumerate projects.
 *
 * The code is the only thing a regular member is given, and the lookup happens
 * server-side — a member can never turn this into a way to browse projects.
 * Creates a pending request for the project's owner to approve.
 */
export const requestToJoinByKey = mutation({
  args: { token: v.optional(v.string()), key: v.string() },
  returns: v.id("joinRequests"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const code = args.key.trim().toUpperCase();
    if (code.length !== 6) throw new Error("INVALID_INVITE_CODE");

    const project = await ctx.db
      .query("projects")
      .withIndex("by_key", (q) => q.eq("key", code))
      .unique();
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.archived) throw new Error("PROJECT_ARCHIVED");
    if (await isProjectMember(ctx, project._id, user._id)) {
      throw new Error("ALREADY_A_MEMBER");
    }

    const existing = await ctx.db
      .query("joinRequests")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", project._id).eq("userId", user._id),
      )
      .first();
    if (existing) {
      if (existing.status === "pending") throw new Error("REQUEST_ALREADY_PENDING");
      throw new Error("ALREADY_REQUESTED");
    }

    const id = await ctx.db.insert("joinRequests", {
      projectId: project._id,
      userId: user._id,
      status: "pending",
      message: "通过邀请码加入",
      createdBy: user._id,
      createdAt: nowMs(),
    });
    await logActivity(ctx, {
      projectId: project._id,
      actorId: user._id,
      type: "member_joined",
      message: `${user.name} 用邀请码申请加入`,
    });
    return id;
  },
});

export const decideJoinRequest = mutation({
  args: {
    token: v.optional(v.string()),
    requestId: v.id("joinRequests"),
    approve: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.status !== "pending") throw new Error("REQUEST_ALREADY_DECIDED");

    await requireProjectMember(ctx, request.projectId, user._id);

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.approve ? "approved" : "rejected",
      decidedBy: user._id,
      decidedAt: now,
    });

    if (args.approve && !(await isProjectMember(ctx, request.projectId, request.userId))) {
      await ctx.db.insert("projectMembers", {
        projectId: request.projectId,
        userId: request.userId,
        role: "member",
        addedBy: user._id,
        createdAt: now,
      });
      await logActivity(ctx, {
        projectId: request.projectId,
        actorId: user._id,
        type: "member_joined",
        message: "新成员加入项目",
      });
    }

    return null;
  },
});

/**
 * The invitee's side of a pending request.
 *
 * - `accept`  — someone invited me; joins me to the project.
 * - `decline` — someone invited me; turns it down.
 * - `cancel`  — I asked to join myself and want to withdraw that request.
 *
 * `createdBy` decides which are legal, so a member cannot silently accept
 * their own request or decline someone else's.
 */
export const respondToInvitation = mutation({
  args: {
    token: v.optional(v.string()),
    requestId: v.id("joinRequests"),
    action: v.union(v.literal("accept"), v.literal("decline"), v.literal("cancel")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("REQUEST_NOT_FOUND");
    if (request.userId !== user._id) throw new Error("NOT_YOUR_REQUEST");
    if (request.status !== "pending") throw new Error("REQUEST_ALREADY_HANDLED");

    if (args.action === "cancel") {
      if (request.createdBy !== user._id) throw new Error("CANNOT_CANCEL_THIS");
      await ctx.db.delete(request._id);
      return null;
    }

    if (request.createdBy === user._id) {
      // This is my own join request: there is nobody to accept it.
      throw new Error("CANNOT_ACCEPT_OWN_REQUEST");
    }

    if (args.action === "decline") {
      await ctx.db.patch(request._id, {
        status: "rejected",
        decidedBy: user._id,
        decidedAt: nowMs(),
      });
      return null;
    }

    const project = await ctx.db.get(request.projectId);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.archived) throw new Error("PROJECT_ARCHIVED");
    if (await isProjectMember(ctx, project._id, user._id)) {
      throw new Error("ALREADY_A_MEMBER");
    }

    await ctx.db.insert("projectMembers", {
      projectId: project._id,
      userId: user._id,
      role: "member",
      addedBy: user._id,
      createdAt: nowMs(),
    });
    await ctx.db.patch(request._id, {
      status: "approved",
      decidedBy: user._id,
      decidedAt: nowMs(),
    });
    await logActivity(ctx, {
      projectId: project._id,
      actorId: user._id,
      type: "member_joined",
      message: `${user.name} 接受了邀请，加入项目`,
    });
    return null;
  },
});

export const listMyJoinRequests = query({
  args: { token: v.optional(v.string()) },
  returns: v.array(joinRequestValidator),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const requests = await ctx.db
      .query("joinRequests")
      .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "pending"))
      .collect();

    const result = [];
    for (const request of requests) {
      const project = await ctx.db.get(request.projectId);
      if (!project) continue;
      result.push({
        _id: request._id,
        projectId: request.projectId,
        projectName: project.name,
        user: publicUser(user),
        status: request.status,
        message: request.message,
        createdAt: request.createdAt,
        decidedAt: request.decidedAt,
      });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const removeMember = mutation({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx, args.token);
    const { project, membership } = await requireProjectMember(
      ctx,
      args.projectId,
      actor._id,
    );
    if (membership.role !== "owner") throw new Error("OWNER_ONLY");
    if (args.userId === project.ownerId) throw new Error("CANNOT_REMOVE_OWNER");

    const target = await ctx.db
      .query("projectMembers")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId),
      )
      .first();
    if (!target) return null;

    await ctx.db.delete(target._id);
    await logActivity(ctx, {
      projectId: args.projectId,
      actorId: actor._id,
      type: "member_left",
      message: "成员被移出项目",
    });
    return null;
  },
});

export const updateProject = mutation({
  args: {
    token: v.optional(v.string()),
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    sprintLengthDays: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireProjectMember(ctx, args.projectId, user._id);

    const patch: Record<string, string | number> = {};
    if (args.sprintLengthDays !== undefined) {
      const days = Math.floor(args.sprintLengthDays);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        throw new Error("INVALID_SPRINT_LENGTH");
      }
      patch.sprintLengthDays = days;
    }
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 1 || name.length > 80) throw new Error("INVALID_NAME");
      patch.name = name;
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim();
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.projectId, patch);
    }
    return null;
  },
});

export const deleteProject = mutation({
  args: { token: v.optional(v.string()), projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const { project } = await requireProjectMember(ctx, args.projectId, user._id);
    if (project.ownerId !== user._id) throw new Error("OWNER_ONLY");

    // Cascade by hand — Convex has no foreign keys.
    const boards = await ctx.db
      .query("boards")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Project deletion must also clear the 任务项 graph, which is keyed by
    // sprint rather than by the board that holds the goals.
    const allGoals = await ctx.db
      .query("goals")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const goal of allGoals) {
      const links = await ctx.db
        .query("goalTasks")
        .withIndex("by_goal", (q) => q.eq("goalId", goal._id))
        .collect();
      for (const link of links) await ctx.db.delete(link._id);
    }
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const task of allTasks) await ctx.db.delete(task._id);

    const attachments = await ctx.db
      .query("attachments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const row of attachments) {
      await ctx.db.delete(row._id);
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // ignore
      }
    }
    const checks = await ctx.db
      .query("checklistItems")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const row of checks) await ctx.db.delete(row._id);

    for (const board of boards) {
      const [columns, goals, points] = await Promise.all([
        ctx.db
          .query("columns")
          .withIndex("by_board", (q) => q.eq("boardId", board._id))
          .collect(),
        ctx.db
          .query("goals")
          .withIndex("by_board", (q) => q.eq("boardId", board._id))
          .collect(),
        ctx.db
          .query("burndown")
          .withIndex("by_scope_board", (q) =>
            q.eq("scope", "sprint").eq("boardId", board._id),
          )
          .collect(),
      ]);

      for (const column of columns) await ctx.db.delete(column._id);
      for (const point of points) await ctx.db.delete(point._id);
      for (const goal of goals) await ctx.db.delete(goal._id);
      await ctx.db.delete(board._id);
    }

    const [members, requests, logs] = await Promise.all([
      ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
      ctx.db
        .query("joinRequests")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("activityLog")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect(),
    ]);

    for (const row of [...members, ...requests, ...logs]) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(args.projectId);
    return null;
  },
});

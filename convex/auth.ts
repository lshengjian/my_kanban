import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  createSession,
  getUserByToken,
  normalizeEmail,
  publicUser,
  publicUserValidator,
  requireAdmin,
} from "./lib/auth";
import { hashPassword, verifyPassword } from "./lib/password";

const MIN_PASSWORD_LENGTH = 6;

export const register = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    password: v.string(),
  },
  returns: v.object({
    token: v.string(),
    user: publicUserValidator,
    isFirstUser: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const name = args.name.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("INVALID_EMAIL");
    }
    if (name.length < 1 || name.length > 60) {
      throw new Error("INVALID_NAME");
    }
    if (args.password.length < MIN_PASSWORD_LENGTH) {
      throw new Error("PASSWORD_TOO_SHORT");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (existing) {
      throw new Error("EMAIL_TAKEN");
    }

    // Bootstrap: the very first account to register owns the workspace.
    const isFirstUser = (await ctx.db.query("users").take(1)).length === 0;

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email,
      name,
      passwordHash: hashPassword(args.password),
      role: isFirstUser ? "admin" : "member",
      status: "active",
      createdAt: now,
    });

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("USER_CREATE_FAILED");

    const token = await createSession(ctx, userId);
    return { token, user: publicUser(user), isFirstUser };
  },
});

export const login = mutation({
  args: { email: v.string(), password: v.string() },
  returns: v.object({ token: v.string(), user: publicUserValidator }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    // Same message either way so the form cannot enumerate accounts.
    if (!user || !verifyPassword(args.password, user.passwordHash)) {
      throw new Error("INVALID_CREDENTIALS");
    }
    if (user.status === "suspended") {
      throw new Error("ACCOUNT_SUSPENDED");
    }

    const now = Date.now();
    await ctx.db.patch(user._id, { lastLoginAt: now });
    const token = await createSession(ctx, user._id);
    return { token, user: publicUser({ ...user, lastLoginAt: now }) };
  },
});

export const logout = mutation({
  args: { token: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .first();
    if (session) await ctx.db.delete(session._id);
    return null;
  },
});

export const me = query({
  args: { token: v.optional(v.string()) },
  returns: v.union(publicUserValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.token);
    return user ? publicUser(user) : null;
  },
});

// --- Admin: user management ---------------------------------------------

export const listUsers = query({
  args: { token: v.optional(v.string()) },
  returns: v.array(publicUserValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const users = await ctx.db.query("users").collect();
    return users
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((user) => publicUser(user));
  },
});

export const setUserRole = mutation({
  args: {
    token: v.optional(v.string()),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  returns: publicUserValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.role === args.role) return publicUser(target);

    // Never let the workspace end up with zero administrators.
    if (target.role === "admin" && args.role === "member") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .collect();
      if (admins.length <= 1) throw new Error("LAST_ADMIN");
    }

    await ctx.db.patch(target._id, { role: args.role });
    return publicUser({ ...target, role: args.role });
  },
});

export const setUserStatus = mutation({
  args: {
    token: v.optional(v.string()),
    userId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  returns: publicUserValidator,
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token);
    if (admin._id === args.userId && args.status === "suspended") {
      throw new Error("CANNOT_SUSPEND_SELF");
    }

    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.status === args.status) return publicUser(target);

    if (target.role === "admin" && args.status === "suspended") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .collect();
      if (admins.length <= 1) throw new Error("LAST_ADMIN");
    }

    await ctx.db.patch(target._id, { status: args.status });

    // Suspension revokes access immediately: drop every live session.
    if (args.status === "suspended") {
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", target._id))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
    }

    return publicUser({ ...target, status: args.status });
  },
});

export const adminStats = query({
  args: { token: v.optional(v.string()) },
  returns: v.object({
    users: v.number(),
    admins: v.number(),
    suspended: v.number(),
    projects: v.number(),
    boards: v.number(),
    goals: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const [users, projects, boards, goals] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("projects").collect(),
      ctx.db.query("boards").collect(),
      ctx.db.query("goals").collect(),
    ]);
    return {
      users: users.length,
      admins: users.filter((u) => u.role === "admin").length,
      suspended: users.filter((u) => u.status === "suspended").length,
      projects: projects.length,
      boards: boards.length,
      goals: goals.length,
    };
  },
});

/** Projects the caller owns, used by the shell to render the admin shortcut. */
export const isAdmin = query({
  args: { token: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.token);
    return user?.role === "admin";
  },
});

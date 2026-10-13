import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { readToken, writeToken } from "./session";
import type { EnvKey } from "./backend";
import AuthPage from "./components/AuthPage";
import AccountPage from "./components/AccountPage";
import ProjectsPage from "./components/ProjectsPage";
import ProjectPage from "./components/ProjectPage";
import BoardPage from "./components/BoardPage";
import AdminPage from "./components/AdminPage";
import PresetPage from "./components/PresetPage";
import { Avatar } from "./components/ui";

type View =
  | { kind: "projects" }
  | { kind: "project"; id: Id<"projects"> }
  | { kind: "board"; id: Id<"boards">; projectId: Id<"projects"> }
  | { kind: "admin" }
  | { kind: "presets" }
  | { kind: "account" };

export default function App({
  env,
  onChangeEnv,
}: {
  /** Which Convex deployment is in use; only the sign-in screen can change it. */
  env: EnvKey;
  onChangeEnv: (env: EnvKey) => void;
}) {
  const [token, setToken] = useState<string | null>(() => readToken());
  const [view, setView] = useState<View>({ kind: "projects" });
  const [booting, setBooting] = useState(true);

  const me = useQuery(api.auth.me, { token: token ?? undefined });
  const logout = useMutation(api.auth.logout);

  // Category management is restricted to the project creator, so remember which
  // projects this user owns. Gated on `me` rather than `token`: a stale token
  // left in localStorage is truthy but invalid, and running the query with it
  // throws UNAUTHENTICATED, blanking the page.
  const ownedProjects = useQuery(
    api.projects.listMyProjects,
    token && me ? { token, limit: 50 } : "skip",
  );
  // `listMyProjects` is paged; ownership only needs the member projects, and a
  // first page is enough because a creator's own projects lead the newest-first
  // ordering. Anything beyond the cap simply falls back to read-only category
  // editing rather than blocking the page.
  const projectOwnerIds = new Set(
    (ownedProjects?.items ?? [])
      .filter((p) => p.role === "owner")
      .map((p) => p._id),
  );

  // A session that no longer resolves (expired, or revoked by a suspension)
  // drops the app back to the sign-in screen.
  useEffect(() => {
    if (token && me === null) {
      writeToken(null);
      setToken(null);
      setView({ kind: "projects" });
    }
  }, [token, me]);

  useEffect(() => {
    if (me !== undefined) setBooting(false);
  }, [me]);

  if (booting) {
    return (
      <div className="auth-wrap">
        <div className="muted">加载中…</div>
      </div>
    );
  }

  if (!token || !me) {
    return (
      <AuthPage
        env={env}
        onChangeEnv={onChangeEnv}
        onAuthenticated={(t) => setToken(t)}
      />
    );
  }

  const isAdmin = me.role === "admin";

  const signOut = async () => {
    try {
      await logout({ token });
    } finally {
      writeToken(null);
      setToken(null);
      setView({ kind: "projects" });
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ kind: "projects" })}>
          <span className="brand-mark">◆</span>
          My KanBan
        </button>

        <nav className="nav">
          <button
            className={view.kind === "projects" || view.kind === "project" ? "active" : ""}
            onClick={() => setView({ kind: "projects" })}
          >
            项目
          </button>
          {isAdmin && (
            <>
              <button
                className={view.kind === "presets" ? "active" : ""}
                onClick={() => setView({ kind: "presets" })}
              >
                卡片类型
              </button>
              <button
                className={view.kind === "admin" ? "active" : ""}
                onClick={() => setView({ kind: "admin" })}
              >
                用户管理
              </button>
            </>
          )}
        </nav>

        <div className="topbar-right">
          {isAdmin && (
            <span
              className="badge"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              title="你是管理员"
            >
              👑 管理员
            </span>
          )}
          <span className="row" style={{ gap: 8 }}>
            <Avatar name={me.name} size="sm" />
            <span style={{ fontWeight: 550, fontSize: 13 }}>{me.name}</span>
          </span>
          <button className="btn btn-sm btn-ghost" onClick={signOut}>
            退出
          </button>
        </div>
      </header>

      {/* On a phone the top bar sits out of thumb reach and squeezes the
          content, so the same destinations get a fixed bottom bar instead. */}
      <nav className="tabbar">
        <button
          className={view.kind === "projects" || view.kind === "project" ? "active" : ""}
          onClick={() => setView({ kind: "projects" })}
        >
          <span aria-hidden>▦</span>项目
        </button>
        {isAdmin && (
          <>
            <button
              className={view.kind === "presets" ? "active" : ""}
              onClick={() => setView({ kind: "presets" })}
            >
              <span aria-hidden>◈</span>卡片类型
            </button>
            <button
              className={view.kind === "admin" ? "active" : ""}
              onClick={() => setView({ kind: "admin" })}
            >
              <span aria-hidden>👤</span>用户
            </button>
          </>
        )}
        <button
          className={view.kind === "account" ? "active" : ""}
          onClick={() => setView({ kind: "account" })}
        >
          <span aria-hidden>◎</span>我的
        </button>
      </nav>

      {view.kind === "projects" && (
        <ProjectsPage
          token={token}
          me={me}
          onOpenProject={(id) => setView({ kind: "project", id })}
        />
      )}

      {view.kind === "project" && (
        <ProjectPage
          key={view.id}
          token={token}
          projectId={view.id}
          userId={me._id}
          onOpenBoard={(id) =>
            setView({ kind: "board", id, projectId: view.id })
          }
          onBack={() => setView({ kind: "projects" })}
        />
      )}

      {view.kind === "board" && (
        <BoardPage
          key={view.id}
          token={token}
          boardId={view.id}
          currentUserId={me._id}
          onBack={() => setView({ kind: "project", id: view.projectId })}
          onNavigate={(id) => setView({ kind: "board", id, projectId: view.projectId })}
          isProjectOwner={projectOwnerIds.has(view.projectId)}
        />
      )}

      {view.kind === "account" && <AccountPage me={me} onSignOut={signOut} />}

      {view.kind === "presets" && <PresetPage token={token} />}

      {view.kind === "admin" && <AdminPage token={token} />}
    </div>
  );
}

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { writeToken } from "../session";
import { describeError } from "../lib/ui";

export default function AuthPage({
  onAuthenticated,
}: {
  onAuthenticated: (token: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const register = useMutation(api.auth.register);
  const login = useMutation(api.auth.login);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        const result = await register({ email, name, password });
        writeToken(result.token);
        onAuthenticated(result.token);
      } else {
        const result = await login({ email, password });
        writeToken(result.token);
        onAuthenticated(result.token);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="brand-mark">◆</span>
          <span style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>FlowBoard</span>
        </div>
        <h1>{mode === "login" ? "欢迎回来" : "创建账户"}</h1>
        <p className="auth-sub">
          {mode === "login"
            ? "登录以继续管理项目与看板"
            : "注册后即可创建项目、组建团队并跟踪交付进度"}
        </p>

        {mode === "register" && (
          <div className="banner">
            <span>👑</span>
            <span>
              <b>第一个注册的账户会成为管理员</b>，可提升其他用户权限或停用账户。
            </span>
          </div>
        )}

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            注册
          </button>
        </div>

        <form className="form-row" onSubmit={submit}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="name">姓名</label>
              <input
                id="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="张三"
                autoComplete="name"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>

          {error && <div className="error-text">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", padding: "10px" }}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并进入"}
          </button>
        </form>

        <div className="faint" style={{ marginTop: 16, fontSize: 12, textAlign: "center" }}>
          {mode === "login" ? "还没有账户？" : "已经有账户了？"}{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "立即注册" : "去登录"}
          </button>
        </div>
      </div>
    </div>
  );
}

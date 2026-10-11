import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Keeps a failed query or render from leaving the user with a blank page.
 *
 * A Convex query that rejects (an expired session, a permissions change, a
 * dropped connection) propagates into React's render loop, and without a
 * boundary the whole tree unmounts and the tab just goes white. This catches
 * that, shows what happened, and offers a way back.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // A dead session is recoverable in place: drop it and reload.
    const text = String(error?.message ?? error);
    if (text.includes("UNAUTHENTICATED") || text.includes("SUSPENDED")) {
      try {
        localStorage.removeItem("flowboard.token");
      } catch {
        /* storage unavailable */
      }
    }

    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>⚠️</div>
          <h1>页面出错了</h1>
          <p className="auth-sub" style={{ marginBottom: 18 }}>
            {text.includes("UNAUTHENTICATED") || text.includes("SUSPENDED")
              ? "登录状态已失效，请重新登录。"
              : "数据加载失败，请重试。"}
          </p>
          <details style={{ textAlign: "left", marginBottom: 16 }}>
            <summary
              style={{ cursor: "pointer", fontSize: 12.5, color: "var(--text-dim)" }}
            >
              技术详情
            </summary>
            <pre
              style={{
                marginTop: 8,
                fontSize: 11.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "var(--text-faint)",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {text}
            </pre>
          </details>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={this.reset}>
              重试
            </button>
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
